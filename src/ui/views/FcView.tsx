import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { EventContentArg, EventDropArg, DateSelectArg, EventClickArg, EventInput, DayHeaderContentArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { DateTime } from 'luxon';
import { useStore } from '../../data/store';
import { useUI } from '../state';
import { colorOf } from '../colors';
import { timeOf } from '../format';
import type { Occurrence } from '../../core/types';
import { utcToLocal } from '../../core/time';
import { askScope } from '../ScopeDialog';
import { useMedia } from '../Sheet';

type FcMode = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';

export function FcView({ mode }: { mode: FcMode }) {
  const { settings, editOccurrence } = useStore();
  const { zone, cursor, setCursor, occurrencesIn, calById, select, edit, setView } = useUI();
  const ref = useRef<FullCalendar>(null);
  const [scrolled, setScrolled] = useState(false);
  const phone = useMedia('(max-width: 767px)');

  // Keep FullCalendar in step with our cursor/view.
  useEffect(() => {
    const api = ref.current?.getApi();
    if (!api) return;
    if (api.view.type !== mode) api.changeView(mode);
    api.gotoDate(cursor.toISODate()!);
  }, [mode, cursor]);

  useEffect(() => {
    if (scrolled) return;
    const api = ref.current?.getApi();
    if (!api || mode === 'dayGridMonth') return;
    api.scrollToTime({ hours: 6, minutes: 45 });
    setScrolled(true);
  }, [mode, scrolled, zone]);

  const events = useCallback(
    (info: { startStr: string; endStr: string }, success: (e: EventInput[]) => void) => {
      const from = DateTime.fromISO(info.startStr).toMillis();
      const to = DateTime.fromISO(info.endStr).toMillis();
      const occ = occurrencesIn(from, to);
      success(occ.map((o) => {
        const c = colorOf(o.color, calById.get(o.calendarId)?.color);
        return {
          id: o.key,
          title: o.title,
          allDay: o.allDay,
          start: o.allDay ? o.start : new Date(o.startUtc).toISOString(),
          end: o.allDay ? o.end : new Date(Math.max(o.endUtc, o.startUtc + 15 * 60000)).toISOString(),
          editable: true,
          extendedProps: { occ: o, color: c },
        };
      }));
    },
    [occurrencesIn, calById],
  );

  const content = useCallback((arg: EventContentArg) => {
    const o = arg.event.extendedProps.occ as Occurrence;
    const c = arg.event.extendedProps.color as string;
    const cls = `evt ${o.status === 'tentative' ? 'is-tentative' : ''} ${o.status === 'cancelled' ? 'is-cancelled' : ''}`;
    if (mode === 'dayGridMonth') {
      return (
        <div className={cls} style={{ ['--c' as string]: c, height: 'auto', padding: '1px 6px 1px 7px' }}>
          <div className="truncate text-[12px]">
            {!o.allDay && <span className="evt-time mr-1 tnum">{timeOf(o.startUtc, zone, settings.timeFormat)}</span>}
            <span className="evt-title font-medium">{o.title}</span>
          </div>
        </div>
      );
    }
    const short = o.endUtc - o.startUtc <= 35 * 60000;
    return (
      <div className={cls} style={{ ['--c' as string]: c }}>
        {short ? (
          <div className="truncate"><span className="evt-title">{o.title}</span> <span className="evt-time tnum">{!o.allDay && timeOf(o.startUtc, zone, settings.timeFormat)}</span></div>
        ) : (
          <>
            <div className="evt-title line-clamp-2">{o.title}</div>
            {!o.allDay && <div className="evt-time tnum truncate">{timeOf(o.startUtc, zone, settings.timeFormat)}{o.location ? ` · ${o.location}` : ''}</div>}
          </>
        )}
      </div>
    );
  }, [mode, zone, settings.timeFormat]);

  const onMove = useCallback(async (info: EventDropArg | EventResizeDoneArg) => {
    const o = info.event.extendedProps.occ as Occurrence;
    const ev = info.event;
    let patch;
    if (ev.allDay) {
      const s = DateTime.fromISO(ev.startStr).toISODate()!;
      const e = ev.endStr ? DateTime.fromISO(ev.endStr).toISODate()! : DateTime.fromISO(s).plus({ days: 1 }).toISODate()!;
      patch = { allDay: true, start: s, end: e };
    } else {
      const s = DateTime.fromISO(ev.startStr).toMillis();
      const e = ev.endStr ? DateTime.fromISO(ev.endStr).toMillis() : s + (o.endUtc - o.startUtc || 3600000);
      const tz = o.allDay ? zone : o.tz;
      patch = { allDay: false, tz, start: utcToLocal(s, tz), end: utcToLocal(e, tz) };
    }
    let scope: 'this' | 'following' | 'all' | null = 'this';
    if (o.isRecurring) scope = await askScope('edit');
    if (!scope) { info.revert(); return; }
    try {
      await editOccurrence(o, patch, scope);
    } catch {
      info.revert();
    }
  }, [editOccurrence, zone]);

  const onSelect = useCallback((s: DateSelectArg) => {
    s.view.calendar.unselect();
    if (s.allDay) {
      edit({ occ: null, draft: { allDay: true, start: s.startStr.slice(0, 10), end: s.endStr.slice(0, 10) } });
    } else {
      const st = DateTime.fromISO(s.startStr).setZone(zone);
      let en = DateTime.fromISO(s.endStr).setZone(zone);
      if (en.diff(st, 'minutes').minutes <= 30) en = st.plus({ minutes: settings.defaultDurationMin });
      edit({ occ: null, draft: { allDay: false, start: st.toFormat("yyyy-MM-dd'T'HH:mm:ss"), end: en.toFormat("yyyy-MM-dd'T'HH:mm:ss") } });
    }
  }, [edit, zone, settings.defaultDurationMin]);

  const onClick = useCallback((a: EventClickArg) => {
    a.jsEvent.preventDefault();
    select(a.event.extendedProps.occ as Occurrence);
  }, [select]);


  const dayHeader = useCallback((a: DayHeaderContentArg) => {
    const d = DateTime.fromJSDate(a.date).setZone(zone);
    if (mode === 'dayGridMonth') return <span className="text-[12px] font-medium text-ink-2">{d.toFormat(phone ? 'ccccc' : 'ccc')}</span>;
    const isToday = d.toISODate() === DateTime.now().setZone(zone).toISODate();
    return (
      <button
        type="button"
        className="flex flex-col items-center gap-1 w-full"
        onClick={() => { setCursor(DateTime.fromISO(d.toISODate()!, { zone })); setView('day'); }}
      >
        <span className={`text-[11px] uppercase ${isToday ? 'text-accent font-semibold' : 'text-ink-2'}`}>{d.toFormat(phone ? 'ccccc' : 'ccc')}</span>
        <span className={`tnum text-[17px] w-8 h-8 inline-flex items-center justify-center rounded-full ${isToday ? 'bg-accent text-white font-semibold' : 'text-ink'}`}>{d.day}</span>
      </button>
    );
  }, [mode, zone, phone, setCursor, setView]);

  return (
    <div className="h-full">
      <FullCalendar
        ref={ref}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, luxonPlugin]}
        initialView={mode}
        initialDate={cursor.toISODate()!}
        timeZone={zone}
        headerToolbar={false}
        height="100%"
        firstDay={settings.weekStart}
        nowIndicator
        dayHeaders={mode !== 'timeGridDay'}
        editable
        selectable
        selectMirror
        eventResizableFromStart={false}
        longPressDelay={350}
        selectLongPressDelay={350}
        dayMaxEvents={mode === 'dayGridMonth' ? true : false}
        allDayText="all-day"
        slotDuration="00:30:00"
        snapDuration="00:15:00"
        scrollTimeReset={false}
        expandRows
        slotLabelFormat={settings.timeFormat === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', meridiem: 'short' }}
        eventTimeFormat={settings.timeFormat === '24h' ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        dayHeaderContent={dayHeader}
        events={events}
        eventContent={content}
        eventClick={onClick}
        eventDrop={onMove}
        eventResize={onMove}
        select={onSelect}
        fixedWeekCount={false}
        moreLinkContent={(a) => `${a.num} more`}
      />
    </div>
  );
}
