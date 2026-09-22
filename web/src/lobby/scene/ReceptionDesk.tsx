/**
 * The reception counter — the one piece of furniture the visitor is meant to
 * walk up to and use, and therefore the one that has to survive close range.
 *
 * Built as a real joinery assembly rather than a slab: a recessed graphite
 * plinth, an oak body, and a honed stone top that oversails it. The recess is
 * doing most of the work — the shadow gap under the body is what stops the desk
 * reading as a box sitting on the floor, and the oversail gives the top a lit
 * edge against the darker body beneath.
 *
 * The whole group remains a single click target, and the footprint is unchanged
 * from Phase 1, so the collision boxes in layout.ts still describe it exactly.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh } from 'three'

import { CREDENZA, DESK, DESK_BACK } from '../layout'
import type { NavigationController } from '../navigation/controller'
import { getMaterials } from './materials'
import { Box, ContactShadow, Cylinder, RoundedBox } from './primitives'

interface Props {
  controller: NavigationController
  onOpenServices: () => void
  reducedMotion: boolean
}

/** Joinery edges: a 6 mm radius, the smallest that still catches a highlight. */
const EDGE = 0.006
/** Stone has a heavier arris than timber. */
const STONE_EDGE = 0.01

const PLINTH_HEIGHT = 0.11
/** How far the plinth is set back from the body on every side. */
const PLINTH_INSET = 0.07
const TOP_THICKNESS = 0.06

