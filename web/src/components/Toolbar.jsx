import CopyButton from './CopyButton.jsx';
import { formatAge, resultsAsTable } from '../lib/format.js';

export default function Toolbar({ data, busy, onRefresh }) {
  if (busy) {
    return (
      <div className="toolbar">กำลังค้นหาจากเว็บ อย. อาจใช้เวลา 30–60 วินาที...</div>
    );
  }
  if (!data) return null;

  const area = [data.subdistrict, data.district, data.province]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="toolbar">
      <span>
        {area ? (
          <>
            กรองด้วย "{area}" เหลือ <strong>{data.totalMatched}</strong> ร้าน (จากทั้งหมด{' '}
            {data.totalFound} รายการที่ค้นเจอ)
          </>
        ) : (
          <>
            พบ <strong>{data.totalFound}</strong> รายการ (ไม่ได้กรองที่ตั้ง)
          </>
        )}
      </span>

      {!data.results.length && <span>— ไม่มีรายการที่ตรงกับเงื่อนไข</span>}

      {data.cached && (
        <>
          <span className="badge">จากแคช · {formatAge(data.cachedAgeSeconds)}</span>
          <button type="button" className="link-btn" onClick={onRefresh}>
            ดึงข้อมูลใหม่
          </button>
        </>
      )}

      {data.results.length > 0 && (
        <CopyButton
          label={`คัดลอกทั้งหมด (${data.results.length})`}
          text={() => resultsAsTable(data.results)}
        />
      )}
    </div>
  );
}
