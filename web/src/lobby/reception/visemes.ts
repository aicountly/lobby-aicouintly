/**
 * Mouth shapes, and how text becomes a schedule of them.
 *
 * Two separate problems live here. The first is *what a mouth shape is*: the
 * lobby speaks in the fifteen Oculus/OVR visemes, because that is the set most
 * character pipelines export, but almost no character actually ships them — so
 * each one is also written out as a blend of ARKit controls, which characters
 * do ship. A character with native `viseme_*` shapes uses them directly; one
 * with only ARKit blendshapes gets the same fifteen shapes built out of what it
 * has; one with neither gets no lip-sync at all and captions instead.
 *
 * The second is *when*. Web Speech synthesis hands back no audio buffer, only
 * word-boundary events, so there is nothing to analyse — the schedule has to be
 * estimated from the text up front and then corrected against those boundaries
 * as they arrive. That is Mode A. Mode B, driving the jaw from an audio
 * envelope, needs a real audio stream and lives in `lipSync.ts`.
 */

/** The fifteen Oculus/OVR visemes. */
export const OVR_VISEMES = [
  'sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou',
] as const

export type OvrViseme = (typeof OVR_VISEMES)[number]

/**
 * The ARKit controls the lobby drives.
 *
 * A subset of the 52, not the whole set: these are the ones something in this
 * codebase actually writes to. A character supplying all 52 is fine — the extra
 * shapes are simply left at zero.
 */
export const FACE_CONTROLS = [
  'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthPressLeft', 'mouthPressRight',
  'mouthShrugUpper', 'mouthRollLower', 'mouthRollUpper', 'tongueOut',
  'browInnerUp', 'browDownLeft', 'browDownRight', 'browOuterUpLeft', 'browOuterUpRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight',
] as const

export type FaceControl = (typeof FACE_CONTROLS)[number]

export type FacePose = Partial<Record<FaceControl, number>>

/**
 * Each viseme written as ARKit controls.
 *
 * This is the "documented mapping onto the ARKit set" that docs/lobby/ASSETS.md
 * says a character may supply instead of native viseme shapes — except that the
 * lobby supplies it, so a character does not have to.
 */
