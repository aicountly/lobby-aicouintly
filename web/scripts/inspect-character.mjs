/**
 * Inspect a .glb against the receptionist contract in docs/lobby/ASSETS.md.
 *
 *   node scripts/inspect-character.mjs path/to/character.glb [--json]
 *
 * Reads the glTF JSON chunk directly — no three.js, no loader, no browser — and
 * reports what the file *actually* contains: clips, joints, morph targets and
 * their names. Configuration declaring a blendshape does not mean a character
 * ships one, so this is the only thing that settles the question.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/** Roles src/lobby/assets/assetConfig.ts can drive. */
const BODY_ROLES = ['idle', 'greet', 'listen', 'speak', 'gesture', 'seated']

/** The 15 Oculus/OVR visemes a speaking character needs. */
const OVR_VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou']

/** The ARKit blendshape set, 52 shapes, as Apple names them. */
const ARKIT = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft',
  'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft',
  'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
]

function readGlb(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a .glb (bad magic)`)
  const version = buf.readUInt32LE(4)
  let offset = 12
  let json = null
  let binLength = 0
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    const body = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === 0x004e4942) binLength = length
    offset += 8 + length + ((4 - (length % 4)) % 4)
  }
  if (!json) throw new Error(`${file} has no JSON chunk`)
  return { json, version, binLength, fileBytes: buf.length }
}

/** Triangles implied by a primitive, from its indices or its position count. */
function primitiveTriangles(gltf, primitive) {
  const mode = primitive.mode ?? 4
  if (mode !== 4) return 0
  const accessor =
    primitive.indices !== undefined ? gltf.accessors?.[primitive.indices] : gltf.accessors?.[primitive.attributes?.POSITION]
  return accessor ? Math.floor(accessor.count / 3) : 0
}

/** Clip length in seconds: the largest keyframe time across its samplers. */
function clipDuration(gltf, animation) {
  let longest = 0
  for (const sampler of animation.samplers ?? []) {
    const input = gltf.accessors?.[sampler.input]
    const end = input?.max?.[0]
    if (typeof end === 'number' && end > longest) longest = end
  }
  return longest
}

function inspect(file) {
  const { json: gltf, version, binLength, fileBytes } = readGlb(file)

  const meshes = (gltf.meshes ?? []).map((mesh, index) => {
    const primitives = mesh.primitives ?? []
    // Morph-target names live in mesh.extras.targetNames; glTF core has no place
    // for them, so a file without extras gives index order and nothing else.
    const targetNames = mesh.extras?.targetNames ?? null
    const targetCount = primitives[0]?.targets?.length ?? 0
    return {
      index,
      name: mesh.name ?? `mesh_${index}`,
      primitives: primitives.length,
      triangles: primitives.reduce((total, p) => total + primitiveTriangles(gltf, p), 0),
      skinned: primitives.some((p) => p.attributes?.JOINTS_0 !== undefined),
      morphTargets: targetCount,
      targetNames,
    }
  })

  const skins = (gltf.skins ?? []).map((skin, index) => ({
    index,
    name: skin.name ?? `skin_${index}`,
    joints: skin.joints?.length ?? 0,
    jointNames: (skin.joints ?? []).map((j) => gltf.nodes?.[j]?.name ?? `node_${j}`),
  }))

  const animations = (gltf.animations ?? []).map((animation, index) => ({
    index,
    name: animation.name ?? `animation_${index}`,
    seconds: Number(clipDuration(gltf, animation).toFixed(3)),
    channels: animation.channels?.length ?? 0,
    // A clip that drives `weights` animates morph targets, not bones.
    paths: [...new Set((animation.channels ?? []).map((c) => c.target?.path))].sort(),
  }))

  const morphNames = meshes.flatMap((m) => m.targetNames ?? [])
  const textures = (gltf.images ?? []).map((image, index) => ({
    index,
    name: image.name ?? `image_${index}`,
    mimeType: image.mimeType ?? 'unknown',
    bytes: image.bufferView !== undefined ? (gltf.bufferViews?.[image.bufferView]?.byteLength ?? 0) : 0,
  }))

  const clipNames = animations.map((a) => a.name)
  const lower = new Map(clipNames.map((n) => [n.toLowerCase(), n]))
  const roleMatches = Object.fromEntries(
    BODY_ROLES.map((role) => [
      role,
      lower.get(role) ?? clipNames.find((n) => n.toLowerCase().includes(role)) ?? null,
    ]),
  )

  const morphSet = new Set(morphNames)
  const arkitPresent = ARKIT.filter((n) => morphSet.has(n))
  const visemesPresent = OVR_VISEMES.filter((n) => morphSet.has(n) || morphSet.has(`viseme_${n}`))

  return {
    file: basename(file),
    fileBytes,
    gltfVersion: version,
    binBytes: binLength,
    generator: gltf.asset?.generator ?? 'unknown',
    copyright: gltf.asset?.copyright ?? null,
    extensionsUsed: gltf.extensionsUsed ?? [],
    extensionsRequired: gltf.extensionsRequired ?? [],
    nodes: gltf.nodes?.length ?? 0,
    materials: gltf.materials?.length ?? 0,
    triangles: meshes.reduce((total, m) => total + m.triangles, 0),
    meshes,
    skins,
    animations,
    textures,
    capability: {
      skinned: skins.length > 0,
      bones: skins.reduce((most, s) => Math.max(most, s.joints), 0),
      bodyRoles: roleMatches,
      morphTargetCount: morphNames.length,
      morphTargetsNamed: morphNames.length > 0,
      arkitPresent,
      arkitMissing: ARKIT.filter((n) => !morphSet.has(n)),
      visemesPresent,
      visemesMissing: OVR_VISEMES.filter((n) => !morphSet.has(n) && !morphSet.has(`viseme_${n}`)),
    },
  }
}

function report(result) {
  const c = result.capability
  const lines = []
  lines.push(`${result.file}  —  ${(result.fileBytes / 1024).toFixed(0)} KB, glTF ${result.gltfVersion}`)
  lines.push(`  generator      ${result.generator}`)
  if (result.copyright) lines.push(`  copyright      ${result.copyright}`)
  lines.push(`  geometry       ${result.triangles.toLocaleString()} triangles, ${result.materials} materials, ${result.nodes} nodes`)
  lines.push(`  extensions     ${result.extensionsUsed.length ? result.extensionsUsed.join(', ') : 'none'}`)
  lines.push(`  skinned        ${c.skinned ? `yes, ${c.bones} bones` : 'NO — cannot play body clips'}`)
  lines.push(`  clips (${result.animations.length})`)
  for (const a of result.animations) {
    lines.push(`    ${a.name.padEnd(22)} ${String(a.seconds).padStart(6)}s  ${a.channels} channels  [${a.paths.join(' ')}]`)
  }
  lines.push('  role coverage')
  for (const [role, clip] of Object.entries(c.bodyRoles)) {
    lines.push(`    ${role.padEnd(10)} ${clip ? `-> ${clip}` : '-- none'}`)
  }
  lines.push(`  morph targets  ${c.morphTargetCount === 0 ? 'NONE — no facial animation possible' : `${c.morphTargetCount} named`}`)
  for (const mesh of result.meshes.filter((m) => m.morphTargets > 0)) {
    const named = mesh.targetNames ? mesh.targetNames.join(', ') : `UNNAMED (${mesh.morphTargets}) — extras.targetNames missing`
    lines.push(`    ${mesh.name}: ${named}`)
  }
  lines.push(`  ARKit 52       ${c.arkitPresent.length}/52 present`)
  lines.push(`  OVR visemes    ${c.visemesPresent.length}/15 present`)
  const verdict = !c.skinned
    ? 'NOT USABLE — not skinned'
    : !c.bodyRoles.idle
      ? 'PARTIAL — no idle clip; the lobby needs one'
      : c.visemesPresent.length >= 8
        ? 'FULL — body clips and visemes; lip-sync possible'
        : c.morphTargetCount > 0
          ? 'PARTIAL — body clips and some morphs, but no viseme set; lip-sync not possible'
          : 'BODY ONLY — clips play, face cannot move'
  lines.push(`  verdict        ${verdict}`)
  return lines.join('\n')
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0) {
  console.error('usage: node scripts/inspect-character.mjs <file.glb> [more.glb ...] [--json]')
  process.exit(2)
}
const results = files.map(inspect)
console.log(asJson ? JSON.stringify(results, null, 2) : results.map(report).join('\n\n'))
