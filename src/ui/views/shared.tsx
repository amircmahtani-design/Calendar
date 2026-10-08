import { DateTime } from 'luxon';
import type { Occurrence, Settings } from '../../core/types';
import { useUI } from '../state';
import { colorOf } from '../colors';
import { timeRange } from '../format';

/** Weeks (arrays of 7 days) covering the month of `d`. */
export function monthMatrix(d: DateTime, weekStart: number): DateTime[][] {
  const first = d.startOf('month');
  const ws = weekStart === 0 ? 7 : weekStart; // luxon: Mon=1..Sun=7
  const offset = (first.weekday - ws + 7) % 7;
  let cur = first.minus({ days: offset });
  const weeks: DateTime[][] = [];
  do {
    const w: DateTime[] = [];
    for (let i = 0; i < 7; i++) { w.push(cur); cur = cur.plus({ days: 1 }); }
    weeks.push(w);
  } while (cur.month === first.month && cur.year === first.year);
  return weeks;
}

/** Map of ISO date → occurrences touching that day (in display zone). */
export function byDay(occ: Occurrence[], zone: string): Map<string, Occurrence[]> {
  const m = new Map<string, Occurrence[]>();
  const add = (k: string, o: Occurrence) => { const a = m.get(k) || []; a.push(o); m.set(k, a); };
  for (const o of occ) {
    let s: DateTime, e: DateTime;
    if (o.allDay) {
      s = DateTime.fromISO(o.start, { zone });
      e = DateTime.fromISO(o.end, { zone }).minus({ days: 1 });
    } else {
      s = DateTime.fromMillis(o.startUtc, { zone });
      e = DateTime.fromMillis(Math.max(o.startUtc, o.endUtc - 1), { zone });
    }
    let d = s.startOf('day');
    let guard = 0;
    while (d <= e.startOf('day') && guard++ < 400) { add(d.toISODate()!, o); d = d.plus({ days: 1 }); }
  }
  for (const a of m.values()) a.sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.startUtc - y.startUtc);
  return m;
}

export function weekdayLabels(weekStart: number, fmt: 'ccccc' | 'ccc' = 'ccc'): string[] {
  const base = DateTime.fromISO('2024-01-01'); // a Monday
  const ws = weekStart === 0 ? 6 : weekStart - 1;
  return Array.from({ length: 7 }, (_, i) => base.plus({ days: (ws + i) % 7 }).toFormat(fmt));
}

/** One event row used in agenda, day lists and search results. */
export function EventRow({ o, settings, showDate }: { o: Occurrence; settings: Settings; showDate?: boolean }) {
  const { zone, calById, select } = useUI();
  const c = colorOf(o.color, calById.get(o.calendarId)?.color);
  const start = o.allDay ? DateTime.fromISO(o.start) : DateTime.fromMillis(o.startUtc, { zone });
  return (
    <button
      type="button"
      onClick={() => select(o)}
      className="press w-full flex items-stretch gap-3 px-4 py-2.5 text-left active:bg-sunken"
      style={{ ['--c' as string]: c }}
    >
      <div className="w-[62px] shrink-0 pt-px text-[13px] text-ink-2 tnum">
        {showDate ? start.toFormat('d MMM') : o.allDay ? 'all-day' : timeRange(o, zone, settings.timeFormat).split(' – ')[0]}
      </div>
      <span className="bar" />
      <div className="min-w-0 flex-1">
        <div className={`text-[15px] font-medium truncate ${o.status === 'cancelled' ? 'line-through text-ink-3' : ''}`}>{o.title || '(No title)'}</div>
        <div className="text-[13px] text-ink-2 truncate tnum">
          {o.allDay ? (timeRange(o, zone, settings.timeFormat) === 'All day' ? 'All day' : timeRange(o, zone, settings.timeFormat)) : timeRange(o, zone, settings.timeFormat)}
          {o.location ? ` · ${o.location}` : ''}
        </div>
      </div>
    </button>
  );
}
