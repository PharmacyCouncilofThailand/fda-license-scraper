import { useCallback, useEffect, useState } from 'react';
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
  reorderPlan,
  setPasscode,
  syncPlanItem,
  updatePlan,
} from '../lib/plans-api.js';
import { orderForTrip } from '../lib/route.js';

export default function PlanView() {
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  function typeLicence(item, index) {
    const entered = window.prompt('เลข ภ.');
    if (entered === null) return;
    mutate(() =>
      patchPlanItem(plan.id, item.newCode, {
        pharmacists: [{ index, licenceNo: entered.trim() }],
      })
    );
  }

  function sortTrip() {
    const ordered = orderForTrip(plan.items).map((item) => item.newCode);
    mutate(() => reorderPlan(plan.id, ordered));
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
    <div className="plan-view">
      {/* The plan is chosen from a dropdown at the top right, not a side list. */}
      <div className="plan-bar">
        <b>แผนการตรวจ</b>
        <div className="plan-pick">
          <select
            className="plan-select"
            value={plan ? plan.id : ''}
            onChange={(event) => event.target.value && open(event.target.value)}
            aria-label="เลือกแผนการตรวจ"
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
          <button type="button" className="link" disabled={busy} onClick={newPlan}>
            + แผนใหม่
          </button>
        </div>
      </div>
      <div className="plan-main">
        {error && <div className="error">{error}</div>}
        {!plan ? (
          <div className="empty">เลือกแผนจากด้านบน หรือสร้างแผนใหม่</div>
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
              {/* Reorder the plan for the day's trip: by on-duty start time
                  first, then by distance from the Pharmacy Council (see
                  ../lib/route.js), and persist the new order so the exports
                  carry it. */}
              <button
                type="button"
                disabled={busy}
                title="เรียงตามเวลาทำการก่อน แล้วระยะทางจากสภาเภสัชกรรม"
                onClick={sortTrip}
              >
                จัดลำดับตามเวลา/เส้นทาง
              </button>
              <button
                type="button"
                className="link danger"
                disabled={busy}
                onClick={() => removePlan(plan.id)}
              >
                ลบแผน
              </button>
            </div>
            <PlanTable
              plan={plan}
              onRemove={(item) => mutate(() => removePlanItem(plan.id, item.newCode))}
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
