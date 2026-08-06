# SAT Reading & Writing Practice

A single-page drill app built on the official College Board SAT Suite question
banks. Questions are served in order, progress persists between sessions, and
anything answered wrong comes back.

## Running it

Serve over HTTP so the browser can fetch the bank files:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Files

- `index.html` — the whole app
- `app.js` — question engine: sequencing, review splicing, progress
- `shared.js` — theme toggle and the sparkle reward animation
- `styles.css` — all styling, light and dark
- `extract_bank.py` — turns College Board question-bank PDFs into `banks/*.json`
- `extract_questions.py` — the older vocabulary-book extractor
- `banks/` — question data
- `book/` — source PDFs (not needed at runtime)

## How questions are chosen

- **In bank order, not at random.** A full pass covers every question once
  before any repeat.
- **The position is saved.** Closing the tab and coming back resumes at the next
  question, not the first. Each skill + difficulty combination keeps its own
  place.
- **Every 10th question is a review** — drawn at random from anything answered
  wrong within the current filter. Change `FRESH_PER_REVIEW` in `app.js`
  to alter the ratio.

## What is tracked

Everything persists to `localStorage` under `sat-practice-v2`:

- per question: how many times seen, right, and wrong
- per filter: how far through the sequence
- lifetime accuracy and per-skill coverage

`seen` increments when a question is **answered**, not when it is displayed, so
skipping with *Next Question* moves the cursor without inflating coverage. That
is why the position and the answered count legitimately differ.

## Adding question banks

Export a set from the College Board Educator Question Bank as PDF, drop it in
`book/`, then:

```bash
python3 extract_bank.py "craft - structure.pdf"   # one file
python3 extract_bank.py --all                     # everything in book/
```

A single export may mix several skills, so the skill and domain are read from
each question's own header and one `banks/cb-<skill>.json` file is written per
skill. Register new files in the `BANKS` array in `app.js`; the skill
dropdown and coverage panel build themselves from whatever is loaded.

Two things the extractor handles that are easy to get wrong:

- **`TEXT_INHIBIT_SPACES` is required.** Without it PyMuPDF reads these PDFs'
  font metrics as calling for a space inside every `rt` pair, so "artist"
  extracts as "ar tist" and the corpus ends up with zero occurrences of "rt".
- **Questions that depend on a table or chart are skipped.** The PDFs contain no
  embedded images: charts do not survive extraction at all, and tables flatten
  into an unreadable run of cells. Those questions would be unanswerable, so
  they are excluded and counted in the run report rather than silently dropped.

## Question format

```json
{
  "id": "cb-words-in-context-1a2b3c4d",
  "skill": "words-in-context",
  "domain": "craft-structure",
  "difficulty": "medium",
  "hasBlank": true,
  "passage": "Although the committee had deliberated for hours, it acted ___ once the deadline came.",
  "question": "Which choice completes the text with the most logical and precise word or phrase?",
  "rule": "One-line takeaway shown after answering.",
  "correctLabel": "B",
  "options": [
    { "label": "A", "text": "reluctantly", "why": "Why this choice fails." }
  ]
}
```

`passage` holds at most one `___`. Questions without one — main idea, text
structure, which-quotation-supports — render as plain prose. A question is
withheld at load time unless the answer key matches an option and every option
has both `text` and `why`, so a half-finished entry never reaches the quiz.

### Optional: the direction drill

An entry may also carry `direction` (`agree`, `reverse`, `result`, `define`),
`directionWhy`, and `signal`. When present, the app hides the answer choices and
first asks which way the sentence turns, then highlights the signal phrase on
reveal. `banks/context.json` has 24 such questions; the official banks carry no
relationship tag, so the step stays hidden for them.

## Unused banks

Kept on disk but not loaded: `banks/context.json` (24 direction-tagged),
`banks/adverbs.json` (30 adverb questions), `banks/questions.json` (539 from the
vocabulary book), `banks/handwritten-boundaries.json` (30). Add any of them to
`BANKS` to bring them back.
