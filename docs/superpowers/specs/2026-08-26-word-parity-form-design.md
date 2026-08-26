# Inspection record: parity with the Word original

**Date:** 2026-08-26
**Status:** approved, ready for planning

## The problem

`web/public/form.html` is a hand-built approximation of the office's Word
record. It is what an inspector fills in on screen, and what Puppeteer prints
for the PDF. Beside the Word file it is visibly a different document: wrong
page margins, wrong type sizes, wrong typeface, a missing seal, and blanks
that sit in fixed-width boxes rather than flowing with the line.

The record is a government form. Its layout is part of the document, not a
presentational choice, so the screen form and the PDF both have to match the
Word original.

## Source of truth

`templates/inspection-form.docx` — the tokenised template the DOCX export
already uses. It stays out of the repository (it carries the inspecting
officers' names); everything below was read out of it.

| | Word | form.html today |
|---|---|---|
| Page | A4, margins top 12mm, bottom 10mm, left/right 20mm | margins 15mm / 18mm |
| Typeface | TH SarabunPSK (`w:cs`), TH SarabunIT๙ as the document default | TH Sarabun New |
| Sizes | 18pt bold title, 15pt body, 14pt the officers' line | 13.5pt throughout, then shrunk to fit |
| Structure | 42 paragraphs + one 2-column table, seal anchored top-left of page 1 | hand-written lines, no seal |
| Blanks | 489 runs carrying `w:u val="dotted"`, flowing inline | fixed-width `<input>` boxes |
| Justification | `thaiDistribute` on the body paragraphs | left-aligned |
| Footer | `หน้าที่ N จาก 2`, centred | page number in the sheet body |

## Decisions

**Match by hand, not by generating HTML from the .docx.** A generator would
keep parity automatically if the template changed, but it means writing an
OOXML renderer and rebuilding the fill mechanism around template tokens. The
form is a statutory record that changes very rarely; the generator trades a
large amount of work against something that is unlikely to happen. A parity
test (below) covers the case where it does.

**Embed TH SarabunPSK, not TH Sarabun New.** PSK is what the runs in the
template name. It comes from
`https://github.com/SarabunConsortium/TH-Sarabun-PSK` under the SIL Open Font
License 1.1, regular and bold, ~867KB together, served only by the record
page. The TH Sarabun New files added earlier come out again, so there is one
face and no chance of the two mixing.

**No automatic shrinking.** Word sets the record at a fixed size and lets long
values push the text down; the HTML currently steps the type down to hold the
record to two pages. Fixed size wins: the form has to look the same every
time, and a record that runs to a third page is what the Word copy would do
too. `fitSheet()` and `shrinkToFit()` both go.

## The work

### Page and type

`@page` and `.sheet` take the Word margins (12/20/10/20mm). Body copy is 15pt,
the title 18pt bold, the officers' line 14pt, `spacing w:before="120"` becomes
6pt of space above the paragraphs that carry it. No `line` rule is set in the
template, so line height stays at the font's own.

### Paragraph structure

The sheet's markup is rebuilt against the template's 42 paragraphs, in order,
with the same wording — including lines missing from the current HTML.

Body paragraphs are justified (`text-align: justify`) to stand in for Word's
`thaiDistribute`.

Blanks stop being fixed-width boxes. Each becomes a field that flows in the
line and grows into the space left on it, underlined with the same dotted
rule, so a long value pushes the line on instead of being cut off or shrunk.
The last blank on a line runs out to the right margin, as the trailing dotted
runs do in Word.

### Seal

The council's seal is anchored to the top-left of page 1 in the template,
17.6 × 25.6mm, offset 5.6mm above the top margin. The HTML has no seal at all
today; it gets one, at that size and position.

### Signature block

A two-column table, 81.6mm per column, no borders: two `ลงชื่อ` rows in the
left column, five in the right.

### Footer

`หน้าที่ N จาก 2`, centred, from the template's `footer1.xml`.

## Code touched

- `web/public/form.html` — the sheet markup, the print CSS, `@font-face`
- `web/public/fonts/` — PSK in, New out
- `fitSheet()`, `shrinkToFit()` — deleted, along with the page-fit slack
- `applyData()` keeps every token name, so the search page needs no change
- `src/docx-form.js` and the DOCX endpoint are untouched: they render from the
  template itself

## Testing

`test-form-parity.js` reads `templates/inspection-form.docx` and the rendered
page and compares them:

- page size and margins against `sectPr`
- every paragraph's text, in order, after collapsing whitespace
- each paragraph's type size against `w:szCs`, converted from half-points
- the number of blanks against the number of dotted-underline run groups

The test is skipped with a clear message when the template is absent, the way
the DOCX path already handles it — the template is not in the repository.

`smoke-form.js` keeps checking that a filled record renders, but its
assertion changes from "exactly two pages" to "two pages for the standard
sample", since a long record is now allowed to run over, as in Word.

## Known limit

Word's `thaiDistribute` has no exact CSS equivalent, and Chromium breaks Thai
lines on a different dictionary to Word's. Everything measurable — margins,
sizes, wording and order, the seal's position, the signature table — will
match. Individual line breaks in full-width paragraphs may still fall a word
apart, and those get fixed one at a time when the two are compared visually.

## Out of scope

The search page, the pharmacist licence panel, and the API.
