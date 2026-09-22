/**
 * The reception conversation.
 *
 * Framework-free on purpose: it owns the turn order, the three state machines,
 * the microphone and the speaker, and it can be driven by a test with a clock
 * it controls. React sees it through `useReception.ts` and nothing else.
 *
 * What it will not do:
 *
 * - It will not describe a demonstration receipt as a real booking. Every
 *   receipt reaches the transcript through `describeReceipt`, which cannot
 *   produce affirmative language for `demo: true`.
 * - It will not say a person has been contacted. A handover says what *would*
 *   happen and offers the enquiry journey; nothing is sent.
 * - It will not report a success it did not get. An adapter that answers
 *   `unavailable` puts the character in `error` and names the integration.
 */
import type {
  BookingReceipt,
  EnquiryReceipt,
  LobbyServiceAdapter,
  ReceptionTurn,
  ServiceUnavailable,
} from '../services/types'
import { isOk } from '../services/types'
import type { CharacterCapability, LipSyncMode } from './capability'
import { chooseLipSyncMode } from './capability'
import { beginSpeaking, endSpeaking, setSignalState } from './signal'
import type { ReceptionSignal } from './signal'
import type { VoiceInput, VoiceOutput } from './speech'
import { characterStateFor } from './states'
import type { AudioPhase, ConversationPhase, ReceptionistState } from './states'
import { createTurnGuard } from './turnGuard'
import type { TurnToken } from './turnGuard'
import { retimedOffset, timelineDurationMs, visemeTimeline } from './visemes'

// ---------------------------------------------------------------------------
// Shortcuts and intent
// ---------------------------------------------------------------------------

export type ServiceShortcutKey = 'booking' | 'enquiry' | 'team'

export interface ServiceShortcut {
  key: ServiceShortcutKey
  label: string
}

const SHORTCUT_PATTERNS: { key: ServiceShortcutKey; label: string; match: RegExp }[] = [
  {
    key: 'booking',
    label: 'Open the booking journey',
    match: /\b(book|booking|appointment|appointments|schedule|reschedule|slot|availability|meeting)\b/i,
  },
  {
    key: 'enquiry',
    label: 'Leave an enquiry',
    match: /\b(enquiry|enquire|inquiry|inquire|quote|pricing|price|cost|message|contact|email|call me|get back)\b/i,
  },
  {
    key: 'team',
    label: 'Ask reception another question',
    match: /\b(question|ask|help|support|problem|issue)\b/i,
  },
]

/** Which journey, if any, the visitor's question points at. */
export function detectShortcut(text: string): ServiceShortcut | null {
  for (const candidate of SHORTCUT_PATTERNS) {
    if (candidate.match.test(text)) return { key: candidate.key, label: candidate.label }
  }
  return null
}

const HANDOVER_PATTERN =
  /\b(human|humans|person|people|someone|somebody|agent|advisor|adviser|staff|colleague|manager|receptionist|operator)\b/i

/** True when the visitor has asked to be passed to a person. */
export function wantsHandover(text: string): boolean {
  return HANDOVER_PATTERN.test(text)
}

const HANDOVER_REPLY =
  'I can pass this to a person. In this demonstration nothing is sent and nobody is contacted — on a connected deployment the enquiry journey is what reaches the team, and it would carry your question with it.'

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * How the receptionist is allowed to talk about a receipt.
 *
 * A single function, because "say it is a demo" scattered across call sites is
 * one forgotten call site away from a character telling a visitor they have an
 * appointment they do not have. When `demo` is true the wording is declarative
 * about the demonstration and never about the appointment.
 */
export function describeReceipt(receipt: BookingReceipt | EnquiryReceipt): string {
  const booking = 'serviceLabel' in receipt ? receipt : null
  if (receipt.demo) {
    return booking
      ? `That was a demonstration, so no appointment exists: nothing was written and Aicountly Calendar was not contacted. The demonstration reference is ${booking.reference}, for ${booking.serviceLabel} on ${booking.date} at ${booking.time}.`
      : `That was a demonstration, so nothing was sent and no record was kept. The demonstration reference is ${receipt.reference}.`
  }
  return booking
    ? `Your ${booking.serviceLabel} is confirmed for ${booking.date} at ${booking.time}. The reference is ${booking.reference}.`
    : `Your enquiry has been sent. The reference is ${receipt.reference}.`
}

/**
 * A safety net with teeth, used by the tests.
 *
 * Returns the affirmative phrases a line would need to be making a real claim.
 * Any demo-flagged line that matches one of these is a bug.
 */
