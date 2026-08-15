// Unified SAT practice engine. Loads skill-tagged question banks and drills
// them in the real digital-SAT shape: a short passage with a blank, four
// choices, and a rule plus per-option reasoning on reveal.
//
// Questions are served in bank order, not at random, and the position is
// remembered so a new session resumes where the last one stopped. Every
// FRESH_PER_REVIEW questions, one previously-wrong question is spliced in.
// Per-question history persists, so nothing worked through is ever lost.
// Theme and sparkle come from shared.js.

// Cache-buster for the JSON data. index.html versions styles.css and app.js in
// its markup, but the banks are fetched from here, so nothing was busting them --
// a browser could serve a months-old vocab.json against new code, which is
// exactly what happened. Bump this whenever a file under banks/ changes.
const DATA_VERSION = '2026-08-14a';

// Official College Board banks only. banks/context.json is deliberately absent
// -- see the note in the README about Words in Context and the direction drill.
const BANKS = [
  { file: 'banks/cb-words-in-context.json' },
  { file: 'banks/cb-transitions.json' },
  { file: 'banks/cb-boundaries.json' },
  { file: 'banks/cb-form-structure-sense.json' },
  { file: 'banks/cb-inferences.json' },
  { file: 'banks/cb-text-structure-purpose.json' },
  { file: 'banks/cb-central-ideas-details.json' },
  { file: 'banks/cb-command-of-evidence.json' },
  { file: 'banks/cb-cross-text-connections.json' },
  { file: 'banks/cb-rhetorical-synthesis.json' }
];

// Ten fresh questions, then one repeat drawn from those he has gotten wrong.
const FRESH_PER_REVIEW = 10;

// The day's goal, in points rather than questions, so hitting it means working
// the skills that pay -- 500 lands at roughly 24 weak-skill answers or 31 mixed
// ones at his current accuracy. The point is that the day ENDS: an open sequence
// of 1667 questions can only ever be interrupted, never finished.
const DAILY_POINTS_TARGET = 500;

// A floor under a bad day. Points only come from correct answers, so at poor
// accuracy the target could recede all afternoon; reaching this many answers
// closes the day whatever the score.
const DAILY_QUESTION_CAP = 40;

// Test dates. These mark the red squares in the runway grid and set where it
// ends, so the runway on screen is the real one. Add or replace as sittings are
// booked; keys are local YYYY-MM-DD to match dayKey().
const EXAMS = [
  { key: '2026-08-22', label: 'Aug 22' },
  { key: '2026-09-12', label: 'Sept 12' }
];

// How much history to show before the current week. The grid runs from here to
// the week of the final exam, so it reads as a runway rather than a scrapbook:
// enough past to see whether the habit is holding, all the future that matters.
const HEATMAP_LOOKBACK_WEEKS = 1;

// --- Sections --------------------------------------------------------------
// The SAT scores Reading and Writing and Maths separately, 200-800 each, and
// only their sum is the 400-1600 figure. So the app keeps them apart all the way
// down: separate pool, separate dropdown, separate cursor, separate projection.
// Blending them would produce a number matching no real result.
//
// Both sections project a 200-800 score, each anchored on one of his own sittings
// rather than a published conversion table -- which keeps the number honest about
// what it is: a rough read off a real test, not a prediction.
//
//   rw    Practice 5, 6 Aug 2026 (Bluebook): 20 wrong of 54, so 34 right → 550.
//   math  Paper Test 6, 11 Aug 2026: 52 right of 54 → 780-800, midpoint 790.
//         Chosen because it is the one maths sitting where both the raw count and
//         the score are recorded; the Bluebook 760 has no raw count against it.
//
// Read the maths delta knowing what it is measured against: an anchor at 96%
// accuracy is a demanding baseline, and the bank skews harder than a real section
// -- so practice below that reads as "down on Practice 6" even on a good day. That
// is not a miscalibration, it is the anchor doing its job. `readout: 'accuracy'`
// is still supported for a section given no anchor at all.
const SECTIONS = {
  rw: {
    label: 'Reading & Writing', short: 'R&W', questions: 54, minutes: 64,
    readout: 'score', anchorLabel: 'Practice 5',
    anchor: { accuracy: 34 / 54, score: 550 }
  },
  math: {
    label: 'Math', short: 'Math', questions: 44, minutes: 70,
    readout: 'score', anchorLabel: 'Practice 6',
    anchor: { accuracy: 52 / 54, score: 790 }
  }
};
const SECTION_ORDER = ['rw', 'math'];
const DEFAULT_SECTION = 'rw';

// Every question in every Reading and Writing bank predates sections and carries
// no tag, so the absence of one means Reading and Writing -- which is what all of
// them are. Only the maths banks mark themselves.
function sectionOf(question) {
  return question && question.section === 'math' ? 'math' : 'rw';
}

// --- Score projection ------------------------------------------------------
// A digital-SAT section is scaled to 200-800, so 600 scaled points ride on its
// questions however many there are. That constant is now the whole conversion --
// see projectedScore -- and the old RW_QUESTIONS / POINTS_PER_QUESTION pair it
// replaced only ever multiplied back out to it.

// Judge on recent form over a section's worth of answers, not lifetime totals:
// review repeats mean a question he once failed gets counted again once he has
// learned it, which flatters a lifetime average indefinitely.
const RECENT_MAX = 200;
const MIN_FOR_PROJECTION = 20;

// --- Points ----------------------------------------------------------------
// Every question is worth base × skill weight, so the weak skills pay more and
// the score he is chasing pulls him toward the work that actually moves it.
//
//   points = POINTS_BY_DIFFICULTY[difficulty] × skillWeight(skill)
//            × REVIEW_BONUS if it is a spliced-in repeat
//            × REPEAT_CREDIT if he has already beaten this exact question
//
// Harder questions pay more because they are worth more on the test too.
const POINTS_BY_DIFFICULTY = { easy: 10, medium: 15, hard: 20 };

// Redeeming a question he previously got wrong is the single most valuable thing
// he can do, so repeats pay a premium.
const REVIEW_BONUS = 1.5;

// A question he has already answered correctly pays NOTHING, and is left out of
// the rolling form log. A fraction was not enough: `answered` resets on every
// question load, so Prev-Next-Submit could be repeated without limit -- at a
// quarter of 60 points that is a 500-point day in about 31 clicks and no
// reading. Going back to re-read an explanation stays free; it just earns
// nothing and cannot flatter the projection.
const ALREADY_BEATEN_PAYS = 0;

// Weakness from Practice 5, scaled 1.0 (never missed) to 3.0 (missed most).
// Used until there is enough live evidence in this app to judge a skill on its
// own, at which point skillWeight() takes over and the weights become dynamic.
const BASELINE_ERRORS = {
  'words-in-context': 6,
  // Drills the same weakness, so it starts priced the same.
  vocabulary: 6,
  boundaries: 4,
  transitions: 3,
  'form-structure-sense': 2,
  inferences: 2,
  'text-structure-purpose': 1,
  'command-of-evidence': 1,
  'rhetorical-synthesis': 1,
  'central-ideas-details': 0,
  'cross-text-connections': 0,
  // Top weight from the start. Every question in this set is one he actually got
  // wrong on a timed practice test, which makes it the most valuable thing in the
  // app to beat -- and, once he has answered a few, skillWeight() takes over and
  // prices it on his live accuracy like any other skill.
  'missed-in-test': 6
};
const WORST_BASELINE = 6;

// How many recent answers in a skill before his live accuracy outranks the
// Practice 5 baseline. Five is enough to show a trend without whipsawing.
const SKILL_FORM_MIN = 5;
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 3;

// Accuracy at or below this counts as fully weak; at 100% a skill pays base only.
const WEIGHT_FLOOR_ACCURACY = 0.4;

// Every Nth consecutive correct answer is worth marking. Five is often enough to
// feel reachable and rare enough that the burst still means something.
const CELEBRATE_RUN = 5;

// --- Peeking at the meanings ------------------------------------------------
// Showing what the four choices mean turns a question he cannot read into one he
// can reason about, so it earns something -- but less, and less again the more he
// leans on it in a day. An escalating cost rather than a hard cap: a cap would
// block him on the one question where he genuinely needs the help, whereas this
// only makes habitual peeking unprofitable.
const PEEK_RATES = [
  { upTo: 3, pay: 0.5 },
  { upTo: 8, pay: 0.35 },
  { upTo: Infinity, pay: 0.2 }
];

function peekRateToday() {
  const used = dayStats().peeks || 0;
  return (PEEK_RATES.find((r) => used < r.upTo) || PEEK_RATES[PEEK_RATES.length - 1]).pay;
}

// The mark inside the ring on the top-bar tile, by share of the day's target.
// Five states rather than a bare number, so the tile reads at a glance from
// across the room rather than needing to be read.
// The stages continue well past 100%: stopping at the target would mean the tile
// goes dead exactly when he is doing his best work. Each rung is a real multiple
// of the day's 500, and every completed multiple also adds an outer ring.
const TARGET_STAGES = [
  { upTo: 0, icon: '💤', label: 'not started' },
  { upTo: 33, icon: '🌱', label: 'under way' },
  { upTo: 66, icon: '⚡', label: 'halfway' },
  { upTo: 99, icon: '🔥', label: 'nearly there' },
  { upTo: 149, icon: '🏆', label: 'target met' },
  { upTo: 199, icon: '💎', label: 'target and a half' },
  { upTo: 299, icon: '🚀', label: 'double target' },
  { upTo: 399, icon: '👑', label: 'triple target' },
  { upTo: Infinity, icon: '🌟', label: 'four times over' }
];

// Outer rings for whole targets beyond the first, capped so the tile cannot grow
// without limit.
const MAX_LAPS = 3;

// Optional focus set. When it holds skills, only those reach the app at all --
// the only entries in the dropdown, the only thing the set counts draw from, and
// the only rows in Coverage, so there is nothing else to wander into. EMPTY, as
// now, means every skill is available.
//
// The set worth reaching for is drawn from Practice 5 (6 Aug 2026, R&W 550 /
// Math 770). Of his 20 wrong answers: words in context 6, boundaries 4,
// transitions 3 -- 13 of 20 between them. The first and third fail the same way,
// picking an option that suits the topic without checking which way the sentence
// turns, which is exactly what the direction drill is for:
//
//   const FOCUS_SKILLS = ['words-in-context', 'transitions', 'boundaries'];
const FOCUS_SKILLS = [];

// The two-step drill. He loses points by picking a word that fits the topic
// without checking which way the sentence turns, so when this is on the app
// makes him commit to the relationship BEFORE it shows him any words.
const DIRECTIONS = [
  { key: 'agree', label: 'Agrees', hint: 'the blank matches the idea beside it' },
  { key: 'reverse', label: 'Reverses', hint: 'the blank opposes the idea beside it' },
  { key: 'result', label: 'Cause or result', hint: 'one side produces the other' },
  { key: 'define', label: 'Defines', hint: 'what follows spells the blank out' }
];

const SKILL_LABELS = {
  vocabulary: 'Vocabulary',
  defective: 'Needs the PDF',
  'missed-in-test': 'Missed in a test',
  'educator-bank': 'Educator question bank',
  'words-in-context': 'Words in Context',
  transitions: 'Transitions',
  boundaries: 'Boundaries',
  'form-structure-sense': 'Form, Structure & Sense',
  inferences: 'Inferences',
  'text-structure-purpose': 'Text Structure & Purpose',
  'central-ideas-details': 'Central Ideas & Details',
  'command-of-evidence': 'Command of Evidence',
  'cross-text-connections': 'Cross-Text Connections',
  'rhetorical-synthesis': 'Rhetorical Synthesis'
};

const DOMAIN_LABELS = {
  'information-ideas': 'Information and Ideas',
  'craft-structure': 'Craft and Structure',
  'expression-of-ideas': 'Expression of Ideas',
  'standard-english': 'Standard English Conventions',
  // Not an SAT domain. The four above are the real score-report headings, so
  // anything of our own goes here rather than among them -- the vocabulary drill,
  // and the questions that need the PDF.
  extra: 'Extras — not score-report skills'
};

// Same order the Bluebook score report uses, so the nav is recognisable. Within
// a domain, the skills he loses the most points on come first.
const DOMAIN_ORDER = [
  'craft-structure',
  'expression-of-ideas',
  'standard-english',
  'information-ideas',
  // Last, so the score-report order above stays untouched.
  'extra'
];

const SKILLS_BY_DOMAIN = {
  'craft-structure': ['words-in-context', 'text-structure-purpose', 'cross-text-connections'],
  'expression-of-ideas': ['transitions', 'rhetorical-synthesis'],
  'standard-english': ['boundaries', 'form-structure-sense'],
  'information-ideas': ['inferences', 'central-ideas-details', 'command-of-evidence'],
  // First in the group: it is the set with the most to teach him.
  extra: ['missed-in-test', 'educator-bank', 'vocabulary', 'defective']
};

// The ones that are not score-report skills, as a set, so the "all skills" total
// in the dropdown can leave them out without repeating the list.
const EXTRA_SKILLS = new Set(SKILLS_BY_DOMAIN.extra);

// Word meanings for the Words in Context options, keyed by question id then
// option label. Built by extract_vocab.py from College Board's own rationale
// text. Optional: if the file is missing the app runs exactly as before.
const VOCAB_FILE = 'banks/vocab.json';
let vocabByQuestion = {};

// Questions the PDF extraction broke -- they ask about an underlined portion that
// no longer exists, so nothing on screen says which words were meant. Built by
// find_defective.py, which also records where to read each one in the source PDF.
// They are retagged to their own skill so they cannot turn up unannounced inside
// a real practice set.
const DEFECTIVE_FILE = 'banks/defective.json';
const DEFECTIVE_SKILL = 'defective';

// Questions he got wrong on a real, timed practice test. They keep their own
// skill so they never turn up unannounced inside ordinary practice -- this is a
// set he chooses to revise -- while `realSkill` on each one records what it
// actually tests. Built by extract_missed.py; grows after every practice test.
//
// Loaded separately from BANKS rather than as an eleventh entry, so it can be
// appended AFTER the vocabulary drill in bank order. That ordering is not
// cosmetic: `pool` is `bank` filtered in place, and the saved cursor is an index
// into it, so anything inserted ahead of an existing question moves the place he
// had been holding. Appending at the end leaves every existing index untouched.
// Short lessons on the rules the questions turn on, keyed to the skills they
// belong to. Authored, not extracted: College Board's rationales explain one
// question each, and a rule is the thing they have in common.
const CONCEPTS_FILE = 'banks/concepts.json';
let concepts = [];

const MISSED_FILE = 'banks/missed-in-test.json';
const MISSED_SKILL = 'missed-in-test';
let missedQuestions = [];

// The 171 questions the first extraction pass left behind -- 138 of them because
// the answer lives in a graph or table, which is not text and never survived the
// PDF. 136 are Command of Evidence, the skill the 9 Aug test showed collapsing,
// so the app was thinnest exactly where he needs the most work. Built by
// extract_educator.py, which records the page to open for the figure.
//
// Loaded and appended last, for the same reason as MISSED_FILE: bank order is
// what the saved cursor indexes.
const EDU_FILE = 'banks/educator-question-bank.json';
const EDU_SKILL = 'educator-bank';
let eduQuestions = [];

// What a question actually tests, as opposed to which set it is filed under.
// Both the missed-in-test and educator sets are grouped by where they came from,
// so anything reasoning about skill -- the peek, the drill link, the badge line --
// has to ask this rather than read `skill` directly.
function skillTested(question) {
  if (!question) return null;
  return question.realSkill || question.skill;
}
let defectiveById = {};
let vocabQuestions = [];
// word (lowercased) -> its drill question id, so a Words in Context question can
// send him straight to the word he just tripped over.
let vocabDrillByWord = {};

const STORE_KEY = 'sat-practice-v2';

let bank = [];        // every loaded question, in bank order
let pool = [];        // the subset the current filter draws from, same order
let current = null;
let answered = false;
// Index of the choice he has marked but not yet submitted, or null. Grading is
// behind the Submit button so he can weigh two options and change his mind.
let pendingIndex = null;
let servingReview = false; // is the question on screen a spliced-in repeat?
let skillFilter = 'all';   // 'all' or any key of SKILL_LABELS
let difficultyFilter = 'all'; // 'all' | 'easy' | 'medium' | 'hard'
// 'all' or a `test` label from the missed-in-test set. Applies to that one skill
// only -- every other bank is a question bank, not a sitting of a test.
let testFilter = 'all';
let wrongOnly = false;     // restrict to questions he has gotten wrong
// Drop the ones he got right first time, so the set is what he has left to do.
// On by default; nothing is deleted, so unticking restores them all.
// Which SAT section is on screen. Everything that could mix the two keys off
// this: the pool, the skill dropdown, the cursor and the projection.
let section = DEFAULT_SECTION;
let hideAced = true;
let starredOnly = false;   // show only the questions he has starred
let clearedCount = 0;      // how many the line above set aside, for the readout
let missedCount = 0;       // and how many "Wrong answers only" is holding back
let directionAnswered = false;
let directionCorrect = null;
let sessionStreak = [];
let directionHits = 0;
let directionTotal = 0;
// Points earned on the question currently on screen, or null before it is
// graded. Drives the "+45 earned" chip without recomputing a stale weight.
let lastAward = null;
// Which stage mark the tile is showing, so a change can be animated once
// rather than on every repaint.
let lastStageIcon = null;
// Where a jump came from, so the trip works both ways: { id, word, at }. `at` is
// the question he was sent to, which is what decides whether the return link is
// relevant to whatever is now on screen.
let returnTo = null;

const STREAK_LENGTH = 8;

const titleEl = document.querySelector('.question-title');
const metaEl = document.querySelector('.q-meta');
const passageEl = document.querySelector('.cloze');
const mathStemEl = document.getElementById('mathStem');
const optionsContainer = document.querySelector('.options');
const ruleBox = document.getElementById('ruleBox');
const conceptPanel = document.getElementById('conceptPanel');
const conceptTitleEl = document.getElementById('conceptTitle');
const conceptBodyEl = document.getElementById('conceptBody');
const conceptHintEl = document.getElementById('conceptHint');
const correctCountEl = document.getElementById('correctCount');
const incorrectCountEl = document.getElementById('incorrectCount');
const streakEl = document.getElementById('streakStrip');
const lifetimeEl = document.getElementById('lifetimeStats');
const skillSelect = document.getElementById('skillSelect');
const difficultySelect = document.getElementById('difficultySelect');
const testSelect = document.getElementById('testSelect');
const testControl = document.getElementById('testControl');
const hideAcedToggle = document.getElementById('hideAcedToggle');
const starredOnlyToggle = document.getElementById('starredOnlyToggle');
// Rebuilt with the rest of the badge line on every renderMeta, exactly as the
// timer is, so it is looked up again rather than held: the element this points at
// is replaced, not mutated.
let starBtn = null;
const skillStatsEl = document.getElementById('skillStats');
// One readout per pager -- there is a copy above and below the question -- so
// this is a list rather than a single element by id.
const readoutEls = document.querySelectorAll('.set-readout');
const directionStep = document.getElementById('directionStep');
const directionChoices = document.getElementById('directionChoices');
const directionFeedback = document.getElementById('directionFeedback');
const directionScoreEl = document.getElementById('directionScore');
const wrongOnlyToggle = document.getElementById('wrongOnlyToggle');
const questionCard = document.getElementById('questionCard');
const submitBtn = document.getElementById('submitAnswer');
const submitRow = document.getElementById('submitRow');
const dailyCountEl = document.getElementById('dailyCount');
const dailyNoteEl = document.getElementById('dailyNote');
const dailyFillEl = document.getElementById('dailyFill');
const daySplitEl = document.getElementById('daySplit');
const splitRwPtsEl = document.getElementById('splitRwPts');
const splitMathPtsEl = document.getElementById('splitMathPts');
const splitRestEl = document.getElementById('splitRest');
const splitRestPtsEl = document.getElementById('splitRestPts');
const scoreSplitEl = document.getElementById('scoreSplit');
const splitRwScoreEl = document.getElementById('splitRwScore');
const splitMathScoreEl = document.getElementById('splitMathScore');
const dayDoneEl = document.getElementById('dayDone');
const dayDoneDetailEl = document.getElementById('dayDoneDetail');
const dayDoneGoBtn = document.getElementById('dayDoneGo');
const streakDaysEl = document.getElementById('streakDays');
const heatmapEl = document.getElementById('heatmap');
const projectionEl = document.getElementById('projection');
const projectionNoteEl = document.getElementById('projectionNote');
const pointsNoteEl = document.getElementById('pointsNote');
const targetMiniEl = document.getElementById('targetMini');
const targetLblEl = document.getElementById('targetLbl');
const targetRingEl = document.getElementById('targetRing');
const targetIconEl = document.getElementById('targetIcon');
const progressDialog = document.getElementById('progressDialog');
const progressSubEl = document.getElementById('progressSub');
const wordsHeadingEl = document.getElementById('wordsHeading');
const wordsListEl = document.getElementById('wordsList');
const sourceRowEl = document.getElementById('sourceRow');
const sourceLinkEl = document.getElementById('sourceLink');
const peekRowEl = document.getElementById('peekRow');
const peekBtnEl = document.getElementById('peekBtn');
const peekNoteEl = document.getElementById('peekNote');
const pdfNoticeEl = document.getElementById('pdfNotice');
const pdfNoticeDetailEl = document.getElementById('pdfNoticeDetail');
const pdfNoticeTitleEl = document.getElementById('pdfNoticeTitle');
const streakValueEl = document.getElementById('streakValue');
const bestValueEl = document.getElementById('bestValue');

// Dismissed per session, not persisted: reopening the app on a finished day
// should say so again, but "keep going" must stay dismissed while he carries on.
let dayBannerDismissed = false;

// --- Persistence -----------------------------------------------------------
// Everything the learner does is kept, not just his mistakes:
//
//   progress[questionId] = { seen, correct, wrong, skill, last }
//   cursor[filterKey]    = how far through that filtered sequence he has gone
//   sinceReview          = fresh questions served since the last repeat
//
// The cursor is what makes a new session resume instead of restarting, and it
// is per filter combination so switching skill does not lose your place in the
// one you were working through.

function emptyStore() {
  return {
    version: 2,
    progress: {},
    cursor: {},
    // learn[conceptId] = { read, rung, seen, best }. The Learn section's own
    // record, kept apart from progress on purpose: a rung he fluffs must not
    // mark a question wrong in the drill or move a counter.
    learn: {},
    // days['2026-08-07'] = { answered, correct }. One row per calendar day he
    // works, which is what the daily target reads and what the streak and the
    // day-to-day comparison will read later.
    days: {},
    // Rolling log of outcomes, oldest first: { s: skill, ok: 0|1 }. Capped at
    // RECENT_MAX. This is what the projection reads, so it reflects current form
    // rather than everything he has ever attempted.
    recent: [],
    // due[questionId] = the answer count at which a vocabulary word is owed
    // another showing. `served` is that count: answers, not questions-in-bank.
    due: {},
    served: 0,
    // vocab[questionId] = { run } -- consecutive right answers on that word.
    vocab: {},
    // starred[questionId] = true. The one set in here he chooses by hand: every
    // other -- missed, cleared, mastered -- is worked out from his answers. A star
    // means "I want to find this again", which no amount of answer history can
    // infer, so nothing ever sets or clears it except him.
    starred: {},
    // concepts[conceptId] = { folded } -- whether he has closed that lesson. Only
    // ever set by him folding it; it opens by itself the first time only.
    concepts: {},
    sinceReview: 0,
    filters: { skill: 'all', difficulty: 'all', test: 'all', hideAced: true }
  };
}

