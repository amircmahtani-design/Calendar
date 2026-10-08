# Amir Calendar — Architecture & Data Model Proposal

Version 1 · 8 October 2026 · Status: awaiting approval before Phase 1

---

## 1. Environment inspection

- **No existing calendar project.** None of the 23 repos under `amircmahtani-design` is a calendar; this is a greenfield build. Nothing to migrate from or preserve code-wise.
- **Your current pattern** is single-file HTML → GitHub web UI → Netlify, Firebase backend, Netlify Functions, no terminal. This project deliberately breaks from that (React/TS/Vite, a real build step, Cloud Functions). That is the right call for something this size, and it does **not** require you to use a terminal: Netlify builds the frontend from GitHub, and a GitHub Action deploys Functions, Firestore rules and indexes on every push to `main`. I do all coding, testing and pushing.
- **Build environment here** (verified): Node 22, Java 21 (needed by the Firebase Emulator Suite), Playwright 1.56, firebase-tools 15. Every phase can be built and fully tested against the emulators before anything touches a live project.

## 2. Stack (as specified, with versions confirmed)

| Layer | Choice | Licence |
|---|---|---|
| UI | React 19 + TypeScript + Vite, Tailwind CSS | MIT |
| Calendar grid | FullCalendar (core 7.x; dayGrid, timeGrid, list, multiMonth, interaction) | MIT — no premium plugins needed |
| Recurrence rules | `rrule` (parse/serialise RRULE) wrapped by our own expansion engine | BSD-3 |
| Time zones | Luxon (IANA zones, DST-safe wall-clock maths) | MIT |
| ICS parse/generate | `ical.js` (Mozilla; handles VTIMEZONE properly) | MPL-2.0 — fine for private use; only obligation is keeping its own source files' licence if we modify them |
| Backend | Firebase Cloud Functions (2nd gen, Node 22) | — |
| Data/auth | Firestore + Firebase Authentication (Google sign-in, locked to your account) | — |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport on a Cloud Function | MIT |
| Email | Resend (recommended) via Cloud Functions | Free tier 3,000/month |
| Tests | Vitest (unit + rules), Playwright (E2E, desktop + iPhone viewports) | MIT/Apache |

**Licensing verdict:** no paid licences required. FullCalendar Premium (resource/timeline views) is not needed for anything in the spec.

**Why `rrule` alone isn't enough:** rrule.js is known to mishandle time zones around DST (it works in UTC/"floating" time). Our engine uses rrule only to enumerate the rule in *floating local time*, then attaches the event's IANA zone with Luxon, so "every Monday 09:00 Madrid" stays 09:00 Madrid across the March/October transitions. Nonexistent times (02:30 on spring-forward day) shift forward per RFC 5545; ambiguous times (autumn) take the first occurrence. This is the single most test-heavy module.

## 3. System shape

```
 iPhone / desktop PWA (Netlify)
   │  Firebase Auth (ID token)        ┌─────────────── Cloud Functions ───────────────┐
   ├────────── Firestore SDK ───────► │ Firestore triggers: audit log, webhook fan-out, │
   │  (reads + owner writes,          │   reminder (re)scheduling, search index        │
   │   offline cache)                 │ Scheduled (every 1 min): reminder dispatcher   │
   │                                  │ Scheduled (daily): backup export to GCS        │
   └────────── HTTPS /api ──────────► │ api:  REST v1 (JSON)                           │
                                      │ mcp:  MCP server (Streamable HTTP + OAuth 2.1) │
 Your apps (PT, Family Ledger…) ────► │ oauth: authorize / token / register endpoints  │
 Claude / ChatGPT / agents ─────────► │ ics:  /ics/{calendarId}.ics?token=… (read-only)│
                                      └────────────────────────────────────────────────┘
```

Modules (one repo, separate packages so each can evolve independently):

- `packages/core` — pure TypeScript, no Firebase: event model, recurrence engine, ICS import/export, availability engine, validation (zod). Shared by frontend, Functions and MCP. 90 % of the correctness tests live here.
- `apps/web` — the React PWA.
- `functions/` — REST API, MCP, OAuth, triggers, scheduler.
- `firestore.rules`, `firestore.indexes.json`.
- `docs/` — API reference (OpenAPI 3.1), MCP setup, migration guide, backup/restore, prod checklist.

## 4. Data model (Firestore)

Single-owner system, so everything sits under `users/{uid}`. Integrations never get direct Firestore access; they go through Functions, which enforce scopes.

