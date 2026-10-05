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
- **Silicona:** each page's first line is `CODE  description`; ~41 products unchanged, ~3 new (`PUSI/TECH-01-20NG`, `TECH-02-22NG`, `TECH-03-24NG`), ~15 absent from the new PDF (the "CON PIN FÁCIL" J8xxx series, `F003`/`F004`, `J3167-16V/AZ/RJ/AM/NJ`). Exact lists must come from a code-token parse (code and description share a line).
- **Gorras:** 206 single-code pages (203 unique codes; 3 duplicated codes inside the PDF) + section divider pages. Against `gorras-polemik` (202 products): 195 unchanged, **8 new** (`P-86, P-87, P-88, P-89, P-90, P-91, P-92, P-95`), **7 absent** (`G-07, G-1020, P-24, P-606, P-610, P-620, P-631`). `gorras-lisas` has zero overlap and is not touched. Section dividers map 1:1 to the existing `estilo` values: CAMIONERAS AAA→CAMIONERA, CAMIONERAS ECONOMICA→ECONOMICA, CERRADA FLEX AAA→FLEX, HEBILLA→HEBILLA, CIERRE MAGICO IMPERMEABLE→IMPERMEABLE, BORDADAS CON HEBILLA→BORDADA, PLANAS AAA→PLANA, CUERINA→CUERINA, DAMA→DAMA, GOLEANAS→GOLEANA, BOINAS→BOINA, HEBILLA NIÑO→NINO, HEBILLA NIÑA→NINA.
- **Polemik master PDF** (the user's extended version of the Polemik PDF catalog built earlier this project, now with `REFERENCIA` codes): 54 Caballero (pages 3–56), 9 Dama (59–67), 4 Unisex (70–73), 10 Analógico (75–84), 60 Digital (89–148), 6 Estuches (151–157). Caballero/Dama/Unisex = 67 products with **zero** overlap with the current `relojes-polemik` catalog. Analógico/Digital/Estuches overlap the current catalog (Digital: 35 of 60 already on the site; Estuches: 3 of 6).

## Decisions

1. **Polemik split (user decision):** current `relojes-polemik` stays as "Polemik normal" (the models already carried). The new luxury models go in a new catalog "Polemik Superior". Interpretation applied: Superior = the Caballero + Dama + Unisex sections (67 new products). `relojes-polemik` is **not modified**.
2. **Removed SKUs** (absent from a new PDF) are dropped from the site for Track A catalogs — per the July playbook and the user's approval of this design. (7 gorras, ~15 pulsos.)
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
- `src/data/relojes-polemik-superior.json`: 67 records in PDF order: `modelo` (the REFERENCIA code), `nombre`, `categoria` (CABALLERO | DAMA | UNISEX), `tipo` (feature tags array), `caja {material,color}`, `correa {material,color}`, `resistenciaAgua` (only if printed), `img` (page render path). Parsed from the page text; verified visually.
- Thumbnails: each product page embeds one JPEG of the watch (`pdfimages -j`, ≥700 px) → `public/images/productos/relojes-polemik-superior/<safe>.jpg`.
- Page renders for the modal: `public/catalogo-pages/relojes-polemik-superior/page-NN.jpg` (1334×750).
- Site PDF: `public/catalogos/relojes-polemik-superior.pdf` (pages 1–73).
- Viewer: new `isPolemikSuperior` block in `src/pages/catalogo/[slug].astro`, copying the structure of an existing block (search by referencia/nombre; pills Todos / Caballero / Dama / Unisex; grid of `CatalogCard`; modal showing the PDF page). Reuse `CatalogCard`; add only the minimal prop/badge handling needed (e.g. a UNISEX badge style). Register the new slug wherever the other `is*` flags are wired (data import, `products` selector, `define:vars` list, the init condition in the script).
- `relojes-polemik` (existing) is untouched.

## Verification

- `npx astro build` passes; every updated/new catalog page generates.
- `astro preview` + Playwright: for each of the 5 catalogs — product count label matches the JSON length, search works, pills filter correctly, modal opens with the right page, PDF download link resolves.
- `git status` shows only files belonging to these catalogs (no `dist/`, no `.DS_Store`, no original-named uploads).

## Out of Scope

- Adding the master PDF's new Digital (25), new Estuches (3) and Analógico (10) items to Polemik normal — left for a follow-up if the user wants them (the user said to leave Polemik normal as is).
- `gorras-lisas`, homepage changes, push/deploy.
