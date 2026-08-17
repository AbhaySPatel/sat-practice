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

A Bluebook practice test is adaptive and College Board publishes no PDF for it,
so there is nothing to parse: those questions are copied out of Bluebook's own
review screen into tests/missed-bluebook.json and read from there. Everything
after the reading is shared with the PDF route -- same skill classifier, same
rule line, same option glossing -- so a typed-in question is indistinguishable
in the app from an extracted one.

To add a paper test: append to TESTS below with the pages each module spans and
the question numbers he missed, then re-run. For a Bluebook test, add to
tests/missed-bluebook.json. Existing entries are rebuilt from scratch each time,
so this is safe to run repeatedly.

Run:  python3 extract_missed.py
"""

import glob
import json
import re
import sys
from pathlib import Path
from collections import Counter, defaultdict

OUT = Path('banks/missed-in-test.json')
# Typed-in questions from the Bluebook tests. An input file rather than rows
# pasted into OUT, because OUT is rewritten from scratch on every run: anything
# hand-added there would vanish the next time a paper test was added.
BLUEBOOK = Path('tests/missed-bluebook.json')
SKILL = 'missed-in-test'
DOMAIN = 'extra'

# Words in Context questions carry a one-line meaning per option, so the "Show
# meanings" peek works on them exactly as it does in the ordinary bank. These
# questions are not in banks/vocab.json -- that is indexed by College Board's own
# question ids and these have their own -- so the glosses are stored on the
# options themselves. Same extraction as extract_vocab.py, reused rather than
# reimplemented: College Board defines the word inside its rationale for the
# choice ("In this context, 'ameliorate' means to help remedy or improve").
from extract_vocab import clean, find_gloss, load_manual  # noqa: E402

# The practice-test rationales use typographic quotes where the question-bank
# export uses straight ones, and extract_vocab's patterns are written for
# straight. Normalising here rather than loosening those patterns leaves the
# 952-word build exactly as it is.
QUOTES = str.maketrans({'“': '"', '”': '"', '‘': "'", '’': "'"})

# Shapes these rationales use that the question-bank ones do not. Tried only
# after extract_vocab's own patterns have failed.
EXTRA_PATTERNS = [
    # "word" in this context would mean X
    r'"{w}"\s+(?:in|as used in) this context\s+(?:would mean|means)\s+(?P<d>[^.;]+)',
    # in this context "word" would mean X
    r'in this context[, ]+"{w}"\s+(?:would mean|means|could mean)\s+(?P<d>[^.;]+)',
    # "word," or X,   -- the aside, with the comma inside the closing quote
    r'"{w},?"[,]?\s+or\s+(?P<d>[^.;]+?)(?=,|\.|;)',
]

VOCAB_INDEX = Path('banks/vocab.json')

# Option text is sometimes an article plus the word ("a tenuous"). The gloss is
# for the word.
ARTICLE = re.compile(r'^(?:a|an|the)\s+', re.I)


def option_word(text):
    return ARTICLE.sub('', (text or '').strip().rstrip('.')).strip()


def load_word_index():
    """word -> gloss, from the 952-word list already built for the drill."""
    if not VOCAB_INDEX.exists():
        return {}
    data = json.loads(VOCAB_INDEX.read_text(encoding='utf-8'))
    return {w['word'].lower(): w['gloss']
            for w in data.get('words', []) if w.get('word') and w.get('gloss')}

# `order` is what keeps the output append-only. The rows are emitted in ascending
# order, not in the order the sources happen to be read, because the app holds his
# place in the revision set as an INDEX into this file: anything inserted ahead of
# a question he has already met moves it out from under him. So a new test gets the
# next number, whichever route it came in by, and nothing already here shifts.
# Bluebook tests carry the same field -- see tests/missed-bluebook.json.
TESTS = [
    {
        'key': 'pt5',
        'label': 'Practice Test 5',
        'order': 1,
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
    {
        'key': 'pt6',
        'label': 'Practice Test 6',
        # Third in, so it emits after the Bluebook set even though it is read first.
        'order': 3,
        'taken': '2026-08-11',
        'questions_pdf': Path('book/sat-practice-test-6-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-6-answers-digital.pdf'),
        # Same layout as Test 5. Page 30 holds no questions; harmless in the range.
        'modules': {1: range(3, 17), 2: range(17, 31)},
        'per_module': 33,
        # He did not mark this worksheet at all -- tests/Test 6 on 11-Aug.jpeg holds
        # only his own answers, all 66 of them. These are the questions where that
        # answer differs from the official key in
        # book/scoring-sat-practice-test-6-digital.pdf. R&W raw 53/66.
        'missed': {
            1: [5, 6, 8, 13, 15, 16, 18, 30],
            2: [5, 11, 12, 24, 28],
        },
    },
    {
        'key': 'pt7',
        'label': 'Practice Test 7',
        'order': 4,
        'taken': '2026-08-12',
        'questions_pdf': Path('book/sat-practice-test-7-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-7-answers-digital.pdf'),
        'modules': {1: range(3, 19), 2: range(19, 31)},
        'per_module': 33,
        # tests/Test 7 on 12 Aug.jpeg, scored against the official key. He marked
        # every one of these himself except M1 Q18, which he had missed.
        'missed': {
            1: [3, 5, 6, 8, 13, 18, 33],
            2: [3, 8, 11, 16, 25],
        },
    },
    {
        'key': 'pt8',
        'label': 'Practice Test 8',
        'order': 5,
        'taken': '2026-08-13',
        'questions_pdf': Path('book/sat-practice-test-8-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-8-answers-digital.pdf'),
        'modules': {1: range(3, 17), 2: range(17, 31)},
        'per_module': 33,
        # tests/Test 8 on 13 Aug.jpeg. His own marking of this one was exact.
        'missed': {
            1: [9, 10, 15, 16, 20, 22, 24, 25, 31],
            2: [3, 5, 9, 12, 13, 17, 18, 20, 26, 31, 33],
        },
    },
    {
        'key': 'pt9',
        'label': 'Practice Test 9',
        'order': 6,
        'taken': '2026-08-14',
        'questions_pdf': Path('book/sat-practice-test-9-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-9-answers-digital.pdf'),
        'modules': {1: range(3, 17), 2: range(17, 31)},
        'per_module': 33,
        # tests/Test 9 on 14 Aug.jpeg. He marked all fourteen himself and every
        # figure on the sheet was right, the first time that has happened.
        'missed': {
            1: [5, 8, 9, 16, 22, 25, 28],
            2: [9, 13, 16, 17, 25, 27, 33],
        },
    },
    {
        'key': 'pt11',
        'label': 'Practice Test 11',
        'order': 8,
        'taken': '2026-08-16',
        'questions_pdf': Path('book/sat-practice-test-11-digital.pdf'),
        'answers_pdf': Path('book/sat-practice-test-11-answers-digital.pdf'),
        # Test 11 is set tighter than 5-9: 52 pages against 56, and Reading runs
        # 3-15 and 17-29 rather than 3-17 and 17-31. Taking the older layout on
        # trust found the blocks but not the prompts inside them, which showed up
        # as "no prompt found" on every question of module 1.
        'modules': {1: range(3, 16), 2: range(17, 30)},
        'per_module': 33,
        # tests/Test 11 on 16 Aug.jpeg. Read carefully: the WIDE column, filled on
        # every row, is his own answer sheet; the narrow one holds the correct
        # letter and is written only where he went wrong. (Taking them the other
        # way round makes every "wrong" answer match the key, which is how the
        # mistake announces itself.) Checked against the official key: his column
        # differs from it at exactly these twelve and nowhere else.
        'missed': {
            1: {5: 'B', 12: 'C', 13: 'C', 14: 'A', 18: 'A', 22: 'C', 32: 'B'},
            2: {5: 'C', 7: 'A', 29: 'D', 32: 'D', 33: 'C'},
        },
    },
]

# --- Reading the test PDF ---------------------------------------------------

# A question number sits on a line of its own, but a stray rule from the page
# border sometimes lands in front of it ("- 1").
NUM = re.compile(r'^[-~\s]*(\d{1,2})\s*$')
OPTION = re.compile(r'^([A-D])\)\s*(.*)$')
# The first page of Test 8's Module 2 sets its options as bullets rather than
# "A)", so the four choices arrive unlabelled. They are still in order, so the
# labels are assigned from their position -- which is all "A)" was telling us.
BULLET = re.compile(r'^[•·▪]\s*(.+)$')

# The blank in a cloze question extracts as the bare word "blank", usually on a
# line of its own but sometimes running on from the words before it ("writing
# blank"). Both spellings have to be caught, so the token is replaced after the
# lines are joined rather than while they are being read.
BLANK_LINE = re.compile(r'^\s*blank\s*$')
BLANK_TOKEN = re.compile(r'(?<![A-Za-z])blank(?![A-Za-z])')

# Accessibility markers wrapping the portion the question calls "underlined".
# Unlike the question-bank exports, the practice-test PDFs carry these, so the
# underline survives extraction instead of leaving the question unanswerable.
# Case-insensitive: Tests 5 and 6 write "Start referenced Content", Test 9 writes
# "Start referenced content". Miss it and the marker text stays in the passage,
# which leaves the prompt running on from the word "content" rather than from a
# full stop -- and split_prompt only starts a prompt after sentence-ending
# punctuation, so the question comes through with no prompt at all.
REFERENCED = re.compile(
    r'Start referenced Content:\s*(?P<text>.*?)\s*End referenced Content\.?',
    re.S | re.I)

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
        # ...but a sentence's terminator sometimes lands on a line of its own, and
        # dropping it costs the question its question mark -- which is what
        # split_prompt looks for to find where the prompt ends.
        return s not in ('?', '.', '!')
    # A short line that is mostly not letters is chart wreckage -- an axis, a
    # stray tick, "- 1 -". But a cross-text prompt can end on a line like
    # "(Text 1)?", four letters in nine characters, and dropping that takes the
    # question mark with it. A run of three letters together is a word, and chart
    # debris does not have one.
    if len(s) < 40 and letters / len(s) < 0.5 and not re.search(r'[A-Za-z]{3}', s):
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

    The number after next is accepted too, because a question number occasionally
    fails to extract at all -- Test 7's Module 2 has no line for question 23 --
    and insisting on the exact next one loses every question after it as well: 23
    through 33, ten of them beyond the one actually missing. A gap of one is the
    most that is safe. Two would let a page-number footer through, and the footers
    on these pages run only a few ahead of the question numbers.
    """
    lines = page_lines(doc, pages)
    starts = {}
    expect, i = 1, 0
    while i < len(lines) and expect <= total:
        m = NUM.match(lines[i][0])
        if m and int(m.group(1)) in (expect, expect + 1) and int(m.group(1)) <= total:
            found = int(m.group(1))
            ahead = '\n'.join(ln for ln, _ in lines[i + 1:i + 130])
            if re.search(r'\n(?:A\)|[•·▪])', ahead):
                starts[found] = i
                expect = found + 1
        i += 1

    blocks = {}
    order = sorted(starts.items(), key=lambda kv: kv[1])
    for pos, (num, start) in enumerate(order):
        end = order[pos + 1][1] if pos + 1 < len(order) else len(lines)
        # The page the question opens on, as a PDF viewer counts them -- what to
        # tell him to turn to when the question depends on a figure.
        blocks[num] = ([ln for ln, _ in lines[start + 1:end]], lines[start][1])
    return blocks


