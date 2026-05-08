/**
 * extract-isa-chinos.mjs
 * Extracts product images from movimientos-isa.pdf (pages 3-16).
 *   Pages 3-9:  ISA brand models → public/images/productos/movimientos-isa/
 *   Pages 11-16: Chinese models  → public/images/productos/movimientos-chinos/
 *
 * Also extracts Chinese catalog page JPEGs:
 *   PDF pages 10-16 → public/catalogo-pages/movimientos-chinos/page-01..07.jpg
 *
 * Image strategies (same robust pipeline as extract-miyota.mjs):
 *  A) Multiple usable raw images → crop each + stitch horizontally
 *  C) Single usable image → crop + pad on white canvas
 *
 * MIN_DIM=180 filters decorative logos; MAX_RATIO=5.0 filters thin banners.
 * All outputs use sharp .flatten({ background: white }) for pure-white backgrounds.
 *
 * Usage:  node scripts/extract-isa-chinos.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');
const ISA_DIR    = path.join(ROOT, 'public/images/productos/movimientos-isa');
const CHINOS_DIR = path.join(ROOT, 'public/images/productos/movimientos-chinos');
const CHINOS_CAT = path.join(ROOT, 'public/catalogo-pages/movimientos-chinos');

const TARGET_H  = 302;
const GAP       = 50;
const PAD       = 20;
const WHITE     = { r: 255, g: 255, b: 255 };
const MIN_DIM   = 180;
const MAX_RATIO = 5.0;

for (const d of [ISA_DIR, CHINOS_DIR, CHINOS_CAT]) mkdirSync(d, { recursive: true });

// ─── Python ───────────────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, io, sys
import numpy as np
from PIL import Image

PDF   = 'public/catalogos/movimientos-isa.pdf'
SCALE = 2.0

# Pages 3-9 = ISA products; pages 11-16 = Chinese products
ISA_PAGES    = set(range(2, 9))    # 0-indexed: 2..8 = PDF pages 3..9
CHINOS_PAGES = set(range(10, 16))  # 0-indexed: 10..15 = PDF pages 11..16
CHINOS_CATALOG_PAGES = list(range(9, 16))  # PDF pages 10-16 for catalog JPEGs

doc    = fitz.open(PDF)
result = {'isa': [], 'chinos': [], 'chinos_catalog': []}

# Extract catalog pages for Chinese section (PDF pages 10-16 → page-01..07.jpg)
for pg_idx in CHINOS_CATALOG_PAGES:
    page = doc[pg_idx]
    mat  = fitz.Matrix(1.5, 1.5)
    pix  = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    arr  = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
    buf  = io.BytesIO()
    Image.fromarray(arr).save(buf, format='JPEG', quality=85)
    result['chinos_catalog'].append(base64.b64encode(buf.getvalue()).decode())

# Extract raw image bytes for product pages
for i in range(len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    m = re.search(r'MODELO:\s*(.+)', text)
    if not m:
        continue
    modelo = m.group(1).strip().split('\n')[0].strip()

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

    entry = {'modelo': modelo, 'raws': raws}
    if i in ISA_PAGES:
        result['isa'].append(entry)
    elif i in CHINOS_PAGES:
        result['chinos'].append(entry)

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_isa_chinos.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 300 * 1024 * 1024,
}).toString();
const data = JSON.parse(jsonStr);
console.log(`ISA: ${data.isa.length} products, Chinese: ${data.chinos.length} products, Catalog pages: ${data.chinos_catalog.length}\n`);

// ─── Save Chinese catalog pages ───────────────────────────────────────────────
for (let i = 0; i < data.chinos_catalog.length; i++) {
    const buf      = Buffer.from(data.chinos_catalog[i], 'base64');
    const outPath  = path.join(CHINOS_CAT, `page-${String(i + 1).padStart(2, '0')}.jpg`);
    await sharp(buf).jpeg({ quality: 85 }).toFile(outPath);
    console.log(`  catalog page-${String(i + 1).padStart(2, '0')}.jpg`);
}
console.log();

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

// ─── Process product images ───────────────────────────────────────────────────

async function processProducts(entries, outDir, label) {
    console.log(`Processing ${label}…`);
    for (const { modelo, raws } of entries) {
        const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
        const outPath = path.join(outDir, `${safe}.png`);

        const usable = raws.filter(({ w, h }) => {
            if (w < MIN_DIM || h < MIN_DIM) return false;
            const ratio = w / h;
            return ratio >= (1 / MAX_RATIO) && ratio <= MAX_RATIO;
        });

        if (usable.length === 0) {
            console.log(`  [SKIP] ${modelo} — no usable images`);
            continue;
        }

        const strategy = usable.length === 1 ? 'single raw' : `multi-raw × ${usable.length}`;
        const rawBufs  = usable.map(({ b64 }) => Buffer.from(b64, 'base64'));

        const normalized = (await Promise.all(rawBufs.map(cropAndNormalize))).filter(Boolean);

        const valid = [];
        for (const v of normalized) {
            if ((await darkFrac(v.buf)) > 0.005) valid.push(v);
        }
        const final = valid.length > 0 ? valid : normalized.slice(0, 1);

        if (final.length === 0) {
            console.log(`  [SKIP] ${modelo} — all blank`);
            continue;
        }

        const outBuf = final.length === 1 ? await single(final[0]) : await stitchH(final);
        await sharp(outBuf).toFile(outPath);
        const meta = await sharp(outPath).metadata();
        console.log(`  ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
    }
}

await processProducts(data.isa,    ISA_DIR,    'ISA models');
console.log();
await processProducts(data.chinos, CHINOS_DIR, 'Chinese models');

console.log('\n✅ Done. All ISA and Chinese images written.');
