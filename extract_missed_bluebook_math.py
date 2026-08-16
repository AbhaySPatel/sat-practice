#!/usr/bin/env python3
"""The maths questions Abhay missed in the Bluebook app, taken from the bank.

Bluebook gives no printable question -- the review screen renders its maths as
MathML that does not survive a copy, so a paste arrives as "defined as more than
times a number".  But every one of these questions is also in the College Board
question bank we already hold, complete with MathML, its SVG figures, its four
choices and its official answer.  So none of them is typed in: each is matched to
its bank entry and adopted whole.

Matching is by a distinctive phrase AND the official answer.  Both have to agree
or the question is refused, so a phrase that happens to appear twice cannot
quietly attach the wrong item.

Everything he supplied that the bank does not know -- which test, which day, and
what he actually picked -- is carried in the table below.

Run:  python3 extract_missed_bluebook_math.py
"""

from pathlib import Path
import glob
import json
import re

OUT_JSON = Path('banks/missed-math-bluebook.json')

# test label, date, question number as Bluebook shows it, the phrase that finds
# it, the official answer (checked against the bank), and what he put.
#
# `module` is None throughout: Bluebook's review header prints the question number
# but not the module, and Practice 7 has two Question 21s while Practice 4 has two
# Question 22s. Rather than guess, the number is shown without a module.
MISSED = [
    # ---- Practice 4, 25 July 2026 ----
    ('Practice 4', '2026-07-25', 22, 'translated down',                 '59/9',   '-2.3'),
    ('Practice 4', '2026-07-25', 21, 'identical rectangular prisms',    'B',      None),
    ('Practice 4', '2026-07-25', 22, 'parabola has vertex',             'D',      None),
    ('Practice 4', '2026-07-25', 11, '2 left parenthesis k x minus n',  '-14/15', '-1.2'),
    ('Practice 4', '2026-07-25', 14, 'consists of the heights of',      '44',     '47'),
    ('Practice 4', '2026-07-25', 17, 'adding 56',                       'C',      'A'),
    ('Practice 4', '2026-07-25', 20, 'rational function',               'C',      'A'),
    # ---- Practice 5, 6 August 2026 ----
    ('Practice 5', '2026-08-06',  6, 'range of the',                    '29',     '232/7'),
    ('Practice 5', '2026-08-06', 11, 'How many solutions does the equation 12', 'A', 'D'),
    ('Practice 5', '2026-08-06', 14, '1.84',                            'A',      'B'),
    ('Practice 5', '2026-08-06', 17,
     'positive constants, which equation could define',                'A',      'B'),
    ('Practice 5', '2026-08-06', 18, 'area, in square units, of triangle', '480', '420'),
    # ---- Practice 6, 10 August 2026 ----
    ('Practice 6', '2026-08-10', 21, 'zebras',                          '79',     '27'),
    ('Practice 6', '2026-08-10', 16, 'grove has',                       'C',      'B'),
    # Separated from a dozen near-identical stems by its own table values.
    ('Practice 6', '2026-08-10', 20,
     ('corresponding values of g', 'negative 27 -27 3 3'),             'A',      'D'),
    # ---- Practice 7, 15 August 2026 ----
    ('Practice 7', '2026-08-15', 21, 'times a number',                  'A',      'B'),
    ('Practice 7', '2026-08-15', 21, 'carpet cleaner',                  'A',      'B'),
]

# Bluebook's own date ordering, kept apart from the paper tests' `order` numbers
# so the two series never interleave in the Test dropdown.
ORDER = {'Practice 4': 11, 'Practice 5': 12, 'Practice 6': 13, 'Practice 7': 14}


def load_bank():
    out = []
    for path in sorted(glob.glob('banks/math-*.json')):
        if 'index' in path:
            continue
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if isinstance(data, list):
            out.extend(data)
    return out


def plain(question):
    """The stem with markup stripped, for phrase matching."""
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', question.get('question') or ''))


def official(question):
    """Every form of the answer the bank accepts, as strings."""
    answers = [str(a) for a in (question.get('answers') or [])]
    if question.get('correctLabel'):
        answers.append(question['correctLabel'])
    return answers


def find(bank, phrase, answer):
    """The one bank question matching BOTH the phrase(s) AND the official answer.

    `phrase` may be a tuple, in which case every part must appear. Two of these
    questions share their opening sentence with a dozen others and are separated
    only by the values in their own table, so one phrase is not always enough.
    """
    parts = phrase if isinstance(phrase, tuple) else (phrase,)
    hits = [q for q in bank
            if all(part.lower() in plain(q).lower() for part in parts)]
    exact = [q for q in hits if answer in official(q)]
    if len(exact) == 1:
        return exact[0]
    return None, len(hits), len(exact)


def main():
    bank = load_bank()
    print(f'{len(bank)} maths questions in the bank\n')

    out, failed = [], 0
    for label, taken, number, phrase, answer, chose in MISSED:
        found = find(bank, phrase, answer)
        if isinstance(found, tuple):
            _, hits, exact = found
            print(f'  ! {label} Q{number}: {phrase!r} -> {hits} hit(s), '
                  f'{exact} with answer {answer}. REFUSED.')
            failed += 1
            continue

        entry = {
            'id': f"missed-bb-{label.split()[-1]}-q{number}-{found['id'].split('-')[-1]}",
            'skill': 'missed-in-test',
            'realSkill': 'math',
            'section': 'math',
            'domain': 'extra',
            'domainLabel': 'Extras',
            'skillLabel': 'Missed in a test',
            'source': 'Bluebook practice test',
            'test': label,
            'testOrder': ORDER[label],
            'taken': taken,
            'module': None,
            'number': number,
            # Adopted whole from the bank: the MathML and any SVG figure ride in
            # questionHtml, so these render without the 33 MB maths banks loaded.
            'questionHtml': found.get('questionHtml'),
            'question': found.get('question'),
            'figure': bool(found.get('figure')),
            'format': found.get('format'),
            'difficulty': found.get('difficulty'),
            # What the bank calls it -- far better than "Math", and it is the
            # College Board's own classification of the thing he got wrong.
            'bankSkill': found.get('skill'),
            'bankId': found['id'],
            'chose': chose,
        }
        if found.get('format') == 'spr':
            entry['answers'] = found.get('answers')
        else:
            entry['correctLabel'] = found.get('correctLabel')
            entry['options'] = found.get('options')
        out.append(entry)
        fig = ' +figure' if found.get('figure') else ''
        print(f"  {label} Q{number:<2} -> {found['id']}  {found.get('skill')}"
              f"  [{found.get('difficulty')}]{fig}")

    out.sort(key=lambda q: (q['testOrder'], q['number']))
    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'\nwrote {len(out)} questions to {OUT_JSON}'
          + (f'  ({failed} refused)' if failed else ''))


if __name__ == '__main__':
    main()
