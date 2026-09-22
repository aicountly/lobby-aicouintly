/**
 * The reception character.
 *
 * Generated, not sculpted: an articulated figure with a procedural face whose
 * mouth is driven by the same viseme schedule a supplied glTF would be driven
 * by. It is stylised and it is labelled as such — on its badge, above its head,
 * and in the interface. It is not photoreal art and nothing in the room claims
 * it is.
 *
 * It is still replaced rather than edited: point `receptionist.url` in the asset
 * manifest at a rigged glTF and none of this geometry is mounted. What survives
 * the swap is everything above it — the state machine, the animation controller
 * and the lip-sync driver all work against `CharacterCapability`, which is
 * probed from whichever character is actually present.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'

import { RECEPTIONIST_SPOT } from '../layout'
import { createReceptionAnimationController } from '../reception/animationController'
import { faceCapabilityFrom, proceduralCapability } from '../reception/capability'
import type { CharacterCapability } from '../reception/capability'
import { BLINK, EXPRESSION_RATE, STATE_EXPRESSIONS, approachPose, emptyPose } from '../reception/expressions'
import { sampleLipSync } from '../reception/lipSync'
import type { ReceptionSignal } from '../reception/signal'
import { FACE_CONTROLS } from '../reception/visemes'
import type { ReceptionistClip } from '../assets/assetConfig'
import { createProceduralFace } from './face'
import { getMaterials } from './materials'
import { Box, Cylinder } from './primitives'
import { placeholderBadgeTexture, signTexture } from './textures'

interface Props {
  signal: ReceptionSignal
  reducedMotion: boolean
  /** Reports what this character can do, once, on mount. */
  onCapability?: (capability: CharacterCapability) => void
}

/** Head and neck sit on top of the torso; everything else hangs off this. */
const HEAD_Y = 1.775
/** How far the head will turn to follow a visitor before the body would have to. */
const HEAD_YAW_LIMIT = 0.62
const HEAD_PITCH_LIMIT = 0.3

interface BodyPose {
  bob: number
  lean: number
  sway: number
  /** [character's left (+X), character's right (−X)] */
  shoulder: [number, number]
  shoulderOut: [number, number]
  elbow: [number, number]
  elbowSwing: [number, number]
  headTilt: number
  headNod: number
}

function emptyBodyPose(): BodyPose {
  return {
    bob: 0,
    lean: 0,
    sway: 0,
    shoulder: [0.06, 0.06],
    shoulderOut: [0, 0],
    elbow: [0.5, 0.5],
    elbowSwing: [0, 0],
    headTilt: 0,
    headNod: 0,
  }
}

/**
 * The stance for one animation role.
 *
 * `loopTime` runs continuously for looping roles; `shot` runs 0→1 across a
 * one-shot and stays at 1 afterwards, which is what lets a wave arc up and back
 * down exactly once.
 */
