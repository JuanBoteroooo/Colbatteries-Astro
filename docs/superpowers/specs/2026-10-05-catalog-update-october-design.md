# October 2026 Catalog Update — Design Spec

## Purpose

The user uploaded 5 new vendor/own-made catalog PDFs to `public/catalogos/` to update existing website catalogs or add new products. This spec covers getting all five onto the website following the established catalog-update playbook (`docs/superpowers/plans/2026-07-21-catalog-mass-update.md`), plus one new catalog ("Reloj Polemik Superior") that needs a new viewer block.

Two tracks:
- **Track A** — four in-place updates of existing structured catalogs (routine, playbook-driven).
- **Track B** — one new catalog, Polemik Superior (new data format, new viewer block).

## Source Material (verified in `public/catalogos/`, all untracked in git, all 16:9 PowerPoint-exported PDFs with a selectable text layer)

| File | Pages | Maps to |
|---|---|---|
| `QUIMICOS PARA JOYERIA.pdf` | 15 | `quimicos-joyeria` (update) |
| `BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf` | 21 | `baterias-recargables` (update) |
| `PULSOS SILICONA.pdf` | 65 | `pulso-silicona` (update) |
| `GORRAS SURTIDAS.pdf` | 220 | `gorras-polemik` (update) |
| `POLEMIK RELOJES NUEVA COLECCION.pdf` | 157 | new `relojes-polemik-superior` (Caballero/Dama/Unisex sections only) |

Analysis already done (read-only, results below are the starting point; the plan re-derives exact lists before touching files):

