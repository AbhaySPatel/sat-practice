#!/usr/bin/env python3
"""Crop the maths questions Abhay missed on the paper practice tests.

Why images and not text: PyMuPDF pulls the words off these pages happily, but it
loses the layout that carries the maths.  Test 9, Module 1, Question 25 comes out
as four options reading `S w = 170`, `S w = 170`, `S w = 340`, `S w = 85` -- A and
B are indistinguishable, because one is a fraction and the other a product and the
text has no way to say which.  Add the figures (roughly 24 per test) and there is
no honest text form of these questions.  So each one is cut out of the page as an
image at 200 dpi, which keeps the notation and the diagrams exactly as he saw them.

The options travel inside the picture, so the app cannot offer them as text to
click.  It shows bare A/B/C/D buttons under the image instead, and an entry box
for the grid-ins -- which is what the paper test gives him too.

Answers come from the official key in the scoring PDF, never from the recorded
guess, so a mistake in the notes below cannot invent a wrong answer.

Run:  python3 extract_missed_math.py
"""

from pathlib import Path
import json
import re

import glob

import fitz  # PyMuPDF
from PIL import Image

OUT_JSON = Path('banks/missed-math.json')
OUT_DIR = Path('media/missed-math')
DPI = 200

# Recovered from the scoring runs and cross-checked: each test's maths misses are
# attributed by matching the Reading and Writing wrong-list recorded alongside
# them against the lists already in extract_missed.py, which are independent.
# `chose` is what he put; it is only ever used for the "you picked X" note.
TESTS = [
    {
        'key': 'pt6', 'label': 'Practice Test 6', 'order': 3, 'taken': '2026-08-11',
        'missed': {1: {19: None}, 2: {26: None}},
    },
    {
        'key': 'pt7', 'label': 'Practice Test 7', 'order': 4, 'taken': '2026-08-12',
        'missed': {1: {23: 'B'}, 2: {}},
    },
    {
        'key': 'pt8', 'label': 'Practice Test 8', 'order': 5, 'taken': '2026-08-13',
        'missed': {1: {23: 'A'}, 2: {19: 'C', 27: '504'}},
    },
    {
        'key': 'pt9', 'label': 'Practice Test 9', 'order': 6, 'taken': '2026-08-14',
        'missed': {1: {25: 'A'}, 2: {26: 'C'}},
    },
]

QUESTIONS_PDF = 'book/sat-practice-test-{n}-digital.pdf'
SCORING_PDF = 'book/scoring-sat-practice-test-{n}-digital.pdf'

# Question numbers are set white-on-black in a filled box; nothing else on the
# page is. That one property finds all 54 of them (27 questions x 2 modules) on
# every test, where matching on position does not -- the gutter sits at x=40 on
# tests 5, 6, 8 and 9 but x=58 on test 7, and plenty of ordinary numbers inside
# the questions share those positions anyway.
MARKER_COLOUR = 16777215  # white
MARKER_SIZE = (9.0, 12.0)
# Body text on these pages runs about 10.5pt. The module's closing "STOP" is set
# at 24, which is the only thing this needs to keep out.
BODY_MAX_SIZE = 16.0
COLUMN_WIDTH = 277.0
# Below this is the running foot ("CONTINUE", the page number) and the dotted
# rule that closes a column. Cropping into either staples furniture to the
# bottom of the question.
PAGE_BOTTOM = 700.0


def module_pages(doc):
    """Return {module: [page indexes]} for the two maths modules."""
    starts = {}
    for i in range(doc.page_count):
        head = doc[i].get_text()[:400]
        if 'Math' not in head or 'QUESTIONS' not in head:
            continue
        found = re.search(r'Module\s*(\d)', head)
        if found:
            starts.setdefault(int(found.group(1)), i)
    if len(starts) < 2:
        raise SystemExit(f'  ! could not find both maths modules (found {sorted(starts)})')

    out = {}
    first, second = starts[1], starts[2]
    out[1] = list(range(first, second))
    # The maths section is the tail of the book, but the last pages are the
    # "No Test Material On This Page" fillers and the back matter.
    end = doc.page_count
    for i in range(second, doc.page_count):
        if 'No Test Material' in doc[i].get_text()[:200]:
            end = i
            break
    out[2] = list(range(second, end))
    return out


def markers(page):
    """Question numbers on a page, as (number, left_x, top_y), reading order."""
    middle = page.rect.width / 2
    hits = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                text = span['text'].strip()
                if not (text.isdigit() and 1 <= int(text) <= 27):
                    continue
                if span.get('color') != MARKER_COLOUR:
                    continue
                if not MARKER_SIZE[0] <= span['size'] <= MARKER_SIZE[1]:
                    continue
                x0, y0 = span['bbox'][0], span['bbox'][1]
                hits.append((int(text), x0, y0, 0 if x0 < middle else 1))
    # Reading order: left column top to bottom, then right column.
    hits.sort(key=lambda h: (h[3], h[2]))
    return hits


