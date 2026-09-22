/**
 * Asset configuration: how final 3D art replaces the procedural lobby.
 *
 * Every replaceable part of the room is a *slot*. A slot with `url: null` keeps
 * the procedural geometry, which is why a fresh clone renders a complete room
 * with no downloads, no licences and no build step. Point a slot at a glTF and
 * the placeholder for that slot is never mounted — the room, the furniture and
 * the receptionist swap independently of one another.
 *
 * Nothing here is baked into the bundle: `/lobby-assets/manifest.json` is read
 * at runtime, so dropping in final art is a file copy, not a rebuild.
 *
 * The rig, clip and blendshape requirements a final character must satisfy are
 * written out in docs/lobby/ASSETS.md. What a character *declares* here and what
 * it actually ships are different things, and only the second one matters — see
 * `reception/capability.ts`, which probes the loaded file and drives the
 * receptionist from what it finds rather than from this file.
 */
import { RECEPTIONIST_SPOT } from '../layout'

/** Placement of a loaded model, applied to the glTF's root node. */
export interface AssetTransform {
  position: [number, number, number]
  /** Degrees, XYZ order. Degrees because manifests are written by hand. */
  rotationDegrees: [number, number, number]
  scale: number | [number, number, number]
}

/**
 * Animation roles the lobby knows how to drive.
 *
 * A character is authored against this list rather than against state names, so
 * that adding a conversation state does not invalidate art that already exists.
 */
export const RECEPTIONIST_CLIPS = [
  'idle',
  'greet',
  'listen',
  'think',
  'speak',
  'gesture',
  'apology',
  'seated',
] as const

export type ReceptionistClip = (typeof RECEPTIONIST_CLIPS)[number]

/**
 * What to play when a role is missing from the supplied character.
 *
 * `idle` is the only clip a character must provide. Everything else degrades
 * along this chain until something plays, so a one-clip character still works
 * and a fully authored one is used in full. The chain terminates at `idle`;
 * `CLIP_FALLBACK.idle` is empty because there is nothing below it.
 */
export const CLIP_FALLBACK: Record<ReceptionistClip, readonly ReceptionistClip[]> = {
  idle: [],
  greet: ['gesture', 'idle'],
  listen: ['idle'],
  think: ['listen', 'idle'],
  speak: ['gesture', 'idle'],
  gesture: ['greet', 'idle'],
  apology: ['gesture', 'idle'],
  seated: ['idle'],
}

/** Maps a role to the clip name inside the glTF. */
export type AnimationMapping = Partial<Record<string, string>>

export interface AssetSlot {
  id: string
  label: string
  /** What the slot covers, for whoever writes the manifest. */
  description: string
  /** null keeps the procedural placeholder for this slot. */
  url: string | null
  transform: AssetTransform
  animations: AnimationMapping
  /** Roles this slot's animations are expected to provide, if any. */
  expectedClips: readonly string[]
}

export type AssetSlotId = 'room' | 'receptionDesk' | 'loungeSeating' | 'receptionist'

export type LobbyAssets = Record<AssetSlotId, AssetSlot>

const IDENTITY: AssetTransform = {
  position: [0, 0, 0],
  rotationDegrees: [0, 0, 0],
  scale: 1,
}

/**
 * The shipped configuration: every slot empty, every placeholder in use.
 *
 * Transforms are pre-filled with the position and facing the procedural piece
 * already occupies, so a correctly authored model — Y-up, metres, origin at the
 * floor between the feet — drops straight in with no manifest maths.
 */
export const DEFAULT_ASSETS: LobbyAssets = {
  room: {
    id: 'room',
    label: 'Room shell',
    description:
      'Floor, ceiling, walls, entrance glazing and the meeting-room portal. Must match the floor plan in src/lobby/layout.ts, because the collision boxes are derived from it and will not move with the art.',
    url: null,
    transform: { ...IDENTITY },
    animations: {},
    expectedClips: [],
  },
  receptionDesk: {
    id: 'receptionDesk',
    label: 'Reception desk',
    description:
      'Counter, working desk and credenza. The visitor-facing front must stay within the collider at z −6.5…−4.7, x −2.5…2.5.',
    url: null,
    transform: { ...IDENTITY },
    animations: {},
    expectedClips: [],
  },
  loungeSeating: {
    id: 'loungeSeating',
    label: 'Lounge seating',
    description:
      'Sofa, two armchairs, coffee table and rug. Keep each piece inside its existing collider or visitors will walk into empty air.',
    url: null,
    transform: { ...IDENTITY },
    animations: {},
    expectedClips: [],
  },
  receptionist: {
    id: 'receptionist',
    label: 'Receptionist character',
    description:
      'A rigged humanoid standing behind the counter. Origin at the floor between the feet, facing +Z (towards the entrance).',
    url: null,
    transform: {
      position: [RECEPTIONIST_SPOT.x, 0, RECEPTIONIST_SPOT.z],
      rotationDegrees: [0, (RECEPTIONIST_SPOT.facing * 180) / Math.PI, 0],
      scale: 1,
    },
    animations: {
      idle: 'Idle',
      greet: 'Greet',
      listen: 'Listen',
      think: 'Think',
      speak: 'Speak',
      gesture: 'Gesture',
      apology: 'Apology',
      seated: 'Seated',
    },
    expectedClips: RECEPTIONIST_CLIPS,
  },
}

