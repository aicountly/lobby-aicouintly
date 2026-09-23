# Aicountly Lobby — integrations

Lobby is the front door. It holds no business data of its own and it is not
allowed to acquire any: no mirrored appointment table, no cached calendar, no
database credentials for another product, no scheduled job copying rows between
applications.

As of Phase 3 it owns exactly three things, and must never acquire a fourth:
the tenant's approved reception configuration, the live reception queue, and
who has access to the desk. A service entry may carry an `appointmentTypeId`
and a tenant may carry an Appointments company id — those are **references**,
the same way Appointments holds a reference uuid for a contact rather than a
contact. Where it needs something another Aicountly application owns, it
asks that application over its API, at the moment it needs it, and shows what
comes back.

That constraint is what the service layer is shaped around.

## Two adapters, kept apart

| | `demoAdapter.ts` | `liveAdapter.ts` |
| --- | --- | --- |
| Selected by | `VITE_LOBBY_SERVICE_MODE` unset or `demo` (the default) | `VITE_LOBBY_SERVICE_MODE=live` |
| Talks to | nothing | the owning application |
| Writes | nothing, anywhere | whatever that application does |
| Receipts | flagged `demo: true`, rendered with a **Demo** badge | flagged `demo: false` |

They satisfy the same interface (`services/types.ts`) and **never import each
other**. That is the point: a demonstration journey that could fall through to a
production call is not a demonstration, and a production adapter that could fall
back to canned data would report success it never got.

There is no third outcome. Every capability returns either a result or

```ts
{ status: 'unavailable', integration: 'Aicountly Appointments', reason: '…' }
```

which the interface renders as a named, actionable notice. Nothing in the lobby
may invent a booking reference, a delivery confirmation or an answer.

## What is connected today

| Capability | Owner | State |
| --- | --- | --- |
| Reception conversation | Lobby (Console holds the key) | implemented; needs a Console binding |
| Booking, availability, appointment types | Aicountly Appointments | **implemented**, server-relayed |
| Speak to a person | Lobby | **implemented** — the queue and the staff desk |
| Enquiries | Connect / Helpdesk | not connected — no owner endpoint |
| Payments | Aicountly Pay | not connected |
| Calendar records | Aicountly Calendar | never directly; only through Appointments |

In `live` mode anything not implemented reports unavailable with a named
reason, and the reasons below are what it says.

### Appointments and availability — owned by Aicountly Appointments

Appointments owns booking workflows and reaches Aicountly Calendar itself
through the agreed integration. **Lobby must never call Calendar directly**, and
must never keep a copy of an appointment or a calendar record.

### Correction

An earlier version of this page said Appointments was "the same blank scaffold
as this repository", with no endpoint to call. **That was wrong, and it was
wrong for some time.** `appointments-aicountly` is a full application — a
router, controllers, a domain layer, migrations, a client for every other
product on the fleet — and it publishes the routes below. Lobby's booking
journey was refusing visitors on the strength of a paragraph nobody rechecked.

### What is implemented

Lobby calls Appointments. The direction matters: Appointments asks Lobby for
almost nothing (aggregate contribution figures and a deep link, neither of
which Lobby serves yet).

| Route | Used for |
| --- | --- |
| `GET v1/services` | the appointment types a visitor may book |
| `GET v1/availability/slots` | free times for a type on a date |
| `POST v1/bookings` | make the booking |

Authenticated with `X-Service-Key`, which is why the call is made by
`server-php` and not by the browser: every `VITE_*` value is inlined into the
bundle at build time and is public.
`Auth::provenBookingSource()` in Appointments derives the booking source from
the authenticated caller, so a booking made this way is recorded as
`RECEPTIONIST` — a caller cannot claim that by putting it in a payload.

`VITE_LOBBY_APPOINTMENTS_API_BASE_URL` is **not** what connects it, and is kept
only so an existing `.env` does not break. Booking is configured with
`LOBBY_APPOINTMENTS_API_BASE` and `LOBBY_APPOINTMENTS_SERVICE_KEY` in the
server's `.env`, plus the Appointments company id in the setup screens.

### Retrying, and why there is exactly one re-send

A `POST` that fails at the transport layer is **uncertain**: the booking may
exist and the answer may have been lost. Retrying blind gives one visitor two
appointments.

Appointments implements `Idempotency-Key` with a stored replay — the
`appointment_idempotency_keys` table, and `Idempotency::replay()` at the top of
`BookingsController::create`. So Lobby's single re-send carries the **same**
key, which makes it a status check rather than a retry: if the first attempt
landed, the second returns that booking rather than making another.