```
users/{uid}
  settings                      (doc) defaultCalendarId, weekStart, timeFormat 12/24,
                                      defaultDurationMin, defaultReminders[], timeZone
                                      ("Asia/Dubai"), theme, dateFormat (DD/MM/YYYY)
  calendars/{calendarId}        name, color, description, visible, archived,
                                defaultReminders[], sortOrder, source {type:"local"|"import",
                                importBatchId?}, createdAt, updatedAt, deletedAt?
  events/{eventId}              ← one doc per single event OR per series master
  overrides/{overrideId}        ← modified/cancelled single occurrences of a series
  reminderJobs/{jobId}          ← materialised upcoming reminder firings
  importBatches/{batchId}       file names, counts {imported, skipped, failed, duplicates},
                                calendar mapping, errorReport[], status, rolledBackAt?
  integrations/{integrationId}  name, type ("oauth"|"apiKey"), scopes[], calendarIds[] | "*",
                                privacy ("full"|"freeBusyOnly"), keyHash, keyPrefix,
                                createdAt, lastUsedAt, revokedAt?
  webhooks/{webhookId}          url, events[], calendarIds[], secret (hashed + encrypted copy),
                                active, failureCount
  webhookDeliveries/{id}        webhookId, eventType, payload, attempt, status, responseCode,
                                nextRetryAt, idempotencyKey
  icsFeeds/{feedId}             calendarId, tokenHash, createdAt, revokedAt?
  auditLog/{logId}              at, actor {type:"user"|"integration", id, name}, action,
                                target, before?, after?, requestId
  trash  (soft delete is a deletedAt field on calendars/events, purged after 30 days)
```

### Event document

```ts
{
  id, calendarId,
  title, description, location, meetingUrl,
  start: { local: "2026-10-12T09:00:00", tz: "Asia/Dubai", utc: Timestamp },  // timed
  end:   { local: "2026-10-12T10:00:00", tz: "Asia/Dubai", utc: Timestamp },
  allDay: false,              // all-day uses { date: "2026-10-12" } with exclusive end date
  status: "confirmed"|"tentative"|"cancelled",
  privacy: "default"|"private"|"public",
  transparency: "busy"|"free",           // drives availability engine
  color?: "#RRGGBB",                      // override; null = inherit calendar
  attendees: [{ email, name?, role?, partstat? }],
  reminders: [{ minutesBefore: 15, method: "email"|"push"|"both" }],
  attachments: [{ title, url }],
  // recurrence (series master only)
  rrule?: "FREQ=MONTHLY;BYDAY=-1MO,-1TU,-1WE,-1TH,-1FR;BYSETPOS=-1",
  rdates?: ["2026-12-24T09:00:00"],       // local times in start.tz
  exdates?: ["2026-11-02T09:00:00"],
  seriesEndUtc: Timestamp | null,         // null = infinite; enables range queries
  splitFrom?: eventId,                    // set when "this and following" splits a series
  // identity & sync
  ical: { uid, sequence, recurrenceId?, raw?: {unmappedProps} },
  source: { type: "app"|"import"|"integration", id?, externalId? },
  etag, createdAt, updatedAt, createdBy, updatedBy, deletedAt?
}
```

### Override document (exceptions)

`{ seriesId, recurrenceId: "2026-11-09T09:00:00" (original local start), cancelled?: true, ...any changed fields }` — RFC 5545 RECURRENCE-ID semantics exactly, so they round-trip to ICS.

### Recurring edit semantics

| Action | This event only | This and following | All events |
|---|---|---|---|
| Edit | create/update override | master gets `UNTIL` = day before; new master created from this occurrence with remaining COUNT recalculated; overrides after the split move to the new series; `splitFrom` links them | edit master; overrides keep their own changed fields, untouched fields follow the master; time shifts move overrides by the same delta |
| Delete | add EXDATE (+ delete override if any) | set `UNTIL`; soft-delete later overrides | soft-delete master + all overrides |

Past occurrences are never rewritten by "this and following".

### Range queries

A visible range [A, B] loads: single events where `start.utc < B && end.utc > A` (indexed), plus masters where `start.utc < B && (seriesEndUtc == null || seriesEndUtc > A)`, plus overrides for those series. Expansion happens in `core` (client for the UI, server for API/MCP/reminders). For your volume (thousands, not millions, of events) this is fast and cheap.

### Reminders

Each reminder becomes a `reminderJobs` doc `{eventId, occurrenceKey, fireAtUtc, method, status}` for the next 14 days only (rolling window refilled daily). A Firestore trigger rebuilds an event's jobs on any create/edit/delete; the dispatcher runs every minute and claims jobs in a transaction, so a reminder can never send twice. Changing a time zone or editing a series simply rebuilds the jobs.

### Permissions

Scopes: `calendars:read`, `events:read`, `freebusy:read`, `events:create`, `events:update`, `events:delete`, `calendars:manage`. Each integration also has `calendarIds` and `privacy`. "Free/busy only" integrations see `{start, end, busy}` and nothing else, including through search. Your examples map directly:

- PT Coach → `events:read, events:create, events:update` on Fitness only
- Family apps → read/create on Family + Ariadne
- General AI assistant → `freebusy:read` on all, privacy = freeBusyOnly
- Chief of Staff agent → all event scopes on authorised calendars, no `calendars:manage`

