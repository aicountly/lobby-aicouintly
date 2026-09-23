<?php

declare(strict_types=1);

namespace Aicountly\Api\Store;

use Aicountly\Api\Env;

/**
 * The only implementation: one JSON document per record, on the server's disk.
 *
 * ## Why files, and why that is a decision rather than a shortcut
 *
 * `server-php` ships with no composer, no vendor directory, no migration step
 * and no database credentials. Adding one would change how this product is
 * installed on every host it runs on, and a deployment dependency that arrives
 * attached to a feature is one nobody agreed to. The volume here does not need
 * a database either: one configuration document per tenant, and a queue of the
 * people physically standing in a lobby.
 *
 * What a database would buy is transactions across records. Nothing here needs
 * one — each operation touches a single document, and single-document atomicity
 * is what `flock` gives on the single host this deploys to. When Lobby grows
 * something that genuinely spans records, {@see Repository} is the seam to
 * implement again rather than the thing to work around.
 *
 * ## Where the data lives, and why it is not defaulted
 *
 * Both cPanel deploys rsync `server-php/` into `<docroot>/api` with `--delete`.
 * Anything written underneath that path which is not also in the repository is
 * deleted on the next deploy — that is exactly how a `knowledge.json` created
 * on the server came to need an explicit exclusion. So this store refuses to
 * guess a location: `LOBBY_DATA_DIR` (or a `data` directory under
 * `LOBBY_STATE_DIR`) must name somewhere outside the deploy path.
 *
 * Unconfigured is reported as unconfigured. Defaulting to the system temp
 * directory would have produced a product that saves a tenant's opening hours
 * and loses them at the next reboot, which is worse than one that says plainly
 * that it has nowhere to save them.
 *
 * ## Concurrency
 *
 * Every read takes a shared lock and every write an exclusive one, on the
 * record's own file. Writes happen **in place** under that lock rather than
 * through the usual write-temp-then-rename: rename swaps the inode, and a
 * second process already blocked on `flock` would wake up holding a lock on a
 * file that is no longer the record. That is the subtle version of the bug this
 * whole class exists to prevent, so the durability trade is made deliberately —
 * `fflush` plus `fsync` before the lock is released, and a write that cannot be
 * flushed is reported rather than assumed.
 */
final class FileRepository implements Repository
{
    /** A key is a path segment. This is the whole alphabet it may use. */
    private const KEY_PATTERN = '/^[a-z0-9][a-z0-9_-]{0,63}$/';

    private ?string $root;

    private ?string $unavailableReason = null;

    public function __construct(?string $root = null)
    {
        $this->root = self::normalise($root) ?? self::configuredRoot();
    }

    /**
     * Reject a root that is empty or relative, rather than building paths from it.
     *
     * `LOBBY_DATA_DIR=` with nothing after it is an ordinary way to leave a
     * setting "unset" in a `.env`, and an empty root would have made every path
     * absolute from the filesystem root — one tenant's configuration written to
     * `/acme/`, outside anything a backup or a deploy knows about. A relative
     * root is refused for the same reason: it would resolve against the
     * process's working directory, which for a web request is not a place
     * anybody chose.
     */
    private static function normalise(?string $root): ?string
    {
        if ($root === null) {
            return null;
        }

        $trimmed = rtrim(trim($root), '/');

        return str_starts_with($trimmed, '/') ? $trimmed : null;
    }

    /**
     * Where the store was told to keep data, or null if nobody said.
     *
     * Not defaulted — see the class docblock. `LOBBY_STATE_DIR` is accepted as
     * a parent because it is already documented as a writable directory outside
     * the document root, and an operator who has set one up should not have to
     * set up a second.
     */
    public static function configuredRoot(): ?string
    {
        $explicit = self::normalise(Env::get('LOBBY_DATA_DIR'));
        if ($explicit !== null) {
            return $explicit;
        }

        $state = self::normalise(Env::get('LOBBY_STATE_DIR'));
        if ($state !== null) {
            return $state . '/data';
        }

        return null;
    }

    public function location(): string
    {
        return $this->root ?? '(unset: set LOBBY_DATA_DIR, or LOBBY_STATE_DIR to use a data/ directory beneath it)';
    }

    public function configured(): bool
    {
        return $this->root !== null;
    }

    /**
     * Why the store cannot be used, for the operator diagnostic.
     *
     * Empty when it can. Populated by whichever check failed most recently, so
     * an administrator sees "not writable by PHP" rather than a generic
     * failure they have to go and reproduce.
     */
    public function unavailableReason(): string
    {
        if ($this->root === null) {
            $raw = trim(Env::get('LOBBY_DATA_DIR')) . trim(Env::get('LOBBY_STATE_DIR'));

            return $raw === ''
                ? 'No data directory is configured. Set LOBBY_DATA_DIR to a writable absolute path outside the document root — a deploy rsyncs over <docroot>/api with --delete, so data underneath it would be removed.'
                : 'LOBBY_DATA_DIR/LOBBY_STATE_DIR is set to a relative path. It must be absolute, so it does not resolve against whatever directory the web server happens to run PHP from.';
        }

        if ($this->unavailableReason !== null) {
            return $this->unavailableReason;
        }

        if (!is_dir($this->root)) {
            return 'The data directory ' . $this->root . ' does not exist and could not be created.';
        }

        if (!is_writable($this->root)) {
            return 'The data directory ' . $this->root . ' is not writable by PHP.';
        }

        return '';
    }

