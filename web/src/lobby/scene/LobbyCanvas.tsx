/**
 * The WebGL surface.
 *
 * Kept deliberately thin: it sets up the renderer and hands off. Anything that
 * can fail here — context creation, a lost context — is reported upwards so the
 * experience can fall back to Standard View instead of showing a dead canvas.
 */
import { useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import type { RootState } from '@react-three/fiber'
import { ACESFilmicToneMapping, Color, PCFSoftShadowMap } from 'three'

import type { LobbyAssets } from '../assets/assetConfig'
import { EYE_HEIGHT, waypoint, yawTowards } from '../layout'
import type { NavigationController } from '../navigation/controller'
import { LobbyScene } from './LobbyScene'

interface Props {
  controller: NavigationController
  assets: LobbyAssets
  reducedMotion: boolean
  onOpenServices: () => void
  onContextLost: () => void
}

export function LobbyCanvas({
  controller,
  assets,
  reducedMotion,
  onOpenServices,
  onContextLost,
}: Props) {
  const start = waypoint('entrance')

  const handleCreated = useCallback(
    (state: RootState) => {
      state.gl.toneMapping = ACESFilmicToneMapping
      state.gl.toneMappingExposure = 0.92
      state.gl.shadowMap.type = PCFSoftShadowMap
      // The room is closed, so this should never be visible — but if a seam
      // ever opens up it shows daylight rather than a black hole.
      state.scene.background = new Color('#e8e1d4')

      // Start the visitor facing into the room rather than at whatever the
      // default camera happened to be pointing at.
      state.camera.rotation.order = 'YXZ'
      state.camera.rotation.set(0, yawTowards(start.x, start.z, start.lookAtX, start.lookAtZ), 0)

      state.gl.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        onContextLost()
      })
    },
    [onContextLost, start],
  )

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ fov: 62, near: 0.08, far: 80, position: [start.x, EYE_HEIGHT, start.z] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={handleCreated}
    >
      <LobbyScene
        controller={controller}
        assets={assets}
        reducedMotion={reducedMotion}
        shadows
        onOpenServices={onOpenServices}
      />
    </Canvas>
  )
}
