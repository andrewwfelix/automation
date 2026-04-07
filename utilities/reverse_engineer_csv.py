#!/usr/bin/env python3
"""
reverse_engineer_csv.py
Parses index.html book cards and writes a clean next_movies.csv
ready for the generate-page.js pipeline.

Usage:
    python3 reverse_engineer_csv.py
    python3 reverse_engineer_csv.py --input path/to/index.html --output next_movies_clean.csv

Columns produced:
    title, author, image, affiliate_link, video_affiliate_link,
    trailer_url, youtube_search, slug, genre, book_year, director,
    film_year, verdict, process_date, process_model, status
"""

import re
import csv
import sys
import argparse
import html
from pathlib import Path

# ------------------------------------------------------------------ #
# CONFIG
# ------------------------------------------------------------------ #
INPUT_FILE  = 'index.html'
OUTPUT_FILE = 'next_movies_clean.csv'

FIELDNAMES = [
    'title', 'author', 'image', 'affiliate_link', 'video_affiliate_link',
    'trailer_url', 'youtube_search', 'slug', 'genre',
    'book_year', 'director', 'film_year', 'verdict',
    'process_date', 'process_model', 'status'
]

VERDICTS = {'Book Wins', 'Movie Wins', 'Too Close to Call', 'Verdict TBD'}

SKIP_SLUGS = {
    'heated-rivalry',  # spotlight — already built
}

# ------------------------------------------------------------------ #
# HELPERS
# ------------------------------------------------------------------ #
def clean(text):
    return html.unescape(text).strip()

def slug_from_href(href):
    return href.replace('.html', '').strip('/')

def image_from_src(src):
    return src.split('/')[-1]

def parse_footer(footer_text):
    """
    Footer examples:
      "Film: 2014 · Book Wins"
      "In theaters March 20, 2026 · Book Wins"
      "Netflix: 2022 · Too Close to Call"
    Returns (film_year, verdict)
    """
    text = clean(footer_text)
    parts = re.split(r'\s*[·•]\s*', text)

    verdict   = ''
    film_year = ''

    if len(parts) >= 2:
        verdict_part = parts[-1].strip()
        date_part    = parts[0].strip()

        for v in VERDICTS:
            if v.lower() in verdict_part.lower():
                verdict = v
                break
        if not verdict:
            verdict = verdict_part

        year_match = re.search(r'\b(19|20)\d{2}\b', date_part)
        if year_match:
            film_year = year_match.group(0)

    return film_year, verdict

def parse_author_line(byline):
    """
    "Author Name — director/cast info"
    Returns (author, director)
    """
    byline = clean(byline)
    parts  = re.split(r'\s*(?:—|–)\s*', byline, maxsplit=1)
    author   = parts[0].strip() if parts else ''
    director = parts[1].strip() if len(parts) > 1 else ''
    return author, director

# ------------------------------------------------------------------ #
# PARSER
# ------------------------------------------------------------------ #
def parse_index(html_content):
    card_pattern   = re.compile(r'<a\s+class="book-card"\s+href="([^"]+)">(.*?)</a>', re.DOTALL)
    img_pattern    = re.compile(r'<img[^>]+src="([^"]+)"', re.DOTALL)
    genre_pattern  = re.compile(r'class="card-genre"[^>]*>(.*?)</span>', re.DOTALL)
    title_pattern  = re.compile(r'<h3>(.*?)</h3>', re.DOTALL)
    author_pattern = re.compile(r'class="card-author"[^>]*>(.*?)</p>', re.DOTALL)
    footer_pattern = re.compile(r'class="book-card-footer"[^>]*>(.*?)</div>', re.DOTALL)

    entries = []

    for match in card_pattern.finditer(html_content):
        href    = match.group(1)
        innards = match.group(2)
        slug    = slug_from_href(href)

        if slug in SKIP_SLUGS:
            continue

        img_m    = img_pattern.search(innards)
        genre_m  = genre_pattern.search(innards)
        title_m  = title_pattern.search(innards)
        author_m = author_pattern.search(innards)
        footer_m = footer_pattern.search(innards)

        image  = image_from_src(img_m.group(1))  if img_m    else ''
        genre  = clean(genre_m.group(1))          if genre_m  else ''
        title  = clean(title_m.group(1))          if title_m  else ''
        byline = clean(author_m.group(1))         if author_m else ''
        footer = clean(footer_m.group(1))         if footer_m else ''

        author, director       = parse_author_line(byline)
        film_year, verdict     = parse_footer(footer)
        youtube_search         = f"{title} official trailer {film_year}".strip()

        entries.append({
            'title':                title,
            'author':               author,
            'image':                image,
            'affiliate_link':       '',
            'video_affiliate_link': '',
            'trailer_url':          '',
            'youtube_search':       youtube_search,
            'slug':                 slug,
            'genre':                genre,
            'book_year':            '',
            'director':             director,
            'film_year':            film_year,
            'verdict':              verdict,
            'process_date':         '',
            'process_model':        '',
            'status':               '',
        })

    return entries

def dedup(entries):
    seen = set()
    out  = []
    for e in entries:
        if e['slug'] not in seen:
            seen.add(e['slug'])
            out.append(e)
    return out

def write_csv(entries, output_path):
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(entries)

def report(entries):
    verdicts      = {}
    missing_year  = 0
    missing_image = 0
    for e in entries:
        v = e['verdict'] or 'Unknown'
        verdicts[v] = verdicts.get(v, 0) + 1
        if not e['film_year']:  missing_year  += 1
        if not e['image']:      missing_image += 1

    print(f"\n{'─'*52}")
    print(f"  Total entries extracted : {len(entries)}")
    print(f"{'─'*52}")
    for v, count in sorted(verdicts.items()):
        print(f"  {v:<28} {count}")
    print(f"{'─'*52}")
    print(f"  Missing film year       : {missing_year}")
    print(f"  Missing image           : {missing_image}")
    print(f"\n  Columns to fill manually in Excel:")
    print(f"    affiliate_link       Amazon book link per row")
    print(f"    trailer_url          YouTube URL per row")
    print(f"    book_year            Publication year per row")
    print(f"    video_affiliate_link Only for titles with no trailer")
    print(f"{'─'*52}\n")

def main():
    parser = argparse.ArgumentParser(description='Reverse-engineer CSV from index.html')
    parser.add_argument('--input',  default=INPUT_FILE,  help='Path to index.html')
    parser.add_argument('--output', default=OUTPUT_FILE, help='Output CSV path')
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    print(f"Reading  : {input_path}")
    content = input_path.read_text(encoding='utf-8')

    print(f"Parsing book cards...")
    entries = parse_index(content)

    print(f"Deduplicating...")
    entries = dedup(entries)

    print(f"Writing  : {output_path}")
    write_csv(entries, output_path)

    report(entries)
    print(f"Done: {output_path}")
    print(f"Open in Excel, fill affiliate_link / trailer_url / book_year,")
    print(f"then point movies.cfg SPREADSHEET_PATH at this file.\n")

if __name__ == '__main__':
    main()
