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
 *   GET  /api/lobby/booking/services availability types, from Appointments
 *   GET  /api/lobby/booking/slots    free times, from Appointments
 *   POST /api/lobby/booking          ask Appointments to make a booking
 *   GET  /api/lobby/handover         where this visitor is in the queue
 *   POST /api/lobby/handover         ask to speak to a person
 *   POST /api/lobby/handover/cancel  withdraw that request
 *
 * Staff and administration, all behind a portal session and a role:
 *   GET  /api/desk/session           who the caller is and what they may do
 *   GET  /api/desk/queue             who is waiting
 *   POST /api/desk/queue/{id}/{act}  claim | accept | release | resolve
 *   GET  /api/admin/config           the draft and what is published
 *   PUT  /api/admin/config           save the draft
 *   POST /api/admin/config/publish   make the draft live
 *   POST /api/admin/config/discard   throw the draft away
 *   GET  /api/admin/staff            who has access here
 *   PUT  /api/admin/staff            change who has access here
 *   GET  /api/admin/diagnostics      what is configured, for an operator
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
require __DIR__ . '/src/Store/Repository.php';
require __DIR__ . '/src/Store/Record.php';
require __DIR__ . '/src/Store/StoreException.php';
require __DIR__ . '/src/Store/FileRepository.php';
require __DIR__ . '/src/Config/Schema.php';
require __DIR__ . '/src/Config/ConfigStore.php';
require __DIR__ . '/src/Knowledge.php';
require __DIR__ . '/src/Access/Role.php';
require __DIR__ . '/src/Access/StaffSession.php';
require __DIR__ . '/src/Desk/Queue.php';
require __DIR__ . '/src/Desk/Presence.php';
require __DIR__ . '/src/Http/AdminController.php';
require __DIR__ . '/src/Http/DeskController.php';
require __DIR__ . '/src/Integration/AppointmentsClient.php';
require __DIR__ . '/src/Http/BookingController.php';
require __DIR__ . '/src/Http/HandoverController.php';
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
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Max-Age: 600');
    header('Vary: Origin');
}

/**
 * One repository per request.
 *
 * Shared so that the actor recorded on a write is set once, and so a request
 * that touches the queue and the configuration does not build two views of the
 * same directory.
 */
function repository(): Store\FileRepository
{
    static $repository = null;

    return $repository ??= new Store\FileRepository();
}

function config_store(): Config\ConfigStore
{
    static $store = null;

    return $store ??= new Config\ConfigStore(repository());
}

/**
 * The member of staff making this request, or a refusal.
 *
 * Reads the portal bearer token and nothing else. A visitor session token is
 * not consulted here and must never be: it is issued to anonymous members of
 * the public, and an exchange path from one to the other would put every
 * tenant's queue and unpublished configuration behind a credential anybody can
 * mint by loading a page.
 *
 * Signed out is 401 and is fixed by signing in. Signed in with no role here is
 * 403 and is fixed by an owner granting access. Conflating them sends people
 * to re-enter a password that was never the problem.
 */
function require_staff(): Access\StaffSession
{
    $session = Access\StaffSession::fromRequest(repository(), bearer_token());

    if ($session === null) {
        send_json(401, [
            'message' => 'Sign in to use the reception desk.',
            'code' => 'sign_in_required',
        ]);
    }

    // Recorded on every write this request makes, so a configuration change
    // carries the uuid of whoever made it.
    Store\FileRepository::actingAs($session->uuid);

    return $session;
}

/**
 * Read a JSON body or stop with the reason.
 *
 * @return array<string, mixed>
 */
function read_json_body(): array
{
    $read = Json::readBody();
    if (!$read['ok']) {
        send_json($read['status'], ['message' => $read['message']]);
    }

    return $read['data'];
}

