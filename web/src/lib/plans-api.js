/*
 * The office passcode guards /api/plans. It is asked for once and kept for the
 * tab: a shared passphrase is not a login, and storing it past the session
 * would leave it on a machine anyone in the office can open.
 */
import { apiBase } from '../api.js';

const PASSCODE_KEY = 'fda:plans:passcode';

function passcode() {
  return sessionStorage.getItem(PASSCODE_KEY) || '';
}

export function setPasscode(value) {
  sessionStorage.setItem(PASSCODE_KEY, value);
}

export function clearPasscode() {
  sessionStorage.removeItem(PASSCODE_KEY);
}

/** Thrown on 401 so the caller can ask for the passcode and retry. */
export class PasscodeError extends Error {
  constructor() {
    super('ต้องใส่รหัสผ่านของสำนักงาน');
    this.name = 'PasscodeError';
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}/api/plans${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(passcode() ? { 'x-plans-passcode': passcode() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const listPlans = () => call('').then((d) => d.plans);
export const getPlan = (id) => call(`/${id}`).then((d) => d.plan);
export const createPlan = (body) => call('', { method: 'POST', body }).then((d) => d.plan);
export const updatePlan = (id, patch) =>
  call(`/${id}`, { method: 'PATCH', body: patch }).then((d) => d.plan);
export const deletePlan = (id) => call(`/${id}`, { method: 'DELETE' }).then(() => undefined);
/* `newCodes` may carry whole search rows, not just codes: the FDA's detail
   call answers the licensee and the pharmacists but not the shop's name,
   licence number or address, which exist only on the row already on screen. */
export const addToPlan = (id, newCodes) =>
  call(`/${id}/items`, { method: 'POST', body: { newCodes } });
export const patchPlanItem = (id, newCode, patch) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}`, { method: 'PATCH', body: patch }).then(
    (d) => d.plan
  );
export const removePlanItem = (id, newCode) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}`, { method: 'DELETE' }).then((d) => d.plan);
export const syncPlanItem = (id, newCode) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}/sync`, { method: 'POST' }).then(
    (d) => d.plan
  );

/** The one place the passcode becomes a header. The record client needs the
    same one, and two readers of the same sessionStorage key would drift. */
export function passcodeHeaders(extra = {}) {
  const code = sessionStorage.getItem(PASSCODE_KEY) || '';
  return { ...extra, ...(code ? { 'x-plans-passcode': code } : {}) };
}

export const exportUrl = (id, kind) => `${apiBase}/api/plans/${id}/${kind}`;

/** The exports are POSTs behind a passcode, so a plain link cannot fetch them. */
export async function downloadExport(id, kind) {
  const response = await fetch(exportUrl(id, kind), {
    method: 'POST',
    headers: passcode() ? { 'x-plans-passcode': passcode() } : {},
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) throw new Error(`ส่งออกไม่สำเร็จ (HTTP ${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `plan-${id}.${kind}`;
  link.click();
  URL.revokeObjectURL(url);
}
