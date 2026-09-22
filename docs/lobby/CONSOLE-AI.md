# Connecting reception to Console

Reception has never answered in production, and the reason has always been the
same: there was nowhere legitimate for its provider key to live. This is the
procedure that fixes that. It has two halves — one in Console, one on the Lobby
host — and neither works without the other.

No provider key is typed on the Lobby host at any point. That is the whole
design: `console.aicountly.org` holds the key encrypted, and Lobby fetches it
per request into memory. See
[RECEPTION.md → Where the key lives](RECEPTION.md#where-the-key-lives).

---

## Part 1 — in Console

### 1.1 Register Lobby in the AI registry

Console resolves credentials by `ai_domains.domain` and `ai_modules.module_key`,
and both come from migrations. Lobby has no rows yet, so Connected Accounts has
nothing to bind a Lobby key *to* and the resolve endpoint would 404 forever.

`console-react-app` carries the migration that adds them, on the branch
`claude/optimistic-einstein-ollvhw`:

    server-php/database/migrations/035_lobby_ai_registry.sql

It adds one domain (`lobby.aicountly.com`), the two Claude 5 model rows
reception can be bound to, and three modules — `reception`, `text_to_speech`,
`speech_to_text`. It is idempotent: every insert is `ON CONFLICT … DO NOTHING`,
so re-running it changes nothing.

**It is not merged and not deployed.** Take it through Console's own review and
deploy, then apply it on Console's host the way that repository applies
migrations:

```bash
cd ~/<console document root>/api        # wherever Console's server-php lives
php scripts/apply-sql-migration.php database/migrations/035_lobby_ai_registry.sql
```

### 1.2 Add the key

In Console → **AI Connected Accounts**:

1. Add a credential on the **lobby.aicountly.com** domain, provider
   **Anthropic**. Console encrypts it; the plaintext never leaves that form.
2. Bind it to the **reception** module as `primary`, against model
   **Claude Opus 5** (`claude-opus-5`) — or Claude Sonnet 5 for the same
   workload at lower cost. Reception reads the model from this binding, so
   changing it later is a Console change, not a deploy.

Leave `text_to_speech` and `speech_to_text` unbound unless a voice vendor has
actually been approved. Reception works without them: replies are spoken by the
browser's own voice, and the interface says which voice the visitor heard.

---

## Part 2 — on the Lobby host, from the WHM terminal

Three values go into `api/.env`, and **none of them is a provider key**:
Console's API base, the shared service key, and which Console domain this
deployment resolves under.

Run this as one block in **WHM → Terminal** (or as root over SSH). Set the first
line to the document root of the `lobby.aicountly.com` subdomain, then paste the
rest as-is. It is safe to re-run: nothing already in `.env` is overwritten.

```bash
(                                                # a subshell: a failed check
set -e                                           # cannot log you out of WHM

# ── 1. The one line you edit ────────────────────────────────────────────────
DOCROOT=/home/CPANELUSER/public_html             # ← the lobby subdomain's docroot

# ── 2. Work out who owns the account, so nothing is left owned by root ──────
API="$DOCROOT/api"
test -f "$API/index.php" || { echo "No Lobby API at $API — check DOCROOT."; exit 1; }
OWNER=$(stat -c '%U' "$DOCROOT")
GROUP=$(stat -c '%G' "$DOCROOT")
echo "Account: $OWNER:$GROUP   API: $API"

# ── 3. The Console service key, read without putting it in shell history ────
printf 'Console service key (input hidden): '
read -rs CONSOLE_SERVICE_KEY
echo
test -n "$CONSOLE_SERVICE_KEY" || { echo "Nothing entered — stopping."; exit 1; }

# ── 4. Create .env if it is not there yet, then append only what is missing ─
touch "$API/.env"
add() { grep -q "^$1=" "$API/.env" || printf '%s=%s\n' "$1" "$2" >> "$API/.env"; }

grep -q '^APP_ENV=' "$API/.env" || echo 'APP_ENV=production' >> "$API/.env"
add CONSOLE_API_URL       'https://console.aicountly.org/api'
add CONSOLE_SERVICE_KEY   "$CONSOLE_SERVICE_KEY"
add CONSOLE_AI_DOMAIN     'lobby.aicountly.com'
add AI_CREDENTIALS_SOURCE 'console'
add LOBBY_TENANT_ID       'default'

# A signed visitor session is required before reception will answer anyone.
# Generated here, once, and never regenerated on a re-run.
grep -q '^LOBBY_SESSION_SECRET=' "$API/.env" || \
  printf 'LOBBY_SESSION_SECRET=%s\n' "$(php -r 'echo bin2hex(random_bytes(32));')" >> "$API/.env"

# Rate-limiter counters, deliberately OUTSIDE the document root.
STATE="/home/$OWNER/lobby-state"
add LOBBY_STATE_DIR "$STATE"
mkdir -p "$STATE"

# Approved business knowledge. Copied from the template — it ships with
# placeholders and no invented business details, so EDIT IT before going live.
test -f "$API/knowledge.json" || cp "$API/knowledge.example.json" "$API/knowledge.json"
add LOBBY_KNOWLEDGE_FILE "$API/knowledge.json"

# ── 5. Ownership and permissions ────────────────────────────────────────────
chown "$OWNER:$GROUP" "$API/.env" "$API/knowledge.json"
chown -R "$OWNER:$GROUP" "$STATE"
chmod 600 "$API/.env"            # the service key is in here
chmod 640 "$API/knowledge.json"
chmod 750 "$STATE"

# ── 6. Ask the server whether it is actually wired up ───────────────────────
# tools/ arrives with the next API deploy; until then this line says "No such
# file" and everything above it has still been done correctly.
sudo -u "$OWNER" php "$API/tools/check-console-ai.php"
)
```

The check prints no secret — only whether each piece is present and what Console
said — so its output is safe to paste into a thread. A green run looks like
this:

```
 ok   Console API configured             CONSOLE_API_URL and CONSOLE_SERVICE_KEY are both set
      Console domain                     lobby.aicountly.com
 ok   Console has a reception binding    anthropic / claude-opus-5
 ok   Reception can answer               credential source: console, model: claude-opus-5
 ok   Visitor sessions                   LOBBY_SESSION_SECRET is set and long enough
 ok   Approved knowledge                 7 section(s) — business, hours, locations, …
 ok   Rate limiter state directory       /home/CPANELUSER/lobby-state
```

Then, from anywhere:

```bash
curl -s https://lobby.aicountly.com/api/lobby/capabilities
```

`"mode":"live"` means a visitor can hold a real conversation. `"unavailable"`
means they cannot, and reception will say so rather than pretending — there is
no third state, and it never falls back to the demonstration script while
claiming to be live.

That endpoint is public, so it deliberately names no provider, no model and no
configuration gap. The per-variable detail is only returned to a caller holding
a valid portal session; the script above is how you see it without one.

---

## If the check fails

| It says | What it means |
| --- | --- |
| `Console API configured` fails | `CONSOLE_API_URL` / `CONSOLE_SERVICE_KEY` are not both in `api/.env`, or PHP cannot read the file. Check the `chown` step ran. |
| `Console has a reception binding` fails | Console answered, but not with a usable credential. Either migration 035 has not been applied, or nothing is bound to the `reception` module, or the binding is revoked. The hint on that line says which. |
| `Reception can answer` fails while the binding is fine | The binding is for a provider other than Anthropic. That is refused on purpose: rewriting the request to suit it would post a live key belonging to another vendor to Anthropic's endpoint. |
| Everything is green, `/api/lobby/capabilities` still says `unavailable` | The CLI and the web request are reading different files. Confirm the subdomain's document root is the one you set as `DOCROOT`. |

A Console outage makes reception report unavailable rather than falling back to
a local key. That is deliberate — see
[RECEPTION.md → Where the key lives](RECEPTION.md#where-the-key-lives). If you
genuinely need the old behaviour on one host, set `AI_CREDENTIALS_SOURCE=auto`
and `LOBBY_AI_API_KEY=…`; it will fall back and log each time it does.

---

## Rotating the key later

In Console, on the credential. Nothing is done on the Lobby host and nothing is
deployed: the resolved answer is held for a few minutes at most, so a rotation
takes effect on its own. That is the reason the key moved to Console.