def marks_line_breaks(doc, pages):
    """Does this PDF end a wrapped line with a space?

    The rule page_lines depends on -- wrapped line ends with a space, mid-word
    break does not -- is a property of how a particular PDF was produced, not of
    the format. Tests 5 and 6 follow it on 95% of wrapped lines. Tests 7 and 8
    follow it on 2%, so applying it there glues every line onto the next: "the
    mostlogical and precise word", "wild salmon.Which choice completes the text".
    A prompt fused to the passage like that is a prompt the splitter cannot find.

    Measured per document rather than configured per test, so the next test is
    read by whichever convention it actually uses.
    """
    total = spaced = 0
    for p in pages:
        for line in doc[p].get_text().split('\n'):
            if len(line.strip()) < 25:      # short lines end a paragraph anyway
                continue
            total += 1
            spaced += line != line.rstrip()
    return total > 0 and spaced / total > 0.5


class Joiner:
    """Rebuilds running text from PDF lines, respecting the mid-word break rule
    described in page_lines: a line that ended with a space gets a space after
    it, one that did not is glued straight onto what follows.

    `always_space` turns that rule off for a PDF that does not follow it, where
    every line break is a word boundary and there is nothing to distinguish."""

    def __init__(self, always_space=False):
        self.parts = []
        self.space_after_last = True
        self.always_space = always_space

    def add(self, raw):
        content = raw.strip()
        if not content:
            return
        if self.parts and self.space_after_last:
            self.parts.append(' ')
        self.parts.append(content)
        self.space_after_last = self.always_space or raw != raw.rstrip()

    def text(self):
        return ''.join(self.parts)


