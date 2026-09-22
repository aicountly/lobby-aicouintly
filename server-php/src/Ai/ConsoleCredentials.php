<?php

declare(strict_types=1);

namespace Aicountly\Api\Ai;

use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Json;

/**
 * Lobby's AI provider credentials, from Console.
 *
 * ## Why Console and not a key in this product's .env
 *
 * console.aicountly.org is the fleet's system of record for AI provider keys.
 * Every product used to carry its own key in its own server .env on its own
 * cPanel host, so rotating one key meant editing a dozen boxes by hand and
 * nothing could report where a key was actually in use. Console holds the key
 * encrypted and hands it over on `GET /ai/credentials/resolve`, authenticated
 * with the shared service key.
 *
 * NOTHING IS WRITTEN TO DISK HERE. The answer is held in process memory and,
 * where APCu exists, in shared memory. A provider key never comes to rest in a
 * file next to this code — which is the point on a public-facing host like this
 * one, where the front door is open to the internet by design.
 *
 * ## What this class is NOT
 *
 * It is not a second AI credential system. It does not store a key, mint one,
 * cache one to disk, or accept one from a request. It asks Console and holds
 * the answer for a few minutes. Lobby owns its reception PROMPTS, its
 * conversation LOGIC and its approved KNOWLEDGE — see Reception and Knowledge —
 * and Console owns the keys and the provider governance. Both are true at once.
 *
 * Adapted from the same class in appointments-aicountly and calendar-react-app,
 * deliberately, so the fleet has one way of doing this. Two differences are
 * Lobby's own: the Console lookup is keyed by the real hostname Console has on
 * record (`ai_domains.domain`), and more than one module is resolvable, because
 * a reception desk has a conversation, a voice and an ear rather than one
 * insight endpoint.
 */
final class ConsoleCredentials
{
    /** The conversation. Console module key under this product's domain. */
    public const MODULE_RECEPTION = 'reception';

    /** Spoken replies, where Console brokers the speech provider's key. */
    public const MODULE_SPEECH = 'text_to_speech';

    /** Voice input, where Console brokers the transcription provider's key. */
    public const MODULE_TRANSCRIPTION = 'speech_to_text';

    /**
     * The host Console has on record for this product.
     *
     * Console matches `ai_domains.domain` exactly, so this is a real hostname
     * rather than a slug. Overridable because the sandbox deployment answers on
     * a different host and must not resolve production's binding.
     */
    private const DEFAULT_DOMAIN = 'lobby.aicountly.com';

    private const DEFAULT_TTL = 300;

    /**
     * Console sits on the request path of a visitor's first message, so this is
     * short on purpose: a slow Console should degrade reception to "not
     * available right now", not hold a visitor at a blank screen.
     */
    private const TIMEOUT = 4;

    private const CONNECT_TIMEOUT = 2;

    /**
     * How long a failure is remembered, in this process only.
     *
     * Without it, one visitor message costs a fresh 4-second timeout for every
     * caller that asks whether reception is configured — the capability report,
     * the conversation, and the reason it gives for being unavailable are three
     * separate asks. A down Console should cost one timeout per worker per half
     * minute, not one per question.
     *
     * Deliberately not written to APCu. A negative result shared across every
     * worker would keep a recovered Console invisible for as long as it lasted.
     */
    private const FAILURE_TTL = 30;

    /** Per-process memo. PHP-FPM reuses a worker for many requests. */
    private static array $memo = [];

    /**
     * @return array{
     *     api_key: string, model: string, provider: string, source: string,
     *     base_url: ?string, auth_method: string, auth_header: ?string,
     *     max_tokens: ?int, ids: array<string, int>
     * }|null
     */
    public static function resolve(string $module = self::MODULE_RECEPTION): ?array
    {
        $cacheKey = self::domain() . '|' . $module;

        if (isset(self::$memo[$cacheKey]) && self::$memo[$cacheKey]['expires'] > time()) {
            return self::$memo[$cacheKey]['value'];
        }

        $shared = self::apcuGet($cacheKey);
        if ($shared !== null) {
            self::$memo[$cacheKey] = ['value' => $shared, 'expires' => time() + 30];

            return $shared;
        }

        $fromConsole = self::fetch($module);
        $shaped = $fromConsole === null ? null : self::shape($fromConsole);

        if ($shaped === null) {
            self::$memo[$cacheKey] = ['value' => null, 'expires' => time() + self::FAILURE_TTL];

            return null;
        }

        $ttl = max(30, (int) ($fromConsole['ttl_seconds'] ?? self::DEFAULT_TTL));
        self::$memo[$cacheKey] = ['value' => $shaped, 'expires' => time() + $ttl];
        self::apcuSet($cacheKey, $shaped, $ttl);

        return $shaped;
    }

    /** Whether this deployment is pointed at a Console at all. */
    public static function isConfigured(): bool
    {
        return self::baseUrl() !== '' && Env::get('CONSOLE_SERVICE_KEY') !== '';
    }

