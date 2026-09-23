<?php

declare(strict_types=1);

namespace Aicountly\Api\Config;

use Aicountly\Api\Json;

/**
 * What a tenant is allowed to configure, and what each field may contain.
 *
 * This is the write path from a browser form straight into the text a
 * receptionist says to the public, so it is a strict allowlist in both
 * directions: an unknown key is dropped rather than stored, and a known key is
 * bounded rather than trusted. Nothing here is rendered as HTML anywhere —
 * every value ends up as text in a prompt or as the text content of an
 * element — but the limits exist anyway, because "it is only ever used
 * somewhere safe" is a property of today's callers.
 *
 * ## What is deliberately absent
 *
 * There is no company master, no branch master, no contact, no appointment, no
 * invoice and no CRM record in this schema, and none may be added. Those belong
 * to Manage, Contacts, Appointments, Billing and CRM respectively, and Lobby
 * reads them live over their APIs. What a service entry holds is a *reference* —
 * `appointmentTypeId` names something Appointments owns — not a copy of it.
 *
 * The line is worth stating because it is the one that erodes quietly: a
 * cached service price here would be wrong the first week somebody changed it
 * in Appointments, and the receptionist would state the stale one confidently.
 */
final class Schema
{
    /** Ceilings, per field. Generous enough for real businesses, bounded enough to stay a prompt. */
    private const LIMITS = [
        'business.name' => 120,
        'business.tagline' => 160,
        'business.description' => 1200,
        'hours.days' => 60,
        'hours.opens' => 24,
        'hours.closes' => 24,
        'hours.note' => 160,
        'locations.label' => 80,
        'locations.address' => 240,
        'locations.notes' => 240,
        'services.name' => 100,
        'services.description' => 400,
        'services.fee' => 60,
        'services.appointmentTypeId' => 64,
        'contact.email' => 160,
        'contact.phone' => 60,
        'contact.routing' => 400,
        'faqs.question' => 240,
        'faqs.answer' => 1200,
        'handover.message' => 400,
        'receptionist.displayName' => 60,
        'receptionist.greeting' => 300,
        'receptionist.voiceId' => 80,
    ];

    /** How many entries each list may hold. A front desk that needs more needs a knowledge base. */
    private const MAX_ROWS = [
        'hours' => 14,
        'locations' => 12,
        'services' => 40,
        'faqs' => 60,
    ];

    /** The tones the persona may take. Free text here would be an instruction channel into the prompt. */
    public const TONES = ['professional', 'warm', 'concise', 'formal'];

    /** Where a spoken reply comes from. `server` requires the speech provider to be configured. */
    public const VOICE_MODES = ['browser', 'server'];

    /**
     * An empty configuration — the shape every consumer can rely on.
     *
     * Returned when a tenant has configured nothing, so callers never branch on
     * a missing key. A receptionist with this configuration says it does not
     * know, which is the correct thing for it to say.
     *
     * @return array<string, mixed>
     */
    public static function blank(): array
    {
        return [
            'business' => ['name' => '', 'tagline' => '', 'description' => ''],
            'hours' => [],
            'locations' => [],
            'services' => [],
            'contact' => ['email' => '', 'phone' => '', 'routing' => ''],
            'faqs' => [],
            'handover' => ['enabled' => false, 'message' => ''],
            'receptionist' => [
                'displayName' => '',
                'greeting' => '',
                'tone' => 'professional',
                'voice' => ['mode' => 'browser', 'voiceId' => '', 'rate' => 1.0],
            ],
            'visitorServices' => ['booking' => false, 'enquiry' => false, 'handover' => false],
        ];
    }

