<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * One outbound HTTP client for every provider this API talks to.
 *
 * `Portal.php` already had a curl block of its own; rather than grow a second
 * and a third, provider calls go through here. It exists to make three things
 * impossible to forget: a connect timeout, a total timeout, and a response that
 * is returned as bytes plus a content type rather than assumed to be JSON.
 *
 * That last point is not fussiness. A text-to-speech endpoint that fails
 * returns a JSON error with a 4xx and an `application/json` content type; code
 * that assumes the body is audio hands the browser a JSON blob labelled as an
 * MP3, and the visitor hears nothing with no error anywhere.
 */
final class Http
{
    /** @var array<int, string> */
    private array $headers = [];

    private int $connectTimeout = 5;

    private int $timeout = 20;

    private ?int $maxResponseBytes = null;

    public static function to(string $url): self
    {
        $client = new self();
        $client->url = $url;

        return $client;
    }

    private string $url = '';

    public function header(string $name, string $value): self
    {
        $this->headers[] = $name . ': ' . $value;

        return $this;
    }

    public function timeouts(int $connectSeconds, int $totalSeconds): self
    {
        $this->connectTimeout = max(1, $connectSeconds);
        $this->timeout = max(1, $totalSeconds);

        return $this;
    }

    /** Refuse a response larger than this many bytes rather than buffering it. */
    public function maxResponseBytes(int $bytes): self
    {
        $this->maxResponseBytes = $bytes > 0 ? $bytes : null;

        return $this;
    }

    /**
     * Send a request and return the raw answer.
     *
     * @param resource|string|null $body
     * @return array{ok: bool, status: int, body: string, contentType: string, error: string}
     */
    public function send(string $method, $body = null): array
    {
        $ch = curl_init($this->url);
        if ($ch === false) {
            return self::failure('The HTTP client could not be created.');
        }

        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_HTTPHEADER => $this->headers,
            CURLOPT_CONNECTTIMEOUT => $this->connectTimeout,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_HEADER => false,
            // A provider redirecting us somewhere is not something to follow
            // blindly with an API key attached to the request.
            CURLOPT_FOLLOWLOCATION => false,
        ];

        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = $body;
        }

        if ($this->maxResponseBytes !== null) {
            $limit = $this->maxResponseBytes;
            $options[CURLOPT_BUFFERSIZE] = 16384;
            $options[CURLOPT_NOPROGRESS] = false;
            $options[CURLOPT_PROGRESSFUNCTION] = static function ($resource, $downloadTotal, $downloaded) use ($limit) {
                // Returning non-zero aborts the transfer, so an oversized body
                // is refused while it arrives rather than after.
                return ($downloadTotal > $limit || $downloaded > $limit) ? 1 : 0;
            };
        }

        curl_setopt_array($ch, $options);

        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $errorNumber = curl_errno($ch);
        $errorMessage = curl_error($ch);
        curl_close($ch);

        if ($response === false || $status === 0) {
            if ($errorNumber === CURLE_ABORTED_BY_CALLBACK) {
                return self::failure('The provider response was larger than this API accepts.');
            }
            if ($errorNumber === CURLE_OPERATION_TIMEDOUT) {
                return self::failure('The provider did not answer in time.');
            }

            // The message can carry the URL, and the URL can carry a query
            // credential, so it is not passed on.
            return self::failure('The provider could not be reached.');
        }

        return [
            'ok' => $status >= 200 && $status < 300,
            'status' => $status,
            'body' => (string) $response,
            'contentType' => strtolower(trim(explode(';', $contentType !== '' ? $contentType : 'application/octet-stream')[0])),
            'error' => '',
        ];
    }

    /**
     * @return array{ok: bool, status: int, body: string, contentType: string, error: string}
     */
    private static function failure(string $message): array
    {
        return ['ok' => false, 'status' => 0, 'body' => '', 'contentType' => '', 'error' => $message];
    }
}
