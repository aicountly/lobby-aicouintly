/**
 * What the body does, and how it gets there.
 *
 * The controller sits between conversation state and whatever is rendering the
 * character. It resolves a state to an animation role, crossfades rather than
 * cutting, plays greeting and handover once instead of looping them, and
 * reports when a one-shot has finished so the conversation can move on.
 *
 * It works with or without an `AnimationMixer`. With one — a supplied glTF — it
 * drives actions. Without one — the lobby's own procedural figure, which is
 * posed in code — it still resolves the role and reports the crossfade
 * progress, and the figure reads those. Keeping one controller for both is what
 * stops the procedural character and a supplied one from drifting into
 * different behaviour.
 */
import { LoopOnce, LoopRepeat } from 'three'
import type { AnimationAction, AnimationClip, AnimationMixer } from 'three'

import { RECEPTIONIST_ONE_SHOT_STATES, RECEPTIONIST_STATE_CLIPS } from '../assets/assetConfig'
import type { ReceptionistClip, ReceptionistState } from '../assets/assetConfig'
import type { CharacterCapability } from './capability'
import { canTransition } from './states'

/**
 * How long a one-shot runs when nothing can tell us.
 *
 * Only used for the procedural figure, which has no clip to measure. A supplied
 * glTF uses its clip's real duration.
 */
const PROCEDURAL_ONE_SHOT_SECONDS: Partial<Record<ReceptionistClip, number>> = {
  greet: 1.7,
  gesture: 1.9,
  apology: 1.3,
}

export interface AnimationControllerOptions {
  capability: CharacterCapability
  /** Present only for a supplied glTF. */
  mixer?: AnimationMixer | null
  clips?: readonly AnimationClip[]
  /** Seconds. Zero when the visitor asked for reduced motion. */
  crossFadeSeconds?: number
  reducedMotion?: boolean
  /** Fired when a one-shot role finishes, so the caller can leave the state. */
  onOneShotEnd?: (state: ReceptionistState) => void
}

export interface ReceptionAnimationController {
  setState(state: ReceptionistState): void
  update(deltaSeconds: number): void
  readonly state: ReceptionistState
  readonly role: ReceptionistClip
  readonly previousRole: ReceptionistClip | null
  /** 0 at the start of a crossfade, 1 once `role` is fully in. */
  readonly blend: number
  /** Seconds since this role started. */
  readonly roleElapsed: number
  readonly oneShotActive: boolean
  setReducedMotion(reduced: boolean): void
  dispose(): void
}

export function createReceptionAnimationController(
  options: AnimationControllerOptions,
): ReceptionAnimationController {
  const { capability, mixer = null, clips = [], onOneShotEnd } = options
  let reducedMotion = options.reducedMotion ?? false
  const fadeSeconds = options.crossFadeSeconds ?? 0.3

  const byName = new Map(clips.map((clip) => [clip.name, clip]))
  const actions = new Map<string, AnimationAction>()

  let state: ReceptionistState = 'idle'
  let role: ReceptionistClip = 'idle'
  let previousRole: ReceptionistClip | null = null
  let blend = 1
  let roleElapsed = 0
  let oneShotSeconds = 0
  let oneShotActive = false
  let disposed = false

  function actionFor(target: ReceptionistClip): AnimationAction | null {
    if (!mixer) return null
    const name = capability.clipsByRole[target]
    if (!name) return null
    const existing = actions.get(name)
    if (existing) return existing
    const clip = byName.get(name)
    if (!clip) return null
    const action = mixer.clipAction(clip)
    actions.set(name, action)
    return action
  }

  function clipSeconds(target: ReceptionistClip): number {
    const name = capability.clipsByRole[target]
    const clip = name ? byName.get(name) : undefined
    return clip?.duration ?? PROCEDURAL_ONE_SHOT_SECONDS[target] ?? 1.5
  }

  function crossFadeTo(target: ReceptionistClip, once: boolean): void {
    const fade = reducedMotion ? 0 : fadeSeconds
    const from = role
    previousRole = from === target ? null : from
    role = target
    blend = fade > 0 && previousRole ? 0 : 1
    roleElapsed = 0
    oneShotActive = once
    oneShotSeconds = once ? clipSeconds(target) : 0

    if (!mixer) return

    const next = actionFor(target)
    if (!next) return
    const current = previousRole ? actionFor(previousRole) : null

    next.reset()
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity)
    next.clampWhenFinished = once
    next.enabled = true
    next.setEffectiveWeight(1)
    next.play()

    if (current && current !== next && fade > 0) current.crossFadeTo(next, fade, false)
    else if (current && current !== next) current.stop()

    if (reducedMotion) {
      // Posed, not animated: hold the first frame of the new role rather than
      // playing it. The character still changes stance between states, which is
      // the information, without anything moving.
      mixer.update(0)
      next.paused = true
    }
  }

  // The resting role once a one-shot has run out. Greeting settles to idle;
  // handover settles to idle too, because the point of the gesture is that the
  // exchange has been passed on.
  function restingState(): ReceptionistState {
    return 'idle'
  }

  const controller: ReceptionAnimationController = {
    get state() {
      return state
    },
    get role() {
      return role
    },
    get previousRole() {
      return previousRole
    },
    get blend() {
      return blend
    },
    get roleElapsed() {
      return roleElapsed
    },
    get oneShotActive() {
      return oneShotActive
    },

    setState(next) {
      if (disposed || next === state) return
      if (import.meta.env?.DEV && !canTransition(state, next)) {
        console.warn(`[lobby] receptionist went ${state} -> ${next}, which is not in the transition table`)
      }
      state = next
      crossFadeTo(RECEPTIONIST_STATE_CLIPS[next], RECEPTIONIST_ONE_SHOT_STATES.includes(next))
    },

    update(deltaSeconds) {
      if (disposed) return
      // Same clamp the walk loop uses: a backgrounded tab returns one enormous
      // delta, and letting it through skips a one-shot entirely.
      const delta = Math.min(Math.max(deltaSeconds, 0), 0.5)
      roleElapsed += delta

      if (blend < 1 && fadeSeconds > 0 && !reducedMotion) {
        blend = Math.min(1, blend + delta / fadeSeconds)
        if (blend >= 1) previousRole = null
      }

      if (mixer && !reducedMotion) mixer.update(delta)

      if (oneShotActive && roleElapsed >= oneShotSeconds) {
        oneShotActive = false
        const finished = state
        // Fall back to the resting role ourselves so the figure never holds a
        // wave, then tell the caller — which may set a different state, and
        // that is allowed to win.
        controller.setState(restingState())
        onOneShotEnd?.(finished)
      }
    },

    setReducedMotion(reduced) {
      if (reduced === reducedMotion) return
      reducedMotion = reduced
      if (!mixer) return
      for (const action of actions.values()) action.paused = reduced
      if (!reduced) mixer.update(0)
    },

    dispose() {
      disposed = true
      for (const action of actions.values()) action.stop()
      actions.clear()
      mixer?.stopAllAction()
    },
  }

  // Start in idle rather than in nothing, so the first frame has a pose.
  crossFadeTo('idle', false)
  return controller
}
