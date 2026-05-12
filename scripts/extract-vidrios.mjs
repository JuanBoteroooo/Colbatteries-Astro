/**
 * extract-vidrios.mjs — Vidrios (Watch Crystals) catalog extractor
 *
 * Pipeline per product image:
 *   1. Flatten alpha → white
 *   2. Tight content-bounds crop (thresh=232, pad=20px)
 *   3. Resize to max 800px wide (fit:inside)
 *   4. .trim({ threshold: 15 }) → JPEG q80
 *
 * Usage: node scripts/extract-vidrios.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__dirname, '..');
const OUT_IMG  = path.join(ROOT, 'public/images/productos/vidrios');
const OUT_JSON = path.join(ROOT, 'src/data/vidrios.json');

const CROP_PAD = 20;
const THRESH   = 232;
const MIN_DIM  = 60;
const OUT_MAX_W = 800;
const JPEG_Q   = 80;
const WHITE    = { r: 255, g: 255, b: 255 };

mkdirSync(OUT_IMG, { recursive: true });

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF = 'public/catalogos/vidrios.pdf'

FORMA_MAP = [
    ('VILUFE', 'LUPA'),
    ('VILU',   'LUPA'),
    ('VIP',    'PLANO'),
    ('VICO',   'CONCAVO'),
    ('MICA',   'ACRILICO'),
    ('VILA',   'LAMINA'),
    ('VIZA',   'ZAFIRADO'),
    ('VIES',   'ESPECIAL'),
    ('CH-',    'PEGANTE'),
    ('ZLD-',   'PEGANTE'),
]

def get_forma(modelo):
    mu = modelo.upper()
    for prefix, forma in FORMA_MAP:
        if mu.startswith(prefix):
            return forma
    return 'OTRO'

def extract_grosor(text):
    m = re.search(r'(\d+(?:\.\d+)?)\s*MM', text, re.IGNORECASE)
    return (m.group(1) + 'MM') if m else ''

def parse_standard(lines):
    modelo = lines[0].strip()
    nombre_raw = lines[1].strip() if len(lines) > 1 else ''
    medida = lines[2].strip() if len(lines) > 2 else ''
    # grosor is the thickness digit in the name line (before MM)
    grosor = extract_grosor(nombre_raw)
    # strip grosor from nombre end
    nombre = re.sub(r'\s+\d+(?:\.\d+)?\s*MM\s*$', '', nombre_raw, flags=re.IGNORECASE).strip()
    return [{'modelo': modelo, 'nombre': nombre, 'grosor': grosor, 'medida': medida, 'forma': get_forma(modelo)}]

def parse_new_format(text):
    results = []
    # split on Nombre: boundaries
    parts = re.split(r'(?=Nombre:)', text)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        nombre_m = re.search(r'Nombre:\s*(.+)', part)
        ref_m    = re.search(r'Referencia:\s*#?\s*(\S+)', part)
        desc_m   = re.search(r'Descripci\xf3n:\s*(.+)', part)
        if not ref_m:
            continue
        ref = ref_m.group(1).strip()
        nombre = nombre_m.group(1).strip() if nombre_m else ''
        desc   = desc_m.group(1).strip()   if desc_m   else ''
        # medida from desc like "Tamaño: 30 mm a 40 mm"
        tam = re.search(r'Tama\xf1o:\s*(.+)', desc)
        medida = tam.group(1).strip() if tam else ''
        grosor = extract_grosor(nombre)
        nombre_clean = re.sub(r'#.*', '', nombre).strip()
        results.append({'modelo': ref, 'nombre': nombre_clean, 'grosor': grosor, 'medida': medida, 'forma': 'DOMO'})
    return results

def get_raws(page, doc):
    raws = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            meta = doc.extract_image(xref)
            w, h = meta['width'], meta['height']
            if w >= 40 and h >= 40:
                raws.append({'b64': base64.b64encode(meta['image']).decode(), 'w': w, 'h': h, 'ext': meta['ext']})
        except Exception:
            pass
    return raws

doc    = fitz.open(PDF)
result = []

for i in range(1, len(doc)):
    page = doc[i]
    text = page.get_text().strip()
    if not text:
        continue
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    raws  = get_raws(page, doc)
    if any(l.startswith('Nombre:') or l.startswith('Referencia:') for l in lines):
        products = parse_new_format(text)
    else:
        products = parse_standard(lines)
    for j, p in enumerate(products):
        p['page'] = i + 1
        # all products on same page share same image(s)
        p['raws'] = raws
        result.append(p)

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_vidrios.py');
writeFileSync(tmpPy, PY_CODE, 'utf8');

console.log('Extracting via PyMuPDF…');
const jsonStr = execFileSync('python3', [tmpPy], {
    cwd: ROOT,
    maxBuffer: 200 * 1024 * 1024,
}).toString();
const pages = JSON.parse(jsonStr);
console.log(`Got ${pages.length} products\n`);

// ─── Sharp helpers ────────────────────────────────────────────────────────────

async function contentBounds(buf) {
    const { data, info } = await sharp(buf)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let top = height, bot = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            if (data[i] < THRESH || data[i + 1] < THRESH || data[i + 2] < THRESH) {
                if (y < top)   top   = y;
                if (y > bot)   bot   = y;
                if (x < left)  left  = x;
                if (x > right) right = x;
            }
        }
    }
    return { top, bot, left, right, width, height };
}

async function processImage(rawBuf) {
    const b = await contentBounds(rawBuf);
    if (b.bot < 0) return null;
    const left  = Math.max(0, b.left  - CROP_PAD);
    const top   = Math.max(0, b.top   - CROP_PAD);
    const right = Math.min(b.width,  b.right  + CROP_PAD + 1);
    const bot   = Math.min(b.height, b.bot    + CROP_PAD + 1);
    return sharp(rawBuf)
        .flatten({ background: WHITE })
        .extract({ left, top, width: right - left, height: bot - top })
        .resize({ width: OUT_MAX_W, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: WHITE })
        .png()
        .toBuffer();
}

// ─── Build JSON (no raws) ────────────────────────────────────────────────────

const jsonOut = pages.map(({ modelo, nombre, grosor, medida, forma, page }) => ({
    modelo,
    nombre,
    forma,
    grosor,
    medida,
    img: `/catalogo-pages/vidrios/page-${String(page).padStart(2, '0')}.jpg`,
}));

// ─── Main loop ────────────────────────────────────────────────────────────────

let done = 0;
// Track already-written product images per page to avoid reprocessing
const pageCache = new Map();

for (const { modelo, raws, page } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-').replace(/#/g, 'num');
    const outPath = path.join(OUT_IMG, `${safe}.jpg`);

    console.log(`[${done + 1}/${pages.length}] ${modelo} (pg ${page})…`);

    try {
        let imgBuf;
        if (pageCache.has(page)) {
            imgBuf = pageCache.get(page);
        } else {
            const usable = raws.filter(({ w, h }) => w >= MIN_DIM && h >= MIN_DIM);
            if (usable.length === 0) {
                console.log(`  → SKIP: no usable images`);
                done++;
                continue;
            }
            // Use largest image
            const largest = usable.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
            imgBuf = await processImage(Buffer.from(largest.b64, 'base64'));
            pageCache.set(page, imgBuf);
        }

        if (!imgBuf) {
            console.log(`  → SKIP: blank after processing`);
            done++;
            continue;
        }

        await sharp(imgBuf)
            .trim({ threshold: 15 })
            .jpeg({ quality: JPEG_Q, mozjpeg: true })
            .toFile(outPath);

        const meta = await sharp(outPath).metadata();
        console.log(`  → saved ${meta.width}×${meta.height}`);

    } catch (err) {
        console.error(`  → ERROR on ${modelo}:`, err.message);
    }

    done++;
}

// Write JSON
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products processed.`);
console.log(`📄 JSON written to src/data/vidrios.json`);
