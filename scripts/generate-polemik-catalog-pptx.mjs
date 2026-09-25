import pptxgen from 'pptxgenjs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'src/data/polemik-nueva-coleccion.json');
const imgDir = path.join(root, 'public/images/productos/polemik-nueva-coleccion');
const outPath = path.join(root, 'public/catalogos/polemik-nueva-coleccion.pptx');
const logoPath = path.join(root, 'public/logo.jpeg');

const BLUE = '024598';
const YELLOW = 'F2A900';
const INK = '111827';
const MUTED = '9CA3AF';
const LABEL = '6B7280';
const TAG_BG = 'EEF2FA';
const CARD_BORDER = 'E5E7EB';
const WHITE = 'FFFFFF';
const FONT = 'Arial';

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

function imgPath(r) {
  return path.join(imgDir, path.basename(r.img));
}

const pres = new pptxgen();
pres.defineLayout({ name: 'DESKTOP_WIDE', width: 13.333, height: 7.5 });
pres.layout = 'DESKTOP_WIDE';

const PAGE_W = 13.333;
const PAGE_H = 7.5;
const MARGIN = 0.5;
const CONTENT_W = PAGE_W - MARGIN * 2;

function coverSlide() {
  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  const tags = CATEGORY_ORDER.filter((c) => byCategory[c].length > 0).join('   ·   ');

  slide.addImage({ path: logoPath, x: PAGE_W / 2 - 0.9, y: 1.2, w: 1.8, h: 0.72, sizing: { type: 'contain', w: 1.8, h: 0.72 } });

  slide.addShape('rect', {
    x: PAGE_W / 2 - 2.6, y: 2.5, w: 5.2, h: 0.9,
    fill: { color: BLUE }, line: { type: 'none' },
  });
  slide.addText('CATÁLOGO', {
    x: PAGE_W / 2 - 2.6, y: 2.5, w: 5.2, h: 0.9,
    fontFace: FONT, fontSize: 32, bold: true, color: WHITE, align: 'center', valign: 'middle',
    charSpacing: 2, isTextBox: true,
  });

  slide.addText('DE RELOJES', {
    x: 0, y: 3.55, w: PAGE_W, h: 0.5,
    fontFace: FONT, fontSize: 22, bold: true, color: INK, align: 'center', valign: 'middle', isTextBox: true,
  });

  slide.addText('POLEMIK', {
    x: 0, y: 4.05, w: PAGE_W, h: 0.95,
    fontFace: FONT, fontSize: 44, bold: true, color: YELLOW, align: 'center', valign: 'middle', isTextBox: true,
  });

  slide.addText(tags.toUpperCase(), {
    x: 0, y: 5.05, w: PAGE_W, h: 0.4,
    fontFace: FONT, fontSize: 13, bold: true, color: BLUE, align: 'center', valign: 'middle', charSpacing: 2, isTextBox: true,
  });

  slide.addText('NUEVA COLECCIÓN  —  SIN PRECIOS', {
    x: 0, y: 5.5, w: PAGE_W, h: 0.35,
    fontFace: FONT, fontSize: 10, color: MUTED, align: 'center', valign: 'middle', charSpacing: 1.5, isTextBox: true,
  });
}

function dividerSlide(cat, count) {
  const slide = pres.addSlide();
  slide.background = { color: BLUE };

  slide.addShape('roundRect', {
    x: PAGE_W / 2 - 1.3, y: 2.15, w: 2.6, h: 1.05,
    rectRadius: 0.16, fill: { color: WHITE }, line: { type: 'none' },
  });
  slide.addImage({ path: logoPath, x: PAGE_W / 2 - 0.9, y: 2.4, w: 1.8, h: 0.55, sizing: { type: 'contain', w: 1.8, h: 0.55 } });

  slide.addText(cat.toUpperCase(), {
    x: 0, y: 3.55, w: PAGE_W, h: 1.0,
    fontFace: FONT, fontSize: 46, bold: true, color: WHITE, align: 'center', valign: 'middle', isTextBox: true,
  });

  const countLabel = `${count} MODELO${count === 1 ? '' : 'S'} DISPONIBLE${count === 1 ? '' : 'S'}`;
  slide.addText(countLabel, {
    x: 0, y: 4.6, w: PAGE_W, h: 0.4,
    fontFace: FONT, fontSize: 14, bold: true, color: YELLOW, align: 'center', valign: 'middle', charSpacing: 2, isTextBox: true,
  });
}

