/** 13.789833 -> 13°47'23.4"N, the notation the office's own plans use. */
function degrees(value, positive, negative) {
  if (value == null) return '';
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  // Round to the displayed precision before checking for a rollover — .toFixed(1)
  // rounding "60.0" into view after the fact is what let 47'60.0" out the door.
  let s = Math.round(((abs - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${value >= 0 ? positive : negative}`;
}

/* Several pharmacists on one licence usually share a shift. When they do not,
   item 2 of the record has to be filled per person — the same warning the
   shop's detail panel carries. */
function hoursDiffer(pharmacists) {
  const hours = new Set(
    (pharmacists || []).map((p) => (p.openHours || '').replace(/\s+/g, ' ').trim())
  );
  return (pharmacists || []).length > 1 && hours.size > 1;
}

function Pharmacists({ item, onPickLicence, onTypeLicence }) {
  const people = item.pharmacists || [];
  if (people.length === 0) return <span className="empty">ไม่ระบุ</span>;
  const differ = hoursDiffer(people);
  return (
    <>
      {differ && <div className="hours-differ">เภสัชกรมีเวลาปฏิบัติการต่างกัน</div>}
      {people.map((person, index) => (
        <div className="person" key={`${index}-${person.name}`}>
          <div>{people.length > 1 ? `คนที่ ${index + 1} : ${person.name}` : person.name}</div>
          <div className={differ ? 'hours differ' : 'hours'}>{person.openHours || 'ไม่ระบุ'}</div>
          {person.licenceNo ? (
            <div className="licence">ภ. {person.licenceNo}</div>
          ) : person.licenceSource === 'ambiguous' ? (
            <select
              className="licence-pick"
              defaultValue=""
              onChange={(event) => onPickLicence(item, index, event.target.value)}
              aria-label={`เลือกเลข ภ. ของ ${person.name}`}
            >
              <option value="">เลือกเลข ภ. ({(person.candidates || []).length} คน)</option>
              {(person.candidates || []).map((choice) => (
                <option key={choice.licenceNo} value={choice.licenceNo}>
                  ภ. {choice.licenceNo} · {choice.fullName} · {choice.status}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              className="licence-missing"
              onClick={() => onTypeLicence(item, index)}
            >
              ไม่พบเลข ภ. — กรอกเอง
            </button>
          )}
        </div>
      ))}
    </>
  );
}

export default function PlanTable({
  plan,
  onRemove,
  onPickLicence,
  onTypeLicence,
}) {
  if (plan.items.length === 0) {
    return (
      <div className="empty">
        ยังไม่มีร้านในแผนนี้ — เลือกร้านจากหน้าค้นหาแล้วกด &quot;ใส่ในแผน&quot;
      </div>
    );
  }
  return (
    <div className="plan-table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th>ลำดับที่</th>
            <th>ชื่อสถานที่</th>
            <th>ประเภทใบอนุญาต</th>
            <th>สถานที่ตั้ง</th>
            <th>ผู้รับอนุญาต</th>
            <th>ผู้มีหน้าที่ปฏิบัติการ</th>
            <th>การทำงาน</th>
          </tr>
        </thead>
        <tbody>
          {plan.items.map((item) => (
            <tr key={item.newCode} className={item.status === 'done' ? 'done' : undefined}>
              <td className="num" data-label="ลำดับที่">{item.order}</td>
              <td data-label="ชื่อสถานที่">
                <b>{item.placeName}</b>
                {item.openHours && <div>เวลาทำการ {item.openHours}</div>}
                {item.lat != null && item.lng != null && (
                  <div className="coords">
                    {degrees(item.lat, 'N', 'S')} {degrees(item.lng, 'E', 'W')}
                  </div>
                )}
              </td>
              <td data-label="ประเภทใบอนุญาต">
                <div>{item.licenseType}</div>
                <div>{item.licenseNo}</div>
              </td>
              <td data-label="สถานที่ตั้ง">{item.address}</td>
              <td data-label="ผู้รับอนุญาต">{item.licenseeName}</td>
              <td data-label="ผู้มีหน้าที่ปฏิบัติการ">
                <Pharmacists
                  item={item}
                  onPickLicence={onPickLicence}
                  onTypeLicence={onTypeLicence}
                />
              </td>
              {/* "กรอกฟอร์ม" (opens the on-site record wizard) is hidden for now
                  — restore the button here when the inspection flow is back. */}
              <td className="actions" data-label="การทำงาน">
                <button type="button" className="link danger" onClick={() => onRemove(item)}>
                  เอาออก
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
