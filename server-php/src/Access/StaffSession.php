<?php

declare(strict_types=1);

namespace Aicountly\Api\Access;

use Aicountly\Api\Env;
use Aicountly\Api\Json;
use Aicountly\Api\Portal;
use Aicountly\Api\Store\Repository;
use Aicountly\Api\VisitorSession;

/**
 * Who the member of staff making this request is, and what they may do here.
 *
 * ## Two credentials that never meet
 *
 * A public visitor presents an `X-Lobby-Session` token this server minted for
 * an anonymous browser. A member of staff presents an `Authorization: Bearer`
 * portal session key belonging to a real signed-in human. This class reads
 * **only** the second, and there is deliberately no code path from the first to
 * any of it.
 *
 * That is the whole point. A visitor token is issued to anyone who loads a
 * public page, with no identity behind it; if it could be exchanged for staff
 * access anywhere — even for a read — then the front desk's queue, and every
 * tenant's unpublished configuration, would be available to the public.
 *
 * ## Where the tenant comes from
 *
 * The host, exactly as it does for a visitor, via
 * {@see VisitorSession::resolveTenant()}. Never from a header, a query
 * parameter or a body field. A staff member signed in at one business must not
 * be able to name another business's tenant and be believed — so the tenant is
 * not something the request gets to assert, and the role lookup happens inside
 * that tenant's own records.
 *
 * ## Where a role comes from
 *
 * Two places, checked in this order:
 *
 *   1. `LOBBY_OWNER_UUIDS` — an operator-set list, in the server's `.env`, of
 *      portal uuids that are owners here. This is the bootstrap, and it has to
 *      exist: without it nobody could ever grant anybody the first role, and
 *      the alternative — "whoever signs in first becomes the owner" — is a
 *      land grab waiting to happen on a public product.
 *   2. The tenant's own `staff` record, which an owner manages from the
 *      interface.
 *
 * A signed-in portal user who appears in neither is {@see Role::NONE}: they are
 * a real person with a real session and no business here, which is different
 * from an unauthenticated caller and is reported differently.
 */
final class StaffSession
{
    public const COLLECTION = 'staff';

    public const RECORD = 'members';

    private function __construct(
        public readonly string $uuid,
        public readonly string $tenant,
        public readonly string $role,
    ) {
    }

    /**
     * Resolve the caller, or null when there is no valid portal session.
     *
     * Null means "not signed in", which is a 401. A resolved session with
     * {@see Role::NONE} means "signed in, no access here", which is a 403. The
     * interface needs to tell those apart: one is fixed by signing in and the
     * other by asking an owner for access.
     */
    public static function fromRequest(Repository $repository, string $bearerToken): ?self
    {
        if ($bearerToken === '') {
            return null;
        }

        $portal = Portal::validateSesKey($bearerToken);
        if ($portal === null) {
            return null;
        }

        $uuid = Json::string($portal['uuid_aictly'] ?? ($portal['uuid'] ?? ''));
        if ($uuid === '') {
            return null;
        }

        $tenant = VisitorSession::resolveTenant();

        return new self($uuid, $tenant, self::roleFor($repository, $tenant, $uuid));
    }

    public function can(string $permission): bool
    {
        return Role::allows($this->role, $permission);
    }

