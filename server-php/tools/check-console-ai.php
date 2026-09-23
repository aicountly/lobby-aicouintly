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

use Aicountly\Api\Access\StaffSession;
use Aicountly\Api\Ai\ConsoleCredentials;
use Aicountly\Api\Config\ConfigStore;
use Aicountly\Api\Provider\AnthropicConversation;
use Aicountly\Api\Store\FileRepository;

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
require $root . '/src/Store/Repository.php';
require $root . '/src/Store/Record.php';
require $root . '/src/Store/StoreException.php';
require $root . '/src/Store/FileRepository.php';
require $root . '/src/Config/Schema.php';
require $root . '/src/Config/ConfigStore.php';
require $root . '/src/Knowledge.php';
require $root . '/src/Access/Role.php';
require $root . '/src/Access/StaffSession.php';
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

// --- Where the tenant's own configuration is kept ---------------------------
//
// The question this answers is not "is something configured" but "can an
// administrator change it from the setup screens" — three different failures
// that send somebody to three different places.
$repository = new FileRepository();
$store = new ConfigStore($repository);
$tenant = VisitorSession::resolveTenant();

line($repository->writable(), 'Configuration storage', $repository->writable()
    ? $repository->location()
    : $repository->unavailableReason());

if ($repository->insideDocumentRoot()) {
    printf("     %-34s %s\n", '', 'WARNING: that path is inside the document root. Its contents are served over HTTP, and the next deploy rsyncs it with --delete.');
}

$published = Knowledge::forTenant($tenant, $store);
$summary = $published->summary();
$sections = $summary['sections'];
$source = $store->published($tenant)['source'];

line($summary['configured'], 'Approved knowledge (tenant ' . $tenant . ')', $summary['configured']
    ? count($sections) . ' section(s) — ' . implode(', ', $sections) . ' [' . $source . ']'
    : match ($source) {
        'legacy-file' => 'read from ' . ConfigStore::legacyPath() . ', but nothing is published and it cannot be saved',
        default => 'nothing published, and no ' . ConfigStore::legacyPath() . ' to import',
    });

if (ConfigStore::legacyExists()) {
    printf("     %-34s %s\n", '', 'A Phase 2C knowledge.json is still present at ' . ConfigStore::legacyPath() . '. It is imported once and then left alone; it is safe to keep as a rollback.');
}

// --- Who can administer this deployment -------------------------------------
//
// An owner list is the bootstrap: with nobody on it and nobody in the tenant
// record, the setup screens are unreachable and there is no way in from a
// browser. That is a configuration problem that looks like a broken product.
$owners = StaffSession::bootstrapOwners();
$roster = $repository->writable() ? StaffSession::roster($repository, $tenant) : [];
line($roster !== [], 'Administrators', $roster !== []
    // Counts only. A portal uuid identifies a real person across the whole
    // fleet, and this output gets pasted into chat threads.
    ? count($owners) . ' from LOBBY_OWNER_UUIDS, ' . (count($roster) - count($owners)) . ' added in-product'
    : 'nobody can open the setup screens. Set LOBBY_OWNER_UUIDS to one or more portal uuids.');

$journeys = $published->journeys();
printf("     %-34s %s\n", 'Visitor journeys', implode(', ', array_map(
    static fn (string $k, bool $v): string => $k . '=' . ($v ? 'on' : 'off'),
    array_keys($journeys),
    array_values($journeys),
)));

if ($journeys['handover'] && Env::get('LOBBY_DESK_ALWAYS_OPEN') === 'true') {
    printf("     %-34s %s\n", '', 'LOBBY_DESK_ALWAYS_OPEN=true: visitors are told staff are available without this server having observed anybody at the desk.');
}

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
