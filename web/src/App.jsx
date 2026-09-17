import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAreas, fetchDetail, searchDrugLocations } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import SearchForm from './components/SearchForm.jsx';
import Toolbar from './components/Toolbar.jsx';
import ResultCard from './components/ResultCard.jsx';
import PickBar from './components/PickBar.jsx';
import PlanView from './components/PlanView.jsx';
import RecordForm from './components/RecordForm.jsx';
import Preloader from './components/Preloader.jsx';
import { SkeletonList } from './components/Skeleton.jsx';
import { addToPlan, createPlan, listPlans, PasscodeError, setPasscode } from './lib/plans-api.js';

const EMPTY_QUERY = { keyword: '', province: '', district: '', subdistrict: '' };
const HANDOFF_KEY = 'fda:form:pending';
// The "current basket": once an officer starts filing shops into a plan
// today, every further "+ ใส่แผน" tap goes to that same plan, cart-style,
// until they switch it from the bar — no re-picking a plan every time.
const ACTIVE_PLAN_KEY = 'fda:plan:active';

export default function App() {
  const [areas, setAreas] = useState({});
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedCode, setSelectedCode] = useState(null);
  // newCode -> { open, status, detail, message }
  const [previews, setPreviews] = useState({});
  // The plan an "+ ใส่แผน" tap files into, cart-style, until switched.
  const [activePlan, setActivePlan] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(ACTIVE_PLAN_KEY) || 'null');
    } catch {
      return null;
    }
  });
  // newCode -> 'idle' | 'busy' | 'added' | 'error'
  const [planStatus, setPlanStatus] = useState({});
  // newCode -> true while its "กรอกฟอร์ม" is fetching the licensee detail.
  const [formBusy, setFormBusy] = useState(() => new Set());

  const pending = useRef(null);
  // The query a search should use, so a dropdown change can re-run immediately
  // instead of waiting a render for state to settle.
  const queryRef = useRef(query);
  queryRef.current = query;

  const [booting, setBooting] = useState(true);

  // Two screens is not a router's worth of dependency; the hash is enough.
  const [route, setRoute] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    fetchAreas()
      .then(setAreas)
      .catch(() => setError('โหลดรายชื่อจังหวัดไม่สำเร็จ'))
      .finally(() => setBooting(false));
  }, []);

  const runSearch = useCallback(async ({ refresh = false } = {}) => {
    const current = queryRef.current;
    const keyword = current.keyword.trim();
    if (!keyword) return;

    // Abandon an in-flight search when a new one starts.
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;

    setBusy(true);
    setError('');
    setSelectedCode(null);
    setPlanStatus({});
    setPreviews({});
    setData(null);

    try {
      const result = await searchDrugLocations(
        { ...current, keyword, refresh },
        controller.signal
      );
      setData(result);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }, []);

  /** Changing an area filter re-runs the search, which the server answers
      from its keyword cache — the filter is applied there. */
  function changeQuery(patch, rerun = false) {
    const next = { ...queryRef.current, ...patch };
    queryRef.current = next;
    setQuery(next);
    if (!rerun || !next.keyword.trim()) return;
    runSearch();
  }

  async function togglePreview(row) {
    const key = row.newCode;
    const state = previews[key];

    if (state?.open) {
      setPreviews((p) => ({ ...p, [key]: { ...state, open: false } }));
      return;
    }
    if (state) {
      setPreviews((p) => ({ ...p, [key]: { ...state, open: true } }));
      return;
    }

    setPreviews((p) => ({ ...p, [key]: { open: true, status: 'loading' } }));
    try {
      const detail = await fetchDetail(key);
      setPreviews((p) => ({ ...p, [key]: { open: true, status: 'ready', detail } }));
    } catch (err) {
      setPreviews((p) => ({
        ...p,
        [key]: { open: true, status: 'error', message: err.message },
      }));
    }
  }

  const results = data?.results || [];

  /** One retry after the passcode is entered — the API asks for it on 401. */
  async function withPasscode(action) {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }

  /** The basket's plan: whatever was last chosen, or a fresh one made on the
      first "+ ใส่แผน" tap of the day. */
  async function ensureActivePlan() {
    if (activePlan?.id) return activePlan.id;
    // No date is asked for here — a plan is named by its letter and its date is
    // set later from the plan screen.
    const plan = await withPasscode(() => createPlan({}));
    const picked = { id: plan.id, date: plan.date };
    setActivePlan(picked);
    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(picked));
    return plan.id;
  }

  async function switchPlan() {
    let plans;
    try {
      plans = await withPasscode(listPlans);
    } catch (err) {
      setError(err.message);
      return;
    }
    const list = plans
      .map((p) => `${p.id} — ${p.date || 'ยังไม่กำหนดวันที่'} (${p.total} ร้าน)`)
      .join('\n');
    const id = window.prompt(`ใส่รหัสแผนที่จะสลับไป:\n${list}`, activePlan?.id || '');
    if (!id) return;
    const plan = plans.find((p) => p.id === id);
    if (!plan) return;
    const picked = { id: plan.id, date: plan.date };
    setActivePlan(picked);
    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(picked));
    setPlanStatus({});
  }

  /* Cart-style: one tap files this row into the working plan right away —
     no separate tick-then-confirm step. */
  async function addOneToPlan(row) {
    setPlanStatus((s) => ({ ...s, [row.newCode]: 'busy' }));
    try {
      const planId = await ensureActivePlan();
      const result = await withPasscode(() =>
        addToPlan(planId, [
          {
            newCode: row.newCode,
            placeName: row.placeName,
            licenseType: row.licenseType,
            licenseNo: row.licenseNo,
            address: row.address,
          },
        ])
      );
      setActivePlan((current) =>
        current ? { ...current, total: (current.total || 0) + result.added.length } : current
      );
      setPlanStatus((s) => ({
        ...s,
        [row.newCode]: result.added.length ? 'added' : 'error',
      }));
    } catch (err) {
      setError(err.message);
      setPlanStatus((s) => ({ ...s, [row.newCode]: 'error' }));
    }
  }

  /* Handing the whole row to the record page: the FDA's detail call does not
     answer the shop's name, licence number or address. */
  async function openFormFor(row) {
    let extra = previews[row.newCode]?.status === 'ready' ? previews[row.newCode].detail : null;
    if (!extra && row.newCode) {
      setFormBusy((s) => new Set(s).add(row.newCode));
      try {
        extra = await fetchDetail(row.newCode);
      } catch {
        // The form is still usable without it; those blanks stay empty.
      } finally {
        setFormBusy((s) => {
          const next = new Set(s);
          next.delete(row.newCode);
          return next;
        });
      }
    }
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...row, ...extra }));
    window.open('/form.html', '_blank', 'noopener');
  }

  if (booting) return <Preloader variant="screen" />;

  if (route.startsWith('#/plans')) {
    // #/plans, or #/plans/<planId>/<newCode> for one shop's record. Two
    // shapes is still not a router's worth of dependency.
    const [, , planId, encodedCode] = route.split('/');
    return (
      <>
        <Sidebar route={route} />
        <main className="app-main">
          <div className="wrap">
            {planId && encodedCode ? (
              <RecordForm planId={planId} newCode={decodeURIComponent(encodedCode)} />
            ) : (
              <PlanView />
            )}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Sidebar route={route} />
      <main className="app-main">
        <div className="wrap">
          <h1>ค้นหาร้านยา</h1>
          <p className="sub">
            ดึงข้อมูลสดจากระบบตรวจสอบการอนุญาตของ อย. แล้วกรองด้วยที่ตั้งก่อนแสดงผล
          </p>

          <SearchForm
            areas={areas}
            facets={data?.facets}
            query={query}
            busy={busy}
            onQueryChange={changeQuery}
            onSubmit={() => runSearch()}
          />

          {data?.incomplete && (
            <div className="warn">
              คำค้นนี้กว้างเกินไป ได้ข้อมูลมา {data.totalFound} รายการแล้วหยุดตามลิมิต
              ผลลัพธ์จึงยังไม่ครบทั้งหมด — ระบุชื่อร้านให้เจาะจงขึ้น
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {busy ? (
            <>
              <Preloader variant="inline" />
              <SkeletonList />
            </>
          ) : (
            <Toolbar data={data} onRefresh={() => runSearch({ refresh: true })} />
          )}

          <ul>
            {results.map((row) => (
              <ResultCard
                key={row.newCode || row.licenseNo}
                row={row}
                selected={row.newCode === selectedCode}
                onSelect={() => setSelectedCode(row.newCode)}
                previewState={previews[row.newCode]}
                onTogglePreview={() => togglePreview(row)}
                onOpenForm={() => openFormFor(row)}
                formBusy={formBusy.has(row.newCode)}
                planStatus={planStatus[row.newCode] || 'idle'}
                onAddToPlan={() => addOneToPlan(row)}
              />
            ))}
          </ul>

          <PickBar activePlan={activePlan} onSwitchPlan={switchPlan} />
        </div>
      </main>
    </>
  );
}
