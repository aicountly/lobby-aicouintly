<?php

declare(strict_types=1);

namespace Aicountly\Api\Config;

use Aicountly\Api\Env;
use Aicountly\Api\Store\Record;
use Aicountly\Api\Store\Repository;
use Aicountly\Api\Store\RevisionConflict;
use Aicountly\Api\Store\StoreUnavailable;

/**
 * The tenant's reception configuration, in two versions: draft and published.
 *
 * ## Why two
 *
 * A visitor is standing in the lobby while somebody in the back office is
 * halfway through rewriting the opening hours. One document would mean the
 * receptionist states a half-typed sentence to a member of the public. So a
 * visitor only ever reads `published`, an administrator edits `draft`, and
 * publishing is a deliberate, separately permitted act with its own audit row.
 *
 * Preview reads `draft`, and requires a staff session to do it. That is the
 * only way to see unpublished text, and it is why preview is not simply "the
 * public page with a flag".
 *
 * ## Migrating the file that came before
 *
 * Phase 2C put a `knowledge.json` beside `.env`, created by hand on the server.
 * Tenants have real content in it and it is live right now, so it is imported,
 * once, into `published` the first time a tenant is read — and the original
 * file is left exactly where it is. Nothing deletes it: it is the operator's
 * file, it is the rollback, and a migration that removes its own source is one
 * that cannot be undone.
 *
 * The import is skipped as soon as a `published` record exists, including an
 * empty one. An administrator who deliberately cleared everything must not find
 * the old file's contents back the next morning.
 *
 * ## When there is nowhere to write
 *
 * A host that has not set `LOBBY_DATA_DIR` yet still has a working reception
 * from Phase 2C, and this phase must not take it away. So the legacy file is
 * still *read* when the store is unwritable — it simply cannot be edited, and
 * the operator diagnostic says which variable to set. Reception keeps
 * answering; only the new setup screens are unavailable.
 */
final class ConfigStore
{
    public const COLLECTION = 'config';

    public const DRAFT = 'draft';

    public const PUBLISHED = 'published';

