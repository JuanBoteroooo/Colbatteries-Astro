/**
 * extract-baterias-gp.mjs — Baterías GP catalog extractor
 *
 * Structured mode: one card per page. Skips blank pages and charger/accessories section.
 * Two-buffer sharp pipeline (trim cannot chain after extract in libvips).
 *
 * Usage: node scripts/extract-baterias-gp.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/baterias-gp');
const OUT_JSON  = path.join(ROOT, 'src/data/baterias-gp.json');
const TMP_DIR   = path.join(tmpdir(), '_baterias_gp_pix');

const WHITE = { r: 255, g: 255, b: 255 };

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

PDF     = 'public/catalogos/GP-BATTERIES.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

# Pages that are chargers/accessories/flashlights — not battery products
# (0-indexed page numbers)
SKIP_PAGES = set(range(53, 65)) | {76}  # charger section (pg54-65) + flashlight (pg77)

SKU_RE  = re.compile(r'^GP[A-Z0-9]+', re.IGNORECASE)
BAR_RE  = re.compile(r'\b(DESCRIPCI[OOÓ]N|CODIGO DE BARRAS)\b', re.IGNORECASE)

def is_sku(s):
    return bool(SKU_RE.match(s)) and ' ' not in s[:6]

def infer_quimica(sku):
    u = sku.upper()
    if re.search(r'CER|HCE|HCR|HR\d|BMU|BXZ', u): return 'NiMH Recargable'
    if 'GPZA' in u:                                  return 'Zinc-Aire'
    if re.match(r'GPCR|GP2CR5|GPCRP2|GPCR2P', u):  return 'Litio'
    if 'GL' in u and '1604' in u:                   return 'Zinc-Carbón'
    return 'Alcalina'

def infer_voltaje(sku):
    u = sku.upper()
    if re.match(r'GP20R8HR', u):                     return '8.4V'
    if re.search(r'CER|HCE|HCR|HR\d|BMU|BXZ', u): return '1.2V'
    if 'GPZA' in u:                                  return '1.4V'
    if re.match(r'GPCR|GP2CR5|GPCRP2|GPCR2P', u):  return '3V'
    if '1604' in u:                                  return '9V'
    if re.match(r'GP(23|27|476)A', u):               return '12V'
    return '1.5V'

doc    = fitz.open(PDF)
result = []

for i in range(len(doc)):
    if i in SKIP_PAGES:
        continue

    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    # Strip DESCRIPCION / CODIGO DE BARRAS noise
    lines = [l for l in lines if not BAR_RE.match(l)]
    if not lines:
        continue

    if is_sku(lines[0]):
        sku  = lines[0]
        desc = lines[1] if len(lines) > 1 else ''
    else:
        # Description first — find SKU elsewhere in text
        sku  = next((l for l in lines if is_sku(l) and ('-' in l or len(l) > 6)), '')
        desc = lines[0]

    # Skip if no meaningful product identifier
    if not sku and not desc:
        continue

    quimica = infer_quimica(sku)
    voltaje = infer_voltaje(sku)

    pg_num   = i + 1
    pix      = page.get_pixmap(dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'sku':        sku,
        'descripcion': desc,
        'quimica':    quimica,
        'voltaje':    voltaje,
        'page':       pg_num,
        'tmp_path':   tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_baterias_gp.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy, TMP_DIR], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Regenerate catalog-page images from valid PDF ───────────────────────────
const CAT_PAGES_DIR = path.join(ROOT, 'public/catalogo-pages/baterias-gp');
const CAT_PAGES_PY  = String.raw`
import fitz, sys, os

PDF = 'public/catalogos/GP-BATTERIES.pdf'
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

doc = fitz.open(PDF)
n = len(doc)
for i in range(n):
    pix = doc[i].get_pixmap(dpi=100, alpha=False)
    pix.save(os.path.join(OUT, f'page-{(i+1):02d}.jpg'))
doc.close()
print(f'Rendered {n} pages', flush=True)
`;

const tmpCatPy = path.join(tmpdir(), '_gp_catpages.py');
writeFileSync(tmpCatPy, CAT_PAGES_PY, 'utf8');
console.log('Regenerating catalog-page images from GP-BATTERIES.pdf…');
execFileSync('python3', [tmpCatPy, CAT_PAGES_DIR], { cwd: ROOT, stdio: ['pipe','pipe','inherit'] });
console.log('Catalog pages done.\n');

// ─── Dynamic product-boundary detection ─────────────────────────────────────
// Scans columns from x=15%→55% to find the first wide white gap
// (the dead zone between the product photo and the text column).
async function findCropWidth(tmpPath) {
    const { data, info } = await sharp(tmpPath)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const W = info.width, H = info.height, C = info.channels;
    const yStart = Math.floor(H * 0.10);
    const yEnd   = Math.floor(H * 0.85);

    // Per-column fraction of non-white pixels
    const density = new Float32Array(W);
    for (let x = 0; x < W; x++) {
        let n = 0;
        for (let y = yStart; y < yEnd; y++) {
            const i = (y * W + x) * C;
            if (data[i] < 242 || data[i + 1] < 242 || data[i + 2] < 242) n++;
        }
        density[x] = n / (yEnd - yStart);
    }

    // Smooth over 9-column window
    const K = 4;
    const smooth = new Float32Array(W);
    for (let x = K; x < W - K; x++) {
        let s = 0;
        for (let k = -K; k <= K; k++) s += density[x + k];
        smooth[x] = s / (2 * K + 1);
    }

    // Find first gap < 1.5% filled in range 15%–58%
    const GAP_THRESH = 0.015;
    const MIN_GAP_W  = 6;
    const xMin = Math.floor(W * 0.15);
    const xMax = Math.floor(W * 0.58);

    let gapStart = -1;
    for (let x = xMin; x < xMax; x++) {
        if (smooth[x] < GAP_THRESH) {
            if (gapStart === -1) gapStart = x;
        } else if (gapStart !== -1) {
            if (x - gapStart >= MIN_GAP_W) return gapStart;
            gapStart = -1;
        }
    }

    return Math.floor(W * 0.38);  // fallback
}

// ─── Core model extractor ────────────────────────────────────────────────────
function coreModel(sku) {
    if (!sku) return '';
    const base = sku.split(/-(?=\d)/)[0];     // strip "-2GSBC2" style suffix
    let m;
    m = base.match(/^(GPZA\d+)/i);            if (m) return m[1].toUpperCase();
    m = base.match(/^(GPCR[\dA-Z]+?)(?:[EF])?$/i); if (m) return m[1].toUpperCase();
    m = base.match(/^(GP(?:2CR5|CRP2|CR2P|CR123A[P]?))/i); if (m) return m[1].toUpperCase();
    m = base.match(/^(GP1604GL)/i);           if (m) return m[1].toUpperCase();
    m = base.match(/^(GP1604A)/i);            if (m) return m[1].toUpperCase();
    m = base.match(/^(GP20R8HR)/i);           if (m) return m[1].toUpperCase();
    // Alkaline size codes end in A not followed by another A (avoids matching GP60AAH etc.)
    m = base.match(/^(GP\d+A)(?=[^A]|$)/i);  if (m) return m[1].toUpperCase();
    m = base.match(/^(GP[A-Z]\d+)F?$/i);      if (m) return m[1].toUpperCase();
    m = base.match(/^(GP\d+)F?$/i);           if (m) return m[1].toUpperCase();
    return base.toUpperCase();
}

// ─── Friendly name map ───────────────────────────────────────────────────────
const NAME_MAP = {
    // Alkaline standard
    'GP13A':     'Pila D (GP13A)',
    'GP14A':     'Pila C (GP14A)',
    'GP15A':     'Pila AA (GP15A)',
    'GP24A':     'Pila AAA (GP24A)',
    'GP25A':     'Pila AAAA (GP25A)',
    'GP910A':    'Pila N/LR1 (GP910A)',
    // High-voltage alkaline
    'GP23A':     'Pila 23A (GP23A)',
    'GP27A':     'Pila 27A (GP27A)',
    'GP476A':    'Pila 476A (GP476A)',
    // 9V
    'GP1604A':   'Pila 9V Alcalina (GP1604A)',
    'GP1604GL':  'Pila 9V Zinc-Carbón (GP1604GL)',
    // Button alkaline
    'GP189':     'Pila AG10 / LR1130 (GP189)',
    'GP192':     'Pila AG3 / LR41 (GP192)',
    'GPA76':     'Pila AG13 / LR44 (GPA76)',
    // Lithium specialty
    'GP2CR5':    'Batería 2CR5 Litio (GP2CR5)',
    'GPCRP2':    'Batería CRP2 Litio (GPCRP2)',
    'GPCR2P':    'Batería CR-2 Litio (GPCR2P)',
    'GPCR123A':  'Batería CR123A Litio (GPCR123A)',
    // Lithium coin
    'GPCR1216':  'Pila CR1216 Litio (GPCR1216)',
    'GPCR1220':  'Pila CR1220 Litio (GPCR1220)',
    'GPCR1616':  'Pila CR1616 Litio (GPCR1616)',
    'GPCR1620':  'Pila CR1620 Litio (GPCR1620)',
    'GPCR1632':  'Pila CR1632 Litio (GPCR1632)',
    'GPCR2016':  'Pila CR2016 Litio (GPCR2016)',
    'GPCR2025':  'Pila CR2025 Litio (GPCR2025)',
    'GPCR2032':  'Pila CR2032 Litio (GPCR2032)',
    'GPCR2430':  'Pila CR2430 Litio (GPCR2430)',
    'GPCR2450':  'Pila CR2450 Litio (GPCR2450)',
    // Zinc-Air hearing aid
    'GPZA10':    'Pila Audífono ZA10 (GPZA10)',
    'GPZA13':    'Pila Audífono ZA13 (GPZA13)',
    'GPZA312':   'Pila Audífono ZA312 (GPZA312)',
    'GPZA675':   'Pila Audífono ZA675 (GPZA675)',
    // 9V NiMH rechargeable
    'GP20R8HR':  'Batería 9V NiMH Recargable (GP20R8HR)',
};

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { sku, descripcion, quimica, voltaje, page, tmp_path } of pages) {
    const core   = coreModel(sku);
    // modelo: NAME_MAP → PDF description → SKU
    const modelo = NAME_MAP[core] ?? (descripcion || sku);

    // nombreImagen: safe version of full SKU (stable filename key)
    const skuSafe = sku
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\()\[\]]/g, '_')
        .slice(0, 80);

    let safe = skuSafe;
    if (usedSafes.has(safe)) safe = `${safe}-pg${page}`;
    usedSafes.add(safe);

    const outPath = path.join(OUT_IMG, `${safe}.jpg`);
    const padded  = String(page).padStart(2, '0');

    console.log(`[${done + 1}/${pages.length}] ${modelo} [${quimica} ${voltaje}] (pg ${page}) SKU=${sku}…`);

    jsonOut.push({
        modelo,
        nombreImagen: safe,
        sku,
        descripcion,
        quimica,
        voltaje,
        page,
        img: `/catalogo-pages/baterias-gp/page-${padded}.jpg`,
    });

    try {
        const { width: fullW, height: fullH } = await sharp(tmp_path).metadata();

        // Two-buffer pipeline: trim cannot chain after extract in libvips
        const cropW = await findCropWidth(tmp_path);
        const cropped = await sharp(tmp_path)
            .flatten({ background: WHITE })
            .extract({
                left:   0,
                top:    Math.floor(fullH * 0.05),
                width:  cropW,
                height: Math.floor(fullH * 0.90),
            })
            .toBuffer();

        await sharp(cropped)
            .trim({ threshold: 45 })
            .resize(800, 800, { fit: 'contain', background: WHITE })
            .jpeg({ quality: 95 })
            .toFile(outPath);

        const meta = await sharp(outPath).metadata();
        console.log(`  → ${meta.width}×${meta.height}`);

        if (existsSync(tmp_path)) unlinkSync(tmp_path);
    } catch (err) {
        console.error(`  → ERROR:`, err.message);
    }

    done++;
}

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products.`);
console.log(`📄 JSON → src/data/baterias-gp.json`);
