/**
 * The character measurement hook.
 *
 * Reporting what an avatar costs means rendering the same room three times —
 * without it, with it idle, and with it speaking — at the same viewport and the
 * same quality profile. That needs a way to put the scene into each state from
 * outside, so `?lobbyCharacter=off|idle|speaking` does exactly that and nothing
 * else: it cannot change quality, it cannot reach the service adapters, and an
 * unrecognised value is ignored.
 *
 * It is deliberately not dev-only. A measurement you cannot reproduce against
 * the built bundle on the device in question is not a measurement.
 */
import { beginSpeaking, endSpeaking, setSignalState } from './signal'
import type { ReceptionSignal } from './signal'
import { visemeTimeline } from './visemes'

export type CharacterMode = 'off' | 'idle' | 'speaking'

export const CHARACTER_MODES: readonly CharacterMode[] = ['off', 'idle', 'speaking']

/** Sentence used for the speaking measurement. Fixed, so runs are comparable. */
const MEASUREMENT_LINE =
  'Good morning, and welcome to Aicountly. Would you like to book an appointment, leave an enquiry, or speak to somebody about your account?'

export function detectCharacterMode(search = typeof window === 'undefined' ? '' : window.location.search): CharacterMode {
  try {
    const value = new URLSearchParams(search).get('lobbyCharacter')
    return CHARACTER_MODES.includes(value as CharacterMode) ? (value as CharacterMode) : 'idle'
  } catch {
    return 'idle'
  }
}

/**
 * Hold the signal in the requested measurement state.
 *
 * Returns a teardown. `speaking` restarts the same schedule each time it runs
 * out, so the mouth is moving for the whole sample window rather than for the
 * first two seconds of it.
 */
export function driveMeasurement(signal: ReceptionSignal, mode: CharacterMode): () => void {
  if (mode !== 'speaking') return () => undefined

  const timeline = visemeTimeline(MEASUREMENT_LINE)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const last = timeline[timeline.length - 1]
  const lengthMs = last ? last.startMs + last.durationMs : 3000

  setSignalState(signal, 'speaking')
  signal.lipSync = 'text-estimated'
  beginSpeaking(signal, timeline, now())

  const handle = setInterval(() => {
    beginSpeaking(signal, timeline, now())
  }, Math.max(1000, lengthMs))

  return () => {
    clearInterval(handle)
    endSpeaking(signal)
    setSignalState(signal, 'idle')
  }
}

// ---------------------------------------------------------------------------
// The measurement probe
// ---------------------------------------------------------------------------

/**
 * True when this page load is a measurement run.
 *
 * Keyed on the parameter being *present*, not on its value, because the default
 * mode is `idle` and an ordinary visit must be indistinguishable from a run
 * that happened to ask for idle. Only a measurement run gets a probe.
 */
export function isMeasurementSession(
  search = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  try {
    return new URLSearchParams(search).has('lobbyCharacter')
  } catch {
    return false
  }
}

export interface MeasurementProbe {
  renderer: {
    info: unknown
    capabilities?: unknown
    getContext?: () => unknown
  }
  scene: unknown
  camera: unknown
  /** So a measurement can stand in the same place for every configuration. */
  setPose?: (pose: { x?: number; z?: number; yaw?: number; pitch?: number }) => void
  mode: CharacterMode
}

/** The name the measurement script looks for. */
export const PROBE_KEY = '__aicountlyLobbyMeasure'

/**
 * Publish the probe, and only during a measurement run.
 *
 * A renderer handle on `window` is a debugging surface, so it exists for
 * exactly as long as the query parameter that asked for it and is never
 * attached during an ordinary visit.
 */
export function attachMeasurementProbe(probe: MeasurementProbe): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>)[PROBE_KEY] = probe
}
