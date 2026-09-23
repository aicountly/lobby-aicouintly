/**
 * The staff and administration shell.
 *
 * One fetch decides everything: `GET /api/desk/session` says who the caller is
 * and what their role allows, and the screens are chosen from that. The
 * permissions it returns are used to decide what to *show*; every route
 * re-checks on the server, so hiding a tab is a courtesy and the refusal is
 * the security.
 *
 * Three states that look similar and are not, kept apart because they need
 * three different actions from the person reading:
 *
 *   not signed in   — sign in; the portal round-trip has not happened
 *   signed in, no role at this business — ask an owner to add you
 *   signed in with a role — the desk
 *
 * Collapsing the middle one into "access denied" sends somebody to re-enter a
 * password that was never the problem.
 */
import { useCallback, useEffect, useState } from 'react'
import { adminApi, type Permission, type Role, type StaffIdentity, type StaffMember } from './adminApi'
import { BusinessSetup } from './BusinessSetup'
import { ReceptionDesk } from './ReceptionDesk'
import { APP_NAME } from '../config'
import './admin.css'

export type AdminScreen = 'desk' | 'setup' | 'staff' | 'diagnostics'

const SCREEN_PERMISSION: Record<AdminScreen, Permission> = {
  desk: 'desk.view',
  setup: 'config.view',
  staff: 'staff.manage',
  diagnostics: 'config.view',
}

const SCREEN_LABEL: Record<AdminScreen, string> = {
  desk: 'Reception desk',
  setup: 'Business setup',
  staff: 'Who has access',
  diagnostics: 'Diagnostics',
}

export function AdminShell({
  initialScreen,
  onLeave,
}: {
  initialScreen: AdminScreen
  onLeave: () => void
}) {
  const [identity, setIdentity] = useState<StaffIdentity | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'no-access' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [screen, setScreen] = useState<AdminScreen>(initialScreen)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await adminApi.session()
      if (cancelled) return

      if (!result.ok) {
        setMessage(result.message)
        setState(result.kind === 'unauthenticated' ? 'signed-out' : 'error')
        return
      }

      setIdentity(result.data.staff)
      setState(result.data.hasAccess ? 'ready' : 'no-access')
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <main className="admin">
        <div className="admin__main">
          <p className="muted">Loading…</p>
        </div>
      </main>
    )
  }

  if (state === 'signed-out') {
    return (
      <Frame onLeave={onLeave}>
        <div className="notice notice--info">
          <p className="notice__title">Sign in to continue</p>
          <p>{message}</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={onLeave}>
          Go to sign in
        </button>
      </Frame>
    )
  }

  if (state === 'error') {
    return (
      <Frame onLeave={onLeave}>
        <div className="notice notice--warn">
          <p className="notice__title">This could not be loaded</p>
          <p>{message}</p>
        </div>
      </Frame>
    )
  }

  if (state === 'no-access' || !identity) {
    return (
      <Frame onLeave={onLeave}>
        <div className="notice notice--info">
          <p className="notice__title">You are signed in, but not on the staff list here</p>
          <p>
            An owner of this business can add you under <strong>Who has access</strong>. Your portal
            id is <code>{identity?.uuid}</code> — that is what they will need.
          </p>
        </div>
      </Frame>
    )
  }

  const available = (Object.keys(SCREEN_LABEL) as AdminScreen[]).filter((s) =>
    identity.permissions.includes(SCREEN_PERMISSION[s]),
  )

  // A deep link to something this role cannot open lands on the first thing it
  // can, rather than on an empty screen or a refusal.
  const current = available.includes(screen) ? screen : (available[0] ?? 'desk')

  return (
    <Frame onLeave={onLeave} role={identity.role} tenant={identity.tenant}>
      <nav className="admin__nav" aria-label="Sections" style={{ marginBottom: 18 }}>
        {available.map((s) => (
          <button
            key={s}
            type="button"
            className="admin__tab"
            aria-current={current === s ? 'page' : undefined}
            onClick={() => setScreen(s)}
          >
            {SCREEN_LABEL[s]}
          </button>
        ))}
      </nav>

      {current === 'desk' && <ReceptionDesk permissions={identity.permissions} />}
      {current === 'setup' && <BusinessSetup permissions={identity.permissions} />}
      {current === 'staff' && <StaffList you={identity.uuid} />}
      {current === 'diagnostics' && <Diagnostics />}
    </Frame>
  )
}

