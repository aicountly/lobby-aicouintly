<?php

declare(strict_types=1);

namespace Aicountly\Api\Http;

use Aicountly\Api\Access\Role;
use Aicountly\Api\Access\StaffSession;
use Aicountly\Api\Config\ConfigStore;
use Aicountly\Api\Config\Schema;
use Aicountly\Api\Json;
use Aicountly\Api\Store\FileRepository;
use Aicountly\Api\Store\Repository;
use Aicountly\Api\Store\RevisionConflict;
use Aicountly\Api\Store\StoreException;

/**
 * The business setup surface: what the receptionist is allowed to say, and who
 * may change it.
 *
 * Every method here re-checks the caller's permission against
 * {@see StaffSession}, and every one takes the tenant from that session rather
 * than from the request. Two rules, and neither is negotiable at this layer:
 *
 *   - The interface hiding a control is not a permission check. An `agent` who
 *     crafts a PUT to the draft endpoint is refused here, by this code, not by
 *     the absence of a button.
 *   - A caller cannot name the tenant they are editing. It comes from the host
 *     the request arrived on, resolved server-side, which is what makes
 *     cross-tenant editing unreachable rather than merely unattempted.
 *
 * Responses are `{status, body}` so that routing stays in one place and these
 * methods stay testable without a web server.
 */
final class AdminController
{
    public function __construct(
        private readonly Repository $repository,
        private readonly ConfigStore $config,
        private readonly StaffSession $session,
    ) {
    }

    /**
     * Refuse unless the caller holds this permission.
     *
     * @return array{status: int, body: array<string, mixed>}|null
     */
    private function refuse(string $permission): ?array
    {
        if ($this->session->can($permission)) {
            return null;
        }

        return [
            'status' => 403,
            'body' => [
                'message' => $this->session->isStaff()
                    ? 'Your role does not allow that.'
                    : 'You do not have access to this business. Ask an owner to add you.',
                'code' => 'forbidden',
                'role' => $this->session->role,
            ],
        ];
    }

    // -----------------------------------------------------------------------
    // Configuration
    // -----------------------------------------------------------------------

    /**
     * The draft, the published document, and whether they differ.
     *
     * Both are returned together because the setup screens show the draft and
     * need to say what is currently live beside it. An administrator editing
     * hours should be able to see, without leaving the page, that the public
     * is still being told the old ones.
     *
     * @return array{status: int, body: array<string, mixed>}
     */
    public function showConfig(): array
    {
        if ($refusal = $this->refuse(Role::VIEW_CONFIG)) {
            return $refusal;
        }

        $tenant = $this->session->tenant;
        $draft = $this->config->draft($tenant);
        $published = $this->config->published($tenant);

        return [
            'status' => 200,
            'body' => [
                'tenant' => $tenant,
                'draft' => ['data' => $draft['data'], 'revision' => $draft['revision'], 'source' => $draft['source']],
                'published' => [
                    'data' => $published['data'],
                    'revision' => $published['revision'],
                    'source' => $published['source'],
                    'updatedAt' => $published['updatedAt'] > 0 ? gmdate('c', $published['updatedAt']) : null,
                ],
                'hasUnpublishedChanges' => $this->config->hasUnpublishedChanges($tenant),
                'storage' => $this->storageState(),
                'tones' => Schema::TONES,
                'voiceModes' => Schema::VOICE_MODES,
                'permissions' => Role::permissions($this->session->role),
            ],
        ];
    }

