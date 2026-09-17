import { useEffect, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';

/**
 * The working plan as a cart: a floating button in the bottom-right corner
 * that carries a count of the shops filed into the active plan, and reveals
 * the list of those shops on hover. Each result card's "+ ใส่แผน" fills this
 * cart; clicking it opens the plan.
 */
export default function PickBar({ activePlan, onSwitchPlan }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null until first load, then an array

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

  if (!activePlan) return null;

  const count = items ? items.length : total || 0;

  return (
    <div
      className="cart"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
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
            <button type="button" className="link" onClick={onSwitchPlan}>
              สลับแผน
            </button>
            <button type="button" className="link" onClick={() => (window.location.hash = '#/plans')}>
              ดูแผน
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="cart-fab"
        aria-label={`แผน ${activePlan.id} — ${count} ร้าน`}
        onClick={() => (window.location.hash = '#/plans')}
      >
        <span className="material-symbols-outlined">shopping_cart</span>
        {count > 0 && <span className="cart-badge">{count}</span>}
      </button>
    </div>
  );
}
