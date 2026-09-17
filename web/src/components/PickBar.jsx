import { useEffect, useRef, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';

/**
 * The working plan, as a button pinned to the bottom-right corner: it carries a
 * count of the shops filed into the active plan, and a click opens a panel
 * listing them with the plan actions (switch plan / open plan). Each result
 * card's "+ ใส่แผน" fills it.
 */
export default function PickBar({ activePlan, onSwitchPlan }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null until first load, then an array
  const box = useRef(null);

  const planId = activePlan?.id;
  // Refetch when a shop is added: App bumps `total` on every "+ ใส่แผน".
  const total = activePlan?.total;

  useEffect(() => {
    if (!planId) return undefined;
    let live = true;
    getPlan(planId)
      .then((plan) => live && setItems(plan.items || []))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [planId, total]);

  // A click anywhere outside the panel closes it, so it stays open for as long
  // as the officer is working in it — the hover version vanished the moment the
  // cursor left, before สลับแผน could be reached.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!activePlan) return null;

  const count = items ? items.length : total || 0;

  return (
    <div className="cart" ref={box}>
      {open && (
        <div className="cart-popover glass-panel">
          <div className="cart-head">
            <b>แผน {activePlan.id}</b>
            <small>{activePlan.date || 'ยังไม่กำหนดวันที่'}</small>
          </div>
          {count === 0 ? (
            <div className="cart-empty">ยังไม่มีร้านในแผน</div>
          ) : (
            <ol className="cart-items">
              {(items || []).map((item) => (
                <li key={item.newCode} className={item.status === 'done' ? 'done' : undefined}>
                  {item.placeName || '(ไม่ระบุชื่อ)'}
                </li>
              ))}
            </ol>
          )}
          <div className="cart-actions">
            <button
              type="button"
              className="link"
              onClick={() => {
                setOpen(false);
                onSwitchPlan();
              }}
            >
              สลับแผน
            </button>
            <button
              type="button"
              className="link"
              onClick={() => (window.location.hash = '#/plans')}
            >
              ดูแผน
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="cart-fab"
        aria-label={`แผน ${activePlan.id} — ${count} ร้าน`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="material-symbols-outlined">checklist</span>
        {count > 0 && <span className="cart-badge">{count}</span>}
      </button>
    </div>
  );
}
