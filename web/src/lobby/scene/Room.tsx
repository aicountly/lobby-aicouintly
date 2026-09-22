/**
 * The shell: floor, ceiling, four walls, the glazed entrance, the meeting-room
 * portal and the lighting coffers.
 *
 * The room is closed on every side. Turning a full circle from anywhere inside
 * shows finished surfaces the whole way round — including behind the visitor as
 * they come in, which is the glazed south elevation rather than a void.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Matrix4 } from 'three'
import type { InstancedMesh } from 'three'

import { CEILING_PANELS, ENTRANCE, FEATURE_WALL, MEETING_ENTRANCE, ROOM } from '../layout'
import { getMaterials } from './materials'
import { Box, Panel } from './primitives'

const T = ROOM.wallThickness
const W = ROOM.halfWidth
const D = ROOM.halfDepth
const H = ROOM.height

/** Centre and width of a span given its two edges. */
function span(from: number, to: number): { centre: number; size: number } {
  return { centre: (from + to) / 2, size: Math.abs(to - from) }
}

export function Room() {
  const m = getMaterials()

  return (
    <group>
      <Floor />
      <Ceiling />
      <NorthWall />
      <SouthWall />
      <EastWall />
      <WestWall />
      <FeatureWall />
      <MeetingCorridor />
      <Outside />

      {/* Entrance mat, sitting just proud of the boards. */}
      <Panel
        size={[ENTRANCE.matSizeX, ENTRANCE.matSizeZ]}
        position={[0, 0.006, ENTRANCE.matCentreZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={m.graphite}
      />
    </group>
  )
}

function Floor() {
  const m = getMaterials()
  return (
    <Panel
      size={[W * 2, D * 2]}
      position={[0, 0, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={m.floor}
    />
  )
}

function Ceiling() {
  const m = getMaterials()
  return (
    <group>
      <Panel
        size={[W * 2, D * 2]}
        position={[0, H, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        material={m.ceiling}
      />
      <LightCoffers />
    </group>
  )
}

/**
 * Ceiling lighting.
 *
 * Phase 1 put four broad glowing rectangles up there, and from the entrance
 * they were the brightest, largest thing in frame — the room read as a lit
 * ceiling with an office underneath. These are slim linear fittings recessed
 * into a plaster slot instead: the same positions, a tenth of the visible area.
 * The illumination is unchanged because it never came from the emissive surface
 * in the first place — it comes from the point lights in Lighting.tsx.
 */
function LightCoffers() {
  const m = getMaterials()
  const SLOT_DEPTH = 0.12
  const SLOT_RECESS = 0.07

  return (
    <group>
      {CEILING_PANELS.map((c) => (
        <group key={`${c.x}:${c.z}`}>
          {/* The plaster slot the fitting sits in, so the ceiling reads as
              modelled rather than as a sticker. */}
          <Box
            size={[c.width + 0.06, SLOT_RECESS, SLOT_DEPTH + 0.06]}
            position={[c.x, H - SLOT_RECESS / 2, c.z]}
            material={m.ceilingReveal}
            castShadow={false}
          />
          <Box
            size={[c.width, 0.018, SLOT_DEPTH]}
            position={[c.x, H - SLOT_RECESS, c.z]}
            material={m.lightPanel}
            castShadow={false}
            receiveShadow={false}
          />
        </group>
      ))}
    </group>
  )
}

function Skirting({
  size,
  position,
}: {
  size: [number, number, number]
  position: [number, number, number]
}) {
  const m = getMaterials()
  return <Box size={size} position={position} material={m.skirting} castShadow={false} />
}

function NorthWall() {
  const m = getMaterials()
  return (
    <group>
      <Box size={[W * 2 + T * 2, H, T]} position={[0, H / 2, -D - T / 2]} material={m.wall} />
      <Skirting size={[W * 2, 0.12, 0.04]} position={[0, 0.06, -D + 0.02]} />
    </group>
  )
}

function WestWall() {
  const m = getMaterials()
  return (
    <group>
      <Box size={[T, H, D * 2]} position={[-W - T / 2, H / 2, 0]} material={m.wall} />
      <Skirting size={[0.04, 0.12, D * 2]} position={[-W + 0.02, 0.06, 0]} />

      {/* Two recessed art panels, to give the long wall something to read as scale. */}
      {[-3.4, 5.4].map((z) => (
        <group key={z}>
          <Box
            size={[0.07, 1.6, 1.15]}
            position={[-W + 0.035, 1.85, z]}
            material={m.oakDark}
            castShadow={false}
          />
          <Box
            size={[0.04, 1.4, 0.95]}
            position={[-W + 0.08, 1.85, z]}
            material={m.ivoryPanel}
            castShadow={false}
          />
        </group>
      ))}
    </group>
  )
}

function EastWall() {
  const m = getMaterials()
  const opening = span(MEETING_ENTRANCE.z - MEETING_ENTRANCE.width / 2, MEETING_ENTRANCE.z + MEETING_ENTRANCE.width / 2)
  const south = span(opening.centre + opening.size / 2, D)
  const north = span(-D, opening.centre - opening.size / 2)

  return (
    <group>
      <Box size={[T, H, north.size]} position={[W + T / 2, H / 2, north.centre]} material={m.wall} />
      <Box size={[T, H, south.size]} position={[W + T / 2, H / 2, south.centre]} material={m.wall} />
      {/* Header over the meeting-room opening. */}
      <Box
        size={[T, H - MEETING_ENTRANCE.height, opening.size]}
        position={[W + T / 2, (H + MEETING_ENTRANCE.height) / 2, opening.centre]}
        material={m.wall}
      />

      <Skirting size={[0.04, 0.12, north.size]} position={[W - 0.02, 0.06, north.centre]} />
      <Skirting size={[0.04, 0.12, south.size]} position={[W - 0.02, 0.06, south.centre]} />

      <MeetingPortal />
    </group>
  )
}

function MeetingPortal() {
  const m = getMaterials()
  const { z, width, height } = MEETING_ENTRANCE
  const halfWidth = width / 2

  return (
    <group>
      {/* Oak lining to the opening. */}
      {[z - halfWidth + 0.06, z + halfWidth - 0.06].map((jambZ) => (
        <Box
          key={jambZ}
          size={[T + 0.06, height + 0.12, 0.12]}
          position={[W + T / 2, (height + 0.12) / 2, jambZ]}
          material={m.oak}
        />
      ))}
      <Box
        size={[T + 0.06, 0.12, width]}
        position={[W + T / 2, height + 0.06, z]}
        material={m.oak}
      />

      {/* Two glazed leaves with a central mullion. */}
      {[z - halfWidth / 2, z + halfWidth / 2].map((leafZ) => (
        <Box
          key={leafZ}
          size={[0.05, height - 0.16, halfWidth - 0.16]}
          position={[W + 0.1, (height - 0.16) / 2 + 0.06, leafZ]}
          material={m.glass}
          castShadow={false}
        />
      ))}
      <Box
        size={[0.09, height - 0.08, 0.09]}
        position={[W + 0.1, (height - 0.08) / 2 + 0.02, z]}
        material={m.graphite}
      />
      {/* Push bars. */}
      {[z - 0.22, z + 0.22].map((barZ) => (
        <Box
          key={barZ}
          size={[0.05, 0.9, 0.05]}
          position={[W + 0.02, 1.05, barZ]}
          material={m.metal}
        />
      ))}
    </group>
  )
}

/**
 * A short corridor built behind the meeting-room glass.
 *
 * Without it the opening would read as a painted rectangle. With it, walking
 * across the lobby changes what you can see through the doors, which is the
 * cheapest honest depth cue in the room.
 */
function MeetingCorridor() {
  const m = getMaterials()
  const { z, width, height, corridorDepth } = MEETING_ENTRANCE
  const startX = W + T
  const centreX = startX + corridorDepth / 2
  const endX = startX + corridorDepth

  return (
    <group>
      <Panel
        size={[corridorDepth, width]}
        position={[centreX, 0.002, z]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        material={m.floor}
      />
      <Panel
        size={[corridorDepth, width]}
        position={[centreX, height, z]}
        rotation={[Math.PI / 2, 0, Math.PI / 2]}
        material={m.ceiling}
      />
      {[z - width / 2, z + width / 2].map((sideZ) => (
        <Box
          key={sideZ}
          size={[corridorDepth, height, 0.08]}
          position={[centreX, height / 2, sideZ]}
          material={m.wall}
        />
      ))}
      <Box size={[0.1, height, width]} position={[endX, height / 2, z]} material={m.wall} />
      <Box size={[0.06, 1.1, 1.6]} position={[endX - 0.06, 1.5, z]} material={m.emerald} castShadow={false} />
      <pointLight position={[centreX, height - 0.4, z]} intensity={6} distance={7} color="#ffe9cc" />
    </group>
  )
}

function SouthWall() {
  const m = getMaterials()
  const { doorHalfWidth, doorHeight, glazingInnerX, glazingOuterX, glazingHeight } = ENTRANCE
  const wallZ = D + T / 2

  const solidOuter = span(glazingOuterX, W)
  const bay = span(glazingInnerX, glazingOuterX)
  const mullion = span(doorHalfWidth, glazingInnerX)

  return (
    <group>
      {/* Mirrored left and right: outer pier, glazed bay, mullion. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            size={[solidOuter.size, H, T]}
            position={[side * solidOuter.centre, H / 2, wallZ]}
            material={m.wall}
          />
          <Box
            size={[mullion.size, H, T]}
            position={[side * mullion.centre, H / 2, wallZ]}
            material={m.wall}
          />
          {/* Glazed bay: sill, glass, head. */}
          <Box
            size={[bay.size, 0.12, T]}
            position={[side * bay.centre, 0.06, wallZ]}
            material={m.graphite}
          />
          <Box
            size={[bay.size - 0.1, glazingHeight, 0.05]}
            position={[side * bay.centre, 0.12 + glazingHeight / 2, D + 0.03]}
            material={m.glass}
            castShadow={false}
          />
          <Box
            size={[bay.size, H - glazingHeight - 0.12, T]}
            position={[side * bay.centre, (H + glazingHeight + 0.12) / 2, wallZ]}
            material={m.wall}
          />
          <Skirting
            size={[solidOuter.size, 0.12, 0.04]}
            position={[side * solidOuter.centre, 0.06, D - 0.02]}
          />
        </group>
      ))}

      {/* Head over the entrance doors. */}
      <Box
        size={[doorHalfWidth * 2 + 0.1, H - doorHeight, T]}
        position={[0, (H + doorHeight) / 2, wallZ]}
        material={m.wall}
      />

      <EntranceDoors />
    </group>
  )
}

function EntranceDoors() {
  const m = getMaterials()
  const { doorHalfWidth, doorHeight } = ENTRANCE
  const doorZ = D + 0.05
  const leafWidth = doorHalfWidth - 0.05

  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            size={[leafWidth - 0.12, doorHeight - 0.16, 0.05]}
            position={[side * (doorHalfWidth / 2), doorHeight / 2, doorZ]}
            material={m.glass}
            castShadow={false}
          />
          {/* Stiles and rails. */}
          <Box
            size={[0.08, doorHeight, 0.1]}
            position={[side * (doorHalfWidth - 0.04), doorHeight / 2, doorZ]}
            material={m.graphite}
          />
          <Box
            size={[0.07, doorHeight, 0.1]}
            position={[side * 0.045, doorHeight / 2, doorZ]}
            material={m.graphite}
          />
          <Box
            size={[leafWidth, 0.1, 0.1]}
            position={[side * (doorHalfWidth / 2), doorHeight - 0.05, doorZ]}
            material={m.graphite}
          />
          <Box
            size={[leafWidth, 0.14, 0.1]}
            position={[side * (doorHalfWidth / 2), 0.07, doorZ]}
            material={m.graphite}
          />
          {/* Pull handle. */}
          <Box
            size={[0.05, 1.05, 0.05]}
            position={[side * 0.2, 1.05, doorZ - 0.09]}
            material={m.metal}
          />
        </group>
      ))}
    </group>
  )
}

