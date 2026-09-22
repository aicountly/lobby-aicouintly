/**
 * The browser half of the reception API.
 *
 * Everything that costs money or holds a credential lives behind this product's
 * own PHP API. This file knows four routes and a session token; it does not
 * know which model answers, which voice speaks, or which service transcribes,
 * and it must never be given a way to find out.
 *
 * The session is the part worth reading twice. A public visitor is issued a
 * short-lived signed token before they can talk, and that token — not anything
 * the browser chooses — carries the conversation id and the tenant. The token
 * is held in memory for the tab's lifetime and deliberately not persisted:
 * it is a rate-limiting and scoping device, not a login, and writing it to
 * storage would give it a longer life than it should have.
 */
import { getApiBaseUrl } from '../../config'
import { RECEPTION_API_PREFIX } from '../lobbyConfig'
import type { ReceptionTurn } from './types'

export interface CapabilityEntry {
  configured: boolean
  provider: string | null
  reason: string
}

export interface LobbyCapabilities {
  /** `live` only when a visitor can actually hold a conversation. */
  mode: 'live' | 'unavailable'
  conversation: CapabilityEntry
  speech: CapabilityEntry
  transcription: CapabilityEntry
  knowledge: { configured: boolean; sections: string[]; businessName: string | null; reason: string }
  actions: string[]
}

export interface ReceptionAction {
  name: string
  input: Record<string, string>
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; code: string; retryable: boolean }

interface AskPayload {
  reply: string
  suggestions: string[]
  actions: ReceptionAction[]
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export interface ReceptionApi {
  capabilities(init?: RequestInit): Promise<LobbyCapabilities | null>
  /** The last report fetched, so callers do not each ask for their own. */
  lastCapabilities(): LobbyCapabilities | null
  ask(message: string, history: readonly ReceptionTurn[], init?: RequestInit): Promise<ApiResult<AskPayload>>
  speak(text: string, init?: RequestInit): Promise<ApiResult<Blob>>
  transcribe(audio: Blob, init?: RequestInit): Promise<ApiResult<string>>
  /** Drop the session, e.g. when the conversation is disposed. */
  reset(): void
}

export function createReceptionApi(): ReceptionApi {
  let session: string | null = null
  let issuing: Promise<string | null> | null = null
  let lastReport: LobbyCapabilities | null = null

  const url = (route: string) => `${getApiBaseUrl()}/${RECEPTION_API_PREFIX}/${route}`

  async function issueSession(init?: RequestInit): Promise<string | null> {
    // One in-flight request at a time: a visitor who types and presses Talk
    // together would otherwise mint two sessions and halve their own limit.
    if (issuing) return issuing

    issuing = (async () => {
      try {
        const response = await fetch(url('session'), { method: 'POST', headers: JSON_HEADERS, signal: init?.signal })
        if (!response.ok) return null
        const body = (await response.json()) as { session?: unknown }
        return typeof body.session === 'string' && body.session ? body.session : null
      } catch {
        return null
      } finally {
        issuing = null
      }
    })()

    return issuing
  }

  async function authed(route: string, request: RequestInit, retry = true): Promise<Response | null> {
    session ??= await issueSession(request)
    if (!session) return null

    const headers = new Headers(request.headers)
    headers.set('x-lobby-session', session)

    let response: Response
    try {
      response = await fetch(url(route), { ...request, headers })
    } catch {
      return null
    }

    // A session expires on its own schedule, so one silent re-issue is the
    // difference between a working conversation and a visitor being told to
    // start again mid-sentence. Only one, and only for this.
    if (response.status === 401 && retry) {
      session = null
      const reissued = await issueSession(request)
      if (!reissued) return response
      session = reissued
      return authed(route, request, false)
    }

    return response
  }

  async function failureFrom(response: Response | null, fallback: string): Promise<ApiResult<never>> {
    if (response === null) {
      return { ok: false, reason: fallback, code: 'unreachable', retryable: true }
    }
    let reason = fallback
    let code = `http_${response.status}`
    let retryable = response.status === 429 || response.status >= 500
    try {
      const body = (await response.json()) as { message?: unknown; code?: unknown; retryable?: unknown }
      if (typeof body.message === 'string' && body.message) reason = body.message
      if (typeof body.code === 'string' && body.code) code = body.code
      if (typeof body.retryable === 'boolean') retryable = body.retryable
    } catch {
      // A non-JSON error body is not worth a second failure.
    }

    return { ok: false, reason, code, retryable }
  }

  return {
    async capabilities(init) {
      try {
        const response = await fetch(url('capabilities'), { signal: init?.signal })
        if (!response.ok) return null
        lastReport = (await response.json()) as LobbyCapabilities
        return lastReport
      } catch {
        return null
      }
    },

    lastCapabilities() {
      return lastReport
    },

    async ask(message, history, init) {
      const response = await authed('reception', {
        method: 'POST',
        headers: JSON_HEADERS,
        signal: init?.signal,
        // Bounded here as well as on the server. The server's limit is the one
        // that counts; this one keeps an ordinary request from being large.
        body: JSON.stringify({
          message,
          history: history.slice(-12).map((turn) => ({ role: turn.role, text: turn.text.slice(0, 400) })),
        }),
      })

      if (!response || !response.ok) {
        return failureFrom(response, 'Reception could not be reached.')
      }

      const body = (await response.json()) as Partial<AskPayload>

      return {
        ok: true,
        data: {
          reply: typeof body.reply === 'string' ? body.reply : '',
          suggestions: Array.isArray(body.suggestions) ? body.suggestions.filter((s): s is string => typeof s === 'string') : [],
          actions: Array.isArray(body.actions) ? (body.actions as ReceptionAction[]) : [],
        },
      }
    },

    async speak(text, init) {
      const response = await authed('speech', {
        method: 'POST',
        headers: JSON_HEADERS,
        signal: init?.signal,
        body: JSON.stringify({ text }),
      })

      if (!response || !response.ok) {
        return failureFrom(response, 'The reply could not be spoken.')
      }

      // The server already refuses to return anything but audio; checking again
      // here costs nothing and means a misconfigured proxy cannot hand an
      // <audio> element a JSON error to fail silently on.
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('audio/')) {
        return { ok: false, reason: 'The speech service did not return audio.', code: 'not_audio', retryable: false }
      }

      const blob = await response.blob()
      if (blob.size < 512) {
        return { ok: false, reason: 'The speech service returned an empty response.', code: 'empty_audio', retryable: true }
      }

      return { ok: true, data: blob }
    },

    async transcribe(audio, init) {
      const response = await authed('transcribe', {
        method: 'POST',
        headers: { 'content-type': audio.type || 'audio/webm' },
        signal: init?.signal,
        body: audio,
      })

      if (!response || !response.ok) {
        return failureFrom(response, 'That recording could not be transcribed.')
      }

      const body = (await response.json()) as { text?: unknown }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text) {
        return { ok: false, reason: 'Nothing was heard in that recording.', code: 'empty_recording', retryable: false }
      }

      return { ok: true, data: text }
    },

    reset() {
      session = null
    },
  }
}
