<?php

declare(strict_types=1);

namespace Aicountly\Api\Desk;

use Aicountly\Api\Env;
use Aicountly\Api\Json;
use Aicountly\Api\Store\Repository;
use Aicountly\Api\Store\StoreException;

/**
 * Whether anybody is actually at the desk.
 *
 * A visitor asking for a person needs a true answer, and the only true answer
 * comes from somebody's browser having been on the desk screen recently. So
 * this is a heartbeat: loading the queue writes a timestamp, and staff are
 * "available" for as long as that timestamp is fresh.
 *
 * What it deliberately is not: a roster, an opening-hours table, or a flag an
 * administrator can set. Each of those would let the product tell a visitor
 * somebody is coming because a spreadsheet said so. "Three agents available"
 * with nobody logged in is the single most damaging thing a reception product
 * can display, because the visitor waits on the strength of it.
 *
 * The cost of a heartbeat is that closing the laptop takes up to
 * {@see WINDOW_SECONDS} to register. That is the right direction to be wrong
 * in — briefly saying somebody is there when they just left, rather than
 * indefinitely saying so because nobody updated a setting.
 */
final class Presence
{
    public const COLLECTION = 'presence';

    public const RECORD = 'desk';

    /** How long a heartbeat counts for. Longer than a poll interval, shorter than a coffee. */
    public const WINDOW_SECONDS = 120;

    public function __construct(
        private readonly Repository $repository,
    ) {
    }

    /**
     * Record that this member of staff is at the desk right now.
     *
     * Failures are swallowed on purpose. A heartbeat that cannot be written
     * must not stop a member of staff seeing their queue — the consequence is
     * that the desk reads as unstaffed, which is the safe direction.
     */
    public function beat(string $tenant, string $uuid): void
    {
        $now = time();

        try {
            $this->repository->mutate(
                $tenant,
                self::COLLECTION,
                self::RECORD,
                static function (array $current) use ($uuid, $now): array {
                    $staff = is_array($current['staff'] ?? null) ? $current['staff'] : [];

                    $kept = [];
                    foreach ($staff as $entry) {
                        if (!is_array($entry)) {
                            continue;
                        }
                        $id = Json::string($entry['uuid'] ?? '');
                        $seen = (int) ($entry['seenAt'] ?? 0);
                        // Drop this member's old row and anything long stale,
                        // so the record cannot grow without bound.
                        if ($id === '' || $id === $uuid || $now - $seen > self::WINDOW_SECONDS * 10) {
                            continue;
                        }
                        $kept[] = ['uuid' => $id, 'seenAt' => $seen];
                    }

                    $kept[] = ['uuid' => $uuid, 'seenAt' => $now];

                    return ['staff' => $kept];
                },
            );
        } catch (StoreException) {
            // Deliberately ignored — see the docblock.
        }
    }

    /** How many members of staff have been at the desk within the window. */
    public function available(string $tenant): int
    {
        $record = $this->repository->get($tenant, self::COLLECTION, self::RECORD);
        if ($record === null) {
            return 0;
        }

        $now = time();
        $count = 0;
        foreach (is_array($record->data['staff'] ?? null) ? $record->data['staff'] : [] as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            if ($now - (int) ($entry['seenAt'] ?? 0) <= self::WINDOW_SECONDS) {
                $count += 1;
            }
        }

        return $count;
    }

    /**
     * May a visitor be put into the queue at all?
     *
     * Both halves have to be true: the business switched handover on, and
     * somebody is there. Either alone would mean queueing a visitor to wait for
     * a person who is not coming.
     *
     * `LOBBY_DESK_ALWAYS_OPEN` exists for a deployment whose staff work from a
     * screen this product does not serve, where the heartbeat can never fire.
     * It is opt-in, and the operator diagnostic reports it, because it is the
     * one switch here that can make the product claim availability it has not
     * observed.
     */
    public function staffed(string $tenant, bool $handoverEnabled): bool
    {
        if (!$handoverEnabled) {
            return false;
        }

        if (Env::get('LOBBY_DESK_ALWAYS_OPEN') === 'true') {
            return true;
        }

        return $this->available($tenant) > 0;
    }
}
