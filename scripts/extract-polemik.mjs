/**
 * extract-polemik.mjs
 * Extracts product images from relojes-polemik.pdf (pages 19-67).
 *
 * Pipeline per raw image:
 *   1. Flatten alpha → white
 *   2. Tight content-bounds crop (thresh=232, pad=25px)
 *   3. Resize to uniform CELL_W×CELL_H (600×800) via fit:'contain' on white bg
 *
 * Grid assembly:
 *   n=1 → 1×1   n=2 → 2×1   n=3 → 2×2 (last centered)
 *   n=4 → 2×2   n=6 → 3×2   general: ceil(√n) cols
 *
 * Filters: MIN_DIM=180 removes logos; MAX_RATIO=5.0 removes banners.
 *
 * Usage:  node scripts/extract-polemik.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_DIR   = path.join(ROOT, 'public/images/productos/relojes-polemik');

const CELL_W    = 600;   // uniform width per watch cell
const CELL_H    = 800;   // uniform height per watch cell
const GRID_GAP  = 20;    // gap between cells in grid
const GRID_PAD  = 40;    // outer margin of assembled grid
const CROP_PAD  = 25;    // px added around detected content bbox
const THRESH    = 232;   // brightness threshold — pixels below this count as content
const MIN_DIM   = 180;
const MAX_RATIO = 5.0;
const WHITE     = { r: 255, g: 255, b: 255 };

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, sys

PDF = 'public/catalogos/relojes-polemik.pdf'

doc    = fitz.open(PDF)
result = []

for i in range(18, 67):  # PDF pages 19-67 (0-indexed 18-66)
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue
    lines  = [l.strip() for l in text.split('\n') if l.strip()]
    modelo = lines[0]

    imgs = page.get_images(full=True)
    raws = []
    for img_info in imgs:
        xref = img_info[0]
        meta = doc.extract_image(xref)
        raws.append({
            'b64': base64.b64encode(meta['image']).decode(),
            'w': meta['width'],
            'h': meta['height'],
            'ext': meta['ext'],
        })

    result.append({'modelo': modelo, 'page': i + 1, 'raws': raws})

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_polemik.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 500 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Sharp helpers ────────────────────────────────────────────────────────────

async function contentBounds(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
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

// Crop to content then normalize to exact CELL_W×CELL_H with fit:contain.
async function processWatch(rawBuf) {
    const b = await contentBounds(rawBuf);
    if (b.bot < 0) return null;

    const left  = Math.max(0, b.left  - CROP_PAD);
    const top   = Math.max(0, b.top   - CROP_PAD);
    const right = Math.min(b.width,  b.right  + CROP_PAD + 1);
    const bot   = Math.min(b.height, b.bot    + CROP_PAD + 1);

    return sharp(rawBuf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: right - left, height: bot - top })
        .resize({ width: CELL_W, height: CELL_H, fit: 'contain', background: WHITE })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

async function darkFrac(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
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

async function assembleGrid(cellBufs) {
    const n = cellBufs.length;
    const { cols, rows } = gridDims(n);
    const totalW = cols * CELL_W + (cols - 1) * GRID_GAP + GRID_PAD * 2;
    const totalH = rows * CELL_H + (rows - 1) * GRID_GAP + GRID_PAD * 2;

    const composites = cellBufs.map((buf, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Center the last row when it has fewer items than cols
        const itemsInRow = Math.min(cols, n - row * cols);
        const rowShift = Math.round((cols - itemsInRow) * (CELL_W + GRID_GAP) / 2);
        return {
            input: buf,
            left: GRID_PAD + col * (CELL_W + GRID_GAP) + rowShift,
            top:  GRID_PAD + row * (CELL_H + GRID_GAP),
        };
    });

    return sharp({ create: { width: totalW, height: totalH, channels: 3, background: WHITE } })
        .composite(composites)
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
for (const { modelo, page, raws } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    const usable = raws.filter(({ w, h }) => {
        if (w < MIN_DIM || h < MIN_DIM) return false;
        const ratio = w / h;
        return ratio >= (1 / MAX_RATIO) && ratio <= MAX_RATIO;
    });

    if (usable.length === 0) {
        console.log(`  [SKIP] ${modelo} (pg ${page}) — no usable images`);
        continue;
    }

    const rawBufs = usable.map(({ b64 }) => Buffer.from(b64, 'base64'));
    const cells   = (await Promise.all(rawBufs.map(processWatch))).filter(Boolean);

    const valid = [];
    for (const buf of cells) {
        if ((await darkFrac(buf)) > 0.003) valid.push(buf);
    }
    const finalCells = valid.length > 0 ? valid : cells.slice(0, 1);

    if (finalCells.length === 0) {
        console.log(`  [SKIP] ${modelo} — all blank after processing`);
        continue;
    }

    const { cols, rows } = gridDims(finalCells.length);
    const outBuf = await assembleGrid(finalCells);
    await sharp(outBuf).toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${modelo} (pg ${page}): ${meta.width}×${meta.height}  [${finalCells.length} cells, ${cols}×${rows} grid]`);
}

console.log('\n✅ Done. All Polemik images written.');
