import { useEffect, useState } from 'react';
import { fetchDetail } from '../api.js';
import { addToPlan, createPlan, listPlans, PasscodeError, setPasscode } from '../lib/plans-api.js';
import { Button } from '@/components/ui/button';

const HANDOFF_KEY = 'fda:form:pending';

/**
 * The chosen shop, kept in view while the officer scrolls the results — and,
 * once shops are ticked, the way a whole day's plan is filled in one go.
 *
 * Handing one shop to the form needs ชื่อผู้รับอนุญาต, which lives on the
 * detail pop-up — the one blank that cannot be filled from memory — so fetch
 * it first unless the preview already did.
 */
export default function PickBar({ row, detail, checkedRows = [], onClearChecked }) {
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [message, setMessage] = useState('');

  const wanted = checkedRows.length > 0;

  useEffect(() => {
    if (!wanted) return;
    listPlans()
      .then((all) => {
        setPlans(all);
        setPlanId((current) => current || (all[0] ? all[0].id : ''));
      })
      .catch(() => setPlans([]));
  }, [wanted]);

  if (!row && !wanted) return null;

  /** One retry after the passcode is entered — the API asks for it on 401. */
  async function withPasscode(action) {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }

  /* The whole row travels, not just the code: the FDA's detail call does not
     answer the shop's name, licence number or address. */
  function payload() {
    return checkedRows.map((r) => ({
      newCode: r.newCode,
      placeName: r.placeName,
      licenseType: r.licenseType,
      licenseNo: r.licenseNo,
      address: r.address,
    }));
  }

  async function addChecked() {
    setBusy(true);
    setMessage('');
    try {
      const result = await withPasscode(() => addToPlan(planId, payload()));
      const failed = result.failed.length ? ` ข้าม ${result.failed.length} ร้าน` : '';
      setMessage(`ใส่ ${result.added.length} ร้านลงแผนแล้ว${failed}`);
      onClearChecked();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToNewPlan() {
    const date = window.prompt('วันที่ตรวจ (พ.ศ.) เช่น 2569-08-27');
    if (!date) return;
    setBusy(true);
    setMessage('');
    try {
      const rows = payload();
      const plan = await withPasscode(() => createPlan({ date }));
      setPlans((all) => [plan, ...all]);
      setPlanId(plan.id);
      const result = await withPasscode(() => addToPlan(plan.id, rows));
      setMessage(`สร้างแผน ${plan.id} และใส่ ${result.added.length} ร้านแล้ว`);
      onClearChecked();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openForm() {
    let extra = detail;
    if (!extra && row.newCode) {
      setBusy(true);
      try {
        extra = await fetchDetail(row.newCode);
      } catch {
        // The form is still usable without it; those blanks stay empty.
      } finally {
        setBusy(false);
      }
    }
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...row, ...extra }));
    window.open('/form.html', '_blank', 'noopener');
  }

  const area = (row && row.area) || {};
  const where =
    [area.subdistrict, area.district, area.province].filter(Boolean).join(' · ') ||
    (row && row.licenseNo) ||
    '';

  return (
    <div className="pickbar glass-panel">
      {wanted ? (
        <>
          <div className="who">
            <b>เลือกไว้ {checkedRows.length} ร้าน</b>
            {message && <small>{message}</small>}
          </div>
          <select
            className="plan-pick"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            aria-label="แผนการตรวจปลายทาง"
          >
            {plans.length === 0 && <option value="">ยังไม่มีแผน</option>}
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.date} · {plan.total} ร้าน
              </option>
            ))}
          </select>
          <Button variant="outline" disabled={busy} onClick={addToNewPlan}>
            แผนใหม่
          </Button>
          <Button size="lg" disabled={busy || !planId} onClick={addChecked}>
            {busy ? 'กำลังใส่...' : 'ใส่ในแผน'}
          </Button>
        </>
      ) : (
        <>
          <div className="who">
            <b>{row.placeName || '(ไม่ระบุชื่อสถานที่)'}</b>
            <small>{where}</small>
          </div>
          <Button size="lg" className="ml-auto" disabled={busy} onClick={openForm}>
            {busy ? 'กำลังดึงรายละเอียด...' : 'กรอกฟอร์มการตรวจ'}
          </Button>
        </>
      )}
    </div>
  );
}
