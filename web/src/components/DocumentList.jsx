import { useEffect, useRef, useState } from 'react';
import { deleteDocument, documentObjectUrl, patchDocument, uploadDocument } from '../lib/records-api.js';
import { downscale } from './PhotoGrid.jsx';

/* One shop's signed paper forms, scanned or photographed after the visit.
   Evidence only — never printed into the generated PDF. Photos of paper stay
   larger than site photos so handwriting reads. */
const DOC_EDGE = 2400;
const DOC_QUALITY = 0.85;
// Vercel refuses a request body over 4.5MB before the server sees it.
const MAX_PDF_BYTES = 4 * 1024 * 1024;

function DocName({ planId, newCode, doc, index, onRecord, onError }) {
  const [text, setText] = useState(doc.name);
  const timer = useRef(null);
  useEffect(() => setText(doc.name), [doc.name]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function change(value) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        onRecord(await patchDocument(planId, newCode, doc.id, { name: value }));
      } catch (err) {
        onError(`บันทึกชื่อเอกสารไม่สำเร็จ: ${err.message}`);
      }
    }, 600);
  }

  return (
    <input
      type="text"
      placeholder={`เอกสารที่ ${index + 1}`}
      value={text}
      onChange={(event) => change(event.target.value)}
    />
  );
}

function DocPreview({ planId, newCode, doc }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (doc.type !== 'image/jpeg') return undefined;
    let revoked = false;
    let made = '';
    documentObjectUrl(planId, newCode, doc.id)
      .then((objectUrl) => {
        if (revoked) return URL.revokeObjectURL(objectUrl);
        made = objectUrl;
        setUrl(objectUrl);
        return undefined;
      })
      .catch(() => setUrl(''));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [planId, newCode, doc.id, doc.type]);
  if (doc.type === 'application/pdf') return <div className="doc-pdf">PDF</div>;
  return url ? <img src={url} alt="" /> : <div className="photo-loading">กำลังโหลด...</div>;
}

export default function DocumentList({ planId, newCode, record, onRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const documents = record.documents || [];

  async function add(event) {
    const files = [...event.target.files];
    event.target.value = '';
    setError('');
    for (const file of files) {
      setBusy(true);
      try {
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf && file.size > MAX_PDF_BYTES) {
          throw new Error(`${file.name} ใหญ่เกิน 4MB — ลองสแกนความละเอียดต่ำลง หรือถ่ายเป็นรูปแทน`);
        }
        const body = isPdf ? file : await downscale(file, DOC_EDGE, DOC_QUALITY);
        const type = isPdf ? 'application/pdf' : 'image/jpeg';
        const name = isPdf ? file.name.replace(/\.pdf$/i, '') : '';
        const { record: next } = await uploadDocument(planId, newCode, body, type, name);
        onRecord(next);
      } catch (err) {
        setError(`อัปโหลดเอกสารไม่สำเร็จ: ${err.message}`);
      } finally {
        setBusy(false);
      }
    }
  }

  async function open(doc) {
    // Opened synchronously so a popup blocker sees the tap, then pointed at
    // the blob once it arrives (the passcode can't ride a plain link).
    const win = window.open('', '_blank');
    try {
      const url = await documentObjectUrl(planId, newCode, doc.id);
      if (win) win.location.href = url;
      else window.location.href = url;
      // The new tab has loaded it by then; free the bytes.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      if (win) win.close();
      setError(err.message);
    }
  }

  async function remove(doc) {
    if (!window.confirm('ลบเอกสารนี้?')) return;
    setError('');
    try {
      onRecord(await deleteDocument(planId, newCode, doc.id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="doc-shop">
      <label className="photo-add">
        <input type="file" accept="image/*,application/pdf" multiple onChange={add} />
        <span>{busy ? 'กำลังอัปโหลด...' : '+ ถ่าย / สแกน / เลือกไฟล์ (รูป หรือ PDF)'}</span>
      </label>

      {error && <div className="error">{error}</div>}

      <div className="photo-list">
        {documents.map((doc, index) => (
          <figure className="photo-item" key={doc.id}>
            <button type="button" className="doc-open" onClick={() => open(doc)} title="เปิดดู">
              <DocPreview planId={planId} newCode={newCode} doc={doc} />
            </button>
            <DocName
              planId={planId}
              newCode={newCode}
              doc={doc}
              index={index}
              onRecord={onRecord}
              onError={setError}
            />
            <button type="button" className="link danger" onClick={() => remove(doc)}>
              ลบเอกสาร
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}
