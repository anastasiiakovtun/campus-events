# Campus Events

Campus Events is a full-stack application for browsing campus events, registering
attendees, and tracking available seats. It was developed for Advanced Development
at Thomas More.

[Live application](https://campus-events-1-g4or.onrender.com/) ·
[API health](https://campus-events-1-g4or.onrender.com/api/health)

## Implemented features

- Browse and create events through the Vue interface.
- Create, retrieve, update, and delete events through the REST API.
- Register attendees with input validation, duplicate-email checks, and capacity checks.
- View registration counts, remaining seats, and occupancy statistics.
- Save confirmation emails durably and retry SMTP failures in the background.
- Cache GET responses in memory with a configurable TTL and invalidation after writes.
- Store data in SQLite locally or PostgreSQL when `DATABASE_URL` is configured.
- Query upcoming and past events and register an attendee through MCP tools.

Real-time notifications are not implemented yet.
See [current limitations](#current-limitations).

## Setup

Requirements: Node.js 22.12 or newer, npm, and Git.

```bash
git clone https://github.com/anastasiiakovtun/campus-events.git
cd campus-events
npm ci
npm run dev
```

Open the frontend at http://localhost:5173. The API runs at
http://localhost:3000/api, with a health endpoint at `/api/health`.

A fresh clone needs no environment file or external services. The workspace
scripts use SQLite at `api/data/events.sqlite` by default. On startup, the API
creates missing tables and adds demo data if the events table is empty.

### Local PostgreSQL with Neon

With the Neon CLI installed, authenticate and link the repository to your Neon
project, then select a development branch:

```bash
neon login
neon link
neon checkout development --create
npm run dev
```

Checkout updates the ignored `.neon` and root `.env.local` files. The API loads
the connection URL automatically. A new `development` branch copies production's
schema and data, then stores its own changes independently. The policy in
`neon.ts` keeps this named branch without automatic expiry; other new temporary
branches expire after seven days. Checking out an existing branch preserves its data.

Render must keep its own `DATABASE_URL` pointed at `production`. Local Neon
checkout does not change Render's environment settings.

## Configuration

Create `api/.env` from [api/.env.example](api/.env.example) when overrides are needed.
The API reads configuration in this order; the first defined value wins:

1. Variables injected into the process, including Render environment settings.
2. `api/.env.local`.
3. `api/.env`.
4. Repository-root `.env.local`.
5. Repository-root `.env`.
6. Defaults in [api/src/config/env.mjs](api/src/config/env.mjs).

Env file paths are resolved relative to the configuration module, independently
of the startup directory. Keep credentials and connection URLs out of Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode; `test` isolates the database and skips local env files. |
| `PORT` | `3000` | API listening port. |
| `DATABASE_URL` | Unset | PostgreSQL connection URL; takes precedence over `DB_STORAGE`. |
| `DB_STORAGE` | `./data/events.sqlite` | SQLite file, relative to the API process's working directory. |
| `SMTP_URL` | Unset | SMTP transport URL; without it, jobs remain pending and the email worker is disabled. |
| `MAIL_FROM` | `Campus Events <no-reply@campus-events.test>` | Sender address for confirmation emails. |
| `MAIL_POLL_INTERVAL_SECONDS` | `5` | Delay between completed email-worker batches. |
| `MAIL_RETRY_BASE_SECONDS` | `30` | Initial retry delay after an SMTP failure. |
| `MAIL_RETRY_MAX_SECONDS` | `3600` | Maximum exponential retry delay. |
| `CACHE_TTL_SECONDS` | `60` | Lifetime of cached GET responses. |
| `LOG_LEVEL` | `info` | Application logging level. |
| `MCP_ALLOWED_HOSTS` | Localhost addresses and `RENDER_EXTERNAL_HOSTNAME`, when set | Comma-separated hostnames allowed in MCP Host and Origin headers; an explicit value replaces the defaults. |

Changing the API port also requires updating the proxy target in
[web/vite.config.js](web/vite.config.js) for local frontend requests.

`npm run seed` deletes and recreates the configured database tables with demo
data. Check the selected database first: if a local env file points to production,
local writes and seeding affect production too.

### Confirmation email delivery

Registration and a pending email job are committed in the same database
transaction. The job stores the recipient and message content, so later event
edits do not change the confirmation. SMTP is handled outside the HTTP request.

The API starts an email worker when `SMTP_URL` is set. It processes up to ten jobs
per batch, retries failures with exponential backoff, and marks a job sent only
after SMTP accepts its recipient. Failed jobs are retained without an attempt
limit. Error codes and job identifiers are logged instead of message contents.

Database claims coordinate multiple API instances. Claims are renewed during
delivery; abandoned claims become eligible again after their two-minute lease
expires. Retries reuse the same message ID. Delivery is at least once: a crash
after SMTP acceptance but before the database acknowledgement can cause a resend.
SMTP acceptance does not guarantee arrival in the recipient's inbox.

Without `SMTP_URL`, jobs stay pending without simulated delivery. Set a reachable
SMTP URL and a provider-approved `MAIL_FROM`, then restart or redeploy the API.
The worker runs inside the API process; when the host sleeps or stops it, pending
jobs resume when the process runs again.

## Architecture

The repository uses npm workspaces:

| Location | Responsibility |
| --- | --- |
| `api/src/` | Node.js / Express API, Zod validation, Sequelize models, mail, and caching. |
| `web/src/` | Vue 3 interface, Vue Router, and the shared HTTP client. |
| `api/tests/` | HTTP integration tests and configuration unit tests using `node:test`. |
| `web/tests/` | Vue component and HTTP-client tests using Vitest. |
| `neon.ts` | Neon branch policy and service configuration. |

API request handling follows routes → controllers → services → repositories.
Services hold business rules; repositories use Sequelize models to access data.
Runtime configuration is loaded in `api/src/config/env.mjs`.

In development, Vite serves the interface and proxies `/api/*` to Express.
Express uses SQLite by default, or the Neon development database when configured.
In production, Express serves both the Vue build (`web/dist`) and `/api/*` from
one origin, with data stored in Neon PostgreSQL. Vue Router history fallback
supports direct navigation to frontend routes.

## API

All API routes use the `/api` prefix. There is no API index at `/api`.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/health` | Check API and database connectivity. |
| GET / POST | `/api/events` | List events by start date / create an event. |
| GET / PATCH / DELETE | `/api/events/:id` | Retrieve, partially update, or delete an event. |
| GET / POST | `/api/events/:id/registrations` | List registrations / register an attendee. |
| GET | `/api/stats` | Event occupancy and availability statistics. |

Creating an event requires `title`, `location`, `startsAt`, and `capacity`.
`description` is optional. Supply `startsAt` as an ISO 8601 date-time string and
`capacity` as an integer. Registration requires a `name` and a valid `email`;
email addresses are normalized to lowercase.

Event details include `registered` and `spotsLeft`. Invalid input returns 400,
missing resources return 404, and duplicate registrations or full events return
409. Errors use a consistent JSON envelope, with optional `details` for validation:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Event with id 999 not found"
  }
}
```

### MCP event tools

The MCP endpoint is `/api/mcp`, served by the official MCP SDK over Streamable
HTTP. It is stateless. The two listing tools expose public event data without
attendee names or email addresses; the registration tool returns the attendee
record it creates. Like the current REST API, these tools do not require
authentication.

| Tool | Result |
| --- | --- |
| `get_upcoming_events` | Events starting at or after the current instant, soonest first. |
| `get_past_events` | Events starting before the current instant, oldest first. |
| `register_for_event` | Registers one attendee using the existing registration service and queues a confirmation email. |

The two listing tools accept an empty object (`{}`) and return `{ events: [...] }` as
structured content and JSON text. Each event includes `registered` and
`spotsLeft`. Dates are compared as instants, independently of timezone offsets.
Filtering happens on every call, even when the underlying event list is cached.

`register_for_event` requires `eventId` (a positive integer), `name`, and `email`.
It reuses the website's name/email validation, name trimming, email normalization,
duplicate checks, capacity rules, cache invalidation, and transactional email
outbox. Success returns `{ registration: {...} }` as structured content and JSON
text; it means registration is saved and confirmation mail is queued, not yet
delivered. Known service errors preserve codes such as `CONFLICT` and `NOT_FOUND`.

The tool is marked as writing data and not idempotent: repeating a completed
registration returns a duplicate error instead of creating another registration
or email job. Assistants should confirm the event and each attendee's identity
before calling. A call registers one person; separate calls for a group are not
atomic, so they can partially succeed. Concurrent capacity and duplicate
protection retain the limitations described below.

Configure an MCP client with the endpoint URL
`https://campus-events-1-g4or.onrender.com/api/mcp` (locally,
`http://localhost:3000/api/mcp`). This is a protocol endpoint, not a browser page.
The SDK supports modern clients and stateless 2025 Streamable HTTP clients.
For example, discover the tools from a local running API:

```bash
curl http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Responses may use SSE framing (`data: {...}`). Invalid tool calls use MCP's
JSON-RPC errors; tool execution failures return `isError: true` with the project's
`{ error: { code, message } }` envelope and no internal database details.
Untrusted Host or Origin headers receive HTTP 403. For a custom hostname, set
`MCP_ALLOWED_HOSTS` to every hostname you intend to allow, including localhost
if needed; omit schemes and ports. Non-browser clients may omit Origin.

## Testing

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and frontend with automatic reload. |
| `npm run check` | Run ESLint and all API/frontend tests. |
| `npm test -w api` | Run API integration and unit tests. |
| `npm test -w web` | Run frontend tests. |
| `npm run lint` | Run ESLint. |
| `npm run build` | Build the frontend for production. |
| `npm run start -w api` | Start Express, serving the frontend if built. |
| `npm run seed` | Destructively reset the configured database to demo data. |

API tests run with `NODE_ENV=test`, which forces in-memory SQLite and ignores
`DATABASE_URL`, `DB_STORAGE`, and local env files. Tests need no Neon database,
Redis, RabbitMQ, or an external SMTP service. A local SMTP fixture tests rejection
and recovery. Coverage includes API behavior, outbox transactions, retries, worker
coordination, cache invalidation, env loading, branch policy, and Vue components.
MCP tests cover date boundaries, seat counts, privacy, invalid calls, header
validation, safe failures, and a real HTTP connection with the official client.
Registration tests also cover input normalization, REST/MCP duplicate protection,
full or missing events, saved email jobs, and rollback when enqueueing fails.

The GitLab CI configuration in [.gitlab-ci.yml](.gitlab-ci.yml) runs lint and tests.
For manual persistence checks, see [Deployment](#deployment).

## Deployment

The frontend and API run as one Render web service connected to Neon PostgreSQL.

| Render setting | Value |
| --- | --- |
| Branch | `main` |
| Root Directory | Empty (repository root) |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start -w api` |
| Health Check Path | `/api/health` |

Set `NODE_ENV=production` and add the production branch's pooled PostgreSQL URL
as `DATABASE_URL` in Render's Environment settings. Keep the URL's TLS settings
(such as `sslmode=require`). Do not commit the URL or send it in chat.

After deployment, verify the homepage and `/api/health`. To test persistence,
create a clearly labelled event and test registration, restart the Render service,
verify the same records and seat count remain, then remove the temporary records.

Render's local filesystem is ephemeral, so a local SQLite file is not persistent
storage there. Changing from SQLite to PostgreSQL does not migrate existing
records automatically; back up and transfer any required data before switching.

Render's Free service blocks outbound SMTP ports 25, 465, and 587. Configure an
SMTP endpoint on a port the host permits, or choose a deployment/delivery setup
that supports your provider. Retries cannot overcome a permanently blocked port.
See [Render's network limitations](https://render.com/docs/free#other-limitations).

## Current limitations

- Email delivery requires a reachable SMTP service. Retries survive restarts,
  but run only while the API process is active and do not provide exactly-once delivery.
- Registration checks are sequential application checks, not an atomic capacity
  reservation. Concurrent requests can bypass capacity or duplicate checks.
- The in-memory cache belongs to one API process; invalidation is not shared
  across multiple instances.
- SSE notifications and Redis-backed notification distribution remain planned work.
