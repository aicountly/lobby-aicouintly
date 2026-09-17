/**
 * The contract the reception desk is written against.
 *
 * Two implementations satisfy it and they never meet: `demoAdapter` runs
 * entirely in the browser and writes nothing anywhere, `liveAdapter` calls the
 * owning application over its API. The interface is the seam — the interface
 * code cannot tell which one it is talking to, which is what keeps the demo
 * journeys from quietly becoming the production ones.
 *
 * There is no third state. A capability either succeeds or reports itself
 * unavailable with a reason; nothing here may return a success it did not get.
 */

export type ServiceMode = 'demo' | 'live'

export interface ServiceUnavailable {
  status: 'unavailable'
  /** The application that owns this capability, named for the visitor. */
  integration: string
  /** Why it cannot be used, in a sentence a non-engineer can act on. */
  reason: string
}

export interface ServiceOk<T> {
  status: 'ok'
  mode: ServiceMode
  data: T
}

export type ServiceOutcome<T> = ServiceOk<T> | ServiceUnavailable

export function isOk<T>(outcome: ServiceOutcome<T>): outcome is ServiceOk<T> {
  return outcome.status === 'ok'
}

export interface ServiceOption {
  id: string
  label: string
  description: string
  durationMinutes: number
}

export interface AvailabilitySlot {
  id: string
  time: string
  label: string
}

export interface BookingRequest {
  serviceId: string
  date: string
  slotId: string
  name: string
  email: string
  notes: string
}

export interface BookingReceipt {
  reference: string
  serviceLabel: string
  date: string
  time: string
  /** True when nothing was written anywhere. Rendered as a demo badge. */
  demo: boolean
  note: string
}

export interface EnquiryRequest {
  topic: string
  name: string
  email: string
  message: string
}

export interface EnquiryReceipt {
  reference: string
  demo: boolean
  note: string
}

export interface ReceptionTurn {
  role: 'visitor' | 'reception'
  text: string
}

export interface ReceptionReply {
  text: string
  demo: boolean
  /** Follow-up prompts the visitor can tap. */
  suggestions: string[]
}

export interface LobbyServiceAdapter {
  readonly mode: ServiceMode
  /** One line describing what this adapter does, shown in the interface. */
  readonly description: string
  listServices(): Promise<ServiceOutcome<ServiceOption[]>>
  listAvailability(serviceId: string, date: string): Promise<ServiceOutcome<AvailabilitySlot[]>>
  requestBooking(request: BookingRequest): Promise<ServiceOutcome<BookingReceipt>>
  submitEnquiry(request: EnquiryRequest): Promise<ServiceOutcome<EnquiryReceipt>>
  askReception(question: string, history: ReceptionTurn[]): Promise<ServiceOutcome<ReceptionReply>>
}
