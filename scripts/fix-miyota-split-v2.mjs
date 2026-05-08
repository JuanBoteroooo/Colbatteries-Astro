/**
 * fix-miyota-split-v2.mjs
 * Correctly splits 28 Miyota composite-JPEG models into horizontal stitches.
 *
 * Root cause of previous failure: the 95%-white-row threshold was too lenient —
 * rows with 1-2 mechanism pixels (min=130 but mean≈254) were misclassified as
 * "white," fragmenting movement views into tiny sub-pieces.
 *
 * Fix:
 *  - Strict white-row criterion: ALL pixels in a row must have every channel
 *    >= 245 (handles JPEG artifacts while rejecting mechanism-detail rows).
 *  - Minimum separator band: at least 5 consecutive strict-white rows to count
 *    as a valid separator (prevents micro-splits from isolated JPEG noise).
 *  - Normalize each cropped segment to the SAME HEIGHT (TARGET_H, maintaining
 *    aspect ratio) before compositing, so all views appear at the same scale.
 *  - 50 px gap between views on a pure-white canvas.
 *
 * Usage:  node scripts/fix-miyota-split-v2.mjs
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
const TARGET_H  = 302;   // final height of each view
const GAP       = 50;    // px between views
const PAD       = 20;    // canvas padding on all sides
const WHITE     = { r: 255, g: 255, b: 255 };

const FORCE_SPLIT = new Set([
    '0S10-3', '0S21-4', '1L40', '1L45', '5R21', '5R32',
    '6P27', '6P29', '9T13-3', '9T22', '9T33',
    '2005-3', '2015-3/6', '2035', '2036', '2039',
    '2105-3', '2115-3/6', '2315-3/6', '2415-3/6',
    'GL02-3', 'GL12-3/6', 'GL32', 'GM02-3',
    'JR20-6', 'JS15-3', 'JS25-4', 'JS26-4',
]);

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python: extract raw JPEG bytes for target models ─────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF = 'public/catalogos/movimientos-miyota.pdf'
TARGETS = set([
    '0S10-3', '0S21-4', '1L40', '1L45', '5R21', '5R32',
    '6P27', '6P29', '9T13-3', '9T22', '9T33',
    '2005-3', '2015-3/6', '2035', '2036', '2039',
    '2105-3', '2115-3/6', '2315-3/6', '2415-3/6',
    'GL02-3', 'GL12-3/6', 'GL32', 'GM02-3',
    'JR20-6', 'JS15-3', 'JS25-4', 'JS26-4',
])

doc    = fitz.open(PDF)
result = []
for i in range(len(doc)):
    page  = doc[i]
    text  = page.get_text()
    if 'MODELO:' not in text:
        continue
    m = re.search(r'MODELO:\s*(.+)', text)
    if not m:
        continue
    modelo = m.group(1).strip().split('\n')[0].strip()
    if modelo not in TARGETS:
        continue
    imgs = page.get_images(full=True)
    if not imgs:
        continue
    xref    = imgs[0][0]
    img_raw = doc.extract_image(xref)['image']
    result.append({ 'modelo': modelo, 'raw_b64': base64.b64encode(img_raw).decode() })
    print(f'  {modelo}', file=sys.stderr)
doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_fix_miyota_v2.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting raw images via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 200 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} models\n`);

// ─── Sharp helpers ────────────────────────────────────────────────────────────

/**
 * Finds pixel bounds of non-white content within buf.
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
 * Splits a portrait/landscape JPEG containing stacked views into one PNG buffer
 * per view.  Returns [buf] unchanged if no valid separator is found.
 *
 * Algorithm:
 *  1. Strict white-row test: ALL pixels must have every channel >= 245.
 *     (Threshold 245, not 255, to absorb JPEG compression artifacts at
 *     true-white regions without misclassifying mechanism-detail rows where
 *     min brightness is typically < 200.)
 *  2. Minimum separator band: requires at least MIN_BAND consecutive such rows.
 *  3. Content segments between bands that are >= MIN_SEG px tall are kept.
 */
