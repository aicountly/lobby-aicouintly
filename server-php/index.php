<?php

declare(strict_types=1);

/**
 * Lobby API — front controller.
 *
 * Deployed to <document root>/api, so it is same-origin with the React app on
 * both lobby.aicountly.com and lobby.gh.aicountly.com.
 *
 * Routes:
 *   GET  /api/health                 liveness + which environment answered
 *   POST /api/global/{path}          allow-listed relay to the portal auth API
 *   GET  /api/session                who the caller is, per the portal
 *   GET  /api/lobby/capabilities     what this deployment can actually do
 *   POST /api/lobby/session          issue a scoped session to a public visitor
 *   POST /api/lobby/reception        one turn of the reception conversation
 *   POST /api/lobby/speech           synthesise a validated reply
 *   POST /api/lobby/transcribe       transcribe one recording
 *
 * Everything under /api/lobby answers a *public* page, so each one derives the
 * tenant server-side, requires a signed visitor session, and is rate limited.
 */

namespace Aicountly\Api;

require __DIR__ . '/src/Env.php';
require __DIR__ . '/src/Portal.php';
require __DIR__ . '/src/Http.php';
require __DIR__ . '/src/Json.php';
require __DIR__ . '/src/RateLimit.php';
require __DIR__ . '/src/VisitorSession.php';
require __DIR__ . '/src/Knowledge.php';
require __DIR__ . '/src/Ai/ConsoleCredentials.php';
require __DIR__ . '/src/Provider/Contracts.php';
require __DIR__ . '/src/Provider/AnthropicConversation.php';
require __DIR__ . '/src/Provider/HttpSpeech.php';
require __DIR__ . '/src/Provider/HttpTranscription.php';
require __DIR__ . '/src/Reception.php';
require __DIR__ . '/src/Capabilities.php';

Env::load(__DIR__ . '/.env');

/**
 * Portal paths this API relays for the browser.
 *
 * The relay exists so the SPA never makes a cross-origin call to the portal:
 * a new product domain is not in the portal's CORS allowlist on day one.
 *
 * It is an allowlist and must stay one. Forwarding arbitrary paths would turn
 * this host into an open proxy for the portal's whole auth surface — login,
 * signup, OTP, user lookups — with the portal seeing this server's IP instead
 * of the caller's, so anything it rate-limits per IP could be driven through
 * here instead.
 */
