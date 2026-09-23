# Phase 3 — business setup, the staff desk, and what is actually live

Branch `claude/optimistic-einstein-ollvhw`. **Not merged and not deployed.**

Phase 2C gave Lobby a receptionist that could only be briefed by SSHing to the
server and hand-editing a JSON file, one tenant per host, with nobody able to
work the front desk. Phase 3 is the product around it: somewhere to configure
what the receptionist says, a separate act to publish it, roles, a queue, a desk
to work it from, and a booking journey that reaches the application that owns
bookings.

---

## The handoff table

The four columns mean four different things and the difference is the point of
the table.

- **Implemented** — the code exists and its tests pass.
- **Configured** — the settings this deployment needs are present.
- **Live-verified** — somebody has seen it work against the real thing.

A health check is not live verification. Neither is a `live` flag in a
capability report: that says a credential resolved, not that a model answered.

| Capability | Implemented | Configured | Live-verified | Remaining action |
| --- | --- | --- | --- | --- |
| Tenant-scoped configuration storage | yes | **no** | no | set `LOBBY_DATA_DIR` on the server, outside the document root |
| Draft / publish separation | yes | n/a | no | nothing — works as soon as storage is configured |
| Import of the Phase 2C `knowledge.json` | yes | n/a | no | nothing; the original file is never touched |
| Roles and staff list | yes | **no** | no | set `LOBBY_OWNER_UUIDS` to at least one portal uuid |
| Business setup screens (`/setup`) | yes | n/a | no | open them once storage and an owner exist |
| Reception queue + state machine | yes | n/a | no | nothing |
| Staff reception desk (`/desk`) | yes | n/a | no | nothing |
| Visitor "speak to a person" | yes | n/a | no | switch handover on under Visitor services |
| Reception conversation (Anthropic via Console) | yes | **no** | **no** | bind a credential to the `reception` module in Console |
| Booking through Appointments | yes | **no** | **no** | set `LOBBY_APPOINTMENTS_API_BASE` + `LOBBY_APPOINTMENTS_SERVICE_KEY`, and the company id in the setup screens |
| Enquiries | **no** | no | no | no owner endpoint exists in Connect or Helpdesk |
| Payments | no | no | no | out of scope; Pay is not live |
| Server speech / transcription | yes (2C) | no | no | optional; the browser voice is used otherwise |
| Operator diagnostic (CLI + `/diagnostics`) | yes | n/a | **partly** | the CLI was run here and reports correctly against an unconfigured host |
| Deploy excludes and smoke check | yes | yes | **partly** | the rsync filters were dry-run against a simulated server; the smoke check has not run in CI |
| The 3D character | yes (2E) | yes | no | still not the approved likeness — see RELEASE-2E.md |

**Nothing in the "Live-verified" column is a yes, and that is not modesty.**
`lobby.aicountly.com:443` is refused by this environment's network policy, so
no part of this phase has been exercised against the deployed host from here.
Everything marked implemented was verified locally: 76 PHP tests, 102 numeric
tests, 23 browser checks, a real 16-process concurrency test, real HTTP against
a stand-in Appointments, and real `rsync` against a simulated server.

---

## What has to happen before a visitor benefits

In order, because each one is blocked by the one above it.

1. **Bind an AI credential in Console.** Until this is done reception answers
   nothing in production — it returns 503 `conversation_unavailable` to every
   visitor, which is correct behaviour and is also a product that does not
   work. This was outstanding before Phase 3 and is still the single biggest
   gap. See [CONSOLE-AI.md](CONSOLE-AI.md).

2. **Set `LOBBY_DATA_DIR`** in `<docroot>/api/.env` to an absolute path outside
   the document root, e.g. `/home/lobbyaicountly/lobby-state/data`. Until this
   is set, the setup screens report that there is nowhere to save and reception
   keeps reading `knowledge.json` exactly as it did before.

3. **Set `LOBBY_OWNER_UUIDS`** to at least one AICOUNTLY portal uuid. Without
   it nobody can open the setup screens at all, because there is nobody to
   grant the first role. A person who signs in without access is shown their own
   uuid on screen, which is what goes here.

4. **Publish a configuration** at `/setup`. An existing `knowledge.json` is
   imported on the first read, so this is usually a review rather than typing.

5. **Optionally connect booking**: `LOBBY_APPOINTMENTS_API_BASE` and
   `LOBBY_APPOINTMENTS_SERVICE_KEY` on the server, and the Appointments company
   id under Visitor services.

`php api/tools/check-console-ai.php` on the server reports every one of these,
and prints no secret.

---

## What Lobby owns, and what it must not acquire

Three things: the tenant's approved reception configuration, the live reception
queue, and who has access to the desk.

