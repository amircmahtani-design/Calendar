import { rrulestr } from 'rrule';
import { DateTime } from 'luxon';
import type { EventDoc, Occurrence, OverrideDoc } from './types';
import {
  addDays, dateToUtc, floatingToLocal, fromBasic, isDate, localToFloating, localToUtc, toBasic, utcToLocal,
} from './time';

// ---------------------------------------------------------------------------
// RRULE string helpers. Rules are stored as "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=..."
// with UNTIL in floating local time of the series' zone.
// ---------------------------------------------------------------------------

export type RuleParts = Record<string, string>;

export function parseRule(rule: string): RuleParts {
  const out: RuleParts = {};
  for (const part of rule.replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k && v !== undefined) out[k.toUpperCase()] = v;
  }
  return out;
}

const ORDER = ['FREQ', 'INTERVAL', 'BYSETPOS', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'WKST', 'COUNT', 'UNTIL'];

export function formatRule(p: RuleParts): string {
  const keys = Object.keys(p).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.filter((k) => p[k] !== undefined && p[k] !== '').map((k) => `${k}=${p[k]}`).join(';');
}

function buildRRule(master: Pick<EventDoc, 'start' | 'allDay' | 'rrule'>) {
  const parts = parseRule(master.rrule!);
  if (parts.UNTIL) {
    // Normalise UNTIL to a floating date-time the library can compare.
    let u = parts.UNTIL.replace(/Z$/, '');
    if (/^\d{8}$/.test(u)) u = `${u}T235959`;
    parts.UNTIL = u;
  }
  const dt = master.allDay ? `${toBasic(master.start)}T000000` : toBasic(master.start);
  return rrulestr(`DTSTART:${dt}\nRRULE:${formatRule(parts)}`);
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** Compute startUtc/endUtc for a doc's local fields. All-day uses the event zone. */
export function computeUtc(ev: Pick<EventDoc, 'allDay' | 'start' | 'end' | 'tz' | 'endTz'>): { startUtc: number; endUtc: number } {
  if (ev.allDay) {
    return { startUtc: dateToUtc(ev.start, ev.tz), endUtc: dateToUtc(ev.end, ev.tz) };
  }
  return { startUtc: localToUtc(ev.start, ev.tz), endUtc: localToUtc(ev.end, ev.endTz || ev.tz) };
}

function durationOf(ev: Pick<EventDoc, 'allDay' | 'start' | 'end' | 'tz' | 'endTz'>): number {
  if (ev.allDay) {
    return Math.round(DateTime.fromISO(ev.end).diff(DateTime.fromISO(ev.start), 'days').days);
  }
  const { startUtc, endUtc } = computeUtc(ev);
  return endUtc - startUtc;
}

/** Shift a local start by the master's duration (ms for timed, days for all-day). */
function endFor(start: string, allDay: boolean, dur: number, tz: string): string {
  if (allDay) return addDays(start, dur);
  return utcToLocal(localToUtc(start, tz) + dur, tz);
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export function isSeries(ev: Pick<EventDoc, 'rrule' | 'rdates'>): boolean {
  return !!ev.rrule || !!(ev.rdates && ev.rdates.length);
}

function baseOccurrence(ev: EventDoc): Occurrence {
  return {
    key: ev.id,
    eventId: ev.id,
    isRecurring: false,
    isException: false,
    calendarId: ev.calendarId,
    title: ev.title,
    description: ev.description,
    location: ev.location,
    meetingUrl: ev.meetingUrl,
    allDay: ev.allDay,
    start: ev.start,
    end: ev.end,
    tz: ev.tz,
    startUtc: ev.startUtc,
    endUtc: ev.endUtc,
    status: ev.status,
    privacy: ev.privacy,
    transparency: ev.transparency,
    color: ev.color,
    attendees: ev.attendees || [],
    reminders: ev.reminders || [],
    attachments: ev.attachments || [],
  };
}

function overlaps(o: { startUtc: number; endUtc: number }, from: number, to: number): boolean {
  // Zero-length events count if their start is inside the range.
  if (o.endUtc <= o.startUtc) return o.startUtc >= from && o.startUtc < to;
  return o.startUtc < to && o.endUtc > from;
}

/** All raw occurrence start values (local strings) between two floating bounds. */
function ruleStarts(master: EventDoc, fromLocal: string, toLocal: string): string[] {
  const out = new Set<string>();
  if (master.rrule) {
    const rule = buildRRule(master);
    for (const d of rule.between(localToFloating(fromLocal), localToFloating(toLocal), true)) {
      out.add(floatingToLocal(d, master.allDay));
    }
  }
  for (const r of master.rdates || []) {
    if (r >= fromLocal.slice(0, r.length) && r <= toLocal.slice(0, r.length)) out.add(r);
  }
  for (const x of master.exdates || []) out.delete(x);
  return [...out].sort();
}

function applyOverride(occ: Occurrence, ov: OverrideDoc, master: EventDoc): Occurrence {
  const c = ov.changes || {};
  const merged: Occurrence = { ...occ, ...stripUndefined(c), isException: true } as Occurrence;
  const tz = c.tz || occ.tz;
  merged.tz = tz;
  const t = computeUtc({ allDay: merged.allDay, start: merged.start, end: merged.end, tz, endTz: c.endTz || master.endTz });
  merged.startUtc = t.startUtc;
  merged.endUtc = t.endUtc;
  return merged;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/**
 * Expand an event (single or series master, with its overrides) into the
 * occurrences overlapping [fromUtc, toUtc).
 */
export function expandEvent(master: EventDoc, overrides: OverrideDoc[], fromUtc: number, toUtc: number): Occurrence[] {
  if (master.deletedAt) return [];
  if (!isSeries(master)) {
    const o = baseOccurrence(master);
    return overlaps(o, fromUtc, toUtc) ? [o] : [];
  }
  const dur = durationOf(master);
  const durMs = master.allDay ? dur * DAY : dur;
  const pad = 2 * DAY;
  const fromLocal = utcToLocal(fromUtc - durMs - pad, master.tz);
  const toLocal = utcToLocal(toUtc + pad, master.tz);
  const ovByRid = new Map<string, OverrideDoc>();
  for (const ov of overrides) if (!ov.deletedAt) ovByRid.set(ov.recurrenceId, ov);

  const result: Occurrence[] = [];
  const seen = new Set<string>();
  const exdates = new Set(master.exdates || []);

  const make = (rid: string): Occurrence => {
    const end = endFor(rid, master.allDay, dur, master.tz);
    const base = baseOccurrence(master);
    const t = computeUtc({ allDay: master.allDay, start: rid, end, tz: master.tz });
    return {
      ...base,
      key: `${master.id}::${rid}`,
      recurrenceId: rid,
      isRecurring: true,
      start: rid,
      end,
      startUtc: t.startUtc,
      endUtc: t.endUtc,
    };
  };

  for (const rid of ruleStarts(master, fromLocal, toLocal)) {
    seen.add(rid);
    const ov = ovByRid.get(rid);
    if (ov?.cancelled) continue;
    const occ = ov ? applyOverride(make(rid), ov, master) : make(rid);
    if (overlaps(occ, fromUtc, toUtc)) result.push(occ);
  }
  // Overrides moved into this range from an original slot outside it.
  for (const [rid, ov] of ovByRid) {
    if (seen.has(rid) || ov.cancelled || exdates.has(rid)) continue;
    const occ = applyOverride(make(rid), ov, master);
    if (overlaps(occ, fromUtc, toUtc)) result.push(occ);
  }
  return result.sort((a, b) => a.startUtc - b.startUtc);
}

/** Expand many events at once. */
export function expandAll(events: EventDoc[], overrides: OverrideDoc[], fromUtc: number, toUtc: number): Occurrence[] {
  const bySeries = new Map<string, OverrideDoc[]>();
  for (const o of overrides) {
    const arr = bySeries.get(o.seriesId) || [];
    arr.push(o);
    bySeries.set(o.seriesId, arr);
  }
  const out: Occurrence[] = [];
  for (const ev of events) out.push(...expandEvent(ev, bySeries.get(ev.id) || [], fromUtc, toUtc));
  return out.sort((a, b) => a.startUtc - b.startUtc || a.title.localeCompare(b.title));
}

/** UTC ms when the series' final occurrence ends; null if it repeats forever. */
export function computeSeriesEnd(master: EventDoc): number | null {
  if (!isSeries(master)) return master.endUtc;
  const dur = durationOf(master);
  let last: string | null = null;
  if (master.rrule) {
    const p = parseRule(master.rrule);
    if (!p.COUNT && !p.UNTIL) return null;
    const all = buildRRule(master).all((_, i) => i < 5000);
    const valid = all.map((d) => floatingToLocal(d, master.allDay)).filter((s) => !(master.exdates || []).includes(s));
    last = valid.length ? valid[valid.length - 1] : master.start;
  }
  for (const r of master.rdates || []) if (!last || r > last) last = r;
  last = last || master.start;
  return computeUtc({ allDay: master.allDay, start: last, end: endFor(last, master.allDay, dur, master.tz), tz: master.tz }).endUtc;
}

/** Fill derived fields (UTC times, series end). Call before every save. */
export function normaliseEvent(ev: EventDoc): EventDoc {
  const t = computeUtc(ev);
  const next: EventDoc = { ...ev, startUtc: t.startUtc, endUtc: t.endUtc };
  next.seriesEndUtc = isSeries(next) ? computeSeriesEnd(next) : null;
  return next;
}

// ---------------------------------------------------------------------------
// Series operations for "this and following"
// ---------------------------------------------------------------------------

/** Occurrence starts strictly before `rid` (for COUNT splitting). */
function countBefore(master: EventDoc, rid: string): number {
  const rule = buildRRule(master);
  const until = localToFloating(rid);
  return rule.between(localToFloating(master.start), until, true).filter((d) => floatingToLocal(d, master.allDay) < rid).length;
}

/** The local value one second (timed) or one day (all-day) before rid, in basic format. */
function untilBefore(rid: string, allDay: boolean): string {
  if (allDay) return toBasic(addDays(rid, -1));
  const d = DateTime.fromISO(rid).minus({ seconds: 1 });
  return toBasic(d.toFormat("yyyy-MM-dd'T'HH:mm:ss"));
}

/** End the series just before `rid`. Returns the truncated master. */
export function truncateSeries(master: EventDoc, rid: string): EventDoc {
  const next: EventDoc = { ...master };
  if (master.rrule) {
    const p = parseRule(master.rrule);
    if (p.COUNT) {
      p.COUNT = String(countBefore(master, rid));
      delete p.UNTIL;
    } else {
      p.UNTIL = untilBefore(rid, master.allDay);
    }
    next.rrule = formatRule(p);
  }
  next.rdates = (master.rdates || []).filter((r) => r < rid);
  next.exdates = (master.exdates || []).filter((r) => r < rid);
  return normaliseEvent(next);
}

/**
 * Split a series at occurrence `rid` for "this and following" edits.
 * Returns the truncated original, a new master starting at `rid`, and the ids
 * of overrides that now belong to the new series.
 */
export function splitSeries(master: EventDoc, overrides: OverrideDoc[], rid: string, newId: string, newUid: string) {
  const dur = durationOf(master);
  const oldMaster = truncateSeries(master, rid);
  let newRule = master.rrule || null;
  if (newRule) {
    const p = parseRule(newRule);
    if (p.COUNT) {
      const remaining = Number(p.COUNT) - countBefore(master, rid);
      p.COUNT = String(Math.max(1, remaining));
    }
    newRule = formatRule(p);
  }
  const newMaster = normaliseEvent({
    ...master,
    id: newId,
    start: rid,
    end: endFor(rid, master.allDay, dur, master.tz),
    rrule: newRule,
    rdates: (master.rdates || []).filter((r) => r >= rid),
    exdates: (master.exdates || []).filter((r) => r >= rid),
    splitFrom: master.id,
    ical: { uid: newUid, sequence: 0 },
  });
  const moved = overrides.filter((o) => o.recurrenceId >= rid).map((o) => o.id);
  return { oldMaster, newMaster, movedOverrideIds: moved };
}

/** Shift a local value by the delta between two local values (same format). */
export function shiftLocal(value: string, fromRef: string, toRef: string, allDay: boolean): string {
  if (allDay || isDate(value)) {
    const days = DateTime.fromISO(toRef.slice(0, 10)).diff(DateTime.fromISO(fromRef.slice(0, 10)), 'days').days;
    return addDays(value.slice(0, 10), Math.round(days));
  }
  const ms = DateTime.fromISO(toRef).diff(DateTime.fromISO(fromRef)).toMillis();
  return DateTime.fromISO(value).plus({ milliseconds: ms }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export { fromBasic, toBasic };
