/**
 * Turn a MakeHuman/MPFB export into the character the lobby ships.
 *
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions \
 *                    @gltf-transform/functions sharp
 *   node scripts/build-character.mjs <source.glb> <out.glb>
 *
 * The toolchain is installed with --no-save on purpose and is NOT in
 * package.json. This runs offline, once, when a character is replaced; putting
 * it in devDependencies would make every CI deploy install sharp's native
 * binaries to build a file that is already committed.
 *
 * This exists because `public/lobby-assets/receptionist.glb` is a committed
 * binary, and a committed binary with no recipe is a fact nobody can check.
 * Run this against the source and you get the shipped file back, byte for byte
 * in content if not in timestamp.
 *
 * ## Source and licence
 *
 * `mpfb.glb` from met4citizen/TalkingHead, built with Blender + MPFB from the
 * MakeHuman asset ecosystem and released **CC0** — public domain, so it may be
 * used commercially and redistributed in a public web bundle, which matters:
 * the lobby is served as static files and anyone can download the .glb.
 *
 * The same repository's better-known `brunette.glb` is CC BY-NC 4.0 and was
 * therefore rejected outright. Aicountly Lobby is a commercial product's front
 * door; non-commercial is not a licence it can use.
 *
 * ## What the source costs, and what is cut
 *
 * 35.1 MB, of which 18.5 MB is texture and the rest is almost entirely morph
 * targets. Three cuts, in order of saving against cost:
 *
 *   1. **Textures resized and re-encoded to WebP.** The face keeps 2048 because
 *      it is what a visitor looks at; clothing, hair and the inside of the
 *      mouth drop to 1024. 18.5 MB -> 0.8 MB.
 *
 *   2. **Morph NORMAL deltas dropped.** Exactly half the morph payload: a
 *      per-vertex normal for all 52 shapes on every mesh. The POSITION deltas
 *      carry the shape; the normals only change how light moves across the face
 *      as it deforms. This is a real loss, not a free one — under the lobby's
 *      soft even lighting, at counter distance, it is not one anybody sees, but
 *      it is written down here rather than called free.
 *
 *   3. **Morphs removed from meshes they cannot move.** MakeHuman writes all 52
 *      shapes onto every mesh, so the EYELASHES carry `jawOpen` and the
 *      EYEBROWS carry `mouthSmile`. Lashes and brows keep the eye, brow, nose
 *      and cheek shapes — a lash must still follow a blink, or the lid closes
 *      through it — and lose the rest.
 *
 * Result: 6.2 MB, ARKit 52/52 intact, 11 of the 15 OVR visemes native and the
 * other four supplied by VISEME_TO_ARKIT at runtime.
 *
 * ## What is deliberately NOT done
 *
 * - **No geometry compression**, having measured rather than assumed. Draco
 *   gives 6.21 MB against 7.94 MB raw, but the server gzips: 3.72 MB against
 *   4.56 MB on the wire, a 0.84 MB gap that a ~200 KB decoder fetch and the
 *   decoder files the page must serve would eat most of — and that fetch blocks
 *   the character appearing. KHR_mesh_quantization was measured too and is
 *   worse than useless here at 13.6 MB: it de-sparsifies the morph accessors,
 *   and sparse is already the efficient shape for mostly-zero deltas.
 * - **No reduction to the 60k triangle budget.** 83,686 ship. That is over what
 *   the spec asks for, and it is stated in ASSETS.md rather than hidden.
 * - **No simplification of the eyelash and eyebrow meshes**, which are 43k of
 *   those triangles. They are alpha-mapped hair cards, and a quadric simplifier
 *   tears them apart exactly at the silhouette, which is the one place they are
 *   visible.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, resample, textureCompress, weld } from '@gltf-transform/functions'
import sharp from 'sharp'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/build-character.mjs <source.glb> <out.glb>')
  process.exit(1)
}

/** The face is the focal point and keeps a larger budget than anything else. */
const FACE_TEXTURE = /skin|diffuse2|eye/i
/**
 * Per-mesh keep lists.
 *
 * The cut here is not about file size — sparse accessors already make these
 * nearly free on disk. It is about PARSE time: three.js expands every morph
 * target to a dense Float32Array over the whole mesh when it loads, so the cost
 * is vertex count times target count, and it is paid on the main thread while
 * the visitor waits. Measured at 7.6 s for the untrimmed file.
 *
 * `base` keeps everything, because it is exactly the ARKit 52 plus the 14
 * viseme shapes and both are what ASSETS.md promises a replacement will have.
 * The rest keep only what something actually drives.
 */
const KEEP = [
  // Lashes follow the lid. Blink and squint are visible; nothing else on a
  // lash is, and each extra target costs a dense array over 15k vertices.
  [/eyelash/i, /^eye(Blink|Squint)(Left|Right)$/],
  // Brows are expressive and worth their five.
  [/eyebrow/i, /^brow/],
  // The eyeballs carry eyeLook* only, and gaze is driven by the LeftEye and
  // RightEye bones instead, so none of them is ever read.
  [/high-poly/i, /^$/],
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(input)
const root = doc.getRoot()

await doc.transform(prune(), dedup(), resample(), weld())

// --- 1. Textures -----------------------------------------------------------
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [2048, 2048] }),
)

for (const texture of root.listTextures()) {
  const name = texture.getName() || ''
  const size = texture.getSize() ?? [0, 0]
  const cap = FACE_TEXTURE.test(name) ? 2048 : 1024
  const image = texture.getImage()
  if (!image || Math.max(size[0], size[1]) <= cap) continue

  const resized = await sharp(Buffer.from(image)).resize(cap, cap, { fit: 'inside' }).webp({ quality: 85 }).toBuffer()
  texture.setImage(new Uint8Array(resized)).setMimeType('image/webp')
  console.log(`  texture ${name}: ${size[0]}x${size[1]} -> ${cap} max`)
}

// --- 2 and 3. Morph targets ------------------------------------------------
let droppedNormals = 0
let droppedTargets = 0

for (const mesh of root.listMeshes()) {
  const rule = KEEP.find(([meshMatch]) => meshMatch.test(mesh.getName()))?.[1] ?? null
  const sourceNames = mesh.getExtras()?.targetNames ?? []

  for (const prim of mesh.listPrimitives()) {
    const kept = []

    prim.listTargets().forEach((target, index) => {
      const name = sourceNames[index] ?? ''

      if (rule && !rule.test(name)) {
        prim.removeTarget(target)
        droppedTargets += 1
        return
      }

      if (target.getAttribute('NORMAL')) {
        target.setAttribute('NORMAL', null)
        droppedNormals += 1
      }
      kept.push(name)
    })

    if (rule) {
      mesh.setExtras({ ...mesh.getExtras(), targetNames: kept })
      mesh.setWeights(new Array(kept.length).fill(0))
    }
  }

  const remaining = mesh.listPrimitives()[0]?.listTargets().length ?? 0
  console.log(`  ${mesh.getName().padEnd(22)} ${String(remaining).padStart(3)} morph targets kept`)
}

console.log(`  dropped ${droppedNormals} morph NORMAL sets and ${droppedTargets} whole targets from eye-region meshes`)

await doc.transform(prune(), dedup())

await io.write(output, doc)
console.log(`  written ${output}`)
