<?php

declare(strict_types=1);

namespace Aicountly\Api\Provider;

use Aicountly\Api\Ai\ConsoleCredentials;
use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Json;

/**
 * Conversation through the Anthropic Messages API.
 *
 * Raw HTTP rather than the official PHP SDK, deliberately and with a cost:
 * `server-php` has no composer manifest, no `vendor/`, and the deploy workflow
 * rsyncs the directory as-is to shared cPanel hosting with no dependency step.
 * Adding one is a real change to how this product ships, and it could not be
 * verified from the build environment this was written in — packagist is
 * unreachable there, so the SDK could neither be installed nor compiled
 * against. Shipping an unvendored, unverified dependency into a deploy that has
 * no install step would fail on the server, not here.
 *
 * So this speaks the documented wire protocol, using the same curl pattern
 * `Portal.php` already uses for the auth relay. If a composer step is added
 * later, swapping this class for the SDK is a contained change: nothing outside
 * it knows how the request is made.
 *
 * ## Where the key comes from
 *
 * Console, via ConsoleCredentials — the same way every other product in the
 * fleet gets one. Console also names the model, the base URL and how the key is
 * presented, so rotating a key or moving a model is a Console change and not a
 * deploy here.
 *
 * `LOBBY_AI_API_KEY` survives for a host with no Console configured at all —
 * a developer's laptop. On a host that has one, it is NOT read, because
 * `AI_CREDENTIALS_SOURCE` defaults to `console` here.
 *
 * That default differs from the products that already shipped a key in .env,
 * where the fleet default is `auto` so a migration can be taken one host at a
 * time. Reception has never had a production key to migrate: it has reported
 * `unavailable` since it was built. There is nothing for `auto` to protect
 * here, and a quiet failover to a second copy of the key is how a revoked key
 * keeps working for months. `auto` is still honoured for anyone who wants it.
 */
final class AnthropicConversation implements ConversationProvider
{
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';

    /** Pinned. A version this code was not written against is a silent behaviour change. */
    private const API_VERSION = '2023-06-01';

    private const DEFAULT_MODEL = 'claude-opus-5';

    /**
     * A reception reply is two or three sentences.
     *
     * Low for a general chat completion, and that is the point: this is a
     * deliberately short output, and a cap the length of an essay would let one
     * runaway turn cost more than a day of normal use.
     */
    private const MAX_TOKENS = 1024;

    /** However high Console's binding is set, a front desk reply stops here. */
    private const MAX_TOKENS_CEILING = 4096;

    /** The provider slug Console must be holding for this class to be the right one. */
    private const PROVIDER = 'anthropic';

    /** @var array<string, mixed>|null */
    private ?array $credential = null;

    private bool $resolved = false;

    public function name(): string
    {
        return 'Anthropic Messages API';
    }

    public function model(): string
    {
        $credential = $this->credential();
        if ($credential !== null && (string) $credential['model'] !== '') {
            return (string) $credential['model'];
        }

        $configured = Env::get('LOBBY_AI_MODEL');

        return $configured !== '' ? $configured : self::DEFAULT_MODEL;
    }

    /** Where this deployment's key came from, for the operator report. */
    public function source(): string
    {
        $credential = $this->credential();

        return $credential === null ? 'none' : (string) $credential['source'];
    }

    public function configured(): bool
    {
        return $this->credential() !== null;
    }

    public function unconfiguredReason(): string
    {
        if ($this->configured()) {
            return '';
        }

        if (!ConsoleCredentials::isConfigured()) {
            return 'No AI provider is configured. Set CONSOLE_API_URL and CONSOLE_SERVICE_KEY in the API .env '
                . 'on the server; the provider key itself lives in Console, not here. '
                . '(LOBBY_AI_API_KEY is a local-development override only.)';
        }

        // Memoised, so asking again here costs nothing. Worth asking: "Console
        // answered with the wrong provider" and "Console did not answer" are
        // different problems with different fixes, and an operator reading one
        // sentence should not have to guess which they have.
        $resolved = ConsoleCredentials::resolve(ConsoleCredentials::MODULE_RECEPTION);
        if ($resolved !== null) {
            return 'Console returned a credential for the "' . $resolved['provider'] . '" provider, and '
                . 'reception speaks to Anthropic. Bind an Anthropic credential to the "'
                . ConsoleCredentials::MODULE_RECEPTION . '" module under ' . ConsoleCredentials::domain() . '. '
                . 'The request is not rewritten to suit another provider: that would post a live key to the '
                . 'wrong vendor.';
        }

        $status = ConsoleCredentials::status(ConsoleCredentials::MODULE_RECEPTION);

        return trim('Console did not return a reception credential. ' . (string) ($status['admin_hint'] ?? ''));
    }

