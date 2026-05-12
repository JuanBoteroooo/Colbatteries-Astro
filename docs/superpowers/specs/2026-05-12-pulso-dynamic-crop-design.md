# Dynamic Row-Crop for Pulso Catalogs

**Date:** 2026-05-12  
**Scope:** 5 pulso extract scripts — resina, silicona, cuero, metalico, pvc

## Problem

Current crop parameters are hardcoded percentages that leave text labels (model code or description) visible in product thumbnails. Each catalog has a different text position (top or bottom), and layout varies slightly per page. Output sizes are inconsistent (500×170, 600×400, 600×600).

## Solution

Add `findContentBounds(tmpPath, options)` to each extract script. Scans row pixel density to locate the text bands at top/bottom edges and returns exact crop boundaries per page.

## Algorithm

```js
async function findContentBounds(tmpPath, { topScanTo = 0.35, bottomScanFrom = 0.65 } = {}) {
    // 1. Render raw pixel data (flatten white bg)
    // 2. Compute per-row density: fraction of non-white pixels (threshold < 242)
    // 3. Smooth over 5-row window (K=2)
    // 4. TOP: scan rows 0 → topScanTo*H
    //      Find white gap (density < 0.01) of ≥5 rows after some content
    //      → topCrop = row after the gap ends (start of product zone)
    //    Fallback: topCrop = 0
    // 5. BOTTOM: scan rows H-1 → bottomScanFrom*H (reversed)
    //      Same gap detection
    //      → bottomCrop = row before the gap starts (end of product zone)
    //    Fallback: bottomCrop = H
    return { topCrop, bottomCrop };
}
```

## Per-Catalog Parameters

| Script | topScanTo | bottomScanFrom | Text position |
|--------|-----------|----------------|---------------|
| extract-pulsos-resina.mjs | 0.30 | 0.65 | TOP code + BOTTOM desc |
| extract-pulsos-silicona.mjs | 0.10 | 0.70 | BOTTOM only |
| extract-pulsos-cuero.mjs | 0.10 | 0.65 | BOTTOM only |
| extract-pulsos-metalicos.mjs | 0.30 | 0.90 | TOP only |
| extract-pulsos-pvc.mjs | 0.30 | 0.90 | TOP only |

## Pipeline Per Page

```js
const { topCrop, bottomCrop } = await findContentBounds(tmp_path, OPTS);
const buf = await sharp(tmp_path)
    .flatten({ background: WHITE })
    .extract({ left: 0, top: topCrop, width: fullW, height: bottomCrop - topCrop })
    .toBuffer();
await sharp(buf)
    .trim({ threshold: 30 })
    .resize(800, 800, { fit: 'contain', background: WHITE })
    .jpeg({ quality: 80 })
    .toFile(outPath);
```

## Output Changes

- All 5 catalogs → **800×800** JPEG q80 (uniform, up from 500×170 / 600×400 / 600×600)
- No changes to JSON structure, frontend, or catalog page images

## Files Changed

- `scripts/extract-pulsos-resina.mjs`
- `scripts/extract-pulsos-silicona.mjs`
- `scripts/extract-pulsos-cuero.mjs`
- `scripts/extract-pulsos-metalicos.mjs`
- `scripts/extract-pulsos-pvc.mjs`
