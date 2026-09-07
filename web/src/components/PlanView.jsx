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
} from '../lib/plans-api.js';

const HANDOFF_KEY = 'fda:form:pending';

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
    const date = window.prompt('วันที่ตรวจ (พ.ศ.) เช่น 2569-08-27');
    if (!date) return;
    try {
      const created = await withPasscode(() => createPlan({ date }));
      await refreshList();
      setPlan(created);
    } catch (err) {
      setError(err.message);
    }
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
    // The record page reports back with these two, which is how ticking
    // "ตรวจแล้ว" happens by itself.
    localStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ ...item, planId: plan.id, newCode: item.newCode })
    );
    window.open('/form.html', '_blank', 'noopener');
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
    <div className="plan-view">
      <PlanList
        plans={plans}
        currentId={plan ? plan.id : null}
        onPick={open}
        onCreate={newPlan}
        onDelete={removePlan}
      />
      <div className="plan-main">
        {error && <div className="error">{error}</div>}
        {!plan ? (
          <div className="empty">เลือกแผนทางซ้าย หรือสร้างแผนใหม่</div>
        ) : (
          <>
            <div className="plan-head">
              <div>
                <h1>{plan.title}</h1>
                <p className="sub">วันที่ {plan.date}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => exportPlan('docx')}>
                ส่งออก Word
              </button>
              <button type="button" disabled={busy} onClick={() => exportPlan('pdf')}>
                ส่งออก PDF
              </button>
            </div>
            <PlanTable
              plan={plan}
              onToggleDone={(item) =>
                mutate(() =>
                  patchPlanItem(plan.id, item.newCode, {
                    status: item.status === 'done' ? 'planned' : 'done',
                  })
                )
              }
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
