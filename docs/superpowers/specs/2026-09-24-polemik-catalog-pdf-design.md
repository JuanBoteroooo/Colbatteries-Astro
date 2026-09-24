# Polemik "Nueva Colección" Catalog PDF — Design Spec

## Purpose

Colbateries wants a noticeably higher-quality product catalog than the site's current PDF/gallery-page catalogs, matching the polish of a reference catalog they like (a Batterycell-produced Q&Q watch muestrario: cover → category divider → thumbnail overview grid → one full page per product with a spec panel). This spec covers producing that quality bar for a new batch of 44 Polemik watch photos that have no existing model codes or manufacturer spec sheets — only what four different professional product photos show us.

This phase produces a downloadable PDF only. Coupling it into the website (a new catalog entry, a viewer page) is an explicit follow-up phase, not part of this spec.

## Non-goals

- No website integration (`catalogs.js` entry, `/catalogo/polemik-nueva-coleccion` viewer page) — deferred to a later phase per the user's own sequencing.
- No model codes — the user explicitly does not want invented codes; each watch is identified by category + a short descriptive name, not a SKU.
- No fabricated technical specs (movement caliber, exact case diameter/thickness, exact water-resistance bar rating, weight) beyond what's visibly printed on the dial or reasonably described from the photo (material/color). We do not have manufacturer data for this batch and won't invent it.
- Not touching the existing `relojes-polemik.json` / `relojes-polemik` catalog — this is a separate, standalone collection per the user's choice.

## Source Material

- `/Users/juanbotero/Downloads/POLEMIK-WCHS.zip` — 44 JPEG photos, professionally shot on clean white/transparent backgrounds, consistent framing, "POLEMIK+" branding visible on each dial. No filename metadata beyond WhatsApp timestamps — photos arrived as an unordered batch, not grouped by product.
- Reference quality bar: `/Users/juanbotero/Downloads/CATALOGO-QQ_MOSTRARIO-SEPTIEMBRE2026.pdf` (156 pages) — cover page, black category-divider pages, a thumbnail "vista general" grid page per category, and one full page per product (product photo on a light card + a labeled spec panel with green square bullets, organized into subsections).

## Content Curation (manual, part of implementation)

Every one of the 44 photos gets manually reviewed and classified into a JSON record:

- `id`: a stable slug (`polemik-01` … `polemik-44`, assigned in a fixed, documented order — not a product code, purely an internal file/reference key).
- `categoria`: `"Caballero"` | `"Dama"` | `"Unisex"`, judged by case size/dial design/strap style.
- `nombre`: a short descriptive display name composed from what's visible (e.g. "Cronógrafo Acero Plateado", "Digital Retro Dorado") — never a code.
- `tipo`: array of visible-feature tags (`"Cronógrafo"`, `"Digital"`, `"Dual Time"`, `"Clásico"`, `"Countdown"`, etc.) read off the dial's printed text/subdial layout.
- `resistenciaAgua`: string like `"5 BAR"` / `"30M"` when printed on the dial, otherwise `null` (omitted from the rendered page, never guessed).
- `caja`: `{ material, color }` — described from the photo (e.g. `{ material: "Acero inoxidable", color: "Dorado" }`).
- `correa`: `{ material, color }` — same approach (e.g. `{ material: "Caucho", color: "Negro" }`).
- `img`: path to the normalized product photo (see below).

## Image Pipeline

1. Extract the zip, discard the `__MACOSX` junk entries and AppleDouble (`._*`) files.
2. Copy the 44 photos into `public/images/productos/polemik-nueva-coleccion/` renamed to match each record's `id` (`polemik-01.jpg` …), so the JSON's `img` field and the filename stay predictable.
3. Photos are already clean white-background studio shots (verified by visual inspection of a representative sample across the batch) — no background removal or cropping pipeline is needed this time, unlike the Químicos batch. If any individual photo turns out to have a noticeably different background tone during the full pass, pad/normalize just that one with the same Pillow approach used for Químicos rather than building new tooling.

## PDF Generation — Playwright

