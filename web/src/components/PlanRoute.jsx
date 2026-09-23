import { useEffect, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';
import { googleMapsEmbedUrl, googleMapsUrl, orderForTrip, tripLegs } from '../lib/route.js';

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
  const legs = tripLegs(ordered);
  const totalKm = legs.reduce((sum, l) => sum + (l.km ?? 0), 0);
  // A leg with no coordinates counts as 0 above, so the total is only the
  // stops we could measure — say so rather than pass it off as the whole route.
  const someMissing = legs.some((l) => l.km == null);
  const fmtKm = (km) => (km == null ? null : `${km.toFixed(1)} กม.`);

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
            {/* The missing-coordinate case is spelled out by the route-note
                below, so the leg badge just shows a dash rather than repeating it. */}
            <span className="route-leg">{fmtKm(legs[i].km) ?? '—'}</span>
            <span className="route-pin">{i + 1}</span>
            <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
            {item.lat == null || item.lng == null ? (
              <span className="route-note">ไม่มีพิกัด — ใช้ชื่อ/ที่อยู่ค้นแทน</span>
            ) : null}
          </li>
        ))}
      </ol>
      {totalKm > 0 && (
        <div className="route-total">
          รวมระยะทางโดยประมาณ {totalKm.toFixed(1)} กม.
          {someMissing ? ' (เฉพาะจุดที่มีพิกัด)' : ''}
        </div>
      )}
    </div>
  );
}
