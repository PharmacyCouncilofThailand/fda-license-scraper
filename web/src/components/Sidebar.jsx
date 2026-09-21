// The wizard steps live in the sidebar menu (as the app's nav did originally),
// not a top tab strip. Each item selects a step; on the full-screen record page
// (no `step`) an item returns to the shell at that step via `onStep`.
const STEPS = [
  { n: 1, icon: 'search', label: 'ค้นหา / เลือกร้าน' },
  { n: 2, icon: 'checklist', label: 'จัดแผน / เรียงเส้นทาง' },
  { n: 3, icon: 'description', label: 'ออกตรวจ / กรอกฟอร์ม' },
];

export default function Sidebar({ step, onStep }) {
  return (
    <aside className="app-sidebar glass-panel-primary">
      <div className="brand">
        <span className="mark">
          <img src="/logo.png" alt="ตราสภาเภสัชกรรม" />
        </span>
        <span>
          <b>ตรวจร้านยา</b>
          <small>สภาเภสัชกรรม</small>
        </span>
      </div>
      <hr />
      <span className="group-label">ขั้นตอน</span>
      <nav>
        {STEPS.map((s) => (
          <button
            key={s.n}
            type="button"
            aria-current={step === s.n ? 'page' : undefined}
            onClick={() => onStep?.(s.n)}
          >
            <span className="material-symbols-outlined sm">{s.icon}</span>
            {s.label}
            <span className="dot" />
          </button>
        ))}
      </nav>
      <hr />
      {/* Carries its own heading, so no group-label here.
          Defined in web/public/pharmacist-search.js — the same element the
          record page uses, so there is one implementation of this search. */}
      <pharmacist-search />
      <hr />
      <div className="foot">
        ข้อมูลจากระบบตรวจสอบการอนุญาต อย.
        <br />
        แคชผลค้นหา 30 นาที
      </div>
    </aside>
  );
}