    public function writable(): bool
    {
        if ($this->root === null) {
            return false;
        }

        return $this->ensureDirectory($this->root) && is_writable($this->root);
    }

    /**
     * Is the data directory reachable over HTTP?
     *
     * A store placed inside the document root serves every tenant's
     * configuration as a static JSON file to anyone who guesses the path. The
     * diagnostic reports this, and {@see ensureDirectory} drops a denial file
     * alongside it, but neither substitutes for moving it: an `.htaccess` is
     * only honoured while the server is configured to read one.
     */
    public function insideDocumentRoot(): bool
    {
        $docRoot = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
        if ($docRoot === '' || $this->root === null) {
            return false;
        }

        $real = realpath($this->root);
        $realDocRoot = realpath($docRoot);
        if ($real === false || $realDocRoot === false) {
            return false;
        }

        return $real === $realDocRoot || str_starts_with($real, $realDocRoot . '/');
    }

    // -----------------------------------------------------------------------
    // Reading
    // -----------------------------------------------------------------------

    public function get(string $tenant, string $collection, string $id): ?Record
    {
        $path = $this->path($tenant, $collection, $id);
        if (!is_file($path)) {
            return null;
        }

        $handle = @fopen($path, 'r');
        if ($handle === false) {
            return null;
        }

        try {
            if (!flock($handle, LOCK_SH)) {
                throw new StoreUnavailable('Could not read ' . $collection . '/' . $id . ': the record is locked.');
            }
            $raw = (string) stream_get_contents($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }

        return self::decode($id, $raw);
    }

    public function all(string $tenant, string $collection): array
    {
        $dir = $this->collectionDirectory($tenant, $collection);
        if (!is_dir($dir)) {
            return [];
        }

        $files = glob($dir . '/*.json') ?: [];
        sort($files, SORT_STRING);

        $records = [];
        foreach ($files as $file) {
            $id = basename($file, '.json');
            if (preg_match(self::KEY_PATTERN, $id) !== 1) {
                continue;
            }
            $record = $this->get($tenant, $collection, $id);
            if ($record !== null) {
                $records[] = $record;
            }
        }

        return $records;
    }

    // -----------------------------------------------------------------------
    // Writing
    // -----------------------------------------------------------------------

    public function put(string $tenant, string $collection, string $id, array $data, ?int $expectedRevision): Record
    {
        return $this->withExclusiveLock(
            $tenant,
            $collection,
            $id,
            static function (?Record $current) use ($data, $expectedRevision): array {
                $actual = $current?->revision ?? 0;
                if ($expectedRevision !== null && $expectedRevision !== $actual) {
                    throw new RevisionConflict($expectedRevision, $actual);
                }

                return $data;
            },
        );
    }

    public function mutate(string $tenant, string $collection, string $id, callable $mutator): Record
    {
        return $this->withExclusiveLock(
            $tenant,
            $collection,
            $id,
            static function (?Record $current) use ($mutator): ?array {
                return $mutator($current?->data ?? [], $current?->revision ?? 0);
            },
        );
    }

    public function delete(string $tenant, string $collection, string $id): void
    {
        $path = $this->path($tenant, $collection, $id);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    /**
     * The one write path: lock, read, transform, write in place, fsync.
     *
     * The transform may return null to mean "leave it exactly as it is", which
     * the queue uses when it finds that the state it wanted to move out of has
     * already been moved out of by somebody else.
     *
     * @param callable(?Record): ?array<string, mixed> $transform
     */
    private function withExclusiveLock(string $tenant, string $collection, string $id, callable $transform): Record
    {
        if ($this->root === null) {
            throw new StoreUnavailable($this->unavailableReason());
        }

        $dir = $this->collectionDirectory($tenant, $collection);
        if (!$this->ensureDirectory($dir)) {
            throw new StoreUnavailable('Could not create the data directory ' . $dir . '.');
        }

        $path = $this->path($tenant, $collection, $id);

        // 'c+' creates the file if missing and does NOT truncate, so the lock
        // is taken before any existing content could be lost.
        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            $this->unavailableReason = 'Could not open ' . $path . ' for writing.';
            throw new StoreUnavailable($this->unavailableReason);
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new StoreUnavailable('Could not lock ' . $collection . '/' . $id . ' for writing.');
            }

            $raw = (string) stream_get_contents($handle);
            $current = $raw === '' ? null : self::decode($id, $raw);

            $next = $transform($current);
            if ($next === null && $current !== null) {
                return $current;
            }

            $record = new Record(
                $id,
                $next ?? [],
                ($current?->revision ?? 0) + 1,
                time(),
                self::actor(),
            );

            $encoded = json_encode(
                [
                    'revision' => $record->revision,
                    'updatedAt' => $record->updatedAt,
                    'updatedBy' => $record->updatedBy,
                    'data' => $record->data,
                ],
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT,
            );

            if ($encoded === false) {
                throw new StoreUnavailable('That record could not be encoded for storage.');
            }

            rewind($handle);
            if (ftruncate($handle, 0) === false || fwrite($handle, $encoded) === false) {
                throw new StoreUnavailable('Could not write ' . $collection . '/' . $id . '.');
            }

            // Flush through PHP's buffer and then through the OS's, before the
            // lock is released. A write that is only in a buffer is a write
            // that a power cut turns into a lost configuration.
            if (!fflush($handle)) {
                throw new StoreUnavailable('Could not flush ' . $collection . '/' . $id . ' to disk.');
            }
            if (function_exists('fsync')) {
                @fsync($handle);
            }

            @chmod($path, 0o600);

            return $record;
        } finally {
            @flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    // -----------------------------------------------------------------------
    // Paths and keys
    // -----------------------------------------------------------------------

    /**
     * Turn a key into a path segment, or refuse.
     *
     * Every id that reaches this class can have come from a URL, so this is a
     * strict allowlist rather than an escape: `..`, `/`, a null byte, an
     * absolute path and a unicode homoglyph all fail the same way, because none
     * of them matches the pattern.
     */
    private static function key(string $value, string $what): string
    {
        $normalised = strtolower(trim($value));
        if (preg_match(self::KEY_PATTERN, $normalised) !== 1) {
            throw new InvalidKey($what . ' is not a valid name.');
        }

        return $normalised;
    }

    /**
     * A tenant id as a directory name.
     *
     * Tenant ids are operator-configured (`LOBBY_TENANT_ID`,
     * `LOBBY_TENANT_BY_HOST`) rather than user-supplied, but they are still run
     * through the same allowlist. "It cannot come from a request" is a property
     * of today's routing, not of this class, and the cost of checking is
     * nothing.
     */
    public static function tenantKey(string $tenant): string
    {
        return self::key($tenant, 'That tenant id');
    }

    private function collectionDirectory(string $tenant, string $collection): string
    {
        return $this->root . '/' . self::key($tenant, 'That tenant id') . '/' . self::key($collection, 'That collection name');
    }

    private function path(string $tenant, string $collection, string $id): string
    {
        return $this->collectionDirectory($tenant, $collection) . '/' . self::key($id, 'That record id') . '.json';
    }

    /**
     * Create a directory, and refuse to serve what is inside it over HTTP.
     *
     * The `.htaccess` is defence in depth for a store that has been pointed
     * somewhere web-reachable. It is not permission to do that — the
     * diagnostic reports {@see insideDocumentRoot} either way — because a
     * directory-level denial only applies while the server is reading
     * `.htaccess` files at all.
     */
    private function ensureDirectory(string $dir): bool
    {
        if (is_dir($dir)) {
            return true;
        }

        if (!@mkdir($dir, 0o700, true) && !is_dir($dir)) {
            $this->unavailableReason = 'Could not create ' . $dir . '.';

            return false;
        }

        $guard = rtrim((string) $this->root, '/') . '/.htaccess';
        if ($this->root !== null && is_dir($this->root) && !is_file($guard)) {
            @file_put_contents($guard, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        }

        return true;
    }

    // -----------------------------------------------------------------------
    // Encoding
    // -----------------------------------------------------------------------

    /**
     * Parse a stored document, tolerating one that has been damaged.
     *
     * A truncated or hand-edited file returns null rather than throwing, so a
     * single unreadable record cannot take down a listing of the rest. The
     * caller sees it as absent, which is the safe reading: reception falls back
     * to saying it does not know rather than to half a configuration.
     */
    private static function decode(string $id, string $raw): ?Record
    {
        $decoded = json_decode($raw, true, 64);
        if (!is_array($decoded) || !is_array($decoded['data'] ?? null)) {
            return null;
        }

        return new Record(
            $id,
            $decoded['data'],
            max(1, (int) ($decoded['revision'] ?? 1)),
            (int) ($decoded['updatedAt'] ?? 0),
            is_string($decoded['updatedBy'] ?? null) ? $decoded['updatedBy'] : '',
        );
    }

    /**
     * Who is writing, for the audit trail on the record itself.
     *
     * Set by the request once the caller has been authenticated. Deliberately
     * ambient rather than a parameter on every write: a caller that had to
     * pass it could pass somebody else's, and the only correct value is the
     * one the session established.
     */
    private static ?string $actor = null;

    public static function actingAs(string $uuid): void
    {
        self::$actor = $uuid;
    }

    private static function actor(): string
    {
        return self::$actor ?? '';
    }
}