def parse_block(block, always_space=False):
    """Split one question's lines into passage, prompt and options."""
    body, options, label = Joiner(always_space), {}, None
    # Options always close a question. Anything textual after them belongs to
    # whatever comes next -- typically the caption of the following question's
    # chart, which reads like prose and so survives is_junk.
    seen_option = False
    # Bullets are only ever the choices when there are no lettered ones. A
    # Rhetorical Synthesis question sets the student's research notes as a bulleted
    # list ABOVE its "A)" choices, so reading bullets as options unconditionally
    # turns the notes into the answers and the question into nonsense.
    lettered = any(OPTION.match(l.strip()) for l in block)
    for raw in block:
        m = OPTION.match(raw.strip())
        bullet = None if (m or lettered) else BULLET.match(raw.strip())
        if m or (bullet and len(options) < 4):
            label = m.group(1) if m else 'ABCD'[len(options)]
            rest = m.group(2) if m else bullet.group(1)
            seen_option = True
            options[label] = Joiner(always_space)
            # Feed the text after "A)" back in carrying the original line's
            # trailing space, so an option broken mid-word rejoins too.
            options[label].add(rest + (' ' if raw != raw.rstrip() else ''))
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

    # Where the PDF marks no line breaks, the placeholder fuses to the word before
    # it -- "some linguists reason thatblank" -- and BLANK_TOKEN, which requires a
    # non-letter either side, will not see it. Prised off first. The trailing
    # guard keeps "blanket" and "blankly" whole.
    text = re.sub(r'(?<=[a-z])blank(?![a-z])', ' blank', body.text())
    text = BLANK_TOKEN.sub('___', text)
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
    # The space after the full stop is optional: tests 5-9 set the prompt on its
    # own line, but test 11 runs it straight on -- "...demands serious
    # attention.Which choice completes the text..." -- and requiring the space
    # found no prompt at all on every question of its first module.
    r'(?:^|(?<=[.?!"”\'_])\s*)('
    r'Which (?:choice|quotation|finding|statement|data)|'
    r'What (?:does|is|makes|choice)|'
    r'As used in the text|'
    r'According to the text|'
    # The one opener that does not begin with a question word: "It can most
    # reasonably be inferred from the text that ... for which reason?"
    r'It can most reasonably be inferred|'
    r'Based on the (?:text|texts|data|table|graph))')


