#!/usr/bin/env python3
"""Build printable vocabulary sheets from banks/vocab.json.

Four PDFs, each meant for one sheet of paper (front and back):
  print/vocab-words.pdf                 single words
  print/vocab-phrases.pdf               multi-word options (phrase + its preposition)
  print/vocab-wic-passages.pdf          hard words in the Words in Context passages
  print/vocab-command-of-evidence.pdf   hard words in the Command of Evidence questions

Included words are the ones tagged hard by the question bank, plus a
hand-picked set of uncommon words that happen to sit in easy/medium
questions (difficulty in vocab.json is the question's, not the word's).
Entries carrying "exclude": true in banks/vocab.json are skipped.
"""
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

BANK = "banks/vocab.json"
# The other vocabulary problem: words in the Words in Context PASSAGE rather than
# in its four choices. Built by extract_wic_vocab.py.
WIC_BANK = "banks/wic-passage-vocab.json"
# Command of Evidence is his biggest single loss and the reading load is the whole
# of it -- four quotations a question, median 146 characters each. Built by
# extract_coe_vocab.py.
COE_BANK = "banks/coe-vocab.json"
OUTDIR = "print"

# Uncommon words sitting in easy/medium questions, kept alongside the hard set.
EXTRA = """a reprieve|adhere to|advantageous|affinity|ambivalence toward|analogous|
animosities toward|anomaly|antithetical|apprised of|atypical|beneficiary of|
calibrations with|catalyst of|commonalities with|concede|consensus|contingent on|
corroboration|deference|denigrate|despise|dormant|entrenching|epitomize|epitomizing|
esteem|exactitude|exhaustive|explicable|extol|feasible|fruitless|grapple with|hampered|
haphazard|homogeneous|impenetrable|implicit|incensed by|inconspicuousness|
indecipherable|indisputable|indistinct|individualistic|infallible|insurmountable|
intangible|integral|intricate|invalidate|invulnerable|lucrative|marginalize|misconstrue|
negating|nullify|obscure|ornamental|precariousness|precursors of|prefiguring|
premeditated|prestige|proponent of|rectify|redundant|refute|renunciation of|repressed by|
resigned|resilience|rudimentary|saturated with|substantiate|substantiating|susceptible to|
tangential|tedious|transcending|uncontroversial|underscore|vigilance|waive|blemish|
burdensome|catastrophic|chaotic|circumvents|defied|delegate|deviates|dominance|eclipses|
elusive|fabricates|forfeiture of|foundational|habitual|hibernation|hinder|hoard|impartial|
impede|improvise|indifference to|insignificance|involuntarily|jarring|melodic|mimic|
moderation|multifaceted|neutrality|obstructed|offhand|outmoded|pragmatic|presume|rebuts|
reciprocates|renounce|replenishes|restraint|retaliates|rousing|scholarly|simulate|
sophisticated|speculate about|subtle|suppress|tranquil|undeniable|vivid"""
EXTRA = {w.strip() for w in EXTRA.replace("\n", "").split("|") if w.strip()}

PAGE_W, PAGE_H = A4
MARGIN_X, MARGIN_TOP, MARGIN_BOT = 34, 34, 26
GUTTER = 14
HEADER_H = 22


def collect():
    bank = json.load(open(BANK))
    picked = []
    for w in bank["words"]:
        if w.get("exclude"):
            continue
        if w["difficulty"] == "hard" or w["word"] in EXTRA:
            picked.append((w["word"], w["gloss"]))
    picked.sort(key=lambda p: p[0].lower())
    words = [p for p in picked if " " not in p[0]]
    phrases = [p for p in picked if " " in p[0]]
    return words, phrases


def collect_passage():
    """The passage words, which are already curated -- nothing to filter here."""
    rows = json.load(open(WIC_BANK))["words"]
    return sorted(((w["word"], w["gloss"]) for w in rows), key=lambda p: p[0].lower())


def collect_hard_wic():
    """The 60 HARD Words in Context questions, with all four meanings each.

    Abhay asked for this specifically, and it is a different sheet from
    vocab-words.pdf rather than a subset of it: that one is an alphabetical list of
    hard WORDS, which is what you revise from. This is grouped by QUESTION, which
    is how the test asks it -- four near-synonyms and only one that fits the
    sentence. Comparing the four IS the skill, and an alphabetical list takes the
    comparison apart.
    """
    qs = [q for q in json.load(open(BANK))["questions"] if q["difficulty"] == "hard"]
    # In bank order, which is the order he meets them in the app.
    return qs


