import { DateTime } from 'luxon';
import { parseRule, formatRule } from './recurrence';
import { fromBasic } from './time';

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const DAY_NAMES: Record<string, string> = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' };
const DAY_SHORT: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
const ORD: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '5': 'fifth', '-1': 'last', '-2': 'second-to-last' };

export function weekdayCode(isoDate: string): string {
  return WEEKDAYS[DateTime.fromISO(isoDate.slice(0, 10)).weekday - 1];
}

/** Plain-English description, e.g. "Every 2 weeks on Mon, Wed, until 31 Dec 2026". */
export function describeRule(rule: string | null | undefined, start: string): string {
  if (!rule) return 'Never';
  const p = parseRule(rule);
  const n = Number(p.INTERVAL || 1);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[p.FREQ] || 'time';
  let s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  const days = p.BYDAY ? p.BYDAY.split(',') : [];
  if (p.FREQ === 'DAILY' && n === 1 && !days.length) s = 'Every day';
  if (p.FREQ === 'WEEKLY' && n === 1 && days.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => days.includes(d))) s = 'Every weekday';
  else if (p.FREQ === 'WEEKLY' && days.length) s += ` on ${days.map((d) => (days.length === 1 ? DAY_NAMES[d] : DAY_SHORT[d])).join(', ')}`;
  else if (p.FREQ === 'WEEKLY' && n > 1) s += ` on ${DAY_NAMES[weekdayCode(start)]}`;
  if (p.FREQ === 'MONTHLY') {
    if (p.BYSETPOS && days.length) {
      const what = days.length === 5 ? 'weekday' : days.length === 7 ? 'day' : days.length === 2 && days.includes('SA') && days.includes('SU') ? 'weekend day' : days.map((d) => DAY_NAMES[d]).join('/');
      s += ` on the ${ORD[p.BYSETPOS] || p.BYSETPOS} ${what}`;
    } else if (days.length === 1 && /^-?\d/.test(days[0])) {
      const m = days[0].match(/^(-?\d)([A-Z]{2})$/);
      if (m) s += ` on the ${ORD[m[1]] || m[1]} ${DAY_NAMES[m[2]]}`;
    } else if (p.BYMONTHDAY) {
      s += p.BYMONTHDAY === '-1' ? ' on the last day' : ` on day ${p.BYMONTHDAY}`;
    } else s += ` on day ${Number(start.slice(8, 10))}`;
  }
  if (p.FREQ === 'YEARLY' && n === 1 && !p.BYMONTH) s = `Every year on ${DateTime.fromISO(start.slice(0, 10)).toFormat('d MMMM')}`;
  if (p.COUNT) s += `, ${p.COUNT} times`;
  if (p.UNTIL) s += `, until ${DateTime.fromISO(fromBasic(p.UNTIL.replace(/Z$/, '')).slice(0, 10)).toFormat('d MMM yyyy')}`;
  return s;
}

export type Preset = 'never' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';

export function presetOf(rule: string | null | undefined): Preset {
  if (!rule) return 'never';
  const p = parseRule(rule);
  const keys = Object.keys(p).filter((k) => k !== 'COUNT' && k !== 'UNTIL' && k !== 'WKST');
  const only = (...k: string[]) => keys.length === k.length && k.every((x) => keys.includes(x));
  if (p.FREQ === 'DAILY' && only('FREQ')) return 'daily';
  if (p.FREQ === 'WEEKLY' && only('FREQ', 'BYDAY') && p.BYDAY === 'MO,TU,WE,TH,FR') return 'weekdays';
  if (p.FREQ === 'WEEKLY' && only('FREQ')) return 'weekly';
  if (p.FREQ === 'WEEKLY' && only('FREQ', 'INTERVAL') && p.INTERVAL === '2') return 'biweekly';
  if (p.FREQ === 'MONTHLY' && only('FREQ')) return 'monthly';
  if (p.FREQ === 'YEARLY' && only('FREQ')) return 'yearly';
  return 'custom';
}

export function presetRule(preset: Preset, existing?: string | null): string | null {
  const keepEnd = (r: string) => {
    if (!existing) return r;
    const e = parseRule(existing);
    const p = parseRule(r);
    if (e.COUNT) p.COUNT = e.COUNT;
    if (e.UNTIL) p.UNTIL = e.UNTIL;
    return formatRule(p);
  };
  switch (preset) {
    case 'never': return null;
    case 'daily': return keepEnd('FREQ=DAILY');
    case 'weekdays': return keepEnd('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    case 'weekly': return keepEnd('FREQ=WEEKLY');
    case 'biweekly': return keepEnd('FREQ=WEEKLY;INTERVAL=2');
    case 'monthly': return keepEnd('FREQ=MONTHLY');
    case 'yearly': return keepEnd('FREQ=YEARLY');
    default: return existing || 'FREQ=WEEKLY';
  }
}

export const PRESET_LABEL: Record<Preset, string> = {
  never: 'Never', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', biweekly: 'Every 2 weeks',
  monthly: 'Every month', yearly: 'Every year', custom: 'Custom…',
};
