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
  if (error) return <div className="error" role="alert" aria-live="polite">{error}</div>;
  if (!plan) return <div className="empty" role="status" aria-live="polite">กำลังโหลด…</div>;
  if (!plan.items.length) return <div className="empty">ยังไม่มีร้านในแผนนี้</div>;

  return (
    <ol className="inspect-list">
      {plan.items.map((item) => {
        // ponytail: "filled" = the record page marked the item done. A record
        // that was started but not completed still reads as ยังไม่กรอก; opening
        // it shows the saved draft either way, so no extra lookup is needed.
        const done = item.status === 'done';
        return (
          <li key={item.newCode}>
            <div className="inspect-name">
              <span className="inspect-num">{item.order}</span>
              <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
              <span className={`inspect-status${done ? ' is-done' : ''}`}>
                {done ? 'กรอกแล้ว' : 'ยังไม่กรอก'}
              </span>
            </div>
            <a
              className={`btn btn-sm${done ? ' btn-outline' : ''}`}
              href={`#/plans/${plan.id}/${encodeURIComponent(item.newCode)}`}
            >
              {done ? 'ดูฟอร์ม' : 'กรอกฟอร์ม'}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
