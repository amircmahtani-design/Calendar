import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';

/** SVG markup of the live date tile: red band with weekday, big day number, month. */
export function liveIconSvg(d: DateTime, size = 64): string {
  const wd = d.toFormat('ccc').toUpperCase();
  const mon = d.toFormat('LLL').toUpperCase();
  const day = String(d.day);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
<defs><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF453A"/><stop offset="1" stop-color="#E5281E"/></linearGradient>
<clipPath id="c"><rect width="100" height="100" rx="23"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="100" height="100" fill="#FBFBFB"/><rect width="100" height="25" fill="url(#r)"/></g>
<text x="50" y="18.5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-weight="700" font-size="14" fill="#fff" letter-spacing="0.5">${wd}</text>
<text x="50" y="74" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-weight="400" font-size="50" fill="#1C1C1E">${day}</text>
<text x="50" y="91" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-weight="600" font-size="11" fill="#6C6C72" letter-spacing="0.5">${mon}</text>
</svg>`;
}

function useToday(zone: string) {
  const [now, setNow] = useState(() => DateTime.now().setZone(zone));
  useEffect(() => {
    setNow(DateTime.now().setZone(zone));
    const tick = () => setNow(DateTime.now().setZone(zone));
    const ms = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day').diff(DateTime.now().setZone(zone)).toMillis();
    const t = setTimeout(tick, ms + 1000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVis); };
  }, [zone, now.day]);
  return now;
}

/** Live app tile shown in the header/sidebar; also keeps the tab favicon and icon badge current. */
export function LiveIcon({ zone, size = 32, badge }: { zone: string; size?: number; badge: boolean }) {
  const today = useToday(zone);
  useEffect(() => {
    const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(liveIconSvg(today))}`;
    let link = document.querySelector<HTMLLinkElement>('link#live-favicon');
    if (!link) {
      link = document.createElement('link');
      link.id = 'live-favicon';
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      document.head.appendChild(link);
    }
    link.href = href;
    document.title = `Calendar · ${today.toFormat('ccc d LLL')}`;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (badge && nav.setAppBadge) nav.setAppBadge(today.day).catch(() => {});
    else if (!badge && nav.clearAppBadge) nav.clearAppBadge().catch(() => {});
  }, [today, badge]);
  return (
    <span
      role="img"
      aria-label={today.toFormat('cccc d MMMM')}
      style={{ width: size, height: size, display: 'inline-block', flex: 'none', filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.12))' }}
      dangerouslySetInnerHTML={{ __html: liveIconSvg(today, size) }}
    />
  );
}
