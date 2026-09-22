/**
 * "Make an enquiry".
 *
 * The shortest of the three journeys and the one most likely to be mistaken for
 * a real contact form, so the demonstration label sits with the receipt rather
 * than only at the top of the panel.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'

import type {
  EnquiryReceipt,
  LobbyServiceAdapter,
  ServiceUnavailable,
} from '../../services/types'
import { isOk } from '../../services/types'
import { DemoReceipt, UnavailableNotice } from '../Notices'

const TOPICS = [
  { id: 'products', label: 'Which Aicountly products suit us' },
  { id: 'pricing', label: 'Pricing and plans' },
  { id: 'migration', label: 'Moving from another system' },
  { id: 'support', label: 'Help with an existing account' },
  { id: 'other', label: 'Something else' },
]

export function EnquiryJourney({
  adapter,
  onReceipt,
}: {
  adapter: LobbyServiceAdapter
  onReceipt?: (receipt: EnquiryReceipt) => void
}) {
  const [topic, setTopic] = useState(TOPICS[0].id)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<EnquiryReceipt | null>(null)
  const [blocked, setBlocked] = useState<ServiceUnavailable | null>(null)

  if (blocked) return <UnavailableNotice outcome={blocked} />

  if (receipt) {
    return (
      <DemoReceipt reference={receipt.reference} demo={receipt.demo} note={receipt.note}>
        <dl className="lobby-detail-list">
          <div>
            <dt>Topic</dt>
            <dd>{TOPICS.find((t) => t.id === topic)?.label ?? topic}</dd>
          </div>
        </dl>
      </DemoReceipt>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    const outcome = await adapter.submitEnquiry({ topic, name, email, message })
    setSubmitting(false)
    if (isOk(outcome)) {
      setReceipt(outcome.data)
      onReceipt?.(outcome.data)
    }
    else setBlocked(outcome)
  }

  return (
    <form className="lobby-fields" onSubmit={submit} data-lobby-form>
      <label className="lobby-field">
        <span>What is it about?</span>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
        <span>Your enquiry</span>
        <textarea
          rows={5}
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what you need."
        />
      </label>

      <button type="submit" className="lobby-button lobby-button-primary" disabled={submitting}>
        {submitting ? 'Working…' : 'Submit demo enquiry'}
      </button>
    </form>
  )
}