function gridSlides(cat, items) {
  const cols = 7;
  const rows = 3;
  const perPage = cols * rows;
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }

  const gap = 0.18;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  const bodyTop = MARGIN + 0.9 + 0.3;
  const bodyH = PAGE_H - MARGIN - bodyTop;
  const cellH = (bodyH - gap * (rows - 1)) / rows;
  const imgH = cellH - 0.35;

  for (const pageItems of pages) {
    const slide = pres.addSlide();
    slide.background = { color: WHITE };

    slide.addShape('rect', { x: MARGIN, y: MARGIN, w: CONTENT_W, h: 0.9, fill: { color: BLUE }, line: { type: 'none' } });
    slide.addText(`${cat.toUpperCase()}  —  VISTA GENERAL`, {
      x: MARGIN + 0.25, y: MARGIN, w: CONTENT_W - 0.5, h: 0.9,
      fontFace: FONT, fontSize: 18, bold: true, color: WHITE, align: 'left', valign: 'middle', isTextBox: true,
    });

    pageItems.forEach((r, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = MARGIN + col * (cellW + gap);
      const y = bodyTop + row * (cellH + gap);

      slide.addImage({ path: imgPath(r), x, y, w: cellW, h: imgH, sizing: { type: 'contain', w: cellW, h: imgH } });
      slide.addText(r.nombre, {
        x, y: y + imgH + 0.02, w: cellW, h: 0.32,
        fontFace: FONT, fontSize: 8, bold: true, color: LABEL, align: 'center', valign: 'top', isTextBox: true,
      });
    });
  }
}

