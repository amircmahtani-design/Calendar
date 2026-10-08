import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { EventDoc, OverrideDoc } from './types';
import { normaliseEvent, expandAll } from './recurrence';
import { planDelete, planEdit } from './ops';

const utc = (s: string) => DateTime.fromISO(s, { zone: 'UTC' }).toMillis();
let n = 0;
const ids = { newEventId: () => `new${++n}`, newOverrideId: () => `ov${++n}`, newUid: () => `uid${++n}` };

function series(p: Partial<EventDoc> = {}): EventDoc {
  return normaliseEvent({
    id: 's', calendarId: 'c', title: 'Gym', allDay: false, start: '2026-01-05T18:00:00', end: '2026-01-05T19:00:00',
    tz: 'Asia/Dubai', startUtc: 0, endUtc: 0, status: 'confirmed', privacy: 'default', transparency: 'busy',
    attendees: [], reminders: [], attachments: [], rrule: 'FREQ=WEEKLY', ...p,
  });
}

/** Apply writes to an in-memory store. */
function apply(events: EventDoc[], overrides: OverrideDoc[], w: { events: EventDoc[]; overrides: OverrideDoc[] }) {
  const em = new Map(events.map((e) => [e.id, e]));
  const om = new Map(overrides.map((o) => [o.id, o]));
  w.events.forEach((e) => em.set(e.id, e));
  w.overrides.forEach((o) => om.set(o.id, o));
  return { events: [...em.values()], overrides: [...om.values()] };
}
const view = (s: { events: EventDoc[]; overrides: OverrideDoc[] }) =>
  expandAll(s.events, s.overrides, utc('2026-01-01'), utc('2026-02-10')).map((o) => `${o.start} ${o.title}`);

describe('editing recurring events', () => {
  const m = series();
  const occ = () => expandAll([m], [], utc('2026-01-01'), utc('2026-03-01'));

  it('this event only → override, rest untouched', () => {
    const o = occ()[2]; // 19 Jan
    const w = planEdit(m, [], o, { title: 'Leg day', start: '2026-01-19T07:00:00', end: '2026-01-19T08:00:00' }, 'this', ids);
    const s = apply([m], [], w);
    const v = view(s);
    expect(v).toContain('2026-01-19T07:00:00 Leg day');
    expect(v.filter((x) => x.endsWith('Gym'))).toHaveLength(5);
  });

  it('this and following → history preserved, future changed', () => {
    const o = occ()[3]; // 26 Jan
    const w = planEdit(m, [], o, { title: 'Gym (new time)', start: '2026-01-26T19:30:00', end: '2026-01-26T20:30:00' }, 'following', ids);
    const s = apply([m], [], w);
    expect(view(s)).toEqual([
      '2026-01-05T18:00:00 Gym', '2026-01-12T18:00:00 Gym', '2026-01-19T18:00:00 Gym',
      '2026-01-26T19:30:00 Gym (new time)', '2026-02-02T19:30:00 Gym (new time)', '2026-02-09T19:30:00 Gym (new time)',
    ]);
  });

  it('all events → moving to the next day shifts the whole series and its exceptions', () => {
    const ov: OverrideDoc = { id: 'x', seriesId: 's', recurrenceId: '2026-01-12T18:00:00', changes: { title: 'Special' } };
    const ex = { ...m, exdates: ['2026-01-19T18:00:00'] };
    const o = expandAll([ex], [ov], utc('2026-01-01'), utc('2026-03-01'))[0];
    const w = planEdit(ex, [ov], o, { start: '2026-01-06T09:00:00', end: '2026-01-06T10:30:00' }, 'all', ids);
    const s = apply([ex], [ov], w);
    expect(view(s)).toEqual([
      '2026-01-06T09:00:00 Gym', '2026-01-13T09:00:00 Special', '2026-01-27T09:00:00 Gym', '2026-02-03T09:00:00 Gym',
    ]);
  });

  it('title-only edit to all keeps times', () => {
    const w = planEdit(m, [], occ()[1], { title: 'Training' }, 'all', ids);
    expect(view(apply([m], [], w))[0]).toBe('2026-01-05T18:00:00 Training');
  });
});

describe('deleting recurring events', () => {
  const m = series({ rrule: 'FREQ=WEEKLY;COUNT=6' });
  const occ = () => expandAll([m], [], utc('2026-01-01'), utc('2026-03-01'));

  it('this occurrence only', () => {
    const s = apply([m], [], planDelete(m, [], occ()[1], 'this'));
    expect(view(s)).toHaveLength(5);
    expect(view(s)).not.toContain('2026-01-12T18:00:00 Gym');
  });
  it('this and following', () => {
    const s = apply([m], [], planDelete(m, [], occ()[2], 'following'));
    expect(view(s)).toEqual(['2026-01-05T18:00:00 Gym', '2026-01-12T18:00:00 Gym']);
  });
  it('all occurrences (soft delete, recoverable)', () => {
    const w = planDelete(m, [], occ()[2], 'all');
    expect(w.events[0].deletedAt).toBeTruthy();
    expect(view(apply([m], [], w))).toEqual([]);
  });
});
