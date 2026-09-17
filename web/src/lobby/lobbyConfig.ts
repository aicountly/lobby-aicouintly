/**
 * Build-time configuration for the Aicountly Lobby visitor experience.
 *
 * "Aicountly Lobby" is the display name for this new visitor interface only.
 * The repository, the `receptionist.aicountly.com` domains, the portal product
 * key, the GA4 property and every `/api` route keep their existing identifiers
 * — a display name is not a reason to rename infrastructure.
 *
 * Every VITE_* value is inlined into the bundle at build time and is therefore
 * public. Never put a credential in one. See ../config.ts.
 */

/** Display name used across the visitor-facing lobby interface. */
export const LOBBY_DISPLAY_NAME = 'Aicountly Lobby'

/**
 * Path served as the public, sign-in-free visitor lobby.
 *
 * The lobby is a reception area: it renders procedural geometry and local demo
 * journeys, reads no business data and makes no authenticated call, so it does
 * not need the portal round-trip. Set VITE_LOBBY_PUBLIC_PATH to an empty string
 * to withdraw the public surface — every other path keeps the existing SSO boot
 * untouched either way.
 */
export const LOBBY_PUBLIC_PATH = normalisePath(
  (import.meta.env.VITE_LOBBY_PUBLIC_PATH ?? '/lobby').trim(),
)

function normalisePath(value: string): string {
  if (!value) return ''
  const withSlash = value.startsWith('/') ? value : `/${value}`
  return withSlash.replace(/\/+$/, '') || '/'
}

/** True when `pathname` is the public visitor lobby. */
export function isPublicLobbyPath(pathname: string): boolean {
  if (!LOBBY_PUBLIC_PATH) return false
  const normalised = pathname.replace(/\/+$/, '') || '/'
  return normalised === LOBBY_PUBLIC_PATH
}

/**
 * Which service adapter answers the reception desk.
 *
 * `demo` (the default) runs entirely in the browser and writes nothing
 * anywhere. `live` selects the production integration adapter, which reports
 * every capability as unavailable until the owning app publishes its contract.
 */
export type LobbyServiceMode = 'demo' | 'live'

export const LOBBY_SERVICE_MODE: LobbyServiceMode =
  (import.meta.env.VITE_LOBBY_SERVICE_MODE ?? '').trim() === 'live' ? 'live' : 'demo'

/**
 * Base URL of the Aicountly Appointments API.
 *
 * Appointments owns booking workflows and reaches Aicountly Calendar itself.
 * The lobby never talks to Calendar directly and never holds calendar records.
 */
export const APPOINTMENTS_API_BASE_URL = (
  import.meta.env.VITE_LOBBY_APPOINTMENTS_API_BASE_URL ?? ''
)
  .trim()
  .replace(/\/$/, '')

/**
 * Path on this product's *own* PHP API that fronts the lobby reception AI.
 *
 * The model credential is governed by Aicountly Console and must stay
 * server-side: a browser-visible VITE_* variable can never hold it. Unset means
 * the relay does not exist yet, and the reception AI reports unavailable.
 */
export const RECEPTION_AI_PATH = (import.meta.env.VITE_LOBBY_RECEPTION_AI_PATH ?? '').trim()

/**
 * Optional runtime asset manifest. When the file is absent the lobby keeps its
 * procedural placeholders, so final art can be dropped in without a rebuild.
 */
export const ASSET_MANIFEST_URL = (
  import.meta.env.VITE_LOBBY_ASSET_MANIFEST_URL ?? '/lobby-assets/manifest.json'
).trim()
