import { useMemo } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI } from '../state';
import { byDay, monthMatrix, weekdayLabels } from './shared';

export function YearView() {
  const { settings } = useStore();
  const { zone, cursor, setCursor, setView, occurrencesIn } = useUI();
  const year = cursor.year;
  const today = DateTime.now().setZone(zone).toISODate();
  const busy = useMemo(() => {
    const from = DateTime.fromObject({ year }, { zone }).startOf('year').minus({ days: 7 }).toMillis();
    const to = DateTime.fromObject({ year }, { zone }).endOf('year').plus({ days: 7 }).toMillis();
    return byDay(occurrencesIn(from, to), zone);
  }, [year, zone, occurrencesIn]);
  const labels = weekdayLabels(settings.weekStart, 'ccccc');

  return (
    <div className="h-full overflow-y-auto px-3 md:px-6 py-3">
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-x-3 md:gap-x-6 gap-y-5 md:gap-y-8">
        {Array.from({ length: 12 }, (_, i) => {
          const m = DateTime.fromObject({ year, month: i + 1, day: 1 }, { zone });
          const weeks = monthMatrix(m, settings.weekStart);
          const isThisMonth = m.hasSame(DateTime.now().setZone(zone), 'month');
          return (
            <button
              key={i}
              type="button"
              className="press text-left rounded-xl md:p-2 md:hover:bg-soft flex flex-col justify-start"
              onClick={() => { setCursor(m); setView('month'); }}
              aria-label={m.toFormat('MMMM yyyy')}
            >
              <div className={`text-[14px] md:text-[15px] font-semibold mb-1 ${isThisMonth ? 'text-accent' : ''}`}>{m.toFormat(window.innerWidth < 768 ? 'LLL' : 'LLLL')}</div>
              <div className="grid grid-cols-7 text-[7.5px] md:text-[10px] text-ink-3 mb-0.5">{labels.map((l, j) => <span key={j} className="text-center">{l}</span>)}</div>
              {weeks.map((w) => (
                <div key={w[0].toISODate()} className="grid grid-cols-7">
                  {w.map((d) => {
                    const iso = d.toISODate()!;
                    const inM = d.month === m.month;
                    const has = inM && busy.has(iso);
                    return (
                      <span key={iso} className="flex flex-col items-center h-[15px] md:h-[22px]">
                        <span className={`tnum text-[8.5px] md:text-[11px] leading-[13px] md:leading-[18px] w-[13px] md:w-[18px] text-center rounded-full
                          ${!inM ? 'opacity-0' : iso === today ? 'bg-accent text-white font-semibold' : ''}`}>{d.day}</span>
                        {has && iso !== today && <span className="w-[3px] h-[3px] rounded-full bg-ink-3 -mt-px" />}
                      </span>
                    );
                  })}
                </div>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
