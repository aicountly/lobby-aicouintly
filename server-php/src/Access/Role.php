<?php

declare(strict_types=1);

namespace Aicountly\Api\Access;

/**
 * Who may do what, as a table rather than as scattered conditionals.
 *
 * Permissions are checked on the backend on every request. The interface also
 * hides what the caller cannot do, but that is courtesy, not security: a hidden
 * button is one `fetch` away from being pressed, and every route below decides
 * for itself rather than trusting that the screen was rendered correctly.
 *
 * ## The roles
 *
 * `owner` runs the account: everything, including deciding who else has access.
 * `manager` runs the front desk: configures it, publishes it, works it.
 * `agent` works the front desk: sees the queue and takes visitors, and cannot
 * change what the receptionist says to the public.
 *
 * The split that matters is `agent` from `manager`. A busy receptionist taking
 * visitors all day has no reason to be able to rewrite the opening hours, and
 * giving them that access by default is how a front desk ends up with one
 * shared login that can do everything.
 */
final class Role
{
    public const OWNER = 'owner';

    public const MANAGER = 'manager';

    public const AGENT = 'agent';

    /** Nobody: a signed-in portal user with no role at this tenant. */
    public const NONE = 'none';

    public const ASSIGNABLE = [self::OWNER, self::MANAGER, self::AGENT];

    // --- Permissions -------------------------------------------------------

    public const VIEW_CONFIG = 'config.view';

    public const EDIT_CONFIG = 'config.edit';

    public const PUBLISH_CONFIG = 'config.publish';

    public const VIEW_DESK = 'desk.view';

    public const WORK_DESK = 'desk.work';

    public const MANAGE_STAFF = 'staff.manage';

    /** @var array<string, array<int, string>> */
    private const GRANTS = [
        self::OWNER => [
            self::VIEW_CONFIG,
            self::EDIT_CONFIG,
            self::PUBLISH_CONFIG,
            self::VIEW_DESK,
            self::WORK_DESK,
            self::MANAGE_STAFF,
        ],
        self::MANAGER => [
            self::VIEW_CONFIG,
            self::EDIT_CONFIG,
            self::PUBLISH_CONFIG,
            self::VIEW_DESK,
            self::WORK_DESK,
        ],
        self::AGENT => [
            self::VIEW_DESK,
            self::WORK_DESK,
        ],
        self::NONE => [],
    ];

    public static function valid(string $role): bool
    {
        return in_array($role, self::ASSIGNABLE, true);
    }

    public static function allows(string $role, string $permission): bool
    {
        return in_array($permission, self::GRANTS[$role] ?? [], true);
    }

    /**
     * Everything a role may do, for the interface to render against.
     *
     * @return array<int, string>
     */
    public static function permissions(string $role): array
    {
        return self::GRANTS[$role] ?? [];
    }
}
