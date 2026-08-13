"""Build the banks/math-*.json question banks from what fetch_math.py cached.

Unlike every other extract_*.py here, this one does not get its questions from a
PDF. It cannot: book/maths-questionbank-export-2026-8-12.pdf draws its mathematics
as vector outlines with no font behind them, so the text layer of a question reads
"In the given equation,  and  are constants" and 1,069 of its 1,414
multiple-choice questions have all four choices blank. fetch_math.py goes to the
API the site itself calls, which serves the same questions as MathML.

The export still earns one job, at the bottom of this file: the answer key for
the handful of questions whose API payload has no answer field. See
build_pdf_answers.

Four payload shapes arrive, and all four have to come out the same way:

    api  + mcq   stem HTML, answerOptions[], correct_answer ['D']
    api  + spr   stem HTML, correct_answer ['403', '.1764', ...]
    ibn  + mcq   prompt HTML, answer.choices{a..d}, answer.correct_choice 'c'
    ibn  + spr   prompt HTML, and no answer field at all -- see below

The `ibn` questions are older disclosed items and carry their mathematics as
base64 PNGs rather than MathML. Those bitmaps are reduced to alpha masks so the
app can paint them in the text colour like everything else -- see mask_images.
They are still marked `raster: true`, because the one thing that cannot be fixed
is that they will not scale with the text the way real MathML does.

Two transforms are not optional:

  * `<mfenced>` is removed from MathML Core. Chrome and Safari draw nothing for
    it, so every one becomes an <mrow> with real parenthesis operators -- without
    this, `r(x - 8)` renders as `rx - 8` and the question is silently wrong.
  * The figure SVGs carry `<style>*{...}</style>`. Inline SVG styles are NOT
    scoped to the SVG; that selector would apply to the whole page. Dropped, and
    the equivalent presentation attributes left in place.

Everything is sanitised to a whitelist built from the tags the responses actually
use, because the app renders these as HTML rather than as text nodes and a bank
file is not a place to start trusting markup blindly.

Output is one file per Math domain plus banks/math-index.json, a markup-free row
per question. Together the domain files are ~33 MB -- that weight is real content
(a glyph outline per character of every axis label; a bitmap per expression on the
older items), so compacting the JSON saves nothing and splitting is what makes it
affordable. The app reads the index up front and fetches a domain only when the
Maths section asks for it, so a Reading session downloads none of it.

Run:  python3 fetch_math.py   (once, to cache)
      python3 extract_math.py
"""

import html
import json
import re
import sys
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

CACHE = Path('book/math-api')
BANKS = Path('banks')
# One file per Math domain, plus a markup-free index the app can read up front.
INDEX = BANKS / 'math-index.json'

# The export is useless for the questions themselves, but it is the only place
# the older disclosed items' answers exist as text: their API payload has no
# answer field at all and states the answer inside the rationale as a PNG. So the
# PDF comes back in through the side door, for the answer key and nothing else.
PDF = Path('book/maths-questionbank-export-2026-8-12.pdf')
PDF_ANSWERS = CACHE / '_pdf-answers.json'

SOURCE = 'College Board SAT Suite question bank (Math)'

# The four Math score-report headings, slugged. Kept distinct from the Reading
# and Writing domains in app.js: Math is a separate section with its own
# 200-800 score, and folding it into those four would make the app's projection
# read maths accuracy through a Reading and Writing conversion.
DOMAIN_SLUG = {
    'Algebra': 'algebra',
    'Advanced Math': 'advanced-math',
    'Problem-Solving and Data Analysis': 'problem-solving-data',
    'Geometry and Trigonometry': 'geometry-trigonometry',
}

DIFFICULTY = {'E': 'easy', 'M': 'medium', 'H': 'hard'}

VOID = {'br', 'img', 'path', 'rect', 'line', 'use', 'circle', 'ellipse',
        'polyline', 'polygon', 'stop', 'mspace', 'none'}

