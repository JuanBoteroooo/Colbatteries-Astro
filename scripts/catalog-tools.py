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
  safe SLUG MODELO
      Print the thumbnail filename stem the SLUG's viewer block computes for MODELO.

Requires Pillow and the Poppler tools in /opt/homebrew/bin.
"""
import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile

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
    s = sub.add_parser('safe')
    s.add_argument('slug')
    s.add_argument('modelo')
    s.set_defaults(fn=cmd_safe)
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    sys.exit(main())
