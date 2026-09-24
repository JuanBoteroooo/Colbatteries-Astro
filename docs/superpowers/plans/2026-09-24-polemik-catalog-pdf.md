# Polemik "Nueva Colección" Catalog PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a high-quality, downloadable PDF catalog (`public/catalogos/polemik-nueva-coleccion.pdf`) for 44 new Polemik watch photos, matching the production quality of the Batterycell Q&Q reference catalog.

**Architecture:** 44 unlabeled supplier photos get renamed into a stable, numbered sequence and manually curated into a JSON data file (category, descriptive name, visible-feature tags, case/strap material and color — no invented specs, no model codes). A Node script builds one HTML document (Colbateries brand CSS: cover → per-category divider → thumbnail overview grid → one full page per watch) and uses Playwright's Chromium to export it to a single multi-page PDF with `page.pdf()`, giving vector text instead of rasterized images.

**Tech Stack:** Node.js (ESM `.mjs` scripts, matching the existing `scripts/parse-eta.mjs` convention), `playwright` (`^1.59.1`, already a devDependency, Chromium already downloaded locally), plain HTML/CSS (no build step needed for the generator — it's a standalone script, not part of the Astro site build).

**Spec:** `docs/superpowers/specs/2026-09-24-polemik-catalog-pdf-design.md`

## Global Constraints

- Output file: `public/catalogos/polemik-nueva-coleccion.pdf` (matches the site's existing `public/catalogos/*.pdf` convention).
- Page size: A4 portrait (210mm × 297mm), zero page margin (`@page { margin: 0 }`), each sheet's own internal padding handles inset spacing.
- Brand colors (exact hex, from the site's own `:root` tokens): blue `#024598`, yellow `#f2a900`, gray-900 `#111827`.
- Fonts: Montserrat (headings) and Inter (body) — same as the rest of the site.
- No model codes anywhere in the catalog — identify each watch by category + a short descriptive name only.
- No fabricated technical specs (no invented movement, exact case size, or exact water-resistance rating) — only what's visibly printed on the dial or reasonably described from the photo (case/strap material and color). Omit a field entirely rather than guess it.
- No automated test suite for this content-generation script — verification is running it and inspecting the real output, consistent with how the project's other one-off catalog/data scripts (e.g. `scripts/parse-eta.mjs`) are handled.
- Do not touch `src/data/relojes-polemik.json`, `catalogs.js`, or any `/catalogo/*` page — website integration is a later, separate phase.

---

### Task 1: Extract and normalize the 44 source photos

**Files:**
- Create: `public/images/productos/polemik-nueva-coleccion/polemik-01.jpg` … `polemik-44.jpg` (44 new binary files)

**Interfaces:**
- Produces: 44 JPEG files at `public/images/productos/polemik-nueva-coleccion/polemik-NN.jpg` (NN = `01`…`44`, zero-padded), in a **fixed, deterministic order** that Task 2 depends on by ID (not by re-deriving the order itself).

The fixed order (source filename → new ID) — this is the exact output of `find <extracted-dir> -iname "*.jpeg" -not -path "*__MACOSX*" | sort`, already verified once during planning:

```
01: WhatsApp Image 2026-09-18 at 13.36.34 (1).jpeg
02: WhatsApp Image 2026-09-18 at 13.36.34 (2).jpeg
03: WhatsApp Image 2026-09-18 at 13.36.34 (3).jpeg
04: WhatsApp Image 2026-09-18 at 13.36.34.jpeg
05: WhatsApp Image 2026-09-18 at 13.36.35 (1).jpeg
06: WhatsApp Image 2026-09-18 at 13.36.35 (2).jpeg
07: WhatsApp Image 2026-09-18 at 13.36.35 (3).jpeg
08: WhatsApp Image 2026-09-18 at 13.36.35 (4).jpeg
09: WhatsApp Image 2026-09-18 at 13.36.35.jpeg
10: WhatsApp Image 2026-09-18 at 13.36.36 (1).jpeg
11: WhatsApp Image 2026-09-18 at 13.36.36 (2).jpeg
12: WhatsApp Image 2026-09-18 at 13.36.36 (3).jpeg
13: WhatsApp Image 2026-09-18 at 13.36.36 (4).jpeg
14: WhatsApp Image 2026-09-18 at 13.36.36 (5).jpeg
15: WhatsApp Image 2026-09-18 at 13.36.36.jpeg
16: WhatsApp Image 2026-09-18 at 13.36.37 (1).jpeg
17: WhatsApp Image 2026-09-18 at 13.36.37 (2).jpeg
18: WhatsApp Image 2026-09-18 at 13.36.37 (3).jpeg
19: WhatsApp Image 2026-09-18 at 13.36.37 (4).jpeg
20: WhatsApp Image 2026-09-18 at 13.36.37.jpeg
21: WhatsApp Image 2026-09-18 at 13.36.38 (1).jpeg
22: WhatsApp Image 2026-09-18 at 13.36.38 (2).jpeg
23: WhatsApp Image 2026-09-18 at 13.36.38 (3).jpeg
24: WhatsApp Image 2026-09-18 at 13.36.38 (4).jpeg
25: WhatsApp Image 2026-09-18 at 13.36.38.jpeg
26: WhatsApp Image 2026-09-18 at 13.36.39 (1).jpeg
27: WhatsApp Image 2026-09-18 at 13.36.39 (2).jpeg
28: WhatsApp Image 2026-09-18 at 13.36.39 (3).jpeg
29: WhatsApp Image 2026-09-18 at 13.36.39 (4).jpeg
30: WhatsApp Image 2026-09-18 at 13.36.39 (5).jpeg
31: WhatsApp Image 2026-09-18 at 13.36.39.jpeg
32: WhatsApp Image 2026-09-18 at 13.36.40 (1).jpeg
33: WhatsApp Image 2026-09-18 at 13.36.40 (2).jpeg
34: WhatsApp Image 2026-09-18 at 13.36.40 (3).jpeg
35: WhatsApp Image 2026-09-18 at 13.36.40 (4).jpeg
36: WhatsApp Image 2026-09-18 at 13.36.40.jpeg
37: WhatsApp Image 2026-09-18 at 13.36.41 (1).jpeg
38: WhatsApp Image 2026-09-18 at 13.36.41 (2).jpeg
39: WhatsApp Image 2026-09-18 at 13.36.41 (3).jpeg
40: WhatsApp Image 2026-09-18 at 13.36.41 (4).jpeg
41: WhatsApp Image 2026-09-18 at 13.36.41.jpeg
42: WhatsApp Image 2026-09-18 at 13.36.42 (1).jpeg
43: WhatsApp Image 2026-09-18 at 13.36.42 (2).jpeg
44: WhatsApp Image 2026-09-18 at 13.36.42.jpeg
```

- [ ] **Step 1: Extract the source zip to a scratch directory**

```bash
mkdir -p /tmp/polemik-src
unzip -o -q "/Users/juanbotero/Downloads/POLEMIK-WCHS.zip" -d /tmp/polemik-src
find /tmp/polemik-src -iname "*.jpeg" -not -path "*__MACOSX*" | wc -l
```
Expected: `44`

- [ ] **Step 2: Copy and rename into the site's public images folder, in the fixed sorted order**

```bash
mkdir -p /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion
i=1
find /tmp/polemik-src -iname "*.jpeg" -not -path "*__MACOSX*" | sort | while read -r f; do
  n=$(printf "%02d" "$i")
  cp "$f" "/Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion/polemik-$n.jpg"
  i=$((i+1))
done
```

- [ ] **Step 3: Verify all 44 files landed correctly, matching the fixed order table above**

```bash
ls /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion | sort | wc -l
ls /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion | sort | head -3
ls /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion | sort | tail -3
```
Expected: `44`, then `polemik-01.jpg`, `polemik-02.jpg`, `polemik-03.jpg`, then `polemik-42.jpg`, `polemik-43.jpg`, `polemik-44.jpg`.

- [ ] **Step 4: Spot-check 2 files actually open as valid images**

```bash
file /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion/polemik-01.jpg
file /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/images/productos/polemik-nueva-coleccion/polemik-44.jpg
```
Expected: both report `JPEG image data` with plausible pixel dimensions (not `0x0` or `empty`).

- [ ] **Step 5: Commit**

```bash
cd /Users/juanbotero/Documents/GitHub/Colbatteries-Astro
git add public/images/productos/polemik-nueva-coleccion/
git commit -m "Add normalized Polemik nueva colección product photos (44)"
```

---

### Task 2: Curate the product data JSON

**Files:**
- Create: `src/data/polemik-nueva-coleccion.json`

**Interfaces:**
- Consumes: the 44 files at `public/images/productos/polemik-nueva-coleccion/polemik-NN.jpg` from Task 1, in the same fixed order.
- Produces: a JSON array of exactly 44 records matching this shape (TypeScript for documentation only — the file itself is plain JSON):

```ts
interface PolemikRecord {
  id: string;              // "polemik-01" … "polemik-44"
  categoria: 'Caballero' | 'Dama' | 'Unisex';
  nombre: string;           // short descriptive name, NOT a code
  tipo: string[];           // visible-feature tags, e.g. ["Cronógrafo", "Taquímetro"]
  resistenciaAgua: string | null;  // e.g. "5 BAR" — null if not printed on the dial
  caja: { material: string; color: string };
  correa: { material: string; color: string };
  img: string;              // "/images/productos/polemik-nueva-coleccion/polemik-01.jpg"
}
```

This is consumed by Task 3's generator script, which reads this exact field set — do not rename fields.

**Classification heuristics:**
- `categoria`: "Dama" for visibly smaller/thinner cases with delicate bracelets aimed at women; "Caballero" for standard/large men's sport or dress cases (the large majority of this batch); "Unisex" only for styles with no clear gendering (e.g. plain retro digital squares).
- `tipo`: read the tags directly off what's printed on the dial/subdials — common ones you'll see repeated: `"Cronógrafo"` (multiple subdials), `"Taquímetro"` (a "TACHYMETRE"/tachymeter scale on the bezel), `"Digital"` (LCD segment display present), `"Dual Time"` (dial literally says "DUAL TIME" or has two time zones), `"Clásico"` (simple 2-3 hand dress watch, no complications), `"Día y Fecha"` (a day+date window, e.g. "WED 8"), `"Countdown"` (dial says "COUNTDOWN"), `"Edición Especial"` (novelty dial art, e.g. a car-rim design).
- `resistenciaAgua`: only fill this when the dial literally prints a rating like "WR 5 BAR" or "WR 30M" — leave `null` otherwise, even if you assume most quartz watches have some water resistance. Do not guess a number.
- `caja`/`correa` `material`: almost everything in this batch is `"Acero inoxidable"` (steel case/bracelet) or the strap is `"Caucho"` (rubber/silicone strap, matches watches with a black rubber band) — use your eyes on each individual photo, don't default without looking.
- `caja`/`correa` `color`: plain description of what you see — `"Dorado"`, `"Plateado"`, `"Negro"`, `"Bicolor dorado y plateado"`, etc.

**13 records are already fully worked out** (verified against the actual photos during design) — use these exactly as given, do not re-derive them:

```json
[
  {
    "id": "polemik-04",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Digital Dorado y Negro",
    "tipo": ["Cronógrafo", "Digital", "Alarma"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Negro y dorado" },
    "correa": { "material": "Silicona", "color": "Negro" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-04.jpg"
  },
  {
    "id": "polemik-09",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Taquímetro Plateado",
    "tipo": ["Cronógrafo", "Taquímetro"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Plateado" },
    "correa": { "material": "Acero inoxidable", "color": "Plateado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-09.jpg"
  },
  {
    "id": "polemik-10",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Bicolor Blanco",
    "tipo": ["Cronógrafo", "Taquímetro"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Bicolor dorado y plateado" },
    "correa": { "material": "Acero inoxidable", "color": "Bicolor dorado y plateado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-10.jpg"
  },
  {
    "id": "polemik-11",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Bicolor Negro",
    "tipo": ["Cronógrafo", "Taquímetro"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Bicolor dorado y plateado" },
    "correa": { "material": "Acero inoxidable", "color": "Bicolor dorado y plateado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-11.jpg"
  },
  {
    "id": "polemik-12",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Deportivo Dorado y Negro",
    "tipo": ["Cronógrafo", "Taquímetro"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Caucho", "color": "Negro" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-12.jpg"
  },
  {
    "id": "polemik-13",
    "categoria": "Caballero",
    "nombre": "Cronógrafo Octagonal Plateado",
    "tipo": ["Cronógrafo"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Plateado" },
    "correa": { "material": "Acero inoxidable", "color": "Plateado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-13.jpg"
  },
  {
    "id": "polemik-14",
    "categoria": "Caballero",
    "nombre": "Dual Time Deportivo Dorado",
    "tipo": ["Cronógrafo", "Dual Time", "Digital"],
    "resistenciaAgua": "5 BAR",
    "caja": { "material": "Acero inoxidable", "color": "Dorado y negro" },
    "correa": { "material": "Caucho", "color": "Negro" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-14.jpg"
  },
  {
    "id": "polemik-15",
    "categoria": "Caballero",
    "nombre": "Clásico Dorado Bisel Estriado",
    "tipo": ["Clásico"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Acero inoxidable", "color": "Dorado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-15.jpg"
  },
  {
    "id": "polemik-25",
    "categoria": "Caballero",
    "nombre": "Clásico Dorado con Cristales",
    "tipo": ["Clásico", "Día y Fecha"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Acero inoxidable", "color": "Dorado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-25.jpg"
  },
  {
    "id": "polemik-31",
    "categoria": "Caballero",
    "nombre": "Edición Especial Rin Deportivo",
    "tipo": ["Clásico", "Edición Especial"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Negro" },
    "correa": { "material": "Acero inoxidable", "color": "Negro" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-31.jpg"
  },
  {
    "id": "polemik-36",
    "categoria": "Dama",
    "nombre": "Clásico Dorado Dama",
    "tipo": ["Clásico"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Acero inoxidable", "color": "Dorado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-36.jpg"
  },
  {
    "id": "polemik-41",
    "categoria": "Caballero",
    "nombre": "Clásico Dorado Textura Panal",
    "tipo": ["Clásico", "Día y Fecha"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Acero inoxidable", "color": "Dorado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-41.jpg"
  },
  {
    "id": "polemik-44",
    "categoria": "Unisex",
    "nombre": "Digital Retro Dorado",
    "tipo": ["Digital", "Dual Time", "Countdown"],
    "resistenciaAgua": null,
    "caja": { "material": "Acero inoxidable", "color": "Dorado" },
    "correa": { "material": "Acero inoxidable", "color": "Dorado" },
    "img": "/images/productos/polemik-nueva-coleccion/polemik-44.jpg"
  }
]
```

- [ ] **Step 1: View the remaining 31 photos and write their records**

View each of these files with your image-reading tool and write one record per file, following the schema and heuristics above:
`polemik-01, 02, 03, 05, 06, 07, 08, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 32, 33, 34, 35, 37, 38, 39, 40, 42, 43`

(That's 31 files — the other 13 are already given above. 13 + 31 = 44.)

- [ ] **Step 2: Assemble the full 44-record JSON array**

Combine the 13 given records with your 31 new ones into a single JSON array, sorted by `id` (`polemik-01` through `polemik-44`), and write it to `src/data/polemik-nueva-coleccion.json`.

- [ ] **Step 3: Validate the JSON**

```bash
cd /Users/juanbotero/Documents/GitHub/Colbatteries-Astro
node -e "
const data = JSON.parse(require('fs').readFileSync('src/data/polemik-nueva-coleccion.json', 'utf-8'));
console.log('records:', data.length);
console.log('unique ids:', new Set(data.map(r => r.id)).size);
console.log('categories:', [...new Set(data.map(r => r.categoria))]);
const bad = data.filter(r => !r.id || !r.categoria || !r.nombre || !Array.isArray(r.tipo) || !r.caja?.material || !r.correa?.material || !r.img);
console.log('records missing required fields:', bad.length);
"
```
Expected: `records: 44`, `unique ids: 44`, `categories:` only contains values from `['Caballero','Dama','Unisex']`, `records missing required fields: 0`.

- [ ] **Step 4: Verify every `img` path actually exists on disk**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/data/polemik-nueva-coleccion.json', 'utf-8'));
const missing = data.filter(r => !fs.existsSync('public' + r.img));
console.log('missing image files:', missing.map(r => r.id));
"
```
Expected: `missing image files: []`

- [ ] **Step 5: Commit**

```bash
git add src/data/polemik-nueva-coleccion.json
git commit -m "Add curated product data for the Polemik nueva colección catalog"
```

---

### Task 3: Build the Playwright PDF generator and produce the catalog

**Files:**
- Create: `scripts/generate-polemik-catalog.mjs`
- Modify: `package.json` (add an npm script alias)

**Interfaces:**
- Consumes: `src/data/polemik-nueva-coleccion.json` (Task 2's exact record shape) and the 44 images at `public/images/productos/polemik-nueva-coleccion/` (Task 1).
- Produces: `public/catalogos/polemik-nueva-coleccion.pdf`.

- [ ] **Step 1: Create `scripts/generate-polemik-catalog.mjs`**

```js
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'src/data/polemik-nueva-coleccion.json');
const imgDir = path.join(root, 'public/images/productos/polemik-nueva-coleccion');
const outPath = path.join(root, 'public/catalogos/polemik-nueva-coleccion.pdf');
const logoPath = path.join(root, 'public/logo.jpeg');

const records = JSON.parse(readFileSync(dataPath, 'utf-8'));

for (const r of records) {
  const imgFile = path.join(imgDir, path.basename(r.img));
  if (!existsSync(imgFile)) {
    console.error(`Missing image for ${r.id}: expected ${imgFile}`);
    process.exit(1);
  }
}

const CATEGORY_ORDER = ['Caballero', 'Dama', 'Unisex'];
const byCategory = Object.fromEntries(
  CATEGORY_ORDER.map((c) => [c, records.filter((r) => r.categoria === c)])
);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function imgSrc(r) {
  return `file://${path.join(imgDir, path.basename(r.img))}`;
}

function coverSheet() {
  const tags = CATEGORY_ORDER.filter((c) => byCategory[c].length > 0).join(' · ');
  return `
  <section class="sheet cover">
    <img class="cover-logo" src="file://${logoPath}" />
    <div class="cover-title-bar">CATÁLOGO</div>
    <div class="cover-sub">DE RELOJES</div>
    <div class="cover-brand">POLEMIK</div>
    <div class="cover-tags">${esc(tags)}</div>
    <div class="cover-note">Nueva colección — sin precios</div>
  </section>`;
}

function dividerSheet(cat, count) {
  return `
  <section class="sheet divider">
    <img class="divider-logo" src="file://${logoPath}" />
    <div class="divider-title">${esc(cat.toUpperCase())}</div>
    <div class="divider-count">${count} modelo${count === 1 ? '' : 's'} disponible${count === 1 ? '' : 's'}</div>
  </section>`;
}

function gridSheets(cat, items) {
  const perPage = 15;
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages
    .map(
      (pageItems) => `
  <section class="sheet grid-sheet">
    <div class="grid-header"><span>${esc(cat.toUpperCase())} — VISTA GENERAL</span></div>
    <div class="grid-body">
      ${pageItems
        .map(
          (r) => `
        <div class="grid-item">
          <img src="${imgSrc(r)}" />
          <span>${esc(r.nombre)}</span>
        </div>`
        )
        .join('')}
    </div>
  </section>`
    )
    .join('');
}

function productSheet(cat, r) {
  return `
  <section class="sheet product-sheet">
    <div class="product-header">
      <span>${esc(r.nombre)}</span>
      <span class="badge">${esc(cat)}</span>
    </div>
    <div class="product-body">
      <div class="product-photo-card"><img src="${imgSrc(r)}" /></div>
      <div class="product-info">
        <div class="product-tags">
          ${r.tipo.map((t) => `<span>${esc(t)}</span>`).join('')}
        </div>
        <div class="spec-section">
          <h4>Caja</h4>
          <div class="spec-row">
            <div class="spec-field"><label>Material</label><strong>${esc(r.caja.material)}</strong></div>
            <div class="spec-field"><label>Color</label><strong>${esc(r.caja.color)}</strong></div>
          </div>
        </div>
        <div class="spec-section">
          <h4>Correa</h4>
          <div class="spec-row">
            <div class="spec-field"><label>Material</label><strong>${esc(r.correa.material)}</strong></div>
            <div class="spec-field"><label>Color</label><strong>${esc(r.correa.color)}</strong></div>
          </div>
        </div>
        ${
          r.resistenciaAgua
            ? `<div class="spec-section">
          <h4>Resistencia al agua</h4>
          <div class="spec-field"><strong>${esc(r.resistenciaAgua)}</strong></div>
        </div>`
            : ''
        }
      </div>
    </div>
  </section>`;
}

let sheets = coverSheet();
for (const cat of CATEGORY_ORDER) {
  const items = byCategory[cat];
  if (items.length === 0) continue;
  sheets += dividerSheet(cat, items.length);
  sheets += gridSheets(cat, items);
  sheets += items.map((r) => productSheet(cat, r)).join('');
}

const CSS = `
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', Arial, sans-serif; color: #111827; }
  .sheet { width: 210mm; height: 297mm; position: relative; overflow: hidden;
           display: flex; flex-direction: column; break-after: page; }
  .sheet:last-child { break-after: auto; }

  .cover, .divider { align-items: center; justify-content: center; text-align: center; gap: 1.25rem; }
  .cover-logo { width: 130px; }
  .cover-title-bar { background: #024598; color: #fff; padding: 1rem 3rem;
    font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 2.2rem; letter-spacing: 0.05em; }
  .cover-sub { font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 1.6rem; color: #111827; }
  .cover-brand { font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 3rem; color: #f2a900; }
  .cover-tags { font-weight: 800; letter-spacing: 0.1em; color: #024598; text-transform: uppercase; font-size: 0.9rem; }
  .cover-note { color: #9ca3af; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }

  .divider { background: #024598; color: #fff; }
  .divider-logo { width: 100px; filter: brightness(0) invert(1); }
  .divider-title { font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 3rem; }
  .divider-count { color: #f2a900; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; font-size: 1rem; }

  .grid-sheet, .product-sheet { padding: 14mm; }
  .grid-header, .product-header { background: #024598; color: #fff; padding: 0.9rem 1.5rem;
    font-family: 'Montserrat', Arial, sans-serif; font-weight: 900; font-size: 1.2rem;
    display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.4rem; }
  .product-header .badge { background: #f2a900; color: #111827; font-size: 0.65rem; font-weight: 800;
    padding: 0.35rem 0.9rem; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.08em; }

  .grid-body { display: grid; grid-template-columns: repeat(5, 1fr); gap: 9mm 6mm; }
  .grid-item { text-align: center; }
  .grid-item img { width: 100%; height: 32mm; object-fit: contain; }
  .grid-item span { display: block; font-size: 0.6rem; font-weight: 600; color: #374151; margin-top: 0.3rem; }

  .product-body { display: flex; gap: 2rem; flex: 1; }
  .product-photo-card { flex: 0 0 45%; background: #f3f4f6; border-radius: 12px;
    display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
  .product-photo-card img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .product-info { flex: 1; display: flex; flex-direction: column; gap: 1.2rem; }
  .product-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .product-tags span { background: #eef2fa; color: #024598; font-size: 0.68rem; font-weight: 700;
    padding: 0.35rem 0.7rem; border-radius: 100px; }
  .spec-section h4 { display: flex; align-items: center; gap: 0.45rem; font-size: 0.72rem; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.08em; color: #111827; margin-bottom: 0.5rem; }
  .spec-section h4::before { content: ''; width: 8px; height: 8px; background: #f2a900; display: inline-block; }
  .spec-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; }
  .spec-field label { display: block; font-size: 0.6rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
  .spec-field strong { display: block; font-size: 0.85rem; color: #111827; font-weight: 700; }
`;

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>${CSS}</style>
</head>
<body>${sheets}</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
await browser.close();

console.log(`Wrote ${outPath}`);
console.log(`Records: ${records.length} | Caballero: ${byCategory.Caballero.length} | Dama: ${byCategory.Dama.length} | Unisex: ${byCategory.Unisex.length}`);
```

- [ ] **Step 2: Add an npm script alias**

In `package.json`, inside `"scripts"`, add (following the existing `"parse:eta"` entry style):

```json
"generate:polemik-catalog": "node scripts/generate-polemik-catalog.mjs"
```

- [ ] **Step 3: Run the generator**

```bash
cd /Users/juanbotero/Documents/GitHub/Colbatteries-Astro
npm run generate:polemik-catalog
```
Expected output ends with something like:
```
Wrote /Users/juanbotero/Documents/GitHub/Colbatteries-Astro/public/catalogos/polemik-nueva-coleccion.pdf
Records: 44 | Caballero: <N> | Dama: <N> | Unisex: <N>
```
(The exact per-category counts depend on Task 2's classifications — just confirm they sum to 44 and the file path matches.)

- [ ] **Step 4: Verify the PDF was written and has a sane page count**

```bash
ls -la public/catalogos/polemik-nueva-coleccion.pdf
python3 -c "
import re
data = open('public/catalogos/polemik-nueva-coleccion.pdf', 'rb').read()
print('pages:', len(re.findall(rb'/Type\s*/Page[^s]', data)))
"
```
Expected: the file exists with a non-trivial size (several MB, given 44 embedded photos), and the page count is `1 (cover) + (1 divider + ceil(count/15) grid sheets + count product sheets) per non-empty category`. For example, with 42 Caballero / 1 Dama / 1 Unisex: `1 + (1+3+42) + (1+1+1) + (1+1+1) = 1 + 46 + 3 + 3 = 53`. Recompute with your actual Task 2 category counts and confirm the script's printed counts match.

- [ ] **Step 5: Open the PDF and visually confirm quality**

Open `public/catalogos/polemik-nueva-coleccion.pdf` in a PDF viewer (or read a few pages with an image-capable tool) and confirm:
- Cover page shows the Colbateries logo, "CATÁLOGO DE RELOJES", "POLEMIK", category tags, and the "sin precios" note, correctly centered.
- Every category present in the data has a blue divider page and at least one overview grid page with legible thumbnails + names.
- At least 3 individual product pages render with: full product photo on the light card, the descriptive name in the blue header bar, the category badge, the visible `tipo` pills, and the Caja/Correa spec rows — no cut-off text, no missing images, no layout overlap.
- No blank trailing page after the very last product sheet.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-polemik-catalog.mjs package.json public/catalogos/polemik-nueva-coleccion.pdf
git commit -m "Add Playwright-based generator for the Polemik nueva colección PDF catalog"
```

---

## Post-plan checklist (manual, run once all tasks are done)

- [ ] Send `public/catalogos/polemik-nueva-coleccion.pdf` to yourself via WhatsApp/email once to confirm the file isn't corrupted and opens cleanly outside this machine.
- [ ] Confirm `git log --oneline -3` shows the three commits (images, data, generator+PDF) in order.
- [ ] Note for the next phase (explicitly deferred here): adding a `catalogs.js` entry and a `/catalogo/polemik-nueva-coleccion` viewer page that reuses `src/data/polemik-nueva-coleccion.json`.
