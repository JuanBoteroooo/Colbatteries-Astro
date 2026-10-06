/**
 * extract-polemik-nueva.mjs
 * Builds the catalog thumbnails of the products added to "Polemik normal"
 * (relojes-polemik) from the master deck `POLEMIK RELOJES NUEVA COLECCION.pdf`.
 *
 * Which products: every record of src/data/relojes-polemik.json whose `img` is
 * `/catalogo-pages/relojes-polemik/nueva-NNN.jpg` (NNN = page of the master PDF).
 * The page text is checked against the record's `modelo` before anything is written
 * (digital pages print `REFERENCIA   <REF>`, estuche pages print `REFERENCIA` and the
 * code on the next line), so a record can never get another product's photo.
 *
 * Same constants and same pipeline as scripts/extract-polemik.mjs (which read the old
 * catalog PDF):
 *   1. PyMuPDF extracts every embedded image of the product page
 *   2. flatten alpha → white
 *   3. tight content-bounds crop (thresh=232, pad=25px)
 *   4. resize to a uniform CELL_W×CELL_H (600×800), fit:'contain' on white
 *   5. assemble the cells in a grid (n=1 → 680×880, n=2 → 1300×880; see the wide cell below)
 *
 * What the master deck adds:
 *   - Digital pages embed two pictures: the hero photo of one watch (left on the page)
 *     and a "colores disponibles" gallery with the variants (right on the page). They are
 *     assembled in that order: [hero | variants] → 1300×880.
 *   - Estuche pages embed one picture → one cell, 680×880 (same canvas as H-12PK). A wide
 *     picture (content aspect ≥ 1.3: EST/ACRIPO, BOX-PA3) gets a double-width cell,
 *     1300×880, so it is not left tiny in a tall canvas.
 *   - PCF-421, PCF-422M, PCF-425, PCF-430 and PCF-433 come with the deck's gray frames
 *     baked into the pictures: the hero sits in one frame with its color code printed
 *     under it, and every variant sits in its own frame with its code under it. Frames
 *     and codes are removed (the picture inside each frame is cropped out) and the
 *     variants are laid out again in a clean grid. Empty frames are dropped
 *     (PCF-422M has two), so only real photos reach the thumbnail.
 *
 * Needs `sharp` and PyMuPDF (python3 -m pip install pymupdf).
 *
 * Usage (from the repo root):  node scripts/extract-polemik-nueva.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_DIR   = path.join(ROOT, 'public/images/productos/relojes-polemik');
const DATA_JSON = path.join(ROOT, 'src/data/relojes-polemik.json');
const MASTER    = path.join(ROOT, 'public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf');

const CELL_W    = 600;   // uniform width per watch cell
const CELL_H    = 800;   // uniform height per watch cell
const GRID_GAP  = 20;    // gap between cells in grid
const GRID_PAD  = 40;    // outer margin of assembled grid
const CROP_PAD  = 25;    // px added around detected content bbox
const THRESH    = 232;   // brightness threshold — pixels below this count as content
const MIN_DIM   = 180;
const MAX_RATIO = 5.0;
const WHITE     = { r: 255, g: 255, b: 255 };

// A single wide picture gets a cell as wide as the two cells of a hero + variants canvas.
const WIDE_W      = 2 * CELL_W + GRID_GAP;
const WIDE_ASPECT = 1.3;

// Pictures with the deck's gray frames baked in (see the header). Handled via
// deframeHero() / deframedGallery(); the script stops if a frame is not found.
const FRAMED = new Set(['PCF-421', 'PCF-422M', 'PCF-425', 'PCF-430', 'PCF-433']);
const TILE_GAP     = 16;    // gap between variants when a framed gallery is laid out again
const FRAME_MARGIN = 4;     // px skipped inside a frame so no line, blur or corner arc is left over
const EMPTY_FRAC   = 0.01;  // a frame whose inside has less content than this is empty

if (!existsSync(MASTER)) {
    console.error(`Master PDF not found: ${path.relative(ROOT, MASTER)}`);
    process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

// ─── Which products ───────────────────────────────────────────────────────────
const products = JSON.parse(readFileSync(DATA_JSON, 'utf8'))
    .map(r => ({ r, m: /\/nueva-(\d{3})\.jpg$/.exec(r.img) }))
    .filter(({ m }) => m)
    .map(({ r, m }) => ({ modelo: r.modelo, tipo: r.tipo, page: Number(m[1]) }));
console.log(`${products.length} products with a master-deck page in ${path.relative(ROOT, DATA_JSON)}`);

// ─── Python extraction ────────────────────────────────────────────────────────
// Embedded images of the wanted pages, left to right as placed on the page, plus the page
// text. The program is fed through stdin (no temp file).
const PY_CODE = String.raw`
import fitz, json, base64, sys

doc    = fitz.open(sys.argv[1])
result = []

for pno in json.loads(sys.argv[2]):
    page  = doc[pno - 1]
    lines = [l.strip() for l in page.get_text().split('\n') if l.strip()]
    imgs  = []
    for info in page.get_image_info(xrefs=True):
        meta = doc.extract_image(info['xref'])
        if meta.get('smask'):
            raise SystemExit('page %d: image %d has a soft mask (not supported)' % (pno, info['xref']))
        imgs.append({
            'b64': base64.b64encode(meta['image']).decode(),
            'w': meta['width'],
            'h': meta['height'],
            'ext': meta['ext'],
            'x0': info['bbox'][0],
            'y0': info['bbox'][1],
        })
    imgs.sort(key=lambda i: (i['x0'], i['y0']))
    result.append({'page': pno, 'lines': lines, 'imgs': imgs})

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', ['-', MASTER, JSON.stringify(products.map(p => p.page))], {
    cwd: ROOT,
    input: PY_CODE,
    maxBuffer: 500 * 1024 * 1024,
}).toString();
const byPage = new Map(JSON.parse(jsonStr).map(p => [p.page, p]));

// The reference printed on the master page must be the record's modelo.
function printedReference(lines, tipo) {
    if (tipo === 'ACCESORIO') {
        const i = lines.indexOf('REFERENCIA');
        return i >= 0 ? lines[i + 1] : null;
    }
    for (const l of lines) {
        const m = /^REFERENCIA\s{2,}(.+)$/.exec(l);
        if (m) return m[1].trim();
    }
    return null;
}

// ─── Sharp helpers ────────────────────────────────────────────────────────────

async function rawPixels(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { data, ...info };
}

async function contentBounds(buf) {
    const { data, width, height, channels } = await rawPixels(buf);
    let top = height, bot = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < THRESH || data[i + 1] < THRESH || data[i + 2] < THRESH) {
                if (y < top)   top   = y;
                if (y > bot)   bot   = y;
                if (x < left)  left  = x;
                if (x > right) right = x;
            }
        }
    }
    return { top, bot, left, right, width, height };
}

// Tight content box (plus CROP_PAD) of a picture, or null when it is blank.
async function contentRect(rawBuf) {
    const b = await contentBounds(rawBuf);
    if (b.bot < 0) return null;

    const left  = Math.max(0, b.left  - CROP_PAD);
    const top   = Math.max(0, b.top   - CROP_PAD);
    const right = Math.min(b.width,  b.right  + CROP_PAD + 1);
    const bot   = Math.min(b.height, b.bot    + CROP_PAD + 1);
    return { left, top, width: right - left, height: bot - top };
}

// Crop to a rect then normalize to exact cellW×CELL_H with fit:contain.
function fitCell(rawBuf, rect, cellW) {
    return sharp(rawBuf)
        .flatten({ background: WHITE })
        .extract(rect)
        .resize({ width: cellW, height: CELL_H, fit: 'contain', background: WHITE })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// Crop to content then normalize to exact CELL_W×CELL_H with fit:contain.
async function processWatch(rawBuf) {
    const rect = await contentRect(rawBuf);
    return rect ? fitCell(rawBuf, rect, CELL_W) : null;
}

// A single picture (estuche): a CELL_W cell, or a WIDE_W cell when the content is wide.
async function processSingle(rawBuf) {
    const rect = await contentRect(rawBuf);
    if (!rect) return null;
    const wide = rect.width / rect.height >= WIDE_ASPECT;
    return { cell: await fitCell(rawBuf, rect, wide ? WIDE_W : CELL_W), cellW: wide ? WIDE_W : CELL_W };
}

async function darkFrac(buf) {
    const { data, width, height } = await rawPixels(buf);
    const n = width * height;
    let dark = 0;
    for (let i = 0; i < n * 3; i += 3) {
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 200) dark++;
    }
    return dark / n;
}

// Grid layout: ceil(√n) cols, ceil(n/cols) rows.
function gridDims(n) {
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
}

// Lays out equally sized cells in a grid (last row centered) on white.
async function layoutGrid(cellBufs, cellW, cellH, gap, pad) {
    const n = cellBufs.length;
    const { cols, rows } = gridDims(n);
    const totalW = cols * cellW + (cols - 1) * gap + pad * 2;
    const totalH = rows * cellH + (rows - 1) * gap + pad * 2;

    const composites = cellBufs.map((buf, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Center the last row when it has fewer items than cols
        const itemsInRow = Math.min(cols, n - row * cols);
        const rowShift = Math.round((cols - itemsInRow) * (cellW + gap) / 2);
        return {
            input: buf,
            left: pad + col * (cellW + gap) + rowShift,
            top:  pad + row * (cellH + gap),
        };
    });

    return sharp({ create: { width: totalW, height: totalH, channels: 3, background: WHITE } })
        .composite(composites)
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Deck frames (PCF-421, PCF-422M, PCF-425, PCF-430, PCF-433) ────────────────

// Finds the gray rounded rectangles drawn around the pictures: connected pieces of content
// (8-neighbours) whose four sides are solid lines. Returns their boxes plus, for each side,
// the inset from the box edge to the inside of the line (tTop, tBottom, tLeft, tRight). The
// color codes printed under a frame are separate, small pieces and are ignored. Watches
// touching a frame are part of the same piece, which is fine: only the box matters.
async function findFrames(buf) {
    const { data, width: W, height: H, channels } = await rawPixels(buf);
    const ink = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
        const i = p * channels;
        ink[p] = (data[i] < THRESH || data[i + 1] < THRESH || data[i + 2] < THRESH) ? 1 : 0;
    }

    // Share of content along a horizontal (y) or vertical (x) line of the box, ignoring the
    // rounded corners.
    const rowFrac = (y, xa, xb) => { let c = 0; for (let x = xa; x <= xb; x++) c += ink[y * W + x]; return c / (xb - xa + 1); };
    const colFrac = (x, ya, yb) => { let c = 0; for (let y = ya; y <= yb; y++) c += ink[y * W + x]; return c / (yb - ya + 1); };
    // Distance from the box edge to the first line inside the frame's solid band (lines with
    // ≥ 90 % content). The outermost lines are blurry, so up to 3 weak lines are skipped
    // before the band; 0 means the side is not a solid line.
    const thickness = (frac, from, step) => {
        let t = 0;
        while (t < 4 && frac(from + step * t) < 0.9) t++;
        if (t === 4) return 0;
        while (t < 16 && frac(from + step * t) >= 0.9) t++;
        return t;
    };

    const seen  = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    const frames = [];
    for (let s = 0; s < W * H; s++) {
        if (!ink[s] || seen[s]) continue;
        let sp = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
        stack[sp++] = s; seen[s] = 1;
        while (sp) {
            const p = stack[--sp];
            const x = p % W, y = (p - x) / W;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const q = ny * W + nx;
                    if (ink[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
                }
            }
        }
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        if (w < 0.15 * W || h < 0.15 * H) continue;
        const mx = Math.max(8, Math.round(w * 0.12));
        const my = Math.max(8, Math.round(h * 0.12));
        const xa = x0 + mx, xb = x1 - mx, ya = y0 + my, yb = y1 - my;
        const tTop    = thickness(y => rowFrac(y, xa, xb), y0, +1);
        const tBottom = thickness(y => rowFrac(y, xa, xb), y1, -1);
        const tLeft   = thickness(x => colFrac(x, ya, yb), x0, +1);
        const tRight  = thickness(x => colFrac(x, ya, yb), x1, -1);
        if (tTop && tBottom && tLeft && tRight) frames.push({ x0, y0, x1, y1, tTop, tBottom, tLeft, tRight });
    }
    return frames;
}

// The picture inside a frame, without the line and the corners, as a PNG buffer.
async function frameInterior(buf, f) {
    const left   = f.x0 + f.tLeft   + FRAME_MARGIN;
    const top    = f.y0 + f.tTop    + FRAME_MARGIN;
    const right  = f.x1 - f.tRight  - FRAME_MARGIN;
    const bottom = f.y1 - f.tBottom - FRAME_MARGIN;
    return sharp(buf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
        .png()
        .toBuffer();
}

// Hero in a frame: the picture inside the one frame (the code printed under it is dropped).
async function deframeHero(buf, label) {
    const frames = await findFrames(buf);
    if (frames.length !== 1) throw new Error(`${label}: expected 1 frame around the hero, found ${frames.length}`);
    return frameInterior(buf, frames[0]);
}

// Gallery of frames: the picture inside every frame that is not empty, in reading order,
// laid out again on white. Returns the new gallery and how many frames were found/kept.
async function deframedGallery(buf, label) {
    const frames = await findFrames(buf);
    if (frames.length < 2) throw new Error(`${label}: expected a gallery of frames, found ${frames.length}`);

    // Reading order: rows (top to bottom, centers within half a frame height), then left to right.
    const hs = frames.map(f => f.y1 - f.y0 + 1);
    const rowTol = Math.min(...hs) / 2;
    frames.sort((a, b) => {
        const dy = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
        return Math.abs(dy) > rowTol ? dy : (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2;
    });

    const tiles = [];
    for (const f of frames) {
        const tile = await frameInterior(buf, f);
        if (await contentFrac(tile) >= EMPTY_FRAC) tiles.push(tile);
    }
    if (tiles.length === 0) throw new Error(`${label}: every frame of the gallery is empty`);

    const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
    const tileW = Math.max(...metas.map(m => m.width));
    const tileH = Math.max(...metas.map(m => m.height));
    const padded = await Promise.all(tiles.map(t => sharp(t)
        .resize({ width: tileW, height: tileH, fit: 'contain', background: WHITE, position: 'centre' })
        .flatten({ background: WHITE })
        .png()
        .toBuffer()));
    const grid = await layoutGrid(padded, tileW, tileH, TILE_GAP, CROP_PAD);
    return { buf: grid, found: frames.length, kept: tiles.length };
}

// Share of pixels that count as content (as in contentBounds).
async function contentFrac(buf) {
    const { data, width, height, channels } = await rawPixels(buf);
    let n = 0;
    for (let p = 0; p < width * height; p++) {
        const i = p * channels;
        if (data[i] < THRESH || data[i + 1] < THRESH || data[i + 2] < THRESH) n++;
    }
    return n / (width * height);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const usableImgs = imgs => imgs.filter(({ w, h }) => {
    if (w < MIN_DIM || h < MIN_DIM) return false;
    const ratio = w / h;
    return ratio >= (1 / MAX_RATIO) && ratio <= MAX_RATIO;
});

for (const { modelo, tipo, page } of products) {
    const entry = byPage.get(page);
    if (!entry) throw new Error(`${modelo}: page ${page} not found in the master PDF`);

    const printed = printedReference(entry.lines, tipo);
    if (printed !== modelo) {
        throw new Error(`${modelo}: master page ${page} prints reference "${printed}" — record and deck disagree`);
    }

    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);
    const imgs    = usableImgs(entry.imgs);
    const raws    = imgs.map(({ b64 }) => Buffer.from(b64, 'base64'));
    const label   = `${modelo} (pg ${page})`;
    let note;
    let cells;
    let cellW = CELL_W;

    if (tipo === 'ACCESORIO') {
        // Estuche page: one picture, in a normal cell or (when wide) a double-width one.
        if (raws.length !== 1) throw new Error(`${label}: expected 1 image, found ${raws.length}`);
        const single = await processSingle(raws[0]);
        cells = [single && single.cell];
        if (single) cellW = single.cellW;
        note = cellW === WIDE_W ? 'estuche, wide cell' : 'estuche';
    } else {
        // Digital page: hero (left on the page) + gallery of variants (right on the page).
        if (raws.length !== 2) throw new Error(`${label}: expected hero + gallery (2 images), found ${raws.length}`);
        let [hero, gallery] = raws;

        if (FRAMED.has(modelo)) {
            hero = await deframeHero(hero, label);
            const g = await deframedGallery(gallery, label);
            gallery = g.buf;
            note = `deck frames removed (${g.found} gallery frames, ${g.kept} with a photo)`;
        } else {
            note = 'hero + variants';
        }
        cells = [await processWatch(hero), await processWatch(gallery)];
    }

    for (const cell of cells) {
        if (!cell || (await darkFrac(cell)) <= 0.003) throw new Error(`${label}: blank cell after processing`);
    }

    const { cols, rows } = gridDims(cells.length);
    const outBuf = await layoutGrid(cells, cellW, CELL_H, GRID_GAP, GRID_PAD);
    await sharp(outBuf).toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${modelo} (pg ${page}): ${meta.width}×${meta.height}  [${cells.length} cells, ${cols}×${rows} grid; ${note}]`);
}

console.log(`\n✅ Done. ${products.length} Polemik images written.`);
