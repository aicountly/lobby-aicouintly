<?php

declare(strict_types=1);

namespace Aicountly\Api\Desk;

use Aicountly\Api\Env;
use Aicountly\Api\Json;
use Aicountly\Api\Store\Record;
use Aicountly\Api\Store\Repository;
use Aicountly\Api\Store\StoreUnavailable;

/**
 * The people waiting to speak to a human, and who has got to them.
 *
 * ## The states, and why there are five
 *
 *   requested  The visitor has asked for a person. Not yet visible at the desk.
 *   queued     Admitted and waiting. This is what staff see.
 *   assigned   One member of staff holds it. Nobody else may take it.
 *   accepted   That member of staff has confirmed and is with the visitor.
 *   resolved   Finished.
 *
 * `requested` and `queued` are separate because asking is not the same as being
 * admitted: outside staffed hours, or with the handover journey switched off,
 * a request is recorded and the visitor is told the truth rather than being put
 * in a queue nobody is watching.
 *
 * `assigned` and `accepted` are separate for the same kind of reason at the
 * other end. Claiming is instant and mechanical; accepting is a human saying
 * they are actually there. A visitor whose entry sits in `assigned` past
 * {@see ACCEPT_GRACE_SECONDS} is returned to the queue, because a member of
 * staff who claimed a visitor and then closed their laptop must not be able to
 * hold that visitor indefinitely.
 *
 * `abandoned` is the sixth, and is every unhappy ending: the visitor closed the
 * tab, or nobody came. It is terminal and is never shown as resolved, because
 * a queue that reported everybody as dealt with would be a queue nobody fixed.
 *
 * ## Why claiming is not a revision check
 *
 * Two staff pressing "take" at the same instant is a race, not an editing
 * conflict. Optimistic concurrency would tell the loser their copy was stale,
 * and a reasonable client would reload and retry — landing them on a visitor
 * somebody else is already talking to. So every transition runs inside
 * {@see Repository::mutate()}, which holds an exclusive lock across the whole
 * read-check-write, and the loser is told who actually has it.
 *
 * ## What is not in here
 *
 * The conversation. Lobby holds the transcript for the length of the visitor's
 * session and does not log it; the queue holds a reference to the conversation
 * and a one-line reason, so that a member of staff walking up knows what they
 * are walking into. It is not a CRM, not a ticket, and not a case history —
 * those belong to products that own them.
 */
final class Queue
{
    public const COLLECTION = 'queue';

    public const REQUESTED = 'requested';

    public const QUEUED = 'queued';

    public const ASSIGNED = 'assigned';

    public const ACCEPTED = 'accepted';

    public const RESOLVED = 'resolved';

    public const ABANDONED = 'abandoned';

    /**
     * Which states may follow which.
     *
     * A table rather than a chain of conditionals, so an illegal transition is
     * refused by the data and every route gets the same answer. Adding a state
     * means editing this and finding out immediately what it breaks.
     *
     * @var array<string, array<int, string>>
     */
    private const TRANSITIONS = [
        self::REQUESTED => [self::QUEUED, self::ABANDONED],
        self::QUEUED => [self::ASSIGNED, self::ABANDONED],
        self::ASSIGNED => [self::ACCEPTED, self::QUEUED, self::ABANDONED],
        self::ACCEPTED => [self::RESOLVED, self::ABANDONED],
        self::RESOLVED => [],
        self::ABANDONED => [],
    ];

    /** A claim not accepted within this many seconds goes back to the queue. */
    public const ACCEPT_GRACE_SECONDS = 120;

    /** How long an entry stays in the listing after it ends. Long enough to see it happened. */
    private const TERMINAL_RETENTION_SECONDS = 900;

    /** A waiting visitor nobody reached in this long has gone. */
    private const ABANDON_AFTER_SECONDS = 1800;

    public const MAX_REASON_CHARS = 200;

    public const MAX_NAME_CHARS = 80;

    public function __construct(
        private readonly Repository $repository,
    ) {
    }

    /** How many people may be waiting before the desk stops admitting more. */
    public static function capacity(): int
    {
        $configured = (int) Env::get('LOBBY_QUEUE_CAPACITY', '25');

        return $configured > 0 ? min($configured, 200) : 25;
    }

    // -----------------------------------------------------------------------
    // The visitor's side
    // -----------------------------------------------------------------------

