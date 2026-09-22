/**
 * The shapes the lobby is built from.
 *
 * Phase 1 used raw boxes everywhere, which is most of why the furniture read as
 * blocks. The important addition here is `RoundedBox`: real geometry with a
 * bevel, so every visible edge catches a highlight instead of dying on a hard
 * 90° corner. Manufactured furniture has a radius on every edge you can touch,
 * and the eye notices its absence long before it notices a texture.
 *
 * Geometries are cached by dimension. A lobby has a lot of repeated parts —
 * cushions, legs, slats — and building a fresh BufferGeometry per mesh would
 * spend memory and upload time on identical data.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CircleGeometry, DoubleSide, MeshBasicMaterial } from 'three'
import type * as THREE from 'three'

import { contactShadowTexture } from './textures'

export type Vec3 = [number, number, number]

interface SolidProps {
  position: Vec3
  rotation?: Vec3
  material: THREE.Material
  castShadow?: boolean
  receiveShadow?: boolean
  visible?: boolean
  children?: ReactNode
}

interface BoxProps extends SolidProps {
  /** width (x), height (y), depth (z) */
  size: Vec3
}

export function Box({
  size,
  position,
  rotation,
  material,
  castShadow = true,
  receiveShadow = true,
  visible,
  children,
}: BoxProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      visible={visible}
    >
      <boxGeometry args={size} />
      {children}
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Rounded box
// ---------------------------------------------------------------------------

const roundedCache = new Map<string, RoundedBoxGeometry>()

/**
 * A bevelled box, cached by its exact dimensions.
 *
 * The radius is clamped to just under half the smallest side: RoundedBoxGeometry
 * degenerates if the bevel is larger than the shape it is bevelling, and a thin
 * cushion asking for a 40 mm radius is an easy mistake to make.
 */
function roundedGeometry(size: Vec3, radius: number, segments: number): RoundedBoxGeometry {
  const safeRadius = Math.max(0.001, Math.min(radius, Math.min(...size) / 2 - 0.001))
  const key = `${size[0]}:${size[1]}:${size[2]}:${safeRadius.toFixed(4)}:${segments}`

  let geometry = roundedCache.get(key)
  if (!geometry) {
    geometry = new RoundedBoxGeometry(size[0], size[1], size[2], segments, safeRadius)
    roundedCache.set(key, geometry)
  }
  return geometry
}

interface RoundedBoxProps extends SolidProps {
  size: Vec3
  /** Bevel radius in metres. 0.006–0.02 suits joinery; 0.05+ suits cushions. */
  radius?: number
  /** Bevel smoothness. 2 is plenty for joinery, 3–4 for upholstery. */
  segments?: number
}

export function RoundedBox({
  size,
  radius = 0.012,
  segments = 2,
  position,
  rotation,
  material,
  castShadow = true,
  receiveShadow = true,
  visible,
}: RoundedBoxProps) {
  const geometry = useMemo(
    () => roundedGeometry(size, radius, segments),
    [size, radius, segments],
  )

  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      material={material}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      visible={visible}
    />
  )
}

/** Free every cached rounded geometry. Called when the lobby unmounts. */
export function disposeRoundedGeometries(): void {
  for (const geometry of roundedCache.values()) geometry.dispose()
  roundedCache.clear()
}

// ---------------------------------------------------------------------------
// Cylinder and plane
// ---------------------------------------------------------------------------

interface CylinderProps extends SolidProps {
  radiusTop: number
  radiusBottom?: number
  height: number
  segments?: number
}

export function Cylinder({
  radiusTop,
  radiusBottom,
  height,
  segments = 16,
  position,
  rotation,
  material,
  castShadow = true,
  receiveShadow = true,
}: CylinderProps) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      material={material}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      <cylinderGeometry args={[radiusTop, radiusBottom ?? radiusTop, height, segments]} />
    </mesh>
  )
}

interface PanelProps {
  /** width (x), height (y) — a flat plane, before rotation. */
  size: [number, number]
  position: Vec3
  rotation?: Vec3
  material: THREE.Material
  receiveShadow?: boolean
}

/** A flat plane: floors, ceilings, rugs, signage. */
export function Panel({ size, position, rotation, material, receiveShadow = true }: PanelProps) {
  return (
    <mesh position={position} rotation={rotation} material={material} receiveShadow={receiveShadow}>
      <planeGeometry args={size} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Contact shadow
// ---------------------------------------------------------------------------

/**
 * Shared contact-shadow resources, one material per opacity bucket.
 *
 * Bucketing rather than a material per mesh keeps the count to two or three
 * while still letting a plant cast a lighter pool than a sofa.
 */
const contactMaterials = new Map<number, MeshBasicMaterial>()
let contactGeometry: CircleGeometry | null = null
let contactMap: THREE.Texture | null = null

function contactResources(opacity: number) {
  const bucket = Math.round(opacity * 10) / 10
  if (!contactMap) contactMap = contactShadowTexture()
  if (!contactGeometry) contactGeometry = new CircleGeometry(0.5, 20)

  let material = contactMaterials.get(bucket)
  if (!material) {
    material = new MeshBasicMaterial({
      map: contactMap,
      transparent: true,
      opacity: bucket,
      depthWrite: false,
      side: DoubleSide,
    })
    contactMaterials.set(bucket, material)
  }
  return { material, geometry: contactGeometry }
}

/**
 * A soft darkening pool under a piece of furniture.
 *
 * A single shadow-casting light cannot resolve the tight occlusion where a sofa
 * leg meets the floor, and adding shadow maps to fix it is expensive. This is
 * the cheap honest substitute: furniture stops looking like it is hovering, for
 * one transparent quad each.
 */
export function ContactShadow({
  position,
  radius,
  opacity = 0.5,
  scaleZ = 1,
}: {
  position: Vec3
  radius: number
  opacity?: number
  /** Stretch along Z for long items like a sofa. */
  scaleZ?: number
}) {
  const { material, geometry } = contactResources(opacity)
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[radius * 2, radius * 2 * scaleZ, 1]}
      renderOrder={-1}
    />
  )
}

/** Free the shared contact-shadow resources. */
export function disposeContactShadow(): void {
  for (const material of contactMaterials.values()) material.dispose()
  contactMaterials.clear()
  contactMap?.dispose()
  contactGeometry?.dispose()
  contactMap = null
  contactGeometry = null
}
