/**
 * The API is served from the same origin in production, and through Vite's
 * proxy in development, so relative paths are right in both. The fallback is
 * only for opening the built page straight off disk.
 */
const BASE = location.protocol.startsWith('http') ? '' : 'http://localhost:3000';

export const apiBase = BASE;

async function get(path, options) {
  const response = await fetch(`${BASE}${path}`, options);
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || 'เรียก API ไม่สำเร็จ');
  }
  return data;
}

/** จังหวัด → อำเภอ → [ตำบล]. Static, so the browser caches it hard. */
/** Which held-back parts are switched on; all off if the call fails. */
export function fetchFeatures() {
  return get('/api/features').catch(() => ({}));
}

export function fetchAreas() {
  return get('/api/areas').then((d) => d.areas || {});
}

export function searchDrugLocations(params, signal) {
  const query = new URLSearchParams({
    keyword: params.keyword,
    province: params.province || '',
    district: params.district || '',
    subdistrict: params.subdistrict || '',
    // The detail page is fetched per row on demand (preview / form), so the
    // slow per-row scrape is not wanted here.
    withDetails: 'false',
    refresh: params.refresh ? 'true' : 'false',
  });
  return get(`/api/fda/drug-locations?${query}`, { signal });
}

export function fetchDetail(newCode) {
  return get(`/api/fda/detail?newCode=${encodeURIComponent(newCode)}`);
}
