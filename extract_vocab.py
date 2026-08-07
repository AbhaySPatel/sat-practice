"""Build banks/vocab.json -- every option word from the Words in Context bank,
with the sentence it appeared in and, where College Board supplied one, a gloss.

The words are not chosen by us. They are the options College Board wrote for its
own questions, so they are SAT vocabulary at SAT difficulty by definition. That
makes this a better wordlist than any published one: it is what the test actually
uses, not a guess at what it might.

Glosses come from the per-option rationale text already in the bank. The rationale
usually explains the word as part of arguing for or against the choice -- "As used
in this context, 'transformed' means substantially changed" -- so the definition is
already there, just buried mid-paragraph and only visible after answering.

Run:  python3 extract_vocab.py
"""

import json
import re
import sys
from pathlib import Path
from collections import Counter

BANK = Path('banks/cb-words-in-context.json')
OUT = Path('banks/vocab.json')

# Hand-written fallbacks for words the rationale never defined. An extracted gloss
# still wins where one exists, because it is specific to the sentence the word was
# doing work in, which is the whole point of Words in Context.
MANUAL = Path('banks/vocab-glosses.json')

# Ordered most-specific first: the earlier patterns carry the context framing that
# makes a gloss trustworthy, so they win over the looser ones.
GLOSS_PATTERNS = [
    # As used in this context, "word" means X
    r'(?:as used in this context|in this context)[, ]+"?{w}"?[,]?\s+(?:means|refers to|would mean)\s+(?P<d>[^.;]+)',
    # "word" means X   /   "word" refers to X   /   "word" would mean X
    r'"{w}"[,]?\s+(?:means|meaning|refers to|would mean|would refer to|is defined as)\s+(?P<d>[^.;]+)',
    # word means X      (unquoted -- common when the word opens a sentence)
    r'\b{w}\b\s+(?:means|would mean|refers to)\s+(?P<d>[^.;]+)',
    # the word "word", meaning X
    r'"{w}"[,]?\s*,?\s*meaning\s+(?P<d>[^.;]+)',
    # word, or X,          (College Board's other habit)
    r'\b{w}\b,\s+or\s+(?P<d>[^.,;]+)',
    # "word" describes X / suggests X / indicates X
    r'"{w}"[,]?\s+(?:describes|suggests|indicates|implies)\s+(?P<d>[^.;]+)',
    # to word is to X   /   to be word is to X
    r'\bto\s+(?:be\s+)?{w}\b\s+is\s+to\s+(?P<d>[^.;]+)',
    # something word is X
    r'"{w}"[,]?\s+is\s+(?P<d>[^.;]+)',
]

# Where a captured definition stops being a definition and becomes College Board
# arguing about the question. Cut at the first of these.
TAIL = re.compile(
    r',?\s+(?:neither|none of which|not what|'
    # "which would/wouldn't/doesn't..." -- the apostrophe may be curly
    r'which (?:would|does|is|are|do|did)(?:n[’\']?t)?|'
    r'but (?:the|there|nothing|this|that)|'
    r'and (?:the|this|that|nothing|there)\b|'
    r'so the|whereas|however|although|though the|yet the|'
    r'nothing in the|there is no|rather than|instead of the)\b', re.I
)

# A gloss that still ends on a dangling connective was cut in the wrong place.
DANGLING = re.compile(r'\b(?:and|or|but|which|that|of|to|in|for|with|the|a|an)$', re.I)

# Rationale text that is argument, not definition. A gloss matching these is
# describing the question rather than the word, so it is worse than none.
REJECT = re.compile(
    r'^(?:the |a |an )?(?:best|correct|incorrect|logical|text|passage|choice|author|'
    r'this|that|it|not |never )', re.I
)


def clean(defn):
    """Tidy a captured definition, or return None if it is not usable."""
    d = defn.strip()
    # Cut where the rationale turns from defining to arguing.
    d = TAIL.split(d)[0]
    # College Board quotes its own definitions -- '"unclear" or "open to..."' --
    # so strip quote marks throughout, not just at the ends.
    d = d.replace('"', ' ').replace('“', ' ').replace('”', ' ')
    d = re.sub(r'\s+', ' ', d).strip()
    d = re.sub(r'^(?:to be |being |that is |i\.e\.,? )', '', d, flags=re.I)
    d = d.rstrip(' ,;:')
    # Trim a trailing connective, then any comma it was hanging off.
    while DANGLING.search(d):
        d = DANGLING.sub('', d).rstrip(' ,;:')
    # A gloss longer than this has run into the next clause and stopped being one.
    if not (2 < len(d) <= 80):
        return None
    if REJECT.match(d):
        return None
    return d


def load_manual():
    if not MANUAL.exists():
        return {}
    raw = json.loads(MANUAL.read_text(encoding='utf-8')).get('glosses', {})
    return {k.strip().lower(): v for k, v in raw.items() if v}


def find_gloss(word, why):
    if not why:
        return None
    esc = re.escape(word)
    for pat in GLOSS_PATTERNS:
        m = re.search(pat.format(w=esc), why, re.I)
        if not m:
            continue
        d = clean(m.group('d'))
        if d and word.lower() not in d.lower():
            return d
    return None


# Sentence boundary: .!? possibly followed by a closing quote, then whitespace.
# The closing-quote case is why the old rfind('. ') approach failed on passages
# like 'Drowne's Wooden Image. ” Drowne, a young man...' and returned four
# sentences at once.
SENTENCE_END = re.compile(r'(?<=[.!?])[”"’\']?\s+')


