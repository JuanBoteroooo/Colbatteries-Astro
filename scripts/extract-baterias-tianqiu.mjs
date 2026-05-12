/**
 * extract-baterias-tianqiu.mjs — Baterías Tianqiu catalog extractor
 *
 * PyMuPDF full-page pixmap → tmp PNG → 600×600 pipeline
 *
 * Usage: node scripts/extract-baterias-tianqiu.mjs
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
const OUT_IMG   = path.join(ROOT, 'public/images/productos/baterias-tianqiu');
const OUT_JSON  = path.join(ROOT, 'src/data/baterias-tianqiu.json');
const TMP_DIR   = path.join(tmpdir(), '_baterias_tianqiu_pix');

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

PDF     = 'public/catalogos/baterias-tianqiu.pdf'
DPI     = 150
TMP_DIR = sys.argv[1]

PAREN_RE = re.compile(r'\(([^)]+)\)')

def parse_paren(content):
    """Return (equivalente, quimica_hint) from parenthesised text."""
    c = content.upper()
    quimica_hint = ''
    equiv        = ''

    if 'RECARGABLE' in c or 'RECARGABL' in c:
        quimica_hint = 'Li-Ion Recargable'
    elif 'CARBON' in c or 'CARBÓN' in c:
        quimica_hint = 'Zinc-Carbón'
    elif 'ALCALINA' in c or 'ALKALINE' in c:
        quimica_hint = 'Alcalina'

    # Everything that isn't a chemistry word is the equivalente
    clean = re.sub(r'\b(TIPO|CARBON|CARBÓN|ALCALINA|ALKALINE|RECARGABLE)\b', '', content, flags=re.IGNORECASE).strip()
    if clean:
        equiv = clean.strip()

    return equiv, quimica_hint

def infer_quimica(modelo):
    u = modelo.upper()
    if u.startswith('CR'):                      return 'Litio',         '3V'
    if u.startswith('LR'):                      return 'Alcalina',      '1.5V'
    if u == '18650':                            return 'Li-Ion Recargable', '3.7V'
    if re.match(r'^(R20|R6P|R03|9V)', u):       return 'Zinc-Carbón',   '1.5V' if '9V' not in u else '9V'
    if u in ('23A', '27A'):                     return 'Alcalina',      '12V'
    return '', ''

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

    raw = lines[0]
    # Strip "TQ/" prefix
    core = re.sub(r'^TQ/', '', raw, flags=re.IGNORECASE).strip()

    # Extract parenthesised portion
    paren_match = PAREN_RE.search(core)
    paren_equiv, quimica_hint = ('', '')
    if paren_match:
        paren_equiv, quimica_hint = parse_paren(paren_match.group(1))
        core = core[:paren_match.start()].strip()

    # Handle "9V CARBON" style (no parens)
    if 'CARBON' in core.upper():
        quimica_hint = 'Zinc-Carbón'
        core = re.sub(r'\s*CARBON\s*', '', core, flags=re.IGNORECASE).strip()

    modelo = core.strip()
    equivalente = paren_equiv.strip()
    descripcion = ' '.join(lines[1:])

    q_inferred, v_inferred = infer_quimica(modelo)
    quimica = quimica_hint or q_inferred
    voltaje = v_inferred

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

const tmpPy = path.join(tmpdir(), '_extract_baterias_tianqiu.py');
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

// ─── Friendly name map ───────────────────────────────────────────────────────
const NAME_MAP = {
    'R20':  'Pila Tipo D (R20)',
    'R14':  'Pila Tipo C (R14)',
    'LR6':  'Pila AA (LR6)',
    'R6P':  'Pila AA (R6P)',
    'LR03': 'Pila AAA (LR03)',
    'R03':  'Pila AAA (R03)',
    'R03P': 'Pila AAA (R03P)',
    '6F22': 'Pila 9V (6F22)',
    'LR1':  'Pila Tipo N (LR1)',
};

// ─── Main loop ────────────────────────────────────────────────────────────────
const jsonOut   = [];
const usedSafes = new Set();
let done = 0;

for (const { modelo, equivalente, descripcion, quimica, voltaje, page, tmp_path } of pages) {
    const titulo = NAME_MAP[modelo] ?? modelo;

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

    console.log(`[${done + 1}/${pages.length}] ${modelo}${equivalente ? ` (${equivalente})` : ''} [${quimica} ${voltaje}] (pg ${page})…`);

    jsonOut.push({
        modelo: titulo,
        nombreImagen: modelo,
        equivalente,
        descripcion,
        quimica,
        voltaje,
        img: `/catalogo-pages/baterias-tianqiu/page-${padded}.jpg`,
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
            // 4% top / 4% bottom → 92% height band, 600×600.
            const cropped = await sharp(tmp_path)
                .flatten({ background: WHITE })
                .extract({
                    left:   0,
                    top:    Math.floor(fullH * 0.04),
                    width:  fullW,
                    height: Math.floor(fullH * 0.92),
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
console.log(`📄 JSON → src/data/baterias-tianqiu.json`);