/** @param array{status: int, body: array<string, mixed>} $result */
function send_result(array $result): never
{
    send_json($result['status'], $result['body']);
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

    send_json(200, Capabilities::report(VisitorSession::resolveTenant(), $operator));
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
        'capabilities' => Capabilities::report(VisitorSession::resolveTenant(), false),
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

    $reception = new Reception($provider, Knowledge::forTenant($session->tenantId, config_store()));
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

// ---------------------------------------------------------------------------
// Booking — relayed to Aicountly Appointments
//
// Relayed rather than called from the browser because the call is
// authenticated with this product's service key for Appointments, and every
// VITE_* value is inlined into the bundle at build time. Lobby keeps nothing
// that comes back.
// ---------------------------------------------------------------------------

if ($path === 'lobby/booking' || strpos($path, 'lobby/booking/') === 0) {
    $session = require_visitor_session();
    $controller = new Http\BookingController(
        Knowledge::forTenant($session->tenantId, config_store()),
        $session,
    );

    if ($path === 'lobby/booking/services') {
        if ($method !== 'GET') {
            send_json(405, ['message' => 'Use GET.']);
        }
        send_result($controller->services());
    }

    if ($path === 'lobby/booking/slots') {
        if ($method !== 'GET') {
            send_json(405, ['message' => 'Use GET.']);
        }
        send_result($controller->slots([
            'service' => (string) ($_GET['service'] ?? ''),
            'date' => (string) ($_GET['date'] ?? ''),
        ]));
    }

    if ($path === 'lobby/booking') {
        if ($method !== 'POST') {
            send_json(405, ['message' => 'Use POST.']);
        }

        // Tighter than the reception limit: this one reaches another product
        // and can create a record there.
        enforce_limit(
            'booking:session:' . $session->conversationId,
            (int) Env::get('LOBBY_BOOKING_LIMIT_PER_HOUR', '10'),
            3600,
            'You have made several booking attempts. Give it a moment.',
        );
        enforce_limit(
            'booking:ip:' . RateLimit::clientIp(),
            (int) Env::get('LOBBY_BOOKING_LIMIT_PER_DAY', '40'),
            86400,
            'Too many booking attempts from this address.',
        );

        send_result($controller->book(read_json_body()));
    }

    send_json(404, ['message' => 'Not found.']);
}

// ---------------------------------------------------------------------------
// Handover — the visitor asking for a person
//
// Keyed by the conversation id inside the signed visitor session, so a visitor
// reaches their own entry and no other, and never holds an identifier that
// could be guessed or shared.
// ---------------------------------------------------------------------------

if ($path === 'lobby/handover' || $path === 'lobby/handover/cancel') {
    $session = require_visitor_session();
    $queue = new Desk\Queue(repository());
    $controller = new Http\HandoverController(
        $queue,
        new Desk\Presence(repository()),
        Knowledge::forTenant($session->tenantId, config_store()),
        $session,
    );

    if ($path === 'lobby/handover/cancel') {
        if ($method !== 'POST') {
            send_json(405, ['message' => 'Use POST.']);
        }
        send_result($controller->cancel());
    }

    if ($method === 'GET') {
        send_result($controller->show());
    }

    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use GET or POST.']);
    }

    // Asking for a person is cheap for the visitor and expensive for the desk,
    // so it is limited per session as well as per address.
    enforce_limit(
        'handover:session:' . $session->conversationId,
        (int) Env::get('LOBBY_HANDOVER_LIMIT_PER_MINUTE', '6'),
        60,
        'You have asked for a person a few times already. Give it a moment.',
    );
    enforce_limit(
        'handover:ip:' . RateLimit::clientIp(),
        (int) Env::get('LOBBY_HANDOVER_LIMIT_PER_HOUR', '60'),
        3600,
        'Too many handover requests from this address.',
    );

    send_result($controller->request(read_json_body()));
}

// ---------------------------------------------------------------------------
// The staff reception desk
// ---------------------------------------------------------------------------

if ($path === 'desk/session') {
    $staff = require_staff();

    send_json(200, [
        'staff' => $staff->toArray(),
        // Told plainly rather than inferred from an empty queue: a person who
        // has not been given access should see that, not a desk that looks
        // like a quiet day.
        'hasAccess' => $staff->isStaff(),
        'onDuty' => (new Desk\Presence(repository()))->available($staff->tenant),
    ]);
}

if ($path === 'desk/queue') {
    $staff = require_staff();
    if ($method !== 'GET') {
        send_json(405, ['message' => 'Use GET.']);
    }

    // Loading the queue is what makes this member of staff count as present.
    // Availability shown to a visitor is therefore an observation, never a
    // setting somebody left switched on.
    if ($staff->can(Access\Role::VIEW_DESK)) {
        (new Desk\Presence(repository()))->beat($staff->tenant, $staff->uuid);
    }

    send_result((new Http\DeskController(new Desk\Queue(repository()), $staff))->index());
}

if (strpos($path, 'desk/queue/') === 0) {
    $staff = require_staff();
    if ($method !== 'POST') {
        send_json(405, ['message' => 'Use POST.']);
    }

    $segments = explode('/', substr($path, strlen('desk/queue/')));
    if (count($segments) !== 2 || $segments[0] === '' || $segments[1] === '') {
        send_json(404, ['message' => 'Not found.']);
    }

    send_result(
        (new Http\DeskController(new Desk\Queue(repository()), $staff))
            ->act($segments[0], $segments[1], read_json_body()),
    );
}

// ---------------------------------------------------------------------------
// Business setup
// ---------------------------------------------------------------------------

if ($path === 'admin/config' || strpos($path, 'admin/config/') === 0 || $path === 'admin/staff') {
    $staff = require_staff();
    $controller = new Http\AdminController(repository(), config_store(), $staff);

    if ($path === 'admin/config') {
        send_result(match ($method) {
            'GET' => $controller->showConfig(),
            'PUT', 'POST' => $controller->saveDraft(read_json_body()),
            default => ['status' => 405, 'body' => ['message' => 'Use GET or PUT.']],
        });
    }

    if ($path === 'admin/config/publish') {
        if ($method !== 'POST') {
            send_json(405, ['message' => 'Use POST.']);
        }
        send_result($controller->publish(read_json_body()));
    }

    if ($path === 'admin/config/discard') {
        if ($method !== 'POST') {
            send_json(405, ['message' => 'Use POST.']);
        }
        send_result($controller->discardDraft());
    }

    if ($path === 'admin/staff') {
        send_result(match ($method) {
            'GET' => $controller->showStaff(),
            'PUT', 'POST' => $controller->saveStaff(read_json_body()),
            default => ['status' => 405, 'body' => ['message' => 'Use GET or PUT.']],
        });
    }

    send_json(404, ['message' => 'Not found.']);
}

if ($path === 'admin/diagnostics') {
    $staff = require_staff();
    if (!$staff->can(Access\Role::VIEW_CONFIG)) {
        send_json(403, ['message' => 'Your role does not allow that.', 'code' => 'forbidden']);
    }

    // The full operator report, including which variable is unset. Behind a
    // role rather than merely behind a portal session: a list of a server's
    // configuration gaps is reconnaissance, and every signed-in portal user on
    // the fleet is a much larger audience than this tenant's administrators.
    send_json(200, Capabilities::report($staff->tenant, true));
}

send_json(404, ['message' => 'Not found.']);