export function bookingClaimsIn(text: string): string[] {
  const claims = [
    /\byour appointment is (booked|confirmed|scheduled)\b/i,
    /\b(is|has been) (booked|confirmed|scheduled|reserved)\b/i,
    /\bwe have (booked|scheduled|sent|contacted)\b/i,
    /\bsomeone (has been|was) (notified|contacted|told)\b/i,
    /\bi have (booked|sent|contacted|notified)\b/i,
  ]
  return claims.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source)
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface VoiceStatus {
  inputAvailable: boolean
  outputAvailable: boolean
  inputReason: string | null
  outputReason: string | null
  listening: boolean
  outputEnabled: boolean
}

export interface ConversationSnapshot {
  turns: readonly ReceptionTurn[]
  phase: ConversationPhase
  audio: AudioPhase
  state: ReceptionistState
  suggestions: readonly string[]
  shortcut: ServiceShortcut | null
  unavailable: ServiceUnavailable | null
  /** Live partial transcript while the visitor is speaking. */
  heard: string
  /** A problem with voice that the visitor should see, not a service failure. */
  voiceNotice: string | null
  voice: VoiceStatus
  lipSync: LipSyncMode
  busy: boolean
}

export interface ConversationOptions {
  adapter: LobbyServiceAdapter
  signal: ReceptionSignal
  /**
   * What the character can do. A function when it is not known yet: the scene
   * probes the model after the conversation is created, and rebuilding the
   * conversation to learn the answer would throw away the transcript.
   */
  capability: CharacterCapability | (() => CharacterCapability)
  voiceInput?: VoiceInput | null
  voiceOutput?: VoiceOutput | null
  inputReason?: string | null
  outputReason?: string | null
  reducedMotion?: boolean
  opening?: string
  starters?: readonly string[]
  /** Injectable clock and timers, so tests do not wait in real time. */
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
}

export interface ReceptionConversation {
  snapshot(): ConversationSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Greet the visitor: wave, and say the opening line with the mouth moving.
   *
   * Called when the visitor walks up to the counter or opens reception — never
   * on page load. `again` re-arms it for a visitor who left and came back.
   */
  greet(again?: boolean): void
  ask(text: string): Promise<void>
  startVoice(): Promise<void>
  stopVoice(): void
  /** Stop everything in flight: speech, microphone, pending reply. */
  interrupt(): void
  setVoiceOutput(enabled: boolean): void
  setReducedMotion(reduced: boolean): void
  /** Tell reception a journey produced a receipt, so it can mention it safely. */
  announceReceipt(receipt: BookingReceipt | EnquiryReceipt): void
  dismissNotice(): void
  dispose(): void
}

const DEFAULT_OPENING =
  'Hello, and welcome to Aicountly. Ask me about opening hours, booking an appointment, or what Aicountly does.'

const DEFAULT_STARTERS = [
  'What are your opening hours?',
  'I would like to book an appointment',
  'What can Aicountly do?',
]

