/**
 * extract-baterias-maxell.mjs — Baterías Maxell catalog extractor
 *
 * PyMuPDF full-page pixmap → tmp PNG → 600×600 pipeline
 *
 * Usage: node scripts/extract-baterias-maxell.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/baterias-maxell');
const OUT_JSON  = path.join(ROOT, 'src/data/baterias-maxell.json');
const TMP_DIR   = path.join(tmpdir(), '_baterias_maxell_pix');

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

PDF     = 'public/catalogos/baterias-maxell.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

def infer_quimica(modelo):
    u = modelo.upper()
    if u.startswith('CR'):    return 'Litio'
    if u.startswith('SR'):    return 'Óxido de Plata'
    if u.startswith('LR'):    return 'Alcalina'
    if u.startswith('M-ZA'):  return 'Zinc-Air'
    if re.match(r'^(AA|AAA|MAXELL-[CD]|MAXELL\s*9)', u): return 'Alcalina'
    return ''

def infer_voltaje(modelo):
    u = modelo.upper()
    if u.startswith('CR'):    return '3V'
    if u.startswith('SR'):    return '1.55V'
    if u.startswith('LR'):    return '1.5V'
    if u.startswith('M-ZA'):  return '1.4V'
    if 'AAA' in u or 'AA-' in u or 'MAXELL-C' in u or 'MAXELL-D' in u: return '1.5V'
    if '9V' in u:             return '9V'
    return ''

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        continue

    modelo_raw  = lines[0]
    descripcion = ' '.join(lines[1:])

    # Split "SR626SW / 377" → modelo="SR626SW", equivalente="377"
    if '/' in modelo_raw:
        parts      = [p.strip() for p in modelo_raw.split('/', 1)]
        modelo     = parts[0]
        equivalente = parts[1] if len(parts) > 1 else ''
    else:
        modelo      = modelo_raw
        equivalente = ''

    quimica  = infer_quimica(modelo)
    voltaje  = infer_voltaje(modelo)

    pg_num   = i + 1
    pix      = page.get_pixmap(dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'modelo':      modelo,
        'equivalente': equivalente,
        'descripcion': descripcion,
        'quimica':     quimica,
        'voltaje':     voltaje,
        'page':        pg_num,
        'tmp_path':    tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_baterias_maxell.py');
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

for (const { modelo, equivalente, descripcion, quimica, voltaje, page, tmp_path } of pages) {
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
        descripcion,
        quimica,
        voltaje,
        img: `/catalogo-pages/baterias-maxell/page-${padded}.jpg`,
    });

    try {
        const { width: fullW, height: fullH } = await sharp(tmp_path).metadata();
        const isException = EXCEPTION_MODELS.some(ex => modelo.includes(ex));

        if (isException) {
            // Safe 800×800: 2% shave, gentle trim.
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
            // Battery: 4% top / 12% bottom → 84% height band, 600×600.
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
console.log(`📄 JSON → src/data/baterias-maxell.json`);