// Local date, deliberately not toISOString(): that is UTC, so east of Greenwich
// an evening session would be filed under tomorrow. A 9pm answer in Mumbai
// belongs to today.
function dayKey(when) {
  const d = when || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Fri 7 Aug" -- for tooltips, where an ISO key reads like a database row.
function prettyDay(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayStats(key) {
  const d = store.days[key || dayKey()];
  return d
    ? { points: 0, peeks: 0, ...d }
    : { answered: 0, correct: 0, points: 0, peeks: 0 };
}

// Best points total on any day before today -- the number to beat.
function bestDayBefore() {
  const today = dayKey();
  let best = { key: null, points: 0 };
  Object.entries(store.days).forEach(([key, day]) => {
    if (key >= today) return;
    if (day.estimated) return; // estimated, so not a real record to chase
    if ((day.points || 0) > best.points) best = { key, points: day.points || 0 };
  });
  return best;
}

// Consecutive days worked, counting back from today. If today is still empty we
// start from yesterday: at 9am an untouched day should not read as a broken
// streak, only a day that has fully passed should break it.
function dayStreak() {
  const cursor = new Date();
  if (!store.days[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);

  let run = 0;
  while (store.days[dayKey(cursor)]) {
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}

function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d); // local midnight, matching dayKey()
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}


// Shade by how much of the target the day reached, not by raw count, so the
// scale means the same thing if the target ever changes.
function heatLevel(points) {
  if (points <= 0) return 0;
  const share = points / DAILY_POINTS_TARGET;
  if (share >= 1) return 4;
  if (share >= 0.66) return 3;
  if (share >= 0.33) return 2;
  return 1;
}

function loadStore() {
  const fresh = emptyStore();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(fresh, JSON.parse(raw));

    // Carry over the v1 miss queue so earlier work is not thrown away.
    const legacy = localStorage.getItem('sat-practice-v1');
    if (legacy) {
      const old = JSON.parse(legacy);
      Object.entries(old.queue || {}).forEach(([id, entry]) => {
        fresh.progress[id] = {
          seen: entry.misses || 0,
          correct: 0,
          wrong: entry.misses || 0,
          skill: entry.skill || 'unknown'
        };
      });
    }
  } catch (err) {
    console.warn('Could not read saved progress; starting fresh.', err);
    return emptyStore();
  }
  return fresh;
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (err) {
    // Storage full or blocked: the session still works, it just will not persist.
    console.warn('Could not save progress.', err);
  }
}

let store = loadStore();

// The chosen skill and difficulty are part of saved state, so reopening the app
// lands on the same set -- and, because the cursor is keyed by that pair, at the
// same place within it. "Wrong answers only" stays deliberately per-session: it
// is a temporary mode, and restoring it silently would greet him with an empty
// set on the days he has nothing outstanding.
skillFilter = (store.filters && store.filters.skill) || 'all';
difficultyFilter = (store.filters && store.filters.difficulty) || 'all';
testFilter = (store.filters && store.filters.test) || 'all';
// Absent means never turned off, which is the default state -- so this reads the
// stored value only to honour an explicit untick, and `|| true` would not do:
// stored `false` has to survive a reload.
hideAced = !(store.filters && store.filters.hideAced === false);
starredOnly = !!(store.filters && store.filters.starredOnly);

function rememberFilters() {
  store.filters = {
    skill: skillFilter, difficulty: difficultyFilter, test: testFilter,
    hideAced: hideAced, starredOnly: starredOnly
  };
  saveStore();
}

function statsFor(id) {
  return store.progress[id] || { seen: 0, correct: 0, wrong: 0 };
}

function recordAnswer(question, isCorrect, pointsGained) {
  // Read before the counts move: revision must not reach the day's tally or the
  // form log.
  const revision = isRevision(question);

  const entry = store.progress[question.id] ||
    { seen: 0, correct: 0, wrong: 0, skill: question.skill };
  entry.seen += 1;
  if (isCorrect) entry.correct += 1;
  else entry.wrong += 1;
  entry.skill = question.skill;
  entry.last = dayKey();
  store.progress[question.id] = entry;

  // Tally the day alongside the question, so the daily target counts answers
  // rather than questions-ever-seen and survives a reload mid-set. Revision is
  // excluded: it would push the answered count toward the question cap and so
  // close the day on work that earned nothing.
  if (!revision) {
    const key = dayKey();
    const day = store.days[key] || { answered: 0, correct: 0, points: 0 };
    day.answered += 1;
    if (isCorrect) day.correct += 1;
    day.points = (day.points || 0) + (pointsGained || 0);

    // Split alongside the total, not instead of it. The ring, the daily target,
    // the heatmap and the best-day record are all about the habit rather than the
    // subject, so they keep reading `day.points` and are untouched by this. Days
    // recorded before the split existed simply have no `bySection`, which reads
    // as "we do not know", not as zero -- see renderDaily.
    const sec = sectionOf(question);
    const split = day.bySection || (day.bySection = {});
    const bucket = split[sec] || (split[sec] = { answered: 0, correct: 0, points: 0 });
    bucket.answered += 1;
    if (isCorrect) bucket.correct += 1;
    bucket.points += (pointsGained || 0);

    store.days[key] = day;

    // Rolling form, oldest trimmed off the front. Re-answering something he has
    // already learned would lift this average without him improving.
    const recent = store.recent || [];
    // `sec` is tagged from here on so the two projections stay separate. Rows
    // saved before sections existed carry none, and are read as Reading and
    // Writing below, which is what every one of them was.
    recent.push({ s: question.skill, ok: isCorrect ? 1 : 0,
                  sec: sectionOf(question) });
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
    store.recent = recent;
  }

  // OUTSIDE the revision guard, deliberately. The clock and the word's schedule
  // must advance on every answer: with these inside, a vocabulary word answered
  // right once became permanent "revision", so scheduleVocab stopped running, its
  // due time froze in the past, and it came back every few questions for ever
  // while its run never reached mastery. That is the "seen 6x and counting" bug.
  store.served = (store.served || 0) + 1;
  scheduleVocab(question, isCorrect);

  saveStore();
}

// Accuracy within one skill. Prefers the rolling log, but falls back to
// everything he has ever done in that skill -- the log only started when points
// did, so without this fallback months of work read as "not rated yet".
function skillForm(skill) {
  const list = (store.recent || []).filter((r) => r.s === skill);
  if (list.length >= SKILL_FORM_MIN) {
    const ok = list.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
    return { n: list.length, accuracy: ok / list.length };
  }

  let seen = 0;
  let correct = 0;
  Object.values(store.progress).forEach((e) => {
    if (e.skill !== skill) return;
    seen += e.seen || 0;
    correct += e.correct || 0;
  });
  if (seen === 0) return { n: 0, accuracy: 0 };
  return { n: seen, accuracy: correct / seen, lifetime: true };
}

// Same idea for the projection: recent form if there is enough of it, otherwise
// his whole record, so the headline number is not blank for someone who has
// answered hundreds of questions.
function formForProjection(sec) {
  const which = sec || section;
  const recent = recentForm(null, which);
  if (recent.n >= MIN_FOR_PROJECTION) return recent;

  // The fallback has to be filtered by section too, and progress entries predate
  // sections so they carry no tag -- but every maths id begins `math-` and no
  // Reading id does, so the key itself says which section an entry belongs to.
  // Without this the maths projection would open by reporting Reading accuracy.
  const mine = Object.entries(store.progress)
    .filter(([id]) => (id.startsWith('math-') ? 'math' : 'rw') === which)
    .map(([, e]) => e);
  const seen = mine.reduce((n, e) => n + (e.seen || 0), 0);
  const correct = mine.reduce((n, e) => n + (e.correct || 0), 0);
  if (seen < MIN_FOR_PROJECTION) return recent;
  return { n: seen, ok: correct, accuracy: correct / seen, lifetime: true };
}

// One-time rebuild of the day history. progress[].last is the only record of
// WHEN earlier work happened, so days before the rolling log can be recovered
// approximately: it holds each question's most recent day, which undercounts a
// question answered across several days. Flagged as estimated in the tooltip.
function backfillDays() {
  const today = dayKey();

  // Repair: an earlier version of this function filled TODAY as well, and
  // credited every attempt a question had ever had to the single day in
  // progress[].last. The result was today's tile showing lifetime totals.
  if (store.days[today] && store.days[today].estimated) {
    delete store.days[today];
    store.backfilledDays = false;
  }

  if (store.backfilledDays) return;
  store.backfilledDays = true;

  const rebuilt = {};
  Object.values(store.progress).forEach((e) => {
    // Today belongs to the live log, which is exact. Estimating it as well would
    // double-count everything he does from here on.
    if (!e.last || e.last >= today) return;

    const d = rebuilt[e.last] || { answered: 0, correct: 0, points: 0, estimated: true };
    // ONE answer per question, not e.seen: `last` records a single day, so
    // crediting every attempt to it inflates that day by the whole history.
    d.answered += 1;
    if ((e.correct || 0) > 0) d.correct += 1;
    // Medium base at the skill's baseline weight: difficulty was never stored
    // per attempt, so this is the best estimate available.
    if ((e.correct || 0) > 0) {
      d.points += Math.round(POINTS_BY_DIFFICULTY.medium * skillWeight(e.skill));
    }
    rebuilt[e.last] = d;
  });

  // Never overwrite a real record -- only fill days the log knows nothing about.
  Object.entries(rebuilt).forEach(([key, day]) => {
    if (!store.days[key]) store.days[key] = day;
  });
  saveStore();
}

// How much a skill pays, 1.0 to 3.0. Live accuracy once there is enough of it,
// otherwise the Practice 5 baseline -- so the weighting is right from the first
// question and then becomes his own as he works.
function skillWeight(skill) {
  const form = skillForm(skill);

  if (form.n >= SKILL_FORM_MIN) {
    const acc = Math.max(WEIGHT_FLOOR_ACCURACY, Math.min(1, form.accuracy));
    const badness = (1 - acc) / (1 - WEIGHT_FLOOR_ACCURACY); // 0 = perfect, 1 = floor
    return round1(WEIGHT_MIN + badness * (WEIGHT_MAX - WEIGHT_MIN));
  }

  const errors = BASELINE_ERRORS[skill] || 0;
  return round1(WEIGHT_MIN + (errors / WORST_BASELINE) * (WEIGHT_MAX - WEIGHT_MIN));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// What this question pays if answered correctly right now.
// Has he ever got this one right before? If so it is revision, not progress.
function alreadyBeaten(id) {
  return statsFor(id).correct > 0;
}

// Revision earns nothing and is kept out of the day's tally. For a real SAT
// question that means any re-answer, since one pass is the work.
//
// Vocabulary is the opposite case: coming back to a word IS the work, so a word
// that is due counts fully. Only one answered ahead of its schedule is revision,
// which is what stops Prev-Next-Submit farming -- answering again immediately
// pushes `due` into the future, so the second answer pays nothing.
function isRevision(question) {
  if (question.skill === VOCAB_SKILL) {
    const due = (store.due || {})[question.id];
    return !(due === undefined || due <= (store.served || 0));
  }
  return alreadyBeaten(question.id);
}

function questionPoints(question) {
  if (isRevision(question)) return ALREADY_BEATEN_PAYS;

  const base = POINTS_BY_DIFFICULTY[question.difficulty] || POINTS_BY_DIFFICULTY.medium;
  // These are ordinary bank questions that only ever sat outside the app because
  // they need a figure, so they pay what their own skill pays. The missed-in-test
  // set is different on purpose: it keeps its own top weight, because getting a
  // question wrong on a timed test is what makes it worth the most.
  const priced = question.skill === EDU_SKILL ? skillTested(question) : question.skill;
  let points = base * skillWeight(priced);
  if (servingReview) points *= REVIEW_BONUS;
  // The rate is fixed at the moment he peeks, so peeking again later on another
  // question cannot retroactively devalue this one.
  if (peekPay !== null && current && question.id === current.id) points *= peekPay;
  return Math.max(1, Math.round(points));
}

// Accuracy over the last `window` answers within one section, default that
// section's own length. Filtered before slicing, not after: taking the last 54
// rows and then dropping the maths ones would leave a handful of Reading answers
// standing in for a section's worth of form.
function recentForm(window, sec) {
  const which = sec || section;
  const all = (store.recent || []).filter((r) => (r.sec || 'rw') === which);
  const list = all.slice(-(window || SECTIONS[which].questions));
  if (list.length === 0) return { n: 0, ok: 0, accuracy: 0 };
  const ok = list.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
  return { n: list.length, ok, accuracy: ok / list.length };
}

// Shift off the anchor by however many questions his accuracy differs by, at
// roughly 11 points a question. Rounded to 10 because a projection precise to
// the point would be pretending.
function projectedScore(accuracy, sec) {
  // Only the sections that carry an anchor can be projected; Maths deliberately
  // has none, and falling back to Reading's would read maths accuracy through a
  // Reading conversion, which is the exact mistake sections exist to prevent.
  const cfg = SECTIONS[sec || section];
  if (!cfg || !cfg.anchor) return null;
  // 600 scaled points spread across that section's questions, so a maths
  // question moves the maths score further than a Reading one moves Reading --
  // there are fewer of them carrying the same range.
  const raw = cfg.anchor.score +
    (accuracy - cfg.anchor.accuracy) * 600;
  return Math.min(800, Math.max(200, Math.round(raw / 10) * 10));
}

// Anything he has ever gotten wrong stays eligible for review, however many
// times he has since gotten it right -- the counts are shown so the record is
// visible rather than silently retired.
function isWrongEver(id) {
  return statsFor(id).wrong > 0;
}

// Answered, and never once missed. The progress entry keeps totals rather than a
// list of attempts, so which attempt was the wrong one is not recorded -- but a
// question with no wrong answers against it can only have been right first time,
// and one he got right first and then missed is exactly what he should still see.
function acedFirstTime(id) {
  const stats = statsFor(id);
  return stats.seen > 0 && stats.wrong === 0;
}

// Is a question retired from the pool by "Hide first-time correct"? The vocabulary
// drill is exempt: it retires words on its own schedule, needing VOCAB_MASTERED_BY
// correct answers in a row, and one right answer is not that.
function isAced(question) {
  return hideAced && question.skill !== VOCAB_SKILL && acedFirstTime(question.id);
}

// Is a question held back for the "Wrong answers only" view? Questions he has
// missed do not belong in the ordinary sequence: met one at a time, weeks apart
// and surrounded by fresh ones, a mistake is just an interruption. Gathered
// behind the tick they are a set he can work through as a set, which is the only
// way the pattern in them is visible.
//
// Vocabulary is exempt, as it is above and for the same reason: a word he missed
// is precisely the word the drill has to bring back, and it retires words itself
// once he has answered them right VOCAB_MASTERED_BY times running. Pulling missed
// words out here would leave the drill nothing to teach him.
function isStarred(id) {
  return !!(store.starred && store.starred[id]);
}

function toggleStar(id) {
  store.starred = store.starred || {};
  if (store.starred[id]) delete store.starred[id];
  else store.starred[id] = true;
  saveStore();
  return isStarred(id);
}

function starredCount() {
  return Object.keys(store.starred || {}).length;
}

function isMissed(question) {
  return !wrongOnly && question.skill !== VOCAB_SKILL && isWrongEver(question.id);
}

// --- Rendering -------------------------------------------------------------


// Built from text nodes rather than innerHTML so authored passages are never
// interpreted as markup.
//
// On reveal we mark the signal phrase, because the whole lesson is that the
// answer was decided by a word he read past. Highlighting it before he answers
// would give the question away, so it only appears afterwards.
function appendText(parent, text, signal) {
  if (!signal) {
    parent.append(text);
    return;
  }
  const at = text.indexOf(signal);
  if (at === -1) {
    parent.append(text);
    return;
  }
  const mark = document.createElement('mark');
  mark.className = 'signal';
  mark.textContent = signal;
  parent.append(text.slice(0, at), mark, text.slice(at + signal.length));
}

// Some questions ask about "the underlined portion", which is worthless unless
// something is actually underlined. The practice-test PDFs mark that portion up
// for screen readers, so extract_missed.py can recover it and store it verbatim;
// this puts the underline back. Built as a real element rather than markup in
// the passage, so passages are still never interpreted as HTML.
function appendUnderlined(parent, text, portion, signal) {
  const at = portion ? text.indexOf(portion) : -1;
  if (at === -1) {
    appendText(parent, text, signal);
    return;
  }
  const u = document.createElement('u');
  u.className = 'referenced';
  appendText(u, portion, signal);
  appendText(parent, text.slice(0, at), signal);
  parent.append(u);
  appendText(parent, text.slice(at + portion.length), signal);
}

// The ONE place this app puts markup on the page rather than text nodes, and the
// only content it does it for: `banks/math-*.json`.
//
// Everywhere else builds text nodes on purpose, so an authored passage can never
// be read as HTML. Maths cannot work that way -- an equation is MathML, a graph is
// SVG, and both are structure, not characters. What makes this safe is where the
// markup comes from: extract_math.py rewrites every field through a tag-and-
// attribute whitelist, drops every `on*` handler, and allows a url() only when it
// points inside the same document. Nothing here is user input and nothing is
// fetched at render time.
//
// So the rule for anyone editing this: content reaching setMarkup must have come
// through that sanitiser. Do not point it at anything else.
function setMarkup(el, markup) {
  el.innerHTML = markup || '';
}

function renderMathStem(question) {
  passageEl.textContent = '';
  passageEl.hidden = true;
  if (!mathStemEl) return;
  mathStemEl.hidden = false;
  // Maths figures are monochrome line art and follow the text colour instead --
  // only the Reading charts need their paper. See renderPassage.
  mathStemEl.classList.remove('is-paper');
  setMarkup(mathStemEl, question.questionHtml);
}

function renderPassage(question, showSignal) {
  passageEl.hidden = false;
  if (mathStemEl) {
    mathStemEl.hidden = true;
    mathStemEl.textContent = '';
    mathStemEl.classList.remove('is-paper');
  }

  // A passage whose figure is a graph or a data table cannot be text nodes -- that
  // is what put 138 questions behind a "go and open the PDF" notice, with the
  // graph's axis labels flattened into the prose. fetch_rw_figures.py fetches the
  // real thing from the API and sanitises it through the same whitelist as Maths,
  // so it renders here instead. It goes in its own block for the same reason the
  // maths stem does: `.cloze` is a <p> and cannot hold a <table> or a <figure>.
  if (question.passageHtml && mathStemEl) {
    passageEl.textContent = '';
    passageEl.hidden = true;
    mathStemEl.hidden = false;
    setMarkup(mathStemEl, question.passageHtml);
    // These charts carry a greyscale -- #CDCDCD against #444444 -- and that grey
    // IS the legend, telling one data series from the other. On the dark card the
    // dark half disappears, and remapping the greys would merge two series into
    // one. So the figure keeps its paper: an explicit light ground with dark ink,
    // in both themes, like a printed insert. The axes and labels come through as
    // currentColor, which resolves against that ink rather than the card's.
    mathStemEl.classList.toggle('is-paper', question.passageHtml.includes('<svg'));
    // The blank arrives inside that markup as #passageBlank, so fillBlank keeps
    // working untouched; the signal phrase is not marked here, because these
    // questions turn on reading a figure rather than on a word he read past.
    return;
  }

  passageEl.textContent = '';
  const signal = showSignal ? question.signal : null;
  const underline = question.underline || null;

  // An underlined question never also has a blank -- it asks about the sentence
  // as written -- so this can return before the cloze handling below.
  if (underline && question.passage.includes(underline)) {
    passageEl.classList.add('is-prose');
    appendUnderlined(passageEl, question.passage, underline, signal);
    return;
  }

  // Two thirds of the bank fills a blank; the rest asks about the passage as a
  // whole (main idea, structure, which quotation supports a claim). Those have
  // nothing to fill in, so render the text plainly.
  if (!question.passage.includes('___')) {
    passageEl.classList.add('is-prose');
    appendText(passageEl, question.passage, signal);
    return;
  }

  passageEl.classList.remove('is-prose');
  const [before, after] = question.passage.split('___');

  const blank = document.createElement('span');
  blank.className = 'blank';
  blank.id = 'passageBlank';
  blank.append(' ');

  // The signal sits on one side of the blank or the other, never both.
  const inBefore = signal && before.includes(signal);
  appendText(passageEl, before, inBefore ? signal : null);
  passageEl.append(blank);
  appendText(passageEl, after, !inBefore ? signal : null);
}

function fillBlank(text) {
  const blank = document.getElementById('passageBlank');
  if (!blank) return;
  blank.textContent = text;
  blank.classList.add('filled');
}

// --- How long this question is taking -------------------------------------

// The real thing being paced against: a question that runs past this is one he
// would be borrowing time for on the day, which is worth seeing while he is still
// on it rather than afterwards.
//
// Per section, because the two are not the same test. Reading and Writing gives 64
// minutes for 54 questions -- 71 seconds each. Maths gives 70 for 44, which is 95.
// Hard-coding the Reading figure flagged every maths question as slow 24 seconds
// early, and it will matter more than cosmetically if pace is ever used to decide
// what stays in rotation.
function paceSeconds(sec) {
  const cfg = SECTIONS[sec || section] || SECTIONS.rw;
  return Math.round((cfg.minutes * 60) / cfg.questions);
}

// Time is banked in stretches rather than read off one start stamp, so the clock
// can stop: at the moment he answers, and whenever the tab is not in front of him.
// A wall clock would file the walk to the kitchen as thinking time and make the
// one number he is meant to trust the one he cannot.
let timeBanked = 0;   // seconds from stretches already closed
let timeSince = 0;    // Date.now() when the open stretch began; 0 when stopped
let timerTicker = null;
// Rebuilt with the rest of the badge line on every renderMeta, so it is looked up
// again rather than held: the element this points at is replaced, not mutated.
let timerEl = null;

function questionSeconds() {
  return timeBanked + (timeSince ? (Date.now() - timeSince) / 1000 : 0);
}

function formatSeconds(total) {
  const s = Math.floor(total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function paintTimer() {
  if (!timerEl) return;
  const seconds = questionSeconds();
  timerEl.textContent = formatSeconds(seconds);
  const cfg = SECTIONS[section];
  const pace = paceSeconds();
  // Past the budget it stops being neutral information and starts being the point.
  timerEl.classList.toggle('is-slow', seconds > pace);
  // The tooltip shows the arithmetic, so the number is checkable rather than
  // asserted -- and it now names the right section's test.
  timerEl.title = timeSince
    ? `Time on this question. ${pace}s is the pace for ${cfg.label}`
      + ` — ${cfg.minutes} minutes for ${cfg.questions} questions.`
    : `Took ${formatSeconds(seconds)}. The pace to hold is ${pace}s per question`
      + ` (${cfg.label}).`;
}

// Called on every serve. Restarts from nothing: a re-served question is a fresh
// attempt at it as far as the clock is concerned.
function startQuestionTimer() {
  timeBanked = 0;
  timeSince = document.hidden ? 0 : Date.now();
  if (timerTicker) clearInterval(timerTicker);
  timerTicker = setInterval(paintTimer, 1000);
  paintTimer();
}

// Closes the open stretch and leaves the total on screen. `timerTicker` is cleared
// as well, so an answered question does not keep painting the same number.
function stopQuestionTimer() {
  timeBanked = questionSeconds();
  timeSince = 0;
  if (timerTicker) {
    clearInterval(timerTicker);
    timerTicker = null;
  }
  paintTimer();
}

// Only while the question is unanswered -- `timerTicker` is the flag for that,
// since stopQuestionTimer clears it -- so returning to the tab long after
// answering does not restart a clock that has already had its say.
document.addEventListener('visibilitychange', () => {
  if (!timerTicker) return;
  if (document.hidden) {
    timeBanked = questionSeconds();
    timeSince = 0;
  } else if (!timeSince) {
    timeSince = Date.now();
  }
  paintTimer();
});

// The star reflects the question on screen and nothing else -- it is never set or
// cleared by answering, only by pressing it.
function paintStar(question) {
  if (!starBtn) return;
  const on = isStarred(question.id);
  starBtn.classList.toggle('is-on', on);
  starBtn.setAttribute('aria-pressed', String(on));
  starBtn.textContent = on ? '\u2605 Starred' : '\u2606 Star';
  starBtn.title = on
    ? 'Starred. Press to remove it.'
    : 'Star this question, to find it again under "Starred only".';
}

// The lesson for a question is the one whose skills include the skill the
// question actually tests -- realSkill for a missed question, whose own skill is
// the set it lives in rather than the thing it examines.
// A skill is not a lesson. "boundaries" holds series punctuation, supplements,
// title commas and subject-verb spacing alongside the clause-joining questions,
// and none of the first four are decided by FIND -> COVER -> READ -> DECIDE --
// so offering that lesson beside them teaches him the rule does not work.
// College Board states the convention on every question ("The convention being
// tested is..."), so a lesson can claim exactly the ones its own rule settles.
//
// Permissive by default in both directions: a lesson with no `match` block takes
// its whole skill, and a question with no stated convention is kept rather than
// dropped. Narrowing is opt-in, per lesson.
function conceptMatches(concept, question) {
  const m = concept.match;
  if (!m) return true;
  const rule = (question.rule || '').toLowerCase();
  if (!rule) return true;
  if ((m.none || []).some((word) => rule.includes(word))) return false;
  return (m.any || []).some((word) => rule.includes(word));
}

function conceptFor(question) {
  if (!question) return null;
  const skill = skillTested(question);
  return concepts.find((c) =>
    (c.skills || []).includes(skill) && conceptMatches(c, question)) || null;
}

// A lesson is 800-1000 words. Opened all at once, ahead of a 70-word passage, it
// is a wall he folds away without reading -- which is what happened. So it is
// released a card at a time: the first is the number it has cost him and the rule
// itself, about twenty words, and he can stop there and still have the only part
// that matters. Nothing is cut; it just arrives in the order he can take it.
let conceptDeck = [];
let conceptAt = 0;

function conceptCards(c) {
  const cards = [{ kind: 'cost' }];
  if (c.ruleDetail || (c.forms || []).length) cards.push({ kind: 'means' });
  if ((c.steps || []).length) cards.push({ kind: 'test' });
  if (c.trap) cards.push({ kind: 'trap' });
  (c.examples || []).forEach((_, i) => cards.push({ kind: 'example', i }));
  if (c.exception) cards.push({ kind: 'exception' });
  if (c.commas) cards.push({ kind: 'commas' });
  if ((c.memorise || []).length || c.check) cards.push({ kind: 'memorise' });
  return cards;
}

// `card` is passed in rather than read off the module cursor, so the Learn
// section can render the same lesson at its own position without the two decks
// fighting over one index.
function renderConceptCard(concept, card) {
  const box = document.createElement('div');
  box.className = 'concept-card';
  box.dataset.kind = card.kind;

  const para = (text, cls) => {
    const el = document.createElement('p');
    if (cls) el.className = cls;
    el.textContent = text;
    return el;
  };
  const heading = (text) => para(text, 'concept-h');
  const pairEl = (wrong, right) => {
    const pair = document.createElement('div');
    pair.className = 'concept-pair';
    if (wrong) { const b = para(wrong, 'concept-bad'); b.dataset.mark = '\u2717'; pair.append(b); }
    if (right) { const g = para(right, 'concept-good'); g.dataset.mark = '\u2713'; pair.append(g); }
    return pair;
  };

  if (card.kind === 'cost') {
    // The number first, on its own, at the size of a score. He reads scores.
    const fig = document.createElement('p');
    fig.className = 'concept-cost';
    fig.textContent = String(concept.cost != null ? concept.cost : '');
    box.append(fig, para(concept.costLabel || 'questions this cost you', 'concept-cost-label'));
    if (concept.rule) box.append(para(concept.rule, 'concept-rule'));
  }

  if (card.kind === 'means') {
    box.append(heading('What it means'));
    if (concept.ruleDetail) box.append(para(concept.ruleDetail));
    if ((concept.forms || []).length) {
      const list = document.createElement('dl');
      list.className = 'concept-forms';
      concept.forms.forEach((f) => {
        const dt = document.createElement('dt'); dt.textContent = f.form;
        const dd = document.createElement('dd'); dd.textContent = f.example;
        list.append(dt, dd);
      });
      box.append(list);
    }
    if (concept.formsWarning) box.append(para(concept.formsWarning, 'concept-warning'));
  }

  if (card.kind === 'test') {
    box.append(heading('The test'));
    const ol = document.createElement('ol');
    ol.className = 'concept-steps';
    concept.steps.forEach((step) => {
      const li = document.createElement('li');
      li.textContent = step;
      ol.append(li);
    });
    box.append(ol);
    (concept.then || []).forEach((line) => box.append(para(line, 'concept-then')));
  }

  if (card.kind === 'trap') {
    box.classList.add('is-trap');
    box.append(heading('The trap'), para(concept.trap));
  }

  if (card.kind === 'example') {
    const ex = concept.examples[card.i];
    box.append(para(ex.source || '', 'concept-src'));
    box.append(para(ex.sentence || '', 'concept-sentence'));
    if ((ex.choices || []).length) {
      const choices = document.createElement('p');
      choices.className = 'concept-choices';
      ex.choices.forEach((text) => {
        const chip = document.createElement('span');
        chip.className = text === ex.answer ? 'concept-choice is-answer' : 'concept-choice';
        chip.textContent = text;
        choices.append(chip);
      });
      box.append(choices);
    }
    if (ex.wrong || ex.right) box.append(pairEl(ex.wrong, ex.right));
    if (ex.working) box.append(para(ex.working, 'concept-working'));
  }

  if (card.kind === 'exception') {
    const e = concept.exception;
    box.classList.add('is-aside');
    box.append(heading(e.title || 'The one exception'));
    if (e.intro) box.append(para(e.intro));
    (e.pairs || []).forEach((pr) => box.append(pairEl(pr.wrong, pr.right)));
    if (e.note) box.append(para(e.note, 'concept-working'));
  }

  if (card.kind === 'commas') {
    box.classList.add('is-aside');
    box.append(heading('What about the commas?'), para(concept.commas));
  }

  if (card.kind === 'memorise') {
    box.classList.add('is-memorise');
    box.append(heading('Memorise this'));
    (concept.memorise || []).forEach((line) => box.append(para(line)));
    if (concept.check) box.append(para(concept.check, 'concept-check'));
  }

  return box;
}

function renderConceptBody(concept) {
  conceptBodyEl.textContent = '';
  conceptDeck = conceptCards(concept);
  if (conceptAt >= conceptDeck.length) conceptAt = 0;

  conceptBodyEl.append(renderConceptCard(concept, conceptDeck[conceptAt]));

  // Dots say how much is left, so a long lesson never feels open-ended, and each
  // is clickable: he can jump straight to the example or the memorise card.
  const nav = document.createElement('div');
  nav.className = 'concept-nav';

  const dots = document.createElement('div');
  dots.className = 'concept-dots';
  conceptDeck.forEach((c, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = i === conceptAt ? 'concept-dot is-on' : 'concept-dot';
    dot.setAttribute('aria-label', `Card ${i + 1} of ${conceptDeck.length}`);
    dot.addEventListener('click', () => { conceptAt = i; renderConceptBody(concept); });
    dots.append(dot);
  });

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-small concept-back';
  back.textContent = '\u2190 Back';
  back.hidden = conceptAt === 0;
  back.addEventListener('click', () => { conceptAt -= 1; renderConceptBody(concept); });

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-small concept-next';
  const last = conceptAt === conceptDeck.length - 1;
  next.textContent = last ? 'Got it' : 'Next \u2192';
  next.addEventListener('click', () => {
    if (!last) { conceptAt += 1; renderConceptBody(concept); return; }
    // Read to the end: fold it away and remember he has been through it, so the
    // summary line can carry the short version from now on.
    store.concepts = store.concepts || {};
    store.concepts[concept.id] = { folded: true, read: true };
    saveStore();
    conceptAt = 0;
    conceptPanel.open = false;
    renderConcept(current);
  });

  nav.append(back, dots, next);
  conceptBodyEl.append(nav);
}

function renderConcept(question) {
  if (!conceptPanel) return;
  const concept = conceptFor(question);
  conceptPanel.hidden = !concept;
  if (!concept) return;

  const fresh = conceptPanel.dataset.conceptId !== concept.id;
  conceptPanel.dataset.conceptId = concept.id;
  if (fresh) conceptAt = 0;   // a different lesson starts at its first card

  store.concepts = store.concepts || {};
  const state = store.concepts[concept.id] || {};

  conceptTitleEl.textContent = concept.title || '';
  // Once he has read it through, the folded line carries the procedure itself --
  // COVER -> PREDICT -> MATCH -- so the panel is useful at a glance without being
  // opened at all. Before that it says what it will cost him not to.
  if (conceptHintEl) {
    conceptHintEl.textContent = state.read
      ? ((concept.memorise || [])[0] || '')
      : `${concept.cost} questions`;
    conceptHintEl.classList.toggle('is-read', !!state.read);
  }

  renderConceptBody(concept);
  conceptPanel.open = !state.folded;
}

function renderMeta(question) {
  metaEl.textContent = '';
  timerEl = null;

  // Only what the dropdowns are not already saying. Narrowing to one skill and
  // then labelling every question with it spends the badge line restating a
  // choice that is on screen two inches above. Both dropdowns apply in every
  // view now, wrong-only included, so this holds wherever he is.
  const skillIsChosen = skillFilter === question.skill;
  const difficultyIsChosen = difficultyFilter === question.difficulty;

  const labels = [];
  if (!skillIsChosen) labels.push(SKILL_LABELS[question.skill] || question.skill);

  // A question grouped by where it came from still has to say what it tests, or
  // the badge line names a set and teaches nothing. Kept even when the skill
  // above is dropped: choosing "Missed in a test" says nothing about which skill
  // any one of them is testing.
  const tests = skillTested(question);
  if (tests && tests !== question.skill) {
    labels.push(SKILL_LABELS[tests] || tests);
  }

  if (question.skill === MISSED_SKILL) {
    // Difficulty here is ours, not College Board's -- every one of these is
    // tagged hard because he missed it -- so it would say nothing. Which test it
    // came from does.
    if (question.test) {
      // Bluebook's review screen does not say which module a question came from,
      // so those carry a number only.
      const where = question.module
        ? `Module ${question.module} Q${question.number}`
        : `Q${question.number}`;
      labels.push(`${question.test} · ${where}`);
    }
  } else if (!difficultyIsChosen) {
    labels.push(question.difficulty);
  }

  labels.filter(Boolean).forEach((label) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label;
    metaEl.append(tag);
  });

  // Held back until the question is graded. Told up front that he has seen this
  // one before, he stops reading it and starts trying to dredge up which letter
  // he picked last time -- which is the one thing this drill is not for. The
  // history is worth having, so it is not deleted: it appears with the answer,
  // where "beaten it before" is context rather than a shortcut past the work.
  // `> 1`, not `> 0`: recordAnswer has already counted this attempt by the time
  // the badge is repainted, so a question he is meeting for the very first time
  // would announce "Seen 1× · 1 right" -- which says nothing, and says it in the
  // language of a repeat. The chip is only news when there was a previous visit.
  const stats = statsFor(question.id);
  if (answered && stats.seen > 1) {
    const tag = document.createElement('span');
    tag.className = stats.wrong > 0 ? 'tag tag-warn' : 'tag';
    tag.textContent = `Seen ${stats.seen}× · ${stats.correct} right / ${stats.wrong} wrong`;
    metaEl.append(tag);
  }

  // Held back for the same reason as the history above, and it gives away more:
  // a repeat is spliced in precisely because he got it wrong, so the badge
  // announces "you have failed this one" before he has read a word of it. It
  // still has to appear once graded -- the review bonus is in the points, and an
  // unexplained multiplier is worse than none.
  if (answered && servingReview) {
    const tag = document.createElement('span');
    tag.className = 'tag tag-warn';
    tag.textContent = 'Review';
    metaEl.append(tag);
  }

  // What this one pays. Shown before answering so the weighting is visible while
  // it can still motivate, then replaced by what he actually earned.
  const worth = document.createElement('span');
  if (lastAward === null && isRevision(question)) {
    // Nothing on offer, so say why rather than showing a bare zero.
    worth.className = 'tag tag-points is-missed';
    worth.textContent = 'revision';
    worth.title = 'Already answered correctly — no points, and it will not move your projection.';
  } else if (lastAward === null) {
    worth.className = 'tag tag-points';
    worth.textContent = `${questionPoints(question)} pts`;
    worth.title = `${POINTS_BY_DIFFICULTY[question.difficulty] || 15} base`
      + ` × ${skillWeight(question.skill)} for ${SKILL_LABELS[question.skill] || question.skill}`
      + (servingReview ? ` × ${REVIEW_BONUS} review` : '');
  } else if (lastAward > 0) {
    worth.className = 'tag tag-points is-earned';
    worth.textContent = `+${lastAward} pts`;
  } else {
    worth.className = 'tag tag-points is-missed';
    worth.textContent = 'no points';
  }
  metaEl.append(worth);

  // A property of the question like the badges either side of it, so it sits on
  // the same line and wears the same pill -- just the one that can be pressed.
  starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'tag tag-star';
  starBtn.addEventListener('click', () => {
    toggleStar(question.id);
    paintStar(question);
    // The dropdown counts move with it; the question on screen does not. Starring
    // is a note to self, not a filter change.
    if (bank.length > 0) buildSkillSelect();
  });
  paintStar(question);
  metaEl.append(starBtn);

  // Last on the line, so the one thing on it that moves is not sitting between
  // two that do not.
  timerEl = document.createElement('span');
  timerEl.className = 'tag tag-timer';
  metaEl.append(timerEl);
  paintTimer();
}

// --- Student-produced response ---------------------------------------------
// A quarter of the maths bank has no choices: he types a value. That changes what
// "correct" means, because one answer has several right spellings -- College Board
// lists `['.1764', '.1765', '3/17']` for a single question, all three accepted, and
// `3/2` and `1.5` for another. Comparing strings would mark two thirds of a
// correct answer wrong, so the comparison is numeric.
// What he typed on the question currently on screen. Not persisted: like the
// crossed-out choices, it belongs to this attempt.
let entryValue = '';

function isEntry(question) {
  return !!question && question.format === 'spr';
}

// "3/17" -> 0.17647..., "-2.5" -> -2.5, "" -> null. Mixed numbers and anything
// with a letter in it come back null and fall through to a string comparison,
// which is the safe direction: a value we cannot read is never silently accepted.
function numericValue(text) {
  const s = String(text == null ? '' : text).trim().replace(/[\s,$%]/g, '');
  if (!s) return null;
  const frac = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = parseFloat(frac[2]);
    return d === 0 ? null : parseFloat(frac[1]) / d;
  }
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Right if it matches any accepted form. The tolerance is relative to the shortest
// accepted answer's precision: College Board's own list gives `.1764` AND `.1765`
// for 3/17, which is to say they accept a value truncated OR rounded at four
// decimals -- so a comparison tighter than that would reject an answer they mark
// correct.
function entryIsCorrect(question, typed) {
  const accepted = question.answers || [];
  const clean = String(typed || '').trim();
  if (!clean) return false;

  // An exact match on what they wrote always counts, whatever it looks like.
  if (accepted.some((a) => String(a).trim().toLowerCase() === clean.toLowerCase())) {
    return true;
  }

  const mine = numericValue(clean);
  if (mine === null) return false;
  return accepted.some((a) => {
    const theirs = numericValue(a);
    if (theirs === null) return false;
    if (theirs === mine) return true;
    // Scaled by magnitude so this works for 403 and for 0.1764 alike.
    const tol = Math.max(Math.abs(theirs), 1) * 1e-4;
    return Math.abs(theirs - mine) <= tol;
  });
}

function renderEntry(question) {
  const wrap = document.createElement('div');
  wrap.className = 'entry';

  const label = document.createElement('label');
  label.className = 'entry-label';
  label.setAttribute('for', 'entryInput');
  label.textContent = 'Your answer';

  const input = document.createElement('input');
  input.className = 'entry-input';
  input.id = 'entryInput';
  input.type = 'text';
  // Not type="number": fractions are an accepted form and a number input will not
  // hold "3/17". inputmode still brings up a numeric keypad on a phone.
  input.inputMode = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'e.g. 403, 3/17, -2.5';
  input.disabled = answered;
  if (answered && entryValue) input.value = entryValue;
  input.addEventListener('input', () => {
    entryValue = input.value;
    updateSubmitState();
  });
  // Enter submits, because reaching for the mouse after typing a number is a
  // pointless interruption on the one question type that has a keyboard focus.
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !answered && entryValue.trim()) {
      ev.preventDefault();
      submitEntry();
    }
  });

  wrap.append(label, input);

  const mark = document.createElement('p');
  mark.className = 'entry-result';
  mark.id = 'entryResult';
  mark.hidden = !answered;
  wrap.append(mark);

  optionsContainer.append(wrap);
  if (answered) paintEntryResult(question);
}

