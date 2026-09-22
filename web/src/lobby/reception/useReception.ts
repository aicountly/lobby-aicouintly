/**
 * The conversation, as React sees it.
 *
 * One hook, one conversation instance, one turn guard for its lifetime. React
 * subscribes to discrete state only — the transcript, the phase, whether the
 * microphone is open. Mouth shapes never reach it; they go through the signal
 * and are read inside `useFrame`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { LOBBY_SERVICE_MODE } from '../lobbyConfig'
import { liveReceptionApi } from '../services/liveAdapter'
import type { LobbyCapabilities } from '../services/receptionApi'
import type { LobbyServiceAdapter } from '../services/types'
import type { CharacterCapability } from './capability'
import { NO_CHARACTER } from './capability'
import { createReceptionConversation } from './conversation'
import type { ConversationSnapshot, ReceptionConversation } from './conversation'
import type { ReceptionSignal } from './signal'
import { createReceptionSignal } from './signal'
import {
  createServerVoiceInput,
  createVoiceInput,
  createVoiceOutput,
  detectSpeechSupport,
  recallVoiceOutput,
  serverTranscriptionSupported,
} from './speech'

export interface UseReceptionOptions {
  adapter: LobbyServiceAdapter
  reducedMotion: boolean
  /** Off by default and only used when 3D is not mounted. */
  enabled?: boolean
}

/**
 * What the reception desk is running right now.
 *
 * Three states, never two. `unavailable` exists so that a live deployment
 * whose model is not configured says so, instead of quietly answering from the
 * demonstration script and presenting the result as a real AI.
 */
export type ReceptionMode = 'demo' | 'live' | 'unavailable'

export interface Reception {
  signal: ReceptionSignal
  conversation: ReceptionConversation
  snapshot: ConversationSnapshot
  capability: CharacterCapability
  /** Which of the three modes this deployment is in. */
  mode: ReceptionMode
  /** What the server reports it can do. Null until the first fetch lands. */
  capabilities: LobbyCapabilities | null
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

  // Only the live adapter has a backend to talk to; in demo mode there is
  // deliberately nothing to call.
  const api = useMemo(() => (LOBBY_SERVICE_MODE === 'live' ? liveReceptionApi() : null), [])
  const [capabilities, setCapabilities] = useState<LobbyCapabilities | null>(null)
  const capabilitiesRef = useRef<LobbyCapabilities | null>(null)

  useEffect(() => {
    if (!api) return
    const controller = new AbortController()
    void api.capabilities({ signal: controller.signal }).then((report) => {
      if (controller.signal.aborted) return
      capabilitiesRef.current = report
      setCapabilities(report)
    })

    return () => controller.abort()
  }, [api])

  const support = useMemo(detectSpeechSupport, [])
  // Server transcription where the deployment has it, the browser recogniser
  // otherwise. Same interface either way, so nothing downstream branches on it.
  const serverTranscription = capabilities?.transcription.configured === true
  const voiceInput = useMemo(() => {
    if (api && serverTranscription && serverTranscriptionSupported()) {
      return createServerVoiceInput(api)
    }

    return support.input ? createVoiceInput() : null
  }, [api, serverTranscription, support.input])
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
        api,
        // Read through a ref so enabling a server voice mid-session takes
        // effect on the next reply without rebuilding the conversation.
        serverSpeech: () => capabilitiesRef.current?.speech.configured === true,
      }),
    // `reducedMotion` is pushed in below rather than rebuilding the
    // conversation, which would drop the transcript mid-exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, signal, voiceInput, voiceOutput, support.inputReason, support.outputReason, api],
  )

  useEffect(() => {
    conversation.setReducedMotion(reducedMotion)
  }, [conversation, reducedMotion])

  // Restore the visitor's own earlier choice, and only theirs. This can never
  // turn speech on by itself: `recallVoiceOutput` returns false unless someone
  // ticked the box on this device before.
  useEffect(() => {
    if (recallVoiceOutput()) conversation.setVoiceOutput(true)
  }, [conversation])

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

  const mode: ReceptionMode =
    LOBBY_SERVICE_MODE !== 'live'
      ? 'demo'
      : capabilities?.mode === 'live'
        ? 'live'
        : 'unavailable'

  return { signal, conversation, snapshot, capability, mode, capabilities, reportCapability }
}
