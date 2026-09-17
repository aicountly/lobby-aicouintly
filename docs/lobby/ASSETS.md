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
