import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, newId } from '../../data/store';
import { useUI } from '../state';
import { Sheet, SheetHeader, TextButton, Group, Row } from '../Sheet';
import { parseIcs, type ParsedCalendar } from '../../core/ics';
import { buildImportPlan, suggestTargets, type Target } from '../../core/importPlan';
import { confirmAction } from '../ScopeDialog';
import { IconImport } from '../icons';
import { PALETTE } from '../colors';

type Step = 'pick' | 'preview' | 'working' | 'done';

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const INV_LABEL: Record<string, string> = {
  recurring: 'Repeating series', exceptions: 'Changed occurrences', alarms: 'With alerts', attendees: 'With invitees',
  urls: 'With links', attachments: 'With attachments (files not included)', travelTime: 'With travel time', mapLocation: 'With map pins',
  'time:zoned': 'Timed, with time zone', 'time:utc': 'Timed, in UTC', 'time:floating': 'Timed, no time zone', 'time:date': 'All-day',
  'time:unknown-zone': 'Non-standard zone names', missingUid: 'Missing ID (can’t de-duplicate)', orphanExceptions: 'Orphan exceptions',
};

export function ImportPanel() {
  const store = useStore();
  const { calendars, events, overrides, batches, commitImport, rollbackImport } = store;
  const { setPanel, zone } = useUI();
  const [step, setStep] = useState<Step>('pick');
  const [parsed, setParsed] = useState<ParsedCalendar[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState('');
  const [batchId] = useState(() => newId());
  const close = () => setPanel(null);

  const plan = useMemo(() => {
    if (!parsed.length) return null;
    let n = 0;
    return buildImportPlan(parsed, targets, { events, overrides, calendars }, batchId, () => `${batchId}${(++n).toString(36).padStart(5, '0')}`);
  }, [parsed, targets, events, overrides, calendars, batchId]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    const out: ParsedCalendar[] = [];
    for (const f of Array.from(files)) {
      try {
        out.push(parseIcs(await f.text(), f.name, zone));
      } catch (e) {
        out.push({ fileName: f.name, name: f.name, items: [], errors: [{ item: f.name, message: (e as Error).message }], inventory: {}, warnings: [] });
      }
    }
    setParsed(out);
    setTargets(suggestTargets(out, calendars.filter((c) => !c.archived)));
    setStep('preview');
  };

  const run = async () => {
    if (!plan) return;
    setStep('working');
    try {
      await commitImport(plan, {
        id: batchId,
        files: parsed.map((p) => p.fileName),
        errors: parsed.flatMap((p) => p.errors.map((e) => ({ file: p.fileName, ...e }))),
        warnings: parsed.flatMap((p) => p.warnings.map((w) => `${p.name}: ${w}`)),
      }, (d, t) => setProgress([d, t]));
      setStep('done');
    } catch (e) {
      setError(`Import stopped: ${(e as Error).message}. Anything written can be rolled back below.`);
      setStep('done');
    }
  };

  const errorReport = () => {
    const lines = ['File,Item,Problem', ...parsed.flatMap((p) => p.errors.map((e) => [p.fileName, e.item, e.message].map((v) => `"${v.replace(/"/g, '""')}"`).join(',')))];
    download(`Import errors ${DateTime.now().toFormat('dd-MM-yyyy HHmm')}.csv`, lines.join('\n'), 'text/csv');
  };

  return (
    <Sheet open onClose={close} label="Import" wide>
      <SheetHeader
        left={step === 'preview' ? <TextButton onClick={() => setStep('pick')}>Back</TextButton> : <TextButton onClick={close}>Close</TextButton>}
        title="Import from Apple Calendar"
        right={step === 'preview' ? <TextButton strong onClick={run} disabled={!plan || plan.totals.toCreate + plan.totals.toUpdate === 0}>Import</TextButton> : null}
      />
      <div className="pt-4 pb-4">
        {step === 'pick' && (
          <>
            <Group>
              <label className="press flex flex-col items-center justify-center gap-2 py-8 px-4 text-center cursor-pointer">
                <span className="w-12 h-12 rounded-full bg-accent-soft text-accent inline-flex items-center justify-center"><IconImport size={24} /></span>
                <span className="text-[16px] font-semibold text-accent">Choose .ics files</span>
                <span className="text-[13px] text-ink-2">You can select several at once. Nothing is saved until you confirm.</span>
                <input type="file" accept=".ics,text/calendar" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
              </label>
            </Group>
            <Group title="Exporting from Apple Calendar">
              <div className="px-4 py-3 text-[14px] leading-relaxed space-y-2 text-ink-2">
                <p><b className="text-ink">On a Mac:</b> open Calendar, click one calendar in the sidebar, then File → Export → Export… Repeat for each calendar. Each file keeps its name and colour.</p>
                <p><b className="text-ink">Without a Mac:</b> on iCloud.com, open Calendar, share a calendar as a Public Calendar, copy the link, change <code>webcal://</code> to <code>https://</code> and open it in Safari to download the .ics. Turn public sharing off afterwards.</p>
                <p>iPhone can’t export .ics directly. Birthdays and Holidays calendars aren’t exportable.</p>
              </div>
            </Group>
            {batches.length > 0 && <History />}
          </>
        )}

        {step === 'preview' && plan && (
          <>
            <Group>
              <div className="px-4 py-3 grid grid-cols-4 text-center">
                {([['toCreate', 'New'], ['toUpdate', 'Updated'], ['duplicates', 'Duplicates'], ['failed', 'Failed']] as const).map(([k, l]) => (
                  <div key={k}><div className={`text-[22px] font-semibold tnum ${k === 'failed' && plan.totals.failed ? 'text-danger' : ''}`}>{plan.totals[k]}</div><div className="text-[12px] text-ink-2">{l}</div></div>
                ))}
              </div>
            </Group>
            {parsed.map((p, i) => {
              const c = plan.perFile[p.fileName];
              const t = targets[i];
              return (
                <Group key={p.fileName + i} title={<span className="normal-case">{p.fileName}</span>} footer={p.warnings.length ? <span className="block space-y-1">{p.warnings.map((w) => <span key={w} className="block">• {w}</span>)}</span> : undefined}>
                  <Row>
                    <span className="dot" style={{ ['--c' as string]: p.color || '#8E8E93' }} />
                    <span className="flex-1 font-medium truncate">{p.name}</span>
                    <span className="text-[13px] text-ink-2 tnum">{p.items.length} item{p.items.length === 1 ? '' : 's'}</span>
                  </Row>
                  <div className="px-4 min-h-12 py-2 flex items-center justify-between gap-3">
                    <span className="text-[15px]">Import into</span>
                    <select
                      aria-label={`Destination for ${p.name}`}
                      className="h-9 rounded-lg bg-sunken px-2 text-[15px] max-w-[60%]"
                      value={t?.kind === 'existing' ? t.calendarId : t?.kind ?? 'new'}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = [...targets];
                        next[i] = v === 'new' ? { kind: 'new', name: p.name, color: p.color || PALETTE[i % PALETTE.length].hex } : v === 'skip' ? { kind: 'skip' } : { kind: 'existing', calendarId: v };
                        setTargets(next);
                      }}
                    >
                      <option value="new">New calendar “{p.name}”</option>
                      {calendars.filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      <option value="skip">Don’t import</option>
                    </select>
                  </div>
                  {c && <div className="px-4 py-2.5 text-[13px] text-ink-2 tnum">{c.toCreate} new · {c.toUpdate} updated · {c.duplicates} already here · {c.failed} failed</div>}
                  {Object.keys(p.inventory).length > 0 && (
                    <div className="px-4 py-2.5 text-[13px] text-ink-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {Object.entries(p.inventory).map(([k, v]) => <span key={k} className="flex justify-between gap-2"><span className="truncate">{INV_LABEL[k] || k}</span><span className="tnum">{v}</span></span>)}
                    </div>
                  )}
                  {p.errors.length > 0 && (
                    <div className="px-4 py-2.5 text-[13px] text-danger space-y-0.5">
                      {p.errors.slice(0, 5).map((e, j) => <p key={j} className="truncate">{e.item}: {e.message}</p>)}
                      {p.errors.length > 5 && <p>…and {p.errors.length - 5} more</p>}
                    </div>
                  )}
                </Group>
              );
            })}
            <p className="px-8 text-[12px] text-ink-2 leading-snug">
              Matching uses each event’s Apple ID, so importing the same file again won’t create duplicates. Every import can be rolled back in one tap.
              {parsed.some((p) => p.errors.length) && <> <button type="button" className="text-accent underline" onClick={errorReport}>Download error report</button>.</>}
            </p>
          </>
        )}

        {step === 'working' && (
          <div className="px-6 py-16 text-center">
            <p className="text-[16px] font-medium">Importing…</p>
            <div className="mt-4 h-1.5 rounded-full bg-sunken overflow-hidden"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress[1] ? (progress[0] / progress[1]) * 100 : 5}%` }} /></div>
            <p className="mt-2 text-[13px] text-ink-2 tnum">{progress[0]} of {progress[1] || '…'}</p>
          </div>
        )}

        {step === 'done' && (
          <>
            <Group>
              <div className="px-4 py-5 text-center">
                {error ? <p className="text-danger text-[15px]">{error}</p> : <>
                  <p className="text-[17px] font-semibold">Import complete</p>
                  {plan && <p className="text-[14px] text-ink-2 mt-1 tnum">{plan.totals.toCreate} added · {plan.totals.toUpdate} updated · {plan.totals.duplicates} skipped as duplicates · {plan.totals.failed} failed</p>}
                </>}
              </div>
              {parsed.some((p) => p.errors.length) && <Row onClick={errorReport} className="text-accent justify-center">Download error report</Row>}
              <Row onClick={() => { setParsed([]); setStep('pick'); }} className="text-accent justify-center">Import more files</Row>
            </Group>
            <History />
          </>
        )}
      </div>
    </Sheet>
  );

  function History() {
    return (
      <Group title="Import history" footer="Rolling back removes what that import added and restores anything it updated.">
        {batches.slice(0, 10).map((b) => (
          <div key={b.id} className="px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[15px] truncate">{b.files.join(', ')}</p>
              <p className="text-[12px] text-ink-2 tnum">{DateTime.fromMillis(b.createdAt).toFormat('dd/MM/yyyy HH:mm')} · {b.totals?.toCreate ?? 0} added · {b.status === 'rolledBack' ? 'rolled back' : b.status}</p>
            </div>
            {b.status !== 'rolledBack' && (
              <button type="button" className="press text-danger text-[14px] min-h-11 px-2" onClick={async () => {
                if (await confirmAction('Roll back this import?', 'Roll back', { danger: true, message: 'Events and calendars it added will be removed (recoverable from Recently deleted).' })) await rollbackImport(b.id);
              }}>Roll back</button>
            )}
          </div>
        ))}
      </Group>
    );
  }
}
