# Wizard UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three loose areas of the inspection app (search, plan, on-site record) into one guided three-step wizard driven by a single active plan, and rebuild the colour system as an olive palette seeded from `#737300`.

**Architecture:** `App.jsx` becomes the wizard shell: it owns the active plan and the active step, renders a persistent top **PlanBar** (plan dropdown + new-plan) and a **three-tab** strip, and shows one step body at a time. Step 1 is the existing search UI, step 2 is `PlanView` refactored to take the active plan id, step 3 is a new `PlanInspect` list that opens the existing per-shop `RecordForm`. The per-shop record keeps its full-screen hash route (`#/plans/<id>/<code>`), rendered outside the tabs.

**Tech Stack:** React (ES modules, `web/src/`), Vite build to `web/public/`, plain CSS design tokens in `web/public/theme.css`. No new dependencies. Backend (`src/`, CommonJS) is untouched.

## Global Constraints

- ES-module `web/src/` only — never import from CommonJS `src/`.
- English code/comments/identifiers; Thai user-facing strings.
- Keep `#737300` as the organisation colour and palette base; light theme only.
- Keep the `<pharmacist-search>` เลข ภ. sub-UI as-is (defined in `web/public/pharmacist-search.js`).
- Passcode travels only in the `x-plans-passcode` header (via `plans-api.js`); never in URL or logs.
- No new UI test framework (none exists). Logic checks use `node --test`-style assert scripts already in the repo; UI is verified in the browser preview (`preview_start` name `fda-license-scraper`, port 3000). Cache-bust reloads (`?v=N`) when a rebuild may be cached.
- Commits are small and per-task. End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Do NOT merge PR #1.

---

## File structure

- `web/public/theme.css` — **modify**: add `--olive-50..900` ramp, repoint `--primary`/`--ring`/`--chart-1`/`--sidebar*` at it, add `--primary-hover`/`--primary-active`; add `.planbar` and `.wizard-tabs` rules; remove dead `.cart*` rules.
- `web/src/components/PlanBar.jsx` — **create**: the persistent top bar (active-plan dropdown + new-plan button).
- `web/src/components/PlanInspect.jsx` — **create**: step 3, lists the active plan's shops and opens each shop's record.
- `web/src/App.jsx` — **modify**: own `step` + `plans` list; render PlanBar + tabs + step body; keep the `#/plans/<id>/<code>` full-screen RecordForm route; drop PickBar.
- `web/src/components/PlanView.jsx` — **modify**: take `planId` + `onPlansChanged` props; drop its internal plan dropdown / create / list / passcode retry (those move to the shell).
- `web/src/components/Sidebar.jsx` — **modify**: drop the three nav links (tabs replace them); keep brand + `<pharmacist-search>` + footer.
- `web/src/components/PickBar.jsx` — **delete**: replaced by PlanBar.

---

## Task 1: Olive palette

**Files:**
- Modify: `web/public/theme.css:24-58` (the `:root` token block) and `.btn` rules at `:134-149`.
- Check: `web/public/palette-check.mjs` (create, throwaway assert).

**Interfaces:**
- Produces: CSS custom properties `--olive-50` … `--olive-900`, `--primary-hover`, `--primary-active`. Later tasks' CSS may reference these.

- [ ] **Step 1: Add the ramp and repoint tokens**

In `web/public/theme.css`, inside `:root`, add the ramp above the `--primary` line:

```css
  /* Olive ramp seeded from the org colour; --olive-600 is #737300, the anchor.
     Repoint the brand tokens at it so tints/shades are consistent and one
     place drives them all. */
  --olive-50:  #fafae6;
  --olive-100: #f2f2c2;
  --olive-200: #e6e68a;
  --olive-300: #d4d452;
  --olive-400: #b3b32e;
  --olive-500: #8f8f0a;
  --olive-600: #737300;   /* ← สีองค์กร */
  --olive-700: #5c5c00;
  --olive-800: #454500;
  --olive-900: #2e2e00;
```

Then change these existing lines to point at the ramp (keep the names):

```css
  --primary: var(--olive-600);
  --primary-foreground: #ffffff;
  --primary-hover: var(--olive-500);
  --primary-active: var(--olive-700);
  --ring: var(--olive-600);
  --chart-1: var(--olive-600);

  --sidebar: var(--olive-600);
  --sidebar-primary-foreground: var(--olive-600);
  --sidebar-accent: var(--olive-500);
  --sidebar-border: var(--olive-500);
  --sidebar-ring: var(--olive-600);
```

Add a hover/active shade to `.btn` (it has none today) after the `transition` line:

