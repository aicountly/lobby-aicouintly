/**
 * The reception counter — the one piece of furniture the visitor is meant to
 * walk up to and use.
 *
 * The whole group is a click target, with an emerald marker floating above it
 * so it reads as interactive from across the room. A drag that turned into a
 * look is not a click, which is what `consumedByDrag` is for.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh } from 'three'

import { CREDENZA, DESK, DESK_BACK } from '../layout'
import type { NavigationController } from '../navigation/controller'
import { getMaterials } from './materials'
import { Box, Cylinder } from './primitives'

interface Props {
  controller: NavigationController
  onOpenServices: () => void
  reducedMotion: boolean
}

export function ReceptionDesk({ controller, onOpenServices, reducedMotion }: Props) {
  const m = getMaterials()
  const [hovered, setHovered] = useState(false)
  const canvas = useThree((state) => state.gl.domElement)

  const deskFrontZ = DESK.z + DESK.depth / 2

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
      {/* Counter. */}
      <Box
        size={[DESK.width, DESK.height - 0.12, DESK.depth]}
        position={[DESK.x, (DESK.height - 0.12) / 2 + 0.12, DESK.z]}
        material={m.oak}
      />
      <Box
        size={[DESK.width - 0.08, 0.12, DESK.depth - 0.08]}
        position={[DESK.x, 0.06, DESK.z]}
        material={m.graphite}
      />
      {/* Stone top, oversailing on all four sides. */}
      <Box
        size={[DESK.width + DESK.topOverhang * 2, 0.07, DESK.depth + DESK.topOverhang * 2]}
        position={[DESK.x, DESK.height + 0.035, DESK.z]}
        material={m.graphiteSoft}
      />
      {/* The restrained emerald reveal, across the visitor-facing front only. */}
      <Box
        size={[DESK.width - 0.3, 0.03, 0.03]}
        position={[DESK.x, 0.86, deskFrontZ + 0.015]}
        material={hovered ? m.emeraldGlow : m.emerald}
        castShadow={false}
      />

      {/* Working desk behind the counter. */}
      <Box
        size={[DESK_BACK.width, DESK_BACK.height, DESK_BACK.depth]}
        position={[DESK_BACK.x, DESK_BACK.height / 2, DESK_BACK.z]}
        material={m.oakLight}
      />
      <Box
        size={[DESK_BACK.width + 0.16, 0.05, DESK_BACK.depth + 0.14]}
        position={[DESK_BACK.x, DESK_BACK.height + 0.025, DESK_BACK.z]}
        material={m.graphiteSoft}
      />
      {[-1.2, 1.2].map((x) => (
        <group key={x}>
          <Cylinder
            radiusTop={0.09}
            height={0.02}
            position={[x, DESK_BACK.height + 0.06, DESK_BACK.z - 0.1]}
            material={m.graphite}
          />
          <Box
            size={[0.04, 0.16, 0.04]}
            position={[x, DESK_BACK.height + 0.14, DESK_BACK.z - 0.1]}
            material={m.graphite}
          />
          <Box
            size={[0.54, 0.33, 0.025]}
            position={[x, DESK_BACK.height + 0.38, DESK_BACK.z - 0.1]}
            rotation={[0.12, 0, 0]}
            material={m.graphite}
          />
        </group>
      ))}

      {/* Credenza against the feature wall. */}
      <Box
        size={[CREDENZA.width, CREDENZA.height, CREDENZA.depth]}
        position={[CREDENZA.x, CREDENZA.height / 2, CREDENZA.z]}
        material={m.oakDark}
      />
      <Box
        size={[CREDENZA.width + 0.1, 0.05, CREDENZA.depth + 0.08]}
        position={[CREDENZA.x, CREDENZA.height + 0.025, CREDENZA.z]}
        material={m.graphiteSoft}
      />

      <ServiceMarker
        position={[DESK.x, 1.45, deskFrontZ - 0.1]}
        active={hovered}
        reducedMotion={reducedMotion}
      />
    </group>
  )
}

/** A slowly breathing emerald ring that says "this is the thing you can use". */
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
    mesh.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06 + (active ? 0.12 : 0))
    mesh.rotation.z = t * 0.35
  })

  return (
    <mesh ref={ring} position={position} material={m.emeraldGlow}>
      <torusGeometry args={[0.13, 0.018, 10, 28]} />
    </mesh>
  )
}
