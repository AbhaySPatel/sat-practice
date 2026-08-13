"""Give the "Needs the PDF" questions their underline back, and dissolve the group.

88 questions ask about "the underlined portion" or "the underlined claim", and the
PDF extraction lost the underline -- leaving a question that cannot be answered at
all. find_defective.py collected them into banks/defective.json, and the app
retagged them to a "Needs the PDF" skill in the Extras group and told him to read
the source instead.

The same API field that fixed the figure questions carries the underline: the
`stimulus` marks the referenced portion either as a real `<u>` or as
`<span role="region" aria-label="Referenced Content">`. On a 30-question sample 27
came through marked, so nearly all of these are answerable in the app after all.

Why this matters beyond 88 questions: 60 of them are text-structure-purpose, which
sits in Craft and Structure -- the largest of Abhay's weak domains and the one band
that did not move between Practice 5 and Practice 6. They were hidden in a group
labelled "not score-report skills", which is the opposite of where they belong.

What this does NOT do is delete the mechanism. defective.json, the retagging and
the notice all stay: a future test or extraction will produce a question that
genuinely cannot be rendered, and that is a real escape hatch. Only the population
changes -- anything successfully fixed is removed from the file, and whatever is
left is a question that truly needs the PDF.

Patches banks/cb-*.json in place by ADDING a field. No question moves and no array
is reordered, because the saved cursor is an index into bank order.

Run:  python3 fetch_rw_figures.py   (first: it is what proved the route)
      python3 fetch_rw_underlines.py
"""

import json
import random
import re
import sys
import time
from pathlib import Path

# The fetch, the pacing, the sanitiser and the blank handling are all shared with
# the figure fix -- same API, same field, same whitelist.
from fetch_rw_figures import (LIST_BODY, LIST_URL, QUESTION_URL, PAUSE, JITTER,
                              JAR_EVERY, build_passage, new_session, post)

DEFECTIVE = Path('banks/defective.json')
BANKS = Path('banks')

# THREE ways College Board marks the referenced portion, not two. The first pass
# tested only the first two and wrote four questions off as unmarkable; all four
# turned out to use the third. Any of them is enough.
re_marked = re.compile(
    r'<u>|aria-label="Referenced Content"|text-decoration:\s*underline', re.I)


def main():
    doc = json.loads(DEFECTIVE.read_text())
    questions = doc.get('questions') or {}
    if not questions:
        print('defective.json holds no questions. Already done?')
        return 0
    print(f'{len(questions)} questions currently need the PDF')

    listing = post(LIST_URL, LIST_BODY)
    by_qid = {q['questionId']: q for q in listing}
    print(f'{len(listing)} Reading and Writing questions listed by the API')

    # Every cb-*.json, indexed by question id so a patch lands in the right file.
    files = sorted(BANKS.glob('cb-*.json'))
    loaded = {f: json.loads(f.read_text()) for f in files}
    where = {}
    for f, rows in loaded.items():
        for row in rows:
            where[row['id']] = (f, row)
    print(f'{len(where)} questions across {len(files)} bank files')

    fixed, unmarked, missing, failed = [], [], [], []
    touched = set()
    for i, (key, meta) in enumerate(list(questions.items()), 1):
        target = where.get(key)
        if not target:
            missing.append((key, 'not found in any cb-*.json'))
            continue
        row = by_qid.get(key.rsplit('-', 1)[-1])
        if not row or not row.get('external_id'):
            missing.append((key, 'not in the API listing'))
            continue
        try:
            d = post(QUESTION_URL, {'external_id': row['external_id']})
        except Exception as e:                        # noqa: BLE001 - reported
            failed.append((key, str(e)[:80]))
            time.sleep(PAUSE)
            continue

        stimulus = d.get('stimulus') or ''
        if not re_marked.search(stimulus):
            # Left in defective.json on purpose. Rendering it would give him the
            # same unanswerable question, only without the notice explaining why.
            unmarked.append((key, meta.get('skill')))
            time.sleep(PAUSE)
            continue

        body, plain, had_blank = build_passage(stimulus, key)
        f, q = target
        q['passageHtml'] = body
        q['hasBlank'] = had_blank
        touched.add(f)
        fixed.append(key)

        if len(fixed) % JAR_EVERY == 0:
            new_session()
        time.sleep(PAUSE + random.uniform(0, JITTER))
        if i % 20 == 0:
            print(f'  {i}/{len(questions)}  fixed {len(fixed)}'
                  f'  unmarked {len(unmarked)}  failed {len(failed)}', flush=True)

    for f in sorted(touched):
        f.write_text(json.dumps(loaded[f], indent=1))
    print(f'\n{len(fixed)} questions now carry their underline; '
          f'{len(touched)} bank file(s) rewritten')

    # Whatever could not be fixed stays, so the escape hatch keeps working.
    for key in fixed:
        questions.pop(key, None)
    doc['questions'] = questions
    DEFECTIVE.write_text(json.dumps(doc, indent=1))
    print(f'defective.json now holds {len(questions)} question(s)')

    if unmarked:
        import collections
        print(f'\n{len(unmarked)} left because the API marks no referenced portion:')
        for skill, n in collections.Counter(s for _, s in unmarked).most_common():
            print(f'    {n:3}  {skill}')
    for key, why in (missing + failed)[:10]:
        print(f'  PROBLEM {key}: {why}')
    if failed:
        print('\nRe-run to retry the failures; anything fixed is already out of the file.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