def collect_coe():
    """Command of Evidence words -- curated in extract_coe_vocab.py, so as-is."""
    rows = json.load(open(COE_BANK))["words"]
    return sorted(((w["word"], w["gloss"]) for w in rows), key=lambda p: p[0].lower())


def wrap(text, font, size, width):
    """Greedy word wrap; a single over-long token is left to overhang."""
    out, line = [], ""
    for word in text.split():
        trial = word if not line else line + " " + word
        if stringWidth(trial, font, size) <= width or not line:
            line = trial
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def build_lines(entries, size, col_w):
    """Each entry -> list of (text, font, indent) lines, kept together in a column."""
    gap = size * 0.55
    blocks = []
    for word, gloss in entries:
        w_width = stringWidth(word, "Helvetica-Bold", size)
        first = [(word, "Helvetica-Bold", 0)]
        # Try to start the gloss on the same line as the word.
        rest_w = col_w - w_width - gap
        lines = []
        if rest_w > col_w * 0.35:
            head = wrap(gloss, "Helvetica", size, rest_w)
            first.append((head[0], "Helvetica", w_width + gap))
            lines.append(first)
            tail = " ".join(head[1:])
        else:
            lines.append(first)
            tail = gloss
        if tail:
            for ln in wrap(tail, "Helvetica", size, col_w - size * 0.9):
                lines.append([(ln, "Helvetica", size * 0.9)])
        blocks.append(lines)
    return blocks


def pack(blocks, rows_per_col, cols, pages):
    """Greedy column packing, never splitting an entry. Returns columns or None."""
    columns, cur, used = [], [], 0
    for block in blocks:
        if used + len(block) > rows_per_col and cur:
            columns.append(cur)
            cur, used = [], 0
        cur.append(block)
        used += len(block)
    if cur:
        columns.append(cur)
    return columns if len(columns) <= cols * pages else None


