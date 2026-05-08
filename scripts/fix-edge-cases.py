"""
fix-edge-cases.py
Targeted fixes for missed stitching on 3 specific product images.
- Ronda 5040D-4: clear horizontal gap at col ~262 → stitch left+right
- Ronda 6004_B:  no clear gap (17% density) → skip, single image OK
- ETA 956112-3_6: gap at col ~197 → stitch left+right

BFS threshold reduced from 30 → 5 (pure black only, no metallic grays).
"""

from PIL import Image
import numpy as np
import os

RONDA_DIR = "public/images/productos/movimientos-ronda"
ETA_DIR   = "public/images/productos/movimientos-eta"

# ─── helpers ────────────────────────────────────────────────────────────────

def load(path):
    img = Image.open(path).convert("RGBA")
    white = Image.new("RGBA", img.size, (255, 255, 255, 255))
    white.alpha_composite(img)
    return white.convert("RGB")

def to_arr(img):
    return np.array(img)

def save(arr, path):
    Image.fromarray(arr).save(path)
    print(f"  Saved → {path} ({arr.shape[1]}×{arr.shape[0]})")

def is_dark(r, g, b, thr=220):
    return r < thr or g < thr or b < thr


def find_col_gap(arr, start, window=40):
    """
    Around `start`, find the column with fewest dark pixels.
    Returns (best_col, dark_count).
    """
    h, w = arr.shape[:2]
    lo = max(0, start - window)
    hi = min(w, start + window)
    best_col, best_cnt = start, h
    for c in range(lo, hi):
        col = arr[:, c, :]
        cnt = int(np.sum((col[:, 0] < 220) | (col[:, 1] < 220) | (col[:, 2] < 220)))
        if cnt < best_cnt:
            best_cnt = cnt
            best_col = c
    return best_col, best_cnt


def content_bbox(arr, col_start, col_end):
    """
    Within column range, find tightest row/col crop that contains dark pixels.
    Returns (r0, r1, c0, c1) with 8px padding.
    """
    h, w = arr.shape[:2]
    slab = arr[:, col_start:col_end, :]
    dark = (slab[:, :, 0] < 220) | (slab[:, :, 1] < 220) | (slab[:, :, 2] < 220)
    rows = np.any(dark, axis=1)
    cols = np.any(dark, axis=0)
    if not np.any(rows):
        return 0, h, col_start, col_end
    r0 = max(0, np.argmax(rows) - 8)
    r1 = min(h, len(rows) - np.argmax(rows[::-1]) + 8)
    c0 = max(col_start, col_start + np.argmax(cols) - 8)
    c1 = min(col_end,   col_start + len(cols) - np.argmax(cols[::-1]) + 8)
    return r0, r1, c0, c1


def stitch_lr(arr, split_col, target_h=270, gap=20):
    """
    Split array at split_col, scale both crops to target_h, stitch with gap.
    Returns new RGB ndarray.
    """
    h, w = arr.shape[:2]

    # Crop bounding boxes
    r0L, r1L, c0L, c1L = content_bbox(arr, 0, split_col)
    r0R, r1R, c0R, c1R = content_bbox(arr, split_col, w)

    left  = arr[r0L:r1L, c0L:c1L]
    right = arr[r0R:r1R, c0R:c1R]

    def resize_to_h(crop, th):
        ih, iw = crop.shape[:2]
        if ih == 0 or iw == 0:
            return crop
        scale = th / ih
        nw = max(1, int(iw * scale))
        return np.array(Image.fromarray(crop).resize((nw, th), Image.LANCZOS))

    left  = resize_to_h(left,  target_h)
    right = resize_to_h(right, target_h)

    white_gap = np.full((target_h, gap, 3), 255, dtype=np.uint8)
    result = np.concatenate([left, white_gap, right], axis=1)

    # Pad with white to clean margins
    pad = 16
    padded = np.full((target_h + pad * 2, result.shape[1] + pad * 2, 3), 255, dtype=np.uint8)
    padded[pad:pad+target_h, pad:pad+result.shape[1]] = result
    return padded


