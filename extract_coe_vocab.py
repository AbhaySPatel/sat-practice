#!/usr/bin/env python3
"""The hard words inside the Command of Evidence questions.

Command of Evidence is his biggest single loss -- 17 questions across the seven
tests -- and when I checked his accuracy against the bank's own difficulty there
was no pattern in WHICH ones he missed: 57% against a 56% base rate. So there is
no rule to teach here. What there is, is reading load.

These questions ask whether a quotation or a finding supports a claim, and the
quotations are long: a median of 146 characters and up to 430. A word he has to
stop and work out is a word spent not judging the claim, and four of them per
question is the whole of his time. So this is the same remedy as
extract_wic_vocab.py applied to the skill that needs it most.

Chosen the same way: wordfreq scores every word in the 140 questions -- passage,
stem and all four choices -- and 520 fall below Zipf 3.62 without already being
drilled elsewhere. Most of those are the subject's own furniture rather than
vocabulary (jellyfish, isotopes, propane, tectonic, hippocampus), and a science
passage will always have some. What survives is the list below: words that carry
over to the next passage, whatever it happens to be about.

Words already in banks/vocab.json or banks/wic-passage-vocab.json are left out --
they are drilled there and do not need a second entry.

Output:  banks/coe-vocab.json
Run:     python3 extract_coe_vocab.py
"""

import json
import re
from pathlib import Path

BANK = Path('banks/cb-command-of-evidence.json')
VOCAB = Path('banks/vocab.json')
WIC = Path('banks/wic-passage-vocab.json')
OUT = Path('banks/coe-vocab.json')

# word: gloss. Same terse register as the other two sheets -- a synonym or a short
# phrase, never a dictionary paragraph. A gloss he has to parse is a second word
# to learn.
GLOSSES = {
    'acclaim': 'public praise',
    'accumulate': 'build up over time',
    'accumulation': 'a gradual building up',
    'alleviate': 'make less severe',
    'allocate': 'set aside for a purpose',
    'anguish': 'severe mental pain',
    'annihilation': 'complete destruction',
    'approximation': 'a close but inexact figure',
    'artifact': 'an object made by people, esp. of historical interest',
    'asserts': 'states firmly, without proving it',
    'attrition': 'a gradual wearing away or loss in numbers',
    'authenticity': 'being genuine rather than copied',
    'bleak': 'grim; without hope',
    'brazen': 'boldly shameless',
    'breadth': 'range; how wide something is',
    'bribery': 'paying someone to act dishonestly',
    'caricature': 'an exaggerated portrayal',
    'causality': 'one thing actually causing another',
    'characterize': 'describe the nature of',
    'charisma': 'personal magnetism',
    'cognition': 'thinking and knowing',
    'colonization': 'settling and taking control of a place',
    'comparatively': 'relatively; when set against others',
    'compiling': 'gathering together into one work',
    'conceive': 'form in the mind; imagine',
    'conclusively': 'in a way that settles the matter',
    'condensed': 'made shorter or denser',
    'confine': 'keep within limits',
    'confiscation': 'official seizure of property',
    'conformity': 'going along with what others do',
    'contemporaries': 'people living at the same time',
    'contradictory': 'in conflict with each other',
    'converge': 'come together at a point',
    'conveying': 'getting across; communicating',
    'conveys': 'gets across; communicates',
    'correlated': 'varying together, without proving cause',
    'corresponds': 'matches; answers to',
    'corrupted': 'spoiled; altered for the worse',
    'cultivated': 'grown deliberately; refined',
    'cumulative': 'adding up as it goes',
    'curated': 'selected and arranged by an expert',
    'depict': 'show or represent',
    'depiction': 'a representation of something',
    'detachment': 'being uninvolved; distance',
    'deviation': 'a departure from the usual',
    'disenfranchised': 'deprived of a right, esp. the vote',
    'disparity': 'a marked inequality',
    'displeasure': 'annoyance; disapproval',
    'divergence': 'a moving apart; a difference',
    'domesticated': 'tamed for human use',
    'duplication': 'repeating something unnecessarily',
    'emphasizes': 'gives special weight to',
    'enactment': 'putting a law into force; performing',
    'entails': 'necessarily involves',
    'entrusted': 'given as a responsibility',
    'envision': 'picture in the mind',
    'ephemeral': 'lasting a very short time',
    'ethnographic': 'describing a people and their culture',
    'evasive': 'avoiding a direct answer',
    'evidently': 'apparently; as far as one can see',
    'exhilarating': 'thrilling; invigorating',
    'expansive': 'wide-ranging; extensive',
    'expenditures': 'amounts spent',
    'explanatory': 'serving to explain',
    'expulsion': 'being forced out',
    'exuberant': 'full of lively energy',
    'facets': 'aspects; sides of something',
    'fathom': 'understand after effort',
    'feats': 'impressive achievements',
    'flatter': 'praise beyond what is deserved',
    'flourished': 'thrived; did well',
    'fluency': 'ease and smoothness, esp. in speech',
    'folklore': 'the traditional stories of a people',
    'folly': 'foolishness',
    'fortified': 'strengthened; reinforced',
    'fractured': 'broken; split',
    'framing': 'how something is presented',
    'frivolous': 'not serious; trivial',
    'heightened': 'increased; made more intense',
    'hypothetical': 'supposed for argument, not actual',
    'idiosyncratic': 'peculiar to one person',
    'illumination': 'light; clarification',
    'immobile': 'unable to move',
    'improvisation': 'making it up as you go',
    'impulsive': 'acting without thinking first',
    'inconsistencies': 'places where things do not agree',
    'incorporates': 'takes in as part of itself',
    'incur': 'bring upon oneself (a cost, a risk)',
    'indistinguishable': 'impossible to tell apart',
    'induce': 'bring about; persuade',
    'influx': 'an arrival of many at once',
    'infrequently': 'rarely',
    'inhabit': 'live in',
    'inherently': 'by its very nature',
    'inhibit': 'hold back; slow down',
    'insightful': 'showing deep understanding',
    'interspersed': 'scattered in among',
    'intervening': 'coming in between',
    'intuitive': 'grasped without reasoning it out',
    'inverse': 'reversed; the opposite way round',
    'keenly': 'sharply; intensely',
    'lament': 'express grief over',
    'leisurely': 'unhurried',
    'magistrates': 'local judges or officials',
    'manipulating': 'handling skilfully; controlling unfairly',
    'mindful': 'keeping something in mind',
    'modernist': 'of the early-20th-century break with tradition',
    'monumental': 'very great; like a monument',
    'motifs': 'recurring elements in a work',
    'nonfiction': 'writing about real events',
    'obedience': 'doing as one is told',
    'observational': 'based on watching rather than experimenting',
    'obstruction': 'something blocking the way',
    'ominous': 'suggesting something bad is coming',
    'outnumbered': 'fewer than the others',
    'passively': 'without acting; letting things happen',
    'pedagogy': 'the practice of teaching',
    'pivotal': 'on which everything turns',
    'ponder': 'think over carefully',
    'populace': 'the people of a place',
    'porous': 'full of tiny holes; letting things through',
    'portrayal': 'the way something is depicted',
    'portrays': 'depicts; represents',
    'predation': 'hunting other animals for food',
    'predecessors': 'those who came before',
    'predictor': 'something that indicates what will happen',
    'profoundly': 'deeply; thoroughly',
    'prominence': 'being important or noticeable',
    'propagated': 'spread; multiplied',
    'proverbs': 'short traditional sayings',
    'purposeful': 'done with a clear aim',
    'pursuits': 'activities one gives time to',
    'quaint': 'attractively old-fashioned',
    'reckoning': 'a calculation; a settling of accounts',
    'reconstruct': 'build up again from evidence',
    'recounts': 'tells the story of',
    'reflective': 'thoughtful; throwing back light',
    'regal': 'royal; magnificent',
    'relinquish': 'give up; let go of',
    'reverence': 'deep respect',
    'scarce': 'in short supply',
    'scarcely': 'hardly; only just',
    'seclusion': 'being kept apart from others',
    'sordid': 'squalid; morally grubby',
    'stagnant': 'not moving; not developing',
    'stillness': 'complete quiet and lack of motion',
    'stylistic': 'to do with style rather than content',
    'stylized': 'made to follow a convention rather than life',
    'subdue': 'bring under control; soften',
    'subset': 'a smaller group inside a larger one',
    'subsistence': 'having only just enough to live on',
    'symbolism': 'using things to stand for ideas',
    'tiresome': 'tedious; wearying',
    'topography': 'the shape of the land',
    'trajectory': 'the path something follows',
    'troublesome': 'causing difficulty',
    'unifying': 'bringing together into a whole',
    'unjustified': 'not supported by good reason',
    'unrealistic': 'not matching how things really are',
    'vanquished': 'defeated utterly',
    'vigorously': 'with force and energy',
    'wayward': 'wilful; hard to control',
    'whereupon': 'at which point',
    'yielded': 'produced; gave way',
}


