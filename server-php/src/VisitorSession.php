<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * A scoped session for a visitor who has not signed in.
 *
 * `/lobby` is public, so the reception AI cannot sit behind the portal login.
 * It also must not become an open proxy to a paid model: anyone who can POST
 * to it could otherwise spend the tenant's budget from a script.
 *
 * So a visitor is issued a short-lived, signed, opaque token before they can
 * talk. The token is the seam: it carries the conversation id and the tenant,
 * both of which this server put there, so neither is ever taken from the
 * request body. A browser can present a token; it cannot mint one, cannot edit
 * the tenant inside one, and cannot extend one.
 *
 * What it deliberately is not: an identity. It says "this browser was issued a
 * reception session at this time", nothing more. A signed-in visitor's portal
 * session is separate and unchanged.
 */
final class VisitorSession
{
    /** Bumped when the token payload changes shape, so old tokens stop verifying. */
    private const VERSION = 'v1';

    private const DEFAULT_TTL_SECONDS = 3600;

    public function __construct(
        public readonly string $conversationId,
        public readonly string $tenantId,
        public readonly int $issuedAt,
        public readonly int $expiresAt,
    ) {
    }

    public static function secret(): string
    {
        return Env::get('LOBBY_SESSION_SECRET');
    }

    public static function configured(): bool
    {
        // Short secrets are the same as no secret for anything that matters.
        return strlen(self::secret()) >= 32;
    }

    /**
     * Which tenant this host serves.
     *
     * Derived here, from server configuration and the request host — never
     * from the request body. A browser that could name its own tenant could
     * read another tenant's approved knowledge and spend its budget.
     */
    public static function resolveTenant(): string
    {
        $map = Env::get('LOBBY_TENANT_BY_HOST');
        $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $host = trim(explode(':', $host)[0]);

        if ($map !== '' && $host !== '') {
            foreach (explode(',', $map) as $pair) {
                $parts = explode('=', $pair, 2);
                if (count($parts) === 2 && strtolower(trim($parts[0])) === $host) {
                    $tenant = trim($parts[1]);
                    if ($tenant !== '') {
                        return $tenant;
                    }
                }
            }
        }

        return Env::get('LOBBY_TENANT_ID', 'default');
    }

    public static function ttl(): int
    {
        $configured = (int) Env::get('LOBBY_SESSION_TTL_SECONDS', (string) self::DEFAULT_TTL_SECONDS);

        return $configured > 0 ? min($configured, 86400) : self::DEFAULT_TTL_SECONDS;
    }

    /** Mint a token for a new conversation. */
    public static function issue(): ?string
    {
        if (!self::configured()) {
            return null;
        }

        $now = time();
        $payload = [
            'v' => self::VERSION,
            'cid' => bin2hex(random_bytes(16)),
            'tid' => self::resolveTenant(),
            'iat' => $now,
            'exp' => $now + self::ttl(),
        ];

        $encoded = self::base64UrlEncode((string) json_encode($payload, JSON_UNESCAPED_SLASHES));

        return $encoded . '.' . self::sign($encoded);
    }

    /**
     * Verify a presented token.
     *
     * Returns null for anything that is not a live, correctly signed token for
     * *this* tenant. A token minted for another host does not verify here even
     * though the signature is ours, because the tenant is re-derived and
     * compared rather than read out and believed.
     */
    public static function verify(string $token): ?self
    {
        if (!self::configured() || $token === '') {
            return null;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return null;
        }
        [$encoded, $signature] = $parts;

        if (!hash_equals(self::sign($encoded), $signature)) {
            return null;
        }

        $payload = json_decode(self::base64UrlDecode($encoded), true);
        if (!is_array($payload) || ($payload['v'] ?? '') !== self::VERSION) {
            return null;
        }

        $expiresAt = (int) ($payload['exp'] ?? 0);
        if ($expiresAt <= time()) {
            return null;
        }

        $tenant = Json::string($payload['tid'] ?? '');
        if ($tenant === '' || $tenant !== self::resolveTenant()) {
            return null;
        }

        $conversationId = Json::string($payload['cid'] ?? '');
        if ($conversationId === '') {
            return null;
        }

        return new self($conversationId, $tenant, (int) ($payload['iat'] ?? 0), $expiresAt);
    }

    /** The token as presented by the browser, from a header we chose. */
    public static function fromRequest(): ?self
    {
        $header = (string) ($_SERVER['HTTP_X_LOBBY_SESSION'] ?? $_SERVER['REDIRECT_HTTP_X_LOBBY_SESSION'] ?? '');

        return $header === '' ? null : self::verify(trim($header));
    }

    /**
     * Is this request coming from somewhere we serve?
     *
     * The session travels in a custom header rather than a cookie, so a
     * cross-site form post cannot carry it and classic CSRF does not apply.
     * This is the second lock: a browser that has been tricked into scripting
     * against us still has to be on an allowed origin.
     */
    public static function originAllowed(): bool
    {
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin === '') {
            // No Origin at all: a same-origin GET, curl, or a server-to-server
            // caller. The signed session is what is actually guarding this.
            return true;
        }

        $host = strtolower(trim(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]));
        $originHost = strtolower((string) (parse_url($origin, PHP_URL_HOST) ?: ''));
        if ($originHost !== '' && $originHost === $host) {
            return true;
        }

        $allowed = array_filter(array_map('trim', explode(',', Env::get('CORS_ALLOWED_ORIGINS'))));

        return in_array($origin, $allowed, true);
    }

    private static function sign(string $encoded): string
    {
        return self::base64UrlEncode(hash_hmac('sha256', self::VERSION . '.' . $encoded, self::secret(), true));
    }

    private static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $encoded): string
    {
        $padded = strtr($encoded, '-_', '+/');
        $remainder = strlen($padded) % 4;
        if ($remainder > 0) {
            $padded .= str_repeat('=', 4 - $remainder);
        }

        return (string) base64_decode($padded, true);
    }
}
