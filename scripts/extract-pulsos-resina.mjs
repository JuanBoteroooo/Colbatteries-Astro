/**
 * extract-pulsos-resina.mjs — Pulsos de Resina catalog extractor
 *
 * PyMuPDF full-page pixmap → tmp PNG → safe 800×800 baseline pipeline
 *
 * Usage: node scripts/extract-pulsos-resina.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const OUT_IMG   = path.join(ROOT, 'public/images/productos/pulso-resina');
const OUT_JSON  = path.join(ROOT, 'src/data/pulsos-resina.json');
const TMP_DIR   = path.join(tmpdir(), '_pulsos_resina_pix');

const JPEG_Q = 80;
const WHITE  = { r: 255, g: 255, b: 255 };

// ─── Clean slate ─────────────────────────────────────────────────────────────
mkdirSync(OUT_IMG,  { recursive: true });
mkdirSync(TMP_DIR,  { recursive: true });

const existing = readdirSync(OUT_IMG).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
console.log(`Deleting ${existing.length} old product images…`);
for (const f of existing) rmSync(path.join(OUT_IMG, f));

const tmpFiles = readdirSync(TMP_DIR);
for (const f of tmpFiles) rmSync(path.join(TMP_DIR, f));
console.log('Clean.\n');

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, re, sys, os

PDF     = 'public/catalogos/pulso-resina.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

# Lines starting with these prefixes are the actual reference/SKU code
CODE_RE = re.compile(r'^(PPU|PURES|PUREF|PIPU|PIPUPU)', re.IGNORECASE)
# Extract mm measurement anywhere in text
MEDIDA_RE = re.compile(r'\b(\d{2})MM\b', re.IGNORECASE)

def parse_page(text):
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        return None

    sku_lines  = [l for l in lines if CODE_RE.match(l)]
    desc_lines = [l for l in lines if not CODE_RE.match(l)]

    if sku_lines:
        modelo     = sku_lines[0]
        descripcion = ' '.join(desc_lines)
    else:
        # Descriptive format: "PULSO DE RESINA NEGRO 1817-18MM"
        modelo     = lines[0]
        descripcion = ' '.join(lines[1:])

    # First mm value found wins for medida
    m = MEDIDA_RE.search(text.upper())
    medida = m.group(1) + 'mm' if m else ''

    return {'modelo': modelo, 'descripcion': descripcion, 'medida': medida}

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue

    parsed = parse_page(text)
    if not parsed:
        continue

    pg_num   = i + 1
    pix      = page.get_pixmap(dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'modelo':      parsed['modelo'],
        'descripcion': parsed['descripcion'],
        'medida':      parsed['medida'],
        'page':        pg_num,
        'tmp_path':    tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_pulsos_resina.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy, TMP_DIR], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Per-catalog crop options ─────────────────────────────────────────────────
const CROP_OPTS = { topScanTo: 0.30, bottomScanFrom: 0.65 };

// ─── Dynamic row-density crop boundary detector ───────────────────────────────
async function findContentBounds(tmpPath, { topScanTo = 0.35, bottomScanFrom = 0.65 } = {}) {
    const { data, info } = await sharp(tmpPath)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const W = info.width, H = info.height, C = info.channels;

    const rowDensity = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * C;
            if (data[idx] < 242 || data[idx + 1] < 242 || data[idx + 2] < 242) n++;
        }
        rowDensity[y] = n / W;
    }

    const K = 2;
    const smooth = new Float32Array(H);
    for (let y = K; y < H - K; y++) {
        let s = 0;
        for (let k = -K; k <= K; k++) s += rowDensity[y + k];
        smooth[y] = s / (2 * K + 1);
    }

    const GAP_THRESH = 0.01;
    const MIN_GAP    = 5;

    let topCrop = 0;
    {
        let inGap = false, gapStart = -1, seenContent = false;
        for (let y = 0; y < Math.floor(H * topScanTo); y++) {
            if (smooth[y] >= GAP_THRESH) {
                seenContent = true;
                if (inGap && y - gapStart >= MIN_GAP) topCrop = y;
                inGap = false;
            } else {
                if (seenContent && !inGap) { inGap = true; gapStart = y; }
            }
        }
    }

    let bottomCrop = H;
    {
        let inGap = false, gapStart = -1, seenContent = false;
        for (let y = H - 1; y >= Math.floor(H * bottomScanFrom); y--) {
            if (smooth[y] >= GAP_THRESH) {
                seenContent = true;
                if (inGap && gapStart - y >= MIN_GAP) bottomCrop = y + 1;
                inGap = false;
            } else {
                if (seenContent && !inGap) { inGap = true; gapStart = y; }
            }
        }
    }

    return { topCrop, bottomCrop };
}

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { modelo, descripcion, medida, page, tmp_path } of pages) {
    let safe = modelo
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\()\[\]]/g, '_')
        .slice(0, 80);

    if (usedSafes.has(safe)) safe = `${safe}-pg${page}`;
    usedSafes.add(safe);

    const outPath = path.join(OUT_IMG, `${safe}.jpg`);
    const padded  = String(page).padStart(2, '0');

    console.log(`[${done + 1}/${pages.length}] ${modelo} [${medida}] (pg ${page})…`);

    jsonOut.push({
        modelo,
        descripcion,
        medida,
        img: `/catalogo-pages/pulso-resina/page-${padded}.jpg`,
    });

    try {
        const { width: fullW, height: fullH } = await sharp(tmp_path).metadata();
        const { topCrop, bottomCrop } = await findContentBounds(tmp_path, CROP_OPTS);
        const cropH = Math.max(bottomCrop - topCrop, 1);

        const cropped = await sharp(tmp_path)
            .flatten({ background: WHITE })
            .extract({ left: 0, top: topCrop, width: fullW, height: cropH })
            .toBuffer();

        await sharp(cropped)
            .trim({ threshold: 30 })
            .resize(800, 800, { fit: 'contain', background: WHITE })
            .jpeg({ quality: 80 })
            .toFile(outPath);

        const meta = await sharp(outPath).metadata();
        console.log(`  → ${meta.width}×${meta.height} [crop ${topCrop}→${bottomCrop}]`);

        if (existsSync(tmp_path)) unlinkSync(tmp_path);
    } catch (err) {
        console.error(`  → ERROR:`, err.message);
    }

    done++;
}

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products.`);
console.log(`📄 JSON → src/data/pulsos-resina.json`);