# Two things test 11's PDF does that tests 5-9 do not.
#
# It spells the cloze blank out as the letters "b l a n k" -- put there for
# screen readers, where the older papers print "___". Left alone the passage
# shows the word on screen, the app's blank never renders, and the prompt that
# follows it is unreachable because the character before it is a letter.
SPELLED_BLANK = re.compile(r'\bb\s+l\s+a\s+n\s+k(?=[^a-z]|$)')

# And it runs the copyright credit straight into the prompt with no space:
# "...there was no appointment at all.\u00a92022 by Mark HaberBased on the text,
# what is notable about Schmidt's behavior?" -- so the prompt does not follow a
# full stop and is not found.
CREDIT = re.compile(
    r'\u00a9\s*\d{4}\s+by\s+.*?(?=(?:Which|What|Based|According|As used|It can)\b)')


def tidy(text):
    """Undo the two test-11 rendering quirks. A no-op on every earlier test."""
    text = SPELLED_BLANK.sub('___', text)
    text = CREDIT.sub(' ', text)
    return re.sub(r'[ \t]+', ' ', text).strip()


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

# Which of College Board's four Reading and Writing domains each skill belongs to.
# Only used to check the classifier against the domain Bluebook itself reports for
# a question, which is why it is not in the banks' own vocabulary of domain names.
SKILL_DOMAIN = {
    'words-in-context': 'Craft and Structure',
    'text-structure-purpose': 'Craft and Structure',
    'cross-text-connections': 'Craft and Structure',
    'central-ideas-details': 'Information and Ideas',
    'command-of-evidence': 'Information and Ideas',
    'inferences': 'Information and Ideas',
    'boundaries': 'Standard English Conventions',
    'form-structure-sense': 'Standard English Conventions',
    'transitions': 'Expression of Ideas',
    'rhetorical-synthesis': 'Expression of Ideas',
}

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
         # "Which finding, if true, would most directly support the hypothesis" --
         # the same skill as the quotation and data questions, asked about a
         # hypothetical result rather than about something already in the text.
         r'if true, would most \w+ly (?:support|weaken|undermine)|'
         r'data from the (?:graph|table)|Based on the (?:data|table|graph)|'
         r'most effectively uses data', 'command-of-evidence'),
        (r'most logically completes the text|most reasonably be inferred', 'inferences'),
        # Ahead of Central Ideas and Details, and matching either text on its own:
        # "both Sykes in Text 1 and the scholars in Text 2 would most likely agree"
        # names no pair literally, and the agree-with-a-statement prompt below would
        # otherwise claim it. Still behind Words in Context and the rest, so "As used
        # in Text 1" stays where it belongs.
        (r'\bTexts? [12]\b|\bboth texts\b', 'cross-text-connections'),
        # "would most likely agree with which statement" is Central Ideas and Details
        # when it is one text -- that is how College Board files it in the question
        # bank, where the 11 cross-text uses and the 2 single-text ones split exactly
        # on whether a numbered Text is named.
        (r'main idea of the text|According to the text|'
         r'would most likely agree with which statement|'
         # Same source of truth as the rule above: the question bank holds this
         # very item -- the difrasismo one -- and files it here.
         r'most strongly supported by the text|'
         # "What does the text most strongly suggest about X?" — seven in the
         # bank, all filed here.
         r'most strongly suggest|'
         # "Based on the text, what is true about Mrs. Ochiltree's acquaintances?"
         # The bank has four of these and files them all here.
         r'what is true about|'
        # "Based on the text, what is notable about Schmidt's behavior?" and
        # "Based on the text, which choice best describes Sir Winston Day?" --
        # the bank holds both of these very questions and files them here, and
        # four more of the "which choice best describes" shape besides.
        r'what is notable about|'
        r'which choice best describes', 'central-ideas-details'),
    ):
        if re.search(pattern, prompt, re.I):
            return skill
    return None


