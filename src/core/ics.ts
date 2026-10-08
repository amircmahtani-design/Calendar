import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import type { Attendee, CalendarDoc, EventDoc, EventStatus, OverrideDoc, Privacy, Reminder } from './types';
import { formatRule, normaliseEvent, parseRule, computeUtc } from './recurrence';
import { fromBasic, isValidZone, toBasic, utcToLocal } from './time';

// ===========================================================================
// IMPORT
// ===========================================================================

export interface ParsedItem {
  key: string; // dedupe key: uid|recurrenceId
  uid: string;
  kind: 'event' | 'override';
  event?: Omit<EventDoc, 'id' | 'calendarId'>;
  override?: Omit<OverrideDoc, 'id' | 'seriesId'>;
  sequence: number;
  summary: string;
  when: string;
}

export interface ParsedCalendar {
  fileName: string;
  name: string;
  color?: string;
  items: ParsedItem[];
  errors: { item: string; message: string }[];
  inventory: Record<string, number>;
  warnings: string[];
}

const WINDOWS_TZ: Record<string, string> = {
  'Arabian Standard Time': 'Asia/Dubai',
  'Romance Standard Time': 'Europe/Madrid',
  'GTB Standard Time': 'Europe/Athens',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles',
  'India Standard Time': 'Asia/Kolkata',
  'Singapore Standard Time': 'Asia/Singapore',
  UTC: 'UTC',
};

// Properties we map into fields. Everything else on a VEVENT is preserved raw.
const MAPPED = new Set([
  'uid', 'dtstart', 'dtend', 'duration', 'summary', 'description', 'location', 'url', 'rrule', 'rdate', 'exdate',
  'recurrence-id', 'status', 'class', 'transp', 'sequence', 'attendee', 'dtstamp', 'created', 'last-modified',
  'organizer', 'x-apple-travel-advisory-behavior',
]);

interface TimeInfo {
  allDay: boolean;
  local: string; // in chosen tz, or date
  tz: string;
  utc: number;
  kind: 'date' | 'utc' | 'zoned' | 'floating' | 'unknown-zone';
}

