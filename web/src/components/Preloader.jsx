import { useEffect, useState } from 'react';

/**
 * The loading screen. Two variants, because this app has two waits and they
 * are nothing alike:
 *
 * - `screen` — the app booting while it fetches the area tree. Under a second,
 *   so it only exists to stop the page flashing an empty shell.
 * - `inline` — a search. The FDA site is walked page by page, and measured
 *   runs range from 7 seconds for a rare name to 223 for "บ้านยา" (2,536 rows
 *   over 51 pages). At that spread a spinner alone tells the officer nothing,
 *   so this one counts the seconds and says what is happening.
 */
export default function Preloader({ variant = 'inline', label, hint }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (variant !== 'inline') return undefined;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [variant]);

  if (variant === 'screen') {
    return (
      <div className="preloader preloader-screen" role="status" aria-live="polite">
        <img className="preloader-seal" src="/logo.png" alt="" />
        <span className="preloader-label">{label || 'กำลังเตรียมระบบ'}</span>
        <span className="preloader-track">
          <span className="preloader-sweep" />
        </span>
      </div>
    );
  }

  return (
    <div className="preloader preloader-inline glass-panel" role="status" aria-live="polite">
      <span className="preloader-pulse" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <div className="preloader-text">
        <b>{label || 'กำลังค้นหาจากเว็บ อย.'}</b>
        <small>
          {hint || 'อ่านตารางทีละหน้า คำค้นที่พบมากอาจใช้เวลาหลายนาที'}
        </small>
      </div>
      <span className="preloader-clock">{seconds} วิ</span>
      <span className="preloader-track">
        <span className="preloader-sweep" />
      </span>
    </div>
  );
}