def pack_balanced(blocks, rows_per_col, ncols):
    """Spread the slack evenly instead of leaving it all in the last column.

    Each column aims at its share of whatever is left, so the columns end at
    roughly the same depth rather than filling up front and trailing off.
    """
    columns, i = [], 0
    for col in range(ncols):
        remaining = sum(len(b) for b in blocks[i:])
        target = -(-remaining // (ncols - col))
        cur, used = [], 0
        while i < len(blocks):
            size = len(blocks[i])
            if used + size > rows_per_col:
                break
            if used >= target and col < ncols - 1:
                break
            cur.append(blocks[i])
            used += size
            i += 1
        columns.append(cur)
    return columns if i == len(blocks) else None


def build_question_blocks(questions, size, col_w):
    """Each hard question -> one block: its sentence, then all four meanings.

    A block is never split across columns, which is the whole point: four options
    read together are a comparison, and four options with one of them overleaf are
    not. That is also why this reuses render()'s packing rather than its
    build_lines -- same machinery, a different unit.
    """
    gap = size * 0.5
    blocks = []
    for q in questions:
        lines = []
        # The sentence, so the meanings have something to be the answer to.
        for i, part in enumerate(wrap(q['sentence'], "Helvetica-Oblique", size, col_w)):
            lines.append([(part, "Helvetica-Oblique", 0)])
        for w in q['words']:
            # A bullet on the right answer. Nothing else in WinAnsi reads as a tick
            # and a missing glyph would print as a hollow box on every question.
            mark = "\u2022" if w['isAnswer'] else " "
            label = f"{mark} {w['label']}"
            lab_w = stringWidth(label + "  ", "Helvetica-Bold", size)
            word = w['word']
            word_w = stringWidth(word, "Helvetica-Bold", size)
            head = [(label, "Helvetica-Bold", 0), (word, "Helvetica-Bold", lab_w)]
            rest_w = col_w - lab_w - word_w - gap
            gloss = w.get('gloss') or ''
            if rest_w > col_w * 0.3:
                wrapped = wrap(gloss, "Helvetica", size, rest_w)
                head.append((wrapped[0], "Helvetica", lab_w + word_w + gap))
                lines.append(head)
                # Wrapped glosses hang under the WORD, not under where the gloss
                # started -- that indent was two thirds of the way across the
                # column and read as a separate entry.
                for extra in wrapped[1:]:
                    lines.append([(extra, "Helvetica", lab_w)])
            else:
                lines.append(head)
                for extra in wrap(gloss, "Helvetica", size, col_w - lab_w):
                    lines.append([(extra, "Helvetica", lab_w)])
        lines.append([("", "Helvetica", 0)])       # a blank line between questions
        blocks.append(lines)
    return blocks


def render(path, title, entries, cols, pages, sizes, blocks_fn=None):
    col_w = (PAGE_W - 2 * MARGIN_X - GUTTER * (cols - 1)) / cols
    body_h = PAGE_H - MARGIN_TOP - MARGIN_BOT - HEADER_H

    for size in sizes:
        leading = size * 1.32
        rows = int(body_h // leading)
        blocks = (blocks_fn or build_lines)(entries, size, col_w)
        columns = pack(blocks, rows, cols, pages)
        if columns:
            # Even out the columns so the last one isn't left half empty.
            balanced = pack_balanced(blocks, rows, cols * pages)
            if balanced:
                columns = balanced
            break
    else:
        raise SystemExit("%s: does not fit in %d page(s)" % (path, pages))

    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(title)
    for i in range(0, len(columns), cols):
        page_cols = columns[i:i + cols]
        y0 = PAGE_H - MARGIN_TOP
        c.setFont("Helvetica-Bold", 9)
        c.drawString(MARGIN_X, y0 - 8, title.upper())
        c.setFont("Helvetica", 7.5)
        c.setFillGray(0.45)
        c.drawRightString(PAGE_W - MARGIN_X, y0 - 8,
                          "%d entries  ·  side %d" % (len(entries), i // cols + 1))
        c.setFillGray(0)
        c.setLineWidth(0.5)
        c.line(MARGIN_X, y0 - 14, PAGE_W - MARGIN_X, y0 - 14)

        for ci, column in enumerate(page_cols):
            x0 = MARGIN_X + ci * (col_w + GUTTER)
            y = y0 - HEADER_H - size
            for block in column:
                for parts in block:
                    for text, font, indent in parts:
                        c.setFont(font, size)
                        c.setFillGray(0 if font == "Helvetica-Bold" else 0.28)
                        c.drawString(x0 + indent, y, text)
                    y -= leading
            c.setFillGray(0)
        c.showPage()
    c.save()
    return size, len(columns)


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    words, phrases = collect()
    # Quarter-point steps so the type grows to fill the sides it is given.
    sizes = [x / 4.0 for x in range(72, 20, -1)]  # 18.0 down to 5.25

    s, n = render(os.path.join(OUTDIR, "vocab-words.pdf"),
                  "SAT vocabulary — single words", words, cols=2, pages=4, sizes=sizes)
    print("vocab-words.pdf   %3d entries  %d columns  %.1fpt" % (len(words), n, s))

    # The phrases fill one side at 12pt; a second side would only be half used.
    s, n = render(os.path.join(OUTDIR, "vocab-phrases.pdf"),
                  "SAT vocabulary — phrases", phrases, cols=2, pages=1, sizes=sizes)
    print("vocab-phrases.pdf %3d entries  %d columns  %.1fpt" % (len(phrases), n, s))

    # Two sides at the same 13pt ceiling as the words sheet, so the three print
    # as one set rather than as three different documents.
    passage = collect_passage()
    s, n = render(os.path.join(OUTDIR, "vocab-wic-passages.pdf"),
                  "SAT vocabulary — Words in Context passages",
                  passage, cols=2, pages=2, sizes=[x for x in sizes if x <= 13.0])
    print("vocab-wic-passages.pdf %3d entries  %d columns  %.1fpt"
          % (len(passage), n, s))

    # Same 13pt ceiling and two sides as the passage sheet, for the same reason:
    # the four print as one set rather than four different documents.
    coe = collect_coe()
    s, n = render(os.path.join(OUTDIR, "vocab-command-of-evidence.pdf"),
                  "SAT vocabulary — Command of Evidence",
                  coe, cols=2, pages=2, sizes=[x for x in sizes if x <= 13.0])
    print("vocab-command-of-evidence.pdf %3d entries  %d columns  %.1fpt"
          % (len(coe), n, s))

    # Grouped by question, so it needs its own block builder. Two columns rather
    # than four: a block is a sentence plus four meanings, and in a narrow column
    # every one of those five lines would wrap.
    hard = collect_hard_wic()
    s, n = render(os.path.join(OUTDIR, "vocab-wic-hard-questions.pdf"),
                  "Words in Context — hard questions, every option explained",
                  hard, cols=2, pages=6, sizes=[x for x in sizes if x <= 10.0],
                  blocks_fn=build_question_blocks)
    print("vocab-wic-hard-questions.pdf %3d questions  %d columns  %.1fpt"
          % (len(hard), n, s))


if __name__ == "__main__":
    main()