# Built from the tags these responses actually contain, plus the rest of MathML
# Core and the SVG shapes -- the cache is Algebra-heavy today and Geometry will
# bring msqrt, mtable and friends. Anything outside the list is unwrapped rather
# than deleted, so unexpected markup loses its tag but never its text.
ALLOWED = {
    # prose
    'p', 'span', 'div', 'em', 'strong', 'i', 'b', 'u', 'sub', 'sup', 'br',
    'cite', 'ul', 'ol', 'li', 'table', 'caption', 'thead', 'tbody', 'tr',
    'td', 'th', 'figure', 'figcaption', 'img',
    # MathML Core
    'math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'mfrac',
    'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'mover', 'munder',
    'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr',
    'mtd', 'mstyle', 'mpadded', 'mphantom', 'merror', 'menclose',
    'semantics', 'annotation', 'annotation-xml',
    # SVG figures
    'svg', 'g', 'defs', 'path', 'rect', 'line', 'circle', 'ellipse',
    'polyline', 'polygon', 'text', 'tspan', 'marker', 'clippath',
    'clipPath', 'use', 'symbol', 'title', 'desc', 'linearGradient', 'stop',
    # <pattern> is how seven of the bar charts distinguish their series -- the
    # hatching IS the legend. Unwrapping it left those bars blank.
    'pattern',
}

# Presentation and layout only. Every `on*` handler and every id/class hook is
# dropped: ids would collide across questions once several are on the page, and
# the app's own stylesheet should own appearance.
ALLOWED_ATTRS = {
    'alttext', 'displaystyle', 'mathvariant', 'scriptlevel', 'dir',
    'd', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform',
    'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'dx', 'dy', 'width', 'height', 'viewBox', 'points', 'offset',
    'font-family', 'font-size', 'text-anchor', 'clip-path',
    'marker-end', 'marker-start', 'markerWidth', 'markerHeight',
    'markerUnits', 'orient', 'refX', 'refY', 'gradientUnits',
    'patternUnits', 'patternTransform', 'patternContentUnits',
    'xmlns', 'xmlns:xlink', 'xlink:href', 'href',
    'role', 'aria-label', 'alt', 'src', 'align', 'scope', 'colspan', 'rowspan',
    'style', 'id',
}

# `id` has to survive. The figures are matplotlib output, which draws every
# character of every axis label as <use xlink:href="#glyph"> pointing at a
# <path id="glyph"> in <defs>, and clips each layer with clip-path="url(#...)".
# One figure here holds 117 ids against 249 references to them; dropping the ids
# leaves all 249 dangling and the labels render as blank boxes.
#
# They are namespaced per question instead, because ids are document-global and
# every figure calls its glyphs the same things -- two questions on one page and
# the second one's labels would resolve against the first one's <defs>.
re_id_ref = re.compile(r'(url\(#|xlink:href="#|\shref="#|\sid=")([^"()\s]+)')


def namespace_ids(markup, prefix):
    if 'id=' not in markup:
        return markup
    return re_id_ref.sub(lambda m: f'{m.group(1)}{prefix}-{m.group(2)}', markup)


# The disclosed items store their maths as small bitmaps of black text, and those
# bitmaps carry LCD subpixel anti-aliasing: 86% of their pixels are not grey, in
# complementary pairs like (255,191,116)/(116,191,255). That colour is an artefact
# of the one monitor they were rendered on, not information -- and inverting the
# image for the dark theme inverts the fringes with it, so the maths arrives
# wearing coloured halos.
#
# So the pixels are reduced to an alpha mask: how dark a pixel is becomes how
# opaque it is, and the glyph keeps no colour of its own. CSS then paints it in
# currentColor, which is the same rule the MathML and the SVG figures already
# follow -- one behaviour for every kind of ink instead of a filter for this one.
# It also comes out slightly smaller, since the RGB channels are dropped.
#
# What this does NOT fix: they are still bitmaps and will not scale like text.
re_data_img = re.compile(
    r'<img\b([^>]*?)src="data:image/png;base64,([A-Za-z0-9+/=]+)"([^>]*?)/?>', re.I)
re_alt = re.compile(r'\balt="([^"]*)"', re.I)


