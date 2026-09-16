# StageLink

Book your journey before you reach the stage.

StageLink digitizes the Kenyan matatu/shuttle stage booking experience: discover
stages, compare verified operators, see real trip status, reserve a seat, pay,
and board with a digital ticket. Full product scope is in the master
specification supplied by the supervisor; this repository implements it in
controlled phases.

## Status: Phase 12 — Trust and Reviews

Phases 1–11 are done (foundation → discovery → trips → booking engine →
M-Pesa → ticketing → operator platform → driver portal → group transport →
notifications → admin platform). Phase 12 adds reviews for completed trips,
moderation/reporting, and a single shared trust indicator used across the
whole booking flow. See "What's intentionally not here yet" for what remains.

## Stack

Node.js · Express · EJS · vanilla CSS/JS · MySQL (via `mysql2`)

No React, TypeScript, or other frameworks outside the supervisor's
requirements have been introduced.

## Project structure

```
StageLink/
├── public/
│   ├── css/
│   │   ├── style.css        # design tokens + base architecture (Phase 1)
│   │   └── passenger.css    # discovery UI: search, cards, map placeholder (Phase 2)
│   └── js/
│       ├── main.js          # mobile nav toggle (Phase 1)
│       ├── discover.js      # nearby-stage geolocation + live search (Phase 2)
│       ├── map.js           # map integration layer / placeholder renderer (Phase 2)
│       └── stage-detail.js  # wires map.js into the stage detail page (Phase 2)
├── views/
│   ├── partials/            # head, header, footer, scripts
│   ├── errors/               # 401, 403, 404, 500
│   ├── passenger/            # discover, county, town, stage, operators,
│   │                         # operator, destinations, destination, route
│   └── index.ejs             # landing page
├── config/db.js             # MySQL pool + connection verification
├── middleware/
│   ├── auth.js               # role architecture (ROLES, requireAuth, requireRole)
│   └── errorHandler.js       # 404 handler, centralized error handler
├── models/                  # parameterized SQL data-access layer (Phase 2)
│   ├── counties.js
│   ├── towns.js
│   ├── stages.js
│   ├── operators.js
│   ├── destinations.js
│   └── routes.js
├── routes/
│   ├── main.js               # landing page route
│   ├── discover.js           # /discover, county/town drill-down, stage detail
│   ├── operators.js          # /operators, operator profile
│   ├── destinations.js       # /destinations, destination detail, route detail
│   └── api.js                # /api/stages/nearby, /api/search (JSON)
├── server.js                # application entry point
├── database.sql             # schema + demo data: roles, organizations, users,
│                             # counties, towns, stages, destinations, routes
├── .env.example
└── package.json
```

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in real values (DB credentials,
   session secret).
3. Create the database and load the schema:
   ```
   mysql -u root -p < database.sql
   ```
4. Start the app:
   ```
   npm start
   ```
   The server listens on `PORT` (default `3000`).

If MySQL is unreachable at startup, the server still starts (static pages and
the landing page keep working) and logs a clear warning — it does not crash
and does not silently pretend the database is connected.

## Database

**Phase 1** — `roles`, `organizations`, `users`. See prior notes below.

**Phase 2** — adds the transport network:

- `counties`, `towns`, `stages` — County → Town → Stage, each with a foreign
  key to its parent and a unique-name constraint scoped to that parent
