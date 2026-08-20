import { useState } from 'react';
import { fetchDetail } from '../api.js';

const HANDOFF_KEY = 'fda:form:pending';

/**
 * The chosen shop, kept in view while the officer scrolls the results.
 *
 * Handing it to the form needs ชื่อผู้รับอนุญาต, which lives on the detail
 * pop-up — the one blank that cannot be filled from memory — so fetch it first
 * unless the preview already did.
 */
export default function PickBar({ row, detail }) {
  const [busy, setBusy] = useState(false);
  if (!row) return null;

  const area = row.area || {};
  const where =
    [area.subdistrict, area.district, area.province].filter(Boolean).join(' · ') ||
    row.licenseNo ||
    '';

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

  return (
    <div className="pickbar glass-panel">
      <div className="who">
        <b>{row.placeName || '(ไม่ระบุชื่อสถานที่)'}</b>
        <small>{where}</small>
      </div>
      <button type="button" className="primary" disabled={busy} onClick={openForm}>
        {busy ? 'กำลังดึงรายละเอียด...' : 'กรอกฟอร์มการตรวจ'}
      </button>
    </div>
  );
}
