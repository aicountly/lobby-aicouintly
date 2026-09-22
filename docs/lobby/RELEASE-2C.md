# Release handoff — Phase 2C

Live AI reception, natural voice and service integration. **Not merged and not
deployed**: this is a review branch.

## Where the work is

| | |
| --- | --- |
| Repository | `aicountly/lobby-aicouintly` |
| Branch | `claude/optimistic-einstein-ollvhw` |
| Base | `main` at `2e11feb` (Phase 2A + 2B, deployed by run #10) |
| Deployed | **Nothing.** No merge, no workflow run, no deployment setting changed |

## Three premises in the brief that did not hold

Stated first because they changed what could be built.

1. **There is no CodeIgniter backend.** `server-php` is 404 lines of hand-rolled
   PHP — a front controller, a `.env` reader and a portal auth relay. No
   framework, no database, no ORM, no composer manifest. Phase 2C builds on what
   is there rather than introducing a framework.
2. **There is no Console credential interface.** The only Console reference in
   the repository is `https://console.aicountly.org/api/product-icons/{appId}`,
   a product-icon CDN for the app launcher. No credential-broker endpoint was
   invented; the model credential is read from the API's own `.env` on the
   server, and `Provider/Contracts.php` is the seam a Console-backed credential
   source would slot into later.
3. **No AI provider was already configured.** Nothing in the repository
   referenced any provider. So the provider integration is new, and it ships
   unconfigured.

## What was built

**Backend** (`server-php`, +9 files):

- `POST /api/lobby/session` — a short-lived HMAC-signed visitor session. The
  token carries the conversation id and the tenant, both server-derived, so no
  route ever reads a tenant from a body. A token signed for another tenant does
  not verify.
- `POST /api/lobby/reception` — one conversational turn. Bounded history,
  message and request ceilings, per-session/per-address/per-tenant limits,
  provider timeout, safe errors. The transcript is not logged.
- `POST /api/lobby/speech` — synthesis. Validates that what came back is
  actually audio before handing it on.
- `POST /api/lobby/transcribe` — transcription. Audio is never written to disk
  and never logged.
- `GET /api/lobby/capabilities` — what this deployment can do. Public flags;
  operator detail only for a caller holding a valid portal session.

**Provider seam** — conversation, speech and transcription are three separate
interfaces with separate configuration, so one missing capability disables
exactly itself. Conversation is implemented against the Anthropic Messages API.
Speech and transcription are implemented as vendor-neutral configured HTTP
adapters, because choosing a voice vendor is a commercial decision with a bill
attached and this phase was told not to add a paid provider on its own
initiative.

**Approved knowledge** — Lobby-owned, `knowledge.json` beside `.env` on the
server, never committed and never uploaded. Rendered into the prompt as
delimited **data**, with the rule that says so placed before the block. The
shipped template contains placeholders and no invented business details.

**Actions** — the model may propose `offer_booking`, `offer_enquiry` or
`request_handover`. That list is the whole permission surface. Every proposal is
matched against an allowlist and a strict schema; undeclared fields are dropped.
None of them writes anything. There is no path from model output to a URL, a
query or a command.

**Frontend** — three explicit modes (demo / live / unavailable), server speech
with playback driven by the audio's own clock, blocked-autoplay handled with
"Tap to hear", server transcription through `MediaRecorder`, and the lip-sync
modes renamed to what they actually are.

## Capability table

| Capability | Implemented | Configured | Live-tested | Remaining dependency |
| --- | --- | --- | --- | --- |
| Visitor session & tenant scoping | Yes | No | No | `LOBBY_SESSION_SECRET` in the API `.env` |
| Text conversation (Anthropic Messages API) | Yes | No | No | `LOBBY_AI_API_KEY` in the API `.env` |
| Approved business knowledge | Yes | No | No | `knowledge.json` written on the server |
| Capability reporting | Yes | Yes | No | — |
| Rate limits & request ceilings | Yes | Yes (defaults) | No | Writable `LOBBY_STATE_DIR` |
| Server speech (TTS) | Yes | No | No | An approved voice vendor + `LOBBY_TTS_*` |
| Server transcription (STT) | Yes | No | No | An approved vendor + `LOBBY_STT_*` |
| Browser speech fallback | Yes | Yes | Partly — audio not heard in a headless browser | — |
| `audio-reactive` lip-sync | Yes | No | No | A configured server voice |
| `provider-viseme` lip-sync | Yes | No | No | A speech service that emits timed viseme events |
| `text-estimated` lip-sync | Yes | Yes | Yes (visually) | — |
| Booking through Appointments | Adapter only | No | No | Appointments must publish a booking API |
| Enquiries through Connect | Adapter only | No | No | An owner endpoint must exist |
| Human handover | Offer only | No | No | A routing integration must exist |
| Realistic character | **No** | — | — | A licensed rigged human (see ASSETS.md) |

## Stated plainly

- **Do replies come from a real model?** The integration does. **No credential
  is configured**, so on this branch no deployment answers from a model. In
  `demo` mode replies are keyword-matched and labelled as such; in `live` mode
  without a credential the panel says reception is not connected and **never**
  falls back to the script.
- **Does speech come from server TTS or the browser?** Both are implemented.
  With nothing configured it is the browser's voice, and the panel says which
  voice was used for the last reply.
- **Is transcription live?** The server path is implemented and unconfigured.
  Without it, the browser recogniser is used where the browser has one.
- **Which business actions can complete?** None. Booking, enquiries and handover
  have adapter boundaries and honest unavailable states. No owning service has
  published an API, and nothing fabricates a receipt in live mode.
- **Which character is displayed?** The generated demonstration character from
  Phase 2B. **The realistic-human goal is not met.**
- **Which mouth-animation mode runs?** `text-estimated` today. `audio-reactive`
  the moment a server voice is configured.
- **Is real-device testing outstanding?** Yes — entirely. No audio has been
  heard, no microphone used, and no physical device tested.

## Verification

| | |
| --- | --- |
| `php server-php/tests/run.php` | **24 / 24** — sessions, tenant isolation, prompt rules, bounded history, action allowlist, capability leakage, limits |
| `npm run test:reception` | **88 / 88** — adds server speech, the audio clock, blocked playback, stale-turn cancellation, microphone cleanup, lip-sync naming |
| `npm run test:ui` | **23 / 23** |
| `npm run build` | clean, `tsc -b` clean |

Every provider is a fixture. Nothing in the automated suites calls Anthropic, a
speech service or a transcription service.

**Live-provider checks actually performed: none.** `api.anthropic.com` was
confirmed reachable from the build environment and returned `401` with no
credential. That is the whole extent of it — no request with a key was made, no
reply was generated, no audio was synthesised or played, and no recording was
transcribed.

Also not done: packagist is unreachable from this build environment, so the
official Anthropic PHP SDK could not be installed or compiled against. The
conversation provider speaks the documented wire protocol over curl instead,
matching the existing auth relay, and `server-php` keeps its zero-dependency
deploy. Swapping it for the SDK later is contained to one class.

## Configuration

Nothing works until the server `.env` is filled in. `server-php/.env.example`
documents every key. The minimum for a live conversation:

```
LOBBY_SESSION_SECRET=<64 hex chars>
LOBBY_AI_API_KEY=<server-side only, never a VITE_* value>
```

plus `knowledge.json` beside it, and `VITE_LOBBY_SERVICE_MODE=live` at build
time. Speech and transcription are independent and optional.

## Deployment and rollback

Both workflows remain `workflow_dispatch` only; nothing here deploys itself.

1. Review and merge the branch.
2. On the server, write `api/.env` additions and `api/knowledge.json` by hand.
   Neither is ever uploaded — every rsync step excludes them.
3. Run **Deploy to cPanel Sandbox**, then work the device checklist below.
4. `GET /api/lobby/capabilities` with a portal Bearer token to confirm each
   capability reads as expected.
5. Only then **Deploy to cPanel Production**.

**Rollback** is a redeploy of the previous commit (`2e11feb`). There is no
migration and no schema change. The server `.env` and `knowledge.json` are not
touched by a deploy in either direction, so rolling back the files is a complete
rollback; unset keys simply make the new routes report unavailable.

## Device checklist

On a real laptop and a real phone, once a credential is configured:

1. Open Lobby.
2. Walk up to reception. The character greets you, captioned.
3. Turn sound on in the HUD.
4. Ask a question the approved knowledge covers.
5. Hear the answer, read the captions, watch the mouth move with the audio.
6. Interrupt mid-sentence. Audio stops immediately and the mouth returns to
   neutral.
7. Ask a second question. The first answer never resumes.
8. Press Talk, speak, stop. The browser's microphone indicator goes out.
9. Switch to Standard View. The same reception, no canvas.
10. Open the booking journey and stop before submitting — confirm nothing was
    created.

Also worth checking: with sound remembered on, reload the page and ask
something. If the browser blocks autoplay you should get **"Tap to hear this
reply"**, not silence.
