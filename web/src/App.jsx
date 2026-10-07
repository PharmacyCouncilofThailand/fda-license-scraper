import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAreas, fetchDetail, fetchFeatures, searchDrugLocations } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import SearchForm from './components/SearchForm.jsx';
import Toolbar from './components/Toolbar.jsx';
import ResultCard from './components/ResultCard.jsx';
import ResultStats from './components/ResultStats.jsx';
import PlanBar from './components/PlanBar.jsx';
import PlanView from './components/PlanView.jsx';
import PlanRoute from './components/PlanRoute.jsx';
import PlanDocuments from './components/PlanDocuments.jsx';
import Drive from './components/Drive.jsx';
import Dashboard from './components/Dashboard.jsx';
import Preloader from './components/Preloader.jsx';
import { SkeletonList } from './components/Skeleton.jsx';
import { addToPlan, createPlan, listPlans, withPasscode } from './lib/plans-api.js';

const EMPTY_QUERY = { keyword: '', province: '', district: '', subdistrict: '' };
const HANDOFF_KEY = 'fda:form:pending';
// The "current basket": once an officer starts filing shops into a plan
// today, every further "+ ใส่แผน" tap goes to that same plan, cart-style,
// until they switch it from the bar — no re-picking a plan every time.
const ACTIVE_PLAN_KEY = 'fda:plan:active';
// Wizard steps 1–5 by hash. Search is plain '#/' so old links still land there.
const STEP_HASHES = ['#/', '#/plan', '#/map', '#/form', '#/docs'];
// What the search page shows before the first search: the four steps of the
// job, so the empty page says how to start rather than nothing.
const INTRO_STEPS = [
  { n: 1, icon: 'search', title: 'ค้นหา', text: 'พิมพ์ชื่อร้าน หรือเลือกจังหวัด อำเภอ ตำบล แล้วกดค้นหา' },
  { n: 2, icon: 'checklist', title: 'จัดแผน', text: 'กด “+ ใส่แผน” หรือลากการ์ดไปวางที่แผนมุมขวาล่าง' },
  { n: 3, icon: 'map', title: 'แผนที่', text: 'ดูเส้นทางของร้านในแผน แล้วเปิดนำทางใน Google Maps' },
  { n: 4, icon: 'description', title: 'ฟอร์ม', text: 'กรอกบันทึกการตรวจ แล้วดาวน์โหลด PDF ไปพิมพ์' },
];

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
  // All plans, for the top bar's switcher dropdown.
  const [plans, setPlans] = useState([]);
  // newCode -> true while its "กรอกฟอร์ม" is fetching the licensee detail.
  const [formBusy, setFormBusy] = useState(() => new Set());
  // Client-side narrowing from the stats bars: { status, licenseType }.
  const [statsFilter, setStatsFilter] = useState({});
  // One short confirmation at a time, e.g. after a shop lands in the plan.
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  function showToast(text) {
    clearTimeout(toastTimer.current);
    setToast({ text, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

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

  // Which wizard step body is showing: 1 search, 2 plan, 3 map, 4 form. Kept
  // in the hash so the browser's back button and a reload return to the step
  // the officer was on instead of dropping them back at search.
  const step = Math.max(1, STEP_HASHES.indexOf(route) + 1);
  const setStep = (n) => {
    window.location.hash = STEP_HASHES[n - 1];
  };

  // The upload parts (เอกสาร, ภาพรวม, ไดรฟ์) are held back for a later update;
  // the server says whether they are on (FEATURE_DOCS).
  const [docsOn, setDocsOn] = useState(false);

  // The area tree feeds the province select; if it fails the select stays
  // empty, so the failure carries its own retry.
  const [areasFailed, setAreasFailed] = useState(false);
  const loadAreas = useCallback(
    () =>
      fetchAreas().then(
        (tree) => {
          setAreas(tree);
          setAreasFailed(false);
        },
        () => setAreasFailed(true)
      ),
    []
  );

  useEffect(() => {
    Promise.all([loadAreas(), fetchFeatures().then((f) => setDocsOn(Boolean(f.docs)))]).finally(
      () => setBooting(false)
    );
  }, [loadAreas]);

  // An old link or bookmark to a part that is switched off lands on search.
  const heldBack =
    !docsOn && (route === '#/docs' || route === '#/dashboard' || route.startsWith('#/drive'));
  useEffect(() => {
    if (!booting && heldBack) window.location.replace('#/');
  }, [booting, heldBack]);

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
    setStatsFilter({});
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

    // An open error is a retry (its button calls this), not a close.
    if (state?.open && state.status !== 'error') {
      setPreviews((p) => ({ ...p, [key]: { ...state, open: false } }));
      return;
    }
    // A loaded preview just reopens; a failed one is fetched again.
    if (state && state.status !== 'error') {
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
  const visible = results.filter(
    (r) =>
      (!statsFilter.status || (r.status || '-') === statsFilter.status) &&
      (!statsFilter.licenseType || (r.licenseType || '-') === statsFilter.licenseType)
  );

  const refreshPlans = useCallback(async () => {
    try {
      const list = await withPasscode(listPlans);
      setPlans(list);
      setActivePlan((cur) => {
        if (cur && !list.some((p) => p.id === cur.id)) {
          localStorage.removeItem(ACTIVE_PLAN_KEY);
          // "✓ อยู่ในแผน" described the plan that is gone.
          setPlanStatus({});
          return null;
        }
        return cur;
      });
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    refreshPlans();
  }, [refreshPlans]);

  // Old links to #/plans or to the removed on-site record page (#/plans/…)
  // land on the จัดแผน step.
  useEffect(() => {
    if (route === '#/plans' || route.startsWith('#/plans/')) {
      window.location.replace(STEP_HASHES[1]);
    }
  }, [route]);

  /** The basket's plan: whatever was last chosen, or a fresh one made on the
      first "+ ใส่แผน" tap of the day. */
  // Two quick adds before the first plan exists must share one new plan.
  const creating = useRef(null);
  async function ensureActivePlan() {
    if (activePlan?.id) return activePlan.id;
    if (!creating.current) {
      // No date is asked for here — a plan is named by its letter and its date
      // is set later from the plan screen.
      creating.current = (async () => {
        const plan = await withPasscode(() => createPlan({}));
        const picked = { id: plan.id, date: plan.date, total: 0 };
        setActivePlan(picked);
        localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(picked));
        await refreshPlans();
        return plan.id;
      })().finally(() => {
        creating.current = null;
      });
    }
    return creating.current;
  }

  function pickPlan(id) {
    const plan = plans.find((p) => p.id === id);
    if (!plan) return;
    const picked = { id: plan.id, date: plan.date, total: plan.total };
    setActivePlan(picked);
    localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(picked));
    setPlanStatus({});
  }

  async function newPlan() {
    try {
      const plan = await withPasscode(() => createPlan({}));
      const picked = { id: plan.id, date: plan.date, total: 0 };
      setActivePlan(picked);
      localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(picked));
      // The cards' "✓ อยู่ในแผน" belonged to the previous plan.
      setPlanStatus({});
      await refreshPlans();
    } catch (err) {
      setError(err.message);
    }
  }

  /* Cart-style: one tap files this row into the working plan right away —
     no separate tick-then-confirm step. */
  async function addOneToPlan(row) {
    // Keyboard and drag reach here too, past the button's disabled state.
    const current = planStatus[row.newCode];
    if (current === 'busy' || current === 'added') return;
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
      const reason = result.failed?.[0]?.message || '';
      // Already in this plan is where the officer wanted it, not a failure.
      const already = reason === 'ร้านนี้มีอยู่แล้วในแผน';
      setPlanStatus((s) => ({
        ...s,
        [row.newCode]: result.added.length || already ? 'added' : 'error',
      }));
      if (result.added.length) {
        showToast(`ใส่ "${row.placeName || row.licenseNo}" ลงแผน ${planId} แล้ว`);
      } else if (already) {
        showToast(`"${row.placeName || row.licenseNo}" อยู่ในแผน ${planId} แล้ว`);
      } else {
        setError(`ใส่ร้านลงแผนไม่สำเร็จ${reason ? `: ${reason}` : ''}`);
      }
      await refreshPlans();
    } catch (err) {
      setError(err.message);
      setPlanStatus((s) => ({ ...s, [row.newCode]: 'error' }));
    }
  }

  /* Handing the whole row to the record page: the FDA's detail call does not
     answer the shop's name, licence number or address. Each tap gets its own
     key, named in the form's URL, so two quick taps cannot swap shops. */
  async function openFormFor(row) {
    // Opened synchronously so a popup blocker sees the tap even when the
    // detail fetch below is slow, then pointed at the form once it is ready.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
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
    const handoff = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    localStorage.setItem(`${HANDOFF_KEY}:${handoff}`, JSON.stringify({ ...row, ...extra }));
    const formUrl = `/form.html?h=${handoff}`;
    if (win) win.location.href = new URL(formUrl, location.href).href;
    else window.open(formUrl, '_blank', 'noopener');
  }

  /* Keyboard on the search step: / focuses the search box, j/k or ↑/↓ walk
     the list, p previews, a files into the plan, f opens the form. One
     long-lived listener reads the latest state and handlers through a ref. */
  const keys = useRef();
  const onSearch = step === 1;
  keys.current = { onSearch, visible, selectedCode, togglePreview, addOneToPlan, openFormFor };
  useEffect(() => {
    function onKey(event) {
      const k = keys.current;
      if (!k.onSearch || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.('input, select, textarea, [contenteditable]')) {
        if (event.key === 'Escape') event.target.blur();
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        document.getElementById('search-keyword')?.focus();
        return;
      }
      if (!k.visible.length) return;
      const index = k.visible.findIndex((r) => r.newCode === k.selectedCode);
      const move = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[event.key];
      if (move) {
        event.preventDefault();
        const next = k.visible[Math.min(k.visible.length - 1, Math.max(0, index + move))];
        setSelectedCode(next.newCode);
        document
          .querySelector(`[data-code="${CSS.escape(next.newCode || '')}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      const row = k.visible[index];
      if (!row) return;
      if (event.key === 'p') k.togglePreview(row);
      else if (event.key === 'a') k.addOneToPlan(row);
      else if (event.key === 'f') k.openFormFor(row);
      else if (event.key === 'Escape') setSelectedCode(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* A result card dropped on the plan cart files it, same as "+ ใส่แผน". */
  function dropOnPlan(code) {
    const row = results.find((r) => r.newCode === code);
    if (row) addOneToPlan(row);
  }

  if (booting || heldBack) return <Preloader variant="screen" />;

  if (route === '#/drive' || route.startsWith('#/drive/')) {
    // #/drive/<segment>/<segment>… — the open folder, one encoded segment each.
    const parts = route.slice('#/drive'.length).split('/').filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    return (
      <>
        <Sidebar onStep={setStep} page="#/drive" docsOn={docsOn} />
        <main className="app-main">
          <div className="wrap">
            <Drive parts={parts} />
          </div>
        </main>
      </>
    );
  }

  if (route === '#/dashboard') {
    return (
      <>
        <Sidebar onStep={setStep} page="#/dashboard" docsOn={docsOn} />
        <main className="app-main">
          <div className="wrap">
            <Dashboard />
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Sidebar step={step} onStep={setStep} docsOn={docsOn} />
      <main className="app-main">
        <div className={step === 3 ? 'wrap' : 'wrap wrap-wide'}>
          <PlanBar
            activePlan={activePlan}
            plans={plans}
            busy={busy}
            onPick={pickPlan}
            onNew={newPlan}
            onDropCode={onSearch ? dropOnPlan : null}
          />

          {toast && (
            <div key={toast.id} className="toast" role="status" aria-live="polite">
              {toast.text}
            </div>
          )}

          {error && <div className="error" role="alert" aria-live="polite">{error}</div>}

          {step === 1 && (
            <>
              <h1>ค้นหาร้านยา</h1>
              <p className="sub">
                ค้นหาร้านยาที่ได้รับอนุญาตจาก อย. จัดแผนออกตรวจ และกรอกบันทึกการตรวจได้ในที่เดียว
              </p>

              {areasFailed && (
                <div className="error" role="alert">
                  โหลดรายชื่อจังหวัดไม่สำเร็จ — เลือกพื้นที่ไม่ได้จนกว่าจะโหลดใหม่{' '}
                  <button type="button" className="link-btn" onClick={loadAreas}>
                    ลองใหม่
                  </button>
                </div>
              )}

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

              {busy ? (
                <>
                  <Preloader variant="inline" />
                  <SkeletonList />
                </>
              ) : (
                <>
                  <Toolbar data={data} onRefresh={() => runSearch({ refresh: true })} />
                  <ResultStats rows={results} shown={visible.length} filter={statsFilter} onFilter={setStatsFilter} />
                  {visible.length > 0 && (
                    <p className="kbd-hint">
                      <kbd>/</kbd> ค้นหา · <kbd>j</kbd>/<kbd>k</kbd> เลื่อน · <kbd>p</kbd> พรีวิว ·{' '}
                      <kbd>a</kbd> ใส่แผน · <kbd>f</kbd> กรอกฟอร์ม · ลากการ์ดไปวางที่แผนมุมขวาล่างได้
                    </p>
                  )}
                </>
              )}

              {!busy && !data && (
                <ol className="search-intro" aria-label="ขั้นตอนการใช้งาน">
                  {INTRO_STEPS.map((s) => (
                    <li key={s.n} className="glass-panel">
                      <span className="material-symbols-outlined" aria-hidden="true">{s.icon}</span>
                      <b>{s.n}. {s.title}</b>
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ol>
              )}

              <ul className="result-grid">
                {visible.map((row) => (
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
            </>
          )}
          {step === 2 && (
            <PlanView
              planId={activePlan?.id || null}
              plans={plans}
              onPick={pickPlan}
              onPlansChanged={refreshPlans}
            />
          )}
          {step === 3 && <PlanRoute planId={activePlan?.id || null} />}
          {/* The form step shows the original record sheet (the static
              form.html), not a shop list. */}
          {step === 4 && (
            <iframe className="form-frame" src="/form.html" title="แบบบันทึกการตรวจสถานที่" />
          )}
          {step === 5 && <PlanDocuments planId={activePlan?.id || null} />}
        </div>
      </main>
    </>
  );
}
