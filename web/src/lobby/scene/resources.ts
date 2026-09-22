/**
 * One place to release everything the scene holds on the GPU.
 *
 * These caches are deliberately page-lifetime rather than canvas-lifetime — a
 * visitor flipping to Standard View and back should not pay to re-decode the
 * textures or rebuild the environment map. The cost of that choice is that
 * nothing frees them automatically, so this is called once when the lobby
 * unmounts for good.
 */
import { disposeLobbyEnvironment } from './environment'
import { disposeFoliage } from './Foliage'
import { disposeMaterials } from './materials'
import { disposeContactShadow, disposeRoundedGeometries } from './primitives'
import { disposeSurfaceTextures } from './textureSet'

export function releaseSceneResources(): void {
  disposeMaterials()
  disposeSurfaceTextures()
  disposeLobbyEnvironment()
  disposeRoundedGeometries()
  disposeContactShadow()
  disposeFoliage()
}
