"""
extract-epson-sii.py
Extract EPSON and SII movement data from the combined 55-page PDF.

Brand detection: products containing "SII" in text → SII; else → EPSON.
  SII series: VR, PC, VC, VD, VJ, VK prefixes — text explicitly says "XXX SII"
  EPSON series: VX, VH, Y, YM — text says "Epson XXX" (lowercase)

Outputs:
  src/data/movimientos-epson.json
  src/data/movimientos-sii.json
  public/images/productos/movimientos-epson/<safe>.png
  public/images/productos/movimientos-sii/<safe>.png
  public/catalogo-pages/movimientos-epson/page-XX.jpg  (sequential)
  public/catalogo-pages/movimientos-sii/page-XX.jpg    (sequential)
"""

import fitz
import re
import json
import os
from PIL import Image
import numpy as np

# ─── Config ─────────────────────────────────────────────────────────────────

PDF_PATH   = "public/catalogos/movimientos-epson.pdf"
EPSON_IMG  = "public/images/productos/movimientos-epson"
SII_IMG    = "public/images/productos/movimientos-sii"
EPSON_CATS = "public/catalogo-pages/movimientos-epson"
SII_CATS   = "public/catalogo-pages/movimientos-sii"
EPSON_JSON = "src/data/movimientos-epson.json"
SII_JSON   = "src/data/movimientos-sii.json"

TARGET_H   = 270
GAP        = 20

for d in [EPSON_IMG, SII_IMG, EPSON_CATS, SII_CATS]:
    os.makedirs(d, exist_ok=True)

# ─── Image helpers ───────────────────────────────────────────────────────────

def safe(modelo):
    return modelo.replace('/', '_').replace(' ', '_')

def render_rect(page, rect, scale=2.5):
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=rect, colorspace=fitz.csRGB)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()

def render_full_page(page, scale=1.5):
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()

def crop_white(arr, threshold=245, pad=8):
    dark = (arr[:, :, 0] < threshold) | (arr[:, :, 1] < threshold) | (arr[:, :, 2] < threshold)
    rows = np.any(dark, axis=1)
    cols = np.any(dark, axis=0)
    if not np.any(rows):
        return arr
    r0 = max(0, int(np.argmax(rows)) - pad)
    r1 = min(arr.shape[0], arr.shape[0] - int(np.argmax(rows[::-1])) + pad)
    c0 = max(0, int(np.argmax(cols)) - pad)
    c1 = min(arr.shape[1], arr.shape[1] - int(np.argmax(cols[::-1])) + pad)
    return arr[r0:r1, c0:c1]

def resize_to_height(arr, h):
    ih, iw = arr.shape[:2]
    if ih == 0 or iw == 0:
        return arr
    nw = max(1, int(iw * h / ih))
    return np.array(Image.fromarray(arr).resize((nw, h), Image.LANCZOS))

def stitch(crops):
    scaled = [resize_to_height(c, TARGET_H) for c in crops]
    white_gap = np.full((TARGET_H, GAP, 3), 255, dtype=np.uint8)
    parts = []
    for i, s in enumerate(scaled):
        if i > 0:
            parts.append(white_gap)
        parts.append(s)
    result = np.concatenate(parts, axis=1)
    pad = 16
    out = np.full((TARGET_H + pad * 2, result.shape[1] + pad * 2, 3), 255, dtype=np.uint8)
    out[pad:pad + TARGET_H, pad:pad + result.shape[1]] = result
    return out

def extract_product_png(page, img_dir, safe_name):
    imgs = page.get_images(full=True)
    if not imgs:
        return None
    rects_data = []
    for img_info in imgs:
        xref = img_info[0]
        img_rects = page.get_image_rects(xref)
        if img_rects:
            rects_data.append((img_rects[0].y0, img_rects[0], xref))
    if not rects_data:
        return None
    rects_data.sort(key=lambda t: t[0])
    crops = []
    for _, rect, _ in rects_data:
        rendered = render_rect(page, rect, scale=2.5)
        cropped  = crop_white(rendered)
        if cropped.shape[0] > 10 and cropped.shape[1] > 10:
            crops.append(cropped)
    if not crops:
        return None
    if len(crops) == 1:
        final = resize_to_height(crops[0], TARGET_H)
        pad = 16
        out = np.full((TARGET_H + pad * 2, final.shape[1] + pad * 2, 3), 255, dtype=np.uint8)
        out[pad:pad + TARGET_H, pad:pad + final.shape[1]] = final
        final = out
    else:
        print(f"    → {len(crops)} views → stitching")
        final = stitch(crops)
    out_path = os.path.join(img_dir, f"{safe_name}.png")
    Image.fromarray(final).save(out_path)
    return out_path

