/**
 * The working plan as a cart pinned to the bottom-right corner: a basket icon
 * carrying the shop count, a dropdown that switches the active plan (A/B/C…),
 * and a button that starts a new one. Floats over every step so the plan is
 * always to hand without taking a strip off the top of the page.
 */
export default function PlanBar({ activePlan, plans, busy, onPick, onNew }) {
  // The count is read from the live list so it stays right after shops are
  // added or removed, even if the picked object was cached with an old total.
  const count = plans.find((p) => p.id === activePlan?.id)?.total ?? 0;

  return (
    <div className="plan-cart" role="region" aria-label="แผนที่กำลังทำ">
      <span className="plan-cart-icon">
        <span className="material-symbols-outlined" aria-hidden="true">shopping_basket</span>
        {activePlan && (
          <span className="plan-cart-count" aria-label={`${count} ร้าน`}>{count}</span>
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
