import { useCallback, useEffect, useRef, useState } from 'react';
import RecordStep from './RecordStep.jsx';
import { STEPS } from '../lib/form-fields.js';
import { getPlan, patchPlanItem, PasscodeError, setPasscode } from '../lib/plans-api.js';
import {
  downloadRecordExport,
  getRecord,
  putRecord,
  StaleRecordError,
} from '../lib/records-api.js';

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

  const flush = useCallback(async () => {
    const draft = pending.current;
    if (!draft) return;
    setSave('saving');
    try {
      const saved = await withPasscode(() => putRecord(planId, newCode, draft));
      dirty.current = false;
      // Only the version marker is taken from the answer: the officer may
      // have typed more while it was in flight, and their keystrokes win.
      setRecord((current) => ({ ...current, updatedAt: saved.updatedAt, createdAt: saved.createdAt }));
      setSave('saved');
    } catch (err) {
      setSave('failed');
      if (err instanceof StaleRecordError) {
        setError(
          'มีคนอื่นบันทึกร้านนี้ไปแล้ว — กด "โหลดของล่าสุด" เพื่อดูของเขา หรือ "บันทึกทับ" เพื่อใช้ของคุณ'
        );
      } else {
        setError(err.message);
      }
    }
  }, [planId, newCode, withPasscode]);

  // Autosave a second after the typing stops. Nothing is ever dropped from the
  // screen when a save fails — the officer is at the shop and cannot retype it.
  useEffect(() => {
    if (!record || !dirty.current || save === 'saving') return undefined;
    const timer = setTimeout(flush, 1000);
    return () => clearTimeout(timer);
  }, [record, flush, save]);

  useEffect(() => {
    const warn = (event) => {
      if (save === 'saved' || save === 'idle') return;
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
      return { ...current, checks };
    });
  }

  async function reload() {
    setError('');
    setRecord(await withPasscode(() => getRecord(planId, newCode)));
    dirty.current = false;
    setSave('idle');
  }

  /** Take the other version's marker and keep what is on screen. */
  function overwrite() {
    setError('');
    dirty.current = true;
    setSave('idle');
    withPasscode(() => getRecord(planId, newCode)).then((current) =>
      setRecord((mine) => ({ ...mine, updatedAt: current.updatedAt }))
    );
  }

  async function exportFile(kind) {
    setError('');
    try {
      await flush();
      const shop = (record.values.placeName || 'บันทึกการตรวจ').slice(0, 40);
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
    const remaining = (plan.items || []).filter(
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
      {step === 5 && <div className="empty">ภาพถ่าย — ทำในงานถัดไป</div>}
      {step === 6 && (
        <div className="record-step">
          <RecordStep
            step={6}
            values={record.values}
            checks={record.checks}
            onChange={change}
            onCheck={check}
          />
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
