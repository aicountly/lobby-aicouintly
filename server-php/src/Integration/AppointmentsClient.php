<?php

declare(strict_types=1);

namespace Aicountly\Api\Integration;

use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Json;

/**
 * Booking, asked of the application that owns it.
 *
 * Aicountly Appointments owns appointment types, availability, holds and
 * bookings, and reaches Aicountly Calendar itself. Lobby asks over HTTP at the
 * moment it needs an answer and keeps nothing: no mirrored appointment table,
 * no cached slot list, no calendar credential. The only appointment data that
 * survives a request here is the reference Appointments hands back, shown once
 * to the visitor who made the booking.
 *
 * ## Why this is server-side
 *
 * The call is authenticated with this product's service key for Appointments.
 * Every `VITE_*` value is inlined into the browser bundle at build time and is
 * public, so the key can only live in the server's `.env` and the browser can
 * only ever be given a path on this API.
 *
 * ## The rule about retrying
 *
 * A `POST` that fails at the transport layer is **uncertain**: the booking may
 * have been created and the answer lost. Sending it again blind would give one
 * visitor two appointments and the practice a double-booked hour.
 *
 * Appointments implements `Idempotency-Key` with a stored replay
 * (`appointment_idempotency_keys`, and `Idempotency::replay()` at the top of
 * `BookingsController::create`). So re-sending with the **same** key is not a
 * retry — it is the status check: if the first attempt landed, the second
 * returns that same booking rather than making another.
 *
 * That is the entire justification for the one re-send below, and it holds only
 * for as long as Appointments keeps that behaviour. If a second attempt is
 * still uncertain, this reports uncertain. It never reports success it did not
 * receive, and it never invents a reference.
 */
final class AppointmentsClient
{
    /** Short, because a visitor is watching a spinner. */
    private const CONNECT_TIMEOUT = 3;

    private const READ_TIMEOUT = 10;

    private const WRITE_TIMEOUT = 20;

    private const MAX_RESPONSE_BYTES = 512 * 1024;

    public function __construct(
        /** Which company in Appointments this tenant is. A reference, not a copy of the company. */
        private readonly int $companyId,
        private readonly int $locationId = 0,
    ) {
    }

    public static function baseUrl(): string
    {
        return rtrim(Env::get('LOBBY_APPOINTMENTS_API_BASE'), '/');
    }

    private static function serviceKey(): string
    {
        return Env::get('LOBBY_APPOINTMENTS_SERVICE_KEY');
    }

    /**
     * Is this callable at all?
     *
     * Configured, not proven. Whether Appointments actually answers is only
     * knowable by asking it, and every method below reports that separately.
     */
    public function configured(): bool
    {
        return self::baseUrl() !== '' && self::serviceKey() !== '' && $this->companyId > 0;
    }

