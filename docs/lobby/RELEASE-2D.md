# Phase 2D — a real human receptionist

| | |
| --- | --- |
| Repository | `aicountly/lobby-aicouintly` |
| Branch | `claude/optimistic-einstein-ollvhw` |
| Base | `main` at `fa80199` (Phase 2C + the Console credential wiring) |
| Deployed | **Nothing.** No merge, no workflow run, no deployment setting changed |

## What this phase was for

RELEASE-2C.md answered "which character is displayed?" with: *the generated
demonstration character from Phase 2B — **the realistic-human goal is not
met***. This closes that.

## The premise that changed

The earlier discovery pass concluded that no licensed, rigged, photoreal human
character was obtainable from this build environment. Egress has not changed —
Poly Haven, Ready Player Me, Mixamo, Meshy and Sketchfab all still refuse the
CONNECT, and `raw.githubusercontent.com` is still the only route to any asset.

What changed is the conclusion. That pass inspected two files on that host
(RobotExpressive, CesiumMan), found neither was a human with a viseme set, and
stopped. **A CC0 human with the complete ARKit 52 was one directory away.**

## What is shipped

`web/public/lobby-assets/receptionist.glb` — 5.7 MB, 83,686 triangles, a 67-bone
Mixamo-named humanoid skeleton, **ARKit 52/52**, 11 of the 15 OVR visemes
native.

Built with Blender + MPFB from MakeHuman assets, released **CC0**. The licence
did the choosing: the same source repository's better-known `brunette.glb` is a
more polished Ready Player Me avatar and is **CC BY-NC 4.0**, which a commercial
product's public front door cannot use. It was rejected without further
consideration, as were three other non-commercial candidates.

It is **not photoreal**, and the docs do not say it is. It is a parametric human
— realistic proportions, real skin, eye and hair textures, a face that holds an
expression — not a scan or a sculpt. It also arrives in a casual top rather than
business dress, which is the source asset's wardrobe and not a choice.

## What had to be built around it

**`scripts/build-character.mjs`** — the recipe for the committed binary, because
a committed binary with no recipe is a fact nobody can check. It takes 35.1 MB
to 5.7 MB: textures resized and re-encoded to WebP (18.5 MB → 0.8 MB), morph
NORMAL deltas dropped (exactly half the morph payload), and morphs removed from
meshes they cannot move — MakeHuman puts `jawOpen` on the eyelashes and
`mouthSmile` on the eyebrows.

Draco and KHR_mesh_quantization were both measured and both rejected, with the
numbers in ASSETS.md. Dropping the morph normals is a real loss and is recorded
as one rather than called free.

**`src/lobby/reception/skeletonPoser.ts`** — the file has zero animation clips,
and `idle` is the one clip the requirements call mandatory. The rig has standard
Mixamo bone names, which is enough to pose in code, which is what the lobby
already does for its own figure. It settles the arms against the body, breathes,
sways, glances and waves, driven by the same controller an authored character
would use.

Two traps are recorded in that file because they cost real time: the bind pose
is **not** a T-pose (the hands already sit at hip height and need bringing *in*,
not *down*), and rotations apply in the **bone's** local space, not the room's —
so the axis that settles an arm is local X with the same sign on both, not the
abduction-about-Z that anatomy suggests. Both numbers came from loading the file
and measuring where the hand ends up.

## A bug this phase found

A character with native `viseme_*` shapes exposed a defect latent since Phase 2B.

The per-frame face pose is composed into a reused object to avoid an allocation
every frame. The expression pass overwrote only the ARKit controls it knew
about; `viseme_*` names are not in that list, so they survived into the next
frame — and because the lip-sync pass *adds* to whatever is there, every viseme
that ever fired climbed to 1 and stayed. Six pinned at once held the mouth
permanently open, which is what it looked like on screen.

No character had native viseme shapes before, so nothing had ever driven those
keys. `composeFacePose` in `faceRig.ts` now clears the whole pose. Four tests
pin it, and they fail against the old code — checked by reintroducing it.

Two smaller fixes came out of the same hunt:

- The character slot **failed silently**. A manifest pointing at a real file the
  loader could not read was indistinguishable from a manifest pointing at
  nothing, and the room looked identical either way. It now says so.
- The capability line read `0/8 animation roles`, which describes a frozen
  character. It now says `body posed in code`.