def mask_images(markup, stats):
    """Rewrite base64 <img> maths into spans the app paints in the text colour."""
    if 'data:image/png' not in markup:
        return markup
    try:
        import base64
        import io
        from PIL import Image, ImageChops
    except ImportError:
        stats['no_pillow'] = True
        return markup

    def sub(m):
        before, b64, after = m.group(1), m.group(2), m.group(3)
        try:
            raw = base64.b64decode(b64)
            im = Image.open(io.BytesIO(raw)).convert('RGBA')
            alpha = ImageChops.multiply(im.getchannel('A'),
                                        ImageChops.invert(im.convert('L')))
            out = Image.new('RGBA', im.size, (0, 0, 0, 0))
            out.putalpha(alpha)
            buf = io.BytesIO()
            out.save(buf, 'PNG', optimize=True)
        except Exception:                     # noqa: BLE001 - keep the original
            stats['failed'] = stats.get('failed', 0) + 1
            return m.group(0)

        stats['n'] = stats.get('n', 0) + 1
        stats['before'] = stats.get('before', 0) + len(raw)
        stats['after'] = stats.get('after', 0) + buf.tell()

        # The alt text was the only thing making these readable aloud, and a span
        # is not an image, so it moves to aria-label with an explicit role.
        alt = re_alt.search(before + after)
        label = (f' role="math" aria-label="{alt.group(1)}"'
                 if alt and alt.group(1).strip() else ' role="presentation"')
        data = base64.b64encode(buf.getvalue()).decode()
        # Single-quoted url(): a double quote here would close the style
        # attribute and the mask would silently never apply.
        url = f"url('data:image/png;base64,{data}')"
        return (f'<span data-math-mask="1"{label} style="width:{im.width}px;'
                f'height:{im.height}px;-webkit-mask-image:{url};mask-image:{url}">'
                f'</span>')

    return re_data_img.sub(sub, markup)

# `style` is allowed only because the figure SVGs are matplotlib output and keep
# every colour there -- drop it and the graphs render as invisible black-on-black
# shapes with no strokes at all. It is filtered to these properties, so nothing
# can smuggle in a position, a background or a url().
SAFE_STYLE = {
    'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'stroke-opacity', 'fill-opacity', 'opacity',
    'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor',
    'color', 'visibility',
}

# College Board draws its axes and plot lines in black, which is invisible on the
# app's dark background. Rewriting black to currentColor makes every figure take
# the surrounding text colour, so both themes work with no per-theme assets and
# no filter hack that would also invert the parts that are deliberately coloured.
re_black = re.compile(r'^(#0{3,8}|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$', re.I)

# The mirror of the same problem. These figures were drawn for white paper, and
# matplotlib paints a white patch behind every tick label so it stays readable
# over a gridline -- on the dark card those become sixteen white blocks down the
# axes. White here always means "the paper", so it is pointed at a variable the
# app sets to whatever the card is. Not `transparent`: these are knockouts, and a
# knockout has to paint something for the open circles on a number line to work.
re_white = re.compile(r'^(#f{3,8}|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$', re.I)
PAPER = 'var(--figure-paper, #ffffff)'


def clean_style(value):
    out = []
    for decl in (value or '').split(';'):
        if ':' not in decl:
            continue
        prop, _, val = decl.partition(':')
        prop, val = prop.strip().lower(), val.strip()
        if prop not in SAFE_STYLE:
            continue
        # A same-document reference is how a hatched fill is applied
        # (fill:url(#bar4)); anything else in a url() would leave the page.
        if 'url(' in val.lower() and not re.match(r'^url\(#[^)]+\)$', val.strip()):
            continue
        if prop in ('fill', 'stroke', 'color'):
            if re_black.match(val):
                val = 'currentColor'
            elif re_white.match(val):
                val = PAPER
        out.append(f'{prop}:{val}')
    return ';'.join(out)

# viewBox and the marker* attributes are case-sensitive in SVG but arrive
# lowercased from the parser, so they are put back on the way out.
RECASE = {
    'viewbox': 'viewBox', 'markerwidth': 'markerWidth',
    'markerheight': 'markerHeight', 'markerunits': 'markerUnits',
    'refx': 'refX', 'refy': 'refY', 'clippath': 'clipPath',
    'gradientunits': 'gradientUnits', 'lineargradient': 'linearGradient',
    'patternunits': 'patternUnits', 'patterntransform': 'patternTransform',
    'patterncontentunits': 'patternContentUnits',
}


