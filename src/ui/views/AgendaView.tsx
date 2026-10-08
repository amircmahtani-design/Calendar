import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI } from '../state';
import { byDay, EventRow } from './shared';

export function AgendaView() {
  const { settings } = useStore();
  const { zone, cursor, occurrencesIn } = useUI();
  const [days, setDays] = useState(60);
  const start = cursor.startOf('day');
  const today = DateTime.now().setZone(zone).toISODate();
  const groups = useMemo(() => {
    const map = byDay(occurrencesIn(start.toMillis(), start.plus({ days }).toMillis()), zone);
    return [...map.entries()].filter(([d]) => d >= start.toISODate()!).sort(([a], [b]) => a.localeCompare(b));
  }, [start, days, zone, occurrencesIn]);

  return (
    <div className="h-full overflow-y-auto">
      {groups.length === 0 && <p className="px-4 py-10 text-center text-ink-3">Nothing scheduled in the next {days} days.</p>}
      {groups.map(([iso, list]) => {
        const d = DateTime.fromISO(iso, { zone });
        const tomorrow = DateTime.fromISO(today!).plus({ days: 1 }).toISODate();
        const label = iso === today ? 'Today' : iso === tomorrow ? 'Tomorrow' : d.toFormat('cccc');
        return (
          <section key={iso}>
            <h2 className="sticky top-0 z-10 bg-bg/95 backdrop-blur px-4 pt-4 pb-1.5 text-[15px] font-semibold border-b border-line-soft">
              <span className={iso === today ? 'text-accent' : ''}>{label}</span>
              <span className="ml-2 font-normal text-ink-2">{d.toFormat('d MMMM yyyy')}</span>
            </h2>
            {list.map((o) => <EventRow key={`${iso}-${o.key}`} o={o} settings={settings} />)}
          </section>
        );
      })}
      <div className="p-4 pb-10 text-center">
        <button type="button" className="press text-accent text-[15px] min-h-11 px-4" onClick={() => setDays((n) => n + 90)}>Show more</button>
      </div>
    </div>
  );
}
