/**
 * Planting.
 *
 * Phase 1's plants were cones, which is exactly what they looked like. A real
 * leaf has no straight edges: it widens from the stem, reaches its broadest
 * point past halfway, tapers to a rounded point, bends under its own weight and
 * folds slightly along its midrib.
 *
 * So the leaf here is generated as a curved, tapered ribbon with a channel
 * across it. It is solid geometry with no alpha at all — a cut-out leaf texture
 * would mean transparent overdraw on every frond, which is one of the easiest
 * ways to lose a mobile frame budget on decoration nobody is looking at.
 *
 * Leaves are double-sided because a ribbon genuinely has two visible faces;
 * nothing else in the room is.
 */
import { useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, MeshStandardMaterial } from 'three'

import { PLANTERS } from '../layout'
import { getMaterials } from './materials'
import { ContactShadow, Cylinder } from './primitives'

/**
 * A curved, tapered leaf.
 *
 * @param length  stem-to-tip, metres
 * @param width   broadest width, metres
 * @param bend    how far the tip droops forward
 * @param curl    depth of the channel along the midrib
 */
function createLeafGeometry(
  length: number,
  width: number,
  bend: number,
  curl: number,
  lengthSegments = 10,
  widthSegments = 4,
): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= lengthSegments; i += 1) {
    const t = i / lengthSegments

    // Spine: rises and bends forward, steeper towards the tip.
    const spineY = length * t
    const spineZ = bend * t * t

    // Width profile. The sine keeps the base narrow and the tip rounded rather
    // than pointed — the difference between a leaf and a spike.
    const halfWidth = (width / 2) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.85)

    for (let j = 0; j <= widthSegments; j += 1) {
      const u = (j / widthSegments) * 2 - 1
      // Channel: the blade folds up away from the midrib.
      const fold = curl * u * u * halfWidth
      positions.push(u * halfWidth, spineY + fold, spineZ)
      uvs.push((u + 1) / 2, t)
    }
  }

  const stride = widthSegments + 1
  for (let i = 0; i < lengthSegments; i += 1) {
    for (let j = 0; j < widthSegments; j += 1) {
      const a = i * stride + j
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Two leaf shapes, shared by every plant in the room. */
const leafCache = new Map<string, BufferGeometry>()

function leafGeometry(kind: 'broad' | 'blade'): BufferGeometry {
  let geometry = leafCache.get(kind)
  if (!geometry) {
    geometry =
      kind === 'broad'
        ? createLeafGeometry(0.46, 0.3, 0.16, 0.28)
        : createLeafGeometry(0.72, 0.11, 0.1, 0.5, 12, 3)
    leafCache.set(kind, geometry)
  }
  return geometry
}

let foliageMaterials: { light: MeshStandardMaterial; deep: MeshStandardMaterial } | null = null

function getFoliageMaterials() {
  if (!foliageMaterials) {
    const base = getMaterials()
    // Cloned so the leaves can be double-sided without forcing it on anything
    // else that uses the foliage colour.
    const light = base.foliage.clone()
    const deep = base.foliageDeep.clone()
    light.side = DoubleSide
    deep.side = DoubleSide
    foliageMaterials = { light, deep }
  }
  return foliageMaterials
}

export function disposeFoliage(): void {
  for (const geometry of leafCache.values()) geometry.dispose()
  leafCache.clear()
  foliageMaterials?.light.dispose()
  foliageMaterials?.deep.dispose()
  foliageMaterials = null
}

/** Deterministic jitter, so a plant looks natural but never changes between loads. */
function wobble(seed: number, index: number): number {
  const v = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453
  return v - Math.floor(v)
}

interface PlantProps {
  x: number
  z: number
  radius: number
  height: number
  kind: 'broad' | 'blade'
  seed: number
}

function Plant({ x, z, radius, height, kind, seed }: PlantProps) {
  const m = getMaterials()
  const leaves = getFoliageMaterials()
  const geometry = leafGeometry(kind)

  const arrangement = useMemo(() => {
    const count = kind === 'broad' ? 13 : 17
    return Array.from({ length: count }, (_, i) => {
      const r1 = wobble(seed, i)
      const r2 = wobble(seed + 3.7, i)
      const r3 = wobble(seed + 9.1, i)
      // Spiral phyllotaxis rather than an even fan: real stems do not share a plane.
      const angle = i * 2.399 + r1 * 0.35
      // Outer leaves lean further out and hang lower.
      const tier = i / count
      const lean = (kind === 'broad' ? 0.5 : 0.28) + tier * 0.6 + r2 * 0.2
      const scale = (kind === 'broad' ? 0.85 : 0.8) + r3 * 0.45
      const rise = height + 0.04 + (1 - tier) * (kind === 'broad' ? 0.12 : 0.2)
      const offset = radius * 0.28 * (0.4 + r1 * 0.6)
      return { angle, lean, scale, rise, offset, dark: r2 > 0.55 }
    })
  }, [kind, seed, radius, height])

  return (
    <group>
      {/* Tapered pot with a rolled rim. */}
      <Cylinder
        radiusTop={radius}
        radiusBottom={radius * 0.74}
        height={height}
        segments={24}
        position={[x, height / 2, z]}
        material={m.pot}
      />
      <Cylinder
        radiusTop={radius * 1.04}
        radiusBottom={radius * 1.02}
        height={0.035}
        segments={24}
        position={[x, height - 0.012, z]}
        material={m.pot}
      />
      {/* Soil, set below the rim so you see into the pot. */}
      <Cylinder
        radiusTop={radius * 0.93}
        height={0.02}
        segments={20}
        position={[x, height - 0.05, z]}
        material={m.oakDeepPanel}
      />

      {arrangement.map((leaf, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={leaf.dark ? leaves.deep : leaves.light}
          position={[
            x + Math.cos(leaf.angle) * leaf.offset,
            leaf.rise,
            z + Math.sin(leaf.angle) * leaf.offset,
          ]}
          rotation={[leaf.lean, -leaf.angle, 0]}
          scale={leaf.scale}
          castShadow
        />
      ))}

      <ContactShadow position={[x, 0.005, z]} radius={radius * 2.1} opacity={0.4} />
    </group>
  )
}

export function Planting() {
  return (
    <group>
      {PLANTERS.map((planter, i) => (
        <Plant
          key={`${planter.x}:${planter.z}`}
          x={planter.x}
          z={planter.z}
          radius={planter.radius}
          height={planter.height}
          kind={i === 2 ? 'blade' : 'broad'}
          seed={11 + i * 7.3}
        />
      ))}
    </group>
  )
}
