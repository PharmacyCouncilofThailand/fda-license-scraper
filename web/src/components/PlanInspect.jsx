import { useEffect, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';

/**
 * Step 3: the day's shops in trip order. Tapping one opens its on-site record
 * (the existing RecordForm, at #/plans/<id>/<code>). The plan's own order is
 * used as-is — reorder it in step 2 first if needed.
 */
export default function PlanInspect({ planId }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!planId) { setPlan(null); return; }
    let live = true;
    getPlan(planId)
      .then((p) => live && setPlan(p))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, [planId]);

  if (!planId) return <div className="empty">เลือกแผนจากแถบด้านบนก่อน</div>;
  if (error) return <div className="error">{error}</div>;
  if (!plan) return <div className="empty">กำลังโหลด…</div>;
  if (!plan.items.length) return <div className="empty">ยังไม่มีร้านในแผนนี้</div>;

  return (
    <ol className="inspect-list">
      {plan.items.map((item) => (
        <li key={item.newCode} className={item.status === 'done' ? 'done' : undefined}>
          <div className="inspect-name">
            <span className="inspect-num">{item.order}</span>
            <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
          </div>
          <a
            className="btn btn-sm"
            href={`#/plans/${plan.id}/${encodeURIComponent(item.newCode)}`}
          >
            กรอกฟอร์ม
          </a>
        </li>
      ))}
    </ol>
  );
}
