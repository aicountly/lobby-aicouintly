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
import type { ReceptionApi } from '../services/receptionApi'
import { createSpokenAudio } from './audioPlayback'
import type { SpokenAudio } from './audioPlayback'
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

export type ServiceShortcutKey = 'booking' | 'enquiry' | 'team' | 'handover'

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
    key: 'handover',
    label: 'Ask for a person',
    // Before the generic 'team' pattern below, which would otherwise swallow
    // "can I speak to someone" on the word "speak".
    match: /\b(human|person|someone|somebody|real person|speak to|talk to|receptionist|staff|agent)\b/i,
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

/**
 * What the receptionist actually proposed, mapped to a journey.
 *
 * The backend validates every action against an allowlist and drops any whose
 * journey this business has switched off, so what arrives here is already the
 * set of things the visitor may legitimately be offered. Using it is what makes
 * that gating mean anything: until now the interface ignored it entirely and
 * guessed from a regex over the visitor's own words, which meant asking "can I
 * speak to someone?" opened the question panel rather than the queue, and a
 * business with booking switched off could still be shown a booking chip.
 *
 * The keyword match stays as the fallback for a reply that proposed nothing,
 * and for the demonstration adapter, which has no actions to propose.
 */
const ACTION_SHORTCUTS: Record<string, ServiceShortcut> = {
  offer_booking: { key: 'booking', label: 'Open the booking journey' },
  offer_enquiry: { key: 'enquiry', label: 'Leave an enquiry' },
  request_handover: { key: 'handover', label: 'Ask for a person' },
}

export function shortcutForReply(
  actions: readonly { name: string }[] | undefined,
  question: string,
): ServiceShortcut | null {
  for (const action of actions ?? []) {
    const shortcut = ACTION_SHORTCUTS[action.name]
    if (shortcut) return shortcut
  }

  return detectShortcut(question)
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
  /**
   * Where the voice actually came from for the last reply.
   *
   * Reported rather than assumed, because "the server synthesised this" and
   * "your browser read it out" are different promises about quality and about
   * where the words went.
   */
  source: 'server' | 'browser' | 'none'
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
  /**
   * Audio is ready but the browser refused to start it.
   *
   * A remembered sound preference is not a grant of autoplay permission, so
   * this is an ordinary outcome and the interface offers a tap rather than an
   * error.
   */
  playbackBlocked: boolean
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
  /** The backend client, when this deployment has one. */
  api?: ReceptionApi | null
  /** True when the server can synthesise speech for this deployment. */
  serverSpeech?: () => boolean
  /** Swapped in tests so playback can be driven without a browser or a sound card. */
  createAudio?: (blob: Blob) => SpokenAudio
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
  /** Start audio the browser refused to autoplay. Called from a visitor tap. */
  playBlockedAudio(): Promise<void>
  setVoiceOutput(enabled: boolean): void
  setReducedMotion(reduced: boolean): void
  /** Tell reception a journey produced a receipt, so it can mention it safely. */
  announceReceipt(receipt: BookingReceipt | EnquiryReceipt): void
  dismissNotice(): void
  dispose(): void
}

/**
 * How long to wait for `onstart` before animating the mouth regardless.
 *
 * Long enough that a normal engine warm-up anchors on the real event, short
 * enough that a browser which never fires it does not leave the character
 * silent-mouthed for a whole reply.
 */
