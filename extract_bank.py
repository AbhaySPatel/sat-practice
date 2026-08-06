"""Extract College Board SAT Suite question-bank PDFs into the app's bank format.

The exported PDFs are highly regular -- one question per page, with a fixed
header block, the passage, a stem, four labelled choices, the answer key, and a
rationale that discusses every choice in turn. This script turns that into the
same JSON shape the practice engine consumes.

A single export can mix several skills (a whole domain at once), so the skill
and domain are read from each question's own header rather than passed in. One
JSON file is written per skill found.

Usage:  python3 extract_bank.py "craft - structure.pdf"
        python3 extract_bank.py --all
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import fitz

BOOK_DIR = Path('book')
OUT_DIR = Path('banks')

# Without TEXT_INHIBIT_SPACES, PyMuPDF reads these PDFs' font metrics as calling
# for a space inside every "rt" pair -- "artist" comes out as "ar tist" and the
# corpus ends up with zero occurrences of "rt". The flag suppresses those
# invented spaces without dropping real ones.
TEXT_FLAGS = (
    fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_INHIBIT_SPACES
)

# The four Reading and Writing domains, longest first so that matching a header
# prefix never stops early on a shorter name.
DOMAINS = {
    'Standard English Conventions': 'standard-english',
    'Information and Ideas': 'information-ideas',
    'Craft and Structure': 'craft-structure',
    'Expression of Ideas': 'expression-of-ideas',
}

# Exports spell a few skills inconsistently; fold them onto one slug each.
SKILL_SLUGS = {
    'boundaries': 'boundaries',
    'form, structure, and sense': 'form-structure-sense',
    'transitions': 'transitions',
    'rhetorical synthesis': 'rhetorical-synthesis',
    'words in context': 'words-in-context',
    'text structure and purpose': 'text-structure-purpose',
    'cross-text connections': 'cross-text-connections',
    'command of evidence': 'command-of-evidence',
    'central ideas and details': 'central-ideas-details',
    'inferences': 'inferences',
}

re_block = re.compile(r'Question ID:\s*([0-9a-f]+)')
re_header = re.compile(
    r'Difficulty\s*\nSAT\s*\nReading and Writing\s*\n(.*?)\n(Easy|Medium|Hard)\s*\nQuestion\n',
    re.S,
)
re_correct = re.compile(r'Correct Answer:\s*([A-D])')
re_option = re.compile(r'^([A-D])\.\s*(.*)$')
re_convention = re.compile(r'(The convention being tested is[^.]*\.)')
# A question whose data lives in a table or chart cannot be answered from the
# extracted text: charts are vector art that does not survive, and tables come
# through as an unreadable run of cells.
re_needs_figure = re.compile(
    r'\b(the table|the graph|the chart|the figure|the bar graph|shown|as depicted)\b', re.I
)


def collapse(text):
    """PDF text wraps mid-sentence; join it back into flowing prose."""
    # Zero-width and non-breaking characters survive extraction and then show up
    # as stray gaps in the rendered question.
    text = text.replace('​', '').replace(' ', ' ').replace('﻿', '')
    return re.sub(r'\s+', ' ', text).strip()


def slugify_skill(name):
    return SKILL_SLUGS.get(name.strip().lower())


def split_header(chunk):
    """Separate the run-together 'Domain Skill' header line into its two parts."""
    text = collapse(chunk)
    for domain, slug in DOMAINS.items():
        if text.startswith(domain):
            return slug, text[len(domain):].strip()
    return None, None


# Every stem in these banks opens with one of a small set of phrases. Anchoring
# on those is what keeps the split correct: many passages end on the blank with
# no full stop after it, so splitting at the last sentence break instead would
# drag the blank -- and the sentence carrying it -- into the stem.
re_stem_start = re.compile(
    r'\b(Which |Based on the text|According to the text|As used in the text'
    r'|What does |What can |How does |How would |The student wants )'
)


def split_stem(chunk):
    """Separate the passage from the question stem."""
    text = collapse(chunk)
    end = text.rfind('?')
    if end == -1:
        return None, None

    head = text[:end + 1]
    matches = list(re_stem_start.finditer(head))
    if not matches:
        return None, None

    at = matches[-1].start()
    return head[:at].strip(), head[at:].strip()


def split_rationale(rationale, correct_label):
    """Split the rationale into one chunk per answer choice.

    The rationale opens with the case for the correct choice, then walks through
    the wrong ones as "Choice X is incorrect...". Splitting on those markers
    gives each option its own explanation.
    """
    text = collapse(rationale)
    marks = [(m.start(), m.group(1)) for m in re.finditer(r'Choice ([A-D]) (?:is|and)', text)]
    chunks = {}
    for i, (start, label) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        piece = text[start:end].strip()
        # A choice can be mentioned more than once; keep the fullest discussion.
        if label not in chunks or len(piece) > len(chunks[label]):
            chunks[label] = piece
    # Anything before the first marker belongs to the correct choice.
    if marks and marks[0][0] > 0:
        lead = text[:marks[0][0]].strip()
        if lead and correct_label in chunks:
            chunks[correct_label] = f'{lead} {chunks[correct_label]}'.strip()
    return chunks


def derive_rule(rationale, correct_why):
    """Pull a one-line takeaway from the rationale.

    Grammar rationales state it outright ("The convention being tested is X.").
    Otherwise fall back to the first sentence of the correct choice's
    explanation that actually says something -- "Choice C is the best answer."
    on its own teaches nothing.
    """
    m = re_convention.search(rationale)
    if m:
        return m.group(1)

    for sentence in re.split(r'(?<=[.!?])\s+', correct_why):
        stripped = sentence.strip()
        if not stripped or re.fullmatch(r'Choice [A-D] is the best answer\.?', stripped):
            continue
        # Drop the "Choice D is the best answer" preamble. Where it runs on as
        # "...best answer because it most logically...", the trailing clause is
        # left dangling, so shed the conjunction and recapitalise into a
        # sentence that stands on its own.
        stripped = re.sub(
            r'^Choice [A-D] is the best answer(?:[.,]|\s+because(?: it)?|\s+since)?\s*',
            '', stripped
        )
        # Splitting on ". " also fires inside abbreviations ("et al. "), which
        # leaves a fragment starting mid-word. Only accept a sentence that
        # actually begins like one.
        if len(stripped) > 20 and re.match(r'[A-Za-z“"]', stripped):
            return stripped[0].upper() + stripped[1:]
    return correct_why[:200]


def parse_options(chunk):
    """Read the A-D choices, keeping options that wrap onto extra lines."""
    options = []
    for line in chunk.split('\n'):
        line = line.strip()
        if not line:
            continue
        m = re_option.match(line)
        if m:
            options.append({'label': m.group(1), 'text': m.group(2).strip()})
        elif options:
            options[-1]['text'] = f"{options[-1]['text']} {line}".strip()
    return options


def parse_pdf(pdf_path):
    doc = fitz.open(pdf_path)
    full = '\n'.join(doc[p].get_text('text', flags=TEXT_FLAGS) for p in range(len(doc)))

    starts = [m.start() for m in re_block.finditer(full)]
    questions, skipped = [], Counter()

    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(full)
        block = full[start:end]
        qid = re_block.match(block).group(1)

        m_head = re_header.search(block)
        m_correct = re_correct.search(block)
        if not (m_head and m_correct):
            skipped['header or answer key not found'] += 1
            continue

        domain, skill_name = split_header(m_head.group(1))
        skill = slugify_skill(skill_name or '')
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

        # The banks use a six-underscore blank; the engine uses three.
        passage = re.sub(r'_{2,}', '___', passage)
        blanks = passage.count('___')
        if blanks > 1:
            skipped['more than one blank'] += 1
            continue

        if re_needs_figure.search(passage) or re_needs_figure.search(stem):
            skipped['depends on a table or chart'] += 1
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
        chunks = split_rationale(rationale, correct)
        if len(chunks) < 4:
            skipped['rationale did not cover all four choices'] += 1
            continue

        questions.append({
            'id': f'cb-{skill}-{qid}',
            'source': 'College Board SAT Suite question bank',
            'skill': skill,
            'domain': domain,
            'difficulty': m_head.group(2).lower(),
            'hasBlank': blanks == 1,
            'passage': passage,
            'question': stem,
            'rule': derive_rule(collapse(rationale), chunks[correct]),
            'correctLabel': correct,
            'options': [
                {'label': o['label'], 'text': o['text'], 'why': chunks[o['label']]}
                for o in opts
            ],
        })

    return questions, skipped


def write_by_skill(questions):
    """One file per skill, so the app can load and filter them independently."""
    OUT_DIR.mkdir(exist_ok=True)
    by_skill = defaultdict(list)
    for q in questions:
        by_skill[q['skill']].append(q)

    for skill, items in sorted(by_skill.items()):
        path = OUT_DIR / f'cb-{skill}.json'
        path.write_text(json.dumps(items, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        blanks = sum(1 for q in items if q['hasBlank'])
        print(f'  {path}  {len(items):4} questions  ({blanks} with a blank)')


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    names = [p.name for p in sorted(BOOK_DIR.glob('*.pdf'))] if args[0] == '--all' else args

    everything = []
    for name in names:
        path = BOOK_DIR / name
        if not path.exists():
            print(f'{name}: not found, skipping')
            continue
        questions, skipped = parse_pdf(path)
        if not questions and not skipped:
            continue  # not a question-bank export
        total = len(questions) + sum(skipped.values())
        print(f'\n{name}: {len(questions)} of {total} parsed')
        for reason, count in skipped.most_common():
            print(f'    skipped {count:4}  {reason}')
        everything.extend(questions)

    print(f'\nTotal parsed: {len(everything)}')
    write_by_skill(everything)


if __name__ == '__main__':
    main()
