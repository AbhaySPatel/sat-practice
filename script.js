const fallbackQuestions = [
  {
    chapter: 1,
    prompt: 'Which of these words is closest in meaning to the word "rampart"?',
    kind: '',
    questionText: '',
    options: [
      {
        label: 'A',
        text: 'lunchroom',
        isCorrect: false,
        explanation: 'A lunchroom is a place to eat, which is unrelated to the meaning of rampart.',
        insight: 'Similar words: cafeteria, dining hall, canteen.',
        example: 'Example: The students went to the lunchroom after class.'
      },
      {
        label: 'B',
        text: 'distribution',
        isCorrect: false,
        explanation: 'Distribution refers to handing out or spreading things, not a defensive structure.',
        insight: 'Similar words: allocation, spreading, delivery.',
        example: 'Example: The distribution of supplies was carefully planned.'
      },
      {
        label: 'C',
        text: 'trouble',
        isCorrect: false,
        explanation: 'Trouble means difficulty or problems, which does not match rampart.',
        insight: 'Similar words: difficulty, distress, problem.',
        example: 'Example: She got into trouble for skipping her homework.'
      },
      {
        label: 'D',
        text: 'destroy',
        isCorrect: false,
        explanation: 'Destroy means to ruin or demolish, not to describe a defensive wall.',
        insight: 'Similar words: demolish, wreck, ruin.',
        example: 'Example: They aimed to destroy the old building.'
      },
      {
        label: 'E',
        text: 'bulwark',
        isCorrect: true,
        explanation: 'A bulwark is a defensive wall or barrier, which is the right meaning of rampart.',
        insight: 'Similar words: fortress wall, rampart, barrier.',
        example: 'Example: The castle stood behind a strong bulwark of stone.'
      }
    ]
  },
  {
    chapter: 8,
    prompt: 'Choose the best definition for "vivid".',
    kind: 'Choose the best answer',
    questionText: 'Pick the answer that most closely matches the meaning of the highlighted word.',
    options: [
      {
        label: 'A',
        text: 'Clear and powerful in appearance or description',
        isCorrect: true,
        explanation: 'This is the right meaning: vivid means bright, strong, or easy to imagine.',
        insight: 'Similar words: striking, graphic, lively.',
        example: 'Example: Her memory of the accident remained vivid for years.'
      },
      {
        label: 'B',
        text: 'Slow and careful in movement',
        isCorrect: false,
        explanation: 'This answer describes caution, not brightness or intensity.',
        insight: 'Similar words: deliberate, measured, steady.',
        example: 'Example: The dancer moved in a slow and careful way.'
      },
      {
        label: 'C',
        text: 'Hidden or secret',
        isCorrect: false,
        explanation: 'This option refers to secrecy, which is not the same as vividness.',
        insight: 'Similar words: covert, concealed, private.',
        example: 'Example: The secret plan remained hidden from everyone.'
      },
      {
        label: 'D',
        text: 'Old-fashioned or outdated',
        isCorrect: false,
        explanation: 'This describes something antiquated, not lively or bright.',
        insight: 'Similar words: archaic, obsolete, dated.',
        example: 'Example: The old typewriter looked outdated in the modern office.'
      }
    ]
  },
  {
    chapter: 3,
    prompt: 'Find the best synonym for "reluctant".',
    kind: 'Choose the best answer',
    questionText: 'Choose the answer that reflects the correct meaning of the highlighted word.',
    options: [
      {
        label: 'A',
        text: 'Unwilling or hesitant to do something',
        isCorrect: true,
        explanation: 'Reluctant means unwilling or hesitant, so this is the correct answer.',
        insight: 'Similar words: hesitant, resistant, unwilling.',
        example: 'Example: She was reluctant to speak in front of the class.'
      },
      {
        label: 'B',
        text: 'Very eager and excited',
        isCorrect: false,
        explanation: 'This describes the opposite feeling, not reluctance.',
        insight: 'Similar words: enthusiastic, eager, eager.',
        example: 'Example: He was very eager to start the new project.'
      },
      {
        label: 'C',
        text: 'Calm and relaxed',
        isCorrect: false,
        explanation: 'This answer describes a peaceful state, not hesitation or resistance.',
        insight: 'Similar words: serene, composed, peaceful.',
        example: 'Example: The lake was calm and relaxed at dawn.'
      },
      {
        label: 'D',
        text: 'Extremely happy or cheerful',
        isCorrect: false,
        explanation: 'This describes joy, which is unrelated to being unwilling.',
        insight: 'Similar words: joyful, delighted, ecstatic.',
        example: 'Example: The children were extremely happy on the last day of school.'
      }
    ]
  }
];

let questions = fallbackQuestions;

const progressLabel = document.querySelector('.progress-label');
const questionTitleEl = document.querySelector('.question-title');
const questionsAnsweredEl = document.getElementById('questionsAnswered');
const optionsContainer = document.querySelector('.options');
const resultText = document.getElementById('resultText');
const statusEl = document.querySelector('.status');
const nextButton = document.getElementById('nextButton');
const correctCountEl = document.getElementById('correctCount');
const incorrectCountEl = document.getElementById('incorrectCount');

// sparkle canvas state
let sparkleCanvas = null;
let sparkleCtx = null;
let particles = [];
let sparkleAnimating = false;

let currentQuestionIndex = 0;
let correctCount = 0;
let incorrectCount = 0;
let questionAnswered = false;

function setProgress(index) {
  // show questions answered instead of a misleading linear progress bar
  const answered = correctCount + incorrectCount;
  if (questionsAnsweredEl) questionsAnsweredEl.textContent = `Questions answered: ${answered}`;
}

