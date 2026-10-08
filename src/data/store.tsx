import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithCredential, GoogleAuthProvider, signOut, type User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, writeBatch, setDoc, getDocs, query, where, type Firestore,
} from 'firebase/firestore';
import { auth, db, OWNER_EMAIL, useEmulator } from './firebase';

// Emulator-only hook so automated tests can sign in without a Google popup.
if (useEmulator && auth && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__testSignIn = (email = OWNER_EMAIL) =>
    signInWithCredential(auth!, GoogleAuthProvider.credential(JSON.stringify({ sub: `test-${email}`, email, email_verified: true })));
}
import type { CalendarDoc, EventDoc, Occurrence, OverrideDoc, Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { planDelete, planEdit, type EventPatch, type Scope, type Writes } from '../core/ops';
import { normaliseEvent } from '../core/recurrence';
import type { ImportPlan } from '../core/importPlan';

export const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Math.random().toString(36).slice(2));
export const newUid = () => `${crypto.randomUUID?.() || newId()}@amir-calendar`;

export const DEFAULT_CALENDARS: Pick<CalendarDoc, 'name' | 'color'>[] = [
  { name: 'Personal', color: '#007AFF' },
  { name: 'Family', color: '#34C759' },
  { name: 'Work', color: '#AF52DE' },
  { name: 'Ariadne', color: '#FF2D55' },
  { name: 'Fitness', color: '#FF9500' },
  { name: 'Travel', color: '#FFCC00' },
  { name: 'Finance', color: '#8E8E93' },
  { name: 'Important Dates', color: '#FF3B30' },
];

export interface ImportBatch {
  id: string;
  createdAt: number;
  files: string[];
  totals: { toCreate: number; toUpdate: number; duplicates: number; failed: number };
  errors: { file: string; item: string; message: string }[];
  warnings: string[];
  status: 'committing' | 'done' | 'rolledBack' | 'failed';
  calendarIds: string[];
  eventIds: string[];
  overrideIds: string[];
  rolledBackAt?: number;
}

interface Store {
  user: User | null;
  authReady: boolean;
  denied: boolean;
  dataReady: boolean;
  calendars: CalendarDoc[];
  events: EventDoc[];
  overrides: OverrideDoc[];
  deletedEvents: EventDoc[];
  settings: Settings;
  batches: ImportBatch[];
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  createEvent: (e: Omit<EventDoc, 'id' | 'startUtc' | 'endUtc'>) => Promise<string>;
  editOccurrence: (occ: Occurrence, patch: EventPatch, scope: Scope) => Promise<void>;
  deleteOccurrence: (occ: Occurrence, scope: Scope) => Promise<void>;
  restoreEvent: (id: string) => Promise<void>;
  saveCalendar: (c: CalendarDoc) => Promise<void>;
  deleteCalendar: (id: string) => Promise<void>;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  commitImport: (plan: ImportPlan, meta: Omit<ImportBatch, 'status' | 'calendarIds' | 'eventIds' | 'overrideIds' | 'createdAt' | 'totals'>, onProgress?: (done: number, total: number) => void) => Promise<void>;
  rollbackImport: (batchId: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store missing');
  return s;
}

function col(fs: Firestore, uid: string, name: string) {
  return collection(fs, 'users', uid, name);
}

/** Commit writes in chunks under Firestore's 500-op batch limit. */
async function commitDocs(fs: Firestore, uid: string, items: { col: string; id: string; data: object }[], onProgress?: (d: number, t: number) => void) {
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const b = writeBatch(fs);
    for (const it of items.slice(i, i + CHUNK)) b.set(doc(fs, 'users', uid, it.col, it.id), it.data);
    await b.commit();
    onProgress?.(Math.min(items.length, i + CHUNK), items.length);
  }
}

