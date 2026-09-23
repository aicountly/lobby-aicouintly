<?php

declare(strict_types=1);

namespace Aicountly\Api\Http;

use Aicountly\Api\Integration\AppointmentsClient;
use Aicountly\Api\Json;
use Aicountly\Api\Knowledge;
use Aicountly\Api\VisitorSession;

/**
 * The booking journey, relayed to the application that owns it.
 *
 * Lobby holds no appointment data and has no calendar credential. Every method
 * here asks Appointments and shows what came back, and none of them writes
 * anything locally — not a cached slot list, not a copy of the booking, not
 * even a note that one was made. The reference Appointments returns is shown
 * to the visitor who made it and then forgotten.
 *
 * The confirmation rule is the whole point of this file. A booking is
 * confirmed **only** when Appointments says so and names it. Everything else —
 * a refusal, an unreachable service, and above all an uncertain outcome — is
 * rendered as what it is. The receptionist's own reply can never make a
 * booking exist: the model may offer this journey, and the journey is what
 * talks to Appointments.
 */
final class BookingController
{
    public function __construct(
        private readonly Knowledge $knowledge,
        private readonly VisitorSession $session,
    ) {
    }

    /**
     * The client for this tenant, built from its published configuration.
     *
     * The company id is a reference stored in the tenant's own configuration;
     * the service key is in the server's `.env`. Neither reaches the browser.
     */
    private function client(): AppointmentsClient
    {
        $booking = $this->knowledge->booking();

        return new AppointmentsClient($booking['companyId'], $booking['locationId']);
    }

    /**
     * @return array{status: int, body: array<string, mixed>}|null
     */
    private function refuseIfDisabled(): ?array
    {
        if (!$this->knowledge->journeys()['booking']) {
            return [
                'status' => 503,
                'body' => [
                    'message' => 'This business does not take appointments through reception.',
                    'code' => 'booking_disabled',
                ],
            ];
        }

        $client = $this->client();
        if (!$client->configured()) {
            return [
                'status' => 503,
                'body' => [
                    // The visitor is told it is not available. Which variable
                    // is unset is operator detail and stays on the server.
                    'message' => 'Booking is not available here at the moment.',
                    'code' => 'booking_unavailable',
                ],
            ];
        }

        return null;
    }

    /** @return array{status: int, body: array<string, mixed>} */
    public function services(): array
    {
        if ($refusal = $this->refuseIfDisabled()) {
            return $refusal;
        }

        $result = $this->client()->services();
        if (!$result['ok']) {
            return [
                'status' => $result['retryable'] ? 503 : 502,
                'body' => ['message' => $result['error'], 'code' => 'appointments_failed', 'retryable' => $result['retryable']],
            ];
        }

        return ['status' => 200, 'body' => ['services' => $result['services']]];
    }

    /**
     * @param array<string, string> $query
     * @return array{status: int, body: array<string, mixed>}
     */
    public function slots(array $query): array
    {
        if ($refusal = $this->refuseIfDisabled()) {
            return $refusal;
        }

        $serviceId = Json::text($query['service'] ?? '', 64);
        $date = Json::text($query['date'] ?? '', 10);

        if ($serviceId === '' || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            return ['status' => 400, 'body' => ['message' => 'Pick a service and a date.', 'code' => 'invalid_request']];
        }

        $result = $this->client()->slots($serviceId, $date . 'T00:00:00Z', $date . 'T23:59:59Z');
        if (!$result['ok']) {
            return [
                'status' => $result['retryable'] ? 503 : 502,
                'body' => [
                    // Appointments answers 503 for "the calendar could not be
                    // read" precisely so this is not shown as "no times free".
                    'message' => $result['error'],
                    'code' => 'appointments_failed',
                    'retryable' => $result['retryable'],
                ],
            ];
        }

        return ['status' => 200, 'body' => ['slots' => $result['slots'], 'date' => $date]];
    }

    /**
     * Ask Appointments to make the booking.
     *
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function book(array $body): array
    {
        if ($refusal = $this->refuseIfDisabled()) {
            return $refusal;
        }

        $serviceId = Json::text($body['serviceId'] ?? '', 64);
        $startsAt = Json::text($body['startsAt'] ?? '', 40);
        $name = Json::text($body['name'] ?? '', 120);
        $email = Json::text($body['email'] ?? '', 160);

        if ($serviceId === '' || $startsAt === '' || $name === '' || $email === '') {
            return [
                'status' => 400,
                'body' => ['message' => 'A service, a time, a name and an email address are all needed.', 'code' => 'invalid_request'],
            ];
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['status' => 400, 'body' => ['message' => 'That email address does not look right.', 'code' => 'invalid_email']];
        }

        $result = $this->client()->book(
            [
                'serviceId' => $serviceId,
                'startsAt' => $startsAt,
                'memberUuid' => Json::text($body['memberUuid'] ?? '', 64),
                'name' => $name,
                'email' => $email,
                'phone' => Json::text($body['phone'] ?? '', 40),
                'notes' => Json::text($body['notes'] ?? '', 400),
            ],
            // Keyed on this visitor's conversation, so pressing the button
            // twice is one appointment, and a genuinely different slot is a
            // different key.
            AppointmentsClient::idempotencyKey($this->session->conversationId, $serviceId, $startsAt),
        );

        return match ($result['outcome']) {
            'ok' => [
                'status' => 201,
                'body' => [
                    'confirmed' => true,
                    'booking' => $result['booking'],
                    // Never `demo`. This branch is only reached when
                    // Appointments created something and named it.
                    'demo' => false,
                ],
            ],
            // Deliberately not 5xx: nothing is broken, and a client that
            // retried on a 5xx would be retrying a request that was correctly
            // refused.
            'refused' => [
                'status' => 409,
                'body' => ['confirmed' => false, 'message' => $result['error'], 'code' => $result['code']],
            ],
            'uncertain' => [
                'status' => 502,
                'body' => [
                    'confirmed' => false,
                    'uncertain' => true,
                    'message' => $result['error'],
                    'code' => $result['code'],
                    // The interface must not offer a retry button here. Two
                    // attempts have already been made with the same
                    // idempotency key; a third is not more information.
                    'retryable' => false,
                ],
            ],
            default => [
                'status' => 503,
                'body' => ['confirmed' => false, 'message' => $result['error'], 'code' => $result['code'], 'retryable' => true],
            ],
        };
    }
}
