<?php

declare(strict_types=1);

namespace Aicountly\Api\Http;

use Aicountly\Api\Access\Role;
use Aicountly\Api\Access\StaffSession;
use Aicountly\Api\Desk\Queue;
use Aicountly\Api\Json;

/**
 * The staff reception desk: who is waiting, and taking them.
 *
 * Read by people standing at a front desk with a queue of real visitors in
 * front of them, so two things matter more than anywhere else in this product.
 *
 * **Nothing is invented.** Every figure on this screen is a count of records
 * that exist. There is no sample queue, no placeholder visitor and no
 * illustrative "3 waiting" — an empty lobby renders as an empty lobby. A
 * demonstration queue on a production desk would have somebody walk over to a
 * chair that nobody is sitting in.
 *
 * **A claim is reported from what was written.** The desk says "you have this
 * visitor" only when the store says so, and says who does have them when it
 * does not. That is the difference between a race that is resolved and a race
 * that is hidden.
 */
final class DeskController
{
    public function __construct(
        private readonly Queue $queue,
        private readonly StaffSession $session,
    ) {
    }

    /**
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
                    : 'You are not on the staff list for this business. Ask an owner to add you.',
                'code' => 'forbidden',
                'role' => $this->session->role,
            ],
        ];
    }

    /**
     * The queue, and what this member of staff currently holds.
     *
     * `mine` is separated out because it is what the person reading this screen
     * actually needs to act on, and scanning a shared list for your own uuid is
     * not a thing to ask of somebody with a visitor waiting.
     *
     * @return array{status: int, body: array<string, mixed>}
     */
    public function index(): array
    {
        if ($refusal = $this->refuse(Role::VIEW_DESK)) {
            return $refusal;
        }

        $entries = $this->queue->forDesk($this->session->tenant);

        $waiting = [];
        $mine = [];
        $withOthers = [];
        $closed = [];

        foreach ($entries as $entry) {
            switch ($entry['state']) {
                case Queue::REQUESTED:
                case Queue::QUEUED:
                    $waiting[] = self::redact($entry, $this->session->uuid);
                    break;
                case Queue::ASSIGNED:
                case Queue::ACCEPTED:
                    if ($entry['assignedTo'] === $this->session->uuid) {
                        $mine[] = self::redact($entry, $this->session->uuid);
                    } else {
                        $withOthers[] = self::redact($entry, $this->session->uuid);
                    }
                    break;
                default:
                    $closed[] = self::redact($entry, $this->session->uuid);
            }
        }

        return [
            'status' => 200,
            'body' => [
                'waiting' => $waiting,
                'mine' => $mine,
                'withOthers' => $withOthers,
                'recentlyClosed' => $closed,
                'counts' => [
                    'waiting' => count($waiting),
                    'mine' => count($mine),
                    'withOthers' => count($withOthers),
                ],
                'capacity' => Queue::capacity(),
                'acceptGraceSeconds' => Queue::ACCEPT_GRACE_SECONDS,
                'you' => $this->session->uuid,
                'serverTime' => gmdate('c'),
            ],
        ];
    }

    /**
     * Take, accept, hand back, or finish with a visitor.
     *
     * The action is matched against a fixed list before anything is attempted,
     * so a path segment can never reach the state machine as a state name.
     *
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function act(string $id, string $action, array $body): array
    {
        if ($refusal = $this->refuse(Role::WORK_DESK)) {
            return $refusal;
        }

        $tenant = $this->session->tenant;
        $uuid = $this->session->uuid;

        $result = match ($action) {
            'claim' => $this->queue->claim($tenant, $id, $uuid),
            'accept' => $this->queue->accept($tenant, $id, $uuid),
            'release' => $this->queue->release($tenant, $id, $uuid),
            'resolve' => $this->queue->resolve($tenant, $id, $uuid, Json::text($body['outcome'] ?? '', Queue::MAX_REASON_CHARS)),
            default => null,
        };

        if ($result === null) {
            return ['status' => 404, 'body' => ['message' => 'There is no such action.', 'code' => 'unknown_action']];
        }

        if (!$result['ok']) {
            // 409, not 403: this is not a permission problem, it is somebody
            // else having got there first, and the interface should say so and
            // refresh rather than suggesting the user lacks access.
            return [
                'status' => 409,
                'body' => [
                    'message' => $result['error'],
                    'code' => 'queue_conflict',
                    // Whether it is *you* who holds it, never who else does.
                    // A queue screen is not a staff directory.
                    'heldByYou' => $result['heldBy'] !== '' && $result['heldBy'] === $uuid,
                    'entry' => $result['entry'] === [] ? null : self::redact($result['entry'], $uuid),
                ],
            ];
        }

        return ['status' => 200, 'body' => ['entry' => self::redact($result['entry'], $uuid)]];
    }

    /**
     * Strip the holder's uuid out of anything leaving this server.
     *
     * The desk needs to know whether an entry is theirs; it does not need
     * another member of staff's portal uuid, which is an identifier for a real
     * person across every product on the fleet. `mine` carries the answer
     * instead.
     *
     * @param array<string, mixed> $entry
     * @return array<string, mixed>
     */
    private static function redact(array $entry, string $viewer): array
    {
        $assignedTo = (string) ($entry['assignedTo'] ?? '');
        unset($entry['assignedTo']);

        $entry['mine'] = $assignedTo !== '' && $assignedTo === $viewer;
        $entry['taken'] = $assignedTo !== '';

        foreach (['requestedAt', 'queuedAt', 'assignedAt', 'acceptedAt', 'closedAt'] as $field) {
            $value = (int) ($entry[$field] ?? 0);
            $entry[$field] = $value > 0 ? gmdate('c', $value) : null;
        }

        return $entry;
    }
}
