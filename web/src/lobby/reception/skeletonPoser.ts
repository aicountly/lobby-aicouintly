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

/**
 * Bone names, per convention, most specific first.
 *
 * Two are supported because the two characters that have been through here use
 * different ones: MakeHuman exports Mixamo names, and Microsoft RocketBox
 * exports 3ds Max Biped names (`Bip01_*`). A rig using neither reports
 * `usable: false` and is left in its bind pose rather than half-posed.
 */
const BONES = {
  hips: ['Hips', 'Bip01_Pelvis'],
  spine: ['Spine', 'Bip01_Spine'],
  chest: ['Spine1', 'Bip01_Spine1'],
  upperChest: ['Spine2', 'Bip01_Spine2'],
  neck: ['Neck', 'Bip01_Neck'],
  head: ['Head', 'Bip01_Head'],
  leftArm: ['LeftArm', 'Bip01_L_UpperArm'],
  leftForeArm: ['LeftForeArm', 'Bip01_L_Forearm'],
  leftHand: ['LeftHand', 'Bip01_L_Hand'],
  rightArm: ['RightArm', 'Bip01_R_UpperArm'],
  rightForeArm: ['RightForeArm', 'Bip01_R_Forearm'],
  rightHand: ['RightHand', 'Bip01_R_Hand'],
  leftShoulder: ['LeftShoulder', 'Bip01_L_Clavicle'],
  rightShoulder: ['RightShoulder', 'Bip01_R_Clavicle'],
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
  /** Which naming convention was recognised, for the capability report. */
  readonly convention: 'mixamo' | 'biped'
  apply(input: SkeletonPoseInput): void
}

/**
 * Arms down, measured per rig rather than guessed once.
 *
 * Two traps, both of which cost real time and are why these numbers came from
 * loading each file and reading world positions off it:
 *
 *   1. **Neither bind pose is a T-pose.** Both rigs park the hands at about hip
 *      height already, splayed out at x=+/-0.5. They need bringing IN, not
 *      DOWN, and an abduction sized for a T-pose swings the arms back out.
 *
 *   2. **Rotations apply in the BONE's local space, and the two conventions do
 *      not agree on which axis that is.** MakeHuman/Mixamo settles an arm about
 *      local X with the SAME sign on both sides; RocketBox/Biped settles it
 *      about local Y with MIRRORED signs. Using one rig's numbers on the other
 *      raises an arm over the character's head.
 *
 * Measured, left hand, from the bind pose at x=0.52 y=1.06:
 *
 *   Biped   local Y +1.0  -> x=0.10 y=0.92   in and down (too far in at 1.0)
 *   Biped   local Y -1.0  -> x=0.63 y=1.50   raised, which is the wave
 *   Mixamo  local X +0.55 -> x=0.21 y=0.95   in and down
 */
interface RigProfile {
  /** Which local axis abducts the upper arm. */
  readonly armAxis: 'x' | 'y' | 'z'
  readonly leftRest: number
  readonly rightRest: number
  /** Absolute upper-arm angle for a wave. */
  readonly rightWave: number
  readonly foreArmAxis: 'x' | 'y' | 'z'
  readonly foreArmBend: number
  /** Bending the forearm is what lifts the hand beside the head. */
  readonly waveForeArmAxis: 'x' | 'y' | 'z'
  readonly waveForeArmBend: number
  /** The side-to-side of the wave itself. */
  readonly waveSwingAxis: 'x' | 'y' | 'z'
}

/**
 * Wave angles, measured against this rig rather than guessed.
 *
 * Head at y=1.52, shoulder at 1.38. Abducting the upper arm alone raises the
 * hand to shoulder height and leaves it pointing straight out sideways, which
 * reads as "stop", not "hello". The forearm bend is what brings it up:
 *
 *   armY 1.05 alone        -> hand y=1.50, x=-0.62   straight out
 *   armY 1.05 + foreY 1.2  -> hand y=1.68, x=-0.41   beside the head
 */
const PROFILES: Record<'mixamo' | 'biped', RigProfile> = {
  mixamo: {
    armAxis: 'x', leftRest: 0.58, rightRest: 0.58, rightWave: -1.02,
    foreArmAxis: 'x', foreArmBend: 0.25,
    waveForeArmAxis: 'x', waveForeArmBend: -0.6, waveSwingAxis: 'y',
  },
  biped: {
    armAxis: 'y', leftRest: 0.72, rightRest: -0.72, rightWave: 1.05,
    foreArmAxis: 'y', foreArmBend: -0.18,
    waveForeArmAxis: 'y', waveForeArmBend: 1.2, waveSwingAxis: 'z',
  },
}

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

  // Which convention this rig follows decides the axis and the signs.
  const convention: 'mixamo' | 'biped' = bones.leftArm?.name.startsWith('Bip01') ? 'biped' : 'mixamo'
  const profile = PROFILES[convention]

  const euler = new Euler()
  const scratch = new Quaternion()

  function set(key: BoneKey, x: number, y: number, z: number): void {
    const bone = bones[key]
    if (!bone) return
    euler.set(x, y, z)
    scratch.setFromEuler(euler)
    bone.quaternion.copy(rest[key] ?? IDENTITY).multiply(scratch)
  }

  /** Rotate a bone by one angle on whichever axis this rig uses. */
  function setOnAxis(key: BoneKey, axis: 'x' | 'y' | 'z', angle: number): void {
    set(key, axis === 'x' ? angle : 0, axis === 'y' ? angle : 0, axis === 'z' ? angle : 0)
  }

  return {
    usable,
    found,
    convention,
    apply({ role, roleElapsed, time, reducedMotion }: SkeletonPoseInput): void {
      if (!usable) return

      // --- Standing, always. The arms come down first and stay down. --------
      const breath = reducedMotion ? 0 : Math.sin(time * 1.15) * 0.5 + 0.5
      const sway = reducedMotion ? 0 : Math.sin(time * 0.43)

      set('spine', breath * 0.012, sway * 0.012, 0)
      set('chest', breath * 0.016, sway * 0.008, 0)
      set('upperChest', breath * 0.01, 0, 0)

      let rightArm = profile.rightRest
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
        const raised = role === 'greet' ? profile.rightWave : (profile.rightRest + profile.rightWave) / 2
        rightArm = profile.rightRest + (raised - profile.rightRest) * ease
        const swing = reducedMotion ? 0 : Math.sin(roleElapsed * 9.5) * 0.35 * ease
        const bend = profile.foreArmBend + (profile.waveForeArmBend - profile.foreArmBend) * ease
        const angles = { x: 0, y: 0, z: 0 }
        angles[profile.waveForeArmAxis] = bend
        angles[profile.waveSwingAxis] += swing
        set('rightForeArm', angles.x, angles.y, angles.z)
        rightForeArmPosed = true
      }

      setOnAxis('leftArm', profile.armAxis, profile.leftRest)
      setOnAxis('rightArm', profile.armAxis, rightArm)
      setOnAxis('leftForeArm', profile.foreArmAxis, profile.foreArmBend)
      if (!rightForeArmPosed) setOnAxis('rightForeArm', profile.foreArmAxis, profile.foreArmBend)

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
