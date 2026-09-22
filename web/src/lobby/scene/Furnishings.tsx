/**
 * Loose items: the planting and the wayfinding directory by the entrance.
 */
import { DIRECTORY } from '../layout'
import { Planting } from './Foliage'
import { getMaterials } from './materials'
import { ContactShadow, Cylinder, RoundedBox } from './primitives'
import { SignPlane } from './Signage'

export function Furnishings() {
  return (
    <group>
      <Planting />
      <Directory />
    </group>
  )
}

/** A free-standing directory board, facing the entrance doors. */
function Directory() {
  const m = getMaterials()
  const { x, z, width, depth, height } = DIRECTORY

  return (
    <group>
      <Cylinder radiusTop={0.24} radiusBottom={0.26} height={0.03} segments={24} position={[x, 0.015, z]} material={m.graphite} />
      <Cylinder radiusTop={0.035} height={height} segments={12} position={[x, height / 2, z]} material={m.metal} />
      <RoundedBox
        size={[width, 0.94, depth]}
        radius={0.01}
        position={[x, height - 0.08, z]}
        material={m.graphite}
      />
      <RoundedBox
        size={[width - 0.07, 0.86, 0.014]}
        radius={0.004}
        position={[x, height - 0.08, z + depth / 2 + 0.008]}
        material={m.oakDeepPanel}
      />
      <SignPlane
        text="Welcome"
        eyebrow="Aicountly"
        size={[width - 0.13, 0.4]}
        position={[x, height + 0.11, z + depth / 2 + 0.018]}
        fontSize={104}
        color="#f6f2ea"
      />
      <SignPlane
        text="Reception · Lounge · Meetings"
        size={[width - 0.13, 0.19]}
        position={[x, height - 0.35, z + depth / 2 + 0.018]}
        fontSize={54}
        color="#c3ccd0"
      />
      <ContactShadow position={[x, 0.005, z]} radius={0.38} opacity={0.4} />
    </group>
  )
}
