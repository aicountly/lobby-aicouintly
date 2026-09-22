# Release handoff — Phase 2A + 2B

One release. Phase 2A rebuilt the room's materials and lighting; Phase 2B gave
the receptionist a face, a voice and a conversation. They are reviewed together
because 2B is only visible against 2A's lighting, and 2A was never deployed.

## Where the work is

| | |
| --- | --- |
| Repository | `aicountly/lobby-aicouintly` |
| Branch | `claude/optimistic-einstein-ollvhw` |
| Phase 2A | `5c861c1` — environment realism upgrade |
| Phase 2B | `d003037` — animated AI receptionist |
| Base | `main` at `4687b5e`, **untouched** |
| Deployed | **Nothing.** No merge, no workflow run, no deployment setting changed |

Both deploy workflows remain `workflow_dispatch` only. Nothing about this branch
can trigger a deploy.

## Build

```
tsc -b                      clean
vite build                  ✓ 110 modules, 803 ms

dist/index.html                           0.40 kB   gzip   0.27 kB
dist/assets/index-*.css                   1.23 kB   gzip   0.62 kB
dist/assets/LobbyExperience-*.css        13.9  kB   gzip   3.3  kB
dist/assets/GLTFLoader-*.js              45.2  kB   gzip  13.5  kB   (code-split)
dist/assets/index-*.js                  214.9  kB   gzip  68.3  kB
dist/assets/LobbyExperience-*.js       1006.8  kB   gzip 273.1  kB
```

The 1 MB chunk is three.js and is itself code-split away from the portal entry:
a visitor who never opens the lobby does not download it. The `GLTFLoader` chunk
is only fetched when a manifest actually names a model. **No new runtime
dependency was added in either phase.**

## Character capability report

A bounded discovery pass was made for a licensed rigged character. It was made
once and not retried.

| Source | Result |
| --- | --- |
| `api.polyhaven.com` | Unreachable — egress policy refuses the CONNECT |
| `models.readyplayer.me` | Unreachable, same |
| `mixamo.com` | Unreachable, same |
| `api.meshy.ai` | Unreachable, and no generation credential is configured or authorised |
| `raw.githubusercontent.com` | Reachable — the only route to any asset |

Two licensed rigs were obtainable and both were **inspected, not assumed**, with
the committed `npm run inspect:character`:

| | RobotExpressive | CesiumMan |
| --- | --- | --- |
| Licence | CC0 1.0 | CC BY 4.0 |
| Bones / clips | 43 / 14 | 19 / 1 (unnamed) |
| Morph targets | 3 (`Angry`, `Surprised`, `Sad`) | none |
| ARKit 52 | 0 | 0 |
| OVR visemes | **0 / 15** | **0 / 15** |

Neither is a human receptionist and neither can lip-sync. Neither is committed;
both were used only to prove the capability probe reads real glTF correctly.

**Shipped instead:** a stylised character generated in code. Its head shell
carries **17 genuine ARKit-named morph targets** built as vertex deltas over a
parametric skull, with transform-driven eyelids, brows, gaze and mouth aperture
behind one rig interface. It is **not photoreal** and is labelled as a
demonstration character on its badge, above its head, and in the panel.

## What it does

- **Seven character states** — idle, greeting, listening, processing, speaking,
  handover, error — derived from a conversation machine and an audio machine
  that are kept separate from it and from each other.
- **Text conversation** with suggestion chips and service shortcuts that open
  the matching journey.
- **Animation controller** with crossfades, and `LoopOnce` + clamp for greeting
  and handover so a wave does not loop.
- **Voice** using the browser's own engine: input on Talk, output only when
  switched on.
- **Lip-sync Mode A** — a viseme schedule built from the reply text and
  re-anchored on `SpeechSynthesis` word boundaries.
- **Interruption** — one turn guard per conversation, cleanup in reverse order.
- Everything driven by a **probe of the mounted character**, never by the
  manifest.

Full detail in [RECEPTION.md](RECEPTION.md).

## Avatar cost

Same room, same 1280×720 viewport, same `balanced` profile, same pose at the
counter (1.95 m from the figure — where it occupies the most screen).

