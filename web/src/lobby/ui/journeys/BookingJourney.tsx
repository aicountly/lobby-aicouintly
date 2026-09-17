/**
 * "Book an appointment".
 *
 * A real three-step booking journey — service, slot, details — driven entirely
 * through the service adapter. In demonstration mode it completes and hands
 * back a reference that exists only on this screen. In live mode every step
 * reports which application is missing, because Aicountly Appointments owns
 * booking and Lobby has no store of its own to fall back on.
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import type {
  AvailabilitySlot,
  BookingReceipt,
  LobbyServiceAdapter,
  ServiceOption,
  ServiceUnavailable,
} from '../../services/types'
import { isOk } from '../../services/types'
import { DemoReceipt, Pending, UnavailableNotice } from '../Notices'

type Step = 'slot' | 'details' | 'done'

/** Tomorrow, in the YYYY-MM-DD form a date input wants. */
function defaultDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function BookingJourney({ adapter }: { adapter: LobbyServiceAdapter }) {
  const [services, setServices] = useState<ServiceOption[] | null>(null)
  const [blocked, setBlocked] = useState<ServiceUnavailable | null>(null)

  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [slotId, setSlotId] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  const [step, setStep] = useState<Step>('slot')
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null)

  useEffect(() => {
    let cancelled = false
    void adapter.listServices().then((outcome) => {
      if (cancelled) return
      if (isOk(outcome)) {
        setServices(outcome.data)
        setServiceId(outcome.data[0]?.id ?? '')
      } else {
        setBlocked(outcome)
      }
    })
    return () => {
      cancelled = true
    }
  }, [adapter])

  useEffect(() => {
    if (!serviceId || !date) return
    let cancelled = false
    setSlots(null)
    setSlotId('')
    void adapter.listAvailability(serviceId, date).then((outcome) => {
      if (cancelled) return
      if (isOk(outcome)) setSlots(outcome.data)
      else setBlocked(outcome)
    })
    return () => {
      cancelled = true
    }
  }, [adapter, serviceId, date])

  if (blocked) return <UnavailableNotice outcome={blocked} />
  if (!services) return <Pending label="Loading available appointment types…" />

  const selectedService = services.find((s) => s.id === serviceId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    const outcome = await adapter.requestBooking({ serviceId, date, slotId, name, email, notes })
    setSubmitting(false)
    if (isOk(outcome)) {
      setReceipt(outcome.data)
      setStep('done')
    } else {
      setBlocked(outcome)
    }
  }

  if (step === 'done' && receipt) {
    return (
      <DemoReceipt reference={receipt.reference} demo={receipt.demo} note={receipt.note}>
        <dl className="lobby-detail-list">
          <div>
            <dt>Appointment</dt>
            <dd>{receipt.serviceLabel}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              {receipt.date} at {receipt.time}
            </dd>
          </div>
        </dl>
      </DemoReceipt>
    )
  }

  return (
    <div data-lobby-form>
      <ol className="lobby-steps" aria-label="Booking steps">
        <li aria-current={step === 'slot' ? 'step' : undefined}>1. Choose a time</li>
        <li aria-current={step === 'details' ? 'step' : undefined}>2. Your details</li>
      </ol>

      {step === 'slot' ? (
        <div className="lobby-fields">
          <label className="lobby-field">
            <span>Appointment type</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.label} · {service.durationMinutes} min
                </option>
              ))}
            </select>
          </label>
          {selectedService ? (
            <p className="lobby-field-help">{selectedService.description}</p>
          ) : null}

          <label className="lobby-field">
            <span>Date</span>
            <input
              type="date"
              value={date}
              min={defaultDate()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <fieldset className="lobby-slots">
            <legend>Available times</legend>
            {slots === null ? (
              <Pending label="Checking availability…" />
            ) : slots.length === 0 ? (
              <p className="lobby-field-help">No times offered on that date. Try another day.</p>
            ) : (
              <div className="lobby-slot-grid">
                {slots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    className={`lobby-slot${slotId === slot.id ? ' is-selected' : ''}`}
                    aria-pressed={slotId === slot.id}
                    onClick={() => setSlotId(slot.id)}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <button
            type="button"
            className="lobby-button lobby-button-primary"
            disabled={!slotId}
            onClick={() => setStep('details')}
          >
            Continue
          </button>
        </div>
      ) : (
        <form className="lobby-fields" onSubmit={submit}>
          <label className="lobby-field">
            <span>Your name</span>
            <input
              type="text"
              required
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="lobby-field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="lobby-field">
            <span>Anything we should know? (optional)</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="lobby-button-row">
            <button type="button" className="lobby-button" onClick={() => setStep('slot')}>
              Back
            </button>
            <button type="submit" className="lobby-button lobby-button-primary" disabled={submitting}>
              {submitting ? 'Working…' : 'Complete demo booking'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
