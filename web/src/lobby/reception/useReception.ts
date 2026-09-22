/**
 * The conversation, as React sees it.
 *
 * One hook, one conversation instance, one turn guard for its lifetime. React
 * subscribes to discrete state only — the transcript, the phase, whether the
 * microphone is open. Mouth shapes never reach it; they go through the signal
 * and are read inside `useFrame`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { LobbyServiceAdapter } from '../services/types'
import type { CharacterCapability } from './capability'
import { NO_CHARACTER } from './capability'
import { createReceptionConversation } from './conversation'
import type { ConversationSnapshot, ReceptionConversation } from './conversation'
import type { ReceptionSignal } from './signal'
import { createReceptionSignal } from './signal'
import { createVoiceInput, createVoiceOutput, detectSpeechSupport } from './speech'

export interface UseReceptionOptions {
  adapter: LobbyServiceAdapter
  reducedMotion: boolean
  /** Off by default and only used when 3D is not mounted. */
  enabled?: boolean
}

export interface Reception {
  signal: ReceptionSignal
  conversation: ReceptionConversation
  snapshot: ConversationSnapshot
  capability: CharacterCapability
  /** Handed to the scene, which calls it once it knows what it mounted. */
  reportCapability: (capability: CharacterCapability) => void
}

export function useReception({ adapter, reducedMotion }: UseReceptionOptions): Reception {
  // One per experience, not per module: two lobbies on a page would otherwise
  // share one mouth and one microphone.
  const signal = useMemo(() => createReceptionSignal(), [])
  // Two copies on purpose: the conversation reads the ref every reply (it must
  // never be stale), React renders the state (it must never tear).
  const capabilityRef = useRef<CharacterCapability>(NO_CHARACTER)
  const [capability, setCapability] = useState<CharacterCapability>(NO_CHARACTER)

  const support = useMemo(detectSpeechSupport, [])
  const voiceInput = useMemo(() => (support.input ? createVoiceInput() : null), [support.input])
  const voiceOutput = useMemo(() => (support.output ? createVoiceOutput() : null), [support.output])

  const conversation = useMemo(
    () =>
      createReceptionConversation({
        adapter,
        signal,
        capability: () => capabilityRef.current,
        voiceInput,
        voiceOutput,
        inputReason: support.inputReason,
        outputReason: support.outputReason,
        reducedMotion,
      }),
    // `reducedMotion` is pushed in below rather than rebuilding the
    // conversation, which would drop the transcript mid-exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, signal, voiceInput, voiceOutput, support.inputReason, support.outputReason],
  )

  useEffect(() => {
    conversation.setReducedMotion(reducedMotion)
  }, [conversation, reducedMotion])

  // Everything in flight stops when the lobby goes away: the microphone, the
  // speaker, the pending adapter call.
  useEffect(() => () => conversation.dispose(), [conversation])

  // A tab that is hidden should not be listening or talking.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') conversation.interrupt()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [conversation])

  const snapshot = useSyncExternalStore(
    conversation.subscribe,
    conversation.snapshot,
    conversation.snapshot,
  )

  const reportCapability = useCallback((next: CharacterCapability) => {
    capabilityRef.current = next
    setCapability(next)
  }, [])

  return { signal, conversation, snapshot, capability, reportCapability }
}
