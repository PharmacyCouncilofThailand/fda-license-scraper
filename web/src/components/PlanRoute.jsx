import { useEffect, useRef, useState } from 'react';
import { getPlan, patchPlanItem, reorderPlan, withPasscode } from '../lib/plans-api.js';
import {
  googleMapsEmbedUrl,
  googleMapsUrl,
  isShortMapsLink,
  orderForTrip,
  parseLatLng,
  tripLegs,
} from '../lib/route.js';

const fmtKm = (km) => (km == null ? null : `${km.toFixed(1)} กม.`);
const pointText = (item) => (item.lat != null && item.lng != null ? `${item.lat}, ${item.lng}` : '');

/** Inline editor for one stop's address and point. */
function StopEditor({ item, busy, onSave, onCancel }) {
  const [address, setAddress] = useState(item.address || '');
  const [point, setPoint] = useState(pointText(item));
  const [problem, setProblem] = useState('');

  function save(event) {
    event.preventDefault();
    const parsed = parseLatLng(point);
    if (parsed === undefined) {
      setProblem(
        isShortMapsLink(point)
          ? 'ลิงก์ย่อใช้ไม่ได้ — เปิดลิงก์ใน Google Maps แล้วคัดลอกพิกัด (เช่น 13.84, 100.52) มาวาง'
          : 'อ่านพิกัดไม่ได้ — ใส่แบบ 13.84, 100.52 หรือวางลิงก์ Google Maps'
      );
      return;
    }
    onSave({ address, lat: parsed ? parsed.lat : null, lng: parsed ? parsed.lng : null });
  }

  return (
    <form className="route-edit" onSubmit={save}>
      <label>
        ที่อยู่
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label>
        พิกัด หรือ ลิงก์ Google Maps (เว้นว่าง = ไม่มีพิกัด)
        <input
          type="text"
          inputMode="url"
          placeholder="13.84, 100.52"
          value={point}
          onChange={(e) => {
            setPoint(e.target.value);
            setProblem('');
          }}
        />
      </label>
      {problem && <div className="error">{problem}</div>}
      <div className="route-edit-buttons plan-head-actions">
        <button type="submit" disabled={busy}>บันทึก</button>
        <button type="button" disabled={busy} onClick={onCancel}>ยกเลิก</button>
      </div>
    </form>
  );
}

/**
 * The map step: the plan's shops in the plan's own order (the same order the
 * plan table and the Word/PDF exports carry), with the whole route opened in
 * Google Maps. The officer can fix a stop's address/point and move stops —
 * drag the handle, or ↑ ↓ — and every change is saved to the plan.
 */
