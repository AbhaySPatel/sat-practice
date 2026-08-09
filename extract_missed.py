"""Build banks/missed-in-test.json -- the questions Abhay actually got wrong on a
full practice test, pulled from College Board's own PDFs.

These are worth more than any other questions in the app. A question from the
general bank is one he might get wrong; a question in here is one he *did* get
wrong, under time, on a real test. Grouping them under their own skill keeps them
out of the ordinary practice sets so they stay a deliberate revision set rather
than turning up at random.

Two PDFs per test, both from satsuite.collegeboard.org:
  - the test PDF     supplies the passage, the prompt and the four options
  - the answers PDF  supplies the correct letter and College Board's rationale
                     for every choice, which becomes each option's `why`

The answers PDF carries no skill labels, so the skill is inferred from the prompt
and -- for Standard English Conventions, where the prompt is identical across
Boundaries and Form/Structure/Sense -- from the rationale, which names the rule
outright ("The convention being tested is subject-verb agreement").

To add a test: append to TESTS below with the pages each module spans and the
question numbers he missed, then re-run. Existing entries are rebuilt from
scratch each time, so this is safe to run repeatedly.

Run:  python3 extract_missed.py
"""

import json
import re
import sys
from pathlib import Path
from collections import Counter

OUT = Path('banks/missed-in-test.json')
SKILL = 'missed-in-test'
DOMAIN = 'extra'

TESTS = [
    {
        'key': 'pt5',
        'label': 'Practice Test 5',
        'taken': '2026-08-09',
        'questions_pdf': Path('book/sat-practice-test-5-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-5-answers-digital.pdf'),
        # Reading and Writing only. Page indexes are 0-based, as PyMuPDF counts.
        'modules': {1: range(3, 17), 2: range(17, 31)},
        'per_module': 33,
        # Read off the scoring worksheet at tests/Test 5 on 09-Aug.jpeg and
        # cross-checked against the official key: every one is a genuine error.
        'missed': {
            1: [4, 5, 8, 10, 16, 19, 24, 25, 29, 30, 33],
            2: [4, 5, 7, 13, 15, 16, 18, 24, 25, 29],
        },
    },
]

# --- Reading the test PDF ---------------------------------------------------

# A question number sits on a line of its own, but a stray rule from the page
# border sometimes lands in front of it ("- 1").
NUM = re.compile(r'^[-~\s]*(\d{1,2})\s*$')
OPTION = re.compile(r'^([A-D])\)\s*(.*)$')

# The blank in a cloze question extracts as the bare word "blank", usually on a
# line of its own but sometimes running on from the words before it ("writing
# blank"). Both spellings have to be caught, so the token is replaced after the
# lines are joined rather than while they are being read.
BLANK_LINE = re.compile(r'^\s*blank\s*$')
BLANK_TOKEN = re.compile(r'(?<![A-Za-z])blank(?![A-Za-z])')

# Accessibility markers wrapping the portion the question calls "underlined".
# Unlike the question-bank exports, the practice-test PDFs carry these, so the
# underline survives extraction instead of leaving the question unanswerable.
REFERENCED = re.compile(
    r'Start referenced Content:\s*(?P<text>.*?)\s*End referenced Content\.?', re.S)

# Page furniture. Everything here appears on every page and belongs to none of
# the questions.
FURNITURE = re.compile(
    r'^(Module|CONTINUE|Unauthorized copying|DIRECTIONS|Reading and Writing|'
    r'\d+ QUESTIONS|The questions in this section address|'
    r'No Test Material On This Page|'
    r'question includes one or more passages|and question carefully|'
    r'All questions in this section are multiple-choice|single best answer)', re.I)


def is_junk(line):
    """Page furniture, rules, and the debris a chart leaves behind."""
    s = line.strip()
    if not s:
        return True
    if FURNITURE.match(s):
        return True
    # Dotted rules between questions, and the ASCII wreckage of a plotted line.
    letters = sum(c.isalpha() for c in s)
    if letters == 0:
        return True
    if len(s) < 40 and letters / len(s) < 0.5:
        return True
    return False


def page_lines(doc, pages):
    """Lines exactly as extracted, trailing space and all.

    That trailing space is load-bearing. Inside an underlined portion the PDF
    breaks words across lines with no hyphen -- "...or its rem" / "ains, in this
    harsh place" -- and the only thing distinguishing that from an ordinary line
    break is that an ordinary one ends with a space and a mid-word one does not.
    Strip the lines here and "remains" becomes "rem ains" with no way back.
    """
    return [(ln, p + 1) for p in pages for ln in doc[p].get_text().split('\n')]


