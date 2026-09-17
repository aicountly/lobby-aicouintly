/**
 * The placeholder receptionist.
 *
 * This is a stand-in, and it is built to look like one: blocked-out volumes, a
 * featureless head, and a badge on its chest that says PLACEHOLDER. It has no
 * face, so there is nothing here that could be mistaken for facial animation,
 * lip-sync or a speaking character — none of which this phase implements.
 *
 * It is replaced, not edited: point `receptionist.url` in the asset manifest at
 * a rigged glTF and this geometry is never mounted. See ../assets/assetConfig.ts
 * and docs/lobby/ASSETS.md for the rig the final character has to satisfy.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'

import { RECEPTIONIST_SPOT } from '../layout'
import { getMaterials } from './materials'
import { Box, Cylinder } from './primitives'
import { placeholderBadgeTexture, signTexture } from './textures'

export function PlaceholderReceptionist({ reducedMotion }: { reducedMotion: boolean }) {
  const m = getMaterials()
  const root = useRef<Group>(null)

  const badge = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: placeholderBadgeTexture(),
        toneMapped: false,
      }),
    [],
  )

  const label = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: signTexture('Placeholder receptionist', {
          width: 640,
          height: 128,
          fontSize: 62,
          background: 'rgba(35,40,44,0.92)',
          color: '#f6f1e8',
        }),
        toneMapped: false,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      badge.map?.dispose()
      badge.dispose()
      label.map?.dispose()
      label.dispose()
    },
    [badge, label],
  )

  // A slow weight shift, so the figure is not a statue. It is deliberately the
  // only motion: no gestures, no head tracking, nothing that would suggest the
  // placeholder is reacting to the visitor.
  useFrame((state) => {
    const group = root.current
    if (!group) return
    if (reducedMotion) {
      group.position.y = 0
      group.rotation.y = RECEPTIONIST_SPOT.facing
      return
    }
    const t = state.clock.elapsedTime
    group.position.y = Math.sin(t * 0.9) * 0.012
    group.rotation.y = RECEPTIONIST_SPOT.facing + Math.sin(t * 0.35) * 0.05
  })

  return (
    <group
      ref={root}
      position={[RECEPTIONIST_SPOT.x, 0, RECEPTIONIST_SPOT.z]}
      rotation={[0, RECEPTIONIST_SPOT.facing, 0]}
    >
      {/* Shoes and legs. */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <Box size={[0.11, 0.07, 0.26]} position={[x, 0.035, 0.03]} material={m.graphite} />
          <Cylinder
            radiusTop={0.075}
            radiusBottom={0.085}
            height={0.78}
            position={[x, 0.46, 0]}
            material={m.graphite}
          />
        </group>
      ))}

      {/* Hips and torso. */}
      <Box size={[0.34, 0.2, 0.22]} position={[0, 0.94, 0]} material={m.placeholderBody} />
      <Cylinder
        radiusTop={0.2}
        radiusBottom={0.18}
        height={0.52}
        segments={20}
        position={[0, 1.3, 0]}
        material={m.placeholderBody}
      />
      {/* Shoulders. */}
      <Cylinder
        radiusTop={0.07}
        height={0.44}
        segments={12}
        position={[0, 1.54, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={m.placeholderBody}
      />

      {/* Arms, resting slightly forward as if at the counter. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Cylinder
            radiusTop={0.055}
            height={0.42}
            position={[side * 0.24, 1.32, 0.015]}
            rotation={[0.08, 0, side * 0.06]}
            material={m.placeholderBody}
          />
          <Cylinder
            radiusTop={0.05}
            height={0.4}
            position={[side * 0.245, 1.0, 0.13]}
            rotation={[0.55, 0, side * 0.04]}
            material={m.placeholderBody}
          />
          <mesh position={[side * 0.25, 0.84, 0.28]} material={m.placeholderBody} castShadow>
            <sphereGeometry args={[0.058, 12, 10]} />
          </mesh>
        </group>
      ))}

      {/* The single emerald accent: a lanyard, not a uniform. */}
      <Box size={[0.07, 0.24, 0.03]} position={[0, 1.22, 0.185]} material={m.placeholderAccent} />

      {/* Badge, worn high enough to clear the 1.19m counter — the model has to
          be able to say what it is from the visitor's side of the desk. */}
      <mesh position={[0, 1.45, 0.2]} material={badge}>
        <planeGeometry args={[0.26, 0.13]} />
      </mesh>

      {/* And again above head height, so there is no reading of this figure
          that mistakes it for finished art. */}
      <mesh position={[0, 2.68, 0]} material={label}>
        <planeGeometry args={[0.95, 0.19]} />
      </mesh>

      {/* Neck and a featureless head — no face, by design. */}
      <Cylinder radiusTop={0.055} height={0.1} position={[0, 1.62, 0]} material={m.placeholderBody} />
      <mesh position={[0, 1.76, 0]} material={m.placeholderBody} castShadow>
        <sphereGeometry args={[0.115, 20, 16]} />
      </mesh>
      {/* A blocked-in hair mass, so the silhouette reads as a person. */}
      <mesh position={[0, 1.79, -0.015]} material={m.graphiteSoft} castShadow>
        <sphereGeometry args={[0.122, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
      </mesh>
    </group>
  )
}
