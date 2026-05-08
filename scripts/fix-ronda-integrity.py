"""
fix-ronda-integrity.py
Re-extract 505_24H, 509-3, 515-24H from the Ronda PDF.

Each page has 2 stacked images (front + back/diagram).
Strategy:
  1. Render each image rect via page.get_pixmap(clip=rect) — PDF renderer
     handles SMask compositing correctly, no manual alpha math.
  2. Crop white borders on each rendered crop.
  3. Scale both to target_h=270, stitch horizontally with 20px white gap.
  4. Overwrite existing PNG.
"""

import fitz
from PIL import Image
import numpy as np
import os

PDF_PATH = "public/catalogos/movimientos-ronda.pdf"
OUT_DIR  = "public/images/productos/movimientos-ronda"

# page 0-index → safe output filename
PAGE_TARGETS = {
    1: "505_24H",
    4: "509-3",
    5: "515-24H",
}

TARGET_H = 270
GAP      = 20


def render_rect(page, rect, scale=2.0):
    """Render page region to RGB ndarray at scale×."""
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, clip=rect, colorspace=fitz.csRGB)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
    return arr


def crop_white(arr, threshold=245, pad=8):
    """Trim white margins. Returns tight crop with `pad` px of breathing room."""
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


def resize_to_height(arr, target_h):
    ih, iw = arr.shape[:2]
    if ih == 0 or iw == 0:
        return arr
    nw = max(1, int(iw * target_h / ih))
    return np.array(Image.fromarray(arr).resize((nw, target_h), Image.LANCZOS))


def stitch(crops, target_h=TARGET_H, gap=GAP):
    """Scale each crop to target_h, join horizontally with white gap."""
    scaled = [resize_to_height(c, target_h) for c in crops]
    white_gap = np.full((target_h, gap, 3), 255, dtype=np.uint8)
    parts = []
    for i, s in enumerate(scaled):
        if i > 0:
            parts.append(white_gap)
        parts.append(s)
    result = np.concatenate(parts, axis=1)
    pad = 16
    out = np.full((target_h + pad * 2, result.shape[1] + pad * 2, 3), 255, dtype=np.uint8)
    out[pad:pad + target_h, pad:pad + result.shape[1]] = result
    return out


doc = fitz.open(PDF_PATH)
print(f"PDF: {len(doc)} pages\n")

for pg_idx, safe_name in PAGE_TARGETS.items():
    page = doc[pg_idx]
    imgs = page.get_images(full=True)
    print(f"── {safe_name} (page {pg_idx + 1}) — {len(imgs)} embedded image(s)")

    if not imgs:
        print("  SKIP: no images on page")
        continue

    # Collect rects for all embedded images, sorted top→bottom
    rects = []
    for img_info in imgs:
        xref = img_info[0]
        img_rects = page.get_image_rects(xref)
        if img_rects:
            rects.append((img_rects[0].y0, img_rects[0], xref))

    rects.sort(key=lambda t: t[0])  # top-to-bottom order

    crops = []
    for y0, rect, xref in rects:
        rendered = render_rect(page, rect, scale=2.0)
        cropped  = crop_white(rendered, threshold=245, pad=8)
        print(f"  img xref={xref}: rect {int(rect.width)}×{int(rect.height)} pts "
              f"→ rendered {rendered.shape[1]}×{rendered.shape[0]} "
              f"→ cropped {cropped.shape[1]}×{cropped.shape[0]}")
        crops.append(cropped)

    if len(crops) == 1:
        # Single view — just scale to target height with padding
        result = resize_to_height(crops[0], TARGET_H)
        pad = 16
        out = np.full((TARGET_H + pad * 2, result.shape[1] + pad * 2, 3), 255, dtype=np.uint8)
        out[pad:pad + TARGET_H, pad:pad + result.shape[1]] = result
        final = out
    else:
        final = stitch(crops)

    out_path = os.path.join(OUT_DIR, f"{safe_name}.png")
    Image.fromarray(final).save(out_path)
    print(f"  → Saved {out_path} ({final.shape[1]}×{final.shape[0]})\n")

doc.close()
print("Done.")
