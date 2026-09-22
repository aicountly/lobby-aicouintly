<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * A sliding-window limiter backed by files.
 *
 * There is no database in this product and adding one to count requests would
 * be a worse trade than the imprecision this accepts. Each key gets one small
 * file holding recent timestamps; the window is trimmed on every check.
 *
 * Its limits are real but its accuracy is not perfect across concurrent
 * workers, so it is sized as a guard against runaway cost and abuse rather
 * than as a billing meter. `LOCK_EX` keeps a single host's writers honest.
 */
final class RateLimit
{
    private static ?string $directory = null;

    public static function directory(): string
    {
        if (self::$directory !== null) {
            return self::$directory;
        }

        $configured = Env::get('LOBBY_STATE_DIR');
        $base = $configured !== '' ? $configured : sys_get_temp_dir() . '/aicountly-lobby';
        if (!is_dir($base)) {
            @mkdir($base, 0770, true);
        }

        return self::$directory = rtrim($base, '/');
    }

    /**
     * Record one hit against `$key` and say whether it is still within budget.
     *
     * @return array{allowed: bool, remaining: int, retryAfter: int}
     */
    public static function hit(string $key, int $limit, int $windowSeconds): array
    {
        if ($limit <= 0) {
            return ['allowed' => true, 'remaining' => 0, 'retryAfter' => 0];
        }

        $path = self::directory() . '/rl_' . hash('sha256', $key) . '.json';
        $now = time();
        $cutoff = $now - $windowSeconds;

        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            // A limiter that cannot write must not become a limiter that
            // refuses everything: the request is allowed and the failure is
            // visible in the capability report instead.
            return ['allowed' => true, 'remaining' => $limit, 'retryAfter' => 0];
        }

        @flock($handle, LOCK_EX);
        $contents = (string) stream_get_contents($handle);
        $stamps = json_decode($contents, true);
        if (!is_array($stamps)) {
            $stamps = [];
        }

        $stamps = array_values(array_filter(
            array_map('intval', $stamps),
            static fn (int $at): bool => $at > $cutoff,
        ));

        $allowed = count($stamps) < $limit;
        if ($allowed) {
            $stamps[] = $now;
        }

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode(array_slice($stamps, -($limit * 2))));
        fflush($handle);
        @flock($handle, LOCK_UN);
        fclose($handle);

        $oldest = $stamps[0] ?? $now;

        return [
            'allowed' => $allowed,
            'remaining' => max(0, $limit - count($stamps)),
            'retryAfter' => $allowed ? 0 : max(1, ($oldest + $windowSeconds) - $now),
        ];
    }

    /** The caller's address, taking a proxy header only when one is trusted. */
    public static function clientIp(): string
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        $trusted = array_filter(array_map('trim', explode(',', Env::get('TRUSTED_PROXY_IPS'))));

        if ($trusted !== [] && in_array($remote, $trusted, true)) {
            $forwarded = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
            $first = trim(explode(',', $forwarded)[0] ?? '');
            if ($first !== '' && filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }

        return $remote;
    }
}
