"""Pull the 1,876 SAT Math questions from College Board's question bank API.

Why an API pull rather than another PDF extractor: book/maths-questionbank-export
-2026-8-12.pdf cannot be parsed. Its prose is text, but every equation, every
inline expression and every lone variable is drawn as vector paths with no font
behind them, so PyMuPDF sees `In the given equation,  and  are constants` and
1,069 of its 1,414 multiple-choice questions have all four choices blank. The
information is not in the file. It is in the API the site itself calls, as
MathML -- so this fetches that instead and the PDF is only used to cross-check
that we got every question.

Two endpoints, because the bank has two kinds of question:

    external_id (1,417)  POST .../questionbank/digital/get-question
    ibn         (459)    GET  saic.collegeboard.org/disclosed/{ibn}.json

Both are public -- no token, no session. Their payload shapes differ completely,
which is extract_math.py's problem, not this script's: here we save what comes
back, verbatim, and normalise later. Re-running is cheap because every response
is cached to disk and an existing file is never re-fetched.

Output:  book/math-api/<questionId>.json   (gitignored, ~1,876 files)
Run:     python3 fetch_math.py
"""

import http.cookiejar
import json
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

LIST_URL = ('https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
            '/questionbank/digital/get-questions')
QUESTION_URL = ('https://qbank-api.collegeboard.org/msreportingquestionbank-prod'
                '/questionbank/digital/get-question')
IBN_URL = 'https://saic.collegeboard.org/disclosed/{ibn}.json'

# asmtEventId 99 = SAT, test 2 = Math, and the four domain codes are the four
# Math score-report headings: H Algebra, P Advanced Math, Q Problem-Solving and
# Data Analysis, S Geometry and Trigonometry.
LIST_BODY = {'asmtEventId': 99, 'test': 2, 'domain': 'H,P,Q,S'}

OUT = Path('book/math-api')
INDEX = OUT / '_index.json'

# Their servers are doing us a favour, and they say so: a first attempt at 0.35s
# between requests drew a run of 504s about ninety questions in, and they cleared
# the moment we stopped. One request at a time, then, with a jittered beat between
# them so the pattern is not a metronome.
#
# But fail fast and come back for it. Every response is cached, so a question
# skipped now costs nothing but a second pass, whereas five retries on a rising
# backoff cost six minutes of the run standing still -- which is what a stall
# around question 400 turned out to be, while the API was answering a hand-run
# curl in 0.6 seconds. Two tries, then move on; the re-run collects the stragglers.
PAUSE = 1.1
JITTER = 0.5                  # so the request pattern is not a metronome
RETRIES = 2
BACKOFF = [10]                # seconds, per successive failure
COOL_OFF = 90                 # after CONSECUTIVE_LIMIT failures in a row
CONSECUTIVE_LIMIT = 4
TIMEOUT = 30

# Sent because the site's own XHR sends them, and a request that looks like the
# application it is imitating is the one least likely to be mistaken for abuse.
HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://satsuitequestionbank.collegeboard.org',
    'Referer': 'https://satsuitequestionbank.collegeboard.org/',
    'User-Agent': ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                   ' (KHTML, like Gecko) Chrome/128.0 Safari/537.36'),
}

# Recycled, not kept for the whole run. Their edge hands out an `_abck` bot-
# detection cookie, and once it decides a session has misbehaved it marks that
# cookie rather than the address -- after which every request carrying it fails
# while a freshly-opened one succeeds immediately. A run died exactly that way at
# question ~780: 22 minutes of solid failures from the script while curl was
# getting 200s in half a second. So the jar is thrown away periodically, and
# whenever a run of failures suggests the current one has gone bad.
JAR_EVERY = 100

opener = None


def new_session():
    global opener
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


new_session()


def get(url, body=None, timeout=TIMEOUT):
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(HEADERS)
    if data:
        headers['Content-Type'] = 'application/json'
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, data, headers)
            with opener.open(req, timeout=timeout) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            if attempt < len(BACKOFF):
                time.sleep(BACKOFF[attempt])
    raise RuntimeError(f'{url}: {last}')


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    listing = get(LIST_URL, LIST_BODY)
    print(f'{len(listing)} questions listed')
    INDEX.write_text(json.dumps(listing, indent=1))

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limit:
        print(f'stopping after {limit} new questions (pass no argument for all)')

    done = fetched = failed = 0
    errors = []
    consecutive = 0
    attempts_since_jar = [0]
    for i, q in enumerate(listing, 1):
        qid = q['questionId']
        path = OUT / f'{qid}.json'
        if path.exists():
            done += 1
            continue
        if limit and fetched >= limit:
            break
        if fetched and fetched % JAR_EVERY == 0 and attempts_since_jar[0]:
            new_session()
            attempts_since_jar[0] = 0
        attempts_since_jar[0] += 1
        try:
            if q.get('external_id'):
                body = get(QUESTION_URL, {'external_id': q['external_id']})
            else:
                body = get(IBN_URL.format(ibn=q['ibn']))
            # The listing row travels with the response: it carries the domain,
            # skill and difficulty, and none of that is in the question payload.
            path.write_text(json.dumps({'meta': q, 'body': body}))
            fetched += 1
            consecutive = 0
        except Exception as e:                      # noqa: BLE001 - reported, not raised
            failed += 1
            consecutive += 1
            errors.append((qid, str(e)[:120]))
            # A run of failures is not bad luck, it is a closed door. Waiting is
            # what reopened it last time; carrying on at speed is what shut it.
            if consecutive >= CONSECUTIVE_LIMIT:
                # New jar first: a flagged cookie will keep failing however long
                # we wait, and waiting was what made the last stall invisible.
                new_session()
                print(f'  {consecutive} failures in a row -- new session,'
                      f' pausing {COOL_OFF}s', flush=True)
                time.sleep(COOL_OFF)
                consecutive = 0
        time.sleep(PAUSE + random.uniform(0, JITTER))
        if i % 25 == 0:
            print(f'  {i}/{len(listing)}  cached {done}  fetched {fetched}'
                  f'  failed {failed}', flush=True)

    print(f'\ncached already {done}, fetched {fetched}, failed {failed}')
    for qid, err in errors[:20]:
        print(f'  FAILED {qid}: {err}')
    if failed:
        print('\nRe-run to retry the failures; everything already saved is skipped.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