- `destinations` — a named place a route can end at (usually a town, kept
  separate so a destination can be more specific than the town's official name)
- `operator_stages` — many-to-many join table for Operator → Stage (an
  operator usually serves several stages; a stage usually hosts several operators)
- `routes` — Operator → Route (`organization_id`), Route → Origin
  (`origin_stage_id`), Route → Destination (`destination_id`). No schedule or
  vehicle yet — a route is the operator's standing offer, not a trip instance.

**Architectural note:** there is no separate `operators` table. Section 1 of
the spec states every transport operator/company IS an organization/tenant,
and Phase 1's `organizations` table already carries the operator-facing
fields (`name`, `logo_url`, `description`, `contact_email`, `contact_phone`,
`verification_status`). A parallel `operators` table would duplicate that
data and create two sources of truth for the same real-world entity, so
`routes` and `operator_stages` both reference `organizations.id` directly,
and `models/operators.js` queries `organizations` under an operator-shaped
API. Flagging this here since the spec's section 31 table list names them
separately — happy to revisit if there's a reason to split them later.

`roles` — the four platform roles (`passenger`, `operator`, `driver`, `admin`).
`users` — one account table for every role; `organization_id` is nullable
(passengers/admins don't belong to one) and `role_id` is required.

Every later phase's tenant-owned tables (vehicles, trips, bookings, etc.)
will carry `organization_id` and must enforce tenant isolation server-side,
per the master specification.

**Note on `database.sql` and character encoding:** the file contains
Unicode characters (an en dash in route display names). Load it with
`mysql -u root --default-character-set=utf8mb4 < database.sql`, or ensure
your client's default charset is already utf8mb4 — otherwise multi-byte
characters can get mangled on import even though the column charset is
correct. The script itself runs `SET NAMES utf8mb4;` to reduce this risk.

## Role architecture

`middleware/auth.js` defines the shared vocabulary every later phase will use:

- `ROLES` — the four role constants
- `attachCurrentUser` — populates `req.currentUser` / `res.locals.currentUser`
  from the session (currently always `null` — no login exists yet)
- `requireAuth` / `requireRole(...roles)` — route guards, implemented now but
  not yet applied to any route, since there is nothing to protect until
  Phase 2 adds login

## Passenger discovery (Phase 2)

- `/discover` — search bar (manual stage search), "stages near me" (browser
  geolocation → `/api/stages/nearby`), and a county grid
- `/discover/counties/:id` → `/discover/towns/:id` → `/stages/:id` — the
  County → Town → Stage drill-down
- `/stages/:id` — stage detail: map placeholder, directions links, operators
  serving the stage, destinations reachable from it
- `/operators`, `/operators/:id` — operator directory and profile (service
  area, routes), with real `verification_status` from the database — never
  a default "verified" badge
- `/destinations`, `/destinations/:id` — destination directory and the
  routes that reach each one
- `/routes/:id` — a single route's detail (origin, destination, operator,
  distance/duration/fare where known). Explicitly labeled as the operator's
  standing route, not a live departure — trip scheduling is a later phase.
- `/api/stages/nearby`, `/api/search` — small JSON endpoints backing the
  client-side geolocation and live-search features

**Map integration layer:** `public/js/map.js` exposes a provider-agnostic
`window.StageLinkMap.render()` / `.directionsUrl()` interface. Today it
renders a clearly labeled placeholder ("Map preview — provider not yet
connected") instead of live tiles, since no map provider/API key has been
configured. Directions links are real, working deep links to Google Maps
(no API key required for that), not a simulated feature. When a real
provider is added later, only `map.js`'s internals need to change — call
sites stay the same.

## Trips and operator dashboard (Phase 3)

- `vehicles`, `vehicle_seat_layouts`, `seat_layout_seats`, `drivers`, `trips`,
  `seats` — see database.sql comments for the full design rationale
- `seats` are per-trip instances generated from the assigned vehicle's seat
  layout when a trip is created — occupancy on every trip card is a real
  `COUNT(...)` over these rows, never a hard-coded or assumed number
- **Minimal login was added ahead of schedule.** "Operator should be able to
  create and manage trips" isn't safe to build with zero access control, so
  this phase adds session-based login (`/login`, `/logout`) using the
  `users`/`roles` tables and the `requireAuth`/`requireRole` middleware
  already scaffolded in Phase 1 — not full registration, password reset, or
  passenger/admin/driver-specific flows, which stay deferred. Demo operator
  credentials are seeded in `database.sql` (see the comment above the Phase 3
  demo data) — all share the password `Password123!`, e.g.
  `ops@metroshuttle.example`.
- `/operator` (dashboard), `/operator/trips` (list), `/operator/trips/new`
  (create), `/operator/trips/:id/edit` (manage status/departure/vehicle/
  driver/fare) — every query scoped to the logged-in operator's
  `organization_id`; creating or editing a trip re-validates that the route,
  vehicle, and driver actually belong to that organization server-side, not
  just via a filtered dropdown
- Setting a trip's status to `confirmed` or later requires a
  `confirmed_departure` timestamp — the app never infers a confirmed
  departure from occupancy or lets an operator claim one without supplying it
- Passenger flow: `/stages/:id/operators/:id` implements the literal
  Stage → Operator → Destination step; each destination links to
  `/routes/:id`, which now shows real "Available Trips" cards (operator,
  verification, origin, destination, scheduled/estimated departure, fare,
  vehicle, live seat availability, status)
- Vehicle, driver, and seat-layout CRUD are **not** built yet — operators
  work with the fleet seeded in `database.sql`. Full fleet management is
  part of the eventual complete operator dashboard.

## Seat management and booking engine (Phase 4)

- `seat_holds`, `bookings` (see database.sql comments). No passenger login
  exists yet, so a hold/booking is tied to the browser's session ID
  (`req.sessionID`) rather than a user account — both tables carry a
  nullable `user_id` for when passenger accounts exist, the same
  forward-compatible pattern as `drivers.user_id`.
- Every seat-touching operation (`models/seatHolds.js`, `models/bookings.js`)
  runs inside a transaction that locks the seat row with
  `SELECT ... FOR UPDATE` before reading or changing its status — this is
  what makes double-booking structurally impossible under concurrency, not
  just unlikely. Verified live: 10 truly simultaneous hold requests for the
  same seat → exactly 1 success, 9 correctly rejected.
- Holds are self-healing (a `status: 'held'` seat whose hold has actually
  expired is treated as available right in the same transaction) *and* swept
  automatically every 30s by `expireStaleHoldsGlobal()` so seats free up even
  when nobody's actively browsing — correctness never depends on the sweep's
  timing, only on the in-transaction check.
- `POST /trips/:id/bookings` re-validates everything server-side — trip not
  departed/cancelled, every hold still unexpired, every seat still actually
  `held` — before ever setting a seat to `booked`. The frontend's view of
  seat availability is never trusted.
- Flow: `GET /trips/:id` (seat map) → `POST .../seats/:id/hold` or `/release`
  (JSON, used by `public/js/seat-selection.js`) → `GET /trips/:id/booking-summary`
  → `POST /trips/:id/bookings` → `GET /bookings/:reference` (confirmation,
  scoped to the creating session).

## M-Pesa payment integration (Phase 5)

- `payments` table + a `bookings.payment_due_at` column (added via `ALTER
  TABLE` since `bookings` already existed from Phase 4) so a booking that's
  never paid for releases its seat automatically — same sweep pattern as
  seat holds, on the same 30s interval.
- **Sandbox mode is automatic.** `services/mpesa.js` checks for
  `MPESA_CONSUMER_KEY`/`SECRET`/`SHORTCODE`/`PASSKEY` in `.env`; none are set
  in this environment, so it falls back to a local simulator that mimics
  Daraja's real shape (synchronous STK-push acceptance, then an async
  callback 2–5s later) with zero network calls. The simulated outcome is
  controllable by the test phone number's last two digits — ends in `00` →
  FAILED, ends in `11` → CANCELLED, anything else → SUCCESS — so every
  branch of the state machine is exercised on demand. **The real Daraja
  client is fully implemented** (`realInitiateStkPush`) and used
  automatically once real credentials are set — see the comment block at the
  top of `services/mpesa.js` for exactly where each of the five credentials
  comes from and what `MPESA_CALLBACK_URL` needs to be (a real,
  internet-reachable HTTPS URL — ngrok or similar in development).
- State machine: `pending` → `processing` → `success` / `failed` /
  `cancelled`. Only `POST /mpesa/callback` (real Daraja webhook or the
  sandbox simulator calling the same `processCallback()` function) ever sets
  a payment to `success` and confirms its bookings — nothing the browser
  sends can do this. The passenger-facing payment page
  (`views/passenger/payment.ejs` + `public/js/payment-status.js`) only polls
  `GET /bookings/:reference/payment-status`, which reads this same
  server-side state.
- Verified live, end to end: full PENDING→PROCESSING→SUCCESS→booking
  CONFIRMED path; FAILED and CANCELLED paths (booking correctly stays
  `pending`, seat stays held, retry allowed); a second payment attempt while
  one is already processing is blocked (still exactly 1 payment row); paying
  an already-`success` booking again is blocked with a clear message instead
  of silently no-opting; a client-supplied `amount` field is ignored (amount
  is always `SUM(fare_kes)` computed server-side); a manually replayed
  callback with the same `checkout_request_id` is a no-op the second time
  (idempotent — doesn't re-confirm or overwrite the receipt).
- `booking_reference` groups a multi-seat checkout into one payment for the
  correct total, rather than charging per seat.
- **Ticket generation is not built this phase.** The trigger point (payment
  SUCCESS → booking CONFIRMED) is fully implemented and the confirmation
  page reflects it, but QR codes, PDF/print, and the dedicated `tickets`
  table from the master spec are deferred — the booking reference currently
  serves as the passenger's proof of booking.

## Digital ticketing (Phase 6)

- `tickets`, `qr_verification_records`, `boarding_records` (see database.sql
  comments). A ticket is 1:1 with a booking (one seat = one ticket = one QR
  code) and is only ever generated from inside the same transaction that
  verifies a payment SUCCESS and confirms the booking
  (`models/tickets.js:generateTicketsForReference`, called from
  `models/payments.js:processCallback`) — never speculatively.
- `qr_code_token` (embedded in the QR image) is a separate, random 48-hex-char
  value from the human-readable `ticket_number` — unguessable, since it's
  what a scan looks up directly.
- `GET /bookings/:reference/ticket` — mobile ticket view with every field the
  spec lists (StageLink + operator branding, verification state, booking
  number, passenger, phone, origin, destination, vehicle registration, seat,
  travel date, scheduled/estimated departure, trip status, amount, payment
  method, transaction reference, payment status, ticket status, QR code),
  plus the "From [Operator], we wish you safe and wonderful travels" footer.
  **PDF/download architecture:** a "Print / Save as PDF" button plus
  dedicated `@media print` CSS that hides site chrome — every browser's
  native print-to-PDF is the download path for this phase, rather than a new
  server-side PDF-generation dependency. A dedicated server-rendered PDF
  endpoint (e.g. via `pdfkit`) can be added later if auto-emailing tickets
  becomes a requirement.
- `GET/POST /operator/verify` — QR verification for operator staff (see
  below for why this uses the existing operator login rather than a new
  driver-specific one), scoped to the logged-in operator's own organization.
  Uses the browser's native `BarcodeDetector` API for camera scanning where
  supported, with a manual code-entry field as the always-available primary
  path (and what every automated test here actually drives). Every scan —
  valid or not — is logged to `qr_verification_records`, including scans
  that don't resolve to any ticket at all (`ticket_id` is nullable for
  exactly that case) and scans of another operator's ticket (logged
  internally as `wrong_operator`, but shown to the scanning staff exactly
  like an unknown ticket — never revealing it belongs to someone else).