    /** Which piece is missing — operator detail, never shown to a visitor. */
    public function unconfiguredReason(): string
    {
        if (self::baseUrl() === '') {
            return 'LOBBY_APPOINTMENTS_API_BASE is unset in the API .env.';
        }
        if (self::serviceKey() === '') {
            return 'LOBBY_APPOINTMENTS_SERVICE_KEY is unset in the API .env. Appointments issues it; it is not a Console credential.';
        }
        if ($this->companyId <= 0) {
            return 'No Appointments company is set for this tenant. Set it under Business setup → Visitor services.';
        }

        return '';
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /**
     * The appointment types a visitor may book.
     *
     * @return array{ok: bool, services: array<int, array<string, mixed>>, error: string, retryable: bool}
     */
    public function services(): array
    {
        $result = $this->get('v1/services', ['is_active' => '1']);
        if (!$result['ok']) {
            return ['ok' => false, 'services' => [], 'error' => $result['error'], 'retryable' => $result['retryable']];
        }

        $services = [];
        foreach ($result['data']['services'] ?? [] as $service) {
            if (!is_array($service)) {
                continue;
            }
            $uuid = Json::string($service['service_uuid'] ?? '');
            if ($uuid === '') {
                continue;
            }
            $services[] = [
                'id' => $uuid,
                'label' => Json::text($service['name'] ?? '', 120),
                'description' => Json::text($service['description'] ?? '', 400),
                'durationMinutes' => (int) ($service['duration_minutes'] ?? 0),
                // Surfaced so the interface can refuse rather than take a
                // booking that Appointments will reject for want of a deposit
                // in a deployment with no Pay.
                'depositRequired' => (bool) ($service['deposit_required'] ?? false),
            ];
        }

        return ['ok' => true, 'services' => $services, 'error' => '', 'retryable' => false];
    }

    /**
     * Free slots for one appointment type on one day.
     *
     * Appointments answers 503 rather than an empty list when the calendar is
     * what failed, precisely so a caller cannot read "we could not look" as
     * "nothing is free". That distinction is preserved here.
     *
     * @return array{ok: bool, slots: array<int, array<string, mixed>>, error: string, retryable: bool}
     */
    public function slots(string $serviceUuid, string $fromIso, string $toIso): array
    {
        $result = $this->get('v1/availability/slots', array_filter([
            'service_uuid' => $serviceUuid,
            'from' => $fromIso,
            'to' => $toIso,
            'location_bo_id' => $this->locationId > 0 ? (string) $this->locationId : '',
            'limit' => '60',
        ]));

        if (!$result['ok']) {
            return ['ok' => false, 'slots' => [], 'error' => $result['error'], 'retryable' => $result['retryable']];
        }

        $slots = [];
        foreach ($result['data']['slots'] ?? [] as $slot) {
            if (!is_array($slot)) {
                continue;
            }
            $startsAt = Json::string($slot['starts_at'] ?? '');
            if ($startsAt === '') {
                continue;
            }
            $slots[] = [
                // The start time is the identifier, because that is what the
                // booking call takes. Inventing a local slot id would mean
                // keeping a table to translate it back.
                'id' => $startsAt,
                'startsAt' => $startsAt,
                'endsAt' => Json::string($slot['ends_at'] ?? ''),
                'label' => Json::text($slot['label'] ?? '', 60),
                'memberUuid' => Json::string($slot['member_uuid'] ?? ''),
            ];
        }

        return ['ok' => true, 'slots' => $slots, 'error' => '', 'retryable' => false];
    }

    // -----------------------------------------------------------------------
    // The write
    // -----------------------------------------------------------------------

    /**
     * Make a booking, or say honestly that it is not known whether one was made.
     *
     * Four outcomes, and the interface must render them as four different
     * things:
     *
     *   ok           Appointments created it and named it.
     *   refused      Appointments declined, with a reason a visitor can act on
     *                (the slot went, the notice period, a deposit is needed).
     *   uncertain    Two attempts, still no answer. Something may exist.
     *   unavailable  Not configured, or Appointments could not be reached at all.
     *
     * `uncertain` is the one that matters. It exists so that nothing anywhere
     * has to guess, and so the visitor is told to check rather than shown a
     * confirmation for an appointment that may not exist.
     *
     * @param array<string, mixed> $request
     * @return array{outcome: string, booking: array<string, mixed>, error: string, code: string}
     */
    public function book(array $request, string $idempotencyKey): array
    {
        if (!$this->configured()) {
            return ['outcome' => 'unavailable', 'booking' => [], 'error' => 'Booking is not connected for this deployment.', 'code' => 'not_configured'];
        }

        $payload = array_filter([
            'cmp_id' => $this->companyId,
            'bo_id' => $this->locationId > 0 ? $this->locationId : null,
            'service_uuid' => Json::string($request['serviceId'] ?? ''),
            'starts_at' => Json::string($request['startsAt'] ?? ''),
            'member_uuid' => Json::string($request['memberUuid'] ?? '') ?: null,
            'contact' => [
                'name' => Json::text($request['name'] ?? '', 120),
                'email' => Json::text($request['email'] ?? '', 160),
                'phone' => Json::text($request['phone'] ?? '', 40),
            ],
            'notes' => Json::text($request['notes'] ?? '', 400),
        ], static fn ($v): bool => $v !== null);

        $first = $this->post('v1/bookings', $payload, $idempotencyKey);

        if ($first['uncertain']) {
            // The same key, deliberately. See the class docblock: Appointments
            // replays a stored result for a key it has already seen, so this
            // asks "did the first one land?" rather than asking for a second
            // booking.
            $second = $this->post('v1/bookings', $payload, $idempotencyKey);

            if ($second['uncertain']) {
                return [
                    'outcome' => 'uncertain',
                    'booking' => [],
                    'error' => 'We could not confirm whether that appointment was made. Please check before booking again.',
                    'code' => 'uncertain',
                ];
            }

            $first = $second;
        }

        if (!$first['ok']) {
            return [
                'outcome' => $first['retryable'] ? 'unavailable' : 'refused',
                'booking' => [],
                'error' => $first['error'],
                'code' => $first['code'],
            ];
        }

        $booking = is_array($first['data']['booking'] ?? null) ? $first['data']['booking'] : [];
        $reference = Json::string($booking['reference'] ?? ($booking['booking_uuid'] ?? ''));

        if ($reference === '') {
            // A 2xx with nothing identifying it is not a confirmation. Reported
            // as uncertain rather than shown as success with a blank reference.
            return [
                'outcome' => 'uncertain',
                'booking' => [],
                'error' => 'The booking system answered without a reference, so we cannot confirm it.',
                'code' => 'no_reference',
            ];
        }

        return [
            'outcome' => 'ok',
            'booking' => [
                'reference' => $reference,
                'serviceLabel' => Json::text($booking['service_name'] ?? '', 120),
                'startsAt' => Json::string($booking['starts_at'] ?? ''),
                'status' => Json::string($booking['status'] ?? ''),
            ],
            'error' => '',
            'code' => '',
        ];
    }

    /**
     * A stable key for one visitor's one booking attempt.
     *
     * Derived from what is being booked, so pressing the button twice is one
     * booking, and booking a genuinely different slot is a different key. It is
     * hashed because the conversation id goes into it and that identifies a
     * visitor's session to another product.
     */
    public static function idempotencyKey(string $conversationId, string $serviceUuid, string $startsAt): string
    {
        return 'lobby-' . substr(hash('sha256', $conversationId . '|' . $serviceUuid . '|' . $startsAt), 0, 40);
    }

    // -----------------------------------------------------------------------
    // Transport
    // -----------------------------------------------------------------------

    /**
     * @param array<string, string> $query
     * @return array{ok: bool, data: array<string, mixed>, error: string, retryable: bool, code: string}
     */
    private function get(string $path, array $query = []): array
    {
        if (!$this->configured()) {
            return ['ok' => false, 'data' => [], 'error' => 'Booking is not connected for this deployment.', 'retryable' => false, 'code' => 'not_configured'];
        }

        $query['cmp_id'] = (string) $this->companyId;
        $url = self::baseUrl() . '/' . ltrim($path, '/') . '?' . http_build_query($query);

        $response = Http::to($url)
            ->header('Accept', 'application/json')
            ->header('X-Service-Key', self::serviceKey())
            ->header('X-Source-App', 'lobby')
            ->timeouts(self::CONNECT_TIMEOUT, self::READ_TIMEOUT)
            ->maxResponseBytes(self::MAX_RESPONSE_BYTES)
            ->send('GET');

        return self::interpret($response);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{ok: bool, data: array<string, mixed>, error: string, retryable: bool, code: string, uncertain: bool}
     */
    private function post(string $path, array $payload, string $idempotencyKey): array
    {
        $url = self::baseUrl() . '/' . ltrim($path, '/');

        $response = Http::to($url)
            ->header('Accept', 'application/json')
            ->header('Content-Type', 'application/json')
            ->header('X-Service-Key', self::serviceKey())
            ->header('X-Source-App', 'lobby')
            ->header('Idempotency-Key', $idempotencyKey)
            ->timeouts(self::CONNECT_TIMEOUT, self::WRITE_TIMEOUT)
            ->maxResponseBytes(self::MAX_RESPONSE_BYTES)
            ->send('POST', (string) json_encode($payload, JSON_UNESCAPED_SLASHES));

        $interpreted = self::interpret($response);

        // Status 0 is a transport failure: the request may have been received
        // and processed. 5xx and 429 are answers — Appointments decided — so
        // they are failures rather than unknowns.
        $interpreted['uncertain'] = $response['status'] === 0;

        return $interpreted;
    }

    /**
     * Turn one HTTP answer into something domain code can branch on.
     *
     * Appointments' own error codes are preserved (`slot_taken`,
     * `calendar_unavailable`, `mode_not_offered`) because they are what tells a
     * visitor whether to pick another time or come back later.
     *
     * @param array{ok: bool, status: int, body: string, contentType: string, error: string} $response
     * @return array{ok: bool, data: array<string, mixed>, error: string, retryable: bool, code: string, uncertain: bool}
     */
    private static function interpret(array $response): array
    {
        if ($response['status'] === 0) {
            return [
                'ok' => false,
                'data' => [],
                'error' => 'The booking system could not be reached.',
                'retryable' => true,
                'code' => 'appointments_unreachable',
                'uncertain' => false,
            ];
        }

        $decoded = Json::decode($response['body']) ?? [];

        if ($response['ok']) {
            $data = is_array($decoded['data'] ?? null) ? $decoded['data'] : $decoded;

            return ['ok' => true, 'data' => $data, 'error' => '', 'retryable' => false, 'code' => '', 'uncertain' => false];
        }

        $code = Json::string($decoded['code'] ?? ($decoded['error'] ?? ''));
        $message = Json::text($decoded['message'] ?? ($decoded['reason'] ?? ''), 300);

        return [
            'ok' => false,
            'data' => [],
            'error' => $message !== '' ? $message : 'The booking system refused that request.',
            // 5xx and 429 are worth trying again; a 4xx is the visitor's
            // request being wrong and will be wrong again.
            'retryable' => $response['status'] >= 500 || $response['status'] === 429,
            'code' => $code !== '' ? $code : 'appointments_error',
            'uncertain' => false,
        ];
    }
}
