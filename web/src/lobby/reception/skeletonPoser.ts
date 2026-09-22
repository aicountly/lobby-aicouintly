/**
 * Posing a supplied character that ships without animation clips.
 *
 * ## Why this exists
 *
 * ASSETS.md asks a replacement character for one clip and one clip only:
 * `idle`. The character the lobby ships has none. It came out of MakeHuman as
 * geometry, a skeleton and 52 ARKit blendshapes, and authoring clips for it
 * would mean Blender or Mixamo, neither of which was available where this was
 * built.
 *
 * What it does have is a **standard humanoid skeleton with Mixamo naming** —
 * `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftArm`,
 * `LeftForeArm`, and so on. That is enough to pose it in code, which is exactly
 * what the lobby already does for its own generated figure. So the two
 * characters are driven the same way, from the same controller, and a clip is
 * an optimisation rather than a requirement.
 *
 * ## The bind pose is not a standing pose
 *
 * A rigged character is exported in an A-pose or T-pose with the arms held out,
 * because that is what makes skin weighting tractable. Dropped into a room
 * unanimated it reads as a scarecrow, which is worse than the stylised figure
 * it replaced. **Settling the arms against the body is the single most
 * important thing here**, and it is why a clipless character could not simply
 * be mounted.
 *
 * ## What it will not do
 *
 * It does not retarget, blend clips, or solve IK. Every angle below is a
 * hand-set rotation on a named bone, composed onto the rest pose. That is
 * enough for a receptionist who stands, breathes, glances and waves, and it is
 * honest about being that rather than pretending to be an animation system.
 */
import { Euler, Quaternion } from 'three'
import type { Object3D } from 'three'

import type { ReceptionistClip } from '../assets/assetConfig'

/** Mixamo names, with and without the common `mixamorig` prefix. */
const BONES = {
  hips: ['Hips'],
  spine: ['Spine'],
  chest: ['Spine1'],
  upperChest: ['Spine2'],
  neck: ['Neck'],
  head: ['Head'],
  leftArm: ['LeftArm'],
  leftForeArm: ['LeftForeArm'],
  leftHand: ['LeftHand'],
  rightArm: ['RightArm'],
  rightForeArm: ['RightForeArm'],
  rightHand: ['RightHand'],
  leftShoulder: ['LeftShoulder'],
  rightShoulder: ['RightShoulder'],
} as const

type BoneKey = keyof typeof BONES

export interface SkeletonPoseInput {
  role: ReceptionistClip
  /** Seconds since this role started. */
  roleElapsed: number
  /** Wall time in seconds, for the continuous idle motion. */
  time: number
  reducedMotion: boolean
}

export interface SkeletonPoser {
  /** False when the rig is not one this can drive; the caller then leaves it alone. */
  readonly usable: boolean
  readonly found: readonly BoneKey[]
  apply(input: SkeletonPoseInput): void
}

/**
 * Arms down, measured rather than guessed.
 *
 * Two things were wrong the first time and both are worth recording, because
 * they are the traps in posing any supplied rig:
 *
 *   1. **This bind pose is not a T-pose.** Loading the rig and reading world
 *      positions off it says the hands already sit at y=1.08 on a 1.78 m
 *      figure — hip height — splayed out at x=+/-0.48. It needs bringing IN,
 *      not DOWN, and an abduction rotation sized for a T-pose swings the arms
 *      back out to horizontal.
 *
 *   2. **Rotations here are in the bone's local space, not the world's.** A
 *      shoulder's local axes do not line up with the room's, so "rotate about Z
 *      to abduct" is only true of a rig whose bones happen to be aligned that
 *      way. On this one the axis that brings a hand in to the hip is local
 *      **X**, and with the SAME sign on both arms, because the mirrored bones
 *      carry mirrored axes with them.
 *
 * So the numbers below came from loading the file and measuring where the hand
 * ends up, not from reasoning about anatomy:
 *
 *   local X   left hand        right hand
 *   0.00      x=0.44 y=1.04    x=-0.44 y=1.04    splayed, the bind pose
 *   0.55      x=0.21 y=0.95    x=-0.21 y=0.95    hanging at the hip
 *   0.95      x=0.04 y=0.97    x=-0.04 y=0.97    crossed in front, too close
 */