```css
.btn:hover { background: var(--primary-hover); }
.btn:active { transform: translateY(1px); background: var(--primary-active); }
```

(Delete the old standalone `.btn:active { transform: translateY(1px); }` so there is one rule.)

- [ ] **Step 2: Write the throwaway check**

Create `web/public/palette-check.mjs` — it fails if the ramp is missing or the anchor drifts off `#737300`:

```js
import assert from 'assert';
import { readFileSync } from 'fs';
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
for (const step of [50,100,200,300,400,500,600,700,800,900]) {
  assert.ok(css.includes(`--olive-${step}:`), `missing --olive-${step}`);
}
assert.ok(/--olive-600:\s*#737300/.test(css), 'anchor must stay #737300');
assert.ok(/--primary:\s*var\(--olive-600\)/.test(css), 'primary must point at the ramp');
console.log('ok — olive palette');
```

- [ ] **Step 3: Run it**

Run: `node web/public/palette-check.mjs`
Expected: `ok — olive palette`

- [ ] **Step 4: Visual check in the browser**

`preview_start` (name `fda-license-scraper`), load `http://localhost:3000/?v=1`. Confirm the sidebar, primary buttons, and focus ring still render olive; hover a primary button and see it darken to `--olive-500`.

- [ ] **Step 5: Delete the throwaway check and commit**

```bash
rm web/public/palette-check.mjs
git add web/public/theme.css
git commit -m "Build an olive palette from #737300 and repoint the brand tokens"
```

---

## Task 2: PlanBar (active-plan top bar)

Replaces the floating `PickBar` cart with a top bar: a dropdown to switch the active plan and a button to create one. App owns the `plans` list so both the bar and step 2 read the same source.

**Files:**
- Create: `web/src/components/PlanBar.jsx`
- Modify: `web/src/App.jsx` (own `plans` list; render PlanBar; remove PickBar)
- Delete: `web/src/components/PickBar.jsx`

**Interfaces:**
- Consumes (from `plans-api.js`, already present): `listPlans() -> Promise<Plan[]>` where `Plan = { id, date, total }`; `createPlan({}) -> Promise<Plan>`.
- PlanBar props: `{ activePlan: {id,date,total}|null, plans: Plan[], busy: boolean, onPick: (id:string)=>void, onNew: ()=>void }`.
- Produces: App gains `plans` state and `refreshPlans()`; `onPick` sets `activePlan` from the list; `onNew` calls the existing `createPlan` path and refreshes.

- [ ] **Step 1: Create PlanBar**

`web/src/components/PlanBar.jsx`:

