/**
 * "Speak to our team".
 *
 * A scripted question-and-answer exchange. It is worth being exact about what
 * this is not: there is no language model behind it, no audio, and the 3D
 * receptionist standing at the counter is a static placeholder with no face,
 * no lip-sync and no facial animation. The replies below are matched from the
 * question by keyword and written out in full in services/demoAdapter.ts.
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import type {
  LobbyServiceAdapter,
  ReceptionTurn,
  ServiceUnavailable,
} from '../../services/types'
import { isOk } from '../../services/types'
import { UnavailableNotice } from '../Notices'

const OPENING: ReceptionTurn = {
  role: 'reception',
  text: 'Hello, and welcome to Aicountly. Ask me about opening hours, booking an appointment, or what Aicountly does.',
}

const STARTERS = [
  'What are your opening hours?',
  'I would like to book an appointment',
  'What can Aicountly do?',
]

export function TeamJourney({ adapter }: { adapter: LobbyServiceAdapter }) {
  const [turns, setTurns] = useState<ReceptionTurn[]>([OPENING])
  const [suggestions, setSuggestions] = useState<string[]>(STARTERS)
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [blocked, setBlocked] = useState<ServiceUnavailable | null>(null)
  const transcript = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = transcript.current
    if (element) element.scrollTop = element.scrollHeight
  }, [turns, thinking])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || thinking) return

    const history = turns
    setTurns([...history, { role: 'visitor', text: trimmed }])
    setDraft('')
    setSuggestions([])
    setThinking(true)

    const outcome = await adapter.askReception(trimmed, history)
    setThinking(false)

    if (!isOk(outcome)) {
      setBlocked(outcome)
      return
    }

    setTurns((current) => [...current, { role: 'reception', text: outcome.data.text }])
    setSuggestions(outcome.data.suggestions)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void ask(draft)
  }

  if (blocked) return <UnavailableNotice outcome={blocked} />

  return (
    <div data-lobby-form>
      <p className="lobby-field-help">
        Scripted replies matched by keyword. No AI model is connected, there is no audio, and the 3D
        receptionist at the counter is a static placeholder — it has no facial animation and no
        lip-sync.
      </p>

      <div className="lobby-transcript" ref={transcript} aria-live="polite" aria-label="Conversation">
        {turns.map((turn, index) => (
          <p key={index} className={`lobby-turn lobby-turn-${turn.role}`}>
            <span className="lobby-turn-who">
              {turn.role === 'reception' ? 'Reception (demo)' : 'You'}
            </span>
            {turn.text}
          </p>
        ))}
        {thinking ? <p className="lobby-turn lobby-turn-reception is-thinking">Typing…</p> : null}
      </div>

      {suggestions.length > 0 ? (
        <div className="lobby-suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="lobby-chip"
              onClick={() => void ask(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <form className="lobby-ask" onSubmit={onSubmit}>
        <label className="lobby-field">
          <span className="lobby-visually-hidden">Your question</span>
          <input
            type="text"
            value={draft}
            placeholder="Type a question…"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="submit" className="lobby-button lobby-button-primary" disabled={thinking}>
          Ask
        </button>
      </form>
    </div>
  )
}
