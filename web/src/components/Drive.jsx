import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { withPasscode } from '../lib/plans-api.js';
import { fileBlob, listDrive, makeFolder, removeItem, renameItem, uploadFile } from '../lib/drive-api.js';

// Vercel refuses a request body over 4.5MB before the server sees it.
const MAX_BYTES = 4 * 1024 * 1024;
// What the server answers inline; everything else downloads.
const VIEWABLE = /\.(pdf|jpe?g|png|gif|webp)$/i;

export const driveHash = (parts) =>
  `#/drive${parts.map((part) => `/${encodeURIComponent(part)}`).join('')}`;

function fileIcon(name) {
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
  if (/\.(jpe?g|png|gif|webp|heic)$/i.test(name)) return 'image';
  return 'draft';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const formatDate = (iso) =>
  new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The office drive: folders and files of any kind, with no tie to a plan.
 * `parts` is the open folder's path, taken from the hash, so the browser's
 * back button walks back up the folders.
 */
export default function Drive({ parts }) {
  const here = parts.join('/');
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);

  const load = useCallback(async () => {
    try {
      setListing(await withPasscode(() => listDrive(here)));
    } catch (err) {
      setListing(null);
      setError(err.message);
    }
  }, [here]);

  useEffect(() => {
    setListing(null);
    setError('');
    load();
  }, [load]);

  const childPath = (name) => (here ? `${here}/${name}` : name);

  async function act(action) {
    setError('');
    try {
      await withPasscode(action);
    } catch (err) {
      setError(err.message);
    }
    await load();
  }

  /* One file at a time, each reporting its own failure — one bad file does
     not stop the rest. */
  async function upload(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setError('');
    const problems = [];
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name} ใหญ่เกิน 4MB`);
        continue;
      }
      setBusy(`กำลังอัปโหลด ${index + 1}/${files.length}…`);
      try {
        await withPasscode(() => uploadFile(here, file));
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`);
      }
    }
    setBusy('');
    await load();
    setError(problems.join('\n'));
  }

  function newFolder() {
    const name = window.prompt('ชื่อโฟลเดอร์ใหม่');
    if (name?.trim()) act(() => makeFolder(here, name.trim()));
  }

  function rename(name) {
    const next = window.prompt('เปลี่ยนชื่อเป็น', name);
    if (next?.trim() && next.trim() !== name) act(() => renameItem(childPath(name), next.trim()));
  }

  function remove(name, isFolder) {
    const question = isFolder
      ? `ลบโฟลเดอร์ "${name}" และทุกอย่างที่อยู่ข้างใน?`
      : `ลบไฟล์ "${name}"?`;
    if (window.confirm(question)) act(() => removeItem(childPath(name)));
  }

  async function download(name) {
    setError('');
    try {
      const url = URL.createObjectURL(await withPasscode(() => fileBlob(childPath(name))));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(name) {
    if (!VIEWABLE.test(name)) return download(name);
    // Opened synchronously so a popup blocker sees the tap, then pointed at
    // the bytes once they arrive — same as the scanned documents.
    const win = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await withPasscode(() => fileBlob(childPath(name))));
      if (win) win.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      if (win) win.close();
      setError(err.message);
    }
    return undefined;
  }

  const dragProps = {
    onDragOver: (event) => {
      if (![...event.dataTransfer.types].includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
    },
    onDrop: (event) => {
      event.preventDefault();
      setDragging(false);
      upload(event.dataTransfer.files);
    },
  };

  const empty = listing && !listing.folders.length && !listing.files.length;

  return (
    <div className={dragging ? 'drive dragging' : 'drive'} {...dragProps}>
      <h1>ไดรฟ์</h1>
      <p className="sub">ที่เก็บไฟล์ของสำนักงาน — ลากไฟล์มาวางในหน้านี้ได้ ไม่เกิน 4MB ต่อไฟล์</p>

      <div className="drive-bar">
        <nav className="drive-crumbs" aria-label="ตำแหน่งโฟลเดอร์">
          <a href={driveHash([])}>ไดรฟ์</a>
          {parts.map((part, index) => (
            <span key={index}>
              <span aria-hidden="true"> › </span>
              {index === parts.length - 1 ? (
                <b aria-current="page">{part}</b>
              ) : (
                <a href={driveHash(parts.slice(0, index + 1))}>{part}</a>
              )}
            </span>
          ))}
        </nav>
        <div className="plan-head-actions">
          <Button variant="outline" size="lg" disabled={!listing || !!busy} onClick={newFolder}>
            <span className="material-symbols-outlined sm" aria-hidden="true">create_new_folder</span>
            โฟลเดอร์ใหม่
          </Button>
          <Button size="lg" disabled={!listing || !!busy} onClick={() => picker.current?.click()}>
            <span className="material-symbols-outlined sm" aria-hidden="true">upload</span>
            {busy || 'อัปโหลด'}
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const { files } = event.target;
              upload(files).finally(() => { event.target.value = ''; });
            }}
          />
        </div>
      </div>

      {error && (
        <div className="error drive-error" role="alert" aria-live="polite">
          {error}{' '}
          <button type="button" className="link-btn" onClick={() => load()}>
            ลองใหม่
          </button>
        </div>
      )}

      {!listing && !error && <div className="empty" role="status">กำลังโหลด…</div>}
      {empty && <div className="empty drive-empty">โฟลเดอร์นี้ว่าง — กด “อัปโหลด” หรือลากไฟล์มาวาง</div>}

      {listing && !empty && (
        <div className="plan-table-wrap">
          <table className="drive-table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th className="drive-num">ขนาด</th>
                <th className="drive-date">แก้ไขล่าสุด</th>
                <th aria-label="จัดการ" />
              </tr>
            </thead>
            <tbody>
              {listing.folders.map((folder) => (
                <tr key={`d:${folder.name}`}>
                  <td>
                    <a className="drive-name" href={driveHash([...parts, folder.name])}>
                      <span className="material-symbols-outlined sm" aria-hidden="true">folder</span>
                      {folder.name}
                    </a>
                  </td>
                  <td className="drive-num">—</td>
                  <td className="drive-date">—</td>
                  <td className="drive-actions">
                    <button type="button" className="link" onClick={() => rename(folder.name)}>เปลี่ยนชื่อ</button>
                    <button type="button" className="link danger" onClick={() => remove(folder.name, true)}>ลบ</button>
                  </td>
                </tr>
              ))}
              {listing.files.map((file) => (
                <tr key={`f:${file.name}`}>
                  <td>
                    <button type="button" className="drive-name" onClick={() => open(file.name)}>
                      <span className="material-symbols-outlined sm" aria-hidden="true">{fileIcon(file.name)}</span>
                      {file.name}
                    </button>
                  </td>
                  <td className="drive-num">{formatSize(file.size)}</td>
                  <td className="drive-date">{formatDate(file.modified)}</td>
                  <td className="drive-actions">
                    <button type="button" className="link" onClick={() => rename(file.name)}>เปลี่ยนชื่อ</button>
                    <button type="button" className="link" onClick={() => download(file.name)}>ดาวน์โหลด</button>
                    <button type="button" className="link danger" onClick={() => remove(file.name, false)}>ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