```jsx
/**
 * The working plan, pinned to the top of every step: a dropdown switches the
 * active plan (A/B/C…) and a button starts a new one. Replaces the old
 * bottom-right cart — the plan is now always in view.
 */
export default function PlanBar({ activePlan, plans, busy, onPick, onNew }) {
  return (
    <div className="planbar">
      <span className="material-symbols-outlined">checklist</span>
      <b className="planbar-title">ระบบวางแผนออกตรวจร้านยา</b>
      <span className="planbar-spacer" />
      <label className="planbar-pick">
        <span className="planbar-lbl">แผนที่ทำ</span>
        <select
          className="plan-select"
          value={activePlan?.id || ''}
          disabled={busy}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          aria-label="เลือกแผนที่กำลังทำ"
        >
          <option value="" disabled>
            {plans.length ? 'เลือกแผน' : 'ยังไม่มีแผน'}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              แผน {p.id} · {p.date || 'ยังไม่กำหนดวันที่'} · {p.total} ร้าน
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="planbar-new" disabled={busy} onClick={onNew}>
        + แผนใหม่
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire App to own the plans list**

In `web/src/App.jsx`:
- Add import: replace `import PickBar from './components/PickBar.jsx';` with `import PlanBar from './components/PlanBar.jsx';`
- Add state near the other plan state: `const [plans, setPlans] = useState([]);`
- Add a refresh function (uses the existing `withPasscode`):

```jsx
const refreshPlans = useCallback(async () => {
  try {
    setPlans(await withPasscode(listPlans));
  } catch (err) {
    setError(err.message);
  }
}, []);
useEffect(() => { refreshPlans(); }, [refreshPlans]);
```

- Replace the prompt-based `switchPlan` body with a list pick, and refresh the list after `createPlan`/`ensureActivePlan`:

```jsx
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
    await refreshPlans();
  } catch (err) {
    setError(err.message);
  }
}
```

- In `ensureActivePlan`, after it creates a plan, call `refreshPlans()` so the new plan appears in the dropdown (add `await refreshPlans();` before `return plan.id;`).
- Delete the old `switchPlan` function.

- [ ] **Step 3: Render PlanBar, drop PickBar**

In the search return, remove `<PickBar activePlan={activePlan} onSwitchPlan={switchPlan} />`. (PlanBar is rendered by the shell in Task 3; for this task, to verify in isolation, temporarily render `<PlanBar activePlan={activePlan} plans={plans} busy={busy} onPick={pickPlan} onNew={newPlan} />` at the top of the search `wrap`.)

- [ ] **Step 4: Delete PickBar**

```bash
git rm web/src/components/PickBar.jsx
```

- [ ] **Step 5: Verify in the browser**

Reload `http://localhost:3000/?v=2`. Confirm: the bar shows existing plans in the dropdown; picking one sets it active (add a shop → its count is on that plan); `+ แผนใหม่` creates a new letter plan and selects it; no console errors; no leftover bottom-right cart.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/components/PlanBar.jsx
git commit -m "Replace the floating cart with a top active-plan bar"
```

---

## Task 3: Wizard shell + tabs

App renders the PlanBar and a three-tab strip, and shows one step body at a time. The per-shop record keeps its full-screen hash route.

**Files:**
- Modify: `web/src/App.jsx` (add `step` state; shell layout; keep record route)
- Modify: `web/src/components/PlanView.jsx` (take `planId` + `onPlansChanged`; drop its own picker)
- Modify: `web/src/components/Sidebar.jsx` (drop nav links)

**Interfaces:**
- Consumes: `pickPlan`, `newPlan`, `plans`, `activePlan` from Task 2.
- PlanView new props: `{ planId: string|null, onPlansChanged: ()=>void }`. It calls `onPlansChanged` after create/delete/date-edit so the shell's dropdown refreshes. It no longer lists or creates plans.
- Produces: App `step` state (`1|2|3`) and a `<PlanInspect>` mount point filled in Task 4.

- [ ] **Step 1: Refactor PlanView to the active plan**

In `web/src/components/PlanView.jsx`:
- Change the signature to `export default function PlanView({ planId, onPlansChanged })`.
- Remove `plans`, `refreshList`, the `useEffect` that loads the list, the `<div className="plan-bar">` dropdown block, and the `newPlan` function. Keep `withPasscode`, `open`, `mutate`, `editDate`, `removePlan`, `typeLicence`, `sortTrip`, `exportPlan`.
- Load the active plan when `planId` changes:

```jsx
useEffect(() => {
  if (!planId) { setPlan(null); return; }
  open(planId);
}, [planId]);
```

- After `mutate`'s `refreshList()` calls, use `onPlansChanged?.()` instead (totals/dates changed). In `removePlan`, after `deletePlan`, call `onPlansChanged?.()` and `setPlan(null)`.
- Replace the empty state text with `เลือกแผนจากแถบด้านบน หรือกด + แผนใหม่`.
- The render no longer has its own plan-bar; it starts at `plan-head`.

- [ ] **Step 2: Add step state and shell layout to App**

In `web/src/App.jsx`:
- Add `const [step, setStep] = useState(1);`
- Import step 3: `import PlanInspect from './components/PlanInspect.jsx';` (created in Task 4; for this task render a placeholder `<div className="empty">ขั้นตอนออกตรวจ (กำลังต่อในขั้นถัดไป)</div>` if PlanInspect does not exist yet).
- Keep the record sub-route full-screen, BEFORE the shell return:

```jsx
if (route.startsWith('#/plans/')) {
  const [, , planId, encodedCode] = route.split('/');
  if (planId && encodedCode) {
    return (
      <>
        <Sidebar />
        <main className="app-main">
          <div className="wrap">
            <RecordForm planId={planId} newCode={decodeURIComponent(encodedCode)} />
          </div>
        </main>
      </>
    );
  }
}
```

- Replace the two remaining returns (search page and `#/plans` PlanView) with ONE shell return:

