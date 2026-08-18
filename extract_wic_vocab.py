#!/usr/bin/env python3
"""The hard words inside the Words in Context PASSAGES, not its answer choices.

banks/vocab.json already carries every option word those questions offer -- the
words the question is asking him to choose between. This is the other vocabulary
problem, and the one that actually costs him the question: the paragraph itself
is written above his reading level, so he is guessing at the sentence before he
ever reaches the four choices.

Built by frequency and then by hand. wordfreq scores every word in the 256
passages, and anything below Zipf 3.6 that is not just an inflected form of a
common word becomes a candidate -- 686 of them. Most are useless to learn:
proper nouns the filter could not catch, species names, and the technical
furniture of the passage's subject (ectomycorrhizae, teosinte, kilonova). What
survives is the list below, chosen as the words a strong reader who is not a
native speaker would actually stumble over.

Words already in banks/vocab.json are left out: they are drilled there as
options and do not need a second entry here.

Output:  banks/wic-passage-vocab.json
Run:     python3 extract_wic_vocab.py
"""

import json
import re
from pathlib import Path

BANK = Path('banks/cb-words-in-context.json')
VOCAB = Path('banks/vocab.json')
OUT = Path('banks/wic-passage-vocab.json')

# word: gloss. Kept in the terse register of vocab.json's own glosses -- a
# synonym or a short phrase, never a dictionary paragraph.
GLOSSES = {
    'allusions': 'indirect references',
    'applicability': 'how far something applies',
    'approachable': 'easy to talk to',
    'artistry': 'creative skill',
    'ascertain': 'find out for certain',
    'asymmetry': 'lack of balance between the sides',
    'authoritarian': 'demanding strict obedience',
    'benign': 'harmless; kindly',
    'buoyancy': 'the tendency to float; cheerfulness',
    'canonical': 'accepted as the standard',
    'causal': 'to do with cause and effect',
    'centrality': 'the state of being central',
    'circulated': 'passed round',
    'coalesced': 'came together as one',
    'cohesive': 'holding together',
    'compensating': 'making up for',
    'compositional': 'to do with how a work is arranged',
    'conceivable': 'possible to imagine',
    'conducive': 'helping to bring about',
    'confounding': 'confusing; upsetting expectations',
    'conjecture': 'a guess from incomplete evidence',
    'conspicuous': 'easy to notice; standing out',
    'consequential': 'important; following as a result',
    'corollary': 'something that follows naturally',
    'counterintuitive': 'against what one would expect',
    'cryptic': 'mysterious; hard to interpret',
    'culminates': 'reaches its high point',
    'curator': 'one who looks after a collection',
    'densely': 'packed closely together',
    'depicts': 'shows or portrays',
    'derives': 'gets or comes from',
    'detectable': 'able to be noticed',
    'deviations': 'departures from the usual',
    'devising': 'thinking up',
    'devoid': 'entirely lacking',
    'dialect': 'a regional form of a language',
    'dictated': 'laid down; determined',
    'discrepancy': 'an inconsistency between things',
    'dispersal': 'a scattering',
    'distaste': 'mild dislike',
    'divisive': 'causing disagreement',
    'elicited': 'drew out a response',
    'eluded': 'escaped or evaded',
    'emanate': 'flow out from a source',
    'emitted': 'gave off',
    'enriching': 'making fuller or better',
    'entice': 'tempt or attract',
    'envisioned': 'pictured in the mind',
    'epoch': 'a distinct period of time',
    'equanimity': 'calmness of mind',
    'erroneous': 'mistaken',
    'esteemed': 'highly respected',
    'evoke': 'call up; bring to mind',
    'exacerbated': 'made worse',
    'exceeds': 'goes beyond',
    'exemplify': 'be a typical example of',
    'exhorting': 'strongly urging',
    'familial': 'to do with family',
    'familiarity': 'close acquaintance with',
    'forage': 'search for food',
    'forefront': 'the leading position',
    'formless': 'without definite shape',
    'formulaic': 'following a set pattern; unoriginal',
    'frail': 'weak and delicate',
    'gratification': 'the satisfying of a desire',
    'groundbreaking': 'new and pioneering',
    'handedness': 'the preference for one hand',
    'hoax': 'a deception',
    'hypothesize': 'propose as a hypothesis',
    'illuminate': 'light up; make clear',
    'imbibe': 'drink in; absorb',
    'inaccessible': 'impossible to reach',
    'incomprehensible': 'impossible to understand',
    'inhabiting': 'living in',
    'insignificant': 'too small to matter',
    'intensified': 'became stronger',
    'lauded': 'praised',
    'languid': 'slow and lacking energy',
    'legitimize': 'make acceptable or lawful',
    'livid': 'furious; or discoloured',
    'luminous': 'giving off light',
    'meticulously': 'with great attention to detail',
    'mingled': 'mixed together',
    'miraculously': 'as if by a miracle',
    'misconception': 'a mistaken belief',
    'multitude': 'a great number',
    'myopic': 'short-sighted, in sight or in outlook',
    'nuances': 'fine shades of meaning',
    'nuisance': 'an annoyance',
    'obliterate': 'wipe out completely',
    'ornamentation': 'decoration',
    'ostensibly': 'apparently, though perhaps not really',
    'painstakingly': 'with great care and effort',
    'participatory': 'involving people taking part',
    'passivity': 'not acting; accepting what happens',
    'peculiarly': 'strangely; or distinctively',
    'penetrate': 'pass into or through',
    'periodically': 'from time to time',
    'periphery': 'the outer edge',
    'permissive': 'allowing much freedom',
    'pinpoint': 'locate exactly',
    'plethora': 'an excess; a great many',
    'posits': 'puts forward as true',
    'potency': 'strength or power',
    'preclude': 'make impossible; rule out',
    'preferential': 'giving an advantage to some',
    'probes': 'investigates; or instruments that explore',
    'proprieties': 'the rules of correct behaviour',
    'punctilious': 'exact about the details of conduct',
    'rambling': 'wandering, without clear direction',
    'randomized': 'put into random order',
    'recollections': 'things remembered',
    'reconcile': 'bring into agreement',
    'relocation': 'a move to a new place',
    'reluctance': 'unwillingness',
    'repudiation': 'a firm rejection',
    'resemblance': 'likeness',
    'resourcefulness': 'skill at finding ways round problems',
    'restive': 'restless and hard to control',
    'restlessness': 'inability to settle',
    'reticent': 'reserved; unwilling to speak',
    'reviving': 'bringing back to life or use',
    'rhetorical': 'to do with persuasive language',
    'secondhand': 'not direct; had from another',
    'seductive': 'temptingly attractive',
    'self-effacement': 'keeping oneself out of view',
    'shortcoming': 'a failing or defect',
    'shroud': 'a covering that hides',
    'skepticism': 'doubt about what is claimed',
    'slang': 'very informal language',
    'slumber': 'sleep',
    'solidified': 'made or became firm',
    'sparse': 'thinly spread; scanty',
    'sporadic': 'happening at irregular intervals',
    'spurred': 'prompted into action',
    'stalwart': 'loyal and dependable',
    'stemmed': 'originated from',
    'sterile': 'barren; producing nothing',
    'stimuli': 'things that provoke a reaction',
    'subtly': 'in a fine, hard-to-notice way',
    'successors': 'those who come after',
    'surging': 'rushing forward',
    'symbiotic': 'living together to mutual benefit',
    'symmetry': 'balance between the sides',
    'syntax': 'how words are arranged into sentences',
    'temperament': "a person's usual nature",
    'thronged': 'crowded',
    'thwart': 'prevent; frustrate',
    'timeless': 'unaffected by the passing of time',
    'tinge': 'a slight trace of colour or feeling',
    'toxicity': 'how poisonous something is',
    'tropes': 'recurring themes or devices',
    'tutelage': 'instruction or guardianship',
    'unbearable': 'impossible to endure',
    'undercut': 'weaken from below',
    'undermined': 'weakened gradually',
    'unearthed': 'dug up; brought to light',
    'uneventful': 'without incident',
    'unorthodox': 'not conventional',
    'unrelenting': 'never easing off',
    'unrestrained': 'not held back',
    'uproot': 'pull up by the roots; displace',
    'vested': 'firmly held, as an interest is',
    'vigor': 'strength and energy',
    'virtuous': 'morally good',
    'vitality': 'liveliness; life force',
    'vividly': 'with sharp clarity',
    'zenith': 'the highest point',
}