- `POST /operator/verify/:ticketId/board` marks a ticket boarded. It locks
  the ticket row and re-checks status at that exact moment — plus a unique
  key on `boarding_records.ticket_id` — so reusing a boarded ticket is
  structurally impossible, not just a status check that could race.
- **Architectural note:** "verify tickets at boarding with a scan" is listed
  as an *operator* capability in the master spec (section 19), so this phase
  reuses the operator login from Phase 3 rather than building a separate
  driver-specific login — driver accounts (`drivers.user_id`) still exist
  for when driver-specific login is eventually built, but that stays
  deferred, same as before.
- Verified live: VALID ticket → board succeeds; re-scanning the same ticket
  → ALREADY BOARDED; a direct second board attempt on it → rejected
  server-side (exactly 1 `boarding_records` row, confirmed); INVALID
  (nonexistent) QR → rejected; EXPIRED (trip already departed) → correctly
  flagged; CANCELLED (trip cancelled) → correctly flagged; wrong-operator
  scan → shown as invalid to staff, logged distinctly in the audit trail.

## Operator management platform (Phase 7)

- Full sidebar app shell (`views/partials/operatorHeader.ejs` +
  `public/css/operator.css`'s `.op-sidebar`/`.op-topbar` rules) — fixed
  sidebar on desktop/tablet, off-canvas drawer behind a hamburger on mobile
  (`public/js/operator-shell.js`). Every operator page routes through it.
- Nav: Dashboard, Trips, Bookings, Vehicles, Drivers, Routes, Stages, Group
  Trips, Payments, Analytics, Notifications, Verify tickets, Settings.
- **Full CRUD, every query scoped to `organization_id`:**
  `models/organization.js` (profile — deliberately excludes
  `verification_status`, which stays admin-only), `models/operatorStages.js`
  (service-area stages — add/remove from the shared stage directory),
  `models/routes.js`, `models/vehicles.js`, `models/drivers.js`
  (extended with create/update), `models/seatLayouts.js` (new layouts
  auto-generate their seat positions — rows of 4, window/middle/middle/window
  — rather than a full drag-and-drop seat-map editor).
- `models/operatorBookings.js`, `models/operatorPayments.js` — read views
  scoped the same way. "Passengers" has no dedicated table yet (see below);
  it's derived live from booking history grouped by phone.
- `models/analytics.js` — every dashboard/analytics number is a live SQL
  aggregate over this organization's own rows (today's trips/bookings, active
  trips, seats sold, revenue, bookings-by-day, revenue-by-route). Nothing is
  stored, cached, or invented — a metric that would need an unbuilt feature
  (e.g. group trips) is left out entirely rather than shown as a fake zero.
