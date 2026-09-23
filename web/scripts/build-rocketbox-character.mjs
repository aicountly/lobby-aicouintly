/**
 * Microsoft RocketBox FBX -> the lobby's receptionist GLB.
 *
 *   npm i --no-save three sharp        # three is already a dependency
 *   node scripts/build-rocketbox-character.mjs <avatar_facial.fbx> <textureDir> <out.glb>
 *
 * Installed with --no-save and deliberately not in package.json: this runs
 * offline, once, when the character is replaced. Putting it in devDependencies
 * would make every CI deploy build sharp's native binaries to produce a file
 * that is already committed.
 *
 * ## Source and licence
 *
 * Microsoft RocketBox (github.com/microsoft/Microsoft-Rocketbox), **MIT**. 115
 * rigged human avatars, released for commercial as well as research use, with
 * ARKit blendshapes contributed in 2022. `Business_Female_01` was chosen: a
 * tailored trouser suit, light blouse and low heels, which is the silhouette
 * the approved reference asks for, on a warm medium complexion.
 *
 * MIT permits redistribution in a public web bundle, which matters here — the
 * lobby is served as static files and anyone can download the .glb.
 *
 * ## What this converts, and why each step exists
 *
 * 1. **Centimetres to metres.** RocketBox exports at 3ds Max scale: this avatar
 *    is 174 units tall. The lobby is metric and the floor plan in ASSETS.md is
 *    in metres, so everything is scaled by 0.01.
 *
 * 2. **Morph target names are normalised.** They arrive as
 *    `blendShape1.AK_25_JawOpen` and `blendShape1.AA_VI_10_aa`. The lobby drives
 *    plain ARKit names (`jawOpen`) and `viseme_*`, so the prefixes are stripped
 *    and the names lower-cased to match. Every rename is written to a mapping
 *    file next to the model rather than being invisible.
 *
 * 3. **Unused morph sets are dropped.** The file carries 175 targets: the ARKit
 *    52, the 15 OVR visemes, 42 Vive facial-tracker shapes and a FACS set.
 *    Nothing in the lobby drives the last two, and every target costs a dense
 *    Float32Array over the whole mesh at load time.
 *
 * 4. **Textures: TGA to WebP.** The source ships 12-16 MB uncompressed TGA per
 *    map. three's TGALoader decodes them; sharp re-encodes.
 *
 * 5. **The suit is recoloured to emerald**, selectively. The body map holds the
 *    suit AND the hands, so a global tint would turn the skin green. Only
 *    pixels that are dark and desaturated — the charcoal suit — are mapped,
 *    and their luminance variation is preserved so the fabric keeps its folds.
 */
globalThis.self = globalThis
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
globalThis.document = {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1 }),
  createElement: () => ({ style: {}, getContext: () => null }),
}
// GLTFExporter converts its output Blob with a FileReader. Node has Blob but
// not FileReader, and the exporter only ever uses readAsArrayBuffer.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
      .catch((error) => this.onerror?.(error))
  }
}

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import sharp from 'sharp'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, prune, sparse, weld } from '@gltf-transform/functions'

const [, , fbxPath, textureDir, outPath] = process.argv
if (!fbxPath || !textureDir || !outPath) {
  console.error('usage: node scripts/build-rocketbox-character.mjs <avatar_facial.fbx> <textureDir> <out.glb>')
  process.exit(1)
}

/** RocketBox units are centimetres; the lobby is metric. */
const SCALE = 0.01

/**
 * Recolouring the suit is OFF, and this is the reason.
 *
 * The approved reference asks for a deep emerald blazer. The obvious approach —
 * repaint the dark, desaturated pixels of the body map — was tried and rendered
 * in the preview harness, and it fails: RocketBox packs the SUIT, the SKIN and
 * the BLOUSE into one atlas, so no luminance-and-chroma rule separates them.
 * Skin in shadow is also dark and desaturated, so the hands and the lower legs
 * turned green while parts of the trousers stayed skin-toned.
 *
 * Separating them properly needs a UV region mask, which is authored per model
 * and cannot be derived from the texture alone. Until one exists the suit ships
 * in its original charcoal, which is a correct business suit rather than a
 * broken green one. ASSETS.md records this as an outstanding difference from
 * the reference rather than pretending it was met.
 */
const RECOLOUR_SUIT = false

// ---------------------------------------------------------------------------

