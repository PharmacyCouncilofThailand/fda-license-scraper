/*
 * Order a plan's shops for the day's trip: first by when the pharmacist goes
 * on duty (earliest start first), then — among shops that open at the same time
 * — by how far the shop is from the Pharmacy Council, nearest first. A shop
 * with no on-duty time, or no coordinates, sinks to the end so the known ones
 * lead.
 */

// The trip starts from the Pharmacy Council (สภาเภสัชกรรม), at the Ministry of
// Public Health, Nonthaburi. ponytail: a real-world coordinate — verify/adjust
// against the office's own point if the distances read wrong.
export const PHARMACY_COUNCIL = { lat: 13.847, lng: 100.5215 };

/** Great-circle distance between two {lat,lng} in kilometres. */
export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The earliest on-duty start among a shop's pharmacists, in minutes since
 * midnight — or the shop's own opening time as a fallback — or null when no
 * time is known. Hours read like "09.00 - 18.00 น.", so the leading HH.MM is
 * the start.
 */
export function dutyStartMinutes(item) {
  const starts = [];
  const take = (hours) => {
    const m = /(\d{1,2})[.:](\d{2})/.exec(String(hours || ''));
    if (m) starts.push(Number(m[1]) * 60 + Number(m[2]));
  };
  for (const person of item.pharmacists || []) take(person.openHours);
  if (starts.length === 0) take(item.openHours);
  return starts.length ? Math.min(...starts) : null;
}

/** Distance from the origin to a shop, or null when the shop has no point. */
function distanceFrom(origin, item) {
  if (item.lat == null || item.lng == null) return null;
  return haversineKm(origin, { lat: item.lat, lng: item.lng });
}

/**
 * A new array of the shops in trip order. `Array.prototype.sort` is stable, so
 * shops that tie on both keys keep the order they came in.
 */
export function orderForTrip(items, origin = PHARMACY_COUNCIL) {
  const keyed = items.map((item) => ({
    item,
    t: dutyStartMinutes(item),
    d: distanceFrom(origin, item),
  }));
  // null sorts after any real value on each key, independently.
  const cmp = (a, b, key) => {
    if (a[key] == null && b[key] == null) return 0;
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return a[key] - b[key];
  };
  keyed.sort((a, b) => cmp(a, b, 't') || cmp(a, b, 'd'));
  return keyed.map((k) => k.item);
}

/**
 * A Google Maps directions link that drives from the Pharmacy Council through
 * the given shops in order. Each stop is its coordinate when known, otherwise
 * its name/address as a text query. Returns '' when there is nothing to route.
 * ponytail: Google's free directions URL caps at ~9 waypoints; a plan longer
 * than that will drop the overflow — split the plan if it ever gets that big.
 */
export function googleMapsUrl(items, origin = PHARMACY_COUNCIL) {
  const point = (it) =>
    it.lat != null && it.lng != null
      ? `${it.lat},${it.lng}`
      : (it.placeName || it.address || '').trim();
  const stops = (items || []).map(point).filter(Boolean);
  if (stops.length === 0) return '';
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: stops[stops.length - 1],
    travelmode: 'driving',
  });
  const waypoints = stops.slice(0, -1);
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}