def split_questions(doc, pages, total):
    """Locate each question by its number line.

    Numbers also occur inside passages and chart axes, so only the *next*
    expected number is ever accepted, and only when four options follow it
    before the number after that. Both together are enough: this recovers 33 of
    33 on each module of Practice Test 5.
    """
    lines = page_lines(doc, pages)
    starts = {}
    expect, i = 1, 0
    while i < len(lines) and expect <= total:
        m = NUM.match(lines[i][0])
        if m and int(m.group(1)) == expect:
            ahead = '\n'.join(ln for ln, _ in lines[i + 1:i + 130])
            if re.search(r'\nA\)', ahead):
                starts[expect] = i
                expect += 1
        i += 1

    blocks = {}
    order = sorted(starts.items(), key=lambda kv: kv[1])
    for pos, (num, start) in enumerate(order):
        end = order[pos + 1][1] if pos + 1 < len(order) else len(lines)
        # The page the question opens on, as a PDF viewer counts them -- what to
        # tell him to turn to when the question depends on a figure.
        blocks[num] = ([ln for ln, _ in lines[start + 1:end]], lines[start][1])
    return blocks


class Joiner:
    """Rebuilds running text from PDF lines, respecting the mid-word break rule
    described in page_lines: a line that ended with a space gets a space after
    it, one that did not is glued straight onto what follows."""

    def __init__(self):
        self.parts = []
        self.space_after_last = True

    def add(self, raw):
        content = raw.strip()
        if not content:
            return
        if self.parts and self.space_after_last:
            self.parts.append(' ')
        self.parts.append(content)
        self.space_after_last = raw != raw.rstrip()

    def text(self):
        return ''.join(self.parts)


def parse_block(block):
    """Split one question's lines into passage, prompt and options."""
    body, options, label = Joiner(), {}, None
    # Options always close a question. Anything textual after them belongs to
    # whatever comes next -- typically the caption of the following question's
    # chart, which reads like prose and so survives is_junk.
    seen_option = False
    for raw in block:
        m = OPTION.match(raw.strip())
        if m:
            label = m.group(1)
            seen_option = True
            options[label] = Joiner()
            # Feed the text after "A)" back in carrying the original line's
            # trailing space, so an option broken mid-word rejoins too.
            options[label].add(m.group(2) + (' ' if raw != raw.rstrip() else ''))
            continue
        if label:
            # A wrapped option line. Anything junk-looking means the options are
            # over and the page furniture has started.
            if is_junk(raw):
                label = None
                continue
            options[label].add(raw)
            continue
        if seen_option:
            continue
        if BLANK_LINE.match(raw):
            body.add('___ ')
            continue
        if is_junk(raw):
            continue
        # "blank" is a placeholder, not a word, so the mid-word rule must not
        # apply to it: a line ending "...the flare is blank" would otherwise glue
        # straight onto the prompt that follows and give "blankWhich choice".
        if raw.rstrip().endswith('blank'):
            raw = raw.rstrip() + ' '
        body.add(raw)

    text = BLANK_TOKEN.sub('___', body.text())
    text = re.sub(r'\s+([.,;:?!])', r'\1', text)
    text = re.sub(r'\s+', ' ', text).strip()
    # Guarantee exactly one space either side of the blank, whichever way it was
    # spelled in the PDF.
    text = re.sub(r'\s*___\s*', ' ___ ', text)
    text = re.sub(r'\s+([.,;:?!])', r'\1', text).strip()

    return text, {k: re.sub(r'\s+', ' ', v.text()).strip() for k, v in options.items()}


# The prompt is the last question-sentence before the options. Splitting on the
# final "?" is not enough -- passages contain questions of their own -- so the
# sentence has to start with one of the openers College Board actually uses.
PROMPT_START = re.compile(
    # Starts the text, follows the end of a sentence, or follows the blank -- a
    # cloze question runs "...concluded that ___ Which choice completes...", with
    # the full stop stranded on its own line and dropped as page furniture.
    r'(?:^|(?<=[.?!"”\'_]) )('
    r'Which (?:choice|quotation|finding|statement|data)|'
    r'What (?:does|is|makes|choice)|'
    r'As used in the text|'
    r'According to the text|'
    r'Based on the (?:text|texts|data|table|graph))')


