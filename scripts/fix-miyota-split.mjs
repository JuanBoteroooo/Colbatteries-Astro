/**
 * fix-miyota-split.mjs
 * Re-processes 28 Miyota models that were extracted as a single tall composite
 * instead of being horizontally stitched.  Each raw JPEG contains two (or more)
 * movement views stacked vertically, separated by a white horizontal band.
 * This script detects that band, splits the image into segments, then stitches
 * them side-by-side horizontally — identical to the EPSON/SII FORCE_SPLIT flow.
 *
 * Usage:  node scripts/fix-miyota-split.mjs
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

const FORCE_SPLIT = new Set([
    '0S10-3', '0S21-4', '1L40', '1L45', '5R21', '5R32',
    '6P27', '6P29', '9T13-3', '9T22', '9T33',
    '2005-3', '2015-3/6', '2035', '2036', '2039',
    '2105-3', '2115-3/6', '2315-3/6', '2415-3/6',
    'GL02-3', 'GL12-3/6', 'GL32', 'GM02-3',
    'JR20-6', 'JS15-3', 'JS25-4', 'JS26-4',
]);

mkdirSync(OUT_DIR, { recursive: true });

// ─── Python: extract raw bytes for target models ───────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF     = 'public/catalogos/movimientos-miyota.pdf'
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

    # Use the first (and only) embedded image
    xref    = imgs[0][0]
    img_raw = doc.extract_image(xref)['image']
    result.append({
        'modelo':  modelo,
        'raw_b64': base64.b64encode(img_raw).decode(),
    })
    print(f'  Extracted raw bytes for {modelo}', file=sys.stderr)

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_fix_miyota_split.py');
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
 * Splits a composite image (multiple views stacked top/bottom, separated by
 * white rows) into PNG buffers — one per segment.
 * Returns the original [buf] if no clean split is found.
 * Uses a "mostly-white" row criterion (95 % of pixels >= threshold) to survive
 * mild JPEG compression artifacts at the separator.
 */
async function splitVertical(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    const WHITE_THRESH  = 245;  // channel value considered "white"
    const WHITE_FRAC    = 0.95; // fraction of pixels per row that must be white

    const isWhite = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
        let whitePx = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (data[i] >= WHITE_THRESH && data[i + 1] >= WHITE_THRESH && data[i + 2] >= WHITE_THRESH) {
                whitePx++;
            }
        }
        isWhite[y] = (whitePx / width) >= WHITE_FRAC ? 1 : 0;
    }

    // Find content segments (contiguous runs of non-white rows)
    const segs = [];
    let inSeg = false, start = 0;
    for (let y = 0; y < height; y++) {
        if (!isWhite[y] && !inSeg) { start = y; inSeg = true; }
        else if (isWhite[y] && inSeg) { segs.push([start, y]); inSeg = false; }
    }
    if (inSeg) segs.push([start, height]);

    // Need at least 2 meaningful segments (each >= 40 px tall)
    const bigSegs = segs.filter(([a, b]) => b - a >= 40);
    if (bigSegs.length < 2) return [buf];

    const SEG_PAD = 8;
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
for (const { modelo, raw_b64 } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-');
    const outPath = path.join(OUT_DIR, `${safe}.png`);

    const rawBuf = Buffer.from(raw_b64, 'base64');
    const segs   = await splitVertical(rawBuf);
    const strategy = segs.length > 1
        ? `vertical-split → ${segs.length} segs`
        : 'no-split (single segment)';

    const resized = (await Promise.all(segs.map(cropAndResize))).filter(Boolean);

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
    console.log(`  ✓ ${modelo}: ${meta.width}×${meta.height}  [${strategy}]`);
}

console.log('\n✅ Done. All split images overwritten.');