Not: a company or branch master (Manage), a contact (Contacts), an appointment
or a calendar record (Appointments, which reaches Calendar itself), an invoice
(Billing), or a CRM record. Where a reference is stored — an Appointments
company id, a service's `appointmentTypeId` — it is a reference, exactly as
Appointments stores a reference uuid for a contact rather than a contact.

---

## Decisions worth knowing about

**Files, not a database.** `server-php` ships with no composer, no vendor
directory, no migration step and no database credentials. Adding one would
change how this product installs on every host it runs on, and a deployment
dependency that arrives attached to a feature is one nobody agreed to.
`Store\Repository` is the seam, so that decision can be taken later on purpose
rather than worked around.

**The store refuses to guess where to write.** Both deploys rsync `server-php/`
into `<docroot>/api` with `--delete`, so anything underneath that path which is
not in the repository is removed on the next deploy. Defaulting to the system
temp directory would have produced a product that saves a tenant's opening
hours and loses them at the next reboot.

**Two different concurrency primitives.** Optimistic revision checks for a
human at a form — two administrators must not silently overwrite each other.
An exclusive lock for two staff claiming the same visitor, because that is a
race to resolve rather than a conflict to report: telling the loser their copy
was stale would have a reasonable client retry and take a visitor somebody else
is already talking to.

**Staff availability is observed, not declared.** Loading the desk screen is a
heartbeat. There is no rota and no flag, because "somebody is available" with
nobody logged in is the one thing a reception product must never display: the
visitor sits down and waits on the strength of it. `LOBBY_DESK_ALWAYS_OPEN`
exists for deployments whose staff work elsewhere, and the diagnostic reports
it when it is on.

**Journeys are gated twice, and the gate is now connected to the interface.**
A journey a business has switched off is not offered to the model *and* is
dropped if the model proposes it anyway. Withholding the tool is what makes the
model behave; dropping the output is what makes it true.

Until this phase the interface ignored the result: it guessed which journey to
offer from a regex over the visitor's own words, so the careful server-side
allowlist reached nobody. Asking "can I speak to a person?" opened another text
box, and a business with booking switched off could still be shown a booking
chip. The chip now comes from the validated actions, with the keyword match as
the fallback for a reply that proposed nothing — which is what the
demonstration adapter relies on, having no actions to propose.

**One re-send, and only because Appointments replays.** See
[INTEGRATIONS.md → Retrying](INTEGRATIONS.md#retrying-and-why-there-is-exactly-one-re-send).

---

## Two things found on the way that were not part of the brief

**`api/tests/run.php` was answering 200 to anyone.** `server-php/` is rsynced
into the document root, so every file under it is a URL; the suite ran on each
request and printed server paths back to the caller. It has been like that since
Phase 2C. Both test files now refuse to run under a web SAPI — the guard
`tools/check-console-ai.php` always had — and both deploy workflows exclude
`tests/`. Found by dry-running the rsync rather than by reading the filter list.

**An empty `LOBBY_DATA_DIR=` wrote to the filesystem root.** An empty value is an
ordinary way to leave a setting unset in a `.env`; it made every path absolute
from `/`, so one tenant's configuration landed in `/acme/`. Empty and relative
roots are now refused and the store reports itself unconfigured. Found by
accident while setting up the concurrency test, then pinned with a test.

---

## Verification actually performed

| What | Result |
| --- | --- |
| PHP tests | 76/76 |
| Numeric tests | 102/102 |
| Browser checks | 23/23 |
| `npm run build` + `tsc -b` | clean |
| Concurrent claims, 16 real processes | 1 winner, 15 correctly refused |
| Same, with `LOCK_EX` removed | 16 winners — the test is not vacuous |
| Booking, over real HTTP against a fixture | confirmed / refused / uncertain / unavailable all reached |
| Retry carries the same idempotency key | asserted from what the fixture received |
| Deploy rsync against a simulated server | `.env`, `knowledge.json`, `data/` survive `--delete`; stale files removed; 0 files under `tests/` sent |
| Staff routes with a visitor token | 401 on all five, as a bearer and as `X-Lobby-Session` |
| Lip-sync lead, on a controlled clock | anchored at `onStart`, 700 ms after issue — a 0 ms lead |
| Mutation tests | draft-as-published fails 2; claim without a holder check fails 1; prompt-only journey gate fails 1; fresh retry key fails 1; reference-less 2xx accepted fails 1; anchoring at issue time fails 2; ignoring the validated actions fails 1 |

### Mutation testing, and why it is in this table

Every protection in this phase was checked by breaking it and watching a test
fail. A test that passes against both the correct code and the broken code is
not evidence, and there is no way to tell the two apart by reading it.