    public function __construct(
        private readonly Repository $repository,
    ) {
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    /**
     * What visitors get. Never the draft, under any flag.
     *
     * @return array{data: array<string, mixed>, revision: int, source: string, updatedAt: int}
     */
    public function published(string $tenant): array
    {
        $record = $this->repository->get($tenant, self::COLLECTION, self::PUBLISHED);
        if ($record !== null) {
            return self::shape($record, 'store');
        }

        $legacy = self::legacy();
        if ($legacy === null) {
            return ['data' => Schema::blank(), 'revision' => 0, 'source' => 'unconfigured', 'updatedAt' => 0];
        }

        // Import once, if there is anywhere to import to. A failure here is not
        // fatal and is not retried in a loop: the legacy content is returned
        // either way, so reception answers exactly as it did before.
        try {
            $imported = $this->repository->put($tenant, self::COLLECTION, self::PUBLISHED, $legacy, 0);

            return self::shape($imported, 'migrated');
        } catch (RevisionConflict) {
            // Another request imported it between the read and the write.
            $record = $this->repository->get($tenant, self::COLLECTION, self::PUBLISHED);

            return $record !== null
                ? self::shape($record, 'store')
                : ['data' => $legacy, 'revision' => 0, 'source' => 'legacy-file', 'updatedAt' => 0];
        } catch (StoreUnavailable) {
            return ['data' => $legacy, 'revision' => 0, 'source' => 'legacy-file', 'updatedAt' => 0];
        }
    }

    /**
     * What an administrator edits.
     *
     * A tenant that has never opened the setup screens has no draft, so the
     * published document is handed back as the starting point. Editing it
     * creates the draft; until then there is nothing unpublished to lose.
     *
     * @return array{data: array<string, mixed>, revision: int, source: string, updatedAt: int}
     */
    public function draft(string $tenant): array
    {
        $record = $this->repository->get($tenant, self::COLLECTION, self::DRAFT);
        if ($record !== null) {
            return self::shape($record, 'draft');
        }

        $published = $this->published($tenant);

        return [
            'data' => $published['data'],
            // Zero, not the published revision: the draft genuinely does not
            // exist, and a first save must be a create rather than an update.
            'revision' => 0,
            'source' => 'from-published',
            'updatedAt' => 0,
        ];
    }

    /** Is there unpublished work? Shown as a badge, so an edit is not forgotten. */
    public function hasUnpublishedChanges(string $tenant): bool
    {
        $draft = $this->repository->get($tenant, self::COLLECTION, self::DRAFT);
        if ($draft === null) {
            return false;
        }

        $published = $this->repository->get($tenant, self::COLLECTION, self::PUBLISHED);

        return $published === null || $published->data !== $draft->data;
    }

    // -----------------------------------------------------------------------
    // Writing
    // -----------------------------------------------------------------------

    /**
     * Save a draft, refusing if somebody else saved since this was opened.
     *
     * @param mixed $input
     * @return array{ok: bool, errors: array<int, array{field: string, message: string}>, revision: int, data: array<string, mixed>}
     */
    public function saveDraft(string $tenant, mixed $input, int $expectedRevision): array
    {
        $validated = Schema::validate($input);
        if ($validated['errors'] !== []) {
            return ['ok' => false, 'errors' => $validated['errors'], 'revision' => $expectedRevision, 'data' => $validated['data']];
        }

        $record = $this->repository->put($tenant, self::COLLECTION, self::DRAFT, $validated['data'], $expectedRevision);

        return ['ok' => true, 'errors' => [], 'revision' => $record->revision, 'data' => $record->data];
    }

    /**
     * Promote the draft to published.
     *
     * Re-validated on the way through rather than trusted because it was
     * validated on the way in: a document can reach the draft record from an
     * import or a restored backup, and what a visitor is told is the last place
     * to take something on trust. A draft that no longer validates is refused
     * with its errors, not published with them.
     *
     * @return array{ok: bool, errors: array<int, array{field: string, message: string}>, revision: int}
     */
    public function publish(string $tenant, int $expectedDraftRevision): array
    {
        $draft = $this->repository->get($tenant, self::COLLECTION, self::DRAFT);
        if ($draft === null) {
            return ['ok' => false, 'errors' => [['field' => '', 'message' => 'There is nothing to publish.']], 'revision' => 0];
        }

        if ($draft->revision !== $expectedDraftRevision) {
            throw new RevisionConflict($expectedDraftRevision, $draft->revision);
        }

        $validated = Schema::validate($draft->data);
        if ($validated['errors'] !== []) {
            return ['ok' => false, 'errors' => $validated['errors'], 'revision' => $draft->revision];
        }

        $current = $this->repository->get($tenant, self::COLLECTION, self::PUBLISHED);
        $published = $this->repository->put(
            $tenant,
            self::COLLECTION,
            self::PUBLISHED,
            $validated['data'],
            $current?->revision ?? 0,
        );

        return ['ok' => true, 'errors' => [], 'revision' => $published->revision];
    }

    /**
     * Throw away the draft and start again from what is live.
     *
     * Deleting the draft rather than copying the published document into it, so
     * that "no draft" keeps meaning "nothing unpublished".
     */
    public function discardDraft(string $tenant): void
    {
        $this->repository->delete($tenant, self::COLLECTION, self::DRAFT);
    }

    // -----------------------------------------------------------------------
    // The file this replaced
    // -----------------------------------------------------------------------

    /** Where the Phase 2C file is, if it is anywhere. */
    public static function legacyPath(): string
    {
        $configured = Env::get('LOBBY_KNOWLEDGE_FILE');

        return $configured !== '' ? $configured : dirname(__DIR__, 2) . '/knowledge.json';
    }

    public static function legacyExists(): bool
    {
        return is_readable(self::legacyPath());
    }

    /**
     * The legacy file, mapped onto the current schema.
     *
     * The old shape is a subset of the new one, with one difference worth
     * naming: `handover` was `{instructions: string}` and is now
     * `{enabled: bool, message: string}`. A tenant who wrote instructions meant
     * them to be used, so the import turns that into an enabled handover
     * carrying the same text. Nothing else is inferred — in particular the
     * visitor journeys stay off, because the old file said nothing about them
     * and switching a public booking journey on for somebody is not a
     * migration's decision to make.
     *
     * @return array<string, mixed>|null
     */
    public static function legacy(): ?array
    {
        $path = self::legacyPath();
        if (!is_readable($path)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($path), true, 32);
        if (!is_array($decoded) || $decoded === []) {
            return null;
        }

        $handover = is_array($decoded['handover'] ?? null) ? $decoded['handover'] : [];
        $instructions = is_string($handover['instructions'] ?? null) ? $handover['instructions'] : '';
        if ($instructions !== '') {
            $decoded['handover'] = ['enabled' => true, 'message' => $instructions];
        }

        // Validated, not trusted: it is a hand-edited file on a server, and it
        // is about to become what a receptionist says to the public. Field
        // errors are dropped rather than raised — there is nobody at a form to
        // show them to — and the normalised value is what carries forward.
        return Schema::validate($decoded)['data'];
    }

    /**
     * @return array{data: array<string, mixed>, revision: int, source: string, updatedAt: int}
     */
    private static function shape(Record $record, string $source): array
    {
        // Normalised on the way out so a document written by an older version
        // of this code still has every key a caller expects.
        $merged = array_replace_recursive(Schema::blank(), $record->data);

        return [
            'data' => $merged,
            'revision' => $record->revision,
            'source' => $source,
            'updatedAt' => $record->updatedAt,
        ];
    }
}
