import { useEffect, useState } from 'react';

type Scope = 'this' | 'following' | 'all';
type Req = { kind: 'edit' | 'delete'; allowThis: boolean; resolve: (s: Scope | null) => void };

let push: ((r: Req) => void) | null = null;

/** Ask which occurrences a change applies to. Resolves null if cancelled. */
export function askScope(kind: 'edit' | 'delete', allowThis = true): Promise<Scope | null> {
  return new Promise((resolve) => {
    if (!push) return resolve('this');
    push({ kind, allowThis, resolve });
  });
}

export function ScopeDialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    push = setReq;
    return () => { push = null; };
  }, []);
  if (!req) return null;
  const done = (s: Scope | null) => { req.resolve(s); setReq(null); };
  const del = req.kind === 'delete';
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-label="Repeating event">
      <div className="scrim-enter absolute inset-0 bg-black/30 dark:bg-black/55" onClick={() => done(null)} />
      <div className="sheet-enter relative w-full max-w-[400px] space-y-2 safe-b">
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[var(--shadow-lg)]">
          <div className="px-5 pt-4 pb-3 text-center">
            <p className="text-[15px] font-semibold">{del ? 'Delete repeating event' : 'Save changes to repeating event'}</p>
            <p className="text-[13px] text-ink-2 mt-0.5">{del ? 'Which occurrences do you want to delete?' : 'Which occurrences should change?'}</p>
          </div>
          <div className="divide-y divide-line-soft border-t border-line-soft">
            {req.allowThis && (
              <button className={`press w-full h-12 text-[16px] ${del ? 'text-danger' : 'text-accent'}`} onClick={() => done('this')}>
                {del ? 'Delete this event only' : 'This event only'}
              </button>
            )}
            <button className={`press w-full h-12 text-[16px] ${del ? 'text-danger' : 'text-accent'}`} onClick={() => done('following')}>
              {del ? 'Delete this and following' : 'This and following events'}
            </button>
            <button className={`press w-full h-12 text-[16px] ${del ? 'text-danger' : 'text-accent'}`} onClick={() => done('all')}>
              {del ? 'Delete all events in series' : 'All events in the series'}
            </button>
          </div>
        </div>
        <button className="press w-full h-12 rounded-2xl bg-surface text-[16px] font-semibold text-accent shadow-[var(--shadow)]" onClick={() => done(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Simple confirm with the same look. */
type ConfirmReq = { title: string; message?: string; action: string; danger?: boolean; resolve: (ok: boolean) => void };
let pushConfirm: ((r: ConfirmReq) => void) | null = null;

export function confirmAction(title: string, action: string, opts: { message?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(window.confirm(title));
    pushConfirm({ title, action, ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => { pushConfirm = setReq; return () => { pushConfirm = null; }; }, []);
  if (!req) return null;
  const done = (ok: boolean) => { req.resolve(ok); setReq(null); };
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-label={req.title}>
      <div className="scrim-enter absolute inset-0 bg-black/30 dark:bg-black/55" onClick={() => done(false)} />
      <div className="sheet-enter relative w-full max-w-[400px] space-y-2 safe-b">
        <div className="rounded-2xl bg-surface overflow-hidden shadow-[var(--shadow-lg)]">
          <div className="px-5 pt-4 pb-3 text-center">
            <p className="text-[15px] font-semibold">{req.title}</p>
            {req.message && <p className="text-[13px] text-ink-2 mt-1 leading-snug">{req.message}</p>}
          </div>
          <button className={`press w-full h-12 border-t border-line-soft text-[16px] ${req.danger ? 'text-danger' : 'text-accent'}`} onClick={() => done(true)}>{req.action}</button>
        </div>
        <button className="press w-full h-12 rounded-2xl bg-surface text-[16px] font-semibold text-accent shadow-[var(--shadow)]" onClick={() => done(false)}>Cancel</button>
      </div>
    </div>
  );
}
