<?php

declare(strict_types=1);

/**
 * Is this host's reception actually wired up?
 *
 *   php api/tools/check-console-ai.php
 *
 * Run it on the server, from WHM's terminal or SSH, after editing `api/.env`.
 * It answers the one question the HTTP endpoints cannot answer for you without
 * a portal login: whether Console will hand this host a reception credential.
 *
 * It prints NO secret. Not the provider key, not the Console service key, not
 * the session secret — only whether each is present and what Console said. That
 * is deliberate: the output of a diagnostic gets pasted into chat threads.
 */

namespace Aicountly\Api;

use Aicountly\Api\Ai\ConsoleCredentials;
use Aicountly\Api\Provider\AnthropicConversation;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$root = dirname(__DIR__);

require $root . '/src/Env.php';
require $root . '/src/Portal.php';
require $root . '/src/Http.php';
require $root . '/src/Json.php';
require $root . '/src/RateLimit.php';
require $root . '/src/VisitorSession.php';
require $root . '/src/Knowledge.php';
require $root . '/src/Ai/ConsoleCredentials.php';
require $root . '/src/Provider/Contracts.php';
require $root . '/src/Provider/AnthropicConversation.php';
require $root . '/src/Provider/HttpSpeech.php';
require $root . '/src/Provider/HttpTranscription.php';
require $root . '/src/Reception.php';
require $root . '/src/Capabilities.php';

Env::load($root . '/.env');

$failures = 0;

function line(bool $ok, string $label, string $detail = ''): void
{
    global $failures;
    if (!$ok) {
        $failures += 1;
    }
    printf("%s  %-34s %s\n", $ok ? ' ok ' : 'FAIL', $label, $detail);
}

echo "\nLobby reception — configuration check\n";
echo str_repeat('-', 72), "\n";

// --- Console ---------------------------------------------------------------
$consoleConfigured = ConsoleCredentials::isConfigured();
line($consoleConfigured, 'Console API configured', $consoleConfigured
    ? 'CONSOLE_API_URL and CONSOLE_SERVICE_KEY are both set'
    : 'set CONSOLE_API_URL and CONSOLE_SERVICE_KEY in api/.env');

echo "     ", str_pad('Console domain', 34), ConsoleCredentials::domain(), "\n";

$status = ConsoleCredentials::status(ConsoleCredentials::MODULE_RECEPTION);
line((bool) $status['available'], 'Console has a reception binding', (string) (
    $status['available']
        ? $status['provider'] . ' / ' . ($status['model'] ?? 'no model named')
        : ($status['admin_hint'] ?? $status['reason'] ?? '')
));

// --- The conversation itself ------------------------------------------------
$conversation = new AnthropicConversation();
line($conversation->configured(), 'Reception can answer', $conversation->configured()
    ? 'credential source: ' . $conversation->source() . ', model: ' . $conversation->model()
    : $conversation->unconfiguredReason());

// --- The rest of what a live deployment needs -------------------------------
line(VisitorSession::configured(), 'Visitor sessions', VisitorSession::configured()
    ? 'LOBBY_SESSION_SECRET is set and long enough'
    : 'LOBBY_SESSION_SECRET is unset or shorter than 32 characters');

$knowledge = Knowledge::summary();
$sections = is_array($knowledge['sections'] ?? null) ? $knowledge['sections'] : [];
line((bool) $knowledge['configured'], 'Approved knowledge', $knowledge['configured']
    ? count($sections) . ' section(s) — ' . implode(', ', $sections)
    : 'no readable file at ' . Knowledge::path());

$stateDir = RateLimit::directory();
line(is_writable($stateDir), 'Rate limiter state directory', $stateDir);

// --- Optional voice ---------------------------------------------------------
$speech = new Provider\HttpSpeech();
$transcription = new Provider\HttpTranscription();
printf("     %-34s %s\n", 'Server voice (optional)', $speech->configured() ? 'configured' : 'not configured — the browser voice is used');
printf("     %-34s %s\n", 'Server transcription (optional)', $transcription->configured() ? 'configured' : 'not configured — the browser recogniser is used');

echo str_repeat('-', 72), "\n";
echo $failures === 0
    ? "Reception is ready. Open the site and press Talk.\n\n"
    : $failures . " item(s) need attention before reception can answer.\n\n";

exit($failures === 0 ? 0 : 1);
