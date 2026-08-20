import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/format.js';

/** A ghost button that confirms the copy in place, then goes back to its label. */
export default function CopyButton({ label, text, className = 'ghost', style }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function handle() {
    await copyText(typeof text === 'function' ? text() : text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className={className} style={style} onClick={handle}>
      {copied ? 'คัดลอกแล้ว ✓' : label}
    </button>
  );
}
