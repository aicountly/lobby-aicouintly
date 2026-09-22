# The reception character

The figure behind the counter and the panel that opens when you select the desk
are one thing. This is how it is built, what it can and cannot do, and what it
does with a microphone.

## What it is not

Before anything else, because these are the claims that would be easiest to
make and are not true:

- **There is no language model connected.** Replies are matched from the
  question by keyword, and every one of them is written out in full in
  `web/src/lobby/services/demoAdapter.ts`. The relay that would front a real
  model (`VITE_LOBBY_RECEPTION_AI_PATH`) is unset, and while it is unset the
  live adapter reports the capability unavailable rather than answering.
- **Nothing is booked, sent or stored.** Every receipt carries `demo: true`, and
  the character is structurally unable to describe one as real — see
  [Receipts](#receipts).
- **Nobody is contacted.** Asking for a person produces a handover that says
  what *would* happen. It does not send anything.
- **The character is not photoreal.** It is generated in code: an articulated
  figure with a procedural face. It is stylised, it is labelled as a
  demonstration character on its badge and above its head, and it is not a scan
  or a sculpt.
- **No audio is recorded or uploaded.** Voice uses the browser's own speech
  engine. Nothing is buffered, stored or sent anywhere.

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
| **A — `timed`** | The character can shape a mouth, and we have the text | A schedule of visemes built from the reply and corrected against the speaker's word boundaries |
| **B — `audio`** | Only a jaw, and there is a real audio stream | An RMS envelope of that stream |
| **C — `none`** | No drivable mouth, or reduced motion | Body animation and the transcript |

**Mode A is what runs in this build.** `SpeechSynthesisUtterance` exposes no
audio buffer — only events — so there is nothing to analyse, and the schedule
has to be estimated from the text up front and re-anchored as
`onboundary` arrives. Re-anchoring never moves the mouth backwards: a correction
that rewinds is more visible than the drift it fixes.

The schedule is grapheme-level, not phoneme-level. There is no pronunciation
dictionary in the bundle and shipping one for lip-sync would cost more than the
entire texture set. At conversational speed and across a reception counter, what
is visible is a mouth that opens on vowels, closes on P and B and rounds on O,
and that much is reliable from spelling.

**Mode B is implemented and exercised by tests with a synthetic envelope. It has
not been exercised against a real text-to-speech stream, because no server-side
voice is configured in this build.** It is the path a server voice would take.

Visemes are the fifteen Oculus/OVR shapes. Almost no character ships them, so
each is also written out as a blend of ARKit controls in
`reception/visemes.ts` — a character with native `viseme_*` shapes is driven by
them directly, one with only ARKit blendshapes gets the same fifteen built from
what it has, one with neither gets Mode C.

## The face

No licensed rigged human character was obtainable from this build (see
[ASSETS.md](ASSETS.md) for what was checked). Rather than declare a face in a
manifest and leave it missing, the face is generated, like the textures.

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
