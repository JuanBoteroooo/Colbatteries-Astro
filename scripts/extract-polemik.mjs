/**
 * extract-polemik.mjs
 * Extracts product images from relojes-polemik.pdf (pages 19-67).
 *
 * Each product page has 2-3 images showing color variants and/or product shots.
 * All usable images per page are cropped, normalized to the same height
 * (fit: 'inside'), then stitched horizontally on a white canvas.
 *
 * Filters applied per image:
 *  - MIN_DIM = 180px: removes small logos/badges (e.g. 566×176 Polemik PNG)
 *  - MAX_RATIO = 5.0: removes extreme banners
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
const ROOT     = path.resolve(__dirname, '..');
const OUT_DIR  = path.join(ROOT, 'public/images/productos/relojes-polemik');
const TARGET_H = 302;
const GAP      = 50;
const PAD      = 20;
const WHITE    = { r: 255, g: 255, b: 255 };
const MIN_DIM  = 180;
const MAX_RATIO = 5.0;

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python ───────────────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

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

async function cropAndNormalize(inputBuf) {
    const CROP_PAD = 14;
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

async function stitchH(views) {
    const totalW = views.reduce((s, v) => s + v.width, 0) + GAP * (views.length - 1) + PAD * 2;
    const totalH = TARGET_H + PAD * 2;
    let x = PAD;
    const composites = views.map(({ buf, width }) => {
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

async function single(view) {
    const { buf, width } = view;
    return sharp({ create: { width: width + PAD * 2, height: TARGET_H + PAD * 2, channels: 3, background: WHITE } })
        .composite([{ input: buf, left: PAD, top: PAD }])
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

    const strategy = usable.length === 1 ? 'single' : `multi × ${usable.length}`;
    const rawBufs  = usable.map(({ b64 }) => Buffer.from(b64, 'base64'));

    const normalized = (await Promise.all(rawBufs.map(cropAndNormalize))).filter(Boolean);

    const valid = [];
    for (const v of normalized) {
        if ((await darkFrac(v.buf)) > 0.003) valid.push(v);
    }
    const final = valid.length > 0 ? valid : normalized.slice(0, 1);

    if (final.length === 0) {
        console.log(`  [SKIP] ${modelo} — all blank`);
        continue;
    }

    const outBuf = final.length === 1 ? await single(final[0]) : await stitchH(final);
    await sharp(outBuf).toFile(outPath);
    const meta = await sharp(outPath).metadata();
    console.log(`  ${modelo} (pg ${page}): ${meta.width}×${meta.height}  [${strategy}]`);
}

console.log('\n✅ Done. All Polemik images written.');
