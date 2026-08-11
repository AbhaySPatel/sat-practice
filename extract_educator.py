"""Build banks/educator-question-bank.json -- the questions the first pass left behind.

The full export (book/questionbank-export-2026-8-10.pdf) holds 1,838 Reading and
Writing questions. It is not new material: the six earlier per-domain PDFs hold
exactly the same 1,838 ids. But only 1,667 of them reached the app, because
extract_bank.py rejected 171:

    155  depend on a table or chart
     14  stem phrased in a way its anchor list did not recognise
      2  a species name wrapping mid-line was misread as an option label

This recovers all 171. Most of the value is in one skill: 136 of them are Command
of Evidence, which the 9 Aug practice test showed to be his worst-collapsing area
-- so the app was thinnest exactly where he needs the most work.

Deliberately a separate script rather than a change to extract_bank.py. Re-running
that would rewrite banks/cb-*.json, and since the app's saved cursor is an index
into bank order, adding questions in the middle of those files would move the
place Abhay had been holding. This writes one new file and appends it, which
cannot disturb anything already there.

Questions needing a figure keep `figure`/`pdf`/`page`, so the app shows the same
"you need the figure" notice built for the missed-in-test set and says which page
to open.

Run:  python3 extract_educator.py
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import extract_bank as E
# Reused so Words in Context questions here get the same "Show meanings" peek as
# everywhere else, rather than being the only ones without it.
from extract_missed import gloss_options, load_manual, load_word_index

EXPORT = Path('book/questionbank-export-2026-8-10.pdf')
BANKS = Path('banks')
OUT = BANKS / 'educator-question-bank.json'

SKILL = 'educator-bank'
DOMAIN = 'extra'

# Everything extract_bank anchors on, plus the phrasings that made it reject 14
# questions. Kept here rather than pushed back into extract_bank so the existing
# banks stay byte-for-byte as they are.
re_stem_start = re.compile(
    r'\b(Which |Based on the text|Based on the two texts|According to the text'
    r'|According to the table|According to the graph|According to the chart'
    r'|As used in the text|What does |What can |What is |What feature |What choice '
    r'|How does |How would |How can |The student wants |The text makes '
    r'|Information in the text|It can most reasonably be inferred'
    r'|In the text|Taken together)'
)


def split_stem(chunk):
    """Separate passage from stem, anchoring on the phrase the stem opens with.

    Same approach as extract_bank.split_stem -- the last '?' ends the stem, and
    the anchor finds where it starts -- but with the wider anchor list above, and
    a fallback for the stem that begins mid-sentence ("Assuming that participants
    had comparable baseline fitness levels, which finding...?"), where the only
    anchor word is a lowercase "which" that would match all over the passage.
    """
    text = E.collapse(chunk)
    end = text.rfind('?')
    if end == -1:
        return None, None
    head = text[:end + 1]

    matches = list(re_stem_start.finditer(head))
    if matches:
        at = matches[-1].start()
        return head[:at].strip(), head[at:].strip()

    # Fallback: the last sentence before the question mark. Only safe because the
    # blank has already been ruled out -- a cloze passage often ends on the blank
    # with no full stop, and splitting there would drag the blank into the stem.
    if '___' in head:
        return None, None
    bounds = list(re.finditer(r'(?<=[.!?])\s+', head))
    if not bounds:
        return None, None
    at = bounds[-1].end()
    passage, stem = head[:at].strip(), head[at:].strip()
    # A stem is a question, not a paragraph; and something has to be left to read.
    if not passage or not (20 < len(stem) < 300):
        return None, None
    return passage, stem


re_option = re.compile(r'^([A-D])\.\s*(.*)$')


def parse_options(chunk):
    """Read the A-D choices.

    Only the *next* expected label starts a new option. Without that rule a
    wrapped line beginning "C. helleri had higher average baseline heart rates"
    -- the species name Crotalus helleri, split across lines -- reads as a second
    choice C, and the question is thrown away for having five options.

    Separately: one question in the export (e3bbf2bf) is missing its "D." label
    altogether -- the fourth choice's text is there, on its own line, unlabelled.
    That is a defect in College Board's file. A line is taken as the next choice
    when it opens with a capital and the choice before it already ended on a full
    stop, which is what tells a fresh choice apart from a wrapped line.
    """
    options = []
    expected = 'A'
    for line in chunk.split('\n'):
        line = line.strip()
        if not line:
            continue
        m = re_option.match(line)
        if m and m.group(1) == expected:
            options.append({'label': m.group(1), 'text': m.group(2).strip()})
            expected = chr(ord(expected) + 1)
            continue
        unlabelled_choice = (
            options and len(options) < 4
            and options[-1]['text'].endswith(('.', '?', '!'))
            and line[:1].isupper()
        )
        if unlabelled_choice:
            options.append({'label': expected, 'text': line})
            expected = chr(ord(expected) + 1)
            continue
        if options:
            options[-1]['text'] = f"{options[-1]['text']} {line}".strip()
    return options


def covered_ids():
    """College Board question ids already in the app's banks."""
    have = set()
    for path in BANKS.glob('cb-*.json'):
        for q in json.loads(path.read_text(encoding='utf-8')):
            m = re.match(r'cb-[a-z-]+-([0-9a-f]+)$', q.get('id', ''))
            if m:
                have.add(m.group(1))
    return have


# Whether a question needs a figure is decided by measurement, not by wording.
# extract_bank's word list includes "shown", which fires on "researchers have
# shown" and would put a "you need the figure" notice on 21 questions that are
# pure prose. Counting the vector paths on the page settles it: across 331 sampled
# pages holding a question known to be plain text, the count ran 39 to 45 and
# never once passed 50 -- that is the page border and rules. A page carrying a
# real chart measures 77 at the median and up to 253.
FIGURE_INK = 50

# Still consulted, because a table drawn with no rules would be invisible to the
# ink test while the question plainly depends on it.
FIGURE_WORD = re.compile(r'\b(table|graph|chart|figure|bar graph)\b', re.I)


def read_export():
    """(full text, {question id: (page, vector paths on that page)})."""
    import fitz
    doc = fitz.open(EXPORT)
    pages, where = [], {}
    for pno in range(doc.page_count):
        text = doc[pno].get_text('text', flags=E.TEXT_FLAGS)
        pages.append(text)
        ids = re.findall(r'Question ID:\s*([0-9a-f]+)', text)
        if not ids:
            continue
        ink = len(doc[pno].get_drawings())
        for qid in ids:
            where.setdefault(qid, (pno + 1, ink))
    return '\n'.join(pages), where


def build():
    if not EXPORT.exists():
        sys.exit(f'{EXPORT} not found -- run from the repo root.')

    full, where = read_export()
    have = covered_ids()
    manual = load_manual()
    word_index = load_word_index()

    starts = [m.start() for m in E.re_block.finditer(full)]
    rows, skipped = [], Counter()
    seen = set()

    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(full)
        block = full[start:end]
        qid = E.re_block.match(block).group(1)
        seen.add(qid)
        if qid in have:
            continue

        m_head = E.re_header.search(block)
        m_correct = E.re_correct.search(block)
        if not (m_head and m_correct):
            skipped['header or answer key not found'] += 1
            continue

        domain, skill_name = E.split_header(m_head.group(1))
        skill = E.slugify_skill(skill_name or '')
        if not skill:
            skipped[f'unrecognised skill {skill_name!r}'] += 1
            continue

        answer_at = block.find('\nAnswer\n', m_head.end())
        if answer_at == -1:
            skipped['no answer block'] += 1
            continue

        passage, stem = split_stem(block[m_head.end():answer_at])
        if not stem:
            skipped['no question stem'] += 1
            continue

        passage = re.sub(r'_{2,}', '___', passage)
        blanks = passage.count('___')
        if blanks > 1:
            skipped['more than one blank'] += 1
            continue

        opts = parse_options(block[answer_at + len('\nAnswer\n'):m_correct.start()])
        if [o['label'] for o in opts] != ['A', 'B', 'C', 'D']:
            skipped['choices were not A-D'] += 1
            continue

        correct = m_correct.group(1)
        rationale_at = block.find('\nRationale\n', m_correct.end())
        if rationale_at == -1:
            skipped['no rationale'] += 1
            continue

        rationale = block[rationale_at + len('\nRationale\n'):]
        chunks = E.split_rationale(rationale, correct)
        if len(chunks) < 4:
            skipped['rationale did not cover all four choices'] += 1
            continue

        # Not a reason to reject any more -- just something he has to be told.
        page, ink = where.get(qid, (None, 0))
        needs_figure = ink > FIGURE_INK or bool(
            FIGURE_WORD.search(passage) or FIGURE_WORD.search(stem))

        row = {
            'id': f'edu-{skill}-{qid}',
            'source': 'College Board SAT Suite question bank (educator export)',
            'skill': SKILL,
            'domain': DOMAIN,
            # What it would be filed as in the ordinary banks. Shown on screen and
            # used for the per-skill tallies.
            'realSkill': skill,
            'realDomain': domain,
            'difficulty': m_head.group(2).lower(),
            'hasBlank': blanks == 1,
            'passage': passage,
            'question': stem,
            'rule': E.derive_rule(E.collapse(rationale), chunks[correct]),
            'correctLabel': correct,
            'options': [
                {'label': o['label'], 'text': o['text'], 'why': chunks[o['label']]}
                for o in opts
            ],
        }
        if skill == 'words-in-context':
            gloss_options(row['options'], chunks, manual, word_index)

        if needs_figure:
            row['figure'] = True
            row['pdf'] = EXPORT.name
            row['page'] = page
        rows.append(row)

    missing = seen - have
    return rows, skipped, missing


def main():
    try:
        import fitz  # noqa: F401
    except ImportError:
        sys.exit('PyMuPDF is needed: pip install pymupdf')

    rows, skipped, missing = build()

    print(f'{len(missing)} questions in the export are not in the app\'s banks')
    print(f'{len(rows)} of them recovered\n')

    OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + '\n',
                   encoding='utf-8')
    print(f'written to {OUT}')

    by_skill = Counter(r['realSkill'] for r in rows)
    for skill, n in by_skill.most_common():
        figs = sum(1 for r in rows if r['realSkill'] == skill and r.get('figure'))
        print(f'  {n:4}  {skill:24} {figs} need the figure')

    print(f'\n  need a figure : {sum(1 for r in rows if r.get("figure"))}')
    print(f'  self-contained: {sum(1 for r in rows if not r.get("figure"))}')
    print(f'  with a blank  : {sum(1 for r in rows if r["hasBlank"])}')

    if skipped:
        print('\n  still not recovered:')
        for reason, n in skipped.most_common():
            print(f'    {n:4}  {reason}')


if __name__ == '__main__':
    main()
