/**
 * The lobby's navigation controller.
 *
 * Owns the camera pose and every input that changes it: pointer drag to look,
 * keys and on-screen buttons to walk, and eased travel to a named destination.
 * The pose lives in plain fields rather than React state because it changes
 * every frame; React only hears about the things the interface actually shows.
 *
 * Two rules from the brief are enforced here rather than in the components,
 * because they are easy to get wrong in one place and impossible to get wrong
 * in all of them:
 *
 *   - Movement keys are read from the scene element, so they only apply when
 *     navigation has focus, and they are ignored outright while the pointer is
 *     in a text field or the service panel is open.
 *   - Every held key is released on blur, on tab-away and on teardown, so
 *     nothing keeps walking while the visitor is somewhere else.
 *
 * Pointer lock is never requested and no microphone is ever opened. Looking
 * around is a drag, which needs no permission and no gesture the visitor did
 * not make.
 */
import type * as THREE from 'three'

import { EYE_HEIGHT, PITCH_LIMIT, WALK_SPEED, waypoint, yawTowards } from '../layout'
import { resolveMove } from './collision'

export type MoveDirection = 'forward' | 'back' | 'left' | 'right' | 'turnLeft' | 'turnRight'

const KEY_BINDINGS: Record<string, MoveDirection> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyQ: 'turnLeft',
  KeyE: 'turnRight',
}

/** Radians of rotation per pixel dragged. */
const LOOK_SENSITIVITY = 0.0034
const TOUCH_LOOK_SENSITIVITY = 0.0042
/** Radians per second when turning with the keyboard or the on-screen buttons. */
const TURN_SPEED = 1.9
/** Pixels of pointer travel after which a drag is a look, not a click. */
const DRAG_THRESHOLD = 6
const TRAVEL_DURATION = 1.15

export interface Pose {
  x: number
  z: number
  yaw: number
  pitch: number
}

interface Travel {
  from: Pose
  to: Pose
  elapsed: number
}

export interface NavigationSnapshot {
  /** Destination currently being travelled to, if any. */
  travellingTo: string | null
  /** True while the visitor is walking under their own steam. */
  walking: boolean
  /** True once the scene element has had focus, so the key hint can retire. */
  hasFocus: boolean
}

type Listener = (snapshot: NavigationSnapshot) => void

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * True when the element being typed into should own the keyboard.
 *
 * `data-lobby-form` lets any panel opt its whole subtree out of navigation,
 * which covers radio groups and custom controls that are not <input>.
 */
function isTypingTarget(element: Element | null): boolean {
  if (!element) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (element instanceof HTMLElement && element.isContentEditable) return true
  return Boolean(element.closest('[data-lobby-form]'))
}

export class NavigationController {
  private pose: Pose

  private readonly home: Pose

  private readonly keys = new Set<MoveDirection>()

  private readonly buttons = new Set<MoveDirection>()

  private travel: Travel | null = null

  /** Destination id while a travel animation is running. */
  private travelId: string | null = null

  private suspended = false

  private reducedMotion = false

  private hasFocus = false

  private dragPointerId: number | null = null

  private dragLast = { x: 0, y: 0 }

  private dragDistance = 0

  private dragWasLook = false

  private bobPhase = 0

  private bobHeight = 0

  private element: HTMLElement | null = null

  private readonly listeners = new Set<Listener>()

  private lastSnapshot: NavigationSnapshot = {
    travellingTo: null,
    walking: false,
    hasFocus: false,
  }

  constructor() {
    const start = waypoint('entrance')
    this.home = {
      x: start.x,
      z: start.z,
      yaw: yawTowards(start.x, start.z, start.lookAtX, start.lookAtZ),
      pitch: 0,
    }
    this.pose = { ...this.home }
  }

  // -- lifecycle ------------------------------------------------------------

  /** Wire the controller to the scene element. Returns the teardown. */
  attach(element: HTMLElement): () => void {
    this.element = element

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('keydown', this.onKeyDown)
    element.addEventListener('focusin', this.onFocusIn)
    element.addEventListener('focusout', this.onFocusOut)

    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    // Key releases are watched on the window as well as the element: if focus
    // moves while a key is held, the element never sees the keyup.
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.releaseAll)
    document.addEventListener('visibilitychange', this.onVisibilityChange)

