export default function Sidebar({ route = '#/' }) {
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
        <a href="#/" aria-current={route.startsWith('#/plans') ? undefined : 'page'}>
          <span className="material-symbols-outlined sm fill">search</span>
          ค้นหาร้านยา
          <span className="dot" />
        </a>
        <a href="#/plans" aria-current={route.startsWith('#/plans') ? 'page' : undefined}>
          <span className="material-symbols-outlined sm">checklist</span>
          แผนการตรวจ
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