function paintEntryResult(question) {
  const mark = document.getElementById('entryResult');
  if (!mark) return;
  const ok = entryIsCorrect(question, entryValue);
  mark.hidden = false;
  mark.className = `entry-result ${ok ? 'is-right' : 'is-wrong'}`;
  // Every accepted form is shown, not just the first -- being told the answer is
  // "3/17" when he wrote ".1765" and was right would teach him the wrong lesson.
  const forms = (question.answers || []).join('  or  ');
  mark.textContent = ok
    ? `✔ Correct — ${forms}`
    : `✖ Not quite. Accepted: ${forms}`;
}

function renderOptions(question) {
  optionsContainer.textContent = '';
  optionsContainer.classList.toggle('is-entry', isEntry(question));

  // 450 of the maths questions are student-produced-response: no choices at all,
  // he types the value. That is not a variant of a multiple-choice question, so it
  // gets its own renderer rather than four fake options.
  if (isEntry(question)) {
    renderEntry(question);
    return;
  }

  (question.options || []).forEach((option, index) => {
    const isCorrect = option.label === question.correctLabel;

    const optionEl = document.createElement('div');
    optionEl.className = 'option';
    optionEl.dataset.isCorrect = String(isCorrect);

    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = option.label;

    const text = document.createElement('span');
    if (option.textHtml) {
      // A maths choice is usually an equation, so it is markup like the stem --
      // and never monospaced: the whole point of MathML is that it is already set
      // properly. Same whitelist guarantee as setMarkup describes.
      text.className = 'text';
      setMarkup(text, option.textHtml);
    } else {
      // Monospace only where punctuation IS the question -- at prose sizes a
      // comma and a semicolon are hard to tell apart. Everywhere else, and
      // especially for full-sentence choices, proportional type reads better.
      const punctuationMatters =
        question.skill === 'boundaries' || question.skill === 'form-structure-sense';
      text.className = punctuationMatters ? 'text choice' : 'text';
      text.textContent = option.text;
    }

    const mark = document.createElement('span');
    mark.className = 'option-result';

    // Bluebook's answer eliminator. Ruling choices out is how these are actually
    // worked -- especially punctuation and vocabulary, where two are obviously
    // wrong and the marks are won by separating the last two.
    const cross = document.createElement('button');
    cross.type = 'button';
    cross.className = 'option-cross';
    cross.textContent = option.label;
    cross.setAttribute('aria-label', `Cross out choice ${option.label}`);
    cross.setAttribute('aria-pressed', 'false');
    cross.addEventListener('click', (ev) => {
      // Without this the click also lands on the option and selects it.
      ev.stopPropagation();
      toggleCrossed(index);
    });

    row.append(label, text, mark, cross);

    optionEl.append(row);

    // A one-line meaning under the word, from banks/vocab.json. Words in Context
    // is his weakest skill and the reason is usually that he does not know the
    // option words, so the gloss is what turns a guess into a read. Revealed with
    // the explanation, not before -- earlier it would hand him the answer.
    const gloss = glossFor(question, option.label);
    if (gloss) {
      const g = document.createElement('p');
      g.className = 'gloss';
      g.textContent = gloss;
      optionEl.append(g);
    }

    const why = document.createElement('p');
    why.className = 'explanation';
    why.textContent = option.why;
    optionEl.append(why);
    optionEl.addEventListener('click', () => selectOption(index));
    optionsContainer.append(optionEl);
  });
}

// Indices he has ruled out on the question currently on screen. Not persisted:
// elimination is working-out, and it belongs to this attempt only.
const crossedOut = new Set();

// The rate this question pays after peeking, or null if he has not peeked. Held
// per question rather than recomputed, so the figure on the badge is the one he
// agreed to when he pressed the button.
let peekPay = null;

// Does this question have meanings worth revealing? Words in Context only: on the
// Vocabulary drill the options ARE the meanings, so showing them would simply
// hand over the answer, and no other skill has glosses at all.
function canPeek(question) {
  if (!question) return false;
  // A missed-in-test question is grouped by where it came from, not by what it
  // tests, so ask what it actually tests -- otherwise the four Words in Context
  // questions he got wrong on the real test are the only ones without the help.
  if (skillTested(question) !== 'words-in-context') return false;
  return question.options.some((o) => glossFor(question, o.label));
}

// Where to read a broken question properly. The underline lives only in the PDF,
// so the page reference is the whole point of keeping these at all.
function renderPdfNotice(question) {
  if (!pdfNoticeEl) return;

  // Two different reasons to need the PDF: the underline was lost in extraction,
  // or the question is built on a chart that is not text at all.
  const broken = !!question && question.skill === DEFECTIVE_SKILL;
  // A maths `figure` is inline SVG that is already on the page, so the notice
  // would be sending him to a PDF for a graph he is looking at. The flag is kept
  // on those questions for styling and for finding them, not as a warning.
  const figure = !!question && !!question.figure && sectionOf(question) !== 'math';
  pdfNoticeEl.hidden = !(broken || figure);
  if (pdfNoticeEl.hidden || !pdfNoticeDetailEl) return;

  const where = question.pdf ? `${question.pdf}, page ${question.page}` : '';

  if (pdfNoticeTitleEl) {
    pdfNoticeTitleEl.textContent = figure
      ? 'You need the figure for this one'
      : 'Read this one from the PDF';
  }

  if (figure) {
    pdfNoticeDetailEl.textContent = where
      ? `This one is answered from a graph or table${where ? ` — ${where}` : ''}. `
        + 'The passage and choices are below; the figure is only in the PDF.'
      : 'This one is answered from a graph or table, which is only in the PDF.';
    return;
  }

  const skill = SKILL_LABELS[question.realSkill] || question.realSkill || 'this skill';
  pdfNoticeDetailEl.textContent = where
    ? `${skill} · ${where}. `
      + 'The underlined portion was lost when the PDF was extracted, so it is not shown below.'
    : `${skill}. The underlined portion was lost when the PDF was extracted.`;
}

