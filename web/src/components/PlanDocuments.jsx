import { useEffect, useState } from 'react';
import DocumentList from './DocumentList.jsx';
import { getPlan, withPasscode } from '../lib/plans-api.js';
import { getRecord } from '../lib/records-api.js';

/**
 * The documents step: after the inspection, the signed paper forms come back
 * to the office and are scanned or photographed into the plan, shop by shop.
 * Kept out of the record form on purpose — filling in and filing away are
 * different jobs done at different times.
 */
export default function PlanDocuments({ planId }) {
  const [plan, setPlan] = useState(null);
  // newCode -> record (only `documents` and `updatedAt` are used here)
  const [records, setRecords] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!planId) { setPlan(null); return undefined; }
    let live = true;
    setError('');
    setPlan(null);
    (async () => {
      try {
        const next = await withPasscode(() => getPlan(planId));
        const pairs = await Promise.all(
          next.items.map(async (item) => [item.newCode, await getRecord(planId, item.newCode)])
        );
        if (!live) return;
        setRecords(Object.fromEntries(pairs));
        setPlan(next);
      } catch (err) {
        if (live) setError(err.message);
      }
    })();
    return () => { live = false; };
  }, [planId]);

  if (!planId) return <div className="empty">เลือกแผนจากแถบด้านล่างก่อน</div>;
  if (error) return <div className="error" role="alert" aria-live="polite">{error}</div>;
  if (!plan) return <div className="empty" role="status" aria-live="polite">กำลังโหลด…</div>;
  if (!plan.items.length) return <div className="empty">ยังไม่มีร้านในแผนนี้</div>;

  const filed = plan.items.filter((item) => records[item.newCode]?.documents?.length).length;

  return (
    <div className="plan-docs">
      <div className="plan-route-bar">
        <b>เอกสารที่ผ่านการออกตรวจ · แผน {plan.id}</b>
        <span className="doc-count">มีเอกสารแล้ว {filed} / {plan.items.length} ร้าน</span>
      </div>
      <p className="doc-hint">
        สแกนหรือถ่ายแบบบันทึกการตรวจที่ลงนามแล้ว (รูป หรือ PDF ไม่เกิน 4MB) เก็บเข้าระบบรายร้าน
      </p>
      {plan.items.map((item) => {
        const record = records[item.newCode];
        const count = record?.documents?.length || 0;
        return (
          <section className="doc-card" key={item.newCode}>
            <header>
              <span className="route-pin">{item.order}</span>
              <div>
                <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
                {item.licenseNo && <small> · {item.licenseNo}</small>}
              </div>
              <span className={count ? 'doc-badge done' : 'doc-badge'}>
                {count ? `${count} ไฟล์` : 'ยังไม่มีเอกสาร'}
              </span>
            </header>
            <DocumentList
              planId={plan.id}
              newCode={item.newCode}
              record={record}
              onRecord={(next) => setRecords((all) => ({ ...all, [item.newCode]: next }))}
            />
          </section>
        );
      })}
    </div>
  );
}