    public static function domain(): string
    {
        $configured = Env::get('CONSOLE_AI_DOMAIN');

        return strtolower($configured !== '' ? $configured : self::DEFAULT_DOMAIN);
    }

    /**
     * What a screen may say about one module, with no secret in it.
     *
     * The variable NAME goes in `admin_hint`, never the value, and the caller
     * shows that hint only to somebody who could act on it — in this product
     * that means a holder of a valid portal session, never a public visitor.
     *
     * @return array{available: bool, model: ?string, provider: ?string, reason: ?string, admin_hint: ?string}
     */
    public static function status(string $module = self::MODULE_RECEPTION): array
    {
        if (!self::isConfigured()) {
            return [
                'available' => false,
                'model' => null,
                'provider' => null,
                'reason' => 'No AI provider is configured for this deployment.',
                'admin_hint' => 'Set CONSOLE_API_URL and CONSOLE_SERVICE_KEY in the API .env on the server. '
                    . 'The provider key itself lives in Console, not here.',
            ];
        }

        $resolved = self::resolve($module);
        if ($resolved === null) {
            return [
                'available' => false,
                'model' => null,
                'provider' => null,
                'reason' => 'Console did not return credentials for this deployment.',
                'admin_hint' => 'In Console, bind an active AI credential to the "' . $module
                    . '" module under the ' . self::domain() . ' domain.',
            ];
        }

        return [
            'available' => true,
            'model' => $resolved['model'] !== '' ? $resolved['model'] : null,
            'provider' => $resolved['provider'],
            'reason' => null,
            'admin_hint' => null,
        ];
    }

    /**
     * The auth header a Console-brokered provider wants, ready to send.
     *
     * For the vendor-neutral speech and transcription endpoints, where Lobby's
     * .env owns the URL and the request shape and Console owns only the key.
     * Opt-in at the call site: a key belonging to one vendor must never be sent
     * to another vendor's URL just because both happen to be configured.
     *
     * @return array{name: string, value: string}|null
     */
    public static function brokeredAuth(string $module): ?array
    {
        $resolved = self::resolve($module);
        if ($resolved === null) {
            return null;
        }

        if (strtolower((string) $resolved['auth_method']) === 'bearer') {
            return ['name' => 'authorization', 'value' => 'Bearer ' . $resolved['api_key']];
        }

        $header = (string) ($resolved['auth_header'] ?? '');

        return [
            'name' => $header !== '' ? $header : 'authorization',
            'value' => (string) $resolved['api_key'],
        ];
    }

    /**
     * Report one AI call back to Console.
     *
     * Fire-and-forget: usage telemetry must never delay or fail a visitor's
     * reply, so failures are swallowed and the timeout is one second. Only
     * counts, identifiers and an outcome go across — never the visitor's words,
     * never the reply, never the key.
     *
     * @param array<string, mixed> $event
     */
    public static function reportUsage(array $event): void
    {
        $base = self::baseUrl();
        $key = Env::get('CONSOLE_SERVICE_KEY');

        if ($base === '' || $key === '') {
            return;
        }

        $encoded = json_encode(['events' => [$event]], JSON_UNESCAPED_SLASHES);
        if (!is_string($encoded)) {
            return;
        }

        Http::to($base . '/ai/usage')
            ->header('content-type', 'application/json')
            ->header('authorization', 'Bearer ' . $key)
            ->timeouts(1, 2)
            ->maxResponseBytes(16 * 1024)
            ->send('POST', $encoded);
    }

    /**
     * Turn a resolved credential plus an outcome into a usage event.
     *
     * Kept here rather than at the call sites so every module reports the same
     * shape, and so the rule that no prompt text goes to Console is enforced in
     * one place rather than remembered in three.
     *
     * @param array<string, mixed> $resolved
     * @param array<string, int> $tokens
     * @return array<string, mixed>
     */
    public static function usageEvent(
        array $resolved,
        string $outcome,
        ?string $errorCode = null,
        ?int $latencyMs = null,
        array $tokens = [],
    ): array {
        $ids = is_array($resolved['ids'] ?? null) ? $resolved['ids'] : [];
        $input = (int) ($tokens['inputTokens'] ?? 0);
        $output = (int) ($tokens['outputTokens'] ?? 0);

        return [
            'domain_id' => $ids['domain_id'] ?? null,
            'module_id' => $ids['module_id'] ?? null,
            'provider_id' => $ids['provider_id'] ?? null,
            'model_id' => $ids['model_id'] ?? null,
            'credential_id' => $ids['credential_id'] ?? null,
            'outcome' => $outcome,
            'error_code' => $errorCode,
            'latency_ms' => $latencyMs,
            'prompt_tokens' => $input > 0 ? $input : null,
            'completion_tokens' => $output > 0 ? $output : null,
            'total_tokens' => ($input + $output) > 0 ? $input + $output : null,
            // A public visitor is not a Console actor and has no company, so
            // the actor fields stay empty rather than carrying a session id
            // that would make an anonymous visitor re-identifiable in reports.
            'dimensions' => ['surface' => 'lobby-reception'],
        ];
    }