function poseForRole(role: ReceptionistClip, loopTime: number, shot: number, out: BodyPose): BodyPose {
  out.bob = 0
  out.lean = 0
  out.sway = 0
  out.shoulder[0] = 0.06
  out.shoulder[1] = 0.06
  out.shoulderOut[0] = 0
  out.shoulderOut[1] = 0
  out.elbow[0] = 0.5
  out.elbow[1] = 0.5
  out.elbowSwing[0] = 0
  out.elbowSwing[1] = 0
  out.headTilt = 0
  out.headNod = 0

  // A single arc, peaking halfway: one-shots are gestures, and a gesture that
  // ends where it started needs no separate return animation.
  const arc = Math.sin(Math.min(1, Math.max(0, shot)) * Math.PI)

  switch (role) {
    case 'idle':
      out.bob = Math.sin(loopTime * 0.9) * 0.012
      out.sway = Math.sin(loopTime * 0.35) * 0.05
      break
    case 'listen':
      out.bob = Math.sin(loopTime * 1.05) * 0.008
      out.lean = 0.055
      out.headTilt = 0.08
      out.shoulder[0] = 0.11
      out.shoulder[1] = 0.11
      out.elbow[0] = 0.62
      out.elbow[1] = 0.62
      break
    case 'think':
      out.bob = Math.sin(loopTime * 0.7) * 0.006
      out.headTilt = 0.14
      out.headNod = -0.1
      // Hand towards the chin. Only one arm moves; both would read as a shrug.
      out.shoulder[1] = -1.22
      out.shoulderOut[1] = -0.22
      out.elbow[1] = -1.72
      break
    case 'speak':
      out.bob = Math.sin(loopTime * 1.4) * 0.009
      out.sway = Math.sin(loopTime * 0.55) * 0.04
      out.shoulder[0] = 0.12 + Math.sin(loopTime * 2.2) * 0.1
      out.shoulder[1] = 0.12 + Math.sin(loopTime * 2.2 + 1.9) * 0.1
      out.elbow[0] = 0.56 + Math.sin(loopTime * 1.7) * 0.16
      out.elbow[1] = 0.56 + Math.sin(loopTime * 1.7 + 2.4) * 0.16
      out.headNod = Math.sin(loopTime * 1.3) * 0.05
      break
    case 'greet':
      out.shoulder[1] = 0.06 - 2.25 * arc
      out.shoulderOut[1] = -0.3 * arc
      out.elbow[1] = 0.5 - 1.3 * arc
      out.elbowSwing[1] = Math.sin(shot * Math.PI * 5.5) * 0.5 * arc
      out.headNod = -0.05 * arc
      out.bob = Math.sin(loopTime * 0.9) * 0.008
      break
    case 'gesture':
      // An open-handed present towards the lounge, on the visitor's right.
      out.shoulder[0] = 0.06 - 1.05 * arc
      out.shoulderOut[0] = 0.62 * arc
      out.elbow[0] = 0.5 - 0.38 * arc
      out.sway = 0.14 * arc
      out.headTilt = 0.06 * arc
      break
    case 'apology':
      out.lean = 0.035
      out.headNod = 0.12
      out.shoulder[0] = 0.02
      out.shoulder[1] = 0.02
      out.elbow[0] = 0.44
      out.elbow[1] = 0.44
      break
    case 'seated':
      out.lean = 0.02
      break
  }
  return out
}

function lerpBodyPose(a: BodyPose, b: BodyPose, t: number, out: BodyPose): BodyPose {
  const mix = (x: number, y: number) => x + (y - x) * t
  out.bob = mix(a.bob, b.bob)
  out.lean = mix(a.lean, b.lean)
  out.sway = mix(a.sway, b.sway)
  out.headTilt = mix(a.headTilt, b.headTilt)
  out.headNod = mix(a.headNod, b.headNod)
  for (let i = 0; i < 2; i += 1) {
    out.shoulder[i] = mix(a.shoulder[i], b.shoulder[i])
    out.shoulderOut[i] = mix(a.shoulderOut[i], b.shoulderOut[i])
    out.elbow[i] = mix(a.elbow[i], b.elbow[i])
    out.elbowSwing[i] = mix(a.elbowSwing[i], b.elbowSwing[i])
  }
  return out
}

