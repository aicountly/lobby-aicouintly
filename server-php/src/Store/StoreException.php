<?php

declare(strict_types=1);

namespace Aicountly\Api\Store;

/** Anything the store refuses or cannot do. */
abstract class StoreException extends \RuntimeException
{
    /** The stable code the API reports, so a client branches on this and not on prose. */
    abstract public function code(): string;

    /** The HTTP status this maps to. */
    abstract public function status(): int;
}

/**
 * The record changed since the caller read it.
 *
 * Not an error in the sense of something being broken — it is the store doing
 * its job. The caller reloads and decides what to do with the newer version.
 */
final class RevisionConflict extends StoreException
{
    public function __construct(
        public readonly int $expected,
        public readonly int $actual,
    ) {
        parent::__construct(
            $actual === 0
                ? 'That record no longer exists.'
                : 'Someone else changed this since you opened it. Reload to see their version before saving.',
        );
    }

    public function code(): string
    {
        return 'revision_conflict';
    }

    public function status(): int
    {
        return 409;
    }
}

/**
 * The store could not be read or written at all.
 *
 * A misconfigured or unwritable data directory. Deliberately distinct from
 * "nothing is configured yet": an administrator whose save fails needs to know
 * it is the server, not their input.
 */
final class StoreUnavailable extends StoreException
{
    public function code(): string
    {
        return 'store_unavailable';
    }

    public function status(): int
    {
        return 503;
    }
}

/** A tenant, collection or id that is not a legal name. Always a programming error. */
final class InvalidKey extends StoreException
{
    public function code(): string
    {
        return 'invalid_key';
    }

    public function status(): int
    {
        return 400;
    }
}
