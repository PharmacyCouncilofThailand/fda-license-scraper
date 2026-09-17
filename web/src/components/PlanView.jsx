import { useCallback, useEffect, useState } from 'react';
import PlanList from './PlanList.jsx';
import PlanTable from './PlanTable.jsx';
import {
  createPlan,
  deletePlan,
  downloadExport,
  getPlan,
  listPlans,
  PasscodeError,
  patchPlanItem,
  removePlanItem,
  setPasscode,
  syncPlanItem,
  updatePlan,
} from '../lib/plans-api.js';

export default function PlanView() {
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(true);

  /** One retry after the passcode is entered — the API asks for it on 401. */
  const withPasscode = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setPlans(await withPasscode(listPlans));
    } catch (err) {
      setError(err.message);
    }
  }, [withPasscode]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  async function open(id) {
    setError('');
    try {
      setPlan(await withPasscode(() => getPlan(id)));
    } catch (err) {
      setError(err.message);
    }
  }

  /** Every mutation answers with the whole plan, so the screen follows it. */
  async function mutate(action) {
    setBusy(true);
    setError('');
    try {
      const next = await withPasscode(action);
      setPlan(next);
      await refreshList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function newPlan() {
    // The plan is named by its letter; its date is set afterward with แก้ไขวันที่.
    try {
      const created = await withPasscode(() => createPlan({}));
      await refreshList();
      setPlan(created);
    } catch (err) {
      setError(err.message);
    }
  }

  function editDate() {
    const entered = window.prompt(
      'วันที่ตรวจ (พ.ศ.) เช่น 2569-08-27 — เว้นว่างเพื่อล้างวันที่',
      plan.date || ''
    );
    if (entered === null) return;
    mutate(() => updatePlan(plan.id, { date: entered.trim() }));
  }

  async function removePlan(id) {
    if (!window.confirm('ลบแผนนี้ทั้งแผน?')) return;
    try {
      await withPasscode(() => deletePlan(id));
      if (plan && plan.id === id) setPlan(null);
      await refreshList();
    } catch (err) {
      setError(err.message);
    }
  }

  function openForm(item) {
    // On-site: the touch wizard, which knows the plan and reports the shop
    // done by itself. The static record page is still there for a shop that
    // is not in any plan.
    window.location.hash = `#/plans/${plan.id}/${encodeURIComponent(item.newCode)}`;
  }

  function typeLicence(item, index) {
    const entered = window.prompt('เลข ภ.');
    if (entered === null) return;
    mutate(() =>
      patchPlanItem(plan.id, item.newCode, {
        pharmacists: [{ index, licenceNo: entered.trim() }],
      })
    );
  }

  async function exportPlan(kind) {
    setError('');
    try {
      await withPasscode(() => downloadExport(plan.id, kind));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={`plan-view${showList ? '' : ' no-list'}`}>
      {showList && (
        <PlanList
          plans={plans}
          currentId={plan ? plan.id : null}
          onPick={open}
          onCreate={newPlan}
          onDelete={removePlan}
        />
      )}
      <div className="plan-main">
        <button
          type="button"
          className="list-toggle link"
          onClick={() => setShowList((v) => !v)}
        >
          {showList ? '‹ ซ่อนรายการแผน' : '› แสดงรายการแผน'}
        </button>
        {error && <div className="error">{error}</div>}
        {!plan ? (
          <div className="empty">เลือกแผนทางซ้าย หรือสร้างแผนใหม่</div>
        ) : (
          <>
            <div className="plan-head">
              <div>
                <h1>แผน {plan.id}</h1>
                <p className="sub">
                  วันที่ {plan.date || 'ยังไม่กำหนด'}{' '}
                  <button type="button" className="link" disabled={busy} onClick={editDate}>
                    แก้ไขวันที่
                  </button>
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => exportPlan('docx')}>
                ส่งออก Word
              </button>
              <button type="button" disabled={busy} onClick={() => exportPlan('pdf')}>
                ส่งออก PDF
              </button>
              {/* SCAFFOLD (ยังไม่คำนวณจริง): the trip-ordering feature's place in
                  the UI. When it is built, this reorders plan.items for the
                  shortest route — nearest-neighbor over the haversine distance
                  between each shop's item.lat/item.lng (already on every item),
                  shops with no coordinates sinking to the end — then persists the
                  new order via patchPlanItem's `order`. Disabled until then. */}
              <button type="button" disabled title="กำลังพัฒนา — ยังไม่คำนวณระยะทางจริง">
                จัดลำดับตามเส้นทาง (เร็ว ๆ นี้)
              </button>
            </div>
            <PlanTable
              plan={plan}
              onRemove={(item) => mutate(() => removePlanItem(plan.id, item.newCode))}
              onOpenForm={openForm}
              onPickLicence={(item, index, licenceNo) =>
                licenceNo &&
                mutate(() =>
                  patchPlanItem(plan.id, item.newCode, {
                    pharmacists: [{ index, licenceNo }],
                  })
                )
              }
              onTypeLicence={typeLicence}
            />
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() =>
                mutate(async () => {
                  let next = plan;
                  for (const item of plan.items) {
                    next = await syncPlanItem(plan.id, item.newCode);
                  }
                  return next;
                })
              }
            >
              อัปเดตข้อมูลจาก อย.
            </button>
          </>
        )}
      </div>
    </div>
  );
}