    /**
     * Save the draft.
     *
     * `revision` must be the one the browser was given. A second administrator
     * who saved in between wins, and this one is told to reload rather than
     * having their copy of the form silently overwrite the other's work.
     *
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function saveDraft(array $body): array
    {
        if ($refusal = $this->refuse(Role::EDIT_CONFIG)) {
            return $refusal;
        }

        if (!array_key_exists('revision', $body) || !is_int($body['revision'])) {
            return [
                'status' => 400,
                'body' => ['message' => 'Send the revision you loaded, so a concurrent edit can be detected.', 'code' => 'revision_required'],
            ];
        }

        try {
            $result = $this->config->saveDraft($this->session->tenant, $body['config'] ?? null, $body['revision']);
        } catch (StoreException $error) {
            return self::storeFailure($error);
        }

        if (!$result['ok']) {
            return [
                'status' => 422,
                'body' => ['message' => 'Some of that could not be saved.', 'code' => 'invalid', 'errors' => $result['errors']],
            ];
        }

        return [
            'status' => 200,
            'body' => [
                'revision' => $result['revision'],
                'data' => $result['data'],
                'hasUnpublishedChanges' => $this->config->hasUnpublishedChanges($this->session->tenant),
            ],
        ];
    }

    /**
     * Make the draft live.
     *
     * A separate permission from editing, because it is a separate act: writing
     * a draft affects nobody, and publishing changes what a receptionist says
     * to the public the moment it returns.
     *
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function publish(array $body): array
    {
        if ($refusal = $this->refuse(Role::PUBLISH_CONFIG)) {
            return $refusal;
        }

        if (!is_int($body['revision'] ?? null)) {
            return [
                'status' => 400,
                'body' => ['message' => 'Send the draft revision you reviewed.', 'code' => 'revision_required'],
            ];
        }

        try {
            $result = $this->config->publish($this->session->tenant, $body['revision']);
        } catch (StoreException $error) {
            return self::storeFailure($error);
        }

        if (!$result['ok']) {
            return [
                'status' => 422,
                'body' => ['message' => 'That draft cannot be published as it is.', 'code' => 'invalid', 'errors' => $result['errors']],
            ];
        }

        return [
            'status' => 200,
            'body' => [
                'published' => true,
                'revision' => $result['revision'],
                'hasUnpublishedChanges' => false,
            ],
        ];
    }

    /** @return array{status: int, body: array<string, mixed>} */
    public function discardDraft(): array
    {
        if ($refusal = $this->refuse(Role::EDIT_CONFIG)) {
            return $refusal;
        }

        $this->config->discardDraft($this->session->tenant);

        return ['status' => 200, 'body' => ['discarded' => true]];
    }

    // -----------------------------------------------------------------------
    // Staff
    // -----------------------------------------------------------------------

    /** @return array{status: int, body: array<string, mixed>} */
    public function showStaff(): array
    {
        if ($refusal = $this->refuse(Role::MANAGE_STAFF)) {
            return $refusal;
        }

        return [
            'status' => 200,
            'body' => [
                'members' => StaffSession::roster($this->repository, $this->session->tenant),
                'revision' => StaffSession::rosterRevision($this->repository, $this->session->tenant),
                'roles' => Role::ASSIGNABLE,
                'you' => $this->session->uuid,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function saveStaff(array $body): array
    {
        if ($refusal = $this->refuse(Role::MANAGE_STAFF)) {
            return $refusal;
        }

        if (!is_int($body['revision'] ?? null)) {
            return ['status' => 400, 'body' => ['message' => 'Send the revision you loaded.', 'code' => 'revision_required']];
        }

        $members = is_array($body['members'] ?? null) ? $body['members'] : [];

        try {
            $result = StaffSession::saveRoster($this->repository, $this->session->tenant, $members, $body['revision']);
        } catch (StoreException $error) {
            return self::storeFailure($error);
        }

        if (!$result['ok']) {
            return ['status' => 422, 'body' => ['message' => $result['error'], 'code' => 'invalid']];
        }

        return [
            'status' => 200,
            'body' => [
                'members' => StaffSession::roster($this->repository, $this->session->tenant),
                'revision' => StaffSession::rosterRevision($this->repository, $this->session->tenant),
            ],
        ];
    }

    // -----------------------------------------------------------------------
    // Shared
    // -----------------------------------------------------------------------

    /**
     * Whether anything here can be saved at all.
     *
     * Returned with the configuration so the setup screens can disable saving
     * and say why, rather than presenting a form that fails on submit.
     *
     * @return array<string, mixed>
     */
    private function storageState(): array
    {
        if (!$this->repository instanceof FileRepository) {
            return ['writable' => $this->repository->writable(), 'reason' => '', 'legacyFile' => null];
        }

        return [
            'writable' => $this->repository->writable(),
            'reason' => $this->repository->unavailableReason(),
            'webReachable' => $this->repository->insideDocumentRoot(),
            'legacyFile' => ConfigStore::legacyExists() ? ConfigStore::legacyPath() : null,
        ];
    }

    /**
     * @return array{status: int, body: array<string, mixed>}
     */
    private static function storeFailure(StoreException $error): array
    {
        $body = ['message' => $error->getMessage(), 'code' => $error->code()];
        if ($error instanceof RevisionConflict) {
            $body['expected'] = $error->expected;
            $body['actual'] = $error->actual;
        }

        return ['status' => $error->status(), 'body' => $body];
    }

    /** Small helper so routes can read a bounded string out of a body. */
    public static function text(array $body, string $key, int $max): string
    {
        return Json::text($body[$key] ?? '', $max);
    }
}
