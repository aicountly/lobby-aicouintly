/**
 * "Speak to a person".
 *
 * A visitor who asks for a human is, more than anywhere else in this product,
 * relying on being told the truth: they will stand there and wait on the
 * strength of what this panel says. So it says one of exactly three true
 * things, and there is no fourth branch that queues somebody quietly because
 * the alternative reads badly.
 *
 *   in the queue      — with the real number of people ahead of them
 *   somebody is with you
 *   nobody is at the desk — recorded, not queued, and here is what to do instead
 *
 * The count of people ahead comes from the server counting records. Nothing
 * here generates an encouraging number, and nothing here shows a position from
 * a request that was not written down: if recording the request fails, the
 * visitor is told nobody was alerted.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import type { HandoverStatus, LobbyServiceAdapter, ServiceUnavailable } from '../../services/types'
import { isOk } from '../../services/types'
import { UnavailableNotice } from '../Notices'

/** How often the position is re-read while waiting. */
const POLL_MS = 6000

export function HandoverJourney({ adapter }: { adapter: LobbyServiceAdapter }) {
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState<HandoverStatus | null>(null)
  const [blocked, setBlocked] = useState<ServiceUnavailable | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const alive = useRef(true)

  const read = useCallback(async () => {
    const outcome = await adapter.handoverStatus()
    if (!alive.current) return
    if (isOk(outcome)) setStatus(outcome.data)
  }, [adapter])

  // Pick up an existing place in the queue when the panel is reopened, so
  // closing it does not look like having been forgotten.
  useEffect(() => {
    alive.current = true
    void read()

    return () => {
      alive.current = false
    }
  }, [read])

  const waiting =
    status?.state === 'queued' || status?.state === 'assigned' || status?.state === 'accepted'

  useEffect(() => {
    if (!waiting) return

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read()
    }, POLL_MS)

    return () => window.clearInterval(timer)
  }, [waiting, read])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setBlocked(null)

    const outcome = await adapter.requestHandover(name.trim(), reason.trim())
    setSubmitting(false)

    if (!isOk(outcome)) {
      // Nothing was recorded, so nothing is shown as though it had been.
      setBlocked(outcome)
      return
    }

    setStatus(outcome.data)
  }

  async function cancel() {
    const outcome = await adapter.cancelHandover()
    if (isOk(outcome)) setStatus(outcome.data)
    setName('')
    setReason('')
  }

  if (blocked) {
    return (
      <>
        <UnavailableNotice outcome={blocked} />
        <p className="lobby-note">
          Nobody has been alerted. Use <strong>Make an enquiry</strong> and somebody will come back
          to you.
        </p>
      </>
    )
  }

  if (status && status.state && status.state !== 'resolved' && status.state !== 'abandoned') {
    return (
      <div className="lobby-receipt">
        {status.demo && <p className="lobby-badge">Demonstration</p>}

        <p className="lobby-receipt-headline">
          {status.withSomeone
            ? 'Someone is with you'
            : status.state === 'queued'
              ? status.ahead === 0
                ? 'You are next'
                : `${status.ahead} ahead of you`
              : 'Noted, but not queued'}
        </p>

        <p>{status.message}</p>

        {status.state === 'requested' && !status.staffed && (
          <p className="lobby-note">
            Nobody is at the desk at the moment, so no one is on their way. Leaving an enquiry is the
            way to reach somebody.
          </p>
        )}

        {!status.withSomeone && (
          <button type="button" className="lobby-button" onClick={cancel}>
            Never mind
          </button>
        )}
      </div>
    )
  }

  return (
    <form className="lobby-form" onSubmit={submit}>
      <p className="lobby-note">
        {status?.staffed === false
          ? 'Nobody is at the desk right now. You can still leave your details, and they will be waiting when somebody is.'
          : 'Somebody at the desk will pick this up.'}
      </p>

      <label className="lobby-field">
        <span>Your name</span>
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
      </label>

      <label className="lobby-field">
        <span>What is it about?</span>
        <input
          type="text"
          value={reason}
          maxLength={200}
          placeholder="Delivery for accounts"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <button type="submit" className="lobby-button lobby-button--primary" disabled={submitting}>
        {submitting ? 'Asking…' : 'Ask for someone'}
      </button>
    </form>
  )
}
