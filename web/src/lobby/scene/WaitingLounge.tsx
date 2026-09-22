/**
 * The waiting lounge: a three-seat sofa against the west wall, two armchairs
 * facing it, a low oak table on a wool rug.
 *
 * The Phase 1 seating was stacked boxes, which is why it read as furniture-
 * shaped rather than as furniture. Three things fix that here, in order of how
 * much they matter:
 *
 *  - Cushions are bevelled with a generous radius, so they catch a soft
 *    highlight along every edge the way stuffed upholstery does.
 *  - Seat and back are visibly separate objects with a gap between them,
 *    instead of one continuous mass.
 *  - Everything sits on legs with a contact shadow beneath, so it has weight.
 *
 * Seat height is 0.44 m to the top of the cushion. Footprints are unchanged
 * from Phase 1, so the colliders in layout.ts still match what you can see.
 */
import { CHAIRS, COFFEE_TABLE, LOUNGE_RUG, SOFA } from '../layout'
import { getMaterials } from './materials'
import { ContactShadow, Cylinder, Panel, RoundedBox } from './primitives'

/** Upholstery wants a big radius; this is a soft cushion, not a panel. */
const CUSHION = 0.055
const FRAME = 0.02
const SEAT_TOP = 0.44

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
  const legHeight = 0.13
  const baseHeight = 0.19
  const baseCentre = legHeight + baseHeight / 2
  const cushionHeight = 0.15
  const cushionCentre = SEAT_TOP - cushionHeight / 2
  const backX = x - 0.385

  return (
    <group>
      {/* Tapered oak legs, angled out slightly the way a mid-century frame is. */}
      {[-0.34, 0.34].flatMap((dx) =>
        [-1.05, 1.05].map((dz) => (
          <Cylinder
            key={`${dx}:${dz}`}
            radiusTop={0.032}
            radiusBottom={0.022}
            height={legHeight}
            segments={10}
            position={[x + dx, legHeight / 2, z + dz]}
            material={m.oakDark}
          />
        )),
      )}

      {/* Frame. Narrower than the cushions so the seat overhangs it. */}
      <RoundedBox
        size={[0.88, baseHeight, length - 0.06]}
        radius={FRAME}
        position={[x, baseCentre, z]}
        material={m.upholsteryDeep}
      />

      {/* Three seat cushions, with a gap between each so they read separately. */}
      {[-1, 0, 1].map((i) => (
        <RoundedBox
          key={i}
          size={[0.9, cushionHeight, 0.76]}
          radius={CUSHION}
          segments={3}
          position={[x + 0.02, cushionCentre, z + i * 0.8]}
          material={m.upholstery}
        />
      ))}

      {/* Back frame, then three back cushions standing proud of it. */}
      <RoundedBox
        size={[0.16, 0.66, length]}
        radius={FRAME}
        position={[backX, 0.75, z]}
        material={m.upholsteryDeep}
      />
      {[-1, 0, 1].map((i) => (
        <RoundedBox
          key={i}
          size={[0.17, 0.48, 0.74]}
          radius={CUSHION}
          segments={3}
          position={[backX + 0.15, 0.78, z + i * 0.8]}
          rotation={[0, 0, -0.06]}
          material={m.upholstery}
        />
      ))}

      {/* Arms: rounded bolsters, not slabs. */}
      {[-1, 1].map((side) => (
        <RoundedBox
          key={side}
          size={[0.9, 0.2, 0.19]}
          radius={0.075}
          segments={3}
          position={[x - 0.01, 0.62, z + side * 1.16]}
          material={m.upholstery}
        />
      ))}
      {[-1, 1].map((side) => (
        <RoundedBox
          key={side}
          size={[0.84, 0.3, 0.15]}
          radius={FRAME}
          position={[x - 0.01, 0.42, z + side * 1.16]}
          material={m.upholsteryDeep}
        />
      ))}

      {/* One emerald cushion. The accent appears once per seating group. */}
      <RoundedBox
        size={[0.13, 0.32, 0.32]}
        radius={0.06}
        segments={3}
        position={[x - 0.2, 0.68, z - 0.62]}
        rotation={[0, 0, 0.18]}
        material={m.emerald}
      />

      <ContactShadow position={[x, 0.005, z]} radius={0.62} scaleZ={2.1} opacity={0.5} />
    </group>
  )
}

