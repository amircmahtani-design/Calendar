import { useEffect, useRef, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../data/store';
import { useUI, type View } from './state';
import { useMedia } from './Sheet';
import { LiveIcon } from './LiveIcon';
import { MiniCalendar } from './MiniCalendar';
import { CalendarList, CalendarsPanel, CalendarEditor } from './panels/CalendarsPanel';
import { ImportPanel } from './panels/ImportPanel';
import { ExportPanel, DeletedPanel, SettingsPanel, MorePanel } from './panels/OtherPanels';
import { EventDetail } from './EventDetail';
import { EventEditor } from './EventEditor';
import { ScopeDialogHost, ConfirmHost } from './ScopeDialog';
import { FcView } from './views/FcView';
import { MobileMonth } from './views/MobileMonth';
import { YearView } from './views/YearView';
import { AgendaView } from './views/AgendaView';
import { SearchView } from './views/SearchView';
import { monthTitle, weekTitle, dayTitle } from './format';
import {
  IconPlus, IconChevronLeft, IconChevronRight, IconSearch, IconMenu, IconMonth, IconWeek, IconDay, IconAgenda, IconMore,
  IconImport, IconExport, IconSettings, IconTrash,
} from './icons';

const VIEWS: { v: View; label: string }[] = [
  { v: 'day', label: 'Day' }, { v: 'week', label: 'Week' }, { v: 'month', label: 'Month' }, { v: 'year', label: 'Year' }, { v: 'agenda', label: 'Agenda' },
];

function useTitle() {
  const { settings } = useStore();
  const { view, cursor } = useUI();
  if (view === 'day') return { main: dayTitle(cursor), short: cursor.toFormat('ccc, d MMMM yyyy') };
  if (view === 'week') {
    const ws = settings.weekStart === 0 ? 7 : settings.weekStart;
    const s = cursor.minus({ days: (cursor.weekday - ws + 7) % 7 });
    const t = weekTitle(s, s.plus({ days: 6 }));
    return { main: t, short: t };
  }
  if (view === 'year') return { main: String(cursor.year), short: String(cursor.year) };
  if (view === 'agenda') return { main: 'Agenda', short: 'Agenda' };
  if (view === 'search') return { main: 'Search', short: 'Search' };
  return { main: monthTitle(cursor), short: monthTitle(cursor) };
}

function ViewBody({ phone }: { phone: boolean }) {
  const { view } = useUI();
  switch (view) {
    case 'day': return <FcView mode="timeGridDay" />;
    case 'week': return <FcView mode="timeGridWeek" />;
    case 'month': return phone ? <MobileMonth /> : <FcView mode="dayGridMonth" />;
    case 'year': return <YearView />;
    case 'agenda': return <AgendaView />;
    case 'search': return <SearchView />;
  }
}

/** Horizontal swipe → previous/next (phones and tablets). */
function Swipe({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { go } = useUI();
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <div
      className="h-full"
      onTouchStart={(e) => { if (enabled && e.touches.length === 1) start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || !enabled) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Date.now() - s.t < 600 && s.x > 24) go(dx < 0 ? 1 : -1);
      }}
    >
      {children}
    </div>
  );
}

function Panels() {
  const { panel, selected, editing } = useUI();
  return (
    <>
      {panel === 'calendars' && <CalendarsPanel />}
      {panel === 'import' && <ImportPanel />}
      {panel === 'export' && <ExportPanel />}
      {panel === 'deleted' && <DeletedPanel />}
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'more' && <MorePanel />}
      {panel && typeof panel === 'object' && <CalendarEditor key={panel.calendar === 'new' ? 'new' : panel.calendar.id} cal={panel.calendar} />}
      {selected && <EventDetail key={selected.key} />}
      {editing && <EventEditor key={editing.occ?.key || 'new'} />}
      <ScopeDialogHost />
      <ConfirmHost />
    </>
  );
}

