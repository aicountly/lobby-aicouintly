# Replacing the lobby's 3D placeholders

Everything you can see in Aicountly Lobby is generated: the room from
primitives, the surfaces from a committed texture generator, the character and
its face from code. Not one asset in this repository was downloaded, and there
is no model file at all. That is deliberate — a fresh clone renders a complete,
navigable room with nothing to fetch and nothing to license.

Final art replaces those placeholders **slot by slot**, at runtime, without a
rebuild.

## How the swap works

`web/public/lobby-assets/manifest.json` is read when the lobby mounts. Each slot
with `"url": null` keeps its procedural geometry. Point a slot at a `.glb` in
the same folder and that slot's placeholder is never mounted; everything else is
untouched.

```jsonc
{
  "version": 1,
  "slots": {
    "receptionist": {
      "url": "/lobby-assets/receptionist.glb",
      "transform": {
        "position": [0.75, 0, -6.15],
        "rotationDegrees": [0, 0, 0],
        "scale": 1
      },
      "animations": { "idle": "Idle_Loop", "greet": "Wave_01" }
    }
  }
}
```

Rules the loader enforces, so a dropped-in file cannot do more than it should:

- **Same-origin only.** Absolute `https://` URLs are accepted only if they match
  the page's own origin. A manifest cannot pull geometry from a third party.
- **Every field is validated.** Anything malformed is discarded and the
  placeholder is kept — a bad manifest degrades, it does not break the room.
- **A model that fails to load falls back.** A 404, a corrupt file or an
  unsupported extension leaves the procedural piece in place rather than a hole.
- **The loader is code-split.** A lobby with no models never downloads
  `GLTFLoader` at all.

The shipped manifest lists every slot with `url: null`, so it doubles as the
template — edit it in place.

## The slots

| Slot | Replaces | Notes |
| --- | --- | --- |
| `room` | Floor, ceiling, walls, entrance glazing, meeting-room portal | Must match the floor plan below |
| `receptionDesk` | Counter, working desk, credenza | Front face must stay inside its collider |
| `loungeSeating` | Sofa, two armchairs, coffee table, rug | Each piece inside its collider |
| `receptionist` | The placeholder character | Rig requirements below |

### The floor plan is not negotiable

Collision is derived from `web/src/lobby/layout.ts`, **not** from the geometry.
Art that does not match it produces a room where you walk into empty air or
through a sofa. If a piece has to move, move it in `layout.ts` and let the
placeholder and the collider follow together.

Interior extents, in metres, Y-up, +X right, −Z the way the camera faces at
yaw 0:

| | X | Z | Y |
| --- | --- | --- | --- |
| Room interior | −7 … 7 | −9 … 9 | 0 … 3.6 |
| Reception counter | −2.5 … 2.5 | −6.5 … −4.7 | 0 … 1.19 |
| Sofa | −6.53 … −5.58 | −0.05 … 2.45 | 0 … 1.08 |
| Armchairs | −3.43 … −2.48 | −0.43 … 0.53 and 1.88 … 2.83 | 0 … 1.0 |
| Coffee table | −5.3 … −3.8 | 0.75 … 1.65 | 0 … 0.45 |
| Entrance doors | −1.7 … 1.7 | at Z = 9 | 0 … 2.45 |
| Meeting portal | at X = 7 | −3.2 … 0 | 0 … 2.6 |

A visitor is a cylinder of radius **0.38 m** with eyes at **1.65 m**.

## The receptionist character

### What is shipped, and what it is not

The character in the room is **generated in code**: an articulated figure with a
procedural face whose head shell carries seventeen ARKit-named morph targets,
built as vertex deltas over a parametric skull. Eyelids, brows, gaze and the
mouth aperture are small meshes moved by transform. It is driven by the same
viseme schedule a supplied glTF would be driven by, so lip-sync is exercised
rather than declared.