function renderPeek() {
  if (!peekRowEl || !peekBtnEl) return;

  const show = !answered && peekPay === null && canPeek(current);
  peekRowEl.hidden = !show;
  if (!show) return;

  const rate = Math.round(peekRateToday() * 100);
  const used = dayStats().peeks || 0;
  peekBtnEl.textContent = 'Show meanings';
  if (peekNoteEl) {
    peekNoteEl.textContent = used === 0
      ? `pays ${rate}% of the points`
      : `pays ${rate}% — ${used} used today`;
  }
}

function revealMeanings() {
  if (answered || peekPay === null && !canPeek(current)) return;

  // Fix the rate before the count moves, so he is charged what the button said.
  peekPay = peekRateToday();

  const key = dayKey();
  const day = store.days[key] || { answered: 0, correct: 0, points: 0, peeks: 0 };
  day.peeks = (day.peeks || 0) + 1;
  store.days[key] = day;
  saveStore();

  optionsContainer.classList.add('is-peeked');
  renderPeek();
  renderMeta(current); // the badge now shows the reduced figure
}

// Rule a choice in or out. A crossed choice cannot be selected, so ruling one out
// and then submitting it is impossible -- to pick it he has to un-cross it first,
// which is the deliberate second thought the tool is for.
function toggleCrossed(index) {
  if (answered) return;
  const optionEl = optionsContainer.children[index];
  if (!optionEl) return;

  const nowCrossed = !crossedOut.has(index);
  if (nowCrossed) {
    crossedOut.add(index);
    // Crossing out the choice he had marked also un-marks it.
    if (pendingIndex === index) {
      pendingIndex = null;
      optionEl.classList.remove('pending');
    }
  } else {
    crossedOut.delete(index);
  }

  optionEl.classList.toggle('is-crossed', nowCrossed);
  const btn = optionEl.querySelector('.option-cross');
  if (btn) btn.setAttribute('aria-pressed', String(nowCrossed));
  updateSubmitState();
}

// Marks a choice without grading it. Re-clicking a different option just moves
// the mark, so nothing is committed until Submit.
function selectOption(index) {
  if (answered) return;
  if (crossedOut.has(index)) return; // ruled out; un-cross it to pick it
  // The choices stay locked until he has called the relationship.
  if (current.direction && !directionAnswered) return;

  pendingIndex = index;
  optionsContainer.querySelectorAll('.option').forEach((optionEl, i) => {
    optionEl.classList.toggle('pending', i === index);
  });
  updateSubmitState();
}

function updateSubmitState() {
  if (!submitBtn) return;
  // Nothing to submit while the choices are still hidden behind the direction
  // step, and nothing left to submit once the question has been graded.
  if (submitRow) submitRow.hidden = optionsContainer.hidden || answered;
  // On an entry question there is no choice to have selected, so what enables the
  // button is having typed something. Whitespace does not count.
  submitBtn.disabled = answered || (isEntry(current)
    ? entryValue.trim() === ''
    : pendingIndex === null);
}

// Step one of the two-step drill: commit to the relationship, with the word
// choices still hidden so they cannot bias the decision.
function renderDirectionStep(question) {
  const active = Boolean(question.direction);
  directionStep.hidden = !active;
  directionFeedback.hidden = true;
  directionFeedback.textContent = '';
  directionChoices.textContent = '';
  optionsContainer.hidden = active;

  if (!active) return;

  DIRECTIONS.forEach((dir) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'direction-btn';
    btn.dataset.direction = dir.key;

    const label = document.createElement('strong');
    label.textContent = dir.label;
    const hint = document.createElement('span');
    hint.textContent = dir.hint;

    btn.append(label, hint);
    btn.addEventListener('click', () => answerDirection(dir.key));
    directionChoices.append(btn);
  });
}

function answerDirection(picked) {
  if (directionAnswered) return;
  directionAnswered = true;
  directionCorrect = picked === current.direction;
  directionTotal += 1;
  if (directionCorrect) directionHits += 1;

  directionChoices.querySelectorAll('.direction-btn').forEach((btn) => {
    const isAnswer = btn.dataset.direction === current.direction;
    btn.classList.add(isAnswer ? 'correct' : 'incorrect');
    if (btn.dataset.direction === picked) btn.classList.add('selected');
    btn.disabled = true;
  });

  directionFeedback.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = directionCorrect ? 'Right relationship. ' : 'Not quite. ';
  directionFeedback.append(strong, current.directionWhy);
  directionFeedback.hidden = false;

  // Now the words are safe to show, and with them the button that grades them.
  optionsContainer.hidden = false;
  updateSubmitState();
  updateSummary();
}

function renderStreak() {
  if (!streakEl) return;
  streakEl.textContent = '';
  const padded = sessionStreak.slice(-STREAK_LENGTH);
  for (let i = 0; i < STREAK_LENGTH; i++) {
    const bar = document.createElement('i');
    const value = padded[i - (STREAK_LENGTH - padded.length)];
    if (value === true) bar.classList.add('hit');
    if (value === false) bar.classList.add('miss');
    streakEl.append(bar);
  }
}

// Lifetime coverage per skill: how much of each bank he has worked through and
// how much of it is still wrong. This is the all-time picture, not the session.
// How strong he is in each skill, weakest first, with what that skill pays. This
// is the list he picks from, so it ranks by where the work is worth doing rather
// than alphabetically, and shows accuracy rather than coverage: 0/211 never
// visibly moves, while "3 of 8 right" moves within one sitting.
function renderSkillStats() {
  if (!skillStatsEl) return;
  skillStatsEl.textContent = '';

  const skills = [...new Set(bank.map((q) => q.skill))].map((skill) => ({
    skill,
    form: skillForm(skill),
    weight: skillWeight(skill)
  }));

  // Weakest first. Untested skills sort by their Practice 5 weight, which is
  // what skillWeight() falls back to, so they land where they deserve.
  skills.sort((a, b) => b.weight - a.weight);

  // One element per skill -- name, rate and bar on a single line -- so the list
  // can be laid out in two columns without a row landing beside its own bar.
  skills.forEach(({ skill, form, weight }) => {
    const item = document.createElement('div');
    item.className = 'skill-item';

    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = SKILL_LABELS[skill] || skill;

    const pay = document.createElement('strong');
    pay.className = 'skill-pay';
    pay.textContent = `${weight}×`;
    pay.title = `Pays ${weight}× — ${weight >= 2.5 ? 'your weakest skill'
      : weight >= 1.7 ? 'still costing you marks' : 'close to solid'}`;

    const bar = document.createElement('span');
    bar.className = 'skill-bar';
    const fill = document.createElement('i');

    if (form.n < SKILL_FORM_MIN) {
      // Not enough answers to call it. An empty bar would read as 0% right.
      bar.classList.add('is-untested');
      item.title = form.n === 0
        ? `${name.textContent} — not tried yet`
        : `${name.textContent} — ${form.n} of ${SKILL_FORM_MIN} answers needed to rate it`;
    } else {
      const pct = Math.round(form.accuracy * 100);
      fill.style.width = `${pct}%`;
      fill.className = pct >= 75 ? 'is-strong' : pct >= 50 ? 'is-middling' : 'is-weak';
      item.title = `${name.textContent} — ${pct}% right over ${form.n} answers`;
      bar.append(fill);
    }

    item.append(name, pay, bar);
    skillStatsEl.append(item);
  });
}

function updateSummary() {
  // Today rather than this session: reloading the page must not reset the
  // numbers he is judging the day by.
  const today = dayStats();
  const wrong = today.answered - today.correct;
  // aria-label spells out what the tick and cross mean; the glyph alone would
  // be read as punctuation or skipped entirely.
  if (correctCountEl) {
    correctCountEl.textContent = `✓ ${today.correct}`;
    correctCountEl.setAttribute('aria-label', `${today.correct} right today`);
  }
  if (incorrectCountEl) {
    incorrectCountEl.textContent = `✗ ${wrong}`;
    incorrectCountEl.setAttribute('aria-label', `${wrong} wrong today`);
  }

  renderProjection();

  const all = Object.values(store.progress);
  const attempts = all.reduce((n, e) => n + e.seen, 0);
  const rights = all.reduce((n, e) => n + e.correct, 0);
  if (lifetimeEl) {
    lifetimeEl.textContent = attempts === 0
      ? 'No questions answered yet'
      : `All time: ${attempts} answers over ${all.length} questions · ${rights} right`;
  }
  // Only meaningful once a direction-tagged question has actually been worked.
  if (directionScoreEl) {
    directionScoreEl.hidden = directionTotal === 0;
    directionScoreEl.textContent =
      `Direction called right: ${directionHits} of ${directionTotal}`;
  }
  // Rebuilt each answer: the multipliers in the option labels move as his
  // accuracy does, and a stale rate is worse than none.
  if (bank.length > 0) buildSkillSelect();
  renderDaily();
  renderDayStreak();
  renderHeatmap();
  renderStreak();
  renderSkillStats();
  renderWords();
}

// The headline figure for whichever section is on screen. Reading and Writing
// gets a projected score against his real Practice 5 result; Maths gets plain
// accuracy, because a projected maths score would not move -- see SECTIONS.
// Either way it is held back until MIN_FOR_PROJECTION answers: a reading off four
// questions would swing 200 points and teach him to distrust the number.
function renderProjection() {
  renderScoreSplit();
  if (!projectionEl) return;
  const cfg = SECTIONS[section];
  const form = formForProjection();

  if (form.n < MIN_FOR_PROJECTION) {
    projectionEl.textContent = '—';
    projectionEl.classList.remove('is-up', 'is-down');
    if (projectionNoteEl) {
      // Says what it is counting. "11 more answers" read as "11 wrong" to the
      // first person who saw it -- right and wrong both count toward the sample.
      projectionNoteEl.textContent = `${form.n} of ${MIN_FOR_PROJECTION} answers`;
      projectionNoteEl.title = `${cfg.label} · this needs `
        + `${MIN_FOR_PROJECTION} answers, right or wrong`;
    }
    return;
  }

  const basis = form.lifetime
    ? `all ${form.n} answers so far`
    : `last ${form.n} answers`;
  const pct = Math.round(form.accuracy * 100);

  if (cfg.readout === 'accuracy') {
    // No arrow: there is nothing to compare against, because this section has no
    // anchor. Colouring it up or down off a threshold we invented would be
    // inventing a target for the one section that does not need one.
    projectionEl.textContent = `${pct}%`;
    projectionEl.classList.remove('is-up', 'is-down');
    if (projectionNoteEl) {
      projectionNoteEl.textContent = `${form.ok} of ${form.n} right`;
      projectionNoteEl.title = `${cfg.label} · ${basis}. No projected score here:`
        + ' he is already near the ceiling, so it would not move.';
    }
    return;
  }

  const score = projectedScore(form.accuracy);
  const delta = score - cfg.anchor.score;
  projectionEl.textContent = `~${score}`;
  projectionEl.classList.toggle('is-up', delta > 0);
  projectionEl.classList.toggle('is-down', delta < 0);

  if (projectionNoteEl) {
    // Named per section: the two are anchored on different sittings, so "on
    // Practice 5" under a maths figure would be pointing at the wrong test.
    const against = cfg.anchorLabel || 'his last sitting';
    projectionNoteEl.textContent = delta === 0
      ? `level with ${against}`
      : `${delta > 0 ? '+' : ''}${delta} on ${against}`;
    projectionNoteEl.title = `${cfg.label} · ${basis} at ${pct}%`;
  }
}

// Both sections' projections side by side, so the dialog answers "where am I"
// without him switching section to find the other half. Each is held to the same
// MIN_FOR_PROJECTION bar as the headline, and a section he has not worked enough
// of shows a dash rather than a number built on four answers.
function renderScoreSplit() {
  if (!scoreSplitEl) return;
  const parts = { rw: splitRwScoreEl, math: splitMathScoreEl };
  let anyReady = false;

  SECTION_ORDER.forEach((sec) => {
    const el = parts[sec];
    if (!el) return;
    const cfg = SECTIONS[sec];
    const form = formForProjection(sec);
    const ready = form.n >= MIN_FOR_PROJECTION && cfg.anchor;
    if (ready) anyReady = true;
    const score = ready ? projectedScore(form.accuracy, sec) : null;
    el.textContent = score === null ? '—' : `~${score}`;
    el.title = score === null
      ? `${cfg.label}: ${form.n} of ${MIN_FOR_PROJECTION} answers needed`
      : `${cfg.label}: ${form.n} answers at ${Math.round(form.accuracy * 100)}%`
        + `, against ${cfg.anchorLabel}`;
  });

  // Nothing to compare while neither section has enough answers -- the headline
  // above is already saying "not yet" and a row of two dashes only repeats it.
  scoreSplitEl.hidden = !anyReady;
}

function renderDayStreak() {
  const run = dayStreak();
  const workedToday = dayStats().answered > 0;

  if (streakValueEl) streakValueEl.textContent = run;
  if (!streakDaysEl) return;

  if (run === 0) {
    streakDaysEl.textContent = 'today starts one';
  } else if (workedToday) {
    streakDaysEl.textContent = run === 1 ? 'day, started today' : 'days in a row';
  } else {
    // The streak still counts yesterday, but it is today's to lose.
    streakDaysEl.textContent = run === 1 ? 'day — today keeps it' : 'days — today keeps it';
  }
  streakDaysEl.classList.toggle('is-live', run > 1 && workedToday);
}

// A 7-wide grid running from a little history through to the week of the last
// exam. Columns are Monday to Sunday, so the same weekday always lands in the
// same column and a weekends-only pattern shows up as a stripe.
function renderHeatmap() {
  if (!heatmapEl) return;
  heatmapEl.textContent = '';

  const today = startOfToday();
  const mondayFrom = (d) => {
    const m = new Date(d);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };

  const start = mondayFrom(today);
  start.setDate(start.getDate() - HEATMAP_LOOKBACK_WEEKS * 7);

  // Run to the Sunday of the final exam's week, or just this week once they pass.
  const last = EXAMS.map((e) => parseDayKey(e.key)).sort((a, b) => b - a)[0];
  const end = mondayFrom(last && last > today ? last : today);
  end.setDate(end.getDate() + 6);

  const examByKey = {};
  EXAMS.forEach((e) => { examByKey[e.key] = e; });

  for (let i = 0; i <= daysBetween(start, end); i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const key = dayKey(day);
    const exam = examByKey[key];

    const cell = document.createElement('i');
    cell.className = 'heat-cell';

    if (exam) {
      // Test day is the point of the whole grid, so it outranks any shading.
      cell.classList.add('is-exam');
      cell.title = `${prettyDay(day)} — SAT test day`;
    } else if (day > today) {
      cell.classList.add('is-future');
      const away = daysBetween(today, day);
      cell.title = `${prettyDay(day)} — ${away === 1 ? 'tomorrow' : `in ${away} days`}`;
    } else {
      const stats = dayStats(key);
      cell.classList.add(`heat-${heatLevel(stats.points)}`);
      // Points in the square itself, not just on hover -- a blank cell for a
      // worked day makes him hover to find out what he did.
      if (stats.points > 0) cell.textContent = stats.points;
      cell.title = stats.answered === 0
        ? `${prettyDay(day)} — nothing done`
        : `${prettyDay(day)} — ${stats.points} points · ${stats.answered} answered,`
          + ` ${stats.correct} right`
          + (stats.estimated ? ' (estimated from earlier sessions)' : '');
      if (daysBetween(today, day) === 0) cell.classList.add('is-today');
    }
    heatmapEl.append(cell);
  }
}


// The day's target: how far through, and whether it is done. Called from
// updateSummary, so it refreshes on every answer and on load.
// Met on points, or on the question cap so a low-accuracy day still ends.
function dayGoalMet(today) {
  const d = today || dayStats();
  return d.points >= DAILY_POINTS_TARGET || d.answered >= DAILY_QUESTION_CAP;
}

// Where the day's points came from. Shown only once there are points to split, so
// it never sits there reading "0 R&W · 0 Math".
//
// A day recorded before the split existed has no `bySection` at all, and that is
// not the same as zero. Rather than credit the whole total to Reading and invent a
// figure, the row stays hidden and the tile shows the total alone -- which is the
// only thing that day actually knows.
function renderDaySplit(today) {
  if (!daySplitEl) return;
  const split = today.bySection;
  const rw = (split && split.rw && split.rw.points) || 0;
  const math = (split && split.math && split.math.points) || 0;

  // The parts MUST reconcile with the total above them, and on the day this
  // feature arrived they cannot: everything answered earlier is in `day.points`
  // and in no bucket, so the row read "60 R&W · 0 Math" under a total of 140.
  // The remainder is shown rather than hidden or quietly folded into Reading --
  // it is real work, it is genuinely unattributed, and a figure that does not add
  // up is worse than one that admits what it does not know. It disappears by
  // itself once a day is recorded entirely under the split.
  const unattributed = Math.max(0, (today.points || 0) - rw - math);

  daySplitEl.hidden = !split || (rw === 0 && math === 0);
  if (daySplitEl.hidden) return;
  if (splitRwPtsEl) splitRwPtsEl.textContent = rw;
  if (splitMathPtsEl) splitMathPtsEl.textContent = math;
  if (splitRestEl) {
    splitRestEl.hidden = unattributed === 0;
    if (splitRestPtsEl) splitRestPtsEl.textContent = unattributed;
  }

  // The counts behind the points, on hover, so the split says how much work each
  // figure came from and not just what it scored.
  const detail = (label, b) => `${label}: ${(b && b.points) || 0} pts from `
    + `${(b && b.answered) || 0} answered, ${(b && b.correct) || 0} right`;
  daySplitEl.title = `${detail('Reading & Writing', split.rw)}\n`
    + `${detail('Math', split.math)}`
    + (unattributed
      ? `\nEarlier today: ${unattributed} pts, answered before the split was `
        + 'recorded, so the section is not known.'
      : '');
}

function renderDaily() {
  const today = dayStats();
  const done = dayGoalMet(today);
  const shown = Math.min(today.points, DAILY_POINTS_TARGET);

  // The tile carries the number; its caption carries the target.
  if (dailyCountEl) dailyCountEl.textContent = today.points;
  renderDaySplit(today);
  if (dailyNoteEl) {
    dailyNoteEl.textContent = done
      ? 'target met'
      : `of ${DAILY_POINTS_TARGET} points`;
  }
  // The tile: number, filling ring, and the stage mark inside it. pct is left
  // uncapped so the stage can climb past the target; only the fill is clamped.
  const pct = Math.round((today.points / DAILY_POINTS_TARGET) * 100);
  const stage = TARGET_STAGES.find((s) => pct <= s.upTo) || TARGET_STAGES[0];
  const laps = Math.min(MAX_LAPS, Math.floor(today.points / DAILY_POINTS_TARGET));

  if (targetMiniEl) {
    // Past the target, "1120 / 500" reads like a mistake; the count alone does not.
    targetMiniEl.textContent = pct >= 100
      ? `${today.points} pts`
      : `${today.points} / ${DAILY_POINTS_TARGET}`;
    targetMiniEl.classList.toggle('is-done', done);
  }
  if (targetLblEl) targetLblEl.textContent = pct >= 100 ? stage.label : 'points today';
  if (targetRingEl) {
    targetRingEl.style.setProperty('--pct', Math.min(100, pct));
    targetRingEl.classList.toggle('is-done', done);
    targetRingEl.dataset.laps = String(laps);
  }
  if (targetIconEl) {
    // Only jump when the mark actually changes; updateSummary runs on every
    // answer and re-triggering the pop each time would make it noise.
    if (lastStageIcon !== null && lastStageIcon !== stage.icon) {
      targetIconEl.classList.remove('is-promoted');
      void targetIconEl.offsetWidth; // reflow, so the animation can restart
      targetIconEl.classList.add('is-promoted');
      setTimeout(() => targetIconEl.classList.remove('is-promoted'), 650);
    }
    lastStageIcon = stage.icon;
    targetIconEl.textContent = stage.icon;
    // The glyph is aria-hidden, so the words go on the tile itself.
    targetIconEl.closest('.target-tile')?.setAttribute(
      'title', `${today.points} of ${DAILY_POINTS_TARGET} points today — ${stage.label}. Click for progress.`
    );
  }
  if (progressSubEl) {
    const run = dayStreak();
    progressSubEl.textContent = done
      ? `Today's target met · ${run} day${run === 1 ? '' : 's'} in a row`
      : `${DAILY_POINTS_TARGET - today.points} points to today's target`;
  }
  if (dailyFillEl) {
    dailyFillEl.style.width = `${Math.round((shown / DAILY_POINTS_TARGET) * 100)}%`;
    dailyFillEl.classList.toggle('is-done', done);
  }

  // The day to beat. Once he passes his best the wording flips from a target to
  // a record, which is the whole point of showing it.
  const best = bestDayBefore();
  if (bestValueEl) bestValueEl.textContent = best.points > 0 ? best.points : '—';
  if (pointsNoteEl) {
    if (best.points === 0) {
      pointsNoteEl.textContent = 'no earlier day yet';
      pointsNoteEl.classList.remove('is-record');
    } else if (today.points > best.points) {
      pointsNoteEl.textContent = 'beaten today';
      pointsNoteEl.classList.add('is-record');
    } else {
      pointsNoteEl.textContent = `${best.points - today.points} to beat · ${prettyDay(parseDayKey(best.key))}`;
      pointsNoteEl.classList.remove('is-record');
    }
  }

  if (dayDoneEl) {
    dayDoneEl.hidden = !done || dayBannerDismissed;
    if (done && dayDoneDetailEl) {
      const pct = Math.round((today.correct / today.answered) * 100);
      dayDoneDetailEl.textContent =
        `${today.points} points · ${today.answered} questions, ${today.correct} right (${pct}%).`;
    }
  }
}

// --- Question flow ---------------------------------------------------------

function loadQuestion(question) {
  current = question;
  answered = false;
  pendingIndex = null;
  lastAward = null; // fresh question, nothing earned on it yet
  crossedOut.clear(); // eliminations belong to the question he was on
  peekPay = null;     // and so does any peek
  entryValue = '';    // and so does anything typed into an entry question
  optionsContainer.classList.remove('is-peeked');
  directionAnswered = false;
  directionCorrect = null;

  // Before renderMeta, which paints the badge the clock lives in.
  startQuestionTimer();
  offerConcept(question, false);   // clears the previous question's, if any
  renderConcept(question);
  renderMeta(question);
  if (sectionOf(question) === 'math') {
    // A maths stem is one block carrying everything -- a displayed equation, the
    // sentence asking the question, sometimes a graph -- so it goes in the passage
    // slot whole and the title stands down rather than repeating a fragment of it.
    titleEl.textContent = '';
    titleEl.hidden = true;
    renderMathStem(question);
  } else {
    titleEl.hidden = false;
    titleEl.textContent = question.question ||
      'Which choice completes the text so that it conforms to the conventions of Standard English?';
    renderPassage(question, false);
  }
  renderOptions(question);
  renderDirectionStep(question);
  // After renderDirectionStep: it decides whether the choices start hidden, and
  // the submit row follows them.
  updateSubmitState();
  renderPeek();
  renderPdfNotice(question);

  ruleBox.hidden = true;
  ruleBox.textContent = '';
  ruleBox.classList.remove('is-math');
  renderSourceLink();
}

