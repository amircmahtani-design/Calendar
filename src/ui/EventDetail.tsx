import { useStore } from '../data/store';
import { useUI } from './state';
import { Sheet, SheetHeader, TextButton } from './Sheet';
import { colorOf } from './colors';
import { reminderLabel, whenText } from './format';
import { describeRule } from '../core/rruleText';
import { askScope, confirmAction } from './ScopeDialog';
import { IconBell, IconCopy, IconLink, IconPeople, IconPin, IconRepeat, IconNote, IconChevronLeft, IconGlobe } from './icons';
import { DateTime } from 'luxon';

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" className="text-accent break-all">{p}</a> : <span key={i}>{p}</span>));
}

export function EventDetail() {
  const { settings, events, deleteOccurrence } = useStore();
  const { selected: o, select, calById, zone, edit } = useUI();
  if (!o) return null;
  const master = events.find((e) => e.id === o.eventId);
  const cal = calById.get(o.calendarId);
  const c = colorOf(o.color, cal?.color);
  const [dateLine, timeLine] = whenText(o, zone, settings.timeFormat);
  const otherZone = !o.allDay && o.tz !== zone ? DateTime.fromMillis(o.startUtc, { zone: o.tz }) : null;

  const onDelete = async () => {
    let scope: 'this' | 'following' | 'all' | null = 'all';
    if (o.isRecurring) scope = await askScope('delete');
    else if (!(await confirmAction('Delete this event?', 'Delete event', { danger: true, message: 'You can restore it from Recently deleted.' }))) scope = null;
    if (!scope) return;
    await deleteOccurrence(o, scope);
    select(null);
  };

  return (
    <Sheet open onClose={() => select(null)} label={o.title}>
      <SheetHeader
        left={<button type="button" className="press flex items-center text-accent min-h-11 text-[16px]" onClick={() => select(null)}><IconChevronLeft size={22} />Back</button>}
        right={<TextButton strong onClick={() => { edit({ occ: o }); select(null); }}>Edit</TextButton>}
      />
      <div className="px-4 pt-4 pb-6 space-y-4">
        <div className="rounded-xl bg-surface p-4 flex gap-3" style={{ ['--c' as string]: c }}>
          <span className="w-10 h-10 rounded-xl flex-none" style={{ background: `color-mix(in srgb, ${c} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${c}` }} />
          <div className="min-w-0">
            <h2 className={`text-[20px] font-semibold leading-tight break-words ${o.status === 'cancelled' ? 'line-through text-ink-3' : ''}`}>{o.title || '(No title)'}</h2>
            <p className="text-[15px] text-ink-2 mt-1">{dateLine}</p>
            <p className="text-[15px] text-ink-2 tnum">{timeLine}</p>
            {otherZone && <p className="text-[13px] text-ink-3 mt-0.5 flex items-center gap-1"><IconGlobe size={14} />{otherZone.toFormat('HH:mm')} in {o.tz.replace(/_/g, ' ')}</p>}
            {o.status !== 'confirmed' && <p className="text-[13px] mt-1 capitalize text-ink-2">{o.status}</p>}
          </div>
        </div>

        {(o.location || o.meetingUrl) && (
          <div className="rounded-xl bg-surface divide-y divide-line-soft">
            {o.location && (
              <a className="flex items-center gap-3 px-4 min-h-12 py-2.5 text-[15px]" href={`https://maps.apple.com/?q=${encodeURIComponent(o.location)}`} target="_blank" rel="noreferrer">
                <IconPin size={18} className="text-ink-2 flex-none" /><span className="break-words">{o.location}</span>
              </a>
            )}
            {o.meetingUrl && (
              <a className="flex items-center gap-3 px-4 min-h-12 py-2.5 text-[15px] text-accent" href={o.meetingUrl} target="_blank" rel="noreferrer">
                <IconLink size={18} className="flex-none" /><span className="truncate">{o.meetingUrl}</span>
              </a>
            )}
          </div>
        )}

        {o.description && (
          <div className="rounded-xl bg-surface px-4 py-3 flex gap-3">
            <IconNote size={18} className="text-ink-2 flex-none mt-0.5" />
            <p className="text-[15px] whitespace-pre-wrap break-words leading-relaxed">{linkify(o.description)}</p>
          </div>
        )}

        <div className="rounded-xl bg-surface divide-y divide-line-soft text-[15px]">
          <div className="flex items-center justify-between px-4 min-h-12">
            <span>Calendar</span>
            <span className="flex items-center gap-2 text-ink-2"><span className="dot" style={{ ['--c' as string]: cal?.color || c }} />{cal?.name || '—'}</span>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <span className="flex items-center gap-2"><IconBell size={16} className="text-ink-2" />Alerts</span>
            <span className="text-ink-2 text-right">{o.reminders.length ? o.reminders.map((r) => <div key={r.minutesBefore}>{reminderLabel(r.minutesBefore)}</div>) : 'None'}</span>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <span className="flex items-center gap-2"><IconRepeat size={16} className="text-ink-2" />Repeat</span>
            <span className="text-ink-2 text-right">{master?.rrule || master?.rdates?.length ? describeRule(master.rrule, master.start) : 'Does not repeat'}{o.isException ? ' (changed)' : ''}</span>
          </div>
          {o.attendees.length > 0 && (
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="flex items-center gap-2"><IconPeople size={16} className="text-ink-2" />Invitees</span>
              <span className="text-ink-2 text-right">{o.attendees.map((a) => <div key={a.email}>{a.name || a.email}</div>)}</span>
            </div>
          )}
          {o.attachments.length > 0 && o.attachments.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 min-h-12 text-accent"><IconLink size={16} />{a.title || a.url}</a>
          ))}
          {o.privacy === 'private' && <div className="px-4 min-h-12 flex items-center text-ink-2">Private</div>}
          {o.transparency === 'free' && <div className="px-4 min-h-12 flex items-center text-ink-2">Shown as free</div>}
        </div>

        <div className="rounded-xl bg-surface divide-y divide-line-soft">
          <button type="button" className="press w-full min-h-12 px-4 flex items-center gap-3 text-[16px] text-accent" onClick={() => { edit({ occ: o, duplicate: true }); select(null); }}>
            <IconCopy size={18} />Duplicate
          </button>
          <button type="button" className="press w-full min-h-12 text-[16px] text-danger" onClick={onDelete}>Delete Event</button>
        </div>
      </div>
    </Sheet>
  );
}
