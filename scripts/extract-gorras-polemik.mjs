/**
 * extract-gorras-polemik.mjs — Gorras Polemik catalog extractor
 *
 * Full-page render via get_pixmap() — shows cap + swatches exactly as in the PDF.
 * Python writes each page PNG directly to a temp dir; Node reads them sequentially.
 *
 * Pipeline: full-page PNG → sharp.trim (white margin strip) →
 *           800×800 contain (white bg) → JPEG q80
 *
 * Usage: node scripts/extract-gorras-polemik.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/gorras-polemik');
const OUT_JSON  = path.join(ROOT, 'src/data/gorras-polemik.json');
const TMP_DIR   = path.join(tmpdir(), '_gorras_polemik_pix');

const DPI    = 150;
const JPEG_Q = 80;
const WHITE  = { r: 255, g: 255, b: 255 };

// ─── Scorched earth ───────────────────────────────────────────────────────────
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
import fitz, json, unicodedata, sys, os

PDF     = 'public/catalogos/gorras-polemik.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

ESTILO_MAP = {
    'CAMIONERAS AAA':            'CAMIONERA',
    'CAMIONERAS ECONOMICA':      'ECONOMICA',
    'CERRADA FLEX AAA':          'FLEX',
    'HEBILLA':                   'HEBILLA',
    'CIERRE MAGICO IMPERMEABLE': 'IMPERMEABLE',
    'BORDADAS CON HEBILLA':      'BORDADA',
    'PLANAS AAA':                'PLANA',
    'CUERINA':                   'CUERINA',
    'DAMA':                      'DAMA',
    'GOLEANAS':                  'GOLEANA',
    'BOINAS':                    'BOINA',
    'HEBILLA NINO':              'NINO',
    'HEBILLA NINA':              'NINA',
}

def strip_accents(s):
    n = unicodedata.normalize('NFD', s.upper())
    return ''.join(c for c in n if unicodedata.category(c) != 'Mn')

def normalise(text):
    t = ' '.join(text.strip().split())
    t = strip_accents(t)
    # check most-specific (longest) keys first to avoid substring false matches
    for k in sorted(ESTILO_MAP, key=len, reverse=True):
        if strip_accents(k) == t:
            return ESTILO_MAP[k]
    return None

doc    = fitz.open(PDF)
result = []
estilo = 'CAMIONERA'

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    imgs = page.get_images(full=True)

    if len(imgs) == 0:
        mapped = normalise(text)
        if mapped:
            estilo = mapped
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        continue

    modelo  = lines[0]
    pg_num  = i + 1  # 1-indexed for catalog pages

    # Render top 80% of page — clips out the model code text at the bottom.
    # The cap images and color swatches occupy y=0..~80% of the PDF page.
    r    = page.rect
    clip = fitz.Rect(0, 0, r.width, r.height * 0.80)
    pix  = page.get_pixmap(clip=clip, dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'modelo':   modelo,
        'estilo':   estilo,
        'page':     pg_num,
        'tmp_path': tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_gorras_polemik.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF (full-page, writing PNGs to tmp)…');
const jsonStr = execFileSync('python3', [tmpPy, TMP_DIR], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,  // metadata only — tiny
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { modelo, estilo, page, tmp_path } of pages) {
    let safe = modelo
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\]/g, '_')
        .slice(0, 80);

    if (usedSafes.has(safe)) safe = `${safe}-pg${page}`;
    usedSafes.add(safe);

    const outPath = path.join(OUT_IMG, `${safe}.jpg`);

    // Catalog pages use 2-digit padding for pages < 100, no extra padding for 100+
    const padded = String(page).padStart(2, '0');

    console.log(`[${done + 1}/${pages.length}] ${modelo} [${estilo}] (pg ${page})…`);

    jsonOut.push({
        modelo,
        estilo,
        img: `/catalogo-pages/gorras-polemik/page-${padded}.jpg`,
    });

    try {
        const { width: fullW, height: fullH } = await sharp(tmp_path).metadata();

        // Step 1: flatten + shave 2% top/bottom into a buffer.
        // trim() cannot chain after extract() in the same pipeline (libvips bug).
        const shaved = await sharp(tmp_path)
            .flatten({ background: WHITE })
            .extract({
                left: 0,
                top: Math.floor(fullH * 0.02),
                width: fullW,
                height: Math.floor(fullH * 0.96)
            })
            .toBuffer();

        // Step 2: fresh sharp instance — trim() now works cleanly on the shaved buffer.
        await sharp(shaved)
            .trim({ threshold: 30 })
            .resize(500, 200, { fit: 'contain', background: WHITE })
            .jpeg({ quality: 90 })
            .toFile(outPath);

        const meta = await sharp(outPath).metadata();
        console.log(`  → ${meta.width}×${meta.height}`);

        // Clean up temp file immediately to keep disk usage low
        if (existsSync(tmp_path)) unlinkSync(tmp_path);
    } catch (err) {
        console.error(`  → ERROR:`, err.message);
    }

    done++;
}

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products.`);
console.log(`📄 JSON → src/data/gorras-polemik.json`);
