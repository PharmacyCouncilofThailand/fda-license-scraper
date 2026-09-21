import { useEffect, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';
import { googleMapsEmbedUrl, googleMapsUrl, orderForTrip } from '../lib/route.js';

/**
 * The map step: the plan's shops in trip order, with a button that opens the
 * whole route in Google Maps (from the Pharmacy Council through each stop).
 * No in-app map — the officer drives it in their phone's maps app.
 */
export default function PlanRoute({ planId }) {
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

  const ordered = orderForTrip(plan.items);
  const url = googleMapsUrl(ordered);
  const embed = googleMapsEmbedUrl(ordered);

  return (
    <div className="plan-route">
      <div className="plan-route-bar">
        <b>เส้นทางออกตรวจ · แผน {plan.id}</b>
        {url && (
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
            เปิดเส้นทางใน Google Maps
          </a>
        )}
      </div>
      {embed && (
        <iframe
          className="route-map"
          src={embed}
          title={`แผนที่เส้นทางออกตรวจ แผน ${plan.id}`}
          loading="lazy"
        />
      )}
      <ol className="route-list">
        <li className="route-origin">
          <span className="route-pin">เริ่ม</span>
          สภาเภสัชกรรม
        </li>
        {ordered.map((item, i) => (
          <li key={item.newCode}>
            <span className="route-pin">{i + 1}</span>
            <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
            {item.lat == null || item.lng == null ? (
              <span className="route-note">ไม่มีพิกัด — ใช้ชื่อ/ที่อยู่ค้นแทน</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