function readTime(prop: ICAL.Property | null, defaultTz: string, forceTz?: string): TimeInfo | null {
  if (!prop) return null;
  const t = prop.getFirstValue() as ICAL.Time;
  if (!t) return null;
  if (t.isDate) {
    const d = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
    return { allDay: true, local: d, tz: forceTz || defaultTz, utc: 0, kind: 'date' };
  }
  const tzidRaw = prop.getParameter('tzid') as string | undefined;
  const wall = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}T${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}:${String(t.second).padStart(2, '0')}`;
  const isUtc = t.zone === ICAL.Timezone.utcTimezone || /Z$/.test(String(prop.toICALString()));
  if (isUtc) {
    const utc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
    const tz = forceTz || defaultTz;
    return { allDay: false, local: utcToLocal(utc, tz), tz, utc, kind: 'utc' };
  }
  if (tzidRaw) {
    const tzid = tzidRaw.replace(/^\/[^/]*\//, ''); // strip "/mozilla.org/..." style prefixes
    const iana = isValidZone(tzid) ? tzid : WINDOWS_TZ[tzid];
    if (iana) {
      const utc = DateTime.fromISO(wall, { zone: iana }).toMillis();
      const tz = forceTz || iana;
      return { allDay: false, local: tz === iana ? wall : utcToLocal(utc, tz), tz, utc, kind: 'zoned' };
    }
    // Unknown TZID: rely on the file's VTIMEZONE via ical.js, then use default zone.
    try {
      const utc = t.toUnixTime() * 1000;
      const tz = forceTz || defaultTz;
      return { allDay: false, local: utcToLocal(utc, tz), tz, utc, kind: 'unknown-zone' };
    } catch {
      /* fall through to floating */
    }
  }
  const tz = forceTz || defaultTz;
  return { allDay: false, local: wall, tz, utc: DateTime.fromISO(wall, { zone: tz }).toMillis(), kind: 'floating' };
}

function text(comp: ICAL.Component, name: string): string | undefined {
  const v = comp.getFirstPropertyValue(name);
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function readAlarms(comp: ICAL.Component, startUtc: number): Reminder[] {
  const out: Reminder[] = [];
  for (const a of comp.getAllSubcomponents('valarm')) {
    const action = String(a.getFirstPropertyValue('action') || '').toUpperCase();
    if (action === 'NONE') continue;
    const trig = a.getFirstProperty('trigger');
    if (!trig) continue;
    const v = trig.getFirstValue() as ICAL.Duration | ICAL.Time;
    let minutes: number | null = null;
    if (v instanceof ICAL.Duration) {
      const related = String(trig.getParameter('related') || 'START').toUpperCase();
      if (related === 'END') continue; // rare; skip rather than misplace
      minutes = Math.round(-v.toSeconds() / 60);
    } else if (v instanceof ICAL.Time) {
      const abs = v.toUnixTime() * 1000;
      if (abs < 0 || new Date(abs).getUTCFullYear() < 1980) continue; // Apple's "no alarm" sentinel
      minutes = Math.round((startUtc - abs) / 60000);
    }
    if (minutes === null || minutes < 0) minutes = 0;
    if (!out.some((r) => r.minutesBefore === minutes)) out.push({ minutesBefore: minutes });
  }
  return out.sort((a, b) => a.minutesBefore - b.minutesBefore);
}

function readAttendees(comp: ICAL.Component): Attendee[] {
  return comp.getAllProperties('attendee').map((p) => ({
    email: String(p.getFirstValue() || '').replace(/^mailto:/i, ''),
    name: (p.getParameter('cn') as string) || undefined,
    role: (p.getParameter('role') as string) || undefined,
    partstat: (p.getParameter('partstat') as string) || undefined,
  })).filter((a) => a.email);
}

function multiDates(comp: ICAL.Component, name: string, tz: string, allDay: boolean): string[] {
  const out: string[] = [];
  for (const p of comp.getAllProperties(name)) {
    const tzid = p.getParameter('tzid') as string | undefined;
    for (const v of p.getValues() as (ICAL.Time | ICAL.Period)[]) {
      const t = v instanceof ICAL.Period ? v.start : v;
      if (!(t instanceof ICAL.Time)) continue;
      if (t.isDate || allDay) {
        out.push(`${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`);
        continue;
      }
      const wall = `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}T${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}:${String(t.second).padStart(2, '0')}`;
      let utc: number;
      if (t.zone === ICAL.Timezone.utcTimezone) utc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
      else if (tzid && (isValidZone(tzid) || WINDOWS_TZ[tzid])) utc = DateTime.fromISO(wall, { zone: isValidZone(tzid) ? tzid : WINDOWS_TZ[tzid] }).toMillis();
      else { out.push(wall); continue; }
      out.push(utcToLocal(utc, tz));
    }
  }
  return [...new Set(out)].sort();
}

/** Convert an RRULE's UTC UNTIL into floating local time in the series' zone. */
function normaliseRule(recur: string, tz: string, allDay: boolean): string {
  const p = parseRule(recur);
  if (p.UNTIL) {
    const u = p.UNTIL;
    if (/Z$/.test(u)) {
      const utc = DateTime.fromFormat(u, "yyyyMMdd'T'HHmmss'Z'", { zone: 'UTC' }).toMillis();
      p.UNTIL = allDay ? toBasic(utcToLocal(utc, tz).slice(0, 10)) : toBasic(utcToLocal(utc, tz));
    } else if (allDay && u.length > 8) {
      p.UNTIL = u.slice(0, 8);
    }
  }
  return formatRule(p);
}

function rawProps(comp: ICAL.Component): Record<string, string[]> {
  const raw: Record<string, string[]> = {};
  for (const p of comp.getAllProperties()) {
    const name = p.name.toLowerCase();
    if (MAPPED.has(name)) continue;
    (raw[name.toUpperCase()] ||= []).push(p.toICALString());
  }
  for (const sub of comp.getAllSubcomponents()) {
    if (sub.name === 'valarm') continue;
    (raw[`BEGIN:${sub.name.toUpperCase()}`] ||= []).push(sub.toString());
  }
  return raw;
}

const STATUS: Record<string, EventStatus> = { CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELLED: 'cancelled' };
const PRIVACY: Record<string, Privacy> = { PRIVATE: 'private', CONFIDENTIAL: 'private', PUBLIC: 'public' };

function bump(inv: Record<string, number>, k: string, n = 1) {
  inv[k] = (inv[k] || 0) + n;
}

export function parseIcs(textIn: string, fileName: string, defaultTz: string): ParsedCalendar {
  const result: ParsedCalendar = { fileName, name: fileName.replace(/\.ics$/i, ''), items: [], errors: [], inventory: {}, warnings: [] };
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(textIn));
  } catch (e) {
    result.errors.push({ item: fileName, message: `Not a valid calendar file: ${(e as Error).message}` });
    return result;
  }
  const name = text(root, 'x-wr-calname');
  if (name) result.name = name;
  const color = text(root, 'x-apple-calendar-color');
  if (color && /^#[0-9a-f]{6}/i.test(color)) result.color = color.slice(0, 7).toUpperCase();
  const calTz = text(root, 'x-wr-timezone');
  const fallbackTz = isValidZone(calTz) ? calTz : defaultTz;

  ICAL.TimezoneService.reset();
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(vtz); } catch { /* ignore broken zones */ }
  }

  const vevents = root.getAllSubcomponents('vevent');
  if (!vevents.length) result.warnings.push('This file contains no events.');
  const masterTz = new Map<string, { tz: string; allDay: boolean }>();

  // Pass 1: masters and single events, so overrides can use the master's zone.
  const ordered = [...vevents].sort((a, b) => Number(!!a.getFirstProperty('recurrence-id')) - Number(!!b.getFirstProperty('recurrence-id')));
  for (const c of ordered) {
    const uid = text(c, 'uid') || `nouid-${Math.random().toString(36).slice(2)}`;
    const summary = text(c, 'summary') || '(No title)';
    try {
      if (!text(c, 'uid')) bump(result.inventory, 'missingUid');
      const ridProp = c.getFirstProperty('recurrence-id');
      const master = ridProp ? masterTz.get(uid) : undefined;
      const start = readTime(c.getFirstProperty('dtstart'), fallbackTz, master?.tz);
      if (!start) throw new Error('Missing start date');
      bump(result.inventory, `time:${start.kind}`);
      let end = readTime(c.getFirstProperty('dtend'), fallbackTz, start.allDay ? undefined : start.tz);
      if (!end) {
        const dur = c.getFirstPropertyValue('duration') as ICAL.Duration | null;
        if (start.allDay) {
          const days = dur ? Math.max(1, Math.round(dur.toSeconds() / 86400)) : 1;
          end = { ...start, local: DateTime.fromISO(start.local).plus({ days }).toISODate()! };
        } else {
          const secs = dur ? dur.toSeconds() : 0;
          const utc = start.utc + secs * 1000;
          end = { ...start, utc, local: utcToLocal(utc, start.tz) };
        }
      }
      if (start.allDay && end.local <= start.local) end = { ...end, local: DateTime.fromISO(start.local).plus({ days: 1 }).toISODate()! };
      if (!start.allDay && end.utc < start.utc) end = { ...start };

      const base = {
        title: summary,
        description: text(c, 'description'),
        location: text(c, 'location'),
        meetingUrl: text(c, 'url'),
        allDay: start.allDay,
        start: start.local,
        end: end.local,
        tz: start.tz,
        endTz: !start.allDay && end.tz !== start.tz ? end.tz : undefined,
        status: STATUS[String(text(c, 'status') || '').toUpperCase()] || 'confirmed',
        privacy: PRIVACY[String(text(c, 'class') || '').toUpperCase()] || 'default',
        transparency: String(text(c, 'transp') || '').toUpperCase() === 'TRANSPARENT' ? 'free' as const : 'busy' as const,
        attendees: readAttendees(c),
        attachments: [] as { title: string; url: string }[],
      };
      const t = computeUtc({ ...base });
      const reminders = readAlarms(c, t.startUtc);
      if (reminders.length) bump(result.inventory, 'alarms');
      if (base.attendees.length) bump(result.inventory, 'attendees');
      if (c.getFirstProperty('attach')) bump(result.inventory, 'attachments');
      if (c.getFirstProperty('x-apple-travel-duration') || c.getFirstProperty('x-apple-travel-advisory-behavior')) bump(result.inventory, 'travelTime');
      if (c.getFirstProperty('x-apple-structured-location')) bump(result.inventory, 'mapLocation');
      if (base.meetingUrl) bump(result.inventory, 'urls');
      const sequence = Number(c.getFirstPropertyValue('sequence') || 0);
      const raw = rawProps(c);

      if (ridProp) {
        const rid = readTime(ridProp, fallbackTz, master?.tz);
        if (!rid) throw new Error('Bad RECURRENCE-ID');
        const ridLocal = master?.allDay ? rid.local.slice(0, 10) : rid.local;
        bump(result.inventory, 'exceptions');
        result.items.push({
          key: `${uid}|${ridLocal}`, uid, kind: 'override', sequence, summary, when: start.local,
          override: {
            recurrenceId: ridLocal,
            cancelled: base.status === 'cancelled' || undefined,
            changes: { ...base, reminders },
            ical: { uid, sequence, raw },
            source: { type: 'import' },
          },
        });
        continue;
      }

      const recur = c.getFirstPropertyValue('rrule') as ICAL.Recur | null;
      const rrule = recur ? normaliseRule(recur.toString(), start.tz, start.allDay) : null;
      if (rrule) bump(result.inventory, 'recurring');
      const exdates = multiDates(c, 'exdate', start.tz, start.allDay);
      const rdates = multiDates(c, 'rdate', start.tz, start.allDay);
      masterTz.set(uid, { tz: start.tz, allDay: start.allDay });
      const event = normaliseEvent({
        id: '', calendarId: '', ...base, ...t, reminders, rrule, exdates, rdates,
        ical: { uid, sequence, raw }, source: { type: 'import' },
      } as EventDoc);
      const { id: _i, calendarId: _c, ...rest } = event;
      void _i; void _c;
      result.items.push({ key: `${uid}|`, uid, kind: 'event', event: rest, sequence, summary, when: start.local });
    } catch (e) {
      result.errors.push({ item: `${summary} (${uid})`, message: (e as Error).message });
    }
  }

  // Overrides whose master is missing become standalone events.
  const masters = new Set(result.items.filter((i) => i.kind === 'event').map((i) => i.uid));
  for (const it of result.items) {
    if (it.kind === 'override' && !masters.has(it.uid) && it.override && !it.override.cancelled) {
      const c = it.override.changes;
      const ev = normaliseEvent({
        id: '', calendarId: '', title: c.title || '(No title)', description: c.description, location: c.location, meetingUrl: c.meetingUrl,
        allDay: !!c.allDay, start: c.start!, end: c.end!, tz: c.tz || fallbackTz, startUtc: 0, endUtc: 0,
        status: c.status || 'confirmed', privacy: c.privacy || 'default', transparency: c.transparency || 'busy',
        attendees: c.attendees || [], reminders: c.reminders || [], attachments: [],
        ical: { uid: it.uid, sequence: it.sequence }, source: { type: 'import' },
      });
      const { id: _i, calendarId: _c, ...rest } = ev;
      void _i; void _c;
      it.kind = 'event';
      it.event = rest;
      it.override = undefined;
      bump(result.inventory, 'orphanExceptions');
    }
  }
  result.items = result.items.filter((i) => !(i.kind === 'override' && !masters.has(i.uid)));

  if (result.inventory.attachments) result.warnings.push(`${result.inventory.attachments} event(s) reference file attachments. Apple does not include the files in the export; titles and links are kept where present.`);
  if (result.inventory.travelTime) result.warnings.push(`${result.inventory.travelTime} event(s) have Apple travel time. It is kept in the raw data but not shown as a separate block.`);
  if (result.inventory.mapLocation) result.warnings.push(`${result.inventory.mapLocation} event(s) have Apple map pins. The address text is kept; the pin is stored raw.`);
  if (result.inventory['time:floating']) result.warnings.push(`${result.inventory['time:floating']} event(s) have no time zone ("floating"). They will be placed in ${fallbackTz}.`);
  if (result.inventory['time:unknown-zone']) result.warnings.push(`${result.inventory['time:unknown-zone']} event(s) use a non-standard time zone name. Times are converted exactly and stored in ${fallbackTz}.`);
  if (result.inventory.orphanExceptions) result.warnings.push(`${result.inventory.orphanExceptions} changed occurrence(s) arrived without their parent series and will be imported as single events.`);
  return result;
}

// ===========================================================================
// EXPORT
// ===========================================================================

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (curLen + l > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function stamp(ms: number): string {
  return DateTime.fromMillis(ms, { zone: 'UTC' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function dtLine(name: string, value: string, tz: string, allDay: boolean): string {
  if (allDay) return `${name};VALUE=DATE:${toBasic(value.slice(0, 10))}`;
  if (tz === 'UTC') return `${name}:${toBasic(value)}Z`;
  return `${name};TZID=${tz}:${toBasic(value)}`;
}

function offsetStr(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}

/** Build a VTIMEZONE from the IANA database for the given year span. */
export function vtimezone(tz: string, fromYear: number, toYear: number): string[] {
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  const start = DateTime.fromObject({ year: fromYear, month: 1, day: 1 }, { zone: tz });
  let prev = start.offset;
  const transitions: { at: DateTime; from: number; to: number }[] = [];
  let cursor = start;
  const end = DateTime.fromObject({ year: toYear + 1, month: 1, day: 1 }, { zone: tz });
  while (cursor < end) {
    const next = cursor.plus({ days: 1 });
    if (next.offset !== prev) {
      // binary search the exact minute
      let lo = cursor.toMillis(), hi = next.toMillis();
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
        if (DateTime.fromMillis(mid, { zone: tz }).offset === prev) lo = mid; else hi = mid;
      }
      transitions.push({ at: DateTime.fromMillis(hi, { zone: 'UTC' }), from: prev, to: next.offset });
      prev = next.offset;
    }
    cursor = next;
  }
  if (!transitions.length) {
    const name = start.offsetNameShort || tz;
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${offsetStr(start.offset)}`, `TZOFFSETTO:${offsetStr(start.offset)}`, `TZNAME:${name}`, 'END:STANDARD');
  } else {
    for (const t of transitions) {
      const kind = t.to > t.from ? 'DAYLIGHT' : 'STANDARD';
      const localBefore = t.at.plus({ minutes: t.from }).toFormat("yyyyMMdd'T'HHmmss");
      lines.push(`BEGIN:${kind}`, `DTSTART:${localBefore}`, `TZOFFSETFROM:${offsetStr(t.from)}`, `TZOFFSETTO:${offsetStr(t.to)}`, `END:${kind}`);
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function ruleForExport(rrule: string, tz: string, allDay: boolean): string {
  const p = parseRule(rrule);
  if (p.UNTIL && !allDay && !/Z$/.test(p.UNTIL)) {
    // Floating local UNTIL → UTC, as RFC 5545 requires when DTSTART has a TZID.
    const local = fromBasic(p.UNTIL);
    p.UNTIL = stamp(DateTime.fromISO(local, { zone: tz }).toMillis());
  }
  return formatRule(p);
}

function eventLines(e: {
  uid: string; sequence?: number; title: string; description?: string; location?: string; meetingUrl?: string;
  allDay: boolean; start: string; end: string; tz: string; endTz?: string; status: EventStatus; privacy: Privacy;
  transparency: string; reminders: Reminder[]; attendees: Attendee[]; updatedAt?: number; createdAt?: number;
  raw?: Record<string, string[]>;
}, extra: string[]): string[] {
  const L = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(e.updatedAt || Date.now())}`];
  if (e.createdAt) L.push(`CREATED:${stamp(e.createdAt)}`);
  if (e.updatedAt) L.push(`LAST-MODIFIED:${stamp(e.updatedAt)}`);
  L.push(dtLine('DTSTART', e.start, e.tz, e.allDay));
  L.push(dtLine('DTEND', e.end, e.endTz || e.tz, e.allDay));
  L.push(...extra);
  L.push(`SUMMARY:${esc(e.title || '')}`);
  if (e.description) L.push(`DESCRIPTION:${esc(e.description)}`);
  if (e.location) L.push(`LOCATION:${esc(e.location)}`);
  if (e.meetingUrl) L.push(`URL:${e.meetingUrl}`);
  if (e.sequence) L.push(`SEQUENCE:${e.sequence}`);
  L.push(`STATUS:${e.status.toUpperCase()}`);
  if (e.privacy !== 'default') L.push(`CLASS:${e.privacy === 'private' ? 'PRIVATE' : 'PUBLIC'}`);
  L.push(`TRANSP:${e.transparency === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`);
  for (const a of e.attendees || []) {
    const params = [a.name ? `CN=${esc(a.name)}` : '', a.role ? `ROLE=${a.role}` : '', a.partstat ? `PARTSTAT=${a.partstat}` : ''].filter(Boolean).join(';');
    L.push(`ATTENDEE${params ? ';' + params : ''}:mailto:${a.email}`);
  }
  // Preserve unmapped properties from the original import (X-APPLE-*, etc.)
  for (const [k, vals] of Object.entries(e.raw || {})) {
    if (k.startsWith('BEGIN:')) continue;
    for (const v of vals) L.push(...v.split(/\r?\n/));
  }
  for (const r of e.reminders || []) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title || 'Reminder')}`, `TRIGGER:${r.minutesBefore === 0 ? 'PT0S' : `-PT${r.minutesBefore}M`}`, 'END:VALARM');
  }
  L.push('END:VEVENT');
  return L;
}