/** Armchairs face west, towards the sofa. Same language, smaller. */
function Armchair({ x, z }: { x: number; z: number }) {
  const m = getMaterials()
  const legHeight = 0.13
  const baseHeight = 0.18
  const cushionHeight = 0.14
  const cushionCentre = SEAT_TOP - cushionHeight / 2

  return (
    <group>
      {[-0.28, 0.28].flatMap((dx) =>
        [-0.28, 0.28].map((dz) => (
          <Cylinder
            key={`${dx}:${dz}`}
            radiusTop={0.03}
            radiusBottom={0.02}
            height={legHeight}
            segments={10}
            position={[x + dx, legHeight / 2, z + dz]}
            material={m.oakDark}
          />
        )),
      )}

      <RoundedBox
        size={[0.72, baseHeight, 0.74]}
        radius={FRAME}
        position={[x, legHeight + baseHeight / 2, z]}
        material={m.upholsteryDeep}
      />
      <RoundedBox
        size={[0.74, cushionHeight, 0.72]}
        radius={CUSHION}
        segments={3}
        position={[x - 0.02, cushionCentre, z]}
        material={m.upholstery}
      />

      <RoundedBox
        size={[0.15, 0.56, 0.76]}
        radius={FRAME}
        position={[x + 0.3, 0.68, z]}
        material={m.upholsteryDeep}
      />
      <RoundedBox
        size={[0.16, 0.42, 0.66]}
        radius={CUSHION}
        segments={3}
        position={[x + 0.17, 0.7, z]}
        rotation={[0, 0, 0.07]}
        material={m.upholstery}
      />

      {[-1, 1].map((side) => (
        <RoundedBox
          key={side}
          size={[0.74, 0.17, 0.16]}
          radius={0.065}
          segments={3}
          position={[x, 0.6, z + side * 0.3]}
          material={m.upholstery}
        />
      ))}

      <ContactShadow position={[x, 0.005, z]} radius={0.52} opacity={0.45} />
    </group>
  )
}

function CoffeeTable() {
  const m = getMaterials()
  const { x, z, width, depth, height } = COFFEE_TABLE

  return (
    <group>
      <RoundedBox
        size={[width, 0.045, depth]}
        radius={0.008}
        position={[x, height, z]}
        material={m.oak}
      />
      <RoundedBox
        size={[width - 0.3, 0.025, depth - 0.3]}
        radius={0.006}
        position={[x, 0.17, z]}
        material={m.oakDark}
      />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <Cylinder
            key={`${sx}:${sz}`}
            radiusTop={0.026}
            radiusBottom={0.019}
            height={height - 0.02}
            segments={10}
            position={[x + sx * (width / 2 - 0.09), (height - 0.02) / 2, z + sz * (depth / 2 - 0.09)]}
            material={m.oakDark}
          />
        )),
      )}

      {/* A couple of brochures and a tray, so the table is not bare. */}
      <RoundedBox
        size={[0.28, 0.01, 0.21]}
        radius={0.003}
        position={[x - 0.3, height + 0.028, z + 0.09]}
        rotation={[0, 0.2, 0]}
        material={m.ivoryPanel}
      />
      <RoundedBox
        size={[0.28, 0.009, 0.21]}
        radius={0.003}
        position={[x - 0.27, height + 0.037, z - 0.05]}
        rotation={[0, -0.12, 0]}
        material={m.emerald}
      />
      <RoundedBox
        size={[0.34, 0.026, 0.24]}
        radius={0.01}
        position={[x + 0.35, height + 0.036, z]}
        material={m.oakLight}
      />

      <ContactShadow position={[x, 0.005, z]} radius={0.82} scaleZ={0.62} opacity={0.35} />
    </group>
  )
}
