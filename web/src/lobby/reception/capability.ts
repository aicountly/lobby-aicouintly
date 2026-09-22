/**
 * What a character can actually do.
 *
 * Configuration says a character has fifty-two blendshapes; the file says
 * otherwise more often than not. Everything downstream — which clip plays, which
 * lip-sync mode runs, whether captions are the only honest option — is decided
 * from a probe of the loaded object, never from the manifest. The manifest is
 * consulted for *names* (which clip is `idle`) and for nothing else.
 *
 * `scripts/inspect-character.mjs` answers the same question offline, against a
 * .glb on disk, so a character can be checked before anyone wires it up.
 */
import type { AnimationClip, Mesh, Object3D } from 'three'

import { CLIP_FALLBACK, RECEPTIONIST_CLIPS, RECEPTIONIST_STATE_CLIPS, RECEPTIONIST_STATES } from '../assets/assetConfig'
import type { AnimationMapping, ReceptionistClip, ReceptionistState } from '../assets/assetConfig'
import { FACE_CONTROLS, OVR_VISEMES } from './visemes'
import type { FaceControl, OvrViseme } from './visemes'

/** How the mouth is driven. Mode A, Mode B, Mode C. */
export type LipSyncMode = 'timed' | 'audio' | 'none'

export interface FaceCapability {
  /** ARKit-named controls the character can actually move. */
  controls: readonly FaceControl[]
  /** Native `viseme_*` shapes, if the character shipped them. */
  nativeVisemes: readonly OvrViseme[]
  canBlink: boolean
  /** Enough mouth controls to form distinguishable visemes. */
  canShapeMouth: boolean
  /** At minimum a jaw, which is all an audio envelope needs. */
  canOpenJaw: boolean
}

export interface CharacterCapability {
  source: 'procedural' | 'gltf'
  name: string
  /**
   * False when there is no character at all — Standard View, or before the
   * scene has reported. Distinguishing "no character" from "a character that
   * can do nothing" is what stops the panel describing an empty page as a
   * procedural figure with no face.
   */
  mounted: boolean
  skinned: boolean
  bones: number
  /** Role -> the clip name that will be played for it, after fallback. */
  clipsByRole: Record<ReceptionistClip, string | null>
  /** Roles the character supplies directly, before fallback. */
  rolesProvided: readonly ReceptionistClip[]
  /** States with a clip of their own rather than a borrowed one. */
  statesWithOwnClip: readonly ReceptionistState[]
  face: FaceCapability
  /** Plain-language notes for the interface and the handover report. */
  notes: readonly string[]
}

const NO_FACE: FaceCapability = {
  controls: [],
  nativeVisemes: [],
  canBlink: false,
  canShapeMouth: false,
  canOpenJaw: false,
}

/** Build a face capability from a list of control names that can be moved. */
export function faceCapabilityFrom(names: Iterable<string>): FaceCapability {
  const present = new Set(names)
  const controls = FACE_CONTROLS.filter((control) => present.has(control))
  const nativeVisemes = OVR_VISEMES.filter(
    (viseme) => present.has(`viseme_${viseme}`) || present.has(viseme),
  )
  const has = (control: FaceControl) => controls.includes(control)
  // Three or more of the shaping controls, plus a jaw, is the point at which
  // "aa", "oh", "ou" and "PP" stop looking like the same shape.
  const shaping = (['mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthStretchLeft', 'mouthClose'] as const)
    .filter(has).length
  return {
    controls,
    nativeVisemes,
    canBlink: has('eyeBlinkLeft') || has('eyeBlinkRight'),
    canShapeMouth: nativeVisemes.length >= 8 || (has('jawOpen') && shaping >= 3),
    canOpenJaw: has('jawOpen'),
  }
}

/**
 * Which lip-sync mode to run.
 *
 * Preference order is a statement about quality: a schedule built from the text
 * knows what sound is coming and can shape the mouth for it, while an envelope
 * only knows how loud the last frame was and can do nothing but open and close.
 * Envelope-driving is the better answer only when there is audio and no text —
 * a voice the lobby did not author — and captions are the honest answer when
 * the character has no mouth to drive.
 */
export function chooseLipSyncMode(
  face: FaceCapability,
  sources: { analyser: boolean; text: boolean },
): LipSyncMode {
  if (face.canShapeMouth && sources.text) return 'timed'
  if (face.canOpenJaw && sources.analyser) return 'audio'
  if (face.canShapeMouth) return 'timed'
  return 'none'
}

export function describeLipSyncMode(mode: LipSyncMode): string {
  switch (mode) {
    case 'timed':
      return 'Mouth shapes scheduled from the reply text and corrected against the speaker’s word boundaries.'
    case 'audio':
      return 'Jaw driven by the loudness of the audio being played. No mouth shapes.'
    case 'none':
      return 'No facial animation. Body animation and on-screen captions only.'
  }
}

/** Resolve one role to a clip name, walking the fallback chain. */
function resolveRole(
  role: ReceptionistClip,
  available: Set<string>,
  mapping: AnimationMapping,
): string | null {
  const chain = [role, ...CLIP_FALLBACK[role]]
  for (const candidate of chain) {
    const named = mapping[candidate]
    if (named && available.has(named)) return named
    // A character whose clips happen to be called `idle`, `Idle` or `IDLE`
    // should not need a manifest entry to say so.
    for (const name of available) {
      if (name.toLowerCase() === candidate.toLowerCase()) return name
    }
  }
  return null
}

