<?php

declare(strict_types=1);

namespace Aicountly\Api\Store;

/**
 * Where this product keeps the small amount of state it actually owns.
 *
 * Lobby owns three things and must never acquire a fourth: the tenant's
 * approved reception configuration, the live reception queue, and the audit of
 * who changed the configuration. Appointments, Calendar, Contacts, Billing and
 * CRM own everything else, and are read over their APIs at the moment they are
 * needed. Nothing in here is a copy of another product's record.
 *
 * ## Why an interface for a handful of JSON files
 *
 * Not speculation about a future database — a seam, so that the decision to
 * introduce one is a deployment decision made on purpose, rather than something
 * that arrives attached to a feature. `server-php` ships with no composer, no
 * vendor directory and no database credentials; a migration step would change
 * how this product is installed, and that is not this phase's to change
 * silently. {@see FileRepository} is the only implementation today.
 *
 * Callers depend on this interface and on nothing below it, so a future
 * database implementation is a constructor change rather than a rewrite.
 *
 * ## The two concurrency primitives, and which to use
 *
 * `put()` with an expected revision is **optimistic**: it is for a human at a
 * form. Two administrators editing the same page must not silently overwrite
 * each other, so the second write is refused and the browser is told to
 * reload. The cost of a conflict is a retyped form; the cost of a lost update
 * is a tenant whose opening hours quietly reverted.
 *
 * `mutate()` is **pessimistic**: it is for machines racing. Two staff hitting
 * "accept" on the same waiting visitor is not a form conflict to report, it is
 * a race to resolve — one of them must get the visitor and the other must be
 * told, correctly, that it is already taken. Read-modify-write under an
 * exclusive lock is the only way to answer that honestly.
 *
 * Using the optimistic path for a claim would be a bug: the loser would see a
 * revision conflict and a reasonable client would retry, at which point it
 * would take a visitor that another member of staff is already talking to.
 */
interface Repository
{
    /**
     * One record, or null when it has never been written.
     *
     * @param non-empty-string $tenant
     * @param non-empty-string $collection
     * @param non-empty-string $id
     */
    public function get(string $tenant, string $collection, string $id): ?Record;

    /**
     * Every record in a collection, in a stable order.
     *
     * Deliberately not paginated. The collections here are bounded by what one
     * reception desk can hold — a configuration document, a queue of people
     * physically in a lobby — and a paginating interface would invite storing
     * something that needs it.
     *
     * @param non-empty-string $tenant
     * @param non-empty-string $collection
     * @return array<int, Record>
     */
    public function all(string $tenant, string $collection): array;

    /**
     * Write a record, refusing if it changed underneath the caller.
     *
     * `$expectedRevision` is the revision the caller read. Pass 0 to mean "this
     * must not exist yet". Pass null only where a last-writer-wins overwrite is
     * genuinely correct, which for anything a human edits it is not.
     *
     * @param non-empty-string $tenant
     * @param non-empty-string $collection
     * @param non-empty-string $id
     * @param array<string, mixed> $data
     * @throws RevisionConflict when the stored revision is not the expected one
     * @throws StoreUnavailable when the write cannot be made durable
     */
    public function put(string $tenant, string $collection, string $id, array $data, ?int $expectedRevision): Record;

    /**
     * Read, transform and write one record while holding an exclusive lock.
     *
     * The callback receives the current data (`[]` when the record does not
     * exist yet) and returns the data to store, or null to leave it untouched.
     * No other process can read-modify-write the same record in between, which
     * is what makes "claim this visitor if nobody else has" a safe operation
     * rather than a likely one.
     *
     * The callback must not perform I/O, call another product, or take another
     * lock: it runs inside a critical section on a web request, and a slow
     * downstream would hold the lock for every other member of staff.
     *
     * @param non-empty-string $tenant
     * @param non-empty-string $collection
     * @param non-empty-string $id
     * @param callable(array<string, mixed>, int): ?array<string, mixed> $mutator
     * @throws StoreUnavailable when the lock or the write cannot be made
     */
    public function mutate(string $tenant, string $collection, string $id, callable $mutator): Record;

    /**
     * Remove a record. Removing one that does not exist is not an error.
     *
     * @param non-empty-string $tenant
     * @param non-empty-string $collection
     * @param non-empty-string $id
     */
    public function delete(string $tenant, string $collection, string $id): void;

    /**
     * Whether this repository can currently be written to.
     *
     * Reported by the operator diagnostic. A store that cannot be written is
     * the difference between "nobody has configured this yet" and "the
     * configuration cannot be saved", and an administrator staring at a form
     * that silently fails deserves to be told which.
     */
    public function writable(): bool;

    /** Where the data is, for an operator. Never shown to a visitor. */
    public function location(): string;
}
