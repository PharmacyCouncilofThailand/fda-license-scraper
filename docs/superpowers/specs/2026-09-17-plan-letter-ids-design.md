# Design: Letter plan IDs with an editable date

## Problem

Creating an inspection plan currently forces the officer to type a date in
Buddhist-era `YYYY-MM-DD` form, and that date *is* the plan's identity — the
plan id, its filename, and its display name are all the date. In practice the
officer often does not know the inspection date when they start filing shops
into a plan, and the date cannot be changed afterward without recreating the
plan and re-adding every shop.

## Goal

- A new plan gets a short letter name (`A`, `B`, `C`, … `Z`, then `AA`, `AB`,
  …) assigned automatically. No date is required to create one.
- The date becomes an ordinary optional field that can be set or changed at any
  time from the plan screen.
- Existing plans, whose ids are dates, keep working unchanged — no migration.

## Plan identity

The plan id changes from "the date" to "the next free letter". Letters are
spreadsheet-column style so the scheme never runs out: `A`–`Z`, then `AA`,
`AB`, … Assignment finds the lowest column label not already taken by a stored
plan, so a deleted plan's letter can be reused and ids stay stable (records and
photos are keyed on the plan id, so ids must never be renumbered under a plan
that already has data).

The date moves to the existing `date` field on the plan document, which is now
allowed to be empty. Nothing else keys on the date.

## The id-pattern coupling

Three stores anchor a plan id to the date shape, as a path-traversal defense
(`.`/`..` cannot match a date):

- `src/plans-store.js` — `idPattern` for the plan document.
- `src/records-store.js` — the plan-id half of the record id `<planId>__<code>`.
- `src/photo-store.js` — `PLAN_ID_PATTERN` for the photo key path.

Each widens to accept **either** the old date shape **or** a 1–4 letter column
label:

```
^([0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?|[A-Z]{1,4})$
```

`[A-Z]{1,4}` can never be `.` or `..`, so the traversal defense is preserved.
Keeping the date alternative in the pattern is what lets existing date-named
plans (and their records and photos) keep resolving.

## Backend changes

- `src/plans.js`
  - `createPlan({ date, title })` — no longer requires or validates `date` at
    creation. It computes the next free column label as the id, stores `date`
    as given or `''`. If a `date` is passed it must still be empty or
    date-shaped.
  - `updatePlan(id, { date })` — new. Accepts `date` of `''` (clear) or a valid
    Buddhist-era `YYYY-MM-DD`; rejects anything else with a 400. Saves and
    returns the plan. Only the date is editable this way; items keep their own
    routes.
  - A `nextPlanId(existingIds)` helper produces the column label.
- `src/server.js` — `PATCH /api/plans/:id` calling `updatePlan`, behind the
  existing passcode guard, beside the other plan routes.

## Frontend changes

- `web/src/lib/plans-api.js` — `updatePlan(id, patch)` calling
  `PATCH /api/plans/:id`.
- `web/src/App.jsx` — `ensureActivePlan()` no longer prompts for a date; it
  calls `createPlan({})` and files the shop into the returned plan. The active
  plan chip shows the letter.
- `web/src/components/PickBar.jsx` — shows `แผน <id>` and the date (or a
  "no date yet" note) instead of the date alone.
- `web/src/components/PlanList.jsx` — each row shows `แผน <id>` with the date
  (or "ยังไม่กำหนดวันที่") underneath.
- `web/src/components/PlanView.jsx` — the plan header shows the letter and an
  "แก้ไขวันที่" control that prompts for a date and calls `updatePlan`.

## Display

The id is shown as `แผน A`. The long official title (`DEFAULT_TITLE`) is
unchanged and still used on the printed documents. A plan with no date shows
`ยังไม่กำหนดวันที่` wherever the date would appear.

## Backward compatibility

Existing plans keep their date-shaped ids and names; only newly created plans
get letters. The widened id patterns accept both shapes, so existing records
and photos continue to resolve. No data migration.

## Testing

- `test-plans.js` — `createPlan` with no date yields `A`, a second yields `B`;
  `updatePlan` sets and clears the date and rejects a malformed one; a
  date-shaped legacy id still loads.
- `test-plans-store.js` / `test-records-store.js` — the widened id pattern
  accepts a letter id and still accepts a date id, and still rejects `..`.
- `node smoke.js` and the full `npm test` suite stay green.

## Sequencing note

The `PLAN_ID_PATTERN` change in `src/photo-store.js` overlaps a change another
session has uncommitted in that file (`safeEncodeCode` extraction). The
photo-store edit is done last, after that session lands its change, to avoid a
clobber; every other part of this work is independent of it.
