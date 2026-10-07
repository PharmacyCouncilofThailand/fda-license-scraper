import { apiBase } from '../api.js';
import { failure, passcodeHeaders, refuseIfUnauthorized } from './plans-api.js';

/* A shop's record now holds only the scanned paper forms filed after the
   visit (the เอกสาร step); the on-site record page was removed. */

function base(planId, newCode) {
  return `${apiBase}/api/plans/${planId}/items/${encodeURIComponent(newCode)}/record`;
}

async function call(url, options = {}) {
  const response = await fetch(url, options);
  await refuseIfUnauthorized(response);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const getRecord = (planId, newCode) =>
  call(base(planId, newCode), { headers: passcodeHeaders() }).then((d) => d.record);

/* The type (JPEG or PDF) travels as the body's Content-Type and the name rides
   the query string — it is the officer's label, not anything sensitive. */
export const uploadDocument = (planId, newCode, blob, type, name = '') =>
  call(`${base(planId, newCode)}/documents?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: passcodeHeaders({ 'Content-Type': type }),
    body: blob,
  }).then((d) => ({ id: d.id, record: d.record }));

export const patchDocument = (planId, newCode, docId, patch) =>
  call(`${base(planId, newCode)}/documents/${docId}`, {
    method: 'PATCH',
    headers: passcodeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  }).then((d) => d.record);

export const deleteDocument = (planId, newCode, docId) =>
  call(`${base(planId, newCode)}/documents/${docId}`, {
    method: 'DELETE',
    headers: passcodeHeaders(),
  }).then((d) => d.record);

/* An <img src> cannot carry the passcode header, and the passcode may not go
   in a URL — so the bytes are fetched and handed over as a blob URL, which the
   caller revokes. */
export async function documentObjectUrl(planId, newCode, docId) {
  const response = await fetch(`${base(planId, newCode)}/documents/${docId}`, {
    headers: passcodeHeaders(),
  });
  await refuseIfUnauthorized(response);
  if (!response.ok) throw await failure(response, 'โหลดเอกสารไม่สำเร็จ');
  return URL.createObjectURL(await response.blob());
}
