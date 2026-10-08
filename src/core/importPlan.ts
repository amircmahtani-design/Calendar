import type { CalendarDoc, EventDoc, OverrideDoc } from './types';
import type { ParsedCalendar } from './ics';

export type Target = { kind: 'existing'; calendarId: string } | { kind: 'new'; name: string; color: string } | { kind: 'skip' };

export interface ImportCounts {
  toCreate: number;
  toUpdate: number;
  duplicates: number;
  failed: number;
}

export interface ImportPlan {
  calendars: CalendarDoc[]; // new calendars to create
  events: EventDoc[]; // create or update
  overrides: OverrideDoc[];
  previous: (EventDoc | OverrideDoc)[]; // copies of docs being updated, for rollback
  perFile: Record<string, ImportCounts>;
  totals: ImportCounts;
}

/** Suggest a target per parsed calendar: same name (case-insensitive) → existing, else new. */
export function suggestTargets(parsed: ParsedCalendar[], existing: CalendarDoc[]): Target[] {
  return parsed.map((p) => {
    const hit = existing.find((c) => !c.deletedAt && c.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    return hit ? { kind: 'existing', calendarId: hit.id } : { kind: 'new', name: p.name, color: p.color || '#007AFF' };
  });
}

/**
 * Build the write plan. Duplicates are matched on UID (+ RECURRENCE-ID).
 * A duplicate with a higher SEQUENCE than what we hold is an update; otherwise skipped.
 */
export function buildImportPlan(
  parsed: ParsedCalendar[],
  targets: Target[],
  existing: { events: EventDoc[]; overrides: OverrideDoc[]; calendars: CalendarDoc[] },
  batchId: string,
  newId: () => string,
  now = Date.now(),
): ImportPlan {
  const evByUid = new Map<string, EventDoc>();
  for (const e of existing.events) if (e.ical?.uid && !e.deletedAt) evByUid.set(e.ical.uid, e);
  const ovByKey = new Map<string, OverrideDoc>();
  const evById = new Map(existing.events.map((e) => [e.id, e]));
  for (const o of existing.overrides) {
    if (o.deletedAt) continue;
    const uid = evById.get(o.seriesId)?.ical?.uid;
    if (uid) ovByKey.set(`${uid}|${o.recurrenceId}`, o);
  }

  const plan: ImportPlan = { calendars: [], events: [], overrides: [], previous: [], perFile: {}, totals: { toCreate: 0, toUpdate: 0, duplicates: 0, failed: 0 } };
  const seenInThisImport = new Set<string>();
  let order = existing.calendars.length;

  parsed.forEach((p, i) => {
    const counts: ImportCounts = { toCreate: 0, toUpdate: 0, duplicates: 0, failed: p.errors.length };
    plan.perFile[p.fileName] = counts;
    const t = targets[i];
    if (!t || t.kind === 'skip') return;
    let calendarId: string;
    if (t.kind === 'new') {
      calendarId = newId();
      plan.calendars.push({
        id: calendarId, name: t.name, color: t.color, visible: true, archived: false, defaultReminders: [],
        sortOrder: order++, source: { type: 'import', importBatchId: batchId, originalName: p.name }, createdAt: now, updatedAt: now,
      });
    } else calendarId = t.calendarId;

    for (const it of p.items.filter((x) => x.kind === 'event')) {
      if (seenInThisImport.has(it.key)) { counts.duplicates++; continue; }
      seenInThisImport.add(it.key);
      const prev = evByUid.get(it.uid);
      if (prev) {
        if ((it.sequence || 0) > (prev.ical?.sequence || 0)) {
          plan.previous.push(prev);
          plan.events.push({ ...prev, ...it.event!, id: prev.id, calendarId: prev.calendarId, source: { type: 'import', importBatchId: batchId }, updatedAt: now });
          counts.toUpdate++;
        } else counts.duplicates++;
        continue;
      }
      const id = newId();
      evByUid.set(it.uid, { ...(it.event as EventDoc), id, calendarId });
      plan.events.push({ ...(it.event as EventDoc), id, calendarId, source: { type: 'import', importBatchId: batchId }, createdAt: now, updatedAt: now });
      counts.toCreate++;
    }
    for (const it of p.items.filter((x) => x.kind === 'override')) {
      if (seenInThisImport.has(it.key)) { counts.duplicates++; continue; }
      seenInThisImport.add(it.key);
      const master = evByUid.get(it.uid);
      if (!master) { counts.failed++; continue; }
      const prev = ovByKey.get(it.key);
      if (prev) {
        if ((it.sequence || 0) > (prev.ical?.sequence || 0)) {
          plan.previous.push(prev);
          plan.overrides.push({ ...prev, ...it.override!, id: prev.id, seriesId: prev.seriesId, updatedAt: now });
          counts.toUpdate++;
        } else counts.duplicates++;
        continue;
      }
      plan.overrides.push({ ...(it.override as OverrideDoc), id: newId(), seriesId: master.id, source: { type: 'import', importBatchId: batchId }, createdAt: now, updatedAt: now });
      counts.toCreate++;
    }
    for (const k of Object.keys(plan.totals) as (keyof ImportCounts)[]) plan.totals[k] += counts[k];
  });
  return plan;
}