def main():
    questions = json.loads(BANK.read_text())
    covered = {w['word'].lower() for w in json.loads(VOCAB.read_text())['words']}

    rows, absent, duplicated = [], [], []
    for word, gloss in sorted(GLOSSES.items()):
        if word in covered:
            duplicated.append(word)
            continue
        pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.I)
        hits = [q for q in questions if pattern.search(q.get('passage') or '')]
        if not hits:
            absent.append(word)
            continue
        # The sentence it appears in, from the first passage that uses it: a word
        # met in its own sentence is learned; a word met in a column is not.
        passage = hits[0]['passage']
        sentence = next((s.strip() for s in re.split(r'(?<=[.!?])\s+', passage)
                         if pattern.search(s)), '')
        rows.append({
            'word': word,
            'gloss': gloss,
            'seen': len(hits),
            'sentence': sentence,
            'sourceId': hits[0]['id'],
        })

    OUT.write_text(json.dumps({
        'source': 'College Board SAT Suite question bank, Words in Context passages',
        'note': 'Hard words from the passage text itself, as opposed to the four '
                'option words in banks/vocab.json. Chosen by wordfreq and then by '
                'hand; see extract_wic_vocab.py.',
        'words': rows,
    }, indent=1))

    print(f'{len(rows)} words -> {OUT}')
    print(f'  across {len({r["sourceId"] for r in rows})} of {len(questions)} passages')
    if duplicated:
        print(f'  {len(duplicated)} skipped, already in vocab.json: '
              + ', '.join(duplicated))
    if absent:
        print(f'  {len(absent)} DROPPED, not found in any passage: ' + ', '.join(absent))


if __name__ == '__main__':
    main()
