/**
 * The loose items: planters and the wayfinding directory by the entrance.
 */
import { DIRECTORY, PLANTERS } from '../layout'
import { getMaterials } from './materials'
import { Box, Cylinder } from './primitives'
import { SignPlane } from './Signage'

export function Furnishings() {
  return (
    <group>
      {PLANTERS.map((planter) => (
        <Planter
          key={`${planter.x}:${planter.z}`}
          x={planter.x}
          z={planter.z}
          radius={planter.radius}
          height={planter.height}
        />
      ))}
      <Directory />
    </group>
  )
}

function Planter({
  x,
  z,
  radius,
  height,
}: {
  x: number
  z: number
  radius: number
  height: number
}) {
  const m = getMaterials()

  // Deterministic leaf placement: the same plant on every load.
  const leaves = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * Math.PI * 2 + (x + z)
    const lean = 0.35 + (i % 3) * 0.16
    const leafHeight = 0.55 + (i % 4) * 0.22
    return { angle, lean, leafHeight }
  })

  return (
    <group>
      <Cylinder
        radiusTop={radius}
        radiusBottom={radius * 0.78}
        height={height}
        position={[x, height / 2, z]}
        material={m.pot}
      />
      <Cylinder
        radiusTop={radius * 0.92}
        height={0.04}
        position={[x, height - 0.01, z]}
        material={m.oakDeepPanel}
      />
      {leaves.map((leaf, i) => (
        <mesh
          key={i}
          position={[
            x + Math.cos(leaf.angle) * radius * 0.35,
            height + leaf.leafHeight / 2,
            z + Math.sin(leaf.angle) * radius * 0.35,
          ]}
          rotation={[Math.sin(leaf.angle) * leaf.lean, leaf.angle, Math.cos(leaf.angle) * leaf.lean]}
          material={i % 2 === 0 ? m.foliage : m.foliageDeep}
          castShadow
        >
          <coneGeometry args={[radius * 0.55, leaf.leafHeight, 5, 1, true]} />
        </mesh>
      ))}
    </group>
  )
}

/** A free-standing directory board, facing the entrance doors. */
function Directory() {
  const m = getMaterials()
  const { x, z, width, depth, height } = DIRECTORY

  return (
    <group>
      <Cylinder radiusTop={0.26} height={0.04} position={[x, 0.02, z]} material={m.graphite} />
      <Box size={[0.09, height, 0.09]} position={[x, height / 2, z]} material={m.graphite} />
      <Box
        size={[width, 0.92, depth]}
        position={[x, height - 0.1, z]}
        material={m.graphite}
      />
      <Box
        size={[width - 0.08, 0.84, 0.02]}
        position={[x, height - 0.1, z + depth / 2 + 0.012]}
        material={m.oakDeepPanel}
      />
      <SignPlane
        text="Welcome"
        eyebrow="Aicountly"
        size={[width - 0.12, 0.42]}
        position={[x, height + 0.1, z + depth / 2 + 0.026]}
        fontSize={104}
        color="#f8f4ec"
      />
      <SignPlane
        text="Reception · Lounge · Meetings"
        size={[width - 0.12, 0.2]}
        position={[x, height - 0.36, z + depth / 2 + 0.026]}
        fontSize={54}
        color="#cbd3d6"
      />
    </group>
  )
}