It is **stylised, not photoreal**. It is not scanned, sculpted or bought; it is
a few hundred lines of geometry. It is labelled as a demonstration character on
its badge and on a board above its head, and the reception panel states what it
can do. Nobody should describe it as finished art, and the requirements below
still stand in full for a character that would replace it.

### Character capability assessment

A bounded discovery pass was made for a licensed rigged human character. What it
found, on the date below:

| Source | Result |
| --- | --- |
| Poly Haven (`api.polyhaven.com`) | **Unreachable.** The build environment's egress policy refuses the CONNECT |
| Ready Player Me (`models.readyplayer.me`) | **Unreachable**, same reason |
| Mixamo (`mixamo.com`) | **Unreachable**, same reason |
| Meshy (`api.meshy.ai`) | **Unreachable**, and no generation credential is configured or authorised for this repository |
| `raw.githubusercontent.com` | **Reachable.** The only route to any asset from this build |

Two licensed rigged characters were therefore obtainable, and both were
inspected with `npm run inspect:character` rather than taken on description:

| | RobotExpressive | CesiumMan |
| --- | --- | --- |
| Licence | CC0 1.0 (Tomás Laulhé; modifications by Don McCurdy) | CC BY 4.0 (Cesium) |
| Size | 453 KB | 428 KB |
| Geometry | 3,237 triangles, 3 materials | 4,672 triangles, 1 material |
| Skeleton | 43 bones | 19 bones |
| Clips | 14, including `Idle` and `Wave` | 1, unnamed (`animation_0`) |
| Morph targets | 3 — `Angry`, `Surprised`, `Sad` | **none** |
| ARKit set | 0 / 52 | 0 / 52 |
| OVR visemes | **0 / 15** | **0 / 15** |
| Verdict | Body clips and some expression morphs; **lip-sync not possible** | No named idle clip, no face |

Neither supplies a viseme set, and neither is a human receptionist. So a
*downloaded* character could not have delivered lip-sync in this build either —
which is why the face is generated instead. Neither file is committed; both were
used only to verify that the capability probe reads real glTF files correctly.

**The gap is stated plainly: no licensed, rigged, photoreal human character was
obtainable here, and the shipped figure is an interim stylised one.** When such
a character is available, everything above it already works against
`CharacterCapability` and the swap is a file copy plus a manifest entry.

### Requirements for a replacement

The requirements below describe what a final character must provide. They are
unchanged, and they are what `npm run inspect:character` checks a file against.

### Format and budget

| | Requirement |
| --- | --- |
| Format | glTF 2.0 binary (`.glb`), single file |
| Units | Metres, Y-up, Z-forward |
| Origin | On the floor, between the feet |
| Facing | +Z, i.e. towards the entrance |
| Height | 1.6–1.9 m |
| Triangles | ≤ 60k for the character |
| Textures | ≤ 2048², KTX2/Basis preferred; PBR metallic-roughness |
| Materials | ≤ 4 |
| Compression | Draco or Meshopt both load; neither is required |

### Body rig

- One skinned mesh, one skeleton, **≤ 80 bones**.
- Humanoid hierarchy with a single root: hips → spine → chest → neck → head,
  plus two arm and two leg chains. Standard humanoid naming (Mixamo or VRM
  conventions) so clips retarget without hand-mapping.
- Bind pose: A-pose or T-pose. No baked scale on any bone.
- No IK constraints or drivers — they do not survive glTF export.

### Animation clips

Clip names are mapped in the manifest's `animations` block, so they can be
called anything; these are the **roles** the lobby knows about:

| Role | Character state it plays | Required |
| --- | --- | --- |
| `idle` | `idle` | **Yes** — the only clip a character must provide |
| `greet` | `greeting` (played once, then released) | Recommended |
| `listen` | `listening` | Recommended |
| `think` | `processing` | Recommended |
| `speak` | `speaking` | Recommended |
| `gesture` | `handover` (played once, then released) | Recommended |
| `apology` | `error` | Optional |
| `seated` | Seated variant | Optional |