def searchable(question):
    """Everything the reader has to get through: passage, stem and all choices."""
    parts = [question.get('passage') or '', question.get('question') or '']
    parts += [o.get('text') or '' for o in question.get('options') or []]
    return ' '.join(parts)


def main():
    questions = json.loads(BANK.read_text())

    covered = set()
    for entry in json.loads(VOCAB.read_text())['words']:
        for part in entry['word'].lower().split():
            covered.add(part)
    if WIC.exists():
        for entry in json.loads(WIC.read_text())['words']:
            covered.add(entry['word'].lower())

    rows, absent, duplicated = [], [], []
    for word, gloss in sorted(GLOSSES.items()):
        if word in covered:
            duplicated.append(word)
            continue
        pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.I)
        hits = [q for q in questions if pattern.search(searchable(q))]
        if not hits:
            absent.append(word)
            continue

        # The sentence it appears in, from the first question that uses it: a word
        # met in its own sentence is learned, a word met in a column is not. The
        # match can be in a choice rather than the passage, and a choice IS the
        # sentence in that case.
        first = hits[0]
        blob = searchable(first)
        sentence = next((s.strip() for s in re.split(r'(?<=[.!?])\s+', blob)
                         if pattern.search(s)), '')
        rows.append({
            'word': word,
            'gloss': gloss,
            'seen': len(hits),
            'sentence': re.sub(r'\s+', ' ', sentence)[:300],
            'sourceId': first['id'],
        })

    OUT.write_text(json.dumps({
        'source': 'College Board SAT Suite question bank, Command of Evidence',
        'note': 'Hard words anywhere in a Command of Evidence question -- passage, '
                'stem or the four quotations. Chosen by wordfreq and then by hand; '
                'see extract_coe_vocab.py. Words already in vocab.json or '
                'wic-passage-vocab.json are excluded.',
        'words': rows,
    }, indent=1) + '\n')

    print(f'{len(rows)} words -> {OUT}')
    print(f'  across {len({r["sourceId"] for r in rows})} of {len(questions)} questions')
    if duplicated:
        print(f'  {len(duplicated)} skipped, already drilled elsewhere: '
              + ', '.join(duplicated))
    if absent:
        print(f'  {len(absent)} DROPPED, not found: ' + ', '.join(absent))


if __name__ == '__main__':
    main()
