<?php

declare(strict_types=1);

/**
 * CLI only — it is started by the test suite with `php -S`.
 *
 * Under any other SAPI this file is a URL in a deployed document root, and one
 * that accepts a service key and writes a state file. It is a test fixture and
 * has no business answering a request from the internet.
 */
if (PHP_SAPI !== 'cli' && PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

/**
 * A stand-in for Aicountly Appointments, for the booking tests.
 *
 *   php -S 127.0.0.1:<port> server-php/tests/fixtures/fake-appointments.php
 *
 * It exists because the behaviour worth pinning is about HTTP: which header a
 * retry carries, and what the client concludes from a connection that dies
 * mid-request. A mocked client object cannot fail that way, so it cannot prove
 * the thing that matters.
 *
 * It imitates only the parts of the contract Lobby depends on, and the one that
 * matters most is the replay: a POST carrying an `Idempotency-Key` that has
 * been seen before returns the stored answer instead of creating a second
 * booking. That is the property that makes Lobby's single re-send a status
 * check rather than a blind retry, and if Appointments ever stopped honouring
 * it these tests are what should start failing.
 *
 * Scenarios are driven by the service key, so one server covers all of them:
 *
 *   ok           behaves
 *   refuse       409 slot_taken
 *   down         503 calendar_unavailable
 *   noref        201 with no reference in the body
 *   die-once     kills the connection on the first POST, then behaves
 *   die-always   kills the connection on every POST
 */

$stateFile = sys_get_temp_dir() . '/fake-appointments-state.json';

function state(string $file): array
{
    return is_readable($file) ? (array) json_decode((string) file_get_contents($file), true) : [];
}

function saveState(string $file, array $state): void
{
    file_put_contents($file, (string) json_encode($state));
}

function reply(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
    exit;
}

/** Kill the connection without a response, as a dropped upstream does. */
function die_mid_request(): never
{
    header('Content-Length: 4000');
    header('Content-Type: application/json');
    echo '{"par';
    // Flushing a partial body and exiting gives the client a truncated
    // response, which is what a real transport failure looks like from curl.
    flush();
    exit;
}

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$scenario = (string) ($_SERVER['HTTP_X_SERVICE_KEY'] ?? 'ok');
$state = state($stateFile);

// Every route requires the service key, exactly as Appointments does.
if ($scenario === '') {
    reply(401, ['code' => 'unauthorized', 'message' => 'No service key.']);
}

if ($path === '/__reset') {
    saveState($stateFile, []);
    reply(200, ['reset' => true]);
}

if ($path === '/__calls') {
    reply(200, ['calls' => $state['calls'] ?? []]);
}

if ($path === '/v1/services' && $method === 'GET') {
    reply(200, ['data' => ['services' => [
        ['service_uuid' => 'svc-1', 'name' => 'Initial consultation', 'description' => 'A first meeting.', 'duration_minutes' => 30, 'deposit_required' => false],
    ]]]);
}

if ($path === '/v1/availability/slots' && $method === 'GET') {
    if ($scenario === 'down') {
        reply(503, ['code' => 'calendar_unavailable', 'message' => 'The calendar could not be read.', 'retryable' => true]);
    }
    reply(200, ['data' => ['slots' => [
        ['starts_at' => '2026-10-01T09:00:00Z', 'ends_at' => '2026-10-01T09:30:00Z', 'label' => '09:00', 'member_uuid' => 'mem-1'],
        ['starts_at' => '2026-10-01T10:00:00Z', 'ends_at' => '2026-10-01T10:30:00Z', 'label' => '10:00', 'member_uuid' => 'mem-1'],
    ]]]);
}

if ($path === '/v1/bookings' && $method === 'POST') {
    $key = (string) ($_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '');

    // Record every attempt, so a test can assert what the second one carried.
    $state['calls'] = $state['calls'] ?? [];
    $state['calls'][] = ['key' => $key, 'at' => microtime(true)];
    saveState($stateFile, $state);

    if ($key === '') {
        reply(400, ['code' => 'idempotency_required', 'message' => 'An Idempotency-Key is required.']);
    }

    // THE REPLAY. A key already seen returns the stored answer rather than
    // creating a second booking.
    if (isset($state['bookings'][$key])) {
        reply(201, $state['bookings'][$key]);
    }

    if ($scenario === 'die-always') {
        die_mid_request();
    }

    if ($scenario === 'die-once' && !isset($state['died'][$key])) {
        $state['died'][$key] = true;
        saveState($stateFile, $state);
        die_mid_request();
    }

    if ($scenario === 'refuse') {
        reply(409, ['code' => 'slot_taken', 'message' => 'Somebody booked that time while you were deciding.']);
    }

    if ($scenario === 'down') {
        reply(503, ['code' => 'calendar_unavailable', 'message' => 'The calendar could not be read.']);
    }

    if ($scenario === 'noref') {
        reply(201, ['data' => ['booking' => ['status' => 'confirmed']]]);
    }

    $body = ['data' => ['booking' => [
        'booking_uuid' => 'bk-' . substr(hash('sha256', $key), 0, 8),
        'reference' => 'APT-' . strtoupper(substr(hash('sha256', $key), 0, 6)),
        'service_name' => 'Initial consultation',
        'starts_at' => '2026-10-01T09:00:00Z',
        'status' => 'confirmed',
    ]]];

    $state['bookings'][$key] = $body;
    saveState($stateFile, $state);

    reply(201, $body);
}

reply(404, ['code' => 'not_found', 'message' => 'No such route.']);
