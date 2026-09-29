import { useCallback, useEffect, useRef, useState } from 'react';
import PhotoGrid from './PhotoGrid.jsx';
import DocumentList from './DocumentList.jsx';
import RecordStep from './RecordStep.jsx';
import SignaturePad from './SignaturePad.jsx';
import { STEPS } from '../lib/form-fields.js';
import { getPlan, patchPlanItem, PasscodeError, setPasscode } from '../lib/plans-api.js';
import {
  downloadRecordExport,
  getRecord,
  putRecord,
  StaleRecordError,
} from '../lib/records-api.js';

/** True when two drafts hold the same content — only the version marker
    (and maybe photos, which travel their own route) differs. Used to tell a
    real conflict from the officer's own photo action bumping `updatedAt`
    out from under their in-flight autosave. */
function sameDraftContent(a, b) {
  return (
    JSON.stringify(a.values || {}) === JSON.stringify(b.values || {}) &&
    JSON.stringify(a.checks || {}) === JSON.stringify(b.checks || {}) &&
    JSON.stringify(a.signatures || {}) === JSON.stringify(b.signatures || {}) &&
    String(a.officerName || '') === String(b.officerName || '')
  );
}

/**
 * One shop's record, filled at the shop.
 *
 * The draft is the server's; this screen holds the copy being typed into and
 * pushes it a second after the last keystroke. What it must never do is throw
 * away what the officer typed because a request failed — they are standing in
 * a pharmacy and cannot type it again.
 */
