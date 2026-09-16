# StageLink — Setup Guide

Get StageLink running on your own computer in about 10 minutes.

## 1. What you need

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18 or newer (developed on 22) | https://nodejs.org — the LTS installer is fine |
| MySQL or MariaDB | MySQL 8 or MariaDB 10.5+ | Developed and tested on **MariaDB 10.11**. XAMPP / WAMP / Laragon all include one. |
| A browser | Chrome, Edge or Firefox | |

No Safaricom/M-Pesa account is needed. Payments run in a built-in **sandbox simulator** (see §6).

## 2. Install

Unzip the project, open a terminal **inside the `StageLink` folder**, then:

```
npm install
```

## 3. Create the database

The file `database.sql` creates the database, every table, and all the demo data in one go.
Run it from inside the project folder (this form works in Command Prompt, PowerShell, macOS and Linux):

```
mysql -u root -p --default-character-set=utf8mb4 -e "source database.sql"
```

* **XAMPP on Windows:** the `mysql` program is at `C:\xampp\mysql\bin\mysql.exe`. XAMPP's `root` user has **no password**, so leave off `-p`.
* **phpMyAdmin instead:** open the **Import** tab, choose `database.sql`, set *Character set* to **utf8mb4**, and click Import (don't pick a database first — the file creates it).

> ⚠️ **Always use `utf8mb4`.** Without it, characters such as the dash in "Nairobi – Nakuru" are stored garbled.

## 4. Configure

Copy `.env.example` to `.env`, then edit it. The simplest local setup:

```
NODE_ENV=development
PORT=3000
APP_NAME=StageLink
SESSION_SECRET=type-any-long-random-string-here-at-least-32-characters

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=stagelink
DB_CONNECTION_LIMIT=10
```

Put your MySQL root password in `DB_PASSWORD` if you have one (XAMPP: leave it empty).

**Cleaner option — a dedicated database user** (run in the `mysql` prompt, then use it in `.env`):

```sql
CREATE USER IF NOT EXISTS 'stagelink_app'@'localhost'  IDENTIFIED BY 'pick-a-password';
CREATE USER IF NOT EXISTS 'stagelink_app'@'127.0.0.1'  IDENTIFIED BY 'pick-a-password';
GRANT ALL PRIVILEGES ON stagelink.* TO 'stagelink_app'@'localhost';
GRANT ALL PRIVILEGES ON stagelink.* TO 'stagelink_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

## 3→4 done — start it

```
npm start
```

You should see `MySQL connection verified` and `StageLink running on http://localhost:3000`. Open that address.

## 5. Demo accounts

Every account uses the password **`Password123!`** (demo data only — never use these in real life).

| Role | Email | What it shows |
|---|---|---|
| Passenger | *(none — no sign-up needed)* | Browse, hold seats, book, pay, get a ticket |
| Operator | `ops@metroshuttle.example` | Dashboard, trips, fleet, bookings, group quotes, ticket verification |
| Operator (others) | `ops@highlandexpress.example`, `ops@lakesidetravellers.example`, `ops@coastlineconnect.example`, `ops@northriftvoyagers.example` | Use two operators together to show that one can't see the other's data |
| Driver | `driver@metroshuttle.example` | Mobile boarding screen, passenger list, scan & board |
| Admin | `admin@stagelink.example` | Platform dashboard, verify operators, moderate reviews, audit log |

Sign in at `/login`; each role is sent to its own area.

## 6. Payments in the demo

On the payment page enter any M-Pesa number in the form `2547XXXXXXXX`. The sandbox decides the outcome from the **last two digits**, 2–5 seconds later:

| Number ends in | Result |
|---|---|
| `00` | Payment **fails** ("insufficient funds") |
| `11` | Payment **cancelled** by the customer |
| anything else | Payment **succeeds** — booking confirmed and ticket issued |

## 7. ⚠️ Before you present — read this

**The demo trips are created relative to the moment you load `database.sql`** (they depart 15 minutes to 6 hours later). If you load it the night before, those trips will have *already departed* by the time you present: seats can't be selected and you'll see "Trip departed".

**Reload the database shortly before presenting** (it also wipes any test bookings, which is what you want):

```
mysql -u root -p --default-character-set=utf8mb4 -e "DROP DATABASE IF EXISTS stagelink"
mysql -u root -p --default-character-set=utf8mb4 -e "source database.sql"
```

Then restart `npm start`. Do a full dry run once after reloading.

## 8. A 10-minute demo path

1. **Discover** — Home → *Find your stage* → county → town → stage. Point out the operator's **verification badge** and "No reviews yet" (nothing invented).
2. **Trip & seats** — open a trip, pick a seat (it's *held* for 5 minutes), continue to the summary.
3. **Pay** — confirm the booking, pay with a number ending in `78`. Watch it go *processing → confirmed*.
4. **Ticket** — open the ticket (QR code, print / save-as-PDF).
5. **Boarding** — as the Metro **driver** (best on a phone, or a narrow browser window): open the trip, *Verify & board*, paste the ticket code, mark **Boarded**. Try the same ticket again → *already boarded*.
6. **Operator** — as Metro operator: dashboard metrics, trips, bookings, payments. Sign in as a *different* operator to show isolation.
7. **Admin** — change an operator's verification and show the public badge change immediately; open **Audit Logs**.
8. **Group transport** — post a request, quote it as an operator, accept as the passenger, pay.
9. **Reviews** — as the driver mark the trip **Arrived**; the passenger can now leave a review.

**Getting the ticket code for step 5:** the QR code contains it. Scan the QR with your phone's normal camera app and it displays the text, or look it up with:
`mysql -u root -p stagelink -e "SELECT ticket_number, qr_code_token FROM tickets"`.
(Camera scanning inside the app works only in browsers that support the `BarcodeDetector` API and on `localhost`/HTTPS — typed entry always works.)

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails on `bcrypt` | Install Node's build tools (Windows: tick "Tools for Native Modules" in the Node installer), or ask to switch to the pure-JS `bcryptjs`. |
| `Access denied for user` | `DB_USER` / `DB_PASSWORD` in `.env` don't match your database. If you made a dedicated user, make sure you ran *both* `CREATE USER` lines (localhost and 127.0.0.1). |
| `Unknown database 'stagelink'` | The import didn't run — repeat §3. |
| `ECONNREFUSED` / "Could not connect to MySQL" | MySQL isn't running. Start it (XAMPP Control Panel → Start MySQL). |
| Odd characters like `â€“` in the pages | Re-import with `--default-character-set=utf8mb4` (§3). |
| "Trip departed" / no seats can be selected | The demo trips are stale — reload the database (§7). |
| `EADDRINUSE` | Something else uses port 3000. Change `PORT` in `.env`. |
| Payment stays "processing" | Wait up to ~5 s, the page refreshes itself. If it never resolves, restart the server and retry. |
| Everything signed out after a restart | Expected in the Phase 12 build (sessions are in memory). Fixed in the Phase 14 build (sessions stored in MySQL). |

## 10. Project layout

```
server.js        app entry point        database.sql   schema + demo data
routes/          URL handlers           models/        all SQL lives here
views/           EJS pages              services/      M-Pesa + notifier
public/          CSS / JS / images      middleware/    auth, errors, security
```

More detail: `README.md` (per-phase notes, design decisions, test evidence).
