import { DateTime, IANAZone } from 'luxon';

/** Wall-clock local string ("2026-10-12T09:00:00") in zone → UTC ms.
 *  Nonexistent times (spring-forward gap) shift forward; ambiguous times
 *  (autumn) take the first occurrence — both per RFC 5545. */
export function localToUtc(local: string, tz: string): number {
  return DateTime.fromISO(local, { zone: tz }).toMillis();
}

export function utcToLocal(ms: number, tz: string): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export function isValidZone(tz: string | undefined | null): tz is string {
  return !!tz && IANAZone.isValidZone(tz);
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai';
  } catch {
    return 'Asia/Dubai';
  }
}

/** All-day date ("2026-10-12") → UTC ms of its midnight in the given zone. */
export function dateToUtc(date: string, tz: string): number {
  return DateTime.fromISO(date, { zone: tz }).startOf('day').toMillis();
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date).plus({ days: n }).toISODate()!;
}

export function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** "2026-10-12T09:00:00" → "20261012T090000"; "2026-10-12" → "20261012" */
export function toBasic(s: string): string {
  return s.replace(/[-:]/g, '');
}

/** "20261012T090000" → "2026-10-12T09:00:00"; "20261012" → "2026-10-12" */
export function fromBasic(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/);
  if (!m) throw new Error(`Bad date value: ${s}`);
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${d}T${m[4]}:${m[5]}:${m[6]}` : d;
}

/** Floating Date (UTC fields = wall clock) used by the rrule library. */
export function localToFloating(local: string): Date {
  const iso = isDate(local) ? `${local}T00:00:00Z` : `${local}Z`;
  return new Date(iso);
}

export function floatingToLocal(d: Date, allDay: boolean): string {
  const iso = d.toISOString(); // 2026-10-12T09:00:00.000Z
  return allDay ? iso.slice(0, 10) : iso.slice(0, 19);
}