export interface ExportOptions {
  calendarName?: string;
  calendarColor?: string;
  fromUtc?: number;
  toUtc?: number;
}

export function toIcs(events: EventDoc[], overrides: OverrideDoc[], calendars: CalendarDoc[], opts: ExportOptions = {}): string {
  const live = events.filter((e) => !e.deletedAt).filter((e) => {
    if (opts.fromUtc === undefined && opts.toUtc === undefined) return true;
    const end = e.rrule || e.rdates?.length ? (e.seriesEndUtc ?? Infinity) : e.endUtc;
    return (opts.toUtc === undefined || e.startUtc < opts.toUtc) && (opts.fromUtc === undefined || end > opts.fromUtc);
  });
  const ids = new Set(live.map((e) => e.id));
  const ovs = overrides.filter((o) => ids.has(o.seriesId) && !o.deletedAt);
  const zones = new Set<string>();
  let minY = 3000, maxY = 0;
  for (const e of live) {
    if (!e.allDay && e.tz !== 'UTC') zones.add(e.tz);
    if (e.endTz) zones.add(e.endTz);
    const y = Number(e.start.slice(0, 4));
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, Number(e.end.slice(0, 4)), e.rrule ? new Date().getUTCFullYear() + 5 : 0);
  }
  for (const o of ovs) if (o.changes.tz) zones.add(o.changes.tz);
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amir Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (opts.calendarName) L.push(`X-WR-CALNAME:${esc(opts.calendarName)}`);
  if (opts.calendarColor) L.push(`X-APPLE-CALENDAR-COLOR:${opts.calendarColor}`);
  if (minY <= maxY) for (const z of zones) L.push(...vtimezone(z, Math.max(minY - 1, 1970), Math.min(maxY, minY + 60)));
  const calName = new Map(calendars.map((c) => [c.id, c.name]));
  for (const e of live) {
    const uid = e.ical?.uid || `${e.id}@amir-calendar`;
    const extra: string[] = [];
    if (e.rrule) extra.push(`RRULE:${ruleForExport(e.rrule, e.tz, e.allDay)}`);
    for (const x of e.exdates || []) extra.push(dtLine('EXDATE', x, e.tz, e.allDay));
    for (const r of e.rdates || []) extra.push(dtLine('RDATE', r, e.tz, e.allDay));
    // Cancelled occurrences are exported as EXDATEs for the widest client compatibility.
    for (const o of ovs) if (o.seriesId === e.id && o.cancelled && !(e.exdates || []).includes(o.recurrenceId)) extra.push(dtLine('EXDATE', o.recurrenceId, e.tz, e.allDay));
    if (!opts.calendarName && calName.get(e.calendarId)) extra.push(`CATEGORIES:${esc(calName.get(e.calendarId)!)}`);
    L.push(...eventLines({ ...e, uid, sequence: e.ical?.sequence, raw: e.ical?.raw }, extra));
    for (const o of ovs.filter((x) => x.seriesId === e.id && !x.cancelled)) {
      const merged = { ...e, ...o.changes };
      L.push(...eventLines({ ...merged, uid, sequence: o.ical?.sequence ?? e.ical?.sequence, raw: o.ical?.raw }, [dtLine('RECURRENCE-ID', o.recurrenceId, e.tz, e.allDay)]));
    }
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
