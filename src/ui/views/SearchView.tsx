import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI } from '../state';
import { EventRow } from './shared';
import { IconSearch } from '../icons';

export function SearchView() {
  const { settings, calendars } = useStore();
  const { zone, occurrencesIn } = useUI();
  const [q, setQ] = useState('');
  const [cal, setCal] = useState('');
  const [when, setWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const results = useMemo(() => {
    const now = DateTime.now().setZone(zone);
    const from = when === 'upcoming' ? now.startOf('day') : now.minus({ years: 3 });
    const to = when === 'past' ? now : now.plus({ years: 2 });
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const occ = occurrencesIn(from.toMillis(), to.toMillis()).filter((o) => {
      if (cal && o.calendarId !== cal) return false;
      if (!terms.length) return !!cal;
      const hay = `${o.title} ${o.description || ''} ${o.location || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const sorted = when === 'past' ? occ.reverse() : occ;
    return sorted.slice(0, 300);
  }, [q, cal, when, zone, occurrencesIn]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-3 pb-2 space-y-2 border-b border-line-soft">
        <label className="flex items-center gap-2 h-10 px-3 rounded-xl bg-sunken">
          <IconSearch size={18} className="text-ink-3" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, notes or location" className="flex-1 bg-transparent outline-none text-[16px]" aria-label="Search events" />
        </label>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['upcoming', 'past', 'all'] as const).map((w) => (
            <button key={w} type="button" onClick={() => setWhen(w)} className={`press shrink-0 h-8 px-3 rounded-full text-[13px] capitalize ${when === w ? 'bg-ink text-bg' : 'bg-sunken text-ink-2'}`}>{w}</button>
          ))}
          <select value={cal} onChange={(e) => setCal(e.target.value)} className="shrink-0 h-8 px-3 rounded-full text-[13px] bg-sunken text-ink-2 outline-none" aria-label="Calendar filter">
            <option value="">All calendars</option>
            {calendars.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!q && !cal && <p className="px-4 py-10 text-center text-ink-3">Search across every visible calendar.</p>}
        {(q || cal) && results.length === 0 && <p className="px-4 py-10 text-center text-ink-3">No matching events.</p>}
        {results.map((o) => <EventRow key={o.key} o={o} settings={settings} showDate />)}
      </div>
    </div>
  );
}