- **Quimicos:** same 14 products as the site, same page order as the site's existing page renders. Likely only visual differences.
- **Recargables:** pages 2–12 = the 11 current products; page 13 = section divider "Estaciones de Energía"; pages 14–21 = **8 new** products `ESTACION-500W/600W/800W/1000W/1200W/1500W/2000W/3000W`.
- **Silicona:** 64 product pages (page 1 is the cover). Matching by code token found anywhere on the page (some pages open with a "PIN INCLUIDO" banner, so the code is not always on the first line): **61 unchanged, 3 new** (`PUSI/TECH-01-20NG (TECHNOMARINE)`, `TECH-02-22NG`, `TECH-03-24NG`, pages 31–33), **0 removed**. (An earlier first-line-only parse wrongly suggested ~15 removals; that was a parsing artifact.)
- **Gorras:** 206 single-code pages (203 unique codes; `P-501` appears on 4 pages, as it already does in the current data) + 13 section divider pages. Pages 2–15 precede the first divider and are BORDADA in the current data. Against `gorras-polemik` (202 products): 195 unchanged, **8 new** (`P-86, P-87, P-88, P-89, P-90, P-91, P-92, P-95`), **7 absent** (`G-07, G-1020, P-24, P-606, P-610, P-620, P-631`). `gorras-lisas` has zero overlap and is not touched. Section dividers map 1:1 to the existing `estilo` values: CAMIONERAS AAA→CAMIONERA, CAMIONERAS ECONOMICA→ECONOMICA, CERRADA FLEX AAA→FLEX, HEBILLA→HEBILLA, CIERRE MAGICO IMPERMEABLE→IMPERMEABLE, BORDADAS CON HEBILLA→BORDADA, PLANAS AAA→PLANA, CUERINA→CUERINA, DAMA→DAMA, GOLEANAS→GOLEANA, BOINAS→BOINA, HEBILLA NIÑO→NINO, HEBILLA NIÑA→NINA.
- **Polemik master PDF** (the user's extended version of the Polemik PDF catalog built earlier this project, now with `REFERENCIA` codes): 54 Caballero (pages 3–56), 9 Dama (59–67), 4 Unisex (70–73), 10 Analógico (75–84), 60 Digital (89–148), 6 Estuches (151–157). Caballero/Dama/Unisex = 67 products with **zero** overlap with the current `relojes-polemik` catalog. Analógico/Digital/Estuches overlap the current catalog (Digital: 35 of 60 already on the site; Estuches: 3 of 6).

## Decisions

1. **Polemik split (user decision):** current `relojes-polemik` stays as "Polemik normal" (the models already carried). The new luxury models go in a new catalog "Polemik Superior". Interpretation applied: Superior = the Caballero + Dama + Unisex sections (67 new products). `relojes-polemik` is **not modified**.
2. **Removed SKUs** (absent from a new PDF) are dropped from the site for Track A catalogs — per the July playbook and the user's approval of this design. Verified result: only the 7 gorras listed above (silicona, recargables and quimicos have none).
3. **Superior PDF download** = pages 1–73 of the master PDF (cover + Caballero + Dama + Unisex). Known wart: its cover line lists all six sections (incl. Analógico/Digital/Estuches). Accepted; the user can supply a Superior-only deck later.
4. **Commits are local only.** No push/deploy until the user says so.

## Track A — per-catalog procedure

Follow the July playbook for each catalog (exact steps live in the plan):
- Extract per-page text; diff by `modelo` into kept / added / removed; write the three lists before touching files.
- Kept SKUs reuse their existing thumbnail (`public/images/productos/<slug>/<safe>.jpg`) unchanged. Added SKUs get a fresh crop. Removed SKUs' thumbnails are deleted.
- Re-render all pages to `public/catalogo-pages/<slug>/page-NN.jpg` at 1334×750 (modal view); delete stale pages beyond the new count.
- Rebuild `src/data/<json>` in new-PDF page order, same schema/field names.
- Copy the new upload to `public/catalogos/<slug>.pdf` (site download); the original-named upload stays untouched and uncommitted.
- Spot-check ≥5 pages per catalog against the JSON.

Catalog-specific notes:
- **Recargables:** new `tipo` value for the stations (e.g. "Estación") → add a pill in the `isBatRecargables` block of `src/pages/catalogo/[slug].astro` (the only UI change in Track A). Fill `capacidad`/`voltaje`/`descripcion` from what each station page states; leave empty what the page does not state (no invented specs).
- **Gorras:** investigate the 3 duplicated codes before building the JSON (same cap in two sections? keep both entries only if thumbnails can't collide; otherwise report and rule).
- **Quimicos:** if page renders are visually identical to the current ones, only the site PDF changes; if they differ, replace renders and thumbnails.

## Track B — Polemik Superior

- `src/data/catalogs.js`: add `{ slug: 'relojes-polemik-superior', label: 'Reloj Polemik Superior', structured: true }` to the `relojes` group.
- `src/data/relojes-polemik-superior.json`: 67 records in PDF order: `modelo` (the REFERENCIA code), `nombre`, `categoria` (CABALLERO | DAMA | UNISEX), `tipo` (feature tags array; a printed "WR 100M" stays a tag), `caja {material,color}` and `correa {material,color}` (both `null` on the 28 pages that use the short layout and print no case/strap block), `img` (page render path). No `resistenciaAgua` field. Parsed from the page text with two page layouts (full spec block: pages 3–28, 59–67, 70–73; short layout with 2–4 photos and a REFERENCIA+tags row: pages 29–56); verified visually. Orthography is normalised where the deck has typos ("Cronografo"→"Cronógrafo", "Clasico"→"Clásico", "FechaTitan"→"Fecha Titan").
- Thumbnails: the first embedded photo on each product page (front view; short-layout pages carry several views) via `pdfimages` → `public/images/productos/relojes-polemik-superior/<safe>.jpg`.
- Page renders for the modal: `public/catalogo-pages/relojes-polemik-superior/page-NN.jpg` (1334×750).
- Site PDF: `public/catalogos/relojes-polemik-superior.pdf` (pages 1–73, extracted with `pypdf` from a scratch venv; `pdfseparate`+`pdfunite` duplicate shared resources and balloon the file to ~25 MB, `pypdf` gives ~7 MB).
- Viewer: new `isPolemikSuperior` block in `src/pages/catalogo/[slug].astro`, copying the structure of an existing block (search by referencia/nombre; pills Todos / Caballero / Dama / Unisex; grid of `CatalogCard`; modal showing the PDF page). Reuse `CatalogCard`; add only the minimal prop/badge handling needed (e.g. a UNISEX badge style). Register the new slug wherever the other `is*` flags are wired (data import, `products` selector, `define:vars` list, the init condition in the script).
- `relojes-polemik` (existing) is untouched.

## Verification

- `npx astro build` passes; every updated/new catalog page generates.
- `astro preview` + Playwright: for each of the 5 catalogs — product count label matches the JSON length, search works, pills filter correctly, modal opens with the right page, PDF download link resolves.
- `git status` shows only files belonging to these catalogs (no `dist/`, no `.DS_Store`, no original-named uploads).

## Out of Scope

- Adding the master PDF's new Digital (25), new Estuches (3) and Analógico (10) items to Polemik normal — left for a follow-up if the user wants them (the user said to leave Polemik normal as is).
- `gorras-lisas`, homepage changes, push/deploy.