# ─── Text parser ─────────────────────────────────────────────────────────────

def parse_page(text, modelo):
    lc = text.lower()

    # brand — SII models always contain "SII" literally; EPSON models use "Epson" (lowercase)
    brand = 'SII' if 'SII' in text else 'EPSON'

    # tipo
    is_crono = bool(re.search(r'cron[oó]grafo|chrono', lc))
    is_dama  = bool(re.search(r'para damas?|movimiento de damas?|ladies?', lc)) and not is_crono
    tipo     = 'CRONÓGRAFO' if is_crono else ('DAMA' if is_dama else 'CABALLERO')

    # fecha
    fecha = bool(re.search(r'\bfecha\b|calendar|date', lc))

    # dimensiones — rectangular first, then round
    rect_m = re.search(
        r'dimensiones son\s*([\d,]+)\s*mm\s*[xX×]\s*([\d,]+)\s*mm|'
        r'dimensiones de\s*([\d,]+)\s*mm\s*[xX×]\s*([\d,]+)\s*mm|'
        r'unas dimensiones de\s*([\d,]+)\s*mm\s*[xX×]\s*([\d,]+)\s*mm|'
        r'([\d,]+)\s*mm\s*[xX×]\s*([\d,]+)\s*mm',
        text, re.I
    )
    dimensiones = ''
    if rect_m:
        groups = [g for g in rect_m.groups() if g is not None]
        a, b = groups[0], groups[1]
        dimensiones = f"{a.replace(',', '.')}mm × {b.replace(',', '.')}mm"
    else:
        # Round: "XX,XX mm (diámetro)" or "diámetro XX,XX mm" or "(XX,XX mm)" after "líneas"
        diam_m = re.search(r'([\d,]+)\s*mm\s*\(di[aá]metro\)', text, re.I)
        if not diam_m:
            diam_m = re.search(r'di[aá]metro\s+([\d,]+)\s*mm', text, re.I)
        if not diam_m:
            diam_m = re.search(r'l[ií]neas\s*\((\d+[,.]?\d*)\s*mm\)', text, re.I)
        if diam_m:
            dimensiones = f"⌀ {diam_m.group(1).replace(',', '.')}mm"

    # altura — multiple patterns in order of specificity
    alt_m = re.search(r'grosor(?:\s+es)?\s+de\s*([\d,]+)\s*mm', text, re.I)
    if not alt_m:
        alt_m = re.search(r'su grosor es\s+([\d,]+)\s*mm', text, re.I)
    if not alt_m:
        alt_m = re.search(r'altura total\s*[\w\s]*?([\d,]+)\s*mm', text, re.I)
    if not alt_m:
        alt_m = re.search(r'con una altura de\s*([\d,]+)\s*mm', text, re.I)
    if not alt_m:
        alt_m = re.search(r'altura de movimiento de\s*([\d,]+)\s*mm', text, re.I)
    if not alt_m:
        alt_m = re.search(r'altura de\s+([\d,]+)\s*mm', text, re.I)
    altura = alt_m.group(1).replace(',', '.') if alt_m else ''

    # joyas — handles "joya", "joyas", "rubíes", "rubí"
    joyas_m = re.search(r'(\d+)\s+(?:joyas?|rub[ií]es?)', text, re.I)
    joyas = int(joyas_m.group(1)) if joyas_m else 0

    # bateria — cascading patterns: "batería 371", "celda 371", "celular 371", "pila 364", "SR521SW"
    bat_m = re.search(r'bater[ií]a\s+(\d{3,4})', text, re.I)
    if not bat_m:
        bat_m = re.search(r'\b(?:celda|celular?|pila)\s+(\d{3,4})', text, re.I)
    if not bat_m:
        # SR code → map to numeric
        sr_m = re.search(r'\bSR(\d{3,4}[A-Z]*)\b', text, re.I)
        bateria = f"SR{sr_m.group(1)}" if sr_m else ''
    else:
        bateria = bat_m.group(1)

    # intercambios
    intc_m = re.search(
        r'(?:Movimiento Intercambio|Intercambio de movimiento)\s*([\s\S]+?)$',
        text, re.I
    )
    intercambios = intc_m.group(1).strip().replace('\n', ' ').replace('  ', ' ') if intc_m else ''

    return {
        "modelo":       modelo,
        "brand":        brand,
        "tipo":         tipo,
        "fecha":        fecha,
        "dimensiones":  dimensiones,
        "altura":       altura,
        "joyas":        joyas,
        "bateria":      bateria,
        "intercambios": intercambios,
    }

