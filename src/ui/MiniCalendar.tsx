import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../data/store';
import { useUI } from './state';
import { monthMatrix, weekdayLabels, byDay } from './views/shared';
import { IconChevronLeft, IconChevronRight } from './icons';

export function MiniCalendar() {
  const { settings } = useStore();
  const { cursor, setCursor, zone, view, setView, occurrencesIn } = useUI();
  const [month, setMonth] = useState(cursor.startOf('month'));
  useEffect(() => { setMonth(cursor.startOf('month')); }, [cursor]);
  const weeks = useMemo(() => monthMatrix(month, settings.weekStart), [month, settings.weekStart]);
  const busy = useMemo(() => byDay(occurrencesIn(weeks[0][0].toMillis(), weeks.at(-1)![6].endOf('day').toMillis()), zone), [weeks, occurrencesIn, zone]);
  const today = DateTime.now().setZone(zone).toISODate();
  const weekOf = (d: DateTime) => {
    const ws = settings.weekStart === 0 ? 7 : settings.weekStart;
    return d.minus({ days: (d.weekday - ws + 7) % 7 }).toISODate();
  };
  const inSelWeek = (d: DateTime) => view === 'week' && weekOf(d) === weekOf(cursor);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[14px] font-semibold">{month.toFormat('MMMM yyyy')}</span>
        <span className="flex">
          <button type="button" aria-label="Previous month" className="press w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-2 hover:bg-sunken" onClick={() => setMonth(month.minus({ months: 1 }))}><IconChevronLeft size={16} /></button>
          <button type="button" aria-label="Next month" className="press w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-2 hover:bg-sunken" onClick={() => setMonth(month.plus({ months: 1 }))}><IconChevronRight size={16} /></button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-[10px] text-ink-3 mb-0.5">{weekdayLabels(settings.weekStart, 'ccccc').map((l, i) => <span key={i} className="text-center">{l}</span>)}</div>
      {weeks.map((w) => (
        <div key={w[0].toISODate()} className={`grid grid-cols-7 rounded-md ${inSelWeek(w[0]) ? 'bg-accent-soft' : ''}`}>
          {w.map((d) => {
            const iso = d.toISODate()!;
            const isCur = iso === cursor.toISODate() && view !== 'week';
            return (
              <button
                key={iso}
                type="button"
                onClick={() => { setCursor(d); if (view === 'year' || view === 'search') setView('day'); }}
                className={`press relative h-7 text-[12px] tnum rounded-full mx-auto w-7 inline-flex items-center justify-center
                  ${iso === today ? 'bg-accent text-white font-semibold' : isCur ? 'bg-ink text-bg font-semibold' : d.month !== month.month ? 'text-ink-3' : 'hover:bg-sunken'}`}
                aria-label={d.toFormat('cccc d MMMM yyyy')}
              >
                {d.day}
                {busy.has(iso) && iso !== today && !isCur && <span className="absolute bottom-[2px] w-[3px] h-[3px] rounded-full bg-ink-3" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