A missing role falls back along a chain that terminates at `idle`
(`CLIP_FALLBACK` in `src/lobby/assets/assetConfig.ts`), so a one-clip character
works and a fully authored one is used in full. `greet` and `gesture` are played
with `LoopOnce` and clamped — a greeting that loops is a character waving at
someone who has already walked away.

Every clip must loop cleanly (first and last frame identical for `idle` and
`listen`) and be authored at 30 fps or higher.

### Facial controls

Required for a character intended to speak. Without them the lobby runs Mode C:
body animation and captions, and no claim of lip-sync. See
[RECEPTION.md](RECEPTION.md) for the three modes.

- **ARKit blendshape set, all 52**, named exactly as Apple specifies
  (`jawOpen`, `mouthSmileLeft`, `browInnerUp`, …). This is the set with the
  broadest tooling support and it is what a future speech pipeline will drive.
- Exported as glTF morph targets on the head mesh, with
  `extras.targetNames` populated — glTF does not carry morph-target names in
  the core specification, and without them the mapping is index order and
  guesswork.
- Neutral is all-zero. No corrective shapes that assume a particular blend order.

### Speech synchronisation

- **Viseme set:** the 15 Oculus/OVR visemes (`sil`, `PP`, `FF`, `TH`, `DD`,
  `kk`, `CH`, `SS`, `nn`, `RR`, `aa`, `E`, `ih`, `oh`, `ou`). Supplying them as
  `viseme_*` blendshapes is best; **the documented mapping onto the ARKit set
  the lobby used to ask for is now supplied by the lobby itself**
  (`VISEME_TO_ARKIT` in `src/lobby/reception/visemes.ts`), so a character with
  the ARKit 52 and no viseme shapes still gets all fifteen.
- Visemes must be drivable independently of the body clips: mouth shapes will be
  applied on top of `speak`, not baked into it.
- Head and eye bones must be animatable separately from the body for future
  look-at, so do not bake head motion into `idle` beyond a subtle breath.

Whoever supplies the character should also state whether the licence permits
redistribution in a public web bundle — the lobby is served as static files, so
the `.glb` is downloadable by anyone who visits.

## Checking a replacement

0. **Inspect it first.** `cd web && npm run inspect:character -- path/to/file.glb`
   prints what the file actually contains — clips, bones, morph-target names,
   ARKit and viseme coverage — and ends with a verdict. Configuration claiming a
   blendshape is not evidence that one exists; this is.
1. Drop the `.glb` into `web/public/lobby-assets/`.
2. Point its slot at it in `manifest.json`.
3. Reload the lobby. No rebuild, no restart.
4. Walk the room: the piece should sit exactly where the placeholder did, and
   collision should still match what you see.
5. Open reception and ask something. The panel's last line reports what the
   lobby found in your file and which lip-sync mode it chose.

If the model does not appear, the loader rejected it — the browser console names
the reason, and the placeholder stays up in the meantime.

---

# Generated texture set (Phase 2A)

The environment upgrade added a PBR texture set. It is **generated, not
downloaded**, and the generator is committed.

## Why generated

Two intended sources were checked and neither was usable from this build:

| Source | Result |
| --- | --- |
| Poly Haven (`polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`) | **Unreachable.** The build environment's egress policy refuses the CONNECT, so no asset could be listed, downloaded or licence-checked. |
| Blender (scripted modelling / baking) | **Not installed**, and the brief says Blender must not be a prerequisite. |

No AI model-generation service is configured or authorised for this repository,
and the brief forbids incurring generation charges or putting generation
credentials in frontend code. So the set is produced by a committed script.

That is not purely a fallback. Generated textures have properties a downloaded
set does not: no licence or redistribution question for a public web bundle,
byte-identical reproducibility from the commit, exact control over real-world
tile size, and — because the generator emits normal and roughness at half the
base-colour resolution — a set that fits the transfer budget with room to spare.

