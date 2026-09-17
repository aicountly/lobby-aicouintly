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
 * written out in docs/lobby/ASSETS.md.
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
 * Phase 1 plays `idle` and nothing else. The remaining roles are declared now
 * so a character can be authored against a fixed list rather than guessed at,
 * and so a file that provides them needs no code change to be accepted.
 */
export const RECEPTIONIST_CLIPS = ['idle', 'greet', 'listen', 'speak', 'gesture', 'seated'] as const

export type ReceptionistClip = (typeof RECEPTIONIST_CLIPS)[number]

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
      speak: 'Speak',
      gesture: 'Gesture',
      seated: 'Seated',
    },
    expectedClips: RECEPTIONIST_CLIPS,
  },
}

export const ASSET_SLOT_IDS = Object.keys(DEFAULT_ASSETS) as AssetSlotId[]
