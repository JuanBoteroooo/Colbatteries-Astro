# October 2026 Catalog Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the five PDFs the user uploaded to `public/catalogos/` onto the website: update four existing structured catalogs (Químicos, Baterías Recargables, Pulso Silicona, Gorras Polemik) and add one new catalog, "Reloj Polemik Superior".

**Architecture:** One small shared tool (`scripts/catalog-tools.py`) renders PDF pages at the site's 1334×750 convention, extracts page text and embedded photos, crops thumbnails and computes the thumbnail filename each viewer block expects. Each catalog is then updated by diffing the new PDF against its current JSON by model code (kept / added / removed), rebuilding the JSON in new-PDF page order, replacing the page renders and the site PDF, and creating thumbnails only for added products. The new Superior catalog adds one JSON file, its image assets and one new block in the existing viewer page that reuses the existing grid/search/pill/modal machinery.

**Tech Stack:** Python 3 + Pillow + numpy, Poppler (`pdftoppm`, `pdftotext`, `pdfimages`, `pdfinfo` in `/opt/homebrew/bin`), `pypdf` in a scratch venv (one-off PDF page extraction), Astro 4 (`.astro` viewer page), Playwright (already a devDependency) for the final browser check.

**Spec:** `docs/superpowers/specs/2026-10-05-catalog-update-october-design.md`

## Global Constraints

