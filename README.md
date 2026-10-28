<div align="center">

# Trip Angkutan

**Transport operations for plantation fleets — recorded in the field, billed from the office.**

A field-officer app that captures every trip with photographic proof, a supervisor
dashboard that turns those trips into billing, and an API that runs inside the
office LAN so the operation never stops working when the internet does.

![Trip Angkutan](docs/media/trip-angkutan-launch.gif)

</div>

---

## The operation

A plantation transport fleet runs trucks between regions and dermaga. Every
movement has to be recorded — who carried what, in which vehicle, and how much
it is worth — because the trip *is* the invoice.

Two things make that hard in the field:

- **There is no signal.** A trip between two remote blocks can be an hour
  without a single bar, and a paper logbook is the only thing that survives.
- **The billing rules are not uniform.** Each region has its own tariff matrix,
  and a vehicle's price depends on its class, its load state, and whether it is
  an internal, local, or external truck.

Trip Angkutan removes the paper logbook and the spreadsheet. The same system
captures the trip on the handset, queues it when the network is gone, and turns
it into a priced, exportable record on the supervisor's desk.

---

## Three surfaces, one system

### For the field officer — a trip that cannot be lost

- **A trip is only a trip once it has a photo.** The camera frame is mandatory,
  so billing always has evidence behind it and disputes have something to
  point at.
- **The plate is read on the handset.** On-device OCR (Tesseract.js) matches
  the plate against the registry and classifies the vehicle automatically —
  internal, local, or external — which is what decides the price. No typing,
  no office round-trip.
- **The signal can vanish mid-trip.** Every master dataset and every pending
  trip is stored locally; the sync queue retries with backoff and reconciles
  on reconnect. The radio can be off for the whole shift.
- **Trips are filed where they happened.** A GPS watch against per-dermaga
  geofences means a trip can only be submitted inside the authorised area.
- **Built for shared handsets.** Username/password or 6-digit PIN, silent token
  renewal, and quick officer switching.

### For the supervisor — one screen for the whole operation

- **Live trip reporting** — filter by date range, vehicle class, and vehicle
  type; expand a trip for its per-vehicle breakdown; see load composition and
  revenue at a glance, with a privacy toggle that masks nominal figures until
  they are needed.
- **The ledger view** — the same data as a spreadsheet-style trip sheet, plus a
  per-class recap, both exportable to `.xlsx` for finance.
- **Master data that matches reality** — routes grouped by region → dermaga,
  regions and dermaga, the vehicle plate registry, and officer accounts scoped
  per region and per dermaga.
- **One tariff matrix, many regions** — a master region every other region
  inherits from, per-region overrides, and a bulk write that pushes one vehicle
  type to every region at once.
- **The servers are visible** — endpoint status, request rate, latency, and
  live CPU, RAM, disk, and load telemetry for the office machine, surfaced in
  the dashboard itself. No external monitoring stack to keep running.

### For the office — billing that survives a bad connection

- **The API lives next to the database.** The Deno service, PostgreSQL, and
  PostgREST run together in Docker Compose on the office machine; daily
  operations do not depend on an internet uplink.
- **One codebase, two deployments.** The same handler serves the public
  endpoint and the office intranet server. The mobile app switches between
  them at runtime from *Profile → Server*, and a shared `JWT_SECRET` keeps
  sessions valid across the switch.
- **Media stays local.** Trip photos, OTA bundles, and the APK are written to
  an object store on the API host, persisted in a Docker volume, and served
  back by the API itself.
- **Deployments cannot half-work.** The build verifies every chunk reference in
  the generated bundle and fails hard on a broken artefact, so a bad bundle
  never reaches the field.

---

## What each capability replaces

| Capability | The manual problem it removes |
|---|---|
| Photo-mandatory trip capture | Paper trip sheets — and bills nobody can evidence |
| On-device plate OCR | Re-typing plates into a spreadsheet, one row at a time |
| Geofence validation | "Which region was that trip in?" |
| Per-region tariff matrix | One spreadsheet maintained for every region at once |
| Bulk tariff write | Copying dozens of rows for every new region |
| Offline queue with retry | A day of trips lost to one missed bar of signal |
| Office-LAN API | "The system is down" whenever the ISP is |
| Live server telemetry | Flying to the server room to check a disk |

---

## Screenshots

| Trip reports & live dashboard | Master Tarif (per-region tariff matrix) |
|---|---|
| ![Trip reports](docs/screenshots/admin-laporan.png) | ![Master Tarif](docs/screenshots/admin-master-tarif.png) |

| Spreadsheet-style trip sheet | Recap per vehicle class |
|---|---|
| ![Trip sheet](docs/screenshots/admin-laporan-spreadsheet.png) | ![Recap](docs/screenshots/admin-laporan-rekap.png) |

| Master Region & dermaga | Officers per region |
|---|---|
| ![Master Region](docs/screenshots/admin-master-region.png) | ![Officers](docs/screenshots/admin-petugas.png) |

| Mobile app (officer login) |
|---|
| ![Mobile login](docs/screenshots/mobile-login.png) |

> Screenshots are regenerated from the running application with
> `npm run docs:screenshots` (headless Chromium over the DevTools Protocol —
> no extra dependency beyond the `ws` module already in the repo).

---

## How it is built

