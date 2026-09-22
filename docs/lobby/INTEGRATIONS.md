# Aicountly Lobby — integrations

Lobby is the front door. It holds no business data of its own and it is not
allowed to acquire any: no mirrored appointment table, no cached calendar, no
database credentials for another product, no scheduled job copying rows between
applications. Where it needs something another Aicountly application owns, it
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

Nothing. In `live` mode every capability reports unavailable, and the reasons
below are what it says.

### Appointments and availability — owned by Aicountly Appointments

Appointments owns booking workflows and reaches Aicountly Calendar itself
through the agreed integration. **Lobby must never call Calendar directly**, and
must never keep a copy of an appointment or a calendar record.

Blocked on two things, in order:

1. `VITE_LOBBY_APPOINTMENTS_API_BASE_URL` is unset.
2. Appointments has published no booking API contract for Lobby to call.

At the time of writing, `appointments-aicountly` is the same blank
scaffold as this repository — `/api/health`, the portal auth relay, and nothing
else. There is no endpoint to call, so `liveAdapter` does not guess one. An
invented path and payload would compile, pass review, and fail the first time
anyone switched it on.

To wire it up, Appointments needs to publish, and Lobby needs to implement
against:

| Capability | What Lobby needs back |
| --- | --- |
| List bookable appointment types | id, label, description, duration |
| Availability for a type and date | slot id, start time, timezone |
| Request a booking | the created appointment's reference, or a typed refusal |

Also required before that work starts: whether a lobby visitor is anonymous or
must be identified, and what authenticates the call. Lobby is a public surface
(see below), so it cannot hold a secret — any credential has to be held by
`server-php` and the call relayed, the same way the portal auth relay already
works.

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

### Enquiries — Aicountly Connect / Helpdesk

Not connected. No owner endpoint is configured, so accepting an enquiry in live
mode would mean dropping it while telling the visitor it had been sent.

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
