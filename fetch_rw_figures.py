"""Give the "you need the figure" questions their figure, from the same API as Maths.

138 questions in banks/educator-question-bank.json were extracted from a PDF whose
graph or table is not text, so the app could only tell him to open the export at a
page number. Their passages are the graph's own axis labels flattened into the
prose -- "1,300 1,200 1,100 1,000 900 ... Number of municipalities no response
responded to inquiry" -- which is unreadable and unanswerable.

The API that fixed Maths serves Reading and Writing too (`test: 1`), and its
payload has a field the Maths one does not: `stimulus`, holding the passage
complete with the figure as inline SVG or a real <table>, plus an aria-label
describing the graph. So the figure was always available; the PDF was simply the
wrong place to have looked for it.

Every one of the 138 carries its College Board id inside its own id
(`edu-command-of-evidence-a15b3219`), so they match the listing exactly -- no
guessing, and the script reports any that do not.

Two details worth knowing:

  * 87 of them are "use data from the table to complete the statement" questions
    with a real cloze blank. The API writes it as
    `<span aria-hidden="true">______</span><span class="sr-only">blank</span>`;
    that becomes the app's own `#passageBlank`, so fillBlank keeps working and the
    screen-reader duplicate does not appear on screen as the word "blank".
  * The existing PDF-extracted `passage` is kept, not replaced. It is the fallback
    if a question fails to fetch, and it costs a few KB.

Rewrites banks/educator-question-bank.json in place, preserving array order --
the saved cursor is an index into bank order, so reordering would move the place
Abhay was holding.

Run:  python3 fetch_rw_figures.py
"""

import http.cookiejar
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# The sanitiser, the id namespacing and the style filter are all shared with Maths
# -- one whitelist, one place to fix it.
from extract_math import clean, namespace_ids

BANK = Path('banks/educator-question-bank.json')

LIST_URL = ('https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
            '/questionbank/digital/get-questions')
QUESTION_URL = ('https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
                '/questionbank/digital/get-question')
# test 1 = Reading and Writing; the four domain codes are its score-report headings.
LIST_BODY = {'asmtEventId': 99, 'test': 1, 'domain': 'INI,CAS,EOI,SEC'}

HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://satsuitequestionbank.collegeboard.org',
    'Referer': 'https://satsuitequestionbank.collegeboard.org/',
    'User-Agent': ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                   ' (KHTML, like Gecko) Chrome/128.0 Safari/537.36'),
}

# Same pacing lesson as fetch_math.py: their edge flags the session cookie rather
# than the address, so the jar is recycled and failures are not retried to death.
PAUSE, JITTER, RETRIES, BACKOFF, TIMEOUT = 1.1, 0.5, 2, 10, 30
JAR_EVERY = 60

opener = None


def new_session():
    global opener
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


new_session()


def post(url, body):
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(
                url, json.dumps(body).encode(),
                {**HEADERS, 'Content-Type': 'application/json'})
            with opener.open(req, timeout=TIMEOUT) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last = e
            if attempt + 1 < RETRIES:
                time.sleep(BACKOFF)
    raise RuntimeError(str(last)[:160])


# The blank, as the API writes it: a visible run of underscores plus a
# screen-reader-only word. Both are replaced by one marker, because the app has its
# own blank element and the word "blank" must not end up rendered as prose.
re_api_blank = re.compile(
    r'<span[^>]*aria-hidden="true"[^>]*>\s*_+\s*</span>'
    r'(?:\s*<span[^>]*class="sr-only"[^>]*>[^<]*</span>)?',
    re.I)
BLANK_TOKEN = '@@APPBLANK@@'
# Matches what renderPassage builds for a text passage, so fillBlank finds it.
BLANK_HTML = '<span class="blank" id="passageBlank"> </span>'
# Any sr-only span left over elsewhere: it duplicates neighbouring text for a
# screen reader and would show up twice on screen.
re_sr_only = re.compile(r'<span[^>]*class="sr-only"[^>]*>[^<]*</span>', re.I)


def build_passage(stimulus, qid):
    """API stimulus -> sanitised HTML carrying the app's own blank."""
    marked = re_api_blank.sub(BLANK_TOKEN, stimulus or '')
    marked = re_sr_only.sub('', marked)
    body, text, _ = clean(marked)
    body = namespace_ids(body, qid)
    # After sanitising, so the blank is markup this file emits rather than markup
    # it received -- `class` and `id` are not on the whitelist by design.
    had_blank = BLANK_TOKEN in body
    body = body.replace(BLANK_TOKEN, BLANK_HTML)
    return body, re.sub(r'\s+', ' ', text.replace(BLANK_TOKEN, ' ___ ')).strip(), had_blank


def main():
    bank = json.loads(BANK.read_text())
    targets = [q for q in bank if q.get('figure')]
    if not targets:
        print('Nothing flagged as needing a figure. Already done?')
        return 0
    print(f'{len(targets)} questions need their figure')

    listing = post(LIST_URL, LIST_BODY)
    print(f'{len(listing)} Reading and Writing questions listed by the API')
    by_qid = {q['questionId']: q for q in listing}

    fixed = failed = blanks = 0
    problems = []
    for i, q in enumerate(targets, 1):
        cb_id = q['id'].rsplit('-', 1)[-1]
        row = by_qid.get(cb_id)
        if not row or not row.get('external_id'):
            problems.append((q['id'], 'not in the API listing'))
            failed += 1
            continue
        try:
            d = post(QUESTION_URL, {'external_id': row['external_id']})
        except Exception as e:                       # noqa: BLE001 - reported
            problems.append((q['id'], str(e)[:90]))
            failed += 1
            time.sleep(PAUSE)
            continue

        stimulus = d.get('stimulus') or ''
        if not stimulus.strip():
            problems.append((q['id'], 'API returned no stimulus'))
            failed += 1
            time.sleep(PAUSE)
            continue

        html_body, plain, had_blank = build_passage(stimulus, q['id'])
        q['passageHtml'] = html_body
        # The old PDF-extracted passage stays as the fallback; `hasBlank` is
        # restated from what the markup actually contains rather than trusted.
        q['hasBlank'] = had_blank
        q['figureInline'] = ('<svg' in html_body) or ('<table' in html_body)
        # The whole point: there is nothing to go to the PDF for any more.
        q.pop('figure', None)
        q.pop('pdf', None)
        q.pop('page', None)
        fixed += 1
        if had_blank:
            blanks += 1

        if fixed % JAR_EVERY == 0:
            new_session()
        time.sleep(PAUSE + random.uniform(0, JITTER))
        if i % 25 == 0:
            print(f'  {i}/{len(targets)}  fixed {fixed}  failed {failed}', flush=True)

    BANK.write_text(json.dumps(bank, indent=1))
    print(f'\n{fixed} questions now carry their figure inline '
          f'({blanks} of them with a cloze blank)')
    print(f'  still flagged as needing the PDF: '
          f'{sum(1 for q in bank if q.get("figure"))}')
    for qid, why in problems[:15]:
        print(f'  FAILED {qid}: {why}')
    if failed:
        print('\nRe-run to retry: anything already fixed no longer carries the flag.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
