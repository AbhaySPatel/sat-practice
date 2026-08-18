"""Restore Reading and Writing passages from the API, for any bank file.

The PDF extraction produced one flat run of text per passage: paragraph breaks,
italics and the "Text 1" / "Text 2" headings of a cross-text question were all
lost. For most skills that is cosmetic. For cross-text-connections it is not --
the whole question is one text against the other, and

    Text 1 Literary scholars have struggled with ... same time. Text 2 It is
    tempting to impose a linear sense of order ...

gives him no way to tell where the first text ends. Two earlier scripts fixed
subsets of this by fetching the API's `stimulus` field (the figures, then the lost
underlines); this does the same for whichever questions are named, and is the
general form of both.

Usage:
    python3 fetch_rw_passages.py cross-text-connections     # one skill
    python3 fetch_rw_passages.py --poems                    # every poem, any skill
    python3 fetch_rw_passages.py --all                      # every bank file

Only questions that do not already carry `passageHtml` are fetched, so re-running
costs nothing and a partial run can be resumed. Banks are patched in place by
ADDING a field -- no question moves and no array is reordered, because the app's
saved cursor is an index into bank order.
"""

import glob
import json
import re
import random
import sys
import time
from pathlib import Path

from fetch_rw_figures import (JAR_EVERY, JITTER, LIST_BODY, LIST_URL, PAUSE,
                              QUESTION_URL, build_passage, new_session, post)

BANKS = Path('banks')


# A poem arrives from the PDF as one unbroken run -- every line of verse joined
# end to end into a paragraph, which is how Abhay met it on screen. The API keeps
# the structure (a blockquote, one <p> per line), so these want restoring whether
# or not their skill does. They span nine of the ten skill files, so selecting
# them by skill would mean fetching the whole bank.
POEM = re.compile(r'\bpoems?\b|\bsonnet\b|\bstanzas?\b|\bverse\b', re.I)


def wanted(question, mode):
    if mode != '--poems':
        return True
    text = (question.get('passage') or '') + ' ' + (question.get('question') or '')
    return bool(POEM.search(text))


def bank_files(skill):
    if skill in ('--all', '--poems'):
        return sorted(BANKS.glob('cb-*.json')) + [BANKS / 'educator-question-bank.json']
    path = BANKS / f'cb-{skill}.json'
    if not path.exists():
        names = sorted(p.stem[3:] for p in BANKS.glob('cb-*.json'))
        print(f'No banks/cb-{skill}.json. Known skills:\n  ' + '\n  '.join(names))
        return []
    return [path]


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip().split('Usage:')[1].strip())
        return 1
    files = bank_files(sys.argv[1])
    if not files:
        return 1

    listing = post(LIST_URL, LIST_BODY)
    by_qid = {q['questionId']: q for q in listing}
    print(f'{len(listing)} Reading and Writing questions listed by the API')

    total = fixed = skipped = failed = 0
    for path in files:
        rows = json.loads(path.read_text())
        # The College Board id is the last segment of ours, in every bank file.
        todo = [q for q in rows if not q.get('passageHtml')
                and q['id'].rsplit('-', 1)[-1] in by_qid
                and wanted(q, sys.argv[1])]
        already = sum(1 for q in rows if q.get('passageHtml'))
        print(f'\n{path.name}: {len(rows)} questions, {already} already restored, '
              f'{len(todo)} to fetch')
        got = 0
        for i, q in enumerate(todo, 1):
            row = by_qid[q['id'].rsplit('-', 1)[-1]]
            if not row.get('external_id'):
                skipped += 1
                continue
            try:
                d = post(QUESTION_URL, {'external_id': row['external_id']})
            except Exception as e:                      # noqa: BLE001 - reported
                print(f'  FAILED {q["id"]}: {str(e)[:70]}')
                failed += 1
                time.sleep(PAUSE)
                continue
            stimulus = d.get('stimulus') or ''
            if not stimulus.strip():
                # Not every question has a stimulus: a Boundaries item is a single
                # sentence carried in the stem. Nothing to restore, and nothing wrong.
                skipped += 1
                time.sleep(PAUSE)
                continue

            body, plain, had_blank = build_passage(stimulus, q['id'])
            q['passageHtml'] = body
            q['hasBlank'] = had_blank
            q.pop('figure', None)
            q.pop('pdf', None)
            q.pop('page', None)
            got += 1
            fixed += 1
            if fixed % JAR_EVERY == 0:
                new_session()
            time.sleep(PAUSE + random.uniform(0, JITTER))
            if i % 25 == 0:
                print(f'  {i}/{len(todo)}  restored {got}', flush=True)
        total += len(rows)
        if got:
            path.write_text(json.dumps(rows, indent=1))
            print(f'  {got} restored, {path.name} rewritten')

    print(f'\n{fixed} passages restored across {len(files)} file(s); '
          f'{skipped} had no stimulus to take; {failed} failed')
    if failed:
        print('Re-run to retry: anything restored is skipped next time.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