## Budgets this breaks, stated plainly

| | Asked for | Shipped |
| --- | --- | --- |
| Triangles | ≤ 60k | **83,686** — 43k of it eyelashes and eyebrows |
| Materials | ≤ 4 | **7** |
| `idle` clip | required | **none**, posed in code instead |

The eyelash and eyebrow meshes are alpha-mapped hair cards; a quadric simplifier
tears them apart exactly at the silhouette, which is the one place they are
visible. They were left alone rather than wrecked to hit a number.

## Verification

| | |
| --- | --- |
| `php server-php/tests/run.php` | **36 / 36** |
| `npm run test:reception` | **92 / 92** — four new, on the viseme bug |
| `npm run test:ui` | **23 / 23** |
| `npm run build`, `tsc -b` | clean |
| `npm run inspect:character` | ARKit 52/52, 11/15 visemes, 67 bones, skinned |

The character was also rendered and looked at, repeatedly: in the room from
visitor distance, in close-up, mid-greeting and at rest.

**Load cost was measured but is not a benchmark.** In this environment —
software-rendered, shared infrastructure — the GLTFLoader chunk import is 4.2 s,
the 5.7 MB fetch 1.5 s, the parse 2.2 s. The import figure especially is an
artefact of one busy main thread. None of it should be quoted as what a visitor
experiences. What matters structurally is that the generated figure mounts
immediately and is replaced when the model is ready, so the room is never empty
and never blocks on the download.

## What is still not done

- **No real-device testing.** Nothing here has been opened on a phone or a
  laptop with a GPU.
- **The character is not in business dress**, and the badge and overhead label
  that marked the generated figure as a demonstration went with it — they were
  part of that figure's geometry. The reception panel still states what the
  character is and what it can do.
- **Reception still answers nothing in production**, because no AI credential is
  bound in Console yet. That is Phase 2C's outstanding item, not this one's.
- Nothing was merged and nothing was deployed.

---

## Amendment — an Indian receptionist, and the lip-sync lead

Two things reported from the deployed site after this note was written.

### 1. The receptionist was European

Aicountly sells in India, so the front desk should not read as foreign.
`build-character.mjs` now shifts the skin tone, darkens the hair to near-black,
and replaces the source's casual printed tee with a flat maroon top — the
printed logo goes with it, and the normal map survives so the fabric still
creases.

**It changes colour, not bone structure.** The face geometry is the same
parametric MakeHuman head. At counter distance the colouring carries it; in
close-up the features are not specifically South Asian. Doing that properly
means applying MakeHuman's ethnic morphs before export, which needs Blender.

A bounded search for a South Asian MakeHuman skin found nothing reachable: the
realistic skins ship in a separate asset download rather than a git repository,
and `makehumancommunity/makehuman` — which is reachable, and CC0 — carries no
diffuse textures in its skins directory.

Two incidental fixes came with the rework: textures are now encoded **once**
rather than twice, so the face takes one round of lossy WebP instead of two, and
the file declares `EXT_texture_webp` again. Dropping `textureCompress` had
silently removed that declaration; browsers decode WebP through a blob URL
regardless, which is exactly the kind of thing that works until something
stricter reads the file.

### 2. The lips led the voice

*"the lip movement when we approach the reception is acting only and the voice
follows a second later"* — accurate, and two bugs pulling the same way.

`speechSynthesis.speak()` returns long before any sound, and the viseme schedule
was anchored at the moment of the request. The whole engine warm-up was spent
mouthing a line nobody could hear yet. The re-timing built for this could not
rescue it either, because `onboundary` also measured elapsed time from before
`speak()` was called — correcting the schedule towards a clock that was itself
late.

Both now measure from `onstart`, so the mouth stays closed until the voice
actually starts. A 1.2-second floor covers browsers that never fire `onstart`,
which Chrome has long-standing bugs around.

Two tests pin it, and they fail against the old code — verified by putting the
bug back.

### Verification

36/36 backend, 93/93 numeric (two new), 23/23 browser, clean build and
typecheck, ARKit 52/52 still intact on the rebuilt character.

**The sync fix has not been heard.** It is verified by test and by reasoning
about the event order, not by listening to a browser speaking — this environment
has no audio. That is the one claim worth checking on a real device.
