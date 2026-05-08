/**
 * extract-epson-sii.mjs
 * Extracts product images from movimientos-epson.pdf.
 *
 * Two strategies:
 *  A) Page-render (PyMuPDF clip) — for pages with multiple separate embedded
 *     images (SMask/PNG overlay + photo), already stored in different rects.
 *  B) Raw-JPEG + vertical split — for FORCE_SPLIT models whose single embedded
 *     JPEG is a portrait composite (two views stacked top/bottom). We extract
 *     the raw bytes, detect the white horizontal band between views, crop each
 *     segment, then stitch side-by-side.
 *
 * All outputs get sharp's .flatten({ background: white }) for a guaranteed
 * pure-white background.
 *
 * Usage:  node scripts/extract-epson-sii.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const EPSON_OUT = path.join(ROOT, 'public/images/productos/movimientos-epson');
const SII_OUT   = path.join(ROOT, 'public/images/productos/movimientos-sii');
const TARGET_H  = 302;
const GAP       = 20;
const PAD       = 16;
const WHITE     = { r: 255, g: 255, b: 255 };

// Models with a single portrait JPEG containing two stacked views.
// These receive the raw-bytes + vertical-split treatment.
const FORCE_SPLIT = new Set([
    // EPSON
    'VX00', 'VX01', 'VX3J', 'VX3KE', 'VX10', 'VX11', 'VX12-3/6',
    'VX32-3/6', 'VX33-3', 'VX42-3/6', 'VX43-3', 'VX50', 'VX51',
    'VX82-3/6', 'VX83-3', 'Y121', 'YM62-3', 'YM92-3',
    // SII
    'VR32-4', 'PC32-3/6', 'VC00', 'VD53', 'VD54', 'VD57',
]);

mkdirSync(EPSON_OUT, { recursive: true });
mkdirSync(SII_OUT,   { recursive: true });

// ─── Python renderer ──────────────────────────────────────────────────────────
// For each product page returns:
//   modelo, brand,
//   raw_b64  — raw bytes of the FIRST embedded image (strategy B)
//   crops_b64 — page-rendered crops per image rect (strategy A)
const PY_CODE = String.raw`
import fitz, json, base64, re, io, sys
import numpy as np
from PIL import Image

PDF   = 'public/catalogos/movimientos-epson.pdf'
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
    m = re.search(r'MODELO:\s*(\S+)', text)
    if not m:
        continue
    modelo = m.group(1).strip()
    brand  = 'SII' if 'SII' in text else 'EPSON'

    imgs = page.get_images(full=True)

    # Raw bytes of first embedded image (for FORCE_SPLIT strategy B)
    raw_b64 = ''
    if imgs:
        xref    = imgs[0][0]
        img_raw = doc.extract_image(xref)['image']
        raw_b64 = base64.b64encode(img_raw).decode()

    # Page-rendered crops per rect (for strategy A — multi-image pages)
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
        'brand':     brand,
        'raw_b64':   raw_b64,
        'crops_b64': crops_b64,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_render_epson_sii.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Rendering PDF pages via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 500 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Parsed ${pages.length} products\n`);

// ─── Sharp helpers ────────────────────────────────────────────────────────────

/**
 * Returns { top, bot, left, right } pixel bounds of non-white content.
 * "White" = all channels >= thresh.
 */
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

/**
 * Splits a portrait image (two views stacked top/bottom, separated by a white
 * horizontal band) into an array of PNG buffers — one per segment.
 * Returns the original [buf] unchanged if no clean split is found.
 */
async function splitVertical(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // Which rows are "all white"?
    const isWhite = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
        let w = true;
        for (let x = 0; x < width && w; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) w = false;
        }
        isWhite[y] = w ? 1 : 0;
    }

    // Find content segments (runs of non-white rows)
    const segs = [];
    let inSeg = false, start = 0;
    for (let y = 0; y < height; y++) {
        if (!isWhite[y] && !inSeg) { start = y; inSeg = true; }
        else if (isWhite[y] && inSeg) { segs.push([start, y]); inSeg = false; }
    }
    if (inSeg) segs.push([start, height]);

    // Need at least 2 meaningful segments (each >= 40px tall)
    const bigSegs = segs.filter(([a, b]) => b - a >= 40);
    if (bigSegs.length < 2) return [buf];

    // Crop each segment with padding, return as PNG buffers
    const SEG_PAD = 8;
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

/**
 * Crop whitespace from all sides of a buffer, then resize to TARGET_H.
 * Returns { buf: PNG, width, height }.
 */
async function cropAndResize(inputBuf) {
    const b = await contentBounds(inputBuf);
    if (b.bot < 0) return null; // blank

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

/** Fraction of pixels darker than 200 brightness. */
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

/** Horizontal stitch: GAP between crops, PAD around the whole canvas. */
async function stitchH(crops) {
    const totalW = crops.reduce((s, c) => s + c.width, 0)
                 + GAP * (crops.length - 1) + PAD * 2;
    const totalH = TARGET_H + PAD * 2;
    let x = PAD;
    const composites = crops.map(({ buf, width }) => {
        const comp = { input: buf, left: x, top: PAD };
        x += width + GAP;
        return comp;
    });
    return sharp({ create: { width: totalW, height: totalH, channels: 3, background: WHITE } })
        .composite(composites)
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

/** Single crop with PAD canvas. */
async function single(crop) {
    const { buf, width, height } = crop;
    return sharp({ create: { width: width + PAD * 2, height: height + PAD * 2, channels: 3, background: WHITE } })
        .composite([{ input: buf, left: PAD, top: PAD }])
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
for (const { modelo, brand, raw_b64, crops_b64 } of pages) {
    const safe    = modelo.replace(/\//g, '_');
    const outDir  = brand === 'SII' ? SII_OUT : EPSON_OUT;
    const outPath = path.join(outDir, `${safe}.png`);

    let rawSegBufs = [];   // PNG buffers for each independent view
    let strategy   = '';

    if (FORCE_SPLIT.has(modelo) && raw_b64) {
        // ── Strategy B: raw JPEG → detect vertical segments → split ──
        const rawBuf = Buffer.from(raw_b64, 'base64');
        rawSegBufs   = await splitVertical(rawBuf);
        strategy     = rawSegBufs.length > 1
            ? `raw-JPEG split → ${rawSegBufs.length} segs`
            : 'raw-JPEG (no split found)';
    } else {
        // ── Strategy A: page-rendered crops per image rect ──
        rawSegBufs = (crops_b64 ?? []).map(b => Buffer.from(b, 'base64'));
        strategy   = `page-render × ${rawSegBufs.length}`;
    }

    if (rawSegBufs.length === 0) {
        console.log(`  [SKIP] ${brand} ${modelo} — no image data`);
        continue;
    }

    // Crop whitespace from each segment + resize to TARGET_H
    const resized = (await Promise.all(rawSegBufs.map(cropAndResize)))
        .filter(Boolean);

    // Drop completely blank views (>99.5% white)
    const valid = [];
    for (const r of resized) {
        if ((await darkFrac(r.buf)) > 0.005) valid.push(r);
    }
    const final = valid.length > 0 ? valid : resized.slice(0, 1);

    if (final.length === 0) {
        console.log(`  [SKIP] ${brand} ${modelo} — all blank`);
        continue;
    }

    const outBuf = final.length === 1
        ? await single(final[0])
        : await stitchH(final);

    await sharp(outBuf).toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${brand} ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
}

console.log('\n✅ Done. All images overwritten.');