    return () => {
      element.removeEventListener('pointerdown', this.onPointerDown)
      element.removeEventListener('keydown', this.onKeyDown)
      element.removeEventListener('focusin', this.onFocusIn)
      element.removeEventListener('focusout', this.onFocusOut)

      window.removeEventListener('pointermove', this.onPointerMove)
      window.removeEventListener('pointerup', this.onPointerUp)
      window.removeEventListener('pointercancel', this.onPointerUp)
      window.removeEventListener('keyup', this.onKeyUp)
      window.removeEventListener('blur', this.releaseAll)
      document.removeEventListener('visibilitychange', this.onVisibilityChange)

      // Leaving the scene must not leave a key held down.
      this.releaseAll()
      this.travel = null
      this.dragPointerId = null
      this.element = null
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.lastSnapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // -- external control -----------------------------------------------------

  /** Suspend movement — used while the service panel is open. */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return
    this.suspended = suspended
    if (suspended) this.releaseAll()
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced
    if (reduced && this.travel) {
      this.pose = { ...this.travel.to }
      this.travel = null
      this.emit()
    }
  }

  /** Held by the on-screen movement pad. */
  setButton(direction: MoveDirection, pressed: boolean): void {
    if (pressed) {
      if (this.suspended) return
      this.buttons.add(direction)
      this.travel = null
    } else {
      this.buttons.delete(direction)
    }
    this.emit()
  }

  /** Walk to a named destination, easing unless reduced motion is asked for. */
  travelTo(id: string): void {
    const target = waypoint(id)
    const to: Pose = {
      x: target.x,
      z: target.z,
      yaw: yawTowards(target.x, target.z, target.lookAtX, target.lookAtZ),
      pitch: 0,
    }

    this.releaseAll()

    if (this.reducedMotion) {
      this.pose = to
      this.travel = null
      this.travelId = null
      this.emit()
      return
    }

    this.travelId = id
    this.travel = { from: { ...this.pose }, to, elapsed: 0 }
    this.emit()
  }

  /** Level the view without moving. */
  resetLook(): void {
    this.pose.pitch = 0
    this.emit()
  }

  /** True when the last pointer gesture was a look, so a click should not fire. */
  consumedByDrag(): boolean {
    return this.dragWasLook
  }

  getPose(): Pose {
    return { ...this.pose }
  }

  // -- per-frame ------------------------------------------------------------

  update(delta: number, camera: THREE.Camera): void {
    // Two different clocks, because they are guarding against two different
    // things.
    //
    // Walking is a physics step and is capped hard: a tab returning from the
    // background hands back a delta measured in seconds, and stepping that in
    // one go would carry the visitor straight through a wall. At 2.6 m/s the
    // cap is a 26cm step, comfortably less than the thinnest obstacle.
    //
    // Travelling to a destination is an animation, and capping it would mean
    // the journey takes longer than 1.15 seconds on any device rendering below
    // 20fps — the devices least able to afford a long one. It gets a much
    // looser cap, which only matters after a tab has been away, and there
    // arriving immediately is the right answer anyway.
    const walkDelta = Math.min(delta, 0.1)
    const animationDelta = Math.min(delta, 0.5)

    if (this.travel) {
      this.advanceTravel(animationDelta)
    } else if (!this.suspended) {
      this.advanceWalk(walkDelta)
    } else {
      this.bobHeight += (0 - this.bobHeight) * Math.min(1, walkDelta * 8)
    }

    camera.position.set(this.pose.x, EYE_HEIGHT + this.bobHeight, this.pose.z)
    camera.rotation.set(this.pose.pitch, this.pose.yaw, 0, 'YXZ')
  }

  private advanceTravel(dt: number): void {
    const travel = this.travel
    if (!travel) return

    travel.elapsed += dt
    const t = Math.min(1, travel.elapsed / TRAVEL_DURATION)
    const eased = easeInOutCubic(t)

    this.pose.x = travel.from.x + (travel.to.x - travel.from.x) * eased
    this.pose.z = travel.from.z + (travel.to.z - travel.from.z) * eased
    this.pose.yaw = travel.from.yaw + shortestAngle(travel.from.yaw, travel.to.yaw) * eased
    this.pose.pitch = travel.from.pitch + (travel.to.pitch - travel.from.pitch) * eased

    this.bobHeight += (0 - this.bobHeight) * Math.min(1, dt * 8)

    if (t >= 1) {
      this.pose = { ...travel.to }
      this.travel = null
      this.travelId = null
      this.emit()
    }
  }

