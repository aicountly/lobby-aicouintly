/**
 * Turning a signal into a mouth, once per frame.
 *
 * Three modes, chosen in `capability.ts` from what the character can do and
 * what the browser gives us:
 *
 * - **Mode A, `timed`.** The reply text is turned into a schedule of visemes up
 *   front and read back against the clock, corrected by the speaker's word
 *   boundaries. This is what runs with Web Speech synthesis, because
 *   `SpeechSynthesisUtterance` exposes no audio to analyse — only events.
 * - **Mode B, `audio`.** An envelope from a real audio stream drives the jaw.
 *   Reserved for a server-side voice, which is not configured in this build;
 *   the envelope is an injected function so the path is exercised by tests
 *   rather than left unwritten.
 * - **Mode C, `none`.** The character has no drivable mouth. The body animates,
 *   captions carry the words, and nothing pretends otherwise.
 */
import type { ReceptionSignal } from './signal'
import { blendPose, visemeAt, visemePose } from './visemes'
import type { FacePose } from './visemes'

const EMPTY: FacePose = {}

/**
 * The mouth pose for this instant.
 *
 * Pure: everything it needs is on the signal, so a test can drive it with a
 * clock it controls.
 */
export function sampleLipSync(signal: ReceptionSignal, nowMs: number): FacePose {
  if (!signal.speaking) return EMPTY

  switch (signal.lipSync) {
    case 'timed': {
      if (signal.timeline.length === 0) return EMPTY
      const at = nowMs - signal.startedAtMs + signal.offsetMs
      if (at < 0) return EMPTY
      const { viseme, next, blend } = visemeAt(signal.timeline, at)
      return blendPose(visemePose(viseme), visemePose(next), blend)
    }
    case 'audio': {
      const level = clamp01(signal.envelope?.() ?? 0)
      if (level <= 0.01) return EMPTY
      // An envelope says how loud, never which sound, so this opens the jaw and
      // rounds the lips slightly and claims nothing more. Shaping it further
      // from loudness alone would be invention.
      return { jawOpen: level * 0.72, mouthFunnel: level * 0.18 }
    }
    case 'none':
      return EMPTY
  }
}

/**
 * A smoothed envelope reader over a Web Audio analyser.
 *
 * Root-mean-square rather than peak, because peak on a voice track is mostly
 * plosives and drives a jaw that snaps. The rise is faster than the fall for
 * the same reason a compressor's is: a mouth that opens late looks broken,
 * while one that closes late looks like a held vowel.
 */
export function createAnalyserEnvelope(
  analyser: { getByteTimeDomainData(array: Uint8Array): void; fftSize: number },
  options: { attack?: number; release?: number; gain?: number } = {},
): () => number {
  const attack = options.attack ?? 0.55
  const release = options.release ?? 0.12
  const gain = options.gain ?? 3.2
  const buffer = new Uint8Array(analyser.fftSize)
  let value = 0

  return () => {
    analyser.getByteTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = (buffer[i] - 128) / 128
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / buffer.length)
    const target = clamp01(rms * gain)
    value += (target - value) * (target > value ? attack : release)
    return value
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * The same schedule, expressed as native viseme weights.
 *
 * A character that shipped the OVR set should be driven by it directly rather
 * than through the ARKit approximation — the approximation exists for characters
 * that did not. Both spellings are emitted (`viseme_aa` and `aa`) because both
 * are in the wild, and a rig only applies the names it actually has.
 */
export function sampleNativeVisemes(signal: ReceptionSignal, nowMs: number): Record<string, number> {
  if (!signal.speaking || signal.lipSync !== 'timed' || signal.timeline.length === 0) return {}
  const at = nowMs - signal.startedAtMs + signal.offsetMs
  if (at < 0) return {}
  const { viseme, next, blend } = visemeAt(signal.timeline, at)
  const out: Record<string, number> = {}
  const put = (name: string, weight: number) => {
    if (weight <= 0.0005) return
    out[`viseme_${name}`] = weight
    out[name] = weight
  }
  put(viseme, 1 - blend)
  if (next !== viseme) put(next, blend)
  return out
}