def content_box(page, left, top, limit):
    """Fit the crop to this question's own ink, right edge and bottom.

    A fixed column width and a drop to the foot of the page both pick up
    furniture: the dotted rule that divides the two columns, and the "STOP"
    banner that closes a module -- which is set at 24pt and centred, so it lands
    inside any band wide enough to hold a figure. Measuring the question instead
    means the crop is never wider or taller than the question is.
    """
    # Never reach past the middle of the page, or the other column comes with it.
    band = min(left + COLUMN_WIDTH, page.rect.width / 2 - 4 if left < page.rect.width / 2
               else page.rect.width - 8)
    right, lowest = left, top

    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                x0, y0, x1, y1 = span['bbox']
                text = span['text'].strip()
                if not text or set(text) <= {'.', ' '}:
                    continue           # the dotted column rule
                if span['size'] > BODY_MAX_SIZE:
                    continue           # STOP / CONTINUE, not part of any question
                if x0 < left - 12 or x1 > band or y0 < top - 2 or y1 > limit:
                    continue
                right, lowest = max(right, x1), max(lowest, y1)

    # Figures are images or vector drawings, not spans, and usually sit lowest
    # and widest.
    rects = [item['rect'] for item in page.get_drawings()]
    for img in page.get_images(full=True):
        rects.extend(page.get_image_rects(img[0]))
    for r in rects:
        if r.x0 < left - 12 or r.x1 > band or r.y0 < top - 2 or r.y1 > limit:
            continue
        if r.height < 2 and r.width < 2:
            continue
        right, lowest = max(right, r.x1), max(lowest, r.y1)

    return min(right + 12, band), min(lowest + 10, limit)


def locate(doc, pages, number):
    """Find the page and crop rectangle for one question number."""
    for page_index in pages:
        page = doc[page_index]
        found = markers(page)
        for value, left, top, side in found:
            if value != number:
                continue
            # Stop at the next question in the SAME column, else at the page foot,
            # then pull back to wherever this question's own ink ends.
            below = [y for (_, _, y, s) in found if s == side and y > top]
            limit = min(below) - 8 if below else PAGE_BOTTOM
            right, bottom = content_box(page, left, top, limit)
            rect = fitz.Rect(left - 12, top - 9, right, bottom)
            return page_index, rect
    return None, None


def trim(path):
    """Drop the whitespace the generous crop leaves at the bottom."""
    img = Image.open(path).convert('RGB')
    grey = img.convert('L')
    box = grey.point(lambda v: 0 if v > 245 else 255).getbbox()
    if box:
        pad = 14
        box = (max(0, box[0] - pad), max(0, box[1] - pad),
               min(img.width, box[2] + pad), min(img.height, box[3] + pad))
        img.crop(box).save(path)
    return Image.open(path).size


# The paper tests do not publish a skill per question, so "Math" is all a missed
# maths row could say -- useless in a dropdown meant to answer "which area does he
# miss most". But these questions are also in the College Board bank, so the skill
# is recoverable: match the crop's own words against the bank and take the label.
#
# Only the LABEL is wanted, not the item, so a near-tie between four questions that
# all carry the same skill is still an answer. What is refused is a tie across
# DIFFERENT skills, which would be a guess.
def load_bank():
    out = []
    for path in sorted(glob.glob('banks/math-*.json')):
        if 'index' in path:
            continue
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if isinstance(data, list):
            out.extend(data)
    return [(q, set(w.lower() for w in re.findall(r'[A-Za-z]{4,}',
            re.sub(r'<[^>]+>', ' ', q.get('question') or '')))) for q in out]


def bank_skill(bank, page, rect, answer):
    mine = set(w.lower() for w in re.findall(r'[A-Za-z]{4,}',
               ' '.join(w[4] for w in page.get_text('words', clip=rect))))
    if not mine:
        return None, None
    scored = []
    for q, bag in bank:
        if not bag:
            continue
        overlap = len(mine & bag) / len(mine | bag)
        answers = set(str(a) for a in (q.get('answers') or []))
        if q.get('correctLabel'):
            answers.add(q['correctLabel'])
        scored.append((overlap, str(answer) in answers, q))
    scored.sort(key=lambda r: -r[0])
    top = scored[0]
    if not top[1] or top[0] < 0.45:
        return None, None
    # A clear winner names the item as well as the skill.
    if top[0] - scored[1][0] >= 0.10:
        return top[2].get('skill'), top[2]['id']
    # Otherwise take the skill only, and only if the close candidates agree on it.
    close = [q for o, _, q in scored if top[0] - o < 0.10]
    skills = {q.get('skill') for q in close}
    return (skills.pop(), None) if len(skills) == 1 else (None, None)


