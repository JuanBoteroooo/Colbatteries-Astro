# Pulso Dynamic Row-Crop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded crop fractions in all 5 pulso extract scripts with per-page row-density detection, outputting 800×800 thumbnails.

**Architecture:** Add `findContentBounds(tmpPath, opts)` inline to each script. Scans row pixel densities, finds white gaps between text labels and product zone, returns exact topCrop/bottomCrop rows. Replace entire exception/normal pipeline with single dynamic pipeline.

**Tech Stack:** Node.js, sharp, PyMuPDF (already in use)

---

### Shared function (inline in each script)

```js
async function findContentBounds(tmpPath, { topScanTo = 0.35, bottomScanFrom = 0.65 } = {}) {
    const { data, info } = await sharp(tmpPath)
        .flatten({ background: WHITE })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const W = info.width, H = info.height, C = info.channels;

    const rowDensity = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * C;
            if (data[idx] < 242 || data[idx + 1] < 242 || data[idx + 2] < 242) n++;
        }
        rowDensity[y] = n / W;
    }

    const K = 2;
    const smooth = new Float32Array(H);
    for (let y = K; y < H - K; y++) {
        let s = 0;
        for (let k = -K; k <= K; k++) s += rowDensity[y + k];
        smooth[y] = s / (2 * K + 1);
    }

    const GAP_THRESH = 0.01;
    const MIN_GAP    = 5;

    let topCrop = 0;
    {
        let inGap = false, gapStart = -1, seenContent = false;
        for (let y = 0; y < Math.floor(H * topScanTo); y++) {
            if (smooth[y] >= GAP_THRESH) {
                seenContent = true;
                if (inGap && y - gapStart >= MIN_GAP) topCrop = y;
                inGap = false;
            } else {
                if (seenContent && !inGap) { inGap = true; gapStart = y; }
            }
        }
    }

    let bottomCrop = H;
    {
        let inGap = false, gapStart = -1, seenContent = false;
        for (let y = H - 1; y >= Math.floor(H * bottomScanFrom); y--) {
            if (smooth[y] >= GAP_THRESH) {
                seenContent = true;
                if (inGap && gapStart - y >= MIN_GAP) bottomCrop = y + 1;
                inGap = false;
            } else {
                if (seenContent && !inGap) { inGap = true; gapStart = y; }
            }
        }
    }

    return { topCrop, bottomCrop };
}
```

### Shared pipeline (inline in each script's try block)

```js
const { topCrop, bottomCrop } = await findContentBounds(tmp_path, CROP_OPTS);
const cropH = Math.max(bottomCrop - topCrop, 1);

const cropped = await sharp(tmp_path)
    .flatten({ background: WHITE })
    .extract({ left: 0, top: topCrop, width: fullW, height: cropH })
    .toBuffer();

await sharp(cropped)
    .trim({ threshold: 30 })
    .resize(800, 800, { fit: 'contain', background: WHITE })
    .jpeg({ quality: 80 })
    .toFile(outPath);

const meta = await sharp(outPath).metadata();
console.log(`  → ${meta.width}×${meta.height} [crop ${topCrop}→${bottomCrop}]`);
```

---

### Task 1: extract-pulsos-resina.mjs

CROP_OPTS: `{ topScanTo: 0.30, bottomScanFrom: 0.65 }`

- [ ] Add `findContentBounds` before main loop; replace exception/normal block; add CROP_OPTS const
- [ ] Run: `node scripts/extract-pulsos-resina.mjs`
- [ ] Verify: 123 images, 800×800, crop rows logged

### Task 2: extract-pulsos-silicona.mjs

CROP_OPTS: `{ topScanTo: 0.10, bottomScanFrom: 0.70 }`

- [ ] Add `findContentBounds` before main loop; replace exception/normal block; add CROP_OPTS const
- [ ] Run: `node scripts/extract-pulsos-silicona.mjs`
- [ ] Verify: 52 images, 800×800

### Task 3: extract-pulsos-cuero.mjs

CROP_OPTS: `{ topScanTo: 0.10, bottomScanFrom: 0.65 }`

- [ ] Add `findContentBounds` before main loop; replace exception/normal block; add CROP_OPTS const
- [ ] Run: `node scripts/extract-pulsos-cuero.mjs`
- [ ] Verify: 46 images, 800×800

### Task 4: extract-pulsos-metalicos.mjs

CROP_OPTS: `{ topScanTo: 0.30, bottomScanFrom: 0.90 }`

- [ ] Add `findContentBounds` before main loop; replace exception/normal block; add CROP_OPTS const
- [ ] Run: `node scripts/extract-pulsos-metalicos.mjs`
- [ ] Verify: 74 images, 800×800

### Task 5: extract-pulsos-pvc.mjs

CROP_OPTS: `{ topScanTo: 0.30, bottomScanFrom: 0.90 }`

- [ ] Add `findContentBounds` before main loop; replace exception/normal block; add CROP_OPTS const
- [ ] Run: `node scripts/extract-pulsos-pvc.mjs`
- [ ] Verify: 85 images, 800×800