async function splitVertical(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const WHITE_CH  = 245;  // per-channel minimum for a pixel to be "white"
    const MIN_BAND  = 5;    // consecutive strict-white rows = valid separator
    const MIN_SEG   = 40;   // minimum content-segment height (px)
    const SEG_PAD   = 6;    // pixel padding when extracting each segment

    // Mark rows where ALL pixels have every channel >= WHITE_CH
    const strictWhite = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
        let allWhite = true;
        for (let x = 0; x < width && allWhite; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < WHITE_CH || data[i + 1] < WHITE_CH || data[i + 2] < WHITE_CH) {
                allWhite = false;
            }
        }
        strictWhite[y] = allWhite ? 1 : 0;
    }

    // Build "valid separator" mask: only rows inside a band >= MIN_BAND wide
    const sepMask = new Uint8Array(height);
    let y = 0;
    while (y < height) {
        if (!strictWhite[y]) { y++; continue; }
        const bandStart = y;
        while (y < height && strictWhite[y]) y++;
        const bandEnd = y; // exclusive
        if (bandEnd - bandStart >= MIN_BAND) {
            for (let r = bandStart; r < bandEnd; r++) sepMask[r] = 1;
        }
    }

    // Collect content segments (runs of non-separator rows)
    const segs = [];
    let inSeg = false, segStart = 0;
    for (let r = 0; r < height; r++) {
        if (!sepMask[r] && !inSeg) { segStart = r; inSeg = true; }
        else if (sepMask[r] && inSeg) { segs.push([segStart, r]); inSeg = false; }
    }
    if (inSeg) segs.push([segStart, height]);

    const bigSegs = segs.filter(([a, b]) => b - a >= MIN_SEG);
    if (bigSegs.length < 2) return [buf]; // no valid split

    // Extract each segment as a PNG buffer (with a little padding to avoid edge crops)
    const crops = [];
    for (const [segTop, segBot] of bigSegs) {
        const top    = Math.max(0, segTop - SEG_PAD);
        const bot    = Math.min(height, segBot + SEG_PAD);
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
 * Crops tight to content bounds (with CROP_PAD margin), then resizes to
 * exactly TARGET_H tall while maintaining aspect ratio.
 * Returns { buf: PNG, width, height } or null if blank.
 */
async function cropAndNormalize(inputBuf) {
    const CROP_PAD = 12;
    const b = await contentBounds(inputBuf);
    if (b.bot < 0) return null;

    const left  = Math.max(0, b.left  - CROP_PAD);
    const top   = Math.max(0, b.top   - CROP_PAD);
    const right = Math.min(b.width,  b.right  + CROP_PAD + 1);
    const bot   = Math.min(b.height, b.bot    + CROP_PAD + 1);
    const cropW = right - left;
    const cropH = bot   - top;

    // Resize to TARGET_H, let sharp compute width to maintain aspect ratio
    const buf = await sharp(inputBuf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: cropW, height: cropH })
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

/** Stitch views side-by-side on a pure-white canvas. */
async function stitchH(views) {
    const totalW = views.reduce((s, v) => s + v.width, 0)
                 + GAP * (views.length - 1) + PAD * 2;
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

/** Single view on white canvas with PAD border. */
async function single(view) {
    const { buf, width } = view;
    return sharp({ create: { width: width + PAD * 2, height: TARGET_H + PAD * 2, channels: 3, background: WHITE } })
        .composite([{ input: buf, left: PAD, top: PAD }])
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
for (const { modelo, raw_b64 } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    const rawBuf = Buffer.from(raw_b64, 'base64');
    const segs   = await splitVertical(rawBuf);

    const strategy = segs.length > 1
        ? `split → ${segs.length} views`
        : 'no split (single view)';

    // Crop + normalize each segment to TARGET_H
    const normalized = (await Promise.all(segs.map(cropAndNormalize))).filter(Boolean);

    // Drop blank views (all-white after flattening)
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
    console.log(`  ✓ ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
}

console.log('\n✅ Done. All split images overwritten with correct horizontal stitches.');
