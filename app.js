// Unified SAT practice engine. Loads skill-tagged question banks and drills
// them in the real digital-SAT shape: a short passage with a blank, four
// choices, and a rule plus per-option reasoning on reveal.
//
// Questions are served in bank order, not at random, and the position is
// remembered so a new session resumes where the last one stopped. Every
// FRESH_PER_REVIEW questions, one previously-wrong question is spliced in.
// Per-question history persists, so nothing worked through is ever lost.
// Theme and sparkle come from shared.js.

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
const HEATMAP_LOOKBACK_WEEKS = 2;

// --- Score projection ------------------------------------------------------
// A digital-SAT Reading and Writing section is 54 questions scaled to 200-800.
const RW_QUESTIONS = 54;
const POINTS_PER_QUESTION = 600 / RW_QUESTIONS;

// Anchored on his own result rather than a published conversion table: Practice
// 5 (6 Aug 2026) was 20 wrong of 54, so 34 right, scored 550. That keeps the
// projection honest about what it is -- a rough read calibrated to one real
// sitting, not a prediction.
const SCORE_ANCHOR = { accuracy: 34 / RW_QUESTIONS, score: 550 };

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
  boundaries: 4,
  transitions: 3,
  'form-structure-sense': 2,
  inferences: 2,
  'text-structure-purpose': 1,
  'command-of-evidence': 1,
  'rhetorical-synthesis': 1,
  'central-ideas-details': 0,
  'cross-text-connections': 0
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
  'standard-english': 'Standard English Conventions'
};

// Same order the Bluebook score report uses, so the nav is recognisable. Within
// a domain, the skills he loses the most points on come first.
const DOMAIN_ORDER = [
  'craft-structure',
  'expression-of-ideas',
  'standard-english',
  'information-ideas'
];

const SKILLS_BY_DOMAIN = {
  'craft-structure': ['words-in-context', 'text-structure-purpose', 'cross-text-connections'],
  'expression-of-ideas': ['transitions', 'rhetorical-synthesis'],
  'standard-english': ['boundaries', 'form-structure-sense'],
  'information-ideas': ['inferences', 'central-ideas-details', 'command-of-evidence']
};

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
let wrongOnly = false;     // restrict to questions he has gotten wrong
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

const STREAK_LENGTH = 8;

const titleEl = document.querySelector('.question-title');
const metaEl = document.querySelector('.q-meta');
const passageEl = document.querySelector('.cloze');
const optionsContainer = document.querySelector('.options');
const ruleBox = document.getElementById('ruleBox');
const correctCountEl = document.getElementById('correctCount');
const incorrectCountEl = document.getElementById('incorrectCount');
const streakEl = document.getElementById('streakStrip');
const lifetimeEl = document.getElementById('lifetimeStats');
const skillSelect = document.getElementById('skillSelect');
const difficultySelect = document.getElementById('difficultySelect');
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
    // days['2026-08-07'] = { answered, correct }. One row per calendar day he
    // works, which is what the daily target reads and what the streak and the
    // day-to-day comparison will read later.
    days: {},
    // Rolling log of outcomes, oldest first: { s: skill, ok: 0|1 }. Capped at
    // RECENT_MAX. This is what the projection reads, so it reflects current form
    // rather than everything he has ever attempted.
    recent: [],
    sinceReview: 0,
    filters: { skill: 'all', difficulty: 'all' }
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
  return d ? { points: 0, ...d } : { answered: 0, correct: 0, points: 0 };
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

function rememberFilters() {
  store.filters = { skill: skillFilter, difficulty: difficultyFilter };
  saveStore();
}

function statsFor(id) {
  return store.progress[id] || { seen: 0, correct: 0, wrong: 0 };
}

function recordAnswer(question, isCorrect, pointsGained) {
  // Read before the counts move: a question already beaten is revision, and
  // revision must not reach the day's tally or the form log.
  const revision = alreadyBeaten(question.id);

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
    store.days[key] = day;

    // Rolling form, oldest trimmed off the front. Re-answering something he has
    // already learned would lift this average without him improving.
    const recent = store.recent || [];
    recent.push({ s: question.skill, ok: isCorrect ? 1 : 0 });
    if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
    store.recent = recent;
  }

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
function formForProjection() {
  const recent = recentForm();
  if (recent.n >= MIN_FOR_PROJECTION) return recent;

  const all = Object.values(store.progress);
  const seen = all.reduce((n, e) => n + (e.seen || 0), 0);
  const correct = all.reduce((n, e) => n + (e.correct || 0), 0);
  if (seen < MIN_FOR_PROJECTION) return recent;
  return { n: seen, ok: correct, accuracy: correct / seen, lifetime: true };
}

