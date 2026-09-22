<?php

declare(strict_types=1);

namespace Aicountly\Api\Provider;

use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Json;

/**
 * Speech-to-text through whichever HTTP endpoint the business approves.
 *
 * Same reasoning as `HttpSpeech`: the vendor is a commercial decision, the
 * integration is not. Audio is posted as multipart/form-data, which is what
 * every transcription API in common use accepts.
 *
 * Audio is never written to disk and never logged. It exists as one string in
 * memory for the length of one request and is then gone.
 */
final class HttpTranscription implements TranscriptionProvider
{
    /** Longest recording accepted, in bytes. Roughly a minute of Opus. */
    public const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

    /** Container types a browser's MediaRecorder actually produces. */
    public const ACCEPTED_TYPES = [
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav',
        'audio/x-wav',
    ];

    public function name(): string
    {
        $configured = Env::get('LOBBY_STT_PROVIDER_NAME');

        return $configured !== '' ? $configured : 'Configured transcription endpoint';
    }

    public function configured(): bool
    {
        return Env::get('LOBBY_STT_URL') !== '';
    }

    public function unconfiguredReason(): string
    {
        return $this->configured()
            ? ''
            : 'LOBBY_STT_URL is not set. No server-side transcription is configured, so voice input uses the browser speech engine where one exists.';
    }

    public function transcribe(string $audio, string $contentType, string $filename): array
    {
        if (!$this->configured()) {
            return ['ok' => false, 'text' => '', 'error' => $this->unconfiguredReason(), 'retryable' => false];
        }
        if ($audio === '') {
            return ['ok' => false, 'text' => '', 'error' => 'The recording was empty.', 'retryable' => false];
        }
        if (strlen($audio) > self::MAX_AUDIO_BYTES) {
            return ['ok' => false, 'text' => '', 'error' => 'That recording is too long.', 'retryable' => false];
        }

        $boundary = '----aicountly' . bin2hex(random_bytes(12));
        $fields = ['model' => Env::get('LOBBY_STT_MODEL')];
        $language = Env::get('LOBBY_STT_LANGUAGE');
        if ($language !== '') {
            $fields['language'] = $language;
        }

        $body = '';
        foreach ($fields as $name => $value) {
            if ($value === '') {
                continue;
            }
            $body .= "--{$boundary}\r\n";
            $body .= "Content-Disposition: form-data; name=\"{$name}\"\r\n\r\n{$value}\r\n";
        }

        $fileField = Env::get('LOBBY_STT_FILE_FIELD', 'file');
        $body .= "--{$boundary}\r\n";
        $body .= "Content-Disposition: form-data; name=\"{$fileField}\"; filename=\"{$filename}\"\r\n";
        $body .= "Content-Type: {$contentType}\r\n\r\n";
        $body .= $audio . "\r\n";
        $body .= "--{$boundary}--\r\n";

        $request = Http::to(Env::get('LOBBY_STT_URL'))
            ->header('content-type', 'multipart/form-data; boundary=' . $boundary)
            ->header('accept', 'application/json')
            ->timeouts(5, (int) Env::get('LOBBY_STT_TIMEOUT_SECONDS', '30'))
            ->maxResponseBytes(256 * 1024);

        $authHeader = Env::get('LOBBY_STT_AUTH_HEADER');
        $authValue = Env::get('LOBBY_STT_AUTH_VALUE');
        if ($authHeader !== '' && $authValue !== '') {
            $request = $request->header($authHeader, $authValue);
        }

        $response = $request->send('POST', $body);

        if ($response['error'] !== '') {
            return ['ok' => false, 'text' => '', 'error' => $response['error'], 'retryable' => true];
        }
        if (!$response['ok']) {
            return [
                'ok' => false,
                'text' => '',
                'error' => 'The transcription service refused the recording.',
                'retryable' => $response['status'] === 429 || $response['status'] >= 500,
            ];
        }

        $data = Json::decode($response['body']);
        if ($data === null) {
            return ['ok' => false, 'text' => '', 'error' => 'The transcription service returned something this API could not read.', 'retryable' => true];
        }

        // `text` is the near-universal field; a configured path covers the rest
        // without this class needing to know one vendor's response shape.
        $path = Env::get('LOBBY_STT_TEXT_PATH', 'text');
        $text = $data;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($text) || !array_key_exists($segment, $text)) {
                $text = null;
                break;
            }
            $text = $text[$segment];
        }

        $transcript = Json::text($text, 2000);
        if ($transcript === '') {
            return ['ok' => false, 'text' => '', 'error' => 'Nothing was heard in that recording.', 'retryable' => false];
        }

        return ['ok' => true, 'text' => $transcript, 'error' => '', 'retryable' => false];
    }
}