    /**
     * The credential for this turn, resolved once per request.
     *
     * @return array<string, mixed>|null
     */
    private function credential(): ?array
    {
        if ($this->resolved) {
            return $this->credential;
        }
        $this->resolved = true;

        if (ConsoleCredentials::isConfigured()) {
            $fromConsole = ConsoleCredentials::resolve(ConsoleCredentials::MODULE_RECEPTION);

            // A binding for another provider is a misconfiguration, not
            // something to paper over: sending a Google key to Anthropic's
            // endpoint would leak the key to a third party and fail anyway.
            if ($fromConsole !== null && strtolower((string) $fromConsole['provider']) === self::PROVIDER) {
                $this->credential = $fromConsole;

                return $this->credential;
            }

            if (!$this->fallbackAllowed()) {
                return null;
            }

            $this->credential = $this->localKey();

            // `auto` was asked for, so say out loud what it did. A silent
            // fallback is the failure mode this whole arrangement exists to
            // end, and "fell back to nothing" is worth reading too.
            error_log('[lobby-ai] Console gave reception no usable credential; AI_CREDENTIALS_SOURCE=auto so '
                . ($this->credential === null
                    ? 'LOBBY_AI_API_KEY was tried, and it is not set either.'
                    : 'LOBBY_AI_API_KEY was used instead.'));

            return $this->credential;
        }

        $this->credential = $this->localKey();

        return $this->credential;
    }

    /**
     * Whether a configured-but-silent Console may fall back to the .env key.
     *
     * The fleet's switch, with the fleet's meaning: `auto` falls back and logs,
     * `console` fails closed. Only the default differs — see the class note.
     */
    private function fallbackAllowed(): bool
    {
        return strtolower(Env::get('AI_CREDENTIALS_SOURCE', 'console')) === 'auto';
    }

    /** @return array<string, mixed>|null */
    private function localKey(): ?array
    {
        $local = Env::get('LOBBY_AI_API_KEY');
        if ($local === '') {
            return null;
        }

        return [
            'api_key' => $local,
            'model' => '',
            'provider' => self::PROVIDER,
            'source' => 'env',
            'base_url' => null,
            'auth_method' => 'header_key',
            'auth_header' => 'x-api-key',
            'max_tokens' => null,
            'ids' => [],
        ];
    }

    /**
     * The messages endpoint, from Console's base URL where it gave one.
     *
     * Only https is accepted. Console is trusted infrastructure, but a
     * malformed row should not be able to send a provider key over plaintext
     * or to a scheme this client was never meant to speak.
     *
     * @param array<string, mixed> $credential
     */
    private function endpoint(array $credential): string
    {
        $base = (string) ($credential['base_url'] ?? '');
        if ($base === '' || !str_starts_with(strtolower($base), 'https://')) {
            return self::ENDPOINT;
        }

        return rtrim($base, '/') . '/messages';
    }

    public function reply(string $system, array $messages, array $tools): array
    {
        $credential = $this->credential();
        if ($credential === null) {
            return $this->failure($this->unconfiguredReason(), false);
        }

        $payload = [
            'model' => $this->model(),
            'max_tokens' => $this->maxTokens($credential),
            'system' => $system,
            'messages' => $messages,
            // A front desk is a latency-sensitive, short-answer workload, and
            // those do not repay deep thinking. Effort is lowered rather than
            // thinking disabled: with thinking off this model occasionally
            // writes a tool call into its visible text instead of making one.
            'output_config' => ['effort' => 'low'],
        ];

        if ($tools !== []) {
            $payload['tools'] = $tools;
        }

        $encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($encoded)) {
            return $this->failure('The reception request could not be encoded.', false);
        }

        $request = Http::to($this->endpoint($credential))
            ->header('content-type', 'application/json')
            ->header('anthropic-version', self::API_VERSION)
            ->timeouts(5, (int) Env::get('LOBBY_AI_TIMEOUT_SECONDS', '25'))
            ->maxResponseBytes(512 * 1024);

        foreach ($this->authHeader($credential) as $name => $value) {
            $request->header($name, $value);
        }

