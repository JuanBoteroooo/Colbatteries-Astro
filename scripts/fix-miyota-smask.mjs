/**
 * fix-miyota-smask.mjs
 * Re-processes 4 Miyota models whose raw JPEG extraction produced black
 * backgrounds because their embedded images have SMask (alpha) channels.
 * Uses PyMuPDF page-render (clips each image rect) so the mask is composited
 * correctly onto white before we stitch horizontally.
 *
 * Usage:  node scripts/fix-miyota-smask.mjs
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

const TARGETS = new Set(['0S60-3', '5Y20', '5Y30', 'JS10']);

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python: page-render per image rect ───────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, io, sys
import numpy as np
from PIL import Image

PDF   = 'public/catalogos/movimientos-miyota.pdf'
SCALE = 3.0
PAD   = 14
THRESH = 238
TARGETS = {'0S60-3', '5Y20', '5Y30', 'JS10'}

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
    if modelo not in TARGETS:
        continue

    imgs = page.get_images(full=True)

    # Collect image rects sorted top-to-bottom
    rects_data = []
    for img_info in imgs:
        xref      = img_info[0]
        img_rects = page.get_image_rects(xref)
        if img_rects:
            r = img_rects[0]
            rects_data.append((float(r.y0), r))
    rects_data.sort(key=lambda t: t[0])

    # Page-render each rect — PyMuPDF composites SMask onto white
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

    result.append({'modelo': modelo, 'crops_b64': crops_b64})
    print(f'  Rendered {len(crops_b64)} crops for {modelo}', file=sys.stderr)

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_fix_miyota_smask.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Page-rendering 4 SMask models via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 200 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Sharp helpers (identical to extract-miyota.mjs) ─────────────────────────

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

async function single(crop) {
    const { buf, width, height } = crop;
    return sharp({ create: { width: width + PAD * 2, height: height + PAD * 2, channels: 3, background: WHITE } })
        .composite([{ input: buf, left: PAD, top: PAD }])
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
for (const { modelo, crops_b64 } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    const rawBufs = (crops_b64 ?? []).map(b => Buffer.from(b, 'base64'));

    const resized = (await Promise.all(rawBufs.map(cropAndResize))).filter(Boolean);

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
    console.log(`  ✓ ${modelo}: ${meta.width}×${meta.height}  [page-render × ${final.length} crops, white bg]`);
}

console.log('\n✅ Done. 4 images overwritten with clean white backgrounds.');