export default function RecordForm({ planId, newCode }) {
  const [record, setRecord] = useState(null);
  const [plan, setPlan] = useState(null);
  const [step, setStep] = useState(1);
  const [save, setSave] = useState('idle'); // idle | saving | saved | failed
  const [error, setError] = useState('');

  const withPasscode = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [loadedPlan, loadedRecord] = await Promise.all([
          withPasscode(() => getPlan(planId)),
          withPasscode(() => getRecord(planId, newCode)),
        ]);
        if (!alive) return;
        setPlan(loadedPlan);
        setRecord(loadedRecord);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [planId, newCode, withPasscode]);

  // The draft as it is right now, for the timer to send without re-arming on
  // every keystroke.
  const pending = useRef(null);
  pending.current = record;

  // Nothing is written until a person changes something: opening a shop to
  // read it must not create a record for it.
  const dirty = useRef(false);

  // At most one PUT in flight at a time. If the draft changes again while one
  // is outstanding, that is remembered here and flushed once the in-flight
  // one lands — rather than firing a second, overlapping PUT that can race
  // the first and cause a self-inflicted 409.
  const inFlight = useRef(false);
  const again = useRef(false);
  // The promise chain for whatever is currently in flight (including any
  // follow-up queued via `again`). A caller that must know the draft is
  // actually persisted (export) awaits this instead of the instant resolve
  // an early `return` would give it.
  const inFlightPromise = useRef(null);

  const runFlush = useCallback(() => {
    const draft = pending.current;
    if (!draft) return Promise.resolve(true);
    inFlight.current = true;
    setSave('saving');
    return (async () => {
      try {
        const saved = await withPasscode(() => putRecord(planId, newCode, draft));
        dirty.current = false;
        // Only the version marker is taken from the answer: the officer may
        // have typed more while it was in flight, and their keystrokes win.
        // Patch pending.current directly too: a queued follow-up flush (below)
        // runs synchronously, before React commits this setRecord — reading
        // the version back out of state would still see the old one and
        // manufacture a 409 against ourselves.
        pending.current = { ...pending.current, updatedAt: saved.updatedAt, createdAt: saved.createdAt };
        setRecord((current) => ({ ...current, updatedAt: saved.updatedAt, createdAt: saved.createdAt }));
        setSave('saved');
        return true;
      } catch (err) {
        if (err instanceof StaleRecordError && sameDraftContent(draft, err.current)) {
          // Nothing but the version marker (and maybe photos) changed — that's
          // this officer's own photo action bumping `updatedAt`, not someone
          // else's edit. Adopt the fresh marker and let the queued retry
          // below resend transparently, instead of scaring them with "someone
          // else already saved this".
          pending.current = {
            ...pending.current,
            updatedAt: err.current.updatedAt,
            createdAt: err.current.createdAt,
          };
          setRecord((current) => ({
            ...current,
            updatedAt: err.current.updatedAt,
            createdAt: err.current.createdAt,
          }));
          again.current = true;
          return true;
        }
        setSave('failed');
        setError(
          err instanceof StaleRecordError
            ? 'มีคนอื่นบันทึกร้านนี้ไปแล้ว — กด "โหลดของล่าสุด" เพื่อดูของเขา หรือ "บันทึกทับ" เพื่อใช้ของคุณ'
            : err.message
        );
        return false;
      } finally {
        inFlight.current = false;
      }
    })().then((ok) => {
      if (again.current) {
        again.current = false;
        const next = runFlush();
        inFlightPromise.current = next;
        return next;
      }
      return ok;
    });
  }, [planId, newCode, withPasscode]);

  // Fire-and-forget for autosave/the header button; returns a promise a
  // caller (export) can await to know the draft actually landed, including
  // waiting out an in-flight save's queued follow-up rather than resolving
  // the instant it finds one already running.
  const flush = useCallback(() => {
    if (inFlight.current) {
      again.current = true;
      return inFlightPromise.current;
    }
    const run = runFlush();
    inFlightPromise.current = run;
    return run;
  }, [runFlush]);

  // Autosave a second after the typing stops. Nothing is ever dropped from the
  // screen when a save fails — the officer is at the shop and cannot retype it.
  useEffect(() => {
    if (!record || !dirty.current || save === 'saving') return undefined;
    const timer = setTimeout(flush, 1000);
    return () => clearTimeout(timer);
  }, [record, flush, save]);

  useEffect(() => {
    const warn = (event) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  function change(name, value) {
    dirty.current = true;
    setSave('idle');
    setRecord((current) => ({ ...current, values: { ...current.values, [name]: value } }));
  }

  function check(group, name, on) {
    dirty.current = true;
    setSave('idle');
    setRecord((current) => {
      const checks = { ...current.checks };
      // "At most one" is enforced here rather than left to the officer's
      // thumb: on paper both boxes can end up ticked, and they do.
      if (group.mode === 'one') for (const option of group.options) delete checks[option.name];
      if (on) checks[name] = true;
      else delete checks[name];
      return { ...current, checks };
    });
  }

  async function reload() {
    setError('');
    try {
      setRecord(await withPasscode(() => getRecord(planId, newCode)));
      dirty.current = false;
      setSave('idle');
    } catch (err) {
      setError(err.message);
    }
  }

  /** Take the other version's marker and keep what is on screen. */
  async function overwrite() {
    setError('');
    dirty.current = true;
    setSave('idle');
    try {
      const current = await withPasscode(() => getRecord(planId, newCode));
      setRecord((mine) => ({ ...mine, updatedAt: current.updatedAt }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportFile(kind) {
    setError('');
    try {
      const ok = await flush();
      if (!ok) {
        setError('บันทึกไม่สำเร็จ — กรุณาบันทึกให้สำเร็จก่อนสร้างไฟล์');
        return;
      }
      // Thai shop names commonly contain "/" — a filesystem won't take that
      // (or other path separators) in a filename.
      const shop = (record.values.placeName || 'บันทึกการตรวจ').replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40);
      await withPasscode(() =>
        downloadRecordExport(planId, newCode, kind, `บันทึกการตรวจ ${shop}.${kind}`)
      );
      // Producing the file is the moment the inspection is written up.
      await withPasscode(() =>
        patchPlanItem(planId, newCode, { status: 'done', statusSource: 'auto' })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function nextShop() {
    const remaining = (plan?.items || []).filter(
      (item) => item.newCode !== newCode && item.status !== 'done'
    );
    if (!remaining.length) {
      window.location.hash = '#/plans';
      return;
    }
    window.location.hash = `#/plans/${planId}/${encodeURIComponent(remaining[0].newCode)}`;
  }

  if (error && !record) return <div className="error">{error}</div>;
  if (!record) return <div className="empty">กำลังโหลด...</div>;

  const saveLabel = {
    idle: 'ยังไม่ได้บันทึก',
    saving: 'กำลังบันทึก...',
    saved: 'บันทึกแล้ว',
    failed: 'บันทึกไม่สำเร็จ — แตะเพื่อลองใหม่',
  }[save];

  return (
    <div className="record-form">
      <header className="record-head">
        <a className="link" href="#/plans">
          ← แผนการตรวจ
        </a>
        <b>{record.values.placeName || newCode}</b>
        <button type="button" className={`save-state ${save}`} onClick={flush}>
          {saveLabel}
        </button>
      </header>

      {error && (
        <div className="error">
          {error}
          <button type="button" className="link" onClick={reload}>
            โหลดของล่าสุด
          </button>
          <button type="button" className="link" onClick={overwrite}>
            บันทึกทับ
          </button>
        </div>
      )}

      <nav className="record-steps">
        {STEPS.map((entry) => (
          <button
            type="button"
            key={entry.n}
            className={entry.n === step ? 'on' : undefined}
            onClick={() => setStep(entry.n)}
          >
            {entry.n}
          </button>
        ))}
        <span className="record-step-title">{STEPS[step - 1].title}</span>
      </nav>

      {step <= 4 && (
        <RecordStep
          step={step}
          values={record.values}
          checks={record.checks}
          onChange={change}
          onCheck={check}
        />
      )}
      {step === 5 && (
        <PhotoGrid
          planId={planId}
          newCode={newCode}
          record={record}
          onRecord={(next) =>
            // Every photo route (add/remove/patch) answers with the whole
            // record and has already saved it — no dirty.current, no
            // setSave: that pair means "there is a draft PUT waiting to go
            // out", and a photo edit never is one.
            setRecord((current) => ({ ...current, photos: next.photos, updatedAt: next.updatedAt }))
          }
        />
      )}
      {step === 5 && (
        <DocumentList
          planId={planId}
          newCode={newCode}
          record={record}
          // Same contract as the photo routes: already saved, only the list
          // and the version marker change.
          onRecord={(next) =>
            setRecord((current) => ({ ...current, documents: next.documents, updatedAt: next.updatedAt }))
          }
        />
      )}
      {step === 6 && (
        <div className="record-step">
          <RecordStep
            step={6}
            values={record.values}
            checks={record.checks}
            onChange={change}
            onCheck={check}
          />
          {[
            { slot: 'page1', label: 'หน้า 1 — เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต' },
            { slot: 'duty', label: 'ผู้มีหน้าที่ปฏิบัติการ / เภสัชกร' },
            { slot: 'licensee', label: 'ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต' },
            { slot: 'officer1', label: 'พนักงานเจ้าหน้าที่ คนที่ 1', needs: 'signOfficer1' },
            { slot: 'officer2', label: 'พนักงานเจ้าหน้าที่ คนที่ 2', needs: 'signOfficer2' },
            { slot: 'officer3', label: 'พนักงานเจ้าหน้าที่ คนที่ 3', needs: 'signOfficer3' },
            { slot: 'officer4', label: 'พนักงานเจ้าหน้าที่ คนที่ 4', needs: 'signOfficer4' },
            { slot: 'officer5', label: 'พนักงานเจ้าหน้าที่ คนที่ 5', needs: 'signOfficer5' },
          ]
            // An officer row with no name on it is a row nobody signs, so it
            // is not five empty boxes to scroll past.
            .filter((entry) => !entry.needs || record.values[entry.needs])
            .map((entry) => (
              <SignaturePad
                key={entry.slot}
                label={entry.label}
                value={record.signatures[entry.slot] || null}
                onChange={(dataUrl) => {
                  dirty.current = true;
                  setSave('idle');
                  setRecord((current) => {
                    const signatures = { ...current.signatures };
                    if (dataUrl) signatures[entry.slot] = dataUrl;
                    else delete signatures[entry.slot];
                    return { ...current, signatures };
                  });
                }}
              />
            ))}
          <div className="record-export">
            <button type="button" onClick={() => exportFile('pdf')}>
              สร้าง PDF
            </button>
            <button type="button" onClick={() => exportFile('docx')}>
              สร้าง Word
            </button>
            <button type="button" onClick={nextShop}>
              ร้านถัดไป →
            </button>
          </div>
        </div>
      )}

      <footer className="record-nav">
        <button type="button" disabled={step === 1} onClick={() => setStep(step - 1)}>
          ← ย้อน
        </button>
        <button type="button" disabled={step === STEPS.length} onClick={() => setStep(step + 1)}>
          ถัดไป →
        </button>
      </footer>
    </div>
  );
}
