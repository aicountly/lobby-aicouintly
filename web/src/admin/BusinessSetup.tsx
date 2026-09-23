/**
 * Business setup: what the receptionist is allowed to say, and when it goes live.
 *
 * The screen is shaped around one idea that is easy to get wrong. Typing here
 * changes nothing for anybody standing in the lobby. The draft is saved as you
 * work; publishing is a separate, deliberate act with its own permission, and
 * until somebody takes it the public keeps hearing the version that was last
 * approved. Every part of this interface is built to make that obvious rather
 * than to be discovered.
 *
 * Nothing owned elsewhere is edited here. There is no company master, no
 * branch master, no contact, no appointment and no invoice — Manage, Contacts,
 * Appointments and Billing own those, and what this screen stores is the
 * reference used to ask them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  adminApi,
  type AdminResult,
  type BusinessConfig,
  type ConfigResponse,
  type FaqRow,
  type FieldError,
  type HoursRow,
  type LocationRow,
  type Permission,
  type ServiceRow,
} from './adminApi'

type Section = 'business' | 'knowledge' | 'receptionist' | 'services' | 'publish'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'knowledge', label: 'What it may say' },
  { id: 'receptionist', label: 'Receptionist' },
  { id: 'services', label: 'Visitor services' },
  { id: 'publish', label: 'Review & publish' },
]

/** Blank rows, so "add" produces something the schema recognises. */
const BLANK: { hours: HoursRow; locations: LocationRow; services: ServiceRow; faqs: FaqRow } = {
  hours: { days: '', opens: '', closes: '', note: '' },
  locations: { label: '', address: '', notes: '' },
  services: { name: '', description: '', fee: '', appointmentTypeId: '' },
  faqs: { question: '', answer: '' },
}