function Frame({
  children,
  onLeave,
  role,
  tenant,
}: {
  children: React.ReactNode
  onLeave: () => void
  role?: Role
  tenant?: string
}) {
  return (
    <main className="admin">
      <header className="admin__bar">
        <h1 className="admin__title">{APP_NAME} — reception</h1>
        {tenant && <span className="muted">{tenant}</span>}
        <span className="admin__spacer" />
        {role && <span className="visitor__state">{role}</span>}
        <button type="button" className="btn btn--small" onClick={onLeave}>
          Back to the lobby
        </button>
      </header>
      <div className="admin__main">{children}</div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Who has access
// ---------------------------------------------------------------------------

/**
 * The staff list.
 *
 * People are identified by their portal id, because that is the identifier
 * this product actually has: Lobby holds no employee master and must not
 * acquire one. Names and email addresses belong to the portal and to Contacts.
 */
function StaffList({ you }: { you: string }) {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [revision, setRevision] = useState(0)
  const [roles, setRoles] = useState<Role[]>([])
  const [message, setMessage] = useState('')
  const [adding, setAdding] = useState({ uuid: '', role: 'agent' as Role })

  const load = useCallback(async () => {
    const result = await adminApi.staff()
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setMembers(result.data.members)
    setRevision(result.data.revision)
    setRoles(result.data.roles)
    setMessage('')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: StaffMember[]) {
    const result = await adminApi.saveStaff(
      // Server-configured owners are not the tenant's to store. They are
      // filtered on the server too; sending them would just be noise.
      next.filter((m) => m.source !== 'server-config').map((m) => ({ uuid: m.uuid, role: m.role })),
      revision,
    )

    if (!result.ok) {
      setMessage(result.message)
      await load()
      return
    }

    setMembers(result.data.members)
    setRevision(result.data.revision)
    setMessage('Saved.')
  }

  return (
    <>
      {message && (
        <div className="notice notice--info" role="status">
          <p>{message}</p>
        </div>
      )}

      <div className="card">
        <h2 className="card__title">Who has access</h2>
        <p className="card__hint">
          <strong>Owner</strong> runs the account and decides who else has access.{' '}
          <strong>Manager</strong> configures and publishes what reception says, and works the desk.{' '}
          <strong>Agent</strong> works the desk only — they cannot change what the receptionist says
          to the public.
        </p>

        <div className="rows">
          {members.map((member) => (
            <div className="row" key={member.uuid}>
              <div className="actions">
                <code>{member.uuid}</code>
                {member.uuid === you && <span className="visitor__state">you</span>}
                <span className="admin__spacer" />

                {member.source === 'server-config' ? (
                  <span className="muted">Owner, set on the server</span>
                ) : (
                  <>
                    <label className="visually-hidden" htmlFor={`role-${member.uuid}`}>
                      Role for {member.uuid}
                    </label>
                    <select
                      id={`role-${member.uuid}`}
                      value={member.role}
                      onChange={(e) =>
                        void save(
                          members.map((m) => (m.uuid === member.uuid ? { ...m, role: e.target.value as Role } : m)),
                        )
                      }
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={() => void save(members.filter((m) => m.uuid !== member.uuid))}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Add somebody</h2>
        <p className="card__hint">
          They need an Aicountly account already. Their portal id is shown to them on this screen
          when they sign in without access.
        </p>

        <div className="row__grid row__grid--two">
          <label className="field">
            <span className="field__label">Portal id</span>
            <input type="text" value={adding.uuid} onChange={(e) => setAdding({ ...adding, uuid: e.target.value.trim() })} />
          </label>
          <label className="field">
            <span className="field__label">Role</span>
            <select value={adding.role} onChange={(e) => setAdding({ ...adding, role: e.target.value as Role })}>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          className="btn btn--primary"
          disabled={!adding.uuid}
          onClick={() => {
            void save([...members, { uuid: adding.uuid, role: adding.role, source: 'tenant' }])
            setAdding({ uuid: '', role: 'agent' })
          }}
        >
          Add
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * What is configured on this deployment, for whoever has to fix it.
 *
 * The distinction this screen exists to make is between **configured** and
 * **working**. A key being present proves somebody typed something; it does not
 * prove the other end answers. Where the server can tell the difference it
 * says so, and where it cannot, this says that too rather than showing a tick.
 *
 * It prints no secret. The server never sends one.
 */
function Diagnostics() {
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void (async () => {
      const result = await adminApi.diagnostics()
      if (result.ok) setReport(result.data)
      else setMessage(result.message)
    })()
  }, [])

  if (message) {
    return (
      <div className="notice notice--warn">
        <p>{message}</p>
      </div>
    )
  }

  if (!report) return <p className="muted">Loading…</p>

  const credentials = report.credentials as { console?: Record<string, unknown> } | undefined
  const console_ = credentials?.console
  const storage = report.storage as Record<string, unknown> | undefined

  return (
    <>
      <div className="notice notice--info">
        <p>
          <strong>Configured</strong> means a setting is present. <strong>Answering</strong> means
          this server has had a real reply. Only the second one means reception works.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Reception AI</h2>
        <Row label="Can answer a visitor" value={(report.mode as string) === 'live' ? 'yes' : 'no'} />
        <Row label="Model" value={String(report.model ?? '—')} />
        <Row label="Credential source" value={String((report.credentials as Record<string, unknown>)?.source ?? '—')} />
        <Row label="Console configured" value={console_?.configured ? 'yes' : 'no'} />
        <Row
          label="Console answering with a binding"
          value={console_?.available ? `yes — ${String(console_?.provider ?? '')}` : 'no'}
        />
        {typeof console_?.hint === 'string' && console_.hint && (
          <p className="field__note">{console_.hint}</p>
        )}
        <Row label="Console domain" value={String(console_?.domain ?? '—')} />
      </div>

      <div className="card">
        <h2 className="card__title">Storage</h2>
        <Row label="Configuration can be saved" value={storage?.writable ? 'yes' : 'no'} />
        <Row label="Location" value={String(storage?.location ?? '—')} />
        {!storage?.writable && <p className="field__error">{String(storage?.reason ?? '')}</p>}
        {Boolean(storage?.webReachable) && <p className="field__error">{String(storage?.warning ?? '')}</p>}
        {Boolean(storage?.legacyFile) && (
          <p className="field__note">
            A Phase 2C knowledge file is still at <code>{String(storage?.legacyFile)}</code>. It is
            imported once and then left alone — keep it as a rollback.
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Voice</h2>
        <Row label="Server speech" value={(report.speech as Record<string, unknown>)?.configured ? 'configured' : 'not configured — the browser voice is used'} />
        <Row label="Server transcription" value={(report.transcription as Record<string, unknown>)?.configured ? 'configured' : 'not configured — the browser recogniser is used'} />
      </div>

      <div className="card">
        <h2 className="card__title">This tenant</h2>
        <Row label="Tenant" value={String(report.tenant ?? '—')} />
        <Row
          label="Approved knowledge"
          value={
            (report.knowledge as Record<string, unknown>)?.configured
              ? ((report.knowledge as { sections?: string[] }).sections ?? []).join(', ')
              : 'nothing published'
          }
        />
        <Row label="Where it came from" value={String((report.knowledge as Record<string, unknown>)?.source ?? '—')} />
        <Row
          label="Visitor journeys"
          value={Object.entries((report.journeys as Record<string, boolean>) ?? {})
            .map(([k, v]) => `${k}: ${v ? 'on' : 'off'}`)
            .join(', ')}
        />
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="actions" style={{ borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
      <span>{label}</span>
      <span className="admin__spacer" />
      <strong>{value}</strong>
    </div>
  )
}
