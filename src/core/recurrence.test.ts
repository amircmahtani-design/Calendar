import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { EventDoc, OverrideDoc } from './types';
import { expandEvent, normaliseEvent, splitSeries, truncateSeries, parseRule } from './recurrence';

function ev(p: Partial<EventDoc>): EventDoc {
  return normaliseEvent({
    id: 'e1', calendarId: 'c1', title: 'T', allDay: false,
    start: '2026-01-05T09:00:00', end: '2026-01-05T10:00:00', tz: 'Asia/Dubai',
    startUtc: 0, endUtc: 0, status: 'confirmed', privacy: 'default', transparency: 'busy',
    attendees: [], reminders: [], attachments: [], ...p,
  });
}
const utc = (s: string, z = 'UTC') => DateTime.fromISO(s, { zone: z }).toMillis();
const starts = (e: EventDoc, from: string, to: string, ovs: OverrideDoc[] = []) =>
  expandEvent(e, ovs, utc(from), utc(to)).map((o) => o.start);

describe('single events', () => {
  it('returns event overlapping range', () => {
    expect(starts(ev({}), '2026-01-05', '2026-01-06')).toEqual(['2026-01-05T09:00:00']);
    expect(starts(ev({}), '2026-01-06', '2026-01-07')).toEqual([]);
  });
  it('multi-day all-day event overlaps each day', () => {
    const e = ev({ allDay: true, start: '2026-01-05', end: '2026-01-08' });
    expect(starts(e, '2026-01-07T00:00:00', '2026-01-07T23:00:00', ).length).toBe(1);
  });
});

