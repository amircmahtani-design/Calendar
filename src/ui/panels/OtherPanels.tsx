import { useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI, type View } from '../state';
import { Sheet, SheetHeader, TextButton, Group, Row, Switch } from '../Sheet';
import { toIcs } from '../../core/ics';
import { reminderLabel } from '../format';
import { deviceZone } from '../../core/time';
import { IconYear, IconCal, IconImport, IconExport, IconSettings, IconTrash, IconSearch, IconChevronRight, IconUndo } from '../icons';
import type { Settings } from '../../core/types';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const sel = 'h-9 rounded-lg bg-sunken px-2 text-[15px] outline-none';

export function ExportPanel() {
  const { calendars, events, overrides, settings } = useStore();
  const { setPanel } = useUI();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(calendars.map((c) => c.id)));
  const [range, setRange] = useState<'all' | 'custom'>('all');
  const [from, setFrom] = useState(DateTime.now().startOf('year').toISODate()!);
  const [to, setTo] = useState(DateTime.now().endOf('year').toISODate()!);
  const stamp = DateTime.now().toFormat('dd-MM-yyyy');

  const pick = () => {
    const evs = events.filter((e) => chosen.has(e.calendarId));
    return { evs, ovs: overrides.filter((o) => evs.some((e) => e.id === o.seriesId)) };
  };
  const bounds = range === 'custom' ? { fromUtc: DateTime.fromISO(from).toMillis(), toUtc: DateTime.fromISO(to).plus({ days: 1 }).toMillis() } : {};

  const ics = () => {
    const { evs, ovs } = pick();
    const one = chosen.size === 1 ? calendars.find((c) => chosen.has(c.id)) : undefined;
    const text = toIcs(evs, ovs, calendars, { ...bounds, calendarName: one?.name, calendarColor: one?.color });
    download(`${one ? one.name : 'Amir Calendar'} ${stamp}.ics`, text, 'text/calendar');
  };
  const json = () => {
    const { evs, ovs } = pick();
    const data = { app: 'Amir Calendar', version: 1, exportedAt: DateTime.now().toFormat('dd/MM/yyyy HH:mm:ss ZZ'), calendars: calendars.filter((c) => chosen.has(c.id)), events: evs, overrides: ovs, settings };
    download(`Amir Calendar backup ${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
  };

  return (
    <Sheet open onClose={() => setPanel(null)} label="Export">
      <SheetHeader title="Export" right={<TextButton strong onClick={() => setPanel(null)}>Done</TextButton>} />
      <div className="pt-4">
        <Group title="Calendars" footer="Choose one calendar to keep its name and colour in Apple and Google Calendar.">
          {calendars.map((c) => (
            <Row key={c.id} onClick={() => { const n = new Set(chosen); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setChosen(n); }}>
              <span className="w-[18px] h-[18px] rounded-[5px]" style={{ background: chosen.has(c.id) ? c.color : 'transparent', boxShadow: `inset 0 0 0 2px ${c.color}` }} />
              <span className="flex-1 truncate">{c.name}{c.archived ? ' (archived)' : ''}</span>
            </Row>
          ))}
        </Group>
        <Group title="Dates">
          <Row>
            <span className="flex-1">Range</span>
            <select aria-label="Range" className={sel} value={range} onChange={(e) => setRange(e.target.value as 'all' | 'custom')}><option value="all">Everything</option><option value="custom">Between dates</option></select>
          </Row>
          {range === 'custom' && (
            <Row>
              <input aria-label="From" type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-ink-2">to</span>
              <input aria-label="To" type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} />
            </Row>
          )}
        </Group>
        <Group footer="The .ics file opens in Apple Calendar, Google Calendar and Outlook. The JSON backup includes everything, including app settings, for a full restore or move.">
          <Row onClick={ics} className="text-accent" ><IconExport size={18} />Export .ics</Row>
          <Row onClick={json} className="text-accent"><IconExport size={18} />Download full backup (JSON)</Row>
        </Group>
      </div>
    </Sheet>
  );
}

export function DeletedPanel() {
  const { deletedEvents, restoreEvent, calendars } = useStore();
  const { setPanel } = useUI();
  const cal = new Map(calendars.map((c) => [c.id, c]));
  return (
    <Sheet open onClose={() => setPanel(null)} label="Recently deleted">
      <SheetHeader title="Recently Deleted" right={<TextButton strong onClick={() => setPanel(null)}>Done</TextButton>} />
      <div className="pt-4">
        <Group footer="Deleted events stay here so you can restore them.">
          {deletedEvents.length === 0 && <Row className="text-ink-3">Nothing deleted.</Row>}
          {deletedEvents.slice(0, 200).map((e) => (
            <Row key={e.id}>
              <span className="dot" style={{ ['--c' as string]: cal.get(e.calendarId)?.color || '#8E8E93' }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate">{e.title}</span>
                <span className="block text-[12px] text-ink-2 tnum">{DateTime.fromISO(e.start.slice(0, 10)).toFormat('d MMM yyyy')}{e.rrule ? ' · repeating' : ''} · deleted {DateTime.fromMillis(e.deletedAt!).toFormat('dd/MM/yyyy')}</span>
              </span>
              {cal.get(e.calendarId) ? (
                <button type="button" className="press text-accent text-[14px] min-h-11 px-2 flex items-center gap-1" onClick={() => restoreEvent(e.id)}><IconUndo size={16} />Restore</button>
              ) : <span className="text-[12px] text-ink-3">calendar deleted</span>}
            </Row>
          ))}
        </Group>
      </div>
    </Sheet>
  );
}

const ZONES = ['device', 'Asia/Dubai', 'Europe/Madrid', 'Atlantic/Canary', 'Europe/Athens', 'Europe/London', 'Europe/Gibraltar', 'UTC'];

export function SettingsPanel() {
  const { settings, saveSettings, calendars, user, signOutUser } = useStore();
  const { setPanel } = useUI();
  const s = settings;
  const set = (p: Partial<Settings>) => saveSettings(p);
  const allZones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone'); } catch { return []; } })();
  const zones = [...new Set([...ZONES, s.timeZone, ...allZones])];
  const badgeSupported = 'setAppBadge' in navigator;

  const toggleBadge = async (v: boolean) => {
    if (v && 'Notification' in window && Notification.permission !== 'granted') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    set({ iconBadge: v });
  };

  return (
    <Sheet open onClose={() => setPanel(null)} label="Settings">
      <SheetHeader title="Settings" right={<TextButton strong onClick={() => setPanel(null)}>Done</TextButton>} />
      <div className="pt-4">
        <Group title="Calendar">
          <Row><span className="flex-1">Default calendar</span>
            <select aria-label="Default calendar" className={sel} value={s.defaultCalendarId || ''} onChange={(e) => set({ defaultCalendarId: e.target.value || undefined })}>
              <option value="">First in list</option>
              {calendars.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Row>
          <Row><span className="flex-1">Opens in</span>
            <select aria-label="Default view" className={sel} value={s.defaultView} onChange={(e) => set({ defaultView: e.target.value as Settings['defaultView'] })}>
              {(['day', 'week', 'month', 'year', 'agenda'] as View[]).map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
            </select>
          </Row>
          <Row><span className="flex-1">Week starts on</span>
            <select aria-label="Week starts on" className={sel} value={s.weekStart} onChange={(e) => set({ weekStart: Number(e.target.value) as Settings['weekStart'] })}>
              <option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option>
            </select>
          </Row>
          <Row><span className="flex-1">Time format</span>
            <select aria-label="Time format" className={sel} value={s.timeFormat} onChange={(e) => set({ timeFormat: e.target.value as Settings['timeFormat'] })}>
              <option value="12h">12-hour (9:00 AM)</option><option value="24h">24-hour (09:00)</option>
            </select>
          </Row>
          <Row><span className="flex-1">Default duration</span>
            <select aria-label="Default duration" className={sel} value={s.defaultDurationMin} onChange={(e) => set({ defaultDurationMin: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
          </Row>
          <Row><span className="flex-1">Default alert</span>
            <select aria-label="Default alert" className={sel} value={s.defaultReminders[0]?.minutesBefore ?? ''} onChange={(e) => set({ defaultReminders: e.target.value === '' ? [] : [{ minutesBefore: Number(e.target.value) }] })}>
              <option value="">None</option>
              {[0, 5, 10, 15, 30, 60, 1440].map((m) => <option key={m} value={m}>{reminderLabel(m)}</option>)}
            </select>
          </Row>
        </Group>
        <Group title="Time zone" footer={s.timeZone === 'device' ? `Following this device: ${deviceZone().replace(/_/g, ' ')}. Times move with you when you travel.` : 'Everything shows in this zone, wherever you are.'}>
          <Row><span className="flex-1">Show times in</span>
            <select aria-label="Time zone" className={`${sel} max-w-[55%]`} value={s.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z === 'device' ? 'This device (auto)' : z.replace(/_/g, ' ')}</option>)}
            </select>
          </Row>
        </Group>
        <Group title="Appearance">
          <Row><span className="flex-1">Theme</span>
            <select aria-label="Theme" className={sel} value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
              <option value="system">Automatic</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </Row>
          <Row>
            <span className="flex-1">Today’s date on app icon</span>
            <Switch label="Date badge" checked={s.iconBadge} onChange={toggleBadge} />
          </Row>
        </Group>
        {!badgeSupported && s.iconBadge && <p className="mx-8 -mt-4 mb-6 text-[12px] text-ink-2">Badges work once the app is added to your Home Screen.</p>}
        <Group title="Account" footer="Only this Google account can open the calendar.">
          <Row><span className="flex-1 truncate text-ink-2">{user?.email}</span></Row>
          <Row onClick={signOutUser} className="text-danger justify-center">Sign out</Row>
        </Group>
      </div>
    </Sheet>
  );
}

export function MorePanel() {
  const { setPanel, setView } = useUI();
  const go = (v: View) => { setView(v); setPanel(null); };
  const items: [ReactNode, string, () => void][] = [
    [<IconYear size={20} />, 'Year', () => go('year')],
    [<IconSearch size={20} />, 'Search', () => go('search')],
    [<IconCal size={20} />, 'Calendars', () => setPanel('calendars')],
    [<IconImport size={20} />, 'Import from Apple', () => setPanel('import')],
    [<IconExport size={20} />, 'Export & backup', () => setPanel('export')],
    [<IconTrash size={20} />, 'Recently deleted', () => setPanel('deleted')],
    [<IconSettings size={20} />, 'Settings', () => setPanel('settings')],
  ];
  return (
    <Sheet open onClose={() => setPanel(null)} label="More">
      <SheetHeader title="More" right={<TextButton strong onClick={() => setPanel(null)}>Done</TextButton>} />
      <div className="pt-4">
        <Group>
          {items.map(([icon, label, fn]) => (
            <Row key={label} onClick={fn}><span className="text-accent">{icon}</span><span className="flex-1">{label}</span><IconChevronRight size={16} className="text-ink-3" /></Row>
          ))}
        </Group>
      </div>
    </Sheet>
  );
}