def split_prompt(text):
    """-> (passage, prompt). The prompt is stripped out of the passage."""
    hits = list(PROMPT_START.finditer(text))
    for m in reversed(hits):
        tail = text[m.start():]
        if '?' in tail:
            end = m.start() + tail.index('?') + 1
            prompt = text[m.start():end].strip()
            passage = (text[:m.start()] + ' ' + text[end:]).strip()
            return re.sub(r'\s+', ' ', passage), prompt
    return text, ''


# A question whose answer lives in a chart. The chart does not survive text
# extraction, so these need the PDF open alongside.
FIGURE = re.compile(r'\b(?:the (?:graph|table|figure|chart)|data in the|'
                    r'according to the (?:graph|table))\b', re.I)


def pull_underline(text):
    """-> (text without the markers, the portion they wrapped)."""
    m = REFERENCED.search(text)
    if not m:
        return text, None
    marked = re.sub(r'\s+', ' ', m.group('text')).strip()
    cleaned = REFERENCED.sub(marked, text)
    cleaned = re.sub(r'\s+([.,;:?!])', r'\1', cleaned)
    return re.sub(r'\s+', ' ', cleaned).strip(), marked


# --- Reading the answers PDF ------------------------------------------------

def read_answers(path, per_module):
    """{(module, number): full rationale text} for Reading and Writing only."""
    import fitz
    doc = fitz.open(path)
    pages, current = {}, None
    for p in range(doc.page_count):
        t = doc[p].get_text()
        m = re.search(r'READING AND WRITING:\s*MODULE\s*(\d)', t, re.I)
        if m:
            current = int(m.group(1))
        elif re.search(r'MATH:\s*MODULE', t, re.I):
            current = None
        if current:
            pages.setdefault(current, []).append(t)

    out = {}
    for module, texts in pages.items():
        whole = re.sub(r'[ \t]+', ' ', '\n'.join(texts))
        parts = re.split(r'\nQUESTION\s+(\d+)\s*\n', '\n' + whole)
        for i in range(1, len(parts), 2):
            num = int(parts[i])
            if 1 <= num <= per_module:
                out.setdefault((module, num), re.sub(r'\s+', ' ', parts[i + 1]).strip())
    return out


BEST = re.compile(r'Choice ([A-D]) is the best answer')
SEGMENT = re.compile(r'(?=Choice [A-D] (?:is|would be))')


def split_rationale(text):
    """-> (correct label, {label: its own rationale})."""
    best = BEST.search(text)
    if not best:
        return None, {}
    per = {}
    for seg in SEGMENT.split(text):
        seg = seg.strip()
        m = re.match(r'Choice ([A-D]) ', seg)
        if m:
            per.setdefault(m.group(1), seg)
    return best.group(1), per


def make_rule(best_rationale):
    """College Board states the rule inside its own rationale, either as the
    reason the answer is best or, for conventions, as the rule under test."""
    m = re.search(r'is the best answer because (.+?)(?<![A-Z])\.(?:\s|$)', best_rationale)
    if m:
        rule = m.group(1).strip()
        rule = re.sub(r'^it ', '', rule)
        return rule[0].upper() + rule[1:] + '.'
    m = re.search(r'(The convention being tested is [^.]+\.)', best_rationale)
    if m:
        return m.group(1).strip()
    first = re.split(r'(?<=\.)\s', best_rationale)
    return first[1].strip() if len(first) > 1 else best_rationale[:160].strip()


# --- Which skill ------------------------------------------------------------

# Checked in order. Conventions first, because Boundaries and Form/Structure &
# Sense share one prompt word for word and only the rationale tells them apart.
def classify(prompt, rationale):
    conv = re.search(r'convention being tested is ([^.]+)', rationale, re.I)
    if conv:
        what = conv.group(1).lower()
        if re.search(r'punctuat|colon|semicolon|comma|dash|parenthes|'
                     r'sentence boundar|supplementary|coordinat', what):
            return 'boundaries'
        return 'form-structure-sense'
    if re.search(r'conventions of Standard English', prompt, re.I):
        return 'form-structure-sense'

    for pattern, skill in (
        (r'most logical transition', 'transitions'),
        (r'relevant information from the notes', 'rhetorical-synthesis'),
        (r'most logical and precise word or phrase|most nearly mean', 'words-in-context'),
        (r'function of the underlined|overall structure|main purpose of the text',
         'text-structure-purpose'),
        (r'quotation .*(?:illustrate|support)|would best support|'
         r'data from the (?:graph|table)|Based on the (?:data|table|graph)|'
         r'most effectively uses data', 'command-of-evidence'),
        (r'most logically completes the text', 'inferences'),
        (r'main idea of the text|According to the text', 'central-ideas-details'),
        (r'Text 1 and Text 2|author of Text 2', 'cross-text-connections'),
    ):
        if re.search(pattern, prompt, re.I):
            return skill
    return None