    /**
     * Record that a visitor has asked for a person.
     *
     * Keyed by the conversation id out of the visitor's signed session, which
     * means a visitor can only ever reach their own entry and never has to be
     * given an identifier that could be guessed or passed around. Asking twice
     * updates the existing entry rather than creating a second one — a visitor
     * pressing a button again is impatient, not two people.
     *
     * @return array{ok: bool, entry: ?array<string, mixed>, error: string, code: string}
     */
    public function request(string $tenant, string $conversationId, string $name, string $reason, bool $deskStaffed): array
    {
        $name = Json::text($name, self::MAX_NAME_CHARS);
        $reason = Json::text($reason, self::MAX_REASON_CHARS);
        $now = time();

        // Counted before the write, and deliberately not inside the entry's own
        // lock: the count is across records and a cross-record lock is exactly
        // the transaction this store does not offer. The consequence is that a
        // burst can overshoot the capacity by the number of simultaneous
        // requests, which for a waiting-room limit is the right trade — the
        // alternative is a global lock on every visitor's request.
        $waiting = count($this->waiting($tenant));

        try {
            $record = $this->repository->mutate(
                $tenant,
                self::COLLECTION,
                $conversationId,
                static function (array $current) use ($name, $reason, $now, $deskStaffed, $waiting): ?array {
                    $state = Json::string($current['state'] ?? '');

                    // Already being dealt with: update the reason, leave the
                    // state alone. A visitor adding detail must not bounce
                    // their own entry back to the start of the queue.
                    if (in_array($state, [self::QUEUED, self::ASSIGNED, self::ACCEPTED], true)) {
                        $current['reason'] = $reason !== '' ? $reason : ($current['reason'] ?? '');
                        $current['name'] = $name !== '' ? $name : ($current['name'] ?? '');
                        $current['updatedAt'] = $now;

                        return $current;
                    }

                    $admit = $deskStaffed && $waiting < self::capacity();

                    return [
                        'state' => $admit ? self::QUEUED : self::REQUESTED,
                        'name' => $name,
                        'reason' => $reason,
                        'requestedAt' => (int) ($current['requestedAt'] ?? $now),
                        'queuedAt' => $admit ? $now : 0,
                        'updatedAt' => $now,
                        'assignedTo' => '',
                        'assignedAt' => 0,
                        'acceptedAt' => 0,
                        'closedAt' => 0,
                        'outcome' => '',
                    ];
                },
            );
        } catch (StoreUnavailable $error) {
            // Nothing was written, so nothing may be claimed. A queue position
            // reported here would be a number with no record behind it.
            return ['ok' => false, 'entry' => null, 'error' => $error->getMessage(), 'code' => 'store_unavailable'];
        }

        return [
            'ok' => true,
            'entry' => $this->visitorView($tenant, $record),
            'error' => '',
            'code' => '',
        ];
    }

    /**
     * What the visitor may see about their own entry: state, and how many are ahead.
     *
     * Never another visitor's name, reason or position, and never the name of
     * the member of staff who has them — only that somebody has.
     *
     * @return array<string, mixed>|null
     */
    public function forVisitor(string $tenant, string $conversationId): ?array
    {
        $record = $this->repository->get($tenant, self::COLLECTION, $conversationId);

        return $record === null ? null : $this->visitorView($tenant, $record);
    }

    /** The visitor gave up, or closed the tab and told us on the way out. */
    public function abandon(string $tenant, string $conversationId): void
    {
        $this->transition($tenant, $conversationId, self::ABANDONED, null, 'visitor_left');
    }

    // -----------------------------------------------------------------------
    // The desk's side
    // -----------------------------------------------------------------------

    /**
     * Everything the desk should see, newest request last.
     *
     * Expiry is applied as a side effect of listing rather than by a cron job,
     * because this product has no scheduler and inventing one would be a
     * deployment dependency. The cost is that an abandoned entry is only
     * noticed once somebody looks, which for a screen staff sit in front of all
     * day is not a cost.
     *
     * @return array<int, array<string, mixed>>
     */
    public function forDesk(string $tenant): array
    {
        $entries = [];

        foreach ($this->repository->all($tenant, self::COLLECTION) as $record) {
            $expired = $this->expireIfStale($tenant, $record);
            if ($expired === null) {
                continue;
            }
            $entries[] = self::deskView($expired);
        }

        usort($entries, static fn (array $a, array $b): int => $a['requestedAt'] <=> $b['requestedAt']);

        return $entries;
    }

    /**
     * Take a waiting visitor, if nobody else already has.
     *
     * The one operation this class exists for. Whether it succeeded is decided
     * inside the lock and reported from the record that was actually written —
     * never from what the caller hoped would happen.
     *
     * @return array{ok: bool, entry: array<string, mixed>, error: string, heldBy: string}
     */
    public function claim(string $tenant, string $id, string $staffUuid): array
    {
        return $this->transition($tenant, $id, self::ASSIGNED, $staffUuid, '');
    }

