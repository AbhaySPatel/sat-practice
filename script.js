let questions = [];

const progressLabel = document.querySelector('.progress-label');
const questionTitleEl = document.querySelector('.question-title');
const questionsAnsweredEl = document.getElementById('questionsAnswered');
const optionsContainer = document.querySelector('.options');
const resultText = document.getElementById('resultText');
const statusEl = document.querySelector('.status');

// Status colors come from theme variables, so set a state class rather than
// inline styles -- inline styles would survive a theme switch and go unreadable.
function setStatus(text, state) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-pending', 'is-correct', 'is-incorrect', 'is-error');
  statusEl.classList.add(`is-${state}`);
}
const correctCountEl = document.getElementById('correctCount');
const incorrectCountEl = document.getElementById('incorrectCount');
const hintButton = document.getElementById('hintButton');
const hintText = document.getElementById('hintText');

// sparkle canvas state
let sparkleCanvas = null;
let sparkleCtx = null;
let sparkleImgs = [];       // keeps the Image objects alive while they load
let readySparkleImgs = [];  // only the ones that decoded, so we mix and match safely
let sparkleAudio = null;
let particles = [];
let sparkleAnimating = false;
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playSparkleSound() {
  // Prefer the provided media audio file; fall back to a synthesized chime.
  if (sparkleAudio) {
    try {
      sparkleAudio.currentTime = 0;
      sparkleAudio.play().catch(() => {
        // if playback blocked, fallback to synth
        synthSparkle();
      });
      return;
    } catch (err) {
      // continue to fallback
    }
  }
  synthSparkle();
}

function synthSparkle() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(220, now);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(30, now);

    mod.connect(modGain);
    modGain.connect(osc.frequency);

    osc.connect(master);

    mod.start(now);
    osc.start(now);
    osc.stop(now + 0.6);
    mod.stop(now + 0.6);
  } catch (err) {
    console.warn('Audio play failed', err);
  }
}

let currentQuestionIndex = 0;
let correctCount = 0;
let incorrectCount = 0;
let questionAnswered = false;

function setProgress(index) {
  // show questions answered instead of a misleading linear progress bar
  const answered = correctCount + incorrectCount;
  if (questionsAnsweredEl) questionsAnsweredEl.textContent = `Questions answered: ${answered}`;
}

// A question is only usable once every option carries its teaching text.
// The ones left blank have broken answer keys in the source book, so they are
// held back from the quiz until someone repairs them in questions.json.
function isReady(q) {
  const options = q.options || [];
  return options.length > 0 && options.every(
    (opt) => opt.explanation && opt.insight && opt.example
  );
}

function enrichQuestions(rawQuestions) {
  return rawQuestions.filter(isReady).map((q) => ({
    chapter: q.chapter || null,
    prompt: q.prompt || '',
    kind: q.kind || '',
    questionText: q.questionText || '',
    hint: q.hint || '',
    options: (q.options || []).map((opt) => ({
      label: opt.label,
      text: opt.text,
      isCorrect: opt.label === q.correctLabel,
      explanation: opt.explanation || '',
      insight: opt.insight || '',
      example: opt.example || ''
    }))
  }));
}

function loadQuestionData() {
  fetch('questions.json')
    .then((response) => {
      if (!response.ok) throw new Error('Failed to load questions.json');
      return response.json();
    })
    .then((rawQuestions) => {
      const loadedQuestions = enrichQuestions(rawQuestions);
      const withheld = rawQuestions.length - loadedQuestions.length;
      if (withheld > 0) {
        console.info(`Loaded ${loadedQuestions.length} questions; withheld ${withheld} awaiting review.`);
      }
      if (loadedQuestions.length > 0) {
        questions = loadedQuestions;
        loadQuestion(Math.floor(Math.random() * questions.length));
      } else {
        resultText.textContent = 'No questions were loaded from questions.json. Please check the file format.';
      }
    })
    .catch((error) => {
      console.error('Unable to load questions.json.', error);
      setStatus('Data load error', 'error');
      resultText.textContent = 'Unable to load quiz data. Ensure questions.json is available via a web server or GitHub Pages.';
    });
}

function renderOptions(question) {
  optionsContainer.innerHTML = '';

  question.options.forEach((option, optionIndex) => {
    const optionEl = document.createElement('div');
    optionEl.className = 'option';
    optionEl.dataset.optionIndex = optionIndex;
    optionEl.dataset.isCorrect = option.isCorrect;

    optionEl.innerHTML = `
      <div class="row">
        <span class="label">${option.label}</span>
        <span class="text">${option.text}</span>
        <span class="option-result"></span>
      </div>
      <p class="explanation">${option.explanation}</p>
      <p class="insight">${option.insight}</p>
      <p class="example">${option.example}</p>
    `;

    optionEl.addEventListener('click', () => {
      revealAnswer(optionIndex);
    });

    optionsContainer.appendChild(optionEl);
  });
}

function resetHint() {
  if (!hintButton || !hintText) return;
  hintText.textContent = '';
  hintText.hidden = true;
  // No authored hint means no button at all, rather than an empty panel.
  const question = questions[currentQuestionIndex];
  hintButton.hidden = !(question && question.hint);
}

