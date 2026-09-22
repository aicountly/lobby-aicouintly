/**
 * Playing one spoken reply, and measuring it while it plays.
 *
 * This is what makes `audio-reactive` an honest mode rather than a label. The
 * element's own `currentTime` is the clock the mouth runs on, and an analyser
 * tapped off the same element is where the envelope comes from — so the face is
 * driven by the sound the visitor is hearing, not by how long ago the request
 * was made. A network round trip and a decode sit between those two numbers,
 * and on a slow connection they are seconds apart.
 *
 * Three things it is careful about:
 *
 * - **Autoplay is a permission, not a setting.** A remembered "read replies
 *   aloud" preference does not mean this tab is allowed to make noise. A
 *   blocked play is reported as `blocked`, not as a failure, so the interface
 *   can offer a tap instead of an error.
 * - **One AudioContext for the page.** Browsers cap how many a page may have,
 *   and a conversation is many replies. Elements and source nodes are cheap and
 *   per-utterance; the context is not.
 * - **Stopping releases everything.** The element is paused and detached, the
 *   nodes are disconnected, and the object URL is revoked. A missed revoke
 *   holds the decoded audio for the life of the page.
 */

export type PlaybackOutcome = 'playing' | 'blocked' | 'failed'

export interface SpokenAudio {
  /** Starts playback. Never throws; a refusal is an outcome. */
  play(): Promise<PlaybackOutcome>
  stop(): void
  /** Playback position in milliseconds — the clock the mouth runs on. */
  clock(): number
  /** 0–1 loudness of what is playing now, or null when no analyser is available. */
  envelope: (() => number) | null
  onEnded(listener: () => void): void
  readonly ended: boolean
}

let sharedContext: AudioContext | null = null

function audioContext(): AudioContext | null {
  if (sharedContext) return sharedContext
  if (typeof window === 'undefined') return null

  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null

  try {
    sharedContext = new Ctor()
    return sharedContext
  } catch {
    return null
  }
}

/** Release the page's audio context. Called when the lobby unmounts. */
export function releaseAudioContext(): void {
  const context = sharedContext
  sharedContext = null
  void context?.close().catch(() => undefined)
}

export function createSpokenAudio(blob: Blob): SpokenAudio {
  const url = URL.createObjectURL(blob)
  const element = new Audio()
  element.src = url
  element.preload = 'auto'
  // Nothing here is cross-origin — the blob is same-origin by construction —
  // but an element feeding an analyser must not be tainted, so this is stated.
  element.crossOrigin = 'anonymous'

  const listeners: (() => void)[] = []
  let ended = false
  let released = false
  let analyser: AnalyserNode | null = null
  let source: MediaElementAudioSourceNode | null = null
  let buffer: Uint8Array<ArrayBuffer> | null = null
  let smoothed = 0

  const finish = () => {
    if (ended) return
    ended = true
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // One listener failing must not strand the others.
      }
    }
  }

  element.addEventListener('ended', finish)
  element.addEventListener('error', finish)

  const release = () => {
    if (released) return
    released = true
    element.removeEventListener('ended', finish)
    element.removeEventListener('error', finish)
    try {
      element.pause()
    } catch {
      // Pausing something that never started is not an error worth surfacing.
    }
    try {
      source?.disconnect()
      analyser?.disconnect()
    } catch {
      // Already disconnected.
    }
    source = null
    analyser = null
    buffer = null
    element.removeAttribute('src')
    element.load()
    URL.revokeObjectURL(url)
  }

  function attachAnalyser(): void {
    const context = audioContext()
    if (!context) return
    try {
      source = context.createMediaElementSource(element)
      analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      // The analyser is a tap, not a filter: the element still has to reach the
      // speakers, so the chain continues to the destination.
      analyser.connect(context.destination)
      buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    } catch {
      // Without an analyser the reply still plays; the mouth falls back to the
      // estimated schedule, which is reported as what it is.
      source = null
      analyser = null
    }
  }

  return {
    get ended() {
      return ended
    },

    async play() {
      attachAnalyser()

      const context = audioContext()
      if (context?.state === 'suspended') {
        // Started from a visitor action, so this normally succeeds; when it
        // does not, the play() below reports blocked and the interface asks.
        await context.resume().catch(() => undefined)
      }

      try {
        await element.play()
        return 'playing'
      } catch (error) {
        const name = (error as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'AbortError') return 'blocked'
        return 'failed'
      }
    },

    stop() {
      release()
      finish()
    },

    clock() {
      return element.currentTime * 1000
    },

    envelope: () => {
      if (!analyser || !buffer) return 0
      analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i += 1) {
        const sample = (buffer[i] - 128) / 128
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / buffer.length)
      const target = Math.min(1, rms * 3.2)
      // Faster to open than to close, and it lands on exactly zero in silence
      // so the mouth returns to neutral rather than hovering ajar.
      smoothed += (target - smoothed) * (target > smoothed ? 0.55 : 0.12)
      return smoothed < 0.01 ? 0 : smoothed
    },

    onEnded(listener) {
      if (ended) {
        listener()
        return
      }
      listeners.push(listener)
    },
  }
}
