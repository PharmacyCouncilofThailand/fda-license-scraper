import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAreas, fetchDetail, searchDrugLocations } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import SearchForm from './components/SearchForm.jsx';
import Toolbar from './components/Toolbar.jsx';
import ResultCard from './components/ResultCard.jsx';
import PickBar from './components/PickBar.jsx';
import Preloader from './components/Preloader.jsx';
import { SkeletonList } from './components/Skeleton.jsx';

const EMPTY_QUERY = { keyword: '', province: '', district: '', subdistrict: '' };

export default function App() {
  const [areas, setAreas] = useState({});
  const [query, setQuery] = useState(EMPTY_QUERY);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedCode, setSelectedCode] = useState(null);
  // newCode -> { open, status, detail, message }
  const [previews, setPreviews] = useState({});

  const pending = useRef(null);
  // The query a search should use, so a dropdown change can re-run immediately
  // instead of waiting a render for state to settle.
  const queryRef = useRef(query);
  queryRef.current = query;

  const [booting, setBooting] = useState(true);

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
  const selected = results.find((r) => r.newCode === selectedCode) || null;
  const selectedDetail =
    previews[selectedCode]?.status === 'ready' ? previews[selectedCode].detail : null;

  if (booting) return <Preloader variant="screen" />;

  return (
    <>
      <Sidebar />
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
              />
            ))}
          </ul>

          <PickBar row={selected} detail={selectedDetail} />
        </div>
      </main>
    </>
  );
}