That is the whole justification, and it holds only while Appointments keeps
that behaviour. `server-php/tests/fixtures/fake-appointments.php` honours the
replay, so if it ever stops, those tests are what should start failing.

Four outcomes, rendered as four different things: **confirmed** (Appointments
named it), **refused** (with its reason, so the visitor can pick another time),
**uncertain** (two attempts, no answer — the visitor is told to check rather
than shown a confirmation), and **unavailable**. A 2xx with no reference in it
is uncertain too.

Appointments answers `503 calendar_unavailable` rather than an empty slot list
when the calendar is what failed, and that distinction is preserved all the way
to the visitor: "we could not look" must never render as "nothing is free".

### Reception AI — owned by Lobby

Lobby has its own reception AI. **Aicountly Console governs the model
credentials**, which means the credential is never in this repository and never
in the browser: every `VITE_*` value is inlined into the bundle at build time
and is public. A key in one is a published key.

So the reception AI answers through this product's own PHP API, which obtains
its credential from Console server-side on
`GET /ai/credentials/resolve?domain=lobby.aicountly.com&module=reception`. That
route now exists: `server-php/src/Ai/ConsoleCredentials.php`, wired into
`POST /api/lobby/reception`. Nothing in the browser and nothing in this server's
`.env` is a provider key — see
[RECEPTION.md → Where the key lives](RECEPTION.md#where-the-key-lives) and the
setup procedure in [CONSOLE-AI.md](CONSOLE-AI.md).

The older `VITE_LOBBY_RECEPTION_AI_PATH` contract below predates that route and
is still honoured for a deployment pointing at something else; it is unset by
default.

The client side is already written against a contract this repository owns:

```
POST <api base>/<VITE_LOBBY_RECEPTION_AI_PATH>
  { "question": string, "history": [{ "role": "visitor" | "reception", "text": string }] }
→ { "reply": string, "suggestions"?: string[] }
```

Anything else — a non-2xx, an empty `reply`, an unreachable host — is reported
as unavailable rather than smoothed over.

In demonstration mode the same capability is answered by a keyword-matched
script in `demoAdapter.ts`. There is no model behind it, and the interface says
so on the screen the visitor is looking at.

### Speak to a person — owned by Lobby

Implemented in Phase 3. A visitor asking for a human joins a queue that staff
work from `/desk`, with the state machine `requested → queued → assigned →
accepted → resolved`.

Two properties are load-bearing:

- **Availability is observed.** Loading the desk screen is a heartbeat, and a
  visitor is only queued while one is fresh. There is no rota, no opening-hours
  table and no flag an administrator can set, because "somebody is available"
  with nobody logged in is the one thing a reception product must never
  display: the visitor sits down and waits on the strength of it.
- **A claim is exclusive.** Two staff pressing "Take" at the same instant is a
  race, resolved under an exclusive lock, and the loser is told it is taken.
  Verified with 16 concurrent processes: one winner. With the lock removed, all
  sixteen win.

The queue holds a name, a one-line reason and timestamps. It does not hold the
conversation: Lobby keeps a transcript for the length of a visitor's session and
does not log it. This is not a CRM and not a ticketing system.

### Enquiries — Aicountly Connect / Helpdesk

Not connected. No owner endpoint is configured, so accepting an enquiry in live
mode would mean dropping it while telling the visitor it had been sent.

This is the one journey that stays available to the receptionist regardless,
because "I do not know, but I can take a message" has to be reachable — but the
message currently goes nowhere, and the interface says so.

### Payments — Aicountly Pay

Not connected in this phase.

## The public surface

`/lobby` renders without signing in. This is a deliberate decision and worth
stating plainly, because it is the only unauthenticated route in the product:

- The room is generated geometry. There are no assets and no data in it.
- In demonstration mode — the default — the page makes no API call at all.
- It reads no tenant, customer, appointment or calendar record.
- The dashboard at `/` is unchanged: the portal round-trip still happens exactly
  as it did, and signing in still gates everything behind it.

Set `VITE_LOBBY_PUBLIC_PATH=` (empty) to withdraw the public route entirely.

Before switching `VITE_LOBBY_SERVICE_MODE=live`, decide what an anonymous
visitor is allowed to do, because at that point a public page starts making real
calls to applications that own real data. That is a product and security
decision, not a configuration one.