export const VISEME_TO_ARKIT: Readonly<Record<OvrViseme, FacePose>> = {
  sil: {},
  PP: { mouthClose: 0.9, mouthPressLeft: 0.6, mouthPressRight: 0.6 },
  FF: { jawOpen: 0.08, mouthShrugUpper: 0.5, mouthRollLower: 0.62 },
  TH: { jawOpen: 0.22, tongueOut: 0.4, mouthRollUpper: 0.2 },
  DD: { jawOpen: 0.22, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  kk: { jawOpen: 0.3, mouthStretchLeft: 0.12, mouthStretchRight: 0.12 },
  CH: { jawOpen: 0.18, mouthFunnel: 0.55, mouthPucker: 0.35 },
  SS: { jawOpen: 0.1, mouthStretchLeft: 0.45, mouthStretchRight: 0.45, mouthSmileLeft: 0.2, mouthSmileRight: 0.2 },
  nn: { jawOpen: 0.16, mouthClose: 0.3 },
  RR: { jawOpen: 0.2, mouthPucker: 0.42 },
  aa: { jawOpen: 0.78, mouthStretchLeft: 0.15, mouthStretchRight: 0.15 },
  E: { jawOpen: 0.36, mouthSmileLeft: 0.34, mouthSmileRight: 0.34, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
  ih: { jawOpen: 0.24, mouthSmileLeft: 0.44, mouthSmileRight: 0.44, mouthStretchLeft: 0.38, mouthStretchRight: 0.38 },
  oh: { jawOpen: 0.5, mouthFunnel: 0.6, mouthPucker: 0.3 },
  ou: { jawOpen: 0.2, mouthPucker: 0.8, mouthFunnel: 0.45 },
}

/**
 * Letters and digraphs to visemes.
 *
 * Grapheme-level, not phoneme-level: there is no pronunciation dictionary in
 * the bundle and shipping one for lip-sync would cost more than the entire
 * texture set. At conversational speed and across a reception counter the
 * difference between this and true phonemes is not visible; what *is* visible
 * is a mouth that opens on vowels, closes on P and B and rounds on O, and that
 * much is reliable from spelling. Digraphs are matched first, longest first.
 */
const DIGRAPHS: [string, OvrViseme][] = [
  ['tch', 'CH'], ['sch', 'SS'],
  ['ch', 'CH'], ['sh', 'CH'], ['th', 'TH'], ['ph', 'FF'], ['wh', 'ou'],
  ['ng', 'nn'], ['ck', 'kk'], ['qu', 'kk'],
  ['ee', 'E'], ['ea', 'E'], ['ie', 'E'],
  ['oo', 'ou'], ['ou', 'ou'], ['ow', 'oh'], ['oa', 'oh'], ['oi', 'oh'], ['oy', 'oh'],
  ['ai', 'aa'], ['ay', 'E'], ['au', 'oh'], ['aw', 'oh'],
]

const LETTERS: Record<string, OvrViseme> = {
  a: 'aa', e: 'E', i: 'ih', o: 'oh', u: 'ou', y: 'ih',
  b: 'PP', p: 'PP', m: 'PP',
  f: 'FF', v: 'FF',
  t: 'DD', d: 'DD',
  k: 'kk', g: 'kk', c: 'kk', q: 'kk', x: 'kk',
  j: 'CH',
  s: 'SS', z: 'SS',
  n: 'nn', l: 'nn',
  r: 'RR', w: 'ou', h: 'aa',
}

/** One scheduled mouth shape. */
export interface VisemeCue {
  viseme: OvrViseme
  startMs: number
  durationMs: number
  /** Index into the original text, so boundary events can re-anchor the run. */
  charIndex: number
}

export interface TimelineOptions {
  /**
   * Characters per second. 14.5 is roughly 170 words per minute at English
   * word lengths, which is a shade faster than a browser's default voice —
   * being slightly ahead reads better than lagging, because the mouth arriving
   * early looks like anticipation and arriving late looks broken.
   */
  charsPerSecond?: number
  /** Silence inserted at a word gap. */
  gapMs?: number
}

/** Visemes for one word, in order, with the character offset of each. */
function wordVisemes(word: string, offset: number): { viseme: OvrViseme; charIndex: number }[] {
  const lower = word.toLowerCase()
  const out: { viseme: OvrViseme; charIndex: number }[] = []
  let i = 0
  while (i < lower.length) {
    let matched = false
    for (const [graph, viseme] of DIGRAPHS) {
      if (lower.startsWith(graph, i)) {
        out.push({ viseme, charIndex: offset + i })
        i += graph.length
        matched = true
        break
      }
    }
    if (matched) continue
    const viseme = LETTERS[lower[i]]
    // A doubled consonant is one mouth shape, not two: "ll" in "hello" does not
    // reopen the mouth, and scheduling it twice makes the jaw stutter.
    if (viseme && out[out.length - 1]?.viseme !== viseme) out.push({ viseme, charIndex: offset + i })
    i += 1
  }
  return out
}

/**
 * A schedule of mouth shapes for a line of text.
 *
 * Deterministic: the same text always produces the same timeline, which is what
 * makes it testable without a browser or a speaker.
 */
export function visemeTimeline(text: string, options: TimelineOptions = {}): VisemeCue[] {
  const charsPerSecond = options.charsPerSecond ?? 14.5
  const gapMs = options.gapMs ?? 55
  const cues: VisemeCue[] = []
  let cursor = 0

  const words = [...text.matchAll(/\S+/g)]
  for (const match of words) {
    const word = match[0]
    const offset = match.index ?? 0
    const shapes = wordVisemes(word, offset)
    if (shapes.length === 0) continue

    // The word's spoken length comes from its spelling; its visemes then share
    // that length. Deriving per-viseme duration from the word rather than from
    // a fixed per-shape constant is what keeps long words from running ahead.
    const wordMs = (word.length / charsPerSecond) * 1000
    const each = wordMs / shapes.length
    for (const shape of shapes) {
      cues.push({ viseme: shape.viseme, startMs: cursor, durationMs: each, charIndex: shape.charIndex })
      cursor += each
    }
    cues.push({ viseme: 'sil', startMs: cursor, durationMs: gapMs, charIndex: offset + word.length })
    cursor += gapMs
  }

  return cues
}

/** Total scheduled length in milliseconds. */
export function timelineDurationMs(timeline: readonly VisemeCue[]): number {
  const last = timeline[timeline.length - 1]
  return last ? last.startMs + last.durationMs : 0
}

/**
 * The shape at a moment, blended with the one after it.
 *
 * Returning a blend rather than a step is the difference between a mouth that
 * moves and a mouth that flickers: at 14 shapes a second, snapping between them
 * is one shape per two frames at 30 fps.
 */
export function visemeAt(
  timeline: readonly VisemeCue[],
  ms: number,
): { viseme: OvrViseme; next: OvrViseme; blend: number } {
  if (timeline.length === 0) return { viseme: 'sil', next: 'sil', blend: 0 }

  // Linear from a cursor would be fine for one caller, but the scene asks every
  // frame and a long reply is a few hundred cues, so binary search it.
  let low = 0
  let high = timeline.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (timeline[mid].startMs <= ms) low = mid
    else high = mid - 1
  }

  const cue = timeline[low]
  if (ms < cue.startMs) return { viseme: 'sil', next: cue.viseme, blend: 0 }
  const next = timeline[low + 1]
  if (!next) {
    const past = ms - (cue.startMs + cue.durationMs)
    return past > 0 ? { viseme: 'sil', next: 'sil', blend: 0 } : { viseme: cue.viseme, next: 'sil', blend: 0 }
  }

  // Crossfade over the tail of the cue rather than its whole length, so the
  // shape is actually held for a moment before it starts becoming the next one.
  const holdMs = cue.durationMs * 0.55
  const into = ms - cue.startMs - holdMs
  const fadeMs = Math.max(cue.durationMs - holdMs, 1)
  return { viseme: cue.viseme, next: next.viseme, blend: clamp01(into / fadeMs) }
}

/**
 * Re-anchor a timeline against a word boundary reported by the speaker.
 *
 * Estimated timing drifts — a voice at a different rate, a long pause at a
 * comma — and `SpeechSynthesisUtterance` reports which character it has reached.
 * Shifting the whole remaining schedule so that character lands *now* corrects
 * the drift without rebuilding the timeline or jumping the mouth backwards.
 */
export function retimedOffset(
  timeline: readonly VisemeCue[],
  charIndex: number,
  elapsedMs: number,
  currentOffsetMs = 0,
): number {
  const cue = timeline.find((c) => c.charIndex >= charIndex)
  if (!cue) return currentOffsetMs
  const wanted = elapsedMs - cue.startMs
  // Never move the mouth backwards: a correction that rewinds is more visible
  // than the drift it is fixing.
  return Math.max(currentOffsetMs, wanted)
}

/** Blend two poses, weighting the second by `blend`. */
export function blendPose(a: FacePose, b: FacePose, blend: number): FacePose {
  const out: FacePose = {}
  for (const control of FACE_CONTROLS) {
    const value = (a[control] ?? 0) * (1 - blend) + (b[control] ?? 0) * blend
    if (value > 0.0005) out[control] = value
  }
  return out
}

/** The ARKit pose for a viseme, scaled by how strongly it is being held. */
export function visemePose(viseme: OvrViseme, weight = 1): FacePose {
  const base = VISEME_TO_ARKIT[viseme]
  if (weight >= 0.999) return { ...base }
  const out: FacePose = {}
  for (const [control, value] of Object.entries(base)) {
    out[control as FaceControl] = value * weight
  }
  return out
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}
