/**
 * Offline check of the map step's pasted-point parser.
 *
 *   node test-route.js
 */
'use strict';

const assert = require('assert');

(async () => {
  const { parseLatLng, isShortMapsLink } = await import('./web/src/lib/route.js');
  assert.deepStrictEqual(parseLatLng('13.847, 100.5215'), { lat: 13.847, lng: 100.5215 });
  assert.deepStrictEqual(
    parseLatLng('https://www.google.com/maps/place/x/@13.81,100.55,17z/data=!3m1'),
    { lat: 13.81, lng: 100.55 }
  );
  // The pin (!3d!4d) wins over the viewport centre (@).
  assert.deepStrictEqual(
    parseLatLng('https://www.google.com/maps/place/x/@13.80,100.50,17z/data=!3d13.8123!4d100.5456'),
    { lat: 13.8123, lng: 100.5456 }
  );
  assert.deepStrictEqual(parseLatLng('https://maps.google.com/?q=13.7,100.6'), { lat: 13.7, lng: 100.6 });
  assert.strictEqual(parseLatLng(''), null);
  assert.strictEqual(parseLatLng('   '), null);
  assert.strictEqual(parseLatLng('https://maps.app.goo.gl/abc123'), undefined);
  assert.ok(isShortMapsLink('https://maps.app.goo.gl/abc123'));
  assert.strictEqual(parseLatLng('ร้านยา ลาดพร้าว'), undefined);
  assert.strictEqual(parseLatLng('95, 100'), undefined);
  console.log('ok — อ่านพิกัดจากข้อความ/ลิงก์ได้ถูกต้อง');
})();