const fbxBuffer = readFileSync(fbxPath)
const root = new FBXLoader().parse(
  fbxBuffer.buffer.slice(fbxBuffer.byteOffset, fbxBuffer.byteOffset + fbxBuffer.byteLength),
  '',
)

// --- Scale -----------------------------------------------------------------
root.scale.setScalar(SCALE)
root.updateMatrixWorld(true)

// --- Morph targets: normalise the names the lobby drives, drop the rest -----
//
// `blendShape1.AK_25_JawOpen`  -> `jawOpen`
// `blendShape1.AA_VI_10_aa`    -> `viseme_aa`
function normaliseMorphName(raw) {
  const arkit = raw.match(/AK_\d+_(.+)$/)
  if (arkit) return arkit[1].charAt(0).toLowerCase() + arkit[1].slice(1)

  const viseme = raw.match(/AA_VI_\d+_(.+)$/)
  if (viseme) {
    // RocketBox spells four of the fifteen differently from the Oculus set the
    // lobby drives. Renaming here means VISEME_TO_ARKIT and the native-viseme
    // path both work untouched; leaving them would silently lose four shapes.
    const OVR = { Sil: 'sil', KK: 'kk', I: 'ih', O: 'oh', U: 'ou' }
    const key = viseme[1]
    return `viseme_${OVR[key] ?? key}`
  }
  return null
}

const mapping = { source: 'Microsoft RocketBox Business_Female_01', licence: 'MIT', meshes: [] }

root.traverse((object) => {
  if (!object.isMesh || !object.morphTargetDictionary) return

  const geometry = object.geometry
  const sourceNames = Object.keys(object.morphTargetDictionary)
  const keptPositions = []
  const keptNormals = []
  const record = []

  for (const sourceName of sourceNames) {
    const target = normaliseMorphName(sourceName)
    if (!target) continue
    const index = object.morphTargetDictionary[sourceName]
    const position = geometry.morphAttributes.position?.[index]
    if (!position) continue
    keptPositions.push(position)
    // Normals are dropped: they are half the morph payload and only change how
    // light moves across a deforming face, which is not visible at this size.
    record.push({ source: sourceName, target, index: keptPositions.length - 1 })
  }

  geometry.morphAttributes.position = keptPositions
  delete geometry.morphAttributes.normal
  geometry.morphTargetsRelative = geometry.morphTargetsRelative ?? false

  object.morphTargetDictionary = {}
  object.morphTargetInfluences = []
  record.forEach((entry) => {
    object.morphTargetDictionary[entry.target] = entry.index
    object.morphTargetInfluences[entry.index] = 0
  })

  // glTF carries morph names in extras; without this the lobby sees indices.
  geometry.userData.targetNames = record.map((entry) => entry.target)
  object.userData.targetNames = record.map((entry) => entry.target)

  mapping.meshes.push({
    mesh: object.name,
    kept: record.length,
    droppedFromSource: sourceNames.length - record.length,
    targets: record.map(({ source, target }) => ({ source, target, range: [0, 1], neutral: 0 })),
  })

  console.log(`  ${object.name}: kept ${record.length} of ${sourceNames.length} morph targets`)
})

// --- Textures ---------------------------------------------------------------
const tgaLoader = new TGALoader()

function decodeTga(file) {
  const buffer = readFileSync(join(textureDir, file))
  // TGALoader returns { data, width, height } here rather than a Texture: it
  // hands back the decoded RGBA buffer directly, which is what sharp wants.
  const decoded = tgaLoader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
  return { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height }
}

const bodyMap = decodeTga('f014_body_color.tga')
const headMap = decodeTga('f014_head_color.tga')
const opacityMap = decodeTga('f014_opacity_color.tga')

async function encodeWebp({ data, width, height }, cap) {
  let pipe = sharp(data, { raw: { width, height, channels: 4 } })
  if (Math.max(width, height) > cap) pipe = pipe.resize(cap, cap, { fit: 'inside' })
  const encoded = await pipe.webp({ quality: 88 }).toBuffer()
  console.log(`  texture ${width}x${height} -> ${Math.min(cap, width)} max, ${(encoded.byteLength / 1024).toFixed(0)} KB webp`)
  return encoded
}

const images = {
  body: await encodeWebp(bodyMap, 1024),
  head: await encodeWebp(headMap, 2048),
  opacity: await encodeWebp(opacityMap, 1024),
}

