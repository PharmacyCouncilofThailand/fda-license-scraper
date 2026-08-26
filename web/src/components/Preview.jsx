import CopyButton from './CopyButton.jsx';
import { SkeletonPreview } from './Skeleton.jsx';
import { rowAsText } from '../lib/format.js';

function ExternalLink({ href, children }) {
  return (
    <a className="detail" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Definitions({ pairs }) {
  return (
    <dl>
      {pairs.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          {value ? <dd>{value}</dd> : <dd className="empty">ไม่ระบุ</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * The FDA detail page carries the shop's coordinates in its "map" link. When
 * it has them, embed an OpenStreetMap view (no API key needed); otherwise
 * offer a Google Maps search on the address text instead.
 */
function MapPanel({ row, detail }) {
  const googleQuery =
    detail.lat != null
      ? `${detail.lat},${detail.lng}`
      : `${row.placeName} ${row.address}`;
  const googleUrl =
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(googleQuery);

  if (detail.lat == null) {
    return (
      <div className="no-map">
        ระบบ อย. ไม่ได้ระบุพิกัดของร้านนี้ —{' '}
        <ExternalLink href={googleUrl}>ค้นหาจากที่อยู่ใน Google Maps ↗</ExternalLink>
      </div>
    );
  }

  const pad = 0.004;
  const bbox = [
    detail.lng - pad,
    detail.lat - pad,
    detail.lng + pad,
    detail.lat + pad,
  ].join(',');

  return (
    <div className="map">
      <iframe
        loading="lazy"
        title={`แผนที่ ${row.placeName || ''}`.trim()}
        src={
          `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}` +
          `&layer=mapnik&marker=${detail.lat},${detail.lng}`
        }
      />
      <div className="map-bar">
        <span>
          พิกัด {detail.lat.toFixed(5)}, {detail.lng.toFixed(5)}
        </span>
        <ExternalLink href={googleUrl}>เปิดใน Google Maps ↗</ExternalLink>
        <ExternalLink
          href={`https://www.openstreetmap.org/?mlat=${detail.lat}&mlon=${detail.lng}#map=17/${detail.lat}/${detail.lng}`}
        >
          เปิดใน OpenStreetMap ↗
        </ExternalLink>
      </div>
    </div>
  );
}

/**
 * Hands a pharmacist's name to the licence lookup in the sidebar. The FDA
 * names the person but not their ภ. number, which is the one thing the
 * inspection record needs — so this saves retyping the name to find it.
 */
function FindLicenceButton({ name }) {
  return (
    <button
      type="button"
      className="find-licence"
      title={`ค้นหาเลข ภ. ของ ${name}`}
      onClick={() =>
        document.dispatchEvent(
          new CustomEvent('pharmacist-search:fill', { detail: { name } })
        )
      }
    >
      <span className="material-symbols-outlined sm">badge</span>
      ค้นหาเลข ภ.
    </button>
  );
}

/**
 * ผู้มีหน้าที่ปฏิบัติการ — the licence can name several, each with working
 * hours of their own, and item 2 of the record is filled from this list
 * rather than from the shop's opening hours. Shown in the licence's order.
 */
function PharmacistList({ pharmacists }) {
  if (!pharmacists || pharmacists.length === 0) {
    return (
      <div className="pharmacists">
        <div className="head">ผู้มีหน้าที่ปฏิบัติการ</div>
        <div className="empty">ระบบ อย. ไม่ได้ระบุผู้มีหน้าที่ปฏิบัติการของร้านนี้</div>
      </div>
    );
  }

  return (
    <div className="pharmacists">
      <div className="head">
        ผู้มีหน้าที่ปฏิบัติการ <small>[List of pharmacist or qualified person]</small>
      </div>
      {pharmacists.map((person, i) => (
        <div className="person" key={`${person.index}-${person.name}`}>
          <div className="who">
            <span>
              ลำดับที่ : {person.index || i + 1} {person.name}
            </span>
            <FindLicenceButton name={person.name} />
          </div>
          <div className="hours">
            เวลาปฏิบัติการ :{' '}
            {person.openHours || <span className="empty">ไม่ระบุ</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Preview({ row, state }) {
  if (state.status === 'loading') return <SkeletonPreview />;
  if (state.status === 'error') {
    return <div className="preview">{state.message}</div>;
  }

  const detail = state.detail;
  return (
    <div className="preview">
      <Definitions
        pairs={[
          ['ชื่อผู้รับอนุญาต', detail.licenseeName],
          ['ผู้ดำเนินกิจการ', detail.operatorName],
          ['เวลาเปิด - ปิด', detail.openHours],
          ['เลขที่ใบอนุญาต', row.licenseNo],
          ['ที่อยู่', row.address],
        ]}
      />
      <PharmacistList pharmacists={detail.pharmacists} />
      <MapPanel row={row} detail={detail} />
      <CopyButton
        label="คัดลอกรายละเอียด"
        style={{ marginTop: '10px' }}
        text={() => rowAsText({ ...row, ...detail })}
      />
    </div>
  );
}
