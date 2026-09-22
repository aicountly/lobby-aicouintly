<?php

declare(strict_types=1);

namespace Aicountly\Api\Provider;

use Aicountly\Api\Ai\ConsoleCredentials;
use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Json;

/**
 * Text-to-speech through whichever HTTP endpoint the business approves.
 *
 * Vendor-neutral on purpose. Anthropic does not offer speech synthesis, so a
 * natural voice means a second provider — and choosing one is a commercial
 * decision with a bill attached, not an implementation detail for this phase to
 * settle on its own. So the integration is real and complete, and the vendor is
 * configuration: endpoint, auth header, request template, expected audio type.
 *
 * The one thing it will not do is hand the browser something that is not audio.
 * A failing TTS endpoint answers with a JSON error and a JSON content type; code
 * that streams that through as an MP3 produces silence with no error anywhere,
 * which is the single most common way this integration breaks.
 */
final class HttpSpeech implements SpeechProvider
{
    private const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

    /** Longest text sent for synthesis. Longer replies are refused, not truncated mid-word. */
    public const MAX_TEXT_CHARS = 1200;

    public function name(): string
    {
        $configured = Env::get('LOBBY_TTS_PROVIDER_NAME');

        return $configured !== '' ? $configured : 'Configured speech endpoint';
    }

    public function configured(): bool
    {
        if (Env::get('LOBBY_TTS_URL') === '' || Env::get('LOBBY_TTS_BODY_TEMPLATE') === '') {
            return false;
        }

        // An operator who asked for the Console key and has not bound one is
        // not "configured without auth" — reporting that would send an
        // unauthenticated request and hand the visitor a vendor's 401 as if the
        // voice had broken. Better to say the voice is not configured and let
        // the browser speak, which is what that answer already means here.
        return !self::brokered() || ConsoleCredentials::brokeredAuth(ConsoleCredentials::MODULE_SPEECH) !== null;
    }

    public function unconfiguredReason(): string
    {
        if ($this->configured()) {
            return '';
        }
        if (Env::get('LOBBY_TTS_URL') === '') {
            return 'LOBBY_TTS_URL is not set. No server-side voice is configured, so replies fall back to the browser speech engine where one exists.';
        }
        if (Env::get('LOBBY_TTS_BODY_TEMPLATE') === '') {
            return 'LOBBY_TTS_BODY_TEMPLATE is not set, so this API does not know what request shape the configured voice endpoint expects.';
        }

        return 'LOBBY_TTS_AUTH_FROM_CONSOLE is on, but Console returned no credential for the "'
            . ConsoleCredentials::MODULE_SPEECH . '" module under ' . ConsoleCredentials::domain()
            . '. Bind one there, or set LOBBY_TTS_AUTH_VALUE and turn the switch off.';
    }

    public function speak(string $text): array
    {
        if (!$this->configured()) {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => $this->unconfiguredReason(), 'retryable' => false];
        }

        $clean = trim($text);
        if ($clean === '') {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => 'There was nothing to say.', 'retryable' => false];
        }
        if (mb_strlen($clean, 'UTF-8') > self::MAX_TEXT_CHARS) {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => 'That reply is too long to synthesise.', 'retryable' => false];
        }

        $body = self::renderBody(Env::get('LOBBY_TTS_BODY_TEMPLATE'), $clean, Env::get('LOBBY_TTS_VOICE'));
        if ($body === null) {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => 'LOBBY_TTS_BODY_TEMPLATE is not valid JSON once the reply is substituted into it.', 'retryable' => false];
        }

        $expected = strtolower(Env::get('LOBBY_TTS_ACCEPT', 'audio/mpeg'));
        $maxBytes = (int) Env::get('LOBBY_TTS_MAX_BYTES', (string) self::DEFAULT_MAX_BYTES);

        $request = Http::to(Env::get('LOBBY_TTS_URL'))
            ->header('content-type', 'application/json')
            ->header('accept', $expected)
            ->timeouts(5, (int) Env::get('LOBBY_TTS_TIMEOUT_SECONDS', '20'))
            ->maxResponseBytes($maxBytes > 0 ? $maxBytes : self::DEFAULT_MAX_BYTES);

        $auth = self::auth();
        if ($auth !== null) {
            $request = $request->header($auth['name'], $auth['value']);
        }

        $response = $request->send('POST', $body);

        if ($response['error'] !== '') {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => $response['error'], 'retryable' => true];
        }

        if (!$response['ok']) {
            return [
                'ok' => false,
                'audio' => '',
                'contentType' => '',
                'error' => 'The speech service refused the request.',
                'retryable' => $response['status'] === 429 || $response['status'] >= 500,
            ];
        }

        // A 200 is not enough. Validate what actually came back.
        if (!str_starts_with($response['contentType'], 'audio/')) {
            return [
                'ok' => false,
                'audio' => '',
                'contentType' => '',
                'error' => 'The speech service answered with ' . ($response['contentType'] ?: 'no content type') . ' rather than audio.',
                'retryable' => false,
            ];
        }

        // A handful of bytes with an audio content type is an error page in
        // disguise more often than it is a very short sound.
        if (strlen($response['body']) < 512) {
            return ['ok' => false, 'audio' => '', 'contentType' => '', 'error' => 'The speech service returned an empty audio response.', 'retryable' => true];
        }

        return ['ok' => true, 'audio' => $response['body'], 'contentType' => $response['contentType'], 'error' => '', 'retryable' => false];
    }

    /**
     * Substitute the reply into the configured JSON template.
     *
     * The text is JSON-encoded before substitution, so a reply containing a
     * quote or a newline cannot break out of its string and change the shape of
     * the request. The result is re-parsed to prove it is still valid JSON.
     */
    public static function renderBody(string $template, string $text, string $voice): ?string
    {
        $encodedText = json_encode($text, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $encodedVoice = json_encode($voice, JSON_UNESCAPED_SLASHES);
        if (!is_string($encodedText) || !is_string($encodedVoice)) {
            return null;
        }

        $rendered = str_replace(
            ['{{text}}', '{{voice}}'],
            [trim($encodedText, '"'), trim($encodedVoice, '"')],
            $template,
        );

        return Json::decode($rendered) === null ? null : $rendered;
    }

    /**
     * How this endpoint is authenticated.
     *
     * Console when LOBBY_TTS_AUTH_FROM_CONSOLE is on, so the key rotates in one
     * place like every other provider key in the fleet. Otherwise the pair in
     * this product's .env, which is how a speech vendor that Console does not
     * carry is configured.
     *
     * Opt-in rather than Console-first on purpose. The URL here is free-form
     * configuration, so nothing can check that a Console-held key belongs to
     * the vendor that URL points at — and a key sent to the wrong vendor is a
     * disclosed key. The operator says which one they mean.
     *
     * @return array{name: string, value: string}|null
     */
    private static function auth(): ?array
    {
        if (self::brokered()) {
            return ConsoleCredentials::brokeredAuth(ConsoleCredentials::MODULE_SPEECH);
        }

        $header = Env::get('LOBBY_TTS_AUTH_HEADER');
        $value = Env::get('LOBBY_TTS_AUTH_VALUE');

        return ($header !== '' && $value !== '') ? ['name' => $header, 'value' => $value] : null;
    }

    private static function brokered(): bool
    {
        return ConsoleCredentials::isConfigured()
            && in_array(strtolower(Env::get('LOBBY_TTS_AUTH_FROM_CONSOLE')), ['1', 'true', 'yes', 'on'], true);
    }
}
