<?php

declare(strict_types=1);

namespace Aicountly\Api\Store;

/**
 * A stored document with the bookkeeping that makes concurrent editing safe.
 *
 * `revision` is the whole point. It starts at 1 and increments on every write,
 * and a caller that wants to change a record must say which revision it read.
 * Without it two administrators with the same page open both save, both
 * succeed, and the first one's work is gone with nothing to indicate it ever
 * happened.
 */
final class Record
{
    /**
     * @param array<string, mixed> $data
     */
    public function __construct(
        public readonly string $id,
        public readonly array $data,
        public readonly int $revision,
        public readonly int $updatedAt,
        /** The actor uuid that last wrote this, where one was known. */
        public readonly string $updatedBy,
    ) {
    }

    /**
     * The record as the API returns it.
     *
     * `revision` travels to the browser and back, because the browser is the
     * one holding a form open while somebody else might be editing.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'revision' => $this->revision,
            'updatedAt' => gmdate('c', $this->updatedAt),
            'updatedBy' => $this->updatedBy,
            'data' => $this->data,
        ];
    }
}
