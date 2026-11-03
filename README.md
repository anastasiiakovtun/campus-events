# Campus Events

Starter project for **Advanced Development** (Thomas More – International Experience Design, year 3).

A small but complete web app: students browse campus events and register for them.

- **api/** : REST API: Node.js, Express 5, Sequelize + SQLite, Zod
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

The API is split into layers:

```
routes/              URL + validation → controller        (no business logic)
controllers/         HTTP in/out, picks the status code    (thin)
services/            business rules, throws AppErrors      (no Express, no SQL)
repositories/        data access via Sequelize             (no rules)
models/              tables, connection, demo data
middleware/           validation, error handling, logging
config/              the only place that reads process.env
utils/                logger, AppError, cache and mailer
api/src/server.mjs   starts the app (and adds demo data to an empty database)
api/src/seed.mjs     npm run seed: reset the database
```

The integration tests in `api/tests/integration` only talk HTTP. They pass without changing the teacher's tests.

### Additional features

- **Capacity fix:** full events no longer accept another registration (`count >= capacity`).
  Covered by `api/tests/integration/capacity.test.mjs`.
- **Confirmation mail:** after a registration is saved, the confirmation mail is sent in the background without
  blocking the response. Mail failures are caught and logged, so an unavailable mail server does not lose the
  registration. Covered by `api/tests/integration/mail.test.mjs`.
- **GET caching:** `api/src/utils/cache.mjs` provides an in-memory cache-aside implementation with a configurable
  TTL (`CACHE_TTL_SECONDS`, default 60 seconds). Create, update, delete and registration operations invalidate the
  cache keys that they make stale. Covered by `api/tests/integration/cache.test.mjs`.

### Live API

The deployed API is available at:

**https://campus-events-1-g4or.onrender.com/api**

Useful endpoints:

- `/api/events`
- `/api/stats`
- `/api/health`

The Render deployment auto-deploys on every push to `main`.

### References

These Stack Overflow discussions informed the implementation:

- [Building enterprise app with Node/Express](https://stackoverflow.com/questions/41875617/building-enterprise-app-with-node-express) —
  informed the separation between controllers, services and the data layer.
- [Downside of calling an async function without await](https://stackoverflow.com/questions/49657914/down-side-on-calling-async-function-without-await) —
  informed the background mail call and explicit `.catch()` error handling.
- [Redis cache vs using memory directly](https://stackoverflow.com/questions/19477821/redis-cache-vs-using-memory-directly) —
  informed the choice of an in-memory TTL cache for this single API instance.

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
