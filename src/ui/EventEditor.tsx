import { useMemo, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../data/store';
import { useUI } from './state';
import { Sheet, SheetHeader, TextButton, Switch } from './Sheet';
import { RepeatEditor } from './RepeatEditor';
import { askScope } from './ScopeDialog';
import { reminderLabel } from './format';
import { PALETTE } from './colors';
import type { EventDoc, Occurrence, Reminder, EventStatus, Privacy, Transparency } from '../core/types';
import type { EventPatch } from '../core/ops';
import { IconClose } from './icons';

const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
const COMMON_ZONES = ['Asia/Dubai', 'Europe/Madrid', 'Atlantic/Canary', 'Europe/Athens', 'Europe/London', 'Europe/Gibraltar', 'Asia/Kolkata', 'America/New_York', 'UTC'];

const field = 'w-full bg-transparent outline-none text-[16px] placeholder:text-ink-3';
const pill = 'h-9 rounded-lg bg-sunken px-2.5 text-[15px] outline-none tnum';

interface Form {
  title: string; location: string; allDay: boolean;
  sDate: string; sTime: string; eDate: string; eTime: string; tz: string;
  rrule: string | null; calendarId: string; reminders: Reminder[];
  meetingUrl: string; description: string; attendees: string;
  status: EventStatus; privacy: Privacy; transparency: Transparency; color: string | null;
}

function fromOcc(o: Occurrence, master: EventDoc | undefined, duplicate: boolean): Form {
  const allDay = o.allDay;
  const endIncl = allDay ? DateTime.fromISO(o.end).minus({ days: 1 }).toISODate()! : o.end.slice(0, 10);
  return {
    title: duplicate ? o.title : o.title, location: o.location || '', allDay,
    sDate: o.start.slice(0, 10), sTime: allDay ? '09:00' : o.start.slice(11, 16),
    eDate: endIncl, eTime: allDay ? '10:00' : o.end.slice(11, 16), tz: o.tz,
    rrule: master?.rrule || null, calendarId: o.calendarId, reminders: o.reminders,
    meetingUrl: o.meetingUrl || '', description: o.description || '',
    attendees: o.attendees.map((a) => a.email).join(', '),
    status: o.status, privacy: o.privacy, transparency: o.transparency, color: o.color || null,
  };
}

export function EventEditor() {
  const { settings, calendars, events, createEvent, editOccurrence } = useStore();
  const { editing, edit, zone, select } = useUI();
  const occ = editing?.occ || null;
  const duplicate = !!editing?.duplicate;
  const master = occ ? events.find((e) => e.id === occ.eventId) : undefined;
  const activeCals = calendars.filter((c) => !c.archived);
  const defaultCal = settings.defaultCalendarId && activeCals.some((c) => c.id === settings.defaultCalendarId) ? settings.defaultCalendarId : activeCals[0]?.id || '';

  const initial = useMemo<Form>(() => {
    if (occ) return fromOcc(occ, master, duplicate);
    const d = editing?.draft;
    const now = DateTime.now().setZone(zone);
    const start = d ? d.start : now.plus({ hours: 1 }).startOf('hour').toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const end = d ? d.end : now.plus({ hours: 1 }).startOf('hour').plus({ minutes: settings.defaultDurationMin }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const allDay = !!d?.allDay;
    const cal = activeCals.find((c) => c.id === (d?.calendarId || defaultCal));
    return {
      title: '', location: '', allDay,
      sDate: start.slice(0, 10), sTime: allDay ? '09:00' : start.slice(11, 16),
      eDate: allDay ? DateTime.fromISO(end.slice(0, 10)).minus({ days: 1 }).toISODate()! : end.slice(0, 10), eTime: allDay ? '10:00' : end.slice(11, 16),
      tz: zone, rrule: null, calendarId: cal?.id || defaultCal,
      reminders: cal?.defaultReminders?.length ? cal.defaultReminders : allDay ? [] : settings.defaultReminders,
      meetingUrl: '', description: '', attendees: '', status: 'confirmed', privacy: 'default', transparency: allDay ? 'free' : 'busy', color: null,
    };
  }, [occ, master, duplicate, editing, zone, settings, activeCals, defaultCal]);

  const [f, setF] = useState<Form>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const startLocal = f.allDay ? f.sDate : `${f.sDate}T${f.sTime}:00`;
  const endLocal = f.allDay ? DateTime.fromISO(f.eDate).plus({ days: 1 }).toISODate()! : `${f.eDate}T${f.eTime}:00`;

  const zones = useMemo(() => {
    const all = new Set([f.tz, zone, ...COMMON_ZONES]);
    return [...all];
  }, [f.tz, zone]);

  // Moving the start keeps the duration, like Apple Calendar.
  const moveStart = (date: string, time: string) => {
    setF((x) => {
      if (x.allDay) {
        const span = DateTime.fromISO(x.eDate).diff(DateTime.fromISO(x.sDate), 'days').days;
        return { ...x, sDate: date, eDate: DateTime.fromISO(date).plus({ days: Math.max(0, span) }).toISODate()! };
      }
      const oldS = DateTime.fromISO(`${x.sDate}T${x.sTime}`);
      const oldE = DateTime.fromISO(`${x.eDate}T${x.eTime}`);
      const dur = oldE.diff(oldS).toMillis();
      const ns = DateTime.fromISO(`${date}T${time}`);
      if (!ns.isValid) return { ...x, sDate: date, sTime: time };
      const ne = ns.plus({ milliseconds: Math.max(0, dur) });
      return { ...x, sDate: date, sTime: time, eDate: ne.toISODate()!, eTime: ne.toFormat('HH:mm') };
    });
  };

  const close = () => edit(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    if (!f.calendarId) return setError('Choose a calendar first.');
    if (!f.allDay && DateTime.fromISO(endLocal, { zone: f.tz }) < DateTime.fromISO(startLocal, { zone: f.tz })) return setError('The end time is before the start.');
    if (f.allDay && f.eDate < f.sDate) return setError('The end date is before the start.');
    const attendees = f.attendees.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /@/.test(s)).map((email) => ({ email }));
    const body = {
      title: f.title.trim() || 'New Event', location: f.location.trim() || undefined, allDay: f.allDay,
      start: startLocal, end: endLocal, tz: f.tz, calendarId: f.calendarId, reminders: f.reminders,
      meetingUrl: f.meetingUrl.trim() || undefined, description: f.description || undefined, attendees,
      status: f.status, privacy: f.privacy, transparency: f.transparency, color: f.color,
    };
    setBusy(true);
    try {
      if (!occ || duplicate) {
        await createEvent({ ...body, rrule: f.rrule, attachments: occ?.attachments || [], exdates: [], rdates: [] } as Omit<EventDoc, 'id' | 'startUtc' | 'endUtc'>);
      } else {
        const patch: EventPatch = {};
        const keys = Object.keys(body) as (keyof typeof body)[];
        for (const k of keys) {
          if (JSON.stringify(body[k] ?? null) !== JSON.stringify((occ as unknown as Record<string, unknown>)[k] ?? null)) (patch as Record<string, unknown>)[k] = body[k];
        }
        const ruleChanged = (f.rrule || null) !== (master?.rrule || null);
        if (ruleChanged) patch.rrule = f.rrule;
        if (Object.keys(patch).length) {
          let scope: 'this' | 'following' | 'all' | null = 'this';
          if (occ.isRecurring) scope = await askScope('edit', !ruleChanged);
          if (!scope) { setBusy(false); return; }
          await editOccurrence(occ, patch, scope);
        }
      }
      select(null);
      close();
    } catch (err) {
      setError((err as Error).message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const title = !occ ? 'New Event' : duplicate ? 'Duplicate Event' : 'Edit Event';

  return (
    <Sheet open onClose={close} label={title}>
      <form onSubmit={submit}>
        <SheetHeader left={<TextButton onClick={close}>Cancel</TextButton>} title={title} right={<TextButton strong type="submit" disabled={busy}>{occ && !duplicate ? 'Done' : 'Add'}</TextButton>} />
        <div className="px-4 py-4 space-y-4">
          {error && <p role="alert" className="rounded-xl bg-danger/10 text-danger px-4 py-2.5 text-[14px]">{error}</p>}
          <div className="rounded-xl bg-surface divide-y divide-line-soft">
            <div className="px-4 min-h-12 flex items-center"><input autoFocus={!occ} aria-label="Title" className={field} placeholder="Title" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
            <div className="px-4 min-h-12 flex items-center"><input aria-label="Location" className={field} placeholder="Location" value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
          </div>

          <div className="rounded-xl bg-surface divide-y divide-line-soft">
            <div className="px-4 min-h-12 flex items-center justify-between">
              <span className="text-[16px]">All-day</span>
              <Switch label="All-day" checked={f.allDay} onChange={(v) => setF((x) => ({ ...x, allDay: v, transparency: v ? 'free' : 'busy', reminders: x.reminders }))} />
            </div>
            <div className="px-4 min-h-12 flex items-center justify-between gap-2">
              <span className="text-[16px]">Starts</span>
              <span className="flex flex-wrap justify-end gap-1.5 min-w-0">
                <input aria-label="Start date" type="date" className={`${pill} w-[9rem]`} value={f.sDate} onChange={(e) => e.target.value && moveStart(e.target.value, f.sTime)} />
                {!f.allDay && <input aria-label="Start time" type="time" step={300} className={`${pill} w-[7.25rem]`} value={f.sTime} onChange={(e) => e.target.value && moveStart(f.sDate, e.target.value)} />}
              </span>
            </div>
            <div className="px-4 min-h-12 flex items-center justify-between gap-2">
              <span className="text-[16px]">Ends</span>
              <span className="flex flex-wrap justify-end gap-1.5 min-w-0">
                <input aria-label="End date" type="date" className={`${pill} w-[9rem]`} value={f.eDate} min={f.sDate} onChange={(e) => e.target.value && set('eDate', e.target.value)} />
                {!f.allDay && <input aria-label="End time" type="time" step={300} className={`${pill} w-[7.25rem]`} value={f.eTime} onChange={(e) => e.target.value && set('eTime', e.target.value)} />}
              </span>
            </div>
            {!f.allDay && (
              <div className="px-4 min-h-12 flex items-center justify-between gap-2">
                <span className="text-[16px]">Time zone</span>
                <select aria-label="Time zone" className={`${pill} max-w-[60%]`} value={f.tz} onChange={(e) => set('tz', e.target.value)}>
                  {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
            <RepeatEditor rule={f.rrule} start={startLocal} allDay={f.allDay} onChange={(r) => set('rrule', r)} />
          </div>

          <div className="rounded-xl bg-surface divide-y divide-line-soft">
            <div className="px-4 min-h-12 flex items-center justify-between gap-2">
              <span className="text-[16px]">Calendar</span>
              <span className="flex items-center gap-2">
                <span className="dot" style={{ ['--c' as string]: calendars.find((c) => c.id === f.calendarId)?.color }} />
                <select aria-label="Calendar" className={pill} value={f.calendarId} onChange={(e) => set('calendarId', e.target.value)}>
                  {activeCals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[16px]">Alerts</span>
                <select aria-label="Add alert" className={pill} value="" onChange={(e) => {
                  const m = Number(e.target.value);
                  if (!Number.isNaN(m) && e.target.value !== '' && !f.reminders.some((r) => r.minutesBefore === m)) set('reminders', [...f.reminders, { minutesBefore: m }].sort((a, b) => a.minutesBefore - b.minutesBefore));
                }}>
                  <option value="">Add alert…</option>
                  {REMINDER_OPTIONS.map((m) => <option key={m} value={m}>{reminderLabel(m)}</option>)}
                </select>
              </div>
              {f.reminders.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {f.reminders.map((r) => (
                    <span key={r.minutesBefore} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full bg-sunken text-[13px]">
                      {reminderLabel(r.minutesBefore)}
                      <button type="button" aria-label={`Remove ${reminderLabel(r.minutesBefore)}`} className="press w-7 h-7 inline-flex items-center justify-center text-ink-2" onClick={() => set('reminders', f.reminders.filter((x) => x.minutesBefore !== r.minutesBefore))}><IconClose size={14} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-surface divide-y divide-line-soft">
            <div className="px-4 min-h-12 flex items-center"><input aria-label="URL" inputMode="url" className={field} placeholder="URL or meeting link" value={f.meetingUrl} onChange={(e) => set('meetingUrl', e.target.value)} /></div>
            <div className="px-4 py-3"><textarea aria-label="Notes" rows={4} className={`${field} resize-y`} placeholder="Notes" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
          </div>

          {!more ? (
            <button type="button" className="press w-full min-h-11 text-accent text-[15px]" onClick={() => setMore(true)}>More options</button>
          ) : (
            <div className="rounded-xl bg-surface divide-y divide-line-soft">
              <div className="px-4 min-h-12 flex items-center"><input aria-label="Invitees" inputMode="email" className={field} placeholder="Invitees (emails, comma separated)" value={f.attendees} onChange={(e) => set('attendees', e.target.value)} /></div>
              <div className="px-4 min-h-12 flex items-center justify-between">
                <span className="text-[16px]">Show as</span>
                <select aria-label="Show as" className={pill} value={f.transparency} onChange={(e) => set('transparency', e.target.value as Transparency)}><option value="busy">Busy</option><option value="free">Free</option></select>
              </div>
              <div className="px-4 min-h-12 flex items-center justify-between">
                <span className="text-[16px]">Status</span>
                <select aria-label="Status" className={pill} value={f.status} onChange={(e) => set('status', e.target.value as EventStatus)}><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="cancelled">Cancelled</option></select>
              </div>
              <div className="px-4 min-h-12 flex items-center justify-between">
                <span className="text-[16px]">Privacy</span>
                <select aria-label="Privacy" className={pill} value={f.privacy} onChange={(e) => set('privacy', e.target.value as Privacy)}><option value="default">Default</option><option value="private">Private</option><option value="public">Public</option></select>
              </div>
              <div className="px-4 py-3">
                <span className="text-[16px]">Colour</span>
                <div className="flex flex-wrap gap-2 mt-2" role="radiogroup" aria-label="Event colour">
                  <button type="button" role="radio" aria-checked={!f.color} onClick={() => set('color', null)} className={`press h-8 px-3 rounded-full text-[13px] ${!f.color ? 'bg-ink text-bg' : 'bg-sunken'}`}>Calendar colour</button>
                  {PALETTE.map((p) => (
                    <button key={p.hex} type="button" role="radio" aria-checked={f.color === p.hex} aria-label={p.name} onClick={() => set('color', p.hex)}
                      className="press w-8 h-8 rounded-full" style={{ background: p.hex, boxShadow: f.color === p.hex ? `0 0 0 2px var(--surface), 0 0 0 4px ${p.hex}` : undefined }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </Sheet>
  );
}