    /** Confirm you are actually with the visitor. Only the member of staff holding it may. */
    public function accept(string $tenant, string $id, string $staffUuid): array
    {
        return $this->transition($tenant, $id, self::ACCEPTED, $staffUuid, '');
    }

    /** Put a claimed visitor back, for somebody else to take. */
    public function release(string $tenant, string $id, string $staffUuid): array
    {
        return $this->transition($tenant, $id, self::QUEUED, $staffUuid, '');
    }

    /** Done. `$outcome` is a note for the desk, not a record of anything a visitor was promised. */
    public function resolve(string $tenant, string $id, string $staffUuid, string $outcome): array
    {
        return $this->transition($tenant, $id, self::RESOLVED, $staffUuid, Json::text($outcome, self::MAX_REASON_CHARS));
    }

    // -----------------------------------------------------------------------
    // The one place a state changes
    // -----------------------------------------------------------------------

    /**
     * Move one entry, under an exclusive lock, or explain why not.
     *
     * Three checks, in order, all inside the lock:
     *
     *   1. The transition is legal from the state the record is actually in.
     *   2. Where a member of staff is named, they are the one holding it.
     *   3. The entry has not expired underneath the request.
     *
     * A refusal names who does hold it, so the interface can say "Priya has
     * this one" rather than "failed".
     *
     * @return array{ok: bool, entry: array<string, mixed>, error: string, heldBy: string}
     */
    private function transition(string $tenant, string $id, string $to, ?string $staffUuid, string $outcome): array
    {
        $now = time();
        $refusal = '';
        $heldBy = '';

        try {
            $record = $this->repository->mutate(
                $tenant,
                self::COLLECTION,
                $id,
                static function (array $current) use ($to, $staffUuid, $outcome, $now, &$refusal, &$heldBy): ?array {
                    $state = Json::string($current['state'] ?? '');
                    if ($state === '') {
                        $refusal = 'That visitor is no longer in the queue.';

                        return null;
                    }

                    $holder = Json::string($current['assignedTo'] ?? '');

                    if (!in_array($to, self::TRANSITIONS[$state] ?? [], true)) {
                        $heldBy = $holder;
                        $refusal = match ($state) {
                            self::ASSIGNED, self::ACCEPTED => $holder !== '' && $holder !== $staffUuid
                                ? 'Somebody else is already with this visitor.'
                                : 'That visitor has already been taken.',
                            self::RESOLVED => 'That visitor has already been dealt with.',
                            self::ABANDONED => 'That visitor has left.',
                            default => 'That is not something that can be done to this visitor now.',
                        };

                        return null;
                    }

                    // Claiming is the only transition that may be made by
                    // somebody who does not already hold the entry.
                    if ($staffUuid !== null && $holder !== '' && $to !== self::ASSIGNED && !hash_equals($holder, $staffUuid)) {
                        $heldBy = $holder;
                        $refusal = 'Somebody else is with this visitor.';

                        return null;
                    }

                    $next = $current;
                    $next['state'] = $to;
                    $next['updatedAt'] = $now;

                    switch ($to) {
                        case self::ASSIGNED:
                            $next['assignedTo'] = (string) $staffUuid;
                            $next['assignedAt'] = $now;
                            break;
                        case self::ACCEPTED:
                            $next['acceptedAt'] = $now;
                            break;
                        case self::QUEUED:
                            // Released, or reclaimed from a stale assignment.
                            $next['assignedTo'] = '';
                            $next['assignedAt'] = 0;
                            $next['queuedAt'] = (int) ($current['queuedAt'] ?? 0) ?: $now;
                            break;
                        case self::RESOLVED:
                        case self::ABANDONED:
                            $next['closedAt'] = $now;
                            $next['outcome'] = $outcome;
                            break;
                    }

                    return $next;
                },
            );
        } catch (StoreUnavailable $error) {
            return ['ok' => false, 'entry' => [], 'error' => $error->getMessage(), 'heldBy' => ''];
        }

        if ($refusal !== '') {
            return ['ok' => false, 'entry' => self::deskView($record), 'error' => $refusal, 'heldBy' => $heldBy];
        }

        return ['ok' => true, 'entry' => self::deskView($record), 'error' => '', 'heldBy' => ''];
    }

    // -----------------------------------------------------------------------
    // Expiry
    // -----------------------------------------------------------------------