# --- Assembly ---------------------------------------------------------------

def rationale_gloss(word, why):
    """The meaning College Board gives this word while arguing for or against
    the choice, or None."""
    text = (why or '').translate(QUOTES)
    hit = find_gloss(word, text)
    if hit:
        return hit
    esc = re.escape(word)
    for pattern in EXTRA_PATTERNS:
        m = re.search(pattern.format(w=esc), text, re.I)
        if not m:
            continue
        d = clean(m.group('d'))
        if d and word.lower() not in d.lower():
            return d
    return None


def gloss_options(opts, per_option, manual, word_index):
    """Attach a one-line meaning to each option, best source first: College
    Board's own rationale for that choice, then the hand-written list, then the
    952-word index built from the rest of the bank."""
    found = 0
    for o in opts:
        word = option_word(o['text'])
        if not word:
            continue
        key = word.lower()
        gloss = (rationale_gloss(word, per_option.get(o['label'], ''))
                 or manual.get(key)
                 or word_index.get(key))
        if gloss:
            o['gloss'] = gloss
            found += 1
    return found


def build(test):
    import fitz
    doc = fitz.open(test['questions_pdf'])
    all_pages = [p for pages in test['modules'].values() for p in pages]
    always_space = not marks_line_breaks(doc, all_pages)
    if always_space:
        print(f'  {test["label"]}: line breaks carry no space; joining on every one')
    answers = read_answers(test['answers_pdf'], test['per_module'])
    manual = load_manual()
    word_index = load_word_index()

    rows, problems = [], []
    for module, pages in test['modules'].items():
        # A module's misses are either a plain list of numbers or, where his
        # sheet records what he actually put, {number: chose}. Both read as an
        # ordered list of numbers here; the pick is looked up further down.
        entry = test['missed'].get(module, [])
        wanted = sorted(entry) if isinstance(entry, dict) else entry
        picks = entry if isinstance(entry, dict) else {}
        if not wanted:
            continue
        blocks = split_questions(doc, pages, test['per_module'])
        for num in wanted:
            found = blocks.get(num)
            if not found:
                problems.append(f'{test["key"]} M{module} Q{num}: not found in the test PDF')
                continue
            block, page = found

            text, options = parse_block(block, always_space)
            text = tidy(text)
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
            if skill == 'words-in-context':
                got = gloss_options(row['options'], per_option, manual, word_index)
                if got < len(row['options']):
                    problems.append(
                        f'{test["key"]} M{module} Q{num}: {len(row["options"]) - got}'
                        ' option(s) without a gloss — add them to '
                        'banks/vocab-glosses.json')

            if picks.get(num):
                row['chose'] = picks[num]
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