        $startedAt = microtime(true);
        $response = $request->send('POST', $encoded);
        $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);

        if ($response['error'] !== '') {
            $this->report($credential, 'error', 'transport', $latencyMs);

            return $this->failure($response['error'], true);
        }

        $data = Json::decode($response['body']);
        if ($data === null) {
            $this->report($credential, 'error', 'unreadable', $latencyMs);

            return $this->failure('The model returned a response this API could not read.', true);
        }

        if (!$response['ok']) {
            $this->report($credential, 'error', 'http_' . $response['status'], $latencyMs);

            return $this->failure($this->describeError($response['status'], $data), $this->retryable($response['status']));
        }

        $stopReason = Json::string($data['stop_reason'] ?? '');

        // Safety classifiers can decline with a 200. Reading content without
        // checking this produces an empty reply and no explanation anywhere.
        if ($stopReason === 'refusal') {
            $this->report($credential, 'blocked', 'refusal', $latencyMs);

            return [
                'ok' => false,
                'text' => '',
                'actions' => [],
                'stopReason' => $stopReason,
                'usage' => [],
                'error' => 'The model declined to answer that.',
                'retryable' => false,
            ];
        }

        $text = '';
        $actions = [];
        foreach (is_array($data['content'] ?? null) ? $data['content'] : [] as $block) {
            if (!is_array($block)) {
                continue;
            }
            $type = Json::string($block['type'] ?? '');
            if ($type === 'text') {
                $text .= Json::string($block['text'] ?? '');
            } elseif ($type === 'tool_use') {
                // Proposed, not performed. Validation and dispatch happen in
                // Reception; nothing here may act on a model-chosen name.
                $actions[] = [
                    'name' => Json::string($block['name'] ?? ''),
                    'input' => is_array($block['input'] ?? null) ? $block['input'] : [],
                ];
            }
        }

        $usage = is_array($data['usage'] ?? null) ? $data['usage'] : [];
        $tokens = [
            'inputTokens' => (int) ($usage['input_tokens'] ?? 0),
            'outputTokens' => (int) ($usage['output_tokens'] ?? 0),
        ];

        $this->report($credential, 'success', null, $latencyMs, $tokens);

        return [
            'ok' => true,
            'text' => trim($text),
            'actions' => $actions,
            'stopReason' => $stopReason,
            'usage' => $tokens,
            'error' => '',
            'retryable' => false,
        ];
    }

    /**
     * Console's cap for this binding, where it set one.
     *
     * Clamped rather than trusted outright: the reason MAX_TOKENS is low is
     * that one runaway turn on a public page can cost more than a normal day,
     * and that argument does not stop applying because a row says 200000.
     *
     * @param array<string, mixed> $credential
     */
    private function maxTokens(array $credential): int
    {
        $fromConsole = $credential['max_tokens'] ?? null;
        if (!is_int($fromConsole) || $fromConsole <= 0) {
            return self::MAX_TOKENS;
        }

        return min($fromConsole, self::MAX_TOKENS_CEILING);
    }

    /**
     * How this provider wants the key presented, as Console recorded it.
     *
     * @param array<string, mixed> $credential
     * @return array<string, string>
     */
    private function authHeader(array $credential): array
    {
        $key = (string) $credential['api_key'];

        if (strtolower((string) $credential['auth_method']) === 'bearer') {
            return ['authorization' => 'Bearer ' . $key];
        }

        $header = (string) ($credential['auth_header'] ?? '');

        return [($header !== '' ? $header : 'x-api-key') => $key];
    }

    /**
     * Tell Console this call happened. Counts and an outcome, never content.
     *
     * Skipped for a local-development key, which has no Console identifiers to
     * report against and would only produce orphan rows.
     *
     * @param array<string, mixed> $credential
     * @param array<string, int> $tokens
     */
    private function report(array $credential, string $outcome, ?string $errorCode, int $latencyMs, array $tokens = []): void
    {
        if (($credential['source'] ?? '') !== 'console') {
            return;
        }

        ConsoleCredentials::reportUsage(
            ConsoleCredentials::usageEvent($credential, $outcome, $errorCode, $latencyMs, $tokens)
        );
    }

    private function retryable(int $status): bool
    {
        return $status === 429 || $status >= 500;
    }

    /**
     * An operator-readable reason, without echoing the provider's body.
     *
     * @param array<string, mixed> $data
     */
    private function describeError(int $status, array $data): string
    {
        $error = is_array($data['error'] ?? null) ? $data['error'] : [];
        $type = Json::string($error['type'] ?? '');

        return match (true) {
            $status === 401 || $status === 403 => 'The reception model credential was rejected.',
            $status === 402 => 'The reception model account has a billing problem.',
            $status === 404 => 'The configured reception model is not available to this account.',
            $status === 413 => 'The reception request was too large for the model.',
            $status === 429 => 'The reception model is rate limited. Try again shortly.',
            $status >= 500 => 'The reception model is temporarily unavailable.',
            default => 'The reception model refused the request' . ($type !== '' ? ' (' . $type . ')' : '') . '.',
        };
    }

    /**
     * @return array{ok: bool, text: string, actions: array<int, mixed>, stopReason: string, usage: array<string, int>, error: string, retryable: bool}
     */
    private function failure(string $error, bool $retryable): array
    {
        return [
            'ok' => false,
            'text' => '',
            'actions' => [],
            'stopReason' => '',
            'usage' => [],
            'error' => $error,
            'retryable' => $retryable,
        ];
    }
}