- **Group Trips and Notifications** are real nav items with real pages
  (`operator/coming-soon.ejs`) that say plainly they aren't built yet — both
  are substantial standalone features in the master spec (sections 17–18)
  with no schema behind them. This isn't a shortcut disguised as a feature;
  it's the honest alternative to fabricating data or a dead link.
- **Verified explicitly, live:** every nav page loads (200) for a logged-in
  operator; viewing or updating *another* organization's vehicle, driver, or
  route by ID → 404 with the underlying data unchanged (confirmed in the
  database before/after); creating a trip on another org's route/vehicle →
  400 (Phase 3's existing guard, re-confirmed); bookings/payments lists
  contain zero rows from other organizations; a full create → edit flow for
  an operator's *own* seat layout, vehicle, and settings works normally
  end-to-end, and updating settings does not touch `verification_status`.

## Driver and boarding staff portal (Phase 8)

- No new tables — `drivers.user_id` (Phase 3) and `ROLES.DRIVER` (Phase 1)
  already existed for exactly this; this phase just seeds one driver login
  per existing driver (`driver@metroshuttle.example` / `Password123!`, one
  per organization — see database.sql) and builds the portal on top.
- `models/driverPortal.js` — every function is scoped to a specific
  **driverId** (the `drivers` row linked via `user_id`), not just
  `organization_id`. A driver only ever sees trips assigned to *them*, not
  every trip their organization runs — a tighter boundary than the operator
  dashboard, matching real boarding-staff duties.
- `GET /driver` (assigned trips) → `GET /driver/trips/:id` (trip detail:
  route/vehicle/status, passenger list, seat list, a status-update form) →
  `GET/POST /driver/trips/:id/verify` (QR scan, reusing the camera-scanning
  `qr-scanner.js` from Phase 6) → `POST .../verify/:ticketId/board`.
- **Permitted trip-status updates are a hard-coded subset** — `boarding`,
  `departed`, `arrived` only. Scheduling, confirming, and cancelling a trip
  stay operator/admin decisions; enforced server-side in
  `updateTripStatusByDriver`, not just by which options a `<select>` shows.
- **Mobile-first UX**: `public/css/driver.css` — single column, 48px+ tap
  targets, no sidebar (unlike the operator dashboard, since this is used
  standing at a stage, often one-handed).
- **Verified explicitly, live:** driver login → redirects to `/driver`;
  `/operator/*` (dashboard, settings, payments) → 403 for a driver account;
  viewing a trip assigned to a *different organization's* driver → 404 (not
  leaked); attempting a forbidden status (`cancelled`) on their own trip →
  400, trip status unchanged in the database; a permitted status
  (`boarding`) on their own trip → succeeds; full scan → board flow on their
  assigned trip → ticket correctly marked `boarded`; another organization's
  driver requesting the same trip's verify page by ID → 404.

