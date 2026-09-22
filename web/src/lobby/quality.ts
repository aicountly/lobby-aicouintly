/**
 * Graphics quality profiles.
 *
 * Quality is a separate axis from `prefers-reduced-motion`: one is about what
 * the GPU can sustain, the other about what the visitor wants moving. A visitor
 * on a workstation who asks for reduced motion still gets the high profile, and
 * a visitor on a phone who is happy with motion still gets the low one.
 *
 * The default is `balanced`, and it is chosen conservatively rather than
 * detected aggressively — guessing high on a weak device costs a bad first
 * impression, while guessing balanced on a strong one costs a little sharpness
 * the visitor can recover from the selector.
 */

export type LobbyQuality = 'low' | 'balanced' | 'high'

export interface QualityProfile {
  /** Upper bound on device pixel ratio. The single biggest fill-rate lever. */
  maxDpr: number
  shadowMapSize: number
  /** Image-based lighting from a generated room environment. */
  environmentEnabled: boolean
  /** Reserved for a later pass; no screen-space AO is shipped in this phase. */
  ambientOcclusion: boolean
  /** Physically refracting glass. Costs a scene re-render per transmissive material. */
  transmission: boolean
  maxAnisotropy: number
  /** Extra unshadowed fill lights that round out the corners. */
  accentLights: boolean
  /** Contact-shadow planes under furniture. Cheap, and they do a lot of grounding. */
  contactShadows: boolean
}

export const LOBBY_QUALITY: Record<LobbyQuality, QualityProfile> = {
  low: {
    maxDpr: 1,
    shadowMapSize: 512,
    environmentEnabled: true,
    ambientOcclusion: false,
    transmission: false,
    maxAnisotropy: 2,
    accentLights: false,
    contactShadows: true,
  },
  balanced: {
    maxDpr: 1.5,
    shadowMapSize: 1024,
    environmentEnabled: true,
    ambientOcclusion: false,
    transmission: false,
    maxAnisotropy: 4,
    accentLights: true,
    contactShadows: true,
  },
  high: {
    maxDpr: 1.75,
    shadowMapSize: 2048,
    environmentEnabled: true,
    ambientOcclusion: true,
    transmission: true,
    maxAnisotropy: 8,
    accentLights: true,
    contactShadows: true,
  },
}

export const QUALITY_LABELS: Record<LobbyQuality, string> = {
  low: 'Low',
  balanced: 'Balanced',
  high: 'High',
}

export const QUALITY_ORDER: LobbyQuality[] = ['low', 'balanced', 'high']

const STORAGE_KEY = 'aicountly-lobby-quality'

function isQuality(value: unknown): value is LobbyQuality {
  return value === 'low' || value === 'balanced' || value === 'high'
}

/**
 * A conservative first guess, only used when the visitor has not chosen.
 *
 * Deliberately crude: there is no reliable way to ask a browser how fast its
 * GPU is, and the honest fallback for "I cannot tell" is the middle profile.
 * Sustained frame time adjusts it afterwards — see useAdaptiveQuality.
 */
export function detectInitialQuality(): LobbyQuality {
  if (typeof window === 'undefined') return 'balanced'

  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    if (isQuality(stored)) return stored
  } catch {
    // Private mode, blocked storage. Fall through to detection.
  }

  // A coarse pointer on a small viewport is a phone often enough to be worth
  // starting one profile down; it is recoverable from the selector either way.
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 600
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4

  if (coarse && (narrow || fewCores)) return 'low'
  return 'balanced'
}

export function rememberQuality(quality: LobbyQuality): void {
  try {
    window.localStorage?.setItem(STORAGE_KEY, quality)
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
}
