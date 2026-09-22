/**
 * The lobby's floor plan, in metres.
 *
 * This module is the single source of truth: the geometry in `scene/` is built
 * from these numbers and the collision boxes in `navigation/` are derived from
 * the same ones, so a piece of furniture cannot drift away from the box that
 * stops you walking through it.
 *
 * Axes follow three.js convention. +X is right, +Y is up, −Z is the direction
 * the camera faces at yaw 0. The entrance is at +Z (south), reception at −Z
 * (north), the waiting lounge along −X (west) and the meeting rooms at +X
 * (east).
 */

export interface Footprint {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** A footprint from a centre point and its extents. */
export function footprint(cx: number, cz: number, sizeX: number, sizeZ: number): Footprint {
  return {
    minX: cx - sizeX / 2,
    maxX: cx + sizeX / 2,
    minZ: cz - sizeZ / 2,
    maxZ: cz + sizeZ / 2,
  }
}

export const ROOM = {
  /** Interior half-extent on X: the side walls stand at ±halfWidth. */
  halfWidth: 7,
  /** Interior half-extent on Z: the end walls stand at ±halfDepth. */
  halfDepth: 9,
  height: 3.6,
  wallThickness: 0.24,
} as const

/** Camera height above the floor. A standing adult's eye line. */
export const EYE_HEIGHT = 1.65

/** Radius of the visitor's collision cylinder. */
export const PLAYER_RADIUS = 0.38

/** Metres per second on foot. A walk, not a sprint. */
export const WALK_SPEED = 2.6

/** How far the camera may tilt from level, in radians (±60°). */
export const PITCH_LIMIT = Math.PI / 3

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Glazed entrance doors in the south wall. */
export const ENTRANCE = {
  z: ROOM.halfDepth,
  doorHalfWidth: 1.7,
  doorHeight: 2.45,
  /** Side glazing panels, as [innerX, outerX] pairs mirrored on both sides. */
  glazingInnerX: 2.35,
  glazingOuterX: 4.75,
  glazingHeight: 2.75,
  matCentreZ: 7.45,
  matSizeX: 3.6,
  matSizeZ: 2.1,
} as const

/** The reception counter and the working desk behind it. */
export const DESK = {
  x: 0,
  z: -5.3,
  width: 5,
  depth: 0.78,
  height: 1.12,
  topOverhang: 0.12,
} as const

export const DESK_BACK = {
  x: 0,
  // Far enough behind the counter to leave somewhere for a receptionist to
  // stand. Anything closer and the character intersects the desk.
  z: -6.9,
  width: 4.3,
  depth: 0.72,
  height: 0.74,
} as const

/** Storage run against the feature wall behind reception. */
export const CREDENZA = {
  x: 0,
  z: -8.45,
  width: 5.8,
  depth: 0.5,
  height: 0.95,
} as const

/** Oak slat feature wall behind the desk, carrying the main sign. */
export const FEATURE_WALL = {
  z: -ROOM.halfDepth + 0.06,
  halfWidth: 4.6,
  height: 3.2,
  slatCount: 28,
} as const

/** Three-seat sofa against the west wall, facing east into the room. */
export const SOFA = {
  x: -6.05,
  z: 1.2,
  /** Depth of the seat, measured along X because the sofa faces east. */
  depth: 0.95,
  /** Length of the sofa, measured along Z. */
  length: 2.5,
  seatHeight: 0.42,
} as const

/** Armchairs opposite the sofa, facing west. */
export const CHAIRS = [
  { x: -2.95, z: 0.05 },
  { x: -2.95, z: 2.35 },
] as const

export const COFFEE_TABLE = {
  x: -4.55,
  z: 1.2,
  width: 1.5,
  depth: 0.9,
  height: 0.42,
} as const

export const LOUNGE_RUG = {
  x: -4.5,
  z: 1.2,
  width: 5,
  depth: 4.4,
} as const

/** Planters. Radius is the pot, which is what the visitor bumps into. */
export const PLANTERS = [
  { x: -6.25, z: -2.1, radius: 0.42, height: 0.55 },
  { x: 5.95, z: 6.5, radius: 0.42, height: 0.55 },
  { x: -6.25, z: 5.6, radius: 0.36, height: 0.48 },
] as const

/** Free-standing wayfinding directory near the entrance. */
export const DIRECTORY = {
  x: 3.7,
  z: 6.1,
  width: 0.7,
  depth: 0.18,
  height: 1.55,
} as const

/**
 * Glazed meeting-room entrance in the east wall, with a short corridor built
 * behind the glass so the opening reads as depth rather than as a picture.
 */
export const MEETING_ENTRANCE = {
  x: ROOM.halfWidth,
  z: -1.6,
  /** Opening width, measured along Z. */
  width: 3.2,
  height: 2.6,
  corridorDepth: 2.6,
} as const

/** Recessed ceiling light coffers. */
export const CEILING_PANELS = [
  { x: 0, z: -7.7, width: 5.4, depth: 0.85 },
  { x: 0, z: -5.4, width: 6, depth: 1.1 },
  { x: 0, z: -1.6, width: 8.4, depth: 1 },
  { x: 0, z: 2.2, width: 8.4, depth: 1 },
  { x: 0, z: 6, width: 6.4, depth: 1 },
] as const

/**
 * Where a visitor stands to talk to reception.
 *
 * Not the `reception` waypoint, which stops three metres back so the counter
 * does not fill the frame. Talking to the character is a different shot: close
 * enough that a 23 cm head is legible, and pitched *down* so the head rides
 * high in the frame and the conversation panel can sit under it without
 * covering the face. Looking up would push the head towards the middle, which
 * is exactly where the panel is.
 *
 * z −4.15 leaves the visitor's 0.38 m radius 0.17 m clear of the counter
 * collider at z −4.7.
 */
export const CONVERSATION_VIEW = { x: 1.3, z: -4.15, yaw: 0, pitch: -0.17 } as const

/** Where the placeholder receptionist stands, behind the counter. */
export const RECEPTIONIST_SPOT = { x: 1.3, z: -6.1, facing: 0 } as const

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

export interface Waypoint {
  id: string
  label: string
  /** Where the visitor stands. */
  x: number
  z: number
  /** What they look at once they arrive. */
  lookAtX: number
  lookAtZ: number
  description: string
}

export const WAYPOINTS: readonly Waypoint[] = [
  {
    id: 'entrance',
    label: 'Return to Entrance',
    x: 0,
    // Far enough back from the doors that turning round shows the whole glazed
    // south elevation rather than a close-up of one door leaf.
    z: 6.4,
    lookAtX: 0,
    lookAtZ: -5.3,
    description: 'The glazed entrance doors, looking north across the lobby to reception.',
  },
  {
    id: 'reception',
    label: 'Reception',
    x: 0,
    // Three metres back from the counter. Closer than this and a 1.19m counter
    // fills the bottom third of the frame, which reads as leaning on it.
    z: -1.9,
    lookAtX: 0,
    lookAtZ: DESK.z,
    description: 'The reception counter, beneath the Aicountly Lobby sign.',
  },
  {
    id: 'lounge',
    label: 'Waiting Lounge',
    // Clear of the near armchair's collider, looking diagonally across the
    // seating rather than standing in the middle of it.
    x: -3.4,
    z: 4.4,
    lookAtX: -5.3,
    lookAtZ: 1.3,
    description: 'The waiting lounge, with a sofa, two armchairs and a low oak table.',
  },
  {
    id: 'meeting',
    label: 'Meeting Rooms',
    x: 4.3,
    z: MEETING_ENTRANCE.z,
    lookAtX: ROOM.halfWidth,
    lookAtZ: MEETING_ENTRANCE.z,
    description: 'The glazed meeting-room entrance on the east side of the lobby.',
  },
]

export function waypoint(id: string): Waypoint {
  const found = WAYPOINTS.find((w) => w.id === id)
  if (!found) throw new Error(`Unknown lobby waypoint: ${id}`)
  return found
}

/**
 * Yaw that points the camera from `from` towards `to`.
 *
 * At yaw 0 the camera looks down −Z, so the forward vector is
 * (−sin yaw, 0, −cos yaw) and the inverse is atan2(−dx, −dz).
 */
export function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ))
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------

/**
 * Everything solid at walking height, derived from the fixtures above.
 *
 * The walls are handled separately as bounds, because clamping to the room is
 * cheaper and more reliable than four very large boxes.
 */
export const COLLIDERS: readonly Footprint[] = [
  // Reception: the counter, the desk behind it and the credenza, as one run
  // each, so you cannot slip through the gap between counter and desk.
  footprint(DESK.x, DESK.z, DESK.width, DESK.depth + 0.3),
  footprint(DESK_BACK.x, DESK_BACK.z, DESK_BACK.width, DESK_BACK.depth),
  footprint(CREDENZA.x, CREDENZA.z, CREDENZA.width, CREDENZA.depth),

  // Waiting lounge.
  footprint(SOFA.x, SOFA.z, SOFA.depth, SOFA.length),
  ...CHAIRS.map((c) => footprint(c.x, c.z, 0.95, 0.95)),
  footprint(COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.width, COFFEE_TABLE.depth),

  // Planters and the directory stand.
  ...PLANTERS.map((p) => footprint(p.x, p.z, p.radius * 2, p.radius * 2)),
  footprint(DIRECTORY.x, DIRECTORY.z, DIRECTORY.width, DIRECTORY.depth),
]
