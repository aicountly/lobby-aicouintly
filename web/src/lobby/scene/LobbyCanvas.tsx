/**
 * The WebGL surface.
 *
 * Kept deliberately thin: it configures the renderer and hands off. Anything
 * that can fail here — context creation, a lost context — is reported upwards so
 * the experience can fall back to Standard View instead of showing a dead canvas.
 *
 * R3F's <Canvas> owns the renderer, so tone mapping and colour space are set
 * here and nowhere else. There is no postprocessing composer in this scene, so
 * the conversion happens exactly once, on output.
 */
import { useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import type { RootState } from '@react-three/fiber'
import { ACESFilmicToneMapping, Color, PCFSoftShadowMap, SRGBColorSpace } from 'three'

import type { LobbyAssets } from '../assets/assetConfig'
import { EYE_HEIGHT, waypoint, yawTowards } from '../layout'
import type { NavigationController } from '../navigation/controller'
import { LOBBY_QUALITY } from '../quality'
import type { LobbyQuality } from '../quality'
import { LobbyScene } from './LobbyScene'
import type { TextureLoadReport } from './textureSet'

interface Props {
  controller: NavigationController
  assets: LobbyAssets
  reducedMotion: boolean
  quality: LobbyQuality
  onOpenServices: () => void
  onContextLost: () => void
  onTexturesSettled?: (report: TextureLoadReport) => void
}

export function LobbyCanvas({
  controller,
  assets,
  reducedMotion,
  quality,
  onOpenServices,
  onContextLost,
  onTexturesSettled,
}: Props) {
  const start = waypoint('entrance')
  const profile = LOBBY_QUALITY[quality]

  const handleCreated = useCallback(
    (state: RootState) => {
      state.gl.outputColorSpace = SRGBColorSpace
      state.gl.toneMapping = ACESFilmicToneMapping
      // Tuned against screenshots rather than guessed: the room is lit by one
      // strong key plus image-based fill, and anything above ~1 blows out the
      // ivory plaster where the daylight lands.
      state.gl.toneMappingExposure = 0.82
      state.gl.shadowMap.enabled = true
      state.gl.shadowMap.type = PCFSoftShadowMap

      // The room is closed, so this should never be visible — but if a seam
      // ever opens up it shows daylight rather than a black hole.
      state.scene.background = new Color('#e4ddd0')

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
      // Pixel ratio is the single biggest fill-rate lever, so it is the first
      // thing the quality profile turns down.
      dpr={[1, profile.maxDpr]}
      camera={{ fov: 62, near: 0.08, far: 80, position: [start.x, EYE_HEIGHT, start.z] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={handleCreated}
    >
      <LobbyScene
        controller={controller}
        assets={assets}
        reducedMotion={reducedMotion}
        quality={quality}
        onOpenServices={onOpenServices}
        onTexturesSettled={onTexturesSettled}
      />
    </Canvas>
  )
}
