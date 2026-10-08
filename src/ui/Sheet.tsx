import { useEffect, useRef, useState, type ReactNode } from 'react';

export function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, children, label, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <div className="scrim-enter absolute inset-0 bg-black/30 dark:bg-black/55" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={`sheet-enter relative w-full ${wide ? 'md:max-w-[720px]' : 'md:max-w-[480px]'} max-h-[92dvh] md:max-h-[86dvh] overflow-y-auto overscroll-contain bg-soft rounded-t-[20px] md:rounded-[18px] shadow-[var(--shadow-lg)] outline-none safe-b`}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ left, title, right }: { left?: ReactNode; title?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 h-14 bg-soft/90 backdrop-blur-md border-b border-line-soft">
      <div className="justify-self-start">{left}</div>
      <div className="text-[16px] font-semibold truncate">{title}</div>
      <div className="justify-self-end">{right}</div>
    </div>
  );
}

export function TextButton({ children, onClick, strong, danger, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; strong?: boolean; danger?: boolean; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press min-h-11 px-1 text-[16px] ${strong ? 'font-semibold' : ''} ${danger ? 'text-danger' : 'text-accent'} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

/** Grouped list section (iOS settings style). */
export function Group({ children, title, footer }: { children: ReactNode; title?: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mx-4 mb-6">
      {title && <h3 className="px-4 pb-1.5 text-[12px] uppercase tracking-wide text-ink-2">{title}</h3>}
      <div className="rounded-xl bg-surface overflow-hidden divide-y divide-line-soft">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-[12px] text-ink-2 leading-snug">{footer}</p>}
    </section>
  );
}

export function Row({ children, onClick, className = '' }: { children: ReactNode; onClick?: () => void; className?: string }) {
  const cls = `w-full min-h-11 px-4 py-2.5 flex items-center gap-3 text-left text-[16px] ${className}`;
  return onClick ? <button type="button" className={`${cls} press active:bg-sunken`} onClick={onClick}>{children}</button> : <div className={cls}>{children}</div>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}