function productSlide(cat, r) {
  const slide = pres.addSlide();
  slide.background = { color: WHITE };

  const headerH = 0.9;
  slide.addShape('rect', { x: MARGIN, y: MARGIN, w: CONTENT_W, h: headerH, fill: { color: BLUE }, line: { type: 'none' } });
  slide.addText(r.nombre, {
    x: MARGIN + 0.25, y: MARGIN, w: CONTENT_W - 2.6, h: headerH,
    fontFace: FONT, fontSize: 20, bold: true, color: WHITE, align: 'left', valign: 'middle', isTextBox: true,
  });
  slide.addShape('roundRect', {
    x: MARGIN + CONTENT_W - 2.0, y: MARGIN + headerH / 2 - 0.22, w: 1.75, h: 0.44,
    rectRadius: 0.22, fill: { color: YELLOW }, line: { type: 'none' },
  });
  slide.addText(cat.toUpperCase(), {
    x: MARGIN + CONTENT_W - 2.0, y: MARGIN + headerH / 2 - 0.22, w: 1.75, h: 0.44,
    fontFace: FONT, fontSize: 11, bold: true, color: INK, align: 'center', valign: 'middle', isTextBox: true,
  });

  const bodyTop = MARGIN + headerH + 0.3;
  const bodyH = PAGE_H - MARGIN - bodyTop;
  const photoSize = bodyH;

  slide.addShape('roundRect', {
    x: MARGIN, y: bodyTop, w: photoSize, h: photoSize,
    rectRadius: 0.08, fill: { color: WHITE }, line: { color: CARD_BORDER, width: 1 },
  });
  slide.addImage({
    path: imgPath(r),
    x: MARGIN + 0.35, y: bodyTop + 0.35, w: photoSize - 0.7, h: photoSize - 0.7,
    sizing: { type: 'contain', w: photoSize - 0.7, h: photoSize - 0.7 },
  });

  const infoX = MARGIN + photoSize + 0.45;
  const infoW = MARGIN + CONTENT_W - infoX;
  let y = bodyTop;

  const tags = r.tipo ?? [];
  if (tags.length > 0) {
    let tx = infoX;
    let ty = y;
    const tagH = 0.4;
    const tagPad = 0.22;
    for (const t of tags) {
      const tw = Math.min(infoW, 0.16 * t.length + tagPad * 2);
      if (tx + tw > infoX + infoW) {
        tx = infoX;
        ty += tagH + 0.12;
      }
      slide.addShape('roundRect', { x: tx, y: ty, w: tw, h: tagH, rectRadius: 0.2, fill: { color: TAG_BG }, line: { type: 'none' } });
      slide.addText(t, {
        x: tx, y: ty, w: tw, h: tagH,
        fontFace: FONT, fontSize: 11, bold: true, color: BLUE, align: 'center', valign: 'middle', isTextBox: true,
      });
      tx += tw + 0.14;
    }
    y = ty + tagH + 0.35;
  }

  function specSection(title, material, color) {
    slide.addShape('rect', { x: infoX, y: y + 0.06, w: 0.12, h: 0.12, fill: { color: YELLOW }, line: { type: 'none' } });
    slide.addText(title.toUpperCase(), {
      x: infoX + 0.22, y, w: infoW - 0.22, h: 0.28,
      fontFace: FONT, fontSize: 13, bold: true, color: INK, align: 'left', valign: 'middle', charSpacing: 1, isTextBox: true,
    });
    y += 0.42;

    const colW = infoW / 2 - 0.15;
    slide.addText('MATERIAL', {
      x: infoX, y, w: colW, h: 0.24,
      fontFace: FONT, fontSize: 9, color: MUTED, align: 'left', valign: 'top', charSpacing: 1, isTextBox: true,
    });
    slide.addText('COLOR', {
      x: infoX + colW + 0.3, y, w: colW, h: 0.24,
      fontFace: FONT, fontSize: 9, color: MUTED, align: 'left', valign: 'top', charSpacing: 1, isTextBox: true,
    });
    y += 0.24;
    slide.addText(material, {
      x: infoX, y, w: colW, h: 0.4,
      fontFace: FONT, fontSize: 15, bold: true, color: INK, align: 'left', valign: 'top', isTextBox: true,
    });
    slide.addText(color, {
      x: infoX + colW + 0.3, y, w: colW, h: 0.4,
      fontFace: FONT, fontSize: 15, bold: true, color: INK, align: 'left', valign: 'top', isTextBox: true,
    });
    y += 0.65;
  }

  specSection('Caja', r.caja.material, r.caja.color);
  specSection('Correa', r.correa.material, r.correa.color);

  if (r.resistenciaAgua) {
    slide.addShape('rect', { x: infoX, y: y + 0.06, w: 0.12, h: 0.12, fill: { color: YELLOW }, line: { type: 'none' } });
    slide.addText('RESISTENCIA AL AGUA', {
      x: infoX + 0.22, y, w: infoW - 0.22, h: 0.28,
      fontFace: FONT, fontSize: 13, bold: true, color: INK, align: 'left', valign: 'middle', charSpacing: 1, isTextBox: true,
    });
    y += 0.42;
    slide.addText(r.resistenciaAgua, {
      x: infoX, y, w: infoW, h: 0.4,
      fontFace: FONT, fontSize: 15, bold: true, color: INK, align: 'left', valign: 'top', isTextBox: true,
    });
  }
}

coverSlide();
for (const cat of CATEGORY_ORDER) {
  const items = byCategory[cat];
  if (items.length === 0) continue;
  dividerSlide(cat, items.length);
  gridSlides(cat, items);
  for (const r of items) productSlide(cat, r);
}

await pres.writeFile({ fileName: outPath });
console.log(`Wrote ${outPath}`);
console.log(`Records: ${records.length} | Caballero: ${byCategory.Caballero.length} | Dama: ${byCategory.Dama.length} | Unisex: ${byCategory.Unisex.length}`);
