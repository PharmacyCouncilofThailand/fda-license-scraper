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
      <MapPanel row={row} detail={detail} />
      <CopyButton
        label="คัดลอกรายละเอียด"
        style={{ marginTop: '10px' }}
        text={() => rowAsText({ ...row, ...detail })}
      />
    </div>
  );
}
