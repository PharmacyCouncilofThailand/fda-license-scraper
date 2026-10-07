# Inspection dashboard — design

Date: 2026-10-05. Branch: `feature/drive`.

## Why

The web app is now used only for preparation in the office: planning,
filling forms and looking up pharmacists. Officers no longer use it at the
shop, so the record page no longer marks a shop inspected. The office still
wants to see how many shops have been inspected.

## Counting rule

- The unit is a **plan item**. The same shop in two plans is two inspections.
- An item is **done** when its record has at least one document attached in
  the "เอกสาร" step, which is the signed form scanned after the visit. Nobody
  has to mark it separately.

## Backend

`src/stats.js` holds `buildStats(plans, records)`. It is pure, and its result
looks like this:

```
{ total, done, remaining,
  byMonth: [{ month, total, done }],        // month 'YYYY-MM' (Buddhist era) of plan.date, '' if unset; sorted, '' last
  byArea:  [{ province, district, total, done }] }  // from splitAddress(item.address); sorted by total desc
```

`GET /api/stats` sits behind the office passcode. It reads every plan from
`plans-store` and every record from `records-store`, then calls `buildStats`.

## Web

A sidebar item "ภาพรวม" opens `#/dashboard`, rendered like the drive page.
The page has three parts:

- three stat tiles: inspected, total and remaining, with a percentage
- a monthly bar chart of done against planned, in CSS only
- a table by province and district with a progress bar

## Out of scope

Date-range filters, Excel export and unique-shop counting are not in this
round.

## Testing

`test-stats.js` runs `buildStats` on fixture plans and records. It checks:

- a done item needs a document
- the same shop in two plans counts twice
- an unset plan date groups under `''`
- area comes from the address
- the sort order
