import { useMemo, useState, useEffect } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI } from '../state';
import { byDay, monthMatrix, weekdayLabels, EventRow } from './shared';
import { colorOf } from '../colors';

export function MobileMonth() {
  const { settings } = useStore();
  const { zone, cursor, setCursor, setView, occurrencesIn, calById, edit } = useUI();
  const weeks = useMemo(() => monthMatrix(cursor, settings.weekStart), [cursor, settings.weekStart]);
  const today = DateTime.now().setZone(zone).toISODate();
  const [sel, setSel] = useState<string>(() => (cursor.hasSame(DateTime.now().setZone(zone), 'month') ? today! : cursor.startOf('month').toISODate()!));

  useEffect(() => {
    if (!DateTime.fromISO(sel).hasSame(cursor, 'month')) {
      setSel(cursor.hasSame(DateTime.now().setZone(zone), 'month') ? today! : cursor.startOf('month').toISODate()!);
    }
  }, [cursor, sel, today, zone]);

  const map = useMemo(() => {
    const from = weeks[0][0].startOf('day').toMillis();
    const to = weeks[weeks.length - 1][6].endOf('day').toMillis();
    return byDay(occurrencesIn(from, to), zone);
  }, [weeks, occurrencesIn, zone]);

  const selDay = DateTime.fromISO(sel, { zone });
  const list = map.get(sel) || [];

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 pt-1">
        <div className="grid grid-cols-7 pb-1">
          {weekdayLabels(settings.weekStart).map((l) => <div key={l} className="text-center text-[12px] text-ink-2">{l}</div>)}
        </div>
        {weeks.map((w) => (
          <div key={w[0].toISODate()} className="grid grid-cols-7">
            {w.map((d) => {
              const iso = d.toISODate()!;
              const inMonth = d.month === cursor.month;
              const isToday = iso === today;
              const isSel = iso === sel;
              const dots = [...new Set((map.get(iso) || []).map((o) => colorOf(o.color, calById.get(o.calendarId)?.color)))].slice(0, 3);
              return (
                <button
                  key={iso}
                  type="button"
                  aria-label={d.toFormat('cccc d MMMM')}
                  aria-pressed={isSel}
                  onClick={() => (isSel ? (setCursor(d), setView('day')) : setSel(iso))}
                  className="press flex flex-col items-center gap-[3px] h-[50px] pt-1"
                >
                  <span className={`tnum text-[17px] w-[34px] h-[34px] inline-flex items-center justify-center rounded-full
                    ${isToday ? (isSel ? 'bg-accent text-white font-semibold' : 'text-accent font-semibold') : isSel ? 'bg-ink text-bg font-semibold' : inMonth ? 'text-ink' : 'text-ink-3'}`}>
                    {d.day}
                  </span>
                  <span className="flex gap-[3px] h-[6px]">
                    {dots.map((c) => <span key={c} className="w-[6px] h-[6px] rounded-full" style={{ background: c, opacity: inMonth ? 1 : 0.4 }} />)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex-1 min-h-0 overflow-y-auto border-t border-line-soft bg-bg">
        <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
          <h2 className="text-[15px] font-semibold">{sel === today ? 'Today' : selDay.toFormat('cccc')} <span className="font-normal text-ink-2">· {selDay.toFormat('d MMMM')}</span></h2>
          <button type="button" className="text-[14px] text-accent press" onClick={() => { setCursor(selDay); setView('day'); }}>Open day</button>
        </div>
        {list.length ? list.map((o) => <EventRow key={o.key} o={o} settings={settings} />) : (
          <button type="button" className="press w-full text-left px-4 py-4 text-[15px] text-ink-3" onClick={() => edit({ occ: null, draft: { allDay: false, start: `${sel}T09:00:00`, end: `${sel}T10:00:00` } })}>
            No events. Tap to add one.
          </button>
        )}
      </div>
    </div>
  );
}
