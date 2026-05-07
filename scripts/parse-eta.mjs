/**
 * scripts/parse-eta.mjs
 * Phase 1: Extract ETA movement data from PDF → JSON + product images
 *
 * Text: pdf-parse (Node.js)
 * Images: PyMuPDF via Python (embedded image extraction)
 */

import { createRequire }  from 'module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync }       from 'child_process';
import path               from 'path';

const require   = createRequire(import.meta.url);
const pdfParse  = require('pdf-parse');

const PDF_PATH  = 'public/catalogos/movimientos-eta.pdf';
const IMG_DIR   = 'public/images/productos/movimientos-eta';
const IMG_URL   = '/images/productos/movimientos-eta'; // served from public/ root
const JSON_OUT  = 'src/data/movimientos-eta.json';

// ─── Helpers ────────────────────────────────────────────────────────────────

function find(text, pattern, defaultVal = '') {
  const m = text.match(pattern);
  return m ? m[1].trim() : defaultVal;
}

function safeRef(modelo) {
  return modelo.replace(/\//g, '_').replace(/\s+/g, '-');
}

// ─── Text parser ────────────────────────────────────────────────────────────

function cleanDesc(raw) {
  // Fix run-together words that pdf-parse missed (e.g. "cuarzoETA" → "cuarzo ETA")
  return raw
    .replace(/([a-záéíóúü])([A-ZÁÉÍÓÚÜ])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseProduct(block, imgPath) {
  const text = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const lc   = text.toLowerCase();

  // -- modelo --
  const modelo = find(text, /MODELO:\s*([^\s]+(?:\s*[\d]+)?[\w.\-\/]+)/, '').replace(/\s+/g, '');

  // -- full description (everything after modelo line, up to "Movimiento Intercambio") --
  const descRaw = text
    .replace(/^MODELO:\s*\S+\s*/, '')
    .replace(/Movimiento Intercambio[\s\S]*$/, '')
    .trim();
  const desc = cleanDesc(descRaw);

  // -- tipo --
  const isCrono = /cronógrafo|cronografo|split|tiempo dividido/.test(lc);
  const isDama  = /damas?|mujer|ovalado/.test(lc) && !isCrono;
  const tipo    = isCrono ? 'CRONÓGRAFO' : isDama ? 'DAMA' : 'CABALLERO';

  // -- manecillas --
  let manecillas = parseInt(find(text, /(\d+)\s*manecillas? en el centro/, '')) || 0;
  if (!manecillas) {
    const m2 = text.match(/(\d+)\s*manecillas?\s*\(/i);
    manecillas = m2 ? parseInt(m2[1]) : 3;
  }

  // -- fecha --
  const fecha = /fecha|calendario|calendar/.test(lc);

  // -- diametro --
  let diametro = find(text, /diámetro de\s*([\d,]+)\s*mm/, '');
  if (!diametro) diametro = find(text, /([\d,]+)\s*mm de diámetro/, '');
  // Parenthetical format: "(23,30 mm)" after a ligne reference
  if (!diametro) {
    const paren = text.match(/\((\d+[,.]?\d*)\s*mm\)/);
    if (paren) diametro = paren[1];
  }

  // -- rectangular dimensions --
  const rectMatch = text.match(/\((\d+[,.]?\d*)\s*mm\s*[xX×]\s*(\d+[,.]?\d*)\s*mm\)/);
  let dimensiones = '';
  if (rectMatch) {
    dimensiones = `${rectMatch[1]}mm × ${rectMatch[2]}mm`;
  } else if (diametro) {
    dimensiones = `⌀ ${diametro}mm`;
  }

  // -- altura (thickness / grosor) --
  let altura = find(text, /grosor de\s*([\d,]+)\s*mm/, '');
  if (!altura) altura = find(text, /una altura de\s*([\d,]+)\s*mm/, '');
  if (!altura) altura = find(text, /altura de\s*([\d,]+)\s*mm/, '');

  // -- altura nivel (H0/H1/H2/H5) --
  let altura_nivel = find(text, /altura (?:de|del) movimiento\s+(H\d)/, '');
  if (!altura_nivel) altura_nivel = find(text, /movimiento\s+(H\d)\b/, '');

  // -- joyas --
  const joyas = parseInt(find(text, /(\d+)\s*joyas?/, '0')) || 0;

  // -- bateria --
  let bateria = find(text, /bater[ií]a de\s*(\d{3,4})/, '');
  if (!bateria) bateria = find(text, /usa\s+bater[ií]a\s+(\d{3,4})/, '');
  if (!bateria) bateria = find(text, /bater[ií]a\s+(\d{3,4})/, '');

  // -- placas --
  const placas = find(text, /placas? (?:son )?de color\s+(\w+)/, '');

  // -- linea (ligne) --
  let linea = find(text, /línea\s+([\d\s\/¼½¾]+)(?=\s*para|\s*con|\s*línea|\s*,)/i, '').trim();
  if (!linea) linea = find(text, /([\d\s\/]+)\s*ligne/, '').trim();

  // -- intercambios compatibles --
  const intercMatch = text.match(/Movimiento Intercambio\s*([\s\S]+?)(?:$)/i);
  const intercambios = intercMatch
    ? intercMatch[1].trim().replace(/\s+/g, ' ')
    : '';

  // -- forma --
  const forma = /rectangular/.test(lc) ? 'rectangular'
    : /ovalado/.test(lc) ? 'ovalado'
    : 'redondo';

  return {
    modelo,
    tipo,
    forma,
    manecillas,
    fecha,
    dimensiones,
    diametro,
    altura,
    altura_nivel,
    linea,
    joyas,
    bateria,
    placas,
    desc,
    intercambios,
    img: `${IMG_URL}/${safeRef(modelo)}.png`,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log('📄 Reading PDF text with pdf-parse...');
const buf  = readFileSync(PDF_PATH);
const data = await pdfParse(buf);

console.log(`   Pages found: ${data.numpages}`);

// Split into per-product blocks (skip cover page which has no MODELO:)
const rawBlocks = data.text.split(/(?=MODELO:)/).filter(b => b.includes('MODELO:'));
console.log(`   Product blocks: ${rawBlocks.length}`);

// ─── Image extraction (PyMuPDF) ─────────────────────────────────────────────

console.log('\n🖼️  Extracting embedded images via PyMuPDF...');
mkdirSync(IMG_DIR, { recursive: true });

// Build Python script that extracts 1 image per product page and saves as PNG
// Pages 2-19 = products (page index 1-18 in 0-based)
const pythonScript = `
import fitz, os, sys

PDF   = '${PDF_PATH}'
OUTD  = '${IMG_DIR}'

# Map: 0-based page index → model reference (set dynamically below)
doc   = fitz.open(PDF)

# Product pages start at index 1 (page 2). Page 0 = cover.
product_pages = range(1, len(doc))  # pages 1..18

page_models = sys.argv[1:]  # models passed as args

for i, modelo in enumerate(page_models):
    pg_idx  = i + 1          # PDF page 0-index
    if pg_idx >= len(doc):
        break
    page    = doc[pg_idx]
    imgs    = page.get_images(full=True)
    if not imgs:
        print(f'  NO IMAGES on page {pg_idx+1} ({modelo})', flush=True)
        continue
    # Take first image (the product photo)
    xref = imgs[0][0]
    pix  = fitz.Pixmap(doc, xref)
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)
    if pix.colorspace and pix.colorspace.n != 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    safe = modelo.replace('/', '_')
    out  = os.path.join(OUTD, f'{safe}.png')
    pix.save(out)
    print(f'  Saved {out} ({pix.width}x{pix.height})', flush=True)

doc.close()
print('Done.', flush=True)
`;

// Temporary Python file
writeFileSync('/tmp/eta_extract.py', pythonScript);

// Parse models from the blocks first so we can pass them as args
const tempProducts = rawBlocks.map(b => {
  const m = b.match(/MODELO:\s*(\S+)/);
  return m ? m[1].replace(/\s+/g, '') : 'UNKNOWN';
});

console.log('   Models:', tempProducts.join(', '));

try {
  const modelArgs = tempProducts.map(m => `'${m}'`).join(' ');
  execSync(`python3 /tmp/eta_extract.py ${tempProducts.join(' ')}`, { stdio: 'inherit' });
} catch (e) {
  console.error('⚠️  Image extraction error:', e.message);
}

// ─── Parse all products ──────────────────────────────────────────────────────

console.log('\n📊 Parsing product data...');
const products = rawBlocks.map((block, i) => {
  const modelo   = tempProducts[i];
  const imgPath  = `/${IMG_DIR}/${safeRef(modelo)}.png`;
  const product  = parseProduct(block, imgPath);

  console.log(`   [${i + 1}] ETA ${product.modelo} | ${product.tipo} | ${product.dimensiones} | ${product.altura}mm | ${product.joyas}j | bat:${product.bateria} | H:${product.altura_nivel}`);
  return product;
});

// ─── Save JSON ───────────────────────────────────────────────────────────────

writeFileSync(JSON_OUT, JSON.stringify(products, null, 2), 'utf-8');
console.log(`\n✅ JSON saved → ${JSON_OUT} (${products.length} products)`);
console.log(`✅ Images   → ${IMG_DIR}/`);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n─── FIELD COVERAGE ───────────────────────────────');
const fields = ['modelo', 'tipo', 'dimensiones', 'altura', 'bateria', 'joyas', 'placas', 'intercambios'];
for (const f of fields) {
  const filled = products.filter(p => p[f] && p[f] !== '0').length;
  console.log(`  ${f.padEnd(14)}: ${filled}/${products.length}`);
}