function writesToItems(w: Writes) {
  return [
    ...w.events.map((e) => ({ col: 'events', id: e.id, data: e })),
    ...w.overrides.map((o) => ({ col: 'overrides', id: o.id, data: o })),
  ];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [calendars, setCalendars] = useState<CalendarDoc[]>([]);
  const [allEvents, setAllEvents] = useState<EventDoc[]>([]);
  const [allOverrides, setAllOverrides] = useState<OverrideDoc[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loaded, setLoaded] = useState({ cal: false, ev: false, ov: false });

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (u) => {
      if (u && u.email !== OWNER_EMAIL) {
        setDenied(true);
        signOut(auth!);
        setUser(null);
      } else {
        setUser(u);
        if (u) setDenied(false);
      }
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const uid = user.uid;
    const fs = db;
    const unsubs = [
      onSnapshot(col(fs, uid, 'calendars'), (s) => {
        const list = s.docs.map((d) => ({ ...(d.data() as CalendarDoc), id: d.id }));
        setCalendars(list.filter((c) => !c.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder));
        setLoaded((l) => ({ ...l, cal: true }));
        // First run: seed the suggested calendars once the server confirms none exist.
        if (!s.metadata.fromCache && s.empty) {
          const now = Date.now();
          commitDocs(fs, uid, DEFAULT_CALENDARS.map((c, i) => {
            const id = newId();
            return { col: 'calendars', id, data: { id, ...c, visible: true, archived: false, defaultReminders: [], sortOrder: i, source: { type: 'local' }, createdAt: now, updatedAt: now } };
          }));
        }
      }),
      onSnapshot(col(fs, uid, 'events'), (s) => {
        setAllEvents(s.docs.map((d) => ({ ...(d.data() as EventDoc), id: d.id })));
        setLoaded((l) => ({ ...l, ev: true }));
      }),
      onSnapshot(col(fs, uid, 'overrides'), (s) => {
        setAllOverrides(s.docs.map((d) => ({ ...(d.data() as OverrideDoc), id: d.id })));
        setLoaded((l) => ({ ...l, ov: true }));
      }),
      onSnapshot(doc(fs, 'users', uid, 'meta', 'settings'), (s) => {
        setSettings({ ...DEFAULT_SETTINGS, ...((s.data() as Partial<Settings>) || {}) });
      }),
      onSnapshot(col(fs, uid, 'importBatches'), (s) => {
        setBatches(s.docs.map((d) => ({ ...(d.data() as ImportBatch), id: d.id })).sort((a, b) => b.createdAt - a.createdAt));
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  const events = useMemo(() => allEvents.filter((e) => !e.deletedAt), [allEvents]);
  const deletedEvents = useMemo(() => allEvents.filter((e) => e.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)), [allEvents]);
  const overrides = useMemo(() => allOverrides.filter((o) => !o.deletedAt), [allOverrides]);

  const uid = user?.uid;

  const signIn = useCallback(async () => {
    if (!auth) return;
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ login_hint: OWNER_EMAIL, prompt: 'select_account' });
    await signInWithPopup(auth, p);
  }, []);

  const signOutUser = useCallback(async () => { if (auth) await signOut(auth); }, []);

  const createEvent = useCallback(async (e: Omit<EventDoc, 'id' | 'startUtc' | 'endUtc'>) => {
    if (!db || !uid) throw new Error('Not signed in');
    const id = newId();
    const now = Date.now();
    const full = normaliseEvent({ ...e, id, startUtc: 0, endUtc: 0, ical: e.ical || { uid: newUid(), sequence: 0 }, source: e.source || { type: 'app' }, createdAt: now, updatedAt: now });
    await setDoc(doc(db, 'users', uid, 'events', id), full);
    return id;
  }, [uid]);

  const editOccurrence = useCallback(async (occ: Occurrence, patch: EventPatch, scope: Scope) => {
    if (!db || !uid) return;
    const master = allEvents.find((e) => e.id === occ.eventId);
    if (!master) throw new Error('Event not found');
    const w = planEdit(master, allOverrides, occ, patch, scope, { newEventId: newId, newOverrideId: newId, newUid });
    // Bump iCalendar SEQUENCE so exports are recognised as updates.
    w.events = w.events.map((e) => ({ ...e, ical: { uid: e.ical?.uid || newUid(), ...e.ical, sequence: (e.ical?.sequence || 0) + 1 } }));
    await commitDocs(db, uid, writesToItems(w));
  }, [uid, allEvents, allOverrides]);

  const deleteOccurrence = useCallback(async (occ: Occurrence, scope: Scope) => {
    if (!db || !uid) return;
    const master = allEvents.find((e) => e.id === occ.eventId);
    if (!master) return;
    await commitDocs(db, uid, writesToItems(planDelete(master, allOverrides, occ, scope)));
  }, [uid, allEvents, allOverrides]);

  const restoreEvent = useCallback(async (id: string) => {
    if (!db || !uid) return;
    const ev = allEvents.find((e) => e.id === id);
    if (!ev) return;
    const ovs = allOverrides.filter((o) => o.seriesId === id && o.deletedAt === ev.deletedAt);
    await commitDocs(db, uid, writesToItems({ events: [{ ...ev, deletedAt: null, updatedAt: Date.now() }], overrides: ovs.map((o) => ({ ...o, deletedAt: null })) }));
  }, [uid, allEvents, allOverrides]);

  const saveCalendar = useCallback(async (c: CalendarDoc) => {
    if (!db || !uid) return;
    await setDoc(doc(db, 'users', uid, 'calendars', c.id), { ...c, updatedAt: Date.now(), createdAt: c.createdAt || Date.now() });
  }, [uid]);

  const deleteCalendar = useCallback(async (id: string) => {
    if (!db || !uid) return;
    const now = Date.now();
    const cal = calendars.find((c) => c.id === id);
    if (!cal) return;
    const evs = allEvents.filter((e) => e.calendarId === id && !e.deletedAt);
    const evIds = new Set(evs.map((e) => e.id));
    await commitDocs(db, uid, [
      { col: 'calendars', id, data: { ...cal, deletedAt: now, updatedAt: now } },
      ...evs.map((e) => ({ col: 'events', id: e.id, data: { ...e, deletedAt: now, updatedAt: now } })),
      ...allOverrides.filter((o) => evIds.has(o.seriesId) && !o.deletedAt).map((o) => ({ col: 'overrides', id: o.id, data: { ...o, deletedAt: now } })),
    ]);
  }, [uid, calendars, allEvents, allOverrides]);

  const saveSettings = useCallback(async (s: Partial<Settings>) => {
    if (!db || !uid) return;
    setSettings((prev) => ({ ...prev, ...s }));
    await setDoc(doc(db, 'users', uid, 'meta', 'settings'), s, { merge: true });
  }, [uid]);

  const commitImport = useCallback(async (plan: ImportPlan, meta: Omit<ImportBatch, 'status' | 'calendarIds' | 'eventIds' | 'overrideIds' | 'createdAt' | 'totals'>, onProgress?: (d: number, t: number) => void) => {
    if (!db || !uid) return;
    const fs = db;
    const batchRef = doc(fs, 'users', uid, 'importBatches', meta.id);
    const created = new Set([...plan.events, ...plan.overrides].map((d) => d.id));
    for (const p of plan.previous) created.delete(p.id);
    const record: ImportBatch = {
      ...meta, createdAt: Date.now(), totals: plan.totals, status: 'committing',
      calendarIds: plan.calendars.map((c) => c.id),
      eventIds: plan.events.filter((e) => created.has(e.id)).map((e) => e.id),
      overrideIds: plan.overrides.filter((o) => created.has(o.id)).map((o) => o.id),
    };
    await setDoc(batchRef, record);
    // Keep copies of anything we overwrite so the batch can be rolled back.
    await commitDocs(fs, uid, plan.previous.map((p) => ({ col: `importBatches/${meta.id}/previous`, id: p.id, data: { kind: 'seriesId' in p ? 'override' : 'event', doc: p } })));
    try {
      await commitDocs(fs, uid, [
        ...plan.calendars.map((c) => ({ col: 'calendars', id: c.id, data: c })),
        ...plan.events.map((e) => ({ col: 'events', id: e.id, data: e })),
        ...plan.overrides.map((o) => ({ col: 'overrides', id: o.id, data: o })),
      ], onProgress);
      await setDoc(batchRef, { status: 'done' }, { merge: true });
    } catch (e) {
      await setDoc(batchRef, { status: 'failed' }, { merge: true });
      throw e;
    }
  }, [uid]);

  const rollbackImport = useCallback(async (batchId: string) => {
    if (!db || !uid) return;
    const fs = db;
    const b = batches.find((x) => x.id === batchId);
    if (!b) return;
    const now = Date.now();
    const evMap = new Map(allEvents.map((e) => [e.id, e]));
    const ovMap = new Map(allOverrides.map((o) => [o.id, o]));
    const calMap = new Map(calendars.map((c) => [c.id, c]));
    const items: { col: string; id: string; data: object }[] = [];
    for (const id of b.eventIds) { const e = evMap.get(id); if (e && !e.deletedAt) items.push({ col: 'events', id, data: { ...e, deletedAt: now } }); }
    for (const id of b.overrideIds) { const o = ovMap.get(id); if (o && !o.deletedAt) items.push({ col: 'overrides', id, data: { ...o, deletedAt: now } }); }
    for (const id of b.calendarIds) { const c = calMap.get(id); if (c) items.push({ col: 'calendars', id, data: { ...c, deletedAt: now } }); }
    const prev = await getDocs(query(collection(fs, 'users', uid, 'importBatches', batchId, 'previous'), where('kind', 'in', ['event', 'override'])));
    for (const d of prev.docs) {
      const { kind, doc: data } = d.data() as { kind: string; doc: EventDoc | OverrideDoc };
      items.push({ col: kind === 'event' ? 'events' : 'overrides', id: d.id, data });
    }
    await commitDocs(fs, uid, items);
    await setDoc(doc(fs, 'users', uid, 'importBatches', batchId), { status: 'rolledBack', rolledBackAt: now }, { merge: true });
  }, [uid, batches, allEvents, allOverrides, calendars]);

  const value: Store = {
    user, authReady, denied, dataReady: loaded.cal && loaded.ev && loaded.ov,
    calendars, events, overrides, deletedEvents, settings, batches,
    signIn, signOutUser, createEvent, editOccurrence, deleteOccurrence, restoreEvent,
    saveCalendar, deleteCalendar, saveSettings, commitImport, rollbackImport,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
