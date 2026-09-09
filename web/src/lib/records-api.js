import { apiBase } from '../api.js';
import { clearPasscode, PasscodeError, passcodeHeaders } from './plans-api.js';

/** Thrown when someone else's write landed first; carries their version. */
export class StaleRecordError extends Error {
  constructor(current) {
    super('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
    this.name = 'StaleRecordError';
    this.current = current;
  }
}

function base(planId, newCode) {
  return `${apiBase}/api/plans/${planId}/items/${encodeURIComponent(newCode)}/record`;
}

async function call(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throw new StaleRecordError(body.current);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const getRecord = (planId, newCode) =>
  call(base(planId, newCode), { headers: passcodeHeaders() }).then((d) => d.record);

export const putRecord = (planId, newCode, record) =>
  call(base(planId, newCode), {
    method: 'PUT',
    headers: passcodeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(record),
  }).then((d) => d.record);

export const uploadPhoto = (planId, newCode, blob) =>
  call(`${base(planId, newCode)}/photos`, {
    method: 'POST',
    headers: passcodeHeaders({ 'Content-Type': 'image/jpeg' }),
    body: blob,
  }).then((d) => ({ id: d.id, record: d.record }));

export const deletePhoto = (planId, newCode, photoId) =>
  call(`${base(planId, newCode)}/photos/${photoId}`, {
    method: 'DELETE',
    headers: passcodeHeaders(),
  }).then((d) => d.record);

/* An <img src> cannot carry the passcode header, and the passcode may not go
   in a URL — so the bytes are fetched and handed to the page as a blob URL.
   The caller revokes it when the image goes away. */
export async function photoObjectUrl(planId, newCode, photoId) {
  const response = await fetch(`${base(planId, newCode)}/photos/${photoId}`, {
    headers: passcodeHeaders(),
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) throw new Error('โหลดรูปไม่สำเร็จ');
  return URL.createObjectURL(await response.blob());
}

/* The export routes also answer 409 — a listed photo's bytes are missing, or
   more than 20 are marked for the appendix — with no `current` field. That is
   a refusal to export, not a stale write, so it is read for its Thai message
   here rather than routed through StaleRecordError. */
export async function downloadRecordExport(planId, newCode, kind, filename) {
  const response = await fetch(`${base(planId, newCode)}/${kind}`, {
    method: 'POST',
    headers: passcodeHeaders(),
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `ส่งออกไม่สำเร็จ (HTTP ${response.status})`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