def bfs_fix(arr, threshold=5):
    """
    BFS flood-fill pure-black border pixels (all channels < threshold) → white.
    Only touches near-pure-black (threshold=5 means R,G,B < 5).
    """
    h, w = arr.shape[:2]
    visited = np.zeros((h, w), bool)
    out = arr.copy()

    def is_black(r, c):
        px = arr[r, c]
        return int(px[0]) < threshold and int(px[1]) < threshold and int(px[2]) < threshold

    # Seed from all 4 borders
    seeds = []
    for r in range(h):
        if is_black(r, 0):     seeds.append((r, 0))
        if is_black(r, w-1):   seeds.append((r, w-1))
    for c in range(w):
        if is_black(0, c):     seeds.append((0, c))
        if is_black(h-1, c):   seeds.append((h-1, c))

    stack = [(r, c) for r, c in seeds if not visited[r, c]]
    for r, c in stack:
        visited[r, c] = True

    while stack:
        r, c = stack.pop()
        out[r, c] = [255, 255, 255]
        for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
            nr, nc = r+dr, c+dc
            if 0 <= nr < h and 0 <= nc < w and not visited[nr, nc] and is_black(nr, nc):
                visited[nr, nc] = True
                stack.append((nr, nc))

    return out


def has_black_border(arr, threshold=5):
    corners = [arr[0,0], arr[0,-1], arr[-1,0], arr[-1,-1]]
    for px in corners:
        if int(px[0]) < threshold and int(px[1]) < threshold and int(px[2]) < threshold:
            return True
    return False


# ─── Ronda: 5040D-4 ─────────────────────────────────────────────────────────

path_5040 = os.path.join(RONDA_DIR, "5040D-4.png")
print("\n── 5040D-4 (Ronda) ──")
img = load(path_5040)
arr = to_arr(img)
print(f"  Loaded: {arr.shape[1]}×{arr.shape[0]}")

split, cnt = find_col_gap(arr, 262, window=30)
pct = cnt / arr.shape[0] * 100
print(f"  Best gap col={split} ({cnt} dark px, {pct:.1f}%)")

if pct < 5.0:
    print("  → Stitching left+right")
    result = stitch_lr(arr, split, target_h=270)
    save(result, path_5040)
else:
    print(f"  → Gap density {pct:.1f}% too high — skipping stitch")


# ─── Ronda: 6004_B ───────────────────────────────────────────────────────────

path_6004 = os.path.join(RONDA_DIR, "6004_B.png")
print("\n── 6004_B (Ronda) ──")
img = load(path_6004)
arr = to_arr(img)
print(f"  Loaded: {arr.shape[1]}×{arr.shape[0]}")
split, cnt = find_col_gap(arr, 249, window=30)
pct = cnt / arr.shape[0] * 100
print(f"  Best gap col={split} ({cnt} dark px, {pct:.1f}%)")
print("  → Single image, no stitching (gap density too high)")

# Apply BFS only if black border exists
if has_black_border(arr):
    print("  → Black border detected, applying BFS (threshold=5)")
    arr = bfs_fix(arr, threshold=5)
    save(arr, path_6004)
else:
    print("  → BG clean, no changes needed")


# ─── ETA: 956112-3_6 ─────────────────────────────────────────────────────────

path_eta = os.path.join(ETA_DIR, "956112-3_6.png")
print("\n── 956112-3_6 (ETA) ──")
img = load(path_eta)
arr = to_arr(img)
print(f"  Loaded: {arr.shape[1]}×{arr.shape[0]}")

split, cnt = find_col_gap(arr, 197, window=30)
pct = cnt / arr.shape[0] * 100
print(f"  Best gap col={split} ({cnt} dark px, {pct:.1f}%)")

if pct < 12.0:
    print("  → Stitching left+right")
    result = stitch_lr(arr, split, target_h=270)
    save(result, path_eta)
else:
    print(f"  → Gap density {pct:.1f}% too high — single image, skipping")


print("\nDone.")
