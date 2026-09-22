/**
 * Shared materials for the lobby.
 *
 * The room is a few hundred meshes and almost all of them are one of about
 * twenty surfaces, so the materials are built once and handed out by reference.
 * Building them per mesh would upload the same shader program over and over.
 *
 * They are created immediately with flat fallback colours and no maps, then the
 * generated PBR maps are attached by `attachSurfaceMaps` when they finish
 * loading. That ordering is deliberate: the visitor can walk into a fully lit,
 * correctly coloured room on the first frame, and the surfaces sharpen a moment
 * later. A texture that never arrives simply leaves its flat colour in place.
 *
 * Colour choices follow the brief's art direction — warm ivory plaster, muted
 * oak, honed light stone, graphite, cream wool, restrained emerald. The two
 * faults being corrected from Phase 1 are baked in here: nothing is tinted
 * orange, and no surface is glossier than a real lacquered floor.
 */
import { Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector2 } from 'three'
import type { Material } from 'three'

import { PALETTE } from '../theme'
import type { SurfaceId, SurfaceMaps } from './textureSet'

export interface LobbyMaterials {
  floor: MeshStandardMaterial
  wall: MeshStandardMaterial
  ceiling: MeshStandardMaterial
  ceilingReveal: MeshStandardMaterial
  skirting: MeshStandardMaterial
  /** Honed limestone: reception counter top and sills. */
  stone: MeshStandardMaterial
  oak: MeshStandardMaterial
  oakLight: MeshStandardMaterial
  oakDark: MeshStandardMaterial
  oakDeepPanel: MeshStandardMaterial
  graphite: MeshStandardMaterial
  graphiteSoft: MeshStandardMaterial
  metal: MeshStandardMaterial
  emerald: MeshStandardMaterial
  emeraldGlow: MeshStandardMaterial
  upholstery: MeshStandardMaterial
  upholsteryDeep: MeshStandardMaterial
  rug: MeshStandardMaterial
  glass: MeshPhysicalMaterial
  lightPanel: MeshStandardMaterial
  foliage: MeshStandardMaterial
  foliageDeep: MeshStandardMaterial
  pot: MeshStandardMaterial
  ivoryPanel: MeshStandardMaterial
  placeholderBody: MeshStandardMaterial
  placeholderAccent: MeshStandardMaterial
  exterior: MeshStandardMaterial
  daylight: MeshBasicMaterial
}

let cache: LobbyMaterials | null = null

/**
 * How strongly each surface picks up the generated room environment.
 *
 * This is the restraint dial. Plaster and cloth barely reflect anything; stone
 * and metal do. Turning it up globally is what makes a scene look like wet
 * plastic, so it is set per material rather than once.
 */
function standard(options: {
  color: string
  roughness: number
  metalness?: number
  envMapIntensity?: number
  normalScale?: number
}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: options.color,
    roughness: options.roughness,
    metalness: options.metalness ?? 0,
  })
  material.envMapIntensity = options.envMapIntensity ?? 0.35
  if (options.normalScale !== undefined) {
    material.normalScale = new Vector2(options.normalScale, options.normalScale)
  }
  return material
}

