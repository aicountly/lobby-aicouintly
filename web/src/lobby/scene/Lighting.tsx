/**
 * Lighting.
 *
 * Daylight comes through the south glazing and is the only shadow-casting
 * light in the room — one shadow map is enough to ground the furniture, and
 * every extra one costs a full render pass. The ceiling coffers are backed by
 * unshadowed point lights, which is what stops the far corners going flat.
 */
import { useMemo } from 'react'
import { Object3D } from 'three'

import { CEILING_PANELS, DESK, ROOM } from '../layout'
import { LIGHT_COLORS } from '../theme'

export function Lighting({ shadows }: { shadows: boolean }) {
  return (
    <group>
      <hemisphereLight
        args={[LIGHT_COLORS.daylight, LIGHT_COLORS.bounce, 0.75]}
        position={[0, ROOM.height, 0]}
      />
      <ambientLight intensity={0.35} color={LIGHT_COLORS.warm} />

      {/* Daylight through the entrance doors. */}
      <directionalLight
        position={[3.5, 7.5, 17]}
        intensity={1.5}
        color={LIGHT_COLORS.daylight}
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0016}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={44}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
      />

      {/* One point light per ceiling coffer. */}
      {CEILING_PANELS.map((panel) => (
        <pointLight
          key={`${panel.x}:${panel.z}`}
          position={[panel.x, ROOM.height - 0.75, panel.z]}
          intensity={8}
          distance={14}
          decay={1.5}
          color={LIGHT_COLORS.warm}
        />
      ))}

      <DeskSpot />

      {/* A softer pool over the waiting lounge. */}
      <pointLight position={[-4.6, 2.6, 1.2]} intensity={7} distance={8} decay={1.6} color={LIGHT_COLORS.warm} />
    </group>
  )
}

/**
 * The accent that makes reception the brightest thing in the room.
 *
 * A spot light aims at `light.target`, and a target only tracks its position
 * once it is part of the scene graph — hence the <primitive>. Left out, the
 * beam points at the world origin instead of the counter.
 */
function DeskSpot() {
  const target = useMemo(() => new Object3D(), [])

  return (
    <group>
      <primitive object={target} position={[DESK.x, 1.1, DESK.z]} />
      <spotLight
        position={[DESK.x, ROOM.height - 0.25, DESK.z + 1.6]}
        target={target}
        angle={0.7}
        penumbra={0.75}
        intensity={19}
        distance={10}
        decay={1.5}
        color={LIGHT_COLORS.warm}
      />
    </group>
  )
}
