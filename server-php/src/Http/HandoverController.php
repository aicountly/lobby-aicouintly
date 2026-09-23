<?php

declare(strict_types=1);

namespace Aicountly\Api\Http;

use Aicountly\Api\Desk\Presence;
use Aicountly\Api\Desk\Queue;
use Aicountly\Api\Json;
use Aicountly\Api\Knowledge;
use Aicountly\Api\VisitorSession;

/**
 * The visitor's half of "can I speak to a person?".
 *
 * Everything here is keyed by the conversation id inside the visitor's signed
 * session. A visitor therefore reaches exactly one entry — their own — without
 * ever being handed an identifier, which means there is nothing to guess,
 * enumerate or pass to somebody else. There is deliberately no route that takes
 * a queue id from the request.
 *
 * The honest-answer rule applies hardest here. A visitor who asks for a person
 * is told one of three true things: you are in the queue and this many people
 * are ahead of you; somebody is coming; or nobody is available, and here is
 * what to do instead. There is no fourth branch that queues them quietly so the
 * interface has something reassuring to show.
 */
final class HandoverController
{
    public function __construct(
        private readonly Queue $queue,
        private readonly Presence $presence,
        private readonly Knowledge $knowledge,
        private readonly VisitorSession $session,
    ) {
    }

    /**
     * Ask for a person.
     *
     * @param array<string, mixed> $body
     * @return array{status: int, body: array<string, mixed>}
     */
    public function request(array $body): array
    {
        $journeys = $this->knowledge->journeys();
        $tenant = $this->session->tenantId;

        if (!$journeys['handover']) {
            return [
                'status' => 503,
                'body' => [
                    'message' => 'This business does not offer handover to a person from reception.',
                    'code' => 'handover_disabled',
                    'state' => null,
                ],
            ];
        }

        $staffed = $this->presence->staffed($tenant, true);

        $result = $this->queue->request(
            $tenant,
            $this->session->conversationId,
            Json::text($body['name'] ?? '', Queue::MAX_NAME_CHARS),
            Json::text($body['reason'] ?? '', Queue::MAX_REASON_CHARS),
            $staffed,
        );

        if (!$result['ok']) {
            return [
                'status' => 503,
                'body' => [
                    // The visitor is told the request was not recorded, because
                    // it was not. Telling them somebody is coming when nothing
                    // was written is the failure this whole product is shaped
                    // around avoiding.
                    'message' => 'That could not be recorded, so nobody has been alerted. Please try again.',
                    'code' => $result['code'],
                    'state' => null,
                ],
            ];
        }

        return ['status' => 200, 'body' => self::view($result['entry'], $staffed)];
    }

    /**
     * Where am I in the queue?
     *
     * @return array{status: int, body: array<string, mixed>}
     */
    public function show(): array
    {
        $tenant = $this->session->tenantId;
        $entry = $this->queue->forVisitor($tenant, $this->session->conversationId);

        if ($entry === null) {
            return ['status' => 200, 'body' => ['state' => null, 'message' => '', 'staffed' => $this->presence->staffed($tenant, $this->knowledge->journeys()['handover'])]];
        }

        return ['status' => 200, 'body' => self::view($entry, $this->presence->staffed($tenant, true))];
    }

    /** The visitor gave up or is leaving. */
    public function cancel(): array
    {
        $this->queue->abandon($this->session->tenantId, $this->session->conversationId);

        return ['status' => 200, 'body' => ['state' => null, 'message' => 'Cancelled.']];
    }

    /**
     * One entry, as the visitor is allowed to see it, with the sentence that
     * goes with each state.
     *
     * @param array<string, mixed> $entry
     * @return array<string, mixed>
     */
    private static function view(array $entry, bool $staffed): array
    {
        $state = (string) ($entry['state'] ?? '');
        $ahead = (int) ($entry['ahead'] ?? 0);

        $message = match ($state) {
            Queue::QUEUED => $ahead === 0
                ? 'You are next. Someone will be with you shortly.'
                : ($ahead === 1
                    ? 'There is one person ahead of you.'
                    : 'There are ' . $ahead . ' people ahead of you.'),
            Queue::ASSIGNED, Queue::ACCEPTED => 'Someone is with you now.',
            Queue::RESOLVED => 'That conversation has finished.',
            Queue::ABANDONED => 'That request was closed.',
            // `requested` is the state that exists precisely so this sentence
            // can be true: the request is recorded, and nobody is there.
            Queue::REQUESTED => 'Nobody is at the desk right now, so your request has been noted but not queued. Leave an enquiry and someone will follow it up.',
            default => '',
        };

        return [
            'state' => $state,
            'ahead' => $ahead,
            'withSomeone' => (bool) ($entry['withSomeone'] ?? false),
            'staffed' => $staffed,
            'message' => $message,
        ];
    }
}
