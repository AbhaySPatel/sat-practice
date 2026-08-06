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
let sessionCorrect = 0;
let sessionIncorrect = 0;
let sessionStreak = [];
let directionHits = 0;
let directionTotal = 0;

const STREAK_LENGTH = 8;

const titleEl = document.querySelector('.question-title');
const metaEl = document.querySelector('.q-meta');
const passageEl = document.querySelector('.cloze');
const optionsContainer = document.querySelector('.options');
const resultText = document.getElementById('resultText');
const ruleBox = document.getElementById('ruleBox');
const statusEl = document.querySelector('.status');
const answeredEl = document.getElementById('questionsAnswered');
const correctCountEl = document.getElementById('correctCount');
const incorrectCountEl = document.getElementById('incorrectCount');
const streakEl = document.getElementById('streakStrip');
const queueCountEl = document.getElementById('queueCount');
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
    sinceReview: 0,
    filters: { skill: 'all', difficulty: 'all' }
  };
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

function recordAnswer(question, isCorrect) {
  const entry = store.progress[question.id] ||
    { seen: 0, correct: 0, wrong: 0, skill: question.skill };
  entry.seen += 1;
  if (isCorrect) entry.correct += 1;
  else entry.wrong += 1;
  entry.skill = question.skill;
  entry.last = new Date().toISOString().slice(0, 10);
  store.progress[question.id] = entry;
  saveStore();
}

// Anything he has ever gotten wrong stays eligible for review, however many
// times he has since gotten it right -- the counts are shown so the record is
// visible rather than silently retired.
function isWrongEver(id) {
  return statsFor(id).wrong > 0;
}

// --- Rendering -------------------------------------------------------------

function setStatus(text, state) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-pending', 'is-correct', 'is-incorrect', 'is-error');
  statusEl.classList.add(`is-${state}`);
}

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
function renderSkillStats() {
  if (!skillStatsEl) return;
  skillStatsEl.textContent = '';

  const bySkill = {};
  bank.forEach((q) => {
    const row = bySkill[q.skill] || { total: 0, seen: 0, wrong: 0 };
    const stats = statsFor(q.id);
    row.total += 1;
    if (stats.seen > 0) row.seen += 1;
    if (stats.wrong > 0) row.wrong += 1;
    bySkill[q.skill] = row;
  });

  Object.keys(bySkill).sort().forEach((skill) => {
    const { total, seen, wrong } = bySkill[skill];
    const row = document.createElement('div');
    row.className = 'skill-row';

    const name = document.createElement('span');
    name.textContent = SKILL_LABELS[skill] || skill;

    const count = document.createElement('strong');
    count.textContent = `${seen}/${total}`;
    if (wrong > 0) count.title = `${wrong} still wrong`;

    row.append(name, count);
    skillStatsEl.append(row);

    // Coverage bar: filled portion is what he has attempted at least once.
    const bar = document.createElement('div');
    bar.className = 'coverage-bar';
    const fill = document.createElement('i');
    fill.style.width = `${total ? (seen / total) * 100 : 0}%`;
    bar.append(fill);
    skillStatsEl.append(bar);
  });
}

function updateSummary() {
  const total = sessionCorrect + sessionIncorrect;
  if (answeredEl) answeredEl.textContent = `Answered this session: ${total}`;
  correctCountEl.textContent = `Correct: ${sessionCorrect}`;
  incorrectCountEl.textContent = `Incorrect: ${sessionIncorrect}`;

  // Lifetime totals across every session, which is what the every-two-days
  // rhythm actually needs to see.
  const all = Object.values(store.progress);
  const attempts = all.reduce((n, e) => n + e.seen, 0);
  const rights = all.reduce((n, e) => n + e.correct, 0);
  if (queueCountEl) {
    queueCountEl.textContent = attempts === 0
      ? '0'
      : `${Math.round((rights / attempts) * 100)}%`;
  }
  if (lifetimeEl) {
    lifetimeEl.textContent = attempts === 0
      ? 'No questions answered yet'
      : `${attempts} answers over ${all.length} questions · ${rights} right`;
  }
  // Only meaningful once a direction-tagged question has actually been worked.
  if (directionScoreEl) {
    directionScoreEl.hidden = directionTotal === 0;
    directionScoreEl.textContent =
      `Direction called right: ${directionHits} of ${directionTotal}`;
  }
  renderStreak();
  renderSkillStats();
}

// --- Question flow ---------------------------------------------------------

