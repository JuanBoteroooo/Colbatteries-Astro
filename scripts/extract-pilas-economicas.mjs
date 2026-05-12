/**
 * extract-pilas-economicas.mjs — Pilas Económicas catalog extractor
 *
 * PyMuPDF full-page pixmap → tmp PNG → 600×600 pipeline
 *
 * Usage: node scripts/extract-pilas-economicas.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/pilas-economicas');
const OUT_JSON  = path.join(ROOT, 'src/data/pilas-economicas.json');
const TMP_DIR   = path.join(tmpdir(), '_pilas_economicas_pix');

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

PDF     = 'public/catalogos/pilas-economicas.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

# Strip brand prefixes to isolate the core model
BRAND_RE = re.compile(r'^(?:Q&Q\s+COLBATTERIES|COLBATTERIES|SSUO|SSOU)\s*', re.IGNORECASE)
CHEM_RE  = re.compile(r'\b(ALKALINA|ALCALINA|LITIO|LITHIUM|SILVER\s*OXIDE)\b', re.IGNORECASE)
VOLT_RE  = re.compile(r'\b(\d+(?:\.\d+)?V)\b', re.IGNORECASE)

def infer_quimica(modelo):
    u = modelo.upper()
    if u.startswith('CR'):  return 'Litio'
    if u.startswith('LR'):  return 'Alcalina'
    if u.startswith('SR'):  return 'Óxido de Plata'
    return ''

def infer_voltaje(modelo):
    u = modelo.upper()
    if u.startswith('CR'):  return '3V'
    if u.startswith('LR'):  return '1.5V'
    if u.startswith('SR'):  return '1.55V'
    return ''

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    imgs = page.get_images()

    # Skip pages with no text and no product images
    if not text and not imgs:
        continue

    # Skip blank-text pages that only have a catalog banner (no extractable product)
    if not text:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        continue

    # Join lines[0] + lines[1] in case model name continues on next line
    raw_joined = ' '.join(lines[:2]) if len(lines) > 1 else lines[0]
    raw = lines[0]
    marca_match = re.match(r'^(Q&Q\s+COLBATTERIES|COLBATTERIES|SSUO|SSOU)\b', raw, re.IGNORECASE)
    marca = marca_match.group(1).strip() if marca_match else ''

    # Remove brand prefix from joined text so multi-line models are captured
    core = BRAND_RE.sub('', raw_joined).strip()

    # Detect explicit chemistry word in core
    chem_word = CHEM_RE.search(core)
    if chem_word:
        core = core[:chem_word.start()].strip() + ' ' + core[chem_word.end():].strip()
        core = core.strip()
        quimica_override = 'Alcalina' if 'ALKAL' in chem_word.group(0).upper() or 'ALCAL' in chem_word.group(0).upper() else 'Litio'
    else:
        quimica_override = ''

    # Detect explicit voltage in core
    volt_word = VOLT_RE.search(core)
    if volt_word:
        voltaje_override = volt_word.group(1)
        core = core[:volt_word.start()].strip() + ' ' + core[volt_word.end():].strip()
        core = core.strip()
    else:
        voltaje_override = ''

    # Split "LR626-377" → modelo=LR626, equivalente=377
    if '-' in core and re.search(r'-\d{2,3}$', core):
        parts = core.rsplit('-', 1)
        modelo     = parts[0].strip()
        equivalente = parts[1].strip()
    else:
        modelo     = core.strip()
        equivalente = ''

    quimica = quimica_override or infer_quimica(modelo)
    voltaje = voltaje_override or infer_voltaje(modelo)

    descripcion = ' '.join(lines[1:])

    pg_num   = i + 1
    pix      = page.get_pixmap(dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'modelo':      modelo,
        'equivalente': equivalente,
        'marca':       marca,
        'descripcion': descripcion,
        'quimica':     quimica,
        'voltaje':     voltaje,
        'page':        pg_num,
        'tmp_path':    tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_pilas_economicas.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy, TMP_DIR], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Exception list (800×800 safe path) ──────────────────────────────────────
const EXCEPTION_MODELS = [
    // Add exception models here as needed
];

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { modelo, equivalente, marca, descripcion, quimica, voltaje, page, tmp_path } of pages) {
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

    console.log(`[${done + 1}/${pages.length}] ${modelo}${equivalente ? ` / ${equivalente}` : ''} [${quimica} ${voltaje}] (pg ${page})…`);

    jsonOut.push({
        modelo,
        equivalente,
        marca,
        descripcion,
        quimica,
        voltaje,
        img: `/catalogo-pages/pilas-economicas/page-${padded}.jpg`,
    });

    try {
        const { width: fullW, height: fullH } = await sharp(tmp_path).metadata();
        const isException = EXCEPTION_MODELS.some(ex => modelo.includes(ex));

        if (isException) {
            const shaved = await sharp(tmp_path)
                .flatten({ background: WHITE })
                .extract({
                    left:   0,
                    top:    Math.floor(fullH * 0.02),
                    width:  fullW,
                    height: Math.floor(fullH * 0.96),
                })
                .toBuffer();

            await sharp(shaved)
                .trim({ threshold: 25 })
                .resize(800, 800, { fit: 'contain', background: WHITE })
                .jpeg({ quality: 95 })
                .toFile(outPath);
        } else {
            // 4% top / 12% bottom → 84% height band, 600×600.
            const cropped = await sharp(tmp_path)
                .flatten({ background: WHITE })
                .extract({
                    left:   0,
                    top:    Math.floor(fullH * 0.04),
                    width:  fullW,
                    height: Math.floor(fullH * 0.84),
                })
                .toBuffer();

            await sharp(cropped)
                .trim({ threshold: 30 })
                .resize(600, 600, { fit: 'contain', background: WHITE })
                .jpeg({ quality: 95 })
                .toFile(outPath);
        }

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
console.log(`📄 JSON → src/data/pilas-economicas.json`);
