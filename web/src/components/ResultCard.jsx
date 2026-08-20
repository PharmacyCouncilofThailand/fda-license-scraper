import CopyButton from './CopyButton.jsx';
import Preview from './Preview.jsx';
import { rowAsText } from '../lib/format.js';

function Tag({ text, extra }) {
  return <span className={`tag ${extra || ''}`.trim()}>{text || '-'}</span>;
}

export default function ResultCard({
  row,
  selected,
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
        <Tag text={row.licenseNo} />
        <Tag text={row.licenseType} />
        <Tag text={row.status} extra={row.status === 'คงอยู่' ? 'on' : 'off'} />

        <div className="actions">
          <button type="button" className="ghost" onClick={onTogglePreview}>
            {previewState?.open ? 'ซ่อน' : 'พรีวิว'}
          </button>
          <CopyButton
            label="คัดลอก"
            text={() => rowAsText(detail ? { ...row, ...detail } : row)}
          />
          {row.detailUrl && (
            <a
              className="detail"
              href={row.detailUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              เปิดแท็บใหม่ ↗
            </a>
          )}
        </div>
      </div>

      {previewState?.open && <Preview row={row} state={previewState} />}
    </li>
  );
}
