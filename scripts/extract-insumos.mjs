/**
 * extract-insumos.mjs — Watchmaking Supplies catalog extractor
 *
 * Uses PyMuPDF get_pixmap() to RENDER each page through the full MuPDF engine
 * (CMYK profiles, masks, vectors, transparencies) → clean sRGB PNG → JPEG q80.
 *
 * This avoids raw stream extraction (doc.extract_image) which yields broken
 * buffers for CMYK images, masks, and multi-layer PDF objects.
 *
 * Usage: node scripts/extract-insumos.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const OUT_IMG  = path.join(ROOT, 'public/images/productos/insumos-relojeria');
const OUT_JSON = path.join(ROOT, 'src/data/insumos-relojeria.json');

const MIN_RECT = 30;   // minimum rect dimension in PDF points to qualify as product image
const DPI      = 200;  // render DPI — gives ~1100px for a typical 400pt image rect
const JPEG_Q   = 80;
const WHITE    = { r: 255, g: 255, b: 255 };

// ─── Scorched earth: delete all old images ────────────────────────────────────
mkdirSync(OUT_IMG, { recursive: true });
const existing = readdirSync(OUT_IMG).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
console.log(`Deleting ${existing.length} old images…`);
for (const f of existing) rmSync(path.join(OUT_IMG, f));
console.log('Clean.\n');

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF = 'public/catalogos/insumos-relojeria.pdf'
DPI = 200
MIN_RECT = 30   # minimum image rect dimension (PDF points) to be considered

SKIP_TEXT = {'TIJAS-ALARGATIJAS-LINGUETES', 'CINTA', 'INSUMOS RELOJERIA', 'INSUMOS\nRELOJERIA'}

MARCAS = ['MOEBIUS', 'ANCHOR', 'MERCURY', 'BONFIX', 'HUBLOT', 'SEIKO', 'MIYOTA', 'ORIENT']

def get_marca(texto):
    tu = texto.upper()
    for m in MARCAS:
        if m in tu:
            return m.capitalize()
    return ''

def get_tipo(texto):
    t = texto.upper()
    if 'TORNILLO' in t:
        return 'TORNILLOS'
    if any(w in t for w in ['PASADOR', 'PINDEL', 'PINGRU', 'PINAC', 'PIN ']):
        return 'PINS'
    if re.search(r'\bPIN\b', t):
        return 'PINS'
    if any(w in t for w in ['EMPAQUE', 'TEFLON', 'BRIDA']):
        return 'EMPAQUES'
    if 'CHAPETA' in t:
        return 'CHAPETAS'
    if any(w in t for w in ['HEBILLA', 'CIERRE']):
        return 'HEBILLAS'
    if any(w in t for w in ['TERMINAL', 'EXTENS', 'CARRITO', 'EXDO', 'EXAC']):
        return 'TERMINALES'
    if any(w in t for w in ['TIJA', 'ALARGA', 'CONVERSOR', 'LINGUETE']):
        return 'TIJAS'
    if any(w in t for w in ['ACEITE', 'PEGANTE', 'SILICONA', 'GRASA', 'ADHESIVO',
                             'SOLUCION', 'LIMPIADOR', 'TINTA', 'LIQUIDO', 'RODICO',
                             'PLASTILINA', 'SOLDAD', 'SOLDAR', 'IMPERMEAB', 'MOEBIUS', 'MERCURY']):
        return 'QUIMICOS'
    if any(w in t for w in ['REPUESTO', 'MECHA', 'PUNTA', 'REMOVEDOR']):
        return 'REPUESTOS'
    if 'CORONA' in t:
        return 'CORONAS'
    return 'OTROS'

def parse_new_format(text):
    nombre_m = re.search(r'Nombre:\s*(.+?)(?:\n|$)', text)
    ref_m    = re.search(r'Referencia:\s*#?\s*(\S+)', text)
    desc_m   = re.search(r'Descripci[oó]n:\s*(.+?)(?:\n|$)', text)
    if not ref_m:
        return None
    modelo = ref_m.group(1).strip()
    nombre = nombre_m.group(1).strip() if nombre_m else ''
    spec   = desc_m.group(1).strip()  if desc_m   else ''
    return {'modelo': modelo, 'nombre': nombre, 'spec': spec}

def parse_standard(lines):
    clean = [l for l in lines if l.strip('., ')]
    if not clean:
        return None
    modelo = clean[0]
    nombre = clean[1] if len(clean) > 1 else ''
    spec   = ' '.join(clean[2:]) if len(clean) > 2 else ''
    return {'modelo': modelo, 'nombre': nombre, 'spec': spec}

def get_product_pixmap(page):
    """
    Find the largest image rect on the page, render ONLY that area via get_pixmap().
    Falls back to rendering the whole page if no qualifying image rect is found.
    Returns base64-encoded PNG bytes (sRGB, no alpha).
    """
    best_rect = None
    best_area = 0.0

    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            rects = page.get_image_rects(xref)
            for rect in rects:
                if rect.width < MIN_RECT or rect.height < MIN_RECT:
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
    if not text or text in SKIP_TEXT:
        continue

    lines = [l.strip() for l in text.split('\n') if l.strip() and l.strip() not in ('.', '..')]
    if not lines:
        continue

    if any(l.startswith('Nombre:') or l.startswith('Referencia:') for l in lines):
        parsed = parse_new_format(text)
    else:
        clean_lines = []
        for l in lines:
            if re.match(r'^(Modelo del producto|Tipo de producto|Cantidad|Uso del producto):', l):
                break
            clean_lines.append(l)
        parsed = parse_standard(clean_lines if clean_lines else lines)

    if not parsed:
        continue

    modelo = parsed['modelo'].strip()
    nombre = parsed['nombre'].strip()
    spec   = parsed['spec'].strip()

    if not nombre and not spec and modelo.replace('-', '').replace('/', '').isupper() and len(modelo) > 25:
        continue

    full_text = modelo + ' ' + nombre + ' ' + spec
    tipo  = get_tipo(full_text)
    marca = get_marca(full_text)

    pixmap_b64 = get_product_pixmap(page)

    result.append({
        'modelo':         modelo,
        'nombre':         nombre,
        'marca':          marca,
        'tipo':           tipo,
        'especificacion': spec,
        'page':           i + 1,
        'pixmap_b64':     pixmap_b64,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_insumos.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF (get_pixmap)…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 600 * 1024 * 1024,   // pixmaps are larger than raw streams
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Main loop ────────────────────────────────────────────────────────────────

const jsonOut = [];
let done = 0;

for (const { modelo, nombre, marca, tipo, especificacion, page, pixmap_b64 } of pages) {
    const safe    = modelo
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\]/g, '_')
        .slice(0, 80);
    const outPath = path.join(OUT_IMG, `${safe}.jpg`);

    console.log(`[${done + 1}/${pages.length}] ${modelo} (pg ${page}) [${tipo}]…`);

    jsonOut.push({
        modelo, nombre, marca, tipo, especificacion,
        img: `/catalogo-pages/insumos-relojeria/page-${String(page).padStart(2, '0')}.jpg`,
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

// Apply known tipo / nombre fixes
const fixes = {
    'SILIMPE-12038':        { tipo: 'QUIMICOS' },
    '421':                  { tipo: 'QUIMICOS' },
    'ZLD-312UV':            { tipo: 'QUIMICOS', nombre: 'PEGAMENTO ZLD-312 UV' },
    'CHACDO3PA 12 AL 24MM': { tipo: 'CHAPETAS' },
    'EXTEPULACE':           { tipo: 'TERMINALES' },
    '637':                  { tipo: 'QUIMICOS' },
};
let patched = 0;
for (const p of jsonOut) {
    const fix = fixes[p.modelo];
    if (fix) { Object.assign(p, fix); patched++; }
}
if (patched) console.log(`\nPatched ${patched} fixes.`);

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products.`);
console.log(`📄 JSON → src/data/insumos-relojeria.json`);
