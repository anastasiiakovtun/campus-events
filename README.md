# Campus Events

Starter project for **Advanced Development** (Thomas More – International Experience Design, year 3).

A small but complete web app: students browse campus events and register for them.

- **api/** : REST API: Node.js, Express 5, Sequelize + SQLite locally / PostgreSQL online, Zod
- **web/** : frontend: Vue 3, Vue Router, Vite

It works out of the box, and it has tests. The API has been cleaned up, deployed to production, fixed and extended
with confirmation mail and caching.

## Quick start

You need **Node.js 22.12 or newer** (`node -v`) and Git.

```bash
git clone <your-fork-url>
cd campus-events
npm install        # installs api + web in one go
npm run dev        # starts both
```

Open **http://localhost:5173**. The API runs on http://localhost:3000/api.
The first start fills the database with demo events. `npm run seed` resets it.

The API automatically reads env files relative to the repository, so starting it
from the root or the API workspace works the same way. Priority is: injected
environment variables, `api/.env.local`, `api/.env`, root `.env.local`, root `.env`,
then defaults. Missing files are optional. Tests skip these files entirely.
Neon's root `.env.local` is picked up without an extra command. If it points to
production, local writes and `npm run seed` affect that production database too;
use a development branch's URL to keep local data separate.

Later parts need a few services. You never need them to run the tests.

| Service | Local | Setting in `api/.env` |
|---|---|---|
| RabbitMQ | `docker compose up -d rabbitmq` | `AMQP_URL` |
| Redis | `docker compose up -d redis` | `REDIS_URL` |
| Identity provider | a free Auth0 tenant | `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_CLIENT_ID` |

## Scripts (run from the root folder)

| Script | What it does |
|---|---|
| `npm run dev` | API + frontend with auto-reload |
| `npm test` | All tests: API (node:test + supertest) and frontend (Vitest) |
| `npm run lint` | ESLint for the whole project |
| `npm run check` | Lint + tests. **The pipeline runs exactly this. It must be green before you hand in.** |
| `npm run seed` | Reset the database to the demo data |
| `npm run build` | Production build of the frontend |

## How it fits together

```
browser ──► web (Vite, :5173) ──/api/*──► api (Express, :3000) ──► SQLite (api/data/events.sqlite)
```

In development Vite forwards every `/api/...` request to the API (see `web/vite.config.js`),
so the browser only talks to one address and you don't need CORS.

### api/

## Assignment: what I changed

**Live app:** https://campus-events-1-g4or.onrender.com/
**Live API:** https://campus-events-1-g4or.onrender.com/api (try `/api/events`, `/api/stats`, `/api/health`)

For a single Render web service, leave Root Directory empty, use
`npm ci --include=dev && npm run build` as the build command and
`npm run start -w api` as the start command. The API serves `web/dist` after the
frontend build, including Vue Router's direct browser routes.

### Persistent database on Render

Render's free web service does not preserve local SQLite changes across restarts
or redeployments. Use a separate PostgreSQL database, such as Neon's Free plan:

1. Create a Neon PostgreSQL project and copy its connection URL from **Connect**.
2. In the Render service's **Environment** settings, add `DATABASE_URL` with that
   URL. Keep the URL's `sslmode=require` parameter and never commit credentials.
3. Deploy the PostgreSQL connection code, then save the environment setting and
   redeploy. When `DATABASE_URL` is set, the API uses PostgreSQL with TLS and
   certificate verification; otherwise it uses the local SQLite file.

The API creates missing tables and adds demo data if there are no events. This
starts a separate database: existing SQLite events and registrations are **not
automatically transferred**. Export any data you need before switching or
redeploying the current SQLite service. `npm run seed` resets whichever database
is configured, so do not run it against hosted data you want to keep.

Tests always use in-memory SQLite when `NODE_ENV=test`, ignoring `DATABASE_URL`
and `DB_STORAGE` to avoid resetting a real database.

To verify persistence after setup, create a clearly labelled test event and
register a test person through the website. Note the event ID and seat count,
restart the Render web service, and confirm that the same event and registration
remain. Use test details rather than a real person's contact information.

**Verified on 21 November 2026:** creating a temporary event and a test
registration through the live API returned HTTP 201, and both records were
confirmed directly in Neon PostgreSQL. After restarting the Render service, the
same records remained, with one registration and one seat left. The temporary
event and its registration were then removed; the original four events and three
registrations still matched the private backup.

References: [Render storage](https://render.com/docs/free#local-files-lost-on-redeploy),
[Neon with Sequelize](https://neon.com/docs/guides/sequelize).

1. **Clean up and split logic.** `api/src/app.mjs` was split into layers:
   routes → controllers → services → repositories → models, plus `middleware/` (validation, error handling,
   request logging), `config/env.mjs` (the only file that reads `process.env`) and `utils/` (logger, AppError, cache, mailer).
   The teacher's integration tests pass without changes. Also fixed a bug: a full event still accepted one more person
   (`count > capacity` → `>=`), with a new test in `tests/integration/capacity.test.mjs`.
2. **Confirmation mail.** After a registration is saved, the mail is sent in the background (no `await`) with `.catch()`.
   The user gets the answer right away, and if the mail server is slow or offline, the registration is still stored.
   Tested in `tests/integration/mail.test.mjs` with an offline mail server.
3. **Caching for GET endpoints.** Cache-aside with a TTL (`utils/cache.mjs`). Every change (create, update, delete,
   register) deletes the cache keys that are now wrong. Tested in `tests/integration/cache.test.mjs`.
4. **Online.** Deployed on Render (auto-deploys on every push to `main`).

### Stack Overflow links I used

- https://stackoverflow.com/questions/41875617/building-enterprise-app-with-node-express
  **Why:** In the old `app.mjs` everything was in one file, some things were mixed up and it was really hard to read.
  The person in this question had the same problem: the controller did everything (request, validation and business rules).
  They wanted separate layers: controller for the web part, service for the business rules, and a data layer for the database.
  I used this idea to split my project into routes, controllers, services and repositories.
- https://stackoverflow.com/questions/49657914/down-side-on-calling-async-function-without-await
  **Why:** The person wants to call an async function without waiting for it to finish, like my confirmation mail:
  the user should get the answer right away. The answer warns that you still have to handle the errors, otherwise Node.js
  can crash. That's why I call `sendRegistrationConfirmation()` without `await`, but with `.catch()`, so if the mail server
  is offline, the error is only logged and the registration stays saved.
- https://stackoverflow.com/questions/19477821/redis-cache-vs-using-memory-directly
  **Why:** The person asks why to use Redis if you can store the cache in a normal object in memory. The answer explains
  that memory is faster, but Redis is needed when the app runs on several servers that share the same cache.
  We have only one copy of the API, so I used an in-memory cache with a TTL.

| Method | URL | |
|---|---|---|
| GET | `/api/health` | Health check |
| GET / POST | `/api/events` | List / create |
| GET / PATCH / DELETE | `/api/events/:id` | One event (incl. `registered`, `spotsLeft`) |
| GET / POST | `/api/events/:id/registrations` | List / register `{ name, email }` |
| GET | `/api/stats` | Occupancy per event |

Errors always have this shape: `{ "error": { "code", "message", "details?" } }`.

### web/

```
api/          client.js (fetch + ApiError) and events.js (one function per endpoint)
views/        one component per page, registered in router.js
components/   reusable pieces: EventCard, SeatMeter, RegistrationForm, ErrorMessage
styles.css    design tokens at the top, change those first
```
