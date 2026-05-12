/**
 * extract-modulos.mjs — Wall-clock Modules catalog extractor
 *
 * Pipeline per product image:
 *   1. Flatten alpha → white
 *   2. Tight content-bounds crop (thresh=232, pad=20px)
 *   3. Resize to max 800px (fit:inside)
 *   4. .trim({ threshold: 15 }) → JPEG q80
 *
 * Usage: node scripts/extract-modulos.mjs
 */

import sharp from 'sharp';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

sharp.cache(false);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const OUT_IMG  = path.join(ROOT, 'public/images/productos/modulos');
const OUT_JSON = path.join(ROOT, 'src/data/modulos.json');

const CROP_PAD  = 20;
const THRESH    = 232;
const MIN_DIM   = 60;
const OUT_MAX_W = 800;
const JPEG_Q    = 80;
const WHITE     = { r: 255, g: 255, b: 255 };

mkdirSync(OUT_IMG, { recursive: true });

// ─── Python extraction ────────────────────────────────────────────────────────
const PY_CODE = String.raw`
import fitz, json, base64, re, sys

PDF = 'public/catalogos/MODULOS.pdf'

def get_tipo(desc):
    d = desc.upper()
    if 'PENDULO' in d and 'PARA' in d:
        return 'ACCESORIO'
    if 'PENDULO' in d:
        return 'PENDULO'
    if 'MUSICAL' in d:
        return 'MUSICAL'
    if 'FUERZA' in d:
        return 'FUERZA'
    if 'EMPOTRAR' in d:
        return 'EMPOTRABLE'
    if 'PUNTERO' in d:
        return 'ACCESORIO'
    if re.search(r'NUMERO|NUMEROS', d):
        return 'ACCESORIO'
    if 'SISTEMA' in d:
        return 'ACCESORIO'
    if 'TIC-TAC' in d or 'SALTO' in d or 'KIT' in d.upper():
        return 'SALTO'
    return 'ACCESORIO'

def get_bateria(modelo, tipo):
    m = modelo.upper()
    if tipo in ('SALTO', 'PENDULO', 'MUSICAL'):
        return 'AA'
    if 'MOFU' in m:
        return 'C'
    return ''

def get_dimensiones(modelo):
    # Extract shaft size from model name e.g. MO5168SA-12MM -> 12MM
    m = re.search(r'-(\d+(?:\.\d+)?(?:MM|CM))', modelo.upper())
    if m:
        return m.group(1)
    # For empotrable: extract from description later
    return ''

def get_raws(page, doc):
    raws = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            meta = doc.extract_image(xref)
            w, h = meta['width'], meta['height']
            if w >= 60 and h >= 60:
                raws.append({'b64': base64.b64encode(meta['image']).decode(),
                             'w': w, 'h': h, 'ext': meta['ext']})
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
    if not lines:
        continue

    modelo = lines[0].strip()
    desc   = lines[1].strip() if len(lines) > 1 else ''
    extra  = ' '.join(lines[2:]).strip() if len(lines) > 2 else ''

    tipo = get_tipo(desc + ' ' + extra)
    bateria = get_bateria(modelo, tipo)
    dimensiones = get_dimensiones(modelo)

    # For empotrable relojes, pick size from description
    if not dimensiones and 'CENTIMETROS' in extra.upper():
        cm = re.search(r'(\d+(?:\.\d+)?)\s*CENTIMETROS', extra, re.IGNORECASE)
        if cm:
            dimensiones = cm.group(1) + 'CM'
    if not dimensiones and 'CENTIMETROS' in desc.upper():
        cm = re.search(r'(\d+(?:\.\d+)?)\s*CENTIMETROS', desc, re.IGNORECASE)
        if cm:
            dimensiones = cm.group(1) + 'CM'

    raws = get_raws(page, doc)

    result.append({
        'modelo':      modelo,
        'descripcion': desc,
        'tipo':        tipo,
        'bateria':     bateria,
        'dimensiones': dimensiones,
        'page':        i + 1,
        'raws':        raws,
    })

doc.close()
json.dump(result, sys.stdout, ensure_ascii=False)
`;

const tmpPy = path.join(tmpdir(), '_extract_modulos.py');
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
            const idx = (y * width + x) * channels;
            if (data[idx] < THRESH || data[idx + 1] < THRESH || data[idx + 2] < THRESH) {
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

// ─── Main loop ────────────────────────────────────────────────────────────────

const jsonOut = [];
let done = 0;

for (const { modelo, descripcion, tipo, bateria, dimensiones, page, raws } of pages) {
    const safe    = modelo.replace(/\//g, '_').replace(/ /g, '-').replace(/#/g, 'num');
    const outPath = path.join(OUT_IMG, `${safe}.jpg`);

    console.log(`[${done + 1}/${pages.length}] ${modelo} (pg ${page})…`);

    jsonOut.push({
        modelo,
        descripcion,
        tipo,
        bateria,
        dimensiones,
        img: `/catalogo-pages/modulos/page-${String(page).padStart(2, '0')}.jpg`,
    });

    try {
        const usable = raws.filter(({ w, h }) => w >= MIN_DIM && h >= MIN_DIM);
        if (usable.length === 0) {
            console.log(`  → SKIP: no usable images`);
            done++;
            continue;
        }
        // Use largest image
        const largest = usable.sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
        const imgBuf  = await processImage(Buffer.from(largest.b64, 'base64'));

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
        console.log(`  → saved ${meta.width}×${meta.height}  [${tipo}${bateria ? ' / ' + bateria : ''}]`);

    } catch (err) {
        console.error(`  → ERROR on ${modelo}:`, err.message);
    }

    done++;
}

writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');
console.log(`\n✅ Done. ${done}/${pages.length} products processed.`);
console.log(`📄 JSON written to src/data/modulos.json`);
