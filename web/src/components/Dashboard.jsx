import { useEffect, useState } from 'react';
import { apiBase } from '../api.js';
import { clearPasscode, PasscodeError, passcodeHeaders, withPasscode } from '../lib/plans-api.js';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2569-10' -> 'ต.ค. 69'; '' is a plan whose date is not set yet. */
function monthLabel(month) {
  if (!month) return 'ยังไม่กำหนดวัน';
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] || m} ${year.slice(2)}`;
}

const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);

async function fetchStats() {
  const response = await fetch(`${apiBase}/api/stats`, { headers: passcodeHeaders() });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

function Tile({ label, value, note }) {
  return (
    <div className="dash-tile">
      <span>{label}</span>
      <b>{value.toLocaleString('th-TH')}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

/* Done stacked under not-yet, one bar per month, both from the olive ramp
   (validated: CVD ΔE 28.7). The lighter step is under 3:1 on the card, so
   every bar carries its numbers as a visible label and the same figures sit
   in the table below the chart. */
function MonthChart({ rows }) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  return (
    <figure className="dash-chart">
      <figcaption>
        <b>รายเดือน</b> <small>ตามวันที่ของแผน</small>
        <span className="dash-legend">
          <span><i className="done" />ตรวจแล้ว</span>
          <span><i className="todo" />ยังไม่ตรวจ</span>
        </span>
      </figcaption>
      <div className="dash-bars" role="img" aria-label="กราฟจำนวนร้านต่อเดือน ดูตัวเลขในตารางด้านล่าง">
        {rows.map((row) => (
          <div
            className="dash-bar"
            key={row.month || 'none'}
            title={`${monthLabel(row.month)}: ตรวจแล้ว ${row.done} จาก ${row.total} ร้าน`}
          >
            <span className="dash-bar-value">{row.done}/{row.total}</span>
            <div className="dash-bar-stack" style={{ height: `${(row.total / max) * 100}%` }}>
              {row.total > row.done && <div className="todo" style={{ flexGrow: row.total - row.done }} />}
              {row.done > 0 && <div className="done" style={{ flexGrow: row.done }} />}
            </div>
            <span className="dash-bar-label">{monthLabel(row.month)}</span>
          </div>
        ))}
      </div>
      <details className="dash-table-view">
        <summary>ดูเป็นตาราง</summary>
        <table className="dash-table">
          <thead><tr><th>เดือน</th><th>ตรวจแล้ว</th><th>ทั้งหมด</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month || 'none'}>
                <td>{monthLabel(row.month)}</td><td>{row.done}</td><td>{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/**
 * How many shops have been inspected. A shop counts once its signed form is
 * scanned into the "เอกสาร" step — the app is no longer used at the shop, so
 * nothing else says the visit happened.
 */
export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    withPasscode(fetchStats).then(setStats, (err) => setError(err.message));
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!stats) return <div className="empty" role="status">กำลังโหลด…</div>;

  return (
    <div className="dash">
      <h1>ภาพรวม</h1>
      <p className="sub">ร้านนับว่าตรวจแล้วเมื่อแนบเอกสารที่ผ่านการตรวจในขั้น “เอกสาร” · ร้านที่อยู่หลายแผนนับตามจำนวนครั้ง</p>

      <div className="dash-tiles">
        <Tile label="ตรวจแล้ว" value={stats.done} note={`${percent(stats.done, stats.total)}% ของแผนทั้งหมด`} />
        <Tile label="ร้านในแผนทั้งหมด" value={stats.total} />
        <Tile label="ยังไม่ตรวจ" value={stats.remaining} />
      </div>

      {stats.total === 0 ? (
        <div className="empty drive-empty">ยังไม่มีร้านในแผน — เริ่มจากค้นหาร้านแล้วกด “+ ใส่แผน”</div>
      ) : (
        <>
          <MonthChart rows={stats.byMonth} />

          <section className="dash-areas">
            <h2>รายพื้นที่</h2>
            <div className="plan-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr><th>จังหวัด</th><th>เขต / อำเภอ</th><th>ความคืบหน้า</th><th>ตรวจแล้ว</th></tr>
                </thead>
                <tbody>
                  {stats.byArea.map((row) => (
                    <tr key={`${row.province}|${row.district}`}>
                      <td>{row.province || 'ไม่ระบุ'}</td>
                      <td>{row.district || 'ไม่ระบุ'}</td>
                      <td>
                        <span className="dash-progress" aria-hidden="true">
                          <span style={{ width: `${percent(row.done, row.total)}%` }} />
                        </span>
                      </td>
                      <td className="dash-num">
                        {row.done}/{row.total} <small>({percent(row.done, row.total)}%)</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