**The remaining gap is honest:** photographed materials would still beat these at
very close range, particularly the stone and the wool rug. If Poly Haven (CC0)
becomes reachable, the swap is a file drop plus a tile-size entry in
`web/src/lobby/scene/textureSet.ts` — no code change.

## Regenerating

```bash
cd web
npm run textures
```

Deterministic: no `Math.random`, no timestamps. Re-running on the same commit
reproduces byte-identical files, so a texture change is a reviewable diff.

| | |
| --- | --- |
| Generator | `web/scripts/generate-lobby-textures.mjs` |
| PNG encoder | `web/scripts/png.mjs` — `node:zlib` only, no image dependency |
| Noise / normal-map maths | `web/scripts/noise.mjs` |
| Output | `web/public/lobby-assets/textures/` |
| Creator / provider | Generated by this repository's own script |
| Licence | Same licence as this repository. No third-party rights, no attribution required, redistribution in a browser bundle unrestricted |
| Generated | 2026-09-22 |

## Manifest

All maps are seamless. Base colour is authored sRGB; normal and roughness are
linear data — `scene/textureSet.ts` sets `texture.colorSpace` accordingly
(`SRGBColorSpace` / `NoColorSpace`).

| File | Pixels | Channels | Size |
| --- | --- | --- | --- |
| `oak-floor-basecolor.png` | 1024×1024 | RGB | 364 KB |
| `oak-floor-normal.png` | 512×512 | RGB | 316 KB |
| `oak-floor-roughness.png` | 512×512 | greyscale | 66 KB |
| `stone-basecolor.png` | 1024×1024 | RGB | 276 KB |
| `stone-normal.png` | 256×256 | RGB | 126 KB |
| `stone-roughness.png` | 256×256 | greyscale | 25 KB |
| `rug-basecolor.png` | 512×512 | RGB | 223 KB |
| `rug-normal.png` | 256×256 | RGB | 176 KB |
| `rug-roughness.png` | 256×256 | greyscale | 25 KB |
| `fabric-basecolor.png` | 512×512 | RGB | 100 KB |
| `fabric-normal.png` | 256×256 | RGB | 89 KB |
| `fabric-roughness.png` | 256×256 | greyscale | 12 KB |
| `oak-veneer-basecolor.png` | 512×512 | RGB | 82 KB |
| `oak-veneer-normal.png` | 256×256 | RGB | 70 KB |
| `oak-veneer-roughness.png` | 256×256 | greyscale | 16 KB |
| `plaster-basecolor.png` | 512×512 | RGB | 49 KB |
| `plaster-normal.png` | 256×256 | RGB | 60 KB |

**Total 2.03 MB across 17 files.**

### Real-world scale

Texture scale is derived from the tile size, not guessed, so a floorboard reads
~200 mm wide wherever it appears. Tile sizes are in
`TILE_METRES` in `scene/textureSet.ts`:

| Surface | Tile | Notes |
| --- | --- | --- |
| Oak floor | 2.4 m | 12 boards per tile, ends staggered |
| Oak veneer | 0.9 m | Repeated 3× across the 5 m desk front |
| Plaster | 2.5 m | Deliberately near-featureless; scale error imperceptible |
| Fabric | 0.4 m | 64 threads per tile |
| Stone | 1.6 m | Honed, restrained drift |
| Rug | 1.2 m | Short wool pile |

### Optimisation applied

- Normal and roughness at half base-colour resolution (a quarter of the pixels).
  The first draft shipped everything at full resolution and came to **9.14 MB**;
  this is **2.03 MB** for no visible loss, because those maps carry
  low-frequency structure and high-frequency noise is what PNG cannot deflate.
- Roughness stored as single-channel greyscale.
- PNG Sub filtering, deflate level 9.
- Anisotropy is capped by the quality profile *and* by
  `renderer.capabilities.getMaxAnisotropy()`.

