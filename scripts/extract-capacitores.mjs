/**
 * extract-capacitores.mjs — Capacitores catalog extractor
 *
 * Covers: capacitors (CTL/MT/TS), circuits (CIR-xxx), movement parts.
 * PyMuPDF full-page pixmap → tmp PNG → 600×600 pipeline
 *
 * Usage: node scripts/extract-capacitores.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/capacitores');
const OUT_JSON  = path.join(ROOT, 'src/data/capacitores.json');
const TMP_DIR   = path.join(tmpdir(), '_capacitores_pix');

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

PDF     = 'public/catalogos/capacitores.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

# Section headers that signal the real model is on the NEXT line
SECTION_HEADERS = {'CIRCUITOS', 'CIRCUITO', 'VOLANTES', 'BOBINAS',
                   'TIJAS Y ALARGATIJAS', 'LINGUETES', 'JUEGO DE PUNTEROS', 'PUENTE'}

BRAND_RE  = re.compile(r'\(?(EPSON|MIYOTA|SII|RONDA|ISA|ETA|CASIO|CITIZEN|SEIKO|SONY|PANASONIC)\)?\s*$', re.IGNORECASE)
BRAND_IN  = re.compile(r'\b(EPSON|MIYOTA|SII|RONDA|ISA|ETA|Casio|Citizen|Seiko|Sony|Panasonic)\b')
EQUIV_RE  = re.compile(r'[=]\s*([\d\-\.]+(?:/[\d\-\.]+)*(?:\s*\([^\)]+\))?)')

def categoria(modelo):
    u = modelo.upper()
    if u.startswith('CIR-'):     return 'Circuito'
    if re.match(r'^(CTL|MT|TS)', u): return 'Capacitor'
    return 'Componente'

def extract_brand(text, modelo_line):
    # Try suffix brand in model line first
    m = BRAND_RE.search(modelo_line)
    if m:
        return m.group(1).capitalize()
    # Fall back to any brand in full text
    m2 = BRAND_IN.search(text)
    if m2:
        return m2.group(1).capitalize()
    return ''

doc    = fitz.open(PDF)
result = []

for i in range(5, len(doc)):  # skip pages 1-5 (cover/guide)
    page = doc[i]
    text = page.get_text().strip()
    imgs = page.get_images()

    if not text:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        continue

    # Determine modelo depending on section type
    if lines[0].upper() in SECTION_HEADERS:
        if len(lines) < 2:
            continue  # no product details (e.g. bare BOBINAS page)
        tipo_section = lines[0]
        modelo_raw   = lines[1]
        descripcion  = ' '.join(lines[2:])
    else:
        tipo_section = ''
        modelo_raw   = lines[0]
        descripcion  = ' '.join(lines[1:])

    # Split brand suffix from model line: "CIR-YM62 (EPSON)" → "CIR-YM62", brand="EPSON"
    brand = extract_brand(text, modelo_raw)
    modelo_clean = BRAND_RE.sub('', modelo_raw).strip()

    # Split equivalente: "MT1620=295-4400" or "CTL920F = 295-6900"
    eq_match = EQUIV_RE.search(modelo_clean)
    if eq_match:
        equivalente  = eq_match.group(1).strip()
        modelo_clean = modelo_clean[:eq_match.start()].rstrip('= ').strip()
    else:
        equivalente = ''

    cat = tipo_section if tipo_section else categoria(modelo_clean)

    pg_num   = i + 1
    pix      = page.get_pixmap(dpi=DPI, alpha=False)
    tmp_path = os.path.join(TMP_DIR, f'page_{pg_num:04d}.png')
    pix.save(tmp_path)

    result.append({
        'modelo':      modelo_clean,
        'equivalente': equivalente,
        'marca':       brand,
        'categoria':   cat,
        'descripcion': descripcion,
        'page':        pg_num,
        'tmp_path':    tmp_path,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_capacitores.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy, TMP_DIR], {
    cwd: ROOT,
    maxBuffer: 4 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Exception list (800×800 safe path) ──────────────────────────────────────
const EXCEPTION_MODELS = [];

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { modelo, equivalente, marca, categoria, descripcion, page, tmp_path } of pages) {
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

    console.log(`[${done + 1}/${pages.length}] ${modelo}${equivalente ? ` = ${equivalente}` : ''} [${categoria}${marca ? ' / ' + marca : ''}] (pg ${page})…`);

    jsonOut.push({
        modelo,
        equivalente,
        marca,
        categoria,
        descripcion,
        img: `/catalogo-pages/capacitores/page-${padded}.jpg`,
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
console.log(`📄 JSON → src/data/capacitores.json`);