// One-time rebuild of the day history. progress[].last is the only record of
// WHEN earlier work happened, so days before the rolling log can be recovered
// approximately: it holds each question's most recent day, which undercounts a
// question answered across several days. Flagged as estimated in the tooltip.
function backfillDays() {
  if (store.backfilledDays) return;
  store.backfilledDays = true;

  const rebuilt = {};
  Object.values(store.progress).forEach((e) => {
    if (!e.last) return;
    const d = rebuilt[e.last] || { answered: 0, correct: 0, points: 0, estimated: true };
    d.answered += e.seen || 0;
    d.correct += e.correct || 0;
    // Medium base at the skill's baseline weight: difficulty was never stored
    // per attempt, so this is the best estimate available.
    d.points += Math.round((e.correct || 0) * POINTS_BY_DIFFICULTY.medium * skillWeight(e.skill));
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

function questionPoints(question) {
  if (alreadyBeaten(question.id)) return ALREADY_BEATEN_PAYS;

  const base = POINTS_BY_DIFFICULTY[question.difficulty] || POINTS_BY_DIFFICULTY.medium;
  let points = base * skillWeight(question.skill);
  if (servingReview) points *= REVIEW_BONUS;
  return Math.max(1, Math.round(points));
}

// Accuracy over the last `window` answers, default one R&W section's worth.
function recentForm(window) {
  const list = (store.recent || []).slice(-(window || RW_QUESTIONS));
  if (list.length === 0) return { n: 0, ok: 0, accuracy: 0 };
  const ok = list.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
  return { n: list.length, ok, accuracy: ok / list.length };
}

// Shift off the anchor by however many questions his accuracy differs by, at
// roughly 11 points a question. Rounded to 10 because a projection precise to
// the point would be pretending.
function projectedScore(accuracy) {
  const raw = SCORE_ANCHOR.score +
    (accuracy - SCORE_ANCHOR.accuracy) * RW_QUESTIONS * POINTS_PER_QUESTION;
  return Math.min(800, Math.max(200, Math.round(raw / 10) * 10));
}

// Anything he has ever gotten wrong stays eligible for review, however many
// times he has since gotten it right -- the counts are shown so the record is
// visible rather than silently retired.
function isWrongEver(id) {
  return statsFor(id).wrong > 0;
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

function renderPassage(question, showSignal) {
  passageEl.textContent = '';
  const signal = showSignal ? question.signal : null;

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

function renderMeta(question) {
  metaEl.textContent = '';
  [
    SKILL_LABELS[question.skill] || question.skill,
    question.difficulty
  ].forEach((label) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label;
    metaEl.append(tag);
  });

  // Show this question's own history, so a repeat is never a surprise and he
  // can see whether he has beaten it before.
  const stats = statsFor(question.id);
  if (stats.seen > 0) {
    const tag = document.createElement('span');
    tag.className = stats.wrong > 0 ? 'tag tag-warn' : 'tag';
    tag.textContent = `Seen ${stats.seen}× · ${stats.correct} right / ${stats.wrong} wrong`;
    metaEl.append(tag);
  }

  if (servingReview) {
    const tag = document.createElement('span');
    tag.className = 'tag tag-warn';
    tag.textContent = 'Review';
    metaEl.append(tag);
  }

  // What this one pays. Shown before answering so the weighting is visible while
  // it can still motivate, then replaced by what he actually earned.
  const worth = document.createElement('span');
  if (lastAward === null && alreadyBeaten(question.id)) {
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
}

function renderOptions(question) {
  optionsContainer.textContent = '';

  question.options.forEach((option, index) => {
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
    // Monospace only where punctuation IS the question -- at prose sizes a
    // comma and a semicolon are hard to tell apart. Everywhere else, and
    // especially for full-sentence choices, proportional type reads better.
    const punctuationMatters =
      question.skill === 'boundaries' || question.skill === 'form-structure-sense';
    text.className = punctuationMatters ? 'text choice' : 'text';
    text.textContent = option.text;

    const mark = document.createElement('span');
    mark.className = 'option-result';

    row.append(label, text, mark);

    const why = document.createElement('p');
    why.className = 'explanation';
    why.textContent = option.why;

    optionEl.append(row, why);
    optionEl.addEventListener('click', () => selectOption(index));
    optionsContainer.append(optionEl);
  });
}

// Marks a choice without grading it. Re-clicking a different option just moves
// the mark, so nothing is committed until Submit.
function selectOption(index) {
  if (answered) return;
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
  submitBtn.disabled = answered || pendingIndex === null;
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
    pay.title = `Pays ${weight}× — ${weight >= 2.5 ? 'his weakest work'
      : weight >= 1.7 ? 'still costing him marks' : 'close to solid'}`;

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
}

// Projected R&W score from recent form, against his real Practice 5 result. Held
// back until MIN_FOR_PROJECTION answers, because a projection off four questions
// would swing 200 points and teach him to distrust the number.
function renderProjection() {
  if (!projectionEl) return;
  const form = formForProjection();

  if (form.n < MIN_FOR_PROJECTION) {
    projectionEl.textContent = '—';
    projectionEl.classList.remove('is-up', 'is-down');
    if (projectionNoteEl) {
      // Says what it is counting. "11 more answers" read as "11 wrong" to the
      // first person who saw it -- right and wrong both count toward the sample.
      projectionNoteEl.textContent = `${form.n} of ${MIN_FOR_PROJECTION} answers`;
      projectionNoteEl.title =
        `A projection needs ${MIN_FOR_PROJECTION} answers, right or wrong`;
    }
    return;
  }

  const score = projectedScore(form.accuracy);
  const delta = score - SCORE_ANCHOR.score;
  projectionEl.textContent = `~${score}`;
  projectionEl.classList.toggle('is-up', delta > 0);
  projectionEl.classList.toggle('is-down', delta < 0);

  if (projectionNoteEl) {
    const move = delta === 0
      ? 'level with Practice 5'
      : `${delta > 0 ? '+' : ''}${delta} on Practice 5`;
    const basis = form.lifetime
      ? `all ${form.n} answers so far`
      : `last ${form.n} answers`;
    projectionNoteEl.textContent = move;
    projectionNoteEl.title =
      `Reading & Writing · ${basis} at ${Math.round(form.accuracy * 100)}%`;
  }
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

function renderDaily() {
  const today = dayStats();
  const done = dayGoalMet(today);
  const shown = Math.min(today.points, DAILY_POINTS_TARGET);

  // The tile carries the number; its caption carries the target.
  if (dailyCountEl) dailyCountEl.textContent = today.points;
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
  directionAnswered = false;
  directionCorrect = null;

  renderMeta(question);
  titleEl.textContent = question.question ||
    'Which choice completes the text so that it conforms to the conventions of Standard English?';
  renderPassage(question, false);
  renderOptions(question);
  renderDirectionStep(question);
  // After renderDirectionStep: it decides whether the choices start hidden, and
  // the submit row follows them.
  updateSubmitState();

  ruleBox.hidden = true;
  ruleBox.textContent = '';
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

  // Re-render with the signal phrase marked, now that giving it away costs nothing.
  renderPassage(current, true);
  fillBlank(selected.text);

  ruleBox.textContent = current.rule;
  ruleBox.hidden = false;

  // No prose summary any more: the correct choice carries a tick and its own
  // explanation, the rule box states the convention, and the sidebar pill says
  // whether he got it. Repeating all that in a paragraph earned no space.
}

// Bank order is preserved, so the sequence a learner walks is stable between
// sessions and the saved cursor keeps pointing at the same place.
function applyFilters() {
  pool = bank.filter((q) =>
    (skillFilter === 'all' || q.skill === skillFilter) &&
    (difficultyFilter === 'all' || q.difficulty === difficultyFilter)
  );
  if (wrongOnly) pool = pool.filter((q) => isWrongEver(q.id));
}

// Each filter combination keeps its own place in the sequence.
function cursorKey() {
  return `${skillFilter}|${difficultyFilter}|${wrongOnly ? 'wrong' : 'all'}`;
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
    setEmptyState(wrongOnly
      ? 'Nothing wrong yet in this set. Untick "Wrong answers only", or widen the skill or difficulty.'
      : 'No questions match these filters.', true);
    // Neither direction leads anywhere in an empty set; the warning takes the
    // readout's place in the pager and both controls go inert.
    setPagerState({ atStart: true, empty: true });
    return;
  }

  // Splice in a repeat every FRESH_PER_REVIEW fresh questions. Reviews are
  // drawn at random from everything he has gotten wrong within this filter.
  const reviewable = wrongOnly
    ? []
    : pool.filter((q) => isWrongEver(q.id) && (!current || q.id !== current.id));

  // A review repeat is drawn at random and never persisted, so it cannot be
  // restored on reload or stepped back to -- only splice one in when moving
  // forward, which also keeps a refresh showing the same question every time.
  if (step > 0 && store.sinceReview >= FRESH_PER_REVIEW && reviewable.length > 0) {
    current = reviewable[Math.floor(Math.random() * reviewable.length)];
    store.sinceReview = 0;
    servingReview = true;
  } else {
    current = takeNextInSequence(step);
    if (step > 0) store.sinceReview += 1;
    servingReview = false;
  }

  saveStore();
  renderSetSummary();
  loadQuestion(current);

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
  const wrong = pool.filter((q) => isWrongEver(q.id)).length;
  const pass = Math.floor(servedIndex / total) + 1;
  const position = (servedIndex % total) + 1;

  // "Position" rather than "seen": skipping with Next advances the place in the
  // sequence without answering anything, so the two numbers legitimately differ.
  const parts = [
    servingReview ? 'Review repeat' : `Position ${position} of ${total}`,
    pass > 1 && !servingReview ? `pass ${pass}` : null,
    `${seen} answered`,
    wrong > 0 ? `${wrong} to revisit` : null
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

function loadBanks() {
  Promise.all(BANKS.map((b) =>
    fetch(b.file)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${b.file}`);
        return r.json();
      })
      .catch((err) => {
        console.error(err);
        return [];
      })
  )).then((results) => {
    const raw = results.flat();
    bank = raw.filter(isReady);
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
    updateSummary();
    // Restore the saved position instead of stepping past it, so reloading the
    // page shows the question he was on rather than skipping one.
    nextQuestion({ step: 0, scroll: false });
  });
}

// The skill list is generated from whatever the banks actually contain, with an
// optgroup per Reading and Writing domain so the score-report structure is
// still visible without spending four rows of the page on it.
function buildSkillSelect() {
  if (!skillSelect) return;
  skillSelect.textContent = '';

  const counts = {};
  bank.forEach((q) => { counts[q.skill] = (counts[q.skill] || 0) + 1; });

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
    FOCUS_SKILLS.length > 0 ? "Today's focus" : 'All skills',
    bank.length
  ));

  DOMAIN_ORDER.forEach((domain) => {
    const skills = SKILLS_BY_DOMAIN[domain].filter((s) => counts[s]);
    if (skills.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = DOMAIN_LABELS[domain] || domain;
    skills.forEach((s) => group.append(
      option(s, SKILL_LABELS[s] || s, counts[s], skillWeight(s))
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
}

function setupControls() {
  if (skillSelect) {
    skillSelect.addEventListener('change', () => {
      skillFilter = skillSelect.value;
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

  if (wrongOnlyToggle) {
    wrongOnlyToggle.checked = wrongOnly;
    wrongOnlyToggle.addEventListener('change', () => {
      wrongOnly = wrongOnlyToggle.checked;
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

const openProgressBtn = document.getElementById('openProgress');
const closeProgressBtn = document.getElementById('closeProgress');

if (openProgressBtn && progressDialog) {
  openProgressBtn.addEventListener('click', () => {
    updateSummary(); // repaint before it is seen, not while it is hidden
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

if (dayDoneGoBtn) {
  dayDoneGoBtn.addEventListener('click', () => {
    dayBannerDismissed = true;
    if (dayDoneEl) dayDoneEl.hidden = true;
  });
}

if (submitBtn) {
  submitBtn.addEventListener('click', () => {
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
