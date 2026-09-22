/**
 * Voice, using the browser's own speech engine and nothing else.
 *
 * There is no provider key here and there cannot be one: every `VITE_*` value
 * is inlined into the bundle and therefore public, so a browser-side speech
 * credential is a published credential. The Web Speech API needs none, which is
 * why it is what this build uses. A server-side voice would be relayed through
 * this product's own PHP API with the credential governed by Aicountly Console;
 * that relay does not exist yet, and nothing here pretends it does.
 *
 * Rules this file exists to keep:
 *
 * - The microphone is requested when the visitor presses Talk, never on load.
 * - Every track is stopped when listening ends, by any route — the visitor
 *   stopping, the engine ending, an error, the turn being cancelled, the page
 *   being hidden.
 * - No audio is recorded. The analyser reads live samples into one reused
 *   scratch array to produce a loudness number; nothing is buffered, stored or
 *   sent anywhere.
 * - Speech never starts by itself. `speak()` is only ever called from a reply
 *   to something the visitor did.
 */

/** Minimal shape of the vendor-prefixed recognition API. */
interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: { transcript: string }
}

interface RecognitionEventLike {
  resultIndex: number
  results: { length: number; [index: number]: RecognitionResultLike }
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onspeechend: (() => void) | null
}

type RecognitionConstructor = new () => RecognitionLike

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

export interface SpeechSupport {
  /** Speech-to-text is present and the page is allowed to use a microphone. */
  input: boolean
  /** Text-to-speech is present. */
  output: boolean
  /** Why input is unavailable, phrased for a visitor. Null when it is available. */
  inputReason: string | null
  /** Why output is unavailable. Null when it is available. */
  outputReason: string | null
}

export function detectSpeechSupport(): SpeechSupport {
  if (typeof window === 'undefined') {
    return { input: false, output: false, inputReason: 'No browser.', outputReason: 'No browser.' }
  }

  const secure = window.isSecureContext !== false
  const hasRecognition = recognitionConstructor() !== null
  const hasMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const hasSynthesis = typeof window.speechSynthesis !== 'undefined'

  const inputReason = !secure
    ? 'Voice needs a secure (https) connection.'
    : !hasRecognition
      ? 'This browser has no speech recognition, so voice input is unavailable here. Typing works.'
      : !hasMedia
        ? 'This browser will not give the page a microphone.'
        : null

  const outputReason = !hasSynthesis
    ? 'This browser has no speech synthesis, so replies are text only.'
    : null

  return { input: inputReason === null, output: outputReason === null, inputReason, outputReason }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface VoiceInputEvents {
  onPartial?(text: string): void
  onFinal?(text: string): void
  /** 0–1, roughly once per frame while listening. */
  onLevel?(level: number): void
  onError?(message: string): void
  onEnd?(): void
}

export interface VoiceInput {
  /** Requests the microphone. Only ever called from a visitor action. */
  start(events: VoiceInputEvents): Promise<boolean>
  stop(): void
  readonly listening: boolean
}

export function createVoiceInput(lang = 'en-GB'): VoiceInput | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null

  let recognition: RecognitionLike | null = null
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let levelTimer: number | null = null
  let listening = false

  /**
   * One teardown, called from every path.
   *
   * Written as a single function on purpose: "stop the tracks" appearing in
   * four handlers is four chances for one of them to be forgotten.
   */
  function teardown(events?: VoiceInputEvents): void {
    if (levelTimer !== null) {
      window.clearInterval(levelTimer)
      levelTimer = null
    }
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onspeechend = null
      try {
        recognition.abort()
      } catch {
        // Aborting one that never started throws in some builds.
      }
      recognition = null
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
    if (context) {
      void context.close().catch(() => undefined)
      context = null
    }
    if (listening) {
      listening = false
      events?.onLevel?.(0)
      events?.onEnd?.()
    }
  }

  return {
    get listening() {
      return listening
    },

    async start(events) {
      if (listening) return true
      try {
        // The page holds the stream itself rather than leaving it to the
        // recognition engine, for two reasons: it is what makes "stop every
        // track" something this code can actually guarantee, and it is where
        // the loudness for the listening animation comes from.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (error) {
        const name = (error as { name?: string })?.name
        events.onError?.(
          name === 'NotAllowedError'
            ? 'Microphone access was declined, so voice input is off. Typing still works.'
            : 'The microphone could not be opened. Typing still works.',
        )
        teardown()
        return false
      }

      listening = true

      try {
        const AudioContextCtor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioContextCtor) {
          context = new AudioContextCtor()
          const analyser = context.createAnalyser()
          analyser.fftSize = 512
          context.createMediaStreamSource(stream).connect(analyser)
          const buffer = new Uint8Array(analyser.fftSize)
          levelTimer = window.setInterval(() => {
            analyser.getByteTimeDomainData(buffer)
            let sum = 0
            for (let i = 0; i < buffer.length; i += 1) {
              const sample = (buffer[i] - 128) / 128
              sum += sample * sample
            }
            events.onLevel?.(Math.min(1, Math.sqrt(sum / buffer.length) * 4))
          }, 60)
        }
      } catch {
        // No meter is a cosmetic loss; recognition still runs.
      }

      recognition = new Recognition()
      recognition.lang = lang
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onresult = (event) => {
        let partial = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const text = result[0]?.transcript ?? ''
          if (result.isFinal) {
            const final = text.trim()
            if (final) events.onFinal?.(final)
            teardown(events)
            return
          }
          partial += text
        }
        if (partial.trim()) events.onPartial?.(partial.trim())
      }

      recognition.onerror = (event) => {
        if (event.error !== 'aborted') {
          events.onError?.(
            event.error === 'no-speech'
              ? 'Nothing was heard. Press Talk and try again, or type instead.'
              : 'Voice input stopped unexpectedly. Typing still works.',
          )
        }
        teardown(events)
      }

      recognition.onend = () => teardown(events)

      try {
        recognition.start()
      } catch {
        events.onError?.('Voice input could not start. Typing still works.')
        teardown(events)
        return false
      }

      return true
    },

    stop() {
      teardown()
    },
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface SpeakHandlers {
  onStart?(): void
  /** `charIndex` into the text being spoken; used to re-anchor mouth shapes. */
  onBoundary?(charIndex: number, elapsedMs: number): void
  onEnd?(): void
}

