// Pure planners for edits and deletes. They return the documents to write so
// the data layer can commit them atomically (and tests can verify them).
import { DateTime } from 'luxon';
import type { EventDoc, Occurrence, OverrideDoc } from './types';
import { computeUtc, normaliseEvent, splitSeries, truncateSeries } from './recurrence';
import { utcToLocal } from './time';

export type Scope = 'this' | 'following' | 'all';

export interface Writes {
  events: EventDoc[];
  overrides: OverrideDoc[];
}

export type EventPatch = Partial<Pick<EventDoc,
  'title' | 'description' | 'location' | 'meetingUrl' | 'allDay' | 'start' | 'end' | 'tz' | 'status' | 'privacy' |
  'transparency' | 'color' | 'attendees' | 'reminders' | 'attachments' | 'calendarId' | 'rrule'>>;

const TIME_KEYS = ['start', 'end', 'allDay', 'tz'] as const;
const datePart = (s: string) => s.slice(0, 10);
const timePart = (s: string) => (s.length > 10 ? s.slice(11) : '00:00:00');
const dayDiff = (a: string, b: string) => Math.round(DateTime.fromISO(datePart(b)).diff(DateTime.fromISO(datePart(a)), 'days').days);
const plusDays = (d: string, n: number) => DateTime.fromISO(d).plus({ days: n }).toISODate()!;

function timeChanged(occ: Occurrence, p: EventPatch): boolean {
  return TIME_KEYS.some((k) => p[k] !== undefined && p[k] !== occ[k]);
}

/**
 * Re-anchor a series so the occurrence originally at `ref` lands at the
 * patch's start/end. Moves master start/end, exdates, rdates and override ids
 * by the same date delta and new time of day.
 */
function retime(master: EventDoc, overrides: OverrideDoc[], ref: string, p: EventPatch): { master: EventDoc; overrides: OverrideDoc[] } {
  const allDay = p.allDay ?? master.allDay;
  const tz = p.tz ?? master.tz;
  const newStart = p.start!;
  const delta = dayDiff(ref, newStart);
  const mapValue = (v: string) => (allDay ? plusDays(datePart(v), delta) : `${plusDays(datePart(v), delta)}T${timePart(newStart)}`);
  const start = mapValue(master.start);
  let end: string;
  if (allDay) {
    const span = Math.max(1, dayDiff(p.start!, p.end!));
    end = plusDays(start, span);
  } else {
    const dur = computeUtc({ allDay: false, start: p.start!, end: p.end!, tz }).endUtc - computeUtc({ allDay: false, start: p.start!, end: p.start!, tz }).startUtc;
    end = utcToLocal(computeUtc({ allDay: false, start, end: start, tz }).startUtc + Math.max(0, dur), tz);
  }
  const next: EventDoc = {
    ...master,
    allDay,
    tz,
    start,
    end,
    exdates: (master.exdates || []).map(mapValue),
    rdates: (master.rdates || []).map(mapValue),
  };
  const ovs = overrides.map((o) => ({ ...o, recurrenceId: mapValue(o.recurrenceId) }));
  return { master: next, overrides: ovs };
}

function stamp<T extends { updatedAt?: number }>(d: T, now: number): T {
  return { ...d, updatedAt: now };
}

/** Plan an edit to an occurrence (or a single event). */
export function planEdit(
  master: EventDoc,
  overrides: OverrideDoc[],
  occ: Occurrence,
  patch: EventPatch,
  scope: Scope,
  ids: { newEventId: () => string; newOverrideId: () => string; newUid: () => string },
  now = Date.now(),
): Writes {
  const own = overrides.filter((o) => o.seriesId === master.id && !o.deletedAt);

  if (!occ.isRecurring) {
    return { events: [stamp(normaliseEvent({ ...master, ...patch }), now)], overrides: [] };
  }
  const rid = occ.recurrenceId!;

  if (scope === 'this') {
    const existing = own.find((o) => o.recurrenceId === rid);
    const { rrule: _r, ...changes } = patch;
    void _r;
    const ov: OverrideDoc = existing
      ? { ...existing, changes: { ...existing.changes, ...changes } }
      : { id: ids.newOverrideId(), seriesId: master.id, recurrenceId: rid, changes, createdAt: now, source: { type: 'app' } };
    return { events: [], overrides: [stamp(ov, now)] };
  }

  if (scope === 'following' && rid > master.start) {
    const { oldMaster, newMaster, movedOverrideIds } = splitSeries(master, own, rid, ids.newEventId(), ids.newUid());
    const moved = own.filter((o) => movedOverrideIds.includes(o.id)).map((o) => ({ ...o, seriesId: newMaster.id }));
    const applied = applyAll(newMaster, moved, rid, occ, patch);
    return {
      events: [stamp(oldMaster, now), stamp({ ...applied.master, createdAt: now, source: { type: 'app' as const } }, now)],
      overrides: applied.overrides.map((o) => stamp(o, now)),
    };
  }

  // 'all' (or 'following' from the first occurrence)
  const applied = applyAll(master, own, rid, occ, patch);
  return { events: [stamp(applied.master, now)], overrides: applied.overrides.map((o) => stamp(o, now)) };
}

function applyAll(master: EventDoc, overrides: OverrideDoc[], rid: string, occ: Occurrence, patch: EventPatch) {
  const { start: _s, end: _e, allDay: _a, tz: _t, ...rest } = patch;
  void _s; void _e; void _a; void _t;
  let m: EventDoc = { ...master, ...rest };
  let ovs = overrides;
  if (timeChanged(occ, patch)) {
    const full: EventPatch = { start: patch.start ?? occ.start, end: patch.end ?? occ.end, allDay: patch.allDay ?? occ.allDay, tz: patch.tz ?? occ.tz };
    // Reference is the occurrence's original slot unless it was itself moved.
    const ref = occ.isException ? occ.start : rid;
    const r = retime(m, ovs, ref, full);
    m = r.master;
    ovs = r.overrides;
  }
  return { master: normaliseEvent(m), overrides: ovs };
}

/** Plan a delete. Soft-deletes (deletedAt) so everything can be recovered. */
export function planDelete(master: EventDoc, overrides: OverrideDoc[], occ: Occurrence, scope: Scope, now = Date.now()): Writes {
  const own = overrides.filter((o) => o.seriesId === master.id && !o.deletedAt);
  if (!occ.isRecurring || scope === 'all' || (scope === 'following' && occ.recurrenceId! <= master.start)) {
    return {
      events: [{ ...master, deletedAt: now, updatedAt: now }],
      overrides: own.map((o) => ({ ...o, deletedAt: now, updatedAt: now })),
    };
  }
  const rid = occ.recurrenceId!;
  if (scope === 'this') {
    const ex = new Set(master.exdates || []);
    ex.add(rid);
    const next = normaliseEvent({ ...master, exdates: [...ex].sort() });
    return {
      events: [stamp(next, now)],
      overrides: own.filter((o) => o.recurrenceId === rid).map((o) => ({ ...o, deletedAt: now, updatedAt: now })),
    };
  }
  const t = truncateSeries(master, rid);
  return {
    events: [stamp(t, now)],
    overrides: own.filter((o) => o.recurrenceId >= rid).map((o) => ({ ...o, deletedAt: now, updatedAt: now })),
  };
}
