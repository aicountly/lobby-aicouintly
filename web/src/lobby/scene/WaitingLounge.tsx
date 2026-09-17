/**
 * The waiting lounge: a three-seat sofa against the west wall, two armchairs
 * facing it, a low oak table on a wool rug.
 *
 * Every piece here has a matching entry in COLLIDERS, so the seating you can
 * see is the seating you cannot walk through.
 */
import { CHAIRS, COFFEE_TABLE, LOUNGE_RUG, SOFA } from '../layout'
import { getMaterials } from './materials'
import { Box, Cylinder, Panel } from './primitives'

export function WaitingLounge() {
  const m = getMaterials()

  return (
    <group>
      <Panel
        size={[LOUNGE_RUG.width, LOUNGE_RUG.depth]}
        position={[LOUNGE_RUG.x, 0.004, LOUNGE_RUG.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={m.rug}
      />

      <Sofa />
      {CHAIRS.map((chair) => (
        <Armchair key={`${chair.x}:${chair.z}`} x={chair.x} z={chair.z} />
      ))}
      <CoffeeTable />
    </group>
  )
}

function Sofa() {
  const m = getMaterials()
  const { x, z, length } = SOFA

  return (
    <group>
      {/* Legs. */}
      {[-0.36, 0.36].flatMap((dx) =>
        [-1.1, 1.1].map((dz) => (
          <Cylinder
            key={`${dx}:${dz}`}
            radiusTop={0.04}
            height={0.12}
            position={[x + dx, 0.06, z + dz]}
            material={m.oakDark}
          />
        )),
      )}

      <Box size={[0.95, 0.3, length]} position={[x, 0.27, z]} material={m.upholsteryDeep} />

      {/* Seat cushions. */}
      {[-1, 0, 1].map((i) => (
        <Box
          key={i}
          size={[0.84, 0.15, 0.76]}
          position={[x + 0.02, 0.495, z + i * 0.8]}
          material={m.upholstery}
        />
      ))}

      {/* Back and back cushions. */}
      <Box size={[0.18, 0.66, length]} position={[x - 0.385, 0.75, z]} material={m.upholsteryDeep} />
      {[-1, 0, 1].map((i) => (
        <Box
          key={i}
          size={[0.13, 0.46, 0.72]}
          position={[x - 0.26, 0.82, z + i * 0.8]}
          material={m.upholstery}
        />
      ))}

      {/* Arms. */}
      {[-1, 1].map((side) => (
        <Box
          key={side}
          size={[0.93, 0.22, 0.16]}
          position={[x - 0.01, 0.68, z + side * 1.17]}
          material={m.upholsteryDeep}
        />
      ))}

      {/* One emerald cushion. The accent colour appears once per seating group. */}
      <Box
        size={[0.14, 0.34, 0.34]}
        position={[x - 0.22, 0.72, z - 0.62]}
        rotation={[0, 0, 0.16]}
        material={m.emerald}
      />
    </group>
  )
}

/** Armchairs face west, towards the sofa. */
function Armchair({ x, z }: { x: number; z: number }) {
  const m = getMaterials()

  return (
    <group>
      {[-0.3, 0.3].flatMap((dx) =>
        [-0.3, 0.3].map((dz) => (
          <Cylinder
            key={`${dx}:${dz}`}
            radiusTop={0.035}
            height={0.12}
            position={[x + dx, 0.06, z + dz]}
            material={m.oakDark}
          />
        )),
      )}

      <Box size={[0.8, 0.28, 0.82]} position={[x, 0.26, z]} material={m.upholsteryDeep} />
      <Box size={[0.7, 0.14, 0.72]} position={[x - 0.02, 0.47, z]} material={m.upholstery} />
      <Box size={[0.16, 0.6, 0.82]} position={[x + 0.32, 0.7, z]} material={m.upholsteryDeep} />
      <Box size={[0.1, 0.42, 0.66]} position={[x + 0.2, 0.72, z]} material={m.upholstery} />
      {[-1, 1].map((side) => (
        <Box
          key={side}
          size={[0.8, 0.18, 0.14]}
          position={[x, 0.62, z + side * 0.34]}
          material={m.upholsteryDeep}
        />
      ))}
    </group>
  )
}

function CoffeeTable() {
  const m = getMaterials()
  const { x, z, width, depth, height } = COFFEE_TABLE

  return (
    <group>
      <Box size={[width, 0.06, depth]} position={[x, height, z]} material={m.oak} />
      <Box size={[width - 0.24, 0.04, depth - 0.24]} position={[x, 0.16, z]} material={m.oakDark} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Box
            key={`${sx}:${sz}`}
            size={[0.07, height - 0.03, 0.07]}
            position={[x + sx * (width / 2 - 0.1), (height - 0.03) / 2, z + sz * (depth / 2 - 0.1)]}
            material={m.oakDark}
          />
        )),
      )}

      {/* A couple of brochures and a tray, so the table is not bare. */}
      <Box
        size={[0.3, 0.012, 0.22]}
        position={[x - 0.32, height + 0.04, z + 0.1]}
        rotation={[0, 0.2, 0]}
        material={m.ivoryPanel}
      />
      <Box
        size={[0.3, 0.012, 0.22]}
        position={[x - 0.28, height + 0.05, z - 0.06]}
        rotation={[0, -0.12, 0]}
        material={m.emerald}
      />
      <Box size={[0.36, 0.03, 0.26]} position={[x + 0.36, height + 0.045, z]} material={m.oakLight} />
    </group>
  )
}