# ─── Scan all pages ───────────────────────────────────────────────────────────

doc = fitz.open(PDF_PATH)
print(f"PDF: {len(doc)} pages\n")

epson_pages = []
sii_pages   = []

for i in range(len(doc)):
    page = doc[i]
    text = page.get_text()
    if 'MODELO:' not in text:
        continue
    m = re.search(r'MODELO:\s*(\S+)', text)
    if not m:
        continue
    modelo = m.group(1).strip()
    brand  = 'SII' if 'SII' in text else 'EPSON'
    if brand == 'EPSON':
        epson_pages.append((i, modelo, text))
    else:
        sii_pages.append((i, modelo, text))

print(f"EPSON products: {len(epson_pages)}")
print(f"SII   products: {len(sii_pages)}")
print(f"EPSON: {[m for _, m, _ in epson_pages]}")
print(f"SII:   {[m for _, m, _ in sii_pages]}")

# ─── Process each brand ───────────────────────────────────────────────────────

BRANDS = [
    ("EPSON", epson_pages, EPSON_IMG, EPSON_CATS, EPSON_JSON, "movimientos-epson"),
    ("SII",   sii_pages,   SII_IMG,   SII_CATS,   SII_JSON,   "movimientos-sii"),
]

for brand_name, pages_list, img_dir, cat_dir, json_path, slug in BRANDS:
    print(f"\n{'='*60}")
    print(f"Processing {brand_name} — {len(pages_list)} products")
    print(f"{'='*60}")

    products = []

    for seq_idx, (pg_idx, modelo, text) in enumerate(pages_list):
        print(f"\n  [{seq_idx+1:2d}/{len(pages_list)}] {modelo} (PDF pg {pg_idx+1})")
        page = doc[pg_idx]

        data = parse_page(text, modelo)
        safe_name = safe(modelo)
        data["img"] = f"/images/productos/{slug}/{safe_name}.png"
        products.append(data)

        print(f"    {data['brand']} | {data['tipo']} | fecha={data['fecha']} | "
              f"dim={data['dimensiones']} | alt={data['altura']}mm | "
              f"bat={data['bateria']} | joyas={data['joyas']}")

        # Product PNG
        out_png = extract_product_png(page, img_dir, safe_name)
        if out_png:
            img_check = Image.open(out_png)
            print(f"    PNG: {img_check.width}×{img_check.height} → {out_png}")
        else:
            print(f"    PNG: FAILED")

        # Catalog page JPG (sequential numbering: seq_idx+2)
        cat_num  = seq_idx + 2
        cat_path = os.path.join(cat_dir, f"page-{str(cat_num).zfill(2)}.jpg")
        Image.fromarray(render_full_page(page)).save(cat_path, "JPEG", quality=85)

    # Cover page
    Image.fromarray(render_full_page(doc[0])).save(
        os.path.join(cat_dir, "page-01.jpg"), "JPEG", quality=85
    )
    print(f"\n  page-01.jpg (cover) saved")

    # JSON
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
    print(f"  JSON → {json_path} ({len(products)} products)")

doc.close()

# ─── Summary ─────────────────────────────────────────────────────────────────

print("\n\n─── FIELD COVERAGE ───────────────────────────────────────────────")
for json_path, label in [(EPSON_JSON, 'EPSON'), (SII_JSON, 'SII')]:
    with open(json_path) as f:
        prods = json.load(f)
    print(f"\n{label} ({len(prods)} products):")
    for field in ['dimensiones', 'altura', 'bateria']:
        filled = sum(1 for p in prods if p.get(field))
        print(f"  {field:14s}: {filled}/{len(prods)}")

print("\n✅ Done.")
