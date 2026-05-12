/**
 * extract-herramientas.mjs — Watchmaking Tools catalog extractor
 *
 * Uses PyMuPDF get_pixmap() to render each page through the full MuPDF engine
 * (handles CMYK, masks, vectors, alpha) → sRGB PNG → sharp contain → JPEG q80.
 *
 * Usage: node scripts/extract-herramientas.mjs
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
const OUT_IMG  = path.join(ROOT, 'public/images/productos/herramientas');
const OUT_JSON = path.join(ROOT, 'src/data/herramientas.json');

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

PDF     = 'public/catalogos/herramientas.pdf'
DPI     = 150
MIN_PT  = 30   # minimum rect dimension (points) to qualify as product image

def get_tipo(texto):
    t = texto.upper()
    if any(w in t for w in ['ULTRASONIDO', 'PULIDORA', 'BORDEADORA', 'LIMPIADORA',
                             'CALIBRADOR', 'SOLDADOR', 'CORTADORA', 'PRENSA', 'TALADRO',
                             'MAQUINA', 'MÁQUINA', 'RECTIFICADORA']):
        return 'MAQUINA'
    if any(w in t for w in ['MICROSCOPIO', 'TESTER', 'EXACTITUD', 'MEDIDOR']):
        return 'PRECISION'
    if 'TAPADORA' in t:
        return 'TAPADORA'
    if any(w in t for w in ['DESTAPADORA', 'ABRIDOR', 'DESTAPADOR']):
        return 'DESTAPADORA'
    if 'DESTORNILLADOR' in t:
        return 'DESTORNILLADOR'
    if 'PINZA' in t:
        return 'PINZA'
    if 'LUPA' in t or 'BINOCULO' in t:
        return 'LUPA'
    if 'LLAVE' in t:
        return 'LLAVE'
    if any(w in t for w in ['BASE', 'SOPORTE', 'MANDRIL', 'COJINETE']):
        return 'BASE'
    return 'HERRAMIENTA'

def parse_new_format(text):
    nombre_m = re.search(r'Nombre:\s*(.+?)(?:\n|$)', text)
    ref_m    = re.search(r'Referencia:\s*#?\s*(\S+)', text)
    desc_m   = re.search(r'Descripci[oó]n:\s*(.+?)(?:\n|$)', text)
    if not ref_m:
        return None
    modelo = ref_m.group(1).strip()
    nombre = nombre_m.group(1).strip() if nombre_m else ''
    spec   = desc_m.group(1).strip()  if desc_m   else ''
    return {'modelo': modelo, 'descripcion': nombre, 'spec': spec}

def parse_standard(lines):
    clean = [l for l in lines if l.strip('., ')]
    if not clean:
        return None
    modelo    = clean[0]
    desc_rest = ' '.join(clean[1:]) if len(clean) > 1 else ''
    return {'modelo': modelo, 'descripcion': desc_rest, 'spec': ''}

def get_product_pixmap(page):
    """Render largest image rect via get_pixmap. Falls back to full page."""
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

    if any(l.startswith('Nombre:') or l.startswith('Referencia:') for l in lines):
        parsed = parse_new_format(text)
    else:
        parsed = parse_standard(lines)

    if not parsed:
        continue

    modelo     = parsed['modelo'].strip()
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

const tmpPy = path.join(tmpdir(), '_extract_herramientas.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF (get_pixmap)…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 800 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Main loop ────────────────────────────────────────────────────────────────

const jsonOut = [];
let done = 0;

for (const { modelo, descripcion, tipo, page, pixmap_b64 } of pages) {
    const safe    = modelo
        .replace(/\//g, '_')
        .replace(/ /g, '-')
        .replace(/#/g, 'num')
        .replace(/[<>:"|?*\\]/g, '_')
        .slice(0, 80);
    const outPath = path.join(OUT_IMG, `${safe}.jpg`);

    console.log(`[${done + 1}/${pages.length}] ${modelo} (pg ${page}) [${tipo}]…`);

    jsonOut.push({
        modelo,
        descripcion,
        tipo,
        img: `/catalogo-pages/herramientas/page-${String(page).padStart(2, '0')}.jpg`,
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
console.log(`📄 JSON → src/data/herramientas.json`);