## Group and event transport (Phase 9)

- `group_requests`, `group_quotations`, `group_bookings` (see database.sql
  comments). Requests are **deliberately not organization-scoped** — every
  operator can browse and quote on every open request, unlike everything else
  in the schema. Tenancy re-enters at the quotation: an operator can only
  submit, modify, or withdraw their *own* organization's quotation.
- Origin/destination are free text (with optional county FKs for operator
  filtering) rather than stage/destination FKs, since group charters are often
  to or from venues that aren't matatu stages.
- Passenger: `GET/POST /group-trips` (request form) → `GET /group-trips/:ref`
  (compare quotations, cheapest first, with real verification badges) →
  accept or decline. Ownership is by session, same as bookings (no passenger
  accounts yet).
- Operator: `/operator/group-trips` (open requests + my quotations),
  detail page to submit or modify a quotation (one per operator per request,
  enforced by a unique key; re-submitting updates it) or withdraw it.
- **Accepting is transactional** (`models/groupBookings.js:acceptQuotation`):
  locks the request and quotation rows, marks the quotation accepted, rejects
  all competing quotations, marks the request accepted, and creates a
  `group_bookings` row (status `pending`, 15-minute `payment_due_at`).
- **No bypass of payment rules.** Group bookings use the *same*
  `initiatePayment`/`processCallback` in `models/payments.js` as individual
  seats, keyed by `booking_reference` (`GB-…`). Same ownership check, same
  server-computed amount (the agreed quotation price — a client-sent `amount`
  is ignored), same duplicate-payment and already-paid guards, same expiry
  check, same idempotent callback. Only a verified payment SUCCESS confirms a
  group booking and completes the request. An unpaid group booking expires via
  the same sweep pattern and **reopens the request** for quoting.
