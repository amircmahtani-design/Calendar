import { useState } from 'react';
import { DateTime } from 'luxon';
import { formatRule, parseRule } from '../core/recurrence';
import { PRESET_LABEL, presetOf, presetRule, WEEKDAYS, weekdayCode, describeRule, type Preset } from '../core/rruleText';
import { fromBasic, toBasic } from '../core/time';

const sel = 'h-9 rounded-lg bg-sunken px-2 text-[15px] outline-none';
const DAY1: Record<string, string> = { MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S' };

export function RepeatEditor({ rule, start, allDay, onChange }: { rule: string | null; start: string; allDay: boolean; onChange: (r: string | null) => void }) {
  const [forceCustom, setForceCustom] = useState(false);
  const preset = forceCustom && rule ? 'custom' : presetOf(rule);
  const p = rule ? parseRule(rule) : {};
  const set = (patch: Record<string, string | undefined>) => {
    const next = { ...p, ...patch } as Record<string, string>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    onChange(formatRule(next));
  };
  const endMode = p.COUNT ? 'count' : p.UNTIL ? 'until' : 'never';
  const untilDate = p.UNTIL ? fromBasic(p.UNTIL.replace(/Z$/, '')).slice(0, 10) : DateTime.fromISO(start.slice(0, 10)).plus({ months: 3 }).toISODate()!;
  const days = p.BYDAY ? p.BYDAY.split(',') : [];
  const dom = Number(start.slice(8, 10));
  const nth = Math.ceil(dom / 7);
  const isLastWeek = DateTime.fromISO(start.slice(0, 10)).plus({ weeks: 1 }).month !== DateTime.fromISO(start.slice(0, 10)).month;
  const wd = weekdayCode(start);
  const monthMode = p.FREQ !== 'MONTHLY' ? '' : p.BYSETPOS === '-1' && days.length === 5 ? 'lastWeekday' : p.BYMONTHDAY === '-1' ? 'lastDay' : days.length === 1 && /^-1/.test(days[0]) ? 'lastDow' : days.length === 1 && /^\d/.test(days[0]) ? 'nthDow' : 'date';

  return (
    <div>
      <div className="flex items-center justify-between px-4 min-h-12">
        <span className="text-[16px]">Repeat</span>
        <select
          aria-label="Repeat"
          className={sel}
          value={preset}
          onChange={(e) => { const v = e.target.value as Preset; setForceCustom(v === 'custom'); onChange(presetRule(v, rule)); }}
        >
          {(Object.keys(PRESET_LABEL) as Preset[]).map((k) => <option key={k} value={k}>{PRESET_LABEL[k]}</option>)}
        </select>
      </div>

      {rule && (
        <div className="px-4 pb-3 space-y-3 text-[15px]">
          {preset === 'custom' && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span>Every</span>
                <input aria-label="Interval" type="number" min={1} max={99} value={p.INTERVAL || 1} onChange={(e) => set({ INTERVAL: e.target.value === '1' ? undefined : e.target.value })} className={`${sel} w-16 text-center`} />
                <select aria-label="Frequency" className={sel} value={p.FREQ} onChange={(e) => onChange(formatRule({ FREQ: e.target.value, ...(p.INTERVAL ? { INTERVAL: p.INTERVAL } : {}), ...(p.COUNT ? { COUNT: p.COUNT } : {}), ...(p.UNTIL ? { UNTIL: p.UNTIL } : {}) }))}>
                  <option value="DAILY">{Number(p.INTERVAL || 1) > 1 ? 'days' : 'day'}</option>
                  <option value="WEEKLY">{Number(p.INTERVAL || 1) > 1 ? 'weeks' : 'week'}</option>
                  <option value="MONTHLY">{Number(p.INTERVAL || 1) > 1 ? 'months' : 'month'}</option>
                  <option value="YEARLY">{Number(p.INTERVAL || 1) > 1 ? 'years' : 'year'}</option>
                </select>
              </div>
              {p.FREQ === 'WEEKLY' && (
                <div className="flex gap-1.5" role="group" aria-label="Days of the week">
                  {WEEKDAYS.map((d) => {
                    const on = days.length ? days.includes(d) : d === wd;
                    return (
                      <button key={d} type="button" aria-pressed={on} aria-label={d}
                        className={`press w-9 h-9 rounded-full text-[14px] font-medium ${on ? 'bg-accent text-white' : 'bg-sunken text-ink-2'}`}
                        onClick={() => {
                          const cur = days.length ? days : [wd];
                          const next = on ? cur.filter((x) => x !== d) : [...cur, d];
                          const ordered = WEEKDAYS.filter((x) => next.includes(x));
                          set({ BYDAY: ordered.length ? ordered.join(',') : undefined });
                        }}>{DAY1[d]}</button>
                    );
                  })}
                </div>
              )}
              {p.FREQ === 'MONTHLY' && (
                <select aria-label="Monthly on" className={`${sel} w-full`} value={monthMode}
                  onChange={(e) => {
                    const base = { FREQ: 'MONTHLY', INTERVAL: p.INTERVAL, COUNT: p.COUNT, UNTIL: p.UNTIL } as Record<string, string | undefined>;
                    const v = e.target.value;
                    const r = v === 'date' ? base : v === 'nthDow' ? { ...base, BYDAY: `${nth}${wd}` } : v === 'lastDow' ? { ...base, BYDAY: `-1${wd}` } : v === 'lastDay' ? { ...base, BYMONTHDAY: '-1' } : { ...base, BYDAY: 'MO,TU,WE,TH,FR', BYSETPOS: '-1' };
                    for (const k of Object.keys(r)) if (!r[k]) delete r[k];
                    onChange(formatRule(r as Record<string, string>));
                  }}>
                  <option value="date">On day {dom}</option>
                  {nth <= 4 && <option value="nthDow">On the {['first', 'second', 'third', 'fourth'][nth - 1]} {DateTime.fromISO(start.slice(0, 10)).toFormat('cccc')}</option>}
                  {isLastWeek && <option value="lastDow">On the last {DateTime.fromISO(start.slice(0, 10)).toFormat('cccc')}</option>}
                  <option value="lastDay">On the last day</option>
                  <option value="lastWeekday">On the last weekday</option>
                </select>
              )}
            </>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span>Ends</span>
            <select aria-label="Ends" className={sel} value={endMode} onChange={(e) => {
              const v = e.target.value;
              if (v === 'never') set({ COUNT: undefined, UNTIL: undefined });
              if (v === 'count') set({ COUNT: '10', UNTIL: undefined });
              if (v === 'until') set({ COUNT: undefined, UNTIL: allDay ? toBasic(untilDate) : `${toBasic(untilDate)}T235959` });
            }}>
              <option value="never">Never</option>
              <option value="until">On date</option>
              <option value="count">After</option>
            </select>
            {endMode === 'until' && <input aria-label="End date" type="date" className={sel} value={untilDate} min={start.slice(0, 10)} onChange={(e) => e.target.value && set({ UNTIL: allDay ? toBasic(e.target.value) : `${toBasic(e.target.value)}T235959` })} />}
            {endMode === 'count' && <><input aria-label="Occurrences" type="number" min={1} max={999} className={`${sel} w-16 text-center`} value={p.COUNT} onChange={(e) => set({ COUNT: String(Math.max(1, Number(e.target.value) || 1)) })} /><span>times</span></>}
          </div>
          <p className="text-[13px] text-ink-2">{describeRule(rule, start)}</p>
        </div>
      )}
    </div>
  );
}
