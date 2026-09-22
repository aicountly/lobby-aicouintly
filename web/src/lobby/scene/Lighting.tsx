/**
 * Lighting.
 *
 * Phase 1 lit the room with five bright ceiling point lights and a strong
 * ambient. That is why it read flat: light arriving evenly from everywhere
 * leaves no gradient across a wall and no direction to any shadow, and the warm
 * colour on every source pushed the whole room orange.
 *
 * This rig has a clear hierarchy instead:
 *
 *  1. Daylight through the south glazing is the key, and the only shadow caster.
 *     One direction, one set of shadows, so the room has a legible sense of
 *     where the light is coming from.
 *  2. A cool sky / warm floor hemisphere plus the generated environment map do
 *     the fill. The cool sky is what cancels the orange cast — warm fixtures
 *     read as warm because something else in frame is cooler.
 *  3. Interior fittings are genuinely emissive *and* carry a small real light
 *     each, because an emissive material lights nothing on its own.
 *  4. A soft pool over the counter makes reception the brightest thing in view.
 */
import { useMemo } from 'react'
import { Object3D } from 'three'

import { CEILING_PANELS, DESK, ROOM } from '../layout'
import { LOBBY_QUALITY } from '../quality'
import type { LobbyQuality } from '../quality'

export function Lighting({ quality }: { quality: LobbyQuality }) {
  const profile = LOBBY_QUALITY[quality]

  return (
    <group>
      {/*
        Fill. Sky is deliberately cool and ground is muted oak: the bounce a real
        room gets off its own floor, without the sunset tint Phase 1 had.
      */}
      <hemisphereLight args={['#dce6ef', '#7d6d58', 0.26]} position={[0, ROOM.height, 0]} />

      <DaylightKey shadowMapSize={profile.shadowMapSize} />

      {/* Ceiling fittings: small, warm, unshadowed. */}
      {CEILING_PANELS.map((panel) => (
        <pointLight
          key={`${panel.x}:${panel.z}`}
          position={[panel.x, ROOM.height - 1.0, panel.z]}
          intensity={profile.accentLights ? 1.7 : 2.2}
          distance={9}
          decay={2}
          color="#ffeccf"
        />
      ))}

      <DeskPool />

      {profile.accentLights ? (
        <>
          {/* Wall-wash on the lounge side, so the west wall has a gradient. */}
          <pointLight position={[-5.6, 2.5, 1.2]} intensity={1.5} distance={7} decay={2} color="#ffeeda" />
          {/* A cool bounce back from the entrance glazing. */}
          <pointLight
            position={[0, 1.9, ROOM.halfDepth - 1.6]}
            intensity={1.2}
            distance={8}
            decay={2}
            color="#e8f0f6"
          />
        </>
      ) : null}
    </group>
  )
}

/**
 * The key light: daylight raking in through the south glazing.
 *
 * The shadow camera is fitted to the room rather than left at its defaults. A
 * directional light's shadow camera is an orthographic box in light space, and
 * every metre of it that falls outside the room is resolution thrown away —
 * which is the difference between soft shadows and blocky ones at 1024.
 */
function DaylightKey({ shadowMapSize }: { shadowMapSize: number }) {
  const target = useMemo(() => new Object3D(), [])

  return (
    <group>
      <primitive object={target} position={[-1, 1, -3]} />
      <directionalLight
        position={[7, 9.5, 17]}
        target={target}
        intensity={2.9}
        color="#fff6ea"
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        // Bias fights acne on the large flat floor; normalBias fights the gap
        // that opens under thin furniture legs when bias alone is raised.
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-camera-near={2}
        shadow-camera-far={46}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
      />
    </group>
  )
}

/** A soft pool over the counter, so reception reads as the focal point. */
function DeskPool() {
  const target = useMemo(() => new Object3D(), [])

  return (
    <group>
      {/* A spot light aims at light.target, and a target only tracks its own
          position once it is in the scene graph — hence the primitive. */}
      <primitive object={target} position={[DESK.x, 1.05, DESK.z]} />
      <spotLight
        position={[DESK.x, ROOM.height - 0.35, DESK.z + 2.2]}
        target={target}
        angle={0.62}
        penumbra={0.9}
        intensity={9}
        distance={11}
        decay={2}
        color="#fff0d8"
      />
    </group>
  )
}