export interface VoiceOutput {
  speak(text: string, handlers?: SpeakHandlers): boolean
  cancel(): void
  readonly speaking: boolean
}

export function createVoiceOutput(lang = 'en-GB'): VoiceOutput | null {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return null
  const synthesis = window.speechSynthesis
  let current: SpeechSynthesisUtterance | null = null

  function pickVoice(): SpeechSynthesisVoice | null {
    const voices = synthesis.getVoices()
    if (voices.length === 0) return null
    // Voices load asynchronously and the list differs on every platform, so
    // this prefers rather than requires: exact locale, then language, then
    // whatever the browser considers default.
    return (
      voices.find((voice) => voice.lang === lang) ??
      voices.find((voice) => voice.lang?.startsWith(lang.slice(0, 2))) ??
      voices.find((voice) => voice.default) ??
      voices[0] ??
      null
    )
  }

  return {
    get speaking() {
      return current !== null
    },

    speak(text, handlers = {}) {
      const trimmed = text.trim()
      if (!trimmed) return false
      try {
        synthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(trimmed)
        utterance.lang = lang
        const voice = pickVoice()
        if (voice) utterance.voice = voice
        utterance.rate = 1
        utterance.pitch = 1

        const startedAt = now()
        utterance.onstart = () => handlers.onStart?.()
        utterance.onboundary = (event) => {
          handlers.onBoundary?.(event.charIndex ?? 0, now() - startedAt)
        }
        const finish = () => {
          if (current === utterance) current = null
          handlers.onEnd?.()
        }
        utterance.onend = finish
        utterance.onerror = finish

        current = utterance
        synthesis.speak(utterance)
        return true
      } catch {
        current = null
        return false
      }
    },

    cancel() {
      current = null
      try {
        synthesis.cancel()
      } catch {
        // Cancelling an empty queue throws in some builds.
      }
    },
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// ---------------------------------------------------------------------------
// Remembering the visitor's choice
// ---------------------------------------------------------------------------

const VOICE_OUTPUT_KEY = 'aicountly-lobby-voice-output'

/**
 * Whether replies were read aloud last time.
 *
 * Off on a first visit, always — nothing may speak at a visitor who has not
 * asked for it. But having asked once, being asked again on every reload is a
 * setting that behaves like a bug.
 */
export function recallVoiceOutput(): boolean {
  try {
    return window.localStorage?.getItem(VOICE_OUTPUT_KEY) === 'on'
  } catch {
    return false
  }
}

export function rememberVoiceOutput(enabled: boolean): void {
  try {
    window.localStorage?.setItem(VOICE_OUTPUT_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private mode or blocked storage. Not remembering is not worth failing over.
  }
}