const BROWSER_SPEECH_ANCHOR_FALLBACK_MS = 1200

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
    api = null,
    serverSpeech = () => false,
    createAudio = createSpokenAudio,
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
  let speechSource: 'server' | 'browser' | 'none' = 'none'
  let playbackBlocked = false
  let currentAudio: SpokenAudio | null = null
  let blockedAudio: SpokenAudio | null = null
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
      // No speech provider supplies timed viseme events in this build; the
      // branch exists so a provider that does is a configuration change.
      visemeEvents: signal.timeline.length > 0 && signal.clock !== null,
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
  /** Stop and release whatever is playing. Safe to call repeatedly. */
  function stopAudio(): void {
    currentAudio?.stop()
    currentAudio = null
    blockedAudio?.stop()
    blockedAudio = null
    playbackBlocked = false
  }

  /**
   * Put a line in the transcript, animate saying it, and settle the turn.
   *
   * `phaseWhileSpeaking` is what separates a greeting from an answer from a
   * handover from a failure: all four move the mouth, and only two of them are
   * the character standing there helpfully.
   */
  function deliver(
    text: string,
    token: TurnToken,
    phaseWhileSpeaking: 'greeting' | 'answering' | 'handover' | 'failed',
  ): void {
    turns = [...turns, { role: 'reception', text }]
    setPhase(phaseWhileSpeaking)

    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      endSpeaking(signal)
      currentAudio = null
      setAudio(voiceOutput || api ? 'silent' : 'unsupported')
      if (token.isCurrent()) {
        setPhase('idle')
        token.settle()
      }
      emit()
    }

    // One teardown for every route out of a turn: settled, superseded,
    // interrupted, disposed. Audio that outlives its turn is the bug this
    // prevents — a cancelled reply that starts playing a second later.
    token.onRelease(() => {
      stopAudio()
      voiceOutput?.cancel()
      endSpeaking(signal)
    })

    /** The character delivers the line for as long as reading it would take. */
    const holdSilently = (timeline: readonly ReturnType<typeof visemeTimeline>[number][]): void => {
      const holdMs = Math.max(timelineDurationMs(timeline), estimateReadMs(text))
      const handle = setTimer(finish, holdMs)
      token.onRelease(() => clearTimer(handle))
    }

    /**
     * The browser's own voice: no audio to analyse, so the schedule is estimated.
     *
     * The schedule is anchored in `onStart`, **not** here. `speechSynthesis.speak()`
     * returns long before any sound comes out — the engine has to pick a voice,
     * warm up, and on some platforms fetch a cloud voice over the network. That
     * gap is hundreds of milliseconds to well over a second, and anchoring at
     * the moment of the request spends all of it mouthing a line nobody can
     * hear yet, so the lips lead the voice for the whole reply.
     *
     * Until the voice actually starts, `signal.speaking` stays false and the
     * mouth stays closed, which is the honest picture: nothing is being said.
     */
    const speakInBrowser = (): boolean => {
      if (!outputEnabled || !voiceOutput) return false

      signal.lipSync = modeForReply()
      const timeline = signal.lipSync === 'text-estimated' ? visemeTimeline(text) : []

      const started = voiceOutput.speak(text, {
        onStart: () => {
          if (!token.isCurrent()) return
          beginSpeaking(signal, timeline, now())
          setAudio('playing')
          emit()
        },
        onBoundary: (charIndex, elapsedMs) => {
          if (!token.isCurrent()) return
          signal.offsetMs = retimedOffset(signal.timeline, charIndex, elapsedMs, signal.offsetMs)
        },
        onEnd: finish,
      })

      if (!started) {
        endSpeaking(signal)
        return false
      }

      // speechSynthesis does not always fire onstart — Chrome in particular has
      // long-standing bugs here. Without a floor, a missing event would leave
      // the character talking with a closed mouth, which is worse than the lead
      // this change removes. So if nothing has started within the window, the
      // schedule anchors anyway and behaves as it used to.
      const anchorFallback = setTimer(() => {
        if (!token.isCurrent() || signal.speaking) return
        beginSpeaking(signal, timeline, now())
        emit()
      }, BROWSER_SPEECH_ANCHOR_FALLBACK_MS)
      token.onRelease(() => clearTimer(anchorFallback))

      speechSource = 'browser'
      setAudio('requested')
      emit()
      return true
    }

    /** Fall back to the silent delivery, with the mouth on an estimated schedule. */
    const deliverSilently = (): void => {
      speechSource = 'none'
      signal.lipSync = modeForReply()
      const timeline = signal.lipSync === 'text-estimated' ? visemeTimeline(text) : []
      beginSpeaking(signal, timeline, now())
      setAudio(voiceOutput || api ? 'silent' : 'unsupported')
      holdSilently(timeline)
      emit()
    }

    /** The server's voice: real audio, so the mouth runs on the audio's clock. */
    const speakFromServer = async (): Promise<void> => {
      setAudio('requested')
      emit()

      const result = await api!.speak(text, { signal: token.signal })

      // The reply may have been superseded while the audio was being made.
      // Nothing that follows may touch the signal if so.
      if (!token.isCurrent()) return

      if (!result.ok) {
        voiceNotice = `${result.reason} The reply is above.`
        // An explicitly labelled fallback, not a silent substitution: the
        // interface reports which voice the visitor actually heard.
        if (!speakInBrowser()) deliverSilently()
        emit()
        return
      }

      const audio = createAudio(result.data)
      currentAudio = audio
      token.onRelease(() => audio.stop())

      // Set the clock and the envelope *before* choosing the mode: the mode is
      // decided by what is actually available to drive the mouth.
      signal.clock = () => audio.clock()
      signal.envelope = audio.envelope
      signal.lipSync = modeForReply()
      beginSpeaking(signal, [], now())
      audio.onEnded(finish)

      const outcome = await audio.play()
      if (!token.isCurrent()) {
        audio.stop()
        return
      }

      if (outcome === 'playing') {
        speechSource = 'server'
        setAudio('playing')
        emit()
        return
      }

      // Not playing: the mouth must not move, and the clock must not be left
      // pointing at an element that is paused at zero.
      endSpeaking(signal)
      currentAudio = null

      if (outcome === 'blocked') {
        // Held, not discarded: the visitor can tap to hear it.
        //
        // The mouth stays still while it waits. Mouthing the line silently and
        // then mouthing it again when the tap lands would deliver the same
        // sentence twice, and a face moving with no sound is exactly what the
        // tap is there to fix.
        blockedAudio = audio
        playbackBlocked = true
        speechSource = 'none'
        setAudio('silent')
        holdSilently([])
        emit()
        return
      }

      audio.stop()
      voiceNotice = 'That reply could not be played. The text is above.'
      if (!speakInBrowser()) deliverSilently()
      emit()
    }

    if (outputEnabled && api && serverSpeech()) {
      void speakFromServer()
      emit()
      return
    }

    if (!speakInBrowser()) deliverSilently()
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

    // What the receptionist proposed, where it proposed anything. The backend
    // has already dropped whatever this business does not offer.
    shortcut = shortcutForReply(outcome.data.actions, question)
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
            source: speechSource,
          },
          lipSync: signal.lipSync,
          busy: phase === 'thinking' || phase === 'capturing',
          playbackBlocked,
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
      // Never over the top of a live exchange. A visitor who steps back and
      // forward across the threshold mid-question must not have their turn
      // cancelled by a welcome, and on a metered deployment each cancelled
      // turn is a request already paid for.
      if (phase !== 'idle' || signal.speaking || listening) return
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
      // Stop whatever is being said before opening the microphone. Without
      // this the receptionist is still talking when the recording starts and
      // transcribes its own voice back as the visitor's question.
      stopAudio()
      voiceOutput?.cancel()
      guard.cancel('visitor pressed talk')
      const token = guard.begin()
      voiceNotice = null
      heard = ''
      listening = true
      setPhase('capturing')
      emit()

      token.onRelease(() => {
        // Cancel, not stop: a turn that was superseded or interrupted must not
        // send its recording and produce a transcript for a question nobody is
        // waiting on any more.
        if (voiceInput.cancel) voiceInput.cancel()
        else voiceInput.stop()
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

    async playBlockedAudio() {
      const audio = blockedAudio
      if (!audio) return
      blockedAudio = null
      playbackBlocked = false

      const outcome = await audio.play()
      if (outcome !== 'playing') {
        audio.stop()
        voiceNotice = 'That reply could not be played.'
        emit()
        return
      }

      currentAudio = audio
      speechSource = 'server'
      signal.clock = () => audio.clock()
      signal.envelope = audio.envelope
      signal.lipSync = modeForReply()
      beginSpeaking(signal, [], now())
      setPhase('answering')
      setAudio('playing')
      audio.onEnded(() => {
        endSpeaking(signal)
        currentAudio = null
        setAudio('silent')
        setPhase('idle')
        emit()
      })
      emit()
    },

    interrupt() {
      guard.cancel('visitor interrupted')
      stopAudio()
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
      stopAudio()
      api?.reset()
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
