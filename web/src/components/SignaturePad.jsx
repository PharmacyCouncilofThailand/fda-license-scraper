import { useEffect, useRef, useState } from 'react';

/* Drawn at twice the box's size so the PNG still looks like ink when the PDF
   prints it at 150pt wide. */
const SCALE = 2;

/** Crop to what was actually drawn, so a short signature is not a wide band
    of transparent pixels stretched across the rule on the paper. */
function trim(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null; // nothing drawn
  const pad = 4;
  const cut = document.createElement('canvas');
  cut.width = Math.min(width, right - left + pad * 2);
  cut.height = Math.min(height, bottom - top + pad * 2);
  cut
    .getContext('2d')
    .drawImage(canvas, Math.max(0, left - pad), Math.max(0, top - pad), cut.width, cut.height, 0, 0, cut.width, cut.height);
  return cut.toDataURL('image/png');
}

export default function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const canvas = canvasRef.current;
    const box = canvas.getBoundingClientRect();
    canvas.width = box.width * SCALE;
    canvas.height = box.height * SCALE;
    const context = canvas.getContext('2d');
    context.lineWidth = 2.5 * SCALE;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111';

    const at = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) * SCALE, (event.clientY - rect.top) * SCALE];
    };
    const down = (event) => {
      drawing.current = true;
      canvas.setPointerCapture(event.pointerId);
      const [x, y] = at(event);
      context.beginPath();
      context.moveTo(x, y);
    };
    const move = (event) => {
      if (!drawing.current) return;
      // A finger drags the page as well as the pen without this.
      event.preventDefault();
      const [x, y] = at(event);
      context.lineTo(x, y);
      context.stroke();
    };
    const up = () => {
      drawing.current = false;
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [open]);

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  function keep() {
    onChange(trim(canvasRef.current));
    setOpen(false);
  }

  return (
    <div className="signature-slot">
      <span>{label}</span>
      {value ? (
        <img className="signature-preview" src={value} alt="" />
      ) : (
        <div className="signature-empty">ยังไม่ได้เซ็น — เว้นไว้เซ็นบนกระดาษก็ได้</div>
      )}
      <div className="signature-actions">
        <button type="button" onClick={() => setOpen(true)}>
          {value ? 'เซ็นใหม่' : 'เซ็นชื่อ'}
        </button>
        {value && (
          <button type="button" className="link danger" onClick={() => onChange(null)}>
            ลบลายเซ็น
          </button>
        )}
      </div>

      {open && (
        <div className="signature-sheet">
          <b>{label}</b>
          <canvas ref={canvasRef} className="signature-canvas" />
          <div className="signature-actions">
            <button type="button" onClick={clear}>
              ล้าง
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
            <button type="button" onClick={keep}>
              ใช้ลายเซ็นนี้
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
