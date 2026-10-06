/* The office drive (ไดรฟ์). Same office passcode as the plans. */
import { apiBase } from '../api.js';
import { passcodeHeaders, refuseIfUnauthorized } from './plans-api.js';

async function call(route, params, options = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${apiBase}/api/drive${route}?${query}`, {
    ...options,
    headers: passcodeHeaders(options.headers),
  });
  await refuseIfUnauthorized(response);
  return response;
}

async function json(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const listDrive = (path) => call('/list', { path }).then(json);

export const makeFolder = (path, name) =>
  call('/folder', { path, name }, { method: 'POST' }).then(json);

/** Resolves to the name the file was stored under (a taken name is numbered). */
export const uploadFile = (path, file) =>
  call('/file', { path, name: file.name }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
    .then(json)
    .then((d) => d.name);

export const renameItem = (path, name) =>
  call('/rename', { path }, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
    .then(json)
    .then((d) => d.name);

export const removeItem = (path) => call('', { path }, { method: 'DELETE' }).then(json);

/** The file's bytes — fetched, since the passcode cannot ride a plain link. */
export async function fileBlob(path) {
  const response = await call('/file', { path });
  if (!response.ok) await json(response);
  return response.blob();
}