const RELAYED_PATHS = [
    'seskey',
    'seskey/refresh',
    'refresh_authtoken',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param array<string, mixed> $payload
 */
function send_json(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * The Authorization header, wherever this server happens to expose it.
 *
 * Under CGI/FastCGI Apache does not pass it to PHP unless it is copied
 * explicitly, and after an internal rewrite it arrives only under the
 * REDIRECT_ prefix. Reading just one of these is why an otherwise correct
 * deployment answers 401 to every sign-in.
 */
function authorization_header(): string
{
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
    ];

    if (function_exists('apache_request_headers')) {
        foreach ((array) apache_request_headers() as $name => $value) {
            if (strcasecmp((string) $name, 'Authorization') === 0) {
                $candidates[] = (string) $value;
                break;
            }
        }
    }

    foreach ($candidates as $candidate) {
        if (is_string($candidate) && $candidate !== '') {
            return $candidate;
        }
    }

    return '';
}

function bearer_token(): string
{
    $header = authorization_header();
    if ($header === '' || preg_match('/Bearer\s+(.+)/i', $header, $matches) !== 1) {
        return '';
    }

    return trim($matches[1]);
}

/**
 * Collapse a routed path to the exact form RELAYED_PATHS is written in.
 *
 * Percent-escapes are decoded first so `%2e%2e` cannot smuggle a traversal
 * segment past the allowlist; exact matching does the rest.
 */
function normalise_path(string $path): string
{
    $decoded = str_replace('\\', '/', rawurldecode($path));
    $segments = array_values(array_filter(explode('/', $decoded), static fn ($s) => $s !== ''));

    return strtolower(implode('/', $segments));
}

/**
 * CORS for local development only.
 *
 * In both deployed environments the app and this API share an origin, so no
 * CORS headers are needed or sent. CORS_ALLOWED_ORIGINS in the server .env is
 * what lets `npm run dev` on localhost talk to a deployed API.
 */
function apply_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }

    $allowed = array_filter(array_map('trim', explode(',', Env::get('CORS_ALLOWED_ORIGINS'))));
    if (!in_array($origin, $allowed, true)) {
        return;
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Lobby-Session');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
    header('Vary: Origin');
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

apply_cors();

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/');

// Strip the directory this front controller is mounted under, so the same file
// works at <docroot>/api and at the root of a dedicated API vhost.
$mountPoint = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'))), '/');
if ($mountPoint !== '' && $mountPoint !== '/' && strpos($uri, $mountPoint) === 0) {
    $uri = substr($uri, strlen($mountPoint));
}

$path = normalise_path($uri);

if ($path === '' || $path === 'health') {
    send_json(200, [
        'status' => 'ok',
        'app' => 'Lobby',
        'env' => Env::get('APP_ENV', 'unknown'),
        'time' => gmdate('c'),
    ]);
}

if (strpos($path, 'global/') === 0) {
    $portalPath = substr($path, strlen('global/'));

    if (!in_array($portalPath, RELAYED_PATHS, true)) {
        send_json(404, ['message' => 'This path is not relayed. Call the portal API directly.']);
    }

    $headers = [];
    $authorization = authorization_header();
    if ($authorization !== '') {
        $headers[] = 'Authorization: ' . $authorization;
    }
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (is_string($contentType) && $contentType !== '') {
        $headers[] = 'Content-Type: ' . $contentType;
    }

    $body = (string) file_get_contents('php://input');
    $result = Portal::forward($method, $portalPath, $headers, $body);

    if ($result['status'] === 504) {
        send_json(504, ['message' => 'Auth service unavailable — please retry.']);
    }

    http_response_code($result['status']);
    header('Content-Type: ' . $result['contentType']);
    header('Cache-Control: no-store');
    echo $result['body'];
    exit;
}

if ($path === 'session') {
    $sesKey = bearer_token();
    if ($sesKey === '') {
        send_json(401, ['message' => 'Missing bearer session key.']);
    }

    $session = Portal::validateSesKey($sesKey);
    if ($session === null) {
        send_json(401, ['message' => 'Invalid or expired session.']);
    }

    send_json(200, [
        'authenticated' => true,
        'uuid' => $session['uuid_aictly'] ?? ($session['uuid'] ?? ''),
    ]);
}

// ---------------------------------------------------------------------------
// Lobby reception
// ---------------------------------------------------------------------------

/**
 * The visitor session for this request, or a refusal.
 *
 * Every reception route starts here. The session is signed by this server and
 * carries the tenant, so no route below ever reads a tenant from the body.
 */
function require_visitor_session(): VisitorSession
{
    if (!VisitorSession::originAllowed()) {
        send_json(403, ['message' => 'That request did not come from an allowed origin.']);
    }

    $session = VisitorSession::fromRequest();
    if ($session === null) {
        send_json(401, [
            'message' => 'Start a reception session first.',
            'code' => 'session_required',
        ]);
    }

    return $session;
}

/** Apply one limit, answering 429 with a Retry-After rather than failing oddly. */
function enforce_limit(string $key, int $limit, int $windowSeconds, string $message): void
{
    $result = RateLimit::hit($key, $limit, $windowSeconds);
    if ($result['allowed']) {
        return;
    }

    header('Retry-After: ' . $result['retryAfter']);
    send_json(429, ['message' => $message, 'retryAfter' => $result['retryAfter']]);
}

if ($path === 'lobby/capabilities') {
    // Operator detail only for a caller holding a live portal session. The
    // flags themselves are public, because the interface needs them to tell a
    // visitor the truth before it tries anything.
    $token = bearer_token();
    $operator = $token !== '' && Portal::validateSesKey($token) !== null;

    send_json(200, Capabilities::report($operator));
}

if ($path === 'lobby/session') {
    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use POST.']);
    }
    if (!VisitorSession::originAllowed()) {
        send_json(403, ['message' => 'That request did not come from an allowed origin.']);
    }
    if (!VisitorSession::configured()) {
        send_json(503, [
            'message' => 'Reception is not available on this deployment.',
            'code' => 'not_configured',
        ]);
    }

    // Per address, because there is no session yet to count against.
    enforce_limit(
        'session:' . RateLimit::clientIp(),
        (int) Env::get('LOBBY_SESSION_LIMIT_PER_HOUR', '60'),
        3600,
        'Too many reception sessions from this address. Try again shortly.',
    );

    $token = VisitorSession::issue();
    if ($token === null) {
        send_json(503, ['message' => 'Reception is not available on this deployment.', 'code' => 'not_configured']);
    }

    send_json(200, [
        'session' => $token,
        'expiresIn' => VisitorSession::ttl(),
        'capabilities' => Capabilities::report(false),
    ]);
}

