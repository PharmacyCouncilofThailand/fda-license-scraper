import { useEffect, useRef, useState } from 'react';

/**
 * The working plan as a cart pinned to the bottom-right corner: a record-sheet
 * icon carrying the shop count, a dropdown that switches the active plan
 * (A/B/C…), and a button that starts a new one. Floats over every step so the
 * plan is always to hand without taking a strip off the top of the page.
 */
export default function PlanBar({ activePlan, plans, busy, onPick, onNew, onDropCode }) {
  // The count is read from the live list so it stays right after shops are
  // added or removed, even if the picked object was cached with an old total.
  const count = plans.find((p) => p.id === activePlan?.id)?.total ?? 0;
  const [over, setOver] = useState(false);
  // Bump the badge when the count goes up, so an add is felt, not just read.
  const [bump, setBump] = useState(0);
  // Only a rise within the same plan counts — not the first load of the list
  // or switching to a plan that already holds more shops.
  const last = useRef({ id: activePlan?.id, count, loaded: plans.length > 0 });
  useEffect(() => {
    const prev = last.current;
    if (prev.loaded && prev.id === activePlan?.id && count > prev.count) setBump((n) => n + 1);
    last.current = { id: activePlan?.id, count, loaded: plans.length > 0 };
  }, [activePlan?.id, count, plans.length]);

  // A result card dragged from the search list drops here to join the plan.
  const dropProps = onDropCode && {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes('text/x-fda-code')) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e) => {
      e.preventDefault();
      setOver(false);
      const code = e.dataTransfer.getData('text/x-fda-code');
      if (code) onDropCode(code);
    },
  };

  return (
    <div
      className={`plan-cart${over ? ' drop-over' : ''}`}
      role="region"
      aria-label="แผนที่กำลังทำ"
      {...dropProps}
    >
      <span className="plan-cart-icon">
        {/* A record sheet, in the cart's own colour (currentColor) so it reads
            as one piece with the pill it sits on. */}
        <svg
          className="plan-cart-sheet"
          viewBox="-1 0 30 30"
          width="22"
          height="22"
          aria-hidden="true"
        >
          <g
            transform="translate(-188 -63)"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          >
            <path d="M207,64H189V92h26V72" />
            <path d="M215,72h-8V64Z" />
            <rect width="6" height="6" transform="translate(193 77)" strokeLinecap="square" strokeMiterlimit="10" />
            <line x2="8" transform="translate(203 78)" strokeLinecap="square" strokeMiterlimit="10" />
            <line x2="8" transform="translate(203 82)" strokeLinecap="square" strokeMiterlimit="10" />
          </g>
        </svg>
        {activePlan && (
          <span
            key={bump}
            className={`plan-cart-count${bump ? ' bump' : ''}`}
            aria-label={`${count} ร้าน`}
          >
            {count}
          </span>
        )}
      </span>
      <label className="plan-cart-pick">
        <span className="planbar-lbl">แผนที่ทำ</span>
        <select
          className="plan-select"
          value={activePlan?.id || ''}
          disabled={busy}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          aria-label="เลือกแผนที่กำลังทำ"
        >
          <option value="" disabled>
            {plans.length ? 'เลือกแผน' : 'ยังไม่มีแผน'}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              แผน {p.id} · {p.date || 'ยังไม่กำหนดวันที่'} · {p.total} ร้าน
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="planbar-new" disabled={busy} onClick={onNew}>
        + แผนใหม่
      </button>
    </div>
  );
}