describe('frequencies', () => {
  it('daily with count', () => {
    const e = ev({ rrule: 'FREQ=DAILY;COUNT=3' });
    expect(starts(e, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05T09:00:00', '2026-01-06T09:00:00', '2026-01-07T09:00:00']);
    expect(e.seriesEndUtc).toBe(utc('2026-01-07T10:00:00', 'Asia/Dubai'));
  });
  it('every weekday', () => {
    const e = ev({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    expect(starts(e, '2026-01-05', '2026-01-12')).toHaveLength(5);
  });
  it('every 2 weeks on Mon and Wed until a date', () => {
    const e = ev({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260131T235959' });
    expect(starts(e, '2026-01-01', '2026-03-01')).toEqual([
      '2026-01-05T09:00:00', '2026-01-07T09:00:00', '2026-01-19T09:00:00', '2026-01-21T09:00:00',
    ]);
  });
  it('last weekday of month', () => {
    const e = ev({ start: '2026-01-30T09:00:00', end: '2026-01-30T10:00:00', rrule: 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=4' });
    expect(starts(e, '2026-01-01', '2026-06-01')).toEqual([
      '2026-01-30T09:00:00', '2026-02-27T09:00:00', '2026-03-31T09:00:00', '2026-04-30T09:00:00',
    ]);
  });
  it('31st of month skips short months (RFC 5545)', () => {
    const e = ev({ start: '2026-01-31T09:00:00', end: '2026-01-31T10:00:00', rrule: 'FREQ=MONTHLY;COUNT=3' });
    expect(starts(e, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31T09:00:00', '2026-03-31T09:00:00', '2026-05-31T09:00:00']);
  });
  it('last day of month via BYMONTHDAY=-1', () => {
    const e = ev({ start: '2026-01-31T09:00:00', end: '2026-01-31T10:00:00', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3' });
    expect(starts(e, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31T09:00:00', '2026-02-28T09:00:00', '2026-03-31T09:00:00']);
  });
  it('29 February yearly only lands in leap years', () => {
    const e = ev({ allDay: true, start: '2028-02-29', end: '2028-03-01', rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29' });
    expect(starts(e, '2028-01-01', '2037-01-01')).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });
  it('second Tuesday monthly', () => {
    const e = ev({ start: '2026-01-13T09:00:00', end: '2026-01-13T10:00:00', rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=2' });
    expect(starts(e, '2026-01-01', '2026-12-31')).toEqual(['2026-01-13T09:00:00', '2026-02-10T09:00:00']);
  });
  it('all-day yearly birthday', () => {
    const e = ev({ allDay: true, start: '2026-06-24', end: '2026-06-25', rrule: 'FREQ=YEARLY' });
    expect(starts(e, '2027-01-01', '2028-01-01')).toEqual(['2027-06-24']);
  });
});

describe('daylight saving', () => {
  const madrid = (p: Partial<EventDoc>) => ev({ tz: 'Europe/Madrid', ...p });
  it('keeps 09:00 local across spring and autumn transitions', () => {
    const e = madrid({ start: '2026-03-23T09:00:00', end: '2026-03-23T10:00:00', rrule: 'FREQ=WEEKLY' });
    const occ = expandEvent(e, [], utc('2026-03-20'), utc('2026-04-10'));
    expect(occ.map((o) => DateTime.fromMillis(o.startUtc, { zone: 'Europe/Madrid' }).toFormat('HH:mm'))).toEqual(['09:00', '09:00', '09:00']);
    // UTC hour moves from 08:00 to 07:00
    expect(new Date(occ[0].startUtc).getUTCHours()).toBe(8);
    expect(new Date(occ[1].startUtc).getUTCHours()).toBe(7);
  });
  it('nonexistent 02:30 on spring-forward day shifts to 03:30', () => {
    const e = madrid({ start: '2026-03-22T02:30:00', end: '2026-03-22T03:00:00', rrule: 'FREQ=WEEKLY;COUNT=2' });
    const occ = expandEvent(e, [], utc('2026-03-20'), utc('2026-04-01'));
    expect(DateTime.fromMillis(occ[1].startUtc, { zone: 'Europe/Madrid' }).toFormat('HH:mm')).toBe('03:30');
  });
  it('ambiguous 02:30 on fall-back day takes first occurrence', () => {
    const e = madrid({ start: '2026-10-18T02:30:00', end: '2026-10-18T03:00:00', rrule: 'FREQ=WEEKLY;COUNT=2' });
    const occ = expandEvent(e, [], utc('2026-10-17'), utc('2026-10-30'));
    expect(DateTime.fromMillis(occ[1].startUtc, { zone: 'Europe/Madrid' }).offset).toBe(120);
  });
  it('Dubai (no DST) daily viewed across a European transition stays fixed in UTC', () => {
    const e = ev({ start: '2026-10-24T09:00:00', end: '2026-10-24T10:00:00', rrule: 'FREQ=DAILY;COUNT=3' });
    const occ = expandEvent(e, [], utc('2026-10-23'), utc('2026-10-30'));
    expect(occ.map((o) => new Date(o.startUtc).getUTCHours())).toEqual([5, 5, 5]);
  });
});

describe('exceptions', () => {
  const series = ev({ rrule: 'FREQ=DAILY;COUNT=5' });
  it('EXDATE removes one occurrence', () => {
    const e = { ...series, exdates: ['2026-01-07T09:00:00'] };
    expect(starts(e, '2026-01-01', '2026-02-01')).not.toContain('2026-01-07T09:00:00');
    expect(starts(e, '2026-01-01', '2026-02-01')).toHaveLength(4);
  });
  it('RDATE adds an extra occurrence', () => {
    const e = { ...series, rdates: ['2026-01-20T09:00:00'] };
    expect(starts(e, '2026-01-01', '2026-02-01')).toContain('2026-01-20T09:00:00');
  });
  it('override changes title and time of one occurrence only', () => {
    const ov: OverrideDoc = { id: 'o1', seriesId: 'e1', recurrenceId: '2026-01-06T09:00:00', changes: { title: 'Moved', start: '2026-01-06T14:00:00', end: '2026-01-06T15:00:00' } };
    const occ = expandEvent(series, [ov], utc('2026-01-01'), utc('2026-02-01'));
    expect(occ).toHaveLength(5);
    const moved = occ.find((o) => o.recurrenceId === '2026-01-06T09:00:00')!;
    expect(moved.title).toBe('Moved');
    expect(moved.start).toBe('2026-01-06T14:00:00');
    expect(moved.isException).toBe(true);
    expect(occ.filter((o) => o.title === 'T')).toHaveLength(4);
  });
  it('cancelled override hides that occurrence, series intact', () => {
    const ov: OverrideDoc = { id: 'o1', seriesId: 'e1', recurrenceId: '2026-01-06T09:00:00', cancelled: true, changes: {} };
    expect(starts(series, '2026-01-01', '2026-02-01', [ov])).toHaveLength(4);
  });
  it('override moved into a range from outside appears', () => {
    const ov: OverrideDoc = { id: 'o1', seriesId: 'e1', recurrenceId: '2026-01-05T09:00:00', changes: { start: '2026-01-20T09:00:00', end: '2026-01-20T10:00:00' } };
    expect(starts(series, '2026-01-19', '2026-01-21', [ov])).toEqual(['2026-01-20T09:00:00']);
  });
});

describe('this and following', () => {
  it('splits an infinite weekly series preserving history', () => {
    const e = ev({ rrule: 'FREQ=WEEKLY' });
    const ov: OverrideDoc = { id: 'o1', seriesId: 'e1', recurrenceId: '2026-02-02T09:00:00', changes: { title: 'x' } };
    const old: OverrideDoc = { id: 'o0', seriesId: 'e1', recurrenceId: '2026-01-12T09:00:00', changes: { title: 'y' } };
    const { oldMaster, newMaster, movedOverrideIds } = splitSeries(e, [ov, old], '2026-01-26T09:00:00', 'e2', 'uid2');
    expect(starts(oldMaster, '2026-01-01', '2026-06-01')).toEqual(['2026-01-05T09:00:00', '2026-01-12T09:00:00', '2026-01-19T09:00:00']);
    expect(starts(newMaster, '2026-01-01', '2026-02-10')).toEqual(['2026-01-26T09:00:00', '2026-02-02T09:00:00', '2026-02-09T09:00:00']);
    expect(movedOverrideIds).toEqual(['o1']);
    expect(newMaster.seriesEndUtc).toBeNull();
    expect(oldMaster.seriesEndUtc).toBe(utc('2026-01-19T10:00:00', 'Asia/Dubai'));
  });
  it('splits a COUNT series keeping the total', () => {
    const e = ev({ rrule: 'FREQ=DAILY;COUNT=10' });
    const { oldMaster, newMaster } = splitSeries(e, [], '2026-01-09T09:00:00', 'e2', 'u');
    expect(parseRule(oldMaster.rrule!).COUNT).toBe('4');
    expect(parseRule(newMaster.rrule!).COUNT).toBe('6');
    expect(starts(oldMaster, '2026-01-01', '2026-02-01').length + starts(newMaster, '2026-01-01', '2026-02-01').length).toBe(10);
  });
  it('delete this and following truncates', () => {
    const e = ev({ allDay: true, start: '2026-01-05', end: '2026-01-06', rrule: 'FREQ=DAILY' });
    const t = truncateSeries(e, '2026-01-08');
    expect(starts(t, '2026-01-01', '2026-03-01')).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });
});