def build_bluebook():
    """The same rows, from tests/missed-bluebook.json instead of a pair of PDFs.

    The typed-in entry carries only what Bluebook's review screen shows: the
    passage, the prompt, the four options, and the one rationale blob covering all
    four choices. The correct letter, the per-option `why`, the rule line and the
    skill are all derived from that blob by the same functions the PDF route uses.
    """
    if not BLUEBOOK.exists():
        return [], []

    manual = load_manual()
    word_index = load_word_index()
    rows, problems = [], []

    for test in json.loads(BLUEBOOK.read_text(encoding='utf-8')):
        order = test.get('order', 0)
        for q in test['questions']:
            where = f'{test["key"]} Q{q["number"]}'
            passage = re.sub(r'\s+', ' ', q['passage']).strip()
            prompt = re.sub(r'\s+', ' ', q['question']).strip()
            rationale = re.sub(r'\s+', ' ', q['rationale']).strip()
            options = q['options']
            correct, per_option = split_rationale(rationale)

            if sorted(options) != list('ABCD'):
                problems.append(f'{where}: options {sorted(options)}')
            if not correct:
                problems.append(f'{where}: no "Choice X is the best answer" in the rationale')
            elif sorted(per_option) != list('ABCD'):
                problems.append(f'{where}: rationales {sorted(per_option)}')

            # `realSkill` can be set by hand when the prompt is one the classifier
            # does not know; otherwise it is inferred exactly as for a paper test.
            skill = q.get('realSkill') or classify(prompt, rationale)
            if not skill:
                problems.append(f'{where}: skill not recognised -- set "realSkill" by hand')
            # Bluebook names the domain above each question, and every skill sits in
            # exactly one domain, so the copied-down `domainBand` checks the
            # classifier for free. A paper test has nothing to check against.
            band = (q.get('domainBand') or '').split(',')[0].strip()
            if skill and band and SKILL_DOMAIN.get(skill) != band:
                problems.append(f'{where}: classified {skill}, but Bluebook '
                                f'files it under {band}')

            # Bluebook underlines the portion on screen but copies as plain text,
            # so which words were underlined is recovered by hand from the
            # rationale. If it does not match the passage character for character
            # the app silently renders the question with nothing underlined, which
            # for these prompts makes it unanswerable -- hence the check.
            underline = q.get('underline')
            if underline and underline not in passage:
                problems.append(f'{where}: underlined portion is not in the passage verbatim')

            row = {
                'id': f'missed-{test["key"]}-m{q["module"]}-q{q["number"]}',
                'source': f'College Board {test["label"]}, '
                          f'Module {q["module"]}, Question {q["number"]}',
                'skill': SKILL,
                'domain': DOMAIN,
                'realSkill': skill,
                'test': test['label'],
                'taken': test['taken'],
                # Bluebook numbers questions within a module, so the same number
                # turns up twice on one test. Which module a question came from is
                # nowhere on its review screen, but the score summary's list of
                # incorrect answers runs through module 1 and then module 2, each
                # in ascending order, so a number that goes down marks the join.
                'module': q['module'],
                'number': q['number'],
                # Unlike a paper test, Bluebook does report difficulty: the
                # Knowledge and Skills page prints one level per domain, above the
                # questions from it. That is College Board's own figure, so it is
                # used as given rather than being called hard by fiat -- it decides
                # what the question is worth and which Difficulty filter it answers
                # to. `domainBand` in the input file records the block it was read
                # from. Falls back to hard for an entry typed without one.
                'difficulty': q.get('difficulty', 'hard'),
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
            # Which distractor took him in. The paper tests' worksheet does not
            # record this; Bluebook's review screen does, and it is the most
            # diagnostic thing about the miss.
            if q.get('chose'):
                row['chose'] = q['chose']
            if underline:
                row['underline'] = underline
            # A "most nearly mean" question is the one Words in Context shape whose
            # options are already definitions -- the word under test is in the
            # passage, not in the choices -- so there is nothing to gloss.
            if skill == 'words-in-context' and 'most nearly mean' not in prompt:
                got = gloss_options(row['options'], per_option, manual, word_index)
                if got < len(row['options']):
                    problems.append(
                        f'{where}: {len(row["options"]) - got} option(s) without a '
                        'gloss — add them to banks/vocab-glosses.json')
            rows.append((order, row))

    return rows, problems


# Every Reading and Writing bank, because a question he missed on a test can be
# the same item as one in any of them.
BANK_GLOB = 'banks/cb-*.json'
EDU_BANK = Path('banks/educator-question-bank.json')


def _norm(s):
    s = re.sub(r'<[^>]+>', ' ', s or '').replace('\u2019', "'")
    return re.sub(r'[^a-z0-9]', '', s.lower())


def borrow_from_bank(rows):
    """Take the restored passage from the same question in the question bank.

    The practice tests and the question bank share an item pool: 39 of these 50
    questions are the very same item as a bank question, confirmed on the prompt,
    on all four option texts and on which option is correct. Prompts here are
    boilerplate -- "Which choice best describes data from the graph..." recurs
    across the bank -- so the prompt alone is not evidence.

    That matters because the bank copies have been repaired and these have not.
    fetch_rw_figures.py and fetch_rw_underlines.py pulled the real chart, table or
    underline from College Board's API into `passageHtml`; the copies here were
    extracted from a PDF that lost them. So where the twin carries a restored
    passage, this adopts it, and the bank becomes the single place a passage is
    ever improved -- run this again and the improvement arrives here too.

    `passageHtml` is the whole test for "restored", rather than any judgement about
    which text reads better: it is set only by those two scripts and only from the
    API. Where the twin has none there is nothing to gain, and 29 of the 39
    passages are byte-identical anyway.

    Nothing else is adopted. The options, the derived rule, `chose` (which
    distractor took him -- recorded nowhere else) and the id all stay, so this
    question keeps its own history and its own place in "Missed in a test".
    """
    if not rows:
        return

    pool = []
    for path in sorted(glob.glob(BANK_GLOB)) + ([EDU_BANK] if EDU_BANK.exists() else []):
        try:
            pool.extend(json.loads(Path(path).read_text()))
        except (OSError, ValueError):
            continue
    if not pool:
        return

    # Indexed by prompt so this is not 50 x 1,838 comparisons of full option lists.
    by_prompt = defaultdict(list)
    for cand in pool:
        by_prompt[_norm(cand.get('question', ''))].append(cand)

    borrowed = matched = 0
    for row in rows:
        mine = sorted(_norm(o['text']) for o in row['options'])
        want = _norm(next((o['text'] for o in row['options']
                           if o['label'] == row.get('correctLabel')), ''))
        for cand in by_prompt.get(_norm(row.get('question', '')), []):
            if sorted(_norm(o['text']) for o in cand['options']) != mine:
                continue
            theirs = _norm(next((o['text'] for o in cand['options']
                                 if o['label'] == cand.get('correctLabel')), ''))
            if theirs != want:
                continue
            matched += 1
            if cand.get('passageHtml'):
                row['passageHtml'] = cand['passageHtml']
                row['hasBlank'] = cand.get('hasBlank', row.get('hasBlank', False))
                # Whatever the twin no longer needs, this no longer needs either.
                row.pop('figure', None)
                row.pop('pdf', None)
                row.pop('page', None)
                borrowed += 1
            break

    left = sum(1 for r in rows if r.get('figure'))
    print(f'  {matched} of {len(rows)} are the same item as a bank question; '
          f'{borrowed} took a restored passage'
          + (f'; {left} still need the PDF' if left else '; none still need the PDF'))


def main():
    try:
        import fitz  # noqa: F401
    except ImportError:
        sys.exit('PyMuPDF is needed: pip install pymupdf')

    all_rows, all_problems = [], []
    # A test can be recorded here before its PDFs are to hand -- the sheet is
    # marked the day he sits it, the papers arrive later. Those wait, named, and
    # everything else still builds. Only the case where NOTHING is present is an
    # error, because that is the run-from-the-wrong-directory mistake.
    ready = [t for t in TESTS
             if t['questions_pdf'].exists() and t['answers_pdf'].exists()]
    if not ready:
        sys.exit('No practice-test PDFs found -- run from the repo root.')
    for test in TESTS:
        if test not in ready:
            missing = [t['questions_pdf'].name for t in [test]
                       if not test['questions_pdf'].exists()]
            print(f'{test["label"]}: WAITING for {", ".join(missing) or "its answer key"}'
                  f' -- {sum(len(v) for v in test["missed"].values())} misses recorded,'
                  ' nothing extracted')
            continue
        rows, problems = build(test)
        all_rows += [(test.get('order', 0), r) for r in rows]
        all_problems += problems
        print(f'{test["label"]}: {len(rows)} questions')

    rows, problems = build_bluebook()
    all_rows += rows
    all_problems += problems
    if rows:
        print(f'{BLUEBOOK}: {len(rows)} questions')

    # The one place file order is decided. Sorted by `order` and otherwise stable,
    # so a test added today lands after everything already here and no existing
    # index moves -- see the note above TESTS, and by MISSED_FILE in app.js.
    all_rows.sort(key=lambda pair: pair[0])
    all_rows = [r for _, r in all_rows]

    # Progress is stored against the id, so two questions sharing one would share
    # his history and each overwrite the other's.
    dupes = [i for i, n in Counter(r['id'] for r in all_rows).items() if n > 1]
    for i in dupes:
        all_problems.append(f'{i}: duplicate id -- check the "module" on each')

    borrow_from_bank(all_rows)

    OUT.write_text(json.dumps(all_rows, indent=2, ensure_ascii=False) + '\n',
                   encoding='utf-8')
    print(f'\n{len(all_rows)} written to {OUT}')

    by_skill = Counter(r['realSkill'] for r in all_rows)
    for skill, n in by_skill.most_common():
        print(f'  {n:3}  {skill}')
    print(f'  {sum(1 for r in all_rows if r.get("underline"))} carry an underlined portion')

    # The paper and Bluebook tests are built from one item pool, so the same question
    # can turn up on both -- and a question he missed twice, on two sittings, is the
    # most telling thing in the whole set. Reported rather than deduplicated: both
    # rows are a true record of a separate attempt, and losing one would hide that it
    # happened twice.
    by_text = {}
    for r in all_rows:
        by_text.setdefault(re.sub(r'\W+', '', r['passage'].lower())[:120], []).append(r)
    twice = [rows for rows in by_text.values() if len(rows) > 1]
    if twice:
        print(f'\n  {len(twice)} question(s) missed on more than one test:')
        for rows in twice:
            where = ', '.join(f'{r["test"]} M{r["module"]}Q{r["number"]}' for r in rows)
            print(f'    {rows[0]["realSkill"] or "unclassified":<24} {where}')

    if all_problems:
        print(f'\n  {len(all_problems)} need a look:')
        for p in all_problems:
            print(f'    {p}')
    else:
        print('\n  every question parsed cleanly')


if __name__ == '__main__':
    main()
