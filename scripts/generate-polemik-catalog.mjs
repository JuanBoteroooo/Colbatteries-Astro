import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

const categorizedCount = CATEGORY_ORDER.reduce((sum, c) => sum + byCategory[c].length, 0);
if (categorizedCount !== records.length) {
  const known = new Set(CATEGORY_ORDER);
  const bad = records.filter((r) => !known.has(r.categoria)).map((r) => `${r.id} (categoria: ${JSON.stringify(r.categoria)})`);
  console.error(`Unrecognized categoria on ${bad.length} record(s): ${bad.join(', ')}`);
  process.exit(1);
}

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
    <div class="divider-logo-card"><img class="divider-logo" src="file://${logoPath}" /></div>
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
        ${
          (r.tipo ?? []).length > 0
            ? `<div class="product-tags">
          ${r.tipo.map((t) => `<span>${esc(t)}</span>`).join('')}
        </div>`
            : ''
        }
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
  .divider-logo-card { background: #fff; border-radius: 16px; padding: 1.1rem 1.5rem;
    display: inline-flex; align-items: center; justify-content: center; }
  .divider-logo { width: 100px; display: block; }
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

  .product-body { display: flex; align-items: flex-start; gap: 2.5rem; margin: 0.5rem 0 0; }
  .product-photo-card { flex: 0 0 62%; aspect-ratio: 1 / 1; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    display: flex; align-items: center; justify-content: center; padding: 2.5rem; }
  .product-photo-card img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .product-info { flex: 1; display: flex; flex-direction: column; gap: 2rem; padding-top: 1.5rem; }
  .product-tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .product-tags span { background: #eef2fa; color: #024598; font-size: 0.8rem; font-weight: 700;
    padding: 0.5rem 1rem; border-radius: 100px; }
  .spec-section h4 { display: flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.08em; color: #111827; margin-bottom: 0.9rem; }
  .spec-section h4::before { content: ''; width: 8px; height: 8px; background: #f2a900; display: inline-block; }
  .spec-row { display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
  .spec-field label { display: block; font-size: 0.7rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
  .spec-field strong { display: block; font-size: 1rem; color: #111827; font-weight: 700; }
`;

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&family=Montserrat:wght@700;800;900&display=swap"
  rel="stylesheet"
/>
<style>${CSS}</style>
</head>
<body>${sheets}</body>
</html>`;

// Chromium refuses to load file:// image resources from a page whose
// document was set via page.setContent() (its origin is opaque, not
// file://), logging "Not allowed to load local resource" and leaving every
// <img> broken. Writing the HTML to a real file and navigating to it via
// file:// gives the document a file:// origin, so the file:// image/logo
// sources load normally.
const tmpHtmlPath = path.join(os.tmpdir(), `polemik-catalog-${process.pid}.html`);
writeFileSync(tmpHtmlPath, html, 'utf-8');

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${tmpHtmlPath}`, { waitUntil: 'networkidle' });
  await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
} finally {
  if (browser) await browser.close();
  rmSync(tmpHtmlPath, { force: true });
}

console.log(`Wrote ${outPath}`);
console.log(`Records: ${records.length} | Caballero: ${byCategory.Caballero.length} | Dama: ${byCategory.Dama.length} | Unisex: ${byCategory.Unisex.length}`);