def answer_key(n):
    """{module: {number: answer}} for the maths half of the official key."""
    doc = fitz.open(SCORING_PDF.format(n=n))
    page = None
    # Take the LAST page carrying the key: an earlier page repeats the boilerplate
    # and taking the first match once returned another test's numbers entirely.
    for i in range(doc.page_count):
        if 'Answer Key' in doc[i].get_text():
            page = i
    lines = [l.strip() for l in doc[page].get_text().split('\n') if l.strip()]

    # The page holds four tables in order -- Reading module 1 and 2, then maths
    # module 1 and 2 -- each introduced by the same column header.
    blocks, cur = [], None
    header = {'CORRECT', 'MARK YOUR', 'ANSWERS'}
    for line in lines:
        if line == 'QUESTION #':
            cur = []
            blocks.append(cur)
            continue
        if cur is not None and line not in header:
            cur.append(line)

    def read(block):
        """Walk number/answer pairs, in order, stopping where the run breaks."""
        out, expect, i = {}, 1, 0
        while i < len(block):
            token = block[i]
            # A grid-in answer sometimes shares the line with its number.
            same = re.match(r'^(\d{1,2})\s+(\S.*)$', token)
            if same and int(same.group(1)) == expect:
                out[expect] = same.group(2).strip()
                expect, i = expect + 1, i + 1
                continue
            if token == str(expect) and i + 1 < len(block):
                out[expect] = block[i + 1].strip()
                expect, i = expect + 1, i + 2
                continue
            i += 1
        return out

    tables = [read(b) for b in blocks]
    maths = [t for t in tables if len(t) == 27][-2:]
    if len(maths) != 2:
        shapes = [len(t) for t in tables]
        raise SystemExit(f'  ! test {n}: expected two 27-answer maths tables, got {shapes}')
    return {1: maths[0], 2: maths[1]}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bank = load_bank()
    out = []

    for test in TESTS:
        n = test['key'][2]
        doc = fitz.open(QUESTIONS_PDF.format(n=n))
        pages = module_pages(doc)
        keys = answer_key(n)
        print(f"{test['label']}: maths module 1 pages {pages[1][0]}-{pages[1][-1]}, "
              f"module 2 pages {pages[2][0]}-{pages[2][-1]}")

        for module in (1, 2):
            for number, chose in sorted(test['missed'][module].items()):
                page_index, rect = locate(doc, pages[module], number)
                if rect is None:
                    print(f'  ! M{module} Q{number}: not found')
                    continue

                name = f"{test['key']}-m{module}-q{number}.png"
                path = OUT_DIR / name
                doc[page_index].get_pixmap(clip=rect, dpi=DPI).save(path)
                size = trim(path)

                correct = keys[module].get(number)
                if correct is None:
                    print(f'  ! M{module} Q{number}: no answer in the key')
                    continue

                # A grid-in answer is not a letter. Emitted in the same shape the
                # maths bank uses for its 450 student-response questions, so the
                # app's existing entry box and answer check take it unchanged.
                entry = correct not in ('A', 'B', 'C', 'D')
                skill, bank_id = bank_skill(bank, doc[page_index], rect, correct)
                out.append({
                    'id': f"missed-math-{test['key']}-m{module}-q{number}",
                    # Rides the same skill as the Reading set so one dropdown, one
                    # test filter and one dialog serve both; `section` is what
                    # keeps the two pools apart in the app.
                    'skill': 'missed-in-test',
                    'realSkill': 'math',
                    'section': 'math',
                    # The maths half of the skill dropdown is built from the
                    # questions themselves rather than a fixed taxonomy, so these
                    # have to carry their own group and labels or they arrive
                    # under an unnamed heading.
                    'domain': 'extra',
                    'domainLabel': 'Extras',
                    'skillLabel': 'Missed in a test',
                    'source': 'SAT paper practice test',
                    'test': test['label'],
                    'testOrder': test['order'],
                    'taken': test['taken'],
                    'module': module,
                    'number': number,
                    'image': f'{OUT_DIR.as_posix()}/{name}',
                    'imageWidth': size[0],
                    'imageHeight': size[1],
                    'format': 'spr' if entry else 'mcq',
                    'chose': chose,
                    # College Board's own name for what this question tests, so
                    # the skill dropdown can group maths misses meaningfully.
                    'bankSkill': skill,
                    'bankId': bank_id,
                    **({'answers': [correct]} if entry else {
                        'correctLabel': correct,
                        # The choices live inside the picture, so the app shows
                        # bare letters. Kept as a real options list so nothing
                        # downstream has to special-case the shape.
                        'options': [{'label': L, 'text': ''} for L in 'ABCD'],
                    }),
                })
                print(f'  M{module} Q{number}: page {page_index}, {size[0]}x{size[1]}px, '
                      f'answer {correct}' + (f', he put {chose}' if chose else '')
                      + f'  [{skill or "skill not matched"}]')

    out.sort(key=lambda q: (q['testOrder'], q['module'], q['number']))
    OUT_JSON.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(f'\nwrote {len(out)} questions to {OUT_JSON}')


if __name__ == '__main__':
    main()
