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
      <hr />
      <span className="group-label">เมนู</span>
      <nav>
        <a href="/" aria-current="page">
          <span className="material-symbols-outlined sm fill">search</span>
          ค้นหาร้านยา
          <span className="dot" />
        </a>
        {/* The record is a static page on purpose — see web/public/form.html. */}
        <a href="/form.html">
          <span className="material-symbols-outlined sm">description</span>
          บันทึกการตรวจ
          <span className="dot" />
        </a>
      </nav>
      <hr />
      <div className="foot">
        ข้อมูลจากระบบตรวจสอบการอนุญาต อย.
        <br />
        แคชผลค้นหา 30 นาที
      </div>
    </aside>
  );
}