function loadQuestion(index) {
  const question = questions[index];
  currentQuestionIndex = index;

  questionTitleEl.innerHTML = question.prompt;
  setStatus('Awaiting answer', 'pending');
  resultText.textContent = 'Click an option to reveal the answer and all explanations.';

  questionAnswered = false;
  resetHint();
  renderOptions(question);
  setProgress(index);
}

function updateSessionSummary() {
  correctCountEl.textContent = `Correct: ${correctCount}`;
  incorrectCountEl.textContent = `Incorrect: ${incorrectCount}`;
}

function revealAnswer(selectedOptionIndex) {
  const question = questions[currentQuestionIndex];
  const selectedOption = question.options[selectedOptionIndex];
  const optionEls = [...optionsContainer.querySelectorAll('.option')];

  optionEls.forEach((optionEl, index) => {
    const optionData = question.options[index];
    optionEl.classList.remove('selected', 'correct', 'incorrect', 'showExplanation');
    optionEl.querySelector('.option-result').textContent = '';
  });

  optionEls.forEach((optionEl, index) => {
    const optionData = question.options[index];
    optionEl.classList.add(optionData.isCorrect ? 'correct' : 'incorrect');
    optionEl.classList.add('showExplanation');
    if (index === selectedOptionIndex) {
      optionEl.classList.add('selected');
      optionEl.querySelector('.option-result').textContent = optionData.isCorrect ? '✔' : '✖';
    }
    if (optionData.isCorrect && index !== selectedOptionIndex) {
      optionEl.querySelector('.option-result').textContent = '✔';
    }
  });

  const isCorrect = selectedOption.isCorrect;
  if (!questionAnswered) {
    if (isCorrect) {
      correctCount += 1;
    } else {
      incorrectCount += 1;
    }
    updateSessionSummary();
    questionAnswered = true;
  }

  // trigger sparkle effect when correct
  if (isCorrect) {
    const optionsRect = optionsContainer.getBoundingClientRect();
    const cardRect = document.querySelector('.card').getBoundingClientRect();
    const x = optionsRect.left - cardRect.left;
    const y = optionsRect.top - cardRect.top;
    // play sparkle sound and visual burst
    playSparkleSound();
    createSparkles(x, y, optionsRect.width, optionsRect.height);
  }

  setStatus(isCorrect ? 'Correct answer' : 'Incorrect answer', isCorrect ? 'correct' : 'incorrect');
  resultText.innerHTML = isCorrect
    ? '<strong>Correct.</strong> You chose the right meaning.'
    : `<strong>Incorrect.</strong> The correct answer is <em>${question.options.find((opt) => opt.isCorrect).label}: ${question.options.find((opt) => opt.isCorrect).text}</em>.`;
}