function loadQuestion(question) {
  current = question;
  answered = false;
  pendingIndex = null;
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
  setStatus('Awaiting answer', 'pending');
  resultText.textContent = question.direction
    ? 'First decide which way the sentence turns. The choices unlock once you commit.'
    : 'Read the whole passage, then pick a choice and submit it. The explanation appears once you do.';
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
    if (isCorrect) sessionCorrect += 1;
    else sessionIncorrect += 1;
    recordAnswer(current, isCorrect);
    sessionStreak.push(isCorrect);
    answered = true;
    updateSummary();
    renderSetSummary();
    renderMeta(current); // refresh the seen/right/wrong tag with this attempt
  }
  updateSubmitState(); // retires the submit row now that this one is graded

  if (isCorrect) window.Sparkle.burstOver(optionsContainer);

  // Re-render with the signal phrase marked, now that giving it away costs nothing.
  renderPassage(current, true);
  fillBlank(selected.text);

  ruleBox.textContent = current.rule;
  ruleBox.hidden = false;

  setStatus(isCorrect ? 'Correct answer' : 'Incorrect answer', isCorrect ? 'correct' : 'incorrect');
  const answer = current.options.find((o) => o.label === current.correctLabel);
  resultText.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = isCorrect ? 'Correct.' : 'Incorrect.';
  resultText.append(strong, isCorrect
    ? ' Read the rule below and move on.'
    : ` The answer is ${answer.label}: "${answer.text}". This one will come back as a review repeat.`);
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

  // Land on the question, not the top of the page. The bottom pager is a normal
  // place to click Next from, and scrolling past the title and filter bar every
  // time would just mean scrolling back down to read. scroll-margin-top on the
  // card keeps its top edge from sitting flush against the viewport.
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
    if (bank.length === 0) {
      setStatus('Data load error', 'error');
      resultText.textContent = 'No questions loaded. Ensure the bank files are served over HTTP.';
      return;
    }

    buildSkillSelect();
    updateSummary();
    // Restore the saved position instead of stepping past it, so reloading the
    // page shows the question he was on rather than skipping one.
    nextQuestion({ step: 0 });
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

  const option = (value, label, count) => {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = `${label} (${count})`;
    return el;
  };

  skillSelect.append(option('all', 'All skills', bank.length));

  DOMAIN_ORDER.forEach((domain) => {
    const skills = SKILLS_BY_DOMAIN[domain].filter((s) => counts[s]);
    if (skills.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = DOMAIN_LABELS[domain] || domain;
    skills.forEach((s) => group.append(option(s, SKILL_LABELS[s] || s, counts[s])));
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
      nextQuestion({ step: 0 });
    });
  }

  if (difficultySelect) {
    difficultySelect.value = difficultyFilter;
    difficultySelect.addEventListener('change', () => {
      difficultyFilter = difficultySelect.value;
      rememberFilters();
      current = null;
      nextQuestion({ step: 0 });
    });
  }

  if (wrongOnlyToggle) {
    wrongOnlyToggle.checked = wrongOnly;
    wrongOnlyToggle.addEventListener('change', () => {
      wrongOnly = wrongOnlyToggle.checked;
      current = null;
      nextQuestion({ step: 0 });
    });
  }
}

// Wrapped rather than passed directly: the listener would hand nextQuestion a
// click event, which has no business being read as its options argument.
document.querySelectorAll('.next-question').forEach((btn) => {
  btn.addEventListener('click', () => nextQuestion());
});

// Step back through the same sequence. Going back does not undo an answer --
// per-question history is cumulative, so revisiting one just shows it again.
document.querySelectorAll('.prev-question').forEach((btn) => {
  btn.addEventListener('click', () => nextQuestion({ step: -1 }));
});

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
    nextQuestion({ step: 0 });
  });
}

const resetBtn = document.getElementById('resetProgress');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!confirm('Erase all progress? Every answer, count and saved position will be lost.')) return;
    store = emptyStore();
    // Wiping progress should not also silently change which set is on screen.
    rememberFilters();
    current = null;
    updateSummary();
    nextQuestion({ step: 0 });
  });
}

window.Sparkle.init();
setupControls();
updateSummary();
loadBanks();

window.addEventListener('error', (ev) => {
  console.error('Unhandled error:', ev.error || ev.message);
  if (resultText) resultText.textContent = `Error: ${ev.error ? ev.error.message : ev.message}`;
  setStatus('Script error', 'error');
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled rejection:', ev.reason);
  if (resultText) resultText.textContent = `Error: ${ev.reason ? ev.reason.message || ev.reason : ev.reason}`;
  setStatus('Script error', 'error');
});
