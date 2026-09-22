/**
 * The receptionist's three state machines, kept apart on purpose.
 *
 * - **Conversation** is what the exchange is doing: waiting, capturing speech,
 *   asking the adapter, answering, handing over, failed.
 * - **Audio** is what the speaker is doing: silent, asked to speak, speaking,
 *   or unsupported on this browser.
 * - **Character** is what the figure behind the counter is doing, and it is the
 *   only one of the three that art is authored against.
 *
 * Collapsing them into one enum is the bug that leaves a character mouthing at
 * an empty room after a reply is dropped: audio can stop without the
 * conversation ending, and a conversation can end while audio is still
 * draining. They are derived here, in one direction only — conversation and
 * audio in, character state out — so there is no path by which the figure and
 * the transcript can disagree.
 */
import { RECEPTIONIST_STATES } from '../assets/assetConfig'
import type { ReceptionistState } from '../assets/assetConfig'

export type { ReceptionistState }
export { RECEPTIONIST_STATES }

/** What the exchange is doing. Independent of audio and of the character. */
export type ConversationPhase =
  | 'idle'
  | 'greeting'
  | 'capturing'
  | 'thinking'
  | 'answering'
  | 'handover'
  | 'failed'

/** What the speaker is doing. Independent of the conversation. */
export type AudioPhase = 'silent' | 'requested' | 'playing' | 'unsupported'

/** How much of the character can actually move, probed from the asset. */
export type AnimationReadiness = 'full' | 'body-only' | 'static'

export interface ReceptionSnapshot {
  conversation: ConversationPhase
  audio: AudioPhase
}

/**
 * The character state implied by the conversation and the speaker.
 *
 * Note what this deliberately does *not* consult: animation readiness. A
 * character that cannot play a `think` clip is still in `processing`; what it
 * can show is a rendering question, answered further down in
 * `animationController.ts`. Deciding state from capability would mean the
 * caption and the figure could tell the visitor different things.
 */
export function characterStateFor({ conversation, audio }: ReceptionSnapshot): ReceptionistState {
  switch (conversation) {
    case 'idle':
      // Audio can outlive the turn it belongs to — a reply finishes rendering
      // before the voice finishes reading it out.
      return audio === 'playing' || audio === 'requested' ? 'speaking' : 'idle'
    case 'greeting':
      return 'greeting'
    case 'capturing':
      return 'listening'
    case 'thinking':
      return 'processing'
    case 'answering':
      return 'speaking'
    case 'handover':
      return 'handover'
    case 'failed':
      return 'error'
    default:
      return assertNever(conversation, 'conversation phase')
  }
}

/**
 * Which character states may follow which.
 *
 * Used as a guard rather than as a router: an illegal transition is a bug in a
 * caller, and in production it is clamped to the target anyway rather than
 * leaving the figure in a stale pose. Every state can reach `idle` and `error`,
 * because both are recovery destinations.
 */
export const ALLOWED_TRANSITIONS: Record<ReceptionistState, readonly ReceptionistState[]> = {
  idle: ['greeting', 'listening', 'processing', 'speaking', 'handover', 'error'],
  greeting: ['idle', 'listening', 'processing', 'speaking', 'error'],
  listening: ['idle', 'processing', 'speaking', 'handover', 'error'],
  processing: ['idle', 'speaking', 'handover', 'error'],
  speaking: ['idle', 'listening', 'processing', 'handover', 'error'],
  handover: ['idle', 'listening', 'processing', 'error'],
  error: ['idle', 'greeting', 'listening', 'processing', 'handover'],
}

export function canTransition(from: ReceptionistState, to: ReceptionistState): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Short label for the state chip in the interface. */
export const RECEPTION_STATE_LABELS: Record<ReceptionistState, string> = {
  idle: 'Waiting',
  greeting: 'Greeting you',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Answering',
  handover: 'Handing over',
  error: 'Something went wrong',
}

/**
 * What a screen reader is told when the state changes.
 *
 * Announced from a polite live region, so it has to stand on its own without
 * the visual chip next to it.
 */
export const RECEPTION_STATE_ANNOUNCEMENTS: Record<ReceptionistState, string> = {
  idle: 'Reception is waiting.',
  greeting: 'Reception is greeting you.',
  listening: 'Reception is listening. Your microphone is on.',
  processing: 'Reception is working on your question.',
  speaking: 'Reception is answering.',
  handover: 'Reception is passing this to a person.',
  error: 'Reception could not answer that.',
}

/** Exhaustiveness check, so adding a state breaks the build rather than the room. */
export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`)
}
