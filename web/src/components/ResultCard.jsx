import CopyButton from './CopyButton.jsx';
import Preview from './Preview.jsx';
import { rowAsText } from '../lib/format.js';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/*
 * Licence number and type are plain labels; the status is the one thing that
 * has to read as right or wrong across a list of hundreds, so it keeps the
 * semantic green/red rather than taking the brand colour a Badge variant
 * would give it.
 */
function StatusBadge({ status }) {
  const active = status === 'คงอยู่';
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-transparent',
        active
          ? 'bg-[var(--success-bg)] text-[var(--success-fg)]'
          : 'bg-[var(--danger-bg)] text-[var(--danger-fg)]'
      )}
    >
      {status || '-'}
    </Badge>
  );
}

export default function ResultCard({
  row,
  selected,
  checked,
  onCheck,
  onSelect,
  previewState,
  onTogglePreview,
}) {
  const detail = previewState?.status === 'ready' ? previewState.detail : null;

  return (
    <li
      className={`glass-panel${selected ? ' selected' : ''}`}
      // Clicking anywhere on the card picks it — except on the controls,
      // which have their own jobs.
      onClick={(event) => {
        if (event.target.closest('button, a, input')) return;
        onSelect();
      }}
    >
      <input
        type="checkbox"
        className="pick-check"
        checked={checked}
        onChange={onCheck}
        aria-label={`เลือก ${row.placeName || 'ร้านนี้'} ใส่แผนการตรวจ`}
      />

      <div className="card-head">
        <input
          type="radio"
          name="pick"
          checked={selected}
          aria-label={`เลือก ${row.placeName || 'ร้านนี้'} เพื่อกรอกฟอร์ม`}
          onChange={onSelect}
        />
        <div className="name">{row.placeName || '(ไม่ระบุชื่อสถานที่)'}</div>
      </div>

      <div className="addr">{row.address || '-'}</div>

      <div className="meta">
        <Badge variant="outline">{row.licenseNo || '-'}</Badge>
        <Badge variant="outline">{row.licenseType || '-'}</Badge>
        <StatusBadge status={row.status} />

        <div className="actions">
          <button type="button" className="ghost" onClick={onTogglePreview}>
            {previewState?.open ? 'ซ่อน' : 'พรีวิว'}
          </button>
          {row.detailUrl && (
            <a
              className="detail"
              href={row.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              ดูข้อมูลต้นฉบับ ↗
            </a>
          )}
        </div>
      </div>

      {previewState?.open && (
        <div className="preview-reveal">
          <Preview row={row} state={previewState} />
        </div>
      )}
    </li>
  );
}
