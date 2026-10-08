import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useStore } from '../data/store';
import { displayZone } from './format';
import { expandAll } from '../core/recurrence';
import type { CalendarDoc, Occurrence } from '../core/types';

export type View = 'day' | 'week' | 'month' | 'year' | 'agenda' | 'search';

export interface Draft {
  start: string; // local in zone, or date when allDay
  end: string;
  allDay: boolean;
  calendarId?: string;
}

export type Panel = null | 'calendars' | 'import' | 'export' | 'settings' | 'deleted' | 'more' | { calendar: CalendarDoc | 'new' };

interface UI {
  zone: string;
  view: View;
  setView: (v: View) => void;
  cursor: DateTime; // a day in `zone`
  setCursor: (d: DateTime) => void;
  go: (dir: -1 | 1) => void;
  today: () => void;
  selected: Occurrence | null;
  select: (o: Occurrence | null) => void;
  editing: { occ: Occurrence | null; draft?: Draft; duplicate?: boolean } | null;
  edit: (e: UI['editing']) => void;
  panel: Panel;
  setPanel: (p: Panel) => void;
  calById: Map<string, CalendarDoc>;
  occurrencesIn: (fromUtc: number, toUtc: number) => Occurrence[];
}

const Ctx = createContext<UI | null>(null);
export const useUI = () => {
  const u = useContext(Ctx);
  if (!u) throw new Error('UI missing');
  return u;
};

export function UIProvider({ children }: { children: ReactNode }) {
  const { settings, events, overrides, calendars } = useStore();
  const zone = displayZone(settings);
  const [view, setViewRaw] = useState<View>(() => (window.innerWidth < 768 && settings.defaultView === 'year' ? 'month' : settings.defaultView));
  const [cursor, setCursor] = useState<DateTime>(() => DateTime.now().setZone(zone).startOf('day'));
  const [selected, select] = useState<Occurrence | null>(null);
  const [editing, edit] = useState<UI['editing']>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const visibleCals = useMemo(() => new Set(calendars.filter((c) => c.visible && !c.archived).map((c) => c.id)), [calendars]);
  const visibleEvents = useMemo(() => events.filter((e) => visibleCals.has(e.calendarId)), [events, visibleCals]);

  const occurrencesIn = useCallback(
    (fromUtc: number, toUtc: number) => expandAll(visibleEvents, overrides, fromUtc, toUtc).filter((o) => visibleCals.has(o.calendarId)),
    [visibleEvents, overrides, visibleCals],
  );

  const setView = useCallback((v: View) => { setViewRaw(v); select(null); }, []);

  const go = useCallback((dir: -1 | 1) => {
    setCursor((c) => {
      switch (view) {
        case 'day': return c.plus({ days: dir });
        case 'week': return c.plus({ weeks: dir });
        case 'month': return c.plus({ months: dir }).startOf('month');
        case 'year': return c.plus({ years: dir });
        default: return c.plus({ weeks: dir * 2 });
      }
    });
  }, [view]);

  const today = useCallback(() => setCursor(DateTime.now().setZone(zone).startOf('day')), [zone]);

  const value: UI = { zone, view, setView, cursor, setCursor, go, today, selected, select, editing, edit, panel, setPanel, calById, occurrencesIn };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