## Other generated assets

| Asset | Method | Notes |
| --- | --- | --- |
| Environment map (IBL) | `scene/environment.ts` | Coloured planes rendered through `PMREMGenerator`. **0 bytes transferred.** A real HDR panorama would be multi-megabyte with its own licence; this is authored to agree with the actual light rig |
| Leaf geometry | `scene/Foliage.tsx` | Curved, tapered ribbon with a midrib channel. Solid geometry, no alpha, so no transparent overdraw |
| Signage / badges | `scene/textures.ts` | Canvas-drawn at runtime, system font stack, 0 bytes transferred |
| Contact shadows | `scene/textures.ts` | 128 px radial gradient, generated at runtime |
| The character's face | `scene/face.ts` | A parametric skull with 17 ARKit-named morph targets built as vertex deltas, plus transform-driven lids, brows, gaze and mouth. **0 bytes transferred**, and the only reason lip-sync is demonstrable at all in this build |
| The character's hair | `scene/face.ts` | Sampled from the skull itself so it hugs it, with a hairline that is high at the brow and low at the nape. A sphere cap on the crown puts the hairline across the eyes |

## Third-party code used

| Component | Source | Licence |
| --- | --- | --- |
| `RoundedBoxGeometry` | `three/examples/jsm/geometries/` | MIT, already a dependency |
| `PMREMGenerator` | `three` core | MIT, already a dependency |

No new runtime dependency was added for this phase.

---

# Replacement specification (measured, Phase 2C)

The character in the room is still the generated one. It is an **interim
demonstration character** and the original goal — a realistic human — is **not
met**. This section is what a replacement has to satisfy, written from the rig
that is actually implemented and the cost that was actually measured, so that
whoever supplies one is building against facts rather than an aspiration.

Nothing in Phase 2C changed the character. The work went into the services
behind it.

## Format and placement

| | Requirement |
| --- | --- |
| Format | glTF 2.0 binary (`.glb`), single file, self-contained |
| Units | Metres, Y-up, Z-forward |
| Origin | On the floor, between the feet |
| Facing | +Z (towards the entrance) |
| Height | 1.6–1.9 m. The rig it replaces is 1.78 m with eyes at 1.65 m |
| Placement | `receptionist` slot, `manifest.json`. Default transform puts it at (1.3, 0, −6.1) facing +Z |

## Animation roles

Authored against roles, not state names, so adding a conversation state does not
invalidate art. `idle` is the only one that is required; everything else falls
back along `CLIP_FALLBACK` to `idle`.

| Role | Plays for | Loop |
| --- | --- | --- |
| `idle` | `idle` | Loop, first and last frame identical |
| `greet` | `greeting` | **Once**, clamped |
| `listen` | `listening` | Loop |
| `think` | `processing` | Loop |
| `speak` | `speaking` | Loop |
| `gesture` | `handover` | **Once**, clamped |
| `apology` | `error` | Loop |
| `seated` | optional variant | Loop |

Authored at 30 fps or higher. No baked scale on any bone, no IK constraints or
drivers (they do not survive glTF export), one skinned mesh, one skeleton,
**≤ 80 bones**, standard humanoid naming (Mixamo or VRM) so clips retarget.

Head and eye bones must be animatable separately from the body: the lobby turns
the head to follow a visitor and leads it with the eyes. Do not bake head motion
into `idle` beyond a breath.

## Facial controls — what is actually driven

The generated rig exposes **28 drivable controls**: 17 genuine morph targets on
the head shell plus 11 driven by transform. A replacement should supply the full
ARKit 52; these are the ones the lobby writes to today, and a character
supplying only these is fully usable.

