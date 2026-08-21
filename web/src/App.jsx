import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAreas, fetchDetail, fetchResultPages, searchDrugLocations } from './api.js';
import { buildView } from './lib/area.js';
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
  // A broad keyword is assembled slice by slice; the complete row set lives
  // here so area filters work on it locally, without another scrape.
  const assemblyRef = useRef(null); // { keyword, rows: Map, done }
  const [progress, setProgress] = useState(null); // { page, total }
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

    assemblyRef.current = null;
    setProgress(null);

    try {
      const result = await searchDrugLocations(
        { ...current, keyword, refresh },
        controller.signal
      );
      setData(result);
      if (result.incomplete) {
        // The single request could not walk every page. Fetch the rest in
        // slices and hand filtering to the browser once the set is whole.
        await assemble(keyword, result, current, controller);
      }
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

  /**
   * Pull the pages the first request had to leave behind, ten at a time,
   * updating the list as each slice lands. Seeding from the first response is
   * only sound when no area filter was set — a filtered response has already
   * dropped rows the full set needs.
   */
  async function assemble(keyword, first, current, controller) {
    const rows = new Map();
    const unfiltered = !current.province && !current.district && !current.subdistrict;
    let next = 1;
    if (unfiltered) {
      for (const row of first.results) rows.set(row.newCode || row.licenseNo, row);
      next = first.pagesRead + 1;
    }
    assemblyRef.current = { keyword, rows, done: false };

    let total = null;
    while (next) {
      setProgress({ page: next, total });
      const slice = await fetchResultPages(keyword, next, 10, controller.signal);
      if (assemblyRef.current?.keyword !== keyword) return; // superseded
      for (const row of slice.results) rows.set(row.newCode || row.licenseNo, row);
      total = slice.totalPages;
      next = slice.nextPage;
      setData(
        buildView([...rows.values()], queryRef.current, {
          assembled: true,
          assembling: Boolean(next),
          pagesRead: total ?? first.pagesRead,
          totalPages: total,
        })
      );
    }
    assemblyRef.current.done = true;
    setProgress(null);
  }

  /** Changing an area filter re-runs the search. With an assembled set in
      hand the browser filters it directly; otherwise the server does, from
      its keyword cache. */
  function changeQuery(patch, rerun = false) {
    const next = { ...queryRef.current, ...patch };
    queryRef.current = next;
    setQuery(next);
    if (!rerun || !next.keyword.trim()) return;

    const held = assemblyRef.current;
    if (held && held.done && held.keyword === next.keyword.trim()) {
      setData(
        buildView([...held.rows.values()], next, {
          assembled: true,
          totalPages: null,
        })
      );
      return;
    }
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

          {progress && (
            <div className="warn">
              คำค้นนี้กว้าง กำลังทยอยอ่านหน้าที่เหลือ... หน้า {progress.page}
              {progress.total ? ` / ${progress.total}` : ''} — แสดงผลเท่าที่ได้ระหว่างรอ
            </div>
          )}

          {data?.incomplete && !progress && (
            <div className="warn">
              คำค้นนี้กว้างเกินไป อ่านตารางได้ {data.pagesRead} หน้าแล้วหยุดตามลิมิต
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
