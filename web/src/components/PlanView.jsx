import { useCallback, useEffect, useState } from 'react';
import PlanTable from './PlanTable.jsx';
import {
  deletePlan,
  downloadExport,
  getPlan,
  PasscodeError,
  patchPlanItem,
  removePlanItem,
  reorderPlan,
  setPasscode,
  syncPlanItem,
  updatePlan,
} from '../lib/plans-api.js';
import { orderForTrip } from '../lib/route.js';

// Plan dates are stored in the Buddhist calendar (พ.ศ.) — the form the office's
// record prints. The native <input type="date"> works in the Gregorian
// calendar, so convert on the way in and out.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function toInput(be) {
  const m = DATE.exec(be || '');
  return m ? `${Number(m[1]) - 543}-${m[2]}-${m[3]}` : '';
}
function toStored(ce) {
  const m = DATE.exec(ce || '');
  return m ? `${Number(m[1]) + 543}-${m[2]}-${m[3]}` : '';
}

export default function PlanView({ planId, onPlansChanged }) {
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

  useEffect(() => {
    if (!planId) {
      setPlan(null);
      return;
    }
    open(planId);
  }, [planId]);

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
      onPlansChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function saveDate(value) {
    // `value` is the picker's Gregorian yyyy-mm-dd, or '' when cleared.
    mutate(() => updatePlan(plan.id, { date: toStored(value) }));
  }

  async function removePlan(id) {
    if (!window.confirm('ลบแผนนี้ทั้งแผน?')) return;
    try {
      await withPasscode(() => deletePlan(id));
      setPlan(null);
      onPlansChanged?.();
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
      <div className="plan-main">
        {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
        {!plan ? (
          <div className="empty">เลือกแผนจากแถบด้านบน หรือกด + แผนใหม่</div>
        ) : (
          <>
            <div className="plan-head">
              <div className="plan-head-info">
                <h1>แผน {plan.id}</h1>
                <label className="plan-date">
                  วันที่ตรวจ
                  <input
                    type="date"
                    name="planDate"
                    autoComplete="off"
                    value={toInput(plan.date)}
                    disabled={busy}
                    onChange={(event) => saveDate(event.target.value)}
                  />
                  {plan.date && <span className="plan-date-be">พ.ศ. {plan.date}</span>}
                </label>
              </div>
              <div className="plan-head-actions">
                {/* Export the plan as the office's Word / PDF record —
                    separate buttons, not one boxed pair. */}
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
            </div>
            <PlanTable
              plan={plan}
              onRemove={(item) =>
                window.confirm(`เอา "${item.placeName || 'ร้านนี้'}" ออกจากแผน?`) &&
                mutate(() => removePlanItem(plan.id, item.newCode))
              }
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
