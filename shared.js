// Cross-cutting behaviour the question engine does not own: the theme toggle
// and the sparkle reward animation. Loaded before app.js.

// --- Theme ---
// No stored choice means we stay on the OS preference, which the stylesheet
// handles on its own. Choosing a theme pins it and overrides the OS from then on.
(function setupTheme() {
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
})();

// --- Sparkle reward ---
// Exposed as window.Sparkle so each section can fire a burst over its own
// options area when the answer is right.
window.Sparkle = (function setupSparkle() {
  let canvas = null;
  let ctx = null;
  let imgs = [];        // keeps the Image objects alive while they load
  let readyImgs = [];   // only the ones that decoded, so we mix and match safely
  let audio = null;
  let particles = [];
  let animating = false;
  let audioCtx = null;

  // Rendered sparkle diameter is size * SPARKLE_SCALE px.
  const SPARKLE_SCALE = 5.5;
  // Particles hold full opacity for the first SPARKLE_HOLD of their life, then
  // ease out over the remainder, so they linger instead of fading from frame one.
  const SPARKLE_HOLD = 0.55;
  const SPARKLE_GRAVITY = 0.026;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function playSound() {
    // Prefer the provided media audio file; fall back to a synthesized chime.
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.play().catch(() => {
          synth();
        });
        return;
      } catch (err) {
        // continue to fallback
      }
    }
    synth();
  }

  function synth() {
    try {
      const ac = getAudioContext();
      const now = ac.currentTime;
      const master = ac.createGain();
      master.gain.setValueAtTime(0.001, now);
      master.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      master.connect(ac.destination);

      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);

      const mod = ac.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(220, now);

      const modGain = ac.createGain();
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

  // The canvas is stretched over the card by CSS (inset: 0), so we only sync the
  // backing store to its laid-out size. The card grows and shrinks as questions
  // and explanations render, so this runs on every card resize, not just window resize.
  function resizeCanvas() {
    if (!canvas || !ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(height * devicePixelRatio));
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function canvasSize() {
    return {
      width: canvas.width / devicePixelRatio,
      height: canvas.height / devicePixelRatio
    };
  }

  // Full opacity through the hold window, then a smooth ease down to zero.
  function alphaFor(p) {
    const remaining = Math.max(0, p.life / p.ttl);
    if (remaining >= 1 - SPARKLE_HOLD) return 1;
    const t = remaining / (1 - SPARKLE_HOLD); // 1 -> 0 across the fade tail
    return t * t;
  }

  function draw(p) {
    if (readyImgs.length === 0) return; // images not loaded yet: draw nothing

    const img = readyImgs[Math.floor(p.imgSeed * readyImgs.length)];
    const drawSize = Math.max(1, p.size) * SPARKLE_SCALE;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation || 0);
    ctx.globalAlpha = alphaFor(p);
    ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    ctx.restore();
  }

  function animate() {
    if (!ctx) return;
    const { width, height } = canvasSize();
    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += SPARKLE_GRAVITY;
      p.rotation += p.spin;
      p.life -= 1;
      draw(p);
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 0) {
      requestAnimationFrame(animate);
    } else {
      animating = false;
      ctx.clearRect(0, 0, width, height);
    }
  }

  function createSparkles(x, y, width = 0, height = 0) {
    if (!canvas || !ctx) return;
    const count = 32;
    const minX = x;
    const maxX = width > 0 ? x + width : x + 1;
    const minY = y;
    const maxY = height > 0 ? y + height : y + 1;

    for (let i = 0; i < count; i++) {
      const particleX = minX + Math.random() * (maxX - minX);
      const particleY = minY + Math.random() * (maxY - minY);
      const angle = Math.random() * Math.PI * 2;
      // slower drift than a plain burst: particles live ~2x longer, so faster
      // speeds would carry them off the card before they finished fading
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
    if (!animating) {
      animating = true;
      requestAnimationFrame(animate);
    }
  }

  function init() {
    const card = document.querySelector('.card');
    if (!card) return;
    canvas = document.createElement('canvas');
    canvas.className = 'sparkle-canvas';
    card.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resizeCanvas();

    // load sparkle images from the media folder
    ['media/sparkling.png', 'media/sparkling2.png'].forEach((p) => {
      const im = new Image();
      im.onload = () => { readyImgs.push(im); };
      im.onerror = () => { console.warn('Sparkle image missing:', p); };
      im.src = p;
      imgs.push(im);
    });

    try {
      audio = new Audio('media/flitterbug.mp3');
      audio.preload = 'auto';
    } catch (e) {
      audio = null;
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resizeCanvas).observe(card);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
  }

  // Fire a burst positioned over an element, with the chime.
  function burstOver(element) {
    if (!canvas || !ctx || !element) return;
    const card = document.querySelector('.card');
    if (!card) return;
    const rect = element.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    playSound();
    createSparkles(rect.left - cardRect.left, rect.top - cardRect.top, rect.width, rect.height);
  }

  return { init, burstOver };
})();