```jsx
return (
  <>
    <Sidebar />
    <main className="app-main">
      <div className="wrap">
        <PlanBar
          activePlan={activePlan}
          plans={plans}
          busy={busy}
          onPick={pickPlan}
          onNew={newPlan}
        />
        <nav className="wizard-tabs" aria-label="ขั้นตอน">
          <button className={step === 1 ? 'active' : ''} onClick={() => setStep(1)}>
            <span className="n">1</span> ค้นหา / เลือกร้าน
          </button>
          <button className={step === 2 ? 'active' : ''} onClick={() => setStep(2)}>
            <span className="n">2</span> จัดแผน / เรียงเส้นทาง
          </button>
          <button className={step === 3 ? 'active' : ''} onClick={() => setStep(3)}>
            <span className="n">3</span> ออกตรวจ / กรอกฟอร์ม
          </button>
        </nav>

        {error && <div className="error">{error}</div>}

        {step === 1 && (
          <>
            {/* existing search block: <h1>ค้นหาร้านยา</h1> … the <ul> of ResultCard */}
          </>
        )}
        {step === 2 && (
          <PlanView planId={activePlan?.id || null} onPlansChanged={refreshPlans} />
        )}
        {step === 3 && (
          <PlanInspect planId={activePlan?.id || null} />
        )}
      </div>
    </main>
  </>
);
```

Move the existing search JSX (the `<h1>` through the `</ul>`) into the `step === 1` block. Drop the now-duplicate top-level `{error && …}` inside step 1 (the shell shows it once). Remove the old `route.startsWith('#/plans')` PlanView branch.

- [ ] **Step 3: Drop Sidebar nav links**

In `web/src/components/Sidebar.jsx`, remove the `<nav>…</nav>` block and the `<hr />` above it and the `route` prop (tabs replace the nav). Keep brand, the `<pharmacist-search />`, and the footer. Update `App.jsx` `<Sidebar />` calls to pass no `route`.

- [ ] **Step 4: Verify in the browser**

Reload `http://localhost:3000/?v=3`. Confirm: three tabs switch instantly; step 1 search still runs and `+ ใส่แผน` files into the active plan; step 2 shows the active plan's table (date edit / export / reorder / delete work and the dropdown total updates); switching the plan in the bar changes step 2; opening a shop record still works via its hash route and returns to the shell.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx web/src/components/PlanView.jsx web/src/components/Sidebar.jsx
git commit -m "Fold search and plan into a three-tab wizard shell"
```

---

## Task 4: Step 3 — inspect list

Step 3 lists the active plan's shops in trip order and opens each shop's record form (un-hiding the กรอกฟอร์ม path).

**Files:**
- Create: `web/src/components/PlanInspect.jsx`
- Modify: `web/src/App.jsx` (replace the step-3 placeholder with the real component)

**Interfaces:**
- Consumes: `getPlan(id) -> Promise<{ id, date, items: Item[] }>` from `plans-api.js`; `Item = { newCode, order, placeName, status }`. Records live at the hash route `#/plans/<id>/<encodedCode>` (rendered by `RecordForm` in App).
- Props: `{ planId: string|null }`.

- [ ] **Step 1: Create PlanInspect**

`web/src/components/PlanInspect.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { getPlan } from '../lib/plans-api.js';

/**
 * Step 3: the day's shops in trip order. Tapping one opens its on-site record
 * (the existing RecordForm, at #/plans/<id>/<code>). The plan's own order is
 * used as-is — reorder it in step 2 first if needed.
 */
export default function PlanInspect({ planId }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!planId) { setPlan(null); return; }
    let live = true;
    getPlan(planId)
      .then((p) => live && setPlan(p))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, [planId]);

  if (!planId) return <div className="empty">เลือกแผนจากแถบด้านบนก่อน</div>;
  if (error) return <div className="error">{error}</div>;
  if (!plan) return <div className="empty">กำลังโหลด…</div>;
  if (!plan.items.length) return <div className="empty">ยังไม่มีร้านในแผนนี้</div>;

  return (
    <ol className="inspect-list">
      {plan.items.map((item) => (
        <li key={item.newCode} className={item.status === 'done' ? 'done' : undefined}>
          <div className="inspect-name">
            <span className="inspect-num">{item.order}</span>
            <b>{item.placeName || '(ไม่ระบุชื่อ)'}</b>
          </div>
          <a
            className="btn btn-sm"
            href={`#/plans/${plan.id}/${encodeURIComponent(item.newCode)}`}
          >
            กรอกฟอร์ม
          </a>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Mount it in App**

In `web/src/App.jsx`, replace the step-3 placeholder with `<PlanInspect planId={activePlan?.id || null} />` (the import was added in Task 3).

- [ ] **Step 3: Verify in the browser**