```
┌───────────────────────────┐        ┌───────────────────────────┐
│  Mobile app (Capacitor)   │        │  Admin dashboard (React)  │
│  React + TypeScript       │        │  static SPA, port 8000    │
│  camera · OCR · geofence  │        │  tariffs · reports · xlsx │
│  offline queue (IndexedDB)│        └─────────────┬─────────────┘
└─────────────┬─────────────┘                      │
              │   HTTP/HTTPS (LAN :3000, endpoint aktif) │
              └───────────────┬──────────────────────┘
                              ▼
                 ┌──────────────────────────┐
                 │   Deno API (server/api)  │
                 │  auth · trips · tariffs  │
                 │  plates · reports · OTA  │
                 │  metrics · rate limiting │
                 └────────────┬─────────────┘
                              │  PostgREST
                 ┌────────────▼─────────────┐
                 │  PostgreSQL 16           │
                 │  schema + migrations     │
                 └──────────────────────────┘
```

| Layer | Technology | Notes |
|---|---|---|
| Mobile shell | Capacitor 8 (Android) | camera, geolocation, filesystem, network state |
| Frontend | React 19 + TypeScript 6 + Tailwind CSS | one codebase, two shells (`/` mobile, `/admin` desktop) |
| Build | Angular application builder (esbuild) | output normalised into `www/`, verified before deploy |
| API | Deno + `Deno.serve` | REST, JWT auth, bcrypt, rate limiting, CORS hardening |
| Data | PostgreSQL 16 + PostgREST 12 | idempotent SQL migrations in `server/db/migrations/` |
| Storage | local object store on the API host (trip photos, APK, OTA bundles) | served by the API, persisted in a Docker volume |
| Packaging | Docker Compose | `web`, `api-intranet`, `db`, `rest` |

---

## Engineering highlights

- **Offline is the default, not a fallback.** Master data is prefetched and
  cached, trips are queued locally with retry and backoff, and reconciliation
  happens on reconnect. The app is fully usable with the radio off.
- **The API runs where the work happens.** It is deployed next to the office
  database, not behind a public cloud, and the mobile app switches to it at
  runtime — so moving between endpoints never logs an officer out.
- **Tariff resolution without row copying.** A region's price is resolved in a
  defined order — internal (Rp 0) → per-region override → master tariff → flat
  regional rate → free. A new region inherits the master tariff automatically
  instead of duplicating dozens of rows.
- **Evidence-first billing.** A trip is locked until a photo exists, and the
  captured frame is OCR'd to classify the vehicle, which drives the tariff
  applied to that trip.
- **Observable from the dashboard.** The API measures itself and reports CPU,
  memory, disk, and request rate to the admin UI.
- **Deploy safety net.** The build re-verifies every chunk reference in the
  generated bundle and fails hard on a broken artefact.

---

## Tech stack

| Area | Stack |
|---|---|
| Frontend | React 19, TypeScript 6, Tailwind CSS 3, lucide-react, hand-rolled SVG charts |
| Mobile | Capacitor 8 (Android), Capacitor SQLite, Tesseract.js (OCR), service worker + OTA updater |
| Backend | Deno, standard `Request`/`Response` handlers, JWT (24 h), bcrypt, custom rate limiter |
| Database | PostgreSQL 16, PostgREST 12, SQL migrations |
| Infrastructure | Docker Compose, health checks, persistent volumes, idempotent migrations |
| Quality | Vitest (27 test files), ESLint, `tsc --noEmit`, Deno test runner for the API |

---

## Repository layout

```
src/                     React app: mobile shell + admin dashboard
  pages/mobile/          officer screens (trip flow, camera, geofence, history)
  pages/admin/           admin shell, tabs, report sheet & recap views
  services/              api, auth, sync, offline db, OCR, OTA, geofence, xlsx
  theme/                 design tokens shared by both shells
server/
  api/                   Deno API: handlers, metrics, system telemetry
  db/                    schema.sql + timestamped SQL migrations
scripts/                 build helpers, OTA publisher, screenshot capture
docs/                    deployment notes, incident reports, screenshots, media
android/                 Capacitor Android project
admin-www/               built admin dashboard served on port 8000
```

---

## Development

```bash
npm install

npm run start             # dev server for the app (port 5173)
npm run build             # production build + bundle verification
npm run test:unit         # unit tests
npm run lint              # ESLint
npm run docs:screenshots  # regenerate README screenshots
npx tsc --noEmit -p tsconfig.app.json
```

Run the full stack (admin dashboard, intranet API, database, object store) with:

```bash
docker compose build api-intranet web
docker compose up -d
```

The admin dashboard is then served from `admin-www/` on port `8000`, the
intranet API on `3000`, and the mobile dev server on `5173`.

> On the office network the same services are started and health-checked by
> `restart-all-ubuntu.sh`; see `docs/DEPLOY-UBUNTU-LOCAL.md` for the rollout
> procedure and the LAN topology.

---

## Quality

| Check | Command |
|---|---|
| Unit tests (frontend + API) | `npm run test:unit` |
| API tests (Deno) | `deno test --allow-env --allow-net --allow-read --allow-write --allow-sys --allow-run=df --allow-run=cat server/api/` |
| Types | `npx tsc --noEmit -p tsconfig.app.json` |
| Lint | `npm run lint` |
| Bundle integrity | `npm run build` (fails hard on broken chunk references) |

---

## Further documentation

| Document | Contents |
|---|---|
| [`Architecture.md`](Architecture.md) | components, data flow, endpoint map |
| [`PRD.md`](PRD.md) | product requirements and feature scope |
| [`Structure.md`](Structure.md) | directory map and file responsibilities |
| [`OFFLINE-FIRST-ARCHITECTURE.md`](OFFLINE-FIRST-ARCHITECTURE.md) | offline strategy, queue, reconciliation |
| [`ALUR_APLIKASI.md`](ALUR_APLIKASI.md) | screen-by-screen flow |
| [`docs/DEPLOY-UBUNTU-LOCAL.md`](docs/DEPLOY-UBUNTU-LOCAL.md) | office-server deployment |

---

<div align="center">
<sub>Built for field operations in low-connectivity environments.</sub>
</div>
