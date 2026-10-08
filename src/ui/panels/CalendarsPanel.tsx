import { useState } from 'react';
import { useStore, newId } from '../../data/store';
import { useUI } from '../state';
import { Sheet, SheetHeader, TextButton, Group, Row, Switch } from '../Sheet';
import { PALETTE } from '../colors';
import { reminderLabel } from '../format';
import { confirmAction } from '../ScopeDialog';
import { IconEye, IconEyeOff, IconChevronRight, IconPlus, IconImport, IconExport } from '../icons';
import type { CalendarDoc } from '../../core/types';

export function CalendarList({ compact = false }: { compact?: boolean }) {
  const { calendars, saveCalendar, events } = useStore();
  const { setPanel } = useUI();
  const active = calendars.filter((c) => !c.archived);
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.calendarId, (counts.get(e.calendarId) || 0) + 1);
  return (
    <ul className={compact ? 'space-y-0.5' : 'divide-y divide-line-soft'}>
      {active.map((c) => (
        <li key={c.id} className={`group flex items-center gap-2 ${compact ? 'h-9 px-2 rounded-lg hover:bg-sunken' : 'min-h-12 px-4'}`}>
          <button
            type="button"
            role="checkbox"
            aria-checked={c.visible}
            aria-label={`Show ${c.name}`}
            onClick={() => saveCalendar({ ...c, visible: !c.visible })}
            className="press flex items-center gap-2.5 flex-1 min-w-0 text-left min-h-9"
          >
            <span className="w-[18px] h-[18px] rounded-[5px] flex-none inline-flex items-center justify-center" style={{ background: c.visible ? c.color : 'transparent', boxShadow: `inset 0 0 0 2px ${c.color}` }}>
              {c.visible && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
            </span>
            <span className={`truncate ${compact ? 'text-[14px]' : 'text-[16px]'}`}>{c.name}</span>
            {!compact && <span className="text-[13px] text-ink-3 tnum ml-auto">{counts.get(c.id) || 0}</span>}
          </button>
          <button
            type="button"
            aria-label={`Edit ${c.name}`}
            onClick={() => setPanel({ calendar: c })}
            className={`press inline-flex items-center justify-center w-8 h-8 rounded-full text-ink-3 ${compact ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : ''}`}
          >
            {compact ? <IconChevronRight size={16} /> : <span className="text-accent text-[13px] font-semibold">Edit</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CalendarsPanel() {
  const { calendars, saveCalendar } = useStore();
  const { setPanel } = useUI();
  const archived = calendars.filter((c) => c.archived);
  const allOn = calendars.filter((c) => !c.archived).every((c) => c.visible);
  return (
    <Sheet open onClose={() => setPanel(null)} label="Calendars">
      <SheetHeader title="Calendars" right={<TextButton strong onClick={() => setPanel(null)}>Done</TextButton>} left={
        <TextButton onClick={() => calendars.filter((c) => !c.archived).forEach((c) => c.visible === allOn && saveCalendar({ ...c, visible: !allOn }))}>{allOn ? 'Hide All' : 'Show All'}</TextButton>
      } />
      <div className="pt-4">
        <Group title="My calendars">
          <CalendarList />
          <Row onClick={() => setPanel({ calendar: 'new' })} className="text-accent"><IconPlus size={18} />Add Calendar</Row>
        </Group>
        {archived.length > 0 && (
          <Group title="Archived" footer="Archived calendars are hidden everywhere but keep their events.">
            {archived.map((c) => (
              <Row key={c.id} onClick={() => setPanel({ calendar: c })}>
                <span className="dot" style={{ ['--c' as string]: c.color }} /><span className="flex-1 truncate text-ink-2">{c.name}</span><IconChevronRight size={16} className="text-ink-3" />
              </Row>
            ))}
          </Group>
        )}
        <Group>
          <Row onClick={() => setPanel('import')}><IconImport size={18} className="text-ink-2" />Import from .ics</Row>
          <Row onClick={() => setPanel('export')}><IconExport size={18} className="text-ink-2" />Export calendars</Row>
        </Group>
      </div>
    </Sheet>
  );
}

const REMINDERS = [0, 5, 10, 15, 30, 60, 1440];

export function CalendarEditor({ cal }: { cal: CalendarDoc | 'new' }) {
  const { calendars, saveCalendar, deleteCalendar, events, settings, saveSettings } = useStore();
  const { setPanel } = useUI();
  const isNew = cal === 'new';
  const [c, setC] = useState<CalendarDoc>(() => isNew
    ? { id: newId(), name: '', color: PALETTE[5].hex, visible: true, archived: false, defaultReminders: [], sortOrder: calendars.length, description: '' }
    : cal);
  const count = events.filter((e) => e.calendarId === c.id).length;
  const back = () => setPanel('calendars');
  const save = async () => {
    if (!c.name.trim()) return;
    await saveCalendar({ ...c, name: c.name.trim() });
    back();
  };
  return (
    <Sheet open onClose={back} label={isNew ? 'Add Calendar' : 'Edit Calendar'}>
      <SheetHeader left={<TextButton onClick={back}>Cancel</TextButton>} title={isNew ? 'Add Calendar' : 'Edit Calendar'} right={<TextButton strong onClick={save} disabled={!c.name.trim()}>Done</TextButton>} />
      <div className="pt-4">
        <Group>
          <div className="px-4 min-h-12 flex items-center"><input autoFocus={isNew} aria-label="Calendar name" placeholder="Calendar name" className="w-full bg-transparent outline-none text-[16px]" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
          <div className="px-4 py-3"><textarea aria-label="Description" rows={2} placeholder="Description (optional)" className="w-full bg-transparent outline-none text-[15px] resize-none" value={c.description || ''} onChange={(e) => setC({ ...c, description: e.target.value })} /></div>
        </Group>
        <Group title="Colour">
          <div className="px-4 py-3 flex flex-wrap gap-3" role="radiogroup" aria-label="Colour">
            {PALETTE.map((p) => (
              <button key={p.hex} type="button" role="radio" aria-checked={c.color === p.hex} aria-label={p.name}
                onClick={() => setC({ ...c, color: p.hex })}
                className="press w-9 h-9 rounded-full" style={{ background: p.hex, boxShadow: c.color.toUpperCase() === p.hex ? `0 0 0 3px var(--surface), 0 0 0 5px ${p.hex}` : undefined }} />
            ))}
            <label className="press w-9 h-9 rounded-full overflow-hidden relative" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} aria-label="Custom colour">
              <input type="color" className="absolute inset-0 opacity-0" value={c.color} onChange={(e) => setC({ ...c, color: e.target.value.toUpperCase() })} />
            </label>
          </div>
        </Group>
        <Group title="Default alerts" footer="Used for new events in this calendar.">
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {REMINDERS.map((m) => {
              const on = c.defaultReminders.some((r) => r.minutesBefore === m);
              return (
                <button key={m} type="button" aria-pressed={on} onClick={() => setC({ ...c, defaultReminders: on ? c.defaultReminders.filter((r) => r.minutesBefore !== m) : [...c.defaultReminders, { minutesBefore: m }].sort((a, b) => a.minutesBefore - b.minutesBefore) })}
                  className={`press h-8 px-3 rounded-full text-[13px] ${on ? 'bg-accent text-white' : 'bg-sunken text-ink-2'}`}>{reminderLabel(m).replace(' before', '')}</button>
              );
            })}
          </div>
        </Group>
        {!isNew && (
          <>
            <Group>
              <Row>
                <span className="flex-1">Show in calendar</span>
                <Switch label="Visible" checked={c.visible} onChange={(v) => setC({ ...c, visible: v })} />
              </Row>
              <Row>
                <span className="flex-1">Default calendar</span>
                <Switch label="Default calendar" checked={settings.defaultCalendarId === c.id} onChange={(v) => saveSettings({ defaultCalendarId: v ? c.id : undefined })} />
              </Row>
            </Group>
            <Group footer={`${count} event${count === 1 ? '' : 's'} in this calendar.`}>
              <Row onClick={async () => { await saveCalendar({ ...c, archived: !c.archived }); back(); }} className="text-accent">
                {c.archived ? <IconEye size={18} /> : <IconEyeOff size={18} />}{c.archived ? 'Unarchive calendar' : 'Archive calendar'}
              </Row>
              <Row className="text-danger justify-center" onClick={async () => {
                const ok = await confirmAction(`Delete “${c.name}”?`, 'Delete calendar', { danger: true, message: `This also deletes its ${count} event${count === 1 ? '' : 's'}. You can restore events from Recently deleted.` });
                if (ok) { await deleteCalendar(c.id); back(); }
              }}>Delete Calendar</Row>
            </Group>
          </>
        )}
      </div>
    </Sheet>
  );
}
