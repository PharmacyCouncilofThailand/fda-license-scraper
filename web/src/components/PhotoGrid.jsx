import { useEffect, useRef, useState } from 'react';
import { deletePhoto, patchPhoto, photoObjectUrl, uploadPhoto } from '../lib/records-api.js';

/* A photo from an iPad's camera is around 4MB. Nothing in the record needs
   that: the appendix prints two to a page. Down-scaling in the browser makes
   the upload quick on a phone's connection and keeps the store small. */
const MAX_EDGE = 1600;
const QUALITY = 0.8;

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  // canvas.toBlob resolves null rather than rejecting when it can't encode
  // (a zero-size canvas, an exhausted memory budget) — treated as a normal
  // upload failure, same message the officer sees for a network error.
  if (!blob) throw new Error('แปลงรูปไม่สำเร็จ');
  return blob;
}

function Thumb({ planId, newCode, photo }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let revoked = false;
    let made = '';
    photoObjectUrl(planId, newCode, photo.id)
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
  }, [planId, newCode, photo.id]);
  return url ? <img src={url} alt="" /> : <div className="photo-loading">กำลังโหลด...</div>;
}

/* The caption has its own local text state so keystrokes never wait on a
   round trip: it saves 600ms after typing stops, via patchPhoto directly —
   never through RecordForm's autosave, which has no idea photos exist. */
function Caption({ planId, newCode, photo, index, onRecord, onError }) {
  const [text, setText] = useState(photo.caption);
  const timer = useRef(null);

  // Only resyncs when the saved caption actually changes (a save landing, or
  // a reload) — not on every onRecord, which would clobber mid-typing text.
  useEffect(() => setText(photo.caption), [photo.caption]);

  function change(value) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        onRecord(await patchPhoto(planId, newCode, photo.id, { caption: value }));
      } catch (err) {
        onError(`บันทึกคำบรรยายไม่สำเร็จ: ${err.message}`);
      }
    }, 600);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="text"
      placeholder={`คำบรรยายภาพที่ ${index + 1}`}
      value={text}
      onChange={(event) => change(event.target.value)}
    />
  );
}

export default function PhotoGrid({ planId, newCode, record, onRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(event) {
    const files = [...event.target.files];
    event.target.value = '';
    setError('');
    for (const file of files) {
      setBusy(true);
      try {
        const blob = await downscale(file);
        const { record: next } = await uploadPhoto(planId, newCode, blob);
        onRecord(next);
      } catch (err) {
        setError(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      } finally {
        setBusy(false);
      }
    }
  }

  async function remove(photoId) {
    if (!window.confirm('ลบรูปนี้?')) return;
    setError('');
    try {
      onRecord(await deletePhoto(planId, newCode, photoId));
    } catch (err) {
      setError(err.message);
    }
  }

  /* The checkbox has no typing to debounce, so it saves immediately — its
     own PATCH, same as the caption, never the whole-record PUT. */
  async function toggleInPdf(photoId, on) {
    setError('');
    try {
      onRecord(await patchPhoto(planId, newCode, photoId, { inPdf: on }));
    } catch (err) {
      setError(`บันทึกไม่สำเร็จ: ${err.message}`);
    }
  }

  return (
    <div className="record-step">
      <label className="photo-add">
        {/* `capture` opens the camera straight away on iOS; without a camera
            it is an ordinary file picker, which is what a desktop needs. */}
        <input type="file" accept="image/*" capture="environment" multiple onChange={add} />
        <span>{busy ? 'กำลังอัปโหลด...' : '+ ถ่ายรูป / เลือกรูป'}</span>
      </label>

      {error && <div className="error">{error}</div>}
      {record.photos.length === 0 && <div className="empty">ยังไม่มีรูป</div>}

      <div className="photo-list">
        {record.photos.map((photo, index) => (
          <figure className="photo-item" key={photo.id}>
            <Thumb planId={planId} newCode={newCode} photo={photo} />
            <Caption
              planId={planId}
              newCode={newCode}
              photo={photo}
              index={index}
              onRecord={onRecord}
              onError={setError}
            />
            <label className="photo-inpdf">
              <input
                type="checkbox"
                checked={photo.inPdf}
                onChange={(event) => toggleInPdf(photo.id, event.target.checked)}
              />
              แนบท้าย PDF
            </label>
            <button type="button" className="link danger" onClick={() => remove(photo.id)}>
              ลบรูป
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}