function useShortcuts() {
  const { setView, go, today, edit, selected, editing, panel } = useUI();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(t.tagName) || t.isContentEditable) return;
      if (selected || editing || panel) return;
      const map: Record<string, () => void> = {
        d: () => setView('day'), w: () => setView('week'), m: () => setView('month'), y: () => setView('year'), a: () => setView('agenda'),
        t: today, n: () => edit({ occ: null }), c: () => edit({ occ: null }), '/': () => setView('search'),
        ArrowLeft: () => go(-1), ArrowRight: () => go(1), j: () => go(1), k: () => go(-1),
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [setView, go, today, edit, selected, editing, panel]);
}

export function Shell() {
  const { settings } = useStore();
  const ui = useUI();
  const { view, setView, go, today, edit, setPanel, zone } = ui;
  const phone = useMedia('(max-width: 767px)');
  const wide = useMedia('(min-width: 1024px)');
  const title = useTitle();
  useShortcuts();
  const isToday = ui.cursor.hasSame(DateTime.now().setZone(zone), view === 'year' ? 'year' : view === 'month' ? 'month' : view === 'week' ? 'week' : 'day');

  if (phone) {
    return (
      <div className="h-full flex flex-col bg-bg">
        <span hidden><LiveIcon zone={zone} size={1} badge={settings.iconBadge} /></span>
        <header className="safe-t bg-bg/95 backdrop-blur-md z-20">
          <div className="h-12 px-2 grid grid-cols-[auto_1fr_auto] items-center gap-1">
            <div className="flex items-center">
              <button type="button" aria-label="Calendars" onClick={() => setPanel('calendars')} className="press w-11 h-11 inline-flex items-center justify-center text-accent"><IconMenu size={22} /></button>
              {view !== 'search' && view !== 'agenda' && (
                <button type="button" aria-label="Previous" onClick={() => go(-1)} className="press w-9 h-11 inline-flex items-center justify-center text-ink-2"><IconChevronLeft size={20} /></button>
              )}
            </div>
            <button type="button" className="press min-w-0 text-center" onClick={() => (view === 'month' ? setView('year') : view === 'year' ? setView('month') : today())}>
              <span className="block text-[17px] font-semibold truncate">{title.short}</span>
            </button>
            <div className="flex items-center justify-end">
              {view !== 'search' && view !== 'agenda' && (
                <button type="button" aria-label="Next" onClick={() => go(1)} className="press w-9 h-11 inline-flex items-center justify-center text-ink-2"><IconChevronRight size={20} /></button>
              )}
              <button type="button" aria-label="New event" onClick={() => edit({ occ: null })} className="press w-9 h-9 ml-1 rounded-full bg-accent text-white inline-flex items-center justify-center shadow-[0_4px_12px_rgb(0_122_255_/_0.35)]"><IconPlus size={20} /></button>
            </div>
          </div>
          {!isToday && view !== 'search' && view !== 'agenda' && (
            <div className="flex justify-center pb-1 -mt-1">
              <button type="button" onClick={today} className="press h-6 px-3 rounded-full bg-accent-soft text-accent text-[12px] font-semibold">Today</button>
            </div>
          )}
        </header>
        <main className="flex-1 min-h-0">
          <Swipe enabled={view !== 'search' && view !== 'agenda'}><ViewBody phone /></Swipe>
        </main>
        <nav className="safe-b border-t border-line-soft bg-bg/95 backdrop-blur-md z-20" aria-label="Views">
          <div className="grid grid-cols-5 h-[54px]">
            {([['month', 'Month', IconMonth], ['week', 'Week', IconWeek], ['day', 'Day', IconDay], ['agenda', 'Agenda', IconAgenda]] as const).map(([v, label, I]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}
                className={`press flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${view === v ? 'text-accent' : 'text-ink-3'}`}>
                <I size={22} />{label}
              </button>
            ))}
            <button type="button" onClick={() => setPanel('more')} className={`press flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${view === 'year' || view === 'search' ? 'text-accent' : 'text-ink-3'}`}>
              <IconMore size={22} />More
            </button>
          </div>
        </nav>
        <Panels />
      </div>
    );
  }

  return (
    <div className="h-full flex bg-soft">
      {wide && (
        <aside className="w-[264px] shrink-0 flex flex-col gap-5 px-4 py-4 overflow-y-auto">
          <div className="flex items-center gap-2.5 px-1">
            <LiveIcon zone={zone} size={30} badge={settings.iconBadge} />
            <span className="text-[17px] font-semibold tracking-[-0.01em]">Calendar</span>
          </div>
          <button type="button" onClick={() => edit({ occ: null })} className="press h-10 rounded-xl bg-accent text-white text-[15px] font-semibold inline-flex items-center justify-center gap-1.5 shadow-[0_4px_14px_rgb(0_122_255_/_0.28)]">
            <IconPlus size={18} />New Event
          </button>
          <MiniCalendar />
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">My Calendars</span>
              <button type="button" aria-label="Add calendar" onClick={() => setPanel({ calendar: 'new' })} className="press w-7 h-7 inline-flex items-center justify-center rounded-md text-ink-2 hover:bg-sunken"><IconPlus size={16} /></button>
            </div>
            <CalendarList compact />
          </div>
          <div className="mt-auto space-y-0.5 text-[14px] text-ink-2">
            {([[IconImport, 'Import', 'import'], [IconExport, 'Export & backup', 'export'], [IconTrash, 'Recently deleted', 'deleted'], [IconSettings, 'Settings', 'settings']] as const).map(([I, label, p]) => (
              <button key={p} type="button" onClick={() => setPanel(p)} className="press w-full h-9 px-2 rounded-lg flex items-center gap-2.5 hover:bg-sunken"><I size={17} />{label}</button>
            ))}
          </div>
        </aside>
      )}
      <div className={`flex-1 min-w-0 flex flex-col bg-bg ${wide ? 'rounded-l-[18px] shadow-[var(--shadow)] my-0' : ''}`}>
        <header className="h-16 shrink-0 px-4 flex items-center gap-3 border-b border-line-soft">
          {!wide && (
            <>
              <LiveIcon zone={zone} size={28} badge={settings.iconBadge} />
              <button type="button" aria-label="Calendars" onClick={() => setPanel('calendars')} className="press w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-sunken text-ink-2"><IconMenu size={20} /></button>
            </>
          )}
          <button type="button" onClick={today} className="press h-9 px-3.5 rounded-lg border border-line text-[14px] font-medium hover:bg-soft">Today</button>
          <div className="flex">
            <button type="button" aria-label="Previous" onClick={() => go(-1)} className="press w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-sunken text-ink-2"><IconChevronLeft size={20} /></button>
            <button type="button" aria-label="Next" onClick={() => go(1)} className="press w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-sunken text-ink-2"><IconChevronRight size={20} /></button>
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] truncate min-w-0">{title.main}</h1>
          <div className="ml-auto flex items-center gap-2">
            <div role="tablist" aria-label="View" className="hidden md:flex p-0.5 rounded-[10px] bg-sunken">
              {VIEWS.map(({ v, label }) => (
                <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)}
                  className={`press h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors ${view === v ? 'bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0_/_0.12)]' : 'text-ink-2 hover:text-ink'}`}>{label}</button>
              ))}
            </div>
            <button type="button" aria-label="Search" onClick={() => setView('search')} className={`press w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-sunken ${view === 'search' ? 'text-accent' : 'text-ink-2'}`}><IconSearch size={19} /></button>
            {!wide && <button type="button" aria-label="New event" onClick={() => edit({ occ: null })} className="press w-9 h-9 rounded-full bg-accent text-white inline-flex items-center justify-center"><IconPlus size={20} /></button>}
          </div>
        </header>
        <main className="flex-1 min-h-0 relative">
          <Swipe enabled={!wide}><ViewBody phone={false} /></Swipe>
        </main>
      </div>
      <Panels />
    </div>
  );
}