    public function isStaff(): bool
    {
        return $this->role !== Role::NONE;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'uuid' => $this->uuid,
            'tenant' => $this->tenant,
            'role' => $this->role,
            'permissions' => Role::permissions($this->role),
        ];
    }

    // -----------------------------------------------------------------------
    // Roles
    // -----------------------------------------------------------------------

    /**
     * The bootstrap owners, from server configuration.
     *
     * @return array<int, string>
     */
    public static function bootstrapOwners(): array
    {
        $raw = Env::get('LOBBY_OWNER_UUIDS');

        return array_values(array_filter(array_map('trim', explode(',', $raw)), static fn (string $u): bool => $u !== ''));
    }

    private static function roleFor(Repository $repository, string $tenant, string $uuid): string
    {
        // Compared with hash_equals rather than in_array so that matching a
        // configured owner uuid is not timing-distinguishable from missing it.
        // The uuid is not a secret, but it is the only thing standing between a
        // signed-in portal user and this tenant's owner role.
        foreach (self::bootstrapOwners() as $owner) {
            if (hash_equals($owner, $uuid)) {
                return Role::OWNER;
            }
        }

        $record = $repository->get($tenant, self::COLLECTION, self::RECORD);
        if ($record === null) {
            return Role::NONE;
        }

        foreach (is_array($record->data['members'] ?? null) ? $record->data['members'] : [] as $member) {
            if (!is_array($member)) {
                continue;
            }
            $memberUuid = Json::string($member['uuid'] ?? '');
            $role = Json::string($member['role'] ?? '');
            if ($memberUuid !== '' && hash_equals($memberUuid, $uuid) && Role::valid($role)) {
                return $role;
            }
        }

        return Role::NONE;
    }

    /**
     * Everyone with a role at this tenant, bootstrap owners included.
     *
     * The bootstrap entries are marked so the interface can show them as what
     * they are: set in the server's `.env`, and not removable from a screen.
     * An owner trying to revoke one needs to know it will come back.
     *
     * @return array<int, array{uuid: string, role: string, source: string}>
     */
    public static function roster(Repository $repository, string $tenant): array
    {
        $roster = [];
        $seen = [];

        foreach (self::bootstrapOwners() as $uuid) {
            $roster[] = ['uuid' => $uuid, 'role' => Role::OWNER, 'source' => 'server-config'];
            $seen[$uuid] = true;
        }

        $record = $repository->get($tenant, self::COLLECTION, self::RECORD);
        foreach (is_array($record?->data['members'] ?? null) ? $record->data['members'] : [] as $member) {
            if (!is_array($member)) {
                continue;
            }
            $uuid = Json::string($member['uuid'] ?? '');
            $role = Json::string($member['role'] ?? '');
            if ($uuid === '' || isset($seen[$uuid]) || !Role::valid($role)) {
                continue;
            }
            $roster[] = ['uuid' => $uuid, 'role' => $role, 'source' => 'tenant'];
            $seen[$uuid] = true;
        }

        return $roster;
    }

    /**
     * Replace the tenant's roster.
     *
     * Bootstrap owners are filtered out on the way in: they are the server's,
     * not the tenant's, and writing a copy into the tenant record would leave a
     * stale duplicate the day the `.env` changed.
     *
     * @param array<int, array{uuid: string, role: string}> $members
     * @return array{ok: bool, error: string, members: array<int, array{uuid: string, role: string}>}
     */
    public static function saveRoster(Repository $repository, string $tenant, array $members, int $expectedRevision): array
    {
        $bootstrap = self::bootstrapOwners();
        $clean = [];
        $seen = [];

        foreach ($members as $member) {
            if (!is_array($member)) {
                continue;
            }
            $uuid = Json::text($member['uuid'] ?? '', 64);
            $role = Json::string($member['role'] ?? '');

            if ($uuid === '' || isset($seen[$uuid])) {
                continue;
            }
            if (!Role::valid($role)) {
                return ['ok' => false, 'error' => 'That is not a role: ' . $role . '.', 'members' => []];
            }
            if (in_array($uuid, $bootstrap, true)) {
                continue;
            }

            $seen[$uuid] = true;
            $clean[] = ['uuid' => $uuid, 'role' => $role];
        }

        // A tenant with no bootstrap owner must keep at least one owner of its
        // own, or the next save locks everybody out of their own account with
        // no way back in that does not involve SSH.
        if ($bootstrap === [] && !self::containsOwner($clean)) {
            return [
                'ok' => false,
                'error' => 'At least one owner is required. Give somebody else the owner role before removing the last one.',
                'members' => [],
            ];
        }

        $repository->put($tenant, self::COLLECTION, self::RECORD, ['members' => $clean], $expectedRevision);

        return ['ok' => true, 'error' => '', 'members' => $clean];
    }

    public static function rosterRevision(Repository $repository, string $tenant): int
    {
        return $repository->get($tenant, self::COLLECTION, self::RECORD)?->revision ?? 0;
    }

    /** @param array<int, array{uuid: string, role: string}> $members */
    private static function containsOwner(array $members): bool
    {
        foreach ($members as $member) {
            if (($member['role'] ?? '') === Role::OWNER) {
                return true;
            }
        }

        return false;
    }
}