# --- Assembly ---------------------------------------------------------------

def build(test):
    import fitz
    doc = fitz.open(test['questions_pdf'])
    answers = read_answers(test['answers_pdf'], test['per_module'])

    rows, problems = [], []
    for module, pages in test['modules'].items():
        wanted = test['missed'].get(module, [])
        if not wanted:
            continue
        blocks = split_questions(doc, pages, test['per_module'])
        for num in wanted:
            found = blocks.get(num)
            if not found:
                problems.append(f'{test["key"]} M{module} Q{num}: not found in the test PDF')
                continue
            block, page = found

            text, options = parse_block(block)
            text, underline = pull_underline(text)
            passage, prompt = split_prompt(text)

            rationale = answers.get((module, num), '')
            correct, per_option = split_rationale(rationale)

            if not prompt:
                problems.append(f'{test["key"]} M{module} Q{num}: no prompt found')
            if sorted(options) != list('ABCD'):
                problems.append(f'{test["key"]} M{module} Q{num}: options {sorted(options)}')
            if not correct:
                problems.append(f'{test["key"]} M{module} Q{num}: no correct answer')
            if sorted(per_option) != list('ABCD'):
                problems.append(
                    f'{test["key"]} M{module} Q{num}: rationales {sorted(per_option)}')

            skill = classify(prompt, rationale)
            if not skill:
                problems.append(f'{test["key"]} M{module} Q{num}: skill not recognised')

            row = {
                'id': f'missed-{test["key"]}-m{module}-q{num}',
                'source': f'College Board {test["label"]}, Module {module}, Question {num}',
                'skill': SKILL,
                'domain': DOMAIN,
                # What it would have been tagged as in the ordinary banks. Shown
                # on screen and used for the per-skill tallies.
                'realSkill': skill,
                'test': test['label'],
                'taken': test['taken'],
                'module': module,
                'number': num,
                # He sat these under time; there is no easy/hard split on a real
                # test, and calling them hard is honest -- he missed them.
                'difficulty': 'hard',
                'hasBlank': '___' in passage,
                'passage': passage,
                'question': prompt,
                'rule': make_rule(per_option.get(correct, rationale)) if correct else '',
                'correctLabel': correct,
                'options': [
                    {'label': lab, 'text': options.get(lab, ''),
                     'why': per_option.get(lab, '')}
                    for lab in 'ABCD'
                ],
            }
            if underline:
                row['underline'] = underline
            # A question built on a graph or table cannot be worked from text
            # alone. Rather than drop it or ship it unanswerable, it carries the
            # page to turn to, and the app says so on screen.
            if FIGURE.search(prompt) or FIGURE.search(passage):
                row['figure'] = True
                row['pdf'] = test['questions_pdf'].name
                row['page'] = page
            rows.append(row)

    return rows, problems


def main():
    try:
        import fitz  # noqa: F401
    except ImportError:
        sys.exit('PyMuPDF is needed: pip install pymupdf')

    all_rows, all_problems = [], []
    for test in TESTS:
        for key in ('questions_pdf', 'answers_pdf'):
            if not test[key].exists():
                sys.exit(f'{test[key]} not found -- run from the repo root.')
        rows, problems = build(test)
        all_rows += rows
        all_problems += problems
        print(f'{test["label"]}: {len(rows)} questions')

    OUT.write_text(json.dumps(all_rows, indent=2, ensure_ascii=False) + '\n',
                   encoding='utf-8')
    print(f'\n{len(all_rows)} written to {OUT}')

    by_skill = Counter(r['realSkill'] for r in all_rows)
    for skill, n in by_skill.most_common():
        print(f'  {n:3}  {skill}')
    print(f'  {sum(1 for r in all_rows if r.get("underline"))} carry an underlined portion')

    if all_problems:
        print(f'\n  {len(all_problems)} need a look:')
        for p in all_problems:
            print(f'    {p}')
    else:
        print('\n  every question parsed cleanly')


if __name__ == '__main__':
    main()
