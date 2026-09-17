/**
 * Reading the optional runtime asset manifest.
 *
 * The manifest is untrusted input — it is a file someone drops into the
 * document root, not part of the build — so every field is checked before it is
 * used and anything unrecognised is discarded rather than merged. A missing,
 * unreachable or malformed manifest is the normal case, not an error: the lobby
 * keeps its procedural placeholders and says so.
 *
 * Example /lobby-assets/manifest.json:
 *
 * {
 *   "version": 1,
 *   "slots": {
 *     "receptionist": {
 *       "url": "/lobby-assets/receptionist.glb",
 *       "transform": { "position": [0.75, 0, -6.15], "rotationDegrees": [0, 0, 0], "scale": 1 },
 *       "animations": { "idle": "Idle_Loop", "greet": "Wave_01" }
 *     }
 *   }
 * }
 */
import { ASSET_MANIFEST_URL } from '../lobbyConfig'
import { ASSET_SLOT_IDS, DEFAULT_ASSETS } from './assetConfig'
import type { AssetSlot, AssetSlotId, AssetTransform, LobbyAssets } from './assetConfig'

export interface AssetManifestResult {
  assets: LobbyAssets
  /** Slots the manifest actually filled. Empty means everything is procedural. */
  overridden: AssetSlotId[]
  /** Why nothing was loaded, when that is worth reporting. */
  note: string | null
}

const PROCEDURAL: AssetManifestResult = {
  assets: DEFAULT_ASSETS,
  overridden: [],
  note: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTriple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return [value[0], value[1], value[2]] as [number, number, number]
}

function readTransform(value: unknown, fallback: AssetTransform): AssetTransform {
  if (!isRecord(value)) return fallback

  const position = readTriple(value.position) ?? fallback.position
  const rotationDegrees = readTriple(value.rotationDegrees) ?? fallback.rotationDegrees

  let scale = fallback.scale
  if (typeof value.scale === 'number' && Number.isFinite(value.scale)) {
    scale = value.scale
  } else {
    const triple = readTriple(value.scale)
    if (triple) scale = triple
  }

  return { position, rotationDegrees, scale }
}

function readAnimations(value: unknown, fallback: Record<string, string | undefined>) {
  if (!isRecord(value)) return fallback
  const mapping: Record<string, string> = {}
  for (const [role, clip] of Object.entries(value)) {
    if (typeof clip === 'string' && clip.trim()) mapping[role] = clip.trim()
  }
  return Object.keys(mapping).length > 0 ? mapping : fallback
}

/**
 * Only same-origin or relative URLs are accepted.
 *
 * A manifest that could name any host would turn a dropped-in file into a way
 * to pull arbitrary third-party geometry into the page.
 */
function readUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url) return null
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (/^https?:\/\//i.test(url)) {
    try {
      if (new URL(url).origin === window.location.origin) return url
    } catch {
      return null
    }
    return null
  }
  // A bare relative path, e.g. "lobby-assets/desk.glb".
  if (!url.includes(':')) return url
  return null
}

export async function loadAssetManifest(signal?: AbortSignal): Promise<AssetManifestResult> {
  if (!ASSET_MANIFEST_URL) return PROCEDURAL

  let payload: unknown
  try {
    const response = await fetch(ASSET_MANIFEST_URL, { signal, cache: 'no-cache' })
    if (!response.ok) return PROCEDURAL
    payload = await response.json()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return PROCEDURAL
    // No manifest is the shipped state, so this is not worth surfacing as a fault.
    return PROCEDURAL
  }

  if (!isRecord(payload) || !isRecord(payload.slots)) {
    return { ...PROCEDURAL, note: 'Asset manifest found but unreadable; placeholders kept.' }
  }

  const assets = { ...DEFAULT_ASSETS } as LobbyAssets
  const overridden: AssetSlotId[] = []

  for (const id of ASSET_SLOT_IDS) {
    const entry = (payload.slots as Record<string, unknown>)[id]
    if (!isRecord(entry)) continue

    const url = readUrl(entry.url)
    if (!url) continue

    const base = DEFAULT_ASSETS[id]
    const slot: AssetSlot = {
      ...base,
      url,
      transform: readTransform(entry.transform, base.transform),
      animations: readAnimations(entry.animations, base.animations),
    }
    assets[id] = slot
    overridden.push(id)
  }

  return {
    assets,
    overridden,
    note: overridden.length === 0 ? 'Asset manifest found but named no usable models.' : null,
  }
}