// The sparkle and chime used to fire on every correct answer, which is how a
// reward stops being one: by the tenth in a session it is wallpaper. These are
// the four moments that are actually worth marking. An ordinary correct answer
// gets the tick and nothing else.
function celebrate({ isCorrect, wasWrongBefore, bestBefore }) {
  const today = dayStats();

  // Trailing run of correct answers, this session.
  let run = 0;
  for (let i = sessionStreak.length - 1; i >= 0 && sessionStreak[i]; i--) run += 1;

  let target = null;

  if (dayGoalMet(today) && !dayGoalMet({ points: today.points - lastAward,
                                         answered: today.answered - 1 })) {
    // Crossed the target on THIS answer. Points arrive in lumps of 10 to 90, so
    // an equality test would miss the moment entirely.
    target = dayDoneEl;
  } else if (bestBefore > 0 && today.points > bestBefore && today.points - lastAward <= bestBefore) {
    // Crossed his best today, on this answer rather than three answers ago.
    // dailyCount now lives in the dialog, and Sparkle positions relative to
    // the question card, so mark it over the choices instead.
    target = optionsContainer;
  } else if (isCorrect && wasWrongBefore) {
    // Redeeming a question he had previously failed -- the whole point of the
    // review repeats, and the clearest evidence that something has stuck.
    target = optionsContainer;
  } else if (isCorrect && run > 0 && run % CELEBRATE_RUN === 0) {
    target = optionsContainer;
  }

  if (target) window.Sparkle.burstOver(target);
}

// The worked explanation. A maths rationale is markup -- it is half equations --
// so it goes through setMarkup; everywhere else it is a plain sentence.
function showRule(question) {
  if (question.ruleHtml) {
    ruleBox.classList.add('is-math');
    setMarkup(ruleBox, question.ruleHtml);
  } else {
    ruleBox.classList.remove('is-math');
    ruleBox.textContent = question.rule || '';
  }
  ruleBox.hidden = false;
}

// Grading an entry question. Deliberately mirrors the bookkeeping in reveal()
// rather than sharing it: the two differ only in how correctness is decided and
// what gets repainted, and the ordering below -- read the before-values, stop the
// clock, record once -- is what keeps a second submit from counting twice.
function submitEntry() {
  if (!current || !isEntry(current) || answered) return;

  const isCorrect = entryIsCorrect(current, entryValue);

  const wasWrongBefore = statsFor(current.id).wrong > 0;
  const bestBefore = bestDayBefore().points;
  stopQuestionTimer();

  lastAward = isCorrect ? questionPoints(current) : 0;
  recordAnswer(current, isCorrect, lastAward);
  sessionStreak.push(isCorrect);
  answered = true;

  const input = document.querySelector('.entry-input');
  if (input) input.disabled = true;
  paintEntryResult(current);

  updateSummary();
  renderSetSummary();
  renderMeta(current);
  celebrate({ isCorrect, wasWrongBefore, bestBefore });

  updateSubmitState();
  showRule(current);
  offerConcept(current, !isCorrect);
  renderSourceLink();
}

// Offered at the moment the rule would have paid for itself, and only then. The
// panel sits above the question and is folded once he has read it, so this opens
// it and takes him up rather than leaving him to remember it is there.
function offerConcept(question, gotItWrong) {
  const existing = document.querySelector('.concept-jump');
  if (existing) existing.remove();      // showRule runs again on every re-serve
  if (!gotItWrong || !conceptPanel) return;
  const concept = conceptFor(question);
  if (!concept) return;

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'btn btn-small concept-jump';
  link.textContent = `Read the rule — ${concept.title}`;
  link.addEventListener('click', () => {
    conceptPanel.open = true;
    conceptPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  ruleBox.after(link);
}

function reveal(selectedIndex) {
  // The choices stay locked until he has called the relationship — that is the
  // entire point of the drill.
  if (current.direction && !directionAnswered) return;

  const selected = current.options[selectedIndex];
  const isCorrect = selected.label === current.correctLabel;
  const optionEls = [...optionsContainer.querySelectorAll('.option')];

  optionEls.forEach((optionEl, index) => {
    const optionCorrect = current.options[index].label === current.correctLabel;
    // 'pending' was the pre-submit mark; from here the styling is right/wrong.
    optionEl.classList.remove('selected', 'pending');
    optionEl.classList.add('showExplanation', optionCorrect ? 'correct' : 'incorrect');
    optionEl.querySelector('.option-result').textContent = optionCorrect ? '✔' : '';
  });

  optionEls[selectedIndex].classList.add('selected');
  optionEls[selectedIndex].querySelector('.option-result').textContent = isCorrect ? '✔' : '✖';

  // Only the first answer on a question counts, so re-reading explanations
  // never inflates the tally.
  if (!answered) {
    // Both read BEFORE recordAnswer, which moves the numbers they compare
    // against: the correct count questionPoints() checks, and the previous
    // best day.
    const wasWrongBefore = statsFor(current.id).wrong > 0;
    const bestBefore = bestDayBefore().points;

    // Stopped before anything is recorded or re-rendered, so the total is the time
    // up to committing to an answer and not the time spent reading why it was wrong.
    stopQuestionTimer();

    lastAward = isCorrect ? questionPoints(current) : 0;
    recordAnswer(current, isCorrect, lastAward);
    sessionStreak.push(isCorrect);
    answered = true;
    updateSummary();
    renderSetSummary();
    renderMeta(current); // refresh the seen/right/wrong tag with this attempt

    celebrate({ isCorrect, wasWrongBefore, bestBefore });
  }
  updateSubmitState(); // retires the submit row now that this one is graded
  renderPeek();        // nothing left to reveal

  if (sectionOf(current) === 'math') {
    // No signal phrase to mark and no blank to fill -- re-rendering the passage
    // here would throw away the stem's MathML and leave an empty question.
    showRule(current);
  } else {
    // Re-render with the signal phrase marked, now that giving it away costs nothing.
    renderPassage(current, true);
    fillBlank(selected.text);
    showRule(current);
  }
  offerConcept(current, !isCorrect);

  renderSourceLink();

  // No prose summary any more: the correct choice carries a tick and its own
  // explanation, the rule box states the convention, and the sidebar pill says
  // whether he got it. Repeating all that in a paragraph earned no space.
}

// Bank order is preserved, so the sequence a learner walks is stable between
// sessions and the saved cursor keeps pointing at the same place.
// A word retires after this many CONSECUTIVE right answers -- see vocabRun below
// for why consecutive rather than a lifetime tally. A miss resets the run, so a
// word he keeps missing keeps coming back.
//
// Only vocabulary retires. Real SAT questions stay available however well he does
// on them, because re-reading a College Board rationale is worth doing.
const VOCAB_MASTERED_BY = 2;

// How soon a word comes back. Wrong -> a few questions later, and again, and
// again until he gets it; right but not yet mastered -> a longer wait, so it is
// checked once more rather than drilled. Counted in answers, not minutes: the app
// has no idea how long he sat there.
const VOCAB_REVISIT_AFTER_WRONG = 3;
const VOCAB_REVISIT_AFTER_RIGHT = 12;

// At least this many fresh words between repeats. Without it the drill jams: a
// repeat does not advance the cursor, so three missed words are enough to fill
// every slot forever and he never meets a new word again. Two fresh to one repeat
// keeps missed words frequent without letting them crowd everything else out.
const VOCAB_FRESH_BETWEEN_REPEATS = 2;

// The word most overdue, from whatever is in the current pool. Restricted to the
// pool so drilling Boundaries never yanks him sideways into a word.
function nextDueVocab() {
  const served = store.served || 0;
  const due = store.due || {};
  let best = null;

  pool.forEach((q) => {
    if (q.skill !== VOCAB_SKILL) return;
    if (current && q.id === current.id) return; // never twice in a row
    const at = due[q.id];
    if (at === undefined || at > served) return;
    if (!best || due[q.id] < due[best.id]) best = q;
  });
  return best;
}

// Called after a vocabulary answer to book its next appearance.
function scheduleVocab(question, isCorrect) {
  if (question.skill !== VOCAB_SKILL) return;
  store.due = store.due || {};
  store.vocab = store.vocab || {};

  // The run of consecutive rights, which is what decides retirement.
  const entry = store.vocab[question.id] || { run: 0 };
  entry.run = isCorrect ? vocabRun(question.id) + 1 : 0;
  store.vocab[question.id] = entry;

  if (isCorrect && vocabMastered(question.id)) {
    // Beaten for good; applyFilters will drop it from the pool.
    delete store.due[question.id];
    return;
  }
  store.due[question.id] = (store.served || 0)
    + (isCorrect ? VOCAB_REVISIT_AFTER_RIGHT : VOCAB_REVISIT_AFTER_WRONG);
}

// The run of consecutive right answers on a word. Consecutive, not a lifetime
// tally: "correct >= wrong + 2" made every miss demand another hit, so a word
// missed three times needed five right answers to clear. That is a debt, not
// learning. A miss resets the run to nought.
function vocabRun(id) {
  const v = store.vocab && store.vocab[id];
  if (v && typeof v.run === 'number') return v.run;
  // No run recorded yet, so fall back to his existing history: a clean record
  // counts as a run, and a word he ever missed starts from nought.
  const s = statsFor(id);
  return s.wrong === 0 ? s.correct : 0;
}

function vocabMastered(id) {
  return vocabRun(id) >= VOCAB_MASTERED_BY;
}

// "Wrong answers only" used to ignore the skill dropdown: while missed questions
// were also spliced back into the ordinary sequence the set behind the tick was
// small, and cutting it by skill left one or two per skill -- his own mistakes
// turned into something he had to hunt for. Now that the tick is the only place
// they live, that set is the size of every mistake he has ever made, and every
// control that narrows it earns its place. All three apply here exactly as they
// do everywhere else.
function testFilterApplies() {
  return testFilter !== 'all' && skillFilter === MISSED_SKILL;
}

function applyFilters() {
  pool = bank.filter((q) =>
    // First and unconditionally: the two sections are scored separately and
    // never share a pool, so nothing below can reach across them.
    sectionOf(q) === section &&
    (skillFilter === 'all' || q.skill === skillFilter) &&
    (difficultyFilter === 'all' || q.difficulty === difficultyFilter) &&
    (!testFilterApplies() || q.test === testFilter) &&
    (!starredOnly || isStarred(q.id))
  );
  // Words he has beaten drop out, so the drill is always the ones still costing
  // him something rather than a march through all 952.
  pool = pool.filter((q) => q.skill !== VOCAB_SKILL || !vocabMastered(q.id));
  // Same idea one level up, and for the same reason: what is left to do is more
  // use to him than the whole bank. A no-op under wrong-only, which already keeps
  // only questions he has missed.
  // Both retirements are switched off inside the starred set. He put a question
  // there by hand; getting it right afterwards must not take it away again, which
  // is what "Hide first-time correct" would otherwise do the moment the star
  // started paying off. Same for the missed set: a starred question he has also
  // missed should not need a second tick to be visible.
  const beforeAced = pool.length;
  if (!starredOnly) pool = pool.filter((q) => !isAced(q));
  // Kept so the readout can show what was set aside. Questions dropping out of a
  // count with no explanation reads like losing them. Zero under wrong-only: a
  // question he has never missed is not part of that set to begin with, so
  // counting it as cleared *from* it would be reporting on the wrong pool.
  clearedCount = wrongOnly ? 0 : beforeAced - pool.length;

  // The ones he has missed come out of the ordinary sequence and wait behind the
  // tick. Counted, for the same reason as above: they have to be visibly set
  // aside rather than appear to have been lost, and the number is the whole
  // argument for going and looking at them.
  const beforeMissed = pool.length;
  if (!starredOnly) pool = pool.filter((q) => !isMissed(q));
  missedCount = beforeMissed - pool.length;

  if (wrongOnly) pool = pool.filter((q) => isWrongEver(q.id));
}

// Each filter combination keeps its own place in the sequence. Wrong-only used to
// pin the skill part to 'all', because the pool behind the tick was the same
// whatever the dropdown said; now the dropdown applies there too, so the skill
// goes on the key like any other. The keys that pinning produced are still valid
// -- they are the wrong-only, all-skills keys, which is what they always meant.
//
// The test is appended only while it is actually being applied, so every key he
// has already built up -- they are saved, and each holds a real position -- means
// exactly what it did before this filter existed.
//
// `hideAced` is marked on the key when it is ON, not off: every key he had
// before it existed was built against the full set, which is what unticking
// gives back, so those keep their meaning too.
function cursorKey() {
  const test = testFilterApplies() ? `|${testFilter}` : '';
  const left = hideAced ? '|todo' : '';
  // Reading and Writing keys carry no section part, so every key he has already
  // built up -- they are saved, and each holds a real position -- still means what
  // it did. Only maths adds one.
  const sec = section === DEFAULT_SECTION ? '' : `${section}|`;
  // Appended only when on, so every key he has already built up still means what
  // it did before starring existed.
  const star = starredOnly ? '|star' : '';
  return `${sec}${skillFilter}|${difficultyFilter}`
    + `|${wrongOnly ? 'wrong' : 'all'}${test}${left}${star}`;
}

function cursorValue() {
  return store.cursor[cursorKey()] || 0;
}

// The cursor holds the place of the question on screen, not the one queued up
// behind it, so re-serving it is a no-op. Only an explicit ask for the next
// question steps it forward -- otherwise a page refresh would consume a
// position and walk the readout forward on its own. Wrapping past the end
// simply starts another pass through the same sequence.
let servedIndex = 0;

// Clamped at zero: stepping back from the very first question has nowhere to go,
// and a negative index would fall off the end of the pool rather than wrap.
function takeNextInSequence(step) {
  const key = cursorKey();
  const at = Math.max(0, cursorValue() + step);
  servedIndex = at;
  store.cursor[key] = at;
  return pool[at % pool.length];
}

// options.step moves the cursor: 1 for the next question, -1 for the previous
// one, 0 to re-serve what is already on screen. Page load and filter changes
// pass 0 so they restore his place instead of consuming a question.
function nextQuestion(options) {
  const requested = options && typeof options.step === 'number' ? options.step : 1;
  // Serving a repeat leaves the cursor where it was, so it still points at the
  // question the repeat interrupted. Stepping back off a repeat therefore means
  // re-serving the cursor; decrementing it would skip that question entirely.
  const step = requested < 0 && servingReview ? 0 : requested;
  // options.scroll false leaves the page exactly where it is: the top pager is
  // already beside the question, so moving the page under him buys nothing.
  const scroll = !options || options.scroll !== false;
  applyFilters();

  if (pool.length === 0) {
    // Skill is not part of this pool any more, so suggesting he widen it would
    // send him to a control that is disabled and would change nothing.
    // Clearing a whole set is the good ending, not a dead end, so it gets its own
    // message -- and names the tick that brings the questions back, because
    // otherwise an empty screen looks like they are gone.
    //
    // The missed ones go first when there are any: an empty set with questions
    // waiting behind a tick is not an ending, and that tick is the one thing on
    // the page that would give him something to do.
    // Nothing is automatic in the starred set, so an empty one has exactly one
    // cause and one cure, and neither is any of the messages below.
    const noStars = starredOnly
      ? (starredCount() === 0
        ? 'No questions starred yet. Open any question and press Star to keep it here.'
        : 'None of your starred questions match the other filters. Widen Skill or '
          + 'Difficulty, or untick "Starred only".')
      : null;
    const waiting = !wrongOnly && missedCount > 0
      ? `Nothing fresh left here — but ${missedCount} you got wrong `
        + `${missedCount === 1 ? 'is' : 'are'} waiting. `
        + 'Tick "Wrong answers only" to work through them.'
      : null;
    const cleared = !wrongOnly && hideAced && clearedCount > 0
      ? `Nothing left here — you have got all ${clearedCount} right first time. `
        + 'Untick "Hide first-time correct" to work through them again.'
      : null;
    // Both dropdowns narrow this view now, so an empty one is far more often a
    // corner of the missed set he has cleared than proof he has never slipped --
    // and the message has to name whichever control is doing the narrowing before
    // it suggests the tick, or he unticks and loses his place in the set.
    const narrowed = [
      skillFilter !== 'all' ? 'skill' : null,
      difficultyFilter !== 'all' ? 'difficulty' : null
    ].filter(Boolean);
    setEmptyState(noStars || waiting || cleared || (wrongOnly
      ? (narrowed.length === 0
        ? 'Nothing wrong yet. Untick "Wrong answers only" to keep practising.'
        : `Nothing wrong here. Widen the ${narrowed.join(' or ')}, or untick `
          + '"Wrong answers only".')
      : 'No questions match these filters.'), true);
    // Neither direction leads anywhere in an empty set; the warning takes the
    // readout's place in the pager and both controls go inert.
    setPagerState({ atStart: true, empty: true });
    // No question is being served, so nothing should still be timing one.
    stopQuestionTimer();
    return;
  }

  // The cursor is an index, and a question can leave the pool between one serve
  // and the next -- answered right first time under "Hide first-time correct",
  // or a vocabulary word mastered. Everything behind it then shifts down a slot,
  // so the question that was next now sits at the index the cursor is already
  // on, and stepping forward from there vaults clean over it.
  //
  // Re-anchoring on what is actually on screen fixes that in both directions: if
  // it is still in the pool, pin the cursor to where it now sits, which also
  // heals any drift left by an earlier removal; if it has gone, its old index
  // already holds the next question, so there is nothing to step over.
  //
  // Skipped while serving a review repeat -- the cursor deliberately stays on
  // the question the repeat interrupted, so `current` is not what it points at.
  //
  // The two places that park the cursor deliberately, Restart and
  // jumpToQuestion, both null `current` before calling in. That is what keeps
  // this from overwriting the position they just set, so it has to stay that way.
  let move = step;
  if (current && !servingReview) {
    const at = pool.findIndex((q) => q.id === current.id);
    if (at >= 0) store.cursor[cursorKey()] = at;
    else if (move > 0) move -= 1;
  }

  // Splice in a repeat every FRESH_PER_REVIEW fresh questions. Reviews are
  // drawn at random from everything he has gotten wrong within this filter --
  // which, now that missed questions wait behind the tick, means the vocabulary
  // words alone. Those are the one kind that has to keep coming back on its own,
  // so the splice is left in place rather than deleted.
  const reviewable = wrongOnly
    ? []
    : pool.filter((q) => isWrongEver(q.id) && (!current || q.id !== current.id));

  // A review repeat is drawn at random and never persisted, so it cannot be
  // restored on reload or stepped back to -- only splice one in when moving
  // forward, which also keeps a refresh showing the same question every time.
  // An overdue word outranks the periodic repeat: missed words have to come back
  // more often than every tenth question. But only after a couple of fresh words,
  // or repeats fill every slot and he never meets a new word again -- a repeat
  // leaves the cursor where it is, so it costs a fresh word its turn.
  const due = step > 0 && store.sinceReview >= VOCAB_FRESH_BETWEEN_REPEATS
    ? nextDueVocab()
    : null;
  if (due) {
    current = due;
    servingReview = true;
    store.sinceReview = 0; // it counts as this cycle's repeat
  } else if (step > 0 && store.sinceReview >= FRESH_PER_REVIEW && reviewable.length > 0) {
    current = reviewable[Math.floor(Math.random() * reviewable.length)];
    store.sinceReview = 0;
    servingReview = true;
  } else {
    current = takeNextInSequence(move);
    // Counted on what he asked for, not on the adjusted move: a question that
    // slid into place is still a fresh question served.
    if (step > 0) store.sinceReview += 1;
    servingReview = false;
  }

  saveStore();
  // After, not before: loading is what clears `answered`, and the readout now
  // reads that flag to decide whether it may say "Review repeat" yet. Called
  // first it would still be holding the previous question's answered state and
  // label a fresh repeat before he has looked at it.
  loadQuestion(current);
  renderSetSummary();

  // Only move the page when he asked from somewhere other than the top of the
  // card. Land on the question rather than the page top -- scrolling past the
  // title and filter bar would just mean scrolling back down to read, and
  // scroll-margin-top keeps the card's top edge off the viewport edge.
  if (!scroll) return;
  const anchor = questionCard || document.querySelector('.page');
  if (anchor && anchor.scrollIntoView) {
    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Position, coverage and how many repeats are waiting -- the readout that tells
// him whether he is making progress through the bank or just circling.
function renderSetSummary() {
  const total = pool.length;
  const seen = pool.filter((q) => statsFor(q.id).seen > 0).length;
  // Only outside the tick. Under it the pool IS the missed set, so "N to revisit"
  // would repeat the total two words to its left; the number is news exactly when
  // the questions it counts are somewhere he is not.
  const wrong = wrongOnly ? 0 : missedCount;
  const pass = Math.floor(servedIndex / total) + 1;
  const position = (servedIndex % total) + 1;

  // "Position" rather than "seen": skipping with Next advances the place in the
  // sequence without answering anything, so the two numbers legitimately differ.
  //
  // "Review repeat" waits for the answer too, or the badge line hiding it is
  // wasted breath -- the readout is the next thing on the page. Until then a
  // repeat reads as the place it interrupted, which is where he still is.
  const showReview = answered && servingReview;
  const parts = [
    showReview ? 'Review repeat' : `Position ${position} of ${total}`,
    pass > 1 && !showReview ? `pass ${pass}` : null,
    `${seen} answered`,
    wrong > 0 ? `${wrong} to revisit` : null,
    // Says where the missing ones went, and it is the number he asked the filter
    // for: how much of this set he has already put behind him.
    clearedCount > 0 ? `${clearedCount} cleared` : null
  ].filter(Boolean);
  setEmptyState(parts.join(' · '));

  // Nothing precedes the first question of the sequence. Stepping back off a
  // review repeat is allowed -- it lands on the question the repeat interrupted.
  setPagerState({ atStart: servedIndex === 0 && !servingReview, empty: false });
}

function setPagerState({ atStart, empty }) {
  document.querySelectorAll('.prev-question').forEach((btn) => {
    btn.disabled = empty || atStart;
  });
  document.querySelectorAll('.next-question').forEach((btn) => {
    btn.disabled = empty;
  });
}

// Doubles as the set-size readout, so a plain count must not look like a warning.
// Never hidden: it is the middle cell of the pager, and collapsing it would drag
// Prev and Next together every time the text was empty.
function setEmptyState(message, isWarning) {
  readoutEls.forEach((el) => {
    el.textContent = message || '';
    el.classList.toggle('is-warning', Boolean(isWarning));
  });
}

// A question is only usable once the blank, the answer key, the rule, and
// every option's reasoning are present.
function isReady(q) {
  // Maths is a different shape and has its own gate. There is no passage (the
  // stem carries everything), the student-response questions have no options at
  // all, and extract_math.py has already held back the ones with no answer key --
  // so the checks below would reject the entire section. What matters here is
  // that it can be rendered and marked.
  if (sectionOf(q) === 'math') {
    if (!q.questionHtml) return false;
    return q.format === 'spr'
      ? Array.isArray(q.answers) && q.answers.length > 0
      : (q.options || []).some((o) => o.label === q.correctLabel);
  }

  const options = q.options || [];
  const blanks = typeof q.passage === 'string' ? q.passage.split('___').length - 1 : -1;
  return (
    blanks === 0 || blanks === 1 // no blank is fine; two would be ambiguous
  ) && (
    typeof q.passage === 'string' &&
    q.rule &&
    options.length > 0 &&
    options.some((o) => o.label === q.correctLabel) &&
    options.every((o) => o.text && o.why)
  );
}

// Every word he has actually met, gathered from the questions he has worked.
// Derived rather than stored: store.progress already records which questions he
// has seen and which he got wrong, and vocab.json maps question to words, so
// there is nothing extra to keep or migrate.
function wordsMet() {
  const byWord = new Map();

  Object.entries(store.progress).forEach(([id, entry]) => {
    if (!entry.seen) return;
    const q = vocabByQuestion[id];
    if (!q) return;

    q.words.forEach((w) => {
      if (!w.gloss) return;
      const key = w.word.toLowerCase();
      const prev = byWord.get(key);
      // A word met in a question he failed outranks the same word met in one he
      // passed -- one sighting being wrong is enough to keep it on the list.
      const missed = entry.wrong > 0;
      if (!prev) {
        byWord.set(key, { word: w.word, gloss: w.gloss, sentence: q.sentence, missed });
      } else if (missed) {
        prev.missed = true;
      }
    });
  });

  return [...byWord.values()].sort((a, b) => {
    if (a.missed !== b.missed) return a.missed ? -1 : 1;
    return a.word.toLowerCase().localeCompare(b.word.toLowerCase());
  });
}

function renderWords() {
  if (!wordsListEl) return;
  const words = wordsMet();
  const missed = words.filter((w) => w.missed).length;

  if (wordsHeadingEl) {
    wordsHeadingEl.textContent = words.length === 0
      ? 'Words met'
      : `Words met · ${words.length}` + (missed ? ` · ${missed} to revise` : '');
  }

  wordsListEl.textContent = '';
  if (words.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'queue-note';
    empty.textContent =
      'Words from Words in Context questions collect here as you work them.';
    wordsListEl.append(empty);
    return;
  }

  words.forEach((w) => {
    const row = document.createElement('div');
    row.className = w.missed ? 'word-row is-missed' : 'word-row';
    // The sentence it appeared in, on hover: seeing the word at work is the
    // whole skill, and a definition on its own is what he can already look up.
    if (w.sentence) row.title = w.sentence;

    const term = document.createElement('span');
    term.className = 'word-term';
    term.textContent = w.word;

    const gloss = document.createElement('span');
    gloss.className = 'word-gloss';
    gloss.textContent = w.gloss;

    row.append(term, gloss);
    wordsListEl.append(row);
  });
}

// --- Vocabulary drill ------------------------------------------------------
// The wordlist becomes questions rather than a list to scroll: 137 rows in a box
// teaches nothing, whereas picking the right meaning out of four is both how the
// test asks it and how the word actually gets learned. Synthesised into `bank`,
// so points, review repeats, the daily target and the Prev/Next pager all apply
// with no new machinery.

const VOCAB_SKILL = 'vocabulary';
const VOCAB_CHOICES = 4;

// Deterministic, so a word is the SAME question every time he meets it. A
// reshuffled question is a different question, and his per-word history would
// stop meaning anything.
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildVocabQuestions(words) {
  const pool = words.filter((w) => w.word && w.gloss);
  if (pool.length < VOCAB_CHOICES) return [];

  return pool.map((w, index) => {
    const seed = hashString(w.word);

    // Three wrong meanings, drawn from other words in the list. Stepping by a
    // prime keeps them spread out rather than clustered around the alphabet.
    const wrong = [];
    for (let step = 1; wrong.length < VOCAB_CHOICES - 1 && step <= pool.length; step += 1) {
      const cand = pool[(index + (seed % 89) + step * 37) % pool.length];
      if (cand.word === w.word || !cand.gloss) continue;
      if (cand.gloss === w.gloss) continue; // two identical choices is a broken question
      if (wrong.some((x) => x.gloss === cand.gloss)) continue;
      wrong.push(cand);
    }
    if (wrong.length < VOCAB_CHOICES - 1) return null;

    const answerAt = seed % VOCAB_CHOICES;
    const options = [];
    let taken = 0;
    for (let i = 0; i < VOCAB_CHOICES; i += 1) {
      const label = String.fromCharCode(65 + i);
      if (i === answerAt) {
        options.push({
          label,
          text: w.gloss,
          why: `Correct. "${w.word}" means ${w.gloss}.`
        });
      } else {
        const d = wrong[taken];
        taken += 1;
        options.push({
          label,
          text: d.gloss,
          why: `That is the meaning of "${d.word}", not "${w.word}".`
        });
      }
    }

    return {
      // Keyed by word, so his history follows the word rather than its position.
      id: `vocab-${w.word.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      source: 'Built from College Board Words in Context options',
      skill: VOCAB_SKILL,
      domain: 'extra',
      difficulty: w.difficulty || 'medium',
      hasBlank: false,
      // No ___, so the card renders it as prose rather than a cloze.
      passage: 'Which of these is closest in meaning?',
      question: w.word,
      correctLabel: String.fromCharCode(65 + answerAt),
      // Only claim a sentence when one genuinely holds the word: that means it
      // was the correct answer in a question whose passage had a blank. Where the
      // passage had no blank the options are synonyms for a word already in the
      // text, so no sentence contains this one -- the link covers it instead.
      rule: w.sentence
        ? `Seen in: ${w.sentence}`
        : 'This word was one of the four choices in a Words in Context question.',
      // Lets the drill hand him back to the question the word came from.
      sourceId: w.sourceId || (w.from && w.from[0]) || null,
      options
    };
  }).filter(Boolean);
}

// Jump straight to a question by id, switching whatever filters are in the way.
// Used by the vocabulary drill to hand him back to the question a word came from,
// so a word is never just a word: he can see it doing its job in the real thing.
// One row serving both directions. Forward only after he has answered, because
// before that it is part of the explanation and would give the word away; back is
// available at once, since he may want to read the question and return without
// answering it.
// The word worth drilling from a Words in Context question: the one he PICKED if
// he got it wrong, otherwise the right answer. Choosing wrongly is the strongest
// evidence he does not know that word.
function drillTargetFor(question) {
  if (!question) return null;
  // Same reasoning as canPeek: ask what the question tests, not which set it is
  // filed under, or the ones he missed on a real test would be the only Words in
  // Context questions with no way through to the word.
  if (skillTested(question) !== 'words-in-context') return null;

  const chosen = pendingIndex === null ? null : question.options[pendingIndex];
  const correct = question.options.find((o) => o.label === question.correctLabel);
  const pick = chosen && chosen.label !== question.correctLabel ? chosen : correct;
  if (!pick || !pick.text) return null;

  const key = pick.text.trim().replace(/\.$/, '').toLowerCase();
  const id = vocabDrillByWord[key];
  return id ? { id, word: pick.text.trim().replace(/\.$/, '') } : null;
}

function renderSourceLink() {
  if (!sourceRowEl || !sourceLinkEl) return;

  if (answered && current && current.skill === VOCAB_SKILL && current.sourceId
      && bank.some((q) => q.id === current.sourceId)) {
    sourceRowEl.hidden = false;
    sourceRowEl.dataset.target = current.sourceId;
    sourceLinkEl.textContent = 'See this word in its question →';
    return;
  }

  // Forward the other way: from a real question to the drill for its word.
  const drill = answered ? drillTargetFor(current) : null;
  if (drill) {
    sourceRowEl.hidden = false;
    sourceRowEl.dataset.target = drill.id;
    sourceLinkEl.textContent = `Drill “${drill.word}” →`;
    return;
  }

  if (returnTo && current && current.id === returnTo.at
      && bank.some((q) => q.id === returnTo.id)) {
    sourceRowEl.hidden = false;
    sourceRowEl.dataset.target = returnTo.id;
    sourceLinkEl.textContent = `← Back to “${returnTo.word}”`;
    return;
  }

  sourceRowEl.hidden = true;
}

function jumpToQuestion(id) {
  const target = bank.find((q) => q.id === id);
  if (!target) return false;

  // Widen the filters only as far as needed to make the question reachable. The
  // test goes too: a link into a Practice 5 question is unreachable while the set
  // is narrowed to Practice 6, and it is the same question either way.
  skillFilter = target.skill;
  difficultyFilter = 'all';
  testFilter = 'all';
  // A question he has missed lives behind "Wrong answers only" now, so a link to
  // one is followable only with the tick on -- and a link to any other kind is
  // followable only with it off. Cleared first because isMissed reads the flag:
  // asked while it is still on, it answers "nothing is being held back".
  wrongOnly = false;
  wrongOnly = isMissed(target);
  // Only when it would otherwise be out of reach. The tick is his default, so a
  // jump to a question that is in the pool regardless leaves it alone.
  if (isAced(target)) {
    hideAced = false;
    if (hideAcedToggle) hideAcedToggle.checked = false;
  }
  if (bank.length > 0) buildSkillSelect();
  syncSkillSelect();
  syncTestSelect();
  if (difficultySelect) difficultySelect.value = difficultyFilter;
  if (testSelect) testSelect.value = testFilter;
  if (wrongOnlyToggle) wrongOnlyToggle.checked = wrongOnly;
  rememberFilters();

  applyFilters();
  const at = pool.findIndex((q) => q.id === id);
  if (at < 0) return false;

  // Park the cursor on it, then re-serve without stepping.
  store.cursor[cursorKey()] = at;
  saveStore();
  current = null;
  nextQuestion({ step: 0, scroll: true });
  return true;
}

function glossFor(question, label) {
  if (!question) return null;

  // A question may carry its own meanings. The missed-in-test set does, because
  // banks/vocab.json is indexed by College Board's question ids and those
  // questions have ids of their own -- so nothing there would ever match them.
  const own = (question.options || []).find((o) => o.label === label);
  if (own && own.gloss) return own.gloss;

  const q = vocabByQuestion[question.id];
  if (!q) return null;
  const hit = q.words.find((w) => w.label === label);
  return hit && hit.gloss ? hit.gloss : null;
}

// Same contract as loadVocab: swallows its own errors and always resolves, so a
// missing file just means nothing is retagged.
function loadDefective() {
  return fetch(`${DEFECTIVE_FILE}?v=${DATA_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.questions) return;
      defectiveById = data.questions;
      console.info(`Defective: ${Object.keys(defectiveById).length} questions `
        + 'retagged — they need the PDF.');
    })
    .catch((err) => console.warn('No defective list loaded.', err));
}

// Same contract again. Appended after everything else, so the 171 questions it
// adds take only new indices and leave every existing one where it was.
function loadEducator() {
  return fetch(`${EDU_FILE}?v=${DATA_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!Array.isArray(data)) return;
      eduQuestions = data;
      const figures = data.filter((q) => q.figure).length;
      console.info(`Educator question bank: ${data.length} questions, `
        + `${figures} needing the figure from the PDF.`);
    })
    .catch((err) => console.warn('No question-bank extras loaded.', err));
}

// Same contract again: swallows its own errors and always resolves, so a missing
// file just means the revision set is absent and everything else runs as before.
function loadConcepts() {
  return fetch(`${CONCEPTS_FILE}?v=${DATA_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!Array.isArray(data)) return;
      concepts = data;
      console.info(`Concepts: ${concepts.length} loaded.`);
    })
    .catch((err) => console.warn('No concepts loaded.', err));
}

function loadMissed() {
  return fetch(`${MISSED_FILE}?v=${DATA_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!Array.isArray(data)) return;
      missedQuestions = data;
      const tests = new Set(data.map((q) => q.test).filter(Boolean));
      console.info(`Missed in a test: ${data.length} questions from `
        + `${tests.size} test(s).`);
    })
    .catch((err) => console.warn('No missed-in-test set loaded.', err));
}

// Fetched alongside the banks and deliberately not awaited by them: a missing or
// broken vocab file must not stop questions loading.
function loadVocab() {
  return fetch(`${VOCAB_FILE}?v=${DATA_VERSION}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.questions)) return;
      data.questions.forEach((q) => {
        if (q.id) vocabByQuestion[q.id] = q;
      });
      vocabQuestions = buildVocabQuestions(data.words || []);
      vocabDrillByWord = {};
      vocabQuestions.forEach((q) => { vocabDrillByWord[q.question.toLowerCase()] = q.id; });
      const glossed = data.questions.reduce(
        (n, q) => n + q.words.filter((w) => w.gloss).length, 0);
      console.info(`Vocab: ${data.questions.length} questions, ${glossed} glossed words, `
        + `${vocabQuestions.length} drill questions built.`);
    })
    .catch((err) => console.warn('No vocab glosses loaded.', err));
}

// One file per Math domain, ~33 MB together: matplotlib figures carrying a glyph
// outline per character of every axis label, and a bitmap per expression on the
// older items. So none of it is fetched until he asks for the Maths section, and
// a Reading session never pays for it.
//
// All four load together rather than one domain at a time. The saved cursor is an
// index into the filtered pool, so a pool that grew halfway through a session
// would silently move his place in it -- one download, then `bank` is stable.
const MATH_DOMAINS = ['algebra', 'advanced-math',
                      'problem-solving-data', 'geometry-trigonometry'];
let mathLoaded = false;
let mathLoading = null;

function loadMathBanks() {
  if (mathLoaded) return Promise.resolve(true);
  if (mathLoading) return mathLoading;

  setEmptyState('Loading the maths questions — about 33 MB, once per session.');
  mathLoading = Promise.all(MATH_DOMAINS.map((slug) =>
    fetch(`banks/math-${slug}.json?v=${DATA_VERSION}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load banks/math-${slug}.json`);
        return r.json();
      })
      .catch((err) => {
        console.error(err);
        return [];
      })
  )).then((results) => {
    const raw = results.flat();
    const ready = raw.filter(isReady);
    // Appended, never spliced in: every cursor already saved is an index into a
    // Reading pool, and those pools are unchanged by questions added at the end.
    bank = bank.concat(ready);
    mathLoaded = true;
    mathLoading = null;
    const withheld = raw.length - ready.length;
    console.info(`Math: ${ready.length} questions loaded`
      + (withheld ? `, ${withheld} withheld as unrenderable or unmarkable.` : '.'));
    buildSkillSelect();
    return ready.length > 0;
  }).catch((err) => {
    mathLoading = null;
    console.error(err);
    setEmptyState('Could not load the maths questions. Check they are served '
      + 'over HTTP from banks/.', true);
    return false;
  });
  return mathLoading;
}

