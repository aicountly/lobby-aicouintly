# Replacing the lobby's 3D placeholders

Everything you can see in Aicountly Lobby is generated in the browser from
primitives — there is not one texture or model file in the repository. That is
deliberate: a fresh clone renders a complete, navigable room with nothing to
download and nothing to license.

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

The placeholder is a blocked-out figure with no face. It is a stand-in and
nothing more: **this phase implements no facial animation, no lip-sync, no voice
and no speech synthesis.** The requirements below describe what a final
character must provide so those become possible, not what exists today.

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

| Role | Used for | Required |
| --- | --- | --- |
| `idle` | Standing at the counter | **Yes** — the only clip this phase plays |
| `greet` | A visitor arriving at reception | Later phase |
| `listen` | Visitor is typing or speaking | Later phase |
| `speak` | Reception is answering | Later phase |
| `gesture` | Pointing towards lounge or meeting rooms | Later phase |
| `seated` | Seated variant | Optional |

Every clip must loop cleanly (first and last frame identical for `idle` and
`listen`) and be authored at 30 fps or higher.

### Facial controls

Required only for a character intended to speak in a later phase:

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
  `kk`, `CH`, `SS`, `nn`, `RR`, `aa`, `E`, `ih`, `oh`, `ou`), supplied either as
  additional blendshapes or as a documented mapping onto the ARKit set.
- Visemes must be drivable independently of the body clips: mouth shapes will be
  applied on top of `speak`, not baked into it.
- Head and eye bones must be animatable separately from the body for future
  look-at, so do not bake head motion into `idle` beyond a subtle breath.

Whoever supplies the character should also state whether the licence permits
redistribution in a public web bundle — the lobby is served as static files, so
the `.glb` is downloadable by anyone who visits.

## Checking a replacement

1. Drop the `.glb` into `web/public/lobby-assets/`.
2. Point its slot at it in `manifest.json`.
3. Reload the lobby. No rebuild, no restart.
4. Walk the room: the piece should sit exactly where the placeholder did, and
   collision should still match what you see.

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

## Third-party code used

| Component | Source | Licence |
| --- | --- | --- |
| `RoundedBoxGeometry` | `three/examples/jsm/geometries/` | MIT, already a dependency |
| `PMREMGenerator` | `three` core | MIT, already a dependency |

No new runtime dependency was added for this phase.
