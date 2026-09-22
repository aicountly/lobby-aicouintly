<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * JSON in and out, with the limits applied at the edge rather than downstream.
 *
 * Everything a visitor sends arrives here first, so this is where the request
 * size ceiling lives. Reading `php://input` without one means a single request
 * can decide how much memory this process uses.
 */
final class Json
{
    /** Largest JSON request body accepted, before decoding. */
    public const MAX_REQUEST_BYTES = 64 * 1024;

    /**
     * Read and decode the request body.
     *
     * @return array{ok: true, data: array<string, mixed>}|array{ok: false, status: int, message: string}
     */
    public static function readBody(int $maxBytes = self::MAX_REQUEST_BYTES): array
    {
        $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($declared > $maxBytes) {
            return ['ok' => false, 'status' => 413, 'message' => 'That request is too large.'];
        }

        // Read one byte past the ceiling so an undeclared or lying
        // Content-Length is caught by the actual size rather than the header.
        $raw = (string) file_get_contents('php://input', false, null, 0, $maxBytes + 1);
        if (strlen($raw) > $maxBytes) {
            return ['ok' => false, 'status' => 413, 'message' => 'That request is too large.'];
        }
        if (trim($raw) === '') {
            return ['ok' => true, 'data' => []];
        }

        $decoded = json_decode($raw, true, 32);
        if (!is_array($decoded)) {
            return ['ok' => false, 'status' => 400, 'message' => 'That request was not valid JSON.'];
        }

        return ['ok' => true, 'data' => $decoded];
    }

    /**
     * Decode a provider response, refusing anything that is not JSON.
     *
     * @return array<string, mixed>|null
     */
    public static function decode(string $body): ?array
    {
        if ($body === '') {
            return null;
        }
        $decoded = json_decode($body, true, 64);

        return is_array($decoded) ? $decoded : null;
    }

    public static function string(mixed $value, string $default = ''): string
    {
        return is_string($value) ? $value : $default;
    }

    /** Trim, collapse runs of whitespace, and cut to a hard ceiling. */
    public static function text(mixed $value, int $maxLength): string
    {
        if (!is_string($value)) {
            return '';
        }
        $clean = trim((string) preg_replace('/\s+/u', ' ', $value));

        return mb_substr($clean, 0, $maxLength, 'UTF-8');
    }
}