    /**
     * Validate and normalise a submitted configuration.
     *
     * Returns the cleaned document and a list of field errors. A document with
     * errors is never stored: a half-valid configuration is how a receptionist
     * ends up stating opening hours nobody typed.
     *
     * Empty input is valid and yields {@see blank()}. "Not configured" is a
     * legitimate state that has to be reachable — an administrator must be able
     * to clear a field they filled in by mistake.
     *
     * @param mixed $input
     * @return array{data: array<string, mixed>, errors: array<int, array{field: string, message: string}>}
     */
    public static function validate(mixed $input): array
    {
        $errors = [];
        $out = self::blank();
        $in = is_array($input) ? $input : [];

        // --- business ------------------------------------------------------
        $business = is_array($in['business'] ?? null) ? $in['business'] : [];
        foreach (['name', 'tagline', 'description'] as $field) {
            $out['business'][$field] = self::text($business[$field] ?? '', 'business.' . $field, $errors);
        }

        // --- hours ---------------------------------------------------------
        $out['hours'] = self::rows($in['hours'] ?? null, 'hours', ['days', 'opens', 'closes', 'note'], $errors, [
            // Days is what makes an entry mean anything; an entry without one
            // would render as a bare time range attached to nothing.
            'days',
        ]);

        // --- locations -----------------------------------------------------
        $out['locations'] = self::rows($in['locations'] ?? null, 'locations', ['label', 'address', 'notes'], $errors, ['label']);

        // --- services ------------------------------------------------------
        $out['services'] = self::rows(
            $in['services'] ?? null,
            'services',
            ['name', 'description', 'fee', 'appointmentTypeId'],
            $errors,
            ['name'],
        );

        // --- contact -------------------------------------------------------
        $contact = is_array($in['contact'] ?? null) ? $in['contact'] : [];
        $out['contact']['email'] = self::text($contact['email'] ?? '', 'contact.email', $errors);
        $out['contact']['phone'] = self::text($contact['phone'] ?? '', 'contact.phone', $errors);
        $out['contact']['routing'] = self::text($contact['routing'] ?? '', 'contact.routing', $errors);

        if ($out['contact']['email'] !== '' && !filter_var($out['contact']['email'], FILTER_VALIDATE_EMAIL)) {
            $errors[] = ['field' => 'contact.email', 'message' => 'That is not a valid email address.'];
        }

        // --- faqs ----------------------------------------------------------
        $faqs = self::rows($in['faqs'] ?? null, 'faqs', ['question', 'answer'], $errors, ['question', 'answer']);
        $out['faqs'] = $faqs;

        // --- handover ------------------------------------------------------
        $handover = is_array($in['handover'] ?? null) ? $in['handover'] : [];
        $out['handover']['enabled'] = (bool) ($handover['enabled'] ?? false);
        $out['handover']['message'] = self::text($handover['message'] ?? '', 'handover.message', $errors);

        // --- receptionist --------------------------------------------------
        $persona = is_array($in['receptionist'] ?? null) ? $in['receptionist'] : [];
        $out['receptionist']['displayName'] = self::text($persona['displayName'] ?? '', 'receptionist.displayName', $errors);
        $out['receptionist']['greeting'] = self::text($persona['greeting'] ?? '', 'receptionist.greeting', $errors);

        $tone = strtolower(Json::string($persona['tone'] ?? ''));
        if ($tone !== '' && !in_array($tone, self::TONES, true)) {
            $errors[] = ['field' => 'receptionist.tone', 'message' => 'Choose one of: ' . implode(', ', self::TONES) . '.'];
            $tone = '';
        }
        $out['receptionist']['tone'] = $tone !== '' ? $tone : 'professional';

        $voice = is_array($persona['voice'] ?? null) ? $persona['voice'] : [];
        $mode = strtolower(Json::string($voice['mode'] ?? ''));
        if ($mode !== '' && !in_array($mode, self::VOICE_MODES, true)) {
            $errors[] = ['field' => 'receptionist.voice.mode', 'message' => 'Choose one of: ' . implode(', ', self::VOICE_MODES) . '.'];
            $mode = '';
        }
        $out['receptionist']['voice']['mode'] = $mode !== '' ? $mode : 'browser';
        $out['receptionist']['voice']['voiceId'] = self::text($voice['voiceId'] ?? '', 'receptionist.voiceId', $errors);

        // Clamped rather than rejected: a rate outside this band is a slider
        // that got dragged, not a statement of intent, and 0.25 is unusable.
        $rate = is_numeric($voice['rate'] ?? null) ? (float) $voice['rate'] : 1.0;
        $out['receptionist']['voice']['rate'] = max(0.5, min(1.5, round($rate, 2)));

        // --- visitor services ----------------------------------------------
        $services = is_array($in['visitorServices'] ?? null) ? $in['visitorServices'] : [];
        foreach (['booking', 'enquiry', 'handover'] as $journey) {
            $out['visitorServices'][$journey] = (bool) ($services[$journey] ?? false);
        }

        return ['data' => $out, 'errors' => $errors];
    }

    /**
     * One bounded text field.
     *
     * Truncation is not silent — a value over its limit is an error, because a
     * description quietly cut at 1200 characters mid-sentence is something the
     * administrator would have fixed had anybody told them.
     *
     * @param array<int, array{field: string, message: string}> $errors
     */
    private static function text(mixed $value, string $field, array &$errors): string
    {
        $limit = self::LIMITS[$field] ?? 240;
        $string = trim(Json::string($value));

        // Control characters other than newline and tab have no business in a
        // field that becomes spoken text, and are a classic way to smuggle
        // formatting past a reviewer looking at rendered output.
        $string = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $string);

        if (mb_strlen($string, 'UTF-8') > $limit) {
            $errors[] = [
                'field' => $field,
                'message' => 'Too long — the limit is ' . $limit . ' characters.',
            ];

            return mb_substr($string, 0, $limit, 'UTF-8');
        }

        return $string;
    }

    /**
     * A bounded list of bounded rows.
     *
     * A row where every field is empty is dropped rather than reported: that is
     * what a form's spare blank row looks like on submit, and an error there
     * would be the interface complaining about something the user did not do.
     * A row with *some* content but a missing required field is a real mistake
     * and is reported against its own index.
     *
     * @param array<int, string> $fields
     * @param array<int, string> $required
     * @param array<int, array{field: string, message: string}> $errors
     * @return array<int, array<string, string>>
     */
    private static function rows(mixed $input, string $key, array $fields, array &$errors, array $required): array
    {
        if (!is_array($input)) {
            return [];
        }

        $max = self::MAX_ROWS[$key] ?? 20;
        $rows = [];

        foreach (array_values($input) as $index => $raw) {
            if (!is_array($raw)) {
                continue;
            }
            if (count($rows) >= $max) {
                $errors[] = ['field' => $key, 'message' => 'No more than ' . $max . ' entries.'];
                break;
            }

            $row = [];
            $filled = false;
            foreach ($fields as $field) {
                $value = self::text($raw[$field] ?? '', $key . '.' . $field, $errors);
                $row[$field] = $value;
                if ($value !== '') {
                    $filled = true;
                }
            }

            if (!$filled) {
                continue;
            }

            foreach ($required as $field) {
                if ($row[$field] === '') {
                    $errors[] = [
                        'field' => $key . '.' . $index . '.' . $field,
                        'message' => 'This is needed for the entry to mean anything.',
                    ];
                }
            }

            $rows[] = $row;
        }

        return $rows;
    }
}
