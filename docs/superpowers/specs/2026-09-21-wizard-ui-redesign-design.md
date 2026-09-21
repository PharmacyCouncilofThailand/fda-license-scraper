# Wizard UI redesign — design

Date: 2026-09-21
Status: approved for planning
Scope: `web/` (the React inspection app) + `web/public/theme.css`

## Goal

Turn the inspection app into a single guided flow so an officer can plan and run
an on-site pharmacy inspection on an iPad or phone without hunting for the next
action. Today the app is three loosely-joined areas (search, plan, on-site
record) with the on-site step hidden. The redesign stitches them into one
three-step wizard, and rebuilds the colour system as a proper olive palette
seeded from the organisation colour `#737300`.

## Constraints (fixed)

- **Keep the current colour theme.** `#737300` stays the organisation colour and
  the palette base. No new brand hue.
- **Wizard-style flow** is the target shape (see Architecture).
- **The เลข ภ. (pharmacist licence) search stays as close to its current form as
  possible.** Do not reinvent that sub-UI.
- **Light theme only.** The app's real output is a printed inspection record on
  white paper, so the screen matches it. No dark mode.
- **Kanit font, glass panels, Material Symbols** carry over unchanged.
- **CommonJS `src/` vs ES-module `web/src/` boundary is not crossed.** This work
  is entirely in `web/` and `web/public/`.
- Existing plan behaviour is preserved: letter plan ids (A, B, C…), optional
  editable date, trip-ordering (duty start time then distance from the Pharmacy
  Council), Word/PDF export, passcode in the `x-plans-passcode` header.

## Architecture

One flow, three steps, driven by a single active plan.

```
┌─────────────────────────────────────────────────────────┐
│  active-plan bar   [แผน A · 5 ร้าน ▾]      [+ แผนใหม่]     │  ← persistent, all steps
├─────────────────────────────────────────────────────────┤
│  (1) ค้นหา/เลือกร้าน  (2) จัดแผน/เรียงเส้นทาง  (3) ออกตรวจ │  ← tabs, jump freely
├─────────────────────────────────────────────────────────┤
│  step content                                            │
└─────────────────────────────────────────────────────────┘
```

### Shell

A new `WizardShell` component owns the chrome and the two pieces of shared
state:

- **Active plan.** The plan the whole flow operates on. Rendered as a dropdown in
  the top bar (switch A/B/C…) plus a `+ แผนใหม่` button. This replaces the
  per-view plan pickers (the search page's `PickBar` cart and `PlanView`'s
  top-right dropdown) with one bar. The active plan id persists in
  `localStorage` under the existing `fda:plan:active` key so a reload lands back
  on the same plan.
- **Active step.** `1 | 2 | 3`. Rendered as three tabs. Navigation is free — any
  tab is clickable at any time (no forced completion). This matches how the work
  really goes: add a shop, jump to the plan, come back to search for more.

The shell renders exactly one step body at a time. It does not unmount the
others' data — plan state lives above the steps, so switching tabs is instant
and loses nothing.

### Step 1 — ค้นหา / เลือกร้าน

Reuses today's search page almost whole:

- `SearchForm` (search shops by name/address via `/api/fda/drug-locations`).
- The `<pharmacist-search>` เลข ภ. sub-UI, unchanged.
- `ResultCard` list. Each card keeps พรีวิว, กรอกฟอร์ม, and the cart-style
  `+ ใส่แผน` button, which files the shop straight into the active plan.