/**
 * Probe a loaded glTF.
 *
 * Reads clips from what the loader returned and morph names from
 * `morphTargetDictionary`, which three.js populates from `extras.targetNames`.
 * A character exported without those names has morph targets the lobby cannot
 * address, and is reported as having no face rather than being driven by index
 * order — guessing which shape is `jawOpen` produces a character that chews.
 */
export function describeGltfCharacter(
  root: Object3D,
  clips: readonly AnimationClip[],
  mapping: AnimationMapping = {},
  name = 'supplied character',
): CharacterCapability {
  const available = new Set(clips.map((clip) => clip.name))
  const morphNames = new Set<string>()
  let bones = 0
  let skinned = false
  let unnamedMorphs = 0

  root.traverse((child: Object3D) => {
    if ((child as { isBone?: boolean }).isBone) bones += 1
    const mesh = child as Mesh & { morphTargetDictionary?: Record<string, number> }
    if (!mesh.isMesh) return
    if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true
    const dictionary = mesh.morphTargetDictionary
    if (dictionary) for (const key of Object.keys(dictionary)) morphNames.add(key)
    else {
      const count = mesh.geometry?.morphAttributes?.position?.length ?? 0
      unnamedMorphs += count
    }
  })

  const clipsByRole = {} as Record<ReceptionistClip, string | null>
  const rolesProvided: ReceptionistClip[] = []
  for (const role of RECEPTIONIST_CLIPS) {
    const direct = mapping[role]
    const exact =
      (direct && available.has(direct) ? direct : null) ??
      [...available].find((clip) => clip.toLowerCase() === role.toLowerCase()) ??
      null
    if (exact) rolesProvided.push(role)
    clipsByRole[role] = resolveRole(role, available, mapping)
  }

  const face = faceCapabilityFrom(morphNames)
  const notes: string[] = []
  if (!skinned) notes.push('The character is not skinned, so body clips cannot play.')
  if (clips.length === 0) notes.push('The file contains no animation clips.')
  if (unnamedMorphs > 0) {
    notes.push(
      `${unnamedMorphs} morph target(s) have no names (extras.targetNames is missing), so they cannot be addressed and are left at zero.`,
    )
  }
  if (face.controls.length === 0 && face.nativeVisemes.length === 0 && morphNames.size > 0) {
    notes.push(
      `The character has ${morphNames.size} morph target(s), but none use ARKit or OVR names, so none can be driven.`,
    )
  }

  return {
    source: 'gltf',
    name,
    mounted: true,
    skinned,
    bones,
    clipsByRole,
    rolesProvided,
    statesWithOwnClip: statesWithOwnClip(rolesProvided),
    face: skinned || clips.length > 0 ? face : { ...face },
    notes,
  }
}

/** The capability of the lobby's own procedural character. */
export function proceduralCapability(face: FaceCapability, name = 'procedural receptionist'): CharacterCapability {
  const clipsByRole = {} as Record<ReceptionistClip, string | null>
  // The procedural figure is posed in code rather than by an AnimationMixer, so
  // every role is "provided" without a clip name behind it. Saying so plainly
  // beats inventing clip names that do not exist anywhere.
  for (const role of RECEPTIONIST_CLIPS) clipsByRole[role] = role === 'seated' ? null : `procedural:${role}`
  const rolesProvided = RECEPTIONIST_CLIPS.filter((role) => role !== 'seated')
  return {
    source: 'procedural',
    name,
    mounted: true,
    skinned: false,
    bones: 0,
    clipsByRole,
    rolesProvided,
    statesWithOwnClip: statesWithOwnClip(rolesProvided),
    face,
    notes: [
      'Stylised procedural character, not a scanned or sculpted human. Posed in code; there is no skeleton and no imported clip.',
    ],
  }
}

export const NO_CHARACTER: CharacterCapability = {
  source: 'procedural',
  name: 'none',
  mounted: false,
  skinned: false,
  bones: 0,
  clipsByRole: Object.fromEntries(RECEPTIONIST_CLIPS.map((role) => [role, null])) as Record<
    ReceptionistClip,
    string | null
  >,
  rolesProvided: [],
  statesWithOwnClip: [],
  face: NO_FACE,
  notes: ['No character is mounted.'],
}

function statesWithOwnClip(rolesProvided: readonly ReceptionistClip[]): ReceptionistState[] {
  return RECEPTIONIST_STATES.filter((state) => rolesProvided.includes(RECEPTIONIST_STATE_CLIPS[state]))
}

/** One-line summary for the interface's capability panel. */
export function summariseCapability(capability: CharacterCapability, mode: LipSyncMode): string {
  if (!capability.mounted) {
    return 'No 3D character is shown here, so replies are text only.'
  }
  const roles = capability.rolesProvided.length
  const face =
    capability.face.nativeVisemes.length > 0
      ? `${capability.face.nativeVisemes.length}/15 visemes`
      : capability.face.controls.length > 0
        ? `${capability.face.controls.length} facial controls`
        : 'no facial controls'
  return `${capability.source === 'gltf' ? 'Supplied model' : 'Procedural character'}: ${roles}/${RECEPTIONIST_CLIPS.length} animation roles, ${face}, lip-sync ${mode}.`
}
