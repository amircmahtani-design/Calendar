import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { parseIcs, toIcs, type ParsedCalendar } from './ics';
import { expandAll } from './recurrence';
import type { EventDoc, OverrideDoc } from './types';

const text = readFileSync(new URL('./fixtures/apple-family.ics', import.meta.url), 'utf8');
const utc = (s: string) => DateTime.fromISO(s, { zone: 'UTC' }).toMillis();

/** Turn parsed items into stored docs, as the import screen does. */
function materialise(p: ParsedCalendar): { events: EventDoc[]; overrides: OverrideDoc[] } {
  const events: EventDoc[] = [];
  const overrides: OverrideDoc[] = [];
  const idByUid = new Map<string, string>();
  p.items.filter((i) => i.kind === 'event').forEach((i, n) => {
    const id = `ev${n}`;
    idByUid.set(i.uid, id);
    events.push({ ...(i.event as EventDoc), id, calendarId: 'fam' });
  });
  p.items.filter((i) => i.kind === 'override').forEach((i, n) => {
    overrides.push({ ...(i.override as OverrideDoc), id: `ov${n}`, seriesId: idByUid.get(i.uid)! });
  });
  return { events, overrides };
}

describe('Apple ICS import', () => {
  const p = parseIcs(text, 'Family.ics', 'Asia/Dubai');

  it('reads calendar name and colour', () => {
    expect(p.name).toBe('Family');
    expect(p.color).toBe('#34C759');
  });

  it('counts items and reports the broken one', () => {
    expect(p.items.filter((i) => i.kind === 'event')).toHaveLength(4);
    expect(p.items.filter((i) => i.kind === 'override')).toHaveLength(1);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].message).toMatch(/start/i);
  });

  it('preserves recurring series, EXDATE and the moved exception', () => {
    const { events, overrides } = materialise(p);
    const occ = expandAll(events, overrides, utc('2026-09-01'), utc('2027-01-01')).filter((o) => o.title.startsWith('Swimming'));
    // Mondays 7 Sep → 28 Dec = 17, minus EXDATE 21 Sep = 16
    expect(occ).toHaveLength(16);
    expect(occ.find((o) => o.start.startsWith('2026-09-21'))).toBeUndefined();
    const moved = occ.find((o) => o.start.startsWith('2026-10-05'))!;
    expect(moved.title).toBe('Swimming lesson (late start)');
    expect(moved.start).toBe('2026-10-05T09:00:00');
    expect(occ.at(-1)!.start).toBe('2026-12-28T07:30:00');
  });

  it('keeps description escapes, location, alarms (dropping Apple "none" alarm)', () => {
    const swim = p.items.find((i) => i.kind === 'event' && i.uid === 'A1B2C3D4-SWIM-0001')!.event!;
    expect(swim.description).toBe('Bring towel, goggles\nand snack');
    expect(swim.location).toBe('Hamdan Sports Complex');
    expect(swim.reminders).toEqual([{ minutesBefore: 30 }]);
    expect(swim.ical?.raw?.['X-APPLE-STRUCTURED-LOCATION']).toBeDefined();
  });

  it('keeps all-day dates exactly', () => {
    const b = p.items.find((i) => i.uid === 'BAPTISM-0001')!.event!;
    expect(b.allDay).toBe(true);
    expect(b.start).toBe('2027-06-24');
    expect(b.end).toBe('2027-06-25');
  });

  it('converts UTC times into the home zone with the right instant', () => {
    const f = p.items.find((i) => i.uid === 'FLIGHT-0001')!.event!;
    expect(f.tz).toBe('Asia/Dubai');
    expect(f.start).toBe('2026-10-20T07:00:00');
    expect(f.startUtc).toBe(utc('2026-10-20T03:00:00'));
    expect(f.attendees[0]).toMatchObject({ email: 'lia@example.com', name: 'Lia' });
  });

  it('keeps foreign zones, so Madrid 19:00 stays 19:00 across the DST change', () => {
    const { events } = materialise(p);
    const occ = expandAll(events, [], utc('2026-10-19'), utc('2026-11-01')).filter((o) => o.title === 'Padel in Madrid');
    expect(occ).toHaveLength(10);
    expect(occ.every((o) => DateTime.fromMillis(o.startUtc, { zone: 'Europe/Madrid' }).hour === 19)).toBe(true);
  });

  it('warns about what Apple did not export', () => {
    expect(p.warnings.join(' ')).toMatch(/attachments/);
    expect(p.warnings.join(' ')).toMatch(/travel time/);
    expect(p.warnings.join(' ')).toMatch(/map pins/);
  });

  it('dedupe keys are stable across repeat imports', () => {
    const again = parseIcs(text, 'Family.ics', 'Asia/Dubai');
    expect(again.items.map((i) => i.key)).toEqual(p.items.map((i) => i.key));
  });
});

describe('ICS export round trip', () => {
  it('exports and re-imports to identical occurrences', () => {
    const p = parseIcs(text, 'Family.ics', 'Asia/Dubai');
    const { events, overrides } = materialise(p);
    const out = toIcs(events, overrides, [], { calendarName: 'Family', calendarColor: '#34C759' });
    expect(out).toMatch(/BEGIN:VTIMEZONE\r\nTZID:Europe\/Madrid/);
    expect(out.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const p2 = parseIcs(out, 'x.ics', 'Asia/Dubai');
    expect(p2.errors).toEqual([]);
    const m2 = materialise(p2);
    const range = [utc('2026-01-01'), utc('2028-01-01')] as const;
    const a = expandAll(events, overrides, ...range).map((o) => `${o.title}|${o.startUtc}|${o.endUtc}`);
    const b = expandAll(m2.events, m2.overrides, ...range).map((o) => `${o.title}|${o.startUtc}|${o.endUtc}`);
    expect(b).toEqual(a);
  });

  it('cancelled occurrences export as EXDATE', () => {
    const p = parseIcs(text, 'Family.ics', 'Asia/Dubai');
    const { events, overrides } = materialise(p);
    const swim = events.find((e) => e.title === 'Swimming lesson')!;
    overrides.push({ id: 'c', seriesId: swim.id, recurrenceId: '2026-11-02T07:30:00', cancelled: true, changes: {} });
    const out = toIcs(events, overrides, []);
    expect(out).toContain('EXDATE;TZID=Asia/Dubai:20261102T073000');
  });
});
