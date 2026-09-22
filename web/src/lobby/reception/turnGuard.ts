/**
 * One conversational turn at a time.
 *
 * A turn spans an adapter call, a speech-synthesis utterance, a microphone
 * capture and a run of scheduled mouth shapes, and any of those can outlive the
 * question that started it. Without a guard, the second question's reply
 * arrives while the first is still being spoken, both write to the same face,
 * and the visitor watches the character answer a question they have already
 * moved on from.
 *
 * So: every turn takes a token, every late result checks it, and starting a new
 * turn cancels the old one and runs its cleanup. **One guard per conversation
 * instance** — a shared guard would let two visitors' conversations cancel each
 * other, and a guard per call would defeat the point.
 */

export interface TurnToken {
  readonly id: number
  /** True once this turn has been cancelled or has settled. */
  readonly closed: boolean
  readonly cancelled: boolean
  /** Passed to fetch and anything else that takes one. */
  readonly signal: AbortSignal
  /** True only while this token is still the guard's current turn. */
  isCurrent(): boolean
  /**
   * Cleanup for this turn: stopping speech, stopping the microphone, clearing a
   * timer. Runs exactly once, whether the turn is cancelled or settles
   * normally, and runs immediately if the turn is already closed.
   */
  onRelease(cleanup: () => void): void
  /** Finish the turn normally. */
  settle(): void
}

export interface TurnGuard {
  /** Start a turn, cancelling whatever was running. */
  begin(): TurnToken
  current(): TurnToken | null
  /** Cancel the running turn, if any. Safe to call when there is none. */
  cancel(reason?: string): void
  /** Cancel and refuse to start any further turns. */
  dispose(): void
  readonly generation: number
}

export function createTurnGuard(): TurnGuard {
  let counter = 0
  let active: InternalToken | null = null
  let disposed = false

  interface InternalToken extends TurnToken {
    close(cancelled: boolean, reason?: string): void
  }

  function makeToken(id: number): InternalToken {
    const controller = new AbortController()
    const cleanups: (() => void)[] = []
    let closed = false
    let cancelled = false

    const token: InternalToken = {
      id,
      get closed() {
        return closed
      },
      get cancelled() {
        return cancelled
      },
      signal: controller.signal,
      isCurrent: () => active === token && !closed,
      onRelease(cleanup) {
        if (closed) {
          runQuietly(cleanup)
          return
        }
        cleanups.push(cleanup)
      },
      settle() {
        token.close(false)
      },
      close(wasCancelled, reason) {
        if (closed) return
        closed = true
        cancelled = wasCancelled
        if (wasCancelled) controller.abort(reason ?? 'superseded')
        // Later cleanups first: they were registered by the deepest step, and
        // unwinding in that order stops a half-finished turn from re-arming
        // something an outer cleanup has already torn down.
        for (let i = cleanups.length - 1; i >= 0; i -= 1) runQuietly(cleanups[i])
        cleanups.length = 0
        if (active === token) active = null
      },
    }
    return token
  }

  return {
    get generation() {
      return counter
    },
    begin() {
      if (disposed) throw new Error('This conversation has been closed.')
      active?.close(true, 'superseded')
      counter += 1
      const token = makeToken(counter)
      active = token
      return token
    },
    current: () => active,
    cancel(reason) {
      active?.close(true, reason ?? 'cancelled')
    },
    dispose() {
      disposed = true
      active?.close(true, 'disposed')
    },
  }
}

/**
 * Cleanup must not be able to stop other cleanup from running.
 *
 * A speech-synthesis cancel that throws is not a reason to leave the microphone
 * open, which is what an unguarded loop would do.
 */
function runQuietly(fn: () => void): void {
  try {
    fn()
  } catch (error) {
    if (import.meta.env?.DEV) console.warn('[lobby] turn cleanup failed', error)
  }
}