API keys are shown once, stored as SHA-256 hashes, prefixed (`acal_live_…`) for identification, rotatable, revocable. Rate limit: per-integration token bucket (default 120 req/min) stored in Firestore.

### Sync loop prevention

Every write records `source.id`; webhooks are **not** delivered back to the integration that made the change (unless it opts in). External apps publishing events must send `externalId`; we upsert on `(integrationId, externalId)`, so re-sending is idempotent. Write requests accept an `Idempotency-Key` header (24-hour replay window) and `If-Match: etag` for conflict detection.

## 5. Limitations and dependencies to know up front

**Things you need to provide (one-off, ~15 minutes, all in a browser):**
1. A new Firebase project (suggest `amir-calendar`) on the **Blaze (pay-as-you-go) plan** — Cloud Functions and scheduled jobs require it. Expected cost at your usage: ~$0–2/month; I'd set a $10 budget alert.
2. An empty GitHub repo `amir-calendar` (I can't create repos, only push to them).
3. A Netlify site linked to that repo (or I set it up via the Netlify connector once the repo exists).
4. A Resend account + API key, and ideally a sending domain (e.g. a subdomain of zenithadvisory.ae) for reminder emails. Without a domain, emails can only go to your own address — which is actually fine for a personal calendar.
5. A Firebase service-account key added as a GitHub secret, so the Action can deploy Functions and rules.

None of this blocks Phase 1, which I build and test entirely on the emulators.

**Apple Calendar import — what to expect:**
- iPhone cannot export .ics. Export is done on a Mac (Calendar → select calendar → File → Export) or by sharing an iCloud calendar publicly and downloading the feed. I'll write step-by-step instructions.
- Usually preserved: titles, notes, locations, times + VTIMEZONE, all-day, RRULE/EXDATE/RECURRENCE-ID exceptions, alarms (VALARM), URL, calendar name (`X-WR-CALNAME`), calendar colour (`X-APPLE-CALENDAR-COLOR`), attendees.
- Usually lost or partial: file attachments (not embedded), travel time, structured location/map pins (kept as raw data only), invitation reply state, the read-only Birthdays and Holidays calendars, shared-calendar membership.
- The import preview will report exactly which properties were found in *your* files and which were dropped, before you confirm. Anything unmapped is kept in `ical.raw` so a later export loses nothing we received.

**iPhone PWA — honest limits:**
- Push notifications work only after adding to Home Screen (iOS 16.4+), and iOS may delay or batch them. **Email is the reliable reminder channel; push is a bonus.**
- No home-screen widgets, Siri, lock-screen integration or background sync on iOS. Offline viewing works; queued offline edits sync when the app is next opened.
- To see these events in Apple's own Calendar app, use the ICS subscription feed (read-only). Apple decides refresh frequency (typically 5 min–1 hour on iOS; you can set it on a Mac). Two-way sync with Apple would need CalDAV, which is designed for but not in scope.

**Claude and ChatGPT connection:**
- The MCP server will speak Streamable HTTP with OAuth 2.1 (dynamic client registration), which is what Claude's custom connectors require; Claude.ai custom connectors need a paid plan. ChatGPT supports custom MCP connectors through its developer mode on eligible plans; its exact requirements change often, so I'll verify both against current documentation in Phase 3 and test a real connection before calling it done.
- Agents running on your own servers can use either MCP or plain REST with an API key.

**Offline conflicts:** last-writer-wins per field is unsafe for calendars, so offline edits carry the `etag` they were based on; if the server copy changed meanwhile, you get a conflict sheet ("Keep mine / Keep server") rather than silent overwrite.

## 6. Delivery plan

| Phase | Scope | Done when |
|---|---|---|
| 1 | Auth, calendars, colours, all 6 views, event CRUD, drag/resize, recurrence engine + edit/delete flows, settings, dark mode, PWA shell | Recurrence suite (DST, 29 Feb, 31st-of-month, last weekday, BYSETPOS) green; Playwright desktop + iPhone journeys green |
| 2 | ICS import (preview, mapping, dedupe by UID+RECURRENCE-ID, error report, rollback), ICS + JSON export | Round-trip tests on real Apple exports (I'll ask for one of yours) |
| 3 | REST API + OpenAPI docs, integrations dashboard, scopes, audit log, webhooks, ICS feeds, MCP + OAuth | Permission matrix tests; live Claude connector test |
| 4 | Reminders (email + push), availability/free-slot engine, search, offline queue, scheduled backups + restore | Dispatcher idempotency tests; restore drill |
| 5 | Security review, rules tests, performance, prod deploy, docs, checklist, sample integration for the PT app | Live site verified on phone + desktop; Theo-style QA pass |

Realistically this is several working sessions, not one. I'll report at the end of each phase with what passed, what didn't and any limitation found.
