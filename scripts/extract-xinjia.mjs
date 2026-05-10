/**
 * extract-xinjia.mjs
 * Extracts product images from relojes-xinjia.pdf (pages 2-108, 107 products).
 *
 * Pipeline — P1617 Standard:
 *   1. Flatten alpha → white
 *   2. Content-bounds crop (thresh=232, pad=25px)
 *   3. Resize to uniform CELL_W×CELL_H (600×800) via fit:'contain' on white bg
 *
 * Strip detection (w/h > 2.0): horizontal strips stacked vertically → variants cell.
 * Grid assembly: ceil(√n) cols.  n=1→1×1  n=2→2×1  n=3→2×2  n=4→2×2
 *
 * Usage:  node scripts/extract-xinjia.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Prevent sharp from caching decoded image tiles — avoids memory growth over 100+ images.
sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'public/images/productos/relojes-xinjia');

const CELL_W      = 600;
const CELL_H      = 800;
const GRID_GAP    = 20;
const GRID_PAD    = 40;
const CROP_PAD    = 25;
const THRESH      = 232;
const STRIP_RATIO = 2.0;
const MIN_DIM     = 180;
const MAX_RATIO   = 5.0;
const WHITE       = { r: 255, g: 255, b: 255 };

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF = 'public/catalogos/relojes-xinjia.pdf'

def get_modelo(text):
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        return None
    full = ' '.join(lines)
    if 'ESTUCHE' in full:
        return lines[0].split()[0]
    if 'TALKING' in full:
        for l in lines:
            if re.match(r'(XJ|CF|H)-\w+', l):
                return l
        return lines[0]
    return lines[0]

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue
    modelo = get_modelo(text)
    if not modelo:
        continue
    imgs = page.get_images(full=True)
    raws = []
    for img_info in imgs:
        xref = img_info[0]
        try:
            meta = doc.extract_image(xref)
            raws.append({
                'b64': base64.b64encode(meta['image']).decode(),
                'w': meta['width'],
                'h': meta['height'],
                'ext': meta['ext'],
            })
        except Exception:
            pass
    result.append({'modelo': modelo, 'page': i + 1, 'raws': raws})

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_xinjia.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 600 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Sharp helpers (all sequential — no Promise.all) ─────────────────────────

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

// Stack landscape strips vertically — fully sequential, no Promise.all.
async function combineStripsCell(stripBufs) {
    const cropped = [];
    for (const buf of stripBufs) {
        const b = await contentBounds(buf);
        if (b.bot < 0) continue;
        const l  = Math.max(0, b.left  - CROP_PAD);
        const t  = Math.max(0, b.top   - CROP_PAD);
        const r  = Math.min(b.width,  b.right + CROP_PAD + 1);
        const bt = Math.min(b.height, b.bot   + CROP_PAD + 1);
        const c  = await sharp(buf)
            .flatten({ background: WHITE })
            .extract({ left: l, top: t, width: r - l, height: bt - t })
            .flatten({ background: WHITE })
            .png()
            .toBuffer();
        cropped.push(c);
    }
    if (cropped.length === 0) return null;

    // Find max width sequentially
    let maxW = 0;
    const metas = [];
    for (const buf of cropped) {
        const m = await sharp(buf).metadata();
        metas.push(m);
        if (m.width > maxW) maxW = m.width;
    }

    // Equalize widths sequentially
    const equalized = [];
    for (let i = 0; i < cropped.length; i++) {
        if (metas[i].width === maxW) {
            equalized.push(cropped[i]);
        } else {
            const eq = await sharp(cropped[i])
                .resize({ width: maxW, fit: 'contain', background: WHITE })
                .flatten({ background: WHITE })
                .png()
                .toBuffer();
            equalized.push(eq);
        }
    }

    // Stack vertically
    const STRIP_GAP = 12;
    let totalH = STRIP_GAP * (equalized.length - 1);
    const eqMetas = [];
    for (const buf of equalized) {
        const m = await sharp(buf).metadata();
        eqMetas.push(m);
        totalH += m.height;
    }

    let y = 0;
    const composites = equalized.map((buf, i) => {
        const comp = { input: buf, left: 0, top: y };
        y += eqMetas[i].height + STRIP_GAP;
        return comp;
    });

    const combined = await sharp({ create: { width: maxW, height: totalH, channels: 3, background: WHITE } })
        .composite(composites)
        .flatten({ background: WHITE })
        .png()
        .toBuffer();

    return sharp(combined)
        .resize({ width: CELL_W, height: CELL_H, fit: 'contain', background: WHITE })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main loop — strictly sequential, one model at a time ────────────────────
let done = 0;
for (const { modelo, page, raws } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    console.log(`[${done + 1}/${pages.length}] Processing ${modelo} (pg ${page})…`);

    try {
        const usable = raws.filter(({ w, h }) => {
            if (w < MIN_DIM || h < MIN_DIM) return false;
            const ratio = w / h;
            return ratio >= (1 / MAX_RATIO) && ratio <= MAX_RATIO;
        });

        if (usable.length === 0) {
            console.log(`  → SKIP: no usable images`);
            done++;
            continue;
        }

        const strips = usable.filter(({ w, h }) => w / h > STRIP_RATIO);
        const heroes = usable.filter(({ w, h }) => w / h <= STRIP_RATIO);

        let finalCells = [];
        let strategyLabel;

        if (strips.length > 0 && heroes.length > 0) {
            const stripBufs = strips.map(({ b64 }) => Buffer.from(b64, 'base64'));
            const variantsCell = await combineStripsCell(stripBufs);

            const heroCells = [];
            for (const { b64 } of heroes) {
                const cell = await processWatch(Buffer.from(b64, 'base64'));
                if (cell) heroCells.push(cell);
            }

            finalCells    = [...(variantsCell ? [variantsCell] : []), ...heroCells];
            strategyLabel = `combine-strips+hero [${strips.length}s+${heroes.length}h]`;

        } else if (strips.length > 0) {
            const stripBufs = strips.map(({ b64 }) => Buffer.from(b64, 'base64'));
            const cell = await combineStripsCell(stripBufs);
            finalCells    = cell ? [cell] : [];
            strategyLabel = `strips-only [${strips.length}]`;

        } else {
            const cells = [];
            for (const { b64 } of heroes) {
                const cell = await processWatch(Buffer.from(b64, 'base64'));
                if (cell) cells.push(cell);
            }

            const valid = [];
            for (const buf of cells) {
                if ((await darkFrac(buf)) > 0.003) valid.push(buf);
            }
            finalCells    = valid.length > 0 ? valid : cells.slice(0, 1);
            strategyLabel = `heroes [${heroes.length}]`;
        }

        if (finalCells.length === 0) {
            console.log(`  → SKIP: all blank after processing`);
            done++;
            continue;
        }

        const { cols, rows } = gridDims(finalCells.length);
        const outBuf = await assembleGrid(finalCells);
        await sharp(outBuf).toFile(outPath);
        const meta = await sharp(outPath).metadata();
        console.log(`  → saved ${meta.width}×${meta.height}  [${finalCells.length} cells ${cols}×${rows} — ${strategyLabel}]`);

    } catch (err) {
        console.error(`  → ERROR on ${modelo}:`, err.message);
    }

    done++;
}

console.log(`\n✅ Done. ${done}/${pages.length} models processed.`);
