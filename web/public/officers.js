/*
 * The office's own inspecting officers. Served straight off disk with no
 * bundler so that both the record page (web/public/form.html) and the React
 * app can read the same one — the record page cannot import an ES module out
 * of web/src/, and two copies of a list of real people is how one of them
 * goes stale. The same reason web/public/pharmacist-search.js is shared.
 */
window.OFFICERS = [
  'นายเทอดภูมิ พัชรสุนทรชัย',
  'นางสาวอชิดา บุญเพียร',
  'นางสาวศศิธร เจือโร่ง',
  'นายศิริพงษ์ เจือโร่ง',
  'นายณภัทร ไกยวงค์',
  'นายเจษฎา จันทรประเสริฐ',
  'นางสาวอัญพิชา แก้วสม',
];