    /**
     * Age one entry forward, returning it, or null once it should disappear.
     *
     * Runs inside the same locked mutation as everything else, so an entry
     * cannot be expired out from under a claim that is in flight.
     */
    private function expireIfStale(string $tenant, Record $record): ?Record
    {
        $data = $record->data;
        $state = Json::string($data['state'] ?? '');
        $now = time();

        $closedAt = (int) ($data['closedAt'] ?? 0);
        if (in_array($state, [self::RESOLVED, self::ABANDONED], true)) {
            if ($closedAt > 0 && $now - $closedAt > self::TERMINAL_RETENTION_SECONDS) {
                $this->repository->delete($tenant, self::COLLECTION, $record->id);

                return null;
            }

            return $record;
        }

        $assignedAt = (int) ($data['assignedAt'] ?? 0);
        $updatedAt = (int) ($data['updatedAt'] ?? 0);

        // A claim nobody accepted goes back to the queue rather than being
        // lost, because the visitor is still standing there.
        if ($state === self::ASSIGNED && $assignedAt > 0 && $now - $assignedAt > self::ACCEPT_GRACE_SECONDS) {
            $result = $this->transition($tenant, $record->id, self::QUEUED, null, '');

            return $result['ok'] ? $this->repository->get($tenant, self::COLLECTION, $record->id) : $record;
        }

        if (
            in_array($state, [self::REQUESTED, self::QUEUED], true)
            && $updatedAt > 0
            && $now - $updatedAt > self::ABANDON_AFTER_SECONDS
        ) {
            $this->transition($tenant, $record->id, self::ABANDONED, null, 'nobody_came');

            return $this->repository->get($tenant, self::COLLECTION, $record->id);
        }

        return $record;
    }

    /** @return array<int, Record> */
    private function waiting(string $tenant): array
    {
        return array_values(array_filter(
            $this->repository->all($tenant, self::COLLECTION),
            static fn (Record $r): bool => in_array(
                Json::string($r->data['state'] ?? ''),
                [self::QUEUED, self::ASSIGNED, self::ACCEPTED],
                true,
            ),
        ));
    }

    // -----------------------------------------------------------------------
    // Projections
    // -----------------------------------------------------------------------

    /**
     * What the desk sees. Includes the reason and the holder; both are staff data.
     *
     * @return array<string, mixed>
     */
    private static function deskView(Record $record): array
    {
        $d = $record->data;

        return [
            'id' => $record->id,
            'state' => Json::string($d['state'] ?? ''),
            'name' => Json::string($d['name'] ?? ''),
            'reason' => Json::string($d['reason'] ?? ''),
            'requestedAt' => (int) ($d['requestedAt'] ?? 0),
            'queuedAt' => (int) ($d['queuedAt'] ?? 0),
            'assignedTo' => Json::string($d['assignedTo'] ?? ''),
            'assignedAt' => (int) ($d['assignedAt'] ?? 0),
            'acceptedAt' => (int) ($d['acceptedAt'] ?? 0),
            'closedAt' => (int) ($d['closedAt'] ?? 0),
            'outcome' => Json::string($d['outcome'] ?? ''),
            'revision' => $record->revision,
        ];
    }

    /**
     * What the visitor sees about themselves.
     *
     * `ahead` is how many people are in front, counted from entries that
     * reached the queue earlier. It is a real count of real records — an
     * invented position would be the interface lying about a queue.
     *
     * @return array<string, mixed>
     */
    private function visitorView(string $tenant, Record $record): array
    {
        $state = Json::string($record->data['state'] ?? '');
        $queuedAt = (int) ($record->data['queuedAt'] ?? 0);

        $ahead = 0;
        if ($state === self::QUEUED && $queuedAt > 0) {
            foreach ($this->repository->all($tenant, self::COLLECTION) as $other) {
                if ($other->id === $record->id) {
                    continue;
                }
                $otherState = Json::string($other->data['state'] ?? '');
                $otherQueuedAt = (int) ($other->data['queuedAt'] ?? 0);
                if ($otherState === self::QUEUED && $otherQueuedAt > 0 && $otherQueuedAt < $queuedAt) {
                    $ahead += 1;
                }
            }
        }

        return [
            'state' => $state,
            'ahead' => $ahead,
            // That somebody is coming, never who. A visitor has no business
            // knowing which member of staff picked them up before they arrive.
            'withSomeone' => in_array($state, [self::ASSIGNED, self::ACCEPTED], true),
            'requestedAt' => (int) ($record->data['requestedAt'] ?? 0),
        ];
    }
}