const ARM_REST_X = 0.58

/** Raises the waving hand to y=1.62, level with the head, from ARM_REST_X. */
const WAVE_RAISE = 1.6

const FOREARM_BEND = 0.25

const IDENTITY = new Quaternion()

export function createSkeletonPoser(root: Object3D): SkeletonPoser {
  const bones = {} as Record<BoneKey, Object3D | null>
  const rest = {} as Record<BoneKey, Quaternion>
  const found: BoneKey[] = []

  for (const key of Object.keys(BONES) as BoneKey[]) {
    const names = BONES[key]
    let bone: Object3D | null = null
    root.traverse((child) => {
      if (bone) return
      const name = child.name
      for (const candidate of names) {
        if (name === candidate || name === `mixamorig${candidate}` || name === `mixamorig:${candidate}`) {
          bone = child
          return
        }
      }
    })
    bones[key] = bone
    if (bone) {
      rest[key] = (bone as Object3D).quaternion.clone()
      found.push(key)
    }
  }

  // Without the arms there is nothing worth doing here: the scarecrow pose is
  // the whole problem this solves, and half-posing a rig it does not recognise
  // would look worse than leaving it in bind.
  const usable = Boolean(bones.leftArm && bones.rightArm)

  const euler = new Euler()
  const scratch = new Quaternion()

  function set(key: BoneKey, x: number, y: number, z: number): void {
    const bone = bones[key]
    if (!bone) return
    euler.set(x, y, z)
    scratch.setFromEuler(euler)
    bone.quaternion.copy(rest[key] ?? IDENTITY).multiply(scratch)
  }

  return {
    usable,
    found,
    apply({ role, roleElapsed, time, reducedMotion }: SkeletonPoseInput): void {
      if (!usable) return

      // --- Standing, always. The arms come down first and stay down. --------
      const breath = reducedMotion ? 0 : Math.sin(time * 1.15) * 0.5 + 0.5
      const sway = reducedMotion ? 0 : Math.sin(time * 0.43)

      set('spine', breath * 0.012, sway * 0.012, 0)
      set('chest', breath * 0.016, sway * 0.008, 0)
      set('upperChest', breath * 0.01, 0, 0)

      let rightArmX = ARM_REST_X
      let rightForeArmPosed = false

      // --- Greeting: the right arm goes up and the forearm waves. -----------
      //
      // Abduction about Z again, not a forward raise about X: raising forward
      // past vertical is what put the arm behind the character's head last
      // time. The forearm swings about Y so the palm crosses the body, which is
      // what a wave looks like from in front.
      if (role === 'greet' || role === 'gesture') {
        const t = Math.min(roleElapsed / 0.45, 1)
        const ease = t * t * (3 - 2 * t)
        rightArmX = ARM_REST_X - ease * (role === 'greet' ? WAVE_RAISE : WAVE_RAISE * 0.55)
        const wave = reducedMotion ? 0 : Math.sin(roleElapsed * 9.5) * 0.4 * ease
        set('rightForeArm', -0.6 * ease + FOREARM_BEND * (1 - ease), wave, 0)
        rightForeArmPosed = true
      }

      set('leftArm', ARM_REST_X, 0, 0)
      set('rightArm', rightArmX, 0, 0)
      set('leftForeArm', FOREARM_BEND, 0, 0)
      if (!rightForeArmPosed) set('rightForeArm', FOREARM_BEND, 0, 0)

      // --- Head: a small settle, and a glance while listening. --------------
      const listening = role === 'listen'
      const speaking = role === 'speak'
      const nod = speaking && !reducedMotion ? Math.sin(time * 2.6) * 0.035 : 0
      const tilt = listening ? 0.06 : 0

      set('neck', nod * 0.5, sway * 0.02, tilt * 0.5)
      set('head', nod + (listening ? 0.03 : 0), sway * 0.03, tilt)
    },
  }
}
