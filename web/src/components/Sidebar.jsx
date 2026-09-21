export default function Sidebar() {
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
