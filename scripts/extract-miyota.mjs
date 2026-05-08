/**
 * extract-miyota.mjs
 * Extracts product images from movimientos-miyota.pdf.
 *
 * Strategies applied per page:
 *  A) Raw-image, multi-view  — pages with 2-3 embedded images (each ≥ MIN_DIM
 *     in both dimensions, not too thin) are extracted raw and stitched H.
 *  B) Portrait auto-split    — single embedded image taller than wide by ≥ 30%
 *     is scanned for a white horizontal band; if found, the two segments are
 *     split, then stitched H.  Falls back to Strategy C if no split found.
 *  C) Single image           — one usable raw image is cropped and padded.
 *  D) Page-render fallback   — if no usable raw images remain after filtering.
 *
 * All outputs use sharp .flatten({ background: white }) for guaranteed pure-
 * white backgrounds.
 *
 * Usage:  node scripts/extract-miyota.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_DIR   = path.join(ROOT, 'public/images/productos/movimientos-miyota');
const TARGET_H  = 302;
const GAP       = 20;
const PAD       = 16;
const WHITE     = { r: 255, g: 255, b: 255 };
const MIN_DIM   = 180;   // px — smaller images are decorative/ignored
const MAX_RATIO = 5.0;   // w/h or h/w above this → decorative stripe

// Models with SMask (alpha) channels — raw JPEG extraction drops the mask,
// producing black backgrounds. Force page-render for these.
const FORCE_PAGE_RENDER = new Set(['0S60-3', '5Y20', '5Y30', 'JS10']);

// Models whose single embedded JPEG is a portrait composite (two or three views
// stacked vertically). Force vertical-split + horizontal stitch for these.
const FORCE_SPLIT = new Set([
    '0S10-3', '0S21-4', '1L40', '1L45', '5R21', '5R32',
    '6P27', '6P29', '9T13-3', '9T22', '9T33',
    '2005-3', '2015-3/6', '2035', '2036', '2039',
    '2105-3', '2115-3/6', '2315-3/6', '2415-3/6',
    'GL02-3', 'GL12-3/6', 'GL32', 'GM02-3',
    'JR20-6', 'JS15-3', 'JS25-4', 'JS26-4',
]);

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python renderer ──────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, io, sys
import numpy as np
from PIL import Image

PDF   = 'public/catalogos/movimientos-miyota.pdf'
SCALE = 3.0
PAD   = 14
THRESH = 238

def crop_content(arr):
    dark = (arr[:,:,0] < THRESH) | (arr[:,:,1] < THRESH) | (arr[:,:,2] < THRESH)
    rows = np.any(dark, axis=1)
    cols = np.any(dark, axis=0)
    if not np.any(rows):
        return arr
    r0 = max(0, int(np.argmax(rows)) - PAD)
    r1 = min(arr.shape[0], arr.shape[0] - int(np.argmax(rows[::-1])) + PAD)
    c0 = max(0, int(np.argmax(cols)) - PAD)
    c1 = min(arr.shape[1], arr.shape[1] - int(np.argmax(cols[::-1])) + PAD)
    return arr[r0:r1, c0:c1]

doc    = fitz.open(PDF)
result = []

for i in range(len(doc)):
    page = doc[i]
    text = page.get_text()
    if 'MODELO:' not in text:
        continue
    m = re.search(r'MODELO:\s*(.+)', text)
    if not m:
        continue
    modelo = m.group(1).strip().split('\n')[0].strip()

    imgs = page.get_images(full=True)

    # Raw bytes for each embedded image (for strategies A/B/C)
    raws_b64 = []
    for img_info in imgs:
        xref    = img_info[0]
        meta    = doc.extract_image(xref)
        w, h    = meta['width'], meta['height']
        raws_b64.append({
            'b64': base64.b64encode(meta['image']).decode(),
            'w': w, 'h': h, 'ext': meta['ext'],
        })

    # Page-rendered crops per image rect (fallback strategy D)
    rects_data = []
    for img_info in imgs:
        xref      = img_info[0]
        img_rects = page.get_image_rects(xref)
        if img_rects:
            r = img_rects[0]
            rects_data.append((float(r.y0), r))
    rects_data.sort(key=lambda t: t[0])

    crops_b64 = []
    for _, rect in rects_data:
        mat = fitz.Matrix(SCALE, SCALE)
        pix = page.get_pixmap(matrix=mat, clip=rect, colorspace=fitz.csRGB)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        cropped = crop_content(arr)
        if cropped.shape[0] < 20 or cropped.shape[1] < 20:
            cropped = arr
        buf = io.BytesIO()
        Image.fromarray(cropped).save(buf, format='PNG')
        crops_b64.append(base64.b64encode(buf.getvalue()).decode())

    result.append({
        'modelo':    modelo,
        'raws_b64':  raws_b64,
        'crops_b64': crops_b64,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_render_miyota.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Rendering PDF pages via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 500 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Parsed ${pages.length} products\n`);

// ─── Sharp helpers ────────────────────────────────────────────────────────────

async function contentBounds(buf, thresh = 238) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let top = height, bot = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < thresh || data[i + 1] < thresh || data[i + 2] < thresh) {
                if (y < top)   top   = y;
                if (y > bot)   bot   = y;
                if (x < left)  left  = x;
                if (x > right) right = x;
            }
        }
    }
    return { top, bot, left, right, width, height };
}

async function splitVertical(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // STRICT white-row test: ALL pixels must have every channel >= 245.
    // Threshold 245 (not 255) absorbs minor JPEG compression artifacts at true-white
    // regions while correctly rejecting mechanism-detail rows (min brightness < 200).
    // The 95%-fraction approach was reverted because rows with 1-2 dark mechanism
    // pixels (e.g. min=130, mean=254) were misclassified as "white," fragmenting
    // movement views into tiny sub-pieces.
    const WHITE_CH = 245;
    const MIN_BAND = 5;    // min consecutive strict-white rows = valid separator
    const MIN_SEG  = 40;   // min content-segment height (px)
    const SEG_PAD  = 6;

    const strictWhite = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
        let all = true;
        for (let x = 0; x < width && all; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < WHITE_CH || data[i + 1] < WHITE_CH || data[i + 2] < WHITE_CH) all = false;
        }
        strictWhite[y] = all ? 1 : 0;
    }

    // Build separator mask: only rows inside a band >= MIN_BAND consecutive white rows
    const sepMask = new Uint8Array(height);
    let y = 0;
    while (y < height) {
        if (!strictWhite[y]) { y++; continue; }
        const bs = y;
        while (y < height && strictWhite[y]) y++;
        if (y - bs >= MIN_BAND) for (let r = bs; r < y; r++) sepMask[r] = 1;
    }

    const segs = [];
    let inSeg = false, start = 0;
    for (let r = 0; r < height; r++) {
        if (!sepMask[r] && !inSeg) { start = r; inSeg = true; }
        else if (sepMask[r] && inSeg) { segs.push([start, r]); inSeg = false; }
    }
    if (inSeg) segs.push([start, height]);

    const bigSegs = segs.filter(([a, b]) => b - a >= MIN_SEG);
    if (bigSegs.length < 2) return [buf];

    const crops = [];
    for (const [segTop, segBot] of bigSegs) {
        const top = Math.max(0, segTop - SEG_PAD);
        const bot = Math.min(height, segBot + SEG_PAD);
        const segBuf = await sharp(buf)
            .flatten({ background: WHITE })
            .extract({ left: 0, top, width, height: bot - top })
            .png()
            .toBuffer();
        crops.push(segBuf);
    }
    return crops;
}

async function cropAndResize(inputBuf) {
    const b = await contentBounds(inputBuf);
    if (b.bot < 0) return null;

    const SEG_PAD = 10;
    const left   = Math.max(0, b.left  - SEG_PAD);
    const top    = Math.max(0, b.top   - SEG_PAD);
    const right  = Math.min(b.width,  b.right  + SEG_PAD + 1);
    const bot    = Math.min(b.height, b.bot    + SEG_PAD + 1);
    const cropW  = right - left;
    const cropH  = bot   - top;
    const newW   = Math.max(1, Math.round(cropW * TARGET_H / cropH));

    const buf = await sharp(inputBuf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: cropW, height: cropH })
        .resize(newW, TARGET_H, { fit: 'fill' })
        .png()
        .toBuffer();

    return { buf, width: newW, height: TARGET_H };
}

async function cropAndNormalize(inputBuf) {
    const CROP_PAD = 12;
    const b = await contentBounds(inputBuf);
    if (b.bot < 0) return null;
    const left  = Math.max(0, b.left  - CROP_PAD);
    const top   = Math.max(0, b.top   - CROP_PAD);
    const right = Math.min(b.width,  b.right  + CROP_PAD + 1);
    const bot   = Math.min(b.height, b.bot    + CROP_PAD + 1);
    const buf = await sharp(inputBuf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: right - left, height: bot - top })
        .resize({ height: TARGET_H, fit: 'inside', background: WHITE })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
    const meta = await sharp(buf).metadata();
    return { buf, width: meta.width, height: TARGET_H };
}

async function darkFrac(inputBuf) {
    const { data, info } = await sharp(inputBuf)
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

async function stitchH(crops, gap = GAP, pad = PAD) {
    const totalW = crops.reduce((s, c) => s + c.width, 0)
                 + gap * (crops.length - 1) + pad * 2;
    const totalH = TARGET_H + pad * 2;
    let x = pad;
    const composites = crops.map(({ buf, width }) => {
        const comp = { input: buf, left: x, top: pad };
        x += width + gap;
        return comp;
    });
    return sharp({ create: { width: totalW, height: totalH, channels: 3, background: WHITE } })
        .composite(composites)
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

async function single(crop, pad = PAD) {
    const { buf, width } = crop;
    return sharp({ create: { width: width + pad * 2, height: TARGET_H + pad * 2, channels: 3, background: WHITE } })
        .composite([{ input: buf, left: pad, top: pad }])
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
for (const { modelo, raws_b64, crops_b64 } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    // Filter usable raw images: not too small, not extreme aspect ratio
    const usable = raws_b64.filter(({ w, h }) => {
        if (w < MIN_DIM || h < MIN_DIM) return false;
        const ratio = w / h;
        return ratio >= (1 / MAX_RATIO) && ratio <= MAX_RATIO;
    });

    let rawSegBufs = [];
    let strategy   = '';

    if (FORCE_PAGE_RENDER.has(modelo) || usable.length === 0) {
        // Strategy D: page-render (forced for SMask models, or fallback when no usable raws)
        rawSegBufs = (crops_b64 ?? []).map(b => Buffer.from(b, 'base64'));
        strategy   = `page-render × ${rawSegBufs.length}`;
    } else if (FORCE_SPLIT.has(modelo) && usable.length >= 1) {
        // Strategy B-forced: composite portrait JPEG → vertical split → stitch H
        const rawBuf = Buffer.from(usable[0].b64, 'base64');
        const segs   = await splitVertical(rawBuf);
        strategy     = segs.length > 1
            ? `force-split → ${segs.length} segs`
            : 'force-split (no band found, single)';

        const normalized = (await Promise.all(segs.map(cropAndNormalize))).filter(Boolean);
        const valid = [];
        for (const v of normalized) {
            if ((await darkFrac(v.buf)) > 0.005) valid.push(v);
        }
        const final = valid.length > 0 ? valid : normalized.slice(0, 1);
        if (final.length === 0) { console.log(`  [SKIP] ${modelo} — all blank`); continue; }
        const outBuf = final.length === 1 ? await single(final[0], 20) : await stitchH(final, 50, 20);
        await sharp(outBuf).toFile(outPath);
        const meta = await sharp(outPath).metadata();
        console.log(`  ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
        continue;
    } else if (usable.length === 1) {
        const rawBuf = Buffer.from(usable[0].b64, 'base64');
        const { w, h } = usable[0];
        if (h > w * 1.3) {
            // Strategy B: auto-portrait → try vertical split
            const segs = await splitVertical(rawBuf);
            rawSegBufs = segs;
            strategy   = segs.length > 1
                ? `portrait-split → ${segs.length} segs`
                : 'portrait (no split found)';
        } else {
            // Strategy C: single landscape/square image
            rawSegBufs = [rawBuf];
            strategy   = 'single raw';
        }
    } else {
        // Strategy A: multiple usable images → stitch horizontally
        rawSegBufs = usable.map(({ b64 }) => Buffer.from(b64, 'base64'));
        strategy   = `multi-raw × ${rawSegBufs.length}`;
    }

    if (rawSegBufs.length === 0) {
        console.log(`  [SKIP] ${modelo} — no image data`);
        continue;
    }

    const resized = (await Promise.all(rawSegBufs.map(cropAndResize))).filter(Boolean);

    const valid = [];
    for (const r of resized) {
        if ((await darkFrac(r.buf)) > 0.005) valid.push(r);
    }
    const final = valid.length > 0 ? valid : resized.slice(0, 1);

    if (final.length === 0) {
        console.log(`  [SKIP] ${modelo} — all blank`);
        continue;
    }

    const outBuf = final.length === 1 ? await single(final[0]) : await stitchH(final);
    await sharp(outBuf).toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
}

console.log('\n✅ Done. All Miyota images written.');