// --- Stage 1: geometry, skin and morphs out of three ------------------------
//
// Textures are stripped first. GLTFExporter serialises an image by drawing it
// to a canvas, and there is no DOM here; glTF-Transform attaches them in stage
// two instead, which is headless by design.
root.traverse((object) => {
  if (!object.isMesh) return
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  const converted = materials.map((material) => {
    if (!material) return material
    // FBX arrives as Phong. glTF is metallic-roughness, and the brief asks for
    // physically based materials, so convert rather than let the exporter
    // approximate: skin and wool want restrained highlights, not a specular
    // lobe inherited from a 3ds Max import.
    const standard = new THREE.MeshStandardMaterial({
      name: material.name,
      color: material.color ? material.color.clone() : undefined,
      roughness: 0.82,
      metalness: 0,
      side: material.side,
      transparent: false,
    })
    return standard
  })
  object.material = Array.isArray(object.material) ? converted : converted[0]
})

const glb = await new Promise((resolve, reject) => {
  new GLTFExporter().parse(
    root,
    (result) => resolve(Buffer.from(result)),
    (error) => reject(error),
    { binary: true, onlyVisible: false, includeCustomExtensions: true },
  )
})
console.log(`  stage 1: ${(glb.byteLength / 1048576).toFixed(2)} MB from three`)

// --- Stage 2: attach the textures and finish --------------------------------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.readBinary(new Uint8Array(glb))
const docRoot = doc.getRoot()
doc.createExtension(EXTTextureWebP).setRequired(false)

/**
 * Flip V on every UV set.
 *
 * FBX and glTF disagree about which end of the texture V=0 is. three's
 * FBXLoader compensates by setting `flipY` on the textures it creates, but
 * those textures are stripped before export — so the UVs leave here in FBX
 * convention and glTF reads them upside down.
 *
 * It is not subtle when it happens: the legs sampled the hands at the top of
 * the body atlas, and the mouth rendered on the throat.
 */
function flipTextureCoordinates(document) {
  const seen = new Set()
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (!semantic.startsWith('TEXCOORD')) continue
        const accessor = primitive.getAttribute(semantic)
        if (!accessor || seen.has(accessor)) continue
        seen.add(accessor)
        const array = accessor.getArray()
        for (let i = 1; i < array.length; i += 2) array[i] = 1 - array[i]
        accessor.setArray(array)
      }
    }
  }
  return seen.size
}

function attach(material, buffer, label) {
  const texture = doc.createTexture(label).setImage(new Uint8Array(buffer)).setMimeType('image/webp')
  material.setBaseColorTexture(texture)
  return texture
}

console.log(`  flipped V on ${flipTextureCoordinates(doc)} UV accessor(s)`)

for (const material of docRoot.listMaterials()) {
  const name = (material.getName() || '').toLowerCase()
  if (name.includes('head')) attach(material, images.head, 'head')
  else if (name.includes('opacity')) {
    attach(material, images.opacity, 'hair')
    // Hair and lashes are alpha-mapped cards; without MASK they render as
    // opaque rectangles around every strand.
    material.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true)
  } else attach(material, images.body, 'body')

  // Restrained highlights: skin and wool are not wet plastic.
  material.setRoughnessFactor(0.82).setMetallicFactor(0)
  console.log(`  material ${material.getName()} -> textured`)
}

// Morph target names live in mesh extras in glTF; three writes them only
// sometimes, so they are set explicitly and then verified by the inspector.
for (const mesh of docRoot.listMeshes()) {
  const names = mapping.meshes.find((entry) => entry.kept)?.targets.map((t) => t.target)
  if (names && mesh.listPrimitives()[0]?.listTargets().length === names.length) {
    mesh.setExtras({ ...mesh.getExtras(), targetNames: names })
  }
}

// Weld first, and it is the single biggest win here. The FBX geometry is
// NON-INDEXED — 8,966 triangles written as 26,898 separate vertices — so every
// one of the 67 morph targets stored three copies of each shared vertex.
// Indexing collapses that before anything else is measured.
//
// Then sparse accessors, because a facial shape moves the face and leaves the
// suit, the shoes and the back of the head untouched.
await doc.transform(weld(), prune(), dedup(), sparse({ ratio: 0.5 }))
await io.write(outPath, doc)

writeFileSync(outPath.replace(/\.glb$/, '.mapping.json'), JSON.stringify(mapping, null, 2) + '\n')
console.log(`  written ${outPath}`)
console.log(`  mapping ${outPath.replace(/\.glb$/, '.mapping.json')}`)
