/**
 * Image-based lighting for the lobby.
 *
 * Physically based materials need something to reflect. Without an environment
 * map, metal goes flat grey, glass shows nothing and stone loses its sheen —
 * which is most of why the Phase 1 room read as plastic.
 *
 * The environment is built here rather than downloaded. A real HDR panorama
 * would be a multi-megabyte asset with its own licence; this is a handful of
 * coloured planes rendered once into a pre-filtered cube map, costing nothing
 * to transfer. It is also authored to agree with the actual lighting rig —
 * daylight from the south glazing, warm ceiling, oak floor bounce — so
 * reflections point the same way as the shadows.
 */
import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
} from 'three'
import type { Texture, WebGLRenderer } from 'three'

let cached: { texture: Texture; dispose: () => void } | null = null

/** A single emissive panel in the environment box. */
function panel(
  scene: Scene,
  colour: string,
  width: number,
  height: number,
  position: [number, number, number],
  rotation: [number, number, number],
  disposables: { dispose: () => void }[],
): void {
  const geometry = new PlaneGeometry(width, height)
  const material = new MeshBasicMaterial({ color: colour })
  const mesh = new Mesh(geometry, material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  scene.add(mesh)
  disposables.push(geometry, material)
}

export function getLobbyEnvironment(renderer: WebGLRenderer): Texture {
  if (cached) return cached.texture

  const scene = new Scene()
  const disposables: { dispose: () => void }[] = []

  // The enclosing shell: warm ivory, the average of the room's own surfaces.
  const shellGeometry = new BoxGeometry(12, 6, 12)
  const shellMaterial = new MeshBasicMaterial({ color: '#9b9389', side: BackSide })
  scene.add(new Mesh(shellGeometry, shellMaterial))
  disposables.push(shellGeometry, shellMaterial)

  // Ceiling: brighter and slightly warm, matching the fixtures.
  panel(scene, '#d9cdb8', 11, 11, [0, 2.95, 0], [Math.PI / 2, 0, 0], disposables)
  // Floor bounce: muted oak and much dimmer, so reflections are not uniformly
  // bright top and bottom the way a plain grey box would make them.
  panel(scene, '#5f5346', 11, 11, [0, -2.95, 0], [-Math.PI / 2, 0, 0], disposables)
  // Daylight wall — the glazed south elevation. This is what gives metal and
  // glass a directional highlight rather than an even grey sheen.
  panel(scene, '#eef1f2', 8, 4.5, [0, 0.6, 5.9], [0, Math.PI, 0], disposables)
  // The opposite wall stays dim so reflections have contrast.
  panel(scene, '#635c52', 9, 4.5, [0, 0.6, -5.9], [0, 0, 0], disposables)

  const pmrem = new PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const target = pmrem.fromScene(scene, 0.35)

  for (const item of disposables) item.dispose()
  pmrem.dispose()

  cached = {
    texture: target.texture,
    dispose: () => {
      target.dispose()
      cached = null
    },
  }
  return cached.texture
}

export function disposeLobbyEnvironment(): void {
  cached?.dispose()
}
