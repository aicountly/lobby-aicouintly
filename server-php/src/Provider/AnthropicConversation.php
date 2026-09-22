<?php

declare(strict_types=1);

namespace Aicountly\Api\Provider;

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

    public function name(): string
    {
        return 'Anthropic Messages API';
    }

    public function model(): string
    {
        $configured = Env::get('LOBBY_AI_MODEL');

        return $configured !== '' ? $configured : self::DEFAULT_MODEL;
    }

    public function configured(): bool
    {
        return Env::get('LOBBY_AI_API_KEY') !== '';
    }

    public function unconfiguredReason(): string
    {
        return $this->configured()
            ? ''
            : 'LOBBY_AI_API_KEY is not set in the API .env on the server. The reception model credential is server-side only and is never part of the browser bundle.';
    }

    public function reply(string $system, array $messages, array $tools): array
    {
        if (!$this->configured()) {
            return $this->failure($this->unconfiguredReason(), false);
        }

        $payload = [
            'model' => $this->model(),
            'max_tokens' => self::MAX_TOKENS,
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

        $response = Http::to(self::ENDPOINT)
            ->header('content-type', 'application/json')
            ->header('x-api-key', Env::get('LOBBY_AI_API_KEY'))
            ->header('anthropic-version', self::API_VERSION)
            ->timeouts(5, (int) Env::get('LOBBY_AI_TIMEOUT_SECONDS', '25'))
            ->maxResponseBytes(512 * 1024)
            ->send('POST', $encoded);

        if ($response['error'] !== '') {
            return $this->failure($response['error'], true);
        }

        $data = Json::decode($response['body']);
        if ($data === null) {
            return $this->failure('The model returned a response this API could not read.', true);
        }

        if (!$response['ok']) {
            return $this->failure($this->describeError($response['status'], $data), $this->retryable($response['status']));
        }

        $stopReason = Json::string($data['stop_reason'] ?? '');

        // Safety classifiers can decline with a 200. Reading content without
        // checking this produces an empty reply and no explanation anywhere.
        if ($stopReason === 'refusal') {
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

        return [
            'ok' => true,
            'text' => trim($text),
            'actions' => $actions,
            'stopReason' => $stopReason,
            'usage' => [
                'inputTokens' => (int) ($usage['input_tokens'] ?? 0),
                'outputTokens' => (int) ($usage['output_tokens'] ?? 0),
            ],
            'error' => '',
            'retryable' => false,
        ];
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
