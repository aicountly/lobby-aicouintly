/**
 * The handful of shapes the whole lobby is built from.
 *
 * Every piece of furniture in this room is boxes and cylinders, so these
 * wrappers exist to keep the geometry files readable: a sofa should look like a
 * list of parts, not a wall of mesh boilerplate.
 */
import type { ReactNode } from 'react'
import type * as THREE from 'three'

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
