#!/usr/bin/env python3
"""Find the bank questions Abhay has already met by sitting a practice test.

The app knew about a test question only when he got it WRONG: the missed sets are
the whole record of a sitting, so "never attempted" counted every question he
answered correctly on paper as untouched. That was 1,816 of 1,838 Reading and
Writing questions outstanding on a bank he had in fact worked a seventh of.

The practice tests are not a separate pool. They are the question bank, sampled:
matching passage text finds 50, 48, 57, 53 and 59 bank questions inside tests 5
to 9 -- against 54 Reading and Writing questions per test, so very nearly all of
one. 267 distinct questions across the five.

A match must agree on both the passage and the question stem. Passage alone was
already unambiguous -- no two bank questions share the probe -- but a test can
put a different question to a passage the bank also uses, and crediting a
question he never saw is the one error worth ruling out here. Every one of the
267 clears both checks.

Maths is deliberately absent. Its questions in these PDFs are drawn as vector
paths with no font behind them -- the same wall fetch_math.py hit -- so there is
no text to match. The maths credit stays what extract_missed_bluebook_math.py
matched by hand, and this script never touches it.

Output:  banks/seen-in-tests.json
Run:     python3 extract_test_seen.py
"""

import json
import re
from pathlib import Path

import fitz

BANKS = Path('banks')
BOOK = Path('book')
OUT = BANKS / 'seen-in-tests.json'

# The answer-key PDFs quote every question again inside their rationales, so
# including them would credit the whole bank. Only the test papers count.
TESTS = sorted(p for p in BOOK.glob('sat-practice-test-*-digital.pdf')
               if 'answers' not in p.name)

# Long enough to be unique to one question, taken from the middle so a passage
# that opens with a shared rubric still lands on its own words.
PROBE_FROM, PROBE_TO = 40, 110
STEM_CHARS = 60
MIN_PASSAGE = 80


def norm(text):
    """Whitespace and punctuation are what differ between the PDF and the JSON."""
    return re.sub(r'\W+', ' ', text or '').lower().strip()


def label_of(path):
    match = re.search(r'test-(\d+)', path.name)
    return f'Practice {match.group(1)}' if match else path.stem


def load_bank():
    rows = []
    for path in sorted(BANKS.glob('cb-*.json')) + [BANKS / 'educator-question-bank.json']:
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        rows += data['questions'] if isinstance(data, dict) else data
    return rows


def main():
    bank = load_bank()
    print(f'{len(bank)} Reading and Writing questions in the bank')
    if not TESTS:
        raise SystemExit('No practice test PDFs in book/ -- nothing to match against.')

    seen = {}
    for path in TESTS:
        text = norm(''.join(page.get_text() for page in fitz.open(path)))
        label, found = label_of(path), 0
        for question in bank:
            passage = norm(question.get('passage'))
            if len(passage) < MIN_PASSAGE:
                continue
            if passage[PROBE_FROM:PROBE_TO] not in text:
                continue
            stem = norm(question.get('question'))[:STEM_CHARS]
            # A passage the test reuses for a question the bank asks differently
            # is not a question he answered, so the stem has to be there too.
            if not stem or stem not in text:
                continue
            found += 1
            seen.setdefault(question['id'], []).append(label)
        print(f'  {label:<12} {found:3} bank questions')

    OUT.write_text(json.dumps({
        'note': 'Bank questions that appear in a practice test Abhay has sat, so the '
                'app can count them as attempted even though he never met them in it. '
                'Matched on passage and question stem by extract_test_seen.py.',
        'source': 'College Board SAT practice tests 5-9 (digital)',
        'seen': {qid: tests for qid, tests in sorted(seen.items())},
    }, indent=1))

    repeats = sum(1 for tests in seen.values() if len(tests) > 1)
    print(f'\n{len(seen)} distinct bank questions across {len(TESTS)} tests -> {OUT}')
    if repeats:
        print(f'  {repeats} of them appear in more than one test')


if __name__ == '__main__':
    main()
