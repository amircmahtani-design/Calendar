import { DateTime } from 'luxon';
import type { Occurrence, Settings } from '../core/types';
import { deviceZone } from '../core/time';

// Day-first everywhere a human reads a date.

export function displayZone(s: Settings): string {
  return s.timeZone === 'device' || !s.timeZone ? deviceZone() : s.timeZone;
}

export const dt = (iso: string, zone: string) => DateTime.fromISO(iso, { zone });

export function monthTitle(d: DateTime) {
  return d.toFormat('MMMM yyyy');
}

export function weekTitle(start: DateTime, end: DateTime) {
  if (start.month === end.month) return `${start.day} – ${end.day} ${end.toFormat('MMMM yyyy')}`;
  if (start.year === end.year) return `${start.toFormat('d MMM')} – ${end.toFormat('d MMM yyyy')}`;
  return `${start.toFormat('d MMM yyyy')} – ${end.toFormat('d MMM yyyy')}`;
}

export function dayTitle(d: DateTime) {
  return d.toFormat('cccc, d MMMM yyyy');
}

export function shortDay(d: DateTime) {
  return d.toFormat('ccc, d MMM');
}

export function longDate(d: DateTime) {
  return d.toFormat('ccc, d MMMM yyyy');
}

export function timeOf(ms: number, zone: string, fmt: Settings['timeFormat']) {
  const d = DateTime.fromMillis(ms, { zone });
  return fmt === '24h' ? d.toFormat('HH:mm') : d.toFormat(d.minute ? 'h:mm a' : 'h a');
}

export function timeRange(o: Pick<Occurrence, 'startUtc' | 'endUtc' | 'allDay' | 'start' | 'end'>, zone: string, fmt: Settings['timeFormat']) {
  if (o.allDay) {
    const s = DateTime.fromISO(o.start);
    const e = DateTime.fromISO(o.end).minus({ days: 1 });
    return s.hasSame(e, 'day') ? 'All day' : `${s.toFormat('d MMM')} – ${e.toFormat('d MMM')}`;
  }
  const s = DateTime.fromMillis(o.startUtc, { zone });
  const e = DateTime.fromMillis(o.endUtc, { zone });
  const f = (d: DateTime) => (fmt === '24h' ? d.toFormat('HH:mm') : d.toFormat('h:mm a'));
  if (s.hasSame(e, 'day')) return `${f(s)} – ${f(e)}`;
  return `${s.toFormat('d MMM')} ${f(s)} – ${e.toFormat('d MMM')} ${f(e)}`;
}

/** Human description of the event's full date/time for the detail view. */
export function whenText(o: Occurrence, zone: string, fmt: Settings['timeFormat']) {
  if (o.allDay) {
    const s = DateTime.fromISO(o.start);
    const e = DateTime.fromISO(o.end).minus({ days: 1 });
    return s.hasSame(e, 'day') ? [longDate(s), 'All day'] : [`${s.toFormat('ccc, d MMM')} – ${e.toFormat('ccc, d MMM yyyy')}`, 'All day'];
  }
  const s = DateTime.fromMillis(o.startUtc, { zone });
  return [longDate(s), timeRange(o, zone, fmt)];
}

export function reminderLabel(min: number): string {
  if (min === 0) return 'At time of event';
  if (min < 60) return `${min} minutes before`;
  if (min < 1440 && min % 60 === 0) return min === 60 ? '1 hour before' : `${min / 60} hours before`;
  if (min % 10080 === 0) return min === 10080 ? '1 week before' : `${min / 10080} weeks before`;
  if (min % 1440 === 0) return min === 1440 ? '1 day before' : `${min / 1440} days before`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h ${m}m before`;
}