    /** @return array<string, mixed>|null the decoded `data` envelope */
    private static function fetch(string $module): ?array
    {
        $base = self::baseUrl();
        $key = Env::get('CONSOLE_SERVICE_KEY');

        if ($base === '' || $key === '') {
            return null;
        }

        $url = $base . '/ai/credentials/resolve?domain=' . rawurlencode(self::domain())
            . '&module=' . rawurlencode($module);

        $response = Http::to($url)
            ->header('authorization', 'Bearer ' . $key)
            ->header('accept', 'application/json')
            ->timeouts(self::CONNECT_TIMEOUT, self::TIMEOUT)
            ->maxResponseBytes(256 * 1024)
            ->send('GET');

        if (!$response['ok']) {
            // Deliberately generic, and deliberately without the URL: a
            // transport message can echo the request, and the request carries
            // the service key in a header the logger has no reason to see.
            error_log(sprintf(
                '[lobby-ai] Console resolve for %s/%s failed: %s',
                self::domain(),
                $module,
                $response['error'] !== '' ? 'transport error' : 'HTTP ' . $response['status'],
            ));

            return null;
        }

        $data = Json::decode($response['body']);

        return is_array($data['data'] ?? null) ? $data['data'] : null;
    }

    /**
     * The primary binding, flattened.
     *
     * Console returns the whole chain — primary first, then fallbacks — so a
     * step-down needs no second round trip. Lobby uses the primary only: a
     * reception desk that quietly answers on a different provider than the one
     * the operator bound would be a worse failure than saying it is unavailable.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>|null
     */
    private static function shape(array $data): ?array
    {
        $list = $data['credentials'] ?? [];
        if (!is_array($list) || $list === []) {
            return null;
        }

        $primary = $list[0];
        if (!is_array($primary) || trim((string) ($primary['api_key'] ?? '')) === '') {
            return null;
        }

        $ids = [];
        foreach (is_array($primary['ids'] ?? null) ? $primary['ids'] : [] as $name => $value) {
            $ids[(string) $name] = (int) $value;
        }

        return [
            'api_key' => (string) $primary['api_key'],
            'model' => (string) ($primary['model'] ?? ''),
            'provider' => (string) ($primary['provider'] ?? ''),
            'source' => 'console',
            'base_url' => isset($primary['base_url']) && $primary['base_url'] !== null
                ? (string) $primary['base_url']
                : null,
            // 'header_key' means the key goes in `auth_header`; 'bearer' means
            // Authorization. Carried through rather than assumed, because the
            // two providers this product can speak to disagree about it.
            'auth_method' => (string) ($primary['auth_method'] ?? 'bearer'),
            'auth_header' => isset($primary['auth_header']) && $primary['auth_header'] !== null
                ? (string) $primary['auth_header']
                : null,
            'max_tokens' => isset($primary['max_tokens']) && $primary['max_tokens'] !== null
                ? (int) $primary['max_tokens']
                : null,
            'ids' => $ids,
        ];
    }

    private static function baseUrl(): string
    {
        return rtrim(Env::get('CONSOLE_API_URL'), '/');
    }

    /** @return array<string, mixed>|null */
    private static function apcuGet(string $key): ?array
    {
        if (!function_exists('apcu_fetch') || !ini_get('apc.enabled')) {
            return null;
        }

        $hit = false;
        $value = apcu_fetch('lobby_ai_cred:' . $key, $hit);

        return ($hit && is_array($value)) ? $value : null;
    }

    /** @param array<string, mixed> $value */
    private static function apcuSet(string $key, array $value, int $ttl): void
    {
        if (function_exists('apcu_store') && ini_get('apc.enabled')) {
            // Shared memory only — deliberately never a file, so a provider key
            // does not come to rest on this host's disk.
            apcu_store('lobby_ai_cred:' . $key, $value, $ttl);
        }
    }

    /**
     * CLI only. Lets the test suite exercise both paths without a Console.
     *
     * Guarded by SAPI rather than by an environment flag on purpose: an
     * environment flag is something a misconfigured production host can end up
     * carrying, and this one would accept an injected credential.
     *
     * @param array<string, mixed>|null $credentials
     */
    public static function overrideForTesting(?array $credentials, string $module = self::MODULE_RECEPTION): void
    {
        if (PHP_SAPI !== 'cli') {
            return;
        }

        if ($credentials === null) {
            self::$memo = [];

            return;
        }

        self::$memo[self::domain() . '|' . $module] = [
            'value' => $credentials,
            'expires' => time() + 300,
        ];
    }
}
