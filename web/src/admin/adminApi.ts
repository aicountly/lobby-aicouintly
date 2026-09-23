/**
 * The browser half of the staff and administration API.
 *
 * Every call carries the portal session key as a bearer token. That is a
 * different credential from the anonymous visitor session the public lobby
 * uses, and the two never mix: the server reads only this one for staff
 * routes, so there is no path by which loading a public page could grant
 * access to a queue or an unpublished configuration.
 *
 * Nothing here decides what the caller may do. The server returns 403 with a
 * reason, and the interface renders that. Permissions are also returned so the
 * screens can hide what is not available — but hiding is courtesy, and the
 * refusal is the security.
 */
import { getApiBaseUrl } from '../config'
import { getSesKey } from '../auth/tokens'

export type Role = 'owner' | 'manager' | 'agent' | 'none'

export type Permission =
  | 'config.view'
  | 'config.edit'
  | 'config.publish'
  | 'desk.view'
  | 'desk.work'
  | 'staff.manage'

export interface StaffIdentity {
  uuid: string
  tenant: string
  role: Role
  permissions: Permission[]
}

export interface FieldError {
  field: string
  message: string
}

/**
 * Every outcome the screens have to render, named.
 *
 * `conflict` is separate from `error` because it needs a different sentence
 * and a different button: somebody else changed this, so reload — not
 * something went wrong, so try again.
 */
export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'unauthenticated'; message: string }
  | { ok: false; kind: 'forbidden'; message: string; role: Role }
  | { ok: false; kind: 'conflict'; message: string }
  | { ok: false; kind: 'invalid'; message: string; errors: FieldError[] }
  | { ok: false; kind: 'error'; message: string; retryable: boolean }

export interface HoursRow { days: string; opens: string; closes: string; note: string }
export interface LocationRow { label: string; address: string; notes: string }
export interface ServiceRow { name: string; description: string; fee: string; appointmentTypeId: string }
export interface FaqRow { question: string; answer: string }

export interface BusinessConfig {
  business: { name: string; tagline: string; description: string }
  hours: HoursRow[]
  locations: LocationRow[]
  services: ServiceRow[]
  contact: { email: string; phone: string; routing: string }
  faqs: FaqRow[]
  handover: { enabled: boolean; message: string }
  receptionist: {
    displayName: string
    greeting: string
    tone: string
    voice: { mode: string; voiceId: string; rate: number }
  }
  visitorServices: { booking: boolean; enquiry: boolean; handover: boolean }
  booking: { companyId: number; locationId: number }
}

export interface ConfigResponse {
  tenant: string
  draft: { data: BusinessConfig; revision: number; source: string }
  published: { data: BusinessConfig; revision: number; source: string; updatedAt: string | null }
  hasUnpublishedChanges: boolean
  storage: { writable: boolean; reason: string; webReachable?: boolean; legacyFile: string | null }
  tones: string[]
  voiceModes: string[]
  permissions: Permission[]
}

export interface QueueEntry {
  id: string
  state: 'requested' | 'queued' | 'assigned' | 'accepted' | 'resolved' | 'abandoned'
  name: string
  reason: string
  requestedAt: string | null
  queuedAt: string | null
  assignedAt: string | null
  acceptedAt: string | null
  closedAt: string | null
  outcome: string
  revision: number
  /** Whether this entry is the viewer's. The holder's uuid never leaves the server. */
  mine: boolean
  taken: boolean
}

export interface QueueResponse {
  waiting: QueueEntry[]
  mine: QueueEntry[]
  withOthers: QueueEntry[]
  recentlyClosed: QueueEntry[]
  counts: { waiting: number; mine: number; withOthers: number }
  capacity: number
  acceptGraceSeconds: number
  you: string
  serverTime: string
}

export interface StaffMember { uuid: string; role: Role; source: 'server-config' | 'tenant' }

export interface StaffResponse {
  members: StaffMember[]
  revision: number
  roles: Role[]
  you: string
}

async function call<T>(route: string, init?: RequestInit): Promise<AdminResult<T>> {
  const token = getSesKey()
  if (!token) {
    return { ok: false, kind: 'unauthenticated', message: 'Sign in to use the reception desk.' }
  }

  let response: Response
  try {
    response = await fetch(`${getApiBaseUrl()}/${route}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
        authorization: `Bearer ${token}`,
      },
    })
  } catch {
    // A network failure is not a refusal. Saying "you do not have access"
    // here would send somebody to ask for permission they already have.
    return { ok: false, kind: 'error', message: 'Could not reach the server.', retryable: true }
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const message = typeof body.message === 'string' ? body.message : ''

  if (response.ok) return { ok: true, data: body as T }

  switch (response.status) {
    case 401:
      return { ok: false, kind: 'unauthenticated', message: message || 'Sign in to continue.' }
    case 403:
      return {
        ok: false,
        kind: 'forbidden',
        message: message || 'Your role does not allow that.',
        role: (typeof body.role === 'string' ? body.role : 'none') as Role,
      }
    case 409:
      return { ok: false, kind: 'conflict', message: message || 'That changed while you were working on it.' }
    case 422:
      return {
        ok: false,
        kind: 'invalid',
        message: message || 'Some of that could not be saved.',
        errors: Array.isArray(body.errors) ? (body.errors as FieldError[]) : [],
      }
    default:
      return {
        ok: false,
        kind: 'error',
        message: message || `The server answered ${response.status}.`,
        retryable: response.status >= 500,
      }
  }
}

export const adminApi = {
  session: () => call<{ staff: StaffIdentity; hasAccess: boolean; onDuty: number }>('desk/session'),

  config: () => call<ConfigResponse>('admin/config'),

  saveDraft: (config: BusinessConfig, revision: number) =>
    call<{ revision: number; data: BusinessConfig; hasUnpublishedChanges: boolean }>('admin/config', {
      method: 'PUT',
      body: JSON.stringify({ config, revision }),
    }),

  publish: (revision: number) =>
    call<{ published: boolean; revision: number }>('admin/config/publish', {
      method: 'POST',
      body: JSON.stringify({ revision }),
    }),

  discardDraft: () => call<{ discarded: boolean }>('admin/config/discard', { method: 'POST' }),

  staff: () => call<StaffResponse>('admin/staff'),

  saveStaff: (members: { uuid: string; role: Role }[], revision: number) =>
    call<StaffResponse>('admin/staff', { method: 'PUT', body: JSON.stringify({ members, revision }) }),

  queue: () => call<QueueResponse>('desk/queue'),

  act: (id: string, action: 'claim' | 'accept' | 'release' | 'resolve', outcome?: string) =>
    call<{ entry: QueueEntry }>(`desk/queue/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(outcome ? { outcome } : {}),
    }),

  diagnostics: () => call<Record<string, unknown>>('admin/diagnostics'),
}