class Clean(HTMLParser):
    """Whitelist rewriter. Unknown tags are unwrapped, not dropped."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.text = []          # plain-text fallback, built alongside
        self.dropped = Counter()
        self._skip_depth = 0    # inside <style>/<script>, drop content entirely

    def handle_starttag(self, tag, attrs):
        if tag in ('style', 'script'):
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag not in ALLOWED:
            self.dropped[tag] += 1
            return                                   # unwrap
        kept = []
        for k, v in attrs:
            if k.startswith('on') or k not in ALLOWED_ATTRS:
                continue
            if k in ('src', 'href', 'xlink:href'):
                # Data URIs and in-document references only. Nothing in a bank
                # file should reach out to the network when the app renders it.
                if not (v or '').startswith(('data:', '#')):
                    continue
            if k == 'style':
                v = clean_style(v)
                if not v:
                    continue
            if k in ('fill', 'stroke'):
                if re_black.match((v or '').strip()):
                    v = 'currentColor'
                elif re_white.match((v or '').strip()):
                    v = PAPER
            kept.append((RECASE.get(k, k), v))
        # The screen-reader text College Board already wrote is the plain-text
        # fallback: "StartFraction 12 x plus 28 Over 4 EndFraction" is clumsy to
        # read but it is correct, and it beats a hole in the sentence.
        for k, v in attrs:
            if k in ('alttext', 'alt', 'aria-label') and v:
                self.text.append(f' {v} ')
        # Every axis label is a <use> pointing at a glyph outline that declares no
        # fill whatsoever, and SVG's initial fill is black -- so recolouring the
        # explicit blacks above leaves the text painting black on the dark theme
        # while the axes and plot line follow the text colour. A default fill on
        # the root is the whole fix: unfilled descendants inherit it, and anything
        # with a fill of its own, including the fill:none on the grid, still wins.
        if tag == 'svg' and not any(k == 'fill' for k, _ in kept):
            kept.append(('fill', 'currentColor'))
        name = RECASE.get(tag, tag)
        bits = ''.join(f' {k}="{html.escape(v or "", quote=True)}"' for k, v in kept)
        self.out.append(f'<{name}{bits}{" /" if tag in VOID else ""}>')

    def handle_endtag(self, tag):
        if tag in ('style', 'script'):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth or tag not in ALLOWED or tag in VOID:
            return
        self.out.append(f'</{RECASE.get(tag, tag)}>')

    def handle_data(self, data):
        if self._skip_depth:
            return
        self.out.append(html.escape(data, quote=False))
        self.text.append(data)


def unfence(markup):
    """<mfenced> -> <mrow> with real parentheses.

    MathML Core dropped mfenced, so Chrome and Safari render its children with
    no brackets at all. `r(x - 8)` silently becoming `rx - 8` is not a display
    bug, it is a different equation, so this runs before anything else.

    Only the default round brackets are handled because that is all these
    responses use; an mfenced carrying open=/close= is reported rather than
    guessed at.
    """
    if 'mfenced' not in markup:
        return markup, 0
    exotic = len(re.findall(r'<mfenced[^>]*\b(?:open|close|separators)\s*=', markup))
    markup = re.sub(r'<mfenced\s*>', '<mrow><mo>(</mo>', markup)
    markup = re.sub(r'<mfenced[^>]*>', '<mrow><mo>(</mo>', markup)
    markup = markup.replace('</mfenced>', '<mo>)</mo></mrow>')
    return markup, exotic


def clean(markup):
    """Sanitise, and return (html, plaintext, dropped-tag counter)."""
    if not markup:
        return '', '', Counter()
    markup, _ = unfence(markup)
    p = Clean()
    p.feed(markup)
    p.close()
    text = re.sub(r'\s+', ' ', ''.join(p.text)).strip()
    return ''.join(p.out).strip(), text, p.dropped


def strip_tags(markup):
    _, text, _ = clean(markup)
    return text


# "Choice B is incorrect and may result from..." -- the same per-option
# explanation the Reading and Writing banks carry, so the app's existing "why"
# display works here unchanged.
re_choice = re.compile(
    r'(Choice\s+([A-D])\s+is\s+(?:correct|incorrect)\b.*?)(?=Choice\s+[A-D]\s+is\s|$)',
    re.S | re.I)


def split_why(rationale_text):
    out = {}
    for chunk, label in ((m.group(1).strip(), m.group(2).upper())
                         for m in re_choice.finditer(rationale_text)):
        out.setdefault(label, chunk)
    return out


# For the disclosed SPR items the API returns no answer field at all, and the
# rationale states it as an image. This sentence, which College Board writes at
# the end of those rationales, is the one place it survives as text.
re_spr_note = re.compile(
    r'Note that ([^.]*?) (?:are|is) examples? of ways to enter a correct answer',
    re.I)


def parse_api(body, meta):
    """The get-question shape: MathML throughout."""
    stem_html, stem_text, dropped = clean(body.get('stem', ''))
    rat_html, rat_text, d2 = clean(body.get('rationale', ''))
    dropped += d2

    q = {'format': body.get('type', 'spr'), 'questionHtml': stem_html,
         'question': stem_text, 'ruleHtml': rat_html, 'rule': rat_text}

    if body.get('type') == 'mcq':
        why = split_why(rat_text)
        opts = []
        for i, o in enumerate(body.get('answerOptions') or []):
            label = 'ABCD'[i] if i < 4 else str(i + 1)
            o_html, o_text, d3 = clean(o.get('content', ''))
            dropped += d3
            opts.append({'label': label, 'textHtml': o_html, 'text': o_text,
                         'why': why.get(label, '')})
        q['options'] = opts
        ca = body.get('correct_answer') or []
        q['correctLabel'] = (ca[0] if ca else '').strip().upper()[:1]
    else:
        # Every accepted form -- '3/17', '.1764', '.1765' are all correct for the
        # same question, and marking two of them wrong would be the app's bug.
        q['answers'] = [str(a).strip() for a in (body.get('correct_answer') or [])]

    return q, dropped


def parse_ibn(body, meta):
    """The disclosed shape: prose plus base64 PNGs where the maths should be."""
    item = body[0] if isinstance(body, list) else body
    ans = item.get('answer') or {}

    stem_html, stem_text, dropped = clean(item.get('prompt', ''))
    rat_html, rat_text, d2 = clean(ans.get('rationale', ''))
    dropped += d2

    q = {'questionHtml': stem_html, 'question': stem_text,
         'ruleHtml': rat_html, 'rule': rat_text, 'raster': True}

    if (ans.get('style') or '').lower().startswith('multiple'):
        q['format'] = 'mcq'
        why = split_why(rat_text)
        opts = []
        for letter, choice in sorted((ans.get('choices') or {}).items()):
            label = letter.upper()
            o_html, o_text, d3 = clean((choice or {}).get('body', ''))
            dropped += d3
            opts.append({'label': label, 'textHtml': o_html, 'text': o_text,
                         'why': why.get(label, '')})
        q['options'] = opts
        q['correctLabel'] = (ans.get('correct_choice') or '').strip().upper()[:1]
    else:
        q['format'] = 'spr'
        m = re_spr_note.search(rat_text)
        # Split on "and" / "," so "3/2 and 1.5" becomes both accepted forms.
        q['answers'] = ([a.strip(' .') for a in re.split(r',|\band\b', m.group(1))
                         if a.strip(' .')] if m else [])

    return q, dropped


# Three phrasings, in order of how directly they state the answer. The middle one
# has to allow a full stop inside the match -- "3/2 and 1.5" contains one, and a
# [^.] class stops dead at the decimal point and finds nothing.
re_pdf_correct = re.compile(r'^Correct Answer:\s*(.+)$', re.M)
re_pdf_note = re.compile(
    r'Note that (.{1,80}?)\s+(?:are|is)\s+examples? of ways to enter a correct answer',
    re.I | re.S)
re_pdf_is = re.compile(r'The correct answer is\s+([^.\n]{1,40}?)\s*\.', re.I)


def build_pdf_answers():
    """{questionId: [accepted answer, ...]} scraped from the export, cached.

    A ~20 second pass over 1,977 pages, so the result is written next to the API
    cache and reused. Delete book/math-api/_pdf-answers.json to rebuild.
    """
    if PDF_ANSWERS.exists():
        return json.loads(PDF_ANSWERS.read_text())
    if not PDF.exists():
        print(f'  (no {PDF} -- skipping the answer-key fallback)')
        return {}

    try:
        import fitz
    except ImportError:
        print('  (PyMuPDF not installed -- skipping the answer-key fallback)')
        return {}

    print(f'  reading {PDF} for the answer-key fallback...', flush=True)
    doc = fitz.open(PDF)
    blocks = {}
    current = None
    for page in doc:
        text = page.get_text()
        parts = re.split(r'(?=Question ID: [0-9a-f]{8})', text)
        for part in parts:
            m = re.match(r'Question ID: ([0-9a-f]{8})', part)
            if m:
                current = m.group(1)
            if current:
                blocks[current] = blocks.get(current, '') + part

    out = {}
    for qid, text in blocks.items():
        m = re_pdf_correct.search(text)
        if m:
            out[qid] = [m.group(1).strip()]
            continue
        m = re_pdf_note.search(text)
        if m:
            # "3/2 and 1.5" -> both are accepted answers for the same question.
            out[qid] = [a.strip(' .') for a in re.split(r',|\band\b', m.group(1))
                        if a.strip(' .')]
            continue
        m = re_pdf_is.search(text)
        if m:
            out[qid] = [m.group(1).strip()]

    PDF_ANSWERS.write_text(json.dumps(out))
    print(f'  answers recovered from the PDF for {len(out)} of {len(blocks)} questions')
    return out


def main():
    if not CACHE.exists():
        print(f'No cache at {CACHE}. Run: python3 fetch_math.py')
        return 1

    # Underscore-prefixed files are this pipeline's own bookkeeping -- the listing
    # fetch_math.py saves and the answer index below -- not questions.
    files = sorted(f for f in CACHE.glob('*.json') if not f.name.startswith('_'))
    if not files:
        print(f'{CACHE} is empty. Run: python3 fetch_math.py')
        return 1

    pdf_answers = build_pdf_answers()

    bank = []
    dropped = Counter()
    skills = defaultdict(int)
    no_answer = []
    dangling = []
    recovered = 0
    mask_stats = {}
    for f in files:
        rec = json.loads(f.read_text())
        meta, body = rec['meta'], rec['body']

        if isinstance(body, list):
            q, d = parse_ibn(body, meta)
        else:
            q, d = parse_api(body, meta)
        dropped += d

        domain = DOMAIN_SLUG.get(meta['primary_class_cd_desc'], 'algebra')
        skill = re.sub(r'[^a-z0-9]+', '-', meta['skill_desc'].lower()).strip('-')
        skills[skill] += 1

        qid = f"math-{meta['questionId']}"
        # After the whitelist, because both rewrite markup this file emits rather
        # than markup it received.
        for field in ('questionHtml', 'ruleHtml'):
            q[field] = mask_images(namespace_ids(q.get(field, ''), qid), mask_stats)
        for o in q.get('options', []):
            o['textHtml'] = mask_images(namespace_ids(o['textHtml'], qid), mask_stats)

        q.update({
            'id': qid,
            'source': SOURCE,
            # Marks the other SAT section. The app's domains and its score
            # projection are Reading and Writing; this is what lets it tell.
            'section': 'math',
            'skill': skill,
            'skillLabel': meta['skill_desc'],
            'domain': domain,
            'domainLabel': meta['primary_class_cd_desc'],
            'difficulty': DIFFICULTY.get(meta['difficulty'], 'medium'),
            'figure': '<svg' in q['questionHtml'],
        })

        # A figure whose glyph and clip references do not resolve renders as a
        # graph with blank boxes where its axis labels should be, and it does it
        # silently -- so the references are counted rather than trusted.
        blob = q['questionHtml'] + q.get('ruleHtml', '')
        defined = set(re.findall(r'\sid="([^"]+)"', blob))
        used = set(re.findall(r'(?:url\(#|xlink:href="#|\shref="#)([^"()\s]+)', blob))
        if used - defined:
            dangling.append((qid, len(used - defined)))

        # Only where the API left nothing. Its own answer is always preferred:
        # it is the same source the site grades against, and for the SPRs it
        # lists every accepted form rather than the one the rationale mentions.
        fallback = pdf_answers.get(meta['questionId']) or []
        if q['format'] == 'mcq':
            if q.get('correctLabel') not in ('A', 'B', 'C', 'D'):
                letter = (fallback[0] if fallback else '').strip().upper()[:1]
                if letter in ('A', 'B', 'C', 'D'):
                    q['correctLabel'] = letter
                    recovered += 1
        elif not q.get('answers') and fallback:
            q['answers'] = fallback
            recovered += 1

        ungradeable = (q['format'] == 'mcq'
                       and q.get('correctLabel') not in ('A', 'B', 'C', 'D')
                       ) or (q['format'] == 'spr' and not q.get('answers'))
        if ungradeable:
            # Held back rather than shipped. A question the app cannot mark is
            # worse than one that is not there: it would count as an attempt,
            # move his score, and never be right.
            no_answer.append(q['id'])
            continue

        bank.append(q)

    bank.sort(key=lambda q: (q['domain'], q['skill'], q['difficulty'], q['id']))
    BANKS.mkdir(exist_ok=True)

    # One file per domain rather than one for the lot. Together they are ~33 MB --
    # the figures are matplotlib SVGs carrying a glyph outline for every character
    # of every axis label, and the older items carry a bitmap per expression, so
    # the weight is real content and compacting the JSON saves nothing. Splitting
    # is what makes it affordable: the app loads none of this until the Maths
    # section is opened, and then only the domains it needs, so a Reading session
    # never pays for it.
    written = []
    for slug in sorted({q['domain'] for q in bank}):
        rows = [q for q in bank if q['domain'] == slug]
        path = BANKS / f'math-{slug}.json'
        path.write_text(json.dumps(rows, indent=1))
        written.append((path, len(rows), path.stat().st_size))

    # A row per question with no markup: id, skill, difficulty and nothing heavy.
    # The dropdown counts and the per-skill totals come from this, so the app can
    # show what is available before a single figure has been downloaded.
    index = [{k: q[k] for k in ('id', 'section', 'skill', 'skillLabel', 'domain',
                                'domainLabel', 'difficulty', 'format')
              if k in q} for q in bank]
    INDEX.write_text(json.dumps(index, indent=1))

    total = sum(s for _, _, s in written)
    mcq = sum(1 for q in bank if q['format'] == 'mcq')
    print(f'{len(bank)} questions -> {len(written)} domain files'
          f'  ({total / 1e6:.1f} MB total)')
    for path, n, size in written:
        print(f'    {path.name:34} {n:5} questions  {size / 1e6:5.1f} MB')
    print(f'  {INDEX.name}: {INDEX.stat().st_size / 1e3:.0f} KB, loaded up front')
    print(f'  {mcq} multiple choice, {len(bank) - mcq} student-response')
    print(f'  {sum(1 for q in bank if q.get("figure"))} with an inline SVG figure')
    print(f'  {sum(1 for q in bank if q.get("raster"))} disclosed items (maths as PNG)')
    print(f'  {len(skills)} skills across '
          f'{len({q["domain"] for q in bank})} domains')
    if dropped:
        print(f'  tags unwrapped: {dict(dropped.most_common(8))}')
    if dangling:
        print(f'\n  {len(dangling)} WITH UNRESOLVED SVG REFERENCES -- their figures'
              f' will render with blank labels:\n    '
              + ', '.join(f'{q} ({n})' for q, n in dangling[:8]))
    if mask_stats.get('n'):
        b, a = mask_stats['before'], mask_stats['after']
        print(f'  {mask_stats["n"]} bitmap expressions reduced to masks '
              f'({b/1e6:.1f} MB -> {a/1e6:.1f} MB, {100*(1-a/b):.0f}% smaller)')
    if mask_stats.get('no_pillow'):
        print('  (Pillow not installed -- bitmaps left as-is, dark theme needs a filter)')
    if mask_stats.get('failed'):
        print(f'  {mask_stats["failed"]} bitmaps could not be decoded, left as-is')
    if recovered:
        print(f'  {recovered} answer keys recovered from the PDF where the API had none')
    if no_answer:
        print(f'\n  {len(no_answer)} HELD BACK -- no answer key in either source, so'
              f' the app could never mark them:\n    {", ".join(no_answer[:12])}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