| | A environment | B + character | C + speech | B − A |
| --- | --- | --- | --- | --- |
| Draw calls | 196 | 246 | 246 | **+50** |
| Triangles | 29,450 | 40,254 | 40,254 | **+10,804** |
| Geometries | 133 | 161 | 161 | **+28** |
| Textures | 19 | 22 | 22 | **+3** |
| Shader programs | 19 | 24 | 24 | **+5** |
| Shadow-casting lights | 1 | 1 | 1 | 0 |
| Transferred | 2,468,206 B | 2,468,206 B | 2,468,206 B | **0** |
| Frame ms (median) | 671.2 | 703.6 | 703.2 | +32.4 |

**Speech animation costs nothing in any of these** — it is morph weights and
transforms on geometry that is already there. The character costs **zero bytes**
because it is generated rather than downloaded.

The frame figures come from **SwiftShader**, a software rasteriser
(`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
driver)`) in a container with no GPU. At ~700 ms a frame, the +5 % between A and
B is inside run-to-run variation — an earlier run of the same script put B
*faster* than A. **These are not a device benchmark and must not be quoted as
one.** The exact numbers, and this caveat, are in
`web/measurements/avatar-cost.json`.

## Verification

| | |
| --- | --- |
| `npm run test:reception` | **80 / 80**, ~15 s, no browser |
| `npm run test:ui` | **23 / 23**, ~75 s |
| `npm run build` | clean, `tsc -b` clean |
| `npm run measure:avatar` | 3 configurations, ~45 s, zero console errors in any |

Both suites have hard timeouts, because a test that never resolves is
indistinguishable from a slow one until it has already cost twenty minutes.

Five real defects, all fixed. The first three were caught here; the last two
were reported from the deployed site:

1. **Patch geometry was wound the opposite way to the head**, so the lips and
   brows were back-facing and invisible. A patch wound the wrong way looks
   exactly like a patch that is not there. There is now a test asserting every
   patch normal points away from the skull.
2. **The mouth group's placement was overwritten every frame** by the rig,
   leaving the whole mouth at the centre of the skull, inside it. Split into an
   anchor that holds placement and a group the rig drives.
3. **A character that unmounted never said so**, so switching to Standard View
   left the panel describing the 3D figure that had just gone away — and left
   the conversation choosing a lip-sync mode for it. Both character components
   now report `NO_CHARACTER` on unmount, which also covers a lost graphics
   context and `?lobbyCharacter=off`. This one surfaced as a one-in-four flake
   in the browser suite; replacing the suite's polling with a MutationObserver
   is what turned it from noise into a reproducible failure.
4. **The conversation panel hid the character and buried the Talk button.** A
   centred modal with a blurred backdrop covered the receptionist completely,
   and the voice controls sat below the transcript — 285 px below the fold of a
   scrolling panel on a phone. An animated character you cannot see, and a
   microphone button you cannot reach, are indistinguishable from neither
   existing, and that is how it was reported. The panel is now a sheet (bottom
   on a phone, docked left on a wide screen, light scrim, no blur), the voice
   controls sit in the control row at the top, and opening reception walks the
   visitor to `CONVERSATION_VIEW` — close to the counter and pitched down, so
   the character's head rides above the panel. Two checks now assert *where*
   the Talk button and the panel are, not just that they exist.
5. **There was no way to talk to the character from the room, and walking up to
   it did nothing.** Voice sat three levels down — Reception services, then
   Speak to our team, then Talk — and the greeting only fired when a panel
   opened, so approaching the counter was met with silence. Talk is now in the
   3D view and opens the microphone directly; the greeting fires on approach
   within five metres, delivered rather than posed so the mouth moves; and a
   caption strip carries the words over the room. The wave was rebuilt too — it
   was raising the arm forward past vertical, which laid it across the room like
   a pole instead of waving.

Also raised: every control in the reception panel is now ≥ 44 px tall. The
suggestion chips and the back link were 30–32 px.

### What was *not* verified

- **No physical device was used.** The browser checks ran at a 420×820 viewport
  with `deviceScaleFactor: 2`; that is viewport emulation, not a phone.
- **No real frame rate on real hardware.** See above.
- **Lip-sync Mode B was not exercised against a real audio stream** — it is
  tested with a synthetic envelope, because no server-side voice is configured.
- **Voice input and output were not exercised end to end.** Headless Chromium
  has no speech engine; what is tested is that the microphone is never touched
  on load, that the controls appear, and that output stays off until switched
  on. The teardown path is unit-tested with a fake engine.

## Blockers and open items

