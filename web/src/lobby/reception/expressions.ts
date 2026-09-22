/**
 * What the face does when it is not forming a word.
 *
 * Expression is driven by conversation state, visemes by speech — two inputs,
 * one face. They are combined additively at the mouth and independently
 * everywhere else, because a smile and an "oh" are the same muscles and a
 * raised brow and an "oh" are not. Anything that would push a control past 1 is
 * clamped rather than renormalised: renormalising makes a smile disappear the
 * moment the character starts talking.
 */
import { FACE_CONTROLS } from './visemes'
import type { FaceControl, FacePose } from './visemes'
import type { ReceptionistState } from './states'

/** The resting expression for each state. */
export const STATE_EXPRESSIONS: Readonly<Record<ReceptionistState, FacePose>> = {
  // Pleasant but not grinning: a held smile across an empty lobby reads as a
  // mask, so idle is barely there and the rest build on it.
  idle: { mouthSmileLeft: 0.12, mouthSmileRight: 0.12 },
  greeting: { mouthSmileLeft: 0.52, mouthSmileRight: 0.52, browInnerUp: 0.3, browOuterUpLeft: 0.35, browOuterUpRight: 0.35, cheekSquintLeft: 0.25, cheekSquintRight: 0.25 },
  // Attention reads as slightly narrowed eyes and a still mouth, not wide ones.
  listening: { mouthSmileLeft: 0.16, mouthSmileRight: 0.16, eyeSquintLeft: 0.16, eyeSquintRight: 0.16, browInnerUp: 0.12 },
  processing: { browInnerUp: 0.42, browDownLeft: 0.22, browDownRight: 0.22, eyeSquintLeft: 0.24, eyeSquintRight: 0.24, mouthPressLeft: 0.2, mouthPressRight: 0.2 },
  speaking: { mouthSmileLeft: 0.18, mouthSmileRight: 0.18, browOuterUpLeft: 0.12, browOuterUpRight: 0.12 },
  handover: { mouthSmileLeft: 0.34, mouthSmileRight: 0.34, browInnerUp: 0.28, browOuterUpLeft: 0.2, browOuterUpRight: 0.2 },
  error: { browInnerUp: 0.62, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, mouthShrugUpper: 0.2 },
}

/**
 * How fast the face moves to a new expression, in units per second.
 *
 * Expression is slower than visemes by roughly an order of magnitude. A face
 * that changes mood as fast as it changes mouth shape looks like a puppet.
 */
export const EXPRESSION_RATE = 3.2

/** Blink timing, in seconds. Humans blink every 2–8 s and take ~120 ms doing it. */
export const BLINK = { minGap: 2.2, maxGap: 6.8, closeFor: 0.12 } as const

/** Add `b` into `a`, clamped to 1. Returns a new pose. */
export function addPose(a: FacePose, b: FacePose): FacePose {
  const out: FacePose = { ...a }
  for (const control of FACE_CONTROLS) {
    const value = (a[control] ?? 0) + (b[control] ?? 0)
    if (value > 0.0005) out[control] = value > 1 ? 1 : value
  }
  return out
}

/**
 * Move `current` towards `target` by at most `rate * delta`, in place.
 *
 * In place because this runs once per frame per control and allocating a pose
 * object at 60 Hz is the kind of thing that shows up as jank on a phone.
 */
export function approachPose(
  current: Record<string, number>,
  target: FacePose,
  rate: number,
  delta: number,
): void {
  const step = rate * delta
  for (const control of FACE_CONTROLS) {
    const want = target[control] ?? 0
    const have = current[control] ?? 0
    if (have === want) continue
    const difference = want - have
    current[control] = Math.abs(difference) <= step ? want : have + Math.sign(difference) * step
  }
}

/** A zeroed pose object with every control the lobby drives. */
export function emptyPose(): Record<FaceControl, number> {
  const pose = {} as Record<FaceControl, number>
  for (const control of FACE_CONTROLS) pose[control] = 0
  return pose
}
