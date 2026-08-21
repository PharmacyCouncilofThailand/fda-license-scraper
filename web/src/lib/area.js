/**
 * Local filtering and facets over an assembled result set.
 *
 * These mirror the server's own normalise / areaMatches / buildFacet in
 * src/scraper.js. The duplication is deliberate: on a serverless deployment
 * every dropdown change that reaches the server may land on a cold instance
 * and pay a full scrape, so once the browser holds the complete row set it
 * filters the rows itself. Change one side, change the other.
 */

function normalise(text) {
  return String(text || '')
    .replace(/ /g, ' ')
    .replace(/จังหวัด/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function areaMatches(row, part, needle) {
  if (!needle) return true;
  const value = row.area ? row.area[part] : null;
  if (value) return normalise(value).includes(needle);
  return normalise(row.address).includes(needle);
}

function buildFacet(rows, part) {
  const counts = new Map();
  for (const row of rows) {
    const value = row.area ? row.area[part] : null;
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th')
  );
}

/**
 * The same shape the search endpoint answers with, computed from rows already
 * in hand, so the rest of the app cannot tell the two apart.
 */
export function buildView(rows, query, extra = {}) {
  const wanted = {
    province: normalise(query.province),
    district: normalise(query.district),
    subdistrict: normalise(query.subdistrict),
  };

  const byProvince = wanted.province
    ? rows.filter((r) => areaMatches(r, 'province', wanted.province))
    : rows;
  const byDistrict = wanted.district
    ? byProvince.filter((r) => areaMatches(r, 'district', wanted.district))
    : byProvince;
  const matched = wanted.subdistrict
    ? byDistrict.filter((r) => areaMatches(r, 'subdistrict', wanted.subdistrict))
    : byDistrict;

  return {
    success: true,
    keyword: query.keyword,
    province: query.province || null,
    district: query.district || null,
    subdistrict: query.subdistrict || null,
    totalFound: rows.length,
    totalMatched: matched.length,
    results: matched,
    facets: {
      provinces: buildFacet(rows, 'province'),
      districts: buildFacet(byProvince, 'district'),
      subdistricts: buildFacet(byDistrict, 'subdistrict'),
    },
    cached: false,
    ...extra,
  };
}