export function ReceptionDesk({ controller, onOpenServices, reducedMotion }: Props) {
  const m = getMaterials()
  const [hovered, setHovered] = useState(false)
  const canvas = useThree((state) => state.gl.domElement)

  const bodyHeight = DESK.height - PLINTH_HEIGHT - TOP_THICKNESS
  const bodyCentreY = PLINTH_HEIGHT + bodyHeight / 2
  const topCentreY = DESK.height - TOP_THICKNESS / 2
  const frontZ = DESK.z + DESK.depth / 2

  useEffect(() => {
    canvas.style.cursor = hovered ? 'pointer' : ''
    return () => {
      canvas.style.cursor = ''
    }
  }, [canvas, hovered])

  return (
    <group
      onClick={(event) => {
        event.stopPropagation()
        if (controller.consumedByDrag()) return
        onOpenServices()
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* Recessed plinth. Set back on all sides so the body appears to float. */}
      <RoundedBox
        size={[DESK.width - PLINTH_INSET * 2, PLINTH_HEIGHT, DESK.depth - PLINTH_INSET * 2]}
        radius={EDGE}
        position={[DESK.x, PLINTH_HEIGHT / 2, DESK.z]}
        material={m.graphite}
      />

      {/* Oak body. */}
      <RoundedBox
        size={[DESK.width, bodyHeight, DESK.depth]}
        radius={EDGE}
        position={[DESK.x, bodyCentreY, DESK.z]}
        material={m.oak}
      />

      {/* Honed stone top, oversailing 120 mm at the front and 60 mm at the ends. */}
      <RoundedBox
        size={[DESK.width + 0.12, TOP_THICKNESS, DESK.depth + 0.24]}
        radius={STONE_EDGE}
        segments={3}
        position={[DESK.x, topCentreY, DESK.z]}
        material={m.stone}
      />

      {/* A single emerald reveal in the shadow line under the top. Restraint is
          the point: one 25 mm strip, not a lit edge all the way round. */}
      <Box
        size={[DESK.width - 0.5, 0.025, 0.02]}
        position={[DESK.x, DESK.height - TOP_THICKNESS - 0.055, frontZ + 0.011]}
        material={hovered ? m.emeraldGlow : m.emerald}
        castShadow={false}
      />

      <PlinthWash frontZ={frontZ} />

      {/* Working desk behind the counter, with a stone-faced top to match. */}
      <RoundedBox
        size={[DESK_BACK.width, DESK_BACK.height - 0.04, DESK_BACK.depth]}
        radius={EDGE}
        position={[DESK_BACK.x, (DESK_BACK.height - 0.04) / 2, DESK_BACK.z]}
        material={m.oakLight}
      />
      <RoundedBox
        size={[DESK_BACK.width + 0.1, 0.04, DESK_BACK.depth + 0.1]}
        radius={STONE_EDGE}
        position={[DESK_BACK.x, DESK_BACK.height - 0.02, DESK_BACK.z]}
        material={m.stone}
      />

      <Workstation x={-1.15} />
      <Workstation x={1.15} />

      {/* Credenza against the feature wall. */}
      <RoundedBox
        size={[CREDENZA.width, CREDENZA.height - 0.08, CREDENZA.depth]}
        radius={EDGE}
        position={[CREDENZA.x, CREDENZA.height / 2 + 0.04, CREDENZA.z]}
        material={m.oakDark}
      />
      <RoundedBox
        size={[CREDENZA.width + 0.06, 0.035, CREDENZA.depth + 0.06]}
        radius={STONE_EDGE}
        position={[CREDENZA.x, CREDENZA.height + 0.018, CREDENZA.z]}
        material={m.stone}
      />

      <ContactShadow position={[DESK.x, 0.006, DESK.z + 0.1]} radius={3.1} scaleZ={0.42} opacity={0.5} />
      <ContactShadow position={[CREDENZA.x, 0.006, CREDENZA.z]} radius={3.1} scaleZ={0.2} opacity={0.3} />

      <ServiceMarker
        position={[DESK.x, 1.46, frontZ - 0.12]}
        active={hovered}
        reducedMotion={reducedMotion}
      />
    </group>
  )
}

/**
 * Accent light in the plinth recess.
 *
 * Emissive geometry alone would only look bright; the small point light is what
 * actually puts a warm graze on the floor in front of the desk.
 */
function PlinthWash({ frontZ }: { frontZ: number }) {
  const m = getMaterials()
  return (
    <group>
      <Box
        size={[DESK.width - PLINTH_INSET * 4, 0.012, 0.012]}
        position={[DESK.x, PLINTH_HEIGHT - 0.02, frontZ - PLINTH_INSET - 0.02]}
        material={m.lightPanel}
        castShadow={false}
        receiveShadow={false}
      />
      <pointLight
        position={[DESK.x, 0.08, frontZ + 0.12]}
        intensity={0.3}
        distance={1.5}
        decay={2}
        color="#ffe6c2"
      />
    </group>
  )
}

/** A monitor, keyboard and mouse — enough to read as a working desk. */
function Workstation({ x }: { x: number }) {
  const m = getMaterials()
  const deskTop = DESK_BACK.height
  const z = DESK_BACK.z - 0.06

  return (
    <group>
      <Cylinder radiusTop={0.1} height={0.014} position={[x, deskTop + 0.007, z]} material={m.graphite} />
      <Box size={[0.03, 0.17, 0.03]} position={[x, deskTop + 0.09, z]} material={m.graphite} />
      <RoundedBox
        size={[0.52, 0.31, 0.016]}
        radius={0.005}
        position={[x, deskTop + 0.33, z]}
        rotation={[0.1, 0, 0]}
        material={m.graphite}
      />
      {/* Screen face, tilted with the panel. Dim: an office monitor seen from
          the visitor's side of a 1.12 m counter is mostly a dark rectangle. */}
      <Box
        size={[0.48, 0.275, 0.004]}
        position={[x, deskTop + 0.333, z + 0.011]}
        rotation={[0.1, 0, 0]}
        material={m.graphiteSoft}
        castShadow={false}
      />
      <RoundedBox
        size={[0.34, 0.012, 0.12]}
        radius={0.004}
        position={[x, deskTop + 0.01, z + 0.3]}
        material={m.graphiteSoft}
      />
      <RoundedBox
        size={[0.06, 0.022, 0.1]}
        radius={0.01}
        position={[x + 0.26, deskTop + 0.014, z + 0.3]}
        material={m.graphiteSoft}
      />
    </group>
  )
}

/** A slowly breathing emerald ring marking the desk as interactive. */
function ServiceMarker({
  position,
  active,
  reducedMotion,
}: {
  position: [number, number, number]
  active: boolean
  reducedMotion: boolean
}) {
  const m = getMaterials()
  const ring = useRef<Mesh>(null)

  useFrame((state) => {
    const mesh = ring.current
    if (!mesh) return
    if (reducedMotion) {
      mesh.scale.setScalar(1)
      mesh.rotation.z = 0
      return
    }
    const t = state.clock.elapsedTime
    mesh.scale.setScalar(1 + Math.sin(t * 1.6) * 0.05 + (active ? 0.1 : 0))
    mesh.rotation.z = t * 0.3
  })

  return (
    <mesh ref={ring} position={position} material={m.emeraldGlow} castShadow={false}>
      <torusGeometry args={[0.11, 0.014, 10, 28]} />
    </mesh>
  )
}