  private advanceWalk(dt: number): void {
    const active = this.activeDirections()

    if (active.has('turnLeft')) this.pose.yaw += TURN_SPEED * dt
    if (active.has('turnRight')) this.pose.yaw -= TURN_SPEED * dt

    let forward = 0
    let strafe = 0
    if (active.has('forward')) forward += 1
    if (active.has('back')) forward -= 1
    if (active.has('right')) strafe += 1
    if (active.has('left')) strafe -= 1

    if (forward === 0 && strafe === 0) {
      // Settle the head back to eye height rather than stopping mid-bob.
      this.bobHeight += (0 - this.bobHeight) * Math.min(1, dt * 8)
      return
    }

    const length = Math.hypot(forward, strafe)
    forward /= length
    strafe /= length

    const sinYaw = Math.sin(this.pose.yaw)
    const cosYaw = Math.cos(this.pose.yaw)
    // Forward at yaw 0 is −Z; right is +X.
    const dx = (-sinYaw * forward + cosYaw * strafe) * WALK_SPEED * dt
    const dz = (-cosYaw * forward - sinYaw * strafe) * WALK_SPEED * dt

    const next = resolveMove(
      { x: this.pose.x, z: this.pose.z },
      { x: this.pose.x + dx, z: this.pose.z + dz },
    )

    const travelled = Math.hypot(next.x - this.pose.x, next.z - this.pose.z)
    this.pose.x = next.x
    this.pose.z = next.z

    if (this.reducedMotion) {
      this.bobHeight = 0
      return
    }

    this.bobPhase += travelled * 4.6
    const target = Math.sin(this.bobPhase) * 0.022
    this.bobHeight += (target - this.bobHeight) * Math.min(1, dt * 12)
  }

  private activeDirections(): Set<MoveDirection> {
    if (this.keys.size === 0) return this.buttons
    if (this.buttons.size === 0) return this.keys
    return new Set([...this.keys, ...this.buttons])
  }

  // -- input handlers -------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.dragPointerId !== null) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    // A press on a HUD button or a link is not a look gesture.
    if ((event.target as Element | null)?.closest('[data-lobby-ui]')) return

    this.dragPointerId = event.pointerId
    this.dragLast = { x: event.clientX, y: event.clientY }
    this.dragDistance = 0
    this.dragWasLook = false

    // Give navigation the keyboard, without stealing focus on page load.
    this.element?.focus({ preventScroll: true })

    try {
      this.element?.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a convenience; the window listeners cover the gesture anyway.
    }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return

    const dx = event.clientX - this.dragLast.x
    const dy = event.clientY - this.dragLast.y
    this.dragLast = { x: event.clientX, y: event.clientY }
    this.dragDistance += Math.hypot(dx, dy)

    if (this.dragDistance < DRAG_THRESHOLD) return
    this.dragWasLook = true
    this.travel = null
    this.travelId = null

    const sensitivity = event.pointerType === 'touch' ? TOUCH_LOOK_SENSITIVITY : LOOK_SENSITIVITY
    // Grab-the-room, the convention every 360 viewer uses: drag right and the
    // room follows the pointer, which turns the visitor left.
    this.pose.yaw += dx * sensitivity
    this.pose.pitch = Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, this.pose.pitch + dy * sensitivity),
    )
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return
    this.dragPointerId = null
    try {
      this.element?.releasePointerCapture(event.pointerId)
    } catch {
      // Already released, or never captured.
    }
    // Cleared on the next frame so the click that follows this pointerup can
    // still see that the gesture was a drag.
    if (this.dragWasLook) {
      window.setTimeout(() => {
        this.dragWasLook = false
      }, 0)
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.suspended) return
    if (isTypingTarget(event.target as Element | null)) return
    if (event.metaKey || event.ctrlKey || event.altKey) return

    const direction = KEY_BINDINGS[event.code]
    if (!direction) return

    // Only once the key is ours: otherwise arrows would stop scrolling the page.
    event.preventDefault()
    this.keys.add(direction)
    this.travel = null
    this.travelId = null
    this.emit()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const direction = KEY_BINDINGS[event.code]
    if (!direction) return
    this.keys.delete(direction)
    this.emit()
  }

  private readonly onFocusIn = (): void => {
    this.hasFocus = true
    this.emit()
  }

  private readonly onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null
    if (next && this.element?.contains(next)) return
    this.hasFocus = false
    this.releaseAll()
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.releaseAll()
  }

  /** Let go of everything currently held. */
  private readonly releaseAll = (): void => {
    if (this.keys.size === 0 && this.buttons.size === 0) {
      this.emit()
      return
    }
    this.keys.clear()
    this.buttons.clear()
    this.emit()
  }

  // -- notification ---------------------------------------------------------

  private emit(): void {
    const snapshot: NavigationSnapshot = {
      travellingTo: this.travelId,
      walking: this.keys.size > 0 || this.buttons.size > 0,
      hasFocus: this.hasFocus,
    }

    const previous = this.lastSnapshot
    if (
      previous.travellingTo === snapshot.travellingTo &&
      previous.walking === snapshot.walking &&
      previous.hasFocus === snapshot.hasFocus
    ) {
      return
    }

    this.lastSnapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}