export function getMaterials(): LobbyMaterials {
  if (cache) return cache

  cache = {
    // Satin lacquered oak. Roughness comes from the map once it loads; this
    // floor value is already matte enough that the specular sweep across the
    // middle of the room never returns.
    floor: standard({ color: '#b0977a', roughness: 0.62, envMapIntensity: 0.28, normalScale: 0.6 }),
    wall: standard({ color: PALETTE.ivory, roughness: 0.95, envMapIntensity: 0.16, normalScale: 0.35 }),
    ceiling: standard({ color: '#e4ddd1', roughness: 0.97, envMapIntensity: 0.1 }),
    ceilingReveal: standard({ color: '#ddd6ca', roughness: 0.94, envMapIntensity: 0.14 }),
    skirting: standard({ color: '#3a4149', roughness: 0.42, metalness: 0.1, envMapIntensity: 0.5 }),

    stone: standard({ color: '#d4cdc1', roughness: 0.5, metalness: 0.02, envMapIntensity: 0.5, normalScale: 0.4 }),

    oak: standard({ color: '#a68a68', roughness: 0.5, envMapIntensity: 0.3, normalScale: 0.5 }),
    oakLight: standard({ color: '#c0a582', roughness: 0.52, envMapIntensity: 0.28, normalScale: 0.45 }),
    oakDark: standard({ color: '#7d6448', roughness: 0.55, envMapIntensity: 0.26, normalScale: 0.45 }),
    oakDeepPanel: standard({ color: '#5f4a34', roughness: 0.62, envMapIntensity: 0.22 }),

    graphite: standard({ color: '#32383e', roughness: 0.44, metalness: 0.12, envMapIntensity: 0.55 }),
    graphiteSoft: standard({ color: '#464f57', roughness: 0.58, metalness: 0.06, envMapIntensity: 0.45 }),
    // Brushed, not chrome: high metalness with real roughness so it catches a
    // soft band of light instead of a mirror image.
    metal: standard({ color: '#adb3b8', roughness: 0.32, metalness: 0.9, envMapIntensity: 1 }),

    emerald: standard({ color: PALETTE.emerald, roughness: 0.48, metalness: 0.08, envMapIntensity: 0.4 }),
    emeraldGlow: (() => {
      const m = standard({ color: PALETTE.emeraldBright, roughness: 0.5 })
      m.emissive = new Color(PALETTE.emeraldBright)
      m.emissiveIntensity = 0.35
      return m
    })(),

    upholstery: standard({ color: '#c7bba6', roughness: 0.92, envMapIntensity: 0.12, normalScale: 1 }),
    upholsteryDeep: standard({ color: '#59626d', roughness: 0.9, envMapIntensity: 0.12, normalScale: 1 }),
    rug: standard({ color: '#bdb3a0', roughness: 0.95, envMapIntensity: 0.08, normalScale: 0.8 }),

    // Architectural glazing. Subtle reflection from the environment, low
    // opacity, and no transmission at the default profile — overlapping
    // transmissive panes sort badly and cost a scene re-render each.
    glass: (() => {
      const m = new MeshPhysicalMaterial({
        color: '#cdd8d6',
        transparent: true,
        opacity: 0.16,
        roughness: 0.05,
        metalness: 0,
        transmission: 0,
        reflectivity: 0.5,
        depthWrite: false,
      })
      m.envMapIntensity = 1.1
      return m
    })(),

    // A fixture diffuser, not a light source. The emissive here is a fraction
    // of Phase 1's: the giant glowing ceiling rectangles are replaced by slim
    // fittings, and the actual illumination comes from real lights.
    lightPanel: (() => {
      const m = standard({ color: '#fff8ec', roughness: 1 })
      m.emissive = new Color('#fff3e0')
      m.emissiveIntensity = 0.3
      return m
    })(),

    foliage: standard({ color: '#4a7355', roughness: 0.78, envMapIntensity: 0.2 }),
    foliageDeep: standard({ color: '#35563f', roughness: 0.8, envMapIntensity: 0.18 }),
    pot: standard({ color: '#9a9184', roughness: 0.82, envMapIntensity: 0.25 }),
    ivoryPanel: standard({ color: '#f3ede3', roughness: 0.9, envMapIntensity: 0.15 }),

    placeholderBody: standard({ color: '#69727b', roughness: 0.7, envMapIntensity: 0.3 }),
    placeholderAccent: standard({ color: PALETTE.emerald, roughness: 0.6, envMapIntensity: 0.35 }),

    exterior: standard({ color: '#cfc9bd', roughness: 0.95 }),
    daylight: new MeshBasicMaterial({ color: '#f2ece1' }),
  }

  return cache
}

/**
 * Tint applied on top of a surface's base-colour map.
 *
 * White means "the texture is the colour". The rest are how one map serves
 * several tones — a single veneer map covers three timber shades, and the one
 * woven-fabric map covers both the cream cushions and the darker frame they sit
 * on. Getting this wrong flattens the room: a blanket white here is what made
 * the sofa frame, the seat cushions and the rug all read as the same cream.
 */
const SURFACE_TINTS: Partial<Record<keyof LobbyMaterials, string>> = {
  oakLight: '#d8c6a8',
  oakDark: '#9d8163',
  upholsteryDeep: '#6e7885',
  rug: '#b6ac98',
}

/** Which surface's maps go on which materials. */
const SURFACE_TARGETS: Record<SurfaceId, (keyof LobbyMaterials)[]> = {
  oakFloor: ['floor'],
  oakVeneer: ['oak', 'oakLight', 'oakDark'],
  plaster: ['wall'],
  fabric: ['upholstery', 'upholsteryDeep'],
  stone: ['stone'],
  rug: ['rug'],
}

/**
 * Attach loaded maps to the materials that use them.
 *
 * Base colour replaces the flat tint, so the material colour goes white to
 * avoid multiplying the texture twice. A surface whose map failed to load keeps
 * its flat colour and simply looks plainer.
 */
export function attachSurfaceMaps(maps: Record<SurfaceId, SurfaceMaps>): void {
  const materials = getMaterials()

  for (const [surfaceId, targets] of Object.entries(SURFACE_TARGETS) as [
    SurfaceId,
    (keyof LobbyMaterials)[],
  ][]) {
    const surface = maps[surfaceId]
    if (!surface) continue

    for (const target of targets) {
      const material = materials[target]
      if (!(material instanceof MeshStandardMaterial)) continue

      if (surface.map) {
        material.map = surface.map
        // The base tint now lives in the texture, so anything without an entry
        // in SURFACE_TINTS goes white to avoid multiplying the colour twice.
        material.color = new Color(SURFACE_TINTS[target] ?? '#ffffff')
      }
      if (surface.normalMap) material.normalMap = surface.normalMap
      if (surface.roughnessMap) material.roughnessMap = surface.roughnessMap
      material.needsUpdate = true
    }
  }
}

/** Release every material this module owns. */
export function disposeMaterials(): void {
  if (!cache) return
  for (const material of Object.values(cache) as Material[]) material.dispose()
  cache = null
}
