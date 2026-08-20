/** Plain text for one shop — what the officer pastes into a report. */
export function rowAsText(row) {
  return [
    row.placeName,
    `เลขที่ใบอนุญาต: ${row.licenseNo} (${row.licenseType})`,
    `สถานะ: ${row.status}`,
    row.licenseeName ? `ผู้รับอนุญาต: ${row.licenseeName}` : '',
    row.operatorName ? `ผู้ดำเนินกิจการ: ${row.operatorName}` : '',
    `ที่อยู่: ${row.address}`,
    row.lat != null ? `พิกัด: ${row.lat}, ${row.lng}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Tab-separated, so it pastes straight into Excel or Google Sheets. */
export function resultsAsTable(rows) {
  const header = ['ชื่อสถานที่', 'เลขที่ใบอนุญาต', 'ประเภท', 'สถานะ', 'ที่อยู่'];
  const lines = rows.map((r) =>
    [r.placeName, r.licenseNo, r.licenseType, r.status, r.address].join('\t')
  );
  return [header.join('\t'), ...lines].join('\n');
}

export function formatAge(seconds) {
  if (!seconds || seconds < 60) return 'เมื่อสักครู่';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  return `${Math.round(minutes / 60)} ชั่วโมงที่แล้ว`;
}

/** The clipboard API needs a secure context; fall back to a hidden field. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
}