export function ProceduralReceptionist({ signal, reducedMotion, onCapability }: Props) {
  const m = getMaterials()
  const root = useRef<Group>(null)
  const torso = useRef<Group>(null)
  const neck = useRef<Group>(null)
  const shoulders = useRef<(Group | null)[]>([null, null])
  const elbows = useRef<(Group | null)[]>([null, null])

  const face = useMemo(() => createProceduralFace(), [])

  const capability = useMemo(
    () => proceduralCapability(faceCapabilityFrom(face.rig.controls)),
    [face],
  )

  const controller = useMemo(
    () => createReceptionAnimationController({ capability, reducedMotion }),
    // Rebuilding on a reduced-motion change would restart the pose; the
    // controller is told instead, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capability],
  )

  useEffect(() => {
    controller.setReducedMotion(reducedMotion)
  }, [controller, reducedMotion])

  useEffect(() => {
    onCapability?.(capability)
  }, [capability, onCapability])

  useEffect(() => () => {
    controller.dispose()
    face.dispose()
  }, [controller, face])

  const badge = useMemo(
    () => new THREE.MeshBasicMaterial({ map: placeholderBadgeTexture(), toneMapped: false }),
    [],
  )

  const label = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: signTexture('Generated character · demonstration', {
          width: 768,
          height: 128,
          fontSize: 54,
          background: 'rgba(35,40,44,0.92)',
          color: '#f6f1e8',
        }),
        toneMapped: false,
        transparent: true,
      }),
    [],
  )

  useEffect(
    () => () => {
      badge.map?.dispose()
      badge.dispose()
      label.map?.dispose()
      label.dispose()
    },
    [badge, label],
  )

  // Per-frame scratch, allocated once. At 60 Hz these would otherwise be a
  // steady drip of garbage for the collector to find during a conversation.
  const scratch = useMemo(
    () => ({
      current: emptyBodyPose(),
      previous: emptyBodyPose(),
      blended: emptyBodyPose(),
      expression: emptyPose(),
      applied: emptyPose(),
      headWorld: new THREE.Vector3(),
      blink: { next: 3.2, closing: 0 },
      headYaw: 0,
      headPitch: 0,
      lastRevision: -1,
    }),
    [],
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const time = state.clock.elapsedTime

    if (signal.stateRevision !== scratch.lastRevision) {
      scratch.lastRevision = signal.stateRevision
      controller.setState(signal.state)
    }
    controller.update(dt)

    // --- Body
    const shot = controller.oneShotActive
      ? Math.min(1, controller.roleElapsed / Math.max(0.2, oneShotSeconds(controller.role)))
      : 1
    const target = poseForRole(controller.role, time, shot, scratch.current)
    const pose = controller.previousRole
      ? lerpBodyPose(
          poseForRole(controller.previousRole, time, 1, scratch.previous),
          target,
          controller.blend,
          scratch.blended,
        )
      : target

    const still = reducedMotion
    const group = root.current
    if (group) {
      group.position.y = still ? 0 : pose.bob
      group.rotation.y = RECEPTIONIST_SPOT.facing + (still ? 0 : pose.sway)
    }
    if (torso.current) torso.current.rotation.x = still ? 0 : pose.lean
    for (let i = 0; i < 2; i += 1) {
      const shoulder = shoulders.current[i]
      if (shoulder) {
        shoulder.rotation.x = still ? 0.06 : pose.shoulder[i]
        shoulder.rotation.z = (i === 0 ? 0.06 : -0.06) + (still ? 0 : pose.shoulderOut[i])
      }
      const elbow = elbows.current[i]
      if (elbow) {
        elbow.rotation.x = still ? 0.5 : pose.elbow[i]
        elbow.rotation.z = still ? 0 : pose.elbowSwing[i]
      }
    }

    // --- Head: turn towards whoever is at the counter.
    if (!still && root.current) {
      root.current.getWorldPosition(scratch.headWorld)
      scratch.headWorld.y += HEAD_Y
      const dx = state.camera.position.x - scratch.headWorld.x
      const dz = state.camera.position.z - scratch.headWorld.z
      const dy = state.camera.position.y - scratch.headWorld.y
      const flat = Math.hypot(dx, dz)
      // Relative to the body, which is itself swaying, so the head tracks the
      // visitor rather than the room.
      const bodyYaw = root.current.rotation.y
      const wantYaw = clamp(wrapAngle(Math.atan2(dx, dz) - bodyYaw), -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT)
      const wantPitch = clamp(-Math.atan2(dy, Math.max(flat, 0.2)), -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT)
      // Eased rather than snapped: a head that locks on instantly is unnerving.
      scratch.headYaw += (wantYaw - scratch.headYaw) * Math.min(1, dt * 3.4)
      scratch.headPitch += (wantPitch - scratch.headPitch) * Math.min(1, dt * 3.4)
    } else {
      scratch.headYaw += (0 - scratch.headYaw) * Math.min(1, dt * 3)
      scratch.headPitch += (0 - scratch.headPitch) * Math.min(1, dt * 3)
    }
    face.look(scratch.headPitch + (still ? 0 : pose.headNod), scratch.headYaw)
    if (neck.current) neck.current.rotation.z = still ? 0 : pose.headTilt * 0.5
    // Eyes lead the head by a little, which is what makes the tracking read as
    // attention rather than as a turret.
    face.gaze(still ? 0 : scratch.headYaw * 0.45, still ? 0 : scratch.headPitch * 0.5)

    // --- Face: expression is slow, visemes are not, blinks are fastest.
    const expression = STATE_EXPRESSIONS[signal.state]
    approachPose(scratch.expression, expression, EXPRESSION_RATE, dt)

    const applied = scratch.applied
    for (const control of FACE_CONTROLS) applied[control] = scratch.expression[control]

    if (!still) {
      const viseme = sampleLipSync(signal, nowMs())
      for (const key of Object.keys(viseme) as (keyof typeof viseme)[]) {
        const value = viseme[key] ?? 0
        const total = (applied[key] ?? 0) + value
        applied[key] = total > 1 ? 1 : total
      }

      scratch.blink.next -= dt
      if (scratch.blink.closing > 0) {
        scratch.blink.closing -= dt
      } else if (scratch.blink.next <= 0) {
        scratch.blink.closing = BLINK.closeFor
        scratch.blink.next = BLINK.minGap + Math.random() * (BLINK.maxGap - BLINK.minGap)
      }
      if (scratch.blink.closing > 0) {
        // Triangular: shut and open again across the same window.
        const t = 1 - Math.abs((scratch.blink.closing / BLINK.closeFor) * 2 - 1)
        const shut = Math.max(applied.eyeBlinkLeft, t)
        applied.eyeBlinkLeft = shut
        applied.eyeBlinkRight = shut
      }
    }

    face.rig.apply(applied)
  })

  return (
    <group
      ref={root}
      position={[RECEPTIONIST_SPOT.x, 0, RECEPTIONIST_SPOT.z]}
      rotation={[0, RECEPTIONIST_SPOT.facing, 0]}
    >
      {/* Shoes and legs. */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <Box size={[0.11, 0.07, 0.26]} position={[x, 0.035, 0.03]} material={m.graphite} />
          <Cylinder radiusTop={0.075} radiusBottom={0.085} height={0.78} position={[x, 0.46, 0]} material={m.graphite} />
        </group>
      ))}

      {/* Everything above the hips leans as one. */}
      <group ref={torso} position={[0, 0.85, 0]}>
        <Box size={[0.34, 0.2, 0.22]} position={[0, 0.09, 0]} material={m.graphite} />
        <Cylinder radiusTop={0.19} radiusBottom={0.18} height={0.56} segments={20} position={[0, 0.47, 0]} material={m.blouse} />
        <Cylinder radiusTop={0.07} height={0.44} segments={12} position={[0, 0.7, 0]} rotation={[0, 0, Math.PI / 2]} material={m.blouse} />
        {/* A collar. Without one the chin sits on a bare column of neck and the
            figure reads as stretched rather than as a person in a shirt. */}
        <Cylinder radiusTop={0.072} radiusBottom={0.105} height={0.055} segments={18} position={[0, 0.755, 0]} material={m.blouse} />

        {/* The single emerald accent: a lanyard, not a uniform. */}
        <Box size={[0.07, 0.24, 0.03]} position={[0, 0.37, 0.185]} material={m.placeholderAccent} />

        {/* Badge, worn high enough to clear the 1.19 m counter, so the figure
            can say what it is from the visitor's side of the desk. */}
        <mesh position={[0, 0.6, 0.2]} material={badge}>
          <planeGeometry args={[0.28, 0.14]} />
        </mesh>

        {/* Arms, pivoted at the shoulder so a gesture is a rotation and not a
            second set of geometry. Index 0 is the character's left (+X). */}
        {[1, -1].map((side, index) => (
          <group
            key={side}
            ref={(node) => {
              shoulders.current[index] = node
            }}
            position={[side * 0.225, 0.66, 0]}
          >
            <Cylinder radiusTop={0.055} height={0.4} position={[0, -0.2, 0.01]} material={m.blouse} />
            <group
              ref={(node) => {
                elbows.current[index] = node
              }}
              position={[0, -0.4, 0.015]}
            >
              <Cylinder radiusTop={0.05} height={0.38} position={[0, -0.17, 0.03]} material={m.blouse} />
              <mesh position={[0, -0.37, 0.05]} material={m.skin} castShadow>
                <sphereGeometry args={[0.056, 14, 12]} />
              </mesh>
            </group>
          </group>
        ))}

        {/* Neck, then the generated head. */}
        <group ref={neck} position={[0, 0.77, 0]}>
          <Cylinder radiusTop={0.052} radiusBottom={0.058} height={0.1} position={[0, 0, 0]} material={m.skin} />
          <primitive object={face.group} position={[0, 0.148, 0]} />
        </group>
      </group>

      {/* Above head height, so there is no reading of this figure that mistakes
          it for finished art. */}
      <mesh position={[0, 2.68, 0]} material={label}>
        <planeGeometry args={[1.12, 0.19]} />
      </mesh>
    </group>
  )
}

/** Matches the one-shot lengths the controller uses for a procedural figure. */
function oneShotSeconds(role: ReceptionistClip): number {
  return role === 'greet' ? 1.7 : role === 'gesture' ? 1.9 : role === 'apology' ? 1.3 : 1.5
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function wrapAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