function showRandomQuestion() {
  const nextIndex = Math.floor(Math.random() * questions.length);
  loadQuestion(nextIndex);
  // scroll the main page container to the top so the question is visible
  const pageEl = document.querySelector('.page');
  if (pageEl && pageEl.scrollIntoView) {
    pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// --- Sparkle implementation ---
function initSparkleCanvas() {
  const card = document.querySelector('.card');
  if (!card) return;
  sparkleCanvas = document.createElement('canvas');
  sparkleCanvas.className = 'sparkle-canvas';
  card.appendChild(sparkleCanvas);
  sparkleCtx = sparkleCanvas.getContext('2d');
  resizeSparkleCanvas();

  // load user-provided sparkle images from media folder
  const imgPaths = ['media/sparkling.png', 'media/sparkling2.png'];
  imgPaths.forEach((p) => {
    const im = new Image();
    im.onload = () => { readySparkleImgs.push(im); };
    im.onerror = () => { console.warn('Sparkle image missing:', p); };
    im.src = p;
    sparkleImgs.push(im);
  });

  // preload audio from media folder if available
  try {
    sparkleAudio = new Audio('media/flitterbug.mp3');
    sparkleAudio.preload = 'auto';
  } catch (e) {
    sparkleAudio = null;
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resizeSparkleCanvas).observe(card);
  } else {
    window.addEventListener('resize', resizeSparkleCanvas);
  }
}

// The canvas is stretched over the card by CSS (inset: 0), so we only sync the
// backing store to its laid-out size. The card grows and shrinks as questions
// and explanations render, so this runs on every card resize, not just window resize.
function resizeSparkleCanvas() {
  if (!sparkleCanvas || !sparkleCtx) return;
  const width = sparkleCanvas.clientWidth;
  const height = sparkleCanvas.clientHeight;
  sparkleCanvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
  sparkleCanvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
  sparkleCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function canvasSize() {
  return {
    width: sparkleCanvas.width / devicePixelRatio,
    height: sparkleCanvas.height / devicePixelRatio
  };
}

// Rendered sparkle diameter is size * SPARKLE_SCALE px.
const SPARKLE_SCALE = 5.5;

// Particles hold full opacity for the first SPARKLE_HOLD of their life, then
// ease out over the remainder, so they linger instead of fading from frame one.
const SPARKLE_HOLD = 0.55;
const SPARKLE_GRAVITY = 0.026;

function createSparkles(x, y, width = 0, height = 0) {
  if (!sparkleCanvas || !sparkleCtx) return;
  const count = 32;
  const minX = x;
  const maxX = width > 0 ? x + width : x + 1;
  const minY = y;
  const maxY = height > 0 ? y + height : y + 1;

  for (let i = 0; i < count; i++) {
    const particleX = minX + Math.random() * (maxX - minX);
    const particleY = minY + Math.random() * (maxY - minY);
    const angle = Math.random() * Math.PI * 2;
    // slower drift than the old burst: particles now live ~2x longer, so the
    // original speeds carried them off the card before they finished fading
    const speed = 4 + Math.random() * 11;
    const sizeType = Math.random() < 0.6 ? 'small' : 'medium';
    const size = sizeType === 'small' ? 2 + Math.random() * 2 : 4 + Math.random() * 4;
    const ttl = 160 + Math.random() * 100;
    particles.push({
      x: particleX,
      y: particleY,
      vx: Math.cos(angle) * speed / 60,
      vy: Math.sin(angle) * speed / 60 - (2 + Math.random() * 7) / 60,
      life: ttl,
      ttl: ttl,
      size: size,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.045,
      // resolved against the loaded images at draw time so both PNGs get mixed in
      imgSeed: Math.random()
    });
  }
  if (!sparkleAnimating) {
    sparkleAnimating = true;
    requestAnimationFrame(animateSparkles);
  }
}

// Full opacity through the hold window, then a smooth ease down to zero.
function sparkleAlpha(p) {
  const remaining = Math.max(0, p.life / p.ttl);
  if (remaining >= 1 - SPARKLE_HOLD) return 1;
  const t = remaining / (1 - SPARKLE_HOLD); // 1 -> 0 across the fade tail
  return t * t;
}

function drawSparkle(p) {
  if (readySparkleImgs.length === 0) return; // images not loaded yet: draw nothing

  const img = readySparkleImgs[Math.floor(p.imgSeed * readySparkleImgs.length)];
  const drawSize = Math.max(1, p.size) * SPARKLE_SCALE;

  sparkleCtx.save();
  sparkleCtx.translate(p.x, p.y);
  sparkleCtx.rotate(p.rotation || 0);
  sparkleCtx.globalAlpha = sparkleAlpha(p);
  sparkleCtx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  sparkleCtx.restore();
}

function animateSparkles() {
  if (!sparkleCtx) return;
  const { width, height } = canvasSize();
  sparkleCtx.clearRect(0, 0, width, height);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += SPARKLE_GRAVITY;
    p.rotation += p.spin;
    p.life -= 1;
    drawSparkle(p);
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (particles.length > 0) {
    requestAnimationFrame(animateSparkles);
  } else {
    sparkleAnimating = false;
    sparkleCtx.clearRect(0, 0, width, height);
  }
}

// initialize sparkle canvas once
initSparkleCanvas();

document.querySelectorAll('.next-question').forEach((btn) => {
  btn.addEventListener('click', () => {
    showRandomQuestion();
  });
});

if (hintButton) {
  hintButton.addEventListener('click', () => {
    const question = questions[currentQuestionIndex];
    if (!question || !question.hint) return;
    hintText.textContent = question.hint;
    hintText.hidden = false;
    hintButton.hidden = true;
  });
}

// --- Theme ---
// No stored choice means we stay on the OS preference, which the stylesheet
// handles on its own. Choosing a theme pins it and overrides the OS from then on.
const themeToggle = document.getElementById('themeToggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch (err) {
    return null;
  }
}

function activeTheme() {
  return storedTheme() || (prefersDark.matches ? 'dark' : 'light');
}

function paintToggle() {
  if (!themeToggle) return;
  const dark = activeTheme() === 'dark';
  // The button advertises what clicking it will switch you to.
  themeToggle.querySelector('.theme-toggle-icon').textContent = dark ? '☀️' : '🌙';
  themeToggle.querySelector('.theme-toggle-label').textContent = dark ? 'Light' : 'Dark';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const next = activeTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch (err) {
      // storage unavailable; the choice just will not survive a reload
    }
    paintToggle();
  });
}

// Follow the OS only while the user has not pinned a theme themselves.
prefersDark.addEventListener('change', paintToggle);

paintToggle();

updateSessionSummary();
loadQuestionData();

// Global error handlers: surface JS errors to the UI for easier debugging
window.addEventListener('error', (ev) => {
  console.error('Unhandled error:', ev.error || ev.message);
  if (resultText) resultText.textContent = `Error: ${ev.error ? ev.error.message : ev.message}`;
  if (statusEl) {
    setStatus('Script error', 'error');
  }
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled rejection:', ev.reason);
  if (resultText) resultText.textContent = `Error: ${ev.reason ? ev.reason.message || ev.reason : ev.reason}`;
  if (statusEl) {
    setStatus('Script error', 'error');
  }
});
