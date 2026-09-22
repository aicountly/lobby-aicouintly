/**
 * "Speak to our team" — the reception conversation.
 *
 * What the visitor can do here: type a question, tap a suggestion, press Talk
 * to speak one, have replies read back, interrupt at any point, and jump into
 * whichever journey their question was really about.
 *
 * What is behind it, stated on the panel rather than only in a document: replies
 * are matched from the question by keyword in `services/demoAdapter.ts`. There
 * is no language model connected. Voice uses the browser's own speech engine,
 * so no audio leaves the device and no provider credential exists. Nothing is
 * booked, sent or stored.
 */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { describeLipSyncMode, summariseCapability } from '../reception/capability'
import type { CharacterCapability } from '../reception/capability'
import type { ConversationSnapshot, ReceptionConversation, ServiceShortcutKey } from '../reception/conversation'
import { RECEPTION_STATE_ANNOUNCEMENTS, RECEPTION_STATE_LABELS } from '../reception/states'
import { UnavailableNotice } from './Notices'

interface Props {
  conversation: ReceptionConversation
  snapshot: ConversationSnapshot
  capability: CharacterCapability
  onOpenService?: (key: ServiceShortcutKey) => void
}

export function ReceptionChat({ conversation, snapshot, capability, onOpenService }: Props) {
  const [draft, setDraft] = useState('')
  const transcript = useRef<HTMLDivElement>(null)

  // Greeting happens when reception is opened, not when the page loads: a lobby
  // that starts talking before it has been approached is a lobby nobody trusts.
  useEffect(() => {
    conversation.greet()
  }, [conversation])

  useEffect(() => {
    const element = transcript.current
    if (element) element.scrollTop = element.scrollHeight
  }, [snapshot.turns, snapshot.phase, snapshot.heard])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void conversation.ask(text)
  }

  const { voice } = snapshot
  const talking = snapshot.phase === 'answering' || snapshot.phase === 'handover' || snapshot.phase === 'failed'
  const canInterrupt = snapshot.busy || talking || voice.listening

  return (
    <div data-lobby-form>
      <p className="lobby-field-help">
        Replies are matched from your question by keyword — there is no AI model connected to this
        demonstration. Voice uses your browser’s own speech engine, so nothing is uploaded and no
        recording is kept. Nothing here is booked, sent or stored.
      </p>

      <div className="lobby-reception-status">
        <span className={`lobby-state-chip is-${snapshot.state}`}>{RECEPTION_STATE_LABELS[snapshot.state]}</span>
        <span className="lobby-visually-hidden" role="status" aria-live="polite">
          {RECEPTION_STATE_ANNOUNCEMENTS[snapshot.state]}
        </span>
        {canInterrupt ? (
          <button type="button" className="lobby-chip lobby-chip-stop" onClick={() => conversation.interrupt()}>
            Stop
          </button>
        ) : null}
      </div>

      <div className="lobby-transcript" ref={transcript} aria-live="polite" aria-label="Conversation">
        {snapshot.turns.map((turn, index) => (
          <p key={index} className={`lobby-turn lobby-turn-${turn.role}`}>
            <span className="lobby-turn-who">{turn.role === 'reception' ? 'Reception (demo)' : 'You'}</span>
            {turn.text}
          </p>
        ))}
        {snapshot.heard ? (
          <p className="lobby-turn lobby-turn-visitor is-partial">
            <span className="lobby-turn-who">You (heard)</span>
            {snapshot.heard}
          </p>
        ) : null}
        {snapshot.phase === 'thinking' ? (
          <p className="lobby-turn lobby-turn-reception is-thinking">Typing…</p>
        ) : null}
      </div>

      {snapshot.unavailable ? <UnavailableNotice outcome={snapshot.unavailable} /> : null}

      {snapshot.voiceNotice ? (
        <p className="lobby-standard-reason" role="status">
          {snapshot.voiceNotice}
        </p>
      ) : null}

      {snapshot.shortcut && onOpenService ? (
        <div className="lobby-suggestions">
          <button
            type="button"
            className="lobby-chip lobby-chip-primary"
            onClick={() => onOpenService(snapshot.shortcut!.key)}
          >
            {snapshot.shortcut.label}
          </button>
        </div>
      ) : null}

      {snapshot.suggestions.length > 0 ? (
        <div className="lobby-suggestions">
          {snapshot.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="lobby-chip"
              onClick={() => void conversation.ask(suggestion)}
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
        <button type="submit" className="lobby-button lobby-button-primary" disabled={snapshot.busy}>
          Ask
        </button>
      </form>

      <div className="lobby-voice-row">
        {voice.inputAvailable ? (
          <button
            type="button"
            className={`lobby-button lobby-button-voice${voice.listening ? ' is-listening' : ''}`}
            aria-pressed={voice.listening}
            onClick={() => (voice.listening ? conversation.stopVoice() : void conversation.startVoice())}
          >
            {voice.listening ? 'Stop listening' : 'Talk'}
          </button>
        ) : (
          <p className="lobby-field-help">{voice.inputReason ?? 'Voice input is unavailable here.'}</p>
        )}

        {voice.outputAvailable ? (
          <label className="lobby-toggle">
            <input
              type="checkbox"
              checked={voice.outputEnabled}
              onChange={(event) => conversation.setVoiceOutput(event.target.checked)}
            />
            <span>Read replies aloud</span>
          </label>
        ) : (
          <p className="lobby-field-help">{voice.outputReason ?? 'Speech output is unavailable here.'}</p>
        )}
      </div>

      <p className="lobby-field-help lobby-capability">
        {summariseCapability(capability, snapshot.lipSync)}{' '}
        {capability.mounted ? describeLipSyncMode(snapshot.lipSync) : null}
      </p>
    </div>
  )
}
