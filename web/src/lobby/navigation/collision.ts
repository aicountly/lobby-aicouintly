/**
 * Keeping the visitor inside the room and out of the furniture.
 *
 * The visitor is a circle on the floor plan and every obstacle is an
 * axis-aligned box, so a test is four comparisons against a box grown by the
 * visitor's radius. Movement is resolved one axis at a time: when a diagonal
 * step is refused, the component that is still clear is kept, which is what
 * makes you slide along a wall instead of sticking to it.
 */
import { COLLIDERS, PLAYER_RADIUS, ROOM, WAYPOINTS } from '../layout'
import type { Footprint } from '../layout'

export interface Point2 {
  x: number
  z: number
}

const BOUND_X = ROOM.halfWidth - PLAYER_RADIUS
const BOUND_Z = ROOM.halfDepth - PLAYER_RADIUS

function overlaps(x: number, z: number, box: Footprint): boolean {
  return (
    x > box.minX - PLAYER_RADIUS &&
    x < box.maxX + PLAYER_RADIUS &&
    z > box.minZ - PLAYER_RADIUS &&
    z < box.maxZ + PLAYER_RADIUS
  )
}

/** True when a visitor standing at (x, z) would be inside something solid. */
export function isBlocked(x: number, z: number): boolean {
  for (const box of COLLIDERS) {
    if (overlaps(x, z, box)) return true
  }
  return false
}

/** True when (x, z) is outside the four walls. */
export function isOutsideRoom(x: number, z: number): boolean {
  return x < -BOUND_X || x > BOUND_X || z < -BOUND_Z || z > BOUND_Z
}

function clampToRoom(value: number, bound: number): number {
  return Math.min(bound, Math.max(-bound, value))
}

/**
 * Move from `from` towards `to`, as far as the room allows.
 *
 * If the starting point is somehow already inside an obstacle the move is
 * allowed through, so a visitor can never be trapped by a geometry change.
 */
export function resolveMove(from: Point2, to: Point2): Point2 {
  const targetX = clampToRoom(to.x, BOUND_X)
  const targetZ = clampToRoom(to.z, BOUND_Z)

  if (isBlocked(from.x, from.z)) return { x: targetX, z: targetZ }

  let x = from.x
  let z = from.z

  if (!isBlocked(targetX, z)) x = targetX
  if (!isBlocked(x, targetZ)) z = targetZ

  return { x, z }
}

/**
 * A destination the visitor cannot legally stand on is a trap: travel puts them
 * inside the furniture, and the first step afterwards is refused in every
 * direction. It is also easy to introduce by nudging a sofa 30cm, so the check
 * runs on every development boot rather than waiting to be noticed.
 */
if (import.meta.env.DEV) {
  for (const point of WAYPOINTS) {
    if (isBlocked(point.x, point.z) || isOutsideRoom(point.x, point.z)) {
      console.error(
        `Aicountly Lobby: waypoint "${point.id}" at (${point.x}, ${point.z}) is inside a collider or outside the room. ` +
          'Move it, or move whatever it is standing in — see src/lobby/layout.ts.',
      )
    }
  }
}