**Why:** `playwright` (`^1.59.1`) is already a devDependency with Chromium already downloaded locally (verified: `~/Library/Caches/ms-playwright/chromium-1223` present) — no new dependency, no install step. Rendering real HTML/CSS to PDF via `page.pdf()` produces vector text (crisp at any zoom, small file size, copy-pasteable) instead of the rasterized-image PDFs (`pdftoppm`/Pillow composite) used for the Químicos catalog. This is the single biggest lever for "alta calidad" here, and the HTML template can be reused almost as-is for the website phase later.

**Script:** `scripts/generate-polemik-catalog.mjs` (Node ESM, run via `node scripts/generate-polemik-catalog.mjs`, following the existing `parse:eta` script convention of a one-off `scripts/*.mjs` file with an `npm run` alias).

**Flow:**
1. Read `src/data/polemik-nueva-coleccion.json`.
2. Group records by `categoria`, preserving JSON array order within each group.
3. Build one HTML document containing, in order:
   - Cover sheet (Colbateries logo, "Catálogo de Relojes", "Polemik — Nueva Colección", category tags present in the data, "Muestrario — sin precios").
   - Per category group present in the data (skip a group entirely if it has zero records):
     - A divider sheet (category name, count of models).
     - One or more overview-grid sheets (thumbnail + short name under each, ~12 per sheet, matching the reference's density).
     - One full sheet per watch in that group: large product photo on a light card (left), and a right-hand panel listing `nombre` as the heading, then labeled rows for `tipo` (as small pills), `resistenciaAgua` (omitted if `null`), `caja.material`/`caja.color`, `correa.material`/`correa.color`.
   - Each sheet is a `<section class="sheet">` sized to A4 portrait (`210mm × 297mm`) with `break-after: page` (the last sheet skips it), so Playwright's `page.pdf({ printBackground: true, preferCSSPageSize: true })` produces one page per sheet without needing per-page screenshots.
4. Colbateries brand tokens are inlined into the HTML's `<style>` (same hex values as the site: `--blue:#024598`, `--yellow:#f2a900`, `--red:#e64132`, Montserrat for headings via a bundled/`@font-face`d local copy or the same Google Fonts `<link>` the site uses — Playwright's headless Chromium can fetch Google Fonts at render time same as any browser). Polemik's own black/red wordmark appears only as the logo crop inside each product photo (already baked into the source photos), not as catalog chrome — matching the approved "Colbateries brand for the catalog shell" decision.
5. `chromium.launch()` → `page.setContent(html, { waitUntil: 'networkidle' })` → `page.pdf({ path: 'public/catalogos/polemik-nueva-coleccion.pdf', printBackground: true, preferCSSPageSize: true })` → close browser.

**Output:** `public/catalogos/polemik-nueva-coleccion.pdf`, following the same `public/catalogos/*.pdf` convention every other downloadable catalog on the site already uses (so it's immediately shareable via WhatsApp/email exactly like the rest, even before any website page exists for it).

## Error Handling

- If a photo file referenced by a JSON record's `img` is missing at generation time, the script fails fast with a clear message naming the record `id` and expected path — it does not silently render a broken `<img>`.
- If `resistenciaAgua`/`tipo` fields are empty/absent for a record, that row is omitted from the layout rather than rendered as an empty or placeholder value.
- If a category group ends up empty (e.g., no Dama watches after classification), its divider and overview-grid sheets are skipped entirely rather than rendered blank.

## Testing

No automated test suite for this one-off generation script, consistent with how the Químicos image/data pipeline was handled earlier in this project (manual verification is the norm for these content-generation scripts here). Verification is manual:

- Run the script, confirm it exits 0 and `public/catalogos/polemik-nueva-coleccion.pdf` exists.
- Open the PDF and check: cover page renders correctly, every category present in the data has its divider + overview grid, every one of the 44 watches has its own page with photo + highlights panel, no cut-off text, no broken images, page count matches expectations (1 cover + dividers/grids + 44 product pages).
- Spot-check 3–4 individual product pages against their source photos to confirm the manually-curated `tipo`/`caja`/`correa` fields are accurate.

## Out of Scope / Explicit Deferrals

- Website integration (catalog entry, viewer page, product-card grid) — next phase.
- Model codes — not part of this catalog by explicit user decision.
- Any spec field we cannot observe from the photo (movement, exact measurements, weight).
