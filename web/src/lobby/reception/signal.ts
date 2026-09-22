/**
 * The channel between the conversation and the 3D character.
 *
 * Mouth shapes change roughly fourteen times a second and the envelope is read
 * every frame. Routing that through React would re-render the tree at frame
 * rate for values React never displays, so it goes through a plain mutable
 * object instead: the conversation writes it, `useFrame` reads it, and React
 * only ever sees the discrete state (see `store.ts`).
 *
 * It is an ordinary value, created per experience and passed as a prop, rather
 * than a module singleton — two lobbies on one page would otherwise share one
 * mouth.
 */
import type { LipSyncMode } from './capability'
import type { ReceptionistState } from './states'
import type { VisemeCue } from './visemes'

export interface ReceptionSignal {
  state: ReceptionistState
  /** Bumped on every state change, so the scene can re-trigger a one-shot. */
  stateRevision: number
  /** The schedule being spoken, empty when nothing is. */
  timeline: readonly VisemeCue[]
  /** `performance.now()` when the schedule started. Only used with no audio clock. */
  startedAtMs: number
  /** Correction applied by word-boundary events, in milliseconds. */
  offsetMs: number
  /**
   * Where the audio has actually reached, in milliseconds.
   *
   * Set whenever real audio is playing, and preferred over the wall clock
   * wherever it exists. The wall clock measures how long ago the request was
   * made, which includes the network round trip and the decode — drive a mouth
   * from that and it finishes talking before the sound does.
   */
  clock: (() => number) | null
  /** Audio-reactive: reads the current 0–1 loudness of the audio being played. */
  envelope: (() => number) | null
  lipSync: LipSyncMode
  /** 0–1 microphone level while listening. Drives the listening pose only. */
  inputLevel: number
  /** True while a reply is being spoken, in any lip-sync mode. */
  speaking: boolean
}

export function createReceptionSignal(): ReceptionSignal {
  return {
    state: 'idle',
    stateRevision: 0,
    timeline: [],
    startedAtMs: 0,
    offsetMs: 0,
    clock: null,
    envelope: null,
    lipSync: 'none',
    inputLevel: 0,
    speaking: false,
  }
}

export function setSignalState(signal: ReceptionSignal, state: ReceptionistState): void {
  if (signal.state === state) return
  signal.state = state
  signal.stateRevision += 1
}

export function beginSpeaking(
  signal: ReceptionSignal,
  timeline: readonly VisemeCue[],
  nowMs: number,
): void {
  signal.timeline = timeline
  signal.startedAtMs = nowMs
  signal.offsetMs = 0
  signal.speaking = true
}

export function endSpeaking(signal: ReceptionSignal): void {
  signal.timeline = []
  signal.startedAtMs = 0
  signal.offsetMs = 0
  // Both clocks are cleared, so a stopped reply cannot leave the mouth being
  // driven by an audio element that is no longer attached to anything.
  signal.clock = null
  signal.envelope = null
  signal.speaking = false
}

/** Where the schedule has reached: the audio clock when there is one. */
export function scheduleTimeMs(signal: ReceptionSignal, nowMs: number): number {
  if (signal.clock) return signal.clock()
  return nowMs - signal.startedAtMs + signal.offsetMs
}
