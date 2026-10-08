import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIcs } from './ics';
import { buildImportPlan, suggestTargets } from './importPlan';
import type { CalendarDoc } from './types';

const text = readFileSync(new URL('./fixtures/apple-family.ics', import.meta.url), 'utf8');
let n = 0;
const id = () => `id${++n}`;

describe('import planning', () => {
  const parsed = [parseIcs(text, 'Family.ics', 'Asia/Dubai')];
  const family: CalendarDoc = { id: 'fam', name: 'family', color: '#34C759', visible: true, archived: false, defaultReminders: [], sortOrder: 0 };

  it('maps to an existing calendar by name', () => {
    expect(suggestTargets(parsed, [family])[0]).toEqual({ kind: 'existing', calendarId: 'fam' });
    expect(suggestTargets(parsed, [])[0]).toMatchObject({ kind: 'new', name: 'Family', color: '#34C759' });
  });

  it('first import creates everything; repeat import finds only duplicates', () => {
    const first = buildImportPlan(parsed, [{ kind: 'existing', calendarId: 'fam' }], { events: [], overrides: [], calendars: [family] }, 'b1', id);
    expect(first.totals).toEqual({ toCreate: 5, toUpdate: 0, duplicates: 0, failed: 1 });
    const second = buildImportPlan(parsed, [{ kind: 'existing', calendarId: 'fam' }], { events: first.events, overrides: first.overrides, calendars: [family] }, 'b2', id);
    expect(second.totals).toEqual({ toCreate: 0, toUpdate: 0, duplicates: 5, failed: 1 });
  });

  it('a newer SEQUENCE becomes an update and keeps a rollback copy', () => {
    const first = buildImportPlan(parsed, [{ kind: 'existing', calendarId: 'fam' }], { events: [], overrides: [], calendars: [family] }, 'b1', id);
    const bumped = [parseIcs(text.replace('SEQUENCE:2', 'SEQUENCE:5').replace('SUMMARY:Swimming lesson\n', 'SUMMARY:Swimming (new pool)\n'), 'Family.ics', 'Asia/Dubai')];
    const second = buildImportPlan(bumped, [{ kind: 'existing', calendarId: 'fam' }], { events: first.events, overrides: first.overrides, calendars: [family] }, 'b2', id);
    expect(second.totals.toUpdate).toBe(1);
    expect(second.previous).toHaveLength(1);
    expect(second.events[0].title).toBe('Swimming (new pool)');
    expect(second.events[0].id).toBe(first.events.find((e) => e.ical?.uid === 'A1B2C3D4-SWIM-0001')!.id);
  });

  it('new calendar is tagged with the batch for rollback', () => {
    const p = buildImportPlan(parsed, suggestTargets(parsed, []), { events: [], overrides: [], calendars: [] }, 'b9', id);
    expect(p.calendars[0].source?.importBatchId).toBe('b9');
    expect(p.events.every((e) => e.calendarId === p.calendars[0].id && e.source?.importBatchId === 'b9')).toBe(true);
  });
});
