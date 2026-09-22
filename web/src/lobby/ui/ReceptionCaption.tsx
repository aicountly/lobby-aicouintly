/**
 * What reception is saying, over the 3D view.
 *
 * Without this, the only place the conversation is visible is inside a panel —
 * and the panel covers the character. So a visitor who walks up to the counter
 * and is greeted sees a figure wave at them in silence, with the words in a
 * transcript they have not opened.
 *
 * It is also the captions half of lip-sync Mode C: a character with no drivable
 * mouth animates its body and its words appear here. That was specified and
 * then only implemented inside the panel, which is not where anyone is looking.
 */
import type { ConversationSnapshot } from '../reception/conversation'

export function ReceptionCaption({ snapshot }: { snapshot: ConversationSnapshot }) {
  const speaking = snapshot.phase === 'greeting' || snapshot.phase === 'answering'
  const line = [...snapshot.turns].reverse().find((turn) => turn.role === 'reception')?.text ?? ''

  const text = snapshot.voice.listening
    ? snapshot.heard || 'Listening…'
    : snapshot.phase === 'thinking'
      ? 'One moment…'
      : snapshot.phase === 'failed' || snapshot.phase === 'handover' || speaking
        ? line
        : ''

  if (!text) return null

  return (
    <div className="lobby-caption" data-lobby-ui>
      <p className={`lobby-caption-line${snapshot.voice.listening ? ' is-visitor' : ''}`}>
        <span className="lobby-caption-who">{snapshot.voice.listening ? 'You' : 'Reception (demo)'}</span>
        {text}
      </p>
    </div>
  )
}
