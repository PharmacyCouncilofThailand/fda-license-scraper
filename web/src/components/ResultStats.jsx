/**
 * A small dashboard over the current results: how many shops per licence
 * status and per licence type, as bars. Each bar is a button that narrows the
 * list to that value (client-side — the rows are already here); tapping it
 * again lets go.
 */
function countBy(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] || '-';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function BarGroup({ title, entries, active, onPick, tone }) {
  const max = entries[0]?.[1] || 1;
  return (
    <div className="stats-group">
      <div className="stats-title">{title}</div>
      {entries.map(([value, count]) => (
        <button
          key={value}
          type="button"
          className={`stats-bar${active === value ? ' on' : ''}${active && active !== value ? ' dim' : ''}`}
          aria-pressed={active === value}
          onClick={() => onPick(active === value ? null : value)}
        >
          <span className="stats-label" title={value}>{value}</span>
          <span className="stats-track">
            <span
              className={`stats-fill ${tone ? tone(value) : ''}`}
              style={{ width: `${(count / max) * 100}%` }}
            />
          </span>
          <span className="stats-count">{count}</span>
        </button>
      ))}
    </div>
  );
}

// ponytail: top 6 licence types only; a "more" toggle if officers ask for the tail.
const TOP = 6;

export default function ResultStats({ rows, shown, filter, onFilter }) {
  if (rows.length < 2) return null;
  return (
    <div className="stats glass-panel">
      <BarGroup
        title="สถานะใบอนุญาต"
        entries={countBy(rows, 'status')}
        active={filter.status}
        onPick={(status) => onFilter((f) => ({ ...f, status }))}
        tone={(v) => (v === 'คงอยู่' ? 'ok' : 'bad')}
      />
      <BarGroup
        title="ประเภทใบอนุญาต"
        entries={countBy(rows, 'licenseType').slice(0, TOP)}
        active={filter.licenseType}
        onPick={(licenseType) => onFilter((f) => ({ ...f, licenseType }))}
      />
      {(filter.status || filter.licenseType) && (
        <div className="stats-shown">
          แสดง <strong>{shown}</strong> จาก {rows.length} ร้าน{' '}
          <button type="button" className="link-btn" onClick={() => onFilter({})}>
            ล้างตัวกรอง
          </button>
        </div>
      )}
    </div>
  );
}
