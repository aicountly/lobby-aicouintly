/**
 * Loads the shared GPU resources the scene needs, from inside the Canvas.
 *
 * This lives as a component rather than in `onCreated` because it needs the
 * renderer *and* a React lifecycle: textures arrive over HTTP, the visitor can
 * change quality while they are in flight, and leaving the lobby has to release
 * everything. Rendering nothing is the point — it only manages resources.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

import { LOBBY_QUALITY } from '../quality'
import type { LobbyQuality } from '../quality'
import { getLobbyEnvironment } from './environment'
import { attachSurfaceMaps } from './materials'
import { getTextureReport, loadSurfaceTextures, setTextureAnisotropy } from './textureSet'
import type { TextureLoadReport } from './textureSet'

interface Props {
  quality: LobbyQuality
  onTexturesSettled?: (report: TextureLoadReport) => void
}

export function SceneResources({ quality, onTexturesSettled }: Props) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const profile = LOBBY_QUALITY[quality]

  // Image-based lighting. Generated once per renderer and reused; clearing it
  // on unmount stops a stale cube map holding the scene alive.
  useEffect(() => {
    if (!profile.environmentEnabled) {
      scene.environment = null
      return
    }
    scene.environment = getLobbyEnvironment(gl)
    return () => {
      scene.environment = null
    }
  }, [gl, scene, profile.environmentEnabled])

  // The PBR maps. Materials already exist with flat colours, so nothing is
  // blocked on this: the room is walkable before the first texture lands.
  useEffect(() => {
    let cancelled = false

    void loadSurfaceTextures(gl, profile.maxAnisotropy).then((maps) => {
      if (cancelled) return
      attachSurfaceMaps(maps)
      onTexturesSettled?.(getTextureReport())
    })

    return () => {
      cancelled = true
    }
  }, [gl, profile.maxAnisotropy, onTexturesSettled])

  // Quality can change after the textures are cached, so filtering is applied
  // separately rather than only at load time.
  useEffect(() => {
    setTextureAnisotropy(gl, profile.maxAnisotropy)
  }, [gl, profile.maxAnisotropy])

  return null
}