if ($path === 'lobby/reception') {
    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use POST.']);
    }

    $session = require_visitor_session();

    $provider = new Provider\AnthropicConversation();
    if (!$provider->configured()) {
        // Explicitly not a fallback to canned answers. A live deployment that
        // quietly answered from a keyword script would be presenting a
        // demonstration as a real model.
        send_json(503, [
            'message' => 'The reception AI is not connected for this deployment.',
            'code' => 'conversation_unavailable',
        ]);
    }

    enforce_limit(
        'reception:session:' . $session->conversationId,
        (int) Env::get('LOBBY_RECEPTION_LIMIT_PER_MINUTE', '12'),
        60,
        'You are sending messages faster than reception can answer. Give it a moment.',
    );
    enforce_limit(
        'reception:ip:' . RateLimit::clientIp(),
        (int) Env::get('LOBBY_RECEPTION_LIMIT_PER_HOUR', '120'),
        3600,
        'Too many reception messages from this address. Try again later.',
    );
    enforce_limit(
        'reception:tenant:' . $session->tenantId,
        (int) Env::get('LOBBY_RECEPTION_LIMIT_PER_DAY', '2000'),
        86400,
        'Reception has reached its daily limit for this business.',
    );

    $read = Json::readBody();
    if (!$read['ok']) {
        send_json($read['status'], ['message' => $read['message']]);
    }

    $message = Json::text($read['data']['message'] ?? '', Reception::MAX_MESSAGE_CHARS);
    if ($message === '') {
        send_json(400, ['message' => 'Say something for reception to answer.']);
    }

    $history = [];
    foreach (is_array($read['data']['history'] ?? null) ? $read['data']['history'] : [] as $turn) {
        if (!is_array($turn)) {
            continue;
        }
        $history[] = [
            'role' => ($turn['role'] ?? '') === 'reception' ? 'reception' : 'visitor',
            'text' => Json::text($turn['text'] ?? '', Reception::MAX_HISTORY_CHARS),
        ];
    }

    $reception = new Reception($provider);
    $result = $reception->answer($message, $history);

    if (!$result['ok']) {
        send_json($result['retryable'] ? 503 : 502, [
            'message' => $result['error'],
            'code' => 'conversation_failed',
            'retryable' => $result['retryable'],
        ]);
    }

    // The transcript is not logged. It is a conversation with a member of the
    // public and this API has no business keeping it.
    send_json(200, [
        'reply' => $result['reply'],
        'suggestions' => $result['suggestions'],
        'actions' => $result['actions'],
        'mode' => 'live',
    ]);
}

if ($path === 'lobby/speech') {
    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use POST.']);
    }

    $session = require_visitor_session();
    $speech = new Provider\HttpSpeech();
    if (!$speech->configured()) {
        send_json(503, [
            'message' => 'Server speech is not configured for this deployment.',
            'code' => 'speech_unavailable',
        ]);
    }

    enforce_limit(
        'speech:session:' . $session->conversationId,
        (int) Env::get('LOBBY_SPEECH_LIMIT_PER_MINUTE', '20'),
        60,
        'Too many speech requests. Give it a moment.',
    );

    $read = Json::readBody();
    if (!$read['ok']) {
        send_json($read['status'], ['message' => $read['message']]);
    }

    $text = Json::text($read['data']['text'] ?? '', Provider\HttpSpeech::MAX_TEXT_CHARS);
    if ($text === '') {
        send_json(400, ['message' => 'There was nothing to say.']);
    }

    $result = $speech->speak($text);
    if (!$result['ok']) {
        send_json($result['retryable'] ? 503 : 502, [
            'message' => $result['error'],
            'code' => 'speech_failed',
            'retryable' => $result['retryable'],
        ]);
    }

    http_response_code(200);
    header('Content-Type: ' . $result['contentType']);
    header('Content-Length: ' . strlen($result['audio']));
    header('Cache-Control: no-store');
    echo $result['audio'];
    exit;
}

if ($path === 'lobby/transcribe') {
    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use POST.']);
    }

    $session = require_visitor_session();
    $transcription = new Provider\HttpTranscription();
    if (!$transcription->configured()) {
        send_json(503, [
            'message' => 'Server transcription is not configured for this deployment.',
            'code' => 'transcription_unavailable',
        ]);
    }

    enforce_limit(
        'transcribe:session:' . $session->conversationId,
        (int) Env::get('LOBBY_TRANSCRIBE_LIMIT_PER_MINUTE', '12'),
        60,
        'Too many recordings. Give it a moment.',
    );

    $contentType = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if (!in_array($contentType, Provider\HttpTranscription::ACCEPTED_TYPES, true)) {
        send_json(415, [
            'message' => 'That audio format is not accepted.',
            'accepted' => Provider\HttpTranscription::ACCEPTED_TYPES,
        ]);
    }

    $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($declared > Provider\HttpTranscription::MAX_AUDIO_BYTES) {
        send_json(413, ['message' => 'That recording is too long.']);
    }

    $audio = (string) file_get_contents('php://input', false, null, 0, Provider\HttpTranscription::MAX_AUDIO_BYTES + 1);
    if (strlen($audio) > Provider\HttpTranscription::MAX_AUDIO_BYTES) {
        send_json(413, ['message' => 'That recording is too long.']);
    }
    if (strlen($audio) < 1024) {
        send_json(400, ['message' => 'Nothing was heard in that recording.', 'code' => 'empty_recording']);
    }

    $extension = match ($contentType) {
        'audio/ogg' => 'ogg',
        'audio/mp4' => 'mp4',
        'audio/mpeg' => 'mp3',
        'audio/wav', 'audio/x-wav' => 'wav',
        default => 'webm',
    };

    // The bytes are never written to disk and never logged.
    $result = $transcription->transcribe($audio, $contentType, 'recording.' . $extension);
    unset($audio);

    if (!$result['ok']) {
        send_json($result['retryable'] ? 503 : 502, [
            'message' => $result['error'],
            'code' => 'transcription_failed',
            'retryable' => $result['retryable'],
        ]);
    }

    send_json(200, ['text' => $result['text']]);
}

send_json(404, ['message' => 'Not found.']);