- Source uploads (untracked, never staged, never modified, never deleted): `public/catalogos/QUIMICOS PARA JOYERIA.pdf`, `public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf`, `public/catalogos/PULSOS SILICONA.pdf`, `public/catalogos/GORRAS SURTIDAS.pdf`, `public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf`.
- Do NOT modify the existing `relojes-polemik` catalog ("Polemik normal"): its JSON, images, page renders and PDF stay byte-identical. Do NOT touch `gorras-lisas`.
- Page renders: `public/catalogo-pages/<slug>/page-NN.jpg`, 1334×750 JPEG, index = PDF page number with at least 2 digits (`page-02`, `page-99`, `page-100`), produced only by `python3 scripts/catalog-tools.py render`.
- Thumbnails: `public/images/productos/<slug>/<stem>.jpg` where `<stem>` is printed by `python3 scripts/catalog-tools.py safe <slug> "<modelo>"` (it mirrors each viewer block's sanitizer; verified against 100% of the current thumbnails of the four updated catalogs).
- JSON: keep each catalog's existing field names; array order = new-PDF page order; `img` = `/catalogo-pages/<slug>/page-NN.jpg` for the product's PDF page.
- Kept products reuse their existing thumbnail file untouched (never regenerate). Removed products' thumbnails are deleted. Only added products get new thumbnails.
- Site PDF: copy the upload to `public/catalogos/<slug>.pdf` using the exact slug names `quimicos-joyeria`, `baterias-recargables`, `pulso-silicona`, `gorras-polemik`, `relojes-polemik-superior`.
- No invented specs: fill product fields only from what the PDF page states; leave a field as `""` (or `null` where this plan says so) when the page does not state it.
- `src/pages/catalogo/[slug].astro` may be edited only in Task 3 (one pill) and Task 7 (Superior wiring). `src/components/CatalogCard.astro` may be edited only in Task 7, only additively (new optional props / new map entries), with zero visual change for existing catalogs.
- `dist/` is tracked in this repository: never build into it. Builds use `npx astro build --outDir "$SCR/dist"`. Never `git add -A` or `git add .` at the repo root; stage explicit paths (or `git add -A -- <directory>` scoped to a catalog's own directory so deletions are staged too).
- Scratch files go in `SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp` (git-ignored, relative to the repo root). Do not use `/tmp`.
- Commits are local only (no push). Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Project rule: before editing UI code (`.astro` templates/styles), invoke the `frontend-design` skill. Here the design intent is "match the existing pattern exactly".

---

### Task 1: Shared catalog tool `scripts/catalog-tools.py`

**Files:**
- Create: `scripts/catalog-tools.py`

**Interfaces:**
- Produces (CLI, run from the repo root): 
  - `python3 scripts/catalog-tools.py render PDF SLUG [--out DIR] [--first N] [--last N]` — renders pages to `DIR/page-NN.jpg` (default `public/catalogo-pages/SLUG`) at 1334×750; with no `--first/--last` it first deletes stale `page-*.jpg` in DIR.
  - `python3 scripts/catalog-tools.py text PDF OUTDIR` — writes `OUTDIR/p-NNN.txt` (3 digits) per page via `pdftotext -layout`.
  - `python3 scripts/catalog-tools.py photos PDF FIRST LAST OUTDIR [--pick largest|first] [--square N]` — writes one embedded image per page to `OUTDIR/page-NNN.jpg`.
  - `python3 scripts/catalog-tools.py crop PDF PAGE X0,Y0,X1,Y1 OUT [--square N]` — crops a box (pixel coordinates of the 2000×1125 render) from one page.
  - `python3 scripts/catalog-tools.py autocrop IMG OUT` — crops the photo block out of a 1334×750 page render.
  - `python3 scripts/catalog-tools.py safe SLUG MODELO` — prints the thumbnail filename stem for a model code.

- [ ] **Step 1: Create `scripts/catalog-tools.py` with exactly this content**

```python
#!/usr/bin/env python3
"""Helpers for updating structured catalogs from a new PDF.

Subcommands:
  render PDF SLUG [--out DIR] [--first N] [--last N]
      Render pages to DIR/page-NN.jpg at 1334x750 (default DIR: public/catalogo-pages/SLUG).
      With no --first/--last it renders every page and first deletes stale page-*.jpg in DIR.
  text PDF OUTDIR
      Write per-page `pdftotext -layout` output to OUTDIR/p-NNN.txt and print the page count.
  photos PDF FIRST LAST OUTDIR [--pick largest|first] [--square N]
      For each page in FIRST..LAST write one embedded image from that page to
      OUTDIR/page-NNN.jpg (RGB JPEG): the largest by pixel area (default) or the first one
      in drawing order. With --square N the image is fitted onto a white NxN canvas.
      Prints a "page  WxH" table (size before squaring); pages without an embedded image
      are listed as "none".
  crop PDF PAGE X0,Y0,X1,Y1 OUT [--square N]
      Render PAGE at 150 dpi (a 960x540pt slide becomes 2000x1125 px), crop the box given in
      those pixel coordinates and save it to OUT (JPEG). With --square N fit it onto a white
      NxN canvas.
  autocrop IMG OUT
      Crop the product photo out of a 1334x750 page render (photo block on top, text below):
      keep the first block of non-white rows (stopping at a gap of 8+ white rows) and trim
      white margins left and right. Saves OUT as JPEG.
  safe SLUG MODELO
      Print the thumbnail filename stem the SLUG's viewer block computes for MODELO.

Requires Pillow and numpy and the Poppler tools in /opt/homebrew/bin.
"""
import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

POPPLER = '/opt/homebrew/bin'
PAGE_SIZE = (1334, 750)

# slug -> (regex of characters replaced by "_", max length), mirroring the sanitizer in
# src/pages/catalogo/[slug].astro for each catalog's block.
SANITIZERS = {
    'quimicos-joyeria': (r'[<>:"|?*\\]', 75),
    'gorras-polemik': (r'[<>:"|?*\\]', 80),
    'baterias-recargables': (r'[<>:"|?*\\()\[\]]', 80),
    'pulso-silicona': (r'[<>:"|?*\\()\[\]]', 80),
    'relojes-polemik-superior': (r'[<>:"|?*\\()\[\]]', 80),
}


def safe_name(slug, modelo):
    chars, limit = SANITIZERS[slug]
    s = modelo.replace('/', '_').replace(' ', '-').replace('#', 'num')
    s = re.sub(chars, '_', s)
    return s[:limit]


def to_square(im, n):
    im = im.convert('RGB')
    im.thumbnail((n, n), Image.LANCZOS)
    canvas = Image.new('RGB', (n, n), 'white')
    canvas.paste(im, ((n - im.size[0]) // 2, (n - im.size[1]) // 2))
    return canvas


def crop_photo(im, white=245, gap=8):
    im = im.convert('RGB')
    gray = np.asarray(im.convert('L'))
    rows = np.where((gray < white).any(axis=1))[0]
    if len(rows) == 0:
        return im
    start = end = rows[0]
    for r in rows[1:]:
        if r - end > gap:
            break
        end = r
    cols = np.where((gray[start:end + 1] < white).any(axis=0))[0]
    return im.crop((int(cols[0]), int(start), int(cols[-1]) + 1, int(end) + 1))


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def page_count(pdf):
    out = run([f'{POPPLER}/pdfinfo', pdf])
    return int(re.search(r'^Pages:\s+(\d+)', out, re.M).group(1))


def cmd_render(args):
    out_dir = args.out or os.path.join('public', 'catalogo-pages', args.slug)
    os.makedirs(out_dir, exist_ok=True)
    total = page_count(args.pdf)
    first = args.first or 1
    last = args.last or total
    if args.first is None and args.last is None:
        for stale in glob.glob(os.path.join(out_dir, 'page-*.jpg')):
            os.remove(stale)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [f'{POPPLER}/pdftoppm', '-jpeg', '-r', '150', '-f', str(first), '-l', str(last), args.pdf, os.path.join(tmp, 'p')],
            check=True, capture_output=True,
        )
        for f in sorted(glob.glob(os.path.join(tmp, 'p-*.jpg'))):
            n = int(re.search(r'p-(\d+)\.jpg$', f).group(1))
            Image.open(f).convert('RGB').resize(PAGE_SIZE).save(os.path.join(out_dir, f'page-{n:02d}.jpg'), quality=85)
    print(f'rendered pages {first}-{last} of {total} to {out_dir}')


def cmd_text(args):
    os.makedirs(args.outdir, exist_ok=True)
    total = page_count(args.pdf)
    for p in range(1, total + 1):
        subprocess.run(
            [f'{POPPLER}/pdftotext', '-layout', '-f', str(p), '-l', str(p), args.pdf, os.path.join(args.outdir, f'p-{p:03d}.txt')],
            check=True, capture_output=True,
        )
    print(f'{total} pages of text written to {args.outdir}')


def cmd_photos(args):
    os.makedirs(args.outdir, exist_ok=True)
    rows = {}
    for line in run([f'{POPPLER}/pdfimages', '-list', '-f', str(args.first), '-l', str(args.last), args.pdf]).splitlines()[2:]:
        cols = line.split()
        rows.setdefault(int(cols[0]), []).append(cols[2])
    with tempfile.TemporaryDirectory() as tmp:
        for page in range(args.first, args.last + 1):
            kinds = rows.get(page, [])
            if 'image' not in kinds:
                print(f'{page:>4}  none')
                continue
            prefix = os.path.join(tmp, f'pg{page}')
            subprocess.run([f'{POPPLER}/pdfimages', '-all', '-f', str(page), '-l', str(page), args.pdf, prefix], check=True, capture_output=True)
            files = sorted(glob.glob(prefix + '-*'))
            sizes = {f: Image.open(f).size for f in files}
            if args.pick == 'first' and len(files) == len(kinds):
                chosen = files[kinds.index('image')]
            else:
                chosen = max(files, key=lambda f: sizes[f][0] * sizes[f][1])
            out = Image.open(chosen).convert('RGB')
            if args.square:
                out = to_square(out, args.square)
            out.save(os.path.join(args.outdir, f'page-{page:03d}.jpg'), quality=92)
            print(f'{page:>4}  {sizes[chosen][0]}x{sizes[chosen][1]}')


def cmd_crop(args):
    x0, y0, x1, y1 = (int(v) for v in args.box.split(','))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [f'{POPPLER}/pdftoppm', '-jpeg', '-r', '150', '-f', str(args.page), '-l', str(args.page), args.pdf, os.path.join(tmp, 'p')],
            check=True, capture_output=True,
        )
        im = Image.open(glob.glob(os.path.join(tmp, 'p-*.jpg'))[0]).convert('RGB').crop((x0, y0, x1, y1))
    if args.square:
        im = to_square(im, args.square)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    im.save(args.out, quality=90)
    print(f'saved {args.out} ({im.size[0]}x{im.size[1]})')


def cmd_autocrop(args):
    im = crop_photo(Image.open(args.img))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    im.save(args.out, quality=90)
    print(f'saved {args.out} ({im.size[0]}x{im.size[1]})')


def cmd_safe(args):
    print(safe_name(args.slug, args.modelo))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('render')
    r.add_argument('pdf')
    r.add_argument('slug')
    r.add_argument('--out')
    r.add_argument('--first', type=int)
    r.add_argument('--last', type=int)
    r.set_defaults(fn=cmd_render)
    t = sub.add_parser('text')
    t.add_argument('pdf')
    t.add_argument('outdir')
    t.set_defaults(fn=cmd_text)
    p = sub.add_parser('photos')
    p.add_argument('pdf')
    p.add_argument('first', type=int)
    p.add_argument('last', type=int)
    p.add_argument('outdir')
    p.add_argument('--pick', choices=['largest', 'first'], default='largest')
    p.add_argument('--square', type=int)
    p.set_defaults(fn=cmd_photos)
    c = sub.add_parser('crop')
    c.add_argument('pdf')
    c.add_argument('page', type=int)
    c.add_argument('box')
    c.add_argument('out')
    c.add_argument('--square', type=int)
    c.set_defaults(fn=cmd_crop)
    a = sub.add_parser('autocrop')
    a.add_argument('img')
    a.add_argument('out')
    a.set_defaults(fn=cmd_autocrop)
    s = sub.add_parser('safe')
    s.add_argument('slug')
    s.add_argument('modelo')
    s.set_defaults(fn=cmd_safe)
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 2: Syntax check and help**

```bash
python3 scripts/catalog-tools.py --help | head -5
python3 scripts/catalog-tools.py safe pulso-silicona "PUSI/TECH-01-20NG (TECHNOMARINE)"
```
Expected: usage text, then `PUSI_TECH-01-20NG-_TECHNOMARINE_`.

- [ ] **Step 3: Verify the `safe` sanitizer reproduces every current thumbnail filename**

```bash
python3 - <<'EOF'
import importlib.util, json, os
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
for slug, jf in [('quimicos-joyeria', 'quimicos-joyeria'), ('baterias-recargables', 'baterias-recargables'),
                 ('pulso-silicona', 'pulsos-silicona'), ('gorras-polemik', 'gorras-polemik')]:
    data = json.load(open(f'src/data/{jf}.json'))
    missing = [x['modelo'] for x in data if not os.path.exists(f'public/images/productos/{slug}/{ct.safe_name(slug, x["modelo"])}.jpg')]
    print(slug, len(data), 'thumbnail files missing for modelos:', missing)
EOF
```
Expected: four lines, each ending with `missing for modelos: []`.

- [ ] **Step 4: Verify `render` reproduces the site's existing page renders**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py render "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" baterias-recargables --out "$SCR/render-check" --first 1 --last 12
python3 - <<'EOF'
import glob, os
from PIL import Image, ImageChops, ImageStat
scr = '.superpowers/sdd/2026-10-05-catalog-update-october/tmp/render-check'
worst = 0
files = sorted(glob.glob(scr + '/page-*.jpg'))
for f in files:
    a = Image.open(f).convert('RGB')
    b = Image.open('public/catalogo-pages/baterias-recargables/' + os.path.basename(f)).convert('RGB')
    worst = max(worst, sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3)
print('pages compared:', len(files), '| worst mean abs diff:', round(worst, 2))
EOF
```
Expected: `pages compared: 12 | worst mean abs diff:` a number below 3 (these 12 pages are visually unchanged in the new PDF; it was 2.05 when this plan was written).

- [ ] **Step 5: Verify `photos` and `crop`**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
python3 scripts/catalog-tools.py photos "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" 3 4 "$SCR/photos-check" --pick first
python3 scripts/catalog-tools.py crop "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" 14 60,15,880,1115 "$SCR/crop-check.jpg"
```
Expected: `   3  700x700`, `   4  700x700`, then `saved .../crop-check.jpg (820x1100)`.

- [ ] **Step 6: Commit**

```bash
git add scripts/catalog-tools.py
git commit -m "$(cat <<'EOF'
Add catalog-tools.py helper for updating catalogs from new PDFs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Update `quimicos-joyeria`

**Files:**
- Replace: `public/catalogo-pages/quimicos-joyeria/page-01.jpg` … `page-15.jpg` (15 files; all 15 pages were restyled in the new PDF: codes no longer wrap onto two lines, new cover)
- Replace: `public/catalogos/quimicos-joyeria.pdf`
- Verify (expected unchanged): `src/data/quimicos-joyeria.json` (14 products, schema `{modelo, descripcion, tipo, img}`)
- Source: `public/catalogos/QUIMICOS PARA JOYERIA.pdf` (15 pages: cover + 14 product pages, each product page's text is just its model code)

**Interfaces:**
- Consumes: `python3 scripts/catalog-tools.py render|text` (Task 1).
- Produces: nothing later tasks depend on.

The 14 products and their product photos are unchanged, so thumbnails (`public/images/productos/quimicos-joyeria/*.jpg`) stay untouched.

- [ ] **Step 1: Verify every JSON record's `img` still points at the page whose text is that model code**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py text "public/catalogos/QUIMICOS PARA JOYERIA.pdf" "$SCR/q-text"
python3 - <<'EOF'
import json, re
scr = '.superpowers/sdd/2026-10-05-catalog-update-october/tmp/q-text'
bad = []
data = json.load(open('src/data/quimicos-joyeria.json'))
for x in data:
    page = int(re.search(r'page-(\d+)\.jpg', x['img']).group(1))
    words = open(f'{scr}/p-{page:03d}.txt').read().split()
    if x['modelo'] not in words:
        bad.append((x['modelo'], page, words))
print(len(data), 'records | mismatches:', bad)
EOF
```
Expected: `14 records | mismatches: []`. If a record's page differs, set that record's `img` to the page (zero-padded to 2 digits) whose text equals its `modelo`, and note it in your report.

- [ ] **Step 2: Render all 15 pages (replaces the old renders)**

```bash
python3 scripts/catalog-tools.py render "public/catalogos/QUIMICOS PARA JOYERIA.pdf" quimicos-joyeria
ls public/catalogo-pages/quimicos-joyeria | wc -l
```
Expected: `rendered pages 1-15 of 15 to public/catalogo-pages/quimicos-joyeria` and `15`.

- [ ] **Step 3: Visual check**

View `page-01.jpg`, `page-02.jpg`, `page-09.jpg` and `page-15.jpg` in `public/catalogo-pages/quimicos-joyeria/`. Confirm: page 1 is the cover "QUIMICOS PARA JOYERIA" (bold, three lines), the model codes sit on one line (e.g. `DPT0501`, `DPSN01BRQT`, not wrapped), and each page's code matches the JSON record that points at it.

- [ ] **Step 4: Replace the site PDF**

```bash
cp "public/catalogos/QUIMICOS PARA JOYERIA.pdf" public/catalogos/quimicos-joyeria.pdf
cmp "public/catalogos/QUIMICOS PARA JOYERIA.pdf" public/catalogos/quimicos-joyeria.pdf && echo identical
```
Expected: `identical`.

- [ ] **Step 5: Integrity check**

```bash
python3 - <<'EOF'
import json, os
data = json.load(open('src/data/quimicos-joyeria.json'))
assert len(data) == 14
for x in data:
    assert os.path.exists('public' + x['img']), x['img']
print('ok: 14 records, all page images exist')
EOF
git status --short | grep -v '^??'
```
Expected: `ok: 14 records, all page images exist`, and the status lines list only files under `public/catalogo-pages/quimicos-joyeria/` and `public/catalogos/quimicos-joyeria.pdf` (plus `src/data/quimicos-joyeria.json` only if Step 1 forced a fix).

- [ ] **Step 6: Commit**

```bash
git add -A -- public/catalogo-pages/quimicos-joyeria
git add public/catalogos/quimicos-joyeria.pdf
git diff --quiet src/data/quimicos-joyeria.json || git add src/data/quimicos-joyeria.json
git commit -m "$(cat <<'EOF'
Update Químicos para Joyería catalog from the restyled PDF

Same 14 products; page renders and site PDF replaced.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update `baterias-recargables` (+8 energy stations)

**Files:**
- Modify: `src/data/baterias-recargables.json` (schema `{modelo, marca, tipo, tamano, voltaje, capacidad, descripcion, img}`; 11 records today, 19 after)
- Add: `public/catalogo-pages/baterias-recargables/page-13.jpg` … `page-21.jpg` (pages 1–12 already exist and are visually identical to the new PDF — do not re-render them)
- Add: `public/images/productos/baterias-recargables/<stem>.jpg` × 8
- Modify: `src/pages/catalogo/[slug].astro` (one new pill in the `isBatRecargables` block)
- Replace: `public/catalogos/baterias-recargables.pdf`
- Source: `public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf` (21 pages)

**Interfaces:**
- Consumes: `python3 scripts/catalog-tools.py render|crop|safe` (Task 1).
- Produces: nothing later tasks depend on.

Page map of the new PDF: 1 cover; 2–12 the 11 current products (unchanged); 13 section divider "Estaciones de Energía" (no product); 14–21 the 8 new products `ESTACION-500W`, `ESTACION-600W`, `ESTACION-800W`, `ESTACION-1000W`, `ESTACION-1200W`, `ESTACION-1500W`, `ESTACION-2000W`, `ESTACION-3000W` (page 14 = 500W … page 21 = 3000W, in that order).

- [ ] **Step 1: Render only the new pages**

```bash
python3 scripts/catalog-tools.py render "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" baterias-recargables --first 13 --last 21
ls public/catalogo-pages/baterias-recargables | wc -l
```
Expected: `rendered pages 13-21 of 21 …` and `21`.

- [ ] **Step 2: Read the specs of each station page**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py text "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" "$SCR/r-text"
for p in 014 015 016 017 018 019 020 021; do echo "=== page $p ==="; grep -v '^\s*$' "$SCR/r-text/p-$p.txt"; done
```
Each station page has a spec table: "Capacidad de Bateria", "Voltage de Salida", "Potencia Nominal", and a line "Incluye Panel Solar de NNw y Conector de 5 metros". Also view `page-14.jpg` … `page-21.jpg` in the render folder to confirm what each shows.

- [ ] **Step 3: Append the 8 records to `src/data/baterias-recargables.json`** (after the existing 11, in page order)

Field rules: `modelo` = the code on the page; `marca` = `""` (no brand is stated); `tipo` = `"Estación"` (exactly this value, it becomes the new pill); `tamano` = the page's "Potencia Nominal" value (e.g. `"500W"`); `voltaje` = the page's "Voltage de Salida" value (e.g. `"110V"`); `capacidad` = the page's "Capacidad de Bateria" value verbatim; `descripcion` = `"Estación de energía portátil <potencia> con carga solar o de corriente 110V"` plus `". Incluye panel solar de <N>W y conector de 5 metros"` only if the page states an included solar panel (use the panel wattage printed on that page); nothing else; `img` = `/catalogo-pages/baterias-recargables/page-NN.jpg` for that product's page. Example (page 14, verified from the page text):

```json
{
  "modelo": "ESTACION-500W",
  "marca": "",
  "tipo": "Estación",
  "tamano": "500W",
  "voltaje": "110V",
  "capacidad": "384WH 12.8V 30AH/80000mah",
  "descripcion": "Estación de energía portátil 500W con carga solar o de corriente 110V. Incluye panel solar de 40W y conector de 5 metros",
  "img": "/catalogo-pages/baterias-recargables/page-14.jpg"
}
```

- [ ] **Step 4: Create the 8 thumbnails (station photo only)**

The station photos occupy the left column of each page. Start from this crop (pixel coordinates of the 2000×1125 render) and adjust per page after viewing the result so that only the station photo(s) remain — no spec table, no solar-panel pictures, no page text:

```bash
python3 scripts/catalog-tools.py crop "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" 14 60,15,880,1115 "public/images/productos/baterias-recargables/ESTACION-500W.jpg"
```
(page 14 → `ESTACION-500W`; repeat for pages 15–21 with their model code as the filename stem; confirm each stem with `python3 scripts/catalog-tools.py safe baterias-recargables "ESTACION-600W"` etc.) View every output file before moving on. Existing thumbnails in this folder are portrait crops of about 760–950 × 745–1125 px; yours should be similar.

- [ ] **Step 5: Add the "Estaciones" pill**

Invoke the `frontend-design` skill first (project rule; the intent is to copy the existing pattern exactly). In `src/pages/catalogo/[slug].astro`, inside the `{isBatRecargables && (` block, the tipo bar currently ends like this:

```
            <button class="eta-tipo-pill" data-tipo="Litio">Litio</button>
            <button class="eta-tipo-pill" data-tipo="Ni-MH">Ni-MH</button>
          </div>
```
Add one line after the Ni-MH button, same indentation:

```
            <button class="eta-tipo-pill" data-tipo="Estación">Estaciones</button>
```
Change nothing else in this file.

- [ ] **Step 6: Replace the site PDF**

```bash
cp "public/catalogos/BATERIAS RECARGABLES Y CARGADORES ECONOMICOS (1).pdf" public/catalogos/baterias-recargables.pdf
```

- [ ] **Step 7: Integrity check**

```bash
python3 - <<'EOF'
import importlib.util, json, os
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
data = json.load(open('src/data/baterias-recargables.json'))
assert len(data) == 19, len(data)
for x in data:
    assert os.path.exists('public' + x['img']), x['img']
    assert os.path.exists(f'public/images/productos/baterias-recargables/{ct.safe_name("baterias-recargables", x["modelo"])}.jpg'), x['modelo']
print('ok: 19 records; stations =', sum(1 for x in data if x['tipo'] == 'Estación'))
EOF
git diff --stat -- "src/pages/catalogo/[slug].astro"
```
Expected: `ok: 19 records; stations = 8`; the diff stat shows exactly 1 insertion in `[slug].astro`.

- [ ] **Step 8: Commit**

```bash
git add src/data/baterias-recargables.json "src/pages/catalogo/[slug].astro" public/catalogos/baterias-recargables.pdf
git add -A -- public/catalogo-pages/baterias-recargables public/images/productos/baterias-recargables
git commit -m "$(cat <<'EOF'
Add 8 energy stations to the Baterías Recargables catalog

New "Estaciones" pill, product pages 13-21, thumbnails and refreshed site PDF.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update `pulso-silicona` (+3 TECHNOMARINE straps)

**Files:**
- Modify: `src/data/pulsos-silicona.json` (schema `{modelo, descripcion, medida, img}`; 61 records today, 64 after)
- Replace: `public/catalogo-pages/pulso-silicona/page-01.jpg` … `page-65.jpg` (65 pages; the old folder has 62)
- Add: `public/images/productos/pulso-silicona/<stem>.jpg` × 3 (800×800 white-background squares like the existing ones)
- Replace: `public/catalogos/pulso-silicona.pdf`
- Source: `public/catalogos/PULSOS SILICONA.pdf` (65 pages: cover + 64 product pages, one product per page)

**Interfaces:**
- Consumes: `python3 scripts/catalog-tools.py render|text|photos|safe` (Task 1).
- Produces: nothing later tasks depend on.

Verified when this plan was written: 61 current products are still present, 3 are new (`PUSI/TECH-01-20NG (TECHNOMARINE)` p31, `TECH-02-22NG` p32, `TECH-03-24NG` p33), 0 are removed. Some pages open with a "PIN INCLUIDO" banner, so a product's code is not always on the page's first line — match by the code found anywhere on the page.

- [ ] **Step 1: Extract per-page text and save the rebuild script**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py text "public/catalogos/PULSOS SILICONA.pdf" "$SCR/s-text"
cat > "$SCR/silicona_rebuild.py" <<'EOF'
import glob
import json
import re
import sys

TXT, OUT = sys.argv[1], sys.argv[2]
CODE = re.compile(r'\b(?:PUSI|PIPUSI|PUSIBI|PIPUSIH)[A-Z0-9/\-]*', re.I)

old = json.load(open('src/data/pulsos-silicona.json'))
by_code = {CODE.search(x['modelo']).group(0).upper(): x for x in old}

records, added, seen = [], [], []
for i, f in enumerate(sorted(glob.glob(f'{TXT}/p-*.txt')), 1):
    if i == 1:
        continue  # cover page
    text = open(f).read()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    code = CODE.search(text).group(0).upper()
    seen.append(code)
    img = f'/catalogo-pages/pulso-silicona/page-{i:02d}.jpg'
    if code in by_code:
        rec = dict(by_code[code])
        rec['img'] = img
    else:
        idx = next(k for k, l in enumerate(lines) if CODE.search(l))
        modelo = re.split(r'\s{3,}', lines[idx])[0].strip()
        descripcion = ' '.join(lines[idx + 1:])
        mm = re.search(r'(\d+)\s*MM', descripcion, re.I)
        rec = {'modelo': modelo, 'descripcion': descripcion, 'medida': f'{mm.group(1)}mm' if mm else '', 'img': img}
        added.append(rec)
    records.append(rec)

removed = sorted(set(by_code) - set(seen))
print(f'product pages: {len(records)} | kept: {len(records) - len(added)} | added: {len(added)} | removed: {len(removed)}')
print('added records:')
for r in added:
    print(' ', json.dumps(r, ensure_ascii=False))
print('removed codes:', removed)
json.dump(records, open(OUT, 'w'), ensure_ascii=False, indent=2)
EOF
python3 "$SCR/silicona_rebuild.py" "$SCR/s-text" "$SCR/silicona-new.json"
```
Expected output: `product pages: 64 | kept: 61 | added: 3 | removed: 0`, then the three TECHNOMARINE records exactly:
`{"modelo": "PUSI/TECH-01-20NG (TECHNOMARINE)", "descripcion": "PULSO SILICONA NEGRO 20MM", "medida": "20mm", "img": "/catalogo-pages/pulso-silicona/page-31.jpg"}` (and the same shape for `TECH-02-22NG` / 22MM / page-32 and `TECH-03-24NG` / 24MM / page-33), and `removed codes: []`. If the numbers differ, stop and report (status NEEDS_CONTEXT) with the printed lists.

- [ ] **Step 2: Render all 65 pages (replaces the old renders)**

```bash
python3 scripts/catalog-tools.py render "public/catalogos/PULSOS SILICONA.pdf" pulso-silicona
ls public/catalogo-pages/pulso-silicona | wc -l
```
Expected: `rendered pages 1-65 of 65 …` and `65`.

- [ ] **Step 3: Create the 3 thumbnails (800×800, product on white, like the existing ones)**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
python3 scripts/catalog-tools.py photos "public/catalogos/PULSOS SILICONA.pdf" 31 33 "$SCR/s-photos" --square 800
for pair in "31:PUSI/TECH-01-20NG (TECHNOMARINE)" "32:PUSI/TECH-02-22NG (TECHNOMARINE)" "33:PUSI/TECH-03-24NG (TECHNOMARINE)"; do
  page="${pair%%:*}"; modelo="${pair#*:}"
  stem=$(python3 scripts/catalog-tools.py safe pulso-silicona "$modelo")
  cp "$SCR/s-photos/page-0$page.jpg" "public/images/productos/pulso-silicona/$stem.jpg"
done
ls public/images/productos/pulso-silicona | grep TECH
```
Expected: three files `PUSI_TECH-01-20NG-_TECHNOMARINE_.jpg`, `…TECH-02-22NG…`, `…TECH-03-24NG…`. View all three: each must show the strap photo centered on white (compare with an existing thumbnail such as `PUSI_J2119-20-AL-26.jpg`). If `--pick largest` returned something other than the strap photo for a page, use `crop` with a box around the strap photo instead.

- [ ] **Step 4: Install the rebuilt JSON**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
cp "$SCR/silicona-new.json" src/data/pulsos-silicona.json
```

- [ ] **Step 5: Integrity check and spot-check**

```bash
python3 - <<'EOF'
import importlib.util, json, os
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
data = json.load(open('src/data/pulsos-silicona.json'))
assert len(data) == 64, len(data)
for x in data:
    assert os.path.exists('public' + x['img']), x['img']
    assert os.path.exists(f'public/images/productos/pulso-silicona/{ct.safe_name("pulso-silicona", x["modelo"])}.jpg'), x['modelo']
print('ok:', len(data), 'records; first/last img:', data[0]['img'], data[-1]['img'])
EOF
```
Expected: `ok: 64 records; first/last img: /catalogo-pages/pulso-silicona/page-02.jpg /catalogo-pages/pulso-silicona/page-65.jpg`.
Then view 5 page renders (for example `page-02`, `page-09`, `page-31`, `page-53`, `page-65`) and confirm each shows the product whose JSON record points at it (modelo text visible on the page).

- [ ] **Step 6: Replace the site PDF**

```bash
cp "public/catalogos/PULSOS SILICONA.pdf" public/catalogos/pulso-silicona.pdf
```

- [ ] **Step 7: Commit**

```bash
git add src/data/pulsos-silicona.json public/catalogos/pulso-silicona.pdf
git add -A -- public/catalogo-pages/pulso-silicona public/images/productos/pulso-silicona
git commit -m "$(cat <<'EOF'
Update Pulso Silicona catalog: add 3 TECHNOMARINE straps, refresh pages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update `gorras-polemik` (+8 added, −7 removed)

**Files:**
- Modify: `src/data/gorras-polemik.json` (schema `{modelo, estilo, img}`; 205 records today, 206 after)
- Replace: `public/catalogo-pages/gorras-polemik/page-01.jpg` … `page-220.jpg` (the old folder has 219 pages)
- Add: `public/images/productos/gorras-polemik/<stem>.jpg` × 8; Delete: the thumbnails of the 7 removed models (if a file does not exist, skip it)
- Replace: `public/catalogos/gorras-polemik.pdf`
- Source: `public/catalogos/GORRAS SURTIDAS.pdf` (220 pages: cover, 13 section-divider pages, 206 product pages whose text is only the model code)

**Interfaces:**
- Consumes: `python3 scripts/catalog-tools.py render|text|autocrop|safe` (Task 1).
- Produces: nothing later tasks depend on.

Verified when this plan was written: 195 current models are still present, 8 are new, 7 are gone; `P-501` appears on 4 pages in both the old and new PDF and the current JSON already has 4 `P-501` records (keep 4 records, one per page; they share the thumbnail `P-501.jpg` — pre-existing behaviour, do not change it). Estilo rules: a kept model keeps its current `estilo`; an added model takes the estilo of the section whose divider precedes its page; pages 2–15 precede the first divider and are BORDADA in the current data. Section → estilo: CAMIONERAS AAA→CAMIONERA, CAMIONERAS ECONOMICA→ECONOMICA, CERRADA FLEX AAA→FLEX, HEBILLA→HEBILLA, CIERRE MAGICO IMPERMEABLE→IMPERMEABLE, BORDADAS CON HEBILLA→BORDADA, PLANAS AAA→PLANA, CUERINA→CUERINA, DAMA→DAMA, GOLEANAS→GOLEANA, BOINAS→BOINA, HEBILLA NIÑO→NINO, HEBILLA NIÑA→NINA.

- [ ] **Step 1: Extract per-page text and save the rebuild script**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py text "public/catalogos/GORRAS SURTIDAS.pdf" "$SCR/g-text"
cat > "$SCR/gorras_rebuild.py" <<'EOF'
import glob
import json
import re
import sys

TXT, OUT = sys.argv[1], sys.argv[2]
SECTION = {
    'CAMIONERAS AAA': 'CAMIONERA', 'CAMIONERAS ECONOMICA': 'ECONOMICA', 'CERRADA FLEX AAA': 'FLEX',
    'HEBILLA': 'HEBILLA', 'CIERRE MAGICO IMPERMEABLE': 'IMPERMEABLE', 'BORDADAS CON HEBILLA': 'BORDADA',
    'PLANAS AAA': 'PLANA', 'CUERINA': 'CUERINA', 'DAMA': 'DAMA', 'GOLEANAS': 'GOLEANA',
    'BOINAS': 'BOINA', 'HEBILLA NIÑO': 'NINO', 'HEBILLA NIÑA': 'NINA',
}
PRE_DIVIDER_ESTILO = 'BORDADA'  # pages before the first divider are all BORDADA in the current data
CODE_ONLY = re.compile(r'^[A-Z]{1,3}-?\d+', re.I)

old = json.load(open('src/data/gorras-polemik.json'))
old_estilo = {}
for x in old:
    old_estilo.setdefault(x['modelo'].upper(), x['estilo'])

section = PRE_DIVIDER_ESTILO
records, added, mismatches, seen = [], [], [], set()
for i, f in enumerate(sorted(glob.glob(f'{TXT}/p-*.txt')), 1):
    if i == 1:
        continue  # cover page
    lines = [l.strip() for l in open(f).read().splitlines() if l.strip()]
    if len(lines) == 1 and CODE_ONLY.match(lines[0]):
        modelo = lines[0]
        key = modelo.upper()
        seen.add(key)
        img = f'/catalogo-pages/gorras-polemik/page-{i:02d}.jpg'
        if key in old_estilo:
            estilo = old_estilo[key]
            if estilo != section:
                mismatches.append((i, modelo, estilo, section))
        else:
            estilo = section
            added.append((i, modelo, estilo))
        records.append({'modelo': modelo, 'estilo': estilo, 'img': img})
    else:
        name = ' '.join(lines)
        if name not in SECTION:
            sys.exit(f'unmapped divider on page {i}: {name!r}')
        section = SECTION[name]

removed = sorted(set(old_estilo) - seen)
print(f'product pages: {len(records)} | unique modelos: {len(seen)} | kept: {len(seen) - len(added)} | added: {len(added)} | removed: {len(removed)}')
print('added (page, modelo, estilo):', added)
print('removed:', removed)
print('kept whose current estilo differs from the new section (kept value wins):', mismatches)
json.dump(records, open(OUT, 'w'), ensure_ascii=False, indent=2)
EOF
python3 "$SCR/gorras_rebuild.py" "$SCR/g-text" "$SCR/gorras-new.json"
```
Expected output (exactly):
```
product pages: 206 | unique modelos: 203 | kept: 195 | added: 8 | removed: 7
added (page, modelo, estilo): [(15, 'P-92', 'BORDADA'), (31, 'P-86', 'CAMIONERA'), (32, 'P-87', 'CAMIONERA'), (33, 'P-88', 'CAMIONERA'), (34, 'P-89', 'CAMIONERA'), (35, 'P-95', 'CAMIONERA'), (154, 'P-90', 'PLANA'), (162, 'P-91', 'CUERINA')]
removed: ['G-07', 'G-1020', 'P-24', 'P-606', 'P-610', 'P-620', 'P-631']
kept whose current estilo differs from the new section (kept value wins): [(164, 'P-68', 'DAMA', 'CUERINA')]
```
If the numbers or lists differ, stop and report (status NEEDS_CONTEXT) with the printed output.

- [ ] **Step 2: Render all 220 pages (replaces the old renders; takes a few minutes)**

```bash
python3 scripts/catalog-tools.py render "public/catalogos/GORRAS SURTIDAS.pdf" gorras-polemik
ls public/catalogo-pages/gorras-polemik | wc -l
```
Expected: `rendered pages 1-220 of 220 …` and `220`.

- [ ] **Step 3: Thumbnails — create the 8 new ones, delete the 7 obsolete ones**

The new pages have the same layout as the existing ones (photo block on top, model code below), so use `autocrop` on the freshly rendered page (existing thumbnails are about 1300×600):

```bash
for pair in "15:P-92" "31:P-86" "32:P-87" "33:P-88" "34:P-89" "35:P-95" "154:P-90" "162:P-91"; do
  page="${pair%%:*}"; modelo="${pair#*:}"
  stem=$(python3 scripts/catalog-tools.py safe gorras-polemik "$modelo")
  python3 scripts/catalog-tools.py autocrop "public/catalogo-pages/gorras-polemik/page-$(printf %02d "$page").jpg" "public/images/productos/gorras-polemik/$stem.jpg"
done
for modelo in G-07 G-1020 P-24 P-606 P-610 P-620 P-631; do
  stem=$(python3 scripts/catalog-tools.py safe gorras-polemik "$modelo")
  rm -f "public/images/productos/gorras-polemik/$stem.jpg"
done
```
View all 8 new thumbnails: each must show the cap photo(s) only, no code text and no large white band; compare with an existing one such as `P-45.jpg`. If a crop is off, re-crop that page with `crop` using an explicit box.

- [ ] **Step 4: Install the rebuilt JSON**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
cp "$SCR/gorras-new.json" src/data/gorras-polemik.json
```

- [ ] **Step 5: Integrity check and spot-check**

```bash
python3 - <<'EOF'
import importlib.util, json, os
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
data = json.load(open('src/data/gorras-polemik.json'))
assert len(data) == 206, len(data)
assert sum(1 for x in data if x['modelo'] == 'P-501') == 4
for x in data:
    assert os.path.exists('public' + x['img']), x['img']
    assert os.path.exists(f'public/images/productos/gorras-polemik/{ct.safe_name("gorras-polemik", x["modelo"])}.jpg'), x['modelo']
print('ok:', len(data), 'records; estilos:', sorted({x['estilo'] for x in data}))
EOF
```
Expected: `ok: 206 records; estilos:` the 13 values BORDADA, BOINA, CAMIONERA, CUERINA, DAMA, ECONOMICA, FLEX, GOLEANA, HEBILLA, IMPERMEABLE, NINA, NINO, PLANA.
Then view 5 page renders (for example `page-02`, `page-31`, `page-107`, `page-162`, `page-220`) and confirm the code printed on each page equals the JSON record that points at it.

- [ ] **Step 6: Replace the site PDF**

```bash
cp "public/catalogos/GORRAS SURTIDAS.pdf" public/catalogos/gorras-polemik.pdf
```

- [ ] **Step 7: Commit**

```bash
git add src/data/gorras-polemik.json public/catalogos/gorras-polemik.pdf
git add -A -- public/catalogo-pages/gorras-polemik public/images/productos/gorras-polemik
git commit -m "$(cat <<'EOF'
Update Gorras Polemik catalog from the new Gorras Surtidas PDF

Adds 8 caps, removes 7 that are no longer in the catalog, refreshes pages.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Polemik Superior — data and assets

**Files:**
- Create: `src/data/relojes-polemik-superior.json` (67 records)
- Create: `public/catalogo-pages/relojes-polemik-superior/page-01.jpg` … `page-73.jpg` (73 files)
- Create: `public/images/productos/relojes-polemik-superior/<stem>.jpg` × 67
- Create: `public/catalogos/relojes-polemik-superior.pdf` (pages 1–73 of the upload)
- Source: `public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf` (157 pages). Only pages 1–73 are used: 1 cover; 2 Caballero divider; 3–56 Caballero (54 products); 57 Dama divider; 58 Dama overview; 59–67 Dama (9); 68 Unisex divider; 69 Unisex overview; 70–73 Unisex (4). Pages 74–157 (Analógico, Digital, Estuches) belong to "Polemik normal" and are NOT used.

**Interfaces:**
- Consumes: `python3 scripts/catalog-tools.py render|text|photos|safe` (Task 1).
- Produces for Task 7: `src/data/relojes-polemik-superior.json`, an array of 67 objects with exactly these keys: `modelo` (string, the REFERENCIA code, unique), `nombre` (string), `categoria` (`"CABALLERO"` | `"DAMA"` | `"UNISEX"`), `tipo` (string[], non-empty), `caja` (`{material, color}` or `null`), `correa` (`{material, color}` or `null`), `img` (`/catalogo-pages/relojes-polemik-superior/page-NN.jpg`). Thumbnails live at `/images/productos/relojes-polemik-superior/<stem>.jpg` with `<stem>` = `safe relojes-polemik-superior <modelo>`. The site PDF is `/catalogos/relojes-polemik-superior.pdf`.

Two page layouts exist: pages 3–28, 59–67, 70–73 print a title line + category, a tags line, a CAJA block and a CORREA block (material/color) and a REFERENCIA line; pages 29–56 (28 pages) use a short layout with 2–4 photos, a title line + category, and one line `REFERENCIA <code> <tag> <tag> …` and no CAJA/CORREA block (`caja`/`correa` = `null`).

- [ ] **Step 1: Extract text and build the JSON with this script**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
python3 scripts/catalog-tools.py text "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" "$SCR/p-text"
cat > "$SCR/superior_build.py" <<'EOF'
import json
import re
import sys

TXT, OUT = sys.argv[1], sys.argv[2]
CATS = {'CABALLERO', 'DAMA', 'UNISEX'}
FIXES = [('Cronografo', 'Cronógrafo'), ('Clasico', 'Clásico'), ('FechaTitan', 'Fecha Titan')]
FIRST_PAGE, LAST_PAGE = 3, 73


def cols(line):
    return [c for c in re.split(r'\s{2,}', line.strip()) if c]


def clean(s):
    s = re.sub(r'\s+', ' ', s).strip()
    for wrong, right in FIXES:
        s = s.replace(wrong, right)
    return s


def tidy_color(s):
    s = re.sub(r'\s+', ' ', s).strip()
    return s.capitalize() if s.isupper() else s


def parse_page(n, text):
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return None
    head = cols(lines[0])
    if len(head) < 2 or head[-1].upper() not in CATS:
        return None  # divider / overview page
    rec = {'modelo': None, 'nombre': clean(' '.join(head[:-1])), 'categoria': head[-1].upper(),
           'tipo': [], 'caja': None, 'correa': None,
           'img': f'/catalogo-pages/relojes-polemik-superior/page-{n:02d}.jpg'}
    section = None
    for line in lines[1:]:
        s = line.strip()
        compact = re.sub(r'\s+', '', s).upper()
        m = re.match(r'REFERENCIA\s+(\S+)\s*(.*)$', s)
        if m:
            rec['modelo'] = m.group(1)
            if m.group(2).strip():
                rec['tipo'] = [clean(t) for t in cols(m.group(2))]
            section = None
        elif compact == 'CAJA':
            section = 'caja'
        elif compact == 'CORREA':
            section = 'correa'
        elif compact == 'MATERIALCOLOR':
            continue
        elif section in ('caja', 'correa'):
            c = cols(s)
            if len(c) == 2 and rec[section] is None:
                rec[section] = {'material': clean(c[0]), 'color': tidy_color(c[1])}
        elif rec['modelo'] is None and not rec['tipo']:
            rec['tipo'] = [clean(t) for t in cols(s)]
    return rec


records = []
for n in range(FIRST_PAGE, LAST_PAGE + 1):
    rec = parse_page(n, open(f'{TXT}/p-{n:03d}.txt').read())
    if rec:
        records.append(rec)

by_cat = {c: sum(1 for r in records if r['categoria'] == c) for c in sorted(CATS)}
print(f'records: {len(records)} | by categoria: {by_cat} | unique modelos: {len({r["modelo"] for r in records})}')
print('missing modelo:', [r['img'] for r in records if not r['modelo']], '| missing tipo:', [r['modelo'] for r in records if not r['tipo']])
print('without caja/correa (expected: the 28 pages 29-56):', sum(1 for r in records if r['caja'] is None))
json.dump(records, open(OUT, 'w'), ensure_ascii=False, indent=2)
EOF
python3 "$SCR/superior_build.py" "$SCR/p-text" "$SCR/superior-new.json"
```
Expected output (exactly):
```
records: 67 | by categoria: {'CABALLERO': 54, 'DAMA': 9, 'UNISEX': 4} | unique modelos: 67
missing modelo: [] | missing tipo: []
without caja/correa (expected: the 28 pages 29-56): 28
```
If anything differs, stop and report (NEEDS_CONTEXT). Known good first record: `{"modelo": "2503D-BC", "nombre": "Doble Hora", "categoria": "CABALLERO", "tipo": ["Cronógrafo", "Taquímetro"], "caja": {"material": "Acero inoxidable", "color": "Dorado"}, "correa": {"material": "Acero inoxidable", "color": "Dorado"}, "img": "/catalogo-pages/relojes-polemik-superior/page-03.jpg"}`; first short-layout record (page 29): `{"modelo": "303D", "nombre": "Cronógrafo y Fecha", "categoria": "CABALLERO", "tipo": ["Cronógrafo", "Hora mundial", "Fecha"], "caja": null, "correa": null, …}`.

- [ ] **Step 2: Render pages 1–73**

```bash
python3 scripts/catalog-tools.py render "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" relojes-polemik-superior --first 1 --last 73
ls public/catalogo-pages/relojes-polemik-superior | wc -l
```
Expected: `rendered pages 1-73 of 157 to public/catalogo-pages/relojes-polemik-superior` and `73`.

- [ ] **Step 3: Spot-check the parsed data against the rendered pages**

View the renders of pages 3, 19, 23, 29, 54, 59, 66 and 70 in `public/catalogo-pages/relojes-polemik-superior/` and compare each with its record in `$SCR/superior-new.json` (nombre, categoria, tags, caja/correa, referencia). Page 54's title is "Cronógrafo y Fecha Titan Negro Dorado y Bicolor Silicona Negro" (a long title; keep it whole as `nombre`). If any record disagrees with its page, fix the script's parsing (not the JSON by hand) and re-run Step 1.

- [ ] **Step 4: Install the JSON and create the 67 thumbnails**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
cp "$SCR/superior-new.json" src/data/relojes-polemik-superior.json
mkdir -p public/images/productos/relojes-polemik-superior
python3 scripts/catalog-tools.py photos "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" 3 56 "$SCR/sup-photos" --pick first
python3 scripts/catalog-tools.py photos "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" 59 67 "$SCR/sup-photos" --pick first
python3 scripts/catalog-tools.py photos "public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf" 70 73 "$SCR/sup-photos" --pick first
python3 - <<'EOF'
import importlib.util, json, re, shutil
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
scr = '.superpowers/sdd/2026-10-05-catalog-update-october/tmp/sup-photos'
for r in json.load(open('src/data/relojes-polemik-superior.json')):
    page = int(re.search(r'page-(\d+)\.jpg', r['img']).group(1))
    stem = ct.safe_name('relojes-polemik-superior', r['modelo'])
    shutil.copy(f'{scr}/page-{page:03d}.jpg', f'public/images/productos/relojes-polemik-superior/{stem}.jpg')
print('thumbnails written')
EOF
ls public/images/productos/relojes-polemik-superior | wc -l
```
Expected: the `photos` runs print one `page  WxH` line per page, `thumbnails written`, and `67`. Build one contact sheet of 12 thumbnails spread across the set (for example 2503D-BC, 9335, 1990N-B, 2401, 303D, 555, 888, 2657, 2342D, 1534, 1335D, 2465) and view it: each must be a watch photo (front view for the short-layout pages), not a logo or a blank.

- [ ] **Step 5: Create the site PDF (pages 1–73) with pypdf from a scratch venv**

`pdfseparate`+`pdfunite` duplicate shared resources and produce ~25 MB; `pypdf` produces ~7 MB.

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
python3 -m venv "$SCR/pdfvenv" && "$SCR/pdfvenv/bin/pip" install -q pypdf
"$SCR/pdfvenv/bin/python" - <<'EOF'
from pypdf import PdfReader, PdfWriter
reader = PdfReader('public/catalogos/POLEMIK RELOJES NUEVA COLECCION.pdf')
writer = PdfWriter()
for i in range(73):
    writer.add_page(reader.pages[i])
writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
writer.write('public/catalogos/relojes-polemik-superior.pdf')
EOF
/opt/homebrew/bin/pdfinfo public/catalogos/relojes-polemik-superior.pdf | grep Pages
ls -la public/catalogos/relojes-polemik-superior.pdf
/opt/homebrew/bin/pdftotext -f 73 -l 73 public/catalogos/relojes-polemik-superior.pdf - | head -3
```
Expected: `Pages: 73`, a file of roughly 7 MB (anything under 12 MB is fine), and the last page's text starts with `Digital Retro Plateado` / `UNISEX`.

- [ ] **Step 6: Integrity check**

```bash
python3 - <<'EOF'
import importlib.util, json, os
spec = importlib.util.spec_from_file_location('ct', 'scripts/catalog-tools.py')
ct = importlib.util.module_from_spec(spec); spec.loader.exec_module(ct)
data = json.load(open('src/data/relojes-polemik-superior.json'))
assert len(data) == 67 and len({x['modelo'] for x in data}) == 67
for x in data:
    assert os.path.exists('public' + x['img']), x['img']
    assert os.path.exists(f'public/images/productos/relojes-polemik-superior/{ct.safe_name("relojes-polemik-superior", x["modelo"])}.jpg'), x['modelo']
print('ok:', len(data), 'records; all page images and thumbnails exist')
EOF
git status --short | grep -v '^??'
```
Expected: `ok: 67 records; all page images and thumbnails exist`; the tracked-status listing is empty (everything new is untracked until the commit).

- [ ] **Step 7: Commit**

```bash
git add src/data/relojes-polemik-superior.json public/catalogos/relojes-polemik-superior.pdf
git add -A -- public/catalogo-pages/relojes-polemik-superior public/images/productos/relojes-polemik-superior
git commit -m "$(cat <<'EOF'
Add Polemik Superior catalog data and assets (67 models)

Caballero, Dama and Unisex sections of the new Polemik PDF: product
data, page renders, thumbnails and the extracted site PDF.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Polemik Superior — viewer block and catalog registration

**Files:**
- Modify: `src/data/catalogs.js` (one new catalog entry)
- Modify: `src/pages/catalogo/[slug].astro` (import, flag, `products` selector, new markup block, `define:vars` list, script init condition)
- Modify: `src/components/CatalogCard.astro` (additive: optional `subtitulo` / `chips` props, `UNISEX` entries in the badge/label maps)

**Interfaces:**
- Consumes (from Task 6): `src/data/relojes-polemik-superior.json` — objects `{modelo, nombre, categoria: 'CABALLERO'|'DAMA'|'UNISEX', tipo: string[], caja: {material,color}|null, correa: {material,color}|null, img}`; thumbnails at `/images/productos/relojes-polemik-superior/<stem>.jpg` with `<stem>` = modelo with `/`→`_`, space→`-`, `#`→`num`, then any of `<>:"|?*\()[]` →`_`, cut to 80 chars (same sanitizer as the `isBatRecargables` block); site PDF `/catalogos/relojes-polemik-superior.pdf` (the page already links `/catalogos/${slug}.pdf`).
- Produces: the catalog page `/catalogo/relojes-polemik-superior/`.

Invoke the `frontend-design` skill first (project rule). The design intent is "match the existing structured-catalog pattern exactly"; do not invent new visual language.

- [ ] **Step 1: Register the catalog**

In `src/data/catalogs.js`, in the `relojes` group, add a second entry after `relojes-polemik`:

```js
      { slug: 'relojes-polemik', label: 'Reloj Polemik', structured: true },
      { slug: 'relojes-polemik-superior', label: 'Reloj Polemik Superior', structured: true },
      { slug: 'relojes-xinjia', label: 'Relojes Xinjia', structured: true },
```

- [ ] **Step 2: Wire the data and flag in `src/pages/catalogo/[slug].astro`**

1. Add the import after the existing `quimicosData` import (line ~37): `import polemikSuperiorData from '../../data/relojes-polemik-superior.json';`
2. Add the flag after `const isQuimicos …` (line ~89): `const isPolemikSuperior = isStructured && slug === 'relojes-polemik-superior';`
3. In the `const products = …` ternary chain (line ~98), add `isPolemikSuperior ? polemikSuperiorData :` immediately before `isPolemik ? polemikData :`.
4. Add `isPolemikSuperior` to the `define:vars={{ … }}` list of the main `<script>` (the one that starts with `<script define:vars={{ slug, isGallery, isStructured, …`, line ~3459).
5. Add `|| isPolemikSuperior` to the structured-mode init condition `if (isETA || isRonda || … || isBatGp) {` (line ~3645, the line after the comment "ETA / RONDA / EPSON / SII / CORONAS STRUCTURED MODE").

- [ ] **Step 3: Add the viewer block**

Read the whole `{isBatRecargables && (` block (it starts around line 1943 and ends with its modal, about 80 lines) and add a new sibling block `{isPolemikSuperior && ( … )}` right after it, copied from it with only these differences:
- Search input placeholder: `Buscar por referencia o nombre...`.
- Tipo bar (keep `id="etaTipoBar"` and the `eta-tipo-pill` classes): `Todos` (`data-tipo=""`, active), `Caballero` (`data-tipo="CABALLERO"`), `Dama` (`data-tipo="DAMA"`), `Unisex` (`data-tipo="UNISEX"`). Result label text `MODELOS` (like the gorras block).
- Grid class: `eta-grid` (the default 3-column style, like the gorras block), not `eta-grid--4col`.
- Per product card wrapper: `data-tipo={p.categoria}` and `data-modelo={[p.modelo, p.nombre, ...(p.tipo ?? []), p.caja?.material, p.caja?.color, p.correa?.material, p.correa?.color].filter(Boolean).join(' ').toLowerCase()}` (so search also matches tags and colours).
- `CatalogCard` props: `imagenSrc={`/images/productos/relojes-polemik-superior/${safe}.jpg`}` with `safe` computed exactly like the recargables block; `imagenCatalogoSrc={p.img as string}`; `titulo={p.modelo as string}`; `fullTitle={true}`; `detalles={{}}`; `tipo={p.categoria}`; `subtitulo={p.nombre}`; `chips={p.tipo}`.
- Keep the empty state and the modal markup identical (same ids: `etaViewer`, `etaSearch`, `etaGrid`, `etaCount`, `etaEmpty`, `etaReset`, `etaModal`, `etaModalImg`, `etaModalTitle`, `etaModalPrev`, `etaModalNext`, `etaModalClose`) because the shared script drives them by id.

- [ ] **Step 4: Extend `CatalogCard.astro` additively**

Read the whole component first. Then:
- Add optional props `subtitulo?: string` and `chips?: string[]` to `Props` and to the destructuring.
- Add `'UNISEX'` to the maps that already hold `'CABALLERO'`/`'DAMA'` for the eyebrow badge: in `BADGE_CLASS` reuse an existing badge class that is visually distinct from the Caballero/Dama ones (for example `'badge-digital'`), and in `TIPO_LABEL` add `'UNISEX': 'Unisex'`.
- Render `subtitulo` as one muted secondary line under the title with class `cc-sub`, and `chips` as a compact row of small muted chips under it (a container with class `cc-chips` whose children have class `cc-chip`; cap at 3 chips and hide overflow so card heights stay uniform), only when the props are provided. Follow the component's existing CSS conventions for the styles. These exact class names are used by the Task 8 check. With the new props absent, the markup and CSS for every other catalog must render exactly as before.

- [ ] **Step 5: Verify the build and the page**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
npx astro build --outDir "$SCR/dist" 2>&1 | tail -15
ls "$SCR/dist/catalogo/relojes-polemik-superior/index.html"
grep -o 'eta-card-wrapper' "$SCR/dist/catalogo/relojes-polemik-superior/index.html" | wc -l
grep -c 'Reloj Polemik Superior' "$SCR/dist/catalogo/index.html"
```
Expected: the build finishes without errors, the Superior `index.html` exists, the wrapper count is 67 (the string also appears once inside the script/CSS, so accept 67–70 but confirm 67 cards by counting `data-tipo="CABALLERO"` = 54, `"DAMA"` = 9, `"UNISEX"` = 4 in that file), and the catalog index mentions `Reloj Polemik Superior`.

Then confirm the `CatalogCard.astro` edit is purely additive: `git diff -- src/components/CatalogCard.astro` must show no removed lines other than the lines of the two maps you extended (`BADGE_CLASS`, `TIPO_LABEL`) and the `Props`/destructuring lines you extended, and every added template line must sit inside a conditional on `subtitulo` or `chips`. Report the output of `git diff --stat -- src/components/CatalogCard.astro`. (Task 8 additionally asserts that the other catalogs render no `.cc-sub` / `.cc-chips` elements.)

- [ ] **Step 6: Commit**

```bash
git add src/data/catalogs.js "src/pages/catalogo/[slug].astro" src/components/CatalogCard.astro
git commit -m "$(cat <<'EOF'
Add Reloj Polemik Superior catalog page

New viewer block (search, Caballero/Dama/Unisex pills, grid, page modal)
reusing the structured-catalog pattern; card gains optional subtitle and
chips props, no change for existing catalogs.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: End-to-end verification in a browser

**Files:**
- Create (scratch only, git-ignored, never committed): `$SCR/verify.mjs`
- Modify: nothing in the repository unless a defect is found (then fix it in the file that owns it, re-run, and commit the fix separately with explicit paths).

**Interfaces:**
- Consumes: everything from Tasks 1–7.

- [ ] **Step 1: Build once into scratch and serve it**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp; mkdir -p "$SCR"
npx astro build --outDir "$SCR/dist" 2>&1 | tail -5
(cd "$SCR/dist" && python3 -m http.server 4399 >/dev/null 2>&1 &)
sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4399/catalogo/relojes-polemik-superior/
```
Expected: `200`.

- [ ] **Step 2: Write and run the check script**

```bash
SCR=.superpowers/sdd/2026-10-05-catalog-update-october/tmp
cat > "$SCR/verify.mjs" <<'EOF'
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4399';
const J = (f) => JSON.parse(readFileSync(`src/data/${f}.json`, 'utf-8'));
const gorras = J('gorras-polemik');

const checks = [
  { slug: 'quimicos-joyeria', total: J('quimicos-joyeria').length },
  { slug: 'baterias-recargables', total: J('baterias-recargables').length, pill: { tipo: 'Estación', count: 8 } },
  { slug: 'pulso-silicona', total: J('pulsos-silicona').length },
  { slug: 'gorras-polemik', total: gorras.length, pill: { tipo: 'PLANA', count: gorras.filter((x) => x.estilo === 'PLANA').length } },
  { slug: 'relojes-polemik-superior', total: J('relojes-polemik-superior').length, pill: { tipo: 'CABALLERO', count: 54 }, search: { q: '303d', min: 1 } },
];

const browser = await chromium.launch();
let failed = 0;
const fail = (slug, msg) => { failed++; console.log(`FAIL ${slug}: ${msg}`); };

for (const c of checks) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/catalogo/${c.slug}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#etaGrid');

  const label = (await page.textContent('#etaCount')).trim();
  const cards = await page.locator('.eta-card-wrapper').count();
  if (Number(label) !== c.total) fail(c.slug, `count label ${label} != ${c.total}`);
  if (cards !== c.total) fail(c.slug, `cards ${cards} != ${c.total}`);

  if (c.pill) {
    await page.click(`.eta-tipo-pill[data-tipo="${c.pill.tipo}"]`);
    const visible = await page.locator('.eta-card-wrapper:not([hidden])').count();
    if (visible !== c.pill.count) fail(c.slug, `pill ${c.pill.tipo}: visible ${visible} != ${c.pill.count}`);
    await page.click('.eta-tipo-pill[data-tipo=""]');
  }
  if (c.search) {
    await page.fill('#etaSearch', c.search.q);
    await page.waitForTimeout(300);
    const visible = await page.locator('.eta-card-wrapper:not([hidden])').count();
    if (visible < c.search.min) fail(c.slug, `search "${c.search.q}" matched ${visible}`);
    await page.fill('#etaSearch', '');
    await page.waitForTimeout(300);
  }

  await page.locator('.eta-card-wrapper:not([hidden]) [data-catalogo-src]').first().click();
  await page.waitForSelector('#etaModal.open', { timeout: 3000 }).catch(() => fail(c.slug, 'modal did not open'));
  const src = await page.getAttribute('#etaModalImg', 'src');
  if (!/page-\d+\.jpg/.test(src ?? '')) fail(c.slug, `modal image src ${src}`);
  await page.screenshot({ path: `.superpowers/sdd/2026-10-05-catalog-update-october/tmp/shot-${c.slug}.png` });

  const extras = await page.locator('.cc-sub, .cc-chips').count();
  if (c.slug === 'relojes-polemik-superior' ? extras === 0 : extras !== 0) fail(c.slug, `.cc-sub/.cc-chips count ${extras}`);

  const pdfHref = await page.getAttribute('a.btn-dl', 'href');
  const res = await page.request.get(`${BASE}${pdfHref}`);
  if (res.status() !== 200) fail(c.slug, `PDF ${pdfHref} -> ${res.status()}`);
  if (errors.length) fail(c.slug, `page errors: ${errors.join(' | ')}`);
  console.log(`checked ${c.slug}: total ${c.total}, pdf ${pdfHref}`);
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} FAILURE(S)` : 'ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
EOF
node "$SCR/verify.mjs"
```
Expected: five `checked …` lines and `ALL CHECKS PASSED`. If a selector in the script is wrong for a catalog (for example a different class on the PDF button or the modal), fix the script, not the site, unless the page really is broken.

- [ ] **Step 3: Look at the screenshots**

View `$SCR/shot-relojes-polemik-superior.png` (card layout, badge, subtitle, chips, modal showing a PDF page) and `$SCR/shot-baterias-recargables.png`. Also open the Superior page once with the Dama and Unisex pills and the search box and take one more screenshot if anything looks off (cards of uneven height, overflowing chips, missing images).

- [ ] **Step 4: Confirm repository hygiene and stop the server**

```bash
pkill -f "http.server 4399" || true
git status --short | grep -v '^??'
git status --short | grep '^??'
git log --oneline -8
```
Expected: the first status listing is empty (everything is committed), the untracked listing shows only the five upload PDFs under `public/catalogos/` (and git-ignored scratch is not listed), and the log shows the seven task commits.

- [ ] **Step 5: Commit any fix made during this task** (skip if nothing changed)

```bash
git add <the explicit files you changed>
git commit -m "Fix issues found in end-to-end catalog verification" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
