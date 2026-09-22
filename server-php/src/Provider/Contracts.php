<?php

declare(strict_types=1);

namespace Aicountly\Api\Provider;

/**
 * The three provider seams, kept apart on purpose.
 *
 * Conversation, speech and transcription are separate capabilities with
 * separate configuration, so one that is missing or failing disables exactly
 * itself. A receptionist with no text-to-speech is a receptionist that types;
 * a receptionist with no transcription is one you type to. Neither is a
 * receptionist that is down, and wiring them to one switch would make them one.
 *
 * Each returns a typed result rather than throwing, because "the provider is
 * not configured" and "the provider refused" are ordinary answers the interface
 * has to show a visitor, not exceptional conditions.
 */

/** @psalm-type Outcome = array{ok: bool, status: int, reason: string} */

interface ConversationProvider
{
    public function name(): string;

    /** False when the credential or endpoint is missing. */
    public function configured(): bool;

    /** Why it is not usable, phrased for an operator. Empty when it is. */
    public function unconfiguredReason(): string;

    /**
     * Ask the model.
     *
     * @param string $system                 Full system prompt.
     * @param array<int, array{role: string, content: mixed}> $messages
     * @param array<int, array<string, mixed>> $tools Allow-listed action schemas.
     * @return array{
     *     ok: bool,
     *     text: string,
     *     actions: array<int, array{name: string, input: array<string, mixed>}>,
     *     stopReason: string,
     *     usage: array<string, int>,
     *     error: string,
     *     retryable: bool
     * }
     */
    public function reply(string $system, array $messages, array $tools): array;
}

interface SpeechProvider
{
    public function name(): string;

    public function configured(): bool;

    public function unconfiguredReason(): string;

    /**
     * Turn text into audio bytes.
     *
     * @return array{ok: bool, audio: string, contentType: string, error: string, retryable: bool}
     */
    public function speak(string $text): array;
}

interface TranscriptionProvider
{
    public function name(): string;

    public function configured(): bool;

    public function unconfiguredReason(): string;

    /**
     * Turn audio bytes into text.
     *
     * @return array{ok: bool, text: string, error: string, retryable: bool}
     */
    public function transcribe(string $audio, string $contentType, string $filename): array;
}
