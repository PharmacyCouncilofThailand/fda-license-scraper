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

/**
 * A 401 means one of two things. With the office passcode it is a prompt and
 * a retry; behind the Council's sign-in gateway (AUTH_MODE=header) there is no
 * passcode to type, so the server's own sentence is shown instead.
 */
export async function refuseIfUnauthorized(response) {
  if (response.status !== 401) return;
  const data = await response.clone().json().catch(() => ({}));
  if (data.code === 'SIGN_IN') {
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบผ่านระบบของสภาเภสัชกรรมก่อน');
  }
  clearPasscode();
  throw new PasscodeError();
}

/** The server's Thai message from a failed response, whichever key carries it. */
export async function failure(response, fallback = 'ระบบตอบกลับผิดปกติ') {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error || data.message || `${fallback} (HTTP ${response.status})`);
}

/* Revoking the object URL straight after click() can cancel the download in
   Safari/iPadOS, so the link is put in the page and the URL kept 10 s. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
  await refuseIfUnauthorized(response);
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
export const reorderPlan = (id, newCodes) =>
  call(`/${id}/order`, { method: 'PUT', body: { newCodes } }).then((d) => d.plan);
export const syncPlanItem = (id, newCode) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}/sync`, { method: 'POST' }).then(
    (d) => d.plan
  );

/** The one place the passcode becomes a header. The documents, drive and
    stats clients need the same one, and two readers of one key would drift. */
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
  await refuseIfUnauthorized(response);
  if (!response.ok) throw await failure(response, 'ส่งออกไม่สำเร็จ');
  saveBlob(await response.blob(), `plan-${id}.${kind}`);
}

// Several calls can hit the 401 together (a page loading a plan and its
// records at once); they share one prompt instead of asking twice.
let asking = null;

/** Run a passcode-guarded call; on 401 ask for the office passcode once and retry. */
export async function withPasscode(action) {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof PasscodeError)) throw err;
    if (!asking) {
      asking = Promise.resolve().then(() => window.prompt('ใส่รหัสผ่านของสำนักงาน'));
      asking.finally(() => setTimeout(() => { asking = null; }, 0));
    }
    const entered = await asking;
    if (!entered) throw err;
    setPasscode(entered);
    return action();
  }
}
