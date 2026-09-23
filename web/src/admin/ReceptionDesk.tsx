/**
 * The staff reception desk.
 *
 * Read by somebody standing at a front desk with real people waiting, so it is
 * built for that rather than for a dashboard: large type, one obvious action
 * per visitor, and state written as a word rather than carried only by colour.
 *
 * Two rules it is worth being explicit about.
 *
 * **Nothing here is invented.** Every number is a count of records that exist.
 * An empty lobby renders as an empty lobby — there is no sample queue and no
 * illustrative figure anywhere in this file, because somebody would eventually
 * walk over to a chair nobody is sitting in.
 *
 * **A claim is reported from what the server wrote.** Pressing "Take" does not
 * optimistically mark the card as yours. Two people can press it at the same
 * instant, exactly one wins, and the loser is told it is already taken and the
 * list refreshes. Showing it as taken before the server agrees would mean both
 * of them walking over.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, type Permission, type QueueEntry, type QueueResponse } from './adminApi'

/** How often the queue is re-read. Often enough to feel live, rarely enough to be cheap. */
const POLL_MS = 5000

export function ReceptionDesk({ permissions }: { permissions: Permission[] }) {
  const [queue, setQueue] = useState<QueueResponse | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [flash, setFlash] = useState('')

  const canWork = permissions.includes('desk.work')

  // So a slow response cannot overwrite a newer one, and so polling stops when
  // the component goes away rather than logging errors into a closed screen.
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    const result = await adminApi.queue()
    if (!alive.current) return

    if (!result.ok) {
      setProblem(result.message)
      return
    }
    setProblem('')
    setQueue(result.data)
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()

    const timer = window.setInterval(() => {
      // Polling the queue is also this member of staff's heartbeat: it is what
      // tells a visitor that somebody is actually at the desk. Pausing it on a
      // hidden tab is therefore correct rather than an optimisation — a
      // backgrounded tab is not somebody at the desk.
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)

    return () => {
      alive.current = false
      window.clearInterval(timer)
    }
  }, [refresh])

  async function act(id: string, action: 'claim' | 'accept' | 'release' | 'resolve') {
    if (busy) return
    setBusy(id + action)
    setFlash('')

    let outcome: string | undefined
    if (action === 'resolve') {
      const note = window.prompt('How did it end? (optional — a note for the desk, not for the visitor)') ?? ''
      outcome = note.trim() || undefined
    }

    const result = await adminApi.act(id, action, outcome)
    setBusy('')

    if (!result.ok) {
      // A conflict is not an error. Somebody got there first, which is the
      // system working; the list is refreshed so the screen matches the room.
      setFlash(result.message)
      await refresh()
      return
    }

    setFlash(
      action === 'claim'
        ? 'Taken. Confirm when you are with them.'
        : action === 'accept'
          ? 'Marked as with you.'
          : action === 'release'
            ? 'Put back in the queue.'
            : 'Finished.',
    )
    await refresh()
  }

  if (problem && !queue) {
    return (
      <div className="notice notice--warn">
        <p className="notice__title">The desk could not be loaded</p>
        <p>{problem}</p>
      </div>
    )
  }

  if (!queue) return <p className="muted">Loading…</p>

  return (
    <>
      {problem && (
        <div className="notice notice--warn" role="alert">
          <p>{problem} — showing the last state that loaded.</p>
        </div>
      )}

      {flash && (
        <div className="notice notice--info" role="status">
          <p>{flash}</p>
        </div>
      )}

      {!canWork && (
        <div className="notice notice--info">
          <p>You can see the queue but not take visitors. Ask an owner for the agent role.</p>
        </div>
      )}

      <div className="actions" style={{ marginBottom: 16 }}>
        <span>
          Waiting <span className="desk__count">{queue.counts.waiting}</span>
        </span>
        <span>
          With you <span className="desk__count">{queue.counts.mine}</span>
        </span>
        <span>
          With others <span className="desk__count">{queue.counts.withOthers}</span>
        </span>
        <span className="admin__spacer" />
        <span className="muted">Updates every {POLL_MS / 1000} seconds</span>
      </div>

      <div className="desk__columns">
        <section aria-labelledby="desk-waiting">
          <h2 id="desk-waiting" className="card__title" style={{ marginBottom: 10 }}>
            Waiting
          </h2>

          {queue.waiting.length === 0 ? (
            <p className="empty">Nobody is waiting.</p>
          ) : (
            <div className="rows">
              {queue.waiting.map((entry) => (
                <Visitor
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  canWork={canWork}
                  actions={
                    entry.state === 'queued'
                      ? [{ label: 'Take', action: 'claim' as const, primary: true }]
                      : []
                  }
                  onAct={act}
                />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="desk-mine">
          <h2 id="desk-mine" className="card__title" style={{ marginBottom: 10 }}>
            With you
          </h2>

          {queue.mine.length === 0 ? (
            <p className="empty">You are not with anybody.</p>
          ) : (
            <div className="rows">
              {queue.mine.map((entry) => (
                <Visitor
                  key={entry.id}
                  entry={entry}
                  busy={busy}
                  canWork={canWork}
                  actions={
                    entry.state === 'assigned'
                      ? [
                          { label: 'I am with them', action: 'accept' as const, primary: true },
                          { label: 'Put back', action: 'release' as const },
                        ]
                      : [{ label: 'Finished', action: 'resolve' as const, primary: true }]
                  }
                  onAct={act}
                  hint={
                    entry.state === 'assigned'
                      ? `Confirm within ${Math.round(queue.acceptGraceSeconds / 60)} minutes or they go back to the queue.`
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {queue.withOthers.length > 0 && (
        <section aria-labelledby="desk-others" style={{ marginTop: 20 }}>
          <h2 id="desk-others" className="card__title" style={{ marginBottom: 10 }}>
            With a colleague
          </h2>
          <div className="rows">
            {queue.withOthers.map((entry) => (
              <Visitor key={entry.id} entry={entry} busy={busy} canWork={false} actions={[]} onAct={act} />
            ))}
          </div>
        </section>
      )}

      {queue.recentlyClosed.length > 0 && (
        <section aria-labelledby="desk-closed" style={{ marginTop: 20 }}>
          <h2 id="desk-closed" className="card__title" style={{ marginBottom: 10 }}>
            Just finished
          </h2>
          <div className="rows">
            {queue.recentlyClosed.map((entry) => (
              <Visitor key={entry.id} entry={entry} busy={busy} canWork={false} actions={[]} onAct={act} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

const STATE_WORDS: Record<QueueEntry['state'], string> = {
  requested: 'Asked, not queued',
  queued: 'Waiting',
  assigned: 'Taken',
  accepted: 'In conversation',
  resolved: 'Finished',
  abandoned: 'Left',
}

function Visitor({
  entry,
  actions,
  onAct,
  busy,
  canWork,
  hint,
}: {
  entry: QueueEntry
  actions: { label: string; action: 'claim' | 'accept' | 'release' | 'resolve'; primary?: boolean }[]
  onAct: (id: string, action: 'claim' | 'accept' | 'release' | 'resolve') => void
  busy: string
  canWork: boolean
  hint?: string
}) {
  return (
    <article className={`visitor${entry.mine ? ' visitor--mine' : ''}${entry.taken && !entry.mine ? ' visitor--theirs' : ''}`}>
      <div className="actions">
        <h3 className="visitor__name">{entry.name || 'A visitor'}</h3>
        <span className="admin__spacer" />
        <span className="visitor__state">{STATE_WORDS[entry.state]}</span>
      </div>

      {entry.reason && <p className="visitor__reason">{entry.reason}</p>}

      <div className="visitor__meta">
        {entry.requestedAt && <span>Asked {relative(entry.requestedAt)}</span>}
        {entry.state === 'queued' && entry.queuedAt && <span>Waiting {relative(entry.queuedAt)}</span>}
        {entry.outcome && <span>{entry.outcome}</span>}
      </div>

      {hint && <p className="field__note" style={{ margin: 0 }}>{hint}</p>}

      {canWork && actions.length > 0 && (
        <div className="actions">
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              className={`btn${a.primary ? ' btn--primary btn--large' : ''}`}
              disabled={busy !== ''}
              onClick={() => onAct(entry.id, a.action)}
            >
              {busy === entry.id + a.action ? '…' : a.label}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

/** "4 minutes ago", from an ISO timestamp the server sent. */
function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}