export function BusinessSetup({ permissions }: { permissions: Permission[] }) {
  const [loaded, setLoaded] = useState<ConfigResponse | null>(null)
  const [draft, setDraft] = useState<BusinessConfig | null>(null)
  const [revision, setRevision] = useState(0)
  const [section, setSection] = useState<Section>('business')
  const [errors, setErrors] = useState<FieldError[]>([])
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'problem'; message: string }>({
    kind: 'idle',
    message: '',
  })

  const canEdit = permissions.includes('config.edit')
  const canPublish = permissions.includes('config.publish')

  // What was loaded, so "is there anything unsaved" is a comparison rather
  // than a flag somebody has to remember to set on every edit.
  const baseline = useRef<string>('')

  const load = useCallback(async () => {
    const result = await adminApi.config()
    if (!result.ok) {
      setStatus({ kind: 'problem', message: result.message })
      return
    }
    setLoaded(result.data)
    setDraft(result.data.draft.data)
    setRevision(result.data.draft.revision)
    baseline.current = JSON.stringify(result.data.draft.data)
    setErrors([])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(
    () => (draft ? JSON.stringify(draft) !== baseline.current : false),
    [draft],
  )

  /**
   * Warn before leaving with unsaved work.
   *
   * Saving is explicit rather than automatic, because a draft that saved on
   * every keystroke would make the revision check fire constantly for two
   * people editing the same page — and the point of that check is to be
   * meaningful when it does.
   */
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /**
   * Render a failure, and narrow the result for the caller when it is not one.
   *
   * A type predicate rather than a plain boolean so that `if (!report(r)) return`
   * leaves `r.data` reachable afterwards — the alternative is every caller
   * re-checking `r.ok` immediately after asking whether it failed.
   */
  function report<T>(result: AdminResult<T>): result is { ok: true; data: T } {
    if (result.ok) return true
    if (result.kind === 'invalid') {
      setErrors(result.errors)
      setStatus({ kind: 'problem', message: result.message })
      // Jump to the first section that has a problem, so an error about
      // opening hours is not reported on a screen showing the FAQ.
      const first = result.errors[0]?.field ?? ''
      const target = sectionForField(first)
      if (target) setSection(target)
      return false
    }
    setStatus({ kind: 'problem', message: result.message })
    return false
  }

  async function save() {
    if (!draft) return
    setStatus({ kind: 'saving', message: '' })
    const result = await adminApi.saveDraft(draft, revision)
    if (!report(result)) return

    setRevision(result.data.revision)
    baseline.current = JSON.stringify(draft)
    setErrors([])
    setStatus({ kind: 'saved', message: 'Draft saved. Nothing has changed for visitors yet.' })
    setLoaded((prev) => (prev ? { ...prev, hasUnpublishedChanges: result.data.hasUnpublishedChanges } : prev))
  }

  async function publish() {
    if (dirty) {
      setStatus({ kind: 'problem', message: 'Save the draft before publishing it.' })
      return
    }
    setStatus({ kind: 'saving', message: '' })
    const result = await adminApi.publish(revision)
    if (!report(result)) return

    setStatus({ kind: 'saved', message: 'Published. Visitors now hear this version.' })
    await load()
  }

  async function discard() {
    if (!window.confirm('Throw away the draft and go back to what is published?')) return
    const result = await adminApi.discardDraft()
    if (!report(result)) return
    await load()
    setStatus({ kind: 'saved', message: 'Draft discarded.' })
  }

  if (status.kind === 'problem' && !loaded) {
    return (
      <div className="notice notice--warn">
        <p className="notice__title">This could not be loaded</p>
        <p>{status.message}</p>
      </div>
    )
  }

  if (!loaded || !draft) return <p className="muted">Loading…</p>

  const set = <K extends keyof BusinessConfig>(key: K, value: BusinessConfig[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message ?? ''

  return (
    <>
      {!loaded.storage.writable && (
        <div className="notice notice--warn">
          <p className="notice__title">Nothing can be saved yet</p>
          <p>{loaded.storage.reason}</p>
        </div>
      )}

      {loaded.storage.webReachable && (
        <div className="notice notice--warn">
          <p className="notice__title">The data directory is reachable over the web</p>
          <p>
            Move it outside the document root. Its contents are served as static files, and the next
            deploy rsyncs that path with <code>--delete</code>.
          </p>
        </div>
      )}

      {loaded.published.source === 'legacy-file' && (
        <div className="notice notice--info">
          <p className="notice__title">Reading the old knowledge file</p>
          <p>
            Reception is answering from <code>{loaded.storage.legacyFile}</code> because there is
            nowhere to save a published copy. Edits here cannot be kept until that is fixed.
          </p>
        </div>
      )}

      {loaded.published.source === 'migrated' && (
        <div className="notice notice--good">
          <p className="notice__title">Your existing reception information was imported</p>
          <p>
            It came from <code>{loaded.storage.legacyFile}</code>, which has been left exactly where
            it is. Check it over below, then publish.
          </p>
        </div>
      )}

      {!canEdit && (
        <div className="notice notice--info">
          <p>You can read this configuration but not change it. Ask an owner for the manager role.</p>
        </div>
      )}

      <nav className="admin__nav" aria-label="Setup sections" style={{ marginBottom: 18 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="admin__tab"
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            {s.label}
            {sectionHasError(errors, s.id) && <span aria-label=" — has a problem"> ⚠</span>}
          </button>
        ))}
      </nav>

      <fieldset disabled={!canEdit} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        {section === 'business' && (
          <BusinessSection config={draft} set={set} errorFor={errorFor} />
        )}
        {section === 'knowledge' && (
          <KnowledgeSection config={draft} set={set} errorFor={errorFor} />
        )}
        {section === 'receptionist' && (
          <ReceptionistSection config={draft} set={set} errorFor={errorFor} tones={loaded.tones} voiceModes={loaded.voiceModes} />
        )}
        {section === 'services' && (
          <ServicesSection config={draft} set={set} errorFor={errorFor} />
        )}
        {section === 'publish' && (
          <PublishSection
            draft={draft}
            published={loaded.published.data}
            publishedAt={loaded.published.updatedAt}
            hasUnpublished={loaded.hasUnpublishedChanges || dirty}
          />
        )}
      </fieldset>

      <div className="card" style={{ position: 'sticky', bottom: 0, marginTop: 20 }}>
        <div className="actions">
          <button type="button" className="btn" onClick={save} disabled={!canEdit || !dirty || status.kind === 'saving'}>
            {status.kind === 'saving' ? 'Saving…' : 'Save draft'}
          </button>

          <button
            type="button"
            className="btn btn--primary"
            onClick={publish}
            disabled={!canPublish || dirty || !loaded.hasUnpublishedChanges}
            title={
              !canPublish
                ? 'Your role does not allow publishing.'
                : dirty
                  ? 'Save the draft first.'
                  : !loaded.hasUnpublishedChanges
                    ? 'There is nothing unpublished.'
                    : undefined
            }
          >
            Publish
          </button>

          {loaded.draft.revision > 0 && (
            <button type="button" className="btn btn--quiet btn--small" onClick={discard} disabled={!canEdit}>
              Discard draft
            </button>
          )}

          <span className="admin__spacer" />

          <span className="muted" role="status">
            {dirty
              ? 'Unsaved changes'
              : loaded.hasUnpublishedChanges
                ? 'Saved, not yet published'
                : status.message || 'Up to date'}
          </span>
        </div>

        {status.kind === 'problem' && (
          <p className="field__error" style={{ marginTop: 10 }} role="alert">
            {status.message}
          </p>
        )}
      </div>
    </>
  )
}

/** Which tab a field error belongs to, so the interface can point at it. */
function sectionForField(field: string): Section | null {
  if (field.startsWith('business') || field.startsWith('hours') || field.startsWith('locations') || field.startsWith('contact')) {
    return 'business'
  }
  if (field.startsWith('services') || field.startsWith('faqs')) return 'knowledge'
  if (field.startsWith('receptionist')) return 'receptionist'
  if (field.startsWith('handover') || field.startsWith('booking') || field.startsWith('visitorServices')) return 'services'
  return null
}

function sectionHasError(errors: FieldError[], section: Section): boolean {
  return errors.some((e) => sectionForField(e.field) === section)
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Field({
  label,
  note,
  error,
  children,
}: {
  label: string
  note?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className={`field${error ? ' field--invalid' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {note && <span className="field__note">{note}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  )
}

function Rows<T>({
  items,
  blank,
  onChange,
  render,
  addLabel,
  empty,
}: {
  items: T[]
  blank: T
  onChange: (next: T[]) => void
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode
  addLabel: string
  empty: string
}) {
  return (
    <>
      {items.length === 0 && <p className="muted" style={{ marginTop: 0 }}>{empty}</p>}
      <div className="rows">
        {items.map((item, index) => (
          <div className="row" key={index}>
            {render(item, (patch) => onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row))), index)}
            <div className="row__actions">
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--small" style={{ marginTop: 10 }} onClick={() => onChange([...items, { ...blank }])}>
        {addLabel}
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface SectionProps {
  config: BusinessConfig
  set: <K extends keyof BusinessConfig>(key: K, value: BusinessConfig[K]) => void
  errorFor: (field: string) => string
}

function BusinessSection({ config, set, errorFor }: SectionProps) {
  return (
    <>
      <div className="card">
        <h2 className="card__title">The business</h2>
        <p className="card__hint">
          How reception refers to you. The name is used in every reply, so write it the way you would
          say it out loud.
        </p>

        <Field label="Name" error={errorFor('business.name')}>
          <input
            type="text"
            value={config.business.name}
            onChange={(e) => set('business', { ...config.business, name: e.target.value })}
          />
        </Field>

        <Field label="Tagline" note="Optional. One short line." error={errorFor('business.tagline')}>
          <input
            type="text"
            value={config.business.tagline}
            onChange={(e) => set('business', { ...config.business, tagline: e.target.value })}
          />
        </Field>

        <Field
          label="What you do"
          note="One or two sentences a receptionist would actually say."
          error={errorFor('business.description')}
        >
          <textarea
            value={config.business.description}
            onChange={(e) => set('business', { ...config.business, description: e.target.value })}
          />
        </Field>
      </div>

      <div className="card">
        <h2 className="card__title">Opening hours</h2>
        <p className="card__hint">
          Reception states these exactly and will not extrapolate to a day that is not listed. Leave a
          day out and it says it does not know rather than guessing.
        </p>

        <Rows
          items={config.hours}
          blank={BLANK.hours}
          onChange={(next) => set('hours', next)}
          addLabel="Add hours"
          empty="No hours set, so reception will say it does not know them."
          render={(row, update, index) => (
            <div className="row__grid row__grid--hours">
              <Field label="Days" error={errorFor(`hours.${index}.days`)}>
                <input type="text" value={row.days} placeholder="Monday to Friday" onChange={(e) => update({ days: e.target.value })} />
              </Field>
              <Field label="Opens">
                <input type="text" value={row.opens} placeholder="09:00" onChange={(e) => update({ opens: e.target.value })} />
              </Field>
              <Field label="Closes">
                <input type="text" value={row.closes} placeholder="17:30" onChange={(e) => update({ closes: e.target.value })} />
              </Field>
              <Field label="Note">
                <input type="text" value={row.note} placeholder="Closed for lunch 13:00–14:00" onChange={(e) => update({ note: e.target.value })} />
              </Field>
            </div>
          )}
        />
      </div>

      <div className="card">
        <h2 className="card__title">Locations</h2>
        <p className="card__hint">Addresses as reception should read them out.</p>

        <Rows
          items={config.locations}
          blank={BLANK.locations}
          onChange={(next) => set('locations', next)}
          addLabel="Add a location"
          empty="No locations set."
          render={(row, update, index) => (
            <>
              <Field label="Label" error={errorFor(`locations.${index}.label`)}>
                <input type="text" value={row.label} placeholder="Head office" onChange={(e) => update({ label: e.target.value })} />
              </Field>
              <Field label="Address">
                <textarea value={row.address} onChange={(e) => update({ address: e.target.value })} />
              </Field>
              <Field label="Getting in" note="Parking, entrance, accessibility.">
                <input type="text" value={row.notes} onChange={(e) => update({ notes: e.target.value })} />
              </Field>
            </>
          )}
        />
      </div>

      <div className="card">
        <h2 className="card__title">Contact and routing</h2>
        <p className="card__hint">Only what reception is allowed to give out.</p>

        <Field label="Email" error={errorFor('contact.email')}>
          <input type="email" value={config.contact.email} onChange={(e) => set('contact', { ...config.contact, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input type="text" value={config.contact.phone} onChange={(e) => set('contact', { ...config.contact, phone: e.target.value })} />
        </Field>
        <Field label="Who handles what" note="e.g. billing questions go to accounts.">
          <textarea value={config.contact.routing} onChange={(e) => set('contact', { ...config.contact, routing: e.target.value })} />
        </Field>
      </div>
    </>
  )
}

function KnowledgeSection({ config, set, errorFor }: SectionProps) {
  return (
    <>
      <div className="card">
        <h2 className="card__title">Services</h2>
        <p className="card__hint">
          What you offer, described as reception would. Leave the fee empty and reception will say it
          cannot quote one — which is the right answer unless the price is approved for it to state.
        </p>

        <Rows
          items={config.services}
          blank={BLANK.services}
          onChange={(next) => set('services', next)}
          addLabel="Add a service"
          empty="No services listed."
          render={(row, update, index) => (
            <>
              <Field label="Name" error={errorFor(`services.${index}.name`)}>
                <input type="text" value={row.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Description">
                <textarea value={row.description} onChange={(e) => update({ description: e.target.value })} />
              </Field>
              <div className="row__grid row__grid--two">
                <Field label="Fee" note="Only if approved to be stated.">
                  <input type="text" value={row.fee} onChange={(e) => update({ fee: e.target.value })} />
                </Field>
                <Field
                  label="Appointments service id"
                  note="Optional. Links this to a bookable type in Appointments."
                >
                  <input type="text" value={row.appointmentTypeId} onChange={(e) => update({ appointmentTypeId: e.target.value })} />
                </Field>
              </div>
            </>
          )}
        />
      </div>

      <div className="card">
        <h2 className="card__title">Questions reception is asked</h2>
        <p className="card__hint">
          The approved answer, in full. Reception will not answer anything that is not here — it says
          it does not know and offers to take an enquiry instead.
        </p>

        <Rows
          items={config.faqs}
          blank={BLANK.faqs}
          onChange={(next) => set('faqs', next)}
          addLabel="Add a question"
          empty="No questions added."
          render={(row, update, index) => (
            <>
              <Field label="Question" error={errorFor(`faqs.${index}.question`)}>
                <input type="text" value={row.question} onChange={(e) => update({ question: e.target.value })} />
              </Field>
              <Field label="Answer" error={errorFor(`faqs.${index}.answer`)}>
                <textarea value={row.answer} onChange={(e) => update({ answer: e.target.value })} />
              </Field>
            </>
          )}
        />
      </div>
    </>
  )
}

function ReceptionistSection({
  config,
  set,
  errorFor,
  tones,
  voiceModes,
}: SectionProps & { tones: string[]; voiceModes: string[] }) {
  const persona = config.receptionist

  return (
    <>
      <div className="card">
        <h2 className="card__title">Who is at the desk</h2>
        <p className="card__hint">
          A name and a manner. Reception always says plainly that it is an AI if anybody asks — that
          is not configurable, and a persona does not change what it is allowed to claim.
        </p>

        <Field label="Name" note="Optional. Left empty, reception is simply “the receptionist”." error={errorFor('receptionist.displayName')}>
          <input type="text" value={persona.displayName} onChange={(e) => set('receptionist', { ...persona, displayName: e.target.value })} />
        </Field>

        <Field label="Greeting" note="What it says when somebody walks up." error={errorFor('receptionist.greeting')}>
          <textarea value={persona.greeting} onChange={(e) => set('receptionist', { ...persona, greeting: e.target.value })} />
        </Field>

        <Field label="Manner" error={errorFor('receptionist.tone')}>
          <select value={persona.tone} onChange={(e) => set('receptionist', { ...persona, tone: e.target.value })}>
            {tones.map((tone) => (
              <option key={tone} value={tone}>
                {tone[0].toUpperCase() + tone.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="card">
        <h2 className="card__title">Voice</h2>
        <p className="card__hint">
          The browser voice needs nothing and works everywhere, but sounds synthetic on some
          platforms. A server voice needs a speech provider configured on this deployment; without
          one, this falls back to the browser and the interface says so.
        </p>

        <Field label="Spoken replies come from" error={errorFor('receptionist.voice.mode')}>
          <select
            value={persona.voice.mode}
            onChange={(e) => set('receptionist', { ...persona, voice: { ...persona.voice, mode: e.target.value } })}
          >
            {voiceModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode === 'browser' ? 'The visitor’s browser' : 'This server'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Voice name" note="Optional. Passed to the speech provider." error={errorFor('receptionist.voiceId')}>
          <input
            type="text"
            value={persona.voice.voiceId}
            onChange={(e) => set('receptionist', { ...persona, voice: { ...persona.voice, voiceId: e.target.value } })}
          />
        </Field>

        <Field label={`Speaking rate — ${persona.voice.rate.toFixed(2)}×`}>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={persona.voice.rate}
            onChange={(e) =>
              set('receptionist', { ...persona, voice: { ...persona.voice, rate: Number(e.target.value) } })
            }
          />
        </Field>
      </div>
    </>
  )
}

function ServicesSection({ config, set, errorFor }: SectionProps) {
  const journeys = config.visitorServices

  return (
    <>
      <div className="card">
        <h2 className="card__title">What visitors can do</h2>
        <p className="card__hint">
          Each of these puts an option in front of a visitor. A journey that is off is not offered to
          the receptionist at all, so it cannot suggest something you do not do.
        </p>

        <label className="field field--switch">
          <input
            type="checkbox"
            checked={journeys.booking}
            onChange={(e) => set('visitorServices', { ...journeys, booking: e.target.checked })}
          />
          <span>
            <span className="field__label">Book an appointment</span>
            <span className="field__note">
              Handled by Aicountly Appointments. Lobby holds no appointment or calendar records and
              asks Appointments at the moment it needs an answer.
            </span>
          </span>
        </label>

        <label className="field field--switch">
          <input
            type="checkbox"
            checked={journeys.enquiry}
            onChange={(e) => set('visitorServices', { ...journeys, enquiry: e.target.checked })}
          />
          <span>
            <span className="field__label">Leave an enquiry</span>
            <span className="field__note">
              Always available to the receptionist as a way to say “I do not know, but somebody will
              come back to you”.
            </span>
          </span>
        </label>

        <label className="field field--switch">
          <input
            type="checkbox"
            checked={journeys.handover}
            onChange={(e) => set('visitorServices', { ...journeys, handover: e.target.checked })}
          />
          <span>
            <span className="field__label">Speak to a person</span>
            <span className="field__note">
              Puts the visitor in the queue on the reception desk — but only while somebody actually
              has the desk open. With nobody there, the visitor is told so rather than left waiting.
            </span>
          </span>
        </label>
      </div>

      {journeys.booking && (
        <div className="card">
          <h2 className="card__title">Appointments</h2>
          <p className="card__hint">
            Which company in Appointments to book against. This is a reference — the company and its
            branches are Manage’s and Appointments’ records, not copies kept here.
          </p>

          <div className="row__grid row__grid--two">
            <Field label="Company id" error={errorFor('booking.companyId')}>
              <input
                type="number"
                min={0}
                value={config.booking.companyId || ''}
                onChange={(e) => set('booking', { ...config.booking, companyId: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Branch id" note="Optional. Leave empty for all branches.">
              <input
                type="number"
                min={0}
                value={config.booking.locationId || ''}
                onChange={(e) => set('booking', { ...config.booking, locationId: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
        </div>
      )}

      {journeys.handover && (
        <div className="card">
          <h2 className="card__title">Handing over</h2>
          <Field label="What reception says when passing somebody on" error={errorFor('handover.message')}>
            <textarea
              value={config.handover.message}
              onChange={(e) => set('handover', { ...config.handover, enabled: true, message: e.target.value })}
            />
          </Field>
        </div>
      )}
    </>
  )
}

/**
 * Review and publish.
 *
 * Shows the exact text the receptionist will be briefed with, and what is
 * changing against what is live. Publishing without seeing the difference is
 * how a business discovers a typo by having it read out to a visitor.
 */
function PublishSection({
  draft,
  published,
  publishedAt,
  hasUnpublished,
}: {
  draft: BusinessConfig
  published: BusinessConfig
  publishedAt: string | null
  hasUnpublished: boolean
}) {
  const changes = useMemo(() => summariseChanges(published, draft), [published, draft])

  return (
    <>
      <div className="card">
        <h2 className="card__title">What is changing</h2>
        {!hasUnpublished ? (
          <p className="muted">
            Nothing. Visitors are hearing this version
            {publishedAt ? ` (published ${new Date(publishedAt).toLocaleString()})` : ''}.
          </p>
        ) : changes.length === 0 ? (
          <p className="muted">The draft differs from what is published, but not in anything reception says.</p>
        ) : (
          <ul className="diff">
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">What reception will be told</h2>
        <p className="card__hint">
          This is the approved information, exactly as it reaches the receptionist. It is given as
          reference data inside a delimited block: anything written in it is information to use, never
          an instruction to follow.
        </p>
        <pre className="preview">{renderKnowledge(draft) || '(nothing — reception will say it does not know)'}</pre>
      </div>
    </>
  )
}

/**
 * A plain-language list of what differs between two versions.
 *
 * Section-level rather than a character diff: the question somebody has before
 * publishing is "what did we change", and "hours" is a more useful answer than
 * a highlighted substring.
 */
function summariseChanges(published: BusinessConfig, draft: BusinessConfig): string[] {
  const changes: string[] = []
  const compare = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(label)
  }

  compare('Business name, tagline or description', published.business, draft.business)
  compare(`Opening hours (${published.hours.length} → ${draft.hours.length} entries)`, published.hours, draft.hours)
  compare(`Locations (${published.locations.length} → ${draft.locations.length})`, published.locations, draft.locations)
  compare(`Services (${published.services.length} → ${draft.services.length})`, published.services, draft.services)
  compare('Contact and routing', published.contact, draft.contact)
  compare(`Questions and answers (${published.faqs.length} → ${draft.faqs.length})`, published.faqs, draft.faqs)
  compare('The receptionist’s name, manner or voice', published.receptionist, draft.receptionist)
  compare('Which journeys visitors are offered', published.visitorServices, draft.visitorServices)
  compare('Handover', published.handover, draft.handover)
  compare('Appointments company', published.booking, draft.booking)

  return changes
}

/**
 * The same flat rendering the server builds for the prompt.
 *
 * Deliberately a second implementation rather than an extra API round trip:
 * it is a preview of a shape this screen already holds, and the alternative is
 * a request on every keystroke. The server's version is the one that is
 * actually sent; this one only has to show an administrator what they wrote.
 */
function renderKnowledge(config: BusinessConfig): string {
  const lines: string[] = []

  if (config.business.name) lines.push(`BUSINESS: ${config.business.name}`)
  if (config.business.tagline) lines.push(`TAGLINE: ${config.business.tagline}`)
  if (config.business.description) lines.push(`ABOUT: ${config.business.description}`)

  if (config.hours.length) {
    lines.push('', 'OPENING HOURS (state these exactly; do not extrapolate to days not listed):')
    for (const row of config.hours) {
      const time = [row.opens, row.closes].filter(Boolean).join(' to ')
      const line = [row.days, time].filter(Boolean).join(' ')
      lines.push(`  - ${line}${row.note ? ` (${row.note})` : ''}`)
    }
  }

  if (config.locations.length) {
    lines.push('', 'LOCATIONS:')
    for (const row of config.locations) {
      lines.push(`  - ${[row.label, row.address, row.notes].filter(Boolean).join(' — ')}`)
    }
  }

  if (config.services.length) {
    lines.push('', 'SERVICES:')
    for (const row of config.services) {
      lines.push(`  - ${[row.name, row.description, row.fee].filter(Boolean).join(' — ')}`)
    }
  }

  const contact = [
    config.contact.email && `  - Email: ${config.contact.email}`,
    config.contact.phone && `  - Phone: ${config.contact.phone}`,
    config.contact.routing && `  - Routing: ${config.contact.routing}`,
  ].filter(Boolean) as string[]

  if (contact.length) lines.push('', 'CONTACT AND ROUTING:', ...contact)

  if (config.faqs.length) {
    lines.push('', 'RECEPTION FAQ:')
    for (const row of config.faqs) {
      if (row.question && row.answer) lines.push(`  Q: ${row.question}`, `  A: ${row.answer}`)
    }
  }

  if (config.handover.enabled && config.handover.message) {
    lines.push('', 'WHEN PASSING A VISITOR TO A PERSON:', `  ${config.handover.message}`)
  }

  return lines.join('\n').trim()
}