- Group bookings don't generate per-seat tickets (no seats or trip involved);
  the confirmation page (`/group-bookings/:ref`) is the proof of booking.
- **Verified live:** request → two operators quote → one modifies (still one
  row) → passenger sees them cheapest-first → another session gets 404 on
  view/accept/pay → accept rejects the competing quotation and creates a
  pending booking → double-accept and late quoting on a closed request → 400 →
  payment with a tampered amount charged the real KES 55,000 → duplicate
  initiate blocked (1 payment row) → callback confirms booking, completes
  request, 0 tickets → pay-after-paid blocked → decline leaves the request
  open → payment after expiry blocked (0 payment rows created) → sweep expires
  the booking and reopens the request. Individual booking → payment → ticket
  regression-checked and unaffected.
- **Note:** an operator re-submitting after a passenger declined resets that
  quotation to `pending` — treated as negotiation ("modify"), not a bug.

## Notification system (Phase 10)

- One `notifications` table serves every audience (see database.sql). A
  recipient is `user:<id>` (operators, drivers) or `session:<id>` (passengers,
  who don't have accounts yet) — so passenger notifications last only as long
  as their browser session, a known limit until passenger accounts exist.
- **`services/notifier.js` is the only place a notification is composed.**
  Every function in it is called from the code path that performs the real
  event — a verified M-Pesa callback, a trip-status update, a seat hold
  actually expiring, a ticket actually being boarded — never speculatively,
  never from a route the browser can trigger directly. A notification is
  always written *after* its event's transaction commits, and a failure here
  is logged and swallowed rather than rolling back the real event.
- **Avoiding excessive notifications is structural, not best-effort:** every
  notification carries a deterministic `dedupe_key`, and `(recipient_key,
  dedupe_key)` is a database UNIQUE key — a replayed payment callback, a
  re-submitted form, or a minute-by-minute sweep running again literally
  cannot insert a duplicate row (`INSERT IGNORE`), verified live. One
  notification per checkout, not per seat. Internal trip bookkeeping
  (`scheduled`, `filling`) is deliberately silent; an operator who changes
  their own trip's status doesn't get notified about their own action, but
  *is* notified when a driver moves it along.
- Covers every required trigger: booking confirmation, payment success/
  failure, seat-hold expiry, upcoming departure (a 1-minute sweep, still
  driven by real trip/booking rows, dedup'd so re-running it is free),
  trip-status change, confirmed departure, cancellation, group-quotation
  updates (submitted/modified/withdrawn/accepted/declined), ticket ready, and
  boarding confirmation.
- **Reusable component:** `views/partials/notificationBell.ejs` (unread
  badge) and `notificationList.ejs` (the feed itself, with type/tone chips,
  relative timestamps, mark-read and mark-all-read) are the *same* two
  partials rendered by the public site, operator dashboard, and driver
  portal — not three separate implementations. `public/js/notifications.js`
  progressively enhances mark-read into an AJAX call and polls the unread
  count only while the tab is visible; every action still works as a plain
  form post without it.
- **Mobile-friendly by construction:** full-width cards, 44px+ tap targets,
  actions stack vertically under 480px (`public/css/notifications.css`).
- 30-day retention, pruned hourly — nothing grows unbounded.
- **Verified live:** payment success → passenger gets payment+ticket
  notifications, operator gets a booking notification; operator changing
  their own trip's status → passenger notified, operator does *not*
  self-notify; a driver marking the same trip `boarding` → operator *is*
  notified; boarding a ticket → passenger notified; a seat hold's real 30s
  expiry sweep → exactly one notification; a group quotation resubmitted at
  an unchanged price → 0 new rows (dedupe key match); the same quotation
  updated to a different price → a new notification, correctly; quotation
  acceptance → the winning operator and the requester notified, the losing
  operator's rejection notification fires too. Cross-session/cross-user
  access to another recipient's notification → 404, confirmed.

## Admin platform (Phase 11)

- `/admin` — 18 sections: Dashboard, Users, Operators, Counties, Towns, Stages,
  Routes, Vehicles, Drivers, Trips, Bookings, Payments, Group Requests,
  Subscriptions, Reviews, Notifications, Audit Logs, Settings. Seeded login:
  `admin@stagelink.example` / `Password123!`.
- **Authorization** is `requireAuth` + `requireRole('admin')` on the whole
  router. Verified both ways: operator/driver/anonymous → 403/401 on `/admin`,
  and an admin → 403 on `/operator` and `/driver`. An operator POSTing an admin
  action (e.g. a verification change) gets 403 and the database is unchanged.
- Reads are deliberately cross-tenant (that's what an admin view is); the only
  **writes** are operator verification status, operator/user suspension, and
  review moderation — each recorded to `audit_logs` (who, what, old → new)
  right after it succeeds. An admin cannot suspend their own account (it would
  lock out the platform).
- **Sensitive payment data:** the admin payments list masks phone numbers
  (`25479****32`) and selects only what oversight needs; no raw provider
  metadata. Verified the unmasked number never appears in the page.
- **Dashboard numbers are live SQL** over real rows — nothing stored or invented.
- Transport-network sections (counties/towns/stages/routes) are read-only
  oversight; operators manage their own service area in their dashboard.
- **Subscriptions is an honest "not built yet" page.** The master spec never
  defines a billing model (tiers, pricing, operator→platform payments), so
  there is nothing real to manage; inventing one would be fabricated
  functionality.
- **Settings** shows real operational state (environment, M-Pesa sandbox/live)
  rather than an editable form backed by a store that doesn't exist.
- Bug caught while rebuilding: admin pages reuse the operator sidebar shell,
  but `head.ejs`/`scripts.ejs` only loaded its CSS/JS for `/operator` paths, so
  admin pages would have rendered unstyled with a dead mobile menu. Fixed and
  covered by a test.

## Trust and reviews (Phase 12)

- **A passenger can only review a trip they actually completed.** Eligibility is
  re-derived from the database on every request: the booking must belong to the
  caller's session *and* have status `completed`. A booking only becomes
  `completed` when the operator or driver marks the trip `arrived`
  (`completeBookingsForArrivedTrip`) — never from anything the passenger
  asserts. Verified: a paid-but-not-yet-completed booking gets 404 on both the
  review form and a direct POST (0 rows written); after arrival the owner can
  review; a different session gets 404; ratings outside 1–5 → 400; a
  double-submit can't create a second review (`UNIQUE(booking_id)` +
  `INSERT IGNORE`).
- Each review is tied to its **booking, trip and operator** (`reviews` table).
- **Reporting + moderation:** any visitor can report a published review; that
  only moves it `published → flagged` (never hides it). An admin then publishes,
  hides, or leaves it flagged, audit-logged. Hidden/flagged reviews don't appear
  publicly or count toward ratings; re-reporting a hidden review does nothing.
  The report redirect only accepts same-site paths.
- **Operator verification states** (`unverified`, `pending`, `verified`,
  `rejected`) are stored on the organization and changeable *only* by an admin.
- **The UI never invents verification.** `views/partials/trustBadge.ejs` is the
  one place verification and reputation are rendered. The label comes solely
  from the stored status ("Verified by StageLink" appears only for exactly
  `verified`; unknown values fall back to "Not verified"). Ratings are
  `AVG`/`COUNT` over published reviews; with none it says "No reviews yet"
  rather than a number. It appears on: trip cards, the seat-selection page, the
  booking summary, the payment page ("You are paying …"), the booking
  confirmation, the ticket, the operator profile, and group quotations — with a
  plain-language explanation on the pages where a decision is made (e.g. "Not
  verified" is explained as *not yet reviewed*, not as a warning).
- Verified live: pending → verified → declined on the admin side changes the
  passenger-facing label immediately and exactly; non-verified operators never
  render "Verified by StageLink" on any surface checked.
- **Known limit:** reviewer identity is the display name given at booking time
  and ownership is by browser session (no passenger accounts yet), so a
  passenger who clears their session loses the ability to review that booking.
- **Operational note:** demo trips are seeded relative to `NOW()` when
  `database.sql` is loaded, so they go stale as real time passes — reload the
  schema to refresh them.

## What's intentionally not here yet

- Passenger accounts (registration/login/password reset) — passengers are
  identified by browser session; passenger notifications and review ownership
  share that limit
- Subscriptions / operator billing (no billing model is specified)
- Refunds and payment reversal
- "Ask StageLink" AI features
- A live map provider (tiles, real routing) — see the map integration layer note
- Server-rendered PDF tickets (print-to-PDF is the supported path)
- CSRF tokens (cookies are `sameSite=lax`; a dedicated token is a hardening step)
- A persistent session store (in-memory today; required before production)
