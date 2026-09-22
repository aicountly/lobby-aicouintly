/**
 * Loading the generated PBR texture set.
 *
 * The files come from `npm run textures` (web/scripts/generate-lobby-textures.mjs)
 * and live in public/lobby-assets/textures/. They are real HTTP assets, so all
 * of this is asynchronous and all of it can fail — a slow phone, a cache miss, a
 * proxy that mangles a response. None of that may stop the visitor walking
 * around, so the rule here is: materials exist immediately with sensible flat
 * colours, and maps are attached if and when they arrive.
 *
 * Colour space is set on load, not baked into the file: base colour is sRGB,
 * normal and roughness are linear data. Getting this wrong is the single most
 * common cause of a "washed out" or "too dark" PBR scene.
 */
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three'
import type { Texture, WebGLRenderer } from 'three'

import { ROOM } from '../layout'

const BASE_PATH = '/lobby-assets/textures'

export type SurfaceId = 'oakFloor' | 'oakVeneer' | 'plaster' | 'fabric' | 'stone' | 'rug'

interface SurfaceDefinition {
  base: string
  normal?: string
  roughness?: string
  /** How many times the tile repeats across the surface it is applied to. */
  repeat: [number, number]
}

/**
 * Repeats are derived from the real size of the surface and the real size of
 * the tile, so a board reads ~200 mm wide wherever it appears. Stretching one
 * tile across a whole room is the fault this table exists to avoid.
 */
const TILE_METRES = {
  oakFloor: 2.4,
  oakVeneer: 0.9,
  plaster: 2.5,
  fabric: 0.4,
  stone: 1.6,
  rug: 1.2,
} as const

const DEFINITIONS: Record<SurfaceId, SurfaceDefinition> = {
  oakFloor: {
    base: 'oak-floor-basecolor.png',
    normal: 'oak-floor-normal.png',
    roughness: 'oak-floor-roughness.png',
    repeat: [(ROOM.halfWidth * 2) / TILE_METRES.oakFloor, (ROOM.halfDepth * 2) / TILE_METRES.oakFloor],
  },
  oakVeneer: {
    base: 'oak-veneer-basecolor.png',
    normal: 'oak-veneer-normal.png',
    roughness: 'oak-veneer-roughness.png',
    // The desk front is 5 m wide; a single tile across it stretched the grain
    // into wide bands. Three tiles reads as ~1.6 m boards there and stays
    // acceptable on the smaller pieces that share this material.
    repeat: [3, 1.2],
  },
  plaster: {
    base: 'plaster-basecolor.png',
    normal: 'plaster-normal.png',
    // Walls are several metres across, but the plaster is deliberately so low
    // contrast that a small scale error in it is not perceptible.
    repeat: [3, 1.6],
  },
  fabric: {
    base: 'fabric-basecolor.png',
    normal: 'fabric-normal.png',
    roughness: 'fabric-roughness.png',
    repeat: [2, 2],
  },
  stone: {
    base: 'stone-basecolor.png',
    normal: 'stone-normal.png',
    roughness: 'stone-roughness.png',
    repeat: [3, 1],
  },
  rug: {
    base: 'rug-basecolor.png',
    normal: 'rug-normal.png',
    roughness: 'rug-roughness.png',
    repeat: [4, 3.5],
  },
}

export interface SurfaceMaps {
  map: Texture | null
  normalMap: Texture | null
  roughnessMap: Texture | null
}

export interface TextureLoadReport {
  requested: number
  loaded: number
  /** Files that did not arrive, with the reason. Surfaced in the dev report. */
  failures: { url: string; reason: string }[]
}

let cache: Promise<Record<SurfaceId, SurfaceMaps>> | null = null
let owned: Texture[] = []
let report: TextureLoadReport = { requested: 0, loaded: 0, failures: [] }

export function getTextureReport(): TextureLoadReport {
  return { ...report, failures: [...report.failures] }
}

/**
 * Load every surface once per page.
 *
 * Cached rather than reloaded when the canvas remounts (switching to Standard
 * View and back), because the textures are page-lifetime resources and
 * re-decoding 2 MB of PNG on every toggle is a visible stall.
 */
export function loadSurfaceTextures(
  renderer: WebGLRenderer,
  anisotropyLimit: number,
): Promise<Record<SurfaceId, SurfaceMaps>> {
  if (cache) return cache

  const loader = new TextureLoader()
  const anisotropy = resolveAnisotropy(renderer, anisotropyLimit)

  report = { requested: 0, loaded: 0, failures: [] }

  async function loadOne(
    file: string,
    colour: boolean,
    repeat: [number, number],
  ): Promise<Texture | null> {
    const url = `${BASE_PATH}/${file}`
    report.requested += 1
    try {
      const texture = await loader.loadAsync(url)
      // Colour data is sRGB; normal and roughness are linear measurements and
      // must not be gamma-decoded or the lighting maths is wrong.
      texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.repeat.set(repeat[0], repeat[1])
      texture.anisotropy = anisotropy
      texture.needsUpdate = true
      owned.push(texture)
      report.loaded += 1
      return texture
    } catch (error) {
      report.failures.push({
        url,
        reason: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  cache = (async () => {
    const entries = await Promise.all(
      (Object.keys(DEFINITIONS) as SurfaceId[]).map(async (id) => {
        const def = DEFINITIONS[id]
        const [map, normalMap, roughnessMap] = await Promise.all([
          loadOne(def.base, true, def.repeat),
          def.normal ? loadOne(def.normal, false, def.repeat) : Promise.resolve(null),
          def.roughness ? loadOne(def.roughness, false, def.repeat) : Promise.resolve(null),
        ])
        return [id, { map, normalMap, roughnessMap }] as const
      }),
    )
    return Object.fromEntries(entries) as Record<SurfaceId, SurfaceMaps>
  })()

  return cache
}

/**
 * Release every texture this module owns.
 *
 * Called when the lobby leaves the page for good, never on a canvas remount —
 * these are shared by every material, so one component must not free them.
 */
export function disposeSurfaceTextures(): void {
  for (const texture of owned) texture.dispose()
  owned = []
  cache = null
  report = { requested: 0, loaded: 0, failures: [] }
}

/** Anisotropy the renderer can actually do, clamped to the quality profile. */
export function resolveAnisotropy(renderer: WebGLRenderer, limit: number): number {
  return Math.max(1, Math.min(limit, renderer.capabilities.getMaxAnisotropy()))
}

/**
 * Re-apply anisotropy after a quality change.
 *
 * The textures are cached for the page, so a visitor who raises quality would
 * otherwise keep the filtering they loaded with — most visible as a blurry
 * floor at grazing angles, which is exactly what anisotropy is for.
 */
export function setTextureAnisotropy(renderer: WebGLRenderer, limit: number): void {
  const anisotropy = resolveAnisotropy(renderer, limit)
  for (const texture of owned) {
    if (texture.anisotropy === anisotropy) continue
    texture.anisotropy = anisotropy
    texture.needsUpdate = true
  }
}
