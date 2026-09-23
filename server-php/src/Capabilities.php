<?php

declare(strict_types=1);

namespace Aicountly\Api;

use Aicountly\Api\Ai\ConsoleCredentials;
use Aicountly\Api\Config\ConfigStore;
use Aicountly\Api\Provider\AnthropicConversation;
use Aicountly\Api\Provider\HttpSpeech;
use Aicountly\Api\Provider\HttpTranscription;
use Aicountly\Api\Store\FileRepository;

/**
 * What this deployment can actually do, reported rather than assumed.
 *
 * The interface needs this to tell a visitor the truth without trying a call
 * and interpreting the failure, and an operator needs it to see which of five
 * separate pieces of configuration is the missing one.
 *
 * Two audiences, two levels of detail. A public visitor gets capability flags
 * and a sentence they can act on. The operator detail — which environment
 * variable is unset — is only returned to a caller holding a valid portal
 * session. It is not secret, but a public endpoint that enumerates a server's
 * configuration gaps is free reconnaissance.
 */
final class Capabilities
{
    /**
     * @return array<string, mixed>
     */
    public static function report(string $tenant, bool $includeOperatorDetail): array
    {
        $conversation = new AnthropicConversation();
        $speech = new HttpSpeech();
        $transcription = new HttpTranscription();

        $repository = new FileRepository();
        $store = new ConfigStore($repository);
        $published = Knowledge::forTenant($tenant, $store);
        $knowledge = $published->summary();
        $journeys = $published->journeys();

        $sessionReady = VisitorSession::configured();
        $conversationReady = $conversation->configured() && $sessionReady;

        $report = [
            // `live` only when a visitor can actually hold a conversation.
            // There is no third state where it half works.
            'mode' => $conversationReady ? 'live' : 'unavailable',
            'conversation' => self::entry(
                $conversationReady,
                $conversation->name(),
                $conversationReady ? '' : 'The reception AI is not connected for this deployment.',
                $includeOperatorDetail
                    ? trim($conversation->unconfiguredReason() . ($sessionReady ? '' : ' LOBBY_SESSION_SECRET is unset or shorter than 32 characters, so no visitor session can be issued.'))
                    : null,
            ),
            'speech' => self::entry(
                $speech->configured(),
                $speech->name(),
                $speech->configured() ? '' : 'Replies are not spoken by the server. The browser voice is used where the browser has one.',
                $includeOperatorDetail ? $speech->unconfiguredReason() : null,
            ),
            'transcription' => self::entry(
                $transcription->configured(),
                $transcription->name(),
                $transcription->configured() ? '' : 'Voice input is not transcribed by the server. The browser engine is used where the browser has one.',
                $includeOperatorDetail ? $transcription->unconfiguredReason() : null,
            ),
            'knowledge' => [
                'configured' => $knowledge['configured'],
                'sections' => $knowledge['sections'],
                'businessName' => $knowledge['businessName'],
                'reason' => $knowledge['configured']
                    ? ''
                    : 'No approved business information is configured, so reception can only say what it does not know.',
            ],
            // Only the journeys this tenant switched on, because the
            // interface renders a button for each one and a button that opens
            // an unavailable journey is a promise the product cannot keep.
            'journeys' => $journeys,
            'actions' => array_values(array_filter(
                array_keys(Reception::ACTIONS),
                static fn (string $action): bool => match ($action) {
                    'offer_booking' => $journeys['booking'],
                    'request_handover' => $journeys['handover'],
                    default => true,
                },
            )),
        ];

        if ($includeOperatorDetail) {
            $source = $store->published($tenant)['source'];
            $report['knowledge']['source'] = $source;
            $report['knowledge']['detail'] = match ($source) {
                'store' => 'Published configuration for this tenant.',
                'migrated' => 'Imported from ' . ConfigStore::legacyPath() . ' on first read. The original file was left in place.',
                'legacy-file' => 'Read directly from ' . ConfigStore::legacyPath() . ' because there is nowhere to save a published copy. ' . $repository->unavailableReason(),
                default => 'Nothing is published for this tenant, and there is no ' . ConfigStore::legacyPath() . ' to import.',
            };
            $report['tenant'] = $tenant;
            $report['model'] = $conversation->model();
            $report['stateDir'] = RateLimit::directory();
            $report['stateDirWritable'] = is_writable(RateLimit::directory());
            $report['storage'] = self::storage($repository);
            $report['credentials'] = self::credentialSource($conversation->source());
        }

        return $report;
    }

    /**
     * Whether the tenant's configuration can be saved at all — operator only.
     *
     * Three states an administrator can act on, and they need three different
     * actions: it works; there is nowhere configured to write; or somewhere is
     * configured and PHP cannot write to it. A single "unavailable" would send
     * them to check the wrong thing.
     *
     * @return array<string, mixed>
     */
    private static function storage(FileRepository $repository): array
    {
        $writable = $repository->writable();
        $inDocRoot = $repository->insideDocumentRoot();

        return [
            'configured' => $repository->configured(),
            'writable' => $writable,
            'location' => $repository->location(),
            'reason' => $writable ? '' : $repository->unavailableReason(),
            // A store under the document root is served as static JSON to
            // anyone who guesses the path, and is deleted by the next deploy.
            'webReachable' => $inDocRoot,
            'warning' => $inDocRoot
                ? 'The data directory is inside the document root. Move it: its contents are served over HTTP, and the next deploy rsyncs this path with --delete.'
                : '',
            'legacyFile' => ConfigStore::legacyExists() ? ConfigStore::legacyPath() : null,
        ];
    }

    /**
     * Where the reception credential came from — for an operator, never public.
     *
     * No key material and no service key: the domain and the module are names
     * an operator needs in order to find the right row in Console, and neither
     * is a secret. `model` is Console's, when Console named one.
     *
     * @return array<string, mixed>
     */
    private static function credentialSource(string $source): array
    {
        $console = ConsoleCredentials::isConfigured();
        $status = $console ? ConsoleCredentials::status() : null;

        return [
            'source' => $source,
            'console' => [
                'configured' => $console,
                'domain' => $console ? ConsoleCredentials::domain() : null,
                'module' => ConsoleCredentials::MODULE_RECEPTION,
                'available' => $status['available'] ?? false,
                'provider' => $status['provider'] ?? null,
                'model' => $status['model'] ?? null,
                'hint' => $status['admin_hint'] ?? null,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function entry(bool $configured, string $provider, string $reason, ?string $detail): array
    {
        $entry = [
            'configured' => $configured,
            // The provider's product name is not a credential, but it is only
            // named once it is actually in use.
            'provider' => $configured ? $provider : null,
            'reason' => $reason,
        ];

        if ($detail !== null && $detail !== '') {
            $entry['detail'] = $detail;
        }

        return $entry;
    }
}
