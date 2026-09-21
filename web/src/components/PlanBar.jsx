/**
 * The working plan, pinned to the top of every step: a dropdown switches the
 * active plan (A/B/C…) and a button starts a new one. Replaces the old
 * bottom-right cart — the plan is now always in view.
 */
export default function PlanBar({ activePlan, plans, busy, onPick, onNew }) {
  return (
    <div className="planbar">
      <span className="material-symbols-outlined">checklist</span>
      <b className="planbar-title">ระบบวางแผนออกตรวจร้านยา</b>
      <span className="planbar-spacer" />
      <label className="planbar-pick">
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