What changes: the search-page cart/`PickBar` floating widget is removed — its
job (show the active plan's shop count, switch plan) is now the top bar. Adding
a shop still gives immediate feedback on the card (`✓ อยู่ในแผน`).

### Step 2 — จัดแผน / เรียงเส้นทาง

Reuses `PlanView`'s body without its own plan picker (that moved to the shell):

- `PlanTable` of the active plan's shops.
- แก้ไขวันที่, ส่งออก Word / PDF.
- จัดลำดับตามเวลา/เส้นทาง (existing `orderForTrip`: duty start time first, then
  distance from the Pharmacy Council).
- เอาออก per row; ลบแผน; อัปเดตข้อมูลจาก อย.

### Step 3 — ออกตรวจ / กรอกฟอร์ม

The on-site record flow, un-hidden:

- Lists the active plan's shops in their trip order.
- Tapping a shop opens its on-site record form (`RecordForm` / `RecordStep`,
  the existing per-shop inspection wizard).
- This restores the `กรอกฟอร์ม` action that is currently hidden in `PlanTable`
  and on the result cards — here it is the step's whole purpose.

## Colour system — olive palette

Replace the single flat `#737300` with a tonal ramp so the redesign can use
tints and shades consistently (backgrounds, hovers, borders, text) instead of
one-off `color-mix()` calls.

Add to `:root` in `web/public/theme.css`:

| Token | Hex | Typical use |
|-------|-----|-------------|
| `--olive-50`  | `#fafae6` | page tint, faint fills |
| `--olive-100` | `#f2f2c2` | soft chips, inactive tab |
| `--olive-200` | `#e6e68a` | placeholder bars, light borders |
| `--olive-300` | `#d4d452` | hover fills, accents |
| `--olive-400` | `#b3b32e` | lines, secondary accents |
| `--olive-500` | `#8f8f0a` | hover of primary |
| `--olive-600` | `#737300` | **primary / brand anchor** |
| `--olive-700` | `#5c5c00` | primary text on light, pressed |
| `--olive-800` | `#454500` | headings |
| `--olive-900` | `#2e2e00` | darkest text |

Then repoint the existing brand tokens at the ramp so nothing downstream breaks:

- `--primary: var(--olive-600)`; `--ring: var(--olive-600)`;
  `--chart-1: var(--olive-600)`.
- `--sidebar: var(--olive-600)`; `--sidebar-accent`/`--sidebar-border`:
  `var(--olive-500)`; `--sidebar-primary-foreground: var(--olive-600)`.
- A new `--primary-hover: var(--olive-500)` and `--primary-active:
  var(--olive-700)` for `.btn` states (today `.btn` has no hover shade).

All existing rules that reference `--primary`, `--ring`, `--sidebar*`,
`--accent` keep working because those names still resolve — they now resolve
through the ramp. Status colours (`--success-*`, `--danger-*`, `--warning-*`)
stay separate and unchanged: a lapsed licence must read as wrong, not as brand.

## Data flow

- No API changes. The shell calls the same `plans-api.js` functions
  (`listPlans`, `createPlan`, `getPlan`, `addToPlan`, `reorderPlan`,
  `updatePlan`, `deletePlan`, records via `records-api.js`).
- Active plan id in `localStorage` (`fda:plan:active`). Active step is in-memory
  component state (resets to step 1 on full reload — acceptable; the plan is what
  must persist, not the tab).
- Passcode handling (`withPasscode` retry on 401) moves up into the shell so all
  three steps share one prompt path instead of each view re-implementing it.

## Error handling

- Reuse the existing per-view error banners; the shell owns one error slot shown
  under the tab strip so any step's failure surfaces in the same place.
- Passcode 401 → single `withPasscode` retry at the shell level (unchanged
  behaviour, just lifted up).

## Out of scope (this spec)

- Real driving-distance/route optimisation beyond the current haversine
  time-then-distance sort. The trip-ordering stays as built.
- Replacing `window.prompt` for แก้ไขวันที่ / กรอกเลข ภ. with in-page inputs.
  Noted as a known pain point; a follow-up, not blocking this redesign.
- Dark mode.
- Any change to the CommonJS backend (`src/`).

## Testing

- `route.js` / plan logic already covered by `route-check.mjs`, `test-plans.js`,
  `npm test`, `smoke.js` — must stay green.
- Manual verification in the browser preview: create plan → search → add shop
  (step 1) → reorder + export (step 2) → open a shop's record form (step 3),
  switching tabs and plans freely; confirm active plan persists across reload.
- Palette: visual check that primary buttons, sidebar, focus ring, and glass
  surfaces still render correctly after repointing tokens.

## Build note

Vite outputs to `web/public/` (built `index.html` + `assets/` are gitignored;
Vercel rebuilds). Only source is committed. Reloads may serve a stale cached
`index.html` — cache-bust when verifying.