function loadBanks() {
  // The vocab fetch is waited on so the first question already has its glosses,
  // but loadVocab() swallows its own errors and always resolves -- a missing
  // vocab file must never stop questions appearing.
  Promise.all([
    Promise.all(BANKS.map((b) =>
      fetch(`${b.file}?v=${DATA_VERSION}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${b.file}`);
          return r.json();
        })
        .catch((err) => {
          console.error(err);
          return [];
        })
    )),
    loadVocab(),
    loadDefective(),
    loadMissed(),
    loadConcepts(),
    loadEducator()
  ]).then(([results]) => {
    // Order matters and is append-only: the saved cursor is an index into this,
    // so new questions go on the end and every existing index keeps its meaning.
    const raw = results.flat().concat(vocabQuestions, missedQuestions, eduQuestions);
    bank = raw.filter(isReady);

    // Retag before anything reads `bank`: the skill filter, the dropdown counts
    // and the review pool all derive from it, so a defective question must never
    // appear inside the skill it was originally tagged with.
    let retagged = 0;
    bank.forEach((q) => {
      const d = defectiveById[q.id];
      if (!d) return;
      q.realSkill = q.skill;
      q.skill = DEFECTIVE_SKILL;
      q.pdf = d.pdf;
      q.page = d.page;
      retagged += 1;
    });
    if (retagged > 0) console.info(`${retagged} questions moved to "Needs the PDF".`);
    const withheld = raw.length - bank.length;
    if (withheld > 0) {
      console.info(`Loaded ${bank.length} questions; withheld ${withheld} awaiting review.`);
    }

    // Narrow to the focus set here, before anything reads `bank`: the dropdown,
    // the per-skill counts, Coverage, the review-repeat pool and the "all skills"
    // option are all derived from it, so they narrow together.
    if (FOCUS_SKILLS.length > 0) {
      const everything = bank.length;
      bank = bank.filter((q) => FOCUS_SKILLS.includes(q.skill));
      console.info(`Focus mode: ${FOCUS_SKILLS.join(', ')} — ${bank.length} of ${everything} questions in play.`);
    }
    if (bank.length === 0) {
      // The pager readout is the only prose left on the card, so failures have
      // to surface there or they would show up as a blank question.
      setEmptyState('No questions loaded. Ensure the bank files are served over HTTP.', true);
      setPagerState({ atStart: true, empty: true });
      return;
    }

    backfillDays();
    buildSkillSelect();
    syncMissedButton();
    updateSummary();
    // Restore the saved position instead of stepping past it, so reloading the
    // page shows the question he was on rather than skipping one.
    nextQuestion({ step: 0, scroll: false });
  });
}

// How the dropdown is grouped, for whichever section is on screen.
//
// Reading and Writing uses the hand-written registries above: the order is the
// Bluebook score report's, weakest-skill-first inside a domain, and the Extras
// group is ours -- none of that is derivable from the questions.
//
// Maths reads its structure out of the bank instead. Every row carries its own
// `domain`/`domainLabel` and `skill`/`skillLabel` straight from College Board, so
// hand-copying nineteen skill names here would only create a second place for
// them to disagree. Domains are ordered as the score report prints them; skills
// alphabetically within a domain, since nothing yet says which he is weakest at.
const MATH_DOMAIN_ORDER = ['algebra', 'advanced-math',
                           'problem-solving-data', 'geometry-trigonometry'];

function sectionTaxonomy() {
  if (section !== 'math') {
    return {
      order: DOMAIN_ORDER,
      domainLabels: DOMAIN_LABELS,
      skills: SKILLS_BY_DOMAIN,
      skillLabels: SKILL_LABELS
    };
  }

  const domainLabels = {};
  const skillLabels = {};
  const skills = {};
  bank.forEach((q) => {
    if (sectionOf(q) !== 'math') return;
    domainLabels[q.domain] = q.domainLabel || q.domain;
    skillLabels[q.skill] = q.skillLabel || q.skill;
    (skills[q.domain] = skills[q.domain] || new Set()).add(q.skill);
  });
  Object.keys(skills).forEach((d) => {
    skills[d] = [...skills[d]].sort((a, b) =>
      (skillLabels[a] || a).localeCompare(skillLabels[b] || b));
  });
  // Any domain the bank turns out to hold that the order above does not name
  // still gets shown, on the end, rather than silently dropping its questions.
  const order = MATH_DOMAIN_ORDER.filter((d) => skills[d])
    .concat(Object.keys(skills).filter((d) => !MATH_DOMAIN_ORDER.includes(d)));
  return { order, domainLabels, skills, skillLabels };
}

// The skill list is generated from whatever the banks actually contain, with an
// optgroup per domain so the score-report structure is still visible without
// spending four rows of the page on it.
function buildSkillSelect() {
  if (!skillSelect) return;
  skillSelect.textContent = '';

  // Counts what is still AVAILABLE, not what exists: retired vocabulary words are
  // gone from the pool, so a fixed 952 in the dropdown would be a lie he watches
  // never move. Questions retired by "Hide first-time correct" go the same way --
  // these numbers are the answer to "how much have I got left here?", so they have
  // to fall as he clears them.
  //
  // The "all skills" total counts the score-report skills only. The Extras group
  // says in its own heading that it is not made of skills, and it is far the
  // biggest thing in the bank -- counted in, it swamps the number and "all
  // skills" stops answering the question it is there to answer.
  // Under "Wrong answers only" the question the counts answer is a different one
  // -- not "how much is left here" but "where are my mistakes" -- so they count
  // the missed set instead. Reading the same number in both views would make the
  // dropdown useless in exactly the view he opened it to narrow.
  //
  // `present` is every skill the bank still holds, counted separately so that a
  // skill with nothing to show in the current view reads (0) rather than
  // vanishing from the list. A skill that disappears reads as a bug, and it takes
  // the only honest place to show the zero with it.
  const tax = sectionTaxonomy();
  const counts = {};
  const present = {};
  let available = 0;
  bank.forEach((q) => {
    // Only the section on screen. Counting across both would put maths totals on
    // a Reading dropdown, and the pool the numbers describe is section-scoped.
    if (sectionOf(q) !== section) return;
    if (q.skill === VOCAB_SKILL && vocabMastered(q.id)) return;
    present[q.skill] = true;
    if (starredOnly && !isStarred(q.id)) return;
    if (starredOnly ? false : (wrongOnly ? !isWrongEver(q.id) : isAced(q) || isMissed(q))) return;
    counts[q.skill] = (counts[q.skill] || 0) + 1;
    if (!EXTRA_SKILLS.has(q.skill)) available += 1;
  });

  // The multiplier belongs here, at the moment he chooses. Shown only on the
  // individual skills -- "all skills" has no single rate.
  const option = (value, label, count, weight) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = weight
      ? `${label} (${count}) · ${weight}×`
      : `${label} (${count})`;
    return el;
  };

  // Named for what it actually holds, so a short list never looks like a bug.
  skillSelect.append(option(
    'all',
    FOCUS_SKILLS.length > 0 ? "Today's focus"
      : (section === 'math' ? 'All maths skills' : 'All skills'),
    available
  ));

  tax.order.forEach((domain) => {
    const skills = (tax.skills[domain] || []).filter((s) => present[s]);
    if (skills.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = tax.domainLabels[domain] || domain;
    skills.forEach((s) => group.append(
      option(s, tax.skillLabels[s] || s, counts[s] || 0, skillWeight(s))
    ));
    skillSelect.append(group);
  });

  // A saved skill can outlive its bank -- if that file is no longer loaded the
  // option will not exist, so fall back rather than leave the select blank.
  skillSelect.value = skillFilter;
  if (skillSelect.value !== skillFilter) {
    skillFilter = 'all';
    skillSelect.value = 'all';
    rememberFilters();
  }

  syncSkillSelect();
  buildTestSelect();
}

// The tests he has sat, newest first -- the one just taken is the one he wants.
// Built from the set itself, so it grows when a test is added and the control
// disappears entirely if the file is missing.
function buildTestSelect() {
  if (!testSelect) return;
  testSelect.textContent = '';

  // Counted against the view he is in, like the skill counts: under wrong-only a
  // test's number is how many of that sitting he has since missed here too, and
  // outside it, the ones still to do. Either way it is what picking that test
  // would give him -- and, as with the skills, a sitting he has finished shows
  // (0) rather than dropping out of a list whose length decides whether the
  // control is on screen at all.
  const sat = bank.filter((q) => q.skill === MISSED_SKILL && q.test);
  const available = (q) => (wrongOnly ? isWrongEver(q.id) : !isAced(q) && !isMissed(q));
  // Newest first by the date he sat it, falling back to the label so tests
  // without a date still order predictably rather than by bank position.
  const taken = {};
  const counts = {};
  let total = 0;
  sat.forEach((q) => {
    taken[q.test] = q.taken || '';
    counts[q.test] = counts[q.test] || 0;
    if (!available(q)) return;
    counts[q.test] += 1;
    total += 1;
  });
  const labels = Object.keys(counts).sort((a, b) =>
    (taken[b] || '').localeCompare(taken[a] || '') || a.localeCompare(b));

  // With nothing to choose between, the control is hidden below -- so the choice
  // has to go too, or a saved one would sit there narrowing the set with no
  // control on screen to say so.
  if (labels.length < 2 && testFilter !== 'all') {
    testFilter = 'all';
    rememberFilters();
  }

  const option = (value, label, count) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = `${label} (${count})`;
    return el;
  };

  testSelect.append(option('all', 'Every test', total));
  labels.forEach((label) => testSelect.append(option(label, label, counts[label])));

  // A saved test can outlive the file that named it.
  testSelect.value = testFilter;
  if (testSelect.value !== testFilter) {
    testFilter = 'all';
    testSelect.value = 'all';
    rememberFilters();
  }

  syncTestSelect();
}