/** The oak slat wall behind reception, which the main sign is fixed to. */
function FeatureWall() {
  const m = getMaterials()
  const { z, halfWidth, height, slatCount } = FEATURE_WALL
  const pitch = (halfWidth * 2) / slatCount

  // One instanced draw call for the whole slat wall instead of 28 meshes. The
  // slats are identical apart from their x position, which is exactly what
  // instancing is for, and it is the single biggest draw-call saving in the room.
  const slats = useRef<InstancedMesh>(null)
  const slatGeometry = useMemo(
    () => new BoxGeometry(pitch * 0.42, height, 0.075),
    [pitch, height],
  )
  useEffect(() => () => slatGeometry.dispose(), [slatGeometry])

  useLayoutEffect(() => {
    const mesh = slats.current
    if (!mesh) return
    const matrix = new Matrix4()
    for (let i = 0; i < slatCount; i += 1) {
      matrix.makeTranslation(-halfWidth + pitch * (i + 0.5), height / 2, z + 0.04)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [slatCount, halfWidth, pitch, height, z])

  return (
    <group>
      <Box
        size={[halfWidth * 2, height, 0.06]}
        position={[0, height / 2, z - 0.03]}
        material={m.oakDeepPanel}
      />
      <instancedMesh
        ref={slats}
        args={[slatGeometry, m.oak, slatCount]}
        castShadow
        receiveShadow
      />
    </group>
  )
}

function Outside() {
  const m = getMaterials()
  return (
    <group>
      <Panel
        size={[34, 16]}
        position={[0, -0.02, D + 8]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={m.exterior}
        receiveShadow={false}
      />
      {/* Turned to face back into the room: a plane's front face is +Z, and
          this one is seen from inside, looking out. Left unrotated it is
          backface-culled and the entrance glazing shows black. */}
      <Panel
        size={[40, 14]}
        position={[0, 6.4, D + 15]}
        rotation={[0, Math.PI, 0]}
        material={m.daylight}
        receiveShadow={false}
      />
    </group>
  )
}