Reload `http://localhost:3000/?v=4`. With a plan that has shops: step 3 lists them in the same order as step 2 (run "จัดลำดับตามเวลา/เส้นทาง" in step 2 and confirm step 3 follows). Click กรอกฟอร์ม → the record form opens full-screen for that shop; the browser back button returns to the wizard.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.jsx web/src/components/PlanInspect.jsx
git commit -m "Add the step-3 inspect list that opens each shop's record"
```

---

## Task 5: Shell CSS + cleanup

Style the new chrome and remove dead rules.

**Files:**
- Modify: `web/src/app.css` (or `web/public/theme.css` for shared tokens — put layout in `app.css`, tokens already done in Task 1)

**Interfaces:**
- Consumes: `--olive-*`, `--primary`, `--card`, `--border` tokens.

- [ ] **Step 1: Add shell styles**

In `web/src/app.css` add:

```css
.planbar {
  display: flex; align-items: center; gap: 8px;
  background: var(--primary); color: var(--primary-foreground);
  padding: 10px 14px; border-radius: 1rem; margin-bottom: 12px;
}
.planbar-title { font-weight: 500; }
.planbar-spacer { flex: 1; }
.planbar-lbl { opacity: .85; font-size: 13px; margin-right: 6px; }
.planbar .plan-select {
  background: rgba(255,255,255,.16); color: #fff; border: 0;
  padding: 6px 10px; border-radius: .6rem;
}
.planbar .plan-select option { color: #111827; }
.planbar-new {
  background: #fff; color: var(--olive-700); border: 0;
  padding: 6px 12px; border-radius: .6rem; font-weight: 500; cursor: pointer;
}
.planbar-new:disabled { opacity: .6; cursor: default; }

.wizard-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.wizard-tabs button {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px; border: 0; border-radius: .75rem; cursor: pointer;
  background: var(--olive-100); color: var(--olive-700); font: inherit;
}
.wizard-tabs button .n {
  display: grid; place-items: center; width: 20px; height: 20px;
  border-radius: 999px; background: var(--olive-300); color: var(--olive-900);
  font-size: 12px; font-weight: 600;
}
.wizard-tabs button.active { background: var(--primary); color: #fff; }
.wizard-tabs button.active .n { background: #fff; color: var(--primary); }

.inspect-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.inspect-list li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--card);
  border: 1px solid var(--border); border-radius: 1rem;
}
.inspect-list li.done { opacity: .6; }
.inspect-name { display: flex; align-items: center; gap: 10px; }
.inspect-num {
  display: grid; place-items: center; width: 26px; height: 26px;
  border-radius: 999px; background: var(--olive-100); color: var(--olive-700);
  font-size: 13px; font-weight: 600;
}

@media (max-width: 560px) {
  .planbar { flex-wrap: wrap; }
  .planbar-title { font-size: 14px; }
  .wizard-tabs button { font-size: 13px; padding: 8px; }
}
```

- [ ] **Step 2: Remove dead CSS**

In `web/src/app.css`, delete the `.cart`, `.cart-fab`, `.cart-badge`, `.cart-popover`, `.cart-head`, `.cart-items`, `.cart-empty`, `.cart-actions` rules (PickBar is gone). If `PlanView`'s old `.plan-bar` / `.plan-pick` rules are now unused, remove them too. Leave `.plan-select` base rules that PlanBar reuses.

- [ ] **Step 3: Verify layout**

Reload `http://localhost:3000/?v=5`. Check desktop and mobile widths (`resize_window` mobile): the bar wraps cleanly, tabs stay tappable, the inspect list reads well, no horizontal scroll, no console errors.

- [ ] **Step 4: Run the logic suites (nothing should have moved)**

Run: `npm test` and `node route-check.mjs` (from the scratchpad copy) — all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/app.css
git commit -m "Style the wizard shell and drop the dead cart CSS"
```

---

## Self-review

- **Spec coverage:** shell + active-plan bar (Tasks 2,3) ✓; three free tabs (Task 3) ✓; step 1 search incl. เลข ภ. kept (Task 3, Sidebar keeps `<pharmacist-search>`) ✓; step 2 plan/reorder/export (Task 3, PlanView refactor) ✓; step 3 record un-hidden (Task 4) ✓; olive palette + repoint (Task 1) ✓; light-only / Kanit / glass untouched ✓; no API/backend change ✓; passcode header unchanged (reuses `plans-api.js`) ✓. Out-of-scope items (real routing, prompt→input, dark mode) are not tasked, as intended.
- **Placeholder scan:** step-3 placeholder in Task 3 is explicitly replaced in Task 4; no other TODOs.
- **Type consistency:** `Plan={id,date,total}` and `Item={newCode,order,placeName,status}` used consistently; `onPlansChanged` (Task 3) matches App's `refreshPlans` (Task 2); PlanBar props match App's `pickPlan`/`newPlan`.
- **Known ceiling:** step 3 uses the plan's stored order (set in step 2); it does not re-sort on its own — reorder in step 2 first. Acceptable per spec.