export const ASSET_SLOT_IDS = Object.keys(DEFAULT_ASSETS) as AssetSlotId[]

// ---------------------------------------------------------------------------
// Receptionist interface
// ---------------------------------------------------------------------------

/**
 * The seven states the reception character can be in.
 *
 * These describe the *character*, not the conversation and not the audio. A
 * conversation can be mid-turn while the character is idle, and speech can be
 * queued while the character is still in `processing`; keeping the three apart
 * is what stops a dropped reply from leaving the figure stuck mouthing at an
 * empty room. See `reception/states.ts` for the transitions and
 * `reception/conversation.ts` for how conversation state maps onto these.
 */
export const RECEPTIONIST_STATES = [
  'idle',
  'greeting',
  'listening',
  'processing',
  'speaking',
  'handover',
  'error',
] as const

export type ReceptionistState = (typeof RECEPTIONIST_STATES)[number]

/** Which animation role each state plays. Roles map to clip names in the manifest. */
export const RECEPTIONIST_STATE_CLIPS: Record<ReceptionistState, ReceptionistClip> = {
  idle: 'idle',
  greeting: 'greet',
  listening: 'listen',
  processing: 'think',
  speaking: 'speak',
  handover: 'gesture',
  error: 'apology',
}

/**
 * States whose clip is played once and held rather than looped.
 *
 * A greeting that loops is a character waving at someone who has already walked
 * away, so these clamp on their last frame and the state machine moves on.
 */
export const RECEPTIONIST_ONE_SHOT_STATES: readonly ReceptionistState[] = ['greeting', 'handover']

/**
 * Facial morph targets the lobby will drive, if a character supplies them.
 *
 * Two independent sets, because they are driven by different things: expression
 * from the conversation state, visemes from speech. A character may ship either,
 * both or neither, and the lobby picks its lip-sync mode from what it finds.
 */
export interface FacialMorphMapping {
  /**
   * ARKit blendshape names, 52 in total. Only the ones the lobby drives are
   * listed; a character is expected to provide the full set.
   * glTF morph targets need `extras.targetNames` populated or the mapping is
   * index order and guesswork.
   */
  expression: Partial<
    Record<
      | 'browInnerUp'
      | 'browDownLeft'
      | 'browDownRight'
      | 'eyeBlinkLeft'
      | 'eyeBlinkRight'
      | 'mouthSmileLeft'
      | 'mouthSmileRight'
      | 'mouthFrownLeft'
      | 'mouthFrownRight'
      | 'jawOpen',
      string
    >
  >
  /**
   * Oculus/OVR viseme set, 15 shapes, applied on top of the body clip rather
   * than baked into it. Required only for a speaking character.
   */
  visemes: Partial<
    Record<
      'sil' | 'PP' | 'FF' | 'TH' | 'DD' | 'kk' | 'CH' | 'SS' | 'nn' | 'RR' | 'aa' | 'E' | 'ih' | 'oh' | 'ou',
      string
    >
  >
}

/**
 * The complete character slot contract.
 *
 * `url: null` is the shipped state and must stay valid: a missing character
 * asset may never prevent the environment from loading.
 */
export interface ReceptionistAsset {
  url: string | null
  transform: AssetTransform
  /** Role -> clip name inside the glTF. */
  animations: AnimationMapping
  /** Optional. Absent means the loader probes for ARKit names directly. */
  facial?: FacialMorphMapping
}

export const RECEPTIONIST_INTERFACE: ReceptionistAsset = {
  url: DEFAULT_ASSETS.receptionist.url,
  transform: DEFAULT_ASSETS.receptionist.transform,
  animations: DEFAULT_ASSETS.receptionist.animations,
}
