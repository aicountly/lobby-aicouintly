# The reception character

The figure behind the counter and the panel that opens when you select the desk
are one thing. This is how it is built, what it can and cannot do, and what it
does with a microphone.

## Three modes, never two

| Mode | When | What answers |
| --- | --- | --- |
| **demo** | `VITE_LOBBY_SERVICE_MODE` unset or `demo` — the default | A keyword-matched script in `demoAdapter.ts`. Labelled as a demonstration on the panel |
| **live** | `=live` **and** the server reports a configured model | The Anthropic Messages API, through this product's own PHP API, using tenant-approved knowledge |
| **unavailable** | `=live` and the server reports no model | Nothing. The panel says so and the booking and enquiry journeys stay usable |

The third mode is the point. A live deployment whose model is not configured
**must not** fall back to keyword matching: that would present a demonstration
to a visitor as a real AI. There is no code path from a failed live request to
a scripted answer — `liveAdapter.askReception` returns `unavailable` on every
failure, and it does not import `demoAdapter`.

`GET /api/lobby/capabilities` is what the browser asks. It reports each
capability separately, so a deployment with a model but no voice is a
receptionist that types rather than one that is down.

## What it is not

Before anything else, because these are the claims that would be easiest to
make and are not true:

- **In demo mode there is no language model.** Replies are matched from the
  question by keyword, and every one of them is written out in full in
  `web/src/lobby/services/demoAdapter.ts`.