def sentence_around(passage, blank='___'):
    """The single sentence holding the blank. Enough context to see the word at
    work, without making him re-read a paragraph."""
    if not passage or blank not in passage:
        return ''

    parts = SENTENCE_END.split(passage)
    for part in parts:
        if blank in part:
            s = part.strip()
            # Drop the "The following text is adapted from..." preamble if the
            # blank happens to share a chunk with it.
            s = re.sub(r'^The following text is adapted from[^.]*\.\s*', '', s)
            return s.strip()
    return ''


def main():
    if not BANK.exists():
        sys.exit(f'{BANK} not found -- run from the repo root.')

    data = json.loads(BANK.read_text(encoding='utf-8'))
    items = data if isinstance(data, list) else data.get('questions', data)
    manual = load_manual()

    entries = {}
    per_question = []

    for q in items:
        if q.get('skill') != 'words-in-context':
            continue
        sentence = sentence_around(q.get('passage', ''))
        answer = q.get('correctLabel')

        # The question's own vocabulary set: all four words with their glosses,
        # kept together so the app can show them beside the question he is on.
        # The full passage is not copied -- it already lives in the skill bank the
        # app loads anyway, and `id` joins the two.
        qrow = {
            'id': q.get('id'),
            'difficulty': q.get('difficulty'),
            'prompt': q.get('question'),
            'sentence': sentence,
            'answer': answer,
            'words': []
        }

        for o in q.get('options', []):
            word = (o.get('text') or '').strip().rstrip('.')
            if not word:
                continue
            key = word.lower()
            # Sentence-initial capitals in the rationale leak into the option text
            # in places; the wordlist should not be half-shouting.
            word = key if word[:1].isupper() and word[1:].islower() else word
            gloss = find_gloss(word, o.get('why', '')) or manual.get(key)

            qrow['words'].append({
                'label': o.get('label'),
                'word': word,
                'gloss': gloss,
                'isAnswer': o.get('label') == answer
            })

            e = entries.get(key)
            if e is None:
                e = {
                    'word': word,
                    'gloss': gloss,
                    'seen': 0,
                    # Was it ever the right answer? Distractors are worth knowing
                    # too, but the ones that were correct are the safer models of
                    # how the word is actually used.
                    'wasAnswer': False,
                    # Carried through so the vocabulary drill can price a word by
                    # the difficulty of the question it came from.
                    'difficulty': q.get('difficulty') or 'medium',
                    # Only set once the word is found to be a correct answer
                    # somewhere: for a distractor no sentence contains it.
                    'sentence': '',
                    'sourceId': q.get('id'),
                    'from': []
                }
                entries[key] = e

            e['seen'] += 1
            if gloss and not e['gloss']:
                e['gloss'] = gloss
            if o.get('label') == answer:
                e['wasAnswer'] = True
                # Show it doing its job: the blank filled by the word itself.
                e['sentence'] = sentence.replace('___', word) if sentence else ''
                e['sourceId'] = q.get('id')
            if q.get('id') and q['id'] not in e['from']:
                e['from'].append(q['id'])

        per_question.append(qrow)

    # Reused words first, then alphabetical: the order to learn them in.
    ordered = sorted(entries.values(), key=lambda e: (-e['seen'], e['word'].lower()))

    glossed = sum(1 for e in ordered if e['gloss'])
    OUT.write_text(json.dumps({
        'source': 'College Board SAT Suite question bank, Words in Context options',
        'note': 'questions[] holds each question with its four option words, for '
                'showing vocabulary beside the question on screen. words[] is the '
                'de-duplicated index for revision. Entries with gloss=null still '
                'need one. Full passages stay in banks/cb-words-in-context.json, '
                'joined by id.',
        'questions': per_question,
        'words': ordered
    }, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    q_all = sum(len(r['words']) for r in per_question)
    q_glossed = sum(1 for r in per_question for w in r['words'] if w['gloss'])
    full = sum(1 for r in per_question if all(w['gloss'] for w in r['words']))

    print(f'{OUT}')
    print(f'  questions          : {len(per_question)}')
    print(f'    option words     : {q_all}, glossed {q_glossed} '
          f'({q_glossed / q_all * 100:.0f}%)')
    print(f'    all four glossed : {full} questions')
    from_manual = sum(1 for e in ordered
                      if e['gloss'] and e['gloss'] == manual.get(e['word'].lower()))
    print(f'  unique words       : {len(ordered)}')
    print(f'    hand-written     : {from_manual}')
    print(f'    with a gloss     : {glossed} ({glossed / len(ordered) * 100:.0f}%)')
    print(f'    still needing one: {len(ordered) - glossed}')
    print(f'    reused by CB     : {sum(1 for e in ordered if e["seen"] > 1)}')

    unused = sorted(set(manual) - {e['word'].lower() for e in ordered})
    if unused:
        print(f'\n  WARNING: {len(unused)} hand-written gloss(es) match no option word:')
        for w in unused[:10]:
            print(f'    {w}')

    print('\n  a question, as stored:')
    sample = next(r for r in per_question if sum(1 for w in r['words'] if w['gloss']) >= 3)
    print(f'    {sample["id"]}  ({sample["difficulty"]})')
    print(f'    {sample["sentence"][:88]}')
    for w in sample['words']:
        mark = '✔' if w['isAnswer'] else ' '
        print(f'      {mark} {w["label"]}  {w["word"]:20} {w["gloss"] or "-- needs a gloss --"}')


if __name__ == '__main__':
    main()