// Shown exactly when it applies. Narrowing to one sitting of a test means nothing
// against a question bank, so outside "Missed in a test" the control is not there
// to be wondered about -- and `testFilter` is left alone, so returning to that
// skill brings his choice back with it.
function syncTestSelect() {
  if (!testControl) return;
  const relevant = skillFilter === MISSED_SKILL
    && testSelect && testSelect.options.length > 2;
  testControl.hidden = !relevant;
}

// The dropdown must never claim to be filtering something it is not -- which is
// why it was disabled under wrong-only, back when that view ignored it. It no
// longer does, so there is nothing to disable and nothing to explain away: the
// select names the skill it is applying, in that view as in every other.
function syncSkillSelect() {
  if (!skillSelect) return;
  skillSelect.value = skillFilter;
}

function setupControls() {
  if (skillSelect) {
    skillSelect.addEventListener('change', () => {
      skillFilter = skillSelect.value;
      syncTestSelect();
      rememberFilters();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }

  if (testSelect) {
    testSelect.addEventListener('change', () => {
      testFilter = testSelect.value;
      rememberFilters();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }

  if (difficultySelect) {
    difficultySelect.value = difficultyFilter;
    difficultySelect.addEventListener('change', () => {
      difficultyFilter = difficultySelect.value;
      rememberFilters();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }

  if (starredOnlyToggle) {
    starredOnlyToggle.checked = starredOnly;
    starredOnlyToggle.addEventListener('change', () => {
      starredOnly = starredOnlyToggle.checked;
      rememberFilters();
      if (bank.length > 0) buildSkillSelect();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }

  if (hideAcedToggle) {
    hideAcedToggle.checked = hideAced;
    hideAcedToggle.addEventListener('change', () => {
      hideAced = hideAcedToggle.checked;
      rememberFilters();
      // The per-skill counts are what he reads to see how much is left, so they
      // have to change with the tick, not on the next answer.
      if (bank.length > 0) buildSkillSelect();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }

  if (wrongOnlyToggle) {
    wrongOnlyToggle.checked = wrongOnly;
    wrongOnlyToggle.addEventListener('change', () => {
      wrongOnly = wrongOnlyToggle.checked;
      // Same reason as the tick above: the counts in both dropdowns mean "what
      // this tick will actually serve you", and the two views count different
      // things, so they have to be rebuilt rather than left reading the other
      // one's numbers. buildSkillSelect ends by syncing both selects, so it
      // stands in for the two calls that used to be here.
      if (bank.length > 0) buildSkillSelect();
      else syncSkillSelect();
      current = null;
      nextQuestion({ step: 0, scroll: false });
    });
  }
}

// Both pagers move the sequence; only the one at the foot of the card scrolls.
// Clicking the top pager means he is already looking at the question, so the page
// stays put -- while from the bottom, the next question would otherwise open
// somewhere above the viewport.
//
// Wrapped in an arrow rather than passed directly: a listener would hand
// nextQuestion the click event, which has no business being read as its options.
function wirePager(selector, step) {
  document.querySelectorAll(selector).forEach((btn) => {
    const scroll = Boolean(btn.closest('.pager-bottom'));
    btn.addEventListener('click', () => nextQuestion({ step, scroll }));
  });
}

wirePager('.next-question', 1);
// Going back does not undo an answer -- per-question history is cumulative, so
// revisiting a question just shows it again with its counts intact.
wirePager('.prev-question', -1);

// --- Missed in a test, as a list -------------------------------------------

// The dialog is a way into the questions, not a second rendering of them: the
// card behind it already shows a question properly -- passage, underline, the
// options, the reasoning -- so each row here carries only what is needed to
// choose one, and picking it hands over to jumpToQuestion.
const missedDialog = document.getElementById('missedDialog');
const missedListEl = document.getElementById('missedList');
const missedTestSel = document.getElementById('missedTest');
const missedSkillSel = document.getElementById('missedSkill');
const missedSubEl = document.getElementById('missedSub');

function missedRows() {
  return bank.filter((q) => q.skill === MISSED_SKILL);
}

// Newest sitting first: the test he just sat is the one he wants.
function missedTestsByDate(rows) {
  const taken = {};
  rows.forEach((q) => { taken[q.test] = q.taken || ''; });
  return Object.keys(taken).sort((a, b) =>
    (taken[b] || '').localeCompare(taken[a] || '') || a.localeCompare(b));
}

// Each dropdown counts within the OTHER one's selection, so the numbers describe
// what picking that option would actually give him. Counting both against the
// whole set leaves "Practice Test 9 (14)" sitting beside "Words in Context (15)"
// -- a number that cannot be true of the fourteen.
//
// Options with none left are listed anyway, showing (0), for the reason
// buildTestSelect gives: a list that reorders and shortens as he filters is a
// list he has to re-find his place in every time.
function buildMissedFilters() {
  if (!missedTestSel || !missedSkillSel) return;
  const rows = missedRows();
  const test = missedTestSel.value || 'all';
  const skill = missedSkillSel.value || 'all';

  const inSkill = rows.filter((q) => skill === 'all' || q.realSkill === skill);
  const inTest = rows.filter((q) => test === 'all' || q.test === test);

  const option = (value, label, count) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = `${label} (${count})`;
    return el;
  };

  missedTestSel.textContent = '';
  missedTestSel.append(option('all', 'Every test', inSkill.length));
  missedTestsByDate(rows).forEach((t) => missedTestSel.append(
    option(t, t, inSkill.filter((q) => q.test === t).length)));

  // Ordered by how many he has missed overall, not within the current filter --
  // otherwise the list reshuffles under the cursor as he changes the other one.
  const skills = [...new Set(rows.map((q) => q.realSkill).filter(Boolean))]
    .sort((a, b) => rows.filter((q) => q.realSkill === b).length
                  - rows.filter((q) => q.realSkill === a).length);
  missedSkillSel.textContent = '';
  missedSkillSel.append(option('all', 'All skills', inTest.length));
  skills.forEach((sk) => missedSkillSel.append(
    option(sk, SKILL_LABELS[sk] || sk, inTest.filter((q) => q.realSkill === sk).length)));

  // Both lists always carry every option, so a selection always survives the
  // rebuild -- but fall back rather than leave a select showing blank.
  missedTestSel.value = test;
  if (!missedTestSel.value) missedTestSel.value = 'all';
  missedSkillSel.value = skill;
  if (!missedSkillSel.value) missedSkillSel.value = 'all';
}

// Recount, then redraw. Both, always: changing either dropdown moves the other's
// numbers as well as the list.
function refreshMissed() {
  buildMissedFilters();
  renderMissedList();
}

function renderMissedList() {
  if (!missedListEl) return;
  missedListEl.textContent = '';

  const wantTest = missedTestSel ? missedTestSel.value : 'all';
  const wantSkill = missedSkillSel ? missedSkillSel.value : 'all';
  const rows = missedRows().filter((q) =>
    (wantTest === 'all' || q.test === wantTest) &&
    (wantSkill === 'all' || q.realSkill === wantSkill));

  if (missedSubEl) {
    const done = rows.filter((q) => !isWrongEver(q.id) && statsFor(q.id).seen > 0).length;
    missedSubEl.textContent = rows.length === 0
      ? 'Nothing matches those filters.'
      : `${rows.length} question${rows.length === 1 ? '' : 's'}`
        + (done > 0 ? ` · ${done} since answered right` : '');
  }

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'missed-empty';
    p.textContent = 'Nothing missed in that combination.';
    missedListEl.append(p);
    return;
  }

  missedTestsByDate(rows).forEach((test) => {
    const mine = rows.filter((q) => q.test === test)
      .sort((a, b) => (a.module - b.module) || (a.number - b.number));
    if (mine.length === 0) return;

    const head = document.createElement('h3');
    head.className = 'missed-test';
    const name = document.createElement('span');
    name.textContent = test;
    const when = document.createElement('span');
    when.className = 'missed-when';
    when.textContent = `${mine.length} missed`;
    head.append(name, when);
    missedListEl.append(head);

    mine.forEach((q) => {
      const item = document.createElement('div');
      item.className = 'missed-item';

      const line = document.createElement('div');
      line.className = 'missed-line';

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'missed-row';
      // Beaten since: still his, still listed, but visibly behind him.
      const beaten = !isWrongEver(q.id) && statsFor(q.id).seen > 0;
      if (beaten) row.classList.add('is-done');

      const ref = document.createElement('span');
      ref.className = 'missed-ref';
      ref.textContent = q.module ? `M${q.module} Q${q.number}` : `Q${q.number}`;

      const skill = document.createElement('span');
      skill.className = 'missed-skill';
      skill.textContent = SKILL_LABELS[q.realSkill] || q.realSkill || '';

      row.append(ref, skill);

      // No answer letter here. The list is somewhere he browses before deciding
      // what to work on, and a column of correct letters hands him every one of
      // them at a glance -- including for questions he is about to sit again.
      // It is in the question view, where he has chosen to see it.
      if (q.chose) {
        const chose = document.createElement('span');
        chose.className = 'missed-chose';
        chose.textContent = `chose ${q.chose}`;
        row.append(chose);
      }

      if (beaten) {
        const tick = document.createElement('span');
        tick.className = 'missed-done-mark';
        tick.textContent = '✓';
        row.append(tick);
      }

      row.dataset.qid = q.id;
      row.title = q.source || '';
      row.addEventListener('click', () => openMissedQuestion(q));

      line.append(row);
      item.append(line);
      missedListEl.append(item);
    });
  });

  // A re-render wipes the rows, so the selection has to be put back -- or let go
  // of, if the filters have taken that question off the list.
  const stillListed = questionOnShow && rows.some((q) => q.id === questionOnShow.id);
  if (stillListed) {
    const row = missedListEl.querySelector(`[data-qid="${questionOnShow.id}"]`);
    if (row) row.classList.add('is-selected');
  } else if (questionOnShow) {
    clearMissedDetail();
  }
}

// --- One missed question, in full ------------------------------------------

const missedDetailEl = document.getElementById('missedDetail');
const qDialogBody = document.getElementById('qDialogBody');
const qDialogSub = document.getElementById('qDialogSub');
const qDialogTitle = document.getElementById('qDialogTitle');
const practiseBtn = document.getElementById('practiseQuestion');
const revealBtn = document.getElementById('revealSolution');
let questionOnShow = null;

// The question view is the card the app already uses, rebuilt inside the dialog:
// same classes, so the same stylesheet lays it out and it reads as the same
// thing he answers on the page rather than a second design for the same object.
// The one difference is that it opens already graded -- he has sat this one, so
// the answer, his pick and the reasoning are all shown at once.
function renderMissedPassage(question, into) {
  // Two shapes, exactly as renderPassage deals with them and for its reasons: a
  // restored passage is markup and may hold a figure or a table, so it needs the
  // stem block; an extracted one is text, and the underline has to be put back.
  if (question.passageHtml) {
    const stem = document.createElement('div');
    stem.className = 'math-stem';
    // A greyscale chart's own greys ARE its legend, so it keeps its paper in
    // both themes rather than collapsing into one indistinguishable series.
    if (question.passageHtml.includes('<svg')) stem.classList.add('is-paper');
    setMarkup(stem, question.passageHtml);
    into.append(stem);
    return;
  }

  const text = question.passage || '';
  const cloze = document.createElement('p');
  cloze.className = text.includes('___') ? 'cloze' : 'cloze is-prose';

  const addWithBlank = (parent, chunk) => {
    chunk.split('___').forEach((part, i) => {
      if (i > 0) {
        const b = document.createElement('span');
        b.className = 'blank filled';
        b.textContent = ' ';
        parent.append(b);
      }
      if (part) parent.append(document.createTextNode(part));
    });
  };

  const und = question.underline;
  if (und && text.includes(und)) {
    const at = text.indexOf(und);
    addWithBlank(cloze, text.slice(0, at));
    const u = document.createElement('u');
    u.className = 'referenced';
    addWithBlank(u, und);
    cloze.append(u);
    addWithBlank(cloze, text.slice(at + und.length));
  } else {
    addWithBlank(cloze, text);
  }
  into.append(cloze);
}

// Opens unmarked: nothing says which choice was right, no reasoning, and not even
// which one he picked last time -- knowing that rules one out. "See solution"
// reveals all three at once, which is the state the card is in after grading.
let missedRevealed = false;

function openMissedQuestion(question) {
  if (!qDialogBody) return;
  questionOnShow = question;
  missedRevealed = false;

  // Mark the row it came from, so the left column says which of the ninety-odd
  // is currently on the right.
  if (missedListEl) {
    missedListEl.querySelectorAll('.missed-row.is-selected')
      .forEach((el) => el.classList.remove('is-selected'));
    const row = missedListEl.querySelector(`[data-qid="${question.id}"]`);
    if (row) row.classList.add('is-selected');
  }
  renderMissedDetail();
}

function renderMissedDetail() {
  const question = questionOnShow;
  if (!qDialogBody || !question) return;
  qDialogBody.textContent = '';

  if (practiseBtn) practiseBtn.hidden = false;
  // Once shown there is nothing left to show, so the button retires rather than
  // sitting there as a no-op.
  if (revealBtn) revealBtn.hidden = missedRevealed;

  if (qDialogTitle) {
    qDialogTitle.textContent = question.module
      ? `Module ${question.module}, Question ${question.number}`
      : `Question ${question.number}`;
  }
  // Skill and pick ride the subtitle rather than taking a badge row of their own.
  // The dialog is short and the passage is the thing worth the height.
  if (qDialogSub) {
    qDialogSub.textContent = '';
    const where = document.createElement('span');
    where.textContent = question.test || '';
    qDialogSub.append(where);

    const skill = document.createElement('span');
    skill.className = 'tag';
    skill.textContent = SKILL_LABELS[question.realSkill] || question.realSkill || '';
    qDialogSub.append(skill);

    // Held back with the rest of it: "you picked C" is a free elimination.
    if (question.chose && missedRevealed) {
      const picked = document.createElement('span');
      picked.className = 'tag tag-warn';
      picked.textContent = `You picked ${question.chose}`;
      qDialogSub.append(picked);
    }
  }

  // Prompt above the passage, as on the card.
  const title = document.createElement('h2');
  title.className = 'question-title';
  title.textContent = question.question || '';
  qDialogBody.append(title);

  renderMissedPassage(question, qDialogBody);

  const options = document.createElement('div');
  options.className = 'options';
  (question.options || []).forEach((option) => {
    const correct = option.label === question.correctLabel;

    const optionEl = document.createElement('div');
    optionEl.className = 'option';
    if (missedRevealed) {
      // showExplanation is what the card adds once a question is graded: it drops
      // the hover affordance and reveals the gloss and the reasoning.
      optionEl.classList.add('showExplanation', correct ? 'correct' : 'incorrect');
      if (option.label === question.chose) optionEl.classList.add('selected');
      optionEl.dataset.isCorrect = String(correct);
    }

    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = option.label;

    const text = document.createElement('span');
    // Monospace only where punctuation IS the question -- the card's rule.
    const punctuationMatters =
      question.realSkill === 'boundaries' || question.realSkill === 'form-structure-sense';
    text.className = punctuationMatters ? 'text choice' : 'text';
    text.textContent = option.text;

    const mark = document.createElement('span');
    mark.className = 'option-result';
    if (missedRevealed) {
      mark.textContent = correct ? '\u2714' : (option.label === question.chose ? '\u2716' : '');
    }

    row.append(label, text, mark);
    optionEl.append(row);

    if (missedRevealed) {
      const gloss = glossFor(question, option.label);
      if (gloss) {
        const g = document.createElement('p');
        g.className = 'gloss';
        g.textContent = gloss;
        optionEl.append(g);
      }

      const why = document.createElement('p');
      why.className = 'explanation';
      why.textContent = option.why;
      optionEl.append(why);
    }

    options.append(optionEl);
  });
  qDialogBody.append(options);

  // The rule states what the answer turns on, so it belongs with the solution.
  if (question.rule && missedRevealed) {
    const rule = document.createElement('p');
    rule.className = 'rule-box';
    rule.textContent = question.rule;
    qDialogBody.append(rule);
  }

  // The right column scrolls on its own, so a new selection starts at the top of
  // the passage rather than wherever the last one was left. Revealing does not
  // move it: he is reading, and being thrown back to the top would lose his place.
  if (!missedRevealed && missedDetailEl) missedDetailEl.scrollTop = 0;
}

// Nothing picked yet, or what was picked has been filtered away.
function clearMissedDetail() {
  questionOnShow = null;
  missedRevealed = false;
  if (qDialogBody) qDialogBody.textContent = '';
  if (qDialogTitle) qDialogTitle.textContent = 'Nothing selected';
  if (qDialogSub) qDialogSub.textContent = 'Pick a question on the left to see it in full.';
  if (practiseBtn) practiseBtn.hidden = true;
  if (revealBtn) revealBtn.hidden = true;
  if (missedListEl) {
    missedListEl.querySelectorAll('.missed-row.is-selected')
      .forEach((el) => el.classList.remove('is-selected'));
  }
}

if (revealBtn) {
  revealBtn.addEventListener('click', () => {
    missedRevealed = true;
    renderMissedDetail();
  });
}

// The dialog closes: jumpToQuestion scrolls the card into view, and it cannot be
// seen from behind a modal.
if (practiseBtn) {
  practiseBtn.addEventListener('click', () => {
    const target = questionOnShow;
    if (missedDialog && missedDialog.open) missedDialog.close();
    if (target) jumpToQuestion(target.id);
  });
}

// Folding is his decision and it sticks; nothing else ever opens or closes it.
if (conceptPanel) {
  conceptPanel.addEventListener('toggle', () => {
    const id = conceptPanel.dataset.conceptId;
    if (!id) return;
    store.concepts = store.concepts || {};
    store.concepts[id] = { folded: !conceptPanel.open };
    saveStore();
  });
}

const openMissedBtn = document.getElementById('openMissed');
const closeMissedBtn = document.getElementById('closeMissed');

// Nothing sat yet, or the file did not load: a button that opens an empty
// dialog is worse than no button. Called once the banks are in.
function syncMissedButton() {
  if (!openMissedBtn) return;
  const n = missedRows().length;
  openMissedBtn.hidden = n === 0;
  openMissedBtn.title = n ? `${n} questions missed on a real test` : '';
}

if (openMissedBtn && missedDialog) {
  openMissedBtn.addEventListener('click', () => {
    if (!questionOnShow) clearMissedDetail();
    refreshMissed();
    missedDialog.showModal();
  });
}
if (closeMissedBtn && missedDialog) {
  closeMissedBtn.addEventListener('click', () => missedDialog.close());
}
if (missedDialog) {
  missedDialog.addEventListener('click', (ev) => {
    if (ev.target === missedDialog) missedDialog.close();
  });
}
if (missedTestSel) missedTestSel.addEventListener('change', refreshMissed);
if (missedSkillSel) missedSkillSel.addEventListener('change', refreshMissed);

const openProgressBtn = document.getElementById('openProgress');
const closeProgressBtn = document.getElementById('closeProgress');

if (openProgressBtn && progressDialog) {
  openProgressBtn.addEventListener('click', () => {
    updateSummary(); // repaint before it is seen, not while it is hidden
    renderWords();
    progressDialog.showModal();
  });
}
if (closeProgressBtn && progressDialog) {
  closeProgressBtn.addEventListener('click', () => progressDialog.close());
}
// Clicking the backdrop closes it. The dialog fills its own box, so a click
// landing on the dialog element itself came from outside the content.
if (progressDialog) {
  progressDialog.addEventListener('click', (ev) => {
    if (ev.target === progressDialog) progressDialog.close();
  });
}

if (peekBtnEl) {
  peekBtnEl.addEventListener('click', revealMeanings);
}

if (sourceLinkEl && sourceRowEl) {
  sourceLinkEl.addEventListener('click', () => {
    const id = sourceRowEl.dataset.target;
    if (!id) return;
    // Going out from a drill word: remember it so he can come straight back.
    // Going back: the round trip is finished, so forget it.
    // Remember where he came from so the return link works, whichever way round
    // the trip was. Following a return link finishes it, so it clears.
    const goingBack = returnTo && current && current.id === returnTo.at
      && id === returnTo.id;
    returnTo = goingBack ? null : {
      id: current.id,
      word: current.skill === VOCAB_SKILL ? current.question : `question ${current.id.slice(-6)}`,
      at: id
    };
    jumpToQuestion(id);
  });
}

if (dayDoneGoBtn) {
  dayDoneGoBtn.addEventListener('click', () => {
    dayBannerDismissed = true;
    if (dayDoneEl) dayDoneEl.hidden = true;
  });
}

// Switching section swaps the pool, the skill list and the headline figure at
// once. The maths banks are fetched on the first press and not before, so a
// Reading session never downloads 33 MB it will not open.
function setSection(next) {
  if (!SECTIONS[next] || next === section) return;

  const go = () => {
    section = next;
    // His filters are per-section from here: a maths skill means nothing in
    // Reading, so the dropdown resets rather than carrying a dead value across.
    skillFilter = 'all';
    testFilter = 'all';
    wrongOnly = false;
    if (wrongOnlyToggle) wrongOnlyToggle.checked = false;
    rememberFilters();
    saveStore();

    document.querySelectorAll('.section-btn').forEach((btn) => {
      const on = btn.dataset.section === section;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    buildSkillSelect();
    updateSummary();
    // `current` cleared so the cursor of the section he is arriving at is honoured
    // rather than overwritten with the position of the question he was just on.
    current = null;
    nextQuestion({ step: 0, scroll: false });
  };

  if (next === 'math' && !mathLoaded) {
    loadMathBanks().then((ok) => { if (ok) go(); });
    return;
  }
  go();
}

document.querySelectorAll('.section-btn').forEach((btn) => {
  btn.addEventListener('click', () => setSection(btn.dataset.section));
});

if (submitBtn) {
  submitBtn.addEventListener('click', () => {
    // One button, two kinds of question: an entry question has no selected index
    // to reveal, so the guard below would swallow every submit on 450 of them.
    if (isEntry(current)) {
      submitEntry();
      return;
    }
    if (pendingIndex === null) return;
    reveal(pendingIndex);
  });
}

// Jump back to the top of the current sequence without losing any history.
const restartBtn = document.getElementById('restartSequence');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    store.cursor[cursorKey()] = 0;
    saveStore();
    current = null;
    nextQuestion({ step: 0, scroll: false });
  });
}

// Deliberately NOT a button. One mis-click would destroy every count, every
// wrong-answer record and his place in each sequence, with nothing to restore
// from -- so this lives in the console only: run eraseProgress() by hand.
window.eraseProgress = function eraseProgress() {
  if (!confirm('Erase all progress? Every answer, count and saved position will be lost.')) return;
  store = emptyStore();
  // Wiping progress should not also silently change which set is on screen.
  rememberFilters();
  current = null;
  updateSummary();
  nextQuestion({ step: 0, scroll: false });
  console.info('Progress erased.');
};

/* ==========================================================================
   Learn -- a separate place from the drill.

   The drill serves a question and grades it. That is practice, and it assumes
   he already knows the rule. Learn is the other half: read the rule, then meet
   it three times where nothing is in the way, three times at the level the test
   actually asks, and three times where it has been deliberately hidden. The
   ladder is the point -- an easy question proves the rule landed, a hard one
   proves it survives pressure, and doing the hard one first only proves he is
   still guessing.

   It writes to store.learn and nothing else. No counters move, no cursor is
   consumed, no question is retired from the main pool -- so a bad run in here
   costs him nothing and the same questions still turn up in the drill later.
   ========================================================================== */

const LEARN_LADDER = [
  { difficulty: 'easy',   title: 'Warm-up',
    blurb: 'The rule with nothing in the way.',            count: 3, pass: 3 },
  { difficulty: 'medium', title: 'Test level',
    blurb: 'Where most of your questions come from.',      count: 3, pass: 2 },
  { difficulty: 'hard',   title: 'The hardest ones',
    blurb: 'Same rule, buried. This is the one that pays.', count: 3, pass: 2 }
];

let learnScreen = 'home';   // 'home' | 'lesson' | 'ladder' | 'result'
let learnConcept = null;
let learnRung = 0;
let learnSet = [];          // the three questions of the current attempt
let learnAt = 0;
let learnPicked = null;
let learnGraded = false;
let learnMarks = [];        // true/false per question of this attempt
let learnBanked = false;    // this attempt's result already written to the store

const learnDialog = document.getElementById('learnDialog');
const learnBodyEl = document.getElementById('learnBody');
const learnSubEl = document.getElementById('learnSub');

function learnState(id) {
  store.learn = store.learn || {};
  const at = store.learn[id] || {};
  return {
    read: !!at.read,
    rung: at.rung || 0,        // 0-2 in progress, 3 = ladder finished
    seen: at.seen || [],       // ids already used, so a retry brings new ones
    best: at.best || {}        // difficulty -> best score, for the home tiles
  };
}

function saveLearn(id, patch) {
  store.learn = store.learn || {};
  store.learn[id] = Object.assign({}, learnState(id), patch);
  saveStore();
}

// Only the real College Board banks can supply a rung: the missed set and the
// educator bank carry their own skill names, so they never match a lesson's
// skills and drop out here without needing to be named.
function learnPick(concept, difficulty, count, seen) {
  const skills = new Set(concept.skills || []);
  const taken = new Set(seen);
  // Same narrowing as the inline panel: a rung must be questions the lesson
  // actually decides, or the ladder disproves the rule it just taught.
  const fits = (q) =>
    skills.has(q.skill) && q.difficulty === difficulty && conceptMatches(concept, q);

  let eligible = bank.filter((q) => fits(q) && !taken.has(q.id));
  // Every question at this level used up: start the set over rather than serve a
  // short rung. Hundreds deep at each level, so this is a long way off.
  if (eligible.length < count) eligible = bank.filter(fits);

  const shuffled = eligible.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

function learnStartRung(concept, rung) {
  const state = learnState(concept.id);
  learnBanked = false;
  learnRung = rung;
  learnSet = learnPick(concept, LEARN_LADDER[rung].difficulty, LEARN_LADDER[rung].count, state.seen);
  learnAt = 0;
  learnPicked = null;
  learnGraded = false;
  learnMarks = [];
  learnScreen = 'ladder';
}

/* ---------- the screens ---------- */

function learnEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function learnButton(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderLearn() {
  if (!learnBodyEl) return;
  learnBodyEl.textContent = '';
  if (learnScreen === 'home' || !learnConcept) return renderLearnHome();
  if (learnScreen === 'lesson') return renderLearnLesson();
  if (learnScreen === 'result') return renderLearnResult();
  return renderLearnLadder();
}

function renderLearnHome() {
  learnScreen = 'home';
  learnConcept = null;
  if (learnSubEl) {
    learnSubEl.textContent =
      'Read the rule, then practise it easy to hard. Nothing in here touches your scores.';
  }

  if (!concepts.length) {
    learnBodyEl.append(learnEl('p', 'learn-verdict-line', 'Loading lessons\u2026'));
    return;
  }

  const grid = learnEl('div', 'learn-grid');

  concepts.forEach((concept) => {
    const state = learnState(concept.id);
    const done = state.rung >= LEARN_LADDER.length;

    const tile = learnEl('button', 'learn-tile');
    tile.type = 'button';
    if (done) tile.classList.add('is-done');

    const top = learnEl('span', 'learn-tile-top');
    top.append(learnEl('span', 'learn-tile-title', concept.title));

    // One word for where he is, because a tile he has to decode is a tile he
    // does not press.
    let badge = 'Start here';
    if (done) badge = 'Done';
    else if (state.rung > 0) badge = LEARN_LADDER[state.rung].title;
    else if (state.read) badge = 'Ready to practise';
    const badgeEl = learnEl('span', 'learn-badge', badge);
    if (done) badgeEl.classList.add('is-done');
    top.append(badgeEl);
    tile.append(top);

    if (concept.rule) tile.append(learnEl('span', 'learn-tile-rule', concept.rule));

    const rungs = learnEl('span', 'learn-rungs');
    LEARN_LADDER.forEach((rung, i) => {
      const best = state.best[rung.difficulty];
      const pill = learnEl('span', 'learn-rung', rung.title);
      if (i < state.rung) pill.classList.add('is-clear');
      else if (i === state.rung && state.read) pill.classList.add('is-next');
      if (best) pill.title = `Best: ${best} of ${rung.count}`;
      rungs.append(pill);
    });
    tile.append(rungs);

    tile.append(learnEl('span', 'learn-tile-cost',
      `${concept.cost} questions on your real tests`));

    tile.addEventListener('click', () => {
      learnConcept = concept;
      const at = learnState(concept.id);
      // Read it once and the lesson stops being the front door -- he goes
      // straight back to the rung he stopped on. The lesson is one press away
      // from inside the ladder if he wants it again.
      if (!at.read || at.rung >= LEARN_LADDER.length) learnScreen = 'lesson';
      else learnStartRung(concept, at.rung);
      renderLearn();
    });

    grid.append(tile);
  });

  learnBodyEl.append(grid);
}

// The inline panel releases this a card at a time because it sits above a
// question in a strip of space he has not chosen to be in. Here he has opened
// Learn on purpose and the dialog is the size of a page, so the same content
// goes down as a sheet: every section at once, two columns, one scroll. Nine
// presses to read one lesson was the reason he was not reading it.
function renderLearnLesson() {
  const concept = learnConcept;
  const deck = conceptCards(concept);

  learnBodyEl.append(learnCrumb(concept.title));
  if (learnSubEl) learnSubEl.textContent = concept.rule || '';

  const sheet = learnEl('div', 'learn-sheet');
  deck.forEach((card) => sheet.append(renderConceptCard(concept, card)));
  learnBodyEl.append(sheet);

  // Pinned to the bottom of the dialog rather than sitting under the last
  // section: the way on should never be something he has to scroll to find.
  const bar = learnEl('div', 'learn-sticky');
  bar.append(learnEl('span', 'learn-sticky-note',
    `${LEARN_LADDER.length} levels · ${LEARN_LADDER.reduce((n, r) => n + r.count, 0)} questions`));
  bar.append(learnButton('Practise it \u2192', 'btn', () => {
    saveLearn(concept.id, { read: true });
    store.concepts = store.concepts || {};
    store.concepts[concept.id] = { folded: true, read: true };
    saveStore();
    renderConcept(current);
    const at = learnState(concept.id);
    learnStartRung(concept, Math.min(at.rung, LEARN_LADDER.length - 1));
    renderLearn();
  }));
  learnBodyEl.append(bar);
}

function learnCrumb(text, onBack) {
  const bar = learnEl('div', 'learn-crumb');
  bar.append(learnButton('← All lessons', 'learn-crumb-back', onBack || (() => {
    learnScreen = 'home';
    renderLearn();
  })));
  bar.append(learnEl('span', 'learn-crumb-here', text));
  return bar;
}

/* ---------- the rail: the rule applied to the question in front of him ----------

   A rule he can recite and cannot use is worth nothing, and the gap between the
   two is exactly "how does FIND -> COVER -> READ -> DECIDE cash out on THIS
   sentence". So the procedure sits beside the question with the parts of it that
   can be made concrete filled in, and afterwards College Board's own reasoning
   for the right choice is lifted out of the option list and put at the top --
   that paragraph is the rule applied to this question, written by the people who
   set it.

   Nothing that names the answer appears before he has answered. */

// 346 of the bank's questions state the convention in the neutral form "The
// convention being tested is X" -- that names the topic, not the answer, so it
// is safe to show up front. The rest state the rule by working the question out
// ("A comma is the appropriate way to link..."), which gives it away, so those
// are held until after he has committed.
const LEARN_CONVENTION = /^the conventions? being tested (?:is|are)\s+/i;

function learnConvention(question) {
  const rule = (question.rule || '').trim();
  if (!LEARN_CONVENTION.test(rule)) return null;
  return rule.replace(LEARN_CONVENTION, '').replace(/\.$/, '');
}

// "Read all the way to the full stop" is the step he skips, so the sentence is
// pulled out and shown on its own. Only for questions with a blank -- on the
// others the whole passage is the unit and cutting it would mislead.
function learnFocusSentence(question) {
  const text = question.passage || '';
  if (!text.includes('___')) return null;
  const at = text.indexOf('___');
  let from = 0;
  for (let i = at; i > 0; i -= 1) {
    if ('.!?'.includes(text[i - 1]) && text[i] === ' ') { from = i + 1; break; }
  }
  let to = text.length;
  for (let i = at; i < text.length - 1; i += 1) {
    if ('.!?'.includes(text[i]) && text[i + 1] === ' ') { to = i + 1; break; }
  }
  const hit = text.slice(from, to).trim();
  // The passage is one sentence: showing it again beside itself is noise.
  return hit && hit.length < text.trim().length ? hit : null;
}

// Every explanation opens "Choice C is the best answer." -- which is the one part
// he does not need, and naming the letter again adds nothing beside a marked
// option list.
function learnWhy(question) {
  const right = (question.options || []).find((o) => o.label === question.correctLabel);
  if (!right || !right.why) return null;
  return right.why.replace(/^choice\s+[a-d]\s+is\s+the\s+best\s+answer[.,]?\s*/i, '').trim();
}

/* Each lesson names one of its own steps that the rail can make concrete on the
   question in front of him -- concept.railHint says which. That step is the one
   he skips, and seeing it done on this passage is the difference between a rule
   he can recite and a rule he can use. */

// "Read the goal sentence at the bottom. Read it before the notes." It is the
// last sentence of every synthesis passage, and it is the whole question.
function learnGoal(question) {
  const hit = /the student wants to[^.]*\./i.exec(question.passage || '');
  return hit ? hit[0] : null;
}

// "Find the signal: a colon, contrast words, or cause/result words." Present in
// roughly half of them; silent rather than inventing one when it is not.
const LEARN_SIGNALS = [
  ':', ' but ', ' although ', ' while ', ' yet ', ' however', ' because ',
  ' since ', ' so ', ' therefore', ' thus ', ' despite ', ' whereas '
];

function learnSignals(question) {
  const text = ' ' + (learnFocusSentence(question) || question.passage || '').toLowerCase() + ' ';
  const found = LEARN_SIGNALS.filter((word) => text.includes(word)).map((word) => word.trim());
  return found.length ? found : null;
}

// "Now hide the rest of the passage." Which half of the skill this one is
// decides what he hides, and the stem always says.
function learnScope(question) {
  const stem = (question.question || '').toLowerCase();
  if (stem.includes('underlined')) {
    return 'This one asks about the underlined part only. Hide the rest of the passage '
      + 'and ask whether the choice could be written from those words alone.';
  }
  if (stem.includes('main purpose') || stem.includes('overall structure')) {
    return 'This one asks about the whole text -- the job the passage does, not the job '
      + 'of any one sentence.';
  }
  return null;
}

function learnRail(concept, question) {
  const rail = learnEl('aside', 'learn-rail');
  const convention = learnConvention(question);

  if (!learnGraded) {
    rail.append(learnEl('p', 'learn-rail-head', 'Apply the rule'));

    const steps = concept.steps || [];
    if (steps.length) {
      const ol = document.createElement('ol');
      ol.className = 'learn-rail-steps';
      steps.forEach((step) => ol.append(learnEl('li', null, step)));
      rail.append(ol);
    }

    const hint = concept.railHint;
    const sentence = learnFocusSentence(question);

    if (hint === 'goal') {
      const goal = learnGoal(question);
      if (goal) {
        rail.append(learnEl('p', 'learn-rail-tag', 'The goal — read this first'));
        rail.append(learnEl('p', 'learn-rail-sentence', goal));
      }
    } else if (hint === 'scope') {
      const scope = learnScope(question);
      if (scope) {
        rail.append(learnEl('p', 'learn-rail-tag', 'What to hide'));
        rail.append(learnEl('p', 'learn-rail-note', scope));
      }
    } else {
      if (sentence) {
        rail.append(learnEl('p', 'learn-rail-tag',
          hint === 'signal' ? 'Say your own word for this' : 'Read this far'));
        rail.append(learnEl('p', 'learn-rail-sentence', sentence));
      }
      if (hint === 'signal') {
        const signals = learnSignals(question);
        rail.append(learnEl('p', 'learn-rail-tag', 'Signal'));
        if (signals) {
          const row = learnEl('p', 'learn-rail-signals');
          signals.forEach((word) => row.append(learnEl('span', 'learn-signal', word)));
          rail.append(row);
        } else {
          rail.append(learnEl('p', 'learn-rail-note',
            'No colon or contrast word here, so the meaning has to come from the '
            + 'sentence itself. Say your word before you look.'));
        }
      }
    }

    if (convention) {
      rail.append(learnEl('p', 'learn-rail-tag', 'What this one tests'));
      rail.append(learnEl('p', 'learn-rail-note', convention));
    }

    (concept.then || []).forEach((line) => rail.append(learnEl('p', 'learn-rail-then', line)));
    return rail;
  }

  rail.classList.add('is-graded');
  rail.append(learnEl('p', 'learn-rail-head', 'How the rule applied'));
  if (convention) {
    rail.append(learnEl('p', 'learn-rail-tag', 'What this one tested'));
    rail.append(learnEl('p', 'learn-rail-note', convention));
  }
  const why = learnWhy(question);
  if (why) {
    rail.append(learnEl('p', 'learn-rail-tag', 'Why that answer'));
    rail.append(learnEl('p', 'learn-rail-why', why));
  }
  const hook = (concept.memorise || [])[0];
  if (hook) rail.append(learnEl('p', 'learn-rail-hook', hook));
  return rail;
}

function renderLearnLadder() {
  const concept = learnConcept;
  const rung = LEARN_LADDER[learnRung];
  const question = learnSet[learnAt];
  if (!learnSet.length) {
    learnBodyEl.append(learnCrumb(concept.title));
    learnBodyEl.append(learnEl('p', 'learn-verdict-line',
      'No questions at this level are loaded yet. Give the banks a moment and try again.'));
    return;
  }
  if (!question) { learnScreen = 'result'; return renderLearn(); }

  learnBodyEl.append(learnCrumb(concept.title));
  if (learnSubEl) learnSubEl.textContent = `${rung.title} · ${rung.blurb}`;

  const stage = learnEl('div', 'learn-stage');

  // The rule stays on screen the whole way up the ladder. He is not being tested
  // on whether he remembered it; he is being shown it works.
  const hook = (concept.memorise || [])[0];
  if (hook) {
    const reminder = learnEl('div', 'learn-reminder');
    reminder.append(learnEl('span', 'learn-reminder-tag', 'The rule'));
    reminder.append(learnEl('span', 'learn-reminder-text', hook));
    reminder.append(learnButton('Read the lesson again', 'learn-relesson', () => {
      learnScreen = 'lesson'; renderLearn();
    }));
    stage.append(reminder);
  }

  const head = learnEl('div', 'learn-qhead');
  head.append(learnEl('span', 'learn-step', `Question ${learnAt + 1} of ${learnSet.length}`));
  const pips = learnEl('span', 'learn-pips');
  learnSet.forEach((_, i) => {
    const pip = learnEl('span', 'learn-pip');
    if (i < learnMarks.length) pip.classList.add(learnMarks[i] ? 'is-right' : 'is-wrong');
    else if (i === learnAt) pip.classList.add('is-now');
    pips.append(pip);
  });
  head.append(pips);
  stage.append(head);

  stage.append(learnEl('h3', 'question-title', question.question || ''));
  stage.append(learnPassage(question));
  stage.append(learnOptions(question));

  const foot = learnEl('div', 'learn-foot');
  if (!learnGraded) {
    const submit = learnButton('Check', 'btn', () => {
      if (learnPicked === null) return;
      learnGraded = true;
      learnMarks[learnAt] = learnPicked === question.correctLabel;
      renderLearn();
    });
    submit.disabled = learnPicked === null;
    foot.append(submit);
  } else {
    const right = learnMarks[learnAt];
    const verdict = learnEl('span', right ? 'learn-verdict is-right' : 'learn-verdict is-wrong',
      right ? '✔ Right' : `✖ The answer was ${question.correctLabel}`);
    foot.append(verdict);
    const lastOne = learnAt === learnSet.length - 1;
    foot.append(learnButton(lastOne ? 'See how you did' : 'Next question →', 'btn', () => {
      if (lastOne) { learnScreen = 'result'; renderLearn(); return; }
      learnAt += 1;
      learnPicked = null;
      learnGraded = false;
      renderLearn();
    }));
  }
  stage.append(foot);

  const work = learnEl('div', 'learn-work');
  work.append(stage, learnRail(concept, question));
  learnBodyEl.append(work);
}

// A local copy of the card's passage rendering rather than a call into it: that
// one paints the single .cloze element the card owns, and Learn must not reach
// into the page behind the dialog.
function learnPassage(question) {
  const box = learnEl('div', 'cloze');
  const text = question.passage || '';
  const underline = question.underline || null;

  if (underline && text.includes(underline)) {
    box.classList.add('is-prose');
    appendUnderlined(box, text, underline, null);
    return box;
  }
  if (!text.includes('___')) {
    box.classList.add('is-prose');
    appendText(box, text, null);
    return box;
  }
  const [before, after] = text.split('___');
  const blank = learnEl('span', 'blank');
  blank.append(' ');
  appendText(box, before, null);
  box.append(blank);
  appendText(box, after, null);
  return box;
}

function learnOptions(question) {
  const box = learnEl('div', 'options');
  const punctuationMatters =
    question.skill === 'boundaries' || question.skill === 'form-structure-sense';

  (question.options || []).forEach((option) => {
    const correct = option.label === question.correctLabel;
    const el = learnEl('div', 'option');
    if (learnGraded) {
      el.classList.add('showExplanation', correct ? 'correct' : 'incorrect');
      if (option.label === learnPicked) el.classList.add('selected');
      el.dataset.isCorrect = String(correct);
    } else if (option.label === learnPicked) {
      el.classList.add('selected');
    }

    const row = learnEl('div', 'row');
    row.append(learnEl('span', 'label', option.label));
    row.append(learnEl('span', punctuationMatters ? 'text choice' : 'text', option.text));
    const mark = learnEl('span', 'option-result');
    if (learnGraded) {
      mark.textContent = correct ? '✔' : (option.label === learnPicked ? '✖' : '');
    }
    row.append(mark);
    el.append(row);

    if (learnGraded && option.why) {
      // Every explanation, not just the right one: on a rung the wrong answers
      // are the lesson. He picked one of them for a reason.
      el.append(learnEl('p', 'explanation', option.why));
    }

    if (!learnGraded) {
      el.addEventListener('click', () => { learnPicked = option.label; renderLearn(); });
    }
    box.append(el);
  });
  return box;
}

function renderLearnResult() {
  const concept = learnConcept;
  const rung = LEARN_LADDER[learnRung];
  const score = learnMarks.filter(Boolean).length;
  const passed = score >= rung.pass;
  const state = learnState(concept.id);

  learnBodyEl.append(learnCrumb(concept.title));
  if (learnSubEl) learnSubEl.textContent = `${rung.title} · result`;

  const stage = learnEl('div', 'learn-stage learn-result');
  stage.append(learnEl('p', 'learn-score', `${score} / ${learnSet.length}`));
  stage.append(learnEl('p', 'learn-score-label', rung.title));

  const nextRung = learnRung + 1;

  // Banked once per attempt rather than on every paint: this screen re-renders
  // and `seen` is a growing list, so writing it here twice would record the same
  // three questions twice.
  if (!learnBanked) {
    learnBanked = true;
    const best = state.best[rung.difficulty];
    const bestScore = best ? Number(String(best).split('/')[0]) : -1;
    const patch = {
      seen: state.seen.concat(learnSet.map((q) => q.id)),
      best: Object.assign({}, state.best,
        score > bestScore ? { [rung.difficulty]: `${score}/${learnSet.length}` } : {})
    };
    if (passed) patch.rung = Math.max(state.rung, nextRung);
    saveLearn(concept.id, patch);
  }

  const foot = learnEl('div', 'learn-foot');

  if (passed && nextRung < LEARN_LADDER.length) {
    stage.append(learnEl('p', 'learn-verdict-line',
      `The rule holds at this level. ${LEARN_LADDER[nextRung].blurb}`));
    foot.append(learnButton(`${LEARN_LADDER[nextRung].title} →`, 'btn', () => {
      learnStartRung(concept, nextRung);
      renderLearn();
    }));
  } else if (passed) {
    stage.append(learnEl('p', 'learn-verdict-line',
      'All three levels. That rule is yours -- go and use it on the real drill.'));
    foot.append(learnButton('Back to lessons', 'btn', () => { learnScreen = 'home'; renderLearn(); }));
  } else {
    // Not a failure screen. Three more at the same level, all questions he has
    // not seen, because the rung is what teaches and repeating it is the method.
    stage.append(learnEl('p', 'learn-verdict-line',
      `${rung.pass} of ${learnSet.length} moves you up. Read the rule once more, then take three new ones.`));
    const hook = (concept.memorise || [])[0];
    if (hook) stage.append(learnEl('p', 'learn-rehook', hook));
    foot.append(learnButton('Three more →', 'btn', () => {
      learnStartRung(concept, learnRung);
      renderLearn();
    }));
    foot.append(learnButton('Read the lesson again', 'btn btn-small', () => {
      learnScreen = 'lesson'; renderLearn();
    }));
  }

  stage.append(foot);
  learnBodyEl.append(stage);
}

/* ---------- wiring ---------- */

const openLearnBtn = document.getElementById('openLearn');
if (openLearnBtn && learnDialog) {
  openLearnBtn.addEventListener('click', () => {
    // Opens where he left off only within a session; a fresh open shows the
    // shelf, because which lesson to work on is the first decision.
    learnScreen = 'home';
    renderLearn();
    learnDialog.showModal();
  });
}

const closeLearnBtn = document.getElementById('closeLearn');
if (closeLearnBtn && learnDialog) {
  closeLearnBtn.addEventListener('click', () => learnDialog.close());
}

if (learnDialog) {
  // Backdrop click closes, as the other dialogs do.
  learnDialog.addEventListener('click', (ev) => {
    if (ev.target === learnDialog) learnDialog.close();
  });
}

window.Sparkle.init();
setupControls();
updateSummary();
loadBanks();

window.addEventListener('error', (ev) => {
  console.error('Unhandled error:', ev.error || ev.message);
  setEmptyState(`Error: ${ev.error ? ev.error.message : ev.message}`, true);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled rejection:', ev.reason);
  setEmptyState(`Error: ${ev.reason ? ev.reason.message || ev.reason : ev.reason}`, true);
});