function enrichQuestions(rawQuestions) {
  return rawQuestions.map((q) => ({
    chapter: q.chapter || null,
    prompt: q.prompt || '',
    kind: q.kind || '',
    questionText: q.questionText || '',
    options: (q.options || []).map((opt) => ({
      label: opt.label,
      text: opt.text,
      isCorrect: opt.label === q.correctLabel,
      explanation: '',
      insight: '',
      example: ''
    }))
  }));
}

function loadQuestionData() {
  const fallbackRawQuestions = window.questionsData || [];

  fetch('questions.json')
    .then((response) => {
      if (!response.ok) throw new Error('Failed to load questions.json');
      return response.json();
    })
    .then((rawQuestions) => {
      const loadedQuestions = enrichQuestions(rawQuestions);
      if (loadedQuestions.length > 0) {
        questions = loadedQuestions;
        loadQuestion(Math.floor(Math.random() * questions.length));
      }
    })
    .catch((error) => {
      console.warn('Could not load questions.json; falling back to local questions-data.js.', error);
      const loadedQuestions = enrichQuestions(fallbackRawQuestions);
      if (loadedQuestions.length > 0) {
        questions = loadedQuestions;
        loadQuestion(Math.floor(Math.random() * questions.length));
      }
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

function loadQuestion(index) {
  const question = questions[index];
  currentQuestionIndex = index;

  questionTitleEl.innerHTML = question.prompt;
  statusEl.textContent = 'Awaiting answer';
  statusEl.style.background = '#fef3c7';
  statusEl.style.color = '#92400e';
  resultText.textContent = 'Click an option to reveal the answer and all explanations.';

  questionAnswered = false;
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
    const optionEls = [...optionsContainer.querySelectorAll('.option')];
    const targetEl = optionEls[selectedOptionIndex];
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const cardRect = document.querySelector('.card').getBoundingClientRect();
      // position relative to card
      const x = rect.left + rect.width / 2 - cardRect.left;
      const y = rect.top + rect.height / 2 - cardRect.top;
      createSparkles(x, y);
      showEmojiBurst(x, y);
    }
  }

  statusEl.textContent = isCorrect ? 'Correct answer' : 'Incorrect answer';
  statusEl.style.background = isCorrect ? '#d1fae5' : '#fee2e2';
  statusEl.style.color = isCorrect ? '#166534' : '#991b1b';
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
  window.addEventListener('resize', resizeSparkleCanvas);
}

function resizeSparkleCanvas() {
  if (!sparkleCanvas) return;
  const rect = document.querySelector('.card').getBoundingClientRect();
  sparkleCanvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  sparkleCanvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
  sparkleCanvas.style.width = rect.width + 'px';
  sparkleCanvas.style.height = rect.height + 'px';
  if (sparkleCtx) sparkleCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function createSparkles(x, y) {
  if (!sparkleCanvas || !sparkleCtx) return;
  const colors = ['#f9a8d4', '#f97316', '#f59e0b', '#60a5fa', '#a78bfa', '#34d399'];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 140;
    particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed / 60,
      vy: Math.sin(angle) * speed / 60 - (20 + Math.random() * 30) / 60,
      life: 60 + Math.random() * 30,
      ttl: 60 + Math.random() * 30,
      size: 2 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
  if (!sparkleAnimating) {
    sparkleAnimating = true;
    requestAnimationFrame(animateSparkles);
  }
}

function animateSparkles() {
  if (!sparkleCtx) return;
  sparkleCtx.clearRect(0, 0, sparkleCanvas.width / devicePixelRatio, sparkleCanvas.height / devicePixelRatio);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12; // gravity
    p.life -= 1;
    const alpha = Math.max(0, p.life / p.ttl);
    sparkleCtx.globalAlpha = alpha;
    sparkleCtx.fillStyle = p.color;
    sparkleCtx.beginPath();
    sparkleCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    sparkleCtx.fill();
    if (p.life <= 0) particles.splice(i, 1);
  }
  sparkleCtx.globalAlpha = 1;
  if (particles.length > 0) {
    requestAnimationFrame(animateSparkles);
  } else {
    sparkleAnimating = false;
    // clear once more to remove any faint traces
    sparkleCtx.clearRect(0, 0, sparkleCanvas.width / devicePixelRatio, sparkleCanvas.height / devicePixelRatio);
  }
}

// initialize sparkle canvas once
initSparkleCanvas();

// simple emoji burst fallback for visibility
function showEmojiBurst(x, y) {
  const card = document.querySelector('.card');
  if (!card) return;
  const burst = document.createElement('div');
  burst.className = 'emoji-burst';
  burst.style.left = '0px';
  burst.style.top = '0px';
  card.appendChild(burst);
  const emojis = ['✨','🎉','🥳','👏','💥','🎊'];
  emojis.forEach((e, i) => {
    const el = document.createElement('span');
    el.textContent = e;
    // small random spread
    const angle = (i / emojis.length) * Math.PI * 2 + (Math.random() - 0.5);
    const rx = Math.cos(angle) * (8 + Math.random() * 30);
    const ry = Math.sin(angle) * (8 + Math.random() * 20) - 10;
    el.style.left = (x + rx) + 'px';
    el.style.top = (y + ry) + 'px';
    el.style.opacity = '1';
    el.style.fontSize = (16 + Math.random() * 10) + 'px';
    burst.appendChild(el);
  });
  // remove after animation
  setTimeout(() => { burst.remove(); }, 1000);
}

nextButton.addEventListener('click', () => {
  showRandomQuestion();
});

updateSessionSummary();
loadQuestion(0);
loadQuestionData();
