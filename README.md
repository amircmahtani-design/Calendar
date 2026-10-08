# Amir Calendar

A private calendar for Amir: React + TypeScript + Vite, Firebase Auth and Firestore, FullCalendar (MIT), deployed on Netlify.

The architecture and data model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What works now (Phase 1 and 2)

- Day, week, month, year, agenda and search views. On phones the app has its own month view (dots, then the selected day's list), a bottom tab bar and swipe navigation.
- Calendars: unlimited, with colour, description, visibility, default alerts, archive, and delete with confirmation.
- Events: all fields, with drag-to-move and resize, tap an empty slot to create, duplicate, and a per-event colour.
- Repeating events (RFC 5545):
  - Patterns: daily, weekdays, weekly on chosen days, every N, monthly by date or by nth or last weekday, yearly.
  - Endings: never, until a date, or after N times.
  - Edit or delete "this event / this and following / all". Exceptions are stored as RECURRENCE-ID overrides, and series are split so history is never rewritten.
  - Daylight saving, 31st-of-month and 29 February are all tested.
- Apple Calendar import:
  - Reads several .ics files at once. Calendar names and colours carry over.
  - Keeps time zones, all-day events, repeating series, EXDATEs, changed occurrences and alerts.
  - Shows a preview with counts and lists what Apple didn't export.
  - Imports are mapped to new or existing calendars and de-duplicated by UID + RECURRENCE-ID, so re-importing is safe.
  - Produces an error report, and each import batch can be rolled back.
- Export to .ics (one calendar, several, or all, optionally limited to dates) and a full JSON backup.
- Soft delete with a Recently Deleted screen and restore.
- Settings, light and dark mode, and an installable PWA.
  - Offline: events you've already loaded stay viewable, and edits made offline queue and sync later.
  - Live date icon in the browser tab and app header. Optional date badge on the iPhone icon.
- Access is locked to amircmahtani@gmail.com, both in the app and in `firestore.rules`.
- Dates are shown day-first everywhere.

## Not built yet (Phases 3–5)

- REST API, MCP server, integration permissions and webhooks.
- ICS subscription feeds.
- Email reminders and the background job system.
- The free-slot finder.
- Scheduled backups to Cloud Storage.

These need Cloud Functions, so the Firebase project has to be on the Blaze plan. Until then, alerts are stored with each event, and they export to Apple and Google, but this app doesn't deliver them yet.

## Tests

```
npm test               # 45 unit tests: recurrence, ICS import/export, edit planning, import planning
npm run emulators      # in another terminal (needs Java)
npm run test:rules     # Firestore security rules
npm run dev:emulator   # dev server wired to the emulators
npm run test:e2e       # Playwright journeys on desktop + iPhone viewports
```

## Firebase setup (one-off)

1. Create the project in the Firebase console.
2. Turn on Google sign-in.
3. Create Firestore in production mode.
4. Paste the web config into `src/firebaseConfig.ts`.
5. Add the Netlify domain under Authentication → Settings → Authorised domains.
6. Publish `firestore.rules` from the Firestore → Rules tab (paste the file contents).

## Moving from Apple Calendar

On a Mac:

1. Open Calendar and select one calendar in the sidebar.
2. Choose File → Export → Export…
3. Repeat for each calendar.
4. In this app, open Import, choose all the .ics files, check the preview, then tap Import.

Re-running an import with newer files only adds what's new or changed. Every import can be rolled back from the Import screen.
