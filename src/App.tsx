import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './data/store';
import { configured, OWNER_EMAIL } from './data/firebase';
import { UIProvider } from './ui/state';
import { Shell } from './ui/Shell';
import { LiveIcon } from './ui/LiveIcon';
import { deviceZone } from './core/time';

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e10' : '#ffffff');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-full flex flex-col items-center justify-center gap-5 px-6 py-12 text-center bg-soft safe-t safe-b">{children}</div>;
}

function SignIn() {
  const { signIn, denied } = useStore();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Centered>
      <LiveIcon zone={deviceZone()} size={88} badge={false} />
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Calendar</h1>
        <p className="text-ink-2 mt-1 text-[15px]">Private to {OWNER_EMAIL}</p>
      </div>
      {(denied || err) && <p role="alert" className="text-danger text-[14px] max-w-[320px]">{denied ? 'That Google account doesn’t have access to this calendar.' : err}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => { setErr(''); setBusy(true); try { await signIn(); } catch (e) { const m = (e as { code?: string }).code; if (m !== 'auth/popup-closed-by-user' && m !== 'auth/cancelled-popup-request') setErr('Sign-in didn’t complete. Please try again.'); } finally { setBusy(false); } }}
        className="press h-12 px-6 rounded-xl bg-surface shadow-[var(--shadow)] text-[16px] font-semibold inline-flex items-center gap-3 disabled:opacity-60"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {busy ? 'Signing in…' : 'Sign in with Google'}
      </button>
    </Centered>
  );
}

function Gate() {
  const { authReady, user, settings, dataReady } = useStore();
  useTheme(settings.theme);
  if (!authReady) return <Centered><LiveIcon zone={deviceZone()} size={64} badge={false} /></Centered>;
  if (!user) return <SignIn />;
  if (!dataReady) return <Centered><LiveIcon zone={deviceZone()} size={64} badge={false} /><p className="text-ink-2 text-[14px]">Loading your calendar…</p></Centered>;
  return <UIProvider><Shell /></UIProvider>;
}

function NotConfigured() {
  useTheme('system');
  return (
    <Centered>
      <LiveIcon zone={deviceZone()} size={88} badge={false} />
      <div className="max-w-[360px]">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Almost ready</h1>
        <p className="text-ink-2 mt-2 text-[15px] leading-relaxed">The app is deployed. It connects to its Firebase project as soon as the project details are added.</p>
      </div>
    </Centered>
  );
}

export default function App() {
  if (!configured) return <NotConfigured />;
  return <StoreProvider><Gate /></StoreProvider>;
}