**Mouth and jaw** (these are the 17 morph targets, and they are what lip-sync
needs): `jawOpen`, `mouthClose`, `mouthFunnel`, `mouthPucker`,
`mouthSmileLeft`, `mouthSmileRight`, `mouthFrownLeft`, `mouthFrownRight`,
`mouthStretchLeft`, `mouthStretchRight`, `mouthPressLeft`, `mouthPressRight`,
`mouthShrugUpper`, `mouthRollLower`, `mouthRollUpper`, `cheekSquintLeft`,
`cheekSquintRight`.

**Eyes and brows** (transform-driven on the generated rig, blendshapes on a
supplied one): `eyeBlinkLeft`, `eyeBlinkRight`, `eyeSquintLeft`,
`eyeSquintRight`, `eyeWideLeft`, `eyeWideRight`, `browInnerUp`, `browDownLeft`,
`browDownRight`, `browOuterUpLeft`, `browOuterUpRight`.

Rules that are not negotiable:

- **`extras.targetNames` must be populated.** glTF does not carry morph-target
  names in the core specification. Without them the loader reports the character
  as having no face and drives nothing — deliberately, because guessing which
  shape is `jawOpen` from index order produces a character that chews.
- Neutral is all-zero. No corrective shapes that assume a blend order.
- Visemes: the 15 OVR shapes (`viseme_aa`, …) are used directly when present.
  **A character with only the ARKit set still gets all fifteen** — the lobby
  supplies the mapping in `reception/visemes.ts`, so supplying viseme shapes is
  an improvement, not a requirement.
- Supplying **timed viseme events with the audio** is what unlocks
  `provider-viseme`, the only mode whose timings are measured from the sound.

## Measured performance budget

From `npm run measure:avatar` at 1280×720, `balanced`, camera 1.95 m from the
character — where it occupies the most screen. These are what the generated
character costs today, and a replacement should be compared against them:

| | Environment only | With the character | Character costs |
| --- | --- | --- | --- |
| Draw calls | 196 | 246 | **+50** |
| Triangles | 29,450 | 40,254 | **+10,804** |
| Geometries | 133 | 161 | **+28** |
| Textures | 19 | 22 | **+3** |
| Shader programs | 19 | 24 | **+5** |
| Transferred | 2,411 KB | 2,411 KB | **0** (it is generated) |

Budget for a replacement: **≤ 60k triangles**, **≤ 4 materials**, textures
**≤ 2048²** (KTX2/Basis preferred), PBR metallic-roughness, Draco or Meshopt
optional. A downloaded character will not be free at transfer time the way this
one is — budget for it in the page weight.

**Facial animation is not free.** Morph targets are per-frame CPU work on the
influence array and extra GPU work sampling the morph texture; draw calls and
triangle counts do not move, which is exactly why they are the wrong thing to
measure it with. The measurement above compares idle against speaking on a
software rasteriser where the difference is inside run-to-run noise, so it
establishes that nothing structural is added — not that the cost is zero. On
real hardware, measure it with frame timing at a fixed viewport.

## Licence

The `.glb` is served as a static file from a public page, so **anyone who visits
can download it**. The licence must permit redistribution in a browser bundle.
State it in writing before the file is committed.

## Import and validation procedure

1. `cd web && npm run inspect:character -- path/to/character.glb`
   Prints what the file actually contains — clips, bones, morph-target names,
   ARKit and viseme coverage — and ends with a verdict. Configuration claiming a
   blendshape is not evidence that one exists; this is.
2. Fix anything it reports before going further. Missing `extras.targetNames` is
   the usual one.
3. Drop the `.glb` into `web/public/lobby-assets/` and point the `receptionist`
   slot at it in `manifest.json`. No rebuild, no restart.
4. Reload and walk the room: the figure should stand where the generated one
   did, and collision should still match what you see (collision comes from
   `layout.ts`, not from the art).
5. Open reception. The panel's last line reports what the lobby found in your
   file and which lip-sync mode it chose.
6. `npm run measure:avatar` and compare against the table above.