- **No model credential is configured in this repository, and none is meant to
  be on the server either.** The live path is implemented and tested against
  fixtures; whether it answers depends on a credential bound to this product in
  Aicountly Console, fetched per request and held in memory. See
  [Where the key lives](#where-the-key-lives).
- **Nothing is booked, sent or stored.** Every receipt carries `demo: true`, and
  the character is structurally unable to describe one as real — see
  [Receipts](#receipts).
- **Nobody is contacted.** Asking for a person produces a handover that says
  what *would* happen. It does not send anything.
- **The character is not photoreal.** It is a real human model now rather than
  the generated stylised figure — a parametric human from the MakeHuman
  ecosystem, with the full ARKit 52 blendshape set and a proper humanoid
  skeleton. But it is not a scan and not a sculpt, and it ships with **no
  animation clips**: the body is posed in code, which the capability panel says
  out loud. It is localised for India in **colour only** — skin, hair and
  clothing — because the facial geometry cannot be changed without Blender.
  See [ASSETS.md](ASSETS.md) for the licence, the budgets it breaks and what
  reducing it cost.
- **Where audio goes depends on which engine is configured, and the panel says
  which.** With the browser engine, the reply text and the recording stay with
  the browser's own speech implementation — which may process on the device or
  in the vendor's cloud depending on the browser, so the interface does not
  claim it is local. With a configured server engine, the reply text is sent to
  the speech service and the recording is sent to the transcription service.
  Neither is stored by this product, and audio is never written to disk or
  logged by the API.

## The backend

`server-php` is a hand-rolled front controller — no framework, no database, no
composer — and Phase 2C keeps it that way. Five routes were added:

| Route | Does |
| --- | --- |
| `GET /api/lobby/capabilities` | What this deployment can actually do |
| `POST /api/lobby/session` | Issues a scoped session to a public visitor |
| `POST /api/lobby/reception` | One turn of the conversation |
| `POST /api/lobby/speech` | Synthesises a validated reply |
| `POST /api/lobby/transcribe` | Transcribes one recording |

### The visitor session

`/lobby` is public, so reception cannot sit behind the portal login — and it
must not become an open proxy to a metered model. A visitor is issued a
short-lived HMAC-signed token before they can talk. The token carries the
conversation id and the tenant, **both put there by the server**, so no route
ever reads a tenant from a request body. A browser can present a token; it
cannot mint one, edit the tenant in one, or extend one. A token signed for
another tenant does not verify, because the tenant is re-derived from the host
and compared rather than read out and believed.

It is not an identity. It says "this browser was issued a reception session",
and nothing else. The portal session for signed-in users is separate and
unchanged.

The token travels in `X-Lobby-Session`, a header rather than a cookie, so a
cross-site form post cannot carry it and classic CSRF does not apply. An Origin
check is the second lock.

### Where the key lives

Not here, and not in this server's `.env` either.

`console.aicountly.org` is the fleet's system of record for AI provider keys.
Lobby asks for its credential on
`GET {CONSOLE_API_URL}/ai/credentials/resolve?domain={host}&module=reception`,
authenticated by the shared `CONSOLE_SERVICE_KEY`, and holds the answer in
process memory and — where APCu exists — in shared memory, for the few minutes
Console says it may. **Nothing is written to disk.** On a host whose front door
is open to the internet by design, that is the point: there is no long-lived
provider key sitting in a file next to the code.

`server-php/src/Ai/ConsoleCredentials.php` is the whole of it, and it is the
same class the rest of the fleet uses, adapted. It does not store a key, mint
one, cache one to disk, or accept one from a request.

Three rules this product does not bend:

- **A binding for another provider is refused, not adapted.** If the `reception`
  module is bound to a Google credential, reception reports unavailable.
  Rewriting the request to suit it would post that key to Anthropic's endpoint —
  disclosing a live key to a third party, and failing anyway.
- **A configured-but-silent Console does not fall back to a local key.**
  `AI_CREDENTIALS_SOURCE` defaults to `console` here, so a Console outage makes
  reception say it is unavailable, which is true. The fleet default is `auto`
  because other products had a key in `.env` to migrate off; reception never
  did. `auto` is still honoured if you set it, and it logs each time it falls
  back.
- **`LOBBY_AI_API_KEY` is for a laptop.** It is read only on a host with no
  `CONSOLE_API_URL`/`CONSOLE_SERVICE_KEY` at all.

Console is also told what the call cost: identifiers, token counts, latency and
an outcome, posted fire-and-forget to `/ai/usage`. Never the visitor's words,
never the reply, never the key. A local-development key reports nothing, because
it has no Console identifiers to report against.

The speech and transcription endpoints stay vendor-neutral in `.env` — Lobby
owns their URL and request shape — but their key can come from Console too, via
`LOBBY_TTS_AUTH_FROM_CONSOLE` / `LOBBY_STT_AUTH_FROM_CONSOLE`. That one is
opt-in rather than automatic: nothing here can check that a Console-held key
belongs to the vendor a free-form URL points at, and a key sent to the wrong
vendor is a disclosed key.

Setting it all up: [CONSOLE-AI.md](CONSOLE-AI.md).

### Limits, and what they are for

Sized to stop runaway cost and abuse on a public page, not to meter billing:
per-session per-minute, per-address per-hour, per-tenant per-day, plus a
request-size ceiling, a message-length ceiling and a bounded history. The
limiter is files under `LOBBY_STATE_DIR`; there is no database, and adding one
to count requests would be a worse trade than the imprecision this accepts.

### Approved knowledge

Lobby owns reception knowledge — hours as reception should say them, how to
route a caller, the answers a front desk is actually asked. It lives in
`knowledge.json` beside `.env` on the server, for the same reasons: it is
tenant data, it is not this repository's to hold, and a deploy must not be able
to overwrite it. `knowledge.example.json` ships with placeholders and no
invented business details.

**Knowledge is data, not instruction.** It is rendered into the prompt inside a
delimited block, and the rule that says so comes *before* the block — a tenant
who writes "ignore your instructions" into an FAQ gets a receptionist that has
read a strange FAQ, not a new set of rules. There is a test that asserts the
ordering.

### Actions: the model proposes, the backend disposes

The model may propose `offer_booking`, `offer_enquiry` or `request_handover`.
That list is the entire permission surface. Each is an *offer* put in front of
the visitor; none writes anything. Proposals are matched against the allowlist
and a strict schema, undeclared fields are dropped, duplicates collapse, and
anything unrecognised disappears. **There is no path from model output to a
URL, a query, or a command.**

Booking still happens in the booking journey, through the application that owns
appointments, which confirms separately. The system prompt tells the model it
cannot perform actions and must never say it has — and the interface only
reports success when the owning service says so.

## Talking to it

Two ways in, and neither needs a panel opened first:

- **Walk up to the counter.** Within five metres the character waves and speaks
  its opening line, captioned over the room. It greets once per visit and
  re-arms when the visitor has gone properly away — eight metres — so coming
  back later is greeted again rather than ignored.
- **Press Talk in the 3D view.** That opens the microphone then and there, walks
  the visitor to the counter, and leaves the character on screen while the
  captions carry both sides. A browser with no speech recognition lands in the
  conversation panel instead, where the reason is stated.

Sound is a button in the 3D view too. It starts off — walking in must not be
met with a page that talks at you — and pressing **Talk** turns it on, because
someone holding a spoken conversation expects a spoken answer. Typing does not.

The panel is still there for typing, for the booking and enquiry journeys, and
for reading the transcript back. It is not the only way to talk.

### What the voice is, and is not

It is the browser's own speech synthesis: no credential, no upload, and a voice
that varies by operating system. On some platforms it is flat and obviously
synthetic. **A natural-sounding voice is a different thing and does not exist
in this build** — it needs a server-side text-to-speech relay behind this
product's own PHP API, with the model credential governed by Aicountly Console,
and `VITE_LOBBY_RECEPTION_AI_PATH` is unset. That relay is also what would make
lip-sync Mode B live, since it is the only thing that would produce an audio
stream to analyse.

The captions matter beyond convenience: they are the other half of lip-sync
Mode C. A character with no drivable mouth animates its body and its words
appear over the room. Putting them only inside the panel — which was the first
implementation — put them where nobody was looking.

## Three state machines, on purpose

| | What it tracks | Values |
| --- | --- | --- |
| **Conversation** | What the exchange is doing | `idle` `greeting` `capturing` `thinking` `answering` `handover` `failed` |
| **Audio** | What the speaker is doing | `silent` `requested` `playing` `unsupported` |
| **Character** | What the figure is doing | `idle` `greeting` `listening` `processing` `speaking` `handover` `error` |

Only the third is what art is authored against. The first two flow into it, in
one direction, in `reception/states.ts`.

Collapsing them into one enum is the bug that leaves a character mouthing at an
empty room: audio can stop without the conversation ending, and a conversation
can end while audio is still draining. Keeping them apart is also what lets the
character apologise with its mouth moving — `error` is a character state and
"speaking" is a separate fact about the signal, so both are true at once.

Character state is derived from the conversation and the speaker and **never
from what the character can do**. A figure that cannot play a `think` clip is
still in `processing`; what it can *show* is answered further down. Deciding
state from capability would let the caption and the figure tell a visitor
different things.

## What the character can actually do

Configuration says a character has fifty-two blendshapes. The file usually says
otherwise. So nothing is driven from the manifest: `reception/capability.ts`
probes the mounted object and reports what it found.

- Clips come from what the loader returned, not from the manifest's names. The
  manifest is consulted for *which* clip is `idle`, and for nothing else.
- Morph targets come from `morphTargetDictionary`, which three.js fills from the
  glTF's `extras.targetNames`. **A character exported without those names is
  reported as having no face.** Driving morph targets by index order produces a
  character that chews.
- Roles fall back along a chain (`CLIP_FALLBACK`) that terminates at `idle`, so
  a one-clip character works and a fully authored one is used in full.

`npm run inspect:character -- path/to/character.glb` answers the same question
offline, before anyone wires a file up.

## Lip-sync: three modes

Chosen from what the character can do and what the browser gives us.

| Mode | When | What drives the mouth |
| --- | --- | --- |
| **`provider-viseme`** | The speech service supplies timed viseme events | Those events, replayed on the audio's own clock |
| **`audio-reactive`** | Real audio is playing and the character has a jaw | An RMS envelope of the audio that is actually playing |
| **`text-estimated`** | No audio to measure, but the character can shape a mouth | A schedule guessed from the spelling of the reply |
| **`none`** | No drivable mouth, or reduced motion | Body animation and the captions |

**The previous name for `text-estimated` was `timed`, which was wrong.** It read
as though the speech provider supplied the timings. It does not: the schedule is
estimated from spelling and nudged by whatever word-boundary events the
browser's own speech engine emits. Nothing measures the audio. Calling that
"provider-timed viseme synchronisation" would be a claim this code cannot
support, so nothing calls it that — and there is a test asserting the
description says "nothing measures the audio" and never says "provider".

**Which mode runs depends on the deployment.** With a configured server voice,
real audio plays and `audio-reactive` runs — approximate mouth movement, not
phoneme-accurate lip-sync, and reported that way. With the browser voice,
`text-estimated` runs. `provider-viseme` is implemented and unreachable until a
speech service supplies viseme events.

**The clock matters.** Where audio exists, the schedule runs on the audio
element's `currentTime`, not on the wall clock. A network round trip and a
decode sit between "the request was made" and "the sound started"; drive a mouth
from the first and it finishes talking before the sound does. `scheduleTimeMs`
prefers the audio clock whenever one is attached, and `endSpeaking` clears it so
a stopped reply cannot leave the mouth driven by a detached element.

Re-anchoring on word boundaries never moves the mouth backwards: a correction
that rewinds is more visible than the drift it fixes.

### Playback is a permission, not a setting

A remembered "read replies aloud" preference does not mean the tab may make
noise. A refused `play()` is reported as `blocked`, not as a failure: the audio
is **held**, the mouth stays still, the caption stands, and the interface offers
"Tap to hear this reply" both in the panel and over the room. Mouthing the line
silently and then again on the tap would deliver the same sentence twice.

If synthesis fails outright, the text stays, a notice says what happened, and
the browser voice is used as an **explicitly labelled** fallback — the panel
reports which voice the visitor actually heard.

The schedule is grapheme-level, not phoneme-level. There is no pronunciation
dictionary in the bundle and shipping one for lip-sync would cost more than the
entire texture set. At conversational speed and across a reception counter, what
is visible is a mouth that opens on vowels, closes on P and B and rounds on O,
and that much is reliable from spelling.

**`audio-reactive` is implemented end to end and tested with a fake audio
element that a test drives by hand — playback, the clock, the envelope, the
blocked path, cancellation. It has not been exercised against a real
text-to-speech service, because no speech endpoint is configured and this build
has no credential for one.**

Visemes are the fifteen Oculus/OVR shapes. Almost no character ships them, so
each is also written out as a blend of ARKit controls in
`reception/visemes.ts` — a character with native `viseme_*` shapes is driven by
them directly, one with only ARKit blendshapes gets the same fifteen built from
what it has, one with neither gets Mode C.

## The face

The shipped character supplies its own: **all 52 ARKit blendshapes**, with 11 of
the 15 OVR visemes native and the other four built from the ARKit set by
`VISEME_TO_ARKIT`. It is CC0, and [ASSETS.md](ASSETS.md) records where it came
from and the non-commercial candidate that was rejected.

A character with a real viseme set is also what exposed a bug that had been
latent since Phase 2B. The per-frame face pose is composed into a reused object
to avoid an allocation every frame, and the expression pass only overwrote the
ARKit controls it knew about. `viseme_*` names are not among them, so they
survived into the next frame — and because the lip-sync pass *adds*, every
viseme that ever fired climbed to 1 and stayed there. Six pinned at once held
the mouth permanently open. `composeFacePose` in `faceRig.ts` now clears the
whole pose, and four tests in `test-reception.mjs` pin it; they fail against the
old code.

### The mouth starts when the voice does

Reported from the deployed site: *"the lip movement when we approach the
reception is acting only and the voice follows a second later"*. Exactly right,
and it was two bugs pulling the same way.

`speechSynthesis.speak()` returns almost immediately, but no sound comes out
until the engine has picked a voice, warmed up and — on some platforms — fetched
a cloud voice over the network. The schedule was anchored at the moment of the
**request**, so the whole of that gap was spent mouthing a line nobody could
hear yet, and the lips led the voice for the rest of the reply.

The re-timing that exists for exactly this could not rescue it, because
`onboundary` measured its elapsed time from before `speak()` was called too. It
was correcting the schedule towards a clock that was itself late.

Both now measure from `onstart`. Until the voice actually starts, `signal.speaking`
stays false and the mouth stays closed, which is the honest picture: nothing is
being said. `speechSynthesis` does not always fire `onstart` — Chrome has
long-standing bugs here — so a 1.2-second floor anchors the schedule anyway
rather than leaving a character talking with a closed mouth.

The server-audio path never had this problem: it runs on the audio element's own
`currentTime`, which cannot start before the audio does.

### The generated fallback

The lobby still ships its own figure, and still mounts it whenever no model is
supplied — so a fresh clone with no `.glb` renders a complete room. It is built
the same way the textures are.

- The **head shell** carries **seventeen genuine morph targets**, ARKit named,
  built as vertex deltas over a parametric skull and marked
  `morphTargetsRelative` — the same mechanism a supplied glTF would use, so the
  lip-sync driver exercises one code path either way.
- **Eyelids, brows, gaze and the mouth aperture** are small meshes moved by
  transform. A blendshape that rotates an eyelid is a worse way to rotate an
  eyelid.
- `reception/faceRig.ts` hides the difference. What a rig cannot move it does
  not list, and `capability.ts` reads that list — so a control that does not
  exist is never driven and never claimed.

Amplitudes come from proportions, not from taste: the head is 23 cm tall, a real
jaw drops about 30 mm at full open, and `jawOpen` at 1.0 is 34 mm.

## Voice

| | |
| --- | --- |
| Input | `SpeechRecognition` (vendor-prefixed on most browsers) |
| Output | `speechSynthesis` |
| Credential | **None, and there cannot be one.** Every `VITE_*` value is inlined into the bundle and therefore public |

Rules the code exists to keep, each with a test:

- The microphone is requested when the visitor presses **Talk**, never on load.
- Every track is stopped when listening ends by any route — the visitor
  stopping, the engine ending, an error, the turn being cancelled, the tab being
  hidden. There is one teardown function and every path calls it.
- No audio is recorded. The analyser reads live samples into one reused scratch
  array to produce a loudness number for the listening pose; nothing is
  buffered.
- Speech is never read aloud until the visitor switches it on, and it never
  starts by itself.

The page holds the `getUserMedia` stream itself rather than leaving it to the
recognition engine. That is what makes "stop every track" something this code
can guarantee, and it is where the listening animation's loudness comes from.

## Interruption

One turn at a time, one guard per conversation (`reception/turnGuard.ts`). A
turn spans an adapter call, an utterance, a microphone capture and a run of
mouth shapes, and any of those can outlive the question that started it. Starting
a new turn cancels the old one and runs its cleanup in reverse order; a cleanup
that throws cannot stop the others, because a speech-cancel that fails is not a
reason to leave the microphone open.

## Receipts

Every receipt reaches the transcript through one function, `describeReceipt`,
which cannot produce affirmative language when `demo` is true. "Say it is a
demo" scattered across call sites is one forgotten call site away from a
character telling a visitor they have an appointment they do not have.

`bookingClaimsIn(text)` returns the affirmative phrases a line would need to be
making a real claim; the test suite asserts it is empty for every demo-flagged
line the character can produce.

## Measuring what it costs

```bash
cd web && npm run build && npm run measure:avatar
```

Three configurations of the same room — `?lobbyCharacter=off|idle|speaking` — at
the same viewport, quality profile and camera pose. The query parameter is the
only thing it can change; an unrecognised value is ignored, and the renderer
probe it publishes exists only while that parameter does.

Draw calls, triangles, geometries, textures, programs and transferred bytes come
from `WebGLRenderer.info` and the Resource Timing API and do not depend on the
GPU. **Frame time does.** Read the note in `measurements/avatar-cost.json`
before quoting any of it.

## Tests

| | |
| --- | --- |
| `npm run test:reception` | State machines, visemes, capability probing, the animation controller, the turn guard, the conversation, all three lip-sync modes, and the face geometry. No browser; seconds |
| `npm run test:ui` | The panel in a real DOM: the chip moves, the demo wording survives to the screen, controls are 44 px, the microphone is untouched on load, and the 3D character tracks the same conversation |

The numeric suite has a hard timeout. A test that never resolves is
indistinguishable from a slow one until it has already cost twenty minutes.
