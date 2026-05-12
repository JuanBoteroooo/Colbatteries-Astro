/**
 * extract-joyeria.mjs — Jewelry & Tools catalog extractor
 *
 * Uses PyMuPDF get_pixmap() for bulletproof rendering (CMYK, masks, alpha).
 * DPI 150 → sharp contain 800×800 → JPEG q80.
 *
 * Usage: node scripts/extract-joyeria.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const OUT_IMG  = path.join(ROOT, 'public/images/productos/joyeria-herramientas');
const OUT_JSON = path.join(ROOT, 'src/data/joyeria-herramientas.json');

const DPI    = 150;
const JPEG_Q = 80;
const WHITE  = { r: 255, g: 255, b: 255 };

// ─── Scorched earth ───────────────────────────────────────────────────────────
mkdirSync(OUT_IMG, { recursive: true });
const existing = readdirSync(OUT_IMG).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
console.log(`Deleting ${existing.length} old images…`);
for (const f of existing) rmSync(path.join(OUT_IMG, f));
console.log('Clean.\n');

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF    = 'public/catalogos/joyeria-herramientas.pdf'
DPI    = 150
MIN_PT = 30

def get_tipo(texto):
    t = texto.upper()
    if any(w in t for w in ['PULIDORA', 'LAMINADOR', 'SOLDADURA', 'SOLDADOR', 'HORNO',
                             'AMOLADORA', 'ESMERIL', 'ULTRASONIDO', 'COMPRESOR', 'GRABADO',
                             'MAQUINA', 'MÁQUINA', 'VIBRADOR', 'CALIBRADOR', 'EXTRUSOR',
                             'CORTADOR', 'AFILADOR', 'RECTIFICADOR']):
        return 'MAQUINA'
    if any(w in t for w in ['LUPA', 'MICROSCOPIO', 'BINOCULO']):
        return 'LUPA'
    if 'LIMA' in t:
        return 'LIMA'
    if 'SIERRA' in t:
        return 'SIERRA'
    if 'CEPILLO' in t:
        return 'CEPILLO'
    if any(w in t for w in ['DISCO', 'RUEDA', 'MUELA', 'ABRASIVO', 'LIJA']):
        return 'ABRASIVO'
    if any(w in t for w in ['MANDRIL', 'FRESA', 'BROCA', 'BUR']):
        return 'MANDRIL'
    if any(w in t for w in ['PINZA', 'ALICATE', 'TENAZA', 'BRUCELA']):
        return 'PINZA'
    if any(w in t for w in ['CRISOL', 'MOLDE', 'BASE', 'SOPORTE', 'ESTANTE']):
        return 'BASE'
    if any(w in t for w in ['PASTA', 'SOLUCION', 'SOLUCIÓN', 'CERA', 'POLVO', 'LIMPIADOR',
                             'GAMUZA', 'PAÑO', 'ALMOHADILLA', 'LUBRICANTE', 'POMEZ',
                             'GRANULO', 'COMPUESTO', 'ACEITE', 'PIEDRA']):
        return 'QUIMICO'
    return 'HERRAMIENTA'

def parse_new_format(text):
    nombre_m = re.search(r'Nombre:\s*(.+?)(?:\n|$)', text)
    # Handle "Referencia de marca :", "Referencia de embalaje :", etc.
    ref_m    = re.search(r'Referencia(?:\s+\w+)*\s*:\s*#?\s*(\S+)', text)
    desc_m   = re.search(r'Descripci[oó]n:\s*(.+?)(?:\n|$)', text)
    if not ref_m:
        return None
    modelo = ref_m.group(1).strip().rstrip('.')
    nombre = nombre_m.group(1).strip() if nombre_m else ''
    spec   = desc_m.group(1).strip()  if desc_m   else ''
    return {'modelo': modelo, 'descripcion': nombre, 'spec': spec}

def parse_standard(lines):
    clean = [l for l in lines if l.strip('., ')]
    if not clean:
        return None
    modelo = clean[0]
    desc   = ' '.join(clean[1:]) if len(clean) > 1 else ''
    return {'modelo': modelo, 'descripcion': desc, 'spec': ''}

def get_product_pixmap(page):
    best_rect = None
    best_area = 0.0
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            for rect in page.get_image_rects(xref):
                if rect.width < MIN_PT or rect.height < MIN_PT:
                    continue
                area = rect.width * rect.height
                if area > best_area:
                    best_area = area
                    best_rect = rect
        except Exception:
            pass
    clip = best_rect if best_rect is not None else page.rect
    pix  = page.get_pixmap(clip=clip, dpi=DPI, alpha=False)
    return base64.b64encode(pix.tobytes("png")).decode()

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip() and l.strip() not in ('.', '..')]
    if not lines:
        continue

    if any(l.startswith('Nombre:') or re.match(r'Referencia', l) for l in lines):
        parsed = parse_new_format(text)
    else:
        parsed = parse_standard(lines)

    if not parsed:
        continue

    modelo      = parsed['modelo'].strip()
    descripcion = parsed['descripcion'].strip()
    spec        = parsed['spec'].strip()

    full_text = modelo + ' ' + descripcion + ' ' + spec
    tipo      = get_tipo(full_text)

    pixmap_b64 = get_product_pixmap(page)

    result.append({
        'modelo':      modelo,
        'descripcion': descripcion,
        'tipo':        tipo,
        'page':        i + 1,
        'pixmap_b64':  pixmap_b64,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_joyeria.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF (get_pixmap)…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 800 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Main loop ────────────────────────────────────────────────────────────────

const jsonOut   = [];
const usedSafes = new Set();   // track for duplicate filenames
let done = 0;

for (const { modelo, descripcion, tipo, page, pixmap_b64 } of pages) {
    let safe = modelo
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\]/g, '_')
        .slice(0, 75);

    // Deduplicate — append page number if safe name already used
    if (usedSafes.has(safe)) safe = `${safe}-pg${page}`;
    usedSafes.add(safe);

    const outPath = path.join(OUT_IMG, `${safe}.jpg`);
    const padded  = String(page).padStart(2, '0');

    console.log(`[${done + 1}/${pages.length}] ${modelo} (pg ${page}) [${tipo}]…`);

    jsonOut.push({
        modelo,
        descripcion,
        tipo,
        img: `/catalogo-pages/joyeria-herramientas/page-${padded}.jpg`,
    });

    try {
        const rawBuf = Buffer.from(pixmap_b64, 'base64');

        await sharp(rawBuf)
            .resize(800, 800, { fit: 'contain', background: WHITE })
            .flatten({ background: WHITE })
            .jpeg({ quality: JPEG_Q })
            .toFile(outPath);

        const meta = await sharp(outPath).metadata();
        console.log(`  → ${meta.width}×${meta.height}`);
    } catch (err) {
        console.error(`  → ERROR:`, err.message);
    }

    done++;
}

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products.`);
console.log(`📄 JSON → src/data/joyeria-herramientas.json`);
