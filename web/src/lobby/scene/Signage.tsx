/**
 * Wall signage.
 *
 * Each sign is a plane carrying a canvas-drawn texture and an unlit material,
 * so lettering stays legible from across the room regardless of how the light
 * happens to fall on that wall.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { FEATURE_WALL, MEETING_ENTRANCE, ROOM } from '../layout'
import { LOBBY_DISPLAY_NAME } from '../lobbyConfig'
import { PALETTE } from '../theme'
import type { Vec3 } from './primitives'
import { signTexture } from './textures'

interface SignPlaneProps {
  text: string
  eyebrow?: string
  /** width, height in metres */
  size: [number, number]
  position: Vec3
  rotation?: Vec3
  fontSize?: number
  color?: string
  accent?: string
  rule?: boolean
}

export function SignPlane({
  text,
  eyebrow,
  size,
  position,
  rotation,
  fontSize = 108,
  color = PALETTE.graphite,
  accent = PALETTE.emerald,
  rule = false,
}: SignPlaneProps) {
  const [signWidth, signHeight] = size
  const material = useMemo(() => {
    const aspect = signWidth / signHeight
    const height = 256
    const texture = signTexture(text, {
      eyebrow,
      color,
      accent,
      rule,
      fontSize,
      width: Math.round(height * aspect),
      height,
    })
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false })
  }, [text, eyebrow, color, accent, rule, fontSize, signWidth, signHeight])

  // Canvas textures and materials are ours to free; nothing else references them.
  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
    },
    [material],
  )

  return (
    <mesh position={position} rotation={rotation} material={material}>
      <planeGeometry args={size} />
    </mesh>
  )
}

/** The fixed signage of the room. */
export function Signage() {
  const signZ = FEATURE_WALL.z + 0.09

  return (
    <group>
      {/* Behind reception, the one piece of large lettering in the room. */}
      <SignPlane
        text={LOBBY_DISPLAY_NAME.toUpperCase()}
        eyebrow="Reception"
        size={[5.4, 1.35]}
        position={[0, 2.35, signZ]}
        fontSize={92}
        color={PALETTE.ivoryPale}
        accent="#7fdcb8"
        rule
      />

      {/* Waiting lounge, on the west wall above the sofa. */}
      <SignPlane
        text="WAITING LOUNGE"
        size={[2.6, 0.5]}
        position={[-ROOM.halfWidth + 0.05, 2.35, 1.2]}
        rotation={[0, Math.PI / 2, 0]}
        fontSize={76}
      />

      {/* Meeting rooms, over the glazed portal on the east wall. */}
      <SignPlane
        text="MEETING ROOMS"
        size={[2.5, 0.48]}
        position={[ROOM.halfWidth - 0.05, MEETING_ENTRANCE.height + 0.45, MEETING_ENTRANCE.z]}
        rotation={[0, -Math.PI / 2, 0]}
        fontSize={76}
      />

      {/* Seen on the way out, over the entrance doors. */}
      <SignPlane
        text="THANK YOU FOR VISITING"
        size={[3.4, 0.4]}
        position={[0, 2.92, ROOM.halfDepth - 0.05]}
        rotation={[0, Math.PI, 0]}
        fontSize={58}
        color={PALETTE.graphiteLight}
      />
    </group>
  )
}