| | |
| --- | --- |
| No licensed photoreal human rig | Unresolved, and unresolvable from this environment. The shipped character is an interim stylised one. When a rig exists, it is a file copy plus a manifest entry |
| No language model | `VITE_LOBBY_RECEPTION_AI_PATH` is unset. Replies are keyword-matched. The relay must be server-side; a browser-visible credential is a published credential |
| No server-side voice | Replies are spoken by the browser's own engine, which needs no credential but sounds synthetic and varies by platform. A natural voice needs a relay behind this product's PHP API with the credential governed by Console; `VITE_LOBBY_RECEPTION_AI_PATH` is unset. Mode B stays unexercised until one exists |
| Photographed materials | Still the honest gap from 2A — generated stone and wool lose to photography at very close range |

## Running it

```bash
cd web
npm install
npm run dev            # http://localhost:5173/lobby
```

```bash
npm run test:reception                    # numeric, seconds
npm run build && npm run test:ui          # browser checks
npm run build && npm run measure:avatar   # cost table + screenshots
npm run inspect:character -- file.glb     # what a supplied character provides
npm run textures                          # regenerate the PBR set
```

`?lobbyCharacter=off|idle|speaking` is the measurement hook. It can change
nothing else, and the renderer probe it publishes exists only while it is set.

## Deployment

Nothing here deploys itself. When the branch is approved:

1. Merge `claude/optimistic-einstein-ollvhw` into `main`.
2. **Sandbox first.** Run *Deploy to cPanel Sandbox* (`workflow_dispatch`) and
   check `https://lobby.gh.aicountly.com/lobby` against the manual checklist
   below on a real phone and a real desktop.
3. Only then run *Deploy to cPanel Production* (`workflow_dispatch`).

No environment variable has to change. Every new behaviour is on by default and
degrades on its own: a browser without speech recognition shows why and keeps
typing; a browser without `speechSynthesis` says replies are text only.

### Rollback

Both workflows build from a ref and rsync the result, so rollback is a redeploy
of the previous commit:

1. Run the same workflow against `4687b5e` (the current `main`).
2. That restores `web/dist` and `server-php` as they are in production today.

There is no migration, no schema change and no stored state in this release, so
rolling back the files is a complete rollback. Browser `localStorage` keeps one
key, `aicountly-lobby-quality`, which older code already reads and ignores
safely.

## Manual device checklist

Do this on a real phone and a real desktop browser. None of it is covered by the
automated suites.

**The room (Phase 2A)**

1. Turn a full circle. Reception, the meeting-room portal, the glazed entrance
   and the lounge should each come past and the fourth turn should land where
   you started.
2. Walk into the counter and each wall. You should stop dead and stay stopped.
3. Switch Low / Balanced / High. The room should stay put and stay lit; only
   sharpness and shadow quality should change.
4. Check the floor at a grazing angle. Boards should read at about 200 mm wide
   with no mirror sheen.

**The character (Phase 2B)**

5. Walk up to the counter. The character should turn its head to follow you and
   blink occasionally.
6. Open Reception services → Speak to our team. The chip at the top should read
   *Greeting you*, then settle to *Waiting*.
7. Ask about opening hours. Watch the chip go *Thinking* → *Answering*, and
   watch the mouth move while it answers. It should close when the reply ends.
8. Ask to speak to a person. The chip should read *Handing over*, the character
   should gesture once and not loop, and the reply must say nothing was sent.
9. Press **Stop** mid-answer. The mouth should stop immediately and the chip
   return to *Waiting*.
10. Press **Talk**. The browser must ask for the microphone *at that moment* and
    not before. Say something; the chip should read *Listening* and the words
    should appear. Press **Stop listening** — **the browser's microphone
    indicator must go out.**
11. Tick **Read replies aloud** and ask something. The mouth should stay roughly
    in step with the voice. Untick it; the next reply must be silent.
12. Turn on the system's reduced-motion setting. The character should stop
    swaying and the mouth should stop moving; replies must still arrive as text.
13. Complete a booking. The receipt must carry a demo badge, and reception must
    describe it as a demonstration — never as a booking that exists.
14. Switch to Standard View. Same three services, no canvas in the DOM, and the
    panel should say there is no 3D character rather than describing one.
15. On the phone: every button and chip in the panel should be comfortably
    tappable, and the page must not scroll sideways.
