#!/usr/bin/env python3
"""Regenerate sitemap.xml for fourcornersgames.ca.

Run from the repo root after adding, removing or changing pages:

    python3 tools/sitemap.py

Lists every public page: all .html files except /dev/, the 404 page and any
page marked noindex (the old-URL redirect stubs). Each entry carries its
English/French twin from the page's own <link rel="alternate" hreflang> tags,
so Google shows each visitor the right language. lastmod is the date of the
file's last commit, or today if it has uncommitted changes.
"""
import datetime
import pathlib
import re
import subprocess

SITE = "https://fourcornersgames.ca"
ROOT = pathlib.Path(__file__).resolve().parent.parent


def url_for(rel: str) -> str:
    if rel == "index.html":
        return SITE + "/"
    if rel.endswith("/index.html"):
        return SITE + "/" + rel[: -len("index.html")]
    return SITE + "/" + rel


def lastmod(rel: str) -> str:
    dirty = subprocess.run(["git", "status", "--porcelain", "--", rel], cwd=ROOT,
                           capture_output=True, text=True).stdout.strip()
    if not dirty:
        date = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel], cwd=ROOT,
                              capture_output=True, text=True).stdout.strip()
        if date:
            return date
    return datetime.date.today().isoformat()


def main() -> None:
    entries = []
    for path in sorted(ROOT.rglob("*.html")):
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith(("dev/", ".git/", "node_modules/")) or rel == "404.html":
            continue
        html = path.read_text(encoding="utf-8")
        if re.search(r'<meta name="robots" content="[^"]*noindex', html):
            continue
        alts = re.findall(r'<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)">', html)
        entries.append((url_for(rel), lastmod(rel), alts))

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
           ' xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for loc, mod, alts in entries:
        out.append("\t<url>")
        out.append(f"\t\t<loc>{loc}</loc>")
        out.append(f"\t\t<lastmod>{mod}</lastmod>")
        for lang, href in alts:
            out.append(f'\t\t<xhtml:link rel="alternate" hreflang="{lang}" href="{href}"/>')
        out.append("\t</url>")
    out.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"sitemap.xml: {len(entries)} pages")


if __name__ == "__main__":
    main()