export function createReceptionConversation(options: ConversationOptions): ReceptionConversation {
  const {
    adapter,
    signal,
    voiceInput = null,
    voiceOutput = null,
    opening = DEFAULT_OPENING,
    starters = DEFAULT_STARTERS,
  } = options

  const capabilityOf =
    typeof options.capability === 'function' ? options.capability : () => options.capability as CharacterCapability

  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>))

  const guard = createTurnGuard()
  const listeners = new Set<() => void>()

  let reducedMotion = options.reducedMotion ?? false
  // Empty until the greeting is delivered. Seeding the opening line here made
  // it arrive before anyone was greeted, so the character had nothing to say
  // when it finally waved.
  let turns: ReceptionTurn[] = []
  let phase: ConversationPhase = 'idle'
  let audio: AudioPhase = voiceOutput ? 'silent' : 'unsupported'
  let suggestions: readonly string[] = starters
  let shortcut: ServiceShortcut | null = null
  let unavailable: ServiceUnavailable | null = null
  let heard = ''
  let voiceNotice: string | null = null
  let outputEnabled = false
  let listening = false
  let greeted = false
  let cached: ConversationSnapshot | null = null
  let disposed = false

  function emit(): void {
    cached = null
    for (const listener of listeners) listener()
  }

  function setPhase(next: ConversationPhase): void {
    if (phase === next) return
    phase = next
    syncSignal()
  }

  function setAudio(next: AudioPhase): void {
    if (audio === next) return
    audio = next
    syncSignal()
  }

  function syncSignal(): void {
    setSignalState(signal, characterStateFor({ conversation: phase, audio }))
  }

  /**
   * Which lip-sync mode this reply will use.
   *
   * Decided per reply rather than once at startup, because the inputs change:
   * a visitor can turn the voice on mid-conversation, and reduced motion can be
   * toggled from the operating system while the lobby is open.
   */
  function modeForReply(): LipSyncMode {
    if (reducedMotion) return 'none'
    return chooseLipSyncMode(capabilityOf().face, {
      analyser: signal.envelope !== null,
      text: true,
    })
  }

  /**
   * Put a line in the transcript, animate saying it, and settle the turn.
   *
   * `phaseWhileSpeaking` is what separates an answer from a handover from a
   * failure: all three move the mouth, and only one of them is the character
   * standing there helpfully.
   */
  function deliver(
    text: string,
    token: TurnToken,
    phaseWhileSpeaking: 'greeting' | 'answering' | 'handover' | 'failed',
  ): void {
    turns = [...turns, { role: 'reception', text }]

    const mode = modeForReply()
    signal.lipSync = mode
    const timeline = mode === 'timed' ? visemeTimeline(text) : []
    beginSpeaking(signal, timeline, now())
    setPhase(phaseWhileSpeaking)

    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      endSpeaking(signal)
      setAudio(voiceOutput ? 'silent' : 'unsupported')
      if (token.isCurrent()) {
        setPhase('idle')
        token.settle()
      }
      emit()
    }

    token.onRelease(() => {
      voiceOutput?.cancel()
      endSpeaking(signal)
    })

    const spoken =
      outputEnabled && voiceOutput
        ? voiceOutput.speak(text, {
            onStart: () => {
              if (token.isCurrent()) setAudio('playing')
              emit()
            },
            onBoundary: (charIndex, elapsedMs) => {
              if (!token.isCurrent()) return
              signal.offsetMs = retimedOffset(signal.timeline, charIndex, elapsedMs, signal.offsetMs)
            },
            onEnd: finish,
          })
        : false

    if (spoken) {
      setAudio('requested')
    } else {
      setAudio(voiceOutput ? 'silent' : 'unsupported')
      // With no voice, the character still animates delivering the line, for as
      // long as the line would take to read. The visitor reads the transcript;
      // the figure is not frozen while they do.
      const holdMs = Math.max(timelineDurationMs(timeline), estimateReadMs(text))
      const handle = setTimer(finish, holdMs)
      token.onRelease(() => clearTimer(handle))
    }

    emit()
  }

  async function runTurn(question: string): Promise<void> {
    const token = guard.begin()
    unavailable = null
    voiceNotice = null
    heard = ''
    turns = [...turns, { role: 'visitor', text: question }]
    suggestions = []
    shortcut = null
    setPhase('thinking')
    emit()

    if (wantsHandover(question)) {
      if (!token.isCurrent()) return
      shortcut = { key: 'enquiry', label: 'Leave an enquiry' }
      suggestions = ['What are your opening hours?', 'I would like to book an appointment']
      deliver(HANDOVER_REPLY, token, 'handover')
      return
    }

    const history = turns.slice(0, -1)
    let outcome: Awaited<ReturnType<LobbyServiceAdapter['askReception']>>
    try {
      outcome = await adapter.askReception(question, history)
    } catch {
      if (!token.isCurrent()) return
      deliver(
        'Reception could not be reached just now. Nothing was sent. Please try again, or use the enquiry journey.',
        token,
        'failed',
      )
      return
    }

    // The visitor asked something else while this was in flight. Dropping it
    // here is the whole reason the guard exists.
    if (!token.isCurrent()) return

    if (!isOk(outcome)) {
      unavailable = outcome
      deliver(
        `I cannot answer that here. ${outcome.integration} is not connected: ${outcome.reason}`,
        token,
        'failed',
      )
      return
    }

    shortcut = detectShortcut(question)
    suggestions = outcome.data.suggestions
    deliver(outcome.data.text, token, 'answering')
  }

  const conversation: ReceptionConversation = {
    snapshot() {
      if (!cached) {
        cached = {
          turns,
          phase,
          audio,
          state: signal.state,
          suggestions,
          shortcut,
          unavailable,
          heard,
          voiceNotice,
          voice: {
            inputAvailable: voiceInput !== null,
            outputAvailable: voiceOutput !== null,
            inputReason: options.inputReason ?? null,
            outputReason: options.outputReason ?? null,
            listening,
            outputEnabled,
          },
          lipSync: signal.lipSync,
          busy: phase === 'thinking' || phase === 'capturing',
        }
      }
      return cached
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    greet(again = false) {
      if (disposed || (greeted && !again)) return
      // A repeat greeting while one is already running would cancel itself.
      if (again && (phase === 'greeting' || signal.speaking)) return
      greeted = true
      suggestions = starters
      // Delivered, not posed. Whether it is *heard* is a separate matter: the
      // line is spoken aloud only if the visitor turned that on, so walking in
      // is never met with a page that talks at you.
      deliver(opening, guard.begin(), 'greeting')
    },

    async ask(text) {
      const trimmed = text.trim()
      if (disposed || !trimmed) return
      await runTurn(trimmed)
    },

    async startVoice() {
      if (disposed || !voiceInput || listening) return
      // Voice in implies voice out. Someone who presses Talk is holding a
      // spoken conversation, and a character that listens to you and then
      // answers in silence is a worse surprise than one that speaks. This is
      // still never autoplay: it takes a deliberate press to get here.
      if (voiceOutput && !outputEnabled) {
        outputEnabled = true
        setAudio('silent')
      }
      // Cancel whatever is being said before opening the microphone, or the
      // character talks over the visitor and hears itself.
      guard.cancel('visitor pressed talk')
      const token = guard.begin()
      voiceNotice = null
      heard = ''
      listening = true
      setPhase('capturing')
      emit()

      token.onRelease(() => {
        voiceInput.stop()
        if (listening) {
          listening = false
          signal.inputLevel = 0
        }
      })

      const started = await voiceInput.start({
        onPartial: (text) => {
          if (!token.isCurrent()) return
          heard = text
          emit()
        },
        onLevel: (level) => {
          if (token.isCurrent()) signal.inputLevel = level
        },
        onFinal: (text) => {
          if (!token.isCurrent()) return
          listening = false
          signal.inputLevel = 0
          // The captured turn supersedes this one, which is correct: the
          // microphone turn is over the moment it has produced a question.
          void runTurn(text)
        },
        onError: (message) => {
          if (!token.isCurrent()) return
          voiceNotice = message
          listening = false
          signal.inputLevel = 0
          setPhase('idle')
          token.settle()
          emit()
        },
        onEnd: () => {
          if (!token.isCurrent()) return
          listening = false
          signal.inputLevel = 0
          if (phase === 'capturing') setPhase('idle')
          token.settle()
          emit()
        },
      })

      if (!started) {
        listening = false
        if (phase === 'capturing') setPhase('idle')
        emit()
      }
    },

    stopVoice() {
      if (!listening) return
      voiceInput?.stop()
      listening = false
      signal.inputLevel = 0
      if (phase === 'capturing') setPhase('idle')
      emit()
    },

    interrupt() {
      guard.cancel('visitor interrupted')
      voiceOutput?.cancel()
      voiceInput?.stop()
      listening = false
      signal.inputLevel = 0
      endSpeaking(signal)
      setAudio(voiceOutput ? 'silent' : 'unsupported')
      setPhase('idle')
      emit()
    },

    setVoiceOutput(enabled) {
      if (outputEnabled === enabled) return
      outputEnabled = enabled
      if (!enabled) {
        voiceOutput?.cancel()
        setAudio(voiceOutput ? 'silent' : 'unsupported')
      }
      emit()
    },

    setReducedMotion(reduced) {
      reducedMotion = reduced
      if (reduced) {
        signal.lipSync = 'none'
        signal.timeline = []
      }
      emit()
    },

    announceReceipt(receipt) {
      if (disposed) return
      const token = guard.begin()
      deliver(describeReceipt(receipt), token, receipt.demo ? 'answering' : 'answering')
    },

    dismissNotice() {
      if (!voiceNotice && !unavailable) return
      voiceNotice = null
      unavailable = null
      emit()
    },

    dispose() {
      disposed = true
      guard.dispose()
      voiceOutput?.cancel()
      voiceInput?.stop()
      listening = false
      endSpeaking(signal)
      signal.inputLevel = 0
      listeners.clear()
    },
  }

  return conversation
}

/**
 * How long a line takes to read, in milliseconds.
 *
 * Only used when there is no voice: it is how long the character is shown
 * delivering the line. Floor of 900 ms so a two-word answer is not a twitch.
 */
export function estimateReadMs(text: string): number {
  return Math.max(900, (text.length / 14.5) * 1000)
}
