"""Find questions the extraction broke, and say where to read them properly.

Some College Board questions ask about an "underlined portion". The underline is
drawn into the Type3 glyph paths in the source PDFs -- PyMuPDF reports no style
flags, and there are no separate underline strokes -- so the extraction could
never have captured it. The questions came through as plain text and are
unanswerable: nothing on screen says which words were underlined.

Rather than throw them away, this records where each one lives in the PDF, so the
app can list them and he can read them with the PDF open beside him.

Writes banks/defective.json. Run:  python3 find_defective.py
"""

import json
import re
import sys
from pathlib import Path
from collections import Counter

BANKS = sorted(Path('banks').glob('cb-*.json'))
OUT = Path('banks/defective.json')

# The exported PDFs, by the skills they contain. Only the ones holding affected
# questions are opened -- the others would just be a slow no-op.
PDFS = [
    Path('book/craft - structure.pdf'),
    Path('book/information - idea.pdf'),
    Path('book/Boundaries.pdf'),
    Path('book/FSS.pdf'),
    Path('book/Rhetorical Synthesis.pdf'),
    Path('book/Transitions.pdf'),
]

# How much of the passage to match on. Long enough to be unique, short enough to
# survive a line break or a curly quote turning straight.
PROBE = 70


def normalise(s):
    """Letters and digits only, lowercased -- so quote style, hyphenation and
    line wrapping cannot break the match."""
    return re.sub(r'[^a-z0-9]+', '', (s or '').lower())


def load_questions():
    out = []
    for path in BANKS:
        data = json.loads(path.read_text(encoding='utf-8'))
        items = data if isinstance(data, list) else data.get('questions', data)
        if isinstance(items, list):
            out += items
    return out


def is_defective(q):
    """Asks about something underlined, but nothing in the passage is marked."""
    asks = 'underlin' in (q.get('question') or '').lower()
    if not asks:
        return None
    passage = q.get('passage') or ''
    marked = '<u>' in passage or '̲' in passage
    return None if marked else 'asks about an underlined portion, but the '\
                               'underline was lost when the PDF was extracted'


def build_page_index():
    """page text, normalised, for every page of every PDF we have."""
    try:
        import fitz
    except ImportError:
        sys.exit('PyMuPDF is needed to locate pages: pip install pymupdf')

    index = []
    for path in PDFS:
        if not path.exists():
            print(f'  (skipped, not present: {path})')
            continue
        doc = fitz.open(path)
        for pno in range(doc.page_count):
            index.append((path.name, pno + 1, normalise(doc[pno].get_text())))
        print(f'  indexed {doc.page_count:4} pages  {path.name}')
    return index


def locate(passage, index):
    """Which PDF page holds this passage. Tries a few probes from different
    points in the text, because the first sentence is sometimes a shared
    preamble ("The following text is adapted from...")."""
    norm = normalise(passage)
    if len(norm) < 30:
        return None

    starts = [len(norm) // 3, 0, len(norm) // 2]
    for start in starts:
        probe = norm[start:start + PROBE]
        if len(probe) < 30:
            continue
        for name, page, text in index:
            if probe in text:
                return {'pdf': name, 'page': page}
    return None


def main():
    questions = load_questions()
    affected = [(q, r) for q in questions for r in [is_defective(q)] if r]
    print(f'{len(affected)} defective of {len(questions)} questions\n')

    index = build_page_index()
    if not index:
        sys.exit('No PDFs found under book/ -- nothing to locate against.')

    rows = {}
    found = 0
    for q, reason in affected:
        where = locate(q.get('passage'), index)
        if where:
            found += 1
        rows[q['id']] = {
            'skill': q.get('skill'),
            'difficulty': q.get('difficulty'),
            'question': q.get('question'),
            'reason': reason,
            **(where or {'pdf': None, 'page': None})
        }

    OUT.write_text(json.dumps({
        'note': 'Questions that cannot be answered as extracted. The app groups '
                'these separately and shows the PDF and page so they can be read '
                'from the source instead.',
        'questions': rows
    }, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(f'\n{len(rows)} written to {OUT}')
    print(f'  page located : {found}')
    print(f'  not found    : {len(rows) - found}')
    by_pdf = Counter(r['pdf'] for r in rows.values())
    for name, n in by_pdf.most_common():
        print(f'    {n:3}  {name}')


if __name__ == '__main__':
    main()