export default function PlanRoute({ planId }) {
  const [plan, setPlan] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dragCode, setDragCode] = useState(null);
  const rows = useRef(new Map());
  const dragStart = useRef(null);

  function adopt(next) {
    setPlan(next);
    setItems(next.items);
  }

  useEffect(() => {
    if (!planId) { setPlan(null); return undefined; }
    let live = true;
    setError('');
    withPasscode(() => getPlan(planId))
      .then((p) => live && adopt(p))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, [planId]);

  /** Show the new order now, save it, and put the old one back if that fails. */
  async function saveOrder(next, before = items) {
    setItems(next);
    setError('');
    setBusy(true);
    try {
      adopt(await withPasscode(() => reorderPlan(plan.id, next.map((i) => i.newCode))));
    } catch (err) {
      setItems(before);
      setError(`บันทึกลำดับไม่สำเร็จ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    saveOrder(next);
  }

  async function saveLocation(item, patch) {
    setError('');
    setBusy(true);
    try {
      adopt(await withPasscode(() => patchPlanItem(plan.id, item.newCode, patch)));
      setEditing(null);
    } catch (err) {
      setError(`บันทึกที่อยู่ไม่สำเร็จ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  /* Drag by the handle with pointer events — one code path for mouse, pen
     and finger. The list reorders live under the pointer; the order is saved
     once, on release, and only if it changed. */
  function dragDown(event, code) {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = items;
    setDragCode(code);
  }

  function dragMove(event) {
    if (!dragCode) return;
    const y = event.clientY;
    const from = items.findIndex((i) => i.newCode === dragCode);
    let to = from;
    items.forEach((item, index) => {
      const el = rows.current.get(item.newCode);
      if (!el || index === from) return;
      const box = el.getBoundingClientRect();
      const mid = box.top + box.height / 2;
      if (index < from && y < mid) to = Math.min(to, index);
      if (index > from && y > mid) to = Math.max(to, index);
    });
    if (to === from) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
  }

  function dragUp() {
    if (!dragCode) return;
    setDragCode(null);
    const before = dragStart.current;
    dragStart.current = null;
    const changed = before && before.some((item, i) => item.newCode !== items[i].newCode);
    // A failed save goes back to the pre-drag order, not the dragged one.
    if (changed) saveOrder(items, before);
  }

  if (!planId) return <div className="empty">เลือกแผนจากแถบด้านบนก่อน</div>;
  if (!plan) {
    return error
      ? <div className="error" role="alert" aria-live="polite">{error}</div>
      : <div className="empty" role="status" aria-live="polite">กำลังโหลด…</div>;
  }
  if (!items.length) return <div className="empty">ยังไม่มีร้านในแผนนี้</div>;

  const url = googleMapsUrl(items);
  const embed = googleMapsEmbedUrl(items);
  const legs = tripLegs(items);
  const totalKm = legs.reduce((sum, l) => sum + (l.km ?? 0), 0);
  // A leg with no coordinates counts as 0 above, so the total is only the
  // stops we could measure — say so rather than pass it off as the whole route.
  const someMissing = legs.some((l) => l.km == null);

  return (
    <div className="plan-route">
      <div className="plan-route-bar">
        <b>เส้นทางออกตรวจ · แผน {plan.id}</b>
        <div className="plan-head-actions">
          <button
            type="button"
            disabled={busy}
            title="เรียงตามเวลาทำการก่อน แล้วระยะทางจากสภาเภสัชกรรม"
            onClick={() => saveOrder(orderForTrip(items))}
          >
            เรียงอัตโนมัติ
          </button>
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              เปิดเส้นทางใน Google Maps
            </a>
          )}
        </div>
      </div>
      {error && <div className="error" role="alert" aria-live="polite">{error}</div>}
      {embed && (
        <iframe
          className="route-map"
          src={embed}
          title={`แผนที่เส้นทางออกตรวจ แผน ${plan.id}`}
          loading="lazy"
        />
      )}
      <ol className="route-list" onPointerMove={dragMove} onPointerUp={dragUp} onPointerCancel={dragUp}>
        <li className="route-origin">
          <span className="route-pin">เริ่ม</span>
          สภาเภสัชกรรม
        </li>
        {items.map((item, i) => (
          <li
            key={item.newCode}
            ref={(el) => (el ? rows.current.set(item.newCode, el) : rows.current.delete(item.newCode))}
            className={`route-stop${dragCode === item.newCode ? ' dragging' : ''}`}
          >
            <button
              type="button"
              className="route-handle"
              aria-label={`ลากเพื่อย้าย ${item.placeName || ''}`}
              onPointerDown={(e) => dragDown(e, item.newCode)}
            >
              ⋮⋮
            </button>
            {/* The missing-coordinate case is spelled out by the route-note
                below, so the leg badge just shows a dash rather than repeating it. */}
            <span className="route-leg">{fmtKm(legs[i].km) ?? '—'}</span>
            <span className="route-pin">{i + 1}</span>
            <div className="route-body">
              <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
              {item.address && <span className="route-address">{item.address}</span>}
              {item.lat == null || item.lng == null ? (
                <span className="route-note">ไม่มีพิกัด — ใช้ชื่อ/ที่อยู่ค้นแทน</span>
              ) : null}
              {item.locationEdited && <span className="route-edited">แก้ไขที่อยู่/พิกัดแล้ว</span>}
              {editing === item.newCode && (
                <StopEditor
                  item={item}
                  busy={busy}
                  onSave={(patch) => saveLocation(item, patch)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </div>
            <div className="route-actions">
              <button type="button" disabled={busy || i === 0} aria-label="เลื่อนขึ้น" onClick={() => move(i, -1)}>↑</button>
              <button type="button" disabled={busy || i === items.length - 1} aria-label="เลื่อนลง" onClick={() => move(i, 1)}>↓</button>
              {editing !== item.newCode && (
                <button type="button" disabled={busy} onClick={() => setEditing(item.newCode)}>แก้ไข</button>
              )}
            </div>
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
