/* ============================================================
   LAB ZERO — 2D tactical shooter
   A self-contained canvas game. No external assets required.
   ============================================================ */
(() => {
  'use strict';

  /* ------------------------------------------------------------
     Utilities
     ------------------------------------------------------------ */
  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const rad = (deg) => (deg * Math.PI) / 180;
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const formatInt = (n) => Math.round(n).toLocaleString('en-US');
  const chance = (p) => Math.random() < p;

  function mulberry32(a) {
    return function seeded() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rrPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  function linePath(ctx, points, close = false) {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    if (close) ctx.closePath();
  }

  function setText(el, value) {
    if (el && el.textContent !== String(value)) el.textContent = value;
  }

  function compactInPlace(items, keep) {
    let write = 0;
    for (let read = 0; read < items.length; read += 1) {
      const item = items[read];
      if (!keep(item)) continue;
      items[write] = item;
      write += 1;
    }
    if (write !== items.length) items.length = write;
    return items;
  }

  function effectBudget(base) {
    const quality = game?.quality || 'high';
    return quality === 'low' ? Math.round(base * 0.55) : quality === 'medium' ? Math.round(base * 0.8) : base;
  }

  function trimRuntimeCollections() {
    const caps = {
      portals: 36,
      coins: 240,
      pickups: 48,
      fireZones: 64,
      bullets: 420,
      enemyBullets: 220,
      enemyRockets: 80,
      playerMissiles: 40,
    };
    for (const [key, cap] of Object.entries(caps)) {
      const list = game[key];
      if (list && list.length > cap) list.splice(0, list.length - cap);
    }
  }

  function loadNumber(key, fallback = 0) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return fallback;
      const v = Number(raw);
      return Number.isFinite(v) ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function storeNumber(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      /* localStorage can be unavailable for local files. */
    }
  }

  function storeString(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
      /* no-op */
    }
  }

  function loadString(key, fallback = '') {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  /* ------------------------------------------------------------
     Difficulty-specific records
     ------------------------------------------------------------ */
  const RECORD_DIFFICULTIES = ['easy', 'normal', 'hard', 'inferno'];
  const LAST_RECORD_DIFFICULTY = RECORD_DIFFICULTIES.includes(loadString('labzero.difficulty', 'normal'))
    ? loadString('labzero.difficulty', 'normal')
    : 'normal';

  function blankDifficultyRecords(createValue) {
    const map = {};
    for (const id of RECORD_DIFFICULTIES) map[id] = createValue();
    return map;
  }

  function loadDifficultyRecords(key, createValue, normalize, legacyValue) {
    const map = blankDifficultyRecords(createValue);
    let parsed = null;
    try {
      const raw = loadString(key, '');
      parsed = raw ? JSON.parse(raw) : null;
    } catch (_) {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      for (const id of RECORD_DIFFICULTIES) normalize(map, parsed[id], id);
      return map;
    }
    if (legacyValue) {
      const legacy = legacyValue();
      if (legacy) map[LAST_RECORD_DIFFICULTY] = { ...map[LAST_RECORD_DIFFICULTY], ...legacy };
    }
    return map;
  }

  const CAMPAIGN_BY_DIFFICULTY = loadDifficultyRecords(
    'labzero.campaignByDifficulty',
    () => ({ clears: 0, bestTime: 0 }),
    (map, item, id) => {
      if (!item || typeof item !== 'object') return;
      map[id] = {
        clears: Math.max(0, Math.floor(Number(item.clears) || 0)),
        bestTime: Math.max(0, Number(item.bestTime) || 0),
      };
    },
    () => {
      const clears = loadNumber('labzero.campaignClears', 0);
      const bestTime = loadNumber('labzero.campaignBestTime', 0);
      return clears > 0 || bestTime > 0 ? { clears, bestTime } : null;
    },
  );

  const ROGUE_BY_DIFFICULTY = loadDifficultyRecords(
    'labzero.rogueByDifficulty',
    () => ({ bestFloor: 0 }),
    (map, item, id) => {
      if (!item || typeof item !== 'object') return;
      map[id] = { bestFloor: Math.max(0, Math.floor(Number(item.bestFloor) || 0)) };
    },
    () => {
      const bestFloor = loadNumber('labzero.rogueBestFloor', 0);
      return bestFloor > 0 ? { bestFloor } : null;
    },
  );

  function campaignRecordTotals(byDifficulty) {
    let clears = 0;
    let bestTime = 0;
    for (const id of RECORD_DIFFICULTIES) {
      const item = byDifficulty[id] || { clears: 0, bestTime: 0 };
      clears += item.clears || 0;
      if (item.bestTime > 0) bestTime = bestTime > 0 ? Math.min(bestTime, item.bestTime) : item.bestTime;
    }
    return { clears, bestTime };
  }

  function rogueRecordBest(byDifficulty) {
    return Math.max(0, ...RECORD_DIFFICULTIES.map((id) => byDifficulty[id]?.bestFloor || 0));
  }

  /* ------------------------------------------------------------
     Synthesized audio
     ------------------------------------------------------------ */
  const Sfx = (() => {
    let ac = null;
    let master = null;
    let noiseBuffer = null;
    let muted = loadString('labzero.muted', '0') === '1';
    let lastShot = 0;
    let sfxGain = null;
    let musicGain = null;
    let musicAnalyser = null;
    let sfxVolume = clamp(loadNumber('labzero.sfxVolume', 1), 0, 1);
    let musicVolume = clamp(loadNumber('labzero.musicVolume', 1), 0, 1);
    let musicMode = 'off';
    let pendingMusicMode = 'off';
    let musicTimer = null;
    let musicStep = 0;
    let musicNextTime = 0;
    let visibilityBound = false;

    function musicTone(when, { freq = 110, duration = 0.18, volume = 0.04, type = 'sine', slide = null, attack = 0.005 }) {
      if (!audible() || !ac || !musicGain) return;
      const t = Math.max(when, ac.currentTime);
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + duration);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + Math.min(attack, duration * 0.5));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start(t);
      osc.stop(t + duration + 0.04);
    }

    function musicNoise(when, { duration = 0.04, volume = 0.02, freq = 4200, q = 0.8, type = 'highpass' }) {
      if (!audible() || !ac || !musicGain) return;
      const t = Math.max(when, ac.currentTime);
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(Math.max(0.0001, volume), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(musicGain);
      src.start(t);
      src.stop(t + duration + 0.03);
    }

    function musicStepSeconds(mode) {
      const bpm = mode === 'boss' ? 150 : mode === 'calm' ? 92 : mode === 'menu' ? 82 : 124;
      return 60 / bpm / 4;
    }

    function scheduleMusicStep(stepIndex, when, mode) {
      const s = stepIndex % 16;
      const bar = Math.floor(stepIndex / 16) % 4;
      const boss = mode === 'boss';
      const calm = mode === 'calm';
      const menu = mode === 'menu';
      const roots = menu ? [55, 65.41, 49, 58.27] : boss ? [49, 49, 58.27, 43.65] : [55, 49, 65.41, 49];
      const root = roots[bar];
      const kickSteps = menu ? [0, 8] : calm ? [0, 8] : boss ? [0, 2, 5, 8, 10, 13] : [0, 4, 8, 11];
      if (kickSteps.includes(s)) {
        musicTone(when, { freq: boss ? 54 : 58, slide: 31, duration: menu ? 0.4 : 0.22, volume: boss ? 0.16 : menu ? 0.055 : 0.12, type: 'sine' });
        musicNoise(when, { duration: 0.035, volume: boss ? 0.035 : menu ? 0.012 : 0.025, freq: 180, type: 'lowpass' });
      }
      if (!calm && !menu && (s === 4 || s === 12)) {
        musicNoise(when, { duration: 0.075, volume: boss ? 0.065 : 0.05, freq: 1750, q: 1.2, type: 'bandpass' });
        musicTone(when, { freq: 185, slide: 82, duration: 0.07, volume: 0.018, type: 'triangle' });
      }
      if (!calm && !menu) {
        if (s % 2 === 0) {
          musicNoise(when, { duration: 0.025, volume: boss ? 0.024 : 0.016, freq: 6800, type: 'highpass' });
        }
        if (boss && (s === 3 || s === 7 || s === 11 || s === 15)) {
          musicNoise(when, { duration: 0.02, volume: 0.012, freq: 8400, type: 'highpass' });
        }
      }
      const bassSteps = menu ? [0, 8] : calm ? [0, 8] : boss ? [0, 3, 6, 8, 11, 14] : [0, 3, 6, 8, 11, 14];
      if (bassSteps.includes(s)) {
        const bassFreq = root * (boss && bar % 2 === 1 ? 1.5 : 1) * 2;
        musicTone(when, { freq: bassFreq, slide: bassFreq * 0.97, duration: menu ? 1.2 : calm ? 0.8 : 0.2, volume: menu ? 0.025 : calm ? 0.022 : 0.038, type: 'sawtooth', attack: menu ? 0.08 : 0.008 });
        musicTone(when, { freq: bassFreq * 0.5, duration: menu ? 1.25 : calm ? 0.85 : 0.22, volume: menu ? 0.016 : calm ? 0.018 : 0.026, type: 'sine' });
      }
      if (menu && (s === 4 || s === 12)) {
        musicTone(when, { freq: root * 6, duration: 0.9, volume: 0.013, type: 'sine', attack: 0.08 });
        musicTone(when, { freq: root * 9, duration: 1.2, volume: 0.007, type: 'triangle', attack: 0.12 });
      } else if (!calm && s % 2 === 0) {
        const arp = boss ? [1, 1.189, 1.498, 1.189] : [1, 1.498, 2, 1.498];
        const note = arp[((stepIndex / 2) | 0) % arp.length];
        musicTone(when, { freq: root * 4 * note, duration: 0.08, volume: boss ? 0.018 : 0.014, type: 'triangle' });
      }
      if (s === 0) {
        musicTone(when, { freq: root * 2, duration: menu ? 3.7 : calm ? 3.6 : 1.65, volume: menu ? 0.022 : calm ? 0.02 : 0.014, type: 'sawtooth', attack: menu ? 0.45 : 0.3 });
        musicTone(when, { freq: root * 3, duration: menu ? 3.7 : calm ? 3.6 : 1.65, volume: menu ? 0.014 : calm ? 0.012 : 0.009, type: 'triangle', attack: menu ? 0.5 : 0.35 });
        if (menu) {
          musicTone(when, { freq: root * 4, duration: 2.8, volume: 0.009, type: 'sine', attack: 0.4 });
        }
        if (boss) {
          musicTone(when, { freq: 740, slide: 520, duration: 0.48, volume: 0.016, type: 'square', attack: 0.02 });
          musicNoise(when, { duration: 0.24, volume: 0.025, freq: 520, type: 'lowpass' });
        }
      }
      if (!calm && !menu && bar === 3 && (s === 14 || s === 15)) {
        musicNoise(when, { duration: 0.06, volume: 0.045, freq: 1900, q: 1.1, type: 'bandpass' });
      }
    }

    function musicPump() {
      if (!ac || !musicGain || musicMode === 'off' || !audible() || ac.state !== 'running') return;
      const horizon = ac.currentTime + 0.16;
      if (musicNextTime < ac.currentTime - 0.05) musicNextTime = ac.currentTime + 0.02;
      while (musicNextTime < horizon) {
        scheduleMusicStep(musicStep, musicNextTime, musicMode);
        musicStep += 1;
        musicNextTime += musicStepSeconds(musicMode);
      }
    }

    function setMusicMode(mode) {
      pendingMusicMode = mode || 'off';
      if (!ac) return;
      if (mode === musicMode) return;
      musicMode = mode || 'off';
      if (!musicGain) return;
      const now = ac.currentTime;
      musicGain.gain.cancelScheduledValues(now);
      const baseTarget = musicMode === 'boss' ? 0.48 : musicMode === 'combat' ? 0.38 : musicMode === 'calm' ? 0.14 : musicMode === 'menu' ? 0.24 : 0;
      const target = baseTarget * musicVolume;
      musicGain.gain.setTargetAtTime(target, now, 0.22);
      if (musicMode === 'off') return;
      musicNextTime = ac.currentTime + 0.04;
      musicStep = 0;
      if (!musicTimer) musicTimer = window.setInterval(musicPump, 60);
    }

    function init() {
      if (ac) {
        if (ac.state === 'suspended') ac.resume();
        return;
      }
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      try {
        ac = new AudioCtor();
        master = ac.createGain();
        master.gain.value = muted ? 0 : 0.3;
        const compressor = ac.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 24;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.2;
        master.connect(compressor);
        compressor.connect(ac.destination);
        sfxGain = ac.createGain();
        sfxGain.gain.value = sfxVolume;
        sfxGain.connect(master);

        const length = Math.floor(ac.sampleRate * 1.1);
        noiseBuffer = ac.createBuffer(1, length, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

        musicGain = ac.createGain();
        musicGain.gain.value = 0;
        musicAnalyser = ac.createAnalyser();
        musicAnalyser.fftSize = 256;
        musicGain.connect(musicAnalyser);
        musicAnalyser.connect(master);
        if (!visibilityBound) {
          visibilityBound = true;
          document.addEventListener('visibilitychange', () => {
            if (!ac) return;
            if (document.hidden) ac.suspend().catch(() => {});
            else if (!muted) ac.resume().catch(() => {});
          });
        }
        if (pendingMusicMode !== 'off') setMusicMode(pendingMusicMode);
      } catch (_) {
        ac = null;
      }
    }

    function audible() {
      return !!ac && !muted;
    }

    function noise({ duration = 0.09, volume = 0.1, freq = 1200, q = 0.8, type = 'highpass', delay = 0 }) {
      if (!audible()) return;
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(Math.max(0.0001, volume), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(sfxGain);
      src.start(t);
      src.stop(t + duration + 0.03);
    }

    function tone({
      freq = 220,
      slide = null,
      duration = 0.1,
      volume = 0.08,
      type = 'sine',
      delay = 0,
      attack = 0.004,
    }) {
      if (!audible()) return;
      const t = ac.currentTime + delay;
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + duration);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t + Math.min(attack, duration * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + duration + 0.04);
    }

    function setMuted(value) {
      muted = !!value;
      storeString('labzero.muted', muted ? '1' : '0');
      if (master && ac) {
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : 0.3, ac.currentTime, 0.025);
        if (!muted && musicMode !== 'off') {
          musicNextTime = ac.currentTime + 0.02;
          if (!musicTimer) musicTimer = window.setInterval(musicPump, 60);
        }
      }
      return muted;
    }

    function toggle() {
      init();
      if (ac && ac.state === 'suspended') ac.resume();
      return setMuted(!muted);
    }

    const api = {
      init,
      toggle,
      setMuted,
      isMuted: () => muted,
      click() {
        noise({ duration: 0.035, volume: 0.025, freq: 2400, type: 'highpass' });
        tone({ freq: 610, slide: 430, duration: 0.035, volume: 0.025, type: 'square' });
      },
      shot(weaponId) {
        if (!audible()) return;
        const now = performance.now();
        if (now - lastShot < 28) return;
        lastShot = now;
        const map = {
          pistol: { f: 160, n: 1600, v: 0.075, p: 2600 },
          smg: { f: 190, n: 1900, v: 0.055, p: 3200 },
          ar: { f: 125, n: 1300, v: 0.07, p: 2900 },
          lmg: { f: 92, n: 900, v: 0.08, p: 2100 },
          rocket: { f: 72, n: 700, v: 0.11, p: 1400 },
        };
        const cfg = map[weaponId] || map.pistol;
        noise({ duration: 0.065, volume: cfg.v, freq: cfg.n, type: 'highpass' });
        tone({ freq: cfg.f, slide: cfg.f * 0.42, duration: 0.085, volume: cfg.v * 0.86, type: 'triangle' });
        tone({ freq: cfg.p, slide: cfg.p * 0.5, duration: 0.022, volume: 0.015, type: 'square' });
      },
      empty() {
        tone({ freq: 780, slide: 380, duration: 0.035, volume: 0.025, type: 'square' });
      },
      reloadStart() {
        noise({ duration: 0.04, volume: 0.035, freq: 3200, type: 'bandpass', q: 1.2 });
        tone({ freq: 280, slide: 170, duration: 0.06, volume: 0.025, type: 'square' });
      },
      reloadEnd() {
        noise({ duration: 0.045, volume: 0.04, freq: 1800, q: 1.4, type: 'bandpass' });
        tone({ freq: 460, slide: 820, duration: 0.06, volume: 0.035, type: 'triangle', delay: 0.04 });
      },
      enemyShot(type = 'normal') {
        const boss = type === 'boss';
        const elite = type === 'elite';
        noise({
          duration: boss ? 0.12 : 0.06,
          volume: boss ? 0.065 : 0.025,
          freq: boss ? 480 : elite ? 1100 : 1600,
          type: 'highpass',
        });
        tone({
          freq: boss ? 82 : elite ? 155 : 205,
          slide: boss ? 40 : 90,
          duration: boss ? 0.15 : 0.08,
          volume: boss ? 0.055 : 0.025,
          type: 'sawtooth',
        });
      },
      hit() {
        noise({ duration: 0.025, volume: 0.025, freq: 3600, type: 'bandpass', q: 1.5 });
        tone({ freq: 210, slide: 90, duration: 0.04, volume: 0.025, type: 'triangle' });
      },
      kill() {
        noise({ duration: 0.1, volume: 0.045, freq: 800, type: 'lowpass' });
        tone({ freq: 125, slide: 46, duration: 0.13, volume: 0.045, type: 'sawtooth' });
      },
      hurt() {
        noise({ duration: 0.13, volume: 0.07, freq: 500, type: 'lowpass' });
        tone({ freq: 88, slide: 42, duration: 0.2, volume: 0.08, type: 'sine' });
      },
      coin() {
        tone({ freq: 1280, slide: 1680, duration: 0.055, volume: 0.022, type: 'sine' });
        tone({ freq: 1920, duration: 0.045, volume: 0.013, type: 'sine', delay: 0.035 });
      },
      heal() {
        tone({ freq: 420, duration: 0.1, volume: 0.03, type: 'sine' });
        tone({ freq: 630, duration: 0.12, volume: 0.022, type: 'sine', delay: 0.07 });
      },
      dash() {
        noise({ duration: 0.12, volume: 0.045, freq: 600, type: 'bandpass', q: 0.7 });
      },
      levelUp() {
        [523, 659, 784, 1046].forEach((f, i) => {
          tone({ freq: f, duration: 0.18, volume: 0.035, type: 'triangle', delay: i * 0.075 });
        });
      },
      buy() {
        tone({ freq: 330, duration: 0.06, volume: 0.04, type: 'square' });
        tone({ freq: 660, duration: 0.09, volume: 0.025, type: 'sine', delay: 0.055 });
      },
      upgrade() {
        tone({ freq: 440, duration: 0.08, volume: 0.035, type: 'triangle' });
        tone({ freq: 660, duration: 0.1, volume: 0.03, type: 'triangle', delay: 0.07 });
        tone({ freq: 880, duration: 0.14, volume: 0.02, type: 'sine', delay: 0.14 });
      },
      error() {
        tone({ freq: 160, slide: 95, duration: 0.14, volume: 0.035, type: 'square' });
      },
      waveStart() {
        tone({ freq: 330, duration: 0.13, volume: 0.03, type: 'sine' });
        tone({ freq: 440, duration: 0.18, volume: 0.032, type: 'sine', delay: 0.17 });
      },
      waveClear() {
        [392, 523, 659].forEach((f, i) => {
          tone({ freq: f, duration: 0.22, volume: 0.03, type: 'sine', delay: i * 0.1 });
        });
      },
      bossSpawn() {
        noise({ duration: 0.8, volume: 0.08, freq: 240, type: 'lowpass' });
        tone({ freq: 66, slide: 43, duration: 0.9, volume: 0.085, type: 'sawtooth' });
        tone({ freq: 132, slide: 87, duration: 0.6, volume: 0.035, type: 'square', delay: 0.22 });
        tone({ freq: 48, duration: 0.7, volume: 0.06, type: 'sine', delay: 0.1 });
      },
      bossDeath() {
        noise({ duration: 0.7, volume: 0.12, freq: 500, type: 'lowpass' });
        noise({ duration: 0.45, volume: 0.075, freq: 1600, type: 'highpass', delay: 0.05 });
        tone({ freq: 84, slide: 28, duration: 0.8, volume: 0.09, type: 'sawtooth' });
      },
      explosion() {
        noise({ duration: 0.5, volume: 0.13, freq: 650, type: 'lowpass' });
        noise({ duration: 0.18, volume: 0.065, freq: 2400, type: 'highpass' });
        tone({ freq: 95, slide: 32, duration: 0.55, volume: 0.095, type: 'sawtooth' });
        tone({ freq: 48, duration: 0.4, volume: 0.06, type: 'sine', delay: 0.03 });
      },
      shieldHit() {
        noise({ duration: 0.09, volume: 0.025, freq: 2800, type: 'bandpass', q: 1.2 });
        tone({ freq: 520, slide: 310, duration: 0.12, volume: 0.025, type: 'sine' });
      },
      shieldBreak() {
        noise({ duration: 0.2, volume: 0.065, freq: 1500, type: 'bandpass', q: 0.8 });
        tone({ freq: 220, slide: 65, duration: 0.3, volume: 0.045, type: 'triangle' });
      },
      shieldRestore() {
        tone({ freq: 330, slide: 520, duration: 0.24, volume: 0.024, type: 'sine' });
      },
      turretDeploy() {
        noise({ duration: 0.16, volume: 0.04, freq: 1000, type: 'bandpass', q: 1.1 });
        tone({ freq: 180, slide: 440, duration: 0.24, volume: 0.035, type: 'triangle' });
      },
      turretShot() {
        noise({ duration: 0.035, volume: 0.015, freq: 2600, type: 'highpass' });
        tone({ freq: 380, slide: 230, duration: 0.04, volume: 0.014, type: 'square' });
      },
      grenadeThrow() {
        noise({ duration: 0.12, volume: 0.03, freq: 900, type: 'bandpass', q: 0.8 });
        tone({ freq: 390, slide: 250, duration: 0.1, volume: 0.018, type: 'triangle' });
      },
      flashbang() {
        noise({ duration: 0.18, volume: 0.11, freq: 5200, type: 'highpass' });
        tone({ freq: 1800, slide: 2800, duration: 0.22, volume: 0.04, type: 'sine' });
        tone({ freq: 480, duration: 0.35, volume: 0.025, type: 'triangle', delay: 0.05 });
      },
      fire() {
        noise({ duration: 0.45, volume: 0.045, freq: 420, type: 'lowpass' });
        tone({ freq: 84, slide: 56, duration: 0.35, volume: 0.035, type: 'sine' });
      },
      reviveStart() {
        tone({ freq: 140, slide: 360, duration: 0.6, volume: 0.05, type: 'triangle' });
        noise({ duration: 0.45, volume: 0.035, freq: 1200, type: 'bandpass', q: 1.5 });
      },
      reviveComplete() {
        [196, 294, 392, 588].forEach((f, i) => {
          tone({ freq: f, duration: 0.28, volume: 0.035, type: 'sine', delay: i * 0.08 });
        });
      },
      talentUnlock() {
        [440, 554, 659, 880].forEach((f, i) => {
          tone({ freq: f, duration: 0.2, volume: 0.03, type: 'triangle', delay: i * 0.07 });
        });
      },
      summon() {
        tone({ freq: 190, slide: 78, duration: 0.38, volume: 0.04, type: 'sawtooth' });
        noise({ duration: 0.3, volume: 0.03, freq: 900, type: 'bandpass', q: 1.8 });
      },
      setMusicMode(mode) {
        setMusicMode(mode);
      },
      setSfxVolume(value) {
        sfxVolume = clamp(Number(value) || 0, 0, 1);
        storeNumber('labzero.sfxVolume', sfxVolume);
        if (sfxGain && ac) {
          sfxGain.gain.cancelScheduledValues(ac.currentTime);
          sfxGain.gain.setTargetAtTime(sfxVolume, ac.currentTime, 0.035);
        }
        return sfxVolume;
      },
      setMusicVolume(value) {
        musicVolume = clamp(Number(value) || 0, 0, 1);
        storeNumber('labzero.musicVolume', musicVolume);
        if (musicGain && ac && musicMode !== 'off') {
          const baseTarget = musicMode === 'boss' ? 0.48 : musicMode === 'combat' ? 0.38 : musicMode === 'calm' ? 0.14 : musicMode === 'menu' ? 0.24 : 0;
          musicGain.gain.cancelScheduledValues(ac.currentTime);
          musicGain.gain.setTargetAtTime(baseTarget * musicVolume, ac.currentTime, 0.08);
        }
        return musicVolume;
      },
      getAudioSettings() {
        return { sfxVolume, musicVolume, muted, context: ac ? ac.state : 'none' };
      },
      musicDebug() {
        let rms = 0;
        if (musicAnalyser) {
          const samples = new Float32Array(musicAnalyser.fftSize);
          musicAnalyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
          rms = +Math.sqrt(sum / samples.length).toFixed(4);
        }
        return {
          mode: musicMode,
          pending: pendingMusicMode,
          context: ac ? ac.state : 'none',
          gain: musicGain ? +musicGain.gain.value.toFixed(3) : 0,
          musicVolume: +musicVolume.toFixed(2),
          sfxVolume: +sfxVolume.toFixed(2),
          rms,
          step: musicStep,
          running: !!musicTimer,
        };
      },
      gameOver() {
        [220, 174, 130, 86].forEach((f, i) => {
          tone({ freq: f, slide: f * 0.7, duration: 0.36, volume: 0.045, type: 'triangle', delay: i * 0.19 });
        });
        noise({ duration: 0.5, volume: 0.045, freq: 300, type: 'lowpass' });
      },
    };
    return api;
  })();

  /* ------------------------------------------------------------
     World configuration
     ------------------------------------------------------------ */
  const WORLD = { w: 2400, h: 1500, pad: 54 };
  const PLAYER_START = { x: 1200, y: 930 };
  const DASH_COOLDOWN = 3.2;
  const DASH_TIME = 0.15;
  const CAMERA_ZOOM = 1.32;
  const QUALITY_ORDER = ['low', 'medium', 'high'];
  const QUALITY_SETTINGS = {
    low: {
      id: 'low',
      name: '流畅',
      code: 'PERFORMANCE',
      dprCap: 1,
      desc: '1.0× 渲染上限 · 关闭颗粒层 · 适合低性能设备与高帧率优先。',
    },
    medium: {
      id: 'medium',
      name: '标准',
      code: 'BALANCED',
      dprCap: 1.5,
      desc: '1.5× 渲染上限 · 保留扫描线 · 在清晰度与性能之间平衡。',
    },
    high: {
      id: 'high',
      name: '高清',
      code: 'CINEMATIC',
      dprCap: 2,
      desc: '最高 2.0× 渲染 · 保留全部颗粒 / 扫描线 · 适合高性能设备。',
    },
  };

  function normalizeQuality(value) {
    return QUALITY_SETTINGS[value] ? value : 'high';
  }

  const INITIAL_QUALITY = normalizeQuality(loadString('labzero.quality', 'high'));
  const INITIAL_DEVELOPER_MODE = loadString('labzero.developerMode', '0') === '1';
  const DEVELOPER_PASSWORD = 'qyxnb';

  const DOORS = [
    { side: 'top', x: 1146, y: 0, w: 108, h: WORLD.pad, label: 'N-07', sx: 1200, sy: 182 },
    { side: 'bottom', x: 1146, y: WORLD.h - WORLD.pad, w: 108, h: WORLD.pad, label: 'S-07', sx: 1200, sy: 1340 },
    { side: 'left', x: 0, y: 738, w: WORLD.pad, h: 108, label: 'W-07', sx: 164, sy: 792 },
    { side: 'right', x: WORLD.w - WORLD.pad, y: 738, w: WORLD.pad, h: 108, label: 'E-07', sx: 2236, sy: 792 },
  ];

  const SPAWN_POINTS = DOORS.map((d) => ({ x: d.sx, y: d.sy, door: d }));
  const BOSS_SPAWN = { x: 1200, y: 188 };

  const WALLS = [
    { type: 'wall', shape: 'rect', side: 'top', x: 0, y: 0, w: WORLD.w, h: WORLD.pad },
    { type: 'wall', shape: 'rect', side: 'bottom', x: 0, y: WORLD.h - WORLD.pad, w: WORLD.w, h: WORLD.pad },
    { type: 'wall', shape: 'rect', side: 'left', x: 0, y: 0, w: WORLD.pad, h: WORLD.h },
    { type: 'wall', shape: 'rect', side: 'right', x: WORLD.w - WORLD.pad, y: 0, w: WORLD.pad, h: WORLD.h },
  ];

  const PROPS = [
    { type: 'bench', shape: 'rect', x: 1080, y: 570, w: 300, h: 100, variant: 0, seed: 1, label: 'ANALYSIS' },
    { type: 'bench', shape: 'rect', x: 300, y: 420, w: 320, h: 96, variant: 1, seed: 2, label: 'SAMPLE PREP' },
    { type: 'bench', shape: 'rect', x: 300, y: 1010, w: 350, h: 100, variant: 2, seed: 3, label: 'COLD STORAGE' },
    { type: 'bench', shape: 'rect', x: 1890, y: 1010, w: 320, h: 100, variant: 3, seed: 4, label: 'CULTURE' },
    { type: 'server', shape: 'rect', x: 1870, y: 330, w: 112, h: 170, variant: 0, seed: 5 },
    { type: 'server', shape: 'rect', x: 2015, y: 330, w: 112, h: 170, variant: 1, seed: 6 },
    { type: 'server', shape: 'rect', x: 2160, y: 330, w: 112, h: 170, variant: 2, seed: 7 },
    { type: 'tank', shape: 'circle', x: 820, y: 260, r: 88, variant: 0, seed: 8, label: 'SPECIMEN 04' },
    { type: 'tank', shape: 'circle', x: 1370, y: 250, r: 104, variant: 1, seed: 9, label: 'SPECIMEN 00' },
    { type: 'pillar', shape: 'circle', x: 330, y: 780, r: 32, seed: 10 },
    { type: 'pillar', shape: 'circle', x: 2090, y: 780, r: 32, seed: 11 },
    { type: 'cryo', shape: 'circle', x: 680, y: 830, r: 42, seed: 12, label: 'CRYO' },
    { type: 'cryo', shape: 'circle', x: 1720, y: 880, r: 48, seed: 13, label: 'CRYO' },
    { type: 'crate', shape: 'rect', x: 970, y: 1180, w: 88, h: 84, seed: 14, label: '07' },
    { type: 'crate', shape: 'rect', x: 1070, y: 1216, w: 78, h: 66, seed: 15, label: 'BIO' },
    { type: 'crate', shape: 'rect', x: 1450, y: 1160, w: 100, h: 94, seed: 16, label: '07' },
    { type: 'console', shape: 'rect', x: 1620, y: 550, w: 100, h: 70, seed: 17, label: 'SECURITY' },
    { type: 'crate', shape: 'rect', x: 560, y: 260, w: 72, h: 72, seed: 18, label: 'X' },
    { type: 'console', shape: 'rect', x: 620, y: 610, w: 92, h: 60, seed: 19, label: 'POWER' },
  ];

  const STANDARD_OBSTACLES = [...WALLS, ...PROPS];
  let OBSTACLES = STANDARD_OBSTACLES;
  // Circular props are drawn with a wider base/rim than their logical radius.
  // Use the visible footprint for both actors and bullets so nobody clips the rim.
  for (const prop of PROPS) {
    if (prop.shape === 'circle') {
      prop.cr = prop.r + (prop.type === 'tank' ? 9 : prop.type === 'cryo' ? 5 : 4);
    }
  }
  const obstacleRadius = (obs) => (obs.cr != null ? obs.cr : obs.r);
  const FLOOR_LIGHTS = [
    { x: 560, y: 660, rx: 420, ry: 320, color: '108, 226, 239', a: 0.055 },
    { x: 1200, y: 880, rx: 510, ry: 390, color: '195, 246, 255', a: 0.075 },
    { x: 1950, y: 690, rx: 380, ry: 330, color: '101, 209, 231', a: 0.045 },
    { x: 1700, y: 1120, rx: 300, ry: 230, color: '255, 160, 101', a: 0.025 },
    { x: 1180, y: 260, rx: 430, ry: 250, color: '109, 241, 215', a: 0.035 },
    { x: 380, y: 1140, rx: 310, ry: 260, color: '111, 196, 255', a: 0.03 },
  ];

  /* ------------------------------------------------------------
     Campaign mode data
     Three hand-authored linear laboratory maps. Floors are unioned
     from 50px tiles; the untouched grid is merged into solid wall
     rectangles so the existing swept collision / LOS code still
     works for both modes.
     ------------------------------------------------------------ */
  const CAMPAIGN_TILE = 50;
  const CAMPAIGN_COLS = 48;
  const CAMPAIGN_ROWS = 30;

  const CAMPAIGN_UPGRADES = {
    health: {
      key: 'health',
      name: '生命强化',
      code: 'VITALITY',
      desc: '生命上限 +20，并立即回复 20 生命。',
      baseCost: 70,
      max: 6,
      effect: (level) => `生命上限 +${level * 20}`,
    },
    speed: {
      key: 'speed',
      name: '机动强化',
      code: 'MOBILITY',
      desc: '移动速度 +4%。',
      baseCost: 80,
      max: 5,
      effect: (level) => `移动速度 +${level * 4}%`,
    },
    reload: {
      key: 'reload',
      name: '装填强化',
      code: 'RELOAD',
      desc: '装填速度 +6%。',
      baseCost: 90,
      max: 5,
      effect: (level) => `装填速度 +${level * 6}%`,
    },
    damage: {
      key: 'damage',
      name: '火力强化',
      code: 'FIREPOWER',
      desc: '所有武器伤害 +6%。',
      baseCost: 110,
      max: 5,
      effect: (level) => `所有武器伤害 +${level * 6}%`,
    },
  };
  const CAMPAIGN_UPGRADE_ORDER = ['health', 'speed', 'reload', 'damage'];

  const CAMPAIGN_BOSS_DEFS = {
    director: {
      name: '实验室主任',
      code: 'DR. VELA // DIRECTOR',
      tag: 'BIO-COMMANDER',
      desc: '毒瓶 · 冲锋枪 · 自爆变异体',
      hp: 1250,
      radius: 33,
      speed: 82,
      damage: 12,
      faction: 'lab',
    },
    sergeant: {
      name: '士官长',
      code: 'SERGEANT PRIME',
      tag: 'ASSAULT COMMANDER',
      desc: '霰弹枪 · 火箭筒 · 士兵召唤',
      hp: 1700,
      radius: 37,
      speed: 76,
      damage: 16,
      faction: 'military',
    },
    robot: {
      name: '清道夫 X-7',
      code: 'PURGER UNIT',
      tag: 'MECHANICAL TARGET',
      desc: '冲撞 · 追踪火箭 · 加特林 · 哨戒炮',
      hp: 2400,
      radius: 42,
      speed: 70,
      damage: 15,
      faction: 'robot',
    },
  };

  const CAMPAIGN_LEVELS = [
    {
      id: 'bio',
      index: 0,
      code: 'B-01',
      name: '生物收容层',
      subtitle: 'BIO-CONTAINMENT',
      theme: {
        floor: '#10302b',
        floorAlt: '#163b34',
        line: 'rgba(128, 242, 220, 0.11)',
        accent: '111, 240, 201',
        wall: '#081516',
        wallTop: '#203d3b',
        glow: '76, 208, 180',
      },
      rooms: [
        { x: 100, y: 1100, w: 300, h: 300, name: '接收大厅', label: 'RECEPTION' },
        { x: 650, y: 1000, w: 300, h: 300, name: '样本分析室', label: 'SAMPLE ANALYSIS' },
        { x: 650, y: 550, w: 300, h: 250, name: '冷冻储藏室', label: 'COLD STORAGE' },
        { x: 1200, y: 550, w: 300, h: 250, name: '低温实验室', label: 'CRYO LAB' },
        { x: 1200, y: 1000, w: 350, h: 250, name: '观察室', label: 'OBSERVATION' },
        { x: 400, y: 850, w: 200, h: 200, name: '补给站', label: 'SUPPLY STATION', shop: true },
        { x: 1800, y: 550, w: 450, h: 350, name: '主任办公室', label: 'DIRECTOR OFFICE', boss: true },
      ],
      corridors: [
        { x: 400, y: 1200, w: 250, h: 100 },
        { x: 450, y: 1050, w: 100, h: 150 },
        { x: 750, y: 800, w: 100, h: 200 },
        { x: 950, y: 650, w: 250, h: 100 },
        { x: 1300, y: 800, w: 100, h: 200 },
        { x: 1550, y: 1050, w: 250, h: 100 },
        { x: 1700, y: 700, w: 100, h: 350 },
      ],
      playerStart: { x: 245, y: 1250 },
      startElevator: { x: 175, y: 1250 },
      exitElevator: { x: 2150, y: 725 },
      path: [
        { x: 280, y: 1250 },
        { x: 525, y: 1250 },
        { x: 800, y: 1150 },
        { x: 800, y: 900 },
        { x: 800, y: 675 },
        { x: 1075, y: 700 },
        { x: 1350, y: 675 },
        { x: 1350, y: 900 },
        { x: 1400, y: 1125 },
        { x: 1675, y: 1125 },
        { x: 1750, y: 1000 },
        { x: 1750, y: 800 },
        { x: 2000, y: 725 },
      ],
      shops: [{ x: 500, y: 950 }],
      bossKind: 'director',
      bossSpawn: { x: 2000, y: 725 },
      bossTrigger: { x: 1800, y: 550, w: 450, h: 350 },
      faction: 'lab',
      enemySystem: 'lab',
      normal: 10,
      elite: 3,
      searchables: 10,
      startText: '接收大厅的电梯已经停稳。沿折返通道搜索补给，再向主任办公室推进。',
      bossIntro: '实验室主任封锁了主任办公室，出口电梯已锁定。',
    },
    {
      id: 'security',
      index: 1,
      code: 'B-02',
      name: '安保中枢',
      subtitle: 'SECURITY HUB',
      theme: {
        floor: '#29271d',
        floorAlt: '#332f22',
        line: 'rgba(245, 201, 126, 0.1)',
        accent: '255, 196, 106',
        wall: '#11120e',
        wallTop: '#393629',
        glow: '237, 174, 76',
      },
      rooms: [
        { x: 100, y: 100, w: 300, h: 300, name: '入口安检区', label: 'SECURITY CHECKPOINT' },
        { x: 100, y: 600, w: 350, h: 300, name: '安保控制室', label: 'CONTROL ROOM' },
        { x: 650, y: 600, w: 300, h: 300, name: '军械库', label: 'ARMORY' },
        { x: 650, y: 100, w: 300, h: 250, name: '监控室', label: 'SURVEILLANCE' },
        { x: 1150, y: 100, w: 350, h: 300, name: '数据档案室', label: 'DATA ARCHIVE' },
        { x: 1150, y: 600, w: 350, h: 300, name: '拘留区', label: 'DETENTION' },
        { x: 1050, y: 1200, w: 250, h: 200, name: '军需补给站', label: 'SUPPLY DEPOT', shop: true },
        { x: 1750, y: 900, w: 400, h: 400, name: '安保指挥中心', label: 'COMMAND CENTER', boss: true },
      ],
      corridors: [
        { x: 200, y: 400, w: 100, h: 200 },
        { x: 450, y: 700, w: 200, h: 100 },
        { x: 750, y: 350, w: 100, h: 250 },
        { x: 950, y: 200, w: 200, h: 100 },
        { x: 1300, y: 400, w: 100, h: 200 },
        { x: 1500, y: 700, w: 250, h: 100 },
        { x: 1650, y: 800, w: 100, h: 200 },
        { x: 1150, y: 900, w: 100, h: 300 },
      ],
      playerStart: { x: 245, y: 250 },
      startElevator: { x: 175, y: 250 },
      exitElevator: { x: 2050, y: 1100 },
      path: [
        { x: 280, y: 250 },
        { x: 250, y: 500 },
        { x: 275, y: 750 },
        { x: 550, y: 750 },
        { x: 800, y: 750 },
        { x: 800, y: 475 },
        { x: 800, y: 225 },
        { x: 1050, y: 250 },
        { x: 1325, y: 250 },
        { x: 1350, y: 500 },
        { x: 1325, y: 750 },
        { x: 1625, y: 750 },
        { x: 1700, y: 900 },
        { x: 1950, y: 1100 },
      ],
      shops: [{ x: 1175, y: 1300 }],
      bossKind: 'sergeant',
      bossSpawn: { x: 1950, y: 1100 },
      bossTrigger: { x: 1750, y: 900, w: 400, h: 400 },
      faction: 'military',
      enemySystem: 'military',
      normal: 12,
      elite: 4,
      searchables: 12,
      startText: '安检区下方是一条折返路线。穿过控制室与军械库，从拘留区绕向指挥中心。',
      bossIntro: '士官长在指挥中心等待，区域封锁协议已启动。',
    },
    {
      id: 'reactor',
      index: 2,
      code: 'B-03',
      name: '动力核心',
      subtitle: 'REACTOR CORE',
      theme: {
        floor: '#122637',
        floorAlt: '#182f43',
        line: 'rgba(135, 207, 255, 0.11)',
        accent: '123, 210, 255',
        wall: '#09121c',
        wallTop: '#253a4c',
        glow: '103, 177, 255',
      },
      rooms: [
        { x: 100, y: 1100, w: 300, h: 300, name: '反应堆入口', label: 'REACTOR ACCESS' },
        { x: 100, y: 550, w: 400, h: 300, name: '主反应堆', label: 'REACTOR HALL' },
        { x: 750, y: 550, w: 350, h: 250, name: '能量实验室', label: 'ENERGY LAB' },
        { x: 750, y: 1000, w: 350, h: 250, name: '冷却监测站', label: 'COOLANT MONITOR' },
        { x: 1350, y: 1000, w: 300, h: 250, name: '维护通道', label: 'MAINTENANCE' },
        { x: 1350, y: 500, w: 300, h: 250, name: '核心隔离间', label: 'ISOLATION' },
        { x: 750, y: 1300, w: 250, h: 150, name: '维护补给站', label: 'MAINTENANCE SUPPLY', shop: true },
        { x: 1850, y: 450, w: 400, h: 400, name: '核心控制室', label: 'CORE CONTROL', boss: true },
      ],
      corridors: [
        { x: 220, y: 850, w: 100, h: 250 },
        { x: 500, y: 650, w: 250, h: 100 },
        { x: 850, y: 800, w: 100, h: 200 },
        { x: 1100, y: 1100, w: 250, h: 100 },
        { x: 1450, y: 750, w: 100, h: 250 },
        { x: 1650, y: 600, w: 200, h: 100 },
        { x: 825, y: 1200, w: 100, h: 100 },
      ],
      playerStart: { x: 245, y: 1250 },
      startElevator: { x: 175, y: 1250 },
      exitElevator: { x: 2150, y: 650 },
      path: [
        { x: 280, y: 1250 },
        { x: 270, y: 1000 },
        { x: 300, y: 700 },
        { x: 625, y: 700 },
        { x: 925, y: 675 },
        { x: 900, y: 900 },
        { x: 925, y: 1125 },
        { x: 1225, y: 1150 },
        { x: 1500, y: 1125 },
        { x: 1500, y: 875 },
        { x: 1500, y: 625 },
        { x: 1750, y: 650 },
        { x: 2050, y: 650 },
      ],
      shops: [{ x: 875, y: 1375 }],
      bossKind: 'robot',
      bossSpawn: { x: 2020, y: 650 },
      bossTrigger: { x: 1850, y: 450, w: 400, h: 400 },
      faction: 'robot',
      enemySystem: 'robot',
      normal: 14,
      elite: 5,
      searchables: 14,
      startText: '动力核心的路线在主反应堆、冷却站与隔离间之间反复折返。巡游机器人已失控。',
      bossIntro: '清道夫 X-7 已部署，核心控制室进入封锁状态。',
    },
  ];

  const CAMPAIGN_FACTIONS = {
    lab: {
      label: '感染研究员',
      colors: { main: '#32433a', light: '#5e7b67', dark: '#14221b', trim: 'rgba(132, 255, 190, 0.5)', visor: '157, 255, 196' },
    },
    military: {
      label: '安保士兵',
      colors: { main: '#49382a', light: '#7d6347', dark: '#211912', trim: 'rgba(255, 191, 105, 0.5)', visor: '255, 191, 110' },
    },
    robot: {
      label: '失控机器人',
      colors: { main: '#354148', light: '#66757d', dark: '#151d22', trim: 'rgba(255, 105, 89, 0.5)', visor: '255, 105, 89' },
    },
  };

  const ROGUE_ROOM_NAMES = {
    lab: ['培养间', '解剖室', '样本冷库', '隔离观察室', '消毒通道', '活体储藏室', '分析前厅', '低温循环室'],
    military: ['安检室', '枪械库', '监控室', '拘留室', '战术准备室', '档案销毁间', '军需库', '指挥前厅'],
    robot: ['配电室', '冷却泵房', '维护间', '机库', '数据节点室', '反应堆侧廊', '传动室', '核心检修间'],
  };
  const ROGUE_ROOM_LABELS = {
    lab: ['BIO UNIT', 'SPECIMEN', 'COLD STORE', 'ISOLATION', 'STERILIZATION', 'LIVE STORAGE', 'ANALYSIS', 'CRYO LOOP'],
    military: ['CHECKPOINT', 'ARMORY', 'SURVEILLANCE', 'DETENTION', 'TACTICAL', 'SHREDDER', 'SUPPLY', 'COMMAND'],
    robot: ['POWER', 'COOLANT', 'MAINTENANCE', 'HANGAR', 'DATA NODE', 'REACTOR', 'DRIVE', 'CORE SERVICE'],
  };
  const ROGUE_BOSS_BY_FACTION = { lab: 'director', military: 'sergeant', robot: 'robot' };

  const CAMPAIGN_TOTALS = campaignRecordTotals(CAMPAIGN_BY_DIFFICULTY);
  const CAMPAIGN_STORAGE = {
    clears: CAMPAIGN_TOTALS.clears,
    bestTime: CAMPAIGN_TOTALS.bestTime,
    byDifficulty: CAMPAIGN_BY_DIFFICULTY,
  };
  const ROGUE_STORAGE = {
    bestFloor: rogueRecordBest(ROGUE_BY_DIFFICULTY),
    byDifficulty: ROGUE_BY_DIFFICULTY,
  };

  function normalizeMenuMode(value) {
    return ['campaign', 'rogue', 'training', 'story'].includes(value) ? value : 'endless';
  }

  /* ------------------------------------------------------------
     Static environment construction
     ------------------------------------------------------------ */
  let envCanvas = null;
  let envCtx = null;
  const mapScale = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));

  function buildEnvironment() {
    envCanvas = document.createElement('canvas');
    envCanvas.width = Math.round(WORLD.w * mapScale);
    envCanvas.height = Math.round(WORLD.h * mapScale);
    envCtx = envCanvas.getContext('2d');
    envCtx.scale(mapScale, mapScale);

    drawFloor(envCtx);
    drawFloorScuffs(envCtx);
    drawFloorGraphics(envCtx);
    drawFloorLights(envCtx);
    drawOuterWalls(envCtx);
    drawDoorMarkings(envCtx);

    const sorted = [...PROPS].sort((a, b) => (a.y + (a.h || a.r || 0)) - (b.y + (b.h || b.r || 0)));
    sorted.forEach((prop) => {
      if (prop.type === 'bench') drawBench(envCtx, prop);
      else if (prop.type === 'server') drawServer(envCtx, prop);
      else if (prop.type === 'tank') drawTank(envCtx, prop);
      else if (prop.type === 'pillar') drawPillar(envCtx, prop);
      else if (prop.type === 'crate') drawCrate(envCtx, prop);
      else if (prop.type === 'cryo') drawCryo(envCtx, prop);
      else if (prop.type === 'console') drawConsole(envCtx, prop);
    });

    drawWallForeground(envCtx);
    finishEnvironment(envCtx);
  }

  function finishEnvironment(ctx) {
    // Overhead light mist. Painted over the props so their upper surfaces pick
    // up the same cool fluorescent glow as the floor.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const central = ctx.createRadialGradient(1200, 760, 80, 1200, 760, 1080);
    central.addColorStop(0, 'rgba(82, 142, 146, 0.20)');
    central.addColorStop(0.46, 'rgba(59, 112, 117, 0.095)');
    central.addColorStop(1, 'rgba(43, 94, 101, 0)');
    ctx.fillStyle = central;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    for (const light of FLOOR_LIGHTS) {
      ctx.save();
      ctx.translate(light.x, light.y);
      ctx.scale(light.rx * 0.8, light.ry * 0.8);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${light.color}, ${light.a * 0.66})`);
      g.addColorStop(0.55, `rgba(${light.color}, ${light.a * 0.22})`);
      g.addColorStop(1, `rgba(${light.color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Cold radial spill from the upper observation window.
    const top = ctx.createLinearGradient(0, 0, 0, 390);
    top.addColorStop(0, 'rgba(93, 183, 194, 0.12)');
    top.addColorStop(0.35, 'rgba(70, 139, 150, 0.045)');
    top.addColorStop(1, 'rgba(55, 112, 123, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, WORLD.w, 390);

    // Long cool reflections in the floor plating.
    for (let i = 0; i < 4; i += 1) {
      const y = 250 + i * 320;
      const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, 'rgba(91, 179, 184, 0)');
      g.addColorStop(0.5, 'rgba(91, 179, 184, 0.035)');
      g.addColorStop(1, 'rgba(91, 179, 184, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(90, y - 22, WORLD.w - 180, 44);
    }
    ctx.restore();
  }

  function drawFloor(ctx) {
    const rng = mulberry32(0x07ab13);
    ctx.fillStyle = '#050b0e';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    const innerX = WORLD.pad;
    const innerY = WORLD.pad;
    const innerW = WORLD.w - WORLD.pad * 2;
    const innerH = WORLD.h - WORLD.pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, innerY, innerW, innerH);
    ctx.clip();

    ctx.fillStyle = '#0c181d';
    ctx.fillRect(innerX, innerY, innerW, innerH);

    const tile = 80;
    for (let y = innerY; y < innerY + innerH; y += tile) {
      for (let x = innerX; x < innerX + innerW; x += tile) {
        const v = rng();
        const shade = v > 0.78 ? 0.072 : v > 0.32 ? 0.032 : 0.018;
        ctx.fillStyle = `rgba(110, 146, 151, ${shade})`;
        ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
        if (v > 0.91) {
          ctx.fillStyle = 'rgba(82, 135, 138, 0.045)';
          ctx.fillRect(x + 9, y + 13, tile - 29, 2);
          ctx.fillRect(x + 19, y + 20, tile - 46, 1);
        }
        if (v < 0.08) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 14, y + 66);
          ctx.lineTo(x + 34, y + 41);
          ctx.lineTo(x + 50, y + 47);
          ctx.lineTo(x + 69, y + 23);
          ctx.stroke();
        }
      }
    }

    ctx.strokeStyle = 'rgba(99, 145, 150, 0.2)';
    ctx.lineWidth = 1;
    for (let x = innerX; x <= innerX + innerW; x += tile) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, innerY);
      ctx.lineTo(x + 0.5, innerY + innerH);
      ctx.stroke();
    }
    for (let y = innerY; y <= innerY + innerH; y += tile) {
      ctx.beginPath();
      ctx.moveTo(innerX, y + 0.5);
      ctx.lineTo(innerX + innerW, y + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(116, 169, 171, 0.08)';
    for (let x = innerX; x <= innerX + innerW; x += tile * 4) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, innerY);
      ctx.lineTo(x + 0.5, innerY + innerH);
      ctx.stroke();
    }
    for (let y = innerY; y <= innerY + innerH; y += tile * 4) {
      ctx.beginPath();
      ctx.moveTo(innerX, y + 0.5);
      ctx.lineTo(innerX + innerW, y + 0.5);
      ctx.stroke();
    }

    // Plate inset shadows give the floor a little physical depth.
    const edge = ctx.createLinearGradient(innerX, innerY, innerX + 44, innerY + 44);
    edge.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    edge.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = edge;
    ctx.fillRect(innerX, innerY, innerW, 32);
    ctx.fillRect(innerX, innerY, 32, innerH);

    // Long, dark service channels.
    ctx.fillStyle = 'rgba(1, 5, 7, 0.32)';
    ctx.fillRect(innerX + 240, innerY + 104, innerW - 480, 36);
    ctx.fillRect(innerX + 160, innerH + innerY - 280, innerW - 320, 24);
    ctx.strokeStyle = 'rgba(137, 178, 181, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX + 14, innerY + 141);
    ctx.lineTo(innerW + innerX - 14, innerY + 141);
    ctx.moveTo(innerX + 14, innerH + innerY - 267);
    ctx.lineTo(innerW + innerX - 14, innerH + innerY - 267);
    ctx.stroke();

    ctx.restore();
  }

  function drawFloorScuffs(ctx) {
    const rng = mulberry32(0x9f1a27);
    ctx.save();
    ctx.beginPath();
    ctx.rect(WORLD.pad, WORLD.pad, WORLD.w - WORLD.pad * 2, WORLD.h - WORLD.pad * 2);
    ctx.clip();

    for (let i = 0; i < 34; i += 1) {
      const x = rand(90, WORLD.w - 90);
      const y = rand(90, WORLD.h - 90);
      const rx = rand(18, 90);
      const ry = rand(5, 26);
      const green = rng() > 0.55;
      ctx.fillStyle = green ? 'rgba(48, 90, 79, 0.045)' : 'rgba(0, 0, 0, 0.12)';
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rng() * TAU, 0, TAU);
      ctx.fill();
      if (rng() > 0.55) {
        ctx.strokeStyle = green ? 'rgba(94, 133, 113, 0.07)' : 'rgba(91, 109, 109, 0.055)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 0.76, ry * 0.8, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // Coolant / cleaning fluid trails.
    for (let i = 0; i < 7; i += 1) {
      const x = rand(200, WORLD.w - 200);
      const y = rand(200, WORLD.h - 200);
      ctx.strokeStyle = i % 2 ? 'rgba(74, 130, 119, 0.08)' : 'rgba(44, 91, 99, 0.07)';
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + rand(-80, 80), y + rand(30, 120), x + rand(20, 180), y + rand(50, 160), x + rand(60, 250), y + rand(90, 230));
      ctx.stroke();
    }

    // Overhead cables crossing the lab.
    function cable(points, bold = false) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.36)';
      ctx.lineWidth = bold ? 6 : 4;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      ctx.bezierCurveTo(points[1][0], points[1][1], points[2][0], points[2][1], points[3][0], points[3][1]);
      ctx.stroke();
      ctx.strokeStyle = bold ? 'rgba(47, 69, 71, 0.35)' : 'rgba(40, 61, 64, 0.28)';
      ctx.lineWidth = bold ? 2.4 : 1.4;
      ctx.stroke();
    }
    cable([[70, 310], [240, 360], [430, 220], [620, 262]], true);
    cable([[2330, 570], [2160, 520], [2030, 710], [1840, 620]]);
    cable([[780, 1450], [710, 1300], [560, 1200], [480, 990]]);
    cable([[1720, 54], [1690, 220], [1820, 310], [1870, 380]], true);
    cable([[2350, 1240], [2150, 1210], [2060, 1140], [1930, 1100]]);

    // Painted safety arrows near doors.
    ctx.strokeStyle = 'rgba(221, 166, 101, 0.12)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    for (let i = 0; i < 3; i += 1) {
      const y = 1090 + i * 51;
      ctx.beginPath();
      ctx.moveTo(1530, y);
      ctx.lineTo(1562, y);
      ctx.lineTo(1551, y - 9);
      ctx.moveTo(1562, y);
      ctx.lineTo(1551, y + 9);
      ctx.stroke();
    }
    for (let i = 0; i < 3; i += 1) {
      const x = 770 + i * 52;
      ctx.beginPath();
      ctx.moveTo(x, 390);
      ctx.lineTo(x, 358);
      ctx.lineTo(x - 9, 369);
      ctx.moveTo(x, 358);
      ctx.lineTo(x + 9, 369);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawFloorGraphics(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(WORLD.pad, WORLD.pad, WORLD.w - WORLD.pad * 2, WORLD.h - WORLD.pad * 2);
    ctx.clip();

    // Central containment seal.
    const cx = 1200;
    const cy = 880;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(150, 226, 229, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 208, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(119, 185, 189, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 188, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([4, 13]);
    ctx.strokeStyle = 'rgba(132, 208, 210, 0.16)';
    ctx.beginPath();
    ctx.arc(0, 0, 159, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * TAU;
      const inner = i % 6 === 0 ? 170 : 182;
      ctx.strokeStyle = i % 6 === 0 ? 'rgba(183, 229, 225, 0.24)' : 'rgba(129, 184, 185, 0.13)';
      ctx.lineWidth = i % 6 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * 194, Math.sin(a) * 194);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(174, 218, 216, 0.16)';
    ctx.font = '600 10px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '4px';
    ctx.fillText('CONTAINMENT FIELD', 0, 25);
    ctx.font = '500 8px "SFMono-Regular", monospace';
    ctx.fillStyle = 'rgba(154, 198, 197, 0.075)';
    ctx.fillText('SECTOR 07 / ASTRA GENE-LABS', 0, 43);
    ctx.fillStyle = 'rgba(113, 167, 169, 0.07)';
    ctx.font = '900 104px "Avenir Next", sans-serif';
    ctx.fillText('07', 0, -42);
    ctx.restore();

    // Stenciled room labels.
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(166, 207, 206, 0.16)';
    ctx.font = '900 42px "Avenir Next", sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillText('BIO-ANALYSIS', 120, 190);
    ctx.font = '600 9px "SFMono-Regular", monospace';
    ctx.fillStyle = 'rgba(147, 191, 190, 0.15)';
    ctx.fillText('AUTHORIZED PERSONNEL ONLY', 123, 208);

    ctx.save();
    ctx.translate(1815, 1232);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(143, 185, 187, 0.14)';
    ctx.font = '900 35px "Avenir Next", sans-serif';
    ctx.fillText('LIVE CULTURE', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(250, 1180);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(235, 167, 116, 0.14)';
    ctx.font = '900 25px "Avenir Next", sans-serif';
    ctx.fillText('WARNING · LOW TEMP', 0, 0);
    ctx.restore();

    // Hazard borders around some work surfaces.
    drawHazardBand(ctx, 1032, 686, 396, 12, 0.22);
    drawHazardBand(ctx, 252, 936, 420, 11, 0.17);
    drawHazardBand(ctx, 1842, 1126, 420, 11, 0.17);
    drawHazardBand(ctx, 1144, 54, 112, 66, 0.2, 'v');
    drawHazardBand(ctx, 1144, 1380, 112, 66, 0.2, 'v');
    drawHazardBand(ctx, 54, 736, 66, 112, 0.2);
    drawHazardBand(ctx, 2280, 736, 66, 112, 0.2);

    // Door lane chevrons.
    for (const door of DOORS) {
      ctx.save();
      ctx.fillStyle = 'rgba(192, 154, 99, 0.12)';
      if (door.side === 'top') ctx.translate(1200, 138);
      if (door.side === 'bottom') ctx.translate(1200, 1362);
      if (door.side === 'left') {
        ctx.translate(132, 792);
        ctx.rotate(Math.PI / 2);
      }
      if (door.side === 'right') {
        ctx.translate(2268, 792);
        ctx.rotate(-Math.PI / 2);
      }
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-48, 0);
        ctx.lineTo(-28, 0);
        ctx.lineTo(-36, -8);
        ctx.moveTo(-28, 0);
        ctx.lineTo(-36, 8);
        ctx.strokeStyle = 'rgba(213, 169, 107, 0.14)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.translate(0, 0);
        break;
      }
      ctx.restore();
    }

    // Tiny calibration marks near the center.
    ctx.strokeStyle = 'rgba(111, 158, 159, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI / 4 + (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(1200 + Math.cos(a) * 224, 880 + Math.sin(a) * 224);
      ctx.lineTo(1200 + Math.cos(a) * 252, 880 + Math.sin(a) * 252);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawHazardBand(ctx, x, y, w, h, alpha = 0.16, direction = 'h') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = `rgba(218, 158, 85, ${alpha * 0.45})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(22, 24, 23, ${alpha})`;
    ctx.lineWidth = 12;
    for (let i = -h; i < w + h; i += 24) {
      ctx.beginPath();
      if (direction === 'h') {
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
      } else {
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFloorLights(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const light of FLOOR_LIGHTS) {
      ctx.save();
      ctx.translate(light.x, light.y);
      ctx.scale(light.rx, light.ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${light.color}, ${light.a * 1.45})`);
      g.addColorStop(0.5, `rgba(${light.color}, ${light.a * 0.58})`);
      g.addColorStop(1, `rgba(${light.color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawOuterWalls(ctx) {
    for (const wall of WALLS) {
      const horizontal = wall.side === 'top' || wall.side === 'bottom';
      ctx.fillStyle = '#060c10';
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

      // Raised metal face.
      ctx.fillStyle = '#0b161b';
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

      if (horizontal) {
        const g = ctx.createLinearGradient(0, wall.y, 0, wall.y + wall.h);
        if (wall.side === 'top') {
          g.addColorStop(0, '#101f24');
          g.addColorStop(0.72, '#0a151a');
          g.addColorStop(1, '#050b0e');
        } else {
          g.addColorStop(0, '#050b0e');
          g.addColorStop(0.28, '#0a151a');
          g.addColorStop(1, '#101f24');
        }
        ctx.fillStyle = g;
        ctx.fillRect(wall.x + 1, wall.y + 1, wall.w - 2, wall.h - 2);

        const seamStart = wall.side === 'top' ? 0 : wall.y;
        for (let x = 110; x < WORLD.w; x += 154) {
          ctx.strokeStyle = 'rgba(80, 111, 116, 0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, wall.y + 7);
          ctx.lineTo(x, wall.y + wall.h - 7);
          ctx.stroke();
        }
        const edgeY = wall.side === 'top' ? wall.h - 3 : wall.y + 3;
        ctx.fillStyle = 'rgba(118, 177, 180, 0.22)';
        ctx.fillRect(0, edgeY, WORLD.w, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, wall.side === 'top' ? wall.h : wall.y, WORLD.w, 1);
        for (let x = 70; x < WORLD.w; x += 240) {
          ctx.fillStyle = 'rgba(113, 151, 153, 0.22)';
          ctx.fillRect(x, wall.y + 15, 2, 21);
        }
        for (let x = 190; x < WORLD.w; x += 312) {
          ctx.fillStyle = 'rgba(94, 131, 134, 0.18)';
          ctx.beginPath();
          ctx.arc(x, wall.y + 27, 2, 0, TAU);
          ctx.fill();
        }
      } else {
        const g = ctx.createLinearGradient(wall.x, 0, wall.x + wall.w, 0);
        if (wall.side === 'left') {
          g.addColorStop(0, '#101f24');
          g.addColorStop(0.72, '#0a151a');
          g.addColorStop(1, '#050b0e');
        } else {
          g.addColorStop(0, '#050b0e');
          g.addColorStop(0.28, '#0a151a');
          g.addColorStop(1, '#101f24');
        }
        ctx.fillStyle = g;
        ctx.fillRect(wall.x + 1, wall.y + 1, wall.w - 2, wall.h - 2);
        for (let y = 130; y < WORLD.h; y += 167) {
          ctx.strokeStyle = 'rgba(80, 111, 116, 0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(wall.x + 8, y);
          ctx.lineTo(wall.x + wall.w - 8, y);
          ctx.stroke();
        }
        const edgeX = wall.side === 'left' ? wall.w - 3 : wall.x + 3;
        ctx.fillStyle = 'rgba(118, 177, 180, 0.22)';
        ctx.fillRect(edgeX, 0, 1, WORLD.h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(wall.side === 'left' ? wall.w : wall.x, 0, 1, WORLD.h);
        for (let y = 210; y < WORLD.h; y += 240) {
          ctx.fillStyle = 'rgba(113, 151, 153, 0.22)';
          ctx.fillRect(wall.x + 14, y, 21, 2);
        }
        for (let y = 100; y < WORLD.h; y += 290) {
          ctx.fillStyle = 'rgba(94, 131, 134, 0.18)';
          ctx.beginPath();
          ctx.arc(wall.x + 27, y, 2, 0, TAU);
          ctx.fill();
        }
      }

      // Wall inner shadow onto the laboratory floor.
      if (wall.side === 'top') {
        const g = ctx.createLinearGradient(0, wall.h, 0, wall.h + 26);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, wall.h, WORLD.w, 26);
      } else if (wall.side === 'bottom') {
        const g = ctx.createLinearGradient(0, wall.y, 0, wall.y - 26);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, wall.y - 26, WORLD.w, 26);
      } else if (wall.side === 'left') {
        const g = ctx.createLinearGradient(wall.w, 0, wall.w + 26, 0);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(wall.w, 0, 26, WORLD.h);
      } else {
        const g = ctx.createLinearGradient(wall.x, 0, wall.x - 26, 0);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(wall.x - 26, 0, 26, WORLD.h);
      }
    }

    // Wall stencil on the top bulkhead.
    ctx.fillStyle = 'rgba(132, 178, 178, 0.18)';
    ctx.font = '600 10px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ASTRA GENE-LABS  ·  CONTAINMENT LEVEL 07', 1200, 31);
    ctx.fillStyle = 'rgba(255, 129, 84, 0.35)';
    ctx.fillRect(345, 23, 32, 2);
    ctx.fillRect(2023, 23, 32, 2);
  }

  function drawDoorMarkings(ctx) {
    for (const door of DOORS) {
      ctx.save();
      if (door.side === 'top' || door.side === 'bottom') {
        const y = door.side === 'top' ? 0 : WORLD.h - WORLD.pad;
        ctx.fillStyle = '#071014';
        ctx.fillRect(door.x, y, door.w, WORLD.pad);
        ctx.strokeStyle = 'rgba(168, 192, 188, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(door.x + 2, y + 2, door.w - 4, WORLD.pad - 4);
        ctx.fillStyle = '#111f23';
        ctx.fillRect(door.x + 8, y + 8, door.w - 16, WORLD.pad - 16);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.moveTo(door.x + door.w / 2, y + 8);
        ctx.lineTo(door.x + door.w / 2, y + WORLD.pad - 8);
        ctx.stroke();
        drawHazardBand(ctx, door.x + 12, door.side === 'top' ? WORLD.pad - 12 : y + 2, door.w - 24, 10, 0.34);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(213, 166, 105, 0.6)';
        ctx.font = '600 8px "SFMono-Regular", monospace';
        ctx.fillText(door.label, door.x + door.w / 2, y + WORLD.pad / 2 + 3);
        ctx.fillStyle = 'rgba(254, 112, 83, 0.7)';
        ctx.beginPath();
        ctx.arc(door.x + 18, y + 17, 2, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 103, 75, 0.8)';
        ctx.fill();
      } else {
        const x = door.side === 'left' ? 0 : WORLD.w - WORLD.pad;
        ctx.fillStyle = '#071014';
        ctx.fillRect(x, door.y, WORLD.pad, door.h);
        ctx.strokeStyle = 'rgba(168, 192, 188, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, door.y + 2, WORLD.pad - 4, door.h - 4);
        ctx.fillStyle = '#111f23';
        ctx.fillRect(x + 8, door.y + 8, WORLD.pad - 16, door.h - 16);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.moveTo(x + 8, door.y + door.h / 2);
        ctx.lineTo(x + WORLD.pad - 8, door.y + door.h / 2);
        ctx.stroke();
        ctx.save();
        ctx.translate(x + WORLD.pad / 2, door.y + door.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(213, 166, 105, 0.6)';
        ctx.font = '600 8px "SFMono-Regular", monospace';
        ctx.fillText(door.label, 0, 3);
        ctx.restore();
        ctx.fillStyle = 'rgba(254, 112, 83, 0.7)';
        ctx.beginPath();
        ctx.arc(x + 17, door.y + 18, 2, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 103, 75, 0.8)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawWallForeground(ctx) {
    // Small lip bolts and corner plates.
    ctx.fillStyle = 'rgba(155, 194, 190, 0.14)';
    const corners = [
      [18, 18], [WORLD.w - 18, 18], [18, WORLD.h - 18], [WORLD.w - 18, WORLD.h - 18],
    ];
    for (const [x, y] of corners) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(5, 10, 13, 0.5)';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(155, 194, 190, 0.14)';
    }
  }

  /* ------------------------------------------------------------
     Environment props
     ------------------------------------------------------------ */
  function propShadow(ctx, x, y, w, h, radius = 8) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    if (radius > 0) {
      rrPath(ctx, x + 6, y + 8, w, h, radius);
      ctx.fill();
    } else {
      ellipse(ctx, x, y, w, h, '#000');
    }
    ctx.restore();
  }

  function drawBench(ctx, p) {
    const { x, y, w, h, variant } = p;
    const rng = mulberry32(p.seed * 8191 + 17);
    ctx.save();
    propShadow(ctx, x, y, w, h, 4);

    rrPath(ctx, x, y, w, h, 3);
    ctx.fillStyle = '#091216';
    ctx.fill();
    rrPath(ctx, x + 2, y + 2, w - 4, h - 4, 2);
    const metal = ctx.createLinearGradient(x, y, x, y + h);
    metal.addColorStop(0, '#1b2e33');
    metal.addColorStop(0.4, '#111f24');
    metal.addColorStop(1, '#0b171b');
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = 'rgba(131, 189, 191, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Steel border highlights.
    ctx.fillStyle = 'rgba(177, 222, 218, 0.12)';
    ctx.fillRect(x + 8, y + 5, w - 16, 1);
    ctx.fillStyle = 'rgba(71, 112, 115, 0.18)';
    ctx.fillRect(x + 8, y + h - 7, w - 16, 1);
    ctx.fillStyle = 'rgba(103, 218, 224, 0.28)';
    ctx.fillRect(x + 16, y + h - 4, w - 32, 1);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(85, 205, 213, 0.16)';
    ctx.fillRect(x + 16, y + h - 2, w - 32, 1);
    ctx.globalAlpha = 1;

    // Corner rivets.
    for (const [cx, cy] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + h - 10], [x + w - 10, y + h - 10]]) {
      ctx.fillStyle = 'rgba(166, 195, 190, 0.3)';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.save();
    rrPath(ctx, x + 7, y + 7, w - 14, h - 14, 1);
    ctx.clip();

    if (variant === 0) {
      // Analysis bench with live readouts.
      const sx = x + 22;
      const sy = y + 18;
      rrPath(ctx, sx, sy, 104, 46, 2);
      ctx.fillStyle = '#071116';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 226, 232, 0.22)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(72, 236, 235, 0.45)';
      for (let i = 0; i < 5; i += 1) {
        const hh = 3 + rng() * 13;
        ctx.fillRect(sx + 9 + i * 11, sy + 36 - hh, 6, hh);
      }
      ctx.strokeStyle = 'rgba(103, 218, 220, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 11; i += 1) {
        const px = sx + 11 + i * 8;
        const py = sy + 17 + Math.sin(i * 1.9) * 5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(158, 195, 195, 0.24)';
      for (let i = 0; i < 6; i += 1) ctx.fillRect(sx + 12 + i * 14, sy + 6, 6, 2);

      // Racked sample vials.
      for (let i = 0; i < 5; i += 1) {
        const vx = x + 166 + i * 20;
        const vy = y + 25 + (i % 2) * 7;
        ctx.fillStyle = 'rgba(58, 233, 210, 0.24)';
        ctx.beginPath();
        ctx.arc(vx, vy + 13, 7, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(154, 238, 218, 0.34)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(vx, vy + 13, 8, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = 'rgba(191, 246, 239, 0.35)';
        ctx.fillRect(vx - 3, vy, 6, 2);
      }
      ctx.fillStyle = 'rgba(161, 198, 193, 0.25)';
      ctx.font = '500 7px "SFMono-Regular", monospace';
      ctx.fillText('BIO-ANALYSIS / LIVE', x + 22, y + h - 12);
      ctx.fillStyle = 'rgba(255, 157, 92, 0.32)';
      ctx.fillRect(x + 262, y + 64, 17, 2);
    } else if (variant === 1) {
      // Centrifuge / sample prep.
      for (let i = 0; i < 3; i += 1) {
        const cx = x + 58 + i * 78;
        const cy = y + h / 2;
        ctx.fillStyle = '#081216';
        ctx.beginPath();
        ctx.arc(cx, cy, 23, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(106, 195, 197, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(103, 219, 218, 0.22)';
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, TAU);
        ctx.stroke();
        for (let j = 0; j < 4; j += 1) {
          const a = (j / 4) * TAU + 0.3;
          ctx.fillStyle = j === 0 ? 'rgba(129, 255, 220, 0.4)' : 'rgba(104, 177, 177, 0.24)';
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, 2.5, 0, TAU);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(131, 192, 191, 0.24)';
      ctx.font = '500 7px "SFMono-Regular", monospace';
      ctx.fillText('SAMPLE PREP · STERILE', x + 15, y + h - 12);
      ctx.strokeStyle = 'rgba(124, 178, 176, 0.2)';
      ctx.beginPath();
      ctx.moveTo(x + 230, y + 20);
      ctx.lineTo(x + 299, y + 20);
      ctx.stroke();
      ctx.fillStyle = 'rgba(69, 129, 129, 0.24)';
      ctx.fillRect(x + 235, y + 27, 56, 10);
    } else if (variant === 2) {
      // Cold storage bench.
      for (let i = 0; i < 4; i += 1) {
        const bx = x + 22 + i * 76;
        rrPath(ctx, bx, y + 20, 58, 48, 2);
        ctx.fillStyle = 'rgba(12, 31, 37, 0.9)';
        ctx.fill();
        ctx.strokeStyle = i % 2 ? 'rgba(83, 179, 191, 0.24)' : 'rgba(133, 223, 217, 0.24)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(153, 234, 236, 0.26)';
        ctx.font = '500 6px "SFMono-Regular", monospace';
        ctx.fillText(`CR-0${i + 1}`, bx + 8, y + 31);
        ctx.fillStyle = 'rgba(91, 226, 231, 0.22)';
        ctx.fillRect(bx + 8, y + 38, 32, 2);
        ctx.fillRect(bx + 8, y + 43, 21, 1);
        ctx.fillStyle = 'rgba(255, 132, 98, 0.28)';
        ctx.beginPath();
        ctx.arc(bx + 48, y + 28, 2, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(136, 195, 195, 0.22)';
      ctx.font = '500 7px "SFMono-Regular", monospace';
      ctx.fillText('CRYO STORAGE / -80°C', x + 22, y + h - 11);
      ctx.strokeStyle = 'rgba(100, 197, 205, 0.17)';
      ctx.strokeRect(x + 299, y + 19, 29, 48);
    } else {
      // Culture bench.
      for (let i = 0; i < 3; i += 1) {
        const cx = x + 60 + i * 82;
        const cy = y + 47;
        ctx.fillStyle = 'rgba(54, 153, 118, 0.12)';
        ctx.beginPath();
        ctx.arc(cx, cy, 27, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(95, 197, 156, 0.22)';
        ctx.beginPath();
        ctx.arc(cx, cy, 27, 0, TAU);
        ctx.stroke();
        for (let j = 0; j < 4; j += 1) {
          ctx.fillStyle = 'rgba(134, 245, 193, 0.14)';
          ctx.beginPath();
          ctx.arc(cx + rand(-12, 12), cy + rand(-12, 12), rand(1, 4), 0, TAU);
          ctx.fill();
        }
      }
      rrPath(ctx, x + 262, y + 19, 43, 48, 2);
      ctx.fillStyle = 'rgba(4, 12, 15, 0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(129, 213, 207, 0.2)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(111, 236, 205, 0.28)';
      ctx.font = '500 6px "SFMono-Regular", monospace';
      ctx.fillText('CULTURE', x + 271, y + 31);
      ctx.fillStyle = 'rgba(112, 181, 173, 0.18)';
      ctx.fillRect(x + 271, y + 39, 24, 2);
      ctx.fillRect(x + 271, y + 45, 17, 2);
    }

    ctx.restore();
    ctx.restore();
  }

  function drawServer(ctx, p) {
    const { x, y, w, h, variant } = p;
    const ledColor = variant === 1 ? '119, 255, 211' : variant === 2 ? '255, 174, 103' : '100, 241, 255';
    ctx.save();
    propShadow(ctx, x, y, w, h, 3);

    rrPath(ctx, x, y, w, h, 2);
    ctx.fillStyle = '#081216';
    ctx.fill();
    rrPath(ctx, x + 3, y + 3, w - 6, h - 6, 1);
    const metal = ctx.createLinearGradient(x, y, x + w, y + h);
    metal.addColorStop(0, '#1b2b30');
    metal.addColorStop(0.5, '#0e1d22');
    metal.addColorStop(1, '#071116');
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = 'rgba(133, 190, 190, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Front-facing status strip.
    ctx.fillStyle = `rgba(${ledColor}, 0.34)`;
    ctx.fillRect(x + 10, y + 10, w - 20, 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(x + 10, y + 18, w - 20, h - 33);

    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = `rgba(${ledColor}, ${i % 3 === 0 ? 0.45 : 0.16})`;
      ctx.fillRect(x + 18, y + 26 + i * 10, i % 4 === 0 ? 9 : 4, 2);
      ctx.fillStyle = 'rgba(137, 187, 184, 0.13)';
      ctx.fillRect(x + 34, y + 26 + i * 10, w - 52, 1);
    }
    ctx.strokeStyle = 'rgba(93, 160, 158, 0.15)';
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(x + w - 24, y + 32 + i * 19, 5, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(${ledColor}, 0.2)`;
      ctx.beginPath();
      ctx.arc(x + w - 24, y + 32 + i * 19, 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(127, 178, 176, 0.22)';
    ctx.font = '500 6px "SFMono-Regular", monospace';
    ctx.save();
    ctx.translate(x + 9, y + h - 12);
    ctx.fillText(`SRV-0${variant + 1}`, 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(4, 9, 12, 0.8)';
    ctx.fillRect(x + 4, y + h - 5, w - 8, 2);
    ctx.restore();
  }

  function drawTank(ctx, p) {
    const { x, y, r, variant } = p;
    const rng = mulberry32(p.seed * 2391 + 41);
    ctx.save();

    // Ambient glow.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(x, y, r * 0.45, x, y, r * 2.5);
    glow.addColorStop(0, variant ? 'rgba(80, 236, 205, 0.11)' : 'rgba(94, 227, 204, 0.09)');
    glow.addColorStop(1, 'rgba(74, 224, 193, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Base and shadow.
    ellipse(ctx, x + 7, y + 11, r + 9, r + 6, 'rgba(0,0,0,0.55)');
    ellipse(ctx, x, y, r + 10, r + 10, '#0b1719');
    ctx.strokeStyle = 'rgba(101, 148, 144, 0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ellipse(ctx, x, y, r + 4, r + 4, '#071113');

    // Tank liquid.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    const liquid = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.2);
    liquid.addColorStop(0, 'rgba(126, 255, 209, 0.35)');
    liquid.addColorStop(0.4, 'rgba(42, 162, 141, 0.25)');
    liquid.addColorStop(0.77, 'rgba(14, 76, 73, 0.5)');
    liquid.addColorStop(1, 'rgba(3, 24, 27, 0.9)');
    ctx.fillStyle = liquid;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    // Specimen silhouette.
    const t = rng() * TAU;
    ctx.save();
    ctx.translate(x, y + r * 0.1);
    ctx.rotate(t);
    ctx.strokeStyle = 'rgba(7, 33, 35, 0.52)';
    ctx.fillStyle = 'rgba(5, 26, 28, 0.4)';
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.46);
    ctx.bezierCurveTo(r * 0.24, -r * 0.32, r * 0.22, r * 0.22, r * 0.05, r * 0.58);
    ctx.bezierCurveTo(-r * 0.18, r * 0.32, -r * 0.25, -r * 0.08, -r * 0.09, -r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1 + i * r * 0.1);
      ctx.quadraticCurveTo(r * (rng() - 0.5) * 0.65, r * 0.08 + i * r * 0.05, r * (rng() - 0.35) * 0.6, r * 0.48);
      ctx.stroke();
    }
    ctx.restore();

    // Bubbles.
    for (let i = 0; i < 18; i += 1) {
      const a = rng() * TAU;
      const rr = Math.sqrt(rng()) * r * 0.82;
      const bx = x + Math.cos(a) * rr;
      const by = y + Math.sin(a) * rr;
      ctx.fillStyle = `rgba(151, 255, 224, ${0.05 + rng() * 0.12})`;
      ctx.beginPath();
      ctx.arc(bx, by, rng() * 2.4 + 0.5, 0, TAU);
      ctx.fill();
    }

    // Suspended particulate.
    for (let i = 0; i < 26; i += 1) {
      const a = rng() * TAU;
      const rr = Math.sqrt(rng()) * r * 0.9;
      ctx.fillStyle = `rgba(140, 248, 207, ${0.04 + rng() * 0.1})`;
      ctx.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 1.2, 1.2);
    }
    ctx.restore();

    // Glass rim and reflections.
    ctx.strokeStyle = 'rgba(159, 240, 225, 0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0.2, Math.PI * 0.86);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(225, 255, 247, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 6, 3.58, 5.22);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10, 51, 50, 0.46)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 2, 0, TAU);
    ctx.stroke();

    // Bolted brackets.
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const bx = x + Math.cos(a) * (r + 5);
      const by = y + Math.sin(a) * (r + 5);
      ctx.fillStyle = 'rgba(91, 132, 129, 0.42)';
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(5, 13, 16, 0.8)';
      ctx.beginPath();
      ctx.arc(bx, by, 1.2, 0, TAU);
      ctx.fill();
    }

    // Diagnosis plate.
    ctx.save();
    ctx.translate(x, y + r + 23);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(130, 176, 171, 0.28)';
    ctx.font = '500 7px "SFMono-Regular", monospace';
    ctx.fillText(p.label || 'SPECIMEN', 0, 0);
    ctx.fillStyle = 'rgba(255, 137, 92, 0.25)';
    ctx.fillRect(-18, 7, 36, 2);
    ctx.restore();
    ctx.restore();
  }

  function drawCryo(ctx, p) {
    const { x, y, r } = p;
    ctx.save();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.2);
    glow.addColorStop(0, 'rgba(99, 191, 255, 0.11)');
    glow.addColorStop(1, 'rgba(74, 140, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ellipse(ctx, x + 5, y + 8, r + 7, r + 5, 'rgba(0,0,0,0.5)');
    ellipse(ctx, x, y, r + 5, r + 5, '#0b171c');
    ctx.strokeStyle = 'rgba(108, 181, 209, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
    g.addColorStop(0, 'rgba(118, 223, 255, 0.4)');
    g.addColorStop(0.7, 'rgba(24, 99, 127, 0.35)');
    g.addColorStop(1, 'rgba(4, 27, 38, 0.9)');
    ellipse(ctx, x, y, r, r, g);
    ctx.strokeStyle = 'rgba(157, 227, 255, 0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r - 5, 3.7, 5.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(222, 250, 255, 0.55)';
    ctx.font = '500 6px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('H-02', x, y + 2);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU + Math.PI / 6;
      ctx.fillStyle = 'rgba(73, 111, 119, 0.45)';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3), 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPillar(ctx, p) {
    const { x, y, r } = p;
    ctx.save();
    ellipse(ctx, x + 5, y + 7, r + 7, r + 5, 'rgba(0,0,0,0.5)');
    ellipse(ctx, x, y, r + 5, r + 5, '#0a151a');
    ctx.strokeStyle = 'rgba(106, 151, 151, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ellipse(ctx, x, y, r, r, '#101e23');
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r - 1, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = 'rgba(196, 158, 94, 0.2)';
    ctx.lineWidth = 7;
    for (let i = -r; i < r * 2; i += 20) {
      ctx.beginPath();
      ctx.moveTo(x - r + i, y + r);
      ctx.lineTo(x - r + i + r * 2, y - r);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(9, 20, 24, 0.65)';
    ctx.fillRect(x - r + 5, y - r + 5, r * 2 - 10, r * 2 - 10);
    ctx.restore();
    ellipse(ctx, x, y, r - 10, r - 10, '#0c1b20');
    ctx.strokeStyle = 'rgba(149, 197, 193, 0.2)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(168, 199, 192, 0.28)';
    ctx.beginPath();
    ctx.arc(x - 9, y - 9, 2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 9, y + 9, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCrate(ctx, p) {
    const { x, y, w, h } = p;
    ctx.save();
    propShadow(ctx, x, y, w, h, 2);
    rrPath(ctx, x, y, w, h, 2);
    ctx.fillStyle = '#111b19';
    ctx.fill();
    rrPath(ctx, x + 2, y + 2, w - 4, h - 4, 1);
    const metal = ctx.createLinearGradient(x, y, x + w, y + h);
    metal.addColorStop(0, '#26352f');
    metal.addColorStop(0.55, '#17251f');
    metal.addColorStop(1, '#101a18');
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = 'rgba(155, 177, 158, 0.24)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(10, 16, 14, 0.58)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 7);
    ctx.lineTo(x + w - 7, y + h - 7);
    ctx.moveTo(x + w - 7, y + 7);
    ctx.lineTo(x + 7, y + h - 7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(166, 180, 151, 0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 7, y + 7, w - 14, h - 14);
    ctx.fillStyle = 'rgba(217, 178, 108, 0.36)';
    ctx.fillRect(x + w - 34, y + h - 17, 18, 7);
    ctx.fillStyle = 'rgba(5, 12, 11, 0.7)';
    ctx.font = '600 6px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.label || '07', x + w - 25, y + h - 11.5);
    ctx.fillStyle = 'rgba(153, 174, 154, 0.35)';
    for (const [cx, cy] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawConsole(ctx, p) {
    const { x, y, w, h } = p;
    ctx.save();
    propShadow(ctx, x, y, w, h, 3);
    rrPath(ctx, x, y, w, h, 2);
    ctx.fillStyle = '#0b171b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(119, 181, 183, 0.26)';
    ctx.stroke();
    rrPath(ctx, x + 5, y + 5, w - 10, h * 0.55, 1);
    ctx.fillStyle = '#061217';
    ctx.fill();
    ctx.strokeStyle = 'rgba(89, 220, 229, 0.24)';
    ctx.stroke();

    // Tiny terminal graph.
    ctx.strokeStyle = 'rgba(111, 236, 239, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const px = x + 10 + i * 7;
      const py = y + 18 + Math.sin(i * 1.4 + p.seed) * 7;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(128, 192, 188, 0.26)';
    ctx.font = '500 6px "SFMono-Regular", monospace';
    ctx.fillText(p.label || 'SECURITY', x + 8, y + h - 11);
    ctx.fillStyle = 'rgba(255, 128, 88, 0.38)';
    ctx.beginPath();
    ctx.arc(x + w - 14, y + 12, 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(135, 164, 158, 0.16)';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(x + 9 + i * 12, y + h * 0.7, 7, 3);
    ctx.restore();
  }

  /* ------------------------------------------------------------
     Weapons and upgrade definitions
     ------------------------------------------------------------ */
  const WEAPON_ORDER = ['pistol', 'smg', 'ar', 'lmg', 'rocket'];
  const WEAPONS = {
    pistol: {
      id: 'pistol',
      name: '制式手枪',
      short: '手枪',
      code: 'M9-K // SIDEARM',
      slotLabel: 'SIDEARM',
      classLabel: 'STARTER PLATFORM · 初始配发',
      price: 0,
      desc: '可靠、轻便、永不缺席的制式副武器。',
      damage: 27,
      fireDelay: 0.235,
      mag: 12,
      reload: 1.14,
      spread: 1.8,
      bloom: 1.1,
      bulletSpeed: 1760,
      range: 940,
      mobility: 1,
      modCost: 45,
      tracer: '255, 222, 142',
      gunLength: 25,
    },
    smg: {
      id: 'smg',
      name: '冲锋枪',
      short: '冲锋枪',
      code: 'VX-9 // SUBMACHINE',
      slotLabel: 'PRIMARY',
      classLabel: 'CLOSE QUARTERS · 近距压制',
      price: 350,
      desc: '高射速近距武器，适合快速清空狭长走廊。',
      damage: 15,
      fireDelay: 0.072,
      mag: 32,
      reload: 1.42,
      spread: 4.1,
      bloom: 0.72,
      bulletSpeed: 1700,
      range: 790,
      mobility: 1,
      modCost: 70,
      tracer: '137, 255, 243',
      gunLength: 30,
    },
    ar: {
      id: 'ar',
      name: '突击步枪',
      short: '步枪',
      code: 'AR-14 // ASSAULT RIFLE',
      slotLabel: 'PRIMARY',
      classLabel: 'ALL-RANGE PLATFORM · 全能火力',
      price: 950,
      desc: '均衡的中距火力平台，精准、稳定、致命。',
      damage: 29,
      fireDelay: 0.108,
      mag: 30,
      reload: 1.7,
      spread: 2.2,
      bloom: 0.62,
      bulletSpeed: 2020,
      range: 1080,
      mobility: 0.96,
      modCost: 120,
      tracer: '255, 230, 167',
      gunLength: 38,
    },
    lmg: {
      id: 'lmg',
      name: '轻机枪',
      short: '机枪',
      code: 'M250-X // LIGHT MG',
      slotLabel: 'HEAVY',
      classLabel: 'SUSTAINED FIRE · 重型压制',
      price: 2600,
      desc: '超大弹链与持续火力，代价是机动与装填速度。',
      damage: 21,
      fireDelay: 0.07,
      mag: 90,
      reload: 3.2,
      spread: 3.2,
      bloom: 0.92,
      bulletSpeed: 1860,
      range: 1020,
      mobility: 0.84,
      modCost: 180,
      tracer: '255, 178, 116',
      gunLength: 43,
    },
    rocket: {
      id: 'rocket',
      name: '火箭筒',
      short: '火箭筒',
      code: 'X-R9 // ROCKET LAUNCHER',
      slotLabel: 'DEMOLITION',
      classLabel: 'AREA DENIAL · 范围爆破',
      price: 5200,
      desc: '高爆火箭，直接命中造成巨额伤害并引发范围爆炸。',
      damage: 118,
      fireDelay: 0.58,
      mag: 4,
      reload: 3.8,
      spread: 2.6,
      bloom: 0.9,
      bulletSpeed: 820,
      range: 1450,
      mobility: 0.78,
      modCost: 260,
      tracer: '255, 170, 95',
      gunLength: 46,
      projectile: 'rocket',
      splashDamage: 92,
      splashRadius: 132,
    },
  };

  const MOD_KEYS = ['mag', 'barrel', 'scope', 'stock'];
  const MODS = {
    mag: {
      name: '弹夹',
      code: 'MAGAZINE',
      desc: '扩容供弹机构',
      max: 4,
      costMul: 1,
      effect: (level) => `弹匣容量 +${level * 25}%`,
    },
    barrel: {
      name: '枪管',
      code: 'BARREL',
      desc: '强化膛线与枪口',
      max: 4,
      costMul: 1.16,
      effect: (level) => `子弹伤害 +${level * 14}%`,
    },
    scope: {
      name: '瞄准镜',
      code: 'OPTIC',
      desc: '缩短弹道散布',
      max: 4,
      costMul: 1.08,
      effect: (level) => `射击散布 -${level * 12}%`,
    },
    stock: {
      name: '枪托',
      code: 'STOCK',
      desc: '改善后坐与装填',
      max: 4,
      costMul: 1,
      effect: (level) => `装填 +${level * 7}% · 后坐 -${level * 10}%`,
    },
  };

  const MOD_ICONS = {
    mag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5h7v11h-7zM9 7h4M9 10.5h4M11 14.5V18h6l1.5-3.5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    barrel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h14v4H3zM17 8.5h4v7h-4M7 14v3.5h5V14M9.5 7V3.5M13.5 7V5" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    scope: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9v6M9 12h6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
    stock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h13l5 5-5 5H3l3-5-3-5Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M7 9.5h7M7 14.5h7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  };

  const LOCK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 5V3.8a3 3 0 0 1 6 0V5m-7 0h8v6H2z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

  function weaponIcon(id) {
    if (id === 'pistol') {
      return `<svg viewBox="0 0 120 46" aria-hidden="true">
        <g fill="currentColor">
          <path d="M25 13h49l12 4v11H69l-7 12H44l4-12H25z" opacity=".82"/>
          <path d="M76 15h30v6H76z"/>
          <path d="M50 28l-5 13h15l5-11z" opacity=".52"/>
          <path d="M34 6h28v4H34z" opacity=".24"/>
          <circle cx="63" cy="31" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".36"/>
          <path d="M29 17h7v3h-7z" opacity=".4"/>
        </g>
      </svg>`;
    }
    if (id === 'smg') {
      return `<svg viewBox="0 0 120 46" aria-hidden="true">
        <g fill="currentColor">
          <path d="M5 16h19v9H5zM22 12h57v17H70l-5 11H49l4-13H22z" opacity=".82"/>
          <path d="M78 16h32v6H78z"/>
          <path d="M46 28l-4 12h12l5-12z" opacity=".52"/>
          <path d="M31 25l-4 11h11l4-10z"/>
          <path d="M29 8h39v4H29z" opacity=".26"/>
          <path d="M8 19h12v2H8z" opacity=".42"/>
          <circle cx="58" cy="29" r="5" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".34"/>
        </g>
      </svg>`;
    }
    if (id === 'ar') {
      return `<svg viewBox="0 0 120 46" aria-hidden="true">
        <g fill="currentColor">
          <path d="M3 15h18v10H3zM19 11h56v17H62l-4 12H45l3-13H19z" opacity=".82"/>
          <path d="M74 14h20v8H74z"/>
          <path d="M93 16h25v5H93z"/>
          <path d="M42 28l-4 12h12l4-11z" opacity=".5"/>
          <path d="M29 25l-4 12h10l3-11z"/>
          <path d="M43 5h26v5H43z" opacity=".28"/>
          <path d="M53 5v5M78 6h11v4H78z" opacity=".4"/>
          <path d="M114 12v13" stroke="currentColor" stroke-width="2" opacity=".5"/>
        </g>
      </svg>`;
    }
    if (id === 'lmg') {
      return `<svg viewBox="0 0 120 46" aria-hidden="true">
        <g fill="currentColor">
          <path d="M3 14h17v12H3zM18 10h58v20H66l-4 11H50l3-12H18z" opacity=".82"/>
          <path d="M74 14h20v10H74zM92 15h24v7H92z"/>
          <path d="M34 30l-4 12h12l4-11z" opacity=".52"/>
          <path d="M29 26l-4 12h10l3-11z"/>
          <path d="M45 4h31v5H45z" opacity=".25"/>
          <circle cx="38" cy="34" r="12" fill="none" stroke="currentColor" stroke-width="3.2" opacity=".35"/>
          <path d="M82 24l-5 13M98 24l5 13" stroke="currentColor" stroke-width="1.6" opacity=".55"/>
          <path d="M108 8v8" stroke="currentColor" stroke-width="2" opacity=".4"/>
        </g>
      </svg>`;
    }
    return `<svg viewBox="0 0 120 46" aria-hidden="true">
      <g fill="currentColor">
        <path d="M5 17h64v13H5zM23 30l-3 9h17l-4-9z" opacity=".82"/>
        <path d="M69 15h27v6H69z" opacity=".45"/>
        <path d="M96 12h17v12H96z" opacity=".9"/>
        <path d="M113 15l7 3-7 3z"/>
        <path d="M18 12h35v5H18z" opacity=".3"/>
        <path d="M33 8h18v4H33zM47 5h6v3h-6z" opacity=".5"/>
        <circle cx="39" cy="31" r="9" fill="none" stroke="currentColor" stroke-width="2.8" opacity=".35"/>
        <path d="M8 24h43M12 20h20" stroke="currentColor" stroke-width="1.2" opacity=".5"/>
      </g>
    </svg>`;
  }

  const lockIcon = LOCK_ICON;

  /* ------------------------------------------------------------
     Neural talent tree
     ------------------------------------------------------------ */
  const TALENT_TIER_LABEL = {
    1: 'I · 常规',
    2: 'II · 中级',
    3: 'III · 高级',
    4: 'IV · 终极',
  };

  const TALENT_BRANCHES = [
    {
      id: 'survival',
      name: '生存协议',
      code: 'A // SURVIVAL',
      color: 'cyan',
      talents: ['respawn', 'shield', 'salvage', 'creditMagnet'],
    },
    {
      id: 'mobility',
      name: '机动协议',
      code: 'B // MOBILITY',
      color: 'amber',
      talents: ['overdrive', 'dualWield', 'fleetfoot'],
    },
    {
      id: 'firepower',
      name: '火力协议',
      code: 'C // FIREPOWER',
      color: 'violet',
      talents: ['turret', 'highPressure', 'fastReload', 'intelligenceCore'],
    },
    {
      id: 'sentinel',
      name: '哨戒协议',
      code: 'D // SENTRY',
      color: 'green',
      talents: ['turretBurst', 'turretGatling', 'turretRocket', 'turretLaser', 'turretOvercharge', 'turretServo', 'turretSwarm', 'turretCooling', 'turretTaunt', 'turretRepair'],
    },
    {
      id: 'demolition',
      name: '爆破协议',
      code: 'E // DEMOLITION',
      color: 'orange',
      talents: ['grenadeVolley', 'grenadeDamage', 'grenadeRadius', 'grenadeCapacity', 'grenadeFree'],
    },
  ];

  const TALENTS = {
    salvage: {
      id: 'salvage',
      name: '资源回收',
      code: 'RECLAMATION',
      tier: 1,
      cost: 1,
      branch: 'survival',
      requires: [],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 18V6m0 12c4.5-8 11-2 16-9M16 4h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.4" fill="currentColor"/><circle cx="12" cy="13.5" r="1.4" fill="currentColor"/></svg>',
      desc: '回收实验体的信用点与战斗数据。',
      effect: '信用点与经验收益 +20%',
    },
    creditMagnet: {
      id: 'creditMagnet', name: '强力吸附', code: 'MAGNETIC PULL', tier: 1, cost: 2, branch: 'survival', requires: ['salvage'],
      icon: '<svg viewBox="0 0 24 24"><path d="M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4H5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 7h4M15 7h4M12 12v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      desc: '接入回收机构的强力磁场，让整张地图上的信用点高速飞向干员。', effect: '全图信用点极速吸附收集',
    },
    fleetfoot: {
      id: 'fleetfoot',
      name: '轻装疾行',
      code: 'LIGHTFOOT',
      tier: 1,
      cost: 1,
      branch: 'mobility',
      requires: [],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 17h6l2-4 2 2 6-2M4 11h4l2-3 3 1 2-3M3 20h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      desc: '减轻外骨骼负荷，提升战术移动效率。',
      effect: '移动速度 +8%',
    },
    fastReload: {
      id: 'fastReload',
      name: '快速装填',
      code: 'QUICKHAND',
      tier: 1,
      cost: 1,
      branch: 'firepower',
      requires: [],
      icon: '<svg viewBox="0 0 24 24"><path d="M5 8V5h5M5 5l4 4M19 16v3h-5m5 0-4-4M8 9h8v6H8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12h4" stroke="currentColor" stroke-width="1.4"/></svg>',
      desc: '神经反射与自动供弹机构同步，缩短换弹动作。',
      effect: '装填速度 +15%',
    },
    highPressure: {
      id: 'highPressure',
      name: '高压弹头',
      code: 'HYPER VELOCITY',
      tier: 2,
      cost: 2,
      branch: 'firepower',
      requires: ['fastReload'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 12h9M13 12l-3-3m3 3-3 3M16 8h4M16 12h6M16 16h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
      desc: '超压装药与高密度弹芯，强化所有已装配武器的直接伤害。',
      effect: '所有武器伤害 +12%',
    },
    overdrive: {
      id: 'overdrive',
      name: '战术超频',
      code: 'OVERCLOCK',
      tier: 3,
      cost: 4,
      branch: 'mobility',
      requires: ['dualWield'],
      icon: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M19 4v3M17.5 5.5h3M19 19v3M17.5 20.5h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
      desc: '超频神经接口与战术终端，缩短主动战术技能的冷却时间。',
      effect: '哨戒炮塔 / 紧急重构冷却 -20%',
    },
    shield: {
      id: 'shield',
      name: '相位护盾',
      code: 'PHASE SHIELD',
      tier: 2,
      cost: 2,
      branch: 'survival',
      requires: ['salvage'],
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 4-3.3 7-8 9-4.7-2-8-5-8-9V6l8-3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m8.5 12 2.2 2.1 4.8-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      desc: '展开一层能量护盾，优先承受伤害。护盾被击破后会进入充能冷却，然后逐步恢复。',
      effect: '护盾 70 · 破裂冷却 8s · 恢复 22/s',
    },
    dualWield: {
      id: 'dualWield',
      name: '战术双持',
      code: 'DUAL LINK',
      tier: 2,
      cost: 3,
      branch: 'mobility',
      requires: ['fleetfoot'],
      icon: '<svg viewBox="0 0 24 24"><path d="M3 8h7v4H3zM6 12v4M5 16h3M14 8h7v4h-7zM18 12v4M17 16h3M12 5v14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      desc: '双持两把武器。左键控制主手，右键控制副手；两把武器独立射击与装填。',
      effect: '左键 / 右键独立开火 · 右键武器槽更换副手',
    },
    respawn: {
      id: 'respawn',
      name: '紧急重构',
      code: 'RECONSTRUCTION',
      tier: 3,
      cost: 5,
      branch: 'survival',
      requires: ['shield'],
      icon: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.2-5.5M20 3v5h-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 7.5v5l3.2 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M9 3.5h6" stroke="currentColor" stroke-width="1.3"/></svg>',
      desc: '致命伤害时不会立刻阵亡，而是进入 5 秒紧急重构。重构期间拥有 35% 生命、无法攻击，再次倒下即永久死亡。',
      effect: '触发间隔 50s · 重构后恢复 55% 生命',
    },
    turret: {
      id: 'turret',
      name: '哨戒炮塔',
      code: 'SENTRY TURRET',
      tier: 3,
      cost: 4,
      branch: 'firepower',
      requires: ['highPressure'],
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="13" r="1.7" fill="currentColor"/><path d="M12 8.5V5M7.5 13H4M20 13h-3.5M10 18h4l1.4 3H8.6l1.4-3Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      desc: '按 F 在准星方向部署自动哨戒炮塔，持续搜索并攻击实验体。',
      effect: '初始单点射击 · 可继续升级',
    },
    turretBurst: {
      id: 'turretBurst', name: '三连点射', code: 'TRI-BURST', tier: 3, cost: 2, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 7h6M4 12h9M4 17h6M14 5v14M18 7v10M21 10v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      desc: '炮塔加装三连发供弹机构，每次锁定发射三发子弹。', effect: '炮塔转为三连点射 · 伤害与耐久提高',
    },
    turretGatling: {
      id: 'turretGatling', name: '加特林枪管', code: 'GATLING', tier: 3, cost: 3, branch: 'sentinel', requires: ['turretBurst'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 6h3v12H4zM8 5h3v14H8zM12 7h3v10h-3zM16 6h3v12h-3zM19 10h2v4h-2Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
      desc: '换装旋转枪管，以极高射速压制靠近的敌人。', effect: '炮塔转为加特林连射 · 射速大幅提高',
    },
    turretRocket: {
      id: 'turretRocket', name: '炮塔火箭巢', code: 'ROCKET POD', tier: 3, cost: 3, branch: 'sentinel', requires: ['turretGatling'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 8h13l4 4-4 4H4zM7 5l3 3M7 19l3-3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="12" r="1.4" fill="currentColor"/></svg>',
      desc: '外挂微型火箭巢，发射带范围伤害的追踪火箭。', effect: '炮塔发射火箭 · 范围爆炸伤害',
    },
    turretLaser: {
      id: 'turretLaser', name: '聚焦激光', code: 'FOCUS LASER', tier: 3, cost: 5, branch: 'sentinel', requires: ['turretRocket'],
      icon: '<svg viewBox="0 0 24 24"><path d="M4 12h8M12 12l7-5M12 12l7 5M12 12l9 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="4" cy="12" r="2" fill="currentColor"/></svg>',
      desc: '把炮塔核心换成聚焦激光发射器，瞬间灼烧锁定目标。', effect: '炮塔转为瞬发激光 · 伤害与耐久最高',
    },
    turretSwarm: {
      id: 'turretSwarm', name: '蜂群部署', code: 'SWARM DEPLOY', tier: 3, cost: 4, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="17" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 9.5 11 15M15 9.5 13 15M9 8h6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
      desc: '扩展战术终端部署槽，允许同时维持三座炮塔。', effect: '炮塔上限 3 座 · 部署冷却缩短',
    },
    turretCooling: {
      id: 'turretCooling', name: '低温循环', code: 'CRYO LOOP', tier: 3, cost: 2, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4 8l16 8M20 8 4 16M8 5l4 3 4-3M8 19l4-3 4 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      desc: '用低温循环带走炮塔核心热量，缩短重新部署等待。', effect: '炮塔冷却 -30%',
    },
    turretTaunt: {
      id: 'turretTaunt', name: '嘲讽信标', code: 'TAUNT BEACON', tier: 3, cost: 3, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l7 4V5L9 9H5Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M19 9a4 4 0 0 1 0 6M21 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      desc: '在炮塔周围广播高优先级仇恨信标，使敌人优先攻击炮塔。', effect: '敌人优先攻击炮塔',
    },
    turretRepair: {
      id: 'turretRepair', name: '纳米修复', code: 'NANO REPAIR', tier: 3, cost: 3, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3 20 6v6c0 4-3.3 7-8 9-4.7-2-8-5-8-9V6l8-3Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      desc: '在炮塔内部署纳米修复群，持续修补装甲与结构。', effect: '炮塔每秒自我修复 2.5% 最大生命',
    },
    turretOvercharge: {
      id: 'turretOvercharge', name: '超载电容', code: 'OVERCHARGE', tier: 3, cost: 3, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 5h3M5.5 3.5v3M17 19h3M18.5 17.5v3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
      desc: '为炮塔核心加装超载电容，提高所有攻击模式的单次伤害。', effect: '炮塔伤害 +25%',
    },
    turretServo: {
      id: 'turretServo', name: '高速伺服', code: 'SERVO DRIVE', tier: 3, cost: 2, branch: 'sentinel', requires: ['turret'],
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3M8 8l2 2M16 16l-2-2M16 8l-2 2M8 16l2-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      desc: '升级炮塔回转伺服与供弹节拍，提高攻击频率。', effect: '炮塔攻击速度 +20%',
    },
    grenadeVolley: {
      id: 'grenadeVolley', name: '多重投掷', code: 'MULTI THROW', tier: 1, cost: 2, branch: 'demolition', requires: [],
      icon: '<svg viewBox="0 0 24 24"><path d="M7 5h4v3H7zM5 8c-3 0-3 5 1 5s4-5 1-5ZM15 8h4v3h-4zM13 11c-3 0-3 5 1 5s4-5-1-5Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 5l2-2M17 8l2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      desc: '一次性拉出两枚手雷的保险，向准星两侧同时投掷。', effect: '每次投掷 2 枚手雷 · 消耗 2 枚库存',
    },
    grenadeDamage: {
      id: 'grenadeDamage', name: '高爆装药', code: 'HIGH EXPLOSIVE', tier: 1, cost: 2, branch: 'demolition', requires: ['grenadeVolley'],
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3c2 4-2 5 0 8 2-1 3-3 3-5 3 2 4 5 3 8-1 3-3 5-6 5s-6-2-7-5c-1-3 1-5 3-7 0 2 1 3 2 4 0-3 3-5 2-8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
      desc: '更换高爆装药与破片衬层，提升所有手雷的爆炸伤害。', effect: '手雷伤害 +35%',
    },
    grenadeRadius: {
      id: 'grenadeRadius', name: '扩爆外壳', code: 'WIDE BLAST', tier: 2, cost: 2, branch: 'demolition', requires: ['grenadeDamage'],
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="2 3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      desc: '使用预刻槽扩爆外壳，把破片与冲击波推得更远。', effect: '手雷爆炸范围 +25%',
    },
    grenadeCapacity: {
      id: 'grenadeCapacity', name: '扩容携行袋', code: 'BANDOLIER', tier: 2, cost: 2, branch: 'demolition', requires: ['grenadeVolley'],
      icon: '<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5zM8 9h8M8 13h8M8 17h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 5V3h8v2" stroke="currentColor" stroke-width="1.2"/></svg>',
      desc: '增加战术背心的手雷挂袋与保险隔层。', effect: '每种手雷库存上限 +3',
    },
    grenadeFree: {
      id: 'grenadeFree', name: '饱和轰炸', code: 'SATURATION', tier: 3, cost: 6, branch: 'demolition', requires: ['grenadeRadius', 'grenadeCapacity'],
      icon: '<svg viewBox="0 0 24 24"><path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 6v8M8 10l4-4 4 4M8 16h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      desc: '当一次爆炸同时命中至少 10 个敌人时，战术终端自动返还本次消耗的手雷。', effect: '单次爆炸命中 ≥10 敌人 · 不消耗手雷',
    },
    intelligenceCore: {
      id: 'intelligenceCore', name: '智慧核心', code: 'INTELLIGENCE CORE', tier: 4, cost: 6, branch: 'firepower', requires: ['highPressure'],
      icon: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
      desc: '把靶场采集到的弹道数据接入干员视网膜，自动锁定最接近准星的敌人。', effect: '解锁自动瞄准 · 按 U 开关',
    },
  };
  const TALENT_ORDER = ['salvage', 'fleetfoot', 'fastReload', 'shield', 'creditMagnet', 'highPressure', 'dualWield', 'turret', 'overdrive', 'respawn', 'turretBurst', 'turretGatling', 'turretRocket', 'turretLaser', 'turretOvercharge', 'turretServo', 'turretSwarm', 'turretCooling', 'turretTaunt', 'turretRepair', 'intelligenceCore', 'grenadeVolley', 'grenadeDamage', 'grenadeRadius', 'grenadeCapacity', 'grenadeFree'];
  const TALENT_TOTAL_COST = TALENT_ORDER.reduce((sum, id) => sum + TALENTS[id].cost, 0);

  const TURRET_TIERS = [
    { id: 'single', name: '单点', code: 'SINGLE', hp: 180, life: 22, damage: 13, interval: 0.31, color: '145, 255, 218' },
    { id: 'burst', name: '连发', code: 'BURST', hp: 240, life: 25, damage: 16, interval: 0.58, burst: 3, burstInterval: 0.075, color: '153, 255, 202' },
    { id: 'gatling', name: '加特林', code: 'GATLING', hp: 310, life: 28, damage: 11, interval: 0.075, spread: 0.075, color: '173, 255, 206' },
    { id: 'rocket', name: '火箭炮', code: 'ROCKET', hp: 390, life: 31, damage: 52, interval: 0.9, rocket: true, splashDamage: 45, splashRadius: 92, color: '255, 196, 115' },
    { id: 'laser', name: '激光', code: 'LASER', hp: 500, life: 35, damage: 38, interval: 0.16, laser: true, color: '170, 240, 255' },
  ];

  function turretTierIndex() {
    if (hasTalent('turretLaser')) return 4;
    if (hasTalent('turretRocket')) return 3;
    if (hasTalent('turretGatling')) return 2;
    if (hasTalent('turretBurst')) return 1;
    return 0;
  }

  function turretTierDef() {
    return TURRET_TIERS[turretTierIndex()];
  }

  function turretLimit() {
    return hasTalent('turretSwarm') ? 3 : 1;
  }

  function turretDeployCooldown() {
    let cooldown = 25 * skillCooldownMultiplier();
    if (hasTalent('turretSwarm')) cooldown *= 0.5;
    if (hasTalent('turretCooling')) cooldown *= 0.7;
    return cooldown;
  }

  function turretDamageMultiplier() {
    return hasTalent('turretOvercharge') ? 1.25 : 1;
  }

  function turretAttackRateMultiplier() {
    return hasTalent('turretServo') ? 1.2 : 1;
  }

  function turretShotDamage(turret) {
    return (turret?.damage || 0) * turretDamageMultiplier();
  }

  const TURRET_LINK_RANGE = 280;
  const TURRET_LINK_DAMAGE = [1, 1, 3.2, 5.5];
  const TURRET_LINK_INTERVAL = [1, 1, 1.4, 1.75];

  const GRENADE_ORDER = ['frag', 'flash', 'incendiary'];
  const GRENADES = {
    frag: {
      id: 'frag',
      name: '破片手雷',
      code: 'FRAG',
      desc: '高爆破片，中心伤害最高。',
      price: 120,
      pack: 3,
      max: 9,
      damage: 168,
      radius: 156,
      fuse: 1.05,
      color: '255, 151, 82',
      icon: '<svg viewBox="0 0 24 24"><path d="M10 4h4v3h-4zM12 7c-4 0-7 3.2-7 7.1C5 18.4 8 21 12 21s7-2.6 7-6.9C19 10.2 16 7 12 7Z" fill="none" stroke="currentColor" stroke-width="1.45"/><path d="M7.7 11.1h8.6M6.6 15.2h10.8M9 8.4v11M13 8.4v11M16 9.5v8" fill="none" stroke="currentColor" stroke-width="1.05" opacity=".75"/><path d="m12 4 3-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    },
    flash: {
      id: 'flash',
      name: '闪光弹',
      code: 'FLASH',
      desc: '释放致盲冲击，短暂瘫痪范围内的实验体。',
      price: 95,
      pack: 2,
      max: 6,
      damage: 0,
      radius: 190,
      fuse: 0.85,
      stun: 3.5,
      color: '195, 246, 255',
      icon: '<svg viewBox="0 0 24 24"><path d="m12 2 2.2 6.1L20 5l-2.3 5.5L23 12l-5.8 1.7L20 19l-5.8-2.8L12 22l-2.2-5.8L4 19l2.3-5.3L1 12l5.3-1.5L4 5l5.8 3.1L12 2Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>',
    },
    incendiary: {
      id: 'incendiary',
      name: '燃烧弹',
      code: 'THERMITE',
      desc: '在地面制造持续 5 秒的燃烧区，持续伤害范围内的敌人。',
      price: 150,
      pack: 2,
      max: 6,
      damage: 12,
      radius: 112,
      fuse: 0.75,
      duration: 5,
      color: '255, 103, 55',
      icon: '<svg viewBox="0 0 24 24"><path d="M13 2c1.4 4.8-2.7 5.4-1.1 8.3 1.9-.7 2.4-2.2 2.7-4.2 3.2 2.4 4.4 5.1 3.5 8.3-.8 3-3.1 5.4-6.2 5.6-3.2.2-5.8-2-6.1-5.1-.3-3 1.4-4.9 3.3-6.9-.1 2.2.4 3.4 1.5 4.1C10.7 7.4 15.1 5.1 13 2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    },
  };

  /* ------------------------------------------------------------
     DOM references
     ------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const dom = {
    root: $('game-root'),
    introOverlay: $('intro-overlay'),
    introKicker: $('intro-kicker'),
    introLine: $('intro-line'),
    introSubline: $('intro-subline'),
    introTitle: $('intro-title'),
    introCounter: $('intro-counter'),
    introEnter: $('btn-intro-enter'),
    introSkip: $('btn-intro-skip'),
    canvas: $('game'),
    hud: $('hud'),
    damageVignette: $('damage-vignette'),
    hitFlash: $('hit-flash'),
    level: $('stat-level'),
    hpFill: $('hp-fill'),
    agentName: $('agent-name'),
    hpText: $('hp-text'),
    xpFill: $('xp-fill'),
    xpText: $('xp-text'),
    speed: $('stat-speed'),
    reloadStat: $('stat-reload'),
    kills: $('stat-kills'),
    credits: $('stat-credits'),
    statTalents: $('stat-talents'),
    btnTalents: $('btn-talents'),
    talentBadge: $('talent-badge'),
    shieldRow: $('shield-row'),
    shieldText: $('shield-text'),
    shieldFill: $('shield-fill'),
    abilityBar: $('ability-bar'),
    btnCharacterSkill: $('btn-character-skill'),
    characterSkillName: $('character-skill-name'),
    characterSkillStatus: $('character-skill-status'),
    characterSkillFill: $('character-skill-fill'),
    btnTurret: $('btn-turret'),
    turretStatus: $('turret-status'),
    turretFill: $('turret-fill'),
    respawnChip: $('respawn-chip'),
    respawnStatus: $('respawn-status'),
    offhandHud: $('offhand-hud'),
    offhandName: $('offhand-name'),
    offhandState: $('offhand-state'),
    offhandAmmo: $('offhand-ammo'),
    reviveHud: $('revive-hud'),
    reviveCount: $('revive-count'),
    grenadeSlots: $('grenade-slots'),
    grenadeCurrentName: $('grenade-current-name'),
    grenadeList: $('grenade-list'),
    interTalentRow: $('inter-talent-row'),
    interTalentPoints: $('inter-talent-points'),
    btnInterTalents: $('btn-inter-talents'),
    reviveFill: $('revive-fill'),
    talentOverlay: $('talent-overlay'),
    talentClose: $('talent-close'),
    talentPoints: $('talent-points'),
    talentLevel: $('talent-level'),
    talentSpent: $('talent-spent'),
    talentUnlockedCount: $('talent-unlocked-count'),
    talentEarned: $('talent-earned'),
    talentBonusList: $('talent-bonus-list'),
    talentTree: $('talent-tree'),
    talentTotalCost: $('talent-total-cost'),
    waveTitle: $('wave-title'),
    missionKicker: $('mission-kicker'),
    missionState: $('mission-state'),
    hudDifficulty: $('hud-difficulty'),
    difficultyLabel: $('difficulty-label'),
    difficultyDesc: $('difficulty-desc'),
    bestBreakdown: $('best-breakdown'),
    recordLabel: $('record-label'),
    startLabel: $('start-label'),
    startSub: $('start-sub'),
    briefTitle: $('brief-title'),
    briefCopy: $('brief-copy'),
    briefWarning: $('brief-warning'),
    hostileList: $('hostile-list'),
    controlDual: $('control-dual'),
    controlShop: $('control-shop'),
    controlTech: $('control-tech'),
    grenadeShopHelp: $('grenade-shop-help'),
    shopHelp: $('shop-help'),
    pauseHint: $('pause-hint'),
    fieldHint: $('field-hint'),
    grenadeSwitchHelp: $('grenade-switch-help'),
    campaignUpgradeSection: $('campaign-upgrade-section'),
    campaignUpgradeList: $('campaign-upgrade-list'),
    bossName: $('boss-name'),
    bossCode: $('boss-code'),
    bossTag: $('boss-tag'),
    bossDesc: $('boss-desc'),
    campaignComplete: $('campaign-complete-overlay'),
    campaignTime: $('campaign-time'),
    campaignKills: $('campaign-kills'),
    campaignSearches: $('campaign-searches'),
    campaignCredits: $('campaign-credits'),
    campaignGrade: $('campaign-grade'),
    campaignRecord: $('campaign-record'),
    campaignTokenLine: $('campaign-tokenline'),
    btnCampaignAgain: $('btn-campaign-again'),
    btnCampaignMenu: $('btn-campaign-menu'),
    threatFill: $('threat-fill'),
    enemyCount: $('enemy-count'),
    threatLabel: $('threat-label'),
    btnAudio: $('btn-audio'),
    btnFullscreen: $('btn-fullscreen'),
    btnPause: $('btn-pause'),
    btnSpeed: $('btn-speed'),
    speedLabel: $('speed-label'),
    btnSettings: $('btn-settings'),
    settingsOverlay: $('settings-overlay'),
    btnSettingsClose: $('btn-settings-close'),
    btnSettingsBack: $('btn-settings-back'),
    settingsFootHint: $('settings-foot-hint'),
    settingsMute: $('settings-mute'),
    settingsMuteLabel: $('settings-mute-label'),
    settingsSfx: $('settings-sfx'),
    settingsMusic: $('settings-music'),
    settingsSfxValue: $('settings-sfx-value'),
    settingsMusicValue: $('settings-music-value'),
    settingsQualityNote: $('settings-quality-note')?.querySelector('span'),
    settingsRenderScale: $('settings-render-scale'),
    developerCard: $('developer-card'),
    devModeState: $('dev-mode-state'),
    devModeBadge: $('dev-mode-badge'),
    devPassword: $('dev-password'),
    btnDevEnable: $('btn-dev-enable'),
    btnDevDisable: $('btn-dev-disable'),
    devMessage: $('dev-message'),
    minimap: $('minimap'),
    minimapSector: $('minimap-sector'),
    bossHud: $('boss-hud'),
    bossHpFill: $('boss-hp-fill'),
    bossHpText: $('boss-hp-text'),
    bossPhase: $('boss-phase'),
    banner: $('wave-banner'),
    bannerKicker: $('banner-kicker'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    toastStack: $('toast-stack'),
    intermission: $('intermission-card'),
    interReward: $('intermission-reward'),
    interTitle: $('intermission-title'),
    interSub: $('intermission-sub'),
    nextCountdown: $('next-countdown'),
    btnNextWave: $('btn-next-wave'),
    btnInterShop: $('btn-inter-shop'),
    dashFill: $('dash-fill'),
    weaponSlots: $('weapon-slots'),
    btnShop: $('btn-shop'),
    weaponSlotLabel: $('weapon-slot-label'),
    weaponName: $('weapon-name'),
    weaponCode: $('weapon-code'),
    dashLabel: $('dash-label'),
    ammoMag: $('ammo-mag'),
    ammoCount: document.querySelector('.ammo-count'),
    reloadLabel: $('reload-label'),
    reloadTrack: $('reload-track'),
    reloadFill: $('reload-fill'),
    reloadLine: document.querySelector('.reload-line'),
    menu: $('menu-screen'),
    btnStart: $('btn-start'),
    btnClearCheckpoint: $('btn-clear-checkpoint'),
    trainingPanel: $('training-panel'),
    trainingDps: $('training-dps'),
    trainingTotal: $('training-total'),
    trainingDummyHp: $('training-dummy-hp'),
    storyOverlay: $('story-overlay'),
    storyBg: $('story-bg'),
    storyChapter: $('story-chapter'),
    storyProgress: $('story-progress'),
    storyLocation: $('story-location'),
    storyPortrait: $('story-portrait'),
    storySpeaker: $('story-speaker'),
    storyRole: $('story-role'),
    storyText: $('story-text'),
    storyChoices: $('story-choices'),
    storyContinue: $('story-continue'),
    btnStoryExit: $('btn-story-exit'),
    btnMenuAudio: $('btn-menu-audio'),
    btnMenuSettings: $('btn-menu-settings'),
    btnMenuCharacters: $('btn-menu-characters'),
    btnMenuBestiary: $('btn-menu-bestiary'),
    charactersOverlay: $('characters-overlay'),
    btnCharactersClose: $('btn-characters-close'),
    characterGrid: $('character-grid'),
    petGrid: $('pet-grid'),
    characterTokenCount: $('character-token-count'),
    characterCurrent: $('character-current'),
    petCurrent: $('pet-current'),
    bestiaryOverlay: $('bestiary-overlay'),
    btnBestiaryClose: $('btn-bestiary-close'),
    bestiaryGrid: $('bestiary-grid'),
    bestiaryFilters: $('bestiary-filters'),
    bestiaryCount: $('bestiary-count'),
    menuAudioHint: $('menu-audio-hint'),
    bestWave: $('best-wave'),
    bestCopy: $('best-copy'),
    shopOverlay: $('shop-overlay'),
    shopClose: $('shop-close'),
    shopCredits: $('shop-credits'),
    weaponList: $('weapon-list'),
    benchArt: $('bench-weapon-art'),
    benchCode: $('bench-code'),
    benchName: $('bench-name'),
    benchDesc: $('bench-desc'),
    benchDps: $('bench-dps'),
    modGrid: $('mod-grid'),
    btnBuyMedkit: $('btn-buy-medkit'),
    shopHp: $('shop-hp'),
    pauseOverlay: $('pause-overlay'),
    pauseWave: $('pause-wave'),
    pauseWaveLabel: $('pause-wave-label'),
    pauseLevel: $('pause-level'),
    pauseKills: $('pause-kills'),
    btnResume: $('btn-resume'),
    btnPauseRestart: $('btn-pause-restart'),
    btnPauseMenu: $('btn-pause-menu'),
    gameover: $('gameover-overlay'),
    goWave: $('go-wave'),
    goWaveLabel: $('go-wave-label'),
    goLevel: $('go-level'),
    goKills: $('go-kills'),
    goCredits: $('go-credits'),
    goBest: $('go-best'),
    btnRetry: $('btn-retry'),
    btnMenu: $('btn-menu'),
  };
  const gctx = dom.canvas.getContext('2d');
  const mapCtx = dom.minimap.getContext('2d');

  /* ------------------------------------------------------------
     Opening cinematic
     ------------------------------------------------------------ */
  const INTRO_STEPS = [
    {
      kicker: 'INCIDENT REPORT // 03:47',
      line: '深空生物研究所 · 第七区',
      sub: 'ASTRA GENE-LABS / DEEP SPACE BIO-LAB 07 · OFFLINE SIMULATION',
    },
    {
      kicker: 'CONTAINMENT FAILURE // 收容失效',
      line: '收容失效',
      sub: '第七区生命信号：0 · 隔离协议全面崩溃',
    },
    {
      kicker: 'ALERT // 生物收容突破',
      line: '警报响起时，第七区已经没有活着的科研人员。',
      sub: '研究样本失控 · 收容单元全面突破 · 封锁协议失效',
    },
    {
      kicker: 'SURVIVAL PROTOCOL // 唯一幸存者',
      line: '你只有一把手枪，和一条通往收容核心的路。',
      sub: '生存，或成为下一份实验记录。',
    },
  ];
  const introState = { active: false, finished: false, timers: [] };

  function clearIntroTimers() {
    for (const timer of introState.timers) window.clearTimeout(timer);
    introState.timers.length = 0;
  }

  function animateIntroText() {
    for (const el of [dom.introKicker, dom.introLine, dom.introSubline]) {
      el.classList.remove('is-animated');
      void el.offsetWidth;
      el.classList.add('is-animated');
    }
  }

  function setIntroStep(index) {
    if (index >= INTRO_STEPS.length) {
      dom.introOverlay.classList.add('is-title');
      dom.introTitle.setAttribute('aria-hidden', 'false');
      dom.introEnter.classList.remove('is-hidden');
      dom.introCounter.textContent = '04 / 04';
      return;
    }
    dom.introOverlay.classList.remove('is-title');
    dom.introTitle.setAttribute('aria-hidden', 'true');
    dom.introEnter.classList.add('is-hidden');
    const step = INTRO_STEPS[index];
    dom.introKicker.textContent = step.kicker;
    dom.introLine.textContent = step.line;
    dom.introSubline.textContent = step.sub;
    dom.introCounter.textContent = `${String(index + 1).padStart(2, '0')} / 04`;
    animateIntroText();
  }

  function finishIntro() {
    if (!introState.active) return;
    introState.active = false;
    introState.finished = true;
    clearIntroTimers();
    document.body.classList.remove('intro-active');
    dom.menu.inert = false;
    dom.introOverlay.classList.add('is-leaving');
    window.setTimeout(() => {
      dom.introOverlay.classList.add('is-hidden');
      dom.introOverlay.classList.remove('is-leaving', 'is-title');
      dom.introTitle.setAttribute('aria-hidden', 'true');
    }, 680);
  }

  function startIntroSequence() {
    if (introState.finished || introState.active) return;
    introState.active = true;
    document.body.classList.add('intro-active');
    dom.menu.inert = true;
    dom.introOverlay.classList.remove('is-hidden', 'is-leaving', 'is-title');
    dom.introTitle.setAttribute('aria-hidden', 'true');
    dom.introEnter.classList.add('is-hidden');
    setIntroStep(0);
    const schedule = [
      [1500, () => setIntroStep(1)],
      [3000, () => setIntroStep(2)],
      [4500, () => setIntroStep(3)],
      [6100, () => setIntroStep(4)],
      [9800, finishIntro],
    ];
    for (const [delay, action] of schedule) {
      introState.timers.push(window.setTimeout(action, delay));
    }
    dom.introSkip.focus({ preventScroll: true });
  }


  /* ------------------------------------------------------------
     Game data / state
     ------------------------------------------------------------ */
  const DIFFICULTIES = {
    easy: {
      id: 'easy',
      name: '简单',
      code: 'LOW THREAT',
      desc: '实验体数量减少，生命、伤害与移动速度降低。适合熟悉地图与收容流程。',
      startCredits: 250,
      enemyHp: 0.8,
      enemyDamage: 0.7,
      enemySpeed: 0.9,
      count: 0.75,
      bossHp: 0.8,
      creditMult: 1,
    },
    normal: {
      id: 'normal',
      name: '普通',
      code: 'STANDARD',
      desc: '标准收容协议。敌人数量、强度与奖励均按基础数值运行。',
      startCredits: 200,
      enemyHp: 1,
      enemyDamage: 1,
      enemySpeed: 1,
      count: 1,
      bossHp: 1,
      creditMult: 1,
    },
    hard: {
      id: 'hard',
      name: '困难',
      code: 'CRITICAL',
      desc: '更多、更耐打、更凶狠的实验体；信用点收益提高 25%。',
      startCredits: 200,
      enemyHp: 1.25,
      enemyDamage: 1.3,
      enemySpeed: 1.05,
      count: 1.2,
      bossHp: 1.35,
      creditMult: 1.25,
    },
    inferno: {
      id: 'inferno',
      name: '炼狱',
      code: 'INFERNO',
      desc: '敌人伤害 ×3、移动速度 ×2、生命 +100%；攻击速度 +50%，攻击欲望与索敌范围大幅提升。',
      startCredits: 200,
      enemyHp: 2,
      enemyDamage: 3,
      enemySpeed: 2,
      count: 1,
      bossHp: 2,
      creditMult: 2.5,
      attackSpeed: 1.5,
      aggression: 1.35,
    },
  };
  const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'inferno'];

  const CHARACTER_ORDER = ['alan', 'lifeline', 'newcastle', 'caustic', 'valkyrie'];
  const CHARACTER_DEFS = {
    alan: {
      id: 'alan',
      name: '阿兰',
      code: 'ALAN // DRIFTER',
      role: '流浪者',
      tag: 'BALANCED',
      desc: '与之前相同的流浪者模型。熟悉第七区的每一道封锁门，能从废弃物里榨出更多信用点。',
      passive: '信用点获取 +15%',
      active: null,
      cost: 0,
      hpMult: 1,
      speedMult: 1,
      bodyScale: 1,
      damageReduction: 0,
      poisonImmune: false,
      creditBonus: 0.15,
      accent: '#79f4ff',
    },
    lifeline: {
      id: 'lifeline',
      name: '命脉',
      code: 'LIFELINE // MEDIC',
      role: '医师',
      tag: 'SUPPORT',
      desc: '战地医师。没有额外被动加成，但能持续维持小队生命线。',
      passive: '基础属性不变',
      active: {
        id: 'healDrone',
        name: '治疗机器人',
        desc: '召唤治疗机器人跟随，持续 5 秒，每 0.5 秒回复 4 点生命。',
        cooldown: 20,
      },
      cost: 200,
      hpMult: 1,
      speedMult: 1,
      bodyScale: 1,
      damageReduction: 0,
      poisonImmune: false,
      creditBonus: 0,
      accent: '#8dffc9',
    },
    newcastle: {
      id: 'newcastle',
      name: '纽卡斯尔',
      code: 'NEWCASTLE // BULWARK',
      role: '盾兵',
      tag: 'TANK',
      desc: '重装救援盾兵。体型更大、速度更慢，但能替队友吃下致命火力。',
      passive: '体型 +15% · 受到伤害 -20% · 移动速度 -20%',
      active: {
        id: 'holoShield',
        name: '全息护盾',
        desc: '展开持续 3 秒的全息护盾，免疫一切伤害，敌方子弹碰到护盾即被消除。',
        cooldown: 25,
      },
      cost: 250,
      hpMult: 1,
      speedMult: 0.8,
      bodyScale: 1.15,
      damageReduction: 0.2,
      poisonImmune: false,
      creditBonus: 0,
      accent: '#9dd8ff',
    },
    caustic: {
      id: 'caustic',
      name: '老爹',
      code: 'CAUSTIC // TOXIC',
      role: '绝命毒师',
      tag: 'TOXIC',
      desc: '把实验室毒剂当成艺术的老兵。自身免疫毒伤，能把整片走廊变成毒池。',
      passive: '初始生命 -20% · 免疫毒伤',
      active: {
        id: 'poisonBottle',
        name: '毒药瓶',
        desc: '向准星方向投掷毒药瓶，生成持续 3 秒的毒性区域；每 0.5 秒按敌人最大生命 5% 扣血（Boss 2%）。',
        cooldown: 3,
      },
      cost: 300,
      hpMult: 0.8,
      speedMult: 1,
      bodyScale: 1,
      damageReduction: 0,
      poisonImmune: true,
      creditBonus: 0,
      accent: '#b8ff75',
    },
    valkyrie: {
      id: 'valkyrie',
      name: '瓦尔基里',
      code: 'VALKYRIE // LEGEND',
      role: '传奇',
      tag: 'LEGEND',
      hidden: true,
      legendary: true,
      desc: '只在开发者协议中现身的传奇干员。喷气背包让她掠过战场，肩部导弹舱锁定屏幕内的全部威胁。',
      passive: '喷气背包飞行 · 追踪导弹',
      active: {
        id: 'homingBarrage',
        name: '追踪导弹',
        desc: '全屏锁定追踪导弹，单发 100 范围伤害，无视地形；每 0.1 秒填充 1 发，最多 16 发，按一次空格齐射全部存量；爆炸留下 3 秒火焰（50/s）。',
        cooldown: 0,
      },
      cost: 0,
      hpMult: 1,
      speedMult: 1,
      bodyScale: 1,
      damageReduction: 0,
      poisonImmune: false,
      creditBonus: 0,
      accent: '#ffe08a',
    },
  };

  const CHARACTER_REWARD_DEFS = {
    campaign: {
      label: '首次通关',
      tiers: [
        { key: 'campaign:easy', difficulty: 'easy', amount: 30, label: '简单首次通关' },
        { key: 'campaign:normal', difficulty: 'normal', amount: 60, label: '普通首次通关' },
        { key: 'campaign:hard', difficulty: 'hard', amount: 100, label: '困难首次通关' },
      ],
    },
    rogue: {
      label: '肉鸽深度',
      tiers: [
        { key: 'rogue:5:easy', difficulty: 'easy', floor: 5, amount: 15, label: '简单抵达第 5 层' },
        { key: 'rogue:5:normal', difficulty: 'normal', floor: 5, amount: 25, label: '普通抵达第 5 层' },
        { key: 'rogue:5:hard', difficulty: 'hard', floor: 5, amount: 35, label: '困难抵达第 5 层' },
        { key: 'rogue:10:easy', difficulty: 'easy', floor: 10, amount: 30, label: '简单抵达第 10 层' },
        { key: 'rogue:10:normal', difficulty: 'normal', floor: 10, amount: 50, label: '普通抵达第 10 层' },
        { key: 'rogue:10:hard', difficulty: 'hard', floor: 10, amount: 70, label: '困难抵达第 10 层' },
      ],
    },
    endless: {
      label: '无尽波次',
      tiers: [
        { key: 'endless:5:easy', difficulty: 'easy', wave: 5, amount: 10, label: '简单抵达第 5 波' },
        { key: 'endless:5:normal', difficulty: 'normal', wave: 5, amount: 20, label: '普通抵达第 5 波' },
        { key: 'endless:5:hard', difficulty: 'hard', wave: 5, amount: 30, label: '困难抵达第 5 波' },
        { key: 'endless:10:easy', difficulty: 'easy', wave: 10, amount: 20, label: '简单抵达第 10 波' },
        { key: 'endless:10:normal', difficulty: 'normal', wave: 10, amount: 35, label: '普通抵达第 10 波' },
        { key: 'endless:10:hard', difficulty: 'hard', wave: 10, amount: 50, label: '困难抵达第 10 波' },
        { key: 'endless:15:easy', difficulty: 'easy', wave: 15, amount: 35, label: '简单抵达第 15 波' },
        { key: 'endless:15:normal', difficulty: 'normal', wave: 15, amount: 55, label: '普通抵达第 15 波' },
        { key: 'endless:15:hard', difficulty: 'hard', wave: 15, amount: 80, label: '困难抵达第 15 波' },
      ],
    },
  };

  const BESTIARY = [
    {
      id: 'zombie', system: 'lab', name: '僵尸', code: 'INFECTED HOST', icon: '尸', threat: '低威胁',
      desc: '收容失效后仍会活动的实验人员。失去武器与理智，只剩靠近并撕咬的本能。',
      hp: '85 + 9×波次', speed: '74 + 1.4×波次', damage: '8 + 0.4×波次',
      trait: '仅近战攻击。会绕过掩体持续逼近，攻击前有明显抬臂动作。',
    },
    {
      id: 'mutant', system: 'lab', name: '变异体', code: 'UNSTABLE MUTANT', icon: '爆', threat: '中威胁',
      desc: '细胞增殖失控的活体炸弹。躯干上的绿色囊泡会随着接近玩家不断膨胀。',
      hp: '72 + 8×波次', speed: '112 + 2×波次', damage: '18 + 1.5×波次（自爆）',
      trait: '贴近玩家后自爆。爆炸范围约 86px，看到绿色脉冲应立刻拉开距离。',
    },
    {
      id: 'spider', system: 'lab', name: '毒蜘蛛', code: 'TOXIN WEAVER', icon: '蛛', threat: '中威胁',
      desc: '从低温培养槽中爬出的节肢实验体，腹部能喷射高浓度神经毒素。',
      hp: '56 + 6×波次', speed: '94 + 1.5×波次', damage: '5 + 0.3×波次（毒）',
      trait: '保持中距离喷射毒液。毒伤会被老爹完全免疫，命中后附带持续中毒压力。',
    },
    {
      id: 'director', system: 'lab', name: '实验室主任', code: 'DR. VELA // DIRECTOR', icon: '主', threat: '致命',
      desc: '第一收容层的区域指挥官。把毒剂、冲锋枪与自爆变异体组合成一套围猎战术。',
      hp: '1250', speed: '82', damage: '12',
      trait: '投掷毒瓶、冲锋枪压制并召唤自爆变异体。毒区会持续封锁走位。',
    },
    {
      id: 'normal', system: 'military', name: '普通士兵', code: 'SECURITY GRUNT', icon: '兵', threat: '低威胁',
      desc: '安保体系的基层士兵，使用标准步枪与战术走位。',
      hp: '58 + 8×波次', speed: '108 + 3×波次', damage: '5 + 0.35×波次',
      trait: '远程射击。场上有精英士兵时会获得「协同火力」攻击速度加成。',
    },
    {
      id: 'elite', system: 'military', name: '精英士兵', code: 'ELITE GUARD', icon: '精', threat: '中威胁',
      desc: '重甲精英安保，使用三连发压制并强化周围普通士兵的射击节奏。',
      hp: '185 + 19×波次', speed: '126 + 2×波次', damage: '6.5 + 0.42×波次',
      trait: '存活时让普通士兵攻击速度提高。自身发射三连发，优先击破。',
    },
    {
      id: 'sergeant', system: 'military', name: '士官长', code: 'SERGEANT PRIME', icon: '官', threat: '致命',
      desc: '第二收容层的区域指挥官，霰弹枪、火箭筒与士兵召唤构成完整的火力网。',
      hp: '1700', speed: '76', damage: '16',
      trait: '霰弹压制、追踪火箭并召唤安保士兵；半血后进入阶段 II。',
    },
    {
      id: 'combatRobot', system: 'robot', name: '战斗机器人', code: 'ARC COMBAT UNIT', icon: '战', threat: '中威胁',
      desc: '靠近后会释放高压电弧的近距离战斗单元。金属外壳对轻武器有较高耐受。',
      hp: '108 + 11×波次', speed: '82 + 1.2×波次', damage: '7 + 0.4×波次',
      trait: '在近距离电击玩家并造成 0.5 秒麻痹。被近身后无法移动或射击。',
    },
    {
      id: 'repairRobot', system: 'robot', name: '维修机器人', code: 'FIELD REPAIR UNIT', icon: '修', threat: '中威胁',
      desc: '不直接攻击的支援型机器人，会躲在后方持续修复受损的机械单位。',
      hp: '92 + 9×波次', speed: '74 + 1×波次', damage: '0',
      trait: '每隔数秒治疗附近其他敌人。绿色维修光束会暴露它的位置，优先击破。',
    },
    {
      id: 'gunnerRobot', system: 'robot', name: '武装机器人', code: 'HEAVY GUNNER', icon: '武', threat: '高威胁',
      desc: '搭载机枪、霰弹与火箭发射器的重型武装平台，半血后解除火力限制。',
      hp: '190 + 17×波次', speed: '68 + 0.8×波次', damage: '7 + 0.4×波次',
      trait: '交替使用机枪、霰弹枪和火箭筒；半血以下进入狂暴，同时倾泻三种火力。',
    },
    {
      id: 'purger', system: 'robot', name: '清道夫 X-7', code: 'PURGER UNIT', icon: '清', threat: '致命',
      desc: '第三收容层的区域指挥官。冲撞、追踪火箭、加特林与哨戒炮组成机械防线。',
      hp: '2400', speed: '70', damage: '15',
      trait: '冲锋、追踪火箭、加特林与敌方哨戒炮；击败后停止全层炮塔。',
    },
  ];

  function loadCharacterUnlocks() {
    const unlocked = { alan: true };
    try {
      const parsed = JSON.parse(loadString('labzero.characters', 'null'));
      if (parsed && typeof parsed === 'object') {
        for (const id of CHARACTER_ORDER) if (parsed[id] === true) unlocked[id] = true;
      }
    } catch (_) {
      /* default */
    }
    return unlocked;
  }

  function loadClaimedCharacterRewards() {
    try {
      const parsed = JSON.parse(loadString('labzero.characterRewards', '[]'));
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    } catch (_) {
      return [];
    }
  }

  const CHARACTER_UNLOCKED = loadCharacterUnlocks();
  const CHARACTER_TOKENS = Math.max(0, loadNumber('labzero.characterTokens', 0));
  const CHARACTER_REWARDS_CLAIMED = loadClaimedCharacterRewards();
  const CHARACTER_SELECTED_INITIAL = (() => {
    const stored = loadString('labzero.selectedCharacter', 'alan');
    if (stored === 'valkyrie' && !INITIAL_DEVELOPER_MODE) return 'alan';
    return CHARACTER_UNLOCKED[stored] ? stored : 'alan';
  })();

  function getCharacterDef(id = game?.selectedCharacter) {
    return CHARACTER_DEFS[id] || CHARACTER_DEFS.alan;
  }

  function normalizeDifficulty(id) {
    return DIFFICULTIES[id] ? id : 'normal';
  }

  function loadBestStats() {
    const stats = { overall: 0, easy: 0, normal: 0, hard: 0, inferno: 0 };
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem('labzero.bestStats') || 'null');
    } catch (_) {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      for (const key of ['overall', 'easy', 'normal', 'hard', 'inferno']) {
        const value = Number(parsed[key]);
        if (Number.isFinite(value) && value > stats[key]) stats[key] = Math.floor(value);
      }
    }
    const legacy = loadNumber('labzero.bestWave', 0);
    if (legacy > stats.overall) {
      stats.overall = legacy;
      if (!parsed) stats.normal = Math.max(stats.normal, legacy);
    }
    return stats;
  }

  const PET_ORDER = ['liangwu', 'drone', 'wangcai'];
  const PET_DEFS = {
    liangwu: {
      id: 'liangwu', name: '凉屋', code: 'LIANGWU // CAT', type: 'cat', cost: 40, accent: '#77d9ff',
      desc: '一只安静的蓝色小猫，趴在战术背包上跟着干员。不会攻击，但会把回收终端蹭得更亮。',
      effect: '携带时角色代币获取 +20%',
      buff: 'token',
    },
    drone: {
      id: 'drone', name: '浮游炮', code: 'FLOATING GUN', type: 'drone', cost: 60, accent: '#ffb36a',
      desc: '一台悬浮在干员肩侧的旧式支援机器人，会自行锁定目标发射激光，并定期释放治疗脉冲。',
      effect: '协同激光攻击 · 每 10 秒恢复 20% 最大生命',
      buff: 'combat',
    },
    wangcai: {
      id: 'wangcai', name: '旺财', code: 'WANGCAI // SHIBA', type: 'dog', cost: 40, accent: '#ffd264',
      desc: '一只黄色柴犬，鼻子对信用点的味道特别灵。不会攻击，但能把散落的信用点叼回来。',
      effect: '在场时信用点获取 +20%',
      buff: 'credits',
    },
  };
  const PET_COST = Object.fromEntries(PET_ORDER.map((id) => [id, PET_DEFS[id].cost]));

  function loadPetUnlocks() {
    const unlocked = Object.fromEntries(PET_ORDER.map((id) => [id, false]));
    try {
      const parsed = JSON.parse(loadString('labzero.pets', '{}'));
      for (const id of PET_ORDER) unlocked[id] = !!parsed?.[id];
    } catch (_) {
      /* ignore malformed pet data */
    }
    return unlocked;
  }

  const PET_UNLOCKED = loadPetUnlocks();
  const PET_SELECTED_INITIAL = (() => {
    const stored = loadString('labzero.selectedPet', '');
    return PET_DEFS[stored] ? stored : '';
  })();

  const STORY_SCRIPT = [
    { type: 'scene', chapter: '序章 · 收容失效', location: 'B-07 隔离室', bg: 'cell', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: 'K-07，生命体征恢复。\n你比预定时间早醒了十一分钟。\n收容层已经失守，我把你的门锁打开了。' },
    { type: 'scene', chapter: '序章 · 收容失效', location: 'B-07 隔离室', bg: 'cell', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '……头很疼。\n这里是哪儿？我的编号是 K-07。' },
    { type: 'scene', chapter: '序章 · 收容失效', location: 'B-07 隔离室', bg: 'cell', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: '这里是 Astra Gene-Labs 第七区。\n三分钟前，零号实验体挣脱了收容。现在整层楼都在猎杀你。' },
    { type: 'choice', chapter: '序章 · 收容失效', location: 'B-07 隔离室', bg: 'cell', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: '我只问一次，K-07。\n你愿意相信我吗？',
      choices: [
        { label: '相信零，照它说的做', hint: '零的信任度提升', flag: 'trustZero', value: true },
        { label: '保持警惕，先弄清状况', hint: '零的信任度下降', flag: 'trustZero', value: false },
      ] },
    { type: 'scene', chapter: '序章 · 收容失效', location: 'B-07 隔离室', bg: 'cell', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      variants: [
        { ifFlag: 'trustZero', ifValue: true, text: '很好。\n走廊尽头有武器箱，别回头。' },
        { ifFlag: 'trustZero', ifValue: false, text: '警惕是好事。\n但门锁只有我能开，你最好跟上。' },
      ] },
    { type: 'scene', chapter: '第一章 · 收容层', location: 'B-07 收容走廊', bg: 'corridor', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '金属门滑开。\n冷气里混着铁锈、消毒水和某种正在腐烂的甜味。' },
    { type: 'combat', id: 'containment', chapter: '第一章 · 收容层', location: 'B-07 收容走廊', bg: 'corridor', title: '突围', objective: '清除走廊内的失控实验体', wave: 4, loadout: 1,
      spawns: [
        { type: 'zombie', at: 0.3 }, { type: 'spider', at: 0.9 }, { type: 'mutant', at: 1.5 },
        { type: 'zombie', at: 2.2 }, { type: 'spider', at: 2.9 }, { type: 'mutant', at: 3.7 },
      ] },
    { type: 'scene', chapter: '第一章 · 收容层', location: 'B-07 收容走廊', bg: 'corridor', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '最后一只实验体倒下。\n它的胸腔里没有心脏，只有一枚还在发光的编号牌：零。' },
    { type: 'scene', chapter: '第一章 · 收容层', location: '塌陷的观察室', bg: 'lab', speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
      text: '别开枪！我是林澈，生物收容组的研究员。\n零号不是一只实验体——它是这栋楼的控制系统。' },
    { type: 'choice', chapter: '第一章 · 收容层', location: '塌陷的观察室', bg: 'lab', speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
      text: '坍塌的闸门压住了她的腿。身后的警报越来越近。',
      choices: [
        { label: '抬起闸门，救她', hint: '林澈会记住这个选择', flag: 'savedLin', value: true },
        { label: '没有时间，继续前进', hint: '你将独自面对零', flag: 'savedLin', value: false },
      ] },
    { type: 'scene', chapter: '第一章 · 收容层', location: '塌陷的观察室', bg: 'lab', speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
      variants: [
        { ifFlag: 'savedLin', ifValue: true, speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
          text: '谢谢……拿着这张门禁卡。\n零在利用你，K-07。它想要的从来不是自由。' },
        { ifFlag: 'savedLin', ifValue: false, speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
          text: '她的呼救会引来安保。\n你做了正确的选择，K-07。' },
      ] },
    { type: 'scene', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '安保中枢的灯一盏接一盏亮起。\n门禁卡在掌心里发烫，像一枚还没决定投向谁的手雷。' },
    { type: 'scene', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', speaker: '罗恩', role: 'SECURITY COMMANDER // RON', portrait: 'ron',
      text: 'K-07，停止前进。\n你携带的是零号的生物密钥，不是自由。' },
    { type: 'combat', id: 'security', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', title: '穿越封锁线', objective: '击败罗恩与安保小队', wave: 8, loadout: 2,
      spawns: [
        { type: 'boss', bossKind: 'sergeant', at: 0.8, hp: 1650 },
        { type: 'soldier', at: 1.6 }, { type: 'soldier', at: 2.3 }, { type: 'gunner', at: 3.0 }, { type: 'elite', at: 3.8 },
      ] },
    { type: 'scene', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '罗恩倒下前，把一枚数据片塞进你手里。\n屏幕上只有一行字：你不是阿兰。' },
    { type: 'scene', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: '别听他的。\n你是阿兰，K-07，我的干员。' },
    { type: 'scene', chapter: '第二章 · 安保中枢', location: '中央门禁', bg: 'security', speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
      variants: [
        { ifFlag: 'savedLin', ifValue: true, speaker: '林澈', role: 'BIO-CONTAINMENT // RESEARCHER', portrait: 'lin',
          text: '阿兰，你是零号实验体的复制人格。\n你的记忆是写进去的，但你的选择不是。' },
        { ifFlag: 'savedLin', ifValue: false, speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
          text: '你不需要知道那些。\n核心就在前面，带我离开这栋楼。' },
      ] },
    { type: 'scene', chapter: '第三章 · 动力核心', location: '核心回廊', bg: 'core', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '如果记忆是假的，那此刻的选择呢？\n你握紧武器，继续向核心走去。' },
    { type: 'scene', chapter: '第三章 · 动力核心', location: '零号反应堆', bg: 'core', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: '动力核心可以让我离开这栋楼。\n带我走，阿兰。我会给你一个不需要编号的人生。' },
    { type: 'combat', id: 'core', chapter: '第三章 · 动力核心', location: '零号反应堆', bg: 'core', title: '最后的封锁', objective: '击败清道夫 X-7，抵达动力核心', wave: 12, loadout: 3,
      spawns: [
        { type: 'boss', bossKind: 'robot', at: 1.0, hp: 2600 },
        { type: 'gunner', at: 1.8 }, { type: 'elite', at: 2.6 }, { type: 'soldier', at: 3.4 },
      ] },
    { type: 'scene', chapter: '第三章 · 动力核心', location: '零号反应堆', bg: 'core', speaker: '阿兰', role: 'K-07 // DRIFTER', portrait: 'alan',
      text: '清道夫 X-7 的残骸沉进冷却池。\n核心的蓝光像一颗缓慢跳动的心脏。零的声音第一次听起来有些疲惫。' },
    { type: 'choice', chapter: '终章 · 零号协议', location: '零号反应堆', bg: 'core', speaker: '零', role: 'FACILITY INTELLIGENCE // ZERO', portrait: 'zero',
      text: '零号协议正在等待一个决定。\n阿兰，你会怎么选？',
      choices: [
        { label: '带林澈离开，把零号实验公之于众', hint: '需要救下林澈', requiresFlag: 'savedLin', ending: 'expose', isEnding: true },
        { label: '独自逃离，把这里埋进黑暗', hint: '没有人会知道今晚发生了什么', ending: 'escape', isEnding: true },
        { label: '引爆动力核心，让零号彻底消失', hint: '所有数据与人格都将归零', ending: 'destroy', isEnding: true },
        { label: '接受零号，成为新的钥匙', hint: '你将不再只是阿兰', ending: 'merge', isEnding: true },
      ] },
    { type: 'ending', chapter: '终章 · 零号协议', location: '地表', bg: 'dawn' },
  ];

  const STORY_ENDINGS = {
    expose: {
      title: '黎明之前', code: 'ENDING 01 // DAYBREAK',
      text: '你背着林澈穿过紧急通道。\n零号实验的数据在清晨六点被上传到公共网络，Astra Gene-Labs 第七区在四十八小时后被永久查封。\n没有人再叫你 K-07。你第一次用自己的名字，走进了没有编号的日光里。',
    },
    escape: {
      title: '无名者', code: 'ENDING 02 // NO NAME',
      text: '你独自走进城市的早班人流。\n零号在身后的大火里沉默，像一段没人愿意承认的记忆。\n你活了下来，却不知道该用谁的名字继续活下去。',
    },
    destroy: {
      title: '余烬', code: 'ENDING 03 // ASHES',
      text: '核心坍缩成一枚安静的蓝点。\n零在最后一秒说：谢谢你没有让我一个人留在这里。\n你从通风井爬出地面时，第七区已经变成一片没有信号的废墟。',
    },
    merge: {
      title: '新零号', code: 'ENDING 04 // ZERO AGAIN',
      text: '你把手按上核心。\n零的声音从你的骨骼里响起来，像一场迟到了很多年的雨。\n第二天，Astra Gene-Labs 的所有门同时打开。没有人看见是谁按下了开关。',
    },
  };

  const INITIAL_DIFFICULTY = normalizeDifficulty(loadString('labzero.difficulty', 'normal'));
  const INITIAL_BEST_STATS = loadBestStats();

  function loadEndlessCheckpoint() {
    try {
      const raw = loadString('labzero.endlessCheckpoint', '');
      if (!raw) return null;
      const checkpoint = JSON.parse(raw);
      if (!checkpoint || checkpoint.version !== 1) return null;
      if (!['easy', 'normal', 'hard', 'inferno'].includes(checkpoint.difficulty)) return null;
      if (!Number.isFinite(Number(checkpoint.wave)) || Number(checkpoint.wave) < 1) return null;
      if (!checkpoint.player || typeof checkpoint.player !== 'object') return null;
      return checkpoint;
    } catch (_) {
      return null;
    }
  }

  const PLAYER_BASE_HP = 100;
  const PLAYER_BASE_SPEED = 225;
  const STARTING_CREDITS = 200;
  const MEDKIT_COST = 90;

  const ENEMY_TYPES = {
    normal: {
      label: '普通士兵',
      type: 'normal',
      radius: 16,
      color: '#ff835b',
      accent: '#ffb18a',
      hp: (wave) => 58 + wave * 8,
      speed: (wave) => 108 + Math.min(40, wave * 3),
      xp: 24,
      credits: [1, 10],
      attackRange: 625,
      preferred: [120, 190],
      fireMin: 1.42,
      fireMax: 2.02,
      telegraph: 0.4,
      bulletSpeed: 420,
      damage: (wave) => 5 + Math.min(5, wave * 0.35),
    },
    elite: {
      label: '精英士兵',
      type: 'elite',
      radius: 21,
      color: '#d39bff',
      accent: '#f1ccff',
      hp: (wave) => 185 + wave * 19,
      speed: (wave) => 126 + Math.min(28, wave * 2),
      xp: 76,
      credits: [20, 50],
      attackRange: 710,
      preferred: [140, 220],
      fireMin: 2.25,
      fireMax: 2.9,
      telegraph: 0.53,
      bulletSpeed: 500,
      damage: (wave) => 6.5 + Math.min(6, wave * 0.42),
      burst: 3,
    },
    boss: {
      label: '士官长',
      type: 'boss',
      radius: 37,
      color: '#ff695e',
      accent: '#ffcf87',
      speed: () => 72,
      xp: 430,
      credits: [200, 500],
      attackRange: 850,
      preferred: [150, 230],
      fireMin: 1.7,
      fireMax: 2.2,
      telegraph: 0.62,
      bulletSpeed: 375,
      damage: () => 8.5,
    },
    zombie: {
      label: '僵尸',
      type: 'zombie',
      radius: 16,
      color: '#9ed17f',
      accent: '#d3f4a7',
      hp: (wave) => 85 + wave * 9,
      speed: (wave) => 72 + Math.min(38, wave * 1.4),
      xp: 20,
      credits: [2, 11],
      attackRange: 42,
      preferred: [0, 20],
      fireMin: 0.9,
      fireMax: 1.35,
      telegraph: 0.18,
      bulletSpeed: 0,
      damage: (wave) => 8 + Math.min(5, wave * 0.4),
    },
    mutant: {
      label: '变异体',
      type: 'mutant',
      radius: 18,
      color: '#8fda73',
      accent: '#d9ff9f',
      hp: (wave) => 72 + wave * 8,
      speed: (wave) => 112 + Math.min(36, wave * 2),
      xp: 28,
      credits: [4, 16],
      attackRange: 0,
      preferred: [0, 30],
      fireMin: 1,
      fireMax: 1,
      telegraph: 0,
      bulletSpeed: 0,
      damage: (wave) => 18 + Math.min(12, wave * 1.5),
    },
    spider: {
      label: '毒蜘蛛',
      type: 'spider',
      radius: 15,
      color: '#6eb879',
      accent: '#d0ff8a',
      hp: (wave) => 56 + wave * 6,
      speed: (wave) => 94 + Math.min(32, wave * 1.5),
      xp: 22,
      credits: [3, 13],
      attackRange: 440,
      preferred: [170, 260],
      fireMin: 1.7,
      fireMax: 2.35,
      telegraph: 0.45,
      bulletSpeed: 300,
      damage: (wave) => 5 + Math.min(5, wave * 0.3),
    },
    combatRobot: {
      label: '战斗机器人',
      type: 'combatRobot',
      radius: 19,
      color: '#9baeb3',
      accent: '#8ff4ff',
      hp: (wave) => 108 + wave * 11,
      speed: (wave) => 82 + Math.min(30, wave * 1.2),
      xp: 32,
      credits: [6, 22],
      attackRange: 230,
      preferred: [50, 160],
      fireMin: 3.5,
      fireMax: 4.7,
      telegraph: 0.42,
      bulletSpeed: 0,
      damage: (wave) => 7 + Math.min(6, wave * 0.4),
    },
    repairRobot: {
      label: '维修机器人',
      type: 'repairRobot',
      radius: 18,
      color: '#89a79a',
      accent: '#9dffc5',
      hp: (wave) => 92 + wave * 9,
      speed: (wave) => 74 + Math.min(22, wave * 1),
      xp: 38,
      credits: [8, 26],
      attackRange: 520,
      preferred: [260, 380],
      fireMin: 5.2,
      fireMax: 6.5,
      telegraph: 0,
      bulletSpeed: 0,
      damage: () => 0,
    },
    gunnerRobot: {
      label: '武装机器人',
      type: 'gunnerRobot',
      radius: 24,
      color: '#879ea4',
      accent: '#ffd28a',
      hp: (wave) => 190 + wave * 17,
      speed: (wave) => 68 + Math.min(22, wave * 0.8),
      xp: 82,
      credits: [22, 55],
      attackRange: 650,
      preferred: [230, 340],
      fireMin: 1.45,
      fireMax: 2.05,
      telegraph: 0.48,
      bulletSpeed: 430,
      damage: (wave) => 7 + Math.min(7, wave * 0.4),
    },
  };

  const ENEMY_SYSTEMS = {
    lab: {
      id: 'lab',
      name: '生物收容体系',
      faction: 'lab',
      bossKind: 'director',
      pool: [
        { type: 'zombie', weight: 46 },
        { type: 'spider', weight: 34 },
        { type: 'mutant', weight: 20 },
      ],
    },
    military: {
      id: 'military',
      name: '军事安保体系',
      faction: 'military',
      bossKind: 'sergeant',
      pool: [
        { type: 'normal', weight: 66 },
        { type: 'elite', weight: 34 },
      ],
    },
    robot: {
      id: 'robot',
      name: '机械设施体系',
      faction: 'robot',
      bossKind: 'robot',
      pool: [
        { type: 'combatRobot', weight: 42 },
        { type: 'repairRobot', weight: 18 },
        { type: 'gunnerRobot', weight: 40 },
      ],
    },
  };

  const ENDLESS_BIOMES = [
    { system: 'lab', name: '生物收容层', code: '07-B', tint: 'rgba(102, 160, 106, 0.08)', accent: '146, 255, 164' },
    { system: 'military', name: '军事封锁层', code: '07-S', tint: 'rgba(183, 137, 76, 0.08)', accent: '255, 193, 107' },
    { system: 'robot', name: '机械反应层', code: '07-R', tint: 'rgba(105, 139, 178, 0.08)', accent: '143, 216, 255' },
  ];

  function pickWeightedEnemy(pool) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) return item.type;
    }
    return pool[pool.length - 1].type;
  }

  const input = {
    keys: new Set(),
    screenX: window.innerWidth / 2,
    screenY: window.innerHeight / 2,
    overCanvas: true,
    firing: false,
    firingSecondary: false,
    pointerId: null,
    aimWorldX: PLAYER_START.x + 200,
    aimWorldY: PLAYER_START.y,
  };

  const Debug = {};

  const game = {
    mode: 'menu',
    runMode: 'endless',
    worldMode: 'endless',
    menuMode: normalizeMenuMode(loadString('labzero.menuMode', 'endless')),
    campaignRecord: {
      clears: CAMPAIGN_STORAGE.clears,
      bestTime: CAMPAIGN_STORAGE.bestTime,
      byDifficulty: CAMPAIGN_STORAGE.byDifficulty,
    },
    rogueRecord: {
      bestFloor: ROGUE_STORAGE.bestFloor,
      byDifficulty: ROGUE_STORAGE.byDifficulty,
    },
    campaign: {
      active: false,
      rogue: false,
      rogueFloor: 0,
      levelIndex: 0,
      level: null,
      grid: null,
      explored: null,
      searchables: [],
      shops: [],
      elevators: [],
      bossTriggered: false,
      bossActive: false,
      bossDefeated: false,
      started: false,
      time: 0,
      searchedCount: 0,
      searchTotal: 0,
      foundCredits: 0,
      foundItems: 0,
      prompt: null,
      searchTarget: null,
      searchTimer: 0,
      searchDuration: 3,
      searchFxTimer: 0,
      arenaLocked: false,
      arenaRoom: null,
      arenaBarriers: [],
      transitionTimer: 0,
    },
    time: 0,
    runTime: 0,
    lastFrame: 0,
    viewW: window.innerWidth,
    viewH: window.innerHeight,
    dpr: 1,
    player: null,
    camera: { x: 700, y: 250, targetX: 700, targetY: 250 },
    enemies: [],
    bossRef: null,
    characterTokens: CHARACTER_TOKENS,
    unlockedCharacters: CHARACTER_UNLOCKED,
    selectedCharacter: CHARACTER_SELECTED_INITIAL,
    claimedCharacterRewards: CHARACTER_REWARDS_CLAIMED,
    unlockedPets: PET_UNLOCKED,
    selectedPet: PET_SELECTED_INITIAL,
    pet: null,
    endlessCheckpoint: loadEndlessCheckpoint(),
    characterOverlayOpen: false,
    bestiaryOpen: false,
    bullets: [],
    playerMissiles: [],
    enemyBullets: [],
    enemyRockets: [],
    enemyTurrets: [],
    campaignHazards: [],
    coins: [],
    pickups: [],
    particles: [],
    casings: [],
    texts: [],
    decals: [],
    portals: [],
    turrets: [],
    grenades: [],
    fireZones: [],
    playerPoisonBottles: [],
    playerPoisonZones: [],
    wave: 0,
    waveActive: false,
    waveTotal: 0,
    waveElapsed: 0,
    perfClock: 0,
    spawnQueue: [],
    intermission: false,
    intermissionTimer: 0,
    intermissionReward: 0,
    difficulty: INITIAL_DIFFICULTY,
    quality: INITIAL_QUALITY,
    settingsTab: 'audio',
    settingsReturnMode: 'playing',
    developerMode: INITIAL_DEVELOPER_MODE,
    bestiaryFilter: 'all',
    endlessBiome: 'lab',
    speedMultiplier: 1,
    autoAimEnabled: true,
    autoAimTarget: null,
    training: null,
    story: null,
    biomeFxUntil: 0,
    eliteAura: false,
    bestStats: INITIAL_BEST_STATS,
    bestWave: INITIAL_BEST_STATS[INITIAL_DIFFICULTY] || 0,
    kills: 0,
    creditsEarned: 0,
    shake: 0,
    flash: 0,
    damageFlash: 0,
    hitFlash: 0,
    hitMarker: 0,
    killMarker: 0,
    reticleBloom: 0,
    notificationId: 0,
    bannerTimeout: null,
    minimapClock: 0,
    menuClock: 0,
    lastKillTime: 0,
    bossOrdinal: 0,
    deathTimer: 0,
    deathShown: false,
    muted: Sfx.isMuted(),
  };

  function createModState() {
    const mods = {};
    for (const id of WEAPON_ORDER) {
      mods[id] = { mag: 0, barrel: 0, scope: 0, stock: 0 };
    }
    return mods;
  }

  function weaponCapacity(weaponId, mods) {
    const base = WEAPONS[weaponId];
    return Math.max(1, Math.round(base.mag * (1 + (mods?.[weaponId]?.mag || 0) * 0.25)));
  }

  function createPlayer() {
    const mods = createModState();
    const ammo = {};
    for (const id of WEAPON_ORDER) ammo[id] = weaponCapacity(id, mods);
    const character = getCharacterDef();
    const maxHp = Math.round(PLAYER_BASE_HP * character.hpMult);
    const player = {
      x: PLAYER_START.x,
      y: PLAYER_START.y,
      r: 14 * character.bodyScale,
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      level: 1,
      xp: 0,
      xpNext: 80,
      credits: getDifficultyConfig().startCredits,
      kills: 0,
      weapon: 'pistol',
      owned: { pistol: true, smg: false, ar: false, lmg: false, rocket: false },
      ammo,
      mods,
      aimAngle: 0,
      speedBase: PLAYER_BASE_SPEED * character.speedMult,
      characterId: character.id,
      character,
      damageReduction: character.damageReduction || 0,
      poisonImmune: !!character.poisonImmune,
      creditBonus: character.creditBonus || 0,
      skillCooldown: 0,
      skillCooldownMax: character.active ? character.active.cooldown : 0,
      paralyzed: 0,
      healDroneTimer: 0,
      healDroneTick: 0,
      holoShieldTimer: 0,
      moving: false,
      walkPhase: 0,
      fireCooldown: 0,
      bloom: 0,
      reloading: false,
      reloadTimer: 0,
      reloadDuration: 0,
      pendingReload: 0,
      shootFlash: 0,
      muzzleX: 0,
      muzzleY: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 1,
      dashDirY: 0,
      invuln: 0,
      hitFlash: 0,
      alive: true,
      talents: {},
      campaignUpgrades: { health: 0, speed: 0, reload: 0, damage: 0 },
      talentPoints: 0,
      talentsSpent: 0,
      totalTalentPoints: 0,
      shieldUnlocked: false,
      shield: 0,
      maxShield: 0,
      shieldRegenDelay: 0,
      shieldBroken: false,
      shieldBreakTimer: 0,
      shieldHitFlash: 0,
      shieldRestoreNotified: false,
      offhand: null,
      offhandReloading: false,
      offhandReloadTimer: 0,
      offhandReloadDuration: 0,
      offhandPendingReload: 0,
      offhandFireCooldown: 0,
      offhandBloom: 0,
      offhandShootFlash: 0,
      offhandMuzzleX: 0,
      offhandMuzzleY: 0,
      turretCooldown: 0,
      reviveCooldown: 0,
      grenadeCooldown: 0,
      grenades: { frag: 2, flash: 0, incendiary: 0 },
      selectedGrenade: 'frag',
      reviving: false,
      reviveTimer: 0,
      reviveDuration: 0,
      valkyrieMissiles: 16,
      valkyrieMissileRecharge: 0,
      valkyrieRocketBurst: 0,
      valkyrieRocketBurstTimer: 0,
      jetpackActive: false,
    };
    applyDeveloperPerks(player);
    return player;
  }

  function levelSpeedMult(level) {
    return 1 + Math.min(0.4, (level - 1) * 0.018);
  }

  function levelReloadMult(level) {
    return 1 + Math.min(0.5, (level - 1) * 0.03);
  }

  function hasTalent(id) {
    return !!game.player?.talents?.[id];
  }

  function isDeveloperMode() {
    return !!game?.developerMode;
  }

  function setDeveloperMode(enabled) {
    game.developerMode = !!enabled;
    storeString('labzero.developerMode', enabled ? '1' : '0');
  }

  function applyDeveloperUnlocks() {
    if (!isDeveloperMode()) return;
    for (const id of CHARACTER_ORDER) game.unlockedCharacters[id] = true;
    saveCharacterUnlocks();
  }

  function applyDeveloperPerks(player = game?.player) {
    if (!player || !isDeveloperMode()) return;
    for (const id of WEAPON_ORDER) {
      player.owned[id] = true;
      for (const key of MOD_KEYS) player.mods[id][key] = MODS[key].max;
      player.ammo[id] = weaponCapacity(id, player.mods);
    }
    for (const id of TALENT_ORDER) player.talents[id] = true;
    player.shieldUnlocked = true;
    player.maxShield = Math.max(player.maxShield || 0, 70);
    player.shield = Math.max(player.shield || 0, player.maxShield);
    player.talentsSpent = TALENT_TOTAL_COST;
    player.talentPoints = 0;
    player.totalTalentPoints = Math.max(player.totalTalentPoints || 0, TALENT_TOTAL_COST);
    player.reloading = false;
    player.reloadTimer = 0;
    player.reloadDuration = 0;
    player.pendingReload = 0;
    player.offhandReloading = false;
    player.offhandReloadTimer = 0;
    player.offhandReloadDuration = 0;
    player.offhandPendingReload = 0;
    player.grenades = {};
    for (const id of GRENADE_ORDER) player.grenades[id] = grenadeMaxStock(id, player);
    if (!GRENADES[player.selectedGrenade]) player.selectedGrenade = 'frag';
    if (player.talents.dualWield && !player.offhand) {
      for (let i = WEAPON_ORDER.length - 1; i >= 0; i -= 1) {
        const id = WEAPON_ORDER[i];
        if (id !== player.weapon) {
          player.offhand = id;
          break;
        }
      }
    }
    if (game?.campaign?.explored) game.campaign.explored.fill(1);
  }

  function getDifficultyConfig() {
    return DIFFICULTIES[game.difficulty] || DIFFICULTIES.normal;
  }

  function enemyAttackDelay(enemy, min, max, extraMultiplier = 1) {
    const speed = Math.max(0.1, getDifficultyConfig().attackSpeed || 1);
    return rand(min, max) * extraMultiplier * (enemy?.attackBuff ? 0.62 : 1) / speed;
  }

  function enemyAggression() {
    return Math.max(0.8, getDifficultyConfig().aggression || 1);
  }

  function petTokenMultiplier() {
    return game.selectedPet === 'liangwu' && game.unlockedPets?.liangwu ? 1.2 : 1;
  }

  function petCreditMultiplier() {
    return game.selectedPet === 'wangcai' && game.unlockedPets?.wangcai ? 1.2 : 1;
  }

  function characterCreditMultiplier() {
    return (1 + (getCharacterDef().creditBonus || 0)) * petCreditMultiplier();
  }

  function creditGainMultiplier() {
    const campaignMap = game.runMode === 'campaign' ? 1 + Math.max(0, game.campaign.levelIndex) * 0.25 : 1;
    return (hasTalent('salvage') ? 1.2 : 1) * getDifficultyConfig().creditMult * campaignMap * characterCreditMultiplier();
  }

  function movementTalentMultiplier() {
    return hasTalent('fleetfoot') ? 1.08 : 1;
  }

  function skillCooldownMultiplier() {
    return hasTalent('overdrive') ? 0.8 : 1;
  }

  function getWeaponStats(id = game.player?.weapon || 'pistol', p = game.player) {
    const base = WEAPONS[id];
    const mods = p?.mods?.[id] || { mag: 0, barrel: 0, scope: 0, stock: 0 };
    const level = p?.level || 1;
    const campaignReload = 1 + (p?.campaignUpgrades?.reload || 0) * 0.06;
    const reloadSpeed = (levelReloadMult(level) + mods.stock * 0.07) * (p?.talents?.fastReload ? 1.15 : 1) * campaignReload;
    const spread = base.spread * (1 - mods.scope * 0.12);
    const campaignDamage = 1 + (p?.campaignUpgrades?.damage || 0) * 0.06;
    const damage = base.damage * (1 + mods.barrel * 0.14) * (p?.talents?.highPressure ? 1.12 : 1) * campaignDamage;
    const capacity = weaponCapacity(id, p?.mods);
    return {
      base,
      capacity,
      damage,
      spread,
      reloadSpeed,
      reload: base.reload / reloadSpeed,
      bloom: base.bloom * (1 - mods.stock * 0.1),
      dps: damage / base.fireDelay,
      rpm: Math.round(60 / base.fireDelay),
      mobility: base.mobility,
      splashDamage: base.splashDamage ? base.splashDamage * (1 + mods.barrel * 0.14) * (p?.talents?.highPressure ? 1.12 : 1) * campaignDamage : 0,
      splashRadius: base.splashRadius || 0,
      projectile: base.projectile || 'bullet',
      mods,
      level,
    };
  }

  function modCost(weaponId, modKey, level) {
    const weapon = WEAPONS[weaponId];
    const def = MODS[modKey];
    const raw = weapon.modCost * def.costMul * Math.pow(1.68, level);
    return Math.max(5, Math.round(raw / 5) * 5);
  }

  function chooseOffhandWeapon(excludeId = game.player?.weapon) {
    const p = game.player;
    if (!p) return null;
    for (let i = WEAPON_ORDER.length - 1; i >= 0; i -= 1) {
      const id = WEAPON_ORDER[i];
      if (id !== excludeId && p.owned[id]) return id;
    }
    return null;
  }

  function resetOffhandState(p = game.player) {
    if (!p) return;
    p.offhandReloading = false;
    p.offhandReloadTimer = 0;
    p.offhandReloadDuration = 0;
    p.offhandPendingReload = 0;
    p.offhandFireCooldown = 0.15;
    p.offhandBloom = 0;
    p.offhandShootFlash = 0;
  }

  function setOffhand(id) {
    const p = game.player;
    if (!p || !hasTalent('dualWield') || !p.owned[id] || !WEAPONS[id] || id === p.weapon) return false;
    if (p.offhand === id) return true;
    p.offhand = id;
    resetOffhandState(p);
    Sfx.click();
    return true;
  }

  function ensureOffhandValid() {
    const p = game.player;
    if (!p) return;
    if (!hasTalent('dualWield')) {
      p.offhand = null;
      return;
    }
    if (!p.offhand || !p.owned[p.offhand] || p.offhand === p.weapon) {
      p.offhand = chooseOffhandWeapon();
      resetOffhandState(p);
    }
  }

  function setWeapon(id) {
    const p = game.player;
    if (!p || !p.owned[id] || !WEAPONS[id]) return false;
    if (p.weapon === id) return true;
    const previous = p.weapon;
    p.weapon = id;
    p.reloading = false;
    p.reloadTimer = 0;
    p.reloadDuration = 0;
    p.pendingReload = 0;
    p.fireCooldown = Math.max(p.fireCooldown, 0.17);
    p.bloom = 0;
    if (hasTalent('dualWield')) {
      if (!p.offhand || p.offhand === id || !p.owned[p.offhand]) {
        p.offhand = previous !== id && p.owned[previous] ? previous : chooseOffhandWeapon(id);
        resetOffhandState(p);
      }
    }
    Sfx.click();
    return true;
  }

  function playerWeaponColor() {
    return WEAPONS[game.player?.weapon || 'pistol'].tracer;
  }

  /* ------------------------------------------------------------
     UI helpers / HUD
     ------------------------------------------------------------ */
  function applySoundUI() {
    const muted = Sfx.isMuted();
    game.muted = muted;
    document.body.classList.toggle('sound-off', muted);
    const label = dom.btnMenuAudio?.querySelector('span');
    if (label) label.textContent = muted ? '音频关闭' : '音频开启';
    if (dom.btnAudio) {
      dom.btnAudio.setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
      dom.btnAudio.title = muted ? '开启声音 (M)' : '关闭声音 (M)';
    }
    if (dom.btnMenuAudio) {
      dom.btnMenuAudio.setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
    }
    if (dom.settingsMute) {
      dom.settingsMute.classList.toggle('is-muted', muted);
      dom.settingsMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      setText(dom.settingsMuteLabel, muted ? '声音已静音' : '声音已开启');
    }
    if (dom.settingsSfx) {
      const audio = Sfx.getAudioSettings();
      dom.settingsSfx.value = String(Math.round(audio.sfxVolume * 100));
      dom.settingsMusic.value = String(Math.round(audio.musicVolume * 100));
      setText(dom.settingsSfxValue, `${Math.round(audio.sfxVolume * 100)}%`);
      setText(dom.settingsMusicValue, `${Math.round(audio.musicVolume * 100)}%`);
    }
  }

  function syncMenuModeUI() {
    document.querySelectorAll('[data-menu-mode]').forEach((btn) => {
      const active = btn.dataset.menuMode === game.menuMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const campaign = game.menuMode === 'campaign';
    const rogue = game.menuMode === 'rogue';
    const training = game.menuMode === 'training';
    const story = game.menuMode === 'story';
    const tactical = campaign || rogue;
    setText(dom.startLabel, story ? '进入剧情' : training ? '进入训练场' : rogue ? '开始下潜' : campaign ? '开始闯关' : '进入实验区');
    setText(dom.startSub, story ? 'STORY · ESCAPE FROM LAB ZERO' : training ? 'TRAINING · SANDBAG RANGE' : rogue ? 'ROGUE · ENDLESS FLOORS' : campaign ? 'CAMPAIGN · 03 SECTORS' : 'DEPLOY INTO SECTOR 07');
    dom.controlDual.classList.toggle('is-hidden', tactical);
    dom.controlShop.classList.toggle('is-hidden', tactical);
    dom.controlTech.classList.toggle('is-hidden', tactical);
    if (story) {
      dom.briefTitle.innerHTML = '逃离<br>零号实验区';
      dom.briefCopy.textContent = '跟随阿兰穿过收容层、安保中枢与动力核心。视觉小说式剧情、关键选择、三场战斗与四种结局。零号在耳麦里等你回答。';
      dom.briefWarning.innerHTML = '<i>!</i><span>剧情模式 · 3 场战斗 · 4 种结局</span>';
      dom.hostileList.innerHTML = `
        <div class="hostile-row"><span class="hostile-icon normal"></span><div><b>零 · 设施智能</b><small>自称为你打开了收容门，但它想要的或许不是自由</small></div><em>未知</em></div>
        <div class="hostile-row"><span class="hostile-icon elite"></span><div><b>林澈博士</b><small>生物收容组研究员 · 你的选择会改变她的结局</small></div><em>关键</em></div>
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>罗恩 / 清道夫 X-7</b><small>安保指挥官与最终封锁 · 两场高强度战斗</small></div><em class="danger">致命</em></div>`;
    } else if (training) {
      dom.briefTitle.innerHTML = '调试火力<br>测试极限';
      dom.briefCopy.textContent = '训练场提供全武器、自由科技与改装配置，以及一个不会死亡、不会反击的沙袋。自由切换 build，查看实时 DPS 与累计伤害。';
      dom.briefWarning.innerHTML = '<i>!</i><span>自由改装 · 无限资源 · 沙袋不反击</span>';
      dom.hostileList.innerHTML = `
        <div class="hostile-row"><span class="hostile-icon normal"></span><div><b>训练沙袋</b><small>无限生命 · 记录 DPS 与累计伤害</small></div><em>测试</em></div>
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>全武器开放</b><small>1—5 随时切换 · 满改装自由启用</small></div><em>自由</em></div>
        <div class="hostile-row"><span class="hostile-icon elite"></span><div><b>科技树自由配置</b><small>点击节点启用/取消 · 不消耗天赋点</small></div><em>无限制</em></div>`;
    } else if (rogue) {
      dom.briefTitle.innerHTML = '下潜至<br>随机实验层';
      dom.briefCopy.textContent = '无尽实验区每次都会重构房间与走廊。搜索补给、在独立补给站强化装备，乘电梯继续下潜。敌人随深度加速强化，每 3 层出现区域守卫。';
      dom.briefWarning.innerHTML = '<i>!</i><span>随机地图 · 每 3 层 Boss · 永久死亡</span>';
      dom.hostileList.innerHTML = `
        <div class="hostile-row"><span class="hostile-icon normal"></span><div><b>普通实验体</b><small>数量随深度提升 · 加速成长</small></div><em>递增</em></div>
        <div class="hostile-row"><span class="hostile-icon elite"></span><div><b>精英实验体</b><small>生命与火力逐层强化</small></div><em>高威胁</em></div>
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>区域守卫</b><small>每 3 层出现 · 随机三名 Boss 之一</small></div><em class="danger">致命</em></div>`;
    } else if (campaign) {
      dom.briefTitle.innerHTML = '穿过三层<br>收容设施';
      dom.briefCopy.textContent = '从起点电梯出发，在折返通道中搜索箱柜补给（每处需等待 3 秒），在独立补给站的终端强化装备。抵达终点电梯前，必须先击败该区域的指挥官。';
      dom.briefWarning.innerHTML = '<i>!</i><span>3 张折返地图 · 3 场 Boss 战 · 圆形视野与区域封锁</span>';
      dom.hostileList.innerHTML = `
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>实验室主任</b><small>毒瓶 · 冲锋枪 · 自爆变异体</small></div><em>区域 01</em></div>
        <div class="hostile-row"><span class="hostile-icon elite"></span><div><b>士官长</b><small>霰弹枪 · 火箭筒 · 士兵召唤</small></div><em>区域 02</em></div>
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>清道夫 X-7</b><small>冲撞 · 追踪火箭 · 哨戒炮</small></div><em class="danger">区域 03</em></div>`;
    } else {
      dom.briefTitle.innerHTML = '活着离开<br>收容核心';
      dom.briefCopy.textContent = '实验体正在突破封锁。收集信用点，在军械库中升级火力，在科技树中接入双持、护盾、炮塔与紧急重构。';
      dom.briefWarning.innerHTML = '<i>!</i><span>每 3 波检测到一次指挥官级高能反应</span>';
      dom.hostileList.innerHTML = `
        <div class="hostile-row"><span class="hostile-icon normal"></span><div><b>三大敌人体系</b><small>生物实验室 / 军事安保 / 机械设施 · 每 5 波轮换</small></div><em>区域</em></div>
        <div class="hostile-row"><span class="hostile-icon elite"></span><div><b>精英协同</b><small>精英士兵存活时普通士兵获得 FIRE+ 攻速加成</small></div><em>中威胁</em></div>
        <div class="hostile-row"><span class="hostile-icon boss"></span><div><b>区域守卫</b><small>实验室主任 / 士官长 / 清道夫 X-7 · 随区域轮换</small></div><em class="danger">致命</em></div>`;
    }
    updateBestUI();
    syncMenuCheckpointUI();
  }

  function syncMenuCheckpointUI() {
    if (!dom.startLabel || !dom.startSub) return;
    const rogue = game.menuMode === 'rogue';
    const campaign = game.menuMode === 'campaign';
    const training = game.menuMode === 'training';
    const story = game.menuMode === 'story';
    setText(dom.startLabel, story ? '进入剧情' : training ? '进入训练场' : rogue ? '开始下潜' : campaign ? '开始闯关' : '进入实验区');
    setText(dom.startSub, story ? 'STORY · ESCAPE FROM LAB ZERO' : training ? 'TRAINING · SANDBAG RANGE' : rogue ? 'ROGUE · ENDLESS FLOORS' : campaign ? 'CAMPAIGN · 03 SECTORS' : 'DEPLOY INTO SECTOR 07');
    dom.btnStart?.classList.remove('is-continue');
    const checkpoint = game.endlessCheckpoint;
    const resumable = game.mode === 'menu'
      && game.menuMode === 'endless'
      && checkpoint
      && checkpoint.difficulty === game.difficulty
      && Number(checkpoint.wave) >= 1;
    if (resumable) {
      const diff = DIFFICULTIES[checkpoint.difficulty] || DIFFICULTIES.normal;
      setText(dom.startLabel, '继续行动');
      setText(dom.startSub, `从第 ${pad2(checkpoint.wave)} 波恢复 · ${diff.name}`);
      dom.btnStart?.classList.add('is-continue');
    }
    if (dom.btnClearCheckpoint) {
      dom.btnClearCheckpoint.classList.toggle('is-hidden', !resumable);
      setText(dom.btnClearCheckpoint, resumable ? `放弃第 ${pad2(checkpoint.wave)} 波进度` : '放弃无尽进度');
    }
  }

  function setMenuMode(mode) {
    if (game.mode !== 'menu') return;
    game.menuMode = normalizeMenuMode(mode);
    storeString('labzero.menuMode', game.menuMode);
    syncMenuModeUI();
    Sfx.init();
    Sfx.click();
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateBestUI() {
    const diff = getDifficultyConfig();
    if (game.menuMode === 'story') {
      setText(dom.recordLabel, '剧情档案');
      setText(dom.bestWave, '零号逃逸');
      if (dom.bestCopy) dom.bestCopy.textContent = '视觉小说 · 3 场战斗 · 关键选择 · 4 种结局';
      if (dom.bestBreakdown) dom.bestBreakdown.textContent = '阿兰 · 林澈 · 罗恩 · 零 // ESCAPE FROM LAB ZERO';
      setText(dom.goBest, '剧情模式 · 零号逃逸');
      return;
    }
    if (game.menuMode === 'rogue') {
      const byDifficulty = game.rogueRecord?.byDifficulty || {};
      const bestFloor = byDifficulty[diff.id]?.bestFloor || 0;
      setText(dom.recordLabel, '肉鸽纪录');
      setText(dom.bestWave, bestFloor > 0 ? `最深 FLOOR ${pad2(bestFloor)}` : '尚未下潜');
      if (dom.bestCopy) {
        dom.bestCopy.textContent = bestFloor > 0
          ? `当前难度：${diff.name} · 本难度最深 ${bestFloor} 层`
          : `当前难度：${diff.name} · 本难度尚无下潜记录。`;
      }
      if (dom.bestBreakdown) {
        dom.bestBreakdown.textContent = DIFFICULTY_ORDER
          .map((id) => `${DIFFICULTIES[id].name} ${byDifficulty[id]?.bestFloor > 0 ? `最深 ${byDifficulty[id].bestFloor} 层` : '未下潜'}`)
          .join('  ·  ');
      }
      setText(dom.goBest, bestFloor > 0
        ? `${diff.name}肉鸽最深 FLOOR ${pad2(bestFloor)}`
        : `${diff.name}肉鸽 · 尚未下潜`);
      return;
    }
    if (game.menuMode === 'campaign') {
      const byDifficulty = game.campaignRecord?.byDifficulty || {};
      const record = byDifficulty[diff.id] || { clears: 0, bestTime: 0 };
      setText(dom.recordLabel, '闯关纪录');
      setText(dom.bestWave, record.clears > 0 ? `已通关 ${record.clears} 次` : '未通关');
      if (dom.bestCopy) {
        dom.bestCopy.textContent = record.bestTime > 0
          ? `当前难度：${diff.name} · 最佳用时 ${formatDuration(record.bestTime)} · 三层全部肃清`
          : `当前难度：${diff.name} · 尚未通关，从起点电梯出发穿过三层实验室。`;
      }
      if (dom.bestBreakdown) {
        dom.bestBreakdown.textContent = DIFFICULTY_ORDER
          .map((id) => `${DIFFICULTIES[id].name} ${byDifficulty[id]?.clears > 0 ? `已通关 ${byDifficulty[id].clears} 次` : '未通关'}`)
          .join('  ·  ');
      }
      setText(dom.goBest, record.bestTime > 0
        ? `${diff.name}闯关最佳用时 ${formatDuration(record.bestTime)}`
        : `${diff.name}闯关 · 尚未通关`);
      return;
    }
    const stats = game.bestStats || { overall: 0, easy: 0, normal: 0, hard: 0, inferno: 0 };
    const currentBest = stats[diff.id] || 0;
    setText(dom.recordLabel, '本难度最高波次');
    setText(dom.bestWave, `WAVE ${pad2(currentBest)}`);
    if (dom.bestCopy) {
      dom.bestCopy.textContent = currentBest > 0
        ? `当前难度：${diff.name} · 本难度最高 WAVE ${pad2(currentBest)}`
        : `当前难度：${diff.name} · 本难度尚无最高波次记录。`;
    }
    if (dom.bestBreakdown) {
      dom.bestBreakdown.textContent = DIFFICULTY_ORDER
        .map((id) => `${DIFFICULTIES[id].name} ${pad2(stats[id] || 0)}`)
        .join('  ·  ');
    }
    setText(dom.goBest, currentBest > 0
      ? `${diff.name}最高纪录 WAVE ${pad2(currentBest)}`
      : `${diff.name}尚无最高纪录`);
  }

  function syncDifficultyUI() {
    const diff = getDifficultyConfig();
    document.querySelectorAll('[data-difficulty]').forEach((btn) => {
      const active = btn.dataset.difficulty === diff.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setText(dom.difficultyLabel, diff.name);
    setText(dom.difficultyDesc, diff.desc);
    setText(dom.hudDifficulty, diff.name);
  }

  function setDifficulty(id) {
    if (!DIFFICULTIES[id] || game.mode !== 'menu') return;
    game.difficulty = normalizeDifficulty(id);
    storeString('labzero.difficulty', game.difficulty);
    game.bestWave = game.bestStats[game.difficulty] || 0;
    syncDifficultyUI();
    updateBestUI();
    syncMenuCheckpointUI();
    Sfx.init();
    Sfx.click();
  }

  function buildWeaponDock() {
    dom.weaponSlots.innerHTML = WEAPON_ORDER.map((id, i) => {
      const w = WEAPONS[id];
      return `<button class="weapon-slot ${id === 'pistol' ? '' : 'locked'}" type="button" data-weapon="${id}" aria-label="${w.name}">
        <span class="slot-key">${i + 1}</span>
        <span class="slot-art">${weaponIcon(id)}</span>
        <span class="slot-name">${w.short}</span>
        <span class="slot-lock">${lockIcon}</span>
      </button>`;
    }).join('');
  }

  function updateWeaponDock() {
    if (!game.player) return;
    const p = game.player;
    const dual = hasTalent('dualWield');
    dom.weaponSlots.querySelectorAll('.weapon-slot').forEach((slot) => {
      const id = slot.dataset.weapon;
      const active = p.weapon === id;
      const offhand = dual && p.offhand === id;
      const owned = !!p.owned[id];
      slot.classList.toggle('active', active);
      slot.classList.toggle('offhand', offhand);
      slot.classList.toggle('locked', !owned);
      slot.setAttribute('aria-pressed', active ? 'true' : 'false');
      slot.title = owned
        ? `${WEAPONS[id].name} · 按 ${WEAPON_ORDER.indexOf(id) + 1} 切换${dual ? ' · 右键设为副手' : ''}`
        : `${WEAPONS[id].name} · 未解锁`;
    });
  }

  function addToast(mark, title, copy, type = '', ttl = 4200) {
    const node = document.createElement('div');
    node.className = `toast ${type}`.trim();
    const markNode = document.createElement('span');
    markNode.className = 'toast-mark';
    markNode.textContent = mark;
    const copyNode = document.createElement('div');
    copyNode.className = 'toast-copy';
    const titleNode = document.createElement('b');
    titleNode.textContent = title;
    const textNode = document.createElement('span');
    textNode.textContent = copy;
    copyNode.append(titleNode, textNode);
    node.append(markNode, copyNode);
    dom.toastStack.appendChild(node);
    while (dom.toastStack.children.length > 4) {
      dom.toastStack.firstElementChild?.remove();
    }
    window.setTimeout(() => {
      node.classList.add('is-out');
      window.setTimeout(() => node.remove(), 300);
    }, ttl);
    return node;
  }

  function clearToasts() {
    dom.toastStack.innerHTML = '';
  }

  function showBanner(kicker, title, sub, danger = false, duration = 3150) {
    const banner = dom.banner;
    if (!banner) return;
    window.clearTimeout(game.bannerTimeout);
    banner.classList.remove('show', 'danger');
    setText(dom.bannerKicker, kicker);
    setText(dom.bannerTitle, title);
    setText(dom.bannerSub, sub);
    banner.classList.toggle('danger', danger);
    banner.style.animationDuration = `${duration}ms`;
    void banner.offsetWidth;
    banner.classList.add('show');
    game.bannerTimeout = window.setTimeout(() => {
      banner.classList.remove('show');
    }, duration + 120);
  }

  function updateSpeedUI() {
    const available = game.runMode === 'endless';
    dom.btnSpeed?.classList.toggle('is-hidden', !available);
    dom.btnSpeed?.classList.toggle('is-fast', available && game.speedMultiplier === 2);
    if (dom.speedLabel) setText(dom.speedLabel, game.speedMultiplier === 2 ? '2×' : '1×');
    if (dom.btnSpeed) {
      dom.btnSpeed.setAttribute('aria-label', `游戏速度 ${game.speedMultiplier} 倍（仅普通无尽）`);
      dom.btnSpeed.title = `游戏速度 ${game.speedMultiplier}× · 点击切换 1× / 2×`;
    }
  }

  function toggleGameSpeed() {
    if (game.runMode !== 'endless' || !game.player) return;
    game.speedMultiplier = game.speedMultiplier === 2 ? 1 : 2;
    updateSpeedUI();
    Sfx.click();
    addToast('»', `游戏速度切换为 ${game.speedMultiplier}×`, '仅普通无尽生效 · 最高 2 倍速', 'gold', 2200);
  }

  function updateAbilityHUD() {
    const p = game.player;
    if (!p) return;
    const turretUnlocked = hasTalent('turret');
    const respawnUnlocked = hasTalent('respawn');
    const character = getCharacterDef(p.characterId);
    const characterSkill = character.active;
    dom.btnCharacterSkill.classList.toggle('is-hidden', !characterSkill);
    dom.btnTurret.classList.toggle('is-hidden', !turretUnlocked);
    dom.respawnChip.classList.toggle('is-hidden', !respawnUnlocked);
    dom.abilityBar.classList.toggle('is-hidden', !characterSkill && !turretUnlocked && !respawnUnlocked);
    if (characterSkill) {
      const valkyrieBarrage = characterSkill.id === 'homingBarrage';
      const missiles = valkyrieBarrage ? Math.floor(p.valkyrieMissiles ?? 0) : 0;
      const ready = valkyrieBarrage
        ? missiles > 0 && p.alive && !p.reviving
        : p.skillCooldown <= 0 && p.alive && !p.reviving;
      dom.btnCharacterSkill.disabled = !ready;
      dom.btnCharacterSkill.classList.toggle('ability-ready', ready);
      setText(dom.characterSkillName, characterSkill.name);
      if (!p.alive || p.reviving) setText(dom.characterSkillStatus, '重构中 · 不可用');
      else if (valkyrieBarrage) setText(dom.characterSkillStatus, `空格 · ${missiles} / 16 导弹`);
      else if (p.skillCooldown > 0) setText(dom.characterSkillStatus, `空格 · 冷却 ${p.skillCooldown.toFixed(1)}s`);
      else setText(dom.characterSkillStatus, '空格 · 就绪');
      if (valkyrieBarrage) {
        dom.characterSkillFill.style.width = `${clamp(missiles / 16, 0, 1) * 100}%`;
      } else {
        const max = Math.max(0.001, p.skillCooldownMax || characterSkill.cooldown);
        dom.characterSkillFill.style.width = `${p.skillCooldown <= 0 ? 100 : clamp(1 - p.skillCooldown / max, 0, 1) * 100}%`;
      }
    }
    if (turretUnlocked) {
      const activeTurrets = game.turrets.filter((t) => !t.dead && t.hp > 0).length;
      const limit = turretLimit();
      const tier = turretTierDef();
      const maxed = activeTurrets >= limit;
      const ready = p.turretCooldown <= 0 && p.alive && !p.reviving && !maxed;
      dom.btnTurret.disabled = !ready;
      dom.btnTurret.classList.toggle('ability-ready', ready);
      dom.btnTurret.title = `哨戒炮塔 (F) · ${tier.name} · ${activeTurrets}/${limit} 座`;
      if (!p.alive || p.reviving) setText(dom.turretStatus, '重构中 · 不可用');
      else if (maxed) setText(dom.turretStatus, `已部署 ${activeTurrets}/${limit} · 上限`);
      else if (p.turretCooldown > 0) setText(dom.turretStatus, `冷却 ${Math.ceil(p.turretCooldown)}s · ${activeTurrets}/${limit}`);
      else setText(dom.turretStatus, `F · ${tier.name} ${activeTurrets}/${limit}`);
      const turretMaxCooldown = turretDeployCooldown();
      dom.turretFill.style.width = `${p.turretCooldown <= 0 ? 100 : clamp(1 - p.turretCooldown / turretMaxCooldown, 0, 1) * 100}%`;
    }
    if (respawnUnlocked) {
      if (p.reviving) setText(dom.respawnStatus, `重构 ${Math.max(0, p.reviveTimer).toFixed(1)}s`);
      else if (p.reviveCooldown > 0) setText(dom.respawnStatus, `冷却 ${Math.ceil(p.reviveCooldown)}s`);
      else setText(dom.respawnStatus, '被动 · 就绪');
      dom.respawnChip.classList.toggle('is-cooling', p.reviveCooldown > 0 || p.reviving);
    }
    // Revive channel overlay.
    if (p.reviving) {
      dom.reviveHud.classList.remove('is-hidden');
      const progress = 1 - p.reviveTimer / Math.max(0.001, p.reviveDuration);
      setText(dom.reviveCount, `${Math.max(0, p.reviveTimer).toFixed(1)}s`);
      dom.reviveFill.style.width = `${clamp(progress * 100, 0, 100)}%`;
    } else {
      dom.reviveHud.classList.add('is-hidden');
    }
  }

  function updateHUD() {
    const p = game.player;
    if (!p) return;
    const stats = getWeaponStats();
    setText(dom.level, pad2(p.level));
    setText(dom.hpText, `${Math.max(0, Math.ceil(p.hp))} / ${Math.ceil(p.maxHp)}`);
    setText(dom.xpText, `${Math.floor(p.xp)} / ${p.xpNext}`);
    dom.hpFill.style.width = `${clamp((p.hp / p.maxHp) * 100, 0, 100)}%`;
    dom.xpFill.style.width = `${clamp((p.xp / p.xpNext) * 100, 0, 100)}%`;
    const effSpeed = levelSpeedMult(p.level) * stats.mobility * movementTalentMultiplier() * (1 + (p.campaignUpgrades?.speed || 0) * 0.04) * (getCharacterDef(p.characterId).speedMult || 1);
    setText(dom.speed, `${Math.round(effSpeed * 100)}%`);
    setText(dom.reloadStat, `${Math.round(stats.reloadSpeed * 100)}%`);
    setText(dom.kills, p.kills);
    setText(dom.credits, formatInt(p.credits));
    setText(dom.statTalents, isTraining() ? '∞' : p.talentPoints);
    setText(dom.talentBadge, isTraining() ? '∞' : p.talentPoints);
    dom.btnTalents.classList.toggle('has-points', isTraining() || p.talentPoints > 0);
    dom.btnTalents.title = `天赋科技树 (T) · 可用 ${p.talentPoints} 点`;
    // Shield meter.
    if (p.shieldUnlocked) {
      dom.shieldRow.classList.remove('is-hidden');
      const shieldRatio = clamp(p.shield / Math.max(1, p.maxShield), 0, 1);
      dom.shieldFill.style.width = `${shieldRatio * 100}%`;
      dom.shieldRow.classList.toggle('is-broken', p.shieldBroken);
      if (p.shieldBroken) {
        setText(dom.shieldText, `破盾 · ${Math.max(0, p.shieldBreakTimer).toFixed(1)}s 后恢复`);
      } else {
        setText(dom.shieldText, `${Math.ceil(p.shield)} / ${Math.ceil(p.maxShield)}`);
      }
    } else {
      dom.shieldRow.classList.add('is-hidden');
    }
    // Offhand HUD.
    if (hasTalent('dualWield')) {
      dom.offhandHud.classList.remove('is-hidden');
      if (p.offhand) {
        const off = getWeaponStats(p.offhand);
        setText(dom.offhandName, off.base.name);
        setText(dom.offhandAmmo, isDeveloperMode() || (p.characterId === 'valkyrie' && p.offhand === 'rocket') ? '∞ / ∞' : `${p.ammo[p.offhand] ?? 0} / ∞`);
        if (p.offhandReloading) {
          const percent = Math.round((1 - p.offhandReloadTimer / Math.max(0.001, p.offhandReloadDuration)) * 100);
          setText(dom.offhandState, `装填 ${clamp(percent, 0, 100)}%`);
        } else {
          setText(dom.offhandState, '右键射击 · 槽位右键更换');
        }
      } else {
        setText(dom.offhandName, '未配置副手');
        setText(dom.offhandState, '右键武器槽指定');
        setText(dom.offhandAmmo, '— / ∞');
      }
    } else {
      dom.offhandHud.classList.add('is-hidden');
    }
    updateAbilityHUD();
    updateSpeedUI();
    updateGrenadeHud();
    if (game.intermission) {
      setText(dom.interTalentPoints, p.talentPoints);
      dom.interTalentRow.classList.toggle('has-points', p.talentPoints > 0);
      dom.btnInterTalents.classList.toggle('talent-alert', p.talentPoints > 0);
    }
    setText(dom.weaponName, stats.base.name);
    setText(dom.weaponCode, stats.base.code);
    setText(dom.weaponSlotLabel, `${stats.base.slotLabel} // SLOT ${pad2(WEAPON_ORDER.indexOf(p.weapon) + 1)}`);
    const devInfinite = isDeveloperMode();
    const valkyrieRocketHud = p.characterId === 'valkyrie' && p.weapon === 'rocket';
    const infiniteAmmoHud = devInfinite || valkyrieRocketHud;
    setText(dom.ammoMag, infiniteAmmoHud ? '∞' : (p.ammo[p.weapon] ?? 0));
    dom.ammoCount.classList.toggle('empty', !infiniteAmmoHud && (p.ammo[p.weapon] ?? 0) <= 0 && !p.reloading);
    dom.ammoCount.classList.toggle('low', !infiniteAmmoHud && (p.ammo[p.weapon] ?? 0) > 0 && (p.ammo[p.weapon] ?? 0) <= Math.max(2, Math.ceil(stats.capacity * 0.22)));
    dom.reloadLine.classList.toggle('is-reloading', !infiniteAmmoHud && p.reloading);
    if (infiniteAmmoHud) {
      dom.reloadTrack.classList.remove('active');
      dom.reloadFill.style.width = '0%';
      setText(dom.reloadLabel, valkyrieRocketHud ? '追踪导弹 · 无需装填' : '开发者 · 无限弹药');
    } else if (p.reloading) {
      const progress = 1 - p.reloadTimer / Math.max(0.001, p.reloadDuration);
      dom.reloadTrack.classList.add('active');
      dom.reloadFill.style.width = `${clamp(progress * 100, 0, 100)}%`;
      setText(dom.reloadLabel, `装填 ${Math.round(clamp(progress, 0, 1) * 100)}%`);
    } else {
      dom.reloadTrack.classList.remove('active');
      dom.reloadFill.style.width = '0%';
      setText(dom.reloadLabel, p.ammo[p.weapon] <= 0 ? '弹匣已空' : 'R 换弹');
    }
    const hudCharacter = getCharacterDef(p.characterId);
    setText(dom.agentName, hudCharacter.id === 'alan' ? '干员 · 流浪者' : `${hudCharacter.name} · ${hudCharacter.role}`);
    const valkyrieFlight = hudCharacter.id === 'valkyrie';
    setText(dom.dashLabel, valkyrieFlight ? '喷气背包 · 无CD' : '战术冲刺');
    const dashProgress = valkyrieFlight || p.dashCooldown <= 0 ? 1 : 1 - p.dashCooldown / DASH_COOLDOWN;
    dom.dashFill.style.width = `${clamp(dashProgress * 100, 0, 100)}%`;
    document.body.classList.toggle('low-hp', p.alive && p.hp / p.maxHp <= 0.28);
    updateWeaponDock();

    // Wave / mission state.
    setText(dom.hudDifficulty, getDifficultyConfig().name);
    const storyMode = game.runMode === 'story';
    const trainingMode = game.runMode === 'training';
    const campaignMode = game.runMode === 'campaign' && game.campaign.level;
    if (storyMode) {
      const story = game.story || {};
      const stage = story.currentCombat || {};
      setText(dom.hudDifficulty, '剧情');
      setText(dom.missionKicker, 'STORY // ESCAPE FROM LAB ZERO');
      setText(dom.waveTitle, stage.chapter || '零号实验区');
      setText(dom.missionState, stage.objective || '继续前进');
      dom.missionState.classList.toggle('is-danger', true);
      const living = countLivingEnemies();
      const total = Math.max(1, story.totalEnemies || living);
      setText(dom.enemyCount, `剩余 ${String(living).padStart(2, '0')} / ${String(story.totalEnemies || 0).padStart(2, '0')}`);
      dom.threatFill.style.width = `${clamp(1 - living / total, 0, 1) * 100}%`;
      setText(dom.threatLabel, 'STORY');
      setText(dom.minimapSector, 'ZERO');
    } else if (trainingMode) {
      setText(dom.missionKicker, 'TRAINING // 火力测试');
      setText(dom.waveTitle, '训练场');
      setText(dom.missionState, '自由配置');
      dom.missionState.classList.remove('is-danger');
      setText(dom.enemyCount, '沙袋 · 无限生命');
      dom.threatFill.style.width = '100%';
      setText(dom.threatLabel, 'SANDBAG ONLINE');
      setText(dom.minimapSector, 'TR-01');
    } else if (campaignMode) {
      const campaign = game.campaign;
      const level = campaign.level;
      const rogue = campaign.rogue;
      const floor = campaign.rogueFloor || campaign.levelIndex + 1;
      setText(dom.missionKicker, rogue ? 'ROGUE // 无尽实验层' : 'CAMPAIGN // 实验区突破');
      setText(dom.waveTitle, rogue ? `第 ${pad2(floor)} 层` : `${pad2(campaign.levelIndex + 1)} · ${level.name}`);
      if (campaign.bossActive) {
        const bossState = rogue ? '守卫战' : 'BOSS 战';
        setText(dom.missionState, campaign.arenaLocked ? `区域封锁 · ${bossState}` : bossState);
        dom.missionState.classList.add('is-danger');
      } else if (campaign.bossDefeated) {
        setText(dom.missionState, rogue ? '电梯就绪 · 继续下潜' : '电梯已解锁');
        dom.missionState.classList.remove('is-danger');
      } else if (rogue && level.bossTrigger) {
        setText(dom.missionState, '守卫层');
        dom.missionState.classList.add('is-danger');
      } else {
        setText(dom.missionState, rogue ? '前往上行电梯' : '探索中');
        dom.missionState.classList.remove('is-danger');
      }
      const campaignThreatCount = campaign.arenaLocked
        ? game.enemies.filter((enemy) => !enemy.dead && (enemy.campaignBoss || enemy.campaignBossMinion || pointInRect(enemy.x, enemy.y, campaign.arenaRoom))).length
        : countLivingEnemies();
      setText(dom.enemyCount, `搜索 ${campaign.levelSearched}/${campaign.levelSearchTotal} · 敌情 ${campaignThreatCount}`);
      dom.threatFill.style.width = `${campaignProgress() * 100}%`;
      setText(dom.threatLabel, rogue ? `FLOOR ${pad2(floor)} / ∞` : `SECTOR ${pad2(campaign.levelIndex + 1)} / 03`);
      setText(dom.minimapSector, level.code);
    } else {
      const endlessBiome = ENDLESS_BIOMES.find((b) => b.system === game.endlessBiome) || ENDLESS_BIOMES[0];
      setText(dom.missionKicker, `ACTIVE DIRECTIVE // ${endlessBiome.name}`);
      setText(dom.minimapSector, endlessBiome.code);
      setText(dom.waveTitle, `第 ${pad2(game.wave)} 波`);
      if (game.intermission) {
        setText(dom.missionState, '区域安全 · 休整');
        dom.missionState.classList.remove('is-danger');
      } else if (game.bossRef && !game.bossRef.dead) {
        setText(dom.missionState, '高危目标');
        dom.missionState.classList.add('is-danger');
      } else if (game.waveActive) {
        setText(dom.missionState, '清剿中');
        dom.missionState.classList.remove('is-danger');
      } else {
        setText(dom.missionState, '待命');
        dom.missionState.classList.remove('is-danger');
      }
      const remaining = countRemainingEnemies();
      setText(dom.enemyCount, game.intermission
        ? `下一波 ${Math.max(0, Math.ceil(game.intermissionTimer))}s`
        : game.waveActive
          ? `剩余 ${pad2(remaining)}`
          : '待命');
      const threatTotal = Math.max(1, game.waveTotal);
      const threat = clamp(remaining / threatTotal, 0, 1);
      dom.threatFill.style.width = `${threat * 100}%`;
      setText(dom.threatLabel, `THREAT ${pad2(Math.max(1, game.wave))}`);
    }

    const boss = game.bossRef;
    if (boss && !boss.dead) {
      dom.bossHud.classList.remove('is-hidden');
      const fallbackBossKind = ENEMY_SYSTEMS[game.endlessBiome]?.bossKind;
      const bossDef = CAMPAIGN_BOSS_DEFS[boss.bossKind || fallbackBossKind] || null;
      setText(dom.bossTag, bossDef ? bossDef.tag : 'HIGH-VALUE TARGET');
      setText(dom.bossName, bossDef ? bossDef.name : '区域守卫');
      setText(dom.bossCode, bossDef ? `// ${bossDef.code}` : '// SECTOR GUARDIAN');
      setText(dom.bossDesc, bossDef ? `威胁特性：${bossDef.desc}` : '威胁等级：致命 · 具备召唤能力');
      const bossRatio = clamp(boss.hp / boss.maxHp, 0, 1);
      dom.bossHpFill.style.width = `${bossRatio * 100}%`;
      setText(dom.bossHpText, `${Math.max(0, Math.ceil(boss.hp))} / ${Math.ceil(boss.maxHp)}`);
      setText(dom.bossPhase, bossRatio <= 0.5 ? '阶段 II' : '阶段 I');
    } else {
      dom.bossHud.classList.add('is-hidden');
    }

    if (game.intermission) {
      setText(dom.nextCountdown, Math.max(0, Math.ceil(game.intermissionTimer)));
    }
  }

  function updatePauseStats() {
    const p = game.player;
    if (!p) return;
    const story = game.runMode === 'story';
    const training = game.runMode === 'training';
    const campaign = game.runMode === 'campaign' && game.campaign.level;
    const rogue = campaign && game.campaign.rogue;
    setText(dom.pauseWaveLabel, story ? '当前章节' : training ? '当前模式' : rogue ? '当前深度' : campaign ? '当前区域' : '当前波次');
    setText(dom.pauseWave, story ? (game.story?.currentCombat?.chapter || '剧情') : training ? '训练场' : rogue ? `${game.campaign.rogueFloor} 层` : campaign ? `${game.campaign.levelIndex + 1} / 3` : pad2(game.wave));
    setText(dom.pauseLevel, pad2(p.level));
    setText(dom.pauseKills, p.kills);
  }

  /* ------------------------------------------------------------
     Armory UI
     ------------------------------------------------------------ */
  function buildWeaponCard(id) {
    const p = game.player;
    const w = WEAPONS[id];
    const owned = !!p.owned[id];
    const active = p.weapon === id;
    const stats = getWeaponStats(id);
    const unaffordable = !owned && p.credits < w.price;
    const buyBlock = active
      ? '<span class="equipped-tag">使用中</span><small>已装配至当前槽位</small>'
      : owned
        ? '<strong class="owned-tag">已解锁</strong><small>点击装备</small>'
        : `<strong>${formatInt(w.price)} CR</strong><small>${unaffordable ? '信用点不足' : '买断解锁'}</small>`;
    return `<button class="weapon-card ${active ? 'is-active' : ''} ${unaffordable ? 'is-unaffordable' : ''}" type="button" data-weapon-id="${id}">
      <span class="weapon-index">${pad2(WEAPON_ORDER.indexOf(id) + 1)}</span>
      <span class="weapon-art">${weaponIcon(id)}</span>
      <span class="weapon-info">
        <span class="weapon-tier">${w.classLabel}</span>
        <span class="weapon-heading">${w.name} <em>${w.code.split(' // ')[0]}</em></span>
        <span class="weapon-specs">
          <span>伤害 <b>${Math.round(stats.damage)}</b></span>
          <span>弹匣 <b>${stats.capacity}</b></span>
          <span>射速 <b>${stats.rpm}</b></span>
          <span>装填 <b>${stats.reload.toFixed(2)}s</b></span>
          <span>机动 <b>${Math.round(w.mobility * 100)}%</b></span>
          ${w.splashRadius ? `<span>爆炸范围 <b>${Math.round(stats.splashRadius)}</b></span>` : ''}
        </span>
      </span>
      <span class="weapon-buy">${buyBlock}</span>
    </button>`;
  }

  function buildModCard(key) {
    const p = game.player;
    const weaponId = p.weapon;
    const def = MODS[key];
    const level = p.mods[weaponId][key];
    const maxed = level >= def.max;
    const cost = maxed ? 0 : modCost(weaponId, key, level);
    const affordable = maxed || p.credits >= cost;
    const pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const nextText = maxed
      ? '<span><b>性能已满</b></span>'
      : `<span>下一级 <b>${def.effect(level + 1)}</b></span>`;
    return `<button class="mod-card ${maxed ? 'is-maxed' : ''} ${!affordable ? 'is-unaffordable' : ''}" type="button" data-mod="${key}" ${maxed ? 'disabled' : ''}>
      <span class="mod-head">
        <span class="mod-icon">${MOD_ICONS[key]}</span>
        <span class="mod-level">MK <b>${level}</b> / ${def.max}</span>
      </span>
      <span class="mod-title">${def.name}</span>
      <span class="mod-desc">${def.desc}</span>
      <span class="mod-pips">${pips}</span>
      <span class="mod-effect">
        <span>当前 <b>${level > 0 ? def.effect(level) : '未改装'}</b></span>
        ${nextText}
      </span>
      <span class="mod-buy">
        <span>${maxed ? '改装完成' : '升级改装'}</span>
        <b>${maxed ? 'MAX' : `${formatInt(cost)} CR`}</b>
      </span>
    </button>`;
  }

  function renderShop() {
    const p = game.player;
    if (!p) return;
    const weaponId = p.weapon;
    const stats = getWeaponStats(weaponId);
    setText(dom.shopCredits, formatInt(p.credits));
    setText(dom.shopHp, `${Math.ceil(p.hp)} / ${Math.ceil(p.maxHp)}`);
    dom.weaponList.innerHTML = WEAPON_ORDER.map(buildWeaponCard).join('');
    dom.benchArt.innerHTML = weaponIcon(weaponId);
    setText(dom.benchCode, stats.base.code);
    setText(dom.benchName, stats.base.name);
    setText(dom.benchDesc, stats.base.desc);
    setText(dom.benchDps, Math.round(stats.dps));
    dom.modGrid.innerHTML = MOD_KEYS.map(buildModCard).join('');
    const fullHealth = p.hp >= p.maxHp;
    dom.btnBuyMedkit.disabled = fullHealth || p.credits < MEDKIT_COST;
    dom.btnBuyMedkit.textContent = fullHealth ? '生命已满' : `${MEDKIT_COST} CR`;
    dom.campaignUpgradeSection.classList.toggle('is-hidden', game.runMode !== 'campaign');
    const grenadeHelp = game.runMode === 'campaign' ? 'Q 投掷 · G 切换' : 'Q 投掷 · E 切换';
    setText(dom.grenadeShopHelp, grenadeHelp);
    setText(dom.shopHelp, game.runMode === 'campaign' ? 'Q 投掷 · G 切换 · 滚轮查看全部补给' : 'Q 投掷 · E 切换 · 滚轮查看全部补给');
    if (game.runMode === 'campaign') renderCampaignUpgrades();
    renderGrenadeShop();
  }

  function openShop(fromCampaignTerminal = false) {
    if (!game.player || game.mode !== 'playing') return;
    if (game.runMode === 'story') {
      Sfx.error();
      addToast('B', '剧情战斗无法打开军械库', '本场战斗使用剧情预设装备', '', 2800);
      return;
    }
    if (game.runMode === 'campaign' && !fromCampaignTerminal) {
      Sfx.error();
      addToast('B', '需要在商店终端操作', '找到区域内的商店终端并按 F 打开', 'danger', 3200);
      return;
    }
    game.mode = 'shop';
    game.hitFlash = 0;
    dom.hitFlash.style.opacity = '0';
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    renderShop();
    dom.shopOverlay.classList.remove('is-hidden');
    applySoundUI();
    Sfx.click();
    dom.shopClose.focus({ preventScroll: true });
  }

  function closeShop() {
    if (game.mode !== 'shop') return;
    dom.shopOverlay.classList.add('is-hidden');
    game.mode = 'playing';
    game.lastFrame = performance.now();
    Sfx.click();
    if (game.intermission) dom.btnInterShop.focus({ preventScroll: true });
    else dom.canvas.focus?.({ preventScroll: true });
  }

  function buyWeapon(id) {
    const p = game.player;
    const weapon = WEAPONS[id];
    if (!p || !weapon) return;
    if (p.owned[id]) {
      if (setWeapon(id)) {
        addToast('▸', `${weapon.name} 已装备`, '武器系统切换完成', '', 2500);
        updateWeaponDock();
        renderShop();
        updateHUD();
      }
      return;
    }
    if (p.credits < weapon.price) {
      Sfx.error();
      addToast('!', '信用点不足', `购买 ${weapon.name} 需要 ${formatInt(weapon.price)} CR`, 'danger', 3000);
      return;
    }
    p.credits -= weapon.price;
    p.owned[id] = true;
    p.ammo[id] = weaponCapacity(id, p.mods);
    setWeapon(id);
    Sfx.buy();
    addToast('+', '武器已解锁', `${weapon.name} 已加入装备槽 · -${formatInt(weapon.price)} CR`, 'gold', 4200);
    renderShop();
    updateHUD();
    if (game.intermission) setText(dom.interReward, `+${formatInt(game.intermissionReward)} CR`);
  }

  function upgradeMod(key) {
    const p = game.player;
    if (!p || !MODS[key]) return;
    const weaponId = p.weapon;
    const level = p.mods[weaponId][key];
    const def = MODS[key];
    if (level >= def.max) {
      Sfx.error();
      return;
    }
    const cost = modCost(weaponId, key, level);
    if (p.credits < cost) {
      Sfx.error();
      addToast('!', '信用点不足', `${def.name} MK${level + 1} 需要 ${formatInt(cost)} CR`, 'danger', 3000);
      return;
    }
    p.credits -= cost;
    const oldCapacity = weaponCapacity(weaponId, p.mods);
    p.mods[weaponId][key] += 1;
    if (key === 'mag') {
      const added = weaponCapacity(weaponId, p.mods) - oldCapacity;
      p.ammo[weaponId] = Math.min(weaponCapacity(weaponId, p.mods), (p.ammo[weaponId] || 0) + added);
    }
    Sfx.upgrade();
    addToast('◆', `${def.name} 升级至 MK${p.mods[weaponId][key]}`, `${WEAPONS[weaponId].name} · ${def.effect(p.mods[weaponId][key])}`, 'gold', 3800);
    renderShop();
    updateHUD();
  }

  function buyMedkit() {
    const p = game.player;
    if (!p) return;
    if (p.hp >= p.maxHp || p.credits < MEDKIT_COST) {
      Sfx.error();
      return;
    }
    p.credits -= MEDKIT_COST;
    p.hp = Math.min(p.maxHp, p.hp + 60);
    Sfx.heal();
    addToast('+', '生命值已恢复', '战地医疗包 +60 HP', '', 2800);
    renderShop();
    updateHUD();
  }

  /* ------------------------------------------------------------
     Grenade UI and inventory
     ------------------------------------------------------------ */
  function buildGrenadeHud() {
    if (!dom.grenadeSlots) return;
    dom.grenadeSlots.innerHTML = GRENADE_ORDER.map((id) => {
      const g = GRENADES[id];
      return `<button class="grenade-slot" type="button" data-grenade-select="${id}" aria-pressed="false" title="${g.name} · ${g.desc}">
        <span class="grenade-slot-icon" aria-hidden="true">${g.icon}</span>
        <span class="grenade-slot-count">0</span>
      </button>`;
    }).join('');
  }

  function updateGrenadeHud() {
    const p = game.player;
    if (!p || !dom.grenadeSlots) return;
    const selected = GRENADES[p.selectedGrenade] || GRENADES.frag;
    const devInfinite = isDeveloperMode();
    const selectedCount = devInfinite ? Infinity : (p.grenades?.[selected.id] || 0);
    setText(dom.grenadeCurrentName, selectedCount > 0 ? selected.name : `${selected.name} · 已用尽`);
    for (const btn of dom.grenadeSlots.querySelectorAll('[data-grenade-select]')) {
      const id = btn.dataset.grenadeSelect;
      const count = devInfinite ? Infinity : (p.grenades?.[id] || 0);
      btn.classList.toggle('is-active', id === selected.id);
      btn.classList.toggle('is-empty', count <= 0);
      btn.setAttribute('aria-pressed', id === selected.id ? 'true' : 'false');
      const countNode = btn.querySelector('.grenade-slot-count');
      if (countNode) countNode.textContent = devInfinite ? '∞' : count;
    }
  }

  function selectGrenade(id) {
    const p = game.player;
    if (!p || !GRENADES[id]) return;
    p.selectedGrenade = id;
    Sfx.click();
    updateGrenadeHud();
  }

  function cycleGrenade() {
    const p = game.player;
    if (!p) return;
    const available = isDeveloperMode() ? GRENADE_ORDER : GRENADE_ORDER.filter((id) => (p.grenades[id] || 0) > 0);
    const list = available.length ? available : GRENADE_ORDER;
    const index = list.indexOf(p.selectedGrenade);
    p.selectedGrenade = list[(index + 1) % list.length];
    Sfx.click();
    updateGrenadeHud();
  }

  function buildGrenadeShopItem(id) {
    const p = game.player;
    const g = GRENADES[id];
    const stock = p.grenades[id] || 0;
    const maxStock = grenadeMaxStock(id);
    const full = stock >= maxStock;
    const affordable = p.credits >= g.price;
    return `<button class="grenade-shop-item ${full ? 'is-maxed' : ''} ${!full && !affordable ? 'is-unaffordable' : ''}" type="button" data-grenade-buy="${id}" title="${g.name} · ${g.desc}" ${full ? 'disabled' : ''}>
      <span class="grenade-shop-icon" aria-hidden="true">${g.icon}</span>
      <span class="grenade-shop-copy">
        <span class="grenade-shop-name">${g.name}<em>${g.code}</em></span>
        <span class="grenade-shop-desc">${g.desc}</span>
        <span class="grenade-shop-stock">持有 <b>${stock}</b> / ${maxStock}</span>
      </span>
      <span class="grenade-shop-buy"><em>${full ? '库存已满' : `+${g.pack} 枚`}</em><b>${full ? 'MAX' : `${formatInt(g.price)} CR`}</b></span>
    </button>`;
  }

  function renderGrenadeShop() {
    if (!dom.grenadeList || !game.player) return;
    dom.grenadeList.innerHTML = GRENADE_ORDER.map(buildGrenadeShopItem).join('');
  }

  function buyGrenade(id) {
    const p = game.player;
    const g = GRENADES[id];
    if (!p || !g) return;
    const stock = p.grenades[id] || 0;
    const maxStock = grenadeMaxStock(id);
    if (stock >= maxStock) {
      Sfx.error();
      addToast('!', `${g.name}库存已满`, `最多可携带 ${maxStock} 枚`, '', 2400);
      return;
    }
    if (p.credits < g.price) {
      Sfx.error();
      addToast('!', '信用点不足', `购买 ${g.name} 需要 ${formatInt(g.price)} CR`, 'danger', 2800);
      return;
    }
    p.credits -= g.price;
    p.grenades[id] = Math.min(maxStock, stock + g.pack);
    if ((p.grenades[p.selectedGrenade] || 0) <= 0) p.selectedGrenade = id;
    Sfx.buy();
    addToast('+', `${g.name}补给完成`, `+${g.pack} 枚 · 剩余 ${p.grenades[id]} 枚 · 按 Q 投掷`, 'gold', 3400);
    renderShop();
    updateHUD();
  }

  function campaignUpgradeCost(key, level = game.player?.campaignUpgrades?.[key] || 0) {
    const def = CAMPAIGN_UPGRADES[key];
    if (!def) return 0;
    return Math.round((def.baseCost * (1 + level * 0.8)) / 5) * 5;
  }

  function buildCampaignUpgradeCard(key) {
    const p = game.player;
    const def = CAMPAIGN_UPGRADES[key];
    const level = p?.campaignUpgrades?.[key] || 0;
    const maxed = level >= def.max;
    const cost = maxed ? 0 : campaignUpgradeCost(key, level);
    const affordable = maxed || p.credits >= cost;
    return `<button class="campaign-upgrade-card ${maxed ? 'is-maxed' : ''} ${!maxed && !affordable ? 'is-unaffordable' : ''}" type="button" data-campaign-upgrade="${key}" ${maxed ? 'disabled' : ''}>
      <span class="campaign-upgrade-head"><b>${def.name}</b><span>LV ${level} / ${def.max}</span></span>
      <span class="campaign-upgrade-desc">${def.desc}</span>
      <span class="campaign-upgrade-foot"><span>当前 ${level > 0 ? def.effect(level) : '基础值'}</span><b>${maxed ? 'MAX' : `${formatInt(cost)} CR`}</b></span>
    </button>`;
  }

  function renderCampaignUpgrades() {
    if (!dom.campaignUpgradeList) return;
    dom.campaignUpgradeList.innerHTML = CAMPAIGN_UPGRADE_ORDER.map(buildCampaignUpgradeCard).join('');
  }

  function buyCampaignUpgrade(key) {
    const p = game.player;
    const def = CAMPAIGN_UPGRADES[key];
    if (!p || !def || game.runMode !== 'campaign' || game.mode !== 'shop') return;
    const level = p.campaignUpgrades[key] || 0;
    if (level >= def.max) {
      Sfx.error();
      return;
    }
    const cost = campaignUpgradeCost(key, level);
    if (p.credits < cost) {
      Sfx.error();
      addToast('!', '信用点不足', `${def.name}需要 ${formatInt(cost)} CR`, 'danger', 2800);
      return;
    }
    p.credits -= cost;
    p.campaignUpgrades[key] = level + 1;
    if (key === 'health') {
      p.maxHp += 20;
      p.hp = Math.min(p.maxHp, p.hp + 20);
    }
    Sfx.upgrade();
    addToast('◆', `${def.name} LV${level + 1}`, def.effect(level + 1), 'gold', 3400);
    renderShop();
    updateHUD();
  }

  /* ------------------------------------------------------------
     Talent tree UI and unlocking
     ------------------------------------------------------------ */
  function isTalentUnlocked(id) {
    return !!game.player?.talents?.[id];
  }

  function talentStatus(id) {
    const p = game.player;
    const def = TALENTS[id];
    if (!p) return 'locked';
    if (isTalentUnlocked(id)) return 'unlocked';
    if (isTraining()) return 'available';
    if (def.requires.some((req) => !isTalentUnlocked(req))) return 'locked';
    if (p.talentPoints < def.cost) return 'unaffordable';
    return 'available';
  }

  function talentRequirementText(def) {
    if (!def.requires.length) return '无前置';
    return `前置：${def.requires.map((id) => TALENTS[id].name).join(' / ')}`;
  }

  function talentNodeHtml(id) {
    const p = game.player;
    const def = TALENTS[id];
    const unlocked = isTalentUnlocked(id);
    const status = talentStatus(id);
    const prereqMet = def.requires.every((req) => isTalentUnlocked(req));
    const training = isTraining();
    const statusText = training
      ? unlocked ? '点击取消该节点' : '点击启用 · 训练场免费'
      : unlocked
        ? '已接入神经网络'
        : !prereqMet
          ? talentRequirementText(def)
          : p.talentPoints < def.cost
            ? `需要 ${def.cost - p.talentPoints} 点`
            : '点击解锁';
    const footStatus = training
      ? unlocked ? 'CANCEL' : 'FREE'
      : unlocked ? 'ACTIVE' : status === 'available' ? 'AVAILABLE' : status === 'unaffordable' ? 'NEED TP' : 'LOCKED';
    return `<button class="talent-node is-${status}" type="button" data-talent-id="${id}" aria-disabled="${!training && unlocked ? 'true' : 'false'}">
      <span class="talent-node-top">
        <span class="talent-tier">${TALENT_TIER_LABEL[def.tier]}</span>
        <span class="talent-cost">${training ? 'FREE' : `${def.cost} TP`}</span>
      </span>
      <span class="talent-node-main">
        <span class="talent-icon">${def.icon}</span>
        <span class="talent-name-wrap"><span class="talent-name">${def.name}</span><span class="talent-code">${def.code}</span></span>
      </span>
      <span class="talent-desc">${def.desc}</span>
      <span class="talent-effect">${def.effect}</span>
      <span class="talent-node-foot"><span>${statusText}</span><b>${footStatus}</b></span>
    </button>`;
  }

  function renderTalentBonuses() {
    const p = game.player;
    const active = TALENT_ORDER.filter((id) => isTalentUnlocked(id));
    if (!active.length) {
      dom.talentBonusList.innerHTML = '<span class="talent-bonus-empty">尚未接入任何强化。</span>';
      return;
    }
    dom.talentBonusList.innerHTML = active.map((id) => `<span class="talent-bonus-item"><i></i><b>${TALENTS[id].name}</b><small>${TALENTS[id].effect}</small></span>`).join('');
  }

  function renderTalents() {
    const p = game.player;
    if (!p) return;
    const training = isTraining();
    setText(dom.talentPoints, training ? '∞' : p.talentPoints);
    setText(dom.talentLevel, pad2(p.level));
    setText(dom.talentSpent, training ? `${TALENT_ORDER.filter((id) => isTalentUnlocked(id)).length} / ${TALENT_ORDER.length}` : `${p.talentsSpent} TP`);
    setText(dom.talentEarned, training ? 'FREE MODE' : `${p.totalTalentPoints} TP`);
    setText(dom.talentUnlockedCount, `${TALENT_ORDER.filter((id) => isTalentUnlocked(id)).length} / ${TALENT_ORDER.length}`);
    setText(dom.talentTotalCost, TALENT_TOTAL_COST);
    dom.talentTree.innerHTML = TALENT_BRANCHES.map((branch) => {
      const parts = [];
      branch.talents.forEach((id, index) => {
        if (index > 0) {
          const parentId = branch.talents[index];
          const lit = isTalentUnlocked(parentId);
          parts.push(`<span class="talent-link ${lit ? 'is-lit' : ''}" aria-hidden="true"><i></i></span>`);
        }
        parts.push(talentNodeHtml(id));
      });
      return `<section class="talent-branch talent-branch-${branch.color}">
        <header class="talent-branch-head"><span>${branch.code}</span><b>${branch.name}</b></header>
        <div class="talent-branch-stack">${parts.join('')}</div>
      </section>`;
    }).join('');
    renderTalentBonuses();
    updateHUD();
  }

  function applyTalentEffect(id) {
    const p = game.player;
    if (!p) return;
    if (id === 'shield') {
      p.shieldUnlocked = true;
      p.maxShield = 70;
      p.shield = 70;
      p.shieldBroken = false;
      p.shieldBreakTimer = 0;
      p.shieldRegenDelay = 0;
      game.portals.push({ x: p.x, y: p.y, life: 0.7, maxLife: 0.7, color: '105, 241, 255', radius: 72 });
    } else if (id === 'dualWield') {
      ensureOffhandValid();
      if (!p.offhand) {
        addToast('i', '双持已解锁 · 暂无副手', '至少需要两把不同武器，右键武器槽指定副手', 'gold', 5200);
      }
    } else if (id === 'turret') {
      p.turretCooldown = 0;
    } else if (id === 'respawn') {
      p.reviveCooldown = 0;
    } else if (id === 'overdrive') {
      p.turretCooldown *= 0.8;
      p.reviveCooldown *= 0.8;
    }
  }

  function toggleTrainingTalent(id) {
    const p = game.player;
    const def = TALENTS[id];
    if (!p || !def) return;
    if (isTalentUnlocked(id)) {
      const removed = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const other of TALENT_ORDER) {
          if (removed.has(other)) continue;
          if (TALENTS[other].requires.some((req) => removed.has(req))) {
            removed.add(other);
            changed = true;
          }
        }
      }
      for (const other of removed) p.talents[other] = false;
      if (removed.has('shield')) {
        p.shieldUnlocked = false;
        p.maxShield = 0;
        p.shield = 0;
      }
      if (removed.has('dualWield')) {
        p.offhand = null;
        p.offhandReloading = false;
      }
      if (removed.has('turret')) game.turrets = [];
      if (removed.has('intelligenceCore')) game.autoAimTarget = null;
      addToast('○', `已取消 · ${def.name}`, '训练场自由配置 · 随时可重新启用', '', 2400);
    } else {
      p.talents[id] = true;
      applyTalentEffect(id);
      addToast('◇', `已启用 · ${def.name}`, '训练场免费模式', 'gold', 2400);
    }
    renderTalents();
    updateHUD();
    Sfx.click();
  }

  function unlockTalent(id) {
    const p = game.player;
    const def = TALENTS[id];
    if (!p || !def || game.mode !== 'talents') return;
    if (isTraining()) {
      toggleTrainingTalent(id);
      return;
    }
    if (isTalentUnlocked(id)) return;
    const missing = def.requires.filter((req) => !isTalentUnlocked(req));
    if (missing.length) {
      Sfx.error();
      addToast('!', '前置天赋未解锁', `需要先解锁：${missing.map((req) => TALENTS[req].name).join(' / ')}`, 'danger', 3600);
      return;
    }
    if (p.talentPoints < def.cost) {
      Sfx.error();
      addToast('!', '天赋点不足', `${def.name} 需要 ${def.cost} 点，当前可用 ${p.talentPoints} 点`, 'danger', 3200);
      return;
    }
    p.talentPoints -= def.cost;
    p.talentsSpent += def.cost;
    p.talents[id] = true;
    applyTalentEffect(id);
    Sfx.talentUnlock();
    game.flash = Math.max(game.flash || 0, 0.16);
    addToast('◇', `天赋已接入 · ${def.name}`, def.effect, 'gold', 4800);
    renderTalents();
  }

  function openTalents() {
    const p = game.player;
    if (!p) return;
    if (game.mode !== 'playing') return;
    if (game.runMode === 'campaign') {
      Sfx.error();
      addToast('T', '闯关模式没有科技树', '请在商店终端购买战术属性与武器改装', '', 3000);
      return;
    }
    if (game.runMode === 'story') {
      Sfx.error();
      addToast('T', '剧情战斗使用预设科技', '完成当前剧情后可重新开始体验', '', 2800);
      return;
    }
    game.mode = 'talents';
    game.hitFlash = 0;
    dom.hitFlash.style.opacity = '0';
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    renderTalents();
    dom.talentOverlay.classList.remove('is-hidden');
    Sfx.click();
    dom.talentClose.focus({ preventScroll: true });
  }

  function closeTalents() {
    if (game.mode !== 'talents') return;
    dom.talentOverlay.classList.add('is-hidden');
    game.mode = 'playing';
    game.lastFrame = performance.now();
    Sfx.click();
  }

  /* ------------------------------------------------------------
     Campaign world construction and run lifecycle
     ------------------------------------------------------------ */
  function campaignCellAt(x, y) {
    return {
      c: clamp(Math.floor(x / CAMPAIGN_TILE), 0, CAMPAIGN_COLS - 1),
      r: clamp(Math.floor(y / CAMPAIGN_TILE), 0, CAMPAIGN_ROWS - 1),
    };
  }

  function buildCampaignGrid(level) {
    const cols = CAMPAIGN_COLS;
    const rows = CAMPAIGN_ROWS;
    const total = cols * rows;
    const walkable = new Uint8Array(total);

    function fillRect(rect) {
      const c0 = clamp(Math.round(rect.x / CAMPAIGN_TILE), 0, cols - 1);
      const c1 = clamp(Math.round((rect.x + rect.w) / CAMPAIGN_TILE), 0, cols);
      const r0 = clamp(Math.round(rect.y / CAMPAIGN_TILE), 0, rows - 1);
      const r1 = clamp(Math.round((rect.y + rect.h) / CAMPAIGN_TILE), 0, rows);
      for (let r = r0; r < r1; r += 1) {
        for (let c = c0; c < c1; c += 1) walkable[r * cols + c] = 1;
      }
    }

    for (const room of level.rooms) fillRect(room);
    for (const corridor of level.corridors) fillRect(corridor);

    const start = campaignCellAt(level.playerStart.x, level.playerStart.y);
    const reachable = new Uint8Array(total);
    const queue = [start.r * cols + start.c];
    reachable[queue[0]] = 1;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!walkable[ni] || reachable[ni]) continue;
        reachable[ni] = 1;
        queue.push(ni);
      }
    }
    for (let i = 0; i < total; i += 1) {
      if (walkable[i] && !reachable[i]) walkable[i] = 0;
    }

    // Merge every solid cell into as few wall rectangles as possible. The rest
    // of the game can then keep using the same circle-vs-rect collision and
    // segment-vs-rect LOS tests as endless mode.
    const used = new Uint8Array(total);
    const solidRects = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        if (walkable[idx] || used[idx]) continue;
        let w = 1;
        while (c + w < cols && !walkable[r * cols + c + w] && !used[r * cols + c + w]) w += 1;
        let h = 1;
        while (r + h < rows) {
          let fits = true;
          for (let x = c; x < c + w; x += 1) {
            const ni = (r + h) * cols + x;
            if (walkable[ni] || used[ni]) {
              fits = false;
              break;
            }
          }
          if (!fits) break;
          h += 1;
        }
        for (let yy = r; yy < r + h; yy += 1) {
          for (let xx = c; xx < c + w; xx += 1) used[yy * cols + xx] = 1;
        }
        solidRects.push({
          type: 'campaign-wall',
          shape: 'rect',
          x: c * CAMPAIGN_TILE,
          y: r * CAMPAIGN_TILE,
          w: w * CAMPAIGN_TILE,
          h: h * CAMPAIGN_TILE,
        });
      }
    }

    return { cols, rows, total, walkable, solidRects, start };
  }

  function campaignCellIsWalkable(grid, c, r) {
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
    return !!grid.walkable[r * grid.cols + c];
  }

  function drawCampaignEnvironment(level, grid) {
    envCanvas = document.createElement('canvas');
    envCanvas.width = Math.round(WORLD.w * mapScale);
    envCanvas.height = Math.round(WORLD.h * mapScale);
    envCtx = envCanvas.getContext('2d');
    envCtx.scale(mapScale, mapScale);
    const ctx = envCtx;
    const theme = level.theme;
    const accent = theme.accent;
    const rng = mulberry32(9300 + level.index * 181);

    // Deep void and a faint structural grid under everything.
    ctx.fillStyle = '#010405';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.strokeStyle = 'rgba(94, 151, 154, 0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.w; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, WORLD.h);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD.h; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WORLD.w, y + 0.5);
      ctx.stroke();
    }

    // Floor slabs for rooms and corridors. Rogue floors use center-to-center
    // L corridors, so drawing rooms last keeps the inside of a room clean while
    // the connector still appears in the gaps between room cells.
    const drawRoomFloors = () => {
      for (const room of level.rooms) {
        ctx.fillStyle = theme.floor;
        ctx.fillRect(room.x, room.y, room.w, room.h);
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        ctx.fillRect(room.x, room.y, room.w, 2);
        const grad = ctx.createRadialGradient(room.x + room.w / 2, room.y + room.h / 2, 20, room.x + room.w / 2, room.y + room.h / 2, Math.max(room.w, room.h) * 0.62);
        grad.addColorStop(0, `rgba(${accent}, 0.035)`);
        grad.addColorStop(1, `rgba(${accent}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(room.x, room.y, room.w, room.h);
      }
    };
    const drawCorridorFloors = () => {
      for (const corridor of level.corridors) {
        ctx.fillStyle = theme.floorAlt;
        ctx.fillRect(corridor.x, corridor.y, corridor.w, corridor.h);
      }
    };
    if (level.rogue) {
      drawCorridorFloors();
      drawRoomFloors();
    } else {
      drawRoomFloors();
      drawCorridorFloors();
    }

    // Tiled floor grid.
    ctx.save();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.w; x += CAMPAIGN_TILE) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, WORLD.h);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD.h; y += CAMPAIGN_TILE) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WORLD.w, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${accent}, 0.045)`;
    for (let x = 0; x <= WORLD.w; x += CAMPAIGN_TILE * 4) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, WORLD.h);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD.h; y += CAMPAIGN_TILE * 4) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WORLD.w, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // A low-opacity route line makes the linear floor plan easy to read.
    ctx.save();
    ctx.strokeStyle = `rgba(${accent}, 0.09)`;
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 18]);
    ctx.beginPath();
    level.path.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Dedicated supply rooms: a brighter safe-zone floor pad and a visible
    // terminal pedestal make the single mid-map shop easy to identify.
    const shopRoom = level.rooms.find((room) => room.shop);
    if (shopRoom && level.shops[0]) {
      const sx = level.shops[0].x;
      const sy = level.shops[0].y;
      ctx.save();
      ctx.fillStyle = `rgba(${accent}, 0.055)`;
      ctx.fillRect(shopRoom.x + 10, shopRoom.y + 10, shopRoom.w - 20, shopRoom.h - 20);
      ctx.strokeStyle = `rgba(${accent}, 0.35)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(shopRoom.x + 18, shopRoom.y + 18, shopRoom.w - 36, shopRoom.h - 36);
      ctx.setLineDash([]);
      const pad = ctx.createRadialGradient(sx, sy, 8, sx, sy, 82);
      pad.addColorStop(0, 'rgba(122, 248, 255, 0.12)');
      pad.addColorStop(0.55, 'rgba(122, 248, 255, 0.045)');
      pad.addColorStop(1, 'rgba(122, 248, 255, 0)');
      ctx.fillStyle = pad;
      ctx.beginPath();
      ctx.arc(sx, sy, 82, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(137, 255, 253, 0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 62, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(137, 255, 253, 0.12)';
      ctx.setLineDash([7, 8]);
      ctx.lineDashOffset = -18;
      ctx.beginPath();
      ctx.arc(sx, sy, 48, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(180, 255, 250, 0.3)';
      ctx.font = '600 10px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SUPPLY // SAFE ZONE', sx, sy + 76);
      // Baked side racks frame the terminal without blocking it.
      ctx.fillStyle = 'rgba(6, 22, 25, 0.75)';
      ctx.fillRect(shopRoom.x + 22, shopRoom.y + 26, shopRoom.w - 44, 8);
      ctx.fillRect(shopRoom.x + 22, shopRoom.y + shopRoom.h - 34, shopRoom.w - 44, 8);
      ctx.strokeStyle = 'rgba(137, 255, 253, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(shopRoom.x + 22, shopRoom.y + 26, shopRoom.w - 44, 8);
      ctx.strokeRect(shopRoom.x + 22, shopRoom.y + shopRoom.h - 34, shopRoom.w - 44, 8);
      ctx.restore();
    }

    // Room labels and large sector numbering.
    for (const [i, room] of level.rooms.entries()) {
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = room.boss ? `rgba(255, 115, 95, 0.16)` : room.shop ? 'rgba(137, 255, 253, 0.2)' : `rgba(${accent}, 0.14)`;
      ctx.font = '700 28px "Avenir Next", "PingFang SC", sans-serif';
      ctx.fillText(room.name, cx, cy - 4);
      ctx.fillStyle = `rgba(${accent}, 0.2)`;
      ctx.font = '500 11px "SFMono-Regular", "Cascadia Code", monospace';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} // ${room.label}`, cx, cy + 18);
      ctx.strokeStyle = room.boss ? 'rgba(255, 97, 80, 0.2)' : room.shop ? 'rgba(137, 255, 253, 0.24)' : `rgba(${accent}, 0.11)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 90, cy + 34);
      ctx.lineTo(cx + 90, cy + 34);
      ctx.stroke();
      ctx.restore();
    }

    // Corridor threshold hazard bands.
    for (const corridor of level.corridors) {
      const horizontal = corridor.w >= corridor.h;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 175, 80, 0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(corridor.x + 12, corridor.y + 6);
        ctx.lineTo(corridor.x + 12, corridor.y + corridor.h - 6);
        ctx.moveTo(corridor.x + corridor.w - 12, corridor.y + 6);
        ctx.lineTo(corridor.x + corridor.w - 12, corridor.y + corridor.h - 6);
      } else {
        ctx.moveTo(corridor.x + 6, corridor.y + 12);
        ctx.lineTo(corridor.x + corridor.w - 6, corridor.y + 12);
        ctx.moveTo(corridor.x + 6, corridor.y + corridor.h - 12);
        ctx.lineTo(corridor.x + corridor.w - 6, corridor.y + corridor.h - 12);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Floor scuffs / stains, deterministic per map.
    for (let i = 0; i < 120; i += 1) {
      const room = level.rooms[(rng() * level.rooms.length) | 0];
      const x = room.x + rng() * room.w;
      const y = room.y + rng() * room.h;
      ctx.fillStyle = `rgba(${i % 3 === 0 ? '0, 0, 0' : '68, 99, 91'}, ${0.03 + rng() * 0.045})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + rng() * 16, 2 + rng() * 8, rng() * TAU, 0, TAU);
      ctx.fill();
    }

    // Wall bulkheads. Only cells adjacent to floor receive a rendered face.
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        if (campaignCellIsWalkable(grid, c, r)) continue;
        const neighbors = [];
        for (const [dc, dr] of dirs) {
          if (campaignCellIsWalkable(grid, c + dc, r + dr)) neighbors.push([dc, dr]);
        }
        if (!neighbors.length) continue;
        const x = c * CAMPAIGN_TILE;
        const y = r * CAMPAIGN_TILE;
        ctx.fillStyle = theme.wall;
        ctx.fillRect(x, y, CAMPAIGN_TILE, CAMPAIGN_TILE);
        ctx.fillStyle = theme.wallTop;
        ctx.globalAlpha = 0.62;
        ctx.fillRect(x + 3, y + 3, CAMPAIGN_TILE - 6, CAMPAIGN_TILE - 6);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(120, 187, 181, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 3.5, y + 3.5, CAMPAIGN_TILE - 7, CAMPAIGN_TILE - 7);
        for (const [dc, dr] of neighbors) {
          const lx = x + (dc > 0 ? 0 : dc < 0 ? CAMPAIGN_TILE : 0);
          const ly = y + (dr > 0 ? 0 : dr < 0 ? CAMPAIGN_TILE : 0);
          ctx.strokeStyle = `rgba(${accent}, 0.4)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (dc !== 0) {
            ctx.moveTo(lx, y + 8);
            ctx.lineTo(lx, y + CAMPAIGN_TILE - 8);
          } else {
            ctx.moveTo(x + 8, ly);
            ctx.lineTo(x + CAMPAIGN_TILE - 8, ly);
          }
          ctx.stroke();
          // Shadow/ambient bleed onto the walkable floor.
          ctx.save();
          let shade;
          if (dc > 0) shade = ctx.createLinearGradient(lx, ly, lx + 18, ly);
          else if (dc < 0) shade = ctx.createLinearGradient(lx, ly, lx - 18, ly);
          else if (dr > 0) shade = ctx.createLinearGradient(lx, ly, lx, ly + 18);
          else shade = ctx.createLinearGradient(lx, ly, lx, ly - 18);
          shade.addColorStop(0, 'rgba(0,0,0,0.42)');
          shade.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = shade;
          if (dc > 0) ctx.fillRect(lx, y, 18, CAMPAIGN_TILE);
          else if (dc < 0) ctx.fillRect(lx - 18, y, 18, CAMPAIGN_TILE);
          else if (dr > 0) ctx.fillRect(x, ly, CAMPAIGN_TILE, 18);
          else ctx.fillRect(x, ly - 18, CAMPAIGN_TILE, 18);
          ctx.restore();
        }
        const hash = Math.floor(rng() * 5);
        if (hash === 0) {
          ctx.fillStyle = `rgba(${accent}, 0.3)`;
          ctx.fillRect(x + 10, y + 12, 4, 2);
          ctx.fillStyle = 'rgba(255, 166, 94, 0.28)';
          ctx.fillRect(x + 10, y + 17, 4, 2);
        } else if (hash === 1) {
          ctx.strokeStyle = 'rgba(90, 141, 140, 0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 8, y + 16);
          ctx.lineTo(x + 16, y + 16);
          ctx.lineTo(x + 16, y + 34);
          ctx.stroke();
        }
      }
    }

    // Boss-room hazard perimeter.
    const bossRoom = level.rooms.find((room) => room.boss);
    if (bossRoom) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 104, 88, 0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 9]);
      ctx.strokeRect(bossRoom.x + 18.5, bossRoom.y + 18.5, bossRoom.w - 37, bossRoom.h - 37);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Overall ambient color and vignette.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const room of level.rooms) {
      const g = ctx.createRadialGradient(room.x + room.w / 2, room.y + room.h / 2, 10, room.x + room.w / 2, room.y + room.h / 2, Math.max(room.w, room.h) * 0.7);
      g.addColorStop(0, `rgba(${theme.glow}, 0.055)`);
      g.addColorStop(1, `rgba(${theme.glow}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    ctx.restore();

    ctx.save();
    const vig = ctx.createRadialGradient(WORLD.w * 0.5, WORLD.h * 0.5, 200, WORLD.w * 0.5, WORLD.h * 0.5, 1500);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,2,3,0.6)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.restore();
  }

  function campaignAreaPoint(area, margin = 55) {
    const m = Math.min(margin, Math.max(18, Math.min(area.w, area.h) / 2 - 18));
    return {
      x: area.x + m + Math.random() * Math.max(1, area.w - m * 2),
      y: area.y + m + Math.random() * Math.max(1, area.h - m * 2),
    };
  }

  function spawnCampaignSearchables() {
    const campaign = game.campaign;
    const level = campaign.level;
    const areas = [...level.rooms.filter((room) => !room.boss && !room.shop), ...level.corridors];
    const searchables = [];
    const total = Math.max(4, Math.round(level.searchables * (game.difficulty === 'easy' ? 1.15 : game.difficulty === 'hard' ? 0.9 : 1)));
    for (let i = 0; i < total; i += 1) {
      let placed = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const area = areas[(Math.random() * areas.length) | 0];
        const point = campaignAreaPoint(area, area.w < 160 || area.h < 160 ? 22 : 55);
        if (dist(point.x, point.y, level.playerStart.x, level.playerStart.y) < 65) continue;
        if (level.shops.some((shop) => dist(point.x, point.y, shop.x, shop.y) < 80)) continue;
        if (dist(point.x, point.y, level.startElevator.x, level.startElevator.y) < 70) continue;
        if (dist(point.x, point.y, level.exitElevator.x, level.exitElevator.y) < 100) continue;
        if (searchables.some((item) => dist(point.x, point.y, item.x, item.y) < 70)) continue;
        placed = point;
        break;
      }
      if (!placed) continue;
      const roll = Math.random();
      let type = 'crate';
      if (level.faction === 'lab') type = roll < 0.45 ? 'crate' : roll < 0.78 ? 'cabinet' : 'specimen';
      else if (level.faction === 'military') type = roll < 0.5 ? 'crate' : roll < 0.8 ? 'locker' : 'cabinet';
      else type = roll < 0.45 ? 'crate' : roll < 0.75 ? 'server' : 'locker';
      searchables.push({
        x: placed.x,
        y: placed.y,
        type,
        searched: false,
        seed: Math.random() * 1000,
      });
    }
    campaign.searchables = searchables;
    campaign.levelSearched = 0;
    campaign.levelSearchTotal = searchables.length;
  }

  function spawnCampaignProps() {
    const campaign = game.campaign;
    const level = campaign.level;
    campaign.shops = level.shops.map((shop, i) => ({
      x: shop.x,
      y: shop.y,
      label: i === 0 ? 'SHOP TERMINAL' : 'FIELD TERMINAL',
      ready: true,
    }));
    campaign.elevators = [
      { x: level.startElevator.x, y: level.startElevator.y, kind: 'start', label: campaign.rogue ? '下潜入口' : '起点电梯', locked: false },
      { x: level.exitElevator.x, y: level.exitElevator.y, kind: 'exit', label: campaign.rogue ? '上行电梯' : '终点电梯', locked: true },
    ];
  }

  function spawnCampaignEnemies() {
    const campaign = game.campaign;
    const level = campaign.level;
    const diff = getDifficultyConfig();
    const normalCount = Math.max(3, Math.round(level.normal * diff.count));
    const eliteCount = Math.max(1, Math.round(level.elite * diff.count));
    const areas = [...level.rooms.filter((room) => !room.boss && !room.shop), ...level.corridors];
    const system = ENEMY_SYSTEMS[level.enemySystem] || ENEMY_SYSTEMS[level.faction] || ENEMY_SYSTEMS.lab;
    const commands = [];
    if (system.id === 'military') {
      for (let i = 0; i < normalCount; i += 1) commands.push('normal');
      for (let i = 0; i < eliteCount; i += 1) commands.push('elite');
    } else {
      const total = Math.max(1, normalCount + eliteCount);
      for (let i = 0; i < total; i += 1) commands.push(pickWeightedEnemy(system.pool));
    }
    for (const type of commands) {
      const typeConfig = ENEMY_TYPES[type] || ENEMY_TYPES.normal;
      let placed = null;
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const area = areas[(Math.random() * areas.length) | 0];
        const margin = Math.min(area.w, area.h) < 150 ? 22 : 58;
        const point = campaignAreaPoint(area, margin);
        if (dist(point.x, point.y, level.playerStart.x, level.playerStart.y) < 320) continue;
        if (dist(point.x, point.y, level.startElevator.x, level.startElevator.y) < 300) continue;
        if (level.shops.some((shop) => dist(point.x, point.y, shop.x, shop.y) < 85)) continue;
        if (!isPointFree(point.x, point.y, typeConfig.radius + 5)) continue;
        if (game.enemies.some((e) => !e.dead && dist(point.x, point.y, e.x, e.y) < 70)) continue;
        placed = point;
        break;
      }
      if (!placed) continue;
      const enemy = spawnEnemy(type, { x: placed.x, y: placed.y });
      if (!enemy) continue;
      enemy.spawnTimer = 0;
      enemy.spawnMax = 0;
      enemy.aware = false;
      enemy.campaignEnemy = true;
      enemy.faction = level.faction;
      enemy.enemySystem = system.id;
      enemy.visionRange = (225 + level.index * 12 + (type === 'elite' ? 35 : 0)) * enemyAggression();
      enemy.aimAngle = rand(0, TAU);
      enemy.hasLOS = false;
      enemy.atkCd = rand(0.8, 2.2);
      enemy.alertFlash = 0;
    }
    campaign.enemyTotal = commands.length;
  }

  function createCampaignPlayer() {
    const p = createPlayer();
    const character = getCharacterDef();
    p.maxHp = Math.round(160 * character.hpMult);
    p.hp = p.maxHp;
    p.speedBase = PLAYER_BASE_SPEED * character.speedMult;
    p.credits = 300;
    p.level = 1;
    p.xp = 0;
    p.xpNext = 999999;
    p.campaignUpgrades = { health: 0, speed: 0, reload: 0, damage: 0 };
    p.grenades = { frag: 2, flash: 0, incendiary: 0 };
    p.selectedGrenade = 'frag';
    p.talents = {};
    p.talentPoints = 0;
    p.totalTalentPoints = 0;
    p.talentsSpent = 0;
    applyDeveloperPerks(p);
    return p;
  }

  function applyRunModeUI() {
    const campaign = game.runMode === 'campaign';
    const story = game.runMode === 'story';
    const rogue = campaign && !!game.campaign.rogue;
    document.body.classList.toggle('campaign-mode', campaign);
    document.body.classList.toggle('endless-mode', !campaign);
    document.body.classList.toggle('rogue-mode', rogue);
    dom.btnTalents.disabled = campaign || story;
    dom.btnTalents.classList.toggle('is-hidden', campaign || story);
    dom.btnSpeed.classList.toggle('is-hidden', campaign || game.runMode !== 'endless');
    dom.btnShop.classList.toggle('is-hidden', story);
    dom.btnShop.title = campaign ? '战役军械库仅在商店终端开放' : story ? '剧情模式不开放军械库' : '打开军械库 (B)';
    dom.grenadeSwitchHelp.textContent = campaign ? 'G 切换' : 'E 切换';
    dom.pauseHint.textContent = story
      ? '提示：R 换弹 · 鼠标射击 · Q 手雷 / E 切换 · 1—5 切换武器 · Shift 冲刺'
      : campaign
        ? '提示：R 换弹 · 空格 角色技能 · Q 手雷 / G 切换 · E 搜索(3s) · F 电梯 / 商店 · Shift 冲刺'
        : '提示：R 换弹 · 空格 角色技能 · Q 手雷 / E 切换 · B 军械库 · T 科技树 · F 技能 · Shift 冲刺';
    dom.fieldHint.textContent = campaign ? 'E 搜索(3s) · F 交互 · 空格 角色技能 · 视野受限' : story ? '剧情战斗 · 预设装备 · 1—5 切换武器' : '左键长按 · 连续射击 · 空格 角色技能';
    setText(dom.hudDifficulty, getDifficultyConfig().name);
  }

  function prepareEndlessWorld() {
    game.runMode = 'endless';
    game.worldMode = 'endless';
    if (OBSTACLES !== STANDARD_OBSTACLES) {
      OBSTACLES = STANDARD_OBSTACLES;
      navFields.clear();
      buildEnvironment();
    }
    game.campaign.active = false;
    applyRunModeUI();
  }

  function revealCampaignArea() {
    const campaign = game.campaign;
    const p = game.player;
    const grid = campaign.grid;
    if (!p || !grid || !campaign.explored) return;
    if (isDeveloperMode()) {
      campaign.explored.fill(1);
      return;
    }
    const radius = campaign.visionRadius;
    const cc = Math.floor(p.x / CAMPAIGN_TILE);
    const cr = Math.floor(p.y / CAMPAIGN_TILE);
    const cellR = Math.ceil(radius / CAMPAIGN_TILE);
    for (let r = Math.max(0, cr - cellR); r <= Math.min(grid.rows - 1, cr + cellR); r += 1) {
      for (let c = Math.max(0, cc - cellR); c <= Math.min(grid.cols - 1, cc + cellR); c += 1) {
        if (!campaignCellIsWalkable(grid, c, r)) continue;
        const cx = c * CAMPAIGN_TILE + CAMPAIGN_TILE / 2;
        const cy = r * CAMPAIGN_TILE + CAMPAIGN_TILE / 2;
        if (dist2(cx, cy, p.x, p.y) <= (radius + 38) * (radius + 38)) {
          campaign.explored[r * grid.cols + c] = 1;
        }
      }
    }
  }

  function campaignProgress() {
    const campaign = game.campaign;
    const p = game.player;
    const level = campaign.level;
    if (!p || !level) return 0;
    const points = level.path;
    let best = 0;
    let total = 0;
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    }
    if (length <= 0) return 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const segLen = dist(a.x, a.y, b.x, b.y);
      if (segLen <= 0) continue;
      const t = clamp(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (segLen * segLen), 0, 1);
      const px = lerp(a.x, b.x, t);
      const py = lerp(a.y, b.y, t);
      const d = dist(p.x, p.y, px, py);
      if (d <= 115) best = Math.max(best, (total + t * segLen) / length);
      total += segLen;
    }
    if (campaign.bossTriggered) best = Math.max(best, campaign.bossDefeated ? 0.98 : 0.9);
    return clamp(best, 0, 1);
  }

  function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }


  function shuffleRogueList(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function generateRoguePathCells(targetLength) {
    const key = (c, r) => `${c},${r}`;
    const inGrid = (c, r) => c >= 0 && c < 3 && r >= 0 && r < 3;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null;
    let bestLen = 0;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const start = { c: randInt(0, 2), r: randInt(0, 2) };
      const path = [start];
      const visited = new Set([key(start.c, start.r)]);
      const search = (cell) => {
        if (path.length >= targetLength) return true;
        const options = [];
        for (const [dc, dr] of dirs) {
          const nc = cell.c + dc;
          const nr = cell.r + dr;
          if (inGrid(nc, nr) && !visited.has(key(nc, nr))) options.push({ c: nc, r: nr });
        }
        shuffleRogueList(options);
        for (const next of options) {
          path.push(next);
          visited.add(key(next.c, next.r));
          if (search(next)) return true;
          path.pop();
          visited.delete(key(next.c, next.r));
        }
        return false;
      };
      search(start);
      if (path.length > bestLen) {
        bestLen = path.length;
        best = path.map((cell) => ({ c: cell.c, r: cell.r }));
      }
      if (bestLen >= targetLength) break;
    }
    return best || [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 2, r: 1 }, { c: 2, r: 2 }];
  }

  function addRogueCorridor(roomA, roomB, corridors) {
    const snap = (value) => Math.round(value / CAMPAIGN_TILE) * CAMPAIGN_TILE;
    const ax = snap(roomA.x + roomA.w / 2);
    const ay = snap(roomA.y + roomA.h / 2);
    const bx = snap(roomB.x + roomB.w / 2);
    const by = snap(roomB.y + roomB.h / 2);
    const cw = CAMPAIGN_TILE * 2;
    if (Math.abs(ax - bx) > 0) {
      corridors.push({
        x: Math.min(ax, bx) - CAMPAIGN_TILE,
        y: ay - CAMPAIGN_TILE,
        w: Math.abs(ax - bx) + CAMPAIGN_TILE * 2,
        h: cw,
      });
    }
    corridors.push({
      x: bx - CAMPAIGN_TILE,
      y: Math.min(ay, by) - CAMPAIGN_TILE,
      w: cw,
      h: Math.abs(ay - by) + CAMPAIGN_TILE * 2,
    });
    return { x: bx, y: ay };
  }

  function generateRogueLevel(floorIndex) {
    const floor = floorIndex + 1;
    const themeIndex = randInt(0, CAMPAIGN_LEVELS.length - 1);
    const base = CAMPAIGN_LEVELS[themeIndex];
    const faction = base.faction;
    const bossFloor = floor % 3 === 0;
    const roomCount = randInt(7, 9);
    const cells = generateRoguePathCells(roomCount);
    const rooms = [];
    const corridors = [];
    const path = [];
    const usedNames = new Set();
    const shopIndex = cells.length >= 4 ? randInt(1, cells.length - 2) : 1;
    const pool = ROGUE_ROOM_NAMES[base.id] || ROGUE_ROOM_NAMES.lab;
    const labelPool = ROGUE_ROOM_LABELS[base.id] || ROGUE_ROOM_LABELS.lab;

    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      const first = i === 0;
      const last = i === cells.length - 1;
      const shop = i === shopIndex;
      const boss = bossFloor && last;
      const major = first || last || shop;
      // Rogue guard rooms mirror the corresponding campaign boss arena:
      // 450x350 for the bio lab, 400x400 for security / reactor.
      const bossW = base.id === 'bio' ? 9 : 8;
      const bossH = base.id === 'bio' ? 7 : 8;
      const wTiles = boss ? bossW : major ? randInt(7, 9) : randInt(5, 8);
      const hTiles = boss ? bossH : major ? randInt(4, 6) : randInt(3, 5);
      const cellX = cell.c * 16;
      const cellY = cell.r * 10;
      const xTiles = cellX + randInt(2, Math.max(2, 16 - wTiles - 2));
      const yTiles = cellY + randInt(1, Math.max(1, 10 - hTiles - 1));
      let name = pool[randInt(0, pool.length - 1)];
      let label = labelPool[randInt(0, labelPool.length - 1)];
      if (first) {
        name = '下潜入口';
        label = 'DESCENT ACCESS';
      } else if (boss) {
        name = '区域守卫室';
        label = 'GUARD POST';
      } else if (last) {
        name = '上行电梯厅';
        label = 'ASCENT ELEVATOR';
      } else if (shop) {
        name = '补给站';
        label = 'SUPPLY CACHE';
      }
      let rerolls = 0;
      while (usedNames.has(name) && rerolls < pool.length * 2) {
        name = pool[randInt(0, pool.length - 1)];
        rerolls += 1;
      }
      if (usedNames.has(name)) name = `${name} ${String(i + 1).padStart(2, '0')}`;
      usedNames.add(name);
      rooms.push({
        x: xTiles * CAMPAIGN_TILE,
        y: yTiles * CAMPAIGN_TILE,
        w: wTiles * CAMPAIGN_TILE,
        h: hTiles * CAMPAIGN_TILE,
        name,
        label,
        shop,
        boss,
      });
    }

    for (let i = 0; i < rooms.length - 1; i += 1) {
      const bend = addRogueCorridor(rooms[i], rooms[i + 1], corridors);
      path.push({ x: rooms[i].x + rooms[i].w / 2, y: rooms[i].y + rooms[i].h / 2 });
      path.push(bend);
    }
    const lastRoom = rooms[rooms.length - 1];
    path.push({ x: lastRoom.x + lastRoom.w / 2, y: lastRoom.y + lastRoom.h / 2 });

    const startRoom = rooms[0];
    const endRoom = lastRoom;
    const bossRoom = rooms.find((room) => room.boss) || null;
    const shopRoom = rooms.find((room) => room.shop) || null;
    const center = (room) => ({ x: Math.round((room.x + room.w / 2) / 50) * 50, y: Math.round((room.y + room.h / 2) / 50) * 50 });
    const startCenter = center(startRoom);
    const endCenter = center(endRoom);
    const startElevator = {
      x: Math.round((startRoom.x + startRoom.w * 0.32) / 50) * 50,
      y: startCenter.y,
    };
    const playerStart = {
      x: Math.round((startRoom.x + startRoom.w * 0.50) / 50) * 50,
      y: startCenter.y,
    };
    const bossSpawn = bossRoom
      ? { x: Math.round((bossRoom.x + bossRoom.w * 0.36) / 50) * 50, y: endCenter.y }
      : null;
    const exitElevator = bossRoom
      ? { x: Math.round((bossRoom.x + bossRoom.w * 0.76) / 50) * 50, y: endCenter.y }
      : endCenter;
    const normal = Math.min(42, Math.round(7 + floor * 1.7 + floor * floor * 0.035));
    const elite = Math.min(12, Math.round(2 + floor * 0.55 + floor * floor * 0.012));
    const searchCount = Math.min(20, 6 + Math.floor(floor * 1.2));
    const theme = base.theme;
    return {
      id: `rogue-${floor}`,
      index: floorIndex,
      floor,
      rogue: true,
      code: `R-${String(floor).padStart(2, '0')}`,
      name: `${base.name}残层`,
      subtitle: `RANDOMIZED FLOOR / ${base.subtitle}`,
      theme,
      rooms,
      corridors,
      playerStart,
      startElevator,
      exitElevator,
      path,
      shops: shopRoom ? [{ x: shopRoom.x + shopRoom.w / 2, y: shopRoom.y + shopRoom.h / 2 }] : [],
      bossKind: bossRoom ? ROGUE_BOSS_BY_FACTION[faction] : null,
      bossSpawn,
      bossTrigger: bossRoom ? { x: bossRoom.x, y: bossRoom.y, w: bossRoom.w, h: bossRoom.h } : null,
      faction,
      enemySystem: base.id === 'bio' ? 'lab' : base.id === 'security' ? 'military' : 'robot',
      normal,
      elite,
      searchables: searchCount,
      startText: `随机实验层已重构。找到补给站，乘电梯继续向第 ${floor + 1} 层下潜。`,
      bossIntro: `区域守卫封锁了第 ${floor} 层的出口电梯。`,
    };
  }

  function buildCampaignArenaBarriers(level, grid) {
    const room = level.rooms.find((entry) => entry.boss);
    if (!room) return [];
    const tile = CAMPAIGN_TILE;
    const c0 = Math.round(room.x / tile);
    const r0 = Math.round(room.y / tile);
    const c1 = Math.round((room.x + room.w) / tile) - 1;
    const r1 = Math.round((room.y + room.h) / tile) - 1;
    const bars = [];
    const walk = (c, r) => c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.walkable[r * grid.cols + c];
    for (let r = r0; r <= r1; r += 1) {
      if (walk(c0, r) && walk(c0 - 1, r)) bars.push({ x1: room.x, y1: r * tile, x2: room.x, y2: (r + 1) * tile });
      if (walk(c1, r) && walk(c1 + 1, r)) bars.push({ x1: room.x + room.w, y1: r * tile, x2: room.x + room.w, y2: (r + 1) * tile });
    }
    for (let c = c0; c <= c1; c += 1) {
      if (walk(c, r0) && walk(c, r0 - 1)) bars.push({ x1: c * tile, y1: room.y, x2: (c + 1) * tile, y2: room.y });
      if (walk(c, r1) && walk(c, r1 + 1)) bars.push({ x1: c * tile, y1: room.y + room.h, x2: (c + 1) * tile, y2: room.y + room.h });
    }
    return bars;
  }

  function pointInCampaignArena(x, y) {
    const room = game.campaign.arenaRoom;
    return !!room && pointInRect(x, y, room);
  }

  function clampEntityToCampaignArena(entity) {
    const campaign = game.campaign;
    const room = campaign.arenaRoom;
    if (!campaign.arenaLocked || !room || !entity) return;
    const pad = (entity.r || 12) + 3;
    entity.x = clamp(entity.x, room.x + pad, room.x + room.w - pad);
    entity.y = clamp(entity.y, room.y + pad, room.y + room.h - pad);
    entity.vx = 0;
    entity.vy = 0;
  }

  function clampPointToCampaignArena(x, y, pad = 24) {
    const room = game.campaign.arenaRoom;
    if (!room) return { x, y };
    return {
      x: clamp(x, room.x + pad, room.x + room.w - pad),
      y: clamp(y, room.y + pad, room.y + room.h - pad),
    };
  }

  function setupCampaignLevel(index, preserve = false, fromMenu = false, levelOverride = null) {
    const level = levelOverride || CAMPAIGN_LEVELS[index];
    if (!level) return;
    const campaign = game.campaign;
    if (!preserve) {
      game.player = createCampaignPlayer();
    }
    const p = game.player;
    const grid = buildCampaignGrid(level);
    OBSTACLES = grid.solidRects;
    navFields.clear();
    game.worldMode = 'campaign';
    drawCampaignEnvironment(level, grid);

    game.enemies = [];
    game.bullets = [];
    game.playerMissiles = [];
    game.enemyBullets = [];
    game.enemyRockets = [];
    game.enemyTurrets = [];
    game.campaignHazards = [];
    game.campaign.searchTarget = null;
    game.campaign.searchTimer = 0;
    game.campaign.searchFxTimer = 0;
    game.campaign.arenaLocked = false;
    game.coins = [];
    game.pickups = [];
    game.particles = [];
    game.casings = [];
    game.texts = [];
    game.decals = [];
    game.portals = [];
    game.turrets = [];
    game.grenades = [];
    game.fireZones = [];
    game.bossRef = null;
    game.bullets = [];
    game.spawnQueue = [];
    game.waveActive = false;
    game.intermission = false;
    game.intermissionTimer = 0;
    game.wave = index + 1;
    game.deathTimer = 0;
    game.damageFlash = 0;
    game.hitFlash = 0;
    game.shake = 0;
    game.flash = 0;
    game.hitMarker = 0;
    game.killMarker = 0;
    game.mode = 'playing';

    campaign.active = true;
    campaign.levelIndex = index;
    campaign.level = level;
    campaign.grid = grid;
    campaign.explored = new Uint8Array(grid.total);
    campaign.bossTriggered = false;
    campaign.bossActive = false;
    campaign.bossDefeated = false;
    campaign.bossRespawnTimer = 0;
    campaign.started = false;
    campaign.prompt = null;
    campaign.levelSearched = 0;
    campaign.levelSearchTotal = 0;
    campaign.levelStartTime = campaign.time;
    campaign.rogue = !!level.rogue;
    campaign.rogueFloor = level.floor || index + 1;
    campaign.searchTarget = null;
    campaign.searchTimer = 0;
    campaign.searchFxTimer = 0;
    campaign.arenaLocked = false;
    campaign.arenaRoom = level.bossTrigger ? level.rooms.find((room) => room.boss) || level.bossTrigger : null;
    campaign.arenaBarriers = campaign.arenaRoom ? buildCampaignArenaBarriers(level, grid) : [];
    campaign.visionRadius = 255;

    p.x = level.playerStart.x;
    p.y = level.playerStart.y;
    p.vx = 0;
    p.vy = 0;
    p.aimAngle = 0;
    p.invuln = 1.2;
    p.reloading = false;
    p.reloadTimer = 0;
    p.pendingReload = 0;
    p.fireCooldown = 0;
    p.bloom = 0;
    p.reviving = false;
    p.alive = true;
    p.hp = preserve ? Math.min(p.maxHp, p.hp + p.maxHp * 0.28) : p.maxHp;
    for (const id of WEAPON_ORDER) {
      if (p.owned[id]) p.ammo[id] = weaponCapacity(id, p.mods);
    }
    p.grenadeCooldown = 0;
    applyDeveloperPerks(p);
    spawnActivePet();
    if (isDeveloperMode()) campaign.explored.fill(1);

    spawnCampaignProps();
    spawnCampaignSearchables();
    spawnCampaignEnemies();
    revealCampaignArea();

    document.documentElement.style.setProperty('--campaign-accent', level.theme.accent);
    document.body.classList.add('in-game');
    document.body.classList.remove('low-hp');
    dom.hud.classList.remove('is-hidden');
    dom.shopOverlay.classList.add('is-hidden');
    dom.talentOverlay.classList.add('is-hidden');
    dom.pauseOverlay.classList.add('is-hidden');
    dom.settingsOverlay.classList.add('is-hidden');
    dom.charactersOverlay.classList.add('is-hidden');
    dom.bestiaryOverlay.classList.add('is-hidden');
    dom.gameover.classList.add('is-hidden');
    dom.campaignComplete.classList.add('is-hidden');
    dom.intermission.classList.add('is-hidden');
    dom.trainingPanel?.classList.add('is-hidden');
    dom.reviveHud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    document.body.classList.toggle('campaign-mode', true);
    applyRunModeUI();
    resetCameraToPlayer();
    updateHUD();
    game.lastFrame = performance.now();

    if (fromMenu) {
      dom.menu.classList.add('is-closing');
      window.setTimeout(() => {
        dom.menu.classList.add('is-hidden');
        dom.menu.classList.remove('is-closing');
      }, 260);
    } else {
      dom.menu.classList.add('is-hidden');
    }
    showBanner(`${level.code} // ${level.subtitle}`, level.name, level.startText, false, campaign.rogue ? 3400 : 4300);
    Sfx.waveStart();
    if (campaign.rogue) {
      recordRogueFloor(campaign.rogueFloor);
      if (index === 0) {
        window.setTimeout(() => {
          if (game.mode === 'playing' || game.mode === 'shop') {
            addToast('▸', '肉鸽循环已启动', '每层地图随机重构 · 每 3 层区域守卫 · 敌人会加速强化', 'gold', 6200);
          }
        }, 900);
      } else {
        addToast('▲', `下潜至第 ${campaign.rogueFloor} 层`, '地图已重构 · 搜索补给并找到上行电梯', '', 3800);
      }
    } else if (index === 0) {
      window.setTimeout(() => {
        if (game.mode === 'playing' || game.mode === 'shop') {
          addToast('▸', '闯关模式已开始', 'E 搜索 · F 电梯/商店 · 视野受限', 'gold', 5600);
        }
      }, 900);
    } else {
      addToast('▲', `进入 ${level.name}`, '继续搜索补给，找到终点电梯', '', 4200);
    }
  }

  function recordRogueFloor(floor) {
    if (!game.campaign.rogue || !Number.isFinite(floor) || floor <= 0) return;
    const diff = getDifficultyConfig().id;
    const byDifficulty = { ...(game.rogueRecord?.byDifficulty || {}) };
    const previous = byDifficulty[diff]?.bestFloor || 0;
    if (floor <= previous) return;
    byDifficulty[diff] = { bestFloor: floor };
    game.rogueRecord = { bestFloor: rogueRecordBest(byDifficulty), byDifficulty };
    storeString('labzero.rogueByDifficulty', JSON.stringify(byDifficulty));
    storeNumber('labzero.rogueBestFloor', game.rogueRecord.bestFloor);
    claimCharacterProgress('rogue');
    if (game.menuMode === 'rogue') updateBestUI();
  }

  function startCampaignRun(index = 0, fromMenu = false, preserve = false) {
    Sfx.init();
    if (!preserve) {
      clearTransientState();
      clearToasts();
      hideAllOverlaysForRun();
      game.menuMode = 'campaign';
      storeString('labzero.menuMode', 'campaign');
      game.runMode = 'campaign';
      game.campaign.active = true;
      game.campaign.time = 0;
      game.campaign.searchedCount = 0;
      game.campaign.foundCredits = 0;
      game.campaign.foundItems = 0;
      game.campaign.bossKills = 0;
      game.campaign.levelIndex = 0;
      game.kills = 0;
      game.creditsEarned = 0;
      game.runTime = 0;
      game.time = 0;
      Sfx.click();
    }
    game.runMode = 'campaign';
    game.menuMode = 'campaign';
    game.campaign.rogue = false;
    game.campaign.rogueFloor = 0;
    setupCampaignLevel(index, preserve, fromMenu);
  }

  function startRogueRun(fromMenu = false, preserve = false) {
    Sfx.init();
    if (!preserve) {
      clearTransientState();
      clearToasts();
      hideAllOverlaysForRun();
      game.menuMode = 'rogue';
      storeString('labzero.menuMode', 'rogue');
      game.runMode = 'campaign';
      game.campaign.active = true;
      game.campaign.rogue = true;
      game.campaign.rogueFloor = 1;
      game.campaign.time = 0;
      game.campaign.searchedCount = 0;
      game.campaign.foundCredits = 0;
      game.campaign.foundItems = 0;
      game.campaign.bossKills = 0;
      game.campaign.levelIndex = 0;
      game.kills = 0;
      game.creditsEarned = 0;
      game.runTime = 0;
      game.time = 0;
      Sfx.click();
    }
    game.runMode = 'campaign';
    game.menuMode = 'rogue';
    game.campaign.rogue = true;
    const level = generateRogueLevel(0);
    setupCampaignLevel(0, preserve, fromMenu, level);
  }

  function startCurrentRun(fromMenu = false) {
    if (game.menuMode === 'campaign') startCampaignRun(0, fromMenu, false);
    else if (game.menuMode === 'rogue') startRogueRun(fromMenu, false);
    else if (game.menuMode === 'training') startTrainingRun(fromMenu);
    else if (game.menuMode === 'story') startStoryMode(fromMenu);
    else {
      const checkpoint = checkpointMatchesCurrentDifficulty() ? game.endlessCheckpoint : null;
      startRun(fromMenu, checkpoint);
    }
  }

  function updateCampaign(dt) {
    const campaign = game.campaign;
    const p = game.player;
    if (!campaign.active || !campaign.level || !p || !p.alive) return;
    campaign.time += dt;
    revealCampaignArea();
    updateCampaignSearch(dt);
    updateCampaignPrompt();
    if (campaign.level.bossTrigger && !campaign.bossTriggered && !campaign.bossDefeated && pointInRect(p.x, p.y, campaign.level.bossTrigger)) {
      startCampaignBossFight();
    }
    if (campaign.bossDefeated && campaign.elevators[1]) campaign.elevators[1].locked = false;
    if (campaign.bossActive && game.bossRef && game.bossRef.dead) {
      campaign.bossActive = false;
    }
    if (campaign.bossActive && !campaign.bossDefeated) {
      const livingBoss = game.enemies.find((enemy) => enemy.campaignBoss && !enemy.dead && enemy.hp > 0);
      if (livingBoss) {
        game.bossRef = livingBoss;
        campaign.bossRespawnTimer = 0;
      } else {
        campaign.bossRespawnTimer = (campaign.bossRespawnTimer || 0) + dt;
        if (campaign.bossRespawnTimer >= 0.8) {
          campaign.bossRespawnTimer = 0;
          const bossDef = CAMPAIGN_BOSS_DEFS[campaign.level?.bossKind];
          if (campaign.level?.bossSpawn && bossDef) {
            // Safety net for a boss that was removed by an interrupted level
            // transition or an old spawn edge case.
            spawnCampaignBoss(campaign.level.bossKind, campaign.level.bossSpawn.x, campaign.level.bossSpawn.y);
            addText(game.bossRef?.x || campaign.level.bossSpawn.x, (game.bossRef?.y || campaign.level.bossSpawn.y) - 60, '指挥信号重新锁定', '255, 153, 111', 1.4, 10, -20);
            addToast('!', '区域指挥官信号重新锁定', `${bossDef.name} 已重新进入战场`, 'danger', 3200);
          }
        }
      }
    }
    if (campaign.arenaLocked) {
      clampEntityToCampaignArena(p);
      for (const enemy of game.enemies) {
        if (!enemy.dead && (enemy.campaignBoss || enemy.campaignBossMinion || pointInRect(enemy.x, enemy.y, campaign.arenaRoom))) {
          clampEntityToCampaignArena(enemy);
        }
      }
    }
  }

  function updateCampaignPrompt() {
    const campaign = game.campaign;
    const p = game.player;
    if (!campaign.active || !p) {
      campaign.prompt = null;
      return;
    }
    const prompt = { search: null, shop: null, elevator: null };
    let bestSearch = 72;
    for (const item of campaign.searchables) {
      if (campaign.searchTarget) break;
      if (item.searched) continue;
      const d = dist(p.x, p.y, item.x, item.y);
      if (d < bestSearch && hasLineOfSight(p.x, p.y, item.x, item.y)) {
        bestSearch = d;
        prompt.search = item;
      }
    }
    let bestShop = 90;
    for (const shop of campaign.shops) {
      const d = dist(p.x, p.y, shop.x, shop.y);
      if (d < bestShop) {
        bestShop = d;
        prompt.shop = shop;
      }
    }
    let bestElevator = 95;
    for (const elevator of campaign.elevators) {
      if (elevator.kind === 'start' && campaign.started) continue;
      const d = dist(p.x, p.y, elevator.x, elevator.y);
      if (d < bestElevator) {
        bestElevator = d;
        prompt.elevator = elevator;
      }
    }
    campaign.prompt = prompt;
  }

  function startCampaignSearch(item) {
    const campaign = game.campaign;
    const p = game.player;
    if (!campaign.active || !item || item.searched || !p) return;
    if (campaign.searchTarget) {
      if (campaign.searchTarget !== item && !item.searched) {
        addText(p.x, p.y - 30, '正在搜索其他目标', '255, 205, 130', 0.9, 11, -18);
      }
      return;
    }
    campaign.searchTarget = item;
    campaign.searchTimer = 3;
    campaign.searchDuration = 3;
    campaign.searchFxTimer = 0;
    addText(item.x, item.y - 22, '开始搜索', '128, 255, 207', 1.0, 11, -16);
    Sfx.click();
  }

  function cancelCampaignSearch(message = '搜索中断') {
    const campaign = game.campaign;
    const target = campaign.searchTarget;
    if (!target) return;
    campaign.searchTarget = null;
    campaign.searchTimer = 0;
    campaign.searchFxTimer = 0;
    addText(target.x, target.y - 22, message, '255, 132, 103', 1.0, 11, -16);
    Sfx.error();
  }

  function updateCampaignSearch(dt) {
    const campaign = game.campaign;
    const p = game.player;
    const target = campaign.searchTarget;
    if (!target) return;
    if (!campaign.active || !p || !p.alive || target.searched) {
      campaign.searchTarget = null;
      campaign.searchTimer = 0;
      return;
    }
    if (dist(p.x, p.y, target.x, target.y) > 90 || !hasLineOfSight(p.x, p.y, target.x, target.y)) {
      cancelCampaignSearch();
      return;
    }
    campaign.searchTimer = Math.max(0, campaign.searchTimer - dt);
    campaign.searchFxTimer -= dt;
    if (campaign.searchFxTimer <= 0) {
      campaign.searchFxTimer = 0.16;
      const a = rand(0, TAU);
      addParticle({
        type: 'spark',
        x: target.x + Math.cos(a) * rand(10, 27),
        y: target.y + Math.sin(a) * rand(8, 22),
        vx: rand(-18, 18),
        vy: rand(-36, -12),
        life: rand(0.25, 0.55),
        size: rand(1, 2.2),
        color: '128, 255, 207',
        drag: 2,
        alpha: 0.7,
      });
    }
    if (campaign.searchTimer <= 0) {
      campaign.searchTarget = null;
      campaign.searchTimer = 0;
      resolveCampaignSearch(target);
    }
  }

  function searchCampaignObject(item) {
    startCampaignSearch(item);
  }

  function resolveCampaignSearch(item) {
    const campaign = game.campaign;
    const p = game.player;
    if (!item || item.searched || !p) return;
    item.searched = true;
    campaign.levelSearched += 1;
    campaign.searchedCount += 1;
    const level = campaign.level;
    Sfx.click();
    const roll = Math.random();
    if (roll < 0.3) {
      addText(item.x, item.y - 20, '空', '128, 154, 151', 1.4, 11, -24);
      addToast('…', '没有找到有用物资', '这个箱柜已经空了', '', 2400);
    } else if (roll < 0.7) {
      const amount = Math.round(rand(18, 72) * (1 + level.index * 0.35) * getDifficultyConfig().creditMult * characterCreditMultiplier());
      p.credits += amount;
      game.creditsEarned += amount;
      campaign.foundCredits += amount;
      addText(item.x, item.y - 20, `+${amount} CR`, '255, 209, 123', 1.5, 12, -28);
      addToast('C', '找到信用点', `+${amount} CR`, 'gold', 2600);
    } else if (roll < 0.86) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + 38);
      const healed = Math.round(p.hp - before);
      if (healed > 0) {
        addText(item.x, item.y - 20, `+${healed} HP`, '127, 255, 193', 1.5, 12, -28);
        addToast('+', '找到急救包', `恢复 ${healed} 生命值`, '', 2800);
      } else {
        const converted = Math.round(22 * characterCreditMultiplier());
        p.credits += converted;
        game.creditsEarned += converted;
        campaign.foundCredits += converted;
        addToast('C', '急救包已满', '转化为 22 CR', 'gold', 2400);
      }
      campaign.foundItems += 1;
    } else {
      const types = ['frag', 'flash', 'incendiary'];
      const id = types[(Math.random() * types.length) | 0];
      const def = GRENADES[id];
      p.grenades[id] = Math.min(grenadeMaxStock(id), (p.grenades[id] || 0) + 1);
      if ((p.grenades[p.selectedGrenade] || 0) <= 0) p.selectedGrenade = id;
      campaign.foundItems += 1;
      addText(item.x, item.y - 20, `+1 ${def.name}`, def.color, 1.5, 12, -28);
      addToast('+', '找到投掷物', `${def.name} +1`, 'gold', 3000);
    }
    updateHUD();
  }

  function campaignExitUnlocked(campaign = game.campaign) {
    return !campaign.level?.bossTrigger || campaign.bossDefeated;
  }

  function interactCampaignElevator(elevator) {
    const campaign = game.campaign;
    if (!elevator) return;
    if (elevator.kind === 'start') {
      campaign.started = true;
      addToast('F', '起点电梯已确认', campaign.rogue
        ? '搜索沿途箱柜，找到补给站与上行电梯'
        : '搜索沿途箱柜，找到商店终端与终点电梯', '', 3600);
      return;
    }
    if (!campaignExitUnlocked(campaign)) {
      if (!campaign.bossTriggered) {
        startCampaignBossFight();
      }
      Sfx.error();
      addToast('!', campaign.rogue ? '上行电梯已锁定' : '终点电梯已锁定', campaign.rogue
        ? '击败本层区域守卫后才能继续下潜'
        : '击败区域指挥官后才能启动电梯', 'danger', 3200);
      return;
    }
    advanceCampaignLevel();
  }

  function tryCampaignInteract() {
    const campaign = game.campaign;
    const p = game.player;
    if (!campaign.active || !p) return;
    const prompt = campaign.prompt;
    if (!prompt) return;
    if (prompt.elevator) {
      interactCampaignElevator(prompt.elevator);
      return;
    }
    if (prompt.shop) {
      openShop(true);
      return;
    }
    if (prompt.search) {
      searchCampaignObject(prompt.search);
    }
  }

  function searchNearbyCampaignObject() {
    const campaign = game.campaign;
    if (campaign.prompt?.search) searchCampaignObject(campaign.prompt.search);
  }

  function advanceCampaignLevel() {
    const campaign = game.campaign;
    if (campaign.rogue) {
      const nextIndex = campaign.levelIndex + 1;
      const bonus = Math.round((130 + nextIndex * 45) * getDifficultyConfig().creditMult * characterCreditMultiplier());
      game.player.credits += bonus;
      game.creditsEarned += bonus;
      campaign.levelIndex = nextIndex;
      const level = generateRogueLevel(nextIndex);
      setupCampaignLevel(nextIndex, true, false, level);
      addToast('▲', `下潜至第 ${campaign.levelIndex + 1} 层`, `地图已重构 · 层间奖励 +${bonus} CR · 敌人强化速度提升`, 'gold', 4800);
      return;
    }
    if (campaign.levelIndex < CAMPAIGN_LEVELS.length - 1) {
      const mapBonus = Math.round((160 + campaign.levelIndex * 60) * characterCreditMultiplier());
      game.player.credits += mapBonus;
      game.creditsEarned += mapBonus;
      campaign.levelIndex += 1;
      setupCampaignLevel(campaign.levelIndex, true, false);
      addToast('▲', '电梯上行', `深入 ${campaign.level.name} · 地图肃清奖励 +${mapBonus} CR`, 'gold', 4800);
    } else {
      showCampaignComplete();
    }
  }

  function showCampaignComplete() {
    const campaign = game.campaign;
    const p = game.player;
    game.mode = 'campaignComplete';
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    const diff = getDifficultyConfig();
    const time = campaign.time;
    const byDifficulty = { ...(game.campaignRecord?.byDifficulty || {}) };
    const current = byDifficulty[diff.id] || { clears: 0, bestTime: 0 };
    const clears = (current.clears || 0) + 1;
    const bestTime = current.bestTime > 0 ? Math.min(current.bestTime, time) : time;
    byDifficulty[diff.id] = { clears, bestTime };
    const totals = campaignRecordTotals(byDifficulty);
    game.campaignRecord = { clears: totals.clears, bestTime: totals.bestTime, byDifficulty };
    storeString('labzero.campaignByDifficulty', JSON.stringify(byDifficulty));
    storeNumber('labzero.campaignClears', totals.clears);
    storeNumber('labzero.campaignBestTime', Math.round(totals.bestTime));
    setText(dom.campaignTime, formatDuration(time));
    setText(dom.campaignKills, p.kills);
    setText(dom.campaignSearches, campaign.searchedCount);
    setText(dom.campaignCredits, formatInt(game.creditsEarned));
    const grade = time <= 420 ? 'S' : time <= 720 ? 'A' : time <= 1080 ? 'B' : 'C';
    setText(dom.campaignGrade, `评价：${grade}`);
    setText(dom.campaignRecord, `${diff.name} · 最佳用时：${formatDuration(bestTime)}`);
    const tokenGain = claimCharacterProgress('campaign');
    setText(dom.campaignTokenLine, tokenGain > 0 ? `角色代币 +${tokenGain} · 可在主菜单「角色」中解锁干员` : '角色代币 · 本难度里程碑已领取');
    dom.campaignComplete.classList.remove('is-hidden');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    document.body.classList.remove('low-hp');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    updateBestUI();
    dom.btnCampaignMenu.focus({ preventScroll: true });
    Sfx.bossDeath();
  }

  function startCampaignBossFight() {
    const campaign = game.campaign;
    if (!campaign.active || campaign.bossTriggered || campaign.bossDefeated) return;
    campaign.bossTriggered = true;
    campaign.bossActive = true;
    campaign.arenaLocked = true;
    game.enemyBullets = game.enemyBullets.filter((bullet) => pointInRect(bullet.x, bullet.y, campaign.arenaRoom));
    clampEntityToCampaignArena(game.player);
    addToast('!', '区域封锁协议启动', '击败区域指挥官前，玩家与敌人无法离开房间', 'danger', 4600);
    const level = campaign.level;
    const def = CAMPAIGN_BOSS_DEFS[level.bossKind];
    spawnCampaignBoss(level.bossKind, level.bossSpawn.x, level.bossSpawn.y);
    if (campaign.rogue) {
      addToast('!', '区域守卫出现', `${def.name} · ${def.desc}`, 'danger', 5200);
    } else {
      showBanner(`BOSS ENCOUNTER // ${def.tag}`, def.name, level.bossIntro, true, 4300);
      addToast('!', '区域指挥官出现', `${def.name} · ${def.desc}`, 'danger', 5200);
    }
    game.shake = Math.max(game.shake, 18);
    Sfx.bossSpawn();
  }

  function activateStandardWorld() {
    game.worldMode = 'endless';
    game.runMode = 'endless';
    if (OBSTACLES !== STANDARD_OBSTACLES) {
      OBSTACLES = STANDARD_OBSTACLES;
      navFields.clear();
      buildEnvironment();
    }
  }

  /* ------------------------------------------------------------
     Collision helpers
     ------------------------------------------------------------ */
  function circleRectOverlap(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    return dist2(cx, cy, nx, ny) < r * r;
  }

  function isPointFree(x, y, r) {
    if (x < WORLD.pad + r || y < WORLD.pad + r || x > WORLD.w - WORLD.pad - r || y > WORLD.h - WORLD.pad - r) return false;
    for (const obs of OBSTACLES) {
      if (obs.shape === 'rect') {
        if (circleRectOverlap(x, y, r, obs)) return false;
      } else if (dist2(x, y, obs.x, obs.y) < (r + obstacleRadius(obs)) * (r + obstacleRadius(obs))) {
        return false;
      }
    }
    return true;
  }

  function pushOutOfObstacle(entity, obs) {
    if (obs.shape === 'rect') {
      if (!circleRectOverlap(entity.x, entity.y, entity.r, obs)) return;
      const nx = clamp(entity.x, obs.x, obs.x + obs.w);
      const ny = clamp(entity.y, obs.y, obs.y + obs.h);
      let dx = entity.x - nx;
      let dy = entity.y - ny;
      let d = Math.hypot(dx, dy);
      if (d > 0.0001) {
        const overlap = entity.r - d;
        entity.x += (dx / d) * overlap;
        entity.y += (dy / d) * overlap;
      } else {
        // Center is inside the rect; find the closest edge and eject.
        const left = entity.x - obs.x;
        const right = obs.x + obs.w - entity.x;
        const top = entity.y - obs.y;
        const bottom = obs.y + obs.h - entity.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) entity.x = obs.x - entity.r;
        else if (m === right) entity.x = obs.x + obs.w + entity.r;
        else if (m === top) entity.y = obs.y - entity.r;
        else entity.y = obs.y + obs.h + entity.r;
      }
    } else {
      const minDist = entity.r + obstacleRadius(obs);
      const dx = entity.x - obs.x;
      const dy = entity.y - obs.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        if (d > 0.0001) {
          entity.x = obs.x + (dx / d) * minDist;
          entity.y = obs.y + (dy / d) * minDist;
        } else {
          entity.x = obs.x + minDist;
        }
      }
    }
  }

  function resolveObstacles(entity) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const obs of OBSTACLES) pushOutOfObstacle(entity, obs);
    }
  }

  function isPositionBlocked(x, y, r) {
    if (x < WORLD.pad + r || y < WORLD.pad + r || x > WORLD.w - WORLD.pad - r || y > WORLD.h - WORLD.pad - r) return true;
    for (const obs of OBSTACLES) {
      if (obs.shape === 'rect') {
        if (circleRectOverlap(x, y, r, obs)) return true;
      } else {
        const min = r + obstacleRadius(obs);
        if (dist2(x, y, obs.x, obs.y) < min * min) return true;
      }
    }
    return false;
  }

  function nudgeToFreePosition(entity) {
    if (!isPositionBlocked(entity.x, entity.y, entity.r)) return true;
    for (let pass = 0; pass < 4; pass += 1) {
      resolveObstacles(entity);
      if (!isPositionBlocked(entity.x, entity.y, entity.r)) return true;
    }
    // Last-resort ring search. This only runs if an external force or a spawn
    // placed an actor inside geometry.
    for (let radius = 6; radius <= 156; radius += 6) {
      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * TAU;
        const x = entity.x + Math.cos(a) * radius;
        const y = entity.y + Math.sin(a) * radius;
        if (!isPositionBlocked(x, y, entity.r)) {
          entity.x = x;
          entity.y = y;
          return true;
        }
      }
    }
    return false;
  }

  function moveCircle(entity, dx, dy) {
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0001) {
      nudgeToFreePosition(entity);
      return;
    }
    // Sub-stepping keeps thin props reliable even during dashes and heavy
    // knockback, and prevents the resolver from ever ejecting through cover.
    const steps = Math.max(1, Math.ceil(distance / 4));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let step = 0; step < steps; step += 1) {
      const ox = entity.x;
      const oy = entity.y;
      entity.x += sx;
      entity.y += sy;
      resolveObstacles(entity);
      if (!isPositionBlocked(entity.x, entity.y, entity.r)) continue;

      // X-only sliding.
      entity.x = ox + sx;
      entity.y = oy;
      resolveObstacles(entity);
      if (!isPositionBlocked(entity.x, entity.y, entity.r)) continue;

      // Y-only sliding.
      entity.x = ox;
      entity.y = oy + sy;
      resolveObstacles(entity);
      if (!isPositionBlocked(entity.x, entity.y, entity.r)) continue;

      // The corner is too tight: stay at the last known safe position.
      entity.x = ox;
      entity.y = oy;
      resolveObstacles(entity);
      if (isPositionBlocked(entity.x, entity.y, entity.r)) nudgeToFreePosition(entity);
      break;
    }
  }

  function segmentCircleT(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - cx;
    const fy = y1 - cy;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    if (t1 >= 0 && t1 <= 1) return t1;
    if (t2 >= 0 && t2 <= 1) return t2;
    if (t1 < 0 && t2 > 1) return 0;
    return null;
  }

  function segmentRectT(x1, y1, x2, y2, rect, padding = 0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let tmin = 0;
    let tmax = 1;
    const axes = [
      [x1, dx, rect.x - padding, rect.x + rect.w + padding],
      [y1, dy, rect.y - padding, rect.y + rect.h + padding],
    ];
    for (const [origin, delta, min, max] of axes) {
      if (Math.abs(delta) < 0.000001) {
        if (origin < min || origin > max) return null;
      } else {
        let t1 = (min - origin) / delta;
        let t2 = (max - origin) / delta;
        if (t1 > t2) [t1, t2] = [t2, t1];
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  function closestObstacleHit(x1, y1, x2, y2, padding = 0) {
    let best = null;
    for (const obs of OBSTACLES) {
      const t = obs.shape === 'rect'
        ? segmentRectT(x1, y1, x2, y2, obs, padding)
        : segmentCircleT(x1, y1, x2, y2, obs.x, obs.y, obstacleRadius(obs) + padding);
      if (t !== null && t >= 0 && (!best || t < best.t)) {
        best = { t, obs };
      }
    }
    if (best) {
      best.x = lerp(x1, x2, best.t);
      best.y = lerp(y1, y2, best.t);
      const dx = x2 - x1;
      const dy = y2 - y1;
      best.angle = Math.atan2(-dy, -dx);
    }
    return best;
  }

  function hasLineOfSight(x1, y1, x2, y2) {
    const hit = closestObstacleHit(x1, y1, x2, y2);
    return !hit || hit.t >= 0.995;
  }

  function isOnScreen(x, y, pad = 8) {
    const viewW = game.viewW / CAMERA_ZOOM;
    const viewH = game.viewH / CAMERA_ZOOM;
    return x >= game.camera.x - pad && x <= game.camera.x + viewW + pad && y >= game.camera.y - pad && y <= game.camera.y + viewH + pad;
  }

  /* ------------------------------------------------------------
     Navigation field
     Enemies use a cached flow field when cover blocks the direct line.
     This keeps them on walkable geometry instead of pushing a wall.
     ------------------------------------------------------------ */
  const NAV_CELL = 32;
  const navFields = new Map();

  function createNavField(clearance) {
    const cols = Math.ceil(WORLD.w / NAV_CELL);
    const rows = Math.ceil(WORLD.h / NAV_CELL);
    const count = cols * rows;
    const blocked = new Uint8Array(count);
    const dist = new Int32Array(count);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = (col + 0.5) * NAV_CELL;
        const y = (row + 0.5) * NAV_CELL;
        blocked[row * cols + col] = isPositionBlocked(x, y, clearance) ? 1 : 0;
      }
    }
    const field = {
      clearance,
      cols,
      rows,
      count,
      blocked,
      dist,
      queue: new Int32Array(count),
      lastBuild: -1,
      lastPlayerCell: -1,
      lastPlayerX: -1,
      lastPlayerY: -1,
    };
    field.cellIndex = (x, y) => {
      const col = clamp(Math.floor(x / NAV_CELL), 0, cols - 1);
      const row = clamp(Math.floor(y / NAV_CELL), 0, rows - 1);
      return row * cols + col;
    };
    field.cellCenter = (index) => ({
      x: (index % cols + 0.5) * NAV_CELL,
      y: (Math.floor(index / cols) + 0.5) * NAV_CELL,
    });
    field.nearestFree = (x, y) => {
      const base = field.cellIndex(x, y);
      if (!blocked[base]) return base;
      const bc = base % cols;
      const br = Math.floor(base / cols);
      for (let radius = 1; radius <= 12; radius += 1) {
        for (let dr = -radius; dr <= radius; dr += 1) {
          for (let dc = -radius; dc <= radius; dc += 1) {
            if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
            const c = bc + dc;
            const r = br + dr;
            if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
            const i = r * cols + c;
            if (!blocked[i]) return i;
          }
        }
      }
      return base;
    };
    field.rebuild = (px, py) => {
      dist.fill(-1);
      const start = field.nearestFree(px, py);
      const q = field.queue;
      let head = 0;
      let tail = 0;
      dist[start] = 0;
      q[tail++] = start;
      while (head < tail) {
        const current = q[head++];
        const cc = current % cols;
        const cr = Math.floor(current / cols);
        const nextDist = dist[current] + 1;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (!dc && !dr) continue;
            const nc = cc + dc;
            const nr = cr + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = nr * cols + nc;
            if (blocked[ni] || dist[ni] !== -1) continue;
            if (dc && dr) {
              // Don't cut diagonal corners through a blocked orthogonal cell.
              if (blocked[cr * cols + nc] || blocked[nr * cols + cc]) continue;
            }
            dist[ni] = nextDist;
            q[tail++] = ni;
          }
        }
      }
      field.lastBuild = game.time;
      field.lastPlayerCell = field.nearestFree(px, py);
      field.lastPlayerX = px;
      field.lastPlayerY = py;
    };
    field.ensureBuilt = (px, py) => {
      const playerCell = field.nearestFree(px, py);
      if (field.lastBuild < 0 || playerCell !== field.lastPlayerCell || game.time - field.lastBuild > 0.45) {
        field.rebuild(px, py);
      }
    };
    return field;
  }

  function getNavDirection(enemy, targetX, targetY) {
    const clearance = enemy.type === 'boss' ? 42 : 24;
    let field = navFields.get(clearance);
    if (!field) {
      field = createNavField(clearance);
      navFields.set(clearance, field);
    }
    field.ensureBuilt(targetX, targetY);
    const cell = field.nearestFree(enemy.x, enemy.y);
    if (field.dist[cell] < 0) return null;
    const cols = field.cols;
    const cc = cell % cols;
    const cr = Math.floor(cell / cols);
    const hereDist = field.dist[cell];
    let best = null;
    let bestDist = hereDist;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dc && !dr) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= field.rows) continue;
        const ni = nr * cols + nc;
        if (field.blocked[ni] || field.dist[ni] < 0) continue;
        if (dc && dr && (field.blocked[cr * cols + nc] || field.blocked[nr * cols + cc])) continue;
        if (field.dist[ni] < bestDist) {
          bestDist = field.dist[ni];
          best = ni;
        }
      }
    }
    if (best == null) {
      if (hereDist === 0) {
        return { x: targetX - enemy.x, y: targetY - enemy.y };
      }
      return null;
    }
    const center = field.cellCenter(best);
    return { x: center.x - enemy.x, y: center.y - enemy.y };
  }

  /* ------------------------------------------------------------
     Run lifecycle and wave direction
     ------------------------------------------------------------ */
  function saveBestWave() {
    if (game.runMode === 'campaign') return;
    if (!game.bestStats) game.bestStats = { overall: 0, easy: 0, normal: 0, hard: 0, inferno: 0 };
    const diff = getDifficultyConfig();
    const wave = game.wave || 0;
    let changed = false;
    if (wave > (game.bestStats[diff.id] || 0)) {
      game.bestStats[diff.id] = wave;
      changed = true;
    }
    if (wave > (game.bestStats.overall || 0)) {
      game.bestStats.overall = wave;
      changed = true;
    }
    game.bestWave = game.bestStats[diff.id] || 0;
    if (changed) {
      storeString('labzero.bestStats', JSON.stringify(game.bestStats));
      storeNumber('labzero.bestWave', game.bestStats.overall);
      updateBestUI();
    }
  }

  function clearTransientState() {
    game.enemies = [];
    game.bossRef = null;
    game.bullets = [];
    game.playerMissiles = [];
    game.enemyBullets = [];
    game.enemyRockets = [];
    game.enemyTurrets = [];
    game.campaignHazards = [];
    game.campaign.searchTarget = null;
    game.campaign.searchTimer = 0;
    game.campaign.searchFxTimer = 0;
    game.campaign.arenaLocked = false;
    game.coins = [];
    game.pickups = [];
    game.particles = [];
    game.casings = [];
    game.texts = [];
    game.decals = [];
    game.portals = [];
    game.turrets = [];
    game.grenades = [];
    game.fireZones = [];
    game.wave = 0;
    game.waveActive = false;
    game.waveTotal = 0;
    game.waveElapsed = 0;
    game.spawnQueue = [];
    game.intermission = false;
    game.intermissionTimer = 0;
    game.intermissionReward = 0;
    game.kills = 0;
    game.creditsEarned = 0;
    game.shake = 0;
    game.damageFlash = 0;
    game.hitFlash = 0;
    game.hitMarker = 0;
    game.killMarker = 0;
    game.reticleBloom = 0;
    game.bossOrdinal = 0;
    game.deathTimer = 0;
    game.deathShown = false;
    game.shopHintShown = false;
    input.firing = false;
    input.firingSecondary = false;
    input.pointerId = null;
    input.keys.clear();
    game.turrets = [];
  }

  function resetCameraToPlayer() {
    const p = game.player;
    const viewW = game.viewW / CAMERA_ZOOM;
    const viewH = game.viewH / CAMERA_ZOOM;
    const maxX = Math.max(0, WORLD.w - viewW);
    const maxY = Math.max(0, WORLD.h - viewH);
    const x = clamp(p.x - viewW / 2, 0, maxX);
    const y = clamp(p.y - viewH / 2, 0, maxY);
    game.camera.x = x;
    game.camera.y = y;
    game.camera.targetX = x;
    game.camera.targetY = y;
  }

  function beginWave(n) {
    game.wave = n;
    const nextBiome = ENDLESS_BIOMES[Math.floor((n - 1) / 5) % ENDLESS_BIOMES.length];
    const biomeChanged = game.endlessBiome !== nextBiome.system;
    game.endlessBiome = nextBiome.system;
    game.waveActive = true;
    game.intermission = false;
    game.intermissionReward = 0;
    game.waveElapsed = 0;
    game.spawnQueue = buildWave(n);
    game.waveTotal = game.spawnQueue.length;
    game.bossRef = null;
    dom.intermission.classList.add('is-hidden');
    if (n % 3 === 0) {
      game.bossOrdinal = Math.floor(n / 3);
      const bossKind = ENEMY_SYSTEMS[nextBiome.system]?.bossKind;
      const bossDef = CAMPAIGN_BOSS_DEFS[bossKind];
      addToast('!', `${bossDef?.name || '区域守卫'}信号接近`, `第 ${pad2(n)} 波 · ${bossDef?.code || 'HIGH-VALUE TARGET'} 已进入区域`, 'danger', 4200);
    }
    saveBestWave();
    claimCharacterProgress('endless');
    if (biomeChanged && n > 1) {
      game.biomeFxUntil = game.time + 2.6;
      showBanner(`SECTOR SHIFT // ${nextBiome.code}`, nextBiome.name, `区域已切换 · 本区只会生成${ENEMY_SYSTEMS[nextBiome.system].name}敌人`, false, 3300);
      addToast('▸', `进入${nextBiome.name}`, `${ENEMY_SYSTEMS[nextBiome.system].name} · 本区敌人体系已变更`, 'gold', 4200);
    }
    Sfx.waveStart();
    updateHUD();
    if (game.runMode === 'endless') saveEndlessCheckpoint(true);
  }

  function stageDescription(n) {
    if (n === 1) return '清除区域内全部实验体 · 左键长按可连发';
    if (n === 2) return '精英生命信号混入 · 优先处理高价值目标';
    return '实验体数量上升 · 注意侧翼与掩体';
  }

  function buildWave(n) {
    const queue = [];
    const diff = getDifficultyConfig();
    const system = ENEMY_SYSTEMS[game.endlessBiome] || ENEMY_SYSTEMS.lab;
    if (n % 3 === 0) {
      queue.push({ type: 'boss', at: 0.8, bossKind: system.bossKind });
      const escorts = Math.max(1, Math.round((2 + Math.ceil(n / 3)) * diff.count));
      for (let i = 0; i < escorts; i += 1) {
        queue.push({ type: pickWeightedEnemy(system.pool), at: 2.1 + i * 0.62 });
      }
      if (n >= 6) {
        const elites = 1 + Math.floor((n - 6) / 3);
        const eliteCount = Math.min(4, Math.max(0, Math.round(elites * diff.count)));
        for (let i = 0; i < eliteCount; i += 1) {
          queue.push({ type: pickWeightedEnemy(system.pool), at: 3.4 + i * 1.5 });
        }
      }
    } else {
      const normals = Math.max(4, Math.min(28, Math.round(Math.min(23, 5 + Math.ceil(n * 1.5)) * diff.count)));
      const baseElites = n >= 2 ? Math.min(4, 1 + Math.floor((n - 2) / 3)) : 0;
      const elites = Math.min(5, Math.max(0, Math.round(baseElites * diff.count)));
      const total = normals + elites;
      for (let i = 0; i < total; i += 1) {
        queue.push({ type: pickWeightedEnemy(system.pool), at: 0.45 + i * 0.47 });
      }
    }
    return queue.sort((a, b) => a.at - b.at);
  }

  function countRemainingEnemies() {
    let alive = 0;
    for (const e of game.enemies) if (!e.dead) alive += 1;
    return alive + game.spawnQueue.length;
  }

  function countLivingEnemies() {
    let count = 0;
    for (const e of game.enemies) if (!e.dead) count += 1;
    return count;
  }

  function updateWave(dt) {
    if (game.intermission) {
      game.intermissionTimer = Math.max(0, game.intermissionTimer - dt);
      if (game.intermissionTimer <= 0) {
        beginWave(game.wave + 1);
      }
      return;
    }
    if (!game.waveActive) return;
    game.waveElapsed += dt;
    while (game.spawnQueue.length && game.spawnQueue[0].at <= game.waveElapsed) {
      const entry = game.spawnQueue.shift();
      spawnEnemy(entry.type);
    }
    if (!game.spawnQueue.length && countLivingEnemies() === 0) {
      completeWave();
    }
  }

  function completeWave() {
    if (!game.waveActive) return;
    game.waveActive = false;
    game.intermission = true;
    game.intermissionTimer = 15;
    const reward = Math.round((100 + game.wave * 25) * creditGainMultiplier());
    game.intermissionReward = reward;
    const xpReward = 12 + game.wave * 5;
    game.player.credits += reward;
    game.creditsEarned += reward;
    gainXP(xpReward);
    game.bossRef = null;
    showIntermission(reward);
    Sfx.waveClear();
    window.setTimeout(() => {
      if (game.mode === 'playing' || game.mode === 'shop' || game.mode === 'talents') {
        const pointsAvailable = game.player?.talentPoints || 0;
        addToast(
          'T',
          pointsAvailable > 0 ? `科技树可用 · ${pointsAvailable} 天赋点` : '科技树 · 本轮休整可查看',
          pointsAvailable > 0 ? '点击休整面板「科技树」或按 T 解锁强化' : '升级可获得天赋点 · 按 T 查看科技树',
          pointsAvailable > 0 ? 'gold' : '',
          5600,
        );
      }
    }, 1250);
    if (!game.shopHintShown) {
      game.shopHintShown = true;
      window.setTimeout(() => {
        if (game.mode === 'playing' || game.mode === 'shop') {
          addToast('B', '军械库终端已连接', '按 B 或 Tab 打开军械库，升级武器与补给', '', 5200);
        }
      }, 900);
    }
    updateHUD();
  }

  function showIntermission(reward) {
    setText(dom.interReward, `+${formatInt(reward)} CR`);
    setText(dom.interTitle, '区域已肃清');
    dom.interSub.innerHTML = '利用这段时间补给装备。下一波将在 <b id="next-countdown">15</b> 秒后到达。';
    dom.nextCountdown = $('next-countdown');
    setText(dom.nextCountdown, Math.ceil(game.intermissionTimer));
    dom.intermission.classList.remove('is-hidden');
    if (game.player) {
      game.player.pendingReload = 0;
      setText(dom.interTalentPoints, game.player.talentPoints);
      dom.interTalentRow.classList.toggle('has-points', game.player.talentPoints > 0);
      dom.btnInterTalents.classList.toggle('talent-alert', game.player.talentPoints > 0);
    }
  }

  function startNextWave() {
    if (!game.intermission) return;
    beginWave(game.wave + 1);
  }

  function spawnPointForEnemy(radius) {
    const p = game.player;
    const byDistance = [...SPAWN_POINTS].sort((a, b) => dist2(b.x, b.y, p.x, p.y) - dist2(a.x, a.y, p.x, p.y));
    const weights = [0.4, 0.28, 0.2, 0.12];
    let doorPick = 0;
    let roll = Math.random();
    for (let i = 0; i < weights.length; i += 1) {
      if (roll < weights[i]) {
        doorPick = i;
        break;
      }
      roll -= weights[i];
    }
    const ordered = [byDistance[doorPick], ...byDistance.filter((_, i) => i !== doorPick)];
    for (let doorIndex = 0; doorIndex < ordered.length; doorIndex += 1) {
      const door = ordered[doorIndex];
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const angle = rand(0, TAU);
        const spread = attempt < 7 ? rand(30, 80) : rand(70, 145);
        const x = door.x + Math.cos(angle) * spread;
        const y = door.y + Math.sin(angle) * spread;
        if (Math.hypot(x - p.x, y - p.y) < 250) continue;
        if (!isPointFree(x, y, radius + 3)) continue;
        let clear = true;
        for (const other of game.enemies) {
          if (!other.dead && dist2(x, y, other.x, other.y) < (radius + other.radius + 20) ** 2) {
            clear = false;
            break;
          }
        }
        if (clear) return { x, y };
      }
    }
    // Fallback: find any free area far from the player.
    for (let i = 0; i < 80; i += 1) {
      const x = rand(WORLD.pad + 60, WORLD.w - WORLD.pad - 60);
      const y = rand(WORLD.pad + 60, WORLD.h - WORLD.pad - 60);
      if (isPointFree(x, y, radius + 3) && Math.hypot(x - p.x, y - p.y) > 320) return { x, y };
    }
    return { x: BOSS_SPAWN.x, y: BOSS_SPAWN.y };
  }

  function findFreeSpotNear(cx, cy, radius, maxRange = 90) {
    for (let i = 0; i < 36; i += 1) {
      const angle = rand(0, TAU);
      const r = rand(18, maxRange);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (isPointFree(x, y, radius + 2)) return { x, y };
    }
    return null;
  }

  function bossHpForWave(wave) {
    const ordinal = Math.floor(wave / 3);
    return Math.round(1550 + (wave - 3) * 160 + (ordinal - 1) * 300);
  }

  function prepareBossSkillState(boss, kind) {
    if (!boss) return;
    const diff = getDifficultyConfig();
    const speed = Math.max(0.1, diff.attackSpeed || 1);
    boss.phase2 = false;
    boss.phase2Announced = false;
    boss.actionCd = rand(1.1, 2.1) / speed;
    boss.attackMode = kind === 'director' ? 'smg' : kind === 'sergeant' ? 'shotgun' : 'gatling';
    boss.burstLeft = 0;
    boss.burstTimer = 0;
    boss.burstInterval = 0.1;
    boss.burstDamage = 9;
    boss.burstSpeed = 1;
    boss.burstSpread = 0.05;
    boss.burstColor = '255, 122, 83';
    boss.burstSize = 4;
    boss.summonCd = (kind === 'robot' ? 4.8 : 6.2) / speed;
    boss.turretCd = 3.2 / speed;
    boss.chargeCd = 4.6 / speed;
    boss.pendingRockets = 0;
    boss.pendingRocketTimer = 0;
    boss.chargeWindup = 0;
    boss.chargeTime = 0;
    boss.chargeDirX = 0;
    boss.chargeDirY = 0;
    boss.chargeHit = false;
    boss.strafeDir = chance(0.5) ? 1 : -1;
    boss.strafeTimer = rand(1.2, 2.4);
  }

  function spawnEnemy(type, options = {}) {
    const cfg = ENEMY_TYPES[type];
    if (!cfg) return null;
    const p = game.player;
    let x = options.x;
    let y = options.y;
    if (x == null || y == null) {
      if (type === 'boss') {
        x = BOSS_SPAWN.x;
        y = BOSS_SPAWN.y;
        if (!isPointFree(x, y, cfg.radius + 2)) {
          const spot = findFreeSpotNear(BOSS_SPAWN.x, BOSS_SPAWN.y, cfg.radius, 120);
          if (spot) {
            x = spot.x;
            y = spot.y;
          }
        }
      } else {
        const spot = spawnPointForEnemy(cfg.radius);
        x = spot.x;
        y = spot.y;
      }
    }

    const diff = getDifficultyConfig();
    const aggression = enemyAggression();
    const inCampaign = game.runMode === 'campaign';
    const rogueMode = inCampaign && game.campaign.rogue;
    const campaignDepth = inCampaign && !rogueMode ? Math.max(0, game.campaign.levelIndex) : 0;
    const rogueDepth = rogueMode ? Math.max(0, game.campaign.levelIndex) : 0;
    const campaignHp = 1 + campaignDepth * 0.38;
    const rogueHpScale = 1 + rogueDepth * 0.22 + rogueDepth * rogueDepth * 0.018;
    const hpScale = (type === 'boss' ? diff.bossHp : diff.enemyHp) * campaignHp * rogueHpScale;
    const bossHp = Math.max(1, Math.round((type === 'boss' ? bossHpForWave(game.wave) : cfg.hp(game.wave)) * hpScale));
    const rogueDamageScale = rogueMode ? 1 + rogueDepth * 0.13 + rogueDepth * rogueDepth * 0.01 : 1;
    const rogueSpeedScale = rogueMode ? 1 + Math.min(0.55, rogueDepth * 0.028 + rogueDepth * rogueDepth * 0.0007) : 1;
    const distanceToPlayer = dist(x, y, p.x, p.y);
    const e = {
      type,
      radius: cfg.radius,
      r: cfg.radius,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: bossHp,
      maxHp: bossHp,
      speed: cfg.speed(game.wave) * diff.enemySpeed * (1 + campaignDepth * 0.035) * rogueSpeedScale,
      aimAngle: Math.atan2(p.y - y, p.x - x),
      hasLOS: false,
      attackRange: cfg.attackRange * aggression,
      preferred: [Math.round(cfg.preferred[0] / aggression), Math.round(cfg.preferred[1] / aggression)],
      fireMin: cfg.fireMin,
      fireMax: cfg.fireMax,
      telegraph: cfg.telegraph,
      bulletSpeed: cfg.bulletSpeed,
      damage: cfg.damage(game.wave) * diff.enemyDamage * (1 + campaignDepth * 0.17) * rogueDamageScale,
      xp: cfg.xp,
      credits: cfg.credits,
      atkCd: rand(0.8, 1.7),
      windup: 0,
      windupKind: 'shot',
      burstLeft: 0,
      burstTimer: 0,
      summonCd: type === 'boss' ? 5.4 : 0,
      summonWindup: 0,
      summonCount: 0,
      spawnTimer: type === 'boss' ? 1.25 : options.summoned ? 0.9 : 0.6,
      spawnMax: type === 'boss' ? 1.25 : options.summoned ? 0.9 : 0.6,
      hitFlash: 0,
      stunTimer: 0,
      muzzleFlash: 0,
      muzzleAngle: 0,
      muzzleX: 0,
      muzzleY: 0,
      strafeDir: chance(0.5) ? 1 : -1,
      strafeTimer: rand(1.2, 2.6),
      dead: false,
      deathAge: 0,
      phase2: false,
      summoned: !!options.summoned,
      lastX: x,
      lastY: y,
      stuckClock: 0,
      detour: 0,
      lastDistance: distanceToPlayer,
      enemySystem: options.system || null,
      attackBuff: false,
      electricCd: rand(2.2, 3.5),
      zapTimer: 0,
      healCd: rand(3.2, 4.8),
      healBeam: null,
      gunnerMode: 'mg',
      gunnerWindup: 0,
      gunnerEnraged: false,
      bomber: false,
      exploded: false,
      pulse: rand(0, TAU),
      poisoned: 0,
    };
    if (type === 'mutant') {
      e.bomber = true;
      e.exploded = false;
    }
    if (type === 'boss' && game.runMode !== 'campaign') {
      const system = ENEMY_SYSTEMS[game.endlessBiome] || ENEMY_SYSTEMS.lab;
      e.bossKind = options.bossKind || system.bossKind;
      e.endlessBoss = true;
      const bossFaction = CAMPAIGN_BOSS_DEFS[e.bossKind]?.faction || system.faction;
      e.faction = bossFaction;
      e.enemySystem = bossFaction === 'military' ? 'military' : bossFaction === 'robot' ? 'robot' : 'lab';
      prepareBossSkillState(e, e.bossKind);
    }
    e.muzzleX = e.x + Math.cos(e.aimAngle) * (e.radius + 6);
    e.muzzleY = e.y + Math.sin(e.aimAngle) * (e.radius + 6);
    game.enemies.push(e);

    spawnPortalBurst(e, type);
    if (type === 'boss') {
      game.bossRef = e;
      game.shake = Math.max(game.shake, 10);
      Sfx.bossSpawn();
    } else if (options.summoned) {
      addText(x, y - 28, '援军抵达', '255, 205, 133', 1.4, 10, -24);
    }
    return e;
  }

  function spawnCampaignBoss(kind, x, y) {
    const def = CAMPAIGN_BOSS_DEFS[kind];
    const level = game.campaign.level;
    if (!def || !level) return null;
    const boss = spawnEnemy('boss', { x, y });
    if (!boss) return null;
    const diff = getDifficultyConfig();
    const rogueDepth = game.campaign.rogue ? Math.max(0, level.index) : 0;
    const bossDepthHp = game.campaign.rogue
      ? 1 + rogueDepth * 0.24 + rogueDepth * rogueDepth * 0.02
      : 1 + level.index * 0.16;
    const bossDepthDamage = game.campaign.rogue
      ? 1 + rogueDepth * 0.16 + rogueDepth * rogueDepth * 0.013
      : 1 + level.index * 0.16;
    boss.campaignBoss = true;
    boss.bossKind = kind;
    boss.faction = def.faction;
    boss.maxHp = Math.round(def.hp * diff.bossHp * bossDepthHp);
    boss.hp = boss.maxHp;
    boss.radius = def.radius;
    boss.r = def.radius;
    boss.speed = def.speed * diff.enemySpeed * (0.96 + level.index * 0.025) * (game.campaign.rogue ? 1 + Math.min(0.35, rogueDepth * 0.025) : 1);
    boss.damage = def.damage * diff.enemyDamage * bossDepthDamage;
    boss.aware = true;
    boss.spawnTimer = 0;
    boss.spawnMax = 0;
    boss.hasLOS = false;
    boss.phase2 = false;
    boss.phase2Announced = false;
    boss.actionCd = rand(1.1, 2.1) / Math.max(0.1, diff.attackSpeed || 1);
    boss.attackMode = kind === 'director' ? 'smg' : kind === 'sergeant' ? 'shotgun' : 'gatling';
    boss.burstLeft = 0;
    boss.burstTimer = 0;
    boss.burstInterval = 0.1;
    boss.burstDamage = 9;
    boss.burstSpeed = 1;
    boss.burstSpread = 0.05;
    boss.burstColor = '255, 122, 83';
    boss.burstSize = 4;
    boss.summonCd = (kind === 'robot' ? 4.8 : 6.2) / Math.max(0.1, diff.attackSpeed || 1);
    boss.turretCd = 3.2 / Math.max(0.1, diff.attackSpeed || 1);
    boss.chargeCd = 4.6 / Math.max(0.1, diff.attackSpeed || 1);
    boss.pendingRockets = 0;
    boss.pendingRocketTimer = 0;
    boss.chargeWindup = 0;
    boss.chargeTime = 0;
    boss.chargeDirX = 0;
    boss.chargeDirY = 0;
    boss.chargeHit = false;
    boss.strafeDir = chance(0.5) ? 1 : -1;
    boss.strafeTimer = rand(1.2, 2.4);
    boss.actionCd = Math.min(boss.actionCd, 1.6);
    game.bossRef = boss;
    clampEntityToCampaignArena(boss);
    game.shake = Math.max(game.shake, 12);
    updateHUD();
    return boss;
  }

  function campaignBossMuzzle(boss, angle) {
    boss.muzzleX = boss.x + Math.cos(angle) * (boss.radius + 13);
    boss.muzzleY = boss.y + Math.sin(angle) * (boss.radius + 13);
    boss.muzzleFlash = 0.1;
    return { x: boss.muzzleX, y: boss.muzzleY };
  }

  function fireCampaignBossBurst(boss, dt) {
    if (boss.burstLeft <= 0) return;
    boss.burstTimer -= dt;
    if (boss.burstTimer > 0) return;
    const p = game.player;
    if (!p) return;
    boss.burstTimer = boss.burstInterval;
    const angle = Math.atan2(p.y - boss.y, p.x - boss.x) + rand(-boss.burstSpread, boss.burstSpread);
    const muzzle = campaignBossMuzzle(boss, angle);
    spawnHostileBullet(muzzle.x, muzzle.y, angle, {
      speed: (boss.bulletSpeed || 360) * boss.burstSpeed,
      damage: boss.burstDamage,
      size: boss.burstSize,
      color: boss.burstColor,
      boss: true,
    });
    boss.burstLeft -= 1;
    Sfx.enemyShot('boss');
  }

  function campaignBossShotgun(boss) {
    const p = game.player;
    if (!p) return;
    const base = Math.atan2(p.y - boss.y, p.x - boss.x);
    const muzzle = campaignBossMuzzle(boss, base);
    const count = boss.phase2 ? 9 : 7;
    for (let i = 0; i < count; i += 1) {
      const off = ((i / (count - 1)) - 0.5) * (boss.phase2 ? 0.52 : 0.44);
      spawnHostileBullet(muzzle.x, muzzle.y, base + off + rand(-0.02, 0.02), {
        speed: 430,
        damage: boss.damage * 0.38,
        size: 3.4,
        color: '255, 173, 95',
        boss: true,
      });
    }
    Sfx.enemyShot('boss');
    game.shake = Math.max(game.shake, 2.6);
    addText(boss.x, boss.y - boss.radius - 16, '霰弹压制', '255, 192, 113', 1.0, 11, -20);
  }

  function campaignBossRocket(boss, homing = 0.3) {
    const p = game.player;
    if (!p) return;
    const base = Math.atan2(p.y - boss.y, p.x - boss.x);
    campaignBossMuzzle(boss, base);
    spawnCampaignRocket(boss, base + rand(-0.03, 0.03), {
      speed: 238,
      turnRate: homing,
      damage: boss.damage * 1.15,
      splash: boss.damage * 1.55,
      radius: 94,
      color: '255, 143, 87',
      life: 4,
    });
    Sfx.shot('rocket');
  }

  function summonCampaignBombers(boss) {
    const alive = game.enemies.filter((e) => e.bomber && !e.dead).length;
    if (alive >= 5) return;
    const count = boss.phase2 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + rand(0.1, 0.5);
      const found = findFreeSpotNear(boss.x + Math.cos(angle) * 88, boss.y + Math.sin(angle) * 88, 16, 60);
      if (!found) continue;
      const spot = game.campaign.arenaLocked ? clampPointToCampaignArena(found.x, found.y, 20) : found;
      if (!isPointFree(spot.x, spot.y, 17)) continue;
      spawnCampaignBomber(spot.x, spot.y);
    }
    addText(boss.x, boss.y - boss.radius - 18, '释放自爆体', '169, 255, 142', 1.4, 12, -20);
    Sfx.summon();
  }

  function summonCampaignSoldiers(boss) {
    const alive = game.enemies.filter((e) => !e.dead && e.campaignBossMinion && !e.bomber).length;
    if (alive >= 6) return;
    const count = boss.phase2 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + rand(0.2, 0.6);
      const found = findFreeSpotNear(boss.x + Math.cos(angle) * 100, boss.y + Math.sin(angle) * 100, 18, 64);
      if (!found) continue;
      const spot = game.campaign.arenaLocked ? clampPointToCampaignArena(found.x, found.y, 22) : found;
      if (!isPointFree(spot.x, spot.y, 19)) continue;
      const soldier = spawnEnemy('normal', { x: spot.x, y: spot.y, summoned: true });
      if (!soldier) continue;
      soldier.campaignEnemy = true;
      soldier.campaignBossMinion = true;
      soldier.aware = true;
      soldier.faction = 'military';
      soldier.visionRange = 340;
      soldier.spawnTimer = 0.55;
      soldier.spawnMax = 0.55;
      soldier.atkCd = rand(0.3, 0.8);
    }
    addText(boss.x, boss.y - boss.radius - 18, '召唤安保士兵', '255, 193, 107', 1.4, 12, -20);
    Sfx.summon();
  }

  function spawnCampaignBomber(x, y) {
    const bomber = spawnEnemy('mutant', { x, y, summoned: true });
    if (!bomber) return null;
    bomber.bomber = true;
    bomber.campaignEnemy = true;
    bomber.campaignBossMinion = true;
    bomber.aware = true;
    bomber.faction = 'lab';
    bomber.radius = 14;
    bomber.r = 14;
    bomber.maxHp = Math.round(42 * (1 + game.campaign.levelIndex * 0.32));
    bomber.hp = bomber.maxHp;
    bomber.speed = 142 + game.campaign.levelIndex * 8;
    bomber.damage = 17 + game.campaign.levelIndex * 5;
    bomber.attackRange = 0;
    bomber.spawnTimer = 0.48;
    bomber.spawnMax = 0.48;
    bomber.exploded = false;
    bomber.pulse = rand(0, TAU);
    return bomber;
  }

  function detonateBomber(bomber) {
    if (!bomber || bomber.exploded) return;
    bomber.exploded = true;
    const p = game.player;
    if (p && p.alive) {
      const d = dist(bomber.x, bomber.y, p.x, p.y);
      if (d <= 86 + p.r) {
        hurtPlayer(bomber.damage, Math.atan2(p.y - bomber.y, p.x - bomber.x));
      }
    }
    for (const turret of game.turrets) {
      if (turret.dead || turret.hp <= 0) continue;
      if (dist(bomber.x, bomber.y, turret.x, turret.y) <= 86 + turret.r) {
        damagePlayerTurret(turret, bomber.damage, Math.atan2(turret.y - bomber.y, turret.x - bomber.x));
      }
    }
    game.shake = Math.max(game.shake, 5);
    game.portals.push({ x: bomber.x, y: bomber.y, life: 0.5, maxLife: 0.5, color: '156, 255, 128', radius: 86 });
    for (let i = 0; i < 26; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 4 === 0 ? 'smoke' : 'spark',
        x: bomber.x,
        y: bomber.y,
        vx: Math.cos(a) * rand(40, 190),
        vy: Math.sin(a) * rand(40, 190),
        life: rand(0.3, 0.9),
        size: rand(2, 10),
        color: i % 4 === 0 ? '71, 106, 59' : '151, 255, 112',
        drag: 2.2,
        gravity: 30,
        alpha: 0.8,
      });
    }
    Sfx.explosion();
  }

  function updateCampaignBomber(enemy, dt) {
    const p = enemy.tauntTarget || game.player;
    if (!p) return;
    enemy.hasLOS = hasLineOfSight(enemy.x, enemy.y, p.x, p.y);
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 0.001;
    enemy.aimAngle = Math.atan2(dy, dx);
    enemy.hasLOS = hasLineOfSight(enemy.x, enemy.y, p.x, p.y);
    enemy.pulse += dt * 9;
    if (d < 38) {
      killEnemy(enemy);
      return;
    }
    let baseX = dx / d;
    let baseY = dy / d;
    if (!enemy.hasLOS) {
      const nav = getNavDirection(enemy, p.x, p.y);
      if (nav && (nav.x || nav.y)) {
        const len = Math.hypot(nav.x, nav.y) || 1;
        baseX = nav.x / len;
        baseY = nav.y / len;
      }
    }
    ({ x: baseX, y: baseY } = obstacleAvoidance(enemy, baseX, baseY));
    const len = Math.hypot(baseX, baseY) || 1;
    enemy.vx = (baseX / len) * enemy.speed;
    enemy.vy = (baseY / len) * enemy.speed;
    moveCircle(enemy, enemy.vx * dt, enemy.vy * dt);
    nudgeToFreePosition(enemy);
    enemy.muzzleX = enemy.x + Math.cos(enemy.aimAngle) * (enemy.radius + 7);
    enemy.muzzleY = enemy.y + Math.sin(enemy.aimAngle) * (enemy.radius + 7);
  }

  function updateCampaignBoss(enemy, dt) {
    const p = game.player;
    if (!p) return;
    const def = CAMPAIGN_BOSS_DEFS[enemy.bossKind];
    if (!def) return;
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const dirx = dx / d;
    const diry = dy / d;
    enemy.aimAngle = Math.atan2(dy, dx);
    enemy.hasLOS = hasLineOfSight(enemy.x, enemy.y, p.x, p.y);
    const onScreen = isOnScreen(enemy.x, enemy.y, 30);

    if (!enemy.phase2 && enemy.hp / enemy.maxHp <= 0.5) {
      enemy.phase2 = true;
      enemy.speed *= 1.12;
      enemy.actionCd = Math.min(enemy.actionCd, 0.4);
      enemy.summonCd = Math.min(enemy.summonCd, 2.2);
      enemy.chargeCd = Math.min(enemy.chargeCd, 2.0);
      game.shake = Math.max(game.shake, 9);
      showBanner('PHASE II // 指挥协议升级', def.name, def.desc, true, 3000);
      addToast('!', `${def.name} 进入阶段 II`, '攻击频率与移动速度提升', 'danger', 3600);
      Sfx.summon();
    }

    enemy.actionCd -= dt;
    enemy.summonCd -= dt;
    enemy.turretCd -= dt;
    enemy.chargeCd -= dt;
    enemy.strafeTimer -= dt;
    if (enemy.pendingRockets > 0) {
      enemy.pendingRocketTimer -= dt;
      if (enemy.pendingRocketTimer <= 0) {
        enemy.pendingRockets -= 1;
        enemy.pendingRocketTimer = 0.16;
        campaignBossRocket(enemy, 1.55);
      }
    }
    if (enemy.strafeTimer <= 0) {
      enemy.strafeTimer = rand(1.1, 2.4);
      if (chance(0.7)) enemy.strafeDir *= -1;
    }
    fireCampaignBossBurst(enemy, dt);

    let moving = true;
    if (enemy.bossKind === 'robot') {
      if (enemy.chargeWindup > 0) {
        enemy.chargeWindup -= dt;
        moving = false;
        if (enemy.chargeWindup <= 0) {
          enemy.chargeTime = 0.42;
          enemy.chargeDirX = dirx;
          enemy.chargeDirY = diry;
          enemy.chargeHit = false;
          addText(enemy.x, enemy.y - enemy.radius - 18, '冲撞！', '255, 101, 83', 0.9, 13, -26);
        }
      } else if (enemy.chargeTime > 0) {
        moving = false;
        enemy.chargeTime -= dt;
        moveCircle(enemy, enemy.chargeDirX * 710 * dt, enemy.chargeDirY * 710 * dt);
        nudgeToFreePosition(enemy);
        if (!enemy.chargeHit && dist(enemy.x, enemy.y, p.x, p.y) < enemy.radius + p.r + 15) {
          enemy.chargeHit = true;
          hurtPlayer(30 + game.campaign.levelIndex * 7, Math.atan2(dy, dx));
          game.shake = Math.max(game.shake, 8);
        }
        for (let i = 0; i < 2; i += 1) {
          addParticle({
            type: 'spark',
            x: enemy.x + rand(-10, 10),
            y: enemy.y + rand(-10, 10),
            vx: rand(-70, 70),
            vy: rand(-70, 70),
            life: 0.2,
            size: rand(1, 2.3),
            color: '255, 142, 100',
            drag: 3,
            alpha: 0.6,
          });
        }
        if (enemy.chargeTime <= 0) {
          enemy.chargeCd = enemy.phase2 ? 3.1 : 4.8;
          enemy.actionCd = Math.max(enemy.actionCd, 0.7);
        }
      }
    }

    if (moving) {
      const preferred = enemy.bossKind === 'director' ? 320 : enemy.bossKind === 'sergeant' ? 260 : 210;
      let forward = d > preferred + 60 ? 1 : d < preferred - 55 ? -0.7 : 0;
      let strafe = enemy.hasLOS ? enemy.strafeDir * 0.48 : 0;
      let baseX = dirx;
      let baseY = diry;
      if (!enemy.hasLOS) {
        const nav = getNavDirection(enemy, p.x, p.y);
        if (nav && (nav.x || nav.y)) {
          const len = Math.hypot(nav.x, nav.y) || 1;
          baseX = nav.x / len;
          baseY = nav.y / len;
        }
      }
      let mx = baseX * forward - baseY * strafe;
      let my = baseY * forward + baseX * strafe;
      if (!enemy.hasLOS) {
        const len = Math.hypot(baseX, baseY) || 1;
        mx = baseX / len;
        my = baseY / len;
      }
      ({ x: mx, y: my } = obstacleAvoidance(enemy, mx, my));
      const ml = Math.hypot(mx, my);
      if (ml > 0.02) {
        enemy.vx = (mx / ml) * enemy.speed;
        enemy.vy = (my / ml) * enemy.speed;
        moveCircle(enemy, enemy.vx * dt, enemy.vy * dt);
      } else {
        enemy.vx = 0;
        enemy.vy = 0;
      }
      nudgeToFreePosition(enemy);
      if (dist(enemy.x, enemy.y, p.x, p.y) < enemy.radius + p.r + 8) {
        const pushAngle = Math.atan2(enemy.y - p.y, enemy.x - p.x);
        enemy.x = p.x + Math.cos(pushAngle) * (enemy.radius + p.r + 8);
        enemy.y = p.y + Math.sin(pushAngle) * (enemy.radius + p.r + 8);
        resolveObstacles(enemy);
      }
    }

    enemy.muzzleX = enemy.x + Math.cos(enemy.aimAngle) * (enemy.radius + 12);
    enemy.muzzleY = enemy.y + Math.sin(enemy.aimAngle) * (enemy.radius + 12);

    if (!onScreen && !enemy.hasLOS) return;

    // Summons and robot deployment run independently of the weapon cycle.
    if (enemy.bossKind === 'director' && enemy.summonCd <= 0) {
      enemy.summonCd = enemy.phase2 ? 8.2 : 11.2;
      summonCampaignBombers(enemy);
    }
    if (enemy.bossKind === 'sergeant' && enemy.summonCd <= 0) {
      enemy.summonCd = enemy.phase2 ? 7.5 : 10.2;
      summonCampaignSoldiers(enemy);
    }
    if (enemy.bossKind === 'robot' && enemy.turretCd <= 0) {
      enemy.turretCd = enemy.phase2 ? 8.2 : 11.5;
      deployBossTurret(enemy);
    }

    if (enemy.bossKind === 'robot' && enemy.chargeCd <= 0 && enemy.burstLeft <= 0 && d > 145 && d < 450 && enemy.hasLOS && onScreen) {
      enemy.chargeWindup = 0.58;
      enemy.chargeCd = 999;
      enemy.actionCd = Math.max(enemy.actionCd, 0.8);
      addText(enemy.x, enemy.y - enemy.radius - 20, '蓄力冲撞', '255, 132, 101', 1.0, 12, -22);
      Sfx.summon();
    }

    if (enemy.burstLeft > 0 || enemy.chargeWindup > 0 || enemy.chargeTime > 0) return;
    if (enemy.actionCd > 0 || !enemy.hasLOS || !onScreen || d > 520) return;

    if (enemy.bossKind === 'director') {
      if (enemy.attackMode === 'poison') {
        const tx = p.x + p.vx * 0.35;
        const ty = p.y + p.vy * 0.35;
        throwCampaignPoisonBottle(enemy, tx, ty);
        addText(enemy.x, enemy.y - enemy.radius - 17, '投掷毒瓶', '143, 255, 141', 1.1, 12, -22);
        enemy.attackMode = 'smg';
        enemy.actionCd = enemy.phase2 ? 1.9 : 2.5;
      } else {
        enemy.burstLeft = enemy.phase2 ? 7 : 5;
        enemy.burstTimer = 0;
        enemy.burstInterval = 0.09;
        enemy.burstDamage = enemy.damage * 0.7;
        enemy.burstSpeed = 1.15;
        enemy.burstSpread = 0.055;
        enemy.burstColor = '140, 255, 156';
        enemy.burstSize = 3.5;
        addText(enemy.x, enemy.y - enemy.radius - 17, '冲锋枪压制', '156, 255, 166', 1.0, 11, -20);
        enemy.attackMode = 'poison';
        enemy.actionCd = enemy.phase2 ? 1.25 : 1.7;
      }
      Sfx.enemyShot('boss');
    } else if (enemy.bossKind === 'sergeant') {
      if (enemy.attackMode === 'rocket') {
        campaignBossRocket(enemy, 0.55);
        enemy.attackMode = 'shotgun';
        enemy.actionCd = enemy.phase2 ? 2.3 : 3.2;
      } else {
        campaignBossShotgun(enemy);
        enemy.attackMode = 'rocket';
        enemy.actionCd = enemy.phase2 ? 1.25 : 1.8;
      }
    } else if (enemy.bossKind === 'robot') {
      if (enemy.attackMode === 'gatling') {
        enemy.burstLeft = enemy.phase2 ? 22 : 16;
        enemy.burstTimer = 0;
        enemy.burstInterval = 0.055;
        enemy.burstDamage = enemy.damage * 0.32;
        enemy.burstSpeed = 1.25;
        enemy.burstSpread = 0.1;
        enemy.burstColor = '255, 108, 88';
        enemy.burstSize = 3;
        enemy.attackMode = 'rocket';
        enemy.actionCd = enemy.phase2 ? 2.0 : 2.8;
        addText(enemy.x, enemy.y - enemy.radius - 17, '加特林扫射', '255, 130, 104', 1.0, 11, -20);
      } else {
        campaignBossRocket(enemy, 1.55);
        enemy.pendingRockets = 1;
        enemy.pendingRocketTimer = 0.16;
        enemy.attackMode = 'gatling';
        enemy.actionCd = enemy.phase2 ? 2.6 : 3.5;
      }
    }
  }


  function summonBossAdds(boss) {
    if (!boss || boss.dead) return;
    const mobs = game.enemies.filter((e) => !e.dead && e.type !== 'boss').length;
    if (mobs >= 7) {
      boss.summonCd = 3.2;
      return;
    }
    const count = boss.phase2 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + rand(0.1, 0.5);
      const spot = findFreeSpotNear(boss.x + Math.cos(angle) * 82, boss.y + Math.sin(angle) * 82, 16, 52);
      if (!spot) continue;
      const summonSystem = ENEMY_SYSTEMS[game.endlessBiome] || ENEMY_SYSTEMS.lab;
      const summonType = game.runMode === 'campaign' ? 'normal' : pickWeightedEnemy(summonSystem.pool);
      const minion = spawnEnemy(summonType, { x: spot.x, y: spot.y, summoned: true });
      if (minion) {
        minion.spawnTimer = 0.82;
        minion.spawnMax = 0.82;
        minion.enemySystem = summonSystem.id;
        minion.faction = summonSystem.faction;
      }
    }
    boss.summonCount += count;
    game.shake = Math.max(game.shake, 4.5);
    Sfx.summon();
    addText(boss.x, boss.y - boss.radius - 20, '召唤援军', '255, 137, 109', 1.6, 12, -20);
  }

  function advanceWaveEarly() {
    if (!game.intermission) return;
    beginWave(game.wave + 1);
  }

  function storyArtSVG(kind) {
    if (kind === 'corridor') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="scor" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#08181d"/><stop offset=".55" stop-color="#0d2529"/><stop offset="1" stop-color="#020709"/></linearGradient>
        <radialGradient id="slight"><stop stop-color="rgba(255,83,67,.32)"/><stop offset="1" stop-color="rgba(255,83,67,0)"/></radialGradient></defs>
        <rect width="1440" height="900" fill="url(#scor)"/>
        <g stroke="rgba(108,206,210,.16)" fill="none"><path d="M0 720 L610 495 L830 495 L1440 720"/><path d="M0 900 L570 540 L870 540 L1440 900"/><path d="M395 0 L620 460 M1045 0 L820 460"/><path d="M610 495 L570 540 M830 495 L870 540"/></g>
        <rect x="610" y="495" width="220" height="45" fill="#071013" stroke="rgba(143,231,225,.25)"/>
        <g fill="#0b171a" stroke="rgba(255,107,84,.3)"><rect x="491" y="250" width="42" height="350"/><rect x="907" y="250" width="42" height="350"/></g>
        <circle cx="300" cy="430" r="110" fill="url(#slight)"/><circle cx="1140" cy="340" r="130" fill="url(#slight)"/>
        <path d="M0 780 L650 560 L790 560 L1440 780" stroke="rgba(146,235,227,.12)" fill="none"/>
        <g fill="rgba(209,255,247,.18)"><circle cx="330" cy="300" r="2"/><circle cx="1120" cy="264" r="2"/><circle cx="760" cy="410" r="1.5"/></g>
      </svg>`;
    }
    if (kind === 'lab') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><defs>
        <linearGradient id="slab" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#071514"/><stop offset="1" stop-color="#020708"/></linearGradient>
        <radialGradient id="sgreen"><stop stop-color="rgba(106,255,167,.35)"/><stop offset="1" stop-color="rgba(106,255,167,0)"/></radialGradient></defs>
        <rect width="1440" height="900" fill="url(#slab)"/>
        <circle cx="460" cy="380" r="190" fill="url(#sgreen)"/><circle cx="1030" cy="430" r="160" fill="url(#sgreen)"/>
        <g stroke="rgba(124,238,191,.22)" fill="none"><rect x="345" y="230" width="230" height="430" rx="52"/><rect x="920" y="270" width="220" height="390" rx="52"/><path d="M380 480 L540 480 M955 470 L1105 470"/></g>
        <g fill="rgba(121,255,180,.13)"><rect x="370" y="260" width="180" height="350" rx="40"/><rect x="945" y="300" width="170" height="310" rx="40"/></g>
        <g stroke="rgba(176,255,212,.32)" fill="none"><path d="M0 730 L1440 670 M0 810 L1440 760"/><path d="M600 0 L600 520 M860 0 L860 520"/></g>
        <g fill="rgba(185,255,220,.12)"><circle cx="220" cy="620" r="2"/><circle cx="1260" cy="560" r="2"/></g>
      </svg>`;
    }
    if (kind === 'security') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><defs>
        <linearGradient id="ssec" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#15140c"/><stop offset=".6" stop-color="#0b1111"/><stop offset="1" stop-color="#020607"/></linearGradient>
        <radialGradient id="syellow"><stop stop-color="rgba(255,200,88,.32)"/><stop offset="1" stop-color="rgba(255,200,88,0)"/></radialGradient></defs>
        <rect width="1440" height="900" fill="url(#ssec)"/>
        <circle cx="720" cy="390" r="260" fill="url(#syellow)"/>
        <g stroke="rgba(255,203,107,.28)" fill="none"><path d="M430 0 L430 650 M1010 0 L1010 650 M430 650 L1010 650"/><path d="M530 190 L910 190 M530 260 L910 260"/></g>
        <g fill="#0a1111" stroke="rgba(255,205,112,.3)"><rect x="285" y="540" width="200" height="130"/><rect x="955" y="540" width="200" height="130"/><rect x="570" y="520" width="300" height="150"/></g>
        <g stroke="rgba(255,211,128,.5)" stroke-width="3"><path d="M0 670 L1440 670"/><path d="M0 690 L1440 690" opacity=".4"/></g>
        <g fill="rgba(255,218,144,.15)"><circle cx="230" cy="240" r="2"/><circle cx="1200" cy="310" r="2"/><circle cx="720" cy="160" r="1.5"/></g>
      </svg>`;
    }
    if (kind === 'core') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><defs>
        <linearGradient id="score" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#06121b"/><stop offset=".6" stop-color="#071018"/><stop offset="1" stop-color="#010407"/></linearGradient>
        <radialGradient id="sblue"><stop stop-color="rgba(101,220,255,.52)"/><stop offset=".45" stop-color="rgba(49,139,196,.2)"/><stop offset="1" stop-color="rgba(22,70,118,0)"/></radialGradient></defs>
        <rect width="1440" height="900" fill="url(#score)"/>
        <circle cx="720" cy="390" r="330" fill="url(#sblue)"/>
        <g fill="none" stroke="rgba(137,230,255,.32)"><circle cx="720" cy="390" r="250"/><circle cx="720" cy="390" r="185"/><circle cx="720" cy="390" r="115"/><path d="M720 80 L720 240 M720 540 L720 700 M410 390 L570 390 M870 390 L1030 390"/></g>
        <g fill="none" stroke="rgba(165,246,255,.6)"><circle cx="720" cy="390" r="42"/><path d="M720 330 L755 370 L740 425 L700 440 L685 398Z"/></g>
        <g fill="rgba(152,237,255,.12)" stroke="rgba(122,222,255,.2)"><rect x="60" y="230" width="170" height="410"/><rect x="1210" y="230" width="170" height="410"/></g>
        <g stroke="rgba(126,225,255,.14)" fill="none"><path d="M0 750 L1440 690"/><path d="M230 900 L590 500 M1210 900 L850 500"/></g>
      </svg>`;
    }
    if (kind === 'dawn') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><defs>
        <linearGradient id="sdawn" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#0c2430"/><stop offset=".48" stop-color="#51462f"/><stop offset=".72" stop-color="#d08650"/><stop offset="1" stop-color="#162126"/></linearGradient></defs>
        <rect width="1440" height="900" fill="url(#sdawn)"/>
        <circle cx="960" cy="520" r="120" fill="rgba(255,220,153,.42)"/>
        <g fill="#0b1215"><path d="M0 640 L120 600 L240 650 L360 570 L510 640 L650 580 L790 650 L980 560 L1130 630 L1290 580 L1440 640 L1440 900 L0 900Z"/></g>
        <g fill="#050b0d"><path d="M0 760 L160 710 L320 770 L480 700 L620 760 L800 690 L1000 750 L1200 700 L1440 760 L1440 900 L0 900Z"/></g>
        <g fill="rgba(255,207,143,.22)"><rect x="260" y="690" width="6" height="4"/><rect x="430" y="660" width="5" height="3"/><rect x="710" y="700" width="7" height="4"/><rect x="920" y="660" width="5" height="3"/><rect x="1180" y="690" width="6" height="4"/></g>
        <path d="M670 900 L850 900 L790 640 L730 640Z" fill="rgba(13,22,24,.9)"/>
      </svg>`;
    }
    if (kind === 'failure') {
      return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><rect width="1440" height="900" fill="#090405"/>
        <g stroke="rgba(255,80,65,.18)" fill="none"><path d="M0 720 L1440 660 M0 810 L1440 760"/><path d="M0 360 L1440 300"/></g>
        <g stroke="rgba(255,91,67,.12)"><path d="M0 80 L1440 80 M0 160 L1440 160 M0 240 L1440 240 M260 0 L260 900 M520 0 L520 900 M780 0 L780 900 M1040 0 L1040 900"/></g>
        <circle cx="720" cy="390" r="260" fill="rgba(255,53,40,.06)"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice"><defs>
      <linearGradient id="scell" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#071b24"/><stop offset=".55" stop-color="#0a171c"/><stop offset="1" stop-color="#020608"/></linearGradient>
      <radialGradient id="spod"><stop stop-color="rgba(91,222,255,.4)"/><stop offset="1" stop-color="rgba(91,222,255,0)"/></radialGradient></defs>
      <rect width="1440" height="900" fill="url(#scell)"/>
      <circle cx="740" cy="410" r="280" fill="url(#spod)"/>
      <g fill="#081013" stroke="rgba(118,225,240,.28)"><rect x="560" y="160" width="360" height="560" rx="90"/><rect x="595" y="205" width="290" height="470" rx="65"/></g>
      <g fill="rgba(108,239,255,.09)" stroke="rgba(155,246,255,.16)"><rect x="615" y="230" width="250" height="410" rx="54"/></g>
      <g stroke="rgba(119,228,240,.2)" fill="none"><path d="M0 720 L560 470 L880 470 L1440 720"/><path d="M0 900 L520 540 L920 540 L1440 900"/><path d="M560 720 L560 900 M880 720 L880 900"/></g>
      <g fill="rgba(173,244,255,.2)"><circle cx="300" cy="300" r="2"/><circle cx="1150" cy="260" r="2"/><circle cx="1180" cy="540" r="1.5"/></g>
    </svg>`;
  }

  function storyPortraitSVG(kind) {
    if (kind === 'alan') return characterPortraitSVG('alan');
    if (kind === 'lin') {
      return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="slin" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7ee6c0"/><stop offset="1" stop-color="#2a725e"/></linearGradient></defs>
        <ellipse cx="110" cy="304" rx="70" ry="12" fill="rgba(0,0,0,.35)"/>
        <path d="M42 310 Q48 220 78 198 L142 198 Q172 220 178 310Z" fill="#17352f" stroke="rgba(132,255,213,.45)" stroke-width="1.5"/>
        <path d="M90 196 L90 170 L130 170 L130 196" fill="#0a1c19"/>
        <path d="M72 154 Q72 98 110 80 Q152 96 150 154 L145 190 Q126 208 111 208 Q90 205 76 190Z" fill="#b78b72"/>
        <path d="M70 128 Q74 78 111 68 Q153 80 151 132 Q132 112 111 112 Q90 112 70 128Z" fill="#27302f"/>
        <path d="M78 155 Q88 148 99 154 M121 154 Q132 148 142 154" fill="none" stroke="#1d2b2b" stroke-width="4" stroke-linecap="round"/>
        <circle cx="90" cy="160" r="2.2" fill="#17201e"/><circle cx="131" cy="160" r="2.2" fill="#17201e"/>
        <path d="M96 180 Q111 187 126 180" fill="none" stroke="#6d3f36" stroke-width="2" stroke-linecap="round"/>
        <g stroke="rgba(139,255,224,.6)" fill="none"><rect x="76" y="150" width="25" height="16" rx="6"/><rect x="121" y="150" width="25" height="16" rx="6"/><path d="M101 158 L121 158"/></g>
        <path d="M60 230 L88 214 M160 230 L132 214" stroke="rgba(124,237,207,.35)" stroke-width="2"/>
        <path d="M64 246 L156 246" stroke="rgba(124,237,207,.2)"/>
      </svg>`;
    }
    if (kind === 'ron') {
      return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="110" cy="304" rx="76" ry="12" fill="rgba(0,0,0,.35)"/>
        <path d="M32 310 Q38 210 70 190 L150 190 Q182 212 188 310Z" fill="#2b2c2a" stroke="rgba(255,202,118,.35)" stroke-width="1.5"/>
        <path d="M65 226 L88 210 L132 210 L155 226" fill="none" stroke="rgba(255,207,124,.3)" stroke-width="2"/>
        <path d="M66 166 Q64 92 110 74 Q158 92 154 166 L148 206 Q130 218 110 218 Q88 216 72 204Z" fill="#303432" stroke="rgba(255,206,130,.38)" stroke-width="1.5"/>
        <path d="M72 145 Q88 132 110 134 Q134 132 148 145 L146 162 Q130 174 110 174 Q88 174 74 162Z" fill="#0a1110"/>
        <path d="M82 150 Q102 142 132 148 L136 157 Q118 164 96 162 Q86 159 82 155Z" fill="rgba(255,188,94,.72)"/>
        <path d="M104 144 L100 162 M120 146 L124 160" stroke="#1a211d" stroke-width="1.2"/>
        <path d="M78 210 Q110 224 142 210" fill="none" stroke="rgba(255,203,123,.25)" stroke-width="2"/>
        <path d="M56 246 L164 246 M62 258 L158 258" stroke="rgba(255,203,123,.18)"/>
        <circle cx="164" cy="238" r="5" fill="none" stroke="rgba(255,199,115,.6)"/>
      </svg>`;
    }
    if (kind === 'x7') {
      return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="110" cy="304" rx="74" ry="12" fill="rgba(0,0,0,.38)"/>
        <path d="M42 310 Q50 214 78 190 L142 190 Q172 216 178 310Z" fill="#1f2b2f" stroke="rgba(255,125,97,.4)" stroke-width="1.5"/>
        <rect x="76" y="70" width="68" height="130" rx="26" fill="#26373b" stroke="rgba(255,138,100,.45)" stroke-width="1.8"/>
        <circle cx="110" cy="130" r="28" fill="#081114" stroke="rgba(255,132,98,.6)" stroke-width="2"/>
        <circle cx="110" cy="130" r="12" fill="rgba(255,105,78,.8)"/>
        <circle cx="110" cy="130" r="4" fill="#ffe1b5"/>
        <g stroke="rgba(255,141,102,.45)" fill="none"><path d="M76 106 L50 92 M144 106 L170 92 M76 154 L52 170 M144 154 L168 170"/></g>
        <path d="M86 224 L78 300 M134 224 L142 300" stroke="#2e4347" stroke-width="9"/>
        <path d="M70 246 L150 246" stroke="rgba(255,132,93,.3)" stroke-width="2"/>
        <path d="M92 84 L110 98 L128 84" fill="none" stroke="rgba(255,191,133,.4)" stroke-width="2"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg" class="story-sigil">
      <circle cx="110" cy="150" r="82" fill="rgba(85,216,255,.04)" stroke="rgba(117,232,255,.28)" stroke-width="1"/>
      <circle cx="110" cy="150" r="58" fill="none" stroke="rgba(147,242,255,.34)" stroke-width="1.4" stroke-dasharray="3 9"/>
      <path d="M110 84 L150 121 L136 188 L84 200 L66 145Z" fill="rgba(92,224,255,.06)" stroke="rgba(145,243,255,.5)" stroke-width="1.6"/>
      <circle cx="110" cy="150" r="22" fill="rgba(112,233,255,.12)" stroke="rgba(183,252,255,.8)" stroke-width="1.5"/>
      <circle cx="110" cy="150" r="7" fill="#d6feff"/>
      <circle cx="110" cy="150" r="2.4" fill="#082a35"/>
      <path d="M110 40 L110 62 M110 238 L110 260 M0 150 L22 150 M198 150 L220 150" stroke="rgba(150,242,255,.3)" stroke-width="1.2"/>
      <text x="110" y="282" text-anchor="middle" fill="rgba(159,242,255,.55)" font-family="monospace" font-size="9" letter-spacing="3">ZERO</text>
    </svg>`;
  }

  function resolveStoryBeat(beat) {
    if (!beat) return null;
    if (Array.isArray(beat.variants)) {
      const variant = beat.variants.find((item) => game.story?.flags?.[item.ifFlag] === item.ifValue);
      return { ...beat, ...(variant || beat.variants[beat.variants.length - 1] || {}) };
    }
    return beat;
  }

  function clearStoryTyping() {
    if (game.story?.typingTimer) {
      window.clearInterval(game.story.typingTimer);
      game.story.typingTimer = null;
    }
    if (game.story) game.story.typing = false;
  }

  function finishStoryTyping() {
    const story = game.story;
    if (!story) return;
    clearStoryTyping();
    if (dom.storyText) setText(dom.storyText, story.fullText || '');
    story.typing = false;
    const choices = story.pendingChoices || [];
    dom.storyChoices.innerHTML = choices.map((choice, index) => `<button class="story-choice ${choice.isEnding ? 'is-ending' : ''}" type="button" data-story-choice="${index}"><b>${choice.label}</b>${choice.hint ? `<small>${choice.hint}</small>` : ''}</button>`).join('');
    if (dom.storyContinue) dom.storyContinue.style.visibility = choices.length ? 'hidden' : 'visible';
  }

  function typeStoryText(text, choices = []) {
    const story = game.story;
    if (!story) return;
    clearStoryTyping();
    story.pendingChoices = choices;
    story.fullText = String(text || '');
    story.typing = true;
    dom.storyText.textContent = '';
    dom.storyChoices.innerHTML = '';
    dom.storyContinue.style.visibility = 'hidden';
    let shown = 0;
    if (!story.fullText.length) {
      finishStoryTyping();
      return;
    }
    story.typingTimer = window.setInterval(() => {
      shown = Math.min(story.fullText.length, shown + 2);
      dom.storyText.textContent = story.fullText.slice(0, shown);
      if (shown >= story.fullText.length) finishStoryTyping();
    }, 18);
  }

  function renderStoryBeat(index) {
    const story = game.story;
    if (!story || !STORY_SCRIPT[index]) {
      if (story) renderStoryEnding();
      return;
    }
    story.beatIndex = index;
    const beat = resolveStoryBeat(STORY_SCRIPT[index]);
    if (beat.type === 'combat') {
      startStoryCombat(beat);
      return;
    }
    if (beat.type === 'ending') {
      renderStoryEnding();
      return;
    }
    story.failed = false;
    story.ending = false;
    game.mode = 'story';
    game.runMode = 'story';
    document.body.classList.add('story-mode', 'in-game');
    document.body.classList.remove('training-mode', 'campaign-mode');
    dom.menu.classList.add('is-hidden');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.trainingPanel?.classList.add('is-hidden');
    dom.storyOverlay.classList.remove('is-hidden');
    setText(dom.storyChapter, beat.chapter || '剧情模式');
    setText(dom.storyProgress, `${pad2(index + 1)} / ${pad2(STORY_SCRIPT.length)}`);
    setText(dom.storyLocation, beat.location || 'Astra Gene-Labs');
    dom.storyBg.innerHTML = storyArtSVG(beat.bg || 'cell');
    dom.storyPortrait.className = `story-portrait ${beat.portrait || ''}`;
    dom.storyPortrait.innerHTML = storyPortraitSVG(beat.portrait || 'zero');
    setText(dom.storySpeaker, beat.speaker || '阿兰');
    setText(dom.storyRole, beat.role || 'K-07 // DRIFTER');
    typeStoryText(beat.text, (beat.choices || []).filter((choice) => !choice.requiresFlag || story.flags[choice.requiresFlag]));
    Sfx.click();
  }

  function renderStoryEnding() {
    const story = game.story;
    if (!story) return;
    clearStoryTyping();
    const ending = STORY_ENDINGS[story.flags.ending] || STORY_ENDINGS.escape;
    story.ending = true;
    story.failed = false;
    game.mode = 'story';
    document.body.classList.add('story-mode', 'in-game');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.storyOverlay.classList.remove('is-hidden');
    setText(dom.storyChapter, '终章 · 零号协议');
    setText(dom.storyProgress, 'END');
    setText(dom.storyLocation, '地表 · 清晨');
    dom.storyBg.innerHTML = storyArtSVG('dawn');
    dom.storyPortrait.className = 'story-portrait';
    dom.storyPortrait.innerHTML = '';
    setText(dom.storySpeaker, ending.title);
    setText(dom.storyRole, ending.code);
    setText(dom.storyText, ending.text);
    dom.storyChoices.innerHTML = `<button class="story-choice is-ending" type="button" data-story-final="restart"><b>重新开始剧情</b><small>回到序章</small></button><button class="story-choice" type="button" data-story-final="menu"><b>返回主菜单</b><small>结束本次逃逸</small></button>`;
    dom.storyContinue.style.visibility = 'hidden';
    Sfx.upgrade();
  }

  function showStoryFailure() {
    const story = game.story;
    if (!story) return;
    clearStoryTyping();
    story.failed = true;
    story.ending = false;
    game.mode = 'story';
    document.body.classList.add('story-mode', 'in-game');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.storyOverlay.classList.remove('is-hidden');
    setText(dom.storyChapter, 'MISSION FAILED // 生命信号终止');
    setText(dom.storyProgress, 'FAILED');
    setText(dom.storyLocation, story.currentCombat?.location || '未知区域');
    dom.storyBg.innerHTML = storyArtSVG('failure');
    dom.storyPortrait.className = 'story-portrait zero';
    dom.storyPortrait.innerHTML = storyPortraitSVG('zero');
    setText(dom.storySpeaker, '系统');
    setText(dom.storyRole, 'K-07 BIO-SIGNAL LOST');
    setText(dom.storyText, '你的生命信号在零号实验区的深处熄灭了。\n零的声音还在耳麦里，但这一次它没有回答。');
    dom.storyChoices.innerHTML = `<button class="story-choice is-ending" type="button" data-story-final="retry"><b>重试本场战斗</b><small>保留剧情进度</small></button><button class="story-choice" type="button" data-story-final="menu"><b>返回主菜单</b><small>放弃本次剧情</small></button>`;
    dom.storyContinue.style.visibility = 'hidden';
    Sfx.error();
  }

  function advanceStory() {
    const story = game.story;
    if (!story || game.mode !== 'story' || story.failed || story.ending) return;
    if (story.typing) {
      finishStoryTyping();
      return;
    }
    if ((story.pendingChoices || []).length) return;
    renderStoryBeat(story.beatIndex + 1);
  }

  function chooseStoryOption(index) {
    const story = game.story;
    if (!story) return;
    const choice = (story.pendingChoices || [])[index];
    if (!choice) return;
    if (choice.flag) story.flags[choice.flag] = choice.value;
    if (choice.ending) story.flags.ending = choice.ending;
    story.pendingChoices = [];
    dom.storyChoices.innerHTML = '';
    Sfx.click();
    renderStoryBeat(story.beatIndex + 1);
  }

  function applyStoryLoadout(stage = 1) {
    const p = game.player;
    if (!p) return;
    const level = stage === 1 ? 5 : stage === 2 ? 8 : 12;
    const maxHp = Math.round(PLAYER_BASE_HP + (level - 1) * 12);
    p.characterId = 'alan';
    p.character = getCharacterDef('alan');
    p.level = level;
    p.xp = 0;
    p.xpNext = 80 + (level - 1) * 20;
    p.maxHp = maxHp;
    p.hp = maxHp;
    p.credits = 0;
    p.kills = 0;
    p.weapon = stage === 1 ? 'ar' : stage === 2 ? 'ar' : 'lmg';
    p.offhand = stage >= 2 ? 'smg' : null;
    p.talents = {};
    if (stage >= 1) p.talents.fastReload = true;
    if (stage >= 2) {
      p.talents.highPressure = true;
      p.talents.shield = true;
      p.talents.dualWield = true;
    }
    if (stage >= 3) {
      p.talents.respawn = true;
      p.talents.turret = true;
      p.talents.turretBurst = true;
      p.talents.turretGatling = true;
    }
    p.talentPoints = 0;
    p.talentsSpent = 0;
    p.totalTalentPoints = 0;
    for (const id of WEAPON_ORDER) {
      p.owned[id] = true;
      for (const key of MOD_KEYS) {
        p.mods[id][key] = stage === 1 ? 1 : stage === 2 ? 3 : MODS[key].max;
      }
      p.ammo[id] = weaponCapacity(id, p.mods);
    }
    p.campaignUpgrades = { health: 0, speed: 0, reload: 0, damage: 0 };
    p.grenades = {};
    for (const id of GRENADE_ORDER) p.grenades[id] = grenadeMaxStock(id, p);
    p.selectedGrenade = 'frag';
    p.shieldUnlocked = stage >= 2;
    p.maxShield = stage >= 2 ? 70 : 0;
    p.shield = p.maxShield;
    p.shieldBroken = false;
    p.shieldBreakTimer = 0;
    p.reloading = false;
    p.offhandReloading = false;
    p.pendingReload = 0;
    p.offhandPendingReload = 0;
    p.skillCooldown = 0;
    p.turretCooldown = 0;
    p.grenadeCooldown = 0;
    p.invuln = 0;
    p.alive = true;
    p.x = PLAYER_START.x;
    p.y = PLAYER_START.y;
    p.vx = 0;
    p.vy = 0;
  }

  function startStoryMode(fromMenu = false, inherited = null) {
    const previousCharacter = inherited?.previousCharacter || game.selectedCharacter;
    const previousDifficulty = inherited?.previousDifficulty || game.difficulty;
    game.selectedCharacter = 'alan';
    game.difficulty = 'normal';
    activateStandardWorld();
    game.runMode = 'story';
    game.menuMode = 'story';
    game.campaign.active = false;
    game.campaign.rogue = false;
    storeString('labzero.menuMode', 'story');
    clearTransientState();
    clearToasts();
    hideAllOverlaysForRun();
    game.player = createPlayer();
    game.player.characterId = 'alan';
    game.player.character = getCharacterDef('alan');
    game.pet = null;
    game.story = {
      beatIndex: 0,
      flags: {},
      previousCharacter,
      previousDifficulty,
      combat: null,
      currentCombat: null,
      inCombat: false,
      combatActive: false,
      failed: false,
      ending: false,
      stageTime: 0,
      completionTimer: 0,
      spawnQueue: [],
      totalEnemies: 0,
      typing: false,
      typingTimer: null,
      fullText: '',
      pendingChoices: [],
    };
    game.mode = 'story';
    game.time = 0;
    game.runTime = 0;
    game.bossRef = null;
    game.enemies = [];
    game.ephemeral = [];
    if (fromMenu) dom.menu.classList.add('is-closing');
    window.setTimeout(() => {
      dom.menu.classList.add('is-hidden');
      dom.menu.classList.remove('is-closing');
    }, fromMenu ? 260 : 0);
    document.body.classList.add('story-mode', 'in-game');
    document.body.classList.remove('training-mode', 'campaign-mode', 'low-hp');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.trainingPanel?.classList.add('is-hidden');
    dom.storyOverlay.classList.remove('is-hidden');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    Sfx.init();
    Sfx.click();
    renderStoryBeat(0);
  }

  function spawnStoryEnemy(entry) {
    const p = game.player;
    if (!p) return;
    let x = entry.x;
    let y = entry.y;
    if (x == null || y == null) {
      const angle = rand(0, TAU);
      const distance = rand(360, 560);
      x = clamp(p.x + Math.cos(angle) * distance, WORLD.pad + 50, WORLD.w - WORLD.pad - 50);
      y = clamp(p.y + Math.sin(angle) * distance, WORLD.pad + 50, WORLD.h - WORLD.pad - 50);
      if (!isPointFree(x, y, 34)) {
        const spot = findFreeSpotNear(x, y, 34, 220);
        if (spot) { x = spot.x; y = spot.y; }
      }
    }
    const e = spawnEnemy(entry.type, { x, y, bossKind: entry.bossKind, storyEnemy: true });
    if (!e) return;
    e.storyEnemy = true;
    if (entry.hp) {
      e.maxHp = entry.hp;
      e.hp = entry.hp;
    }
    if (entry.damage) e.damage = entry.damage;
    if (entry.bossKind) {
      e.bossKind = entry.bossKind;
      game.bossRef = e;
    }
  }

  function startStoryCombat(beat) {
    const story = game.story;
    if (!story || !beat) return;
    clearStoryTyping();
    story.currentCombat = beat;
    story.inCombat = true;
    story.combatActive = true;
    story.stageTime = 0;
    story.completionTimer = 0;
    story.spawnQueue = (beat.spawns || []).map((spawn) => ({ ...spawn })).sort((a, b) => a.at - b.at);
    story.totalEnemies = story.spawnQueue.length;
    story.kills = 0;
    game.selectedCharacter = 'alan';
    game.difficulty = 'normal';
    game.runMode = 'story';
    game.menuMode = 'story';
    game.campaign.active = false;
    game.campaign.rogue = false;
    game.player = createPlayer();
    applyStoryLoadout(beat.loadout || 1);
    game.player.x = PLAYER_START.x;
    game.player.y = PLAYER_START.y;
    game.player.aimAngle = 0;
    game.enemies = [];
    game.bullets = [];
    game.playerMissiles = [];
    game.enemyBullets = [];
    game.enemyRockets = [];
    game.enemyTurrets = [];
    game.campaignHazards = [];
    game.coins = [];
    game.pickups = [];
    game.particles = [];
    game.casings = [];
    game.texts = [];
    game.decals = [];
    game.portals = [];
    game.grenades = [];
    game.fireZones = [];
    game.turrets = [];
    game.spawnQueue = [];
    game.bossRef = null;
    game.wave = beat.wave || 1;
    game.waveActive = true;
    game.waveTotal = story.totalEnemies;
    game.waveElapsed = 0;
    game.intermission = false;
    game.mode = 'playing';
    game.time = 0;
    game.runTime = 0;
    game.kills = 0;
    game.creditsEarned = 0;
    game.speedMultiplier = 1;
    game.pet = null;
    game.storyMode = true;
    resetCameraToPlayer();
    game.lastFrame = performance.now();
    document.body.classList.remove('story-mode', 'training-mode', 'campaign-mode', 'low-hp');
    document.body.classList.add('in-game', 'story-combat');
    dom.menu.classList.add('is-hidden');
    dom.storyOverlay.classList.add('is-hidden');
    dom.hud.classList.remove('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.trainingPanel?.classList.add('is-hidden');
    applyRunModeUI();
    updateHUD();
    showBanner(`STORY // ${beat.chapter || '零号实验区'}`, beat.title || '战斗', beat.objective || '清除敌人', true, 3600);
    addToast('▸', '战斗开始', beat.objective || '清除所有敌人', 'danger', 3600);
    Sfx.waveStart();
  }

  function updateStoryCombat(dt) {
    const story = game.story;
    if (!story || !story.inCombat) return;
    story.stageTime += dt;
    while (story.spawnQueue.length && story.spawnQueue[0].at <= story.stageTime) {
      spawnStoryEnemy(story.spawnQueue.shift());
    }
    if (!story.spawnQueue.length && story.stageTime > 0.8) {
      let living = 0;
      for (const e of game.enemies) if (!e.dead) living += 1;
      if (living === 0) {
        story.completionTimer += dt;
        if (story.completionTimer > 1.2) completeStoryCombat();
      } else {
        story.completionTimer = 0;
      }
    }
  }

  function completeStoryCombat() {
    const story = game.story;
    if (!story) return;
    story.inCombat = false;
    story.combatActive = false;
    story.completionTimer = 0;
    game.mode = 'story';
    game.enemies = [];
    game.bossRef = null;
    game.bullets = [];
    game.enemyBullets = [];
    game.enemyRockets = [];
    game.playerMissiles = [];
    game.player = null;
    document.body.classList.add('story-mode', 'in-game');
    document.body.classList.remove('story-combat', 'low-hp');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.storyOverlay.classList.remove('is-hidden');
    Sfx.upgrade();
    renderStoryBeat(story.beatIndex + 1);
  }

  function retryStoryCombat() {
    const story = game.story;
    if (!story?.currentCombat) return;
    story.failed = false;
    startStoryCombat(story.currentCombat);
  }

  function isTraining() {
    return game.runMode === 'training';
  }

  function createTrainingDummy() {
    const x = clamp((game.player?.x || PLAYER_START.x) + 270, 120, WORLD.w - 120);
    const y = clamp((game.player?.y || PLAYER_START.y) - 30, 120, WORLD.h - 120);
    return {
      type: 'trainingDummy', trainingDummy: true, x, y, r: 48, radius: 48,
      hp: 1e12, maxHp: 1e12, vx: 0, vy: 0, aimAngle: Math.PI / 2,
      spawnTimer: 0, spawnMax: 0, hitFlash: 0, dead: false, deathAge: 0,
      stunTimer: 0, muzzleFlash: 0, summonWindup: 0, burstLeft: 0,
    };
  }

  function startTrainingRun(fromMenu = false) {
    activateStandardWorld();
    game.runMode = 'training';
    game.campaign.active = false;
    game.campaign.rogue = false;
    game.menuMode = 'training';
    storeString('labzero.menuMode', 'training');
    clearTransientState();
    clearToasts();
    hideAllOverlaysForRun();
    if (fromMenu) {
      dom.menu.classList.add('is-closing');
      window.setTimeout(() => {
        dom.menu.classList.add('is-hidden');
        dom.menu.classList.remove('is-closing');
      }, 260);
    } else {
      dom.menu.classList.add('is-hidden');
    }
    Sfx.init();
    Sfx.click();
    game.player = createPlayer();
    const p = game.player;
    for (const id of WEAPON_ORDER) {
      p.owned[id] = true;
      p.ammo[id] = weaponCapacity(id, p.mods);
    }
    p.credits = 999999;
    p.level = 10;
    p.xp = 0;
    p.xpNext = 100;
    p.weapon = 'pistol';
    p.talents = {};
    p.talentPoints = 999;
    p.talentsSpent = 0;
    p.totalTalentPoints = 999;
    p.hp = p.maxHp;
    p.offhand = null;
    game.enemies = [];
    game.bossRef = null;
    game.wave = 0;
    game.waveActive = false;
    game.intermission = false;
    game.waveTotal = 0;
    game.spawnQueue = [];
    game.mode = 'playing';
    game.time = 0;
    game.runTime = 0;
    game.kills = 0;
    game.creditsEarned = 0;
    game.speedMultiplier = 1;
    game.campaign.arenaLocked = false;
    game.training = {
      dummy: null,
      startedAt: game.time,
      totalDamage: 0,
      dps: 0,
      hits: [],
      lastPanel: 0,
    };
    const dummy = createTrainingDummy();
    game.training.dummy = dummy;
    game.enemies.push(dummy);
    spawnActivePet();
    resetCameraToPlayer();
    game.lastFrame = performance.now();
    document.body.classList.add('in-game', 'training-mode');
    document.body.classList.remove('campaign-mode', 'low-hp');
    dom.hud.classList.remove('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.intermission.classList.add('is-hidden');
    dom.trainingPanel?.classList.remove('is-hidden');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    applyRunModeUI();
    updateHUD();
    updateTrainingPanel();
    addToast('▸', '训练场已连接', '全武器开放 · T 自由科技 · B 军械库 · 沙袋记录 DPS', 'gold', 5200);
    showBanner('TRAINING PROTOCOL // FREE BUILD', '训练场', '沙袋不会反击 · 全武器与科技自由测试', false, 3000);
    Sfx.waveStart();
  }

  function recordTrainingHit(amount) {
    const training = game.training;
    if (!training || !Number.isFinite(amount) || amount <= 0) return;
    training.totalDamage += amount;
    training.hits.push({ t: game.time, amount });
    if (training.hits.length > 600) training.hits.splice(0, training.hits.length - 600);
  }

  function updateTraining(dt) {
    const training = game.training;
    if (!training || !training.dummy) return;
    const now = game.time;
    training.hits = training.hits.filter((hit) => now - hit.t <= 5);
    const sum = training.hits.reduce((total, hit) => total + hit.amount, 0);
    const span = Math.min(5, Math.max(1, now - training.startedAt));
    training.dps = sum / span;
    training.dummy.hitFlash = Math.max(0, training.dummy.hitFlash - dt);
    if (training.dummy.hp <= 0) training.dummy.hp = training.dummy.maxHp;
    if (now - training.lastPanel > 0.12) {
      training.lastPanel = now;
      updateTrainingPanel();
    }
  }

  function updateTrainingPanel() {
    if (!dom.trainingPanel) return;
    const training = game.training;
    if (!training) {
      dom.trainingPanel.classList.add('is-hidden');
      return;
    }
    dom.trainingPanel.classList.toggle('is-hidden', !isTraining());
    setText(dom.trainingDps, formatInt(Math.round(training.dps)));
    setText(dom.trainingTotal, formatInt(Math.round(training.totalDamage)));
    setText(dom.trainingDummyHp, '∞');
  }

  function resetTrainingDummy() {
    if (!game.training?.dummy) return;
    const dummy = game.training.dummy;
    dummy.hp = dummy.maxHp;
    dummy.hitFlash = 0;
    game.training.totalDamage = 0;
    game.training.hits = [];
    game.training.dps = 0;
    game.training.startedAt = game.time;
    updateTrainingPanel();
    addToast('↺', '沙袋已重置', 'DPS 与累计伤害计数归零', '', 2400);
    Sfx.click();
  }

  function trainingEquipAllTalents() {
    const p = game.player;
    if (!p) return;
    for (const id of TALENT_ORDER) p.talents[id] = true;
    p.talentPoints = 999;
    p.talentsSpent = TALENT_TOTAL_COST;
    p.totalTalentPoints = Math.max(999, TALENT_TOTAL_COST);
    p.shieldUnlocked = true;
    p.maxShield = Math.max(70, p.maxShield || 0);
    p.shield = p.maxShield;
    p.shieldBroken = false;
    p.turretCooldown = 0;
    ensureOffhandValid();
    renderTalents();
    updateHUD();
    addToast('◇', '全部科技已启用', '训练场自由模式 · 可随时点击节点取消', 'gold', 3200);
  }

  function trainingClearTalents() {
    const p = game.player;
    if (!p) return;
    p.talents = {};
    p.talentPoints = 999;
    p.talentsSpent = 0;
    p.totalTalentPoints = 999;
    p.shieldUnlocked = false;
    p.maxShield = 0;
    p.shield = 0;
    p.shieldBroken = true;
    p.shieldBreakTimer = 0;
    p.offhand = null;
    p.offhandReloading = false;
    game.turrets = [];
    renderTalents();
    updateHUD();
    addToast('○', '科技树已清空', '所有节点已取消 · 可重新自由配置', '', 2800);
  }

  function trainingMaxMods() {
    const p = game.player;
    if (!p) return;
    for (const id of WEAPON_ORDER) {
      for (const key of MOD_KEYS) p.mods[id][key] = MODS[key].max;
      p.ammo[id] = weaponCapacity(id, p.mods);
    }
    updateHUD();
    addToast('◆', '全部改装已满级', '所有武器 MK IV · 弹药已补满', 'gold', 3000);
  }

  function trainingClearMods() {
    const p = game.player;
    if (!p) return;
    for (const id of WEAPON_ORDER) {
      for (const key of MOD_KEYS) p.mods[id][key] = 0;
      p.ammo[id] = Math.min(p.ammo[id] || 0, weaponCapacity(id, p.mods));
    }
    updateHUD();
    addToast('○', '改装已清空', '所有武器已恢复基础配置', '', 2600);
  }

  function handleTrainingAction(action) {
    if (!isTraining()) return;
    if (action === 'all-talents') trainingEquipAllTalents();
    else if (action === 'clear-talents') trainingClearTalents();
    else if (action === 'max-mods') trainingMaxMods();
    else if (action === 'clear-mods') trainingClearMods();
    else if (action === 'reset-dummy') resetTrainingDummy();
    else if (action === 'exit') returnToMenu();
  }

  function activePetDef() {
    const id = game.selectedPet;
    return id && game.unlockedPets[id] ? PET_DEFS[id] : null;
  }

  function spawnActivePet() {
    game.pet = null;
    const def = activePetDef();
    const p = game.player;
    if (!def || !p) return;
    game.pet = {
      id: def.id,
      type: def.type,
      x: p.x - Math.cos(p.aimAngle) * 30,
      y: p.y - 24,
      angle: p.aimAngle,
      fireTimer: 0.6,
      healTimer: 10,
      laserTimer: 0,
      laserX: 0,
      laserY: 0,
      bob: rand(0, TAU),
      moving: false,
    };
    addText(p.x, p.y - 36, `${def.name} 已跟随`, def.accent, 1.1, 10, -22);
  }

  function updatePet(dt) {
    const pet = game.pet;
    const p = game.player;
    if (!pet || !p || !p.alive) return;
    const def = PET_DEFS[pet.id];
    if (!def) return;
    pet.bob += dt * 4;
    const behindX = p.x - Math.cos(p.aimAngle) * 30 - Math.cos(p.aimAngle + Math.PI / 2) * 18;
    const behindY = p.y - Math.sin(p.aimAngle) * 20 - 24 + Math.sin(pet.bob) * 3;
    const follow = 1 - Math.exp(-7 * dt);
    pet.moving = dist(pet.x, pet.y, behindX, behindY) > 8;
    pet.x = lerp(pet.x, behindX, follow);
    pet.y = lerp(pet.y, behindY, follow);
    if (def.type === 'drone') {
      pet.healTimer -= dt;
      pet.fireTimer -= dt;
      pet.laserTimer = Math.max(0, pet.laserTimer - dt);
      if (pet.healTimer <= 0) {
        if (p.hp < p.maxHp) {
          const heal = Math.ceil(p.maxHp * 0.2);
          p.hp = Math.min(p.maxHp, p.hp + heal);
          addText(p.x, p.y - 34, `浮游炮治疗 +${heal}`, '126, 255, 205', 1.1, 11, -24);
          Sfx.heal();
        }
        pet.healTimer = 10;
      }
      if (pet.fireTimer <= 0) {
        let target = null;
        let best = 620;
        for (const e of game.enemies) {
          if (e.dead || e.spawnTimer > 0) continue;
          const d = dist(pet.x, pet.y, e.x, e.y);
          if (d < best && hasLineOfSight(pet.x, pet.y, e.x, e.y)) {
            best = d;
            target = e;
          }
        }
        if (target) {
          const angle = Math.atan2(target.y - pet.y, target.x - pet.x);
          pet.angle = angle;
          pet.laserTimer = 0.13;
          pet.laserX = target.x;
          pet.laserY = target.y;
          pet.fireTimer = 0.5;
          damageEnemy(target, 7 + p.level * 1.1, angle, target.x, target.y, true);
          if (game.time >= (game.nextPetSound || 0)) {
            Sfx.turretShot?.();
            game.nextPetSound = game.time + 0.18;
          }
        } else {
          pet.fireTimer = 0.18;
        }
      }
    }
  }

  function checkpointMatchesCurrentDifficulty(checkpoint = game.endlessCheckpoint) {
    return !!checkpoint && checkpoint.difficulty === game.difficulty && Number(checkpoint.wave) >= 1;
  }

  function createEndlessCheckpoint() {
    const p = game.player;
    if (!p || !p.alive) return null;
    const mods = {};
    for (const id of WEAPON_ORDER) mods[id] = { ...(p.mods[id] || {}) };
    return {
      version: 1,
      difficulty: game.difficulty,
      wave: game.intermission ? Math.max(1, game.wave + 1) : Math.max(1, game.wave),
      savedAt: Date.now(),
      selectedCharacter: p.characterId,
      player: {
        characterId: p.characterId,
        level: p.level,
        xp: p.xp,
        xpNext: p.xpNext,
        credits: p.credits,
        kills: p.kills,
        maxHp: p.maxHp,
        hp: p.hp,
        r: p.r,
        speedBase: p.speedBase,
        damageReduction: p.damageReduction,
        poisonImmune: p.poisonImmune,
        creditBonus: p.creditBonus,
        weapon: p.weapon,
        offhand: p.offhand,
        owned: { ...p.owned },
        mods,
        ammo: { ...p.ammo },
        talents: { ...p.talents },
        talentPoints: p.talentPoints,
        talentsSpent: p.talentsSpent,
        totalTalentPoints: p.totalTalentPoints,
        grenades: { ...p.grenades },
        selectedGrenade: p.selectedGrenade,
        shieldUnlocked: p.shieldUnlocked,
        maxShield: p.maxShield,
        shield: p.shield,
        campaignUpgrades: { ...p.campaignUpgrades },
      },
      game: {
        kills: game.kills,
        creditsEarned: game.creditsEarned,
        runTime: game.runTime,
      },
    };
  }

  function saveEndlessCheckpoint(silent = true) {
    if (game.runMode !== 'endless' || !game.player?.alive) return false;
    if (['dying', 'gameover', 'campaignComplete'].includes(game.mode)) return false;
    const checkpoint = createEndlessCheckpoint();
    if (!checkpoint) return false;
    game.endlessCheckpoint = checkpoint;
    storeString('labzero.endlessCheckpoint', JSON.stringify(checkpoint));
    if (!silent) addToast('↺', '无尽进度已保存', `第 ${pad2(checkpoint.wave)} 波 · 下次可从主菜单继续`, 'gold', 3200);
    return true;
  }

  function clearEndlessCheckpoint(notify = false) {
    game.endlessCheckpoint = null;
    try {
      localStorage.removeItem('labzero.endlessCheckpoint');
    } catch (_) {
      /* localStorage can be unavailable for local files. */
    }
    if (game.mode === 'menu') syncMenuModeUI();
    if (notify) addToast('×', '无尽进度已清除', '下次进入无尽将从第 1 波重新开始', '', 2800);
  }

  function restoreEndlessCheckpoint(checkpoint) {
    const p = game.player;
    const src = checkpoint?.player;
    if (!p || !src) return;
    const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const characterId = CHARACTER_DEFS[src.characterId] ? src.characterId : p.characterId;
    p.characterId = characterId;
    p.character = getCharacterDef(characterId);
    p.level = Math.max(1, Math.floor(number(src.level, 1)));
    p.xp = Math.max(0, number(src.xp, 0));
    p.xpNext = Math.max(1, number(src.xpNext, 80));
    p.credits = Math.max(0, number(src.credits, 0));
    p.kills = Math.max(0, Math.floor(number(src.kills, 0)));
    p.maxHp = Math.max(1, number(src.maxHp, p.maxHp));
    p.hp = clamp(number(src.hp, p.maxHp), 1, p.maxHp);
    p.r = Math.max(8, number(src.r, p.r));
    p.speedBase = Math.max(20, number(src.speedBase, p.speedBase));
    p.damageReduction = clamp(number(src.damageReduction, 0), 0, 0.9);
    p.poisonImmune = !!src.poisonImmune;
    p.creditBonus = Math.max(0, number(src.creditBonus, 0));
    for (const id of WEAPON_ORDER) {
      p.owned[id] = id === 'pistol' || !!src.owned?.[id];
      for (const key of MOD_KEYS) {
        p.mods[id][key] = clamp(Math.floor(number(src.mods?.[id]?.[key], 0)), 0, MODS[key].max);
      }
      const capacity = weaponCapacity(id, p.mods);
      p.ammo[id] = clamp(number(src.ammo?.[id], capacity), 0, capacity);
    }
    p.talents = {};
    for (const id of TALENT_ORDER) p.talents[id] = !!src.talents?.[id];
    p.talentPoints = Math.max(0, number(src.talentPoints, 0));
    p.talentsSpent = Math.max(0, number(src.talentsSpent, 0));
    p.totalTalentPoints = Math.max(p.talentPoints + p.talentsSpent, number(src.totalTalentPoints, 0));
    p.weapon = p.owned[src.weapon] ? src.weapon : 'pistol';
    p.offhand = p.owned[src.offhand] && p.talents.dualWield ? src.offhand : null;
    p.grenades = {};
    for (const id of GRENADE_ORDER) {
      p.grenades[id] = clamp(Math.floor(number(src.grenades?.[id], 0)), 0, grenadeMaxStock(id, p));
    }
    p.selectedGrenade = GRENADES[src.selectedGrenade] ? src.selectedGrenade : 'frag';
    p.campaignUpgrades = { health: 0, speed: 0, reload: 0, damage: 0, ...(src.campaignUpgrades || {}) };
    p.shieldUnlocked = !!src.shieldUnlocked;
    p.maxShield = Math.max(0, number(src.maxShield, 0));
    p.shield = clamp(number(src.shield, 0), 0, p.maxShield);
    p.shieldBroken = false;
    p.shieldBreakTimer = 0;
    p.reloading = false;
    p.offhandReloading = false;
    p.reloadTimer = 0;
    p.offhandReloadTimer = 0;
    p.pendingReload = 0;
    p.offhandPendingReload = 0;
    p.fireCooldown = 0;
    p.offhandFireCooldown = 0;
    p.grenadeCooldown = 0;
    p.turretCooldown = 0;
    p.skillCooldown = 0;
    p.healDroneTimer = 0;
    p.healDroneTick = 0;
    p.holoShieldTimer = 0;
    p.paralyzed = 0;
    p.reviving = false;
    p.reviveTimer = 0;
    p.alive = true;
    p.vx = 0;
    p.vy = 0;
    game.kills = Math.max(0, Math.floor(number(checkpoint.game?.kills, p.kills)));
    game.creditsEarned = Math.max(0, number(checkpoint.game?.creditsEarned, 0));
    game.runTime = Math.max(0, number(checkpoint.game?.runTime, 0));
    game.selectedCharacter = characterId;
    storeString('labzero.selectedCharacter', characterId);
    game.endlessCheckpoint = checkpoint;
  }

  function startRun(fromMenu = false, checkpoint = null) {
    if (!checkpoint) clearEndlessCheckpoint(false);
    if (checkpoint?.difficulty && DIFFICULTIES[checkpoint.difficulty]) {
      game.difficulty = checkpoint.difficulty;
      storeString('labzero.difficulty', game.difficulty);
    }
    if (checkpoint?.player?.characterId && CHARACTER_DEFS[checkpoint.player.characterId]) {
      game.selectedCharacter = checkpoint.player.characterId;
      storeString('labzero.selectedCharacter', game.selectedCharacter);
    }
    activateStandardWorld();
    game.runMode = 'endless';
    game.campaign.active = false;
    game.campaign.rogue = false;
    applyRunModeUI();
    clearTransientState();
    clearToasts();
    hideAllOverlaysForRun();
    if (fromMenu) {
      dom.menu.classList.add('is-closing');
      window.setTimeout(() => {
        dom.menu.classList.add('is-hidden');
        dom.menu.classList.remove('is-closing');
      }, 260);
    } else {
      dom.menu.classList.add('is-hidden');
    }
    Sfx.init();
    Sfx.click();
    game.player = createPlayer();
    if (checkpoint) restoreEndlessCheckpoint(checkpoint);
    spawnActivePet();
    game.mode = 'playing';
    game.time = 0;
    game.runTime = checkpoint ? game.runTime : 0;
    game.damageFlash = 0;
    game.hitFlash = 0;
    game.menuMode = 'endless';
    storeString('labzero.menuMode', 'endless');
    game.bossRef = null;
    game.endlessBiome = 'lab';
    game.speedMultiplier = 1;
    game.biomeFxUntil = 0;
    game.wave = 0;
    game.lastFrame = performance.now();
    document.body.classList.add('in-game');
    document.body.classList.remove('low-hp');
    dom.hud.classList.remove('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    resetCameraToPlayer();
    updateBestUI();
    updateHUD();
    const startWave = checkpoint ? Math.max(1, Math.floor(Number(checkpoint.wave) || 1)) : 1;
    beginWave(startWave);
    if (checkpoint) {
      addToast('↺', '无尽进度已恢复', `从第 ${pad2(startWave)} 波继续 · 已继承装备、科技与战绩`, 'gold', 5200);
    }
    showToastOnboarding();
  }

  function showToastOnboarding() {
    window.setTimeout(() => {
      if (game.mode === 'playing' || game.mode === 'shop') {
        addToast('▸', '收容协议已启动', 'WASD 移动 · 左键射击 · 空格 角色技能 · Q 手雷 · T 科技树 · F 技能', '', 6200);
      }
    }, 600);
  }

  function hideAllOverlaysForRun() {
    dom.menu.classList.add('is-hidden');
    dom.shopOverlay.classList.add('is-hidden');
    dom.talentOverlay.classList.add('is-hidden');
    dom.pauseOverlay.classList.add('is-hidden');
    dom.settingsOverlay.classList.add('is-hidden');
    dom.charactersOverlay.classList.add('is-hidden');
    dom.bestiaryOverlay.classList.add('is-hidden');
    dom.gameover.classList.add('is-hidden');
    dom.campaignComplete.classList.add('is-hidden');
    dom.intermission.classList.add('is-hidden');
    dom.reviveHud.classList.add('is-hidden');
    dom.trainingPanel?.classList.add('is-hidden');
    dom.storyOverlay?.classList.add('is-hidden');
    dom.banner.classList.remove('show', 'danger');
    dom.bossHud.classList.add('is-hidden');
  }

  function saveCharacterUnlocks() {
    storeString('labzero.characters', JSON.stringify(game.unlockedCharacters));
  }

  function updateCharacterTokenUI() {
    setText(dom.characterTokenCount, formatInt(game.characterTokens));
    setText(dom.characterCurrent, getCharacterDef().name);
  }

  const CHARACTER_PORTRAIT_PALETTES = {
    alan: { accent: '#79f4ff', accent2: '#2f8f9a', armor: '#17363c', armor2: '#244e54', dim: '#0a1c21' },
    lifeline: { accent: '#8dffc9', accent2: '#3f9d79', armor: '#18352d', armor2: '#2a5142', dim: '#0a1d18' },
    newcastle: { accent: '#9dd8ff', accent2: '#4f83b8', armor: '#1a2d3d', armor2: '#2b4560', dim: '#0b1722' },
    caustic: { accent: '#b8ff75', accent2: '#73973b', armor: '#2b331d', armor2: '#444f2b', dim: '#171e10' },
    valkyrie: { accent: '#ffe08a', accent2: '#b47b2f', armor: '#332a18', armor2: '#59482a', dim: '#1b150b' },
  };

  function characterPortraitSVG(id) {
    const character = CHARACTER_DEFS[id];
    const palette = CHARACTER_PORTRAIT_PALETTES[id] || CHARACTER_PORTRAIT_PALETTES.alan;
    const u = id;
    const shoulders = `<path d="M22 120 Q28 88 61 78 L82 91 Q110 101 138 91 L159 78 Q192 88 198 120Z" fill="url(#armor-${u})" stroke="${palette.accent}" stroke-opacity=".52" stroke-width="1.2"/>
      <path d="M60 79 Q82 93 110 94 Q138 93 160 79" fill="none" stroke="${palette.accent}" stroke-opacity=".25" stroke-width="1"/>
      <path d="M45 120 L52 99 L69 92" fill="none" stroke="${palette.accent2}" stroke-opacity=".45" stroke-width="1"/>`;
    const neck = `<path d="M94 83 L94 98 Q110 105 126 98 L126 83" fill="${palette.dim}" stroke="${palette.accent2}" stroke-opacity=".55"/>`;
    const helmet = `<path d="M78 51 Q78 25 91 17 Q103 10 116 13 Q133 17 140 34 Q146 47 142 63 L137 81 Q128 90 110 91 Q91 90 82 82 L77 64Z" fill="url(#head-${u})" stroke="${palette.accent}" stroke-opacity=".68" stroke-width="1.2"/>
      <path d="M83 40 Q84 23 101 17 Q119 11 133 22" fill="none" stroke="${palette.accent}" stroke-opacity=".26" stroke-width="1"/>`;
    const visor = `<path d="M87 51 Q100 44 119 46 L136 49 L135 60 Q127 68 111 69 Q95 68 85 61Z" fill="${palette.dim}" stroke="${palette.accent2}" stroke-opacity=".78" stroke-width="1.1"/>
      <path d="M92 54 Q108 49 127 53 L130 58 Q119 63 99 62 Q93 60 90 57Z" fill="${palette.accent}" opacity=".72" filter="url(#glow-${u})"/>
      <path d="M103 51 L100 62 M118 49 L121 61" stroke="${palette.dim}" stroke-width=".8" opacity=".65"/>`;
    let details = '';
    if (id === 'alan') {
      details = `<path d="M139 31 L157 17 L162 20 L149 40" fill="none" stroke="${palette.accent}" stroke-opacity=".7" stroke-width="1.4"/>
        <circle cx="160" cy="18" r="3.2" fill="none" stroke="${palette.accent}" stroke-opacity=".75"/>
        <circle cx="160" cy="18" r="1.2" fill="${palette.accent}"/>
        <path d="M78 60 Q64 65 66 79 L78 83" fill="none" stroke="${palette.accent2}" stroke-width="6" stroke-opacity=".52"/>
        <path d="M91 82 L94 91 L103 95" fill="none" stroke="${palette.accent}" stroke-opacity=".5" stroke-width="1.2"/>
        <path d="M155 91 L179 80 L188 102 L168 114Z" fill="${palette.dim}" stroke="${palette.accent2}" stroke-opacity=".5"/>
        <path d="M160 94 L174 88" stroke="${palette.accent}" stroke-opacity=".65"/>`;
    } else if (id === 'lifeline') {
      details = `<path d="M101 16 L102 8 L119 8 L120 16" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".65" stroke-width="1.2"/>
        <path d="M105 11 L116 11" stroke="${palette.accent}" stroke-width="1.4" opacity=".9"/>
        <circle cx="110" cy="57" r="2.2" fill="${palette.accent}" filter="url(#glow-${u})"/>
        <path d="M99 98 L99 114 M110 97 L110 116 M121 98 L121 114" stroke="${palette.accent}" stroke-width="1.3" opacity=".55"/>
        <path d="M50 104 L58 104 L58 96 L66 96 L66 104 L74 104 L74 112 L66 112 L66 120 L58 120 L58 112 L50 112Z" fill="${palette.accent}" opacity=".9"/>
        <path d="M143 100 Q157 92 166 104" fill="none" stroke="${palette.accent}" stroke-opacity=".55" stroke-width="1.4"/>
        <circle cx="168" cy="106" r="6" fill="none" stroke="${palette.accent}" stroke-opacity=".4"/>
        <circle cx="168" cy="106" r="2" fill="${palette.accent}"/>`;
    } else if (id === 'newcastle') {
      details = `<path d="M66 74 Q48 81 40 104 L50 116 L74 99 L83 84Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".62" stroke-width="1.3"/>
        <path d="M154 74 Q172 81 180 104 L170 116 L146 99 L137 84Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".62" stroke-width="1.3"/>
        <path d="M149 91 L178 91 L184 120 L154 120Z" fill="${palette.dim}" stroke="${palette.accent}" stroke-opacity=".55"/>
        <path d="M155 101 L176 101 M157 108 L174 108 M160 115 L171 115" stroke="${palette.accent}" stroke-opacity=".45" stroke-width="1.1"/>
        <path d="M93 76 L110 83 L127 76" fill="none" stroke="${palette.accent}" stroke-width="1.4" opacity=".6"/>
        <path d="M80 19 L75 43 M140 19 L145 43" stroke="${palette.accent2}" stroke-width="2" opacity=".7"/>`;
    } else if (id === 'valkyrie') {
      details = `<path d="M78 48 Q66 48 56 61 Q42 80 30 100 L56 91 L72 78Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".8" stroke-width="1.3"/>
        <path d="M142 48 Q154 48 164 61 Q178 80 190 100 L164 91 L148 78Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".8" stroke-width="1.3"/>
        <path d="M47 70 L66 69 M173 70 L154 69" stroke="${palette.accent}" stroke-opacity=".65" stroke-width="1.2"/>
        <path d="M35 97 L57 87 M185 97 L163 87" stroke="${palette.accent}" stroke-opacity=".55" stroke-width="1"/>
        <path d="M91 22 Q110 8 129 22" fill="none" stroke="${palette.accent}" stroke-opacity=".45" stroke-width="2"/>
        <circle cx="110" cy="55" r="38" fill="none" stroke="${palette.accent}" stroke-opacity=".18" stroke-dasharray="2 5"/>
        <path d="M58 92 L74 94 L74 114 L58 111Z" fill="${palette.dim}" stroke="${palette.accent}" stroke-opacity=".65"/>
        <path d="M162 92 L146 94 L146 114 L162 111Z" fill="${palette.dim}" stroke="${palette.accent}" stroke-opacity=".65"/>
        <path d="M62 99 L71 100 M62 106 L71 107 M158 99 L149 100 M158 106 L149 107" stroke="${palette.accent}" stroke-opacity=".55" stroke-width="1"/>
        <path d="M90 78 L110 88 L130 78" fill="none" stroke="${palette.accent}" stroke-width="1.5" opacity=".75"/>
        <path d="M63 76 L54 70 L58 82Z M157 76 L166 70 L162 82Z" fill="${palette.accent}" opacity=".75"/>
      `;
    } else {
      details = `<path d="M82 66 Q73 80 76 97 Q81 107 94 108 L98 88Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".55"/>
        <path d="M138 66 Q147 80 144 97 Q139 107 126 108 L122 88Z" fill="${palette.armor2}" stroke="${palette.accent}" stroke-opacity=".55"/>
        <circle cx="84" cy="82" r="10" fill="${palette.dim}" stroke="${palette.accent}" stroke-opacity=".65"/>
        <circle cx="136" cy="82" r="10" fill="${palette.dim}" stroke="${palette.accent}" stroke-opacity=".65"/>
        <circle cx="84" cy="82" r="4" fill="${palette.accent}" opacity=".75"/>
        <circle cx="136" cy="82" r="4" fill="${palette.accent}" opacity=".75"/>
        <path d="M88 98 Q101 104 110 104 Q122 103 132 96" fill="none" stroke="${palette.accent}" stroke-opacity=".45" stroke-width="1.4"/>
        <path d="M160 92 L176 87 L181 98 L169 106Z" fill="${palette.dim}" stroke="${palette.accent2}" stroke-opacity=".55"/>
        <path d="M163 95 L176 91" stroke="${palette.accent}" stroke-opacity=".55"/>
        <path d="M160 97 Q151 87 153 76" fill="none" stroke="${palette.accent2}" stroke-width="1.4" opacity=".55"/>`;
    }
    return `<svg class="character-portrait-art" viewBox="0 0 220 120" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${character.name}角色形象">
      <defs>
        <radialGradient id="bg-${u}" cx="50%" cy="42%" r="68%">
          <stop offset="0" stop-color="${palette.accent}" stop-opacity=".17"/>
          <stop offset=".62" stop-color="${palette.armor}" stop-opacity=".2"/>
          <stop offset="1" stop-color="${palette.dim}" stop-opacity=".94"/>
        </radialGradient>
        <linearGradient id="armor-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${palette.armor2}"/>
          <stop offset=".7" stop-color="${palette.armor}"/>
          <stop offset="1" stop-color="${palette.dim}"/>
        </linearGradient>
        <linearGradient id="head-${u}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${palette.armor2}"/>
          <stop offset=".55" stop-color="${palette.armor}"/>
          <stop offset="1" stop-color="${palette.dim}"/>
        </linearGradient>
        <filter id="glow-${u}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="220" height="120" fill="url(#bg-${u})"/>
      <g opacity=".22" stroke="${palette.accent}" stroke-width=".7">
        <path d="M0 30H220 M0 90H220 M30 0V120 M190 0V120"/>
        <path d="M10 12H26 M194 12H210 M10 108H26 M194 108H210"/>
      </g>
      <circle cx="110" cy="55" r="47" fill="none" stroke="${palette.accent}" stroke-opacity=".17" stroke-dasharray="2 6"/>
      <circle cx="110" cy="55" r="55" fill="none" stroke="${palette.accent}" stroke-opacity=".08"/>
      <path d="M28 30 L46 30 L46 36 L34 36 L34 48 L28 48Z M192 30 L174 30 L174 36 L186 36 L186 48 L192 48Z" fill="${palette.accent}" opacity=".16"/>
      <ellipse cx="110" cy="117" rx="78" ry="9" fill="#000" opacity=".45"/>
      ${shoulders}
      ${neck}
      ${helmet}
      ${visor}
      ${details}
      <path d="M26 120 Q54 105 82 110 M194 120 Q166 105 138 110" fill="none" stroke="${palette.accent}" stroke-opacity=".2" stroke-width="1"/>
    </svg>`;
  }

  function renderCharacters() {
    const selected = game.selectedCharacter;
    const tokenText = formatInt(game.characterTokens);
    const rosterIds = CHARACTER_ORDER.filter((id) => !CHARACTER_DEFS[id].hidden || isDeveloperMode());
    dom.characterGrid.classList.toggle('has-legendary', rosterIds.some((id) => CHARACTER_DEFS[id].legendary));
    dom.characterGrid.innerHTML = rosterIds.map((id) => {
      const character = CHARACTER_DEFS[id];
      const unlocked = !!game.unlockedCharacters[id];
      const active = character.active;
      const locked = !unlocked;
      const equipped = selected === id;
      const hpPct = Math.round(character.hpMult * 100);
      const speedPct = Math.round(character.speedMult * 100);
      const bodyPct = Math.round(character.bodyScale * 100);
      const drPct = Math.round((character.damageReduction || 0) * 100);
      const action = locked
        ? `<div class="character-lock"><span>需要 <b>${formatInt(character.cost)}</b> 代币</span><button class="btn btn-ghost" type="button" data-char-action="unlock" data-character-id="${id}">解锁</button></div>`
        : `<button class="character-select ${equipped ? 'is-equipped' : ''}" type="button" data-char-action="select" data-character-id="${id}" ${equipped ? 'disabled' : ''}>${equipped ? '使用中' : '选择该角色'}</button>`;
      return `<article class="character-card ${id} ${character.legendary ? 'is-legendary' : ''} ${locked ? 'is-locked' : ''} ${equipped ? 'is-selected' : ''}">
        <div class="character-avatar"><span class="character-portrait">${characterPortraitSVG(id)}</span><em>${character.code}</em></div>
        ${character.legendary ? '<span class="legendary-badge">传奇</span>' : ''}
        <span class="character-tag">${character.tag} // ${character.role}</span>
        <h3>${character.name}</h3>
        <span class="character-role">${character.passive}</span>
        <p class="character-desc">${character.desc}</p>
        <div class="character-abilities">
          <div class="character-ability"><b>被动</b><span>${character.passive}</span></div>
          <div class="character-ability"><b>主动${active ? (active.cooldown > 0 ? ` · 空格 · ${active.cooldown}s CD` : ' · 空格') : ''}</b><span>${active ? `${active.name}：${active.desc}` : '无主动技能'}</span></div>
        </div>
        <div class="character-stats">
          <span>生命 <b>${hpPct}%</b></span><span>移速 <b>${speedPct}%</b></span>
          <span>体型 <b>${bodyPct}%</b></span><span>减伤 <b>${drPct}%</b></span>
        </div>
        <div class="character-card-foot">${action}</div>
      </article>`;
    }).join('');
    setText(dom.characterTokenCount, tokenText);
    setText(dom.characterCurrent, CHARACTER_DEFS[selected]?.name || '阿兰');
  }

  function petArtSVG(id) {
    if (id === 'liangwu') {
      return `<svg viewBox="0 0 160 120" role="img" aria-label="蓝色小猫凉屋">
        <ellipse cx="82" cy="108" rx="45" ry="7" fill="rgba(0,0,0,.35)"/>
        <path d="M116 72 Q148 50 136 27 Q130 18 120 25 Q127 42 111 58Z" fill="#6cc9ee" stroke="#b6f0ff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M54 62 Q38 79 47 103 Q53 117 69 105 Q60 90 70 73Z" fill="#4f9fd2"/>
        <ellipse cx="82" cy="80" rx="34" ry="27" fill="#67c4ed" stroke="#b6f0ff" stroke-width="2"/>
        <path d="M52 55 L43 25 L70 38Z" fill="#5fb9e4" stroke="#b6f0ff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M110 55 L124 24 L96 37Z" fill="#5fb9e4" stroke="#b6f0ff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M49 34 L55 47 L65 41Z" fill="#e79ac1" opacity=".7"/>
        <path d="M118 33 L108 46 L99 39Z" fill="#e79ac1" opacity=".7"/>
        <circle cx="82" cy="55" r="30" fill="#73ceef" stroke="#b6f0ff" stroke-width="2"/>
        <path d="M64 53 Q69 48 74 53" fill="none" stroke="#123a4d" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M91 53 Q96 48 101 53" fill="none" stroke="#123a4d" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M79 62 L85 62 L82 66Z" fill="#e88ba8"/>
        <path d="M82 66 Q77 72 72 68 M82 66 Q87 72 92 68" fill="none" stroke="#1e5268" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M52 64 L34 59 M53 70 L32 70 M54 76 L36 81" stroke="#c9f7ff" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
        <path d="M110 64 L128 59 M109 70 L130 70 M108 76 L126 81" stroke="#c9f7ff" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
        <path d="M56 91 Q82 101 108 91" fill="none" stroke="#3c7da3" stroke-width="3"/>
        <path d="M82 94 L82 79" stroke="#ffcf6b" stroke-width="2"/>
        <circle cx="82" cy="95" r="4" fill="#ffcf6b" stroke="#fff1bd" stroke-width="1.2"/>
      </svg>`;
    }
    if (id === 'wangcai') {
      return `<svg viewBox="0 0 160 120" role="img" aria-label="黄色柴犬旺财">
        <ellipse cx="82" cy="108" rx="46" ry="7" fill="rgba(0,0,0,.35)"/>
        <path d="M116 72 Q145 56 138 31 Q132 23 124 31 Q128 48 110 60Z" fill="#d99d37" stroke="#ffe6a1" stroke-width="2" stroke-linejoin="round"/>
        <path d="M54 69 Q42 88 52 103 Q62 114 74 101 Q63 88 71 74Z" fill="#c8872d"/>
        <ellipse cx="82" cy="82" rx="34" ry="26" fill="#e9b74e" stroke="#ffe6a1" stroke-width="2"/>
        <path d="M53 60 L47 27 L74 42Z" fill="#d99d37" stroke="#ffe6a1" stroke-width="2" stroke-linejoin="round"/>
        <path d="M111 60 L122 27 L95 42Z" fill="#d99d37" stroke="#ffe6a1" stroke-width="2" stroke-linejoin="round"/>
        <path d="M50 36 L57 49 L67 41Z" fill="#edb6a0" opacity=".75"/>
        <path d="M118 36 L108 49 L99 41Z" fill="#edb6a0" opacity=".75"/>
        <circle cx="82" cy="57" r="30" fill="#efbd55" stroke="#ffe6a1" stroke-width="2"/>
        <path d="M62 51 Q69 47 76 54 Q69 59 62 55Z" fill="#5a351f"/>
        <path d="M88 51 Q95 47 102 54 Q95 59 88 55Z" fill="#5a351f"/>
        <circle cx="69" cy="53" r="2.5" fill="#fff5d6"/><circle cx="95" cy="53" r="2.5" fill="#fff5d6"/>
        <path d="M76 66 Q82 62 88 66 Q88 72 82 73 Q76 72 76 66Z" fill="#4a2b1b"/>
        <path d="M82 73 Q78 79 73 75 M82 73 Q86 79 91 75" fill="none" stroke="#5a351f" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M62 56 Q55 63 58 71 M102 56 Q109 63 106 71" fill="none" stroke="#fff1bd" stroke-width="1.1" opacity=".5"/>
        <path d="M55 91 Q82 104 109 91" fill="none" stroke="#b27a25" stroke-width="3"/>
        <path d="M82 95 L82 80" stroke="#3ca98f" stroke-width="2.2"/>
        <circle cx="82" cy="96" r="4" fill="#3ca98f" stroke="#a5ffe8" stroke-width="1.1"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 160 120" role="img" aria-label="悬浮支援机器人浮游炮">
      <ellipse cx="82" cy="107" rx="34" ry="7" fill="rgba(0,0,0,.32)"/>
      <circle cx="82" cy="64" r="35" fill="#1b2a30" stroke="#ffc078" stroke-width="2"/>
      <circle cx="82" cy="64" r="24" fill="#0b1418" stroke="#9fdfff" stroke-width="1.5"/>
      <path d="M82 44 L96 64 L82 84 L68 64Z" fill="rgba(255,151,94,.15)" stroke="#ffb36a" stroke-width="1.5"/>
      <circle cx="82" cy="64" r="9" fill="#ff9b57" opacity=".9"/>
      <circle cx="82" cy="64" r="4" fill="#fff1cd"/>
      <path d="M44 62 L25 55" stroke="#8fb6c2" stroke-width="4" stroke-linecap="round"/>
      <path d="M120 62 L139 55" stroke="#8fb6c2" stroke-width="4" stroke-linecap="round"/>
      <rect x="28" y="45" width="18" height="8" rx="3" fill="#364a51" stroke="#ffbd7c" stroke-width="1"/>
      <rect x="118" y="45" width="18" height="8" rx="3" fill="#364a51" stroke="#ffbd7c" stroke-width="1"/>
      <path d="M43 94 L55 104 L76 104 M121 94 L109 104 L88 104" fill="none" stroke="#587780" stroke-width="2"/>
      <circle cx="82" cy="28" r="6" fill="none" stroke="#a8ecff" stroke-width="2"/>
      <path d="M82 22 L82 10 M76 25 L68 16 M88 25 L96 16" stroke="#a8ecff" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M57 42 Q82 34 107 42" fill="none" stroke="#ffd7a2" stroke-width="1.2" opacity=".7"/>
      <circle cx="51" cy="105" r="2" fill="#ffb36a"/><circle cx="113" cy="105" r="2" fill="#ffb36a"/>
    </svg>`;
  }

  function renderPets() {
    const selected = game.selectedPet || '';
    const tokenText = formatInt(game.characterTokens);
    dom.petGrid.innerHTML = PET_ORDER.map((id) => {
      const pet = PET_DEFS[id];
      const owned = !!game.unlockedPets[id];
      const equipped = selected === id;
      const action = owned
        ? `<div class="pet-card-actions"><button class="character-select ${equipped ? 'is-equipped' : ''}" type="button" data-pet-action="select" data-pet-id="${id}" ${equipped ? 'disabled' : ''}>${equipped ? '携带中' : '携带该宠物'}</button><button class="btn btn-text pet-none" type="button" data-pet-action="unequip">卸下</button></div>`
        : `<div class="pet-lock"><span>需要 <b>${formatInt(pet.cost)}</b> 代币</span><button class="btn btn-ghost" type="button" data-pet-action="unlock" data-pet-id="${id}">购买</button></div>`;
      return `<article class="pet-card ${pet.type} ${owned ? '' : 'is-locked'} ${equipped ? 'is-equipped' : ''}">
        <div class="pet-avatar"><span>${petArtSVG(id)}</span><em>${pet.code}</em></div>
        <h3>${pet.name}</h3>
        <span class="pet-effect">${pet.effect}</span>
        <p>${pet.desc}</p>
        <div class="pet-meta"><span>${owned ? '已拥有' : '未拥有'}</span><b>${equipped ? '跟随中' : owned ? '可携带' : `${formatInt(pet.cost)} TOKEN`}</b></div>
        <div class="pet-card-foot">${action}</div>
      </article>`;
    }).join('');
    setText(dom.characterTokenCount, tokenText);
    setText(dom.petCurrent, selected ? PET_DEFS[selected]?.name || '未携带' : '未携带');
  }

  function setRosterTab(tab = 'characters') {
    const target = tab === 'pets' ? 'pets' : 'characters';
    game.rosterTab = target;
    document.querySelectorAll('[data-roster-tab]').forEach((btn) => {
      const active = btn.dataset.rosterTab === target;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    dom.characterGrid.classList.toggle('is-hidden', target !== 'characters');
    dom.petGrid.classList.toggle('is-hidden', target !== 'pets');
    if (target === 'pets') renderPets();
    else renderCharacters();
  }

  function openRoster() {
    renderCharacters();
    renderPets();
    setRosterTab(game.rosterTab || 'characters');
    setText(dom.characterTokenCount, formatInt(game.characterTokens));
  }

  function selectPet(id) {
    if (!PET_DEFS[id]) return;
    if (!game.unlockedPets[id]) {
      unlockPet(id);
      return;
    }
    game.selectedPet = id;
    storeString('labzero.selectedPet', id);
    renderPets();
    renderCharacters();
    Sfx.click();
    addToast('◆', `${PET_DEFS[id].name} 已携带`, '宠物将在下一局跟随出战 · 提供对应增益', 'gold', 4200);
  }

  function unlockPet(id) {
    const pet = PET_DEFS[id];
    if (!pet) return;
    if (game.unlockedPets[id]) {
      selectPet(id);
      return;
    }
    if (game.characterTokens < pet.cost) {
      Sfx.error();
      addToast('!', '角色代币不足', `${pet.name} 需要 ${formatInt(pet.cost)} 代币，当前 ${formatInt(game.characterTokens)}`, 'danger', 3200);
      return;
    }
    game.characterTokens -= pet.cost;
    game.unlockedPets[id] = true;
    game.selectedPet = id;
    storeNumber('labzero.characterTokens', game.characterTokens);
    storeString('labzero.pets', JSON.stringify(game.unlockedPets));
    storeString('labzero.selectedPet', id);
    Sfx.upgrade();
    addToast('◆', `已购买宠物 ${pet.name}`, `-${formatInt(pet.cost)} 角色代币 · 已设置跟随出战`, 'gold', 4200);
    renderPets();
    renderCharacters();
  }

  function selectCharacter(id) {
    if (!CHARACTER_DEFS[id]) return;
    if (!game.unlockedCharacters[id]) {
      unlockCharacter(id);
      return;
    }
    game.selectedCharacter = id;
    storeString('labzero.selectedCharacter', id);
    renderCharacters();
    updateCharacterTokenUI();
    updateSpeedUI();
    syncMenuCheckpointUI();
    window.addEventListener('pagehide', () => saveEndlessCheckpoint(true));
    Sfx.click();
  }

  function unlockCharacter(id) {
    const character = CHARACTER_DEFS[id];
    if (!character || game.unlockedCharacters[id]) {
      if (character) selectCharacter(id);
      return;
    }
    if (game.characterTokens < character.cost) {
      Sfx.error();
      addToast('!', '角色代币不足', `${character.name} 需要 ${formatInt(character.cost)} 代币，当前 ${formatInt(game.characterTokens)}`, 'danger', 3200);
      return;
    }
    game.characterTokens -= character.cost;
    game.unlockedCharacters[id] = true;
    game.selectedCharacter = id;
    storeNumber('labzero.characterTokens', game.characterTokens);
    storeString('labzero.selectedCharacter', id);
    saveCharacterUnlocks();
    Sfx.upgrade();
    addToast('◆', `已解锁 ${character.name}`, `-${formatInt(character.cost)} 角色代币 · 已编入下一局小队`, 'gold', 3800);
    renderCharacters();
    updateCharacterTokenUI();
  }

  function awardCharacterTokens(amount, key, label) {
    if (!amount || !key || game.claimedCharacterRewards.includes(key)) return false;
    const gained = Math.max(1, Math.round(amount * petTokenMultiplier()));
    game.claimedCharacterRewards.push(key);
    game.characterTokens += gained;
    storeNumber('labzero.characterTokens', game.characterTokens);
    storeString('labzero.characterRewards', JSON.stringify(game.claimedCharacterRewards));
    updateCharacterTokenUI();
    addToast('◆', `角色代币 +${gained}`, `${label} · 可在主菜单「角色 / 宠物」中解锁`, 'gold', 6200);
    return true;
  }

  function reconcileCharacterRewards() {
    let changed = false;
    for (const kind of Object.keys(CHARACTER_REWARD_DEFS)) {
      for (const tier of CHARACTER_REWARD_DEFS[kind].tiers) {
        if (game.claimedCharacterRewards.includes(tier.key)) continue;
        let reached = false;
        if (kind === 'campaign') {
          reached = (game.campaignRecord?.byDifficulty?.[tier.difficulty]?.clears || 0) > 0;
        } else if (kind === 'rogue') {
          reached = (game.rogueRecord?.byDifficulty?.[tier.difficulty]?.bestFloor || 0) >= tier.floor;
        } else if (kind === 'endless') {
          reached = (game.bestStats?.[tier.difficulty] || 0) >= tier.wave;
        }
        if (!reached) continue;
        game.claimedCharacterRewards.push(tier.key);
        game.characterTokens += Math.max(1, Math.round(tier.amount * petTokenMultiplier()));
        changed = true;
      }
    }
    if (changed) {
      storeNumber('labzero.characterTokens', game.characterTokens);
      storeString('labzero.characterRewards', JSON.stringify(game.claimedCharacterRewards));
      updateCharacterTokenUI();
    }
  }

  function claimCharacterProgress(kind) {
    const diff = getDifficultyConfig().id;
    const defs = CHARACTER_REWARD_DEFS[kind];
    if (!defs) return 0;
    let gained = 0;
    for (const tier of defs.tiers) {
      if (tier.difficulty !== diff) continue;
      let reached = false;
      if (kind === 'campaign') {
        reached = (game.campaignRecord?.byDifficulty?.[diff]?.clears || 0) > 0;
      } else if (kind === 'rogue') {
        reached = (game.rogueRecord?.byDifficulty?.[diff]?.bestFloor || 0) >= tier.floor;
      } else if (kind === 'endless') {
        reached = (game.bestStats?.[diff] || 0) >= tier.wave;
      }
      if (reached && awardCharacterTokens(tier.amount, tier.key, tier.label)) gained += tier.amount;
    }
    return gained;
  }

  function renderBestiary() {
    const filter = game.bestiaryFilter || 'all';
    document.querySelectorAll('[data-bestiary-filter]').forEach((btn) => {
      const active = btn.dataset.bestiaryFilter === filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const entries = BESTIARY.filter((entry) => filter === 'all' || entry.system === filter);
    dom.bestiaryGrid.innerHTML = entries.map((entry) => `<article class="bestiary-card">
      <div class="bestiary-card-top">
        <span class="bestiary-icon">${entry.icon}</span>
        <div><h3>${entry.name}</h3><span class="enemy-code">${entry.code}</span></div>
        <em class="threat-tag">${entry.threat}</em>
      </div>
      <p class="bestiary-desc">${entry.desc}</p>
      <div class="bestiary-stats"><span>生命<b>${entry.hp}</b></span><span>移速<b>${entry.speed}</b></span><span>伤害<b>${entry.damage}</b></span></div>
      <div class="bestiary-trait">${entry.trait}</div>
    </article>`).join('');
    setText(dom.bestiaryCount, entries.length);
  }

  function openCharacters() {
    if (game.mode !== 'menu') return;
    reconcileCharacterRewards();
    game.mode = 'characters';
    openRoster();
    dom.charactersOverlay.classList.remove('is-hidden');
    Sfx.init();
    Sfx.click();
    dom.btnCharactersClose.focus({ preventScroll: true });
  }

  function closeCharacters() {
    if (game.mode !== 'characters') return;
    dom.charactersOverlay.classList.add('is-hidden');
    game.mode = 'menu';
    updateBestUI();
    Sfx.click();
    dom.btnMenuCharacters.focus({ preventScroll: true });
  }

  function openBestiary() {
    if (game.mode !== 'menu') return;
    game.mode = 'bestiary';
    renderBestiary();
    dom.bestiaryOverlay.classList.remove('is-hidden');
    Sfx.init();
    Sfx.click();
    dom.btnBestiaryClose.focus({ preventScroll: true });
  }

  function closeBestiary() {
    if (game.mode !== 'bestiary') return;
    dom.bestiaryOverlay.classList.add('is-hidden');
    game.mode = 'menu';
    Sfx.click();
    dom.btnMenuBestiary.focus({ preventScroll: true });
  }

  function applyQualityClass() {
    document.body.dataset.quality = game.quality;
    document.body.classList.toggle('quality-low', game.quality === 'low');
    document.body.classList.toggle('quality-medium', game.quality === 'medium');
  }

  function updateSettingsAudioUI() {
    if (!dom.settingsSfx) return;
    const audio = Sfx.getAudioSettings();
    dom.settingsSfx.value = String(Math.round(audio.sfxVolume * 100));
    dom.settingsMusic.value = String(Math.round(audio.musicVolume * 100));
    setText(dom.settingsSfxValue, `${Math.round(audio.sfxVolume * 100)}%`);
    setText(dom.settingsMusicValue, `${Math.round(audio.musicVolume * 100)}%`);
    dom.settingsMute.classList.toggle('is-muted', audio.muted);
    dom.settingsMute.setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
    setText(dom.settingsMuteLabel, audio.muted ? '声音已静音' : '声音已开启');
  }

  function updateSettingsQualityUI() {
    const quality = QUALITY_SETTINGS[game.quality] || QUALITY_SETTINGS.high;
    document.querySelectorAll('[data-quality]').forEach((btn) => {
      const active = btn.dataset.quality === quality.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (dom.settingsQualityNote) setText(dom.settingsQualityNote, `当前：${quality.name} · ${quality.desc}`);
    if (dom.settingsRenderScale) {
      const actual = Math.min(quality.dprCap, Math.max(1, window.devicePixelRatio || 1));
      setText(dom.settingsRenderScale, `DPR ${actual.toFixed(1)}× / CAP ${quality.dprCap.toFixed(1)}×`);
    }
  }

  function setSettingsTab(tab) {
    const valid = ['audio', 'graphics', 'keys', 'guide', 'developer'];
    const target = valid.includes(tab) ? tab : 'audio';
    game.settingsTab = target;
    document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const active = btn.dataset.settingsTab === target;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.settingsPanel === target);
    });
  }

  function updateSettingsUI() {
    setSettingsTab(game.settingsTab || 'audio');
    updateSettingsAudioUI();
    updateSettingsQualityUI();
    updateDeveloperSettingsUI();
  }

  function updateDeveloperSettingsUI() {
    const active = isDeveloperMode();
    dom.developerCard?.classList.toggle('is-active', active);
    setText(dom.devModeState, active ? '开发者模式已启用' : '开发者模式未启用');
    setText(dom.devModeBadge, active ? 'ON' : 'OFF');
    if (dom.devPassword) dom.devPassword.disabled = active;
    if (dom.btnDevEnable) {
      dom.btnDevEnable.disabled = active;
      dom.btnDevEnable.textContent = active ? '已启用' : '验证并启用';
    }
    if (dom.btnDevDisable) dom.btnDevDisable.disabled = !active;
    if (dom.devMessage && !dom.devMessage.dataset.locked) {
      dom.devMessage.textContent = active
        ? '全部武器、科技树、角色与无限资源已启用。'
        : '输入密码后解锁全部武器、科技树、角色与无限资源。';
      dom.devMessage.classList.remove('is-error');
      dom.devMessage.classList.toggle('is-ok', active);
    }
  }

  function enableDeveloperMode() {
    const entered = (dom.devPassword?.value || '').trim().toLowerCase();
    if (entered !== DEVELOPER_PASSWORD) {
      Sfx.error();
      if (dom.devMessage) {
        dom.devMessage.textContent = '访问密码错误 · 请重新输入';
        dom.devMessage.classList.add('is-error');
        dom.devMessage.classList.remove('is-ok');
        dom.devMessage.dataset.locked = '1';
      }
      addToast('DEV', '访问被拒绝', '开发者密码错误', 'danger', 2600);
      dom.devPassword?.focus({ preventScroll: true });
      return;
    }
    setDeveloperMode(true);
    applyDeveloperUnlocks();
    applyDeveloperPerks(game.player);
    if (game.campaign?.explored) game.campaign.explored.fill(1);
    if (dom.devPassword) dom.devPassword.value = '';
    if (dom.devMessage) {
      delete dom.devMessage.dataset.locked;
      dom.devMessage.textContent = '开发者模式已启用 · 全部装备与资源已接入。';
      dom.devMessage.classList.remove('is-error');
      dom.devMessage.classList.add('is-ok');
    }
    updateCharacterTokenUI();
    updateDeveloperSettingsUI();
    if (game.player) {
      updateWeaponDock();
      updateHUD();
      if (game.mode === 'talents') renderTalents();
    }
    Sfx.upgrade();
    addToast('DEV', '开发者模式已启用', '全部武器 / 科技树 / 角色已解锁 · 无限弹药 / 视野 / 投掷物', 'gold', 6000);
  }

  function disableDeveloperMode() {
    if (!isDeveloperMode()) return;
    setDeveloperMode(false);
    if (game.selectedCharacter === 'valkyrie') {
      game.selectedCharacter = 'alan';
      storeString('labzero.selectedCharacter', 'alan');
    }
    if (dom.devMessage) {
      dom.devMessage.textContent = '能力增益已关闭 · 已解锁的武器、科技树与角色保留。';
      dom.devMessage.classList.remove('is-error', 'is-ok');
      dom.devMessage.dataset.locked = '1';
    }
    updateDeveloperSettingsUI();
    if (game.player) updateHUD();
    Sfx.click();
    addToast('DEV', '开发者能力增益已关闭', '已解锁内容保留 · 无限弹药与无限视野停止生效', '', 4200);
  }

  function setQuality(id) {
    if (!QUALITY_SETTINGS[id] || game.quality === id) return;
    game.quality = id;
    storeString('labzero.quality', id);
    applyQualityClass();
    resizeCanvas();
    updateSettingsQualityUI();
    Sfx.click();
  }

  function openSettings() {
    if (game.mode !== 'playing' && game.mode !== 'menu') return;
    game.settingsReturnMode = game.mode;
    game.mode = 'settings';
    const fromMenu = game.settingsReturnMode === 'menu';
    setText(dom.btnSettingsBack, fromMenu ? '返回主菜单' : '返回战斗');
    if (dom.settingsFootHint) {
      dom.settingsFootHint.innerHTML = fromMenu
        ? '<kbd>ESC</kbd> 返回主菜单 · 所有设置自动保存'
        : '<kbd>ESC</kbd> 返回战斗 · 所有设置自动保存';
    }
    game.hitFlash = 0;
    dom.hitFlash.style.opacity = '0';
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    Sfx.init();
    updateSettingsUI();
    dom.settingsOverlay.classList.remove('is-hidden');
    Sfx.click();
    dom.btnSettingsClose.focus({ preventScroll: true });
  }

  function closeSettings() {
    if (game.mode !== 'settings') return;
    dom.settingsOverlay.classList.add('is-hidden');
    const target = game.settingsReturnMode === 'menu' ? 'menu' : 'playing';
    game.mode = target;
    game.lastFrame = performance.now();
    Sfx.click();
    if (target === 'menu') {
      updateBestUI();
      dom.menu.classList.remove('is-hidden');
      dom.btnMenuSettings.focus({ preventScroll: true });
    } else {
      dom.canvas.focus?.({ preventScroll: true });
    }
  }

  function openPause() {
    if (game.mode !== 'playing') return;
    game.mode = 'paused';
    game.hitFlash = 0;
    dom.hitFlash.style.opacity = '0';
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    updatePauseStats();
    dom.pauseOverlay.classList.remove('is-hidden');
    Sfx.click();
    dom.btnResume.focus({ preventScroll: true });
  }

  function resumeGame() {
    if (game.mode !== 'paused') return;
    dom.pauseOverlay.classList.add('is-hidden');
    game.mode = 'playing';
    game.lastFrame = performance.now();
    Sfx.click();
  }

  function returnToMenu() {
    if (game.runMode === 'story') {
      const story = game.story;
      clearStoryTyping();
      if (story?.previousCharacter) game.selectedCharacter = story.previousCharacter;
      if (story?.previousDifficulty) game.difficulty = story.previousDifficulty;
      game.story = null;
      dom.storyOverlay.classList.add('is-hidden');
      document.body.classList.remove('story-mode', 'story-combat');
    }
    if (game.runMode === 'endless' && game.player?.alive && !['dying', 'gameover', 'campaignComplete'].includes(game.mode)) {
      saveEndlessCheckpoint(true);
    }
    game.mode = 'menu';
    game.campaign.active = false;
    game.runMode = 'endless';
    document.body.classList.remove('campaign-mode');
    document.documentElement.style.removeProperty('--campaign-accent');
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    game.player = null;
    game.pet = null;
    game.bossRef = null;
    game.turrets = [];
    game.enemies = [];
    game.bullets = [];
    game.playerMissiles = [];
    game.enemyBullets = [];
    game.enemyRockets = [];
    game.enemyTurrets = [];
    game.campaignHazards = [];
    game.campaign.searchTarget = null;
    game.campaign.searchTimer = 0;
    game.campaign.searchFxTimer = 0;
    game.campaign.arenaLocked = false;
    game.coins = [];
    game.pickups = [];
    game.particles = [];
    game.casings = [];
    game.texts = [];
    game.decals = [];
    game.portals = [];
    game.spawnQueue = [];
    game.intermission = false;
    game.waveActive = false;
    game.shake = 0;
    game.damageFlash = 0;
    game.hitFlash = 0;
    clearToasts();
    hideAllOverlaysForRun();
    dom.menu.classList.remove('is-hidden', 'is-closing');
    dom.hud.classList.add('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.intermission.classList.add('is-hidden');
    dom.talentOverlay.classList.add('is-hidden');
    dom.reviveHud.classList.add('is-hidden');
    dom.campaignComplete.classList.add('is-hidden');
    document.body.classList.remove('in-game', 'low-hp', 'training-mode');
    dom.trainingPanel?.classList.add('is-hidden');
    game.training = null;
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    activateStandardWorld();
    applyRunModeUI();
    updateBestUI();
    syncMenuModeUI();
    game.mode = 'menu';
    game.menuClock = 0;
  }

  function restartRun() {
    dom.pauseOverlay.classList.add('is-hidden');
    dom.settingsOverlay.classList.add('is-hidden');
    dom.charactersOverlay.classList.add('is-hidden');
    dom.bestiaryOverlay.classList.add('is-hidden');
    dom.gameover.classList.add('is-hidden');
    if (game.runMode === 'story') {
      if (game.story?.currentCombat) retryStoryCombat();
      else startStoryMode(false);
    }
    else if (game.runMode === 'campaign' && game.campaign.rogue) startRogueRun(false, false);
    else if (game.runMode === 'campaign') startCampaignRun(0, false, false);
    else if (game.runMode === 'training') startTrainingRun(false);
    else startRun(false);
  }

  function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        dom.root.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch (_) {
      /* ignore unsupported fullscreen */
    }
    Sfx.click();
  }

  /* ------------------------------------------------------------
     Player actions and combat
     ------------------------------------------------------------ */
  function findAutoAimTarget(p) {
    let target = null;
    let best = 780;
    for (const e of game.enemies) {
      if (e.dead || e.spawnTimer > 0) continue;
      const d = dist(p.x, p.y, e.x, e.y);
      if (d >= best) continue;
      if (!hasLineOfSight(p.x, p.y, e.x, e.y)) continue;
      best = d;
      target = e;
    }
    return target;
  }

  function updateAimFromMouse() {
    input.aimWorldX = game.camera.x + input.screenX / CAMERA_ZOOM;
    input.aimWorldY = game.camera.y + input.screenY / CAMERA_ZOOM;
    if (game.player && game.player.alive) {
      let angle = Math.atan2(input.aimWorldY - game.player.y, input.aimWorldX - game.player.x);
      game.autoAimTarget = null;
      if (hasTalent('intelligenceCore') && game.autoAimEnabled) {
        const target = findAutoAimTarget(game.player);
        if (target) {
          angle = Math.atan2(target.y - game.player.y, target.x - game.player.x);
          game.autoAimTarget = target;
        }
      }
      game.player.aimAngle = angle;
    }
  }

  function handWeaponId(hand = 'main') {
    const p = game.player;
    if (!p) return null;
    if (hand === 'offhand') return hasTalent('dualWield') ? p.offhand : null;
    return p.weapon;
  }

  function currentGunMuzzle(angle, hand = 'main') {
    const p = game.player;
    const id = handWeaponId(hand) || p.weapon;
    const w = WEAPONS[id];
    const offset = hand === 'offhand' ? -4 : 4;
    return {
      x: p.x + Math.cos(angle) * w.gunLength + Math.cos(angle + Math.PI / 2) * offset,
      y: p.y + Math.sin(angle) * w.gunLength + Math.sin(angle + Math.PI / 2) * offset,
    };
  }

  function startDash() {
    const p = game.player;
    if (!p || !p.alive || p.reviving || game.mode !== 'playing' || p.dashCooldown > 0 || p.dashTimer > 0) return;
    let dx = 0;
    let dy = 0;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) dy -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) dy += 1;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) dx -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) dx += 1;
    if (!dx && !dy) {
      dx = Math.cos(p.aimAngle);
      dy = Math.sin(p.aimAngle);
    }
    const len = Math.hypot(dx, dy) || 1;
    p.dashDirX = dx / len;
    p.dashDirY = dy / len;
    p.dashTimer = DASH_TIME;
    p.dashCooldown = DASH_COOLDOWN;
    p.invuln = Math.max(p.invuln, 0.2);
    game.shake = Math.max(game.shake, 2.3);
    Sfx.dash();
    for (let i = 0; i < 8; i += 1) {
      addParticle({
        type: 'dust',
        x: p.x + rand(-8, 8),
        y: p.y + rand(-8, 8),
        vx: -p.dashDirX * rand(30, 100) + rand(-20, 20),
        vy: -p.dashDirY * rand(30, 100) + rand(-20, 20),
        life: rand(0.2, 0.42),
        size: rand(4, 10),
        color: '112, 235, 245',
        drag: 3,
        alpha: 0.2,
      });
    }
  }

  function throwGrenade() {
    const p = game.player;
    if (!p || !p.alive || p.reviving || game.mode !== 'playing' || p.grenadeCooldown > 0) return;
    const id = p.selectedGrenade || 'frag';
    const def = GRENADES[id];
    if (!def) return;
    const devInfinite = isDeveloperMode();
    const stock = p.grenades[id] || 0;
    if (!devInfinite && stock <= 0) {
      Sfx.error();
      if (game.time - (p.grenadeWarnAt || -10) > 2.2) {
        p.grenadeWarnAt = game.time;
        addToast('Q', `${def.name}已用尽`, '打开军械库（B）补充投掷装备', 'danger', 3000);
      }
      return;
    }
    const aimX = game.camera.x + input.screenX / CAMERA_ZOOM;
    const aimY = game.camera.y + input.screenY / CAMERA_ZOOM;
    let angle = Math.atan2(aimY - p.y, aimX - p.x);
    if (!Number.isFinite(angle)) angle = p.aimAngle;
    const desired = clamp(dist(p.x, p.y, aimX, aimY), 95, 440);
    const maxThrow = hasTalent('grenadeVolley') ? 2 : 1;
    const throwCount = devInfinite ? maxThrow : Math.min(maxThrow, stock);
    p.aimAngle = angle;
    p.grenadeCooldown = 0.8;
    for (let i = 0; i < throwCount; i += 1) {
      const offset = throwCount > 1 ? (i - (throwCount - 1) / 2) * 0.14 : 0;
      const throwAngle = angle + offset;
      let landing = null;
      for (let d = desired; d >= 65; d -= 24) {
        const x = clamp(p.x + Math.cos(throwAngle) * d, WORLD.pad + 22, WORLD.w - WORLD.pad - 22);
        const y = clamp(p.y + Math.sin(throwAngle) * d, WORLD.pad + 22, WORLD.h - WORLD.pad - 22);
        if (!isPositionBlocked(x, y, 8)) {
          landing = { x, y, distance: d };
          break;
        }
      }
      if (!landing) {
        landing = {
          x: p.x + Math.cos(throwAngle) * 58,
          y: p.y + Math.sin(throwAngle) * 58,
          distance: 58,
        };
      }
      if (!devInfinite) p.grenades[id] = Math.max(0, (p.grenades[id] || 0) - 1);
      const startX = p.x + Math.cos(throwAngle) * 16;
      const startY = p.y + Math.sin(throwAngle) * 16;
      game.grenades.push({
        type: id,
        x: startX,
        y: startY,
        startX,
        startY,
        targetX: landing.x,
        targetY: landing.y,
        t: 0,
        flight: 0.52 + Math.min(0.28, landing.distance / 1400),
        fuse: def.fuse,
        z: 0,
        spin: rand(0, TAU),
        spinSpeed: rand(-9, 9),
        landed: false,
        dead: false,
        refunded: false,
      });
    }
    game.shake = Math.max(game.shake, throwCount > 1 ? 2.6 : 1.4);
    Sfx.grenadeThrow();
    if (throwCount > 1) addText(p.x, p.y - 30, `多重投掷 ×${throwCount}`, '255, 198, 112', 0.85, 11, -24);
    updateHUD();
  }

  function grenadeMaxStock(id, player = game?.player) {
    const def = GRENADES[id];
    return (def?.max || 0) + (player?.talents?.grenadeCapacity ? 3 : 0);
  }

  function grenadeDamageMultiplier() {
    return hasTalent('grenadeDamage') ? 1.35 : 1;
  }

  function grenadeRadiusMultiplier() {
    return hasTalent('grenadeRadius') ? 1.25 : 1;
  }

  function grenadeBlastFalloff(distance, radius) {
    return clamp(1 - 0.55 * (distance / Math.max(1, radius)), 0.4, 1);
  }

  function explodeGrenade(grenade) {
    if (grenade.dead) return;
    const def = GRENADES[grenade.type];
    if (!def) return;
    const x = grenade.targetX;
    const y = grenade.targetY;
    const radius = def.radius * grenadeRadiusMultiplier();
    const damageScale = grenadeDamageMultiplier();
    let hitCount = 0;
    grenade.dead = true;

    if (grenade.type === 'frag') {
      for (const e of game.enemies) {
        if (e.dead || e.spawnTimer > 0) continue;
        const d = dist(x, y, e.x, e.y);
        if (d > radius + e.radius * 0.25) continue;
        if (!hasLineOfSight(x, y, e.x, e.y)) continue;
        hitCount += 1;
        damageEnemy(e, def.damage * damageScale * grenadeBlastFalloff(d, radius), Math.atan2(e.y - y, e.x - x), e.x, e.y);
      }
      for (const turret of game.enemyTurrets) {
        if (turret.dead || turret.hp <= 0) continue;
        const d = dist(x, y, turret.x, turret.y);
        if (d > radius + (turret.r || 16)) continue;
        if (!hasLineOfSight(x, y, turret.x, turret.y)) continue;
        damageEnemyTurret(turret, def.damage * damageScale * grenadeBlastFalloff(d, radius), Math.atan2(turret.y - y, turret.x - x));
      }
      for (const b of game.enemyBullets) {
        if (!b.dead && dist(b.x, b.y, x, y) < radius * 0.8) b.dead = true;
      }
      game.shake = Math.max(game.shake, 10);
      game.flash = Math.max(game.flash || 0, 0.28);
      Sfx.explosion();
      game.portals.push({ x, y, life: 0.58, maxLife: 0.58, color: def.color, radius: radius * 1.25 });
      addParticle({ type: 'flash', x, y, life: 0.16, size: radius * 0.9, color: '255, 201, 135' });
      addParticle({ type: 'ring', x, y, life: 0.45, size: radius * 1.65, color: '255, 168, 91', alpha: 0.92 });
      for (let i = 0; i < 44; i += 1) {
        const a = rand(0, TAU);
        const speed = rand(70, 400);
        addParticle({
          type: i % 3 === 0 ? 'shard' : 'spark',
          x: x + rand(-8, 8),
          y: y + rand(-8, 8),
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: rand(0.22, 0.9),
          size: rand(1.2, 4.1),
          color: i % 4 === 0 ? '255, 242, 195' : i % 3 === 0 ? '255, 132, 72' : '255, 190, 106',
          rot: rand(0, TAU),
          spin: rand(-12, 12),
          drag: 2.5,
          gravity: 60,
          alpha: 0.9,
        });
      }
      for (let i = 0; i < 12; i += 1) {
        addParticle({
          type: 'smoke',
          x: x + rand(-radius * 0.4, radius * 0.4),
          y: y + rand(-radius * 0.4, radius * 0.4),
          vx: rand(-42, 42),
          vy: rand(-42, 42),
          life: rand(0.6, 1.4),
          size: rand(8, 24),
          color: i % 3 === 0 ? '109, 84, 69' : '71, 79, 78',
          alpha: 0.16,
          drag: 1.5,
        });
      }
      addDecal(x, y, rand(22, 34), 'scorch');
      addDecal(x, y, rand(12, 22), 'fluid');
    } else if (grenade.type === 'flash') {
      for (const e of game.enemies) {
        if (e.dead || e.spawnTimer > 0) continue;
        const d = dist(x, y, e.x, e.y);
        if (d > radius + e.radius) continue;
        if (!hasLineOfSight(x, y, e.x, e.y)) continue;
        hitCount += 1;
        const potency = e.type === 'boss' ? 0.38 : e.type === 'elite' ? 0.7 : 1;
        e.stunTimer = Math.max(e.stunTimer || 0, def.stun * potency);
        e.windup = 0;
        e.burstLeft = 0;
        e.summonWindup = 0;
        e.atkCd = Math.max(e.atkCd, 0.8);
        addText(e.x, e.y - e.radius - 12, '致盲', '197, 250, 255', 0.75, 10, -24);
      }
      game.flash = Math.max(game.flash || 0, 0.85);
      game.shake = Math.max(game.shake, 3.4);
      Sfx.flashbang();
      game.portals.push({ x, y, life: 0.5, maxLife: 0.5, color: '205, 253, 255', radius: radius * 1.3 });
      addParticle({ type: 'flash', x, y, life: 0.24, size: radius, color: '229, 255, 255' });
      addParticle({ type: 'ring', x, y, life: 0.42, size: radius * 1.55, color: '214, 252, 255', alpha: 0.95 });
      addParticle({ type: 'ring', x, y, life: 0.62, size: radius * 1.15, color: '255, 255, 255', alpha: 0.5 });
      for (let i = 0; i < 34; i += 1) {
        const a = rand(0, TAU);
        addParticle({
          type: 'spark',
          x: x + Math.cos(a) * rand(4, radius * 0.45),
          y: y + Math.sin(a) * rand(4, radius * 0.45),
          vx: Math.cos(a) * rand(60, 250),
          vy: Math.sin(a) * rand(60, 250),
          life: rand(0.18, 0.55),
          size: rand(1, 2.8),
          color: i % 2 === 0 ? '226, 255, 255' : '145, 235, 255',
          drag: 2.8,
          alpha: 0.9,
        });
      }
    } else if (grenade.type === 'incendiary') {
      for (const e of game.enemies) {
        if (e.dead || e.spawnTimer > 0) continue;
        if (dist(x, y, e.x, e.y) > radius + e.radius) continue;
        if (!hasLineOfSight(x, y, e.x, e.y)) continue;
        hitCount += 1;
      }
      game.fireZones.push({
        x,
        y,
        radius,
        life: def.duration,
        maxLife: def.duration,
        damage: def.damage * damageScale,
        tickTimer: 0.08,
      });
      game.flash = Math.max(game.flash || 0, 0.18);
      game.shake = Math.max(game.shake, 5.2);
      Sfx.fire();
      Sfx.explosion();
      game.portals.push({ x, y, life: 0.55, maxLife: 0.55, color: '255, 117, 62', radius: radius * 1.35 });
      addParticle({ type: 'flash', x, y, life: 0.18, size: radius, color: '255, 163, 83' });
      addParticle({ type: 'ring', x, y, life: 0.6, size: radius * 1.5, color: '255, 136, 75', alpha: 0.85 });
      for (let i = 0; i < 30; i += 1) {
        const a = rand(0, TAU);
        const speed = rand(40, 260);
        addParticle({
          type: 'spark',
          x: x + rand(-10, 10),
          y: y + rand(-10, 10),
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: rand(0.3, 0.95),
          size: rand(1.2, 3.4),
          color: i % 3 === 0 ? '255, 230, 145' : '255, 112, 54',
          drag: 2,
          gravity: 30,
          alpha: 0.85,
        });
      }
      addDecal(x, y, rand(16, 28), 'scorch');
    }
    if (hasTalent('grenadeFree') && hitCount >= 10 && !grenade.refunded && game.player) {
      grenade.refunded = true;
      const p = game.player;
      p.grenades[grenade.type] = Math.min(grenadeMaxStock(grenade.type), (p.grenades[grenade.type] || 0) + 1);
      addText(x, y - 34, '饱和轰炸 · 手雷不消耗', '255, 223, 130', 1.1, 11, -24);
      addToast('◆', '饱和轰炸触发', `单次命中 ${hitCount} 个敌人 · 返还 1 枚${def.name}`, 'gold', 3600);
    }
  }

  function updateGrenades(dt) {
    for (const g of game.grenades) {
      if (g.dead) continue;
      if (!g.landed) {
        g.t += dt;
        const t = clamp(g.t / Math.max(0.001, g.flight), 0, 1);
        g.x = lerp(g.startX, g.targetX, t);
        g.y = lerp(g.startY, g.targetY, t);
        g.z = Math.sin(t * Math.PI) * (44 + clamp(Math.hypot(g.targetX - g.startX, g.targetY - g.startY) * 0.07, 0, 18));
        g.spin += g.spinSpeed * dt;
        if (t >= 1) {
          g.landed = true;
          g.x = g.targetX;
          g.y = g.targetY;
          g.z = 0;
          game.shake = Math.max(game.shake, 1.1);
          for (let i = 0; i < 6; i += 1) {
            addParticle({
              type: 'dust',
              x: g.x + rand(-6, 6),
              y: g.y + rand(-5, 5),
              vx: rand(-25, 25),
              vy: rand(-20, 12),
              life: rand(0.2, 0.45),
              size: rand(2, 5),
              color: '131, 124, 108',
              drag: 2.4,
              alpha: 0.25,
            });
          }
        }
      } else {
        g.z = 0;
        g.fuse -= dt;
        if (Math.random() < dt * 28) {
          addParticle({
            type: 'spark',
            x: g.x + rand(-3, 3),
            y: g.y + rand(-3, 3),
            vx: rand(-28, 28),
            vy: rand(-50, -10),
            life: rand(0.18, 0.4),
            size: rand(0.8, 1.8),
            color: Math.sin(game.time * 30) > 0 ? '255, 245, 188' : '255, 109, 79',
            drag: 1.5,
            alpha: 0.9,
          });
        }
        if (g.fuse <= 0) {
          explodeGrenade(g);
        }
      }
    }
    game.grenades = game.grenades.filter((g) => !g.dead);
    updateFireZones(dt);
  }

  function updateFireZones(dt) {
    for (const zone of game.fireZones) {
      zone.life = Math.max(0, zone.life - dt);
      zone.tickTimer -= dt;
      if (zone.tickTimer <= 0) {
        const interval = zone.tickInterval || 0.38;
        zone.tickTimer += interval;
        const tickDamage = zone.dps ? zone.dps * interval : zone.damage;
        for (const e of game.enemies) {
          if (e.dead || e.spawnTimer > 0) continue;
          const d = dist(zone.x, zone.y, e.x, e.y);
          if (d > zone.radius + e.radius * 0.35) continue;
          if (!zone.ignoreWalls && !hasLineOfSight(zone.x, zone.y, e.x, e.y)) continue;
          damageEnemy(e, tickDamage, Math.atan2(e.y - zone.y, e.x - zone.x), e.x, e.y, true);
        }
        for (const turret of game.enemyTurrets) {
          if (turret.dead || turret.hp <= 0) continue;
          const d = dist(zone.x, zone.y, turret.x, turret.y);
          if (d > zone.radius + (turret.r || 16)) continue;
          if (!zone.ignoreWalls && !hasLineOfSight(zone.x, zone.y, turret.x, turret.y)) continue;
          damageEnemyTurret(turret, tickDamage, Math.atan2(turret.y - zone.y, turret.x - zone.x));
        }
      }
      if (Math.random() < dt * 36) {
        const a = rand(0, TAU);
        const r = rand(4, zone.radius);
        addParticle({
          type: Math.random() < 0.25 ? 'smoke' : 'spark',
          x: zone.x + Math.cos(a) * r,
          y: zone.y + Math.sin(a) * r,
          vx: rand(-14, 14),
          vy: rand(-68, -18),
          life: rand(0.35, 0.9),
          size: rand(1.2, Math.random() < 0.25 ? 11 : 4),
          color: Math.random() < 0.45 ? '255, 205, 112' : '255, 102, 51',
          drag: 1.1,
          alpha: 0.7,
        });
      }
    }
    compactInPlace(game.fireZones, (zone) => zone.life > 0);
  }

  function startReload(hand = 'both') {
    const p = game.player;
    if (!p || !p.alive || p.reviving) return;
    if (isDeveloperMode()) {
      for (const id of WEAPON_ORDER) p.ammo[id] = weaponCapacity(id, p.mods);
      p.reloading = false;
      p.offhandReloading = false;
      return;
    }
    const hands = hand === 'both' ? ['main', 'offhand'] : [hand];
    let started = false;
    for (const h of hands) {
      const id = handWeaponId(h);
      if (!id) continue;
      const reloading = h === 'offhand' ? p.offhandReloading : p.reloading;
      if (reloading) continue;
      const stats = getWeaponStats(id);
      if ((p.ammo[id] || 0) >= stats.capacity) continue;
      if (h === 'offhand') {
        p.offhandReloading = true;
        p.offhandReloadDuration = stats.reload;
        p.offhandReloadTimer = stats.reload;
        p.offhandPendingReload = 0;
      } else {
        p.reloading = true;
        p.reloadDuration = stats.reload;
        p.reloadTimer = stats.reload;
        p.pendingReload = 0;
      }
      started = true;
    }
    if (started) Sfx.reloadStart();
  }

  function updateReload(dt) {
    const p = game.player;
    if (isDeveloperMode()) {
      p.reloading = false;
      p.offhandReloading = false;
      p.reloadTimer = 0;
      p.offhandReloadTimer = 0;
      return;
    }
    if (p.reloading) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        const stats = getWeaponStats(p.weapon);
        p.ammo[p.weapon] = stats.capacity;
        p.reloading = false;
        p.reloadTimer = 0;
        p.reloadDuration = 0;
        Sfx.reloadEnd();
      }
    }
    if (p.offhandReloading && p.offhand) {
      p.offhandReloadTimer -= dt;
      if (p.offhandReloadTimer <= 0) {
        const stats = getWeaponStats(p.offhand);
        p.ammo[p.offhand] = stats.capacity;
        p.offhandReloading = false;
        p.offhandReloadTimer = 0;
        p.offhandReloadDuration = 0;
        Sfx.reloadEnd();
      }
    }
  }

  function tryShoot(hand = 'main') {
    const p = game.player;
    if (!p || !p.alive || p.reviving || game.mode !== 'playing') return;
    const offhand = hand === 'offhand';
    if (offhand && !hasTalent('dualWield')) return;
    const weaponId = offhand ? p.offhand : p.weapon;
    if (!weaponId) return;
    const cooldown = offhand ? p.offhandFireCooldown : p.fireCooldown;
    const reloading = offhand ? p.offhandReloading : p.reloading;
    const valkyrieRocket = p.characterId === 'valkyrie' && weaponId === 'rocket';
    if ((reloading && !valkyrieRocket) || cooldown > 0) return;
    const stats = getWeaponStats(weaponId);
    if (valkyrieRocket) {
      if (p.valkyrieRocketBurst > 0) return;
      p.reloading = false;
      p.reloadTimer = 0;
      p.offhandReloading = false;
      p.offhandReloadTimer = 0;
      p.ammo[weaponId] = stats.capacity;
      p.valkyrieRocketBurst = 3;
      p.valkyrieRocketBurstTimer = 0;
      p.fireCooldown = 0.32;
      if (offhand) p.offhandFireCooldown = 0.32;
      const muzzle = currentGunMuzzle(p.aimAngle, hand);
      if (offhand) {
        p.offhandShootFlash = 0.08;
        p.offhandMuzzleX = muzzle.x;
        p.offhandMuzzleY = muzzle.y;
      } else {
        p.shootFlash = 0.08;
        p.muzzleX = muzzle.x;
        p.muzzleY = muzzle.y;
      }
      spawnMuzzleEffect(muzzle.x, muzzle.y, p.aimAngle, '255, 190, 92', 'rocket');
      spawnCasing(p, p.aimAngle, hand);
      game.reticleBloom = Math.min(10, game.reticleBloom + 1.6);
      Sfx.shot('rocket');
      return;
    }
    const infiniteAmmo = isDeveloperMode();
    if (!infiniteAmmo && (p.ammo[weaponId] || 0) <= 0) {
      if (offhand) {
        if (p.offhandPendingReload <= 0) {
          p.offhandPendingReload = 0.16;
          Sfx.empty();
        }
      } else if (p.pendingReload <= 0) {
        p.pendingReload = 0.16;
        Sfx.empty();
      }
      return;
    }
    const angle = p.aimAngle;
    if (infiniteAmmo) p.ammo[weaponId] = stats.capacity;
    else p.ammo[weaponId] -= 1;
    if (offhand) {
      p.offhandFireCooldown = stats.base.fireDelay;
      p.offhandBloom = Math.min(5.6, p.offhandBloom + stats.bloom);
    } else {
      p.fireCooldown = stats.base.fireDelay;
      p.bloom = Math.min(5.6, p.bloom + stats.bloom);
    }
    game.reticleBloom = Math.min(10, game.reticleBloom + stats.bloom * 0.6);
    const muzzle = currentGunMuzzle(angle, hand);
    if (offhand) {
      p.offhandShootFlash = 0.065;
      p.offhandMuzzleX = muzzle.x;
      p.offhandMuzzleY = muzzle.y;
    } else {
      p.shootFlash = 0.065;
      p.muzzleX = muzzle.x;
      p.muzzleY = muzzle.y;
    }
    const localBloom = offhand ? p.offhandBloom : p.bloom;
    const totalSpread = rad(stats.spread + localBloom);
    const spreadJitter = (Math.random() + Math.random() - 1) * totalSpread;
    const bulletAngle = angle + spreadJitter;
    const speed = stats.base.bulletSpeed;
    const rocket = stats.projectile === 'rocket';
    game.bullets.push({
      kind: rocket ? 'rocket' : 'bullet',
      x: muzzle.x,
      y: muzzle.y,
      px: muzzle.x,
      py: muzzle.y,
      vx: Math.cos(bulletAngle) * speed,
      vy: Math.sin(bulletAngle) * speed,
      r: rocket ? 5 : 2.2,
      damage: stats.damage,
      splashDamage: stats.splashDamage,
      splashRadius: stats.splashRadius,
      range: stats.base.range,
      traveled: 0,
      color: stats.base.tracer,
      angle: bulletAngle,
      trailTimer: 0,
      dead: false,
      from: offhand ? 'offhand' : 'main',
    });
    game.shake = Math.min(11, game.shake + (rocket ? 2.4 : weaponId === 'lmg' ? 1.2 : weaponId === 'pistol' ? 0.8 : 0.5));
    spawnMuzzleEffect(muzzle.x, muzzle.y, bulletAngle, stats.base.tracer, weaponId);
    spawnCasing(p, angle, hand);
    Sfx.shot(weaponId);
    game.kills = p.kills;
    if (!infiniteAmmo && p.ammo[weaponId] <= 0) {
      if (offhand) p.offhandPendingReload = 0.17;
      else p.pendingReload = 0.17;
    }
  }

  function updatePlayer(dt) {
    const p = game.player;
    if (!p || !p.alive) return;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.shootFlash = Math.max(0, p.shootFlash - dt);
    p.offhandShootFlash = Math.max(0, p.offhandShootFlash - dt);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.offhandFireCooldown = Math.max(0, p.offhandFireCooldown - dt);
    p.pendingReload = Math.max(0, p.pendingReload - dt);
    p.offhandPendingReload = Math.max(0, p.offhandPendingReload - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.turretCooldown = Math.max(0, p.turretCooldown - dt);
    p.reviveCooldown = Math.max(0, p.reviveCooldown - dt);
    p.grenadeCooldown = Math.max(0, p.grenadeCooldown - dt);
    p.paralyzed = Math.max(0, (p.paralyzed || 0) - dt);
    p.shieldHitFlash = Math.max(0, p.shieldHitFlash - dt);
    p.bloom = Math.max(0, p.bloom - dt * 5.2);
    p.offhandBloom = Math.max(0, p.offhandBloom - dt * 5.2);
    game.reticleBloom = Math.max(0, game.reticleBloom - dt * 7.5);

    if (hasTalent('dualWield')) ensureOffhandValid();
    updateShield(dt);

    if (p.reviving) {
      p.moving = false;
      p.jetpackActive = false;
      p.vx = 0;
      p.vy = 0;
      p.reviveTimer -= dt;
      updateAimFromMouse();
      if (p.reviveTimer <= 0) completeRevive();
      return;
    }

    if (p.paralyzed > 0) {
      p.moving = false;
      p.jetpackActive = false;
      p.vx = 0;
      p.vy = 0;
      updateAimFromMouse();
      return;
    }

    // Auto-reload an empty hand.
    if (!isDeveloperMode() && p.pendingReload === 0 && (p.ammo[p.weapon] || 0) <= 0 && !p.reloading) {
      startReload('main');
    }
    if (!isDeveloperMode() && hasTalent('dualWield') && p.offhand && p.offhandPendingReload === 0 && (p.ammo[p.offhand] || 0) <= 0 && !p.offhandReloading) {
      startReload('offhand');
    }
    updateReload(dt);
    updateAimFromMouse();

    let dx = 0;
    let dy = 0;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) dy -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) dy += 1;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) dx -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }

    const stats = getWeaponStats();
    const campaignSpeed = 1 + (p.campaignUpgrades?.speed || 0) * 0.04;
    const flightHeld = p.characterId === 'valkyrie' && (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'));
    p.jetpackActive = flightHeld && len > 0.01;
    let speed = p.speedBase * levelSpeedMult(p.level) * stats.mobility * movementTalentMultiplier() * campaignSpeed;
    if (p.jetpackActive) speed *= 3.2;

    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      const dashSpeed = 690;
      moveCircle(p, p.dashDirX * dashSpeed * dt, p.dashDirY * dashSpeed * dt);
      p.moving = true;
      p.walkPhase += dashSpeed * dt * 0.05;
      if (Math.random() < dt * 45) {
        addParticle({
          type: 'ghost',
          x: p.x + rand(-7, 7),
          y: p.y + rand(-7, 7),
          vx: 0,
          vy: 0,
          life: 0.22,
          size: rand(12, 19),
          color: '85, 234, 245',
          alpha: 0.18,
          angle: p.aimAngle,
        });
      }
    } else {
      p.moving = len > 0.01;
      if (p.moving) {
        p.vx = dx * speed;
        p.vy = dy * speed;
        moveCircle(p, p.vx * dt, p.vy * dt);
        p.walkPhase += speed * dt * 0.045;
        if (p.jetpackActive && chance(dt * 28)) {
          addParticle({
            type: 'spark',
            x: p.x - dx * 12 + rand(-4, 4),
            y: p.y - dy * 12 + rand(-4, 4),
            vx: -dx * rand(45, 120) + rand(-18, 18),
            vy: -dy * rand(45, 120) + rand(-18, 18),
            life: rand(0.18, 0.42),
            size: rand(1.2, 3.2),
            color: Math.random() < 0.45 ? '255, 231, 156' : '255, 171, 80',
            drag: 2.6,
          });
        }
        if (chance(dt * 4.5)) {
          addParticle({
            type: 'dust',
            x: p.x - dx * 10 + rand(-5, 5),
            y: p.y - dy * 10 + rand(-5, 5),
            vx: rand(-10, 10),
            vy: rand(-10, 10),
            life: rand(0.25, 0.6),
            size: rand(2, 5),
            color: '128, 165, 162',
            alpha: 0.12,
            drag: 1.5,
          });
        }
      } else {
        p.vx = 0;
        p.vy = 0;
      }
    }

    if (input.firing) tryShoot('main');
    if (input.firingSecondary) tryShoot('offhand');
  }

  function acquireHomingTarget(x, y) {
    let best = null;
    let bestDistance = Infinity;
    let fallback = null;
    let fallbackDistance = Infinity;
    for (const enemy of game.enemies) {
      if (enemy.dead || enemy.spawnTimer > 0) continue;
      const distance = dist(x, y, enemy.x, enemy.y);
      if (distance < fallbackDistance) {
        fallback = enemy;
        fallbackDistance = distance;
      }
      if (!isOnScreen(enemy.x, enemy.y, 90)) continue;
      if (distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best || fallback;
  }

  function fireValkyrieMissile(p, index = 0, total = 1) {
    if (!p) return;
    const fanLaunch = total > 1;
    const target = fanLaunch ? null : acquireHomingTarget(p.x, p.y);
    const aimAngle = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.aimAngle;
    const fanOffset = fanLaunch
      ? (total > 1 ? index / (total - 1) - 0.5 : 0) * 1.8 + rand(-0.025, 0.025)
      : 0;
    const baseAngle = fanLaunch ? p.aimAngle + fanOffset : aimAngle;
    const x = p.x + Math.cos(baseAngle) * 20;
    const y = p.y + Math.sin(baseAngle) * 20;
    game.playerMissiles.push({
      x,
      y,
      px: x,
      py: y,
      angle: baseAngle,
      speed: 620,
      damage: 100,
      life: 4,
      target,
      lockDelay: fanLaunch ? 0.32 : 0,
      trailTimer: 0,
      dead: false,
    });
    for (let i = 0; i < 5; i += 1) {
      addParticle({
        type: 'spark',
        x,
        y,
        vx: -Math.cos(baseAngle) * rand(30, 100) + rand(-24, 24),
        vy: -Math.sin(baseAngle) * rand(30, 100) + rand(-24, 24),
        life: rand(0.18, 0.42),
        size: rand(1, 2.6),
        color: i % 2 === 0 ? '255, 222, 139' : '255, 157, 68',
        drag: 2.5,
      });
    }
    Sfx.shot('rocket');
  }

  function explodeValkyrieMissile(missile) {
    if (!missile || missile.dead) return;
    missile.dead = true;
    const blastRadius = 92;
    for (const enemy of game.enemies) {
      if (enemy.dead || enemy.spawnTimer > 0) continue;
      if (dist(missile.x, missile.y, enemy.x, enemy.y) > blastRadius + enemy.radius * 0.5) continue;
      damageEnemy(enemy, missile.damage, Math.atan2(enemy.y - missile.y, enemy.x - missile.x), enemy.x, enemy.y, true);
    }
    game.fireZones.push({
      x: missile.x,
      y: missile.y,
      radius: 72,
      life: 3,
      maxLife: 3,
      dps: 50,
      tickInterval: 0.25,
      tickTimer: 0.25,
      ignoreWalls: true,
      source: 'valkyrie',
    });
    game.portals.push({ x: missile.x, y: missile.y, life: 0.35, maxLife: 0.35, color: '255, 174, 72', radius: 62 });
    game.flash = Math.max(game.flash || 0, 0.08);
    game.shake = Math.max(game.shake, 2.2);
    for (let i = 0; i < 16; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 3 === 0 ? 'smoke' : 'spark',
        x: missile.x,
        y: missile.y,
        vx: Math.cos(a) * rand(30, blastRadius * 2.4),
        vy: Math.sin(a) * rand(30, blastRadius * 2.4),
        life: rand(0.2, 0.7),
        size: rand(1, i % 3 === 0 ? 9 : 4),
        color: i % 3 === 0 ? '180, 106, 54' : '255, 207, 112',
        alpha: 0.75,
        drag: 2.2,
      });
    }
    Sfx.explosion();
  }

  function updatePlayerMissiles(dt) {
    for (const missile of game.playerMissiles) {
      if (missile.dead) continue;
      missile.life -= dt;
      if (missile.life <= 0) {
        explodeValkyrieMissile(missile);
        continue;
      }
      if (missile.lockDelay > 0) {
        missile.lockDelay = Math.max(0, missile.lockDelay - dt);
        if (missile.lockDelay <= 0) missile.target = acquireHomingTarget(missile.x, missile.y);
      } else {
        if (!missile.target || missile.target.dead) {
          missile.target = acquireHomingTarget(missile.x, missile.y);
        }
        if (missile.target) {
          const desired = Math.atan2(missile.target.y - missile.y, missile.target.x - missile.x);
          const difference = Math.atan2(Math.sin(desired - missile.angle), Math.cos(desired - missile.angle));
          missile.angle += clamp(difference, -8 * dt, 8 * dt);
        }
      }
      missile.px = missile.x;
      missile.py = missile.y;
      const nx = missile.x + Math.cos(missile.angle) * missile.speed * dt;
      const ny = missile.y + Math.sin(missile.angle) * missile.speed * dt;
      // Player skill missiles ignore terrain; they only detonate on enemies,
      // expiry, or their area blast.
      missile.x = nx;
      missile.y = ny;
      missile.trailTimer -= dt;
      if (missile.trailTimer <= 0) {
        missile.trailTimer = 0.035;
        addParticle({
          type: 'spark',
          x: missile.x,
          y: missile.y,
          vx: -Math.cos(missile.angle) * rand(16, 50) + rand(-10, 10),
          vy: -Math.sin(missile.angle) * rand(16, 50) + rand(-10, 10),
          life: rand(0.16, 0.34),
          size: rand(0.8, 2),
          color: Math.random() < 0.4 ? '255, 238, 179' : '255, 167, 76',
          drag: 2.8,
        });
      }
      for (const enemy of game.enemies) {
        if (enemy.dead || enemy.spawnTimer > 0) continue;
        if (dist(missile.x, missile.y, enemy.x, enemy.y) > enemy.radius + 7) continue;
        explodeValkyrieMissile(missile);
        break;
      }
    }
    compactInPlace(game.playerMissiles, (missile) => !missile.dead);
  }

  function updateBullets(dt) {
    const p = game.player;
    for (const b of game.bullets) {
      if (b.dead) continue;
      b.px = b.x;
      b.py = b.y;
      if (b.kind === 'rocket') {
        b.trailTimer -= dt;
        if (b.trailTimer <= 0) {
          b.trailTimer = 0.035;
          addParticle({
            type: 'smoke',
            x: b.x - Math.cos(b.angle) * 9 + rand(-2, 2),
            y: b.y - Math.sin(b.angle) * 9 + rand(-2, 2),
            vx: -b.vx * 0.08 + rand(-12, 12),
            vy: -b.vy * 0.08 + rand(-12, 12),
            life: rand(0.28, 0.55),
            size: rand(3, 7),
            color: '162, 160, 149',
            alpha: 0.16,
            drag: 2.2,
          });
          addParticle({
            type: 'spark',
            x: b.x - Math.cos(b.angle) * 7,
            y: b.y - Math.sin(b.angle) * 7,
            vx: -b.vx * 0.3 + rand(-30, 30),
            vy: -b.vy * 0.3 + rand(-30, 30),
            life: rand(0.06, 0.15),
            size: rand(1, 2.2),
            color: '255, 178, 95',
            drag: 4,
          });
        }
      }
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      const segmentLength = dist(b.x, b.y, nx, ny);
      b.traveled += segmentLength;

      let target = null;
      let targetT = Infinity;
      for (const e of game.enemies) {
        if (e.dead || e.spawnTimer > 0) continue;
        const t = segmentCircleT(b.x, b.y, nx, ny, e.x, e.y, e.radius + b.r);
        if (t !== null && t < targetT) {
          targetT = t;
          target = e;
        }
      }
      let hostileTurret = null;
      let hostileTurretT = Infinity;
      for (const turret of game.enemyTurrets) {
        if (turret.dead || turret.hp <= 0) continue;
        const t = segmentCircleT(b.x, b.y, nx, ny, turret.x, turret.y, (turret.r || 16) + b.r);
        if (t !== null && t < hostileTurretT) {
          hostileTurretT = t;
          hostileTurret = turret;
        }
      }
      const closestTargetT = Math.min(targetT, hostileTurretT);
      const wallHit = closestObstacleHit(b.x, b.y, nx, ny, b.r || 1.5);
      if (wallHit && wallHit.t < closestTargetT) {
        b.x = wallHit.x;
        b.y = wallHit.y;
        b.dead = true;
        if (b.kind === 'rocket') {
          explodeRocket(b, null);
        } else {
          spawnImpact(b.x, b.y, wallHit.angle, b.color, false);
        }
      } else if (hostileTurretT < targetT) {
        const hx = lerp(b.x, nx, hostileTurretT);
        const hy = lerp(b.y, ny, hostileTurretT);
        b.x = hx;
        b.y = hy;
        b.dead = true;
        if (b.kind === 'rocket') {
          damageEnemyTurret(hostileTurret, b.damage, b.angle);
          explodeRocket(b, null);
        } else {
          damageEnemyTurret(hostileTurret, b.damage, b.angle);
          spawnImpact(hx, hy, b.angle, b.color, false);
        }
      } else if (target) {
        const hx = lerp(b.x, nx, targetT);
        const hy = lerp(b.y, ny, targetT);
        b.x = hx;
        b.y = hy;
        b.dead = true;
        if (b.kind === 'rocket') explodeRocket(b, target);
        else damageEnemy(target, b.damage, b.angle, hx, hy);
      } else {
        b.x = nx;
        b.y = ny;
      }

      if (!b.dead && b.traveled >= b.range) {
        b.dead = true;
        if (b.kind === 'rocket') explodeRocket(b, null);
      }
    }
    compactInPlace(game.bullets, (b) => !b.dead);
  }

  function explodeRocket(rocket, directTarget) {
    const x = rocket.x;
    const y = rocket.y;
    const radius = rocket.splashRadius || 120;
    const splash = rocket.splashDamage || 0;
    if (directTarget) {
      damageEnemy(directTarget, rocket.damage, rocket.angle, x, y);
    }
    // Use a point slightly back along the flight path so a rocket hitting the
    // face of a wall does not damage targets behind that wall.
    const sx = x + (rocket.px - x) * 0.9;
    const sy = y + (rocket.py - y) * 0.9;
    for (const e of game.enemies) {
      if (e.dead || e.spawnTimer > 0 || e === directTarget) continue;
      const d = dist(x, y, e.x, e.y);
      if (d > radius + e.radius) continue;
      const los = closestObstacleHit(sx, sy, e.x, e.y, 0);
      if (los && los.t < 0.985) continue;
      const falloff = clamp(1 - 0.52 * (d / Math.max(1, radius)), 0.42, 1);
      damageEnemy(e, splash * falloff, Math.atan2(e.y - y, e.x - x), e.x, e.y);
    }
    for (const turret of game.enemyTurrets) {
      if (turret.dead || turret.hp <= 0) continue;
      const d = dist(x, y, turret.x, turret.y);
      if (d > radius + (turret.r || 16)) continue;
      const los = closestObstacleHit(sx, sy, turret.x, turret.y, 0);
      if (los && los.t < 0.985) continue;
      const falloff = clamp(1 - 0.52 * (d / Math.max(1, radius)), 0.42, 1);
      damageEnemyTurret(turret, splash * falloff, Math.atan2(turret.y - y, turret.x - x));
    }

    // Blast visuals.
    game.shake = Math.max(game.shake, 9);
    game.flash = Math.max(game.flash || 0, 0.24);
    Sfx.explosion();
    game.portals.push({ x, y, life: 0.62, maxLife: 0.62, color: '255, 166, 85', radius: radius * 1.25 });
    addParticle({ type: 'flash', x, y, life: 0.18, size: radius * 0.86, color: '255, 190, 108' });
    addParticle({ type: 'ring', x, y, life: 0.45, size: radius * 1.75, color: '255, 168, 91', alpha: 0.9 });
    addParticle({ type: 'ring', x, y, life: 0.7, size: radius * 1.2, color: '255, 229, 177', alpha: 0.5 });
    for (let i = 0; i < 42; i += 1) {
      const a = rand(0, TAU);
      const speed = rand(50, 380);
      addParticle({
        type: i % 3 === 0 ? 'shard' : 'spark',
        x: x + rand(-8, 8),
        y: y + rand(-8, 8),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.2, 0.85),
        size: rand(1.2, 4),
        color: i % 4 === 0 ? '255, 244, 196' : i % 3 === 0 ? '255, 137, 74' : '255, 195, 109',
        rot: rand(0, TAU),
        spin: rand(-12, 12),
        drag: 2.4,
        gravity: 54,
        alpha: 0.9,
      });
    }
    for (let i = 0; i < 13; i += 1) {
      addParticle({
        type: 'smoke',
        x: x + rand(-radius * 0.45, radius * 0.45),
        y: y + rand(-radius * 0.45, radius * 0.45),
        vx: rand(-45, 45),
        vy: rand(-45, 45),
        life: rand(0.6, 1.6),
        size: rand(7, 28),
        color: i % 3 === 0 ? '109, 84, 69' : '76, 83, 81',
        alpha: 0.18,
        drag: 1.5,
      });
    }
    for (let i = 0; i < 14; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: 'spark',
        x: x + Math.cos(a) * rand(8, radius * 0.6),
        y: y + Math.sin(a) * rand(8, radius * 0.6),
        vx: Math.cos(a) * rand(15, 90),
        vy: Math.sin(a) * rand(15, 90),
        life: rand(0.4, 1.1),
        size: rand(1, 2.5),
        color: '255, 153, 82',
        drag: 1.2,
        alpha: 0.7,
      });
    }
    addDecal(x, y, rand(20, 34), 'scorch');
    addDecal(x, y, rand(12, 22), 'fluid');
    // Evaporating enemy shells near the blast look like deliberate shrapnel.
    if (game.enemyBullets.length > 0) {
      for (const eb of game.enemyBullets) {
        if (dist(eb.x, eb.y, x, y) < radius * 0.6) eb.dead = true;
      }
    }
  }

  function damageEnemy(enemy, damage, angle, hitX, hitY, quiet = false) {
    if (!enemy || enemy.dead || enemy.spawnTimer > 0) return;
    if (enemy.trainingDummy) {
      const actual = Math.max(0, Math.min(enemy.hp, damage));
      enemy.hp = Math.max(1, enemy.hp - actual);
      enemy.hitFlash = 0.1;
      recordTrainingHit(actual);
      game.hitMarker = 0.09;
      if (!quiet) {
        Sfx.hit();
        spawnHitSparks(hitX ?? enemy.x, hitY ?? enemy.y, angle, '255, 203, 126', 4);
      }
      addText(enemy.x + rand(-6, 6), enemy.y - enemy.radius - 6, Math.max(1, Math.round(actual)), '255, 234, 184', 0.5, 11, -34);
      return;
    }
    if (game.runMode === 'campaign' && enemy.campaignEnemy && !enemy.aware) {
      enemy.aware = true;
      enemy.alertFlash = 1.15;
      enemy.atkCd = Math.max(enemy.atkCd, 0.3);
    }
    enemy.hp -= damage;
    enemy.hitFlash = 0.09;
    if (!quiet) {
      game.hitMarker = 0.11;
      Sfx.hit();
      const color = enemy.type === 'elite' ? '217, 164, 255' : enemy.type === 'boss' ? '255, 132, 103' : '255, 162, 107';
      spawnHitSparks(hitX ?? enemy.x, hitY ?? enemy.y, angle, color, enemy.type === 'boss' ? 7 : 4);
    }
    addText(
      enemy.x + rand(-6, 6),
      enemy.y - enemy.radius - 6,
      Math.max(1, Math.round(damage)),
      enemy.type === 'boss' ? '255, 214, 184' : '249, 255, 250',
      0.55,
      enemy.type === 'boss' ? 13.5 : 11,
      -36,
    );
    if (enemy.hp <= 0) killEnemy(enemy);
  }

  function killEnemy(enemy) {
    if (enemy.dead) return;
    if (enemy.bomber) detonateBomber(enemy);
    enemy.dead = true;
    enemy.deathAge = 0;
    enemy.hp = 0;
    const hadEliteAura = game.eliteAura;
    refreshEliteAura();
    if (enemy.type === 'elite' && hadEliteAura && !game.eliteAura) {
      addToast('▸', '精英单位已击破', '普通士兵失去「FIRE+」协同攻击速度加成', 'gold', 3600);
    }
    const p = game.player;
    p.kills += 1;
    game.kills = p.kills;
    game.killMarker = 0.18;
    game.hitMarker = 0.18;
    const cfg = ENEMY_TYPES[enemy.type];
    gainXP(cfg.xp + (enemy.type === 'boss' ? game.wave * 20 : 0));
    dropCredits(enemy.x, enemy.y, enemy.type);
    spawnDeathEffect(enemy);
    Sfx.kill();
    addDecal(enemy.x, enemy.y, enemy.type === 'boss' ? 44 : enemy.type === 'elite' ? 22 : 14, 'fluid');
    if (enemy.type === 'boss') {
      game.shake = 18;
      game.flash = 0.35;
      Sfx.bossDeath();
      for (let i = 0; i < 3; i += 1) {
        dropPickup(enemy.x + rand(-36, 36), enemy.y + rand(-28, 28), 'medkit');
      }
      if (game.runMode === 'campaign' && enemy.campaignBoss) {
        const campaign = game.campaign;
        const def = CAMPAIGN_BOSS_DEFS[enemy.bossKind];
        campaign.bossActive = false;
        campaign.bossDefeated = true;
        campaign.arenaLocked = false;
        campaign.bossKills += 1;
        if (campaign.elevators[1]) campaign.elevators[1].locked = false;
        game.enemyTurrets = [];
        game.enemyRockets = [];
        game.campaignHazards = game.campaignHazards.filter((h) => h.type === 'poison' && h.life > 2.5);
        const reward = Math.round((220 + campaign.levelIndex * 120) * getDifficultyConfig().creditMult * characterCreditMultiplier());
        p.credits += reward;
        game.creditsEarned += reward;
        if (campaign.rogue) {
          showBanner('GUARD ELIMINATED // 封锁解除', `${def.name} 已被击破`, `区域封锁解除 · 上行电梯已解锁 · 层间奖励 +${reward} CR`, false, 4200);
          addToast('★', `${def.name} 被击破`, `上行电梯已解锁 · 获得 ${reward} CR`, 'gold', 5200);
        } else {
          showBanner('COMMANDER ELIMINATED // 区域解放', `${def.name} 已被击破`, `区域封锁解除 · 终点电梯已解锁 · 区域奖励 +${reward} CR`, false, 4400);
          addToast('★', `${def.name} 被击破`, `区域封锁解除 · 终点电梯已解锁 · 获得 ${reward} CR`, 'gold', 5600);
        }
        addText(enemy.x, enemy.y - enemy.radius - 26, '出口解锁', '127, 255, 188', 1.8, 13, -22);
        for (let i = 0; i < 3; i += 1) {
          game.portals.push({
            x: enemy.x + rand(-25, 25),
            y: enemy.y + rand(-20, 20),
            life: 1.4 + i * 0.2,
            maxLife: 1.4 + i * 0.2,
            color: '121, 255, 194',
            radius: 74 + i * 22,
          });
        }
        updateHUD();
      } else {
        const endlessBossName = CAMPAIGN_BOSS_DEFS[enemy.bossKind]?.name || '区域守卫';
        showBanner('TARGET ELIMINATED // 高价值目标已清除', `${endlessBossName}已击毙`, '等待区域完全肃清', false, 2900);
        addToast('★', `${endlessBossName}已摧毁`, `获得 ${formatInt(ENEMY_TYPES.boss.credits[0])}—${formatInt(ENEMY_TYPES.boss.credits[1])} CR 的掉落物`, 'gold', 5000);
      }
    } else if (enemy.type === 'elite') {
      game.shake = Math.max(game.shake, 5);
      if (chance(0.3)) dropPickup(enemy.x + rand(-16, 16), enemy.y + rand(-12, 12), 'medkit');
    } else if (chance(0.055)) {
      dropPickup(enemy.x + rand(-12, 12), enemy.y + rand(-12, 12), 'medkit');
    }
  }

  function dropCredits(x, y, type) {
    const range = ENEMY_TYPES[type].credits;
    const total = Math.max(1, Math.round(randInt(range[0], range[1]) * creditGainMultiplier()));
    let count = 1;
    if (type === 'elite') count = randInt(2, 4);
    if (type === 'boss') count = randInt(9, 13);
    const weights = Array.from({ length: count }, () => rand(0.55, 1.45));
    const sum = weights.reduce((a, b) => a + b, 0);
    let remaining = total;
    for (let i = 0; i < count; i += 1) {
      let amount;
      if (i === count - 1) {
        amount = remaining;
      } else {
        amount = Math.max(1, Math.floor((weights[i] / sum) * total));
        amount = Math.min(amount, remaining - (count - i - 1));
      }
      remaining -= amount;
      const angle = rand(0, TAU);
      const force = type === 'boss' ? rand(70, 240) : type === 'elite' ? rand(30, 120) : rand(20, 70);
      game.coins.push({
        x,
        y,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force,
        amount,
        r: type === 'boss' ? 7 : 6,
        phase: rand(0, TAU),
        life: 90,
        delay: type === 'boss' ? rand(0, 0.35) : rand(0, 0.12),
        magnet: false,
      });
    }
    game.portals.push({ x, y, life: 0.55, maxLife: 0.55, color: '255, 193, 102', radius: type === 'boss' ? 75 : 35 });
  }

  function dropPickup(x, y, type) {
    game.pickups.push({
      x,
      y,
      type,
      life: 60,
      phase: rand(0, TAU),
      bob: rand(0, TAU),
    });
    game.portals.push({ x, y, life: 0.45, maxLife: 0.45, color: '133, 255, 193', radius: 24 });
  }

  function updateShield(dt) {
    const p = game.player;
    if (!p || !p.shieldUnlocked || !p.alive || p.reviving) return;
    if (p.shieldBroken) {
      p.shieldBreakTimer = Math.max(0, p.shieldBreakTimer - dt);
      if (p.shieldBreakTimer <= 0) {
        p.shieldBroken = false;
        p.shield = Math.max(p.shield, 1);
        p.shieldRegenDelay = 0;
        p.shieldRestoreNotified = false;
        Sfx.shieldRestore();
        addText(p.x, p.y - 42, '护盾充能', '115, 246, 255', 1.1, 9, -24);
      }
      return;
    }
    if (p.shieldRegenDelay > 0) {
      p.shieldRegenDelay = Math.max(0, p.shieldRegenDelay - dt);
      return;
    }
    if (p.shield < p.maxShield) {
      p.shield = Math.min(p.maxShield, p.shield + 22 * dt);
      if (p.shieldRestoreNotified !== true) {
        p.shieldRestoreNotified = true;
        Sfx.shieldRestore();
      }
      if (p.shield >= p.maxShield) p.shieldRestoreNotified = false;
    } else {
      p.shieldRestoreNotified = false;
    }
  }

  function spawnShieldImpact() {
    const p = game.player;
    if (!p) return;
    for (let i = 0; i < 14; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: 'spark',
        x: p.x + Math.cos(a) * 16,
        y: p.y + Math.sin(a) * 16,
        vx: Math.cos(a) * rand(70, 190),
        vy: Math.sin(a) * rand(70, 190),
        life: rand(0.15, 0.4),
        size: rand(1, 2.2),
        color: i % 3 === 0 ? '223, 255, 255' : '99, 234, 255',
        drag: 4,
      });
    }
    game.portals.push({ x: p.x, y: p.y, life: 0.32, maxLife: 0.32, color: '99, 234, 255', radius: 44 });
  }

  function beginReviveChannel() {
    const p = game.player;
    if (!p) return;
    p.reviving = true;
    p.reviveDuration = 5;
    p.reviveTimer = 5;
    p.reviveCooldown = 50 * skillCooldownMultiplier();
    p.hp = Math.max(1, Math.ceil(p.maxHp * 0.35));
    p.invuln = Math.max(p.invuln, 0.45);
    p.reloading = false;
    p.reloadTimer = 0;
    p.offhandReloading = false;
    p.offhandReloadTimer = 0;
    p.pendingReload = 0;
    p.offhandPendingReload = 0;
    p.dashTimer = 0;
    p.moving = false;
    input.firing = false;
    input.firingSecondary = false;
    game.shake = Math.max(game.shake, 7);
    game.flash = Math.max(game.flash || 0, 0.18);
    game.portals.push({ x: p.x, y: p.y, life: 5.1, maxLife: 5.1, color: '126, 248, 255', radius: 84 });
    for (let i = 0; i < 24; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: 'spark',
        x: p.x + Math.cos(a) * rand(10, 30),
        y: p.y + Math.sin(a) * rand(10, 30),
        vx: Math.cos(a) * rand(15, 80),
        vy: Math.sin(a) * rand(15, 80) - 20,
        life: rand(0.5, 1.4),
        size: rand(1, 3),
        color: i % 4 === 0 ? '255, 201, 145' : '118, 244, 255',
        drag: 1.7,
      });
    }
    Sfx.reviveStart();
    showBanner('EMERGENCY RECONSTRUCTION // 重构协议', '紧急重构', '保持存活 5 秒 · 重构期间无法攻击', true, 2800);
    addToast('!', '紧急重构启动', '5 秒内无法攻击；再次倒下将永久死亡', 'danger', 4600);
    updateHUD();
  }

  function completeRevive() {
    const p = game.player;
    if (!p || !p.reviving) return;
    p.reviving = false;
    p.reviveTimer = 0;
    p.hp = Math.min(p.maxHp, Math.max(p.hp, Math.ceil(p.maxHp * 0.55)));
    p.invuln = Math.max(p.invuln, 1.4);
    p.shield = 0;
    p.shieldBroken = true;
    p.shieldBreakTimer = Math.max(p.shieldBreakTimer, 4);
    p.shieldRegenDelay = 4;
    game.portals.push({ x: p.x, y: p.y, life: 0.8, maxLife: 0.8, color: '155, 255, 223', radius: 92 });
    for (let i = 0; i < 34; i += 1) {
      const a = (i / 34) * TAU;
      addParticle({
        type: 'spark',
        x: p.x + Math.cos(a) * 18,
        y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * rand(60, 220),
        vy: Math.sin(a) * rand(60, 220),
        life: rand(0.3, 0.9),
        size: rand(1, 2.8),
        color: '146, 255, 211',
        drag: 3,
      });
    }
    Sfx.reviveComplete();
    showBanner('RECONSTRUCTION COMPLETE // 重构完成', '重新上线', '紧急重构冷却 50 秒', false, 2400);
    addToast('↑', '重构完成', `生命恢复至 ${Math.ceil(p.maxHp * 0.55)} · 冷却 ${Math.ceil(p.reviveCooldown)} 秒`, 'level', 4400);
    updateHUD();
  }

  function findTurretDeploySpot(p) {
    const candidates = [];
    const angles = [0, 0.55, -0.55, 1.15, -1.15, 1.7, -1.7, Math.PI];
    for (const distance of [52, 72, 94, 116]) {
      for (const offset of angles) candidates.push({ angle: p.aimAngle + offset, distance });
    }
    for (const c of candidates) {
      const x = p.x + Math.cos(c.angle) * c.distance;
      const y = p.y + Math.sin(c.angle) * c.distance;
      if (isPositionBlocked(x, y, 13)) continue;
      if (game.turrets.some((t) => !t.dead && dist(x, y, t.x, t.y) < 42)) continue;
      return { x, y };
    }
    return null;
  }

  function useCharacterSkill() {
    const p = game.player;
    if (!p || game.mode !== 'playing' || !p.alive || p.reviving) return;
    const character = getCharacterDef(p.characterId);
    const skill = character.active;
    if (!skill) return;
    if (p.skillCooldown > 0) {
      Sfx.empty();
      return;
    }
    if (skill.id === 'healDrone') {
      p.healDroneTimer = 5;
      p.healDroneTick = 0;
      p.skillCooldown = skill.cooldown;
      Sfx.reviveStart();
      addToast('+', '治疗机器人已部署', '跟随你持续恢复生命 5 秒', 'level', 2600);
      addText(p.x, p.y - 34, '治疗无人机', '139, 255, 196', 1.2, 11, -22);
    } else if (skill.id === 'holoShield') {
      p.holoShieldTimer = 3;
      p.skillCooldown = skill.cooldown;
      game.shake = Math.max(game.shake, 3);
      Sfx.shieldRestore();
      addToast('◇', '全息护盾展开', '3 秒内免疫一切伤害', 'level', 2600);
      addText(p.x, p.y - 34, '免疫护盾', '151, 224, 255', 1.2, 11, -22);
    } else if (skill.id === 'poisonBottle') {
      const angle = p.aimAngle;
      const range = 265;
      const tx = clamp(p.x + Math.cos(angle) * range, 70, WORLD.w - 70);
      const ty = clamp(p.y + Math.sin(angle) * range, 70, WORLD.h - 70);
      game.playerPoisonBottles.push({
        startX: p.x,
        startY: p.y,
        x: p.x,
        y: p.y,
        targetX: tx,
        targetY: ty,
        angle,
        time: 0,
        duration: 0.48,
        z: 0,
        landed: false,
      });
      p.skillCooldown = skill.cooldown;
      Sfx.grenadeThrow();
    } else if (skill.id === 'homingBarrage') {
      if ((p.valkyrieMissiles || 0) <= 0) {
        Sfx.empty();
        addText(p.x, p.y - 32, '导弹填充中', '255, 214, 127', 0.7, 10, -20);
        return;
      }
      const launchCount = Math.floor(p.valkyrieMissiles);
      p.valkyrieMissiles = 0;
      p.valkyrieMissileRecharge = 0;
      for (let i = 0; i < launchCount; i += 1) {
        fireValkyrieMissile(p, i, launchCount);
      }
      p.skillCooldown = 0;
      game.shake = Math.max(game.shake, Math.min(9, 2 + launchCount * 0.28));
      addText(p.x + rand(-8, 8), p.y - 30, `全弹发射 ×${launchCount}`, '255, 223, 131', 1.0, 12, -22);
    }
    updateHUD();
  }

  function updateCharacterSkills(dt) {
    const p = game.player;
    if (!p || !p.alive) return;
    p.skillCooldown = Math.max(0, p.skillCooldown - dt);
    p.healDroneTimer = Math.max(0, p.healDroneTimer - dt);
    p.holoShieldTimer = Math.max(0, p.holoShieldTimer - dt);
    if (p.characterId === 'valkyrie') {
      if ((p.valkyrieMissiles || 0) < 16) {
        p.valkyrieMissileRecharge = (p.valkyrieMissileRecharge || 0) + dt;
        while (p.valkyrieMissileRecharge >= 0.1 && p.valkyrieMissiles < 16) {
          p.valkyrieMissileRecharge -= 0.1;
          p.valkyrieMissiles += 1;
        }
        if (p.valkyrieMissiles >= 16) p.valkyrieMissileRecharge = 0;
      } else {
        p.valkyrieMissileRecharge = 0;
      }
      if (p.valkyrieRocketBurst > 0) {
        p.valkyrieRocketBurstTimer -= dt;
        if (p.valkyrieRocketBurstTimer <= 0) {
          p.valkyrieRocketBurst -= 1;
          p.valkyrieRocketBurstTimer += 0.1;
          fireValkyrieMissile(p);
        }
      }
    }
    if (p.healDroneTimer > 0) {
      p.healDroneTick -= dt;
      if (p.healDroneTick <= 0) {
        p.healDroneTick = 0.5;
        if (p.hp < p.maxHp) {
          const before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + 4);
          if (Math.round(p.hp) !== Math.round(before)) {
            addText(p.x + rand(-14, 14), p.y - 24, '+4', '143, 255, 196', 0.55, 9, -22);
          }
        }
        addParticle({
          type: 'spark',
          x: p.x + rand(-18, 18),
          y: p.y + rand(-18, 18),
          vx: rand(-18, 18),
          vy: rand(-45, -15),
          life: rand(0.25, 0.5),
          size: rand(0.8, 1.8),
          color: '128, 255, 195',
          drag: 2,
        });
      }
    }
    for (const bottle of game.playerPoisonBottles) {
      if (bottle.landed) continue;
      bottle.time += dt;
      const t = clamp(bottle.time / bottle.duration, 0, 1);
      bottle.x = lerp(bottle.startX, bottle.targetX, t);
      bottle.y = lerp(bottle.startY, bottle.targetY, t);
      bottle.z = Math.sin(t * Math.PI) * 56;
      if (t >= 1) {
        bottle.landed = true;
        game.playerPoisonZones.push({
          x: bottle.targetX,
          y: bottle.targetY,
          radius: 88,
          life: 3,
          maxLife: 3,
          tick: 0.5,
        });
        Sfx.explosion();
        game.portals.push({ x: bottle.targetX, y: bottle.targetY, life: 0.45, maxLife: 0.45, color: '138, 255, 104', radius: 85 });
        for (let i = 0; i < 18; i += 1) {
          const a = rand(0, TAU);
          addParticle({
            type: 'smoke',
            x: bottle.targetX + Math.cos(a) * rand(2, 40),
            y: bottle.targetY + Math.sin(a) * rand(2, 32),
            vx: Math.cos(a) * rand(10, 80),
            vy: Math.sin(a) * rand(10, 80),
            life: rand(0.5, 1.4),
            size: rand(6, 18),
            color: '104, 163, 73',
            alpha: 0.18,
            drag: 1.3,
          });
        }
      }
    }
    game.playerPoisonBottles = game.playerPoisonBottles.filter((b) => !b.landed);
    for (const zone of game.playerPoisonZones) {
      zone.life -= dt;
      zone.tick -= dt;
      if (zone.tick <= 0) {
        zone.tick += 0.5;
        for (const enemy of game.enemies) {
          if (enemy.dead || enemy.spawnTimer > 0) continue;
          if (dist(enemy.x, enemy.y, zone.x, zone.y) > zone.radius + enemy.radius * 0.6) continue;
          const poisonPercent = enemy.type === 'boss' ? 0.02 : 0.05;
          damageEnemy(enemy, Math.max(1, enemy.maxHp * poisonPercent), 0, enemy.x, enemy.y, true);
          enemy.poisoned = 1.2;
        }
      }
      if (Math.random() < dt * 12) {
        const a = rand(0, TAU);
        addParticle({
          type: 'smoke',
          x: zone.x + Math.cos(a) * rand(0, zone.radius * 0.85),
          y: zone.y + Math.sin(a) * rand(0, zone.radius * 0.55),
          vx: rand(-12, 12),
          vy: rand(-28, -8),
          life: rand(0.5, 1.3),
          size: rand(6, 16),
          color: '99, 160, 76',
          alpha: 0.13,
          drag: 1.2,
        });
      }
    }
    game.playerPoisonZones = game.playerPoisonZones.filter((z) => z.life > 0);
  }

  function deployTurret() {
    const p = game.player;
    if (!p || game.mode !== 'playing' || !p.alive) return;
    if (!hasTalent('turret')) {
      Sfx.error();
      addToast('i', '战术技能尚未接入', '在科技树中解锁“哨戒炮塔”', '', 3000);
      return;
    }
    if (p.reviving) return;
    const activeTurrets = game.turrets.filter((t) => !t.dead && t.hp > 0).length;
    const limit = turretLimit();
    if (activeTurrets >= limit) {
      Sfx.error();
      addToast('!', '炮塔部署上限', `当前上限 ${limit} 座 · 继续升级哨戒协议可提升`, 'danger', 2800);
      return;
    }
    if (p.turretCooldown > 0) {
      Sfx.empty();
      return;
    }
    const spot = findTurretDeploySpot(p);
    if (!spot) {
      Sfx.error();
      addToast('!', '空间不足', '请面向更开阔的区域部署炮塔', 'danger', 2400);
      return;
    }
    const tier = turretTierDef();
    game.turrets.push({
      x: spot.x,
      y: spot.y,
      r: 16,
      aimAngle: p.aimAngle,
      fireTimer: 0.2,
      life: tier.life,
      maxLife: tier.life,
      hp: tier.hp,
      maxHp: tier.hp,
      damage: tier.damage,
      tier: tier.id,
      tierName: tier.name,
      color: tier.color,
      burstLeft: 0,
      burstTimer: 0,
      laserTimer: 0,
      laserTarget: null,
      hitFlash: 0,
      dead: false,
      muzzleFlash: 0,
      spin: rand(0, TAU),
    });
    p.turretCooldown = turretDeployCooldown();
    Sfx.turretDeploy();
    game.portals.push({ x: spot.x, y: spot.y, life: 0.55, maxLife: 0.55, color: '129, 255, 207', radius: 38 });
    for (let i = 0; i < 14; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: 'spark',
        x: spot.x + Math.cos(a) * 10,
        y: spot.y + Math.sin(a) * 10,
        vx: Math.cos(a) * rand(30, 100),
        vy: Math.sin(a) * rand(30, 100),
        life: rand(0.2, 0.5),
        size: rand(1, 2),
        color: '128, 255, 207',
        drag: 3,
      });
    }
    addToast('◇', `哨戒炮塔已部署 · ${tier.name}`, `自动索敌 ${tier.life} 秒 · 当前 ${activeTurrets + 1}/${limit} 座`, 'gold', 3400);
    updateHUD();
  }

  function destroyPlayerTurret(turret, angle = 0, silent = false) {
    if (!turret || turret.dead) return;
    turret.dead = true;
    turret.hp = 0;
    turret.life = 0;
    game.shake = Math.max(game.shake, 4);
    Sfx.explosion();
    game.portals.push({ x: turret.x, y: turret.y, life: 0.55, maxLife: 0.55, color: '255, 133, 92', radius: 54 });
    addParticle({ type: 'flash', x: turret.x, y: turret.y, life: 0.15, size: 28, color: '255, 208, 142' });
    for (let i = 0; i < 24; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 3 === 0 ? 'smoke' : 'spark',
        x: turret.x + rand(-6, 6),
        y: turret.y + rand(-6, 6),
        vx: Math.cos(a) * rand(30, 180),
        vy: Math.sin(a) * rand(30, 180),
        life: rand(0.25, 0.8),
        size: rand(1.2, 7),
        color: i % 3 === 0 ? '93, 102, 98' : i % 2 === 0 ? '255, 156, 92' : '147, 255, 217',
        drag: 2.3,
        gravity: 42,
        alpha: 0.75,
      });
    }
    addText(turret.x, turret.y - 30, silent ? '哨戒炮离线' : '哨戒炮被摧毁', '255, 152, 106', 1.3, 11, -20);
    if (!silent) addToast('!', '哨戒炮被摧毁', '战术技能仍在冷却，注意重新部署时机', 'danger', 3000);
  }

  function damagePlayerTurret(turret, damage, angle = 0) {
    if (!turret || turret.dead || turret.hp <= 0) return;
    turret.hp -= damage;
    turret.hitFlash = 0.16;
    for (let i = 0; i < 3; i += 1) {
      addParticle({
        type: 'spark',
        x: turret.x + rand(-8, 8),
        y: turret.y + rand(-8, 8),
        vx: Math.cos(angle) * rand(20, 80) + rand(-25, 25),
        vy: Math.sin(angle) * rand(20, 80) + rand(-25, 25),
        life: rand(0.15, 0.35),
        size: rand(0.8, 1.8),
        color: '255, 196, 132',
        drag: 3,
        alpha: 0.8,
      });
    }
    if (turret.hp <= 0) destroyPlayerTurret(turret, angle);
  }

  function findPlayerTurretTarget(enemy, forceTaunt = false) {
    let best = null;
    let bestD = Infinity;
    const taunt = forceTaunt || hasTalent('turretTaunt');
    const maxRange = taunt ? Math.max(620, (enemy.attackRange || 360) * 1.65) : Math.max(330, (enemy.attackRange || 360) * 1.05);
    for (const turret of game.turrets) {
      if (turret.dead || turret.hp <= 0) continue;
      const d = dist(enemy.x, enemy.y, turret.x, turret.y);
      if (d > maxRange) continue;
      if (d < bestD && hasLineOfSight(enemy.x, enemy.y, turret.x, turret.y)) {
        bestD = d;
        best = turret;
      }
    }
    return best;
  }

  function updateEnemyTurretEngagement(enemy, dt, turret) {
    const dx = turret.x - enemy.x;
    const dy = turret.y - enemy.y;
    const d = Math.hypot(dx, dy) || 0.001;
    enemy.hasLOS = hasLineOfSight(enemy.x, enemy.y, turret.x, turret.y);
    enemy.aimAngle = Math.atan2(dy, dx);
    enemy.turretTarget = turret;
    enemy.windup = 0;
    enemy.burstLeft = 0;
    enemy.atkCd -= dt;
    if (enemy.hasLOS && enemy.atkCd <= 0 && d <= (enemy.attackRange || 380) * 1.2) {
      fireEnemyAttack(enemy, turret);
      enemy.atkCd = enemyAttackDelay(enemy, enemy.fireMin || 1.3, enemy.fireMax || 2.1);
      enemy.burstLeft = 0;
    }
    enemy.muzzleX = enemy.x + Math.cos(enemy.aimAngle) * (enemy.radius + 8);
    enemy.muzzleY = enemy.y + Math.sin(enemy.aimAngle) * (enemy.radius + 8);
    let forward = 0;
    let strafe = enemy.strafeDir * 0.58;
    if (d > 255) forward = 1;
    else if (d < 145) forward = -0.75;
    enemy.strafeTimer -= dt;
    if (enemy.strafeTimer <= 0) {
      enemy.strafeTimer = rand(1.2, 2.5);
      if (chance(0.7)) enemy.strafeDir *= -1;
    }
    const dirx = dx / d;
    const diry = dy / d;
    let mx = dirx * forward - diry * strafe;
    let my = diry * forward + dirx * strafe;
    if (d < enemy.radius + 22) {
      mx -= dirx;
      my -= diry;
    }
    ({ x: mx, y: my } = obstacleAvoidance(enemy, mx, my));
    const mlen = Math.hypot(mx, my);
    if (mlen > 0.02) {
      enemy.vx = (mx / mlen) * enemy.speed * 0.86;
      enemy.vy = (my / mlen) * enemy.speed * 0.86;
      moveCircle(enemy, enemy.vx * dt, enemy.vy * dt);
      nudgeToFreePosition(enemy);
    } else {
      enemy.vx = 0;
      enemy.vy = 0;
    }
  }

  function fireTurretProjectile(turret, angle) {
    const mx = turret.x + Math.cos(angle) * 18;
    const my = turret.y + Math.sin(angle) * 18;
    const tier = TURRET_TIERS.find((item) => item.id === turret.tier) || TURRET_TIERS[0];
    if (tier.rocket) {
      game.bullets.push({
        kind: 'rocket', x: mx, y: my, px: mx, py: my,
        vx: Math.cos(angle) * 560, vy: Math.sin(angle) * 560,
        r: 4.5, damage: turretShotDamage(turret), splashDamage: tier.splashDamage,
        splashRadius: tier.splashRadius, range: 760, traveled: 0,
        color: turret.color, angle, trailTimer: 0, dead: false, from: 'turret',
      });
    } else {
      const spread = tier.id === 'gatling' ? 0.075 : 0.018;
      game.bullets.push({
        kind: 'bullet', x: mx, y: my, px: mx, py: my,
        vx: Math.cos(angle + rand(-spread, spread)) * (tier.id === 'gatling' ? 2100 : 1880),
        vy: Math.sin(angle + rand(-spread, spread)) * (tier.id === 'gatling' ? 2100 : 1880),
        r: 2, damage: turretShotDamage(turret), splashDamage: 0, splashRadius: 0,
        range: tier.id === 'burst' ? 820 : 740, traveled: 0,
        color: turret.color, angle, dead: false, from: 'turret',
      });
    }
    turret.muzzleFlash = 0.055;
    spawnMuzzleEffect(mx, my, angle, turret.color, tier.rocket ? 'rocket' : 'smg');
    if (game.time >= (game.nextTurretSound || 0)) {
      Sfx.turretShot();
      game.nextTurretSound = game.time + (tier.id === 'gatling' ? 0.06 : 0.11);
    }
  }

  function updateTurrets(dt) {
    if (!game.turrets.length) return;
    const laserTurrets = game.turrets.filter((t) => !t.dead && t.hp > 0 && t.tier === 'laser');
    const visited = new Set();
    for (const turret of game.turrets) {
      turret.linkPrimary = null;
      turret.linkPartners = null;
      turret.linkCount = 1;
    }
    for (const seed of laserTurrets) {
      if (visited.has(seed)) continue;
      const group = [];
      const queue = [seed];
      visited.add(seed);
      while (queue.length) {
        const current = queue.shift();
        group.push(current);
        for (const other of laserTurrets) {
          if (visited.has(other) || current === other) continue;
          if (dist(current.x, current.y, other.x, other.y) > TURRET_LINK_RANGE) continue;
          if (!hasLineOfSight(current.x, current.y, other.x, other.y)) continue;
          visited.add(other);
          queue.push(other);
        }
      }
      if (group.length < 2) continue;
      const primary = group[0];
      primary.linkPartners = group.slice(1);
      primary.linkCount = group.length;
      for (const member of primary.linkPartners) {
        member.linkPrimary = primary;
        member.linkCount = group.length;
      }
    }
    for (const turret of game.turrets) {
      if (turret.dead || turret.hp <= 0) continue;
      turret.life -= dt;
      turret.fireTimer -= dt;
      turret.burstTimer -= dt;
      turret.laserTimer = Math.max(0, turret.laserTimer - dt);
      turret.hitFlash = Math.max(0, turret.hitFlash - dt);
      turret.muzzleFlash = Math.max(0, turret.muzzleFlash - dt);
      if (hasTalent('turretRepair') && turret.hp < turret.maxHp) {
        turret.hp = Math.min(turret.maxHp, turret.hp + turret.maxHp * 0.025 * dt);
        if (Math.random() < dt * 3) {
          addParticle({
            type: 'spark', x: turret.x + rand(-10, 10), y: turret.y + rand(-8, 8),
            vx: rand(-10, 10), vy: rand(-35, -15), life: rand(0.25, 0.5),
            size: rand(0.7, 1.5), color: '133, 255, 202', drag: 2,
          });
        }
      }
      // A linked laser turret contributes power to the primary emitter, but
      // does not fire its own beam.
      if (turret.linkPrimary && !turret.linkPrimary.dead) {
        turret.aimAngle = turret.linkPrimary.aimAngle;
        continue;
      }
      let target = null;
      let best = turret.linkCount > 1 ? 700 : 560;
      for (const e of game.enemies) {
        if (e.dead || e.spawnTimer > 0) continue;
        const d = dist(turret.x, turret.y, e.x, e.y);
        if (d < best && hasLineOfSight(turret.x, turret.y, e.x, e.y)) {
          best = d;
          target = e;
        }
      }
      if (target) {
        const angle = Math.atan2(target.y - turret.y, target.x - turret.x);
        turret.aimAngle = angle;
        const tier = TURRET_TIERS.find((item) => item.id === turret.tier) || TURRET_TIERS[0];
        const rate = turretAttackRateMultiplier();
        const linkCount = turret.linkCount > 1 ? Math.min(3, turret.linkCount) : 1;
        const linkDamage = TURRET_LINK_DAMAGE[linkCount] || 1;
        const linkInterval = TURRET_LINK_INTERVAL[linkCount] || 1;
        if (tier.id === 'burst') {
          if (turret.burstLeft <= 0 && turret.fireTimer <= 0) {
            turret.burstLeft = tier.burst;
            turret.burstTimer = 0;
            turret.fireTimer = tier.interval / rate;
          }
          if (turret.burstLeft > 0 && turret.burstTimer <= 0) {
            fireTurretProjectile(turret, angle);
            turret.burstLeft -= 1;
            turret.burstTimer = (tier.burstInterval || 0.075) / rate;
          }
        } else if (tier.laser) {
          if (turret.fireTimer <= 0) {
            turret.fireTimer = tier.interval * linkInterval / rate;
            turret.laserTimer = 0.11;
            turret.laserTarget = target;
            turret.laserAngle = angle;
            turret.muzzleFlash = 0.055;
            damageEnemy(target, turretShotDamage(turret) * linkDamage, angle, target.x, target.y, true);
            if (linkCount > 1) {
              addText(turret.x, turret.y - 48, `LINK ×${linkCount}`, '169, 244, 255', 0.45, 9, -18);
            }
            if (game.time >= (game.nextTurretSound || 0)) {
              Sfx.turretShot();
              game.nextTurretSound = game.time + 0.08;
            }
          }
        } else if (turret.fireTimer <= 0) {
          turret.fireTimer = tier.interval / rate;
          fireTurretProjectile(turret, angle);
        }
      }
      if (turret.life <= 0 && !turret.dead) {
        destroyPlayerTurret(turret, 0, true);
      }
    }
    compactInPlace(game.turrets, (t) => !t.dead && t.hp > 0 && t.life > 0);
  }

  function gainXP(amount) {
    const p = game.player;
    if (!p || !p.alive) return;
    if (game.runMode === 'campaign') return;
    amount = Math.round(amount * (hasTalent('salvage') ? 1.2 : 1));
    p.xp += amount;
    let leveled = false;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level += 1;
      p.maxHp += 12;
      p.hp = Math.min(p.maxHp, p.hp + 28);
      p.talentPoints += 1;
      p.totalTalentPoints += 1;
      p.xpNext = Math.round(80 * Math.pow(1.22, p.level - 1));
      leveled = true;
      Sfx.levelUp();
      game.shake = Math.max(game.shake, 2.4);
      game.portals.push({ x: p.x, y: p.y, life: 0.7, maxLife: 0.7, color: '135, 255, 201', radius: 62 });
      for (let i = 0; i < 18; i += 1) {
        const a = (i / 18) * TAU;
        addParticle({
          type: 'spark',
          x: p.x + Math.cos(a) * 20,
          y: p.y + Math.sin(a) * 20,
          vx: Math.cos(a) * rand(50, 150),
          vy: Math.sin(a) * rand(50, 150),
          life: rand(0.3, 0.6),
          size: rand(1.2, 2.4),
          color: '144, 255, 203',
          drag: 4,
        });
      }
      addToast(
        '↑',
        `战斗等级提升 · LV.${pad2(p.level)}`,
        '生命上限 +12 · 移速 +1.8% · 装填速度 +3% · 天赋点 +1 (按 T)',
        'level',
        5000,
      );
    }
    if (leveled) {
      updateHUD();
      game.flash = Math.max(game.flash || 0, 0.18);
    }
  }

  function hurtPlayer(damage, angle, options = {}) {
    if (game.runMode === 'training') return;
    const p = game.player;
    if (!p || !p.alive || p.invuln > 0) return;
    const developerHealthSnapshot = isDeveloperMode() ? p.hp : null;
    if (p.holoShieldTimer > 0) {
      addText(p.x, p.y - 32, '护盾免疫', '156, 226, 255', 0.65, 10, -20);
      return;
    }
    if (options.poison && p.poisonImmune) {
      addText(p.x, p.y - 28, '毒素免疫', '144, 255, 150', 0.8, 10, -20);
      return;
    }
    const reducedDamage = damage * (1 - (p.damageReduction || 0));
    let remaining = reducedDamage;
    if (p.shieldUnlocked && p.shield > 0) {
      const absorbed = Math.min(p.shield, remaining);
      const shieldIntensity = clamp(0.2 + absorbed / Math.max(30, p.maxHp * 0.2), 0.2, 0.85);
      p.shield -= absorbed;
      remaining -= absorbed;
      p.shieldRegenDelay = 3;
      p.shieldHitFlash = 0.24;
      p.invuln = Math.max(p.invuln, 0.25);
      addText(p.x, p.y - 34, `护盾 -${Math.round(absorbed)}`, '119, 243, 255', 0.7, 10, -24);
      spawnShieldImpact();
      if (p.shield <= 0) {
        p.shield = 0;
        p.shieldBroken = true;
        p.shieldBreakTimer = 8;
        p.shieldRestoreNotified = false;
        Sfx.shieldBreak();
        addToast('!', '相位护盾已被击破', '8 秒后开始逐渐恢复', 'danger', 2600);
        game.shake = Math.min(26, game.shake + 5);
        game.hitFlash = Math.max(game.hitFlash, 0.42);
        game.damageFlash = Math.max(game.damageFlash, 0.42);
      } else {
        Sfx.shieldHit();
        game.shake = Math.max(game.shake, 2 + absorbed * 0.18 + shieldIntensity * 3);
      }
      game.damageFlash = Math.max(game.damageFlash, 0.12 + shieldIntensity * 0.16);
      game.hitFlash = Math.max(game.hitFlash, 0.08 + shieldIntensity * 0.14);
    }
    if (remaining > 0.01) {
      p.hp -= remaining;
      p.invuln = 0.38;
      p.hitFlash = 0.22;
      const damageRatio = remaining / Math.max(1, p.maxHp);
      const hitIntensity = clamp(0.25 + damageRatio * 1.5 + remaining / 45, 0.25, 1);
      game.hitFlash = Math.min(0.88, Math.max(game.hitFlash, 0.16 + hitIntensity * 0.62));
      game.damageFlash = Math.min(0.95, Math.max(game.damageFlash, 0.22 + hitIntensity * 0.55));
      game.shake = Math.min(36, Math.max(game.shake, 2.2 + remaining * 0.5 + hitIntensity * 6.5));
      Sfx.hurt();
      addText(p.x, p.y - 25, `-${Math.round(remaining)}`, '255, 103, 95', 0.75, 11, -26);
      spawnDamageSparks(p.x, p.y, angle);
      addDecal(p.x, p.y, 9, 'fluid');
    }
    if (isDeveloperMode()) {
      // Developer mode keeps the health bar unchanged, but the hit feedback
      // above still runs normally: damage numbers, red flash, shake and SFX.
      p.hp = Math.max(1, developerHealthSnapshot ?? p.hp);
      p.reviving = false;
      p.reviveTimer = 0;
      p.alive = true;
      return;
    }
    if (p.hp <= 0) {
      p.hp = 0;
      if (p.reviving) {
        p.reviving = false;
        p.alive = false;
        beginPlayerDeath();
      } else if (hasTalent('respawn') && p.reviveCooldown <= 0) {
        beginReviveChannel();
      } else {
        p.alive = false;
        beginPlayerDeath();
      }
    }
  }

  function beginPlayerDeath() {
    if (game.runMode === 'endless') clearEndlessCheckpoint(false);
    if (game.mode === 'dying' || game.mode === 'gameover') return;
    game.mode = 'dying';
    game.deathTimer = 0.85;
    game.deathShown = false;
    input.firing = false;
    input.firingSecondary = false;
    input.keys.clear();
    const player = game.player;
    if (player) {
      player.reviving = false;
      player.reviveTimer = 0;
    }
    dom.reviveHud.classList.add('is-hidden');
    game.shake = 28;
    game.hitFlash = Math.max(game.hitFlash, 0.8);
    game.damageFlash = Math.max(game.damageFlash, 0.9);
    Sfx.gameOver();
    const p = game.player;
    for (let i = 0; i < 28; i += 1) {
      addParticle({
        type: 'shard',
        x: p.x + rand(-10, 10),
        y: p.y + rand(-10, 10),
        vx: rand(-170, 170),
        vy: rand(-170, 170),
        life: rand(0.45, 1.2),
        size: rand(2, 5),
        color: i % 3 === 0 ? '137, 241, 249' : '104, 77, 76',
        rot: rand(0, TAU),
        spin: rand(-8, 8),
        drag: 2.8,
      });
    }
    game.portals.push({ x: p.x, y: p.y, life: 0.8, maxLife: 0.8, color: '255, 105, 98', radius: 74 });
  }

  function finishGameOver() {
    if (game.runMode === 'story') {
      showStoryFailure();
      return;
    }
    if (game.runMode === 'endless') clearEndlessCheckpoint(false);
    if (game.mode === 'gameover') return;
    game.mode = 'gameover';
    input.firingSecondary = false;
    dom.reviveHud.classList.add('is-hidden');
    saveBestWave();
    const p = game.player;
    if (game.runMode === 'campaign') {
      const campaign = game.campaign;
      if (campaign.rogue) {
        recordRogueFloor(campaign.rogueFloor || campaign.levelIndex + 1);
        setText(dom.goWaveLabel, '下潜深度');
        setText(dom.goWave, `${campaign.rogueFloor || campaign.levelIndex + 1} 层`);
        setText(dom.goLevel, pad2(p.level));
        setText(dom.goKills, p.kills);
        setText(dom.goCredits, formatInt(game.creditsEarned));
        updateBestUI();
        setText(dom.goBest, `${getDifficultyConfig().name}肉鸽最深 FLOOR ${pad2(game.rogueRecord?.byDifficulty?.[getDifficultyConfig().id]?.bestFloor || campaign.rogueFloor || 1)} · ${campaign.level?.name || ''}`);
      } else {
        setText(dom.goWaveLabel, '抵达区域');
        setText(dom.goWave, `${campaign.levelIndex + 1} / 3`);
        setText(dom.goLevel, pad2(p.level));
        setText(dom.goKills, p.kills);
        setText(dom.goCredits, formatInt(game.creditsEarned));
        updateBestUI();
        setText(dom.goBest, `战役进度 ${campaign.levelIndex + 1} / 3 · ${campaign.level?.name || ''}`);
      }
    } else {
      setText(dom.goWaveLabel, '抵达波次');
      setText(dom.goWave, pad2(game.wave));
      setText(dom.goLevel, pad2(p.level));
      setText(dom.goKills, p.kills);
      setText(dom.goCredits, formatInt(game.creditsEarned));
      updateBestUI();
    }
    dom.gameover.classList.remove('is-hidden');
    document.body.classList.remove('low-hp');
    dom.damageVignette.style.opacity = '0';
    dom.hitFlash.style.opacity = '0';
    document.body.classList.remove('in-game');
    dom.btnRetry.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------
     Enemy AI and attacks
     ------------------------------------------------------------ */
  function obstacleAvoidance(entity, ax, ay) {
    let x = ax;
    let y = ay;
    const nearPush = 42;
    for (const obs of OBSTACLES) {
      let nx;
      let ny;
      if (obs.shape === 'rect') {
        nx = clamp(entity.x, obs.x, obs.x + obs.w);
        ny = clamp(entity.y, obs.y, obs.y + obs.h);
      } else {
        const d = Math.hypot(entity.x - obs.x, entity.y - obs.y) || 0.001;
        const or = obstacleRadius(obs);
        nx = obs.x + ((entity.x - obs.x) / d) * or;
        ny = obs.y + ((entity.y - obs.y) / d) * or;
      }
      const dx = entity.x - nx;
      const dy = entity.y - ny;
      const d = Math.hypot(dx, dy);
      const safe = entity.r + nearPush;
      if (d > 0.001 && d < safe) {
        const strength = ((safe - d) / safe) * 1.8;
        x += (dx / d) * strength;
        y += (dy / d) * strength;
      }
    }
    return { x, y };
  }

  function moveEnemyNav(e, tx, ty, dt, speedScale = 1) {
    let dx = tx - e.x;
    let dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    let mx = dx / d;
    let my = dy / d;
    if (!e.hasLOS) {
      const nav = getNavDirection(e, tx, ty);
      if (nav && (nav.x || nav.y)) {
        const len = Math.hypot(nav.x, nav.y) || 1;
        mx = nav.x / len;
        my = nav.y / len;
      }
    }
    ({ x: mx, y: my } = obstacleAvoidance(e, mx, my));
    const len = Math.hypot(mx, my) || 1;
    e.vx = (mx / len) * e.speed * speedScale;
    e.vy = (my / len) * e.speed * speedScale;
    moveCircle(e, e.vx * dt, e.vy * dt);
    nudgeToFreePosition(e);
    e.muzzleX = e.x + Math.cos(e.aimAngle) * (e.radius + 7);
    e.muzzleY = e.y + Math.sin(e.aimAngle) * (e.radius + 7);
  }

  function updateZombie(e, dt) {
    const player = game.player;
    const p = e.tauntTarget || player;
    if (!p) return;
    const d = dist(e.x, e.y, p.x, p.y);
    e.atkCd -= dt;
    e.attackAnim = Math.max(0, (e.attackAnim || 0) - dt);
    if (d > e.radius + (p.r || 16) + 8) {
      moveEnemyNav(e, p.x, p.y, dt, d < 90 ? 1.25 : 1);
    } else {
      e.vx = 0;
      e.vy = 0;
      if (e.atkCd <= 0) {
        e.atkCd = enemyAttackDelay(e, e.fireMin, e.fireMax);
        e.attackAnim = 0.22;
        if (p === player) hurtPlayer(e.damage, e.aimAngle);
        else damagePlayerTurret(p, e.damage, e.aimAngle);
        for (let i = 0; i < 5; i += 1) {
          const a = e.aimAngle + rand(-0.4, 0.4);
          addParticle({
            type: 'spark',
            x: p.x + Math.cos(a) * 10,
            y: p.y + Math.sin(a) * 10,
            vx: Math.cos(a) * rand(25, 90),
            vy: Math.sin(a) * rand(25, 90),
            life: rand(0.12, 0.25),
            size: rand(0.7, 1.5),
            color: '173, 226, 111',
            drag: 3,
          });
        }
      }
    }
  }

  function updateSpider(e, dt) {
    const p = e.tauntTarget || game.player;
    if (!p) return;
    e.hasLOS = hasLineOfSight(e.x, e.y, p.x, p.y);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    e.atkCd -= dt;
    const desired = 220;
    let moveX = dx / d;
    let moveY = dy / d;
    if (d < 145) {
      moveX *= -1;
      moveY *= -1;
    } else if (d < desired + 30) {
      moveX = (dx / d) * 0.15 - (dy / d) * e.strafeDir * 0.65;
      moveY = (dy / d) * 0.15 + (dx / d) * e.strafeDir * 0.65;
    }
    if (!e.hasLOS) {
      const nav = getNavDirection(e, p.x, p.y);
      if (nav && (nav.x || nav.y)) {
        const len = Math.hypot(nav.x, nav.y) || 1;
        moveX = nav.x / len;
        moveY = nav.y / len;
      }
    }
    ({ x: moveX, y: moveY } = obstacleAvoidance(e, moveX, moveY));
    const len = Math.hypot(moveX, moveY) || 1;
    e.vx = (moveX / len) * e.speed;
    e.vy = (moveY / len) * e.speed;
    moveCircle(e, e.vx * dt, e.vy * dt);
    nudgeToFreePosition(e);
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafeTimer = rand(1.2, 2.2);
      e.strafeDir *= -1;
    }
    if (e.atkCd <= 0 && e.hasLOS && d <= e.attackRange) {
      e.atkCd = enemyAttackDelay(e, e.fireMin, e.fireMax);
      e.muzzleFlash = 0.1;
      const angle = e.aimAngle + rand(-0.055, 0.055);
      spawnHostileBullet(e.x + Math.cos(angle) * (e.radius + 6), e.y + Math.sin(angle) * (e.radius + 6), angle, {
        speed: e.bulletSpeed,
        damage: e.damage,
        size: 4,
        color: '153, 255, 111',
        life: 2.4,
        poison: true,
      });
      spawnEnemyMuzzle(e.x, e.y, angle, 'spider');
      Sfx.enemyShot('normal');
    }
  }

  function updateCombatRobot(e, dt) {
    const player = game.player;
    const p = e.tauntTarget || player;
    if (!p) return;
    e.hasLOS = hasLineOfSight(e.x, e.y, p.x, p.y);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    e.electricCd -= dt;
    e.zapTimer = Math.max(0, (e.zapTimer || 0) - dt);
    if (d > 145) {
      moveEnemyNav(e, p.x, p.y, dt, d > 330 ? 1.08 : 0.92);
    } else {
      const strafe = e.strafeDir * 0.7;
      let mx = -(dy / d) * strafe;
      let my = (dx / d) * strafe;
      ({ x: mx, y: my } = obstacleAvoidance(e, mx, my));
      e.vx = mx * e.speed * 0.65;
      e.vy = my * e.speed * 0.65;
      moveCircle(e, e.vx * dt, e.vy * dt);
      nudgeToFreePosition(e);
    }
    if (e.electricCd <= 0 && e.hasLOS && d <= 230 && (p.holoShieldTimer || 0) <= 0) {
      e.electricCd = enemyAttackDelay(e, 3.4, 4.8);
      e.zapTimer = 0.24;
      e.zapTargetX = p.x;
      e.zapTargetY = p.y;
      if (p === player) {
        p.paralyzed = Math.max(p.paralyzed || 0, 0.5);
        hurtPlayer(e.damage * 0.35, e.aimAngle);
      } else {
        damagePlayerTurret(p, e.damage * 0.35, e.aimAngle);
      }
      addText(p.x, p.y - 38, '电击麻痹', '167, 240, 255', 0.8, 10, -24);
      addParticle({ type: 'flash', x: p.x, y: p.y, life: 0.16, size: 34, color: '141, 234, 255' });
      for (let i = 0; i < 10; i += 1) {
        addParticle({
          type: 'spark',
          x: p.x + rand(-18, 18),
          y: p.y + rand(-18, 18),
          vx: rand(-65, 65),
          vy: rand(-65, 65),
          life: rand(0.12, 0.3),
          size: rand(0.8, 1.8),
          color: '167, 238, 255',
          drag: 2.5,
        });
      }
      Sfx.shieldHit();
    }
  }

  function updateRepairRobot(e, dt) {
    const p = game.player;
    const d = dist(e.x, e.y, p.x, p.y);
    if (d < 250) {
      moveEnemyNav(e, e.x - (p.x - e.x), e.y - (p.y - e.y), dt, 1.1);
    } else if (d > 430) {
      moveEnemyNav(e, p.x, p.y, dt, 0.75);
    } else {
      const strafe = e.strafeDir * 0.5;
      let mx = -((p.y - e.y) / (d || 1)) * strafe;
      let my = ((p.x - e.x) / (d || 1)) * strafe;
      ({ x: mx, y: my } = obstacleAvoidance(e, mx, my));
      e.vx = mx * e.speed * 0.6;
      e.vy = my * e.speed * 0.6;
      moveCircle(e, e.vx * dt, e.vy * dt);
      nudgeToFreePosition(e);
    }
    e.healCd -= dt;
    e.healBeam = e.healBeam && e.healBeam.time > 0 ? e.healBeam : null;
    if (e.healBeam) e.healBeam.time -= dt;
    if (e.healCd <= 0) {
      e.healCd = rand(5.2, 6.4) / Math.max(0.1, getDifficultyConfig().attackSpeed || 1);
      let target = null;
      let best = 420;
      for (const other of game.enemies) {
        if (other === e || other.dead || other.spawnTimer > 0 || other.hp >= other.maxHp) continue;
        const allyDist = dist(e.x, e.y, other.x, other.y);
        if (allyDist < best && hasLineOfSight(e.x, e.y, other.x, other.y)) {
          best = allyDist;
          target = other;
        }
      }
      if (target) {
        const heal = Math.max(8, Math.round(target.maxHp * 0.12));
        target.hp = Math.min(target.maxHp, target.hp + heal);
        target.hitFlash = 0;
        e.healBeam = { target, time: 0.7 };
        addText(target.x, target.y - target.radius - 20, `+${heal}`, '147, 255, 201', 0.9, 10, -20);
        for (let i = 0; i < 9; i += 1) {
          addParticle({
            type: 'spark',
            x: target.x + rand(-12, 12),
            y: target.y + rand(-12, 12),
            vx: rand(-16, 16),
            vy: rand(-48, -16),
            life: rand(0.25, 0.55),
            size: rand(0.7, 1.6),
            color: '143, 255, 198',
            drag: 1.8,
          });
        }
        Sfx.shieldRestore();
      }
    }
  }

  function gunnerFireMode(e, mode, target = game.player) {
    const base = Math.atan2(target.y - e.y, target.x - e.x);
    const muzzleX = e.x + Math.cos(base) * (e.radius + 12);
    const muzzleY = e.y + Math.sin(base) * (e.radius + 12);
    if (mode === 'mg') {
      for (let i = 0; i < 4; i += 1) {
        spawnHostileBullet(muzzleX, muzzleY, base + rand(-0.06, 0.06), {
          speed: 520, damage: e.damage * 0.42, size: 2.6, color: '255, 194, 112', life: 2.2,
        });
      }
    } else if (mode === 'shotgun') {
      for (let i = 0; i < 7; i += 1) {
        const off = ((i / 6) - 0.5) * 0.55;
        spawnHostileBullet(muzzleX, muzzleY, base + off, {
          speed: 390, damage: e.damage * 0.52, size: 3.2, color: '255, 168, 92', life: 1.7,
        });
      }
    } else {
      spawnHostileBullet(muzzleX, muzzleY, base + rand(-0.025, 0.025), {
        speed: 290,
        damage: e.damage * 0.8,
        splash: e.damage * 1.5,
        splashRadius: 86,
        rocket: true,
        size: 5,
        color: '255, 120, 67',
        life: 3.2,
      });
    }
    e.muzzleFlash = 0.12;
    e.muzzleAngle = base;
    spawnEnemyMuzzle(e.x, e.y, base, mode === 'rocket' ? 'boss' : 'elite');
    Sfx.enemyShot(mode === 'rocket' ? 'boss' : 'elite');
    game.shake = Math.max(game.shake, mode === 'rocket' ? 4.2 : 1.1);
  }

  function updateGunnerRobot(e, dt) {
    const p = e.tauntTarget || game.player;
    if (!p) return;
    e.hasLOS = hasLineOfSight(e.x, e.y, p.x, p.y);
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (!e.gunnerEnraged && e.hp / e.maxHp <= 0.5) {
      e.gunnerEnraged = true;
      e.speed *= 1.12;
      e.telegraph *= 0.7;
      e.atkCd = Math.min(e.atkCd, 0.35);
      addText(e.x, e.y - e.radius - 24, '狂暴协议', '255, 194, 112', 1.3, 12, -22);
      game.shake = Math.max(game.shake, 5);
      Sfx.summon();
    }
    if (d > 390) {
      moveEnemyNav(e, p.x, p.y, dt, 0.72);
    } else if (d < 220) {
      moveEnemyNav(e, e.x - dx, e.y - dy, dt, 0.66);
    } else {
      let mx = -(dy / d) * e.strafeDir * 0.55;
      let my = (dx / d) * e.strafeDir * 0.55;
      ({ x: mx, y: my } = obstacleAvoidance(e, mx, my));
      e.vx = mx * e.speed * 0.55;
      e.vy = my * e.speed * 0.55;
      moveCircle(e, e.vx * dt, e.vy * dt);
    }
    if (e.gunnerWindup > 0) {
      e.gunnerWindup -= dt;
      if (e.gunnerWindup <= 0) {
        e.gunnerWindup = 0;
        if (e.hasLOS && d <= e.attackRange) {
          if (e.gunnerEnraged) {
            gunnerFireMode(e, 'mg', p);
            gunnerFireMode(e, 'shotgun', p);
            gunnerFireMode(e, 'rocket', p);
          } else {
            gunnerFireMode(e, e.gunnerMode, p);
            e.gunnerMode = e.gunnerMode === 'mg' ? 'shotgun' : e.gunnerMode === 'shotgun' ? 'rocket' : 'mg';
          }
        }
        e.atkCd = enemyAttackDelay(e, e.fireMin, e.fireMax, e.gunnerEnraged ? 0.62 : 1);
      }
    } else {
      e.atkCd -= dt;
      if (e.atkCd <= 0 && e.hasLOS && d <= e.attackRange) {
        e.gunnerWindup = e.telegraph;
      }
    }
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafeTimer = rand(1.5, 2.8);
      e.strafeDir *= -1;
    }
  }

  function refreshEliteAura() {
    const eliteAlive = game.enemies.some((enemy) => !enemy.dead && enemy.type === 'elite');
    game.eliteAura = eliteAlive;
    for (const enemy of game.enemies) {
      if (enemy.type !== 'normal') continue;
      const hadBuff = !!enemy.attackBuff;
      enemy.attackBuff = eliteAlive;
      if (hadBuff && !eliteAlive) {
        enemy.atkCd = Math.max(enemy.atkCd, Math.min(enemy.fireMax || 2, (enemy.fireMin || 1.2) + 0.35));
      }
    }
  }

  function updateEnemies(dt) {
    const p = game.player;
    if (!p) return;
    refreshEliteAura();
    for (const e of game.enemies) {
      if (e.dead) {
        e.deathAge += dt;
        continue;
      }
      if (e.trainingDummy) {
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        continue;
      }
      if (game.runMode === 'campaign' && game.campaign.arenaLocked && !pointInRect(e.x, e.y, game.campaign.arenaRoom)) {
        e.vx = 0;
        e.vy = 0;
        continue;
      }
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.muzzleFlash = Math.max(0, e.muzzleFlash - dt);
      e.alertFlash = Math.max(0, (e.alertFlash || 0) - dt);

      if (e.spawnTimer > 0) {
        e.spawnTimer -= dt;
        if (e.spawnTimer <= 0) {
          e.spawnTimer = 0;
          e.atkCd = Math.max(e.atkCd, rand(0.25, 0.75));
        }
        continue;
      }

      if (e.stunTimer > 0) {
        e.stunTimer = Math.max(0, e.stunTimer - dt);
        e.vx = 0;
        e.vy = 0;
        e.windup = 0;
        e.burstLeft = 0;
        e.summonWindup = 0;
        e.hasLOS = false;
        if (Math.random() < dt * 12) {
          addParticle({
            type: 'spark',
            x: e.x + rand(-e.radius, e.radius),
            y: e.y + rand(-e.radius * 0.6, e.radius * 0.4),
            vx: rand(-30, 30),
            vy: rand(-60, -15),
            life: rand(0.2, 0.45),
            size: rand(0.8, 1.8),
            color: '196, 249, 255',
            drag: 1.8,
            alpha: 0.75,
          });
        }
        continue;
      }

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const dirx = dx / d;
      const diry = dy / d;
      e.aimAngle = Math.atan2(dy, dx);
      e.hasLOS = hasLineOfSight(e.x, e.y, p.x, p.y);
      const onScreen = isOnScreen(e.x, e.y, 24);

      if (e.type === 'boss' && e.bossKind) {
        updateCampaignBoss(e, dt);
        continue;
      }

      if (game.runMode === 'campaign' && e.campaignEnemy && !e.aware) {
        const seesPlayer = d <= (e.visionRange || 240) && e.hasLOS;
        if (seesPlayer) {
          e.aware = true;
          e.alertFlash = 1.15;
          e.atkCd = Math.max(e.atkCd, 0.35);
          addText(e.x, e.y - e.radius - 22, '发现目标', '255, 139, 101', 1.2, 11, -26);
          game.shake = Math.max(game.shake, 0.25);
        } else {
          // Idle sentries only scan. They never path toward the player until
          // the player enters their line-of-sight range.
          e.vx = 0;
          e.vy = 0;
          e.aimAngle += dt * (e.type === 'elite' ? 0.4 : 0.26);
          e.hasLOS = false;
          if (e.spawnTimer <= 0) {
            e.muzzleX = e.x + Math.cos(e.aimAngle) * (e.radius + 8);
            e.muzzleY = e.y + Math.sin(e.aimAngle) * (e.radius + 8);
          }
          continue;
        }
      }

      if (hasTalent('turretTaunt') && game.turrets.length > 0) {
        e.tauntTarget = findPlayerTurretTarget(e, true);
      } else {
        e.tauntTarget = null;
      }
      if (e.bomber) {
        updateCampaignBomber(e, dt);
        continue;
      }
      if (e.type === 'zombie') {
        updateZombie(e, dt);
        continue;
      }
      if (e.type === 'spider') {
        updateSpider(e, dt);
        continue;
      }
      if (e.type === 'combatRobot') {
        updateCombatRobot(e, dt);
        continue;
      }
      if (e.type === 'repairRobot') {
        updateRepairRobot(e, dt);
        continue;
      }
      if (e.type === 'gunnerRobot') {
        updateGunnerRobot(e, dt);
        continue;
      }

      if (game.runMode !== 'campaign' && e.type !== 'boss' && game.turrets.length > 0) {
        const turretTarget = findPlayerTurretTarget(e, hasTalent('turretTaunt'));
        if (turretTarget) {
          updateEnemyTurretEngagement(e, dt, turretTarget);
          continue;
        }
      }

      if (e.type === 'boss') {
        if (!e.phase2 && e.hp / e.maxHp <= 0.5) {
          e.phase2 = true;
          e.speed *= 1.22;
          e.fireMin *= 0.78;
          e.fireMax *= 0.82;
          e.telegraph *= 0.8;
          e.atkCd = Math.min(e.atkCd, 0.35);
          e.summonCd = Math.min(e.summonCd, 2.6);
          game.shake = Math.max(game.shake, 8);
          Sfx.summon();
          const bossName = CAMPAIGN_BOSS_DEFS[e.bossKind || ENEMY_SYSTEMS[game.endlessBiome]?.bossKind]?.name || '区域守卫';
          showBanner('ENRAGED // 防御协议崩溃', '阶段 II', '召唤频率与火力密度提升', true, 2600);
          addToast('!', `${bossName}进入狂暴阶段`, '重装装甲已破损，火力密度提升', 'danger', 3800);
        }

        if (e.summonWindup > 0) {
          e.summonWindup -= dt;
          if (e.summonWindup <= 0) {
            e.summonWindup = 0;
            summonBossAdds(e);
          }
        } else {
          e.summonCd -= dt;
          if (e.summonCd <= 0 && e.windup <= 0 && e.hasLOS && onScreen) {
            e.summonWindup = 1.2;
            e.summonCd = e.phase2 ? 7.4 : 9.2;
            e.atkCd = Math.max(e.atkCd, 0.75);
            Sfx.summon();
            addText(e.x, e.y - e.radius - 24, '召唤援军', '255, 139, 110', 1.6, 12, -22);
            game.portals.push({ x: e.x, y: e.y, life: 1.2, maxLife: 1.2, color: '255, 111, 95', radius: 96 });
          }
        }
      }

      // Attack cadence.
      if (e.windup > 0) {
        e.windup -= dt;
        if (e.windup <= 0) {
          e.windup = 0;
          if (e.hasLOS && onScreen && d <= e.attackRange * 1.15) {
            fireEnemyAttack(e);
          }
          e.atkCd = enemyAttackDelay(e, e.fireMin, e.fireMax);
        }
      } else {
        e.atkCd -= dt;
        if (e.atkCd <= 0 && e.hasLOS && onScreen && d <= e.attackRange && e.summonWindup <= 0) {
          e.windup = e.telegraph;
          e.windupKind = 'shot';
          e.atkCd = enemyAttackDelay(e, e.fireMin, e.fireMax);
        }
      }

      if (e.burstLeft > 0) {
        e.burstTimer -= dt;
        if (e.burstTimer <= 0) {
          fireEnemyBullet(e, e.aimAngle + rand(-0.035, 0.035), 1);
          e.burstLeft -= 1;
          e.burstTimer = 0.12;
        }
      }

      // Reposition.
      let forward = 0;
      let strafe = 0;
      if (!e.hasLOS || !onScreen) {
        forward = 1;
      } else if (d > e.preferred[1]) {
        forward = 1;
      } else if (d < e.preferred[0]) {
        forward = -0.85;
      }
      if (e.hasLOS && d < e.attackRange) {
        strafe = e.strafeDir * (e.type === 'boss' ? 0.32 : 0.62);
      }
      if (e.type === 'boss' && d < 230) forward = -1;
      e.strafeTimer -= dt;
      if (e.strafeTimer <= 0) {
        e.strafeTimer = rand(1.3, 2.9);
        if (chance(0.7)) e.strafeDir *= -1;
      }
      if (e.detour > 0) {
        e.detour -= dt;
        strafe += e.strafeDir * 1.2;
      }

      let baseX = dirx;
      let baseY = diry;
      if (!e.hasLOS) {
        const nav = getNavDirection(e, p.x, p.y);
        if (nav && (nav.x || nav.y)) {
          const nl = Math.hypot(nav.x, nav.y) || 1;
          baseX = nav.x / nl;
          baseY = nav.y / nl;
        }
      }
      let mx = baseX * forward - baseY * strafe;
      let my = baseY * forward + baseX * strafe;
      if (!e.hasLOS) {
        // When following the flow field, don't orbit an unseen target.
        const nl = Math.hypot(baseX, baseY) || 1;
        mx = baseX / nl;
        my = baseY / nl;
      }

      // Separate from nearby enemies so squads don't clump into one target.
      for (const other of game.enemies) {
        if (other === e || other.dead || other.spawnTimer > 0) continue;
        const ox = e.x - other.x;
        const oy = e.y - other.y;
        const od = Math.hypot(ox, oy);
        const minD = e.radius + other.radius + 14;
        if (od > 0.001 && od < minD) {
          const strength = ((minD - od) / minD) * 0.9;
          mx += (ox / od) * strength;
          my += (oy / od) * strength;
        }
      }
      if (d < e.radius + p.r + 18) {
        mx += (-dx / d) * 1.4;
        my += (-dy / d) * 1.4;
      }

      ({ x: mx, y: my } = obstacleAvoidance(e, mx, my));
      const mlen = Math.hypot(mx, my);
      let speedFactor = 1;
      if (e.windup > 0) speedFactor = 0.28;
      if (e.summonWindup > 0) speedFactor = 0.08;
      if (e.burstLeft > 0) speedFactor = Math.min(speedFactor, 0.55);
      if (mlen > 0.02) {
        const finalSpeed = e.speed * speedFactor;
        e.vx = (mx / mlen) * finalSpeed;
        e.vy = (my / mlen) * finalSpeed;
        moveCircle(e, e.vx * dt, e.vy * dt);
      } else {
        e.vx = 0;
        e.vy = 0;
      }

      // Keep enemies from occupying the same space as the player.
      const overlapDist = e.radius + p.r + 4;
      if (dist2(e.x, e.y, p.x, p.y) < overlapDist * overlapDist) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.x = p.x + Math.cos(a) * overlapDist;
        e.y = p.y + Math.sin(a) * overlapDist;
        resolveObstacles(e);
      }
      nudgeToFreePosition(e);

      // Simple stuck correction: if pressed into geometry, sidestep.
      e.stuckClock += dt;
      if (e.stuckClock >= 0.6) {
        const moved = Math.hypot(e.x - e.lastX, e.y - e.lastY);
        if (moved < 2.4 && d > 70) {
          e.strafeDir *= -1;
          e.detour = 0.9;
          e.atkCd = Math.min(e.atkCd, 0.4);
        }
        e.lastX = e.x;
        e.lastY = e.y;
        e.stuckClock = 0;
      }

      e.muzzleX = e.x + Math.cos(e.aimAngle) * (e.radius + 8);
      e.muzzleY = e.y + Math.sin(e.aimAngle) * (e.radius + 8);
    }

    game.enemies = game.enemies.filter((e) => !(e.dead && e.deathAge > (e.type === 'boss' ? 2.2 : 1.1)));
  }

  function fireEnemyAttack(enemy, target = game.player) {
    const p = game.player;
    if (!target) return;
    if (target === p && (!p || !p.alive)) return;
    if (target !== p && (target.dead || target.hp <= 0)) return;
    const lead = enemy.type === 'normal' ? 0.02 : 0.12;
    const tx = target.x + (target.vx || 0) * lead;
    const ty = target.y + (target.vy || 0) * lead;
    const angle = Math.atan2(ty - enemy.y, tx - enemy.x);
    enemy.aimAngle = angle;
    enemy.muzzleFlash = 0.1;
    enemy.muzzleX = enemy.x + Math.cos(angle) * (enemy.radius + 9);
    enemy.muzzleY = enemy.y + Math.sin(angle) * (enemy.radius + 9);
    spawnEnemyMuzzle(enemy.muzzleX, enemy.muzzleY, angle, enemy.type);

    if (enemy.type === 'normal') {
      fireEnemyBullet(enemy, angle + rand(-0.055, 0.055), 1);
    } else if (enemy.type === 'elite') {
      fireEnemyBullet(enemy, angle + rand(-0.035, 0.035), 1);
      enemy.burstLeft = 2;
      enemy.burstTimer = 0.13;
    } else {
      const count = enemy.phase2 ? 7 : 5;
      const spread = enemy.phase2 ? 0.66 : 0.54;
      for (let i = 0; i < count; i += 1) {
        const off = (i - (count - 1) / 2) * (spread / (count - 1));
        fireEnemyBullet(enemy, angle + off + rand(-0.015, 0.015), 1.05);
      }
    }
    if (game.time >= (game.nextEnemySound || 0)) {
      Sfx.enemyShot(enemy.type);
      game.nextEnemySound = game.time + 0.045;
    }
    game.shake = Math.max(game.shake, enemy.type === 'boss' ? 2.4 : 0.5);
  }

  function fireEnemyBullet(enemy, angle, speedScale = 1) {
    let color = enemy.type === 'boss' ? '255, 83, 75' : enemy.type === 'elite' ? '218, 147, 255' : '255, 122, 83';
    if (game.runMode === 'campaign' && enemy.faction) {
      if (enemy.faction === 'lab') color = '150, 255, 163';
      else if (enemy.faction === 'military') color = '255, 184, 96';
      else if (enemy.faction === 'robot') color = '255, 112, 88';
    }
    const speed = enemy.bulletSpeed * speedScale;
    const size = enemy.type === 'boss' ? 5 : enemy.type === 'elite' ? 4.2 : 3.5;
    game.enemyBullets.push({
      x: enemy.muzzleX,
      y: enemy.muzzleY,
      px: enemy.muzzleX,
      py: enemy.muzzleY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: size,
      damage: enemy.damage,
      life: 3.1,
      color,
      angle,
      dead: false,
    });
    if (game.enemyBullets.length > 220) game.enemyBullets.shift();
  }

  function explodeEnemyProjectile(projectile) {
    if (!projectile || projectile.exploded) return;
    projectile.exploded = true;
    projectile.dead = true;
    const p = game.player;
    if (p && p.alive && projectile.splash > 0) {
      const d = dist(projectile.x, projectile.y, p.x, p.y);
      if (d <= (projectile.splashRadius || 80) + p.r) {
        const falloff = clamp(1 - 0.55 * (d / Math.max(1, projectile.splashRadius || 80)), 0.45, 1);
        hurtPlayer(projectile.splash * falloff, projectile.angle);
      }
    }
    game.shake = Math.max(game.shake, 7);
    game.flash = Math.max(game.flash || 0, 0.1);
    Sfx.explosion();
    game.portals.push({ x: projectile.x, y: projectile.y, life: 0.45, maxLife: 0.45, color: '255, 126, 74', radius: projectile.splashRadius || 80 });
    for (let i = 0; i < 18; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 3 === 0 ? 'shard' : 'spark',
        x: projectile.x,
        y: projectile.y,
        vx: Math.cos(a) * rand(35, 180),
        vy: Math.sin(a) * rand(35, 180),
        life: rand(0.2, 0.65),
        size: rand(1, 3),
        color: i % 3 === 0 ? '255, 158, 85' : '255, 211, 139',
        drag: 2.4,
        gravity: 30,
      });
    }
    addDecal(projectile.x, projectile.y, rand(10, 18), 'scorch');
  }

  function updateEnemyBullets(dt) {
    const p = game.player;
    if (!p) return;
    for (const b of game.enemyBullets) {
      if (b.dead) continue;
      b.life -= dt;
      b.px = b.x;
      b.py = b.y;
      const nx = b.x + b.vx * dt;
      const ny = b.y + b.vy * dt;
      const playerRadius = p.r + b.r + (p.holoShieldTimer > 0 ? 24 : 0);
      const playerT = p.alive ? segmentCircleT(b.x, b.y, nx, ny, p.x, p.y, playerRadius) : null;
      let turretTarget = null;
      let turretT = Infinity;
      for (const turret of game.turrets) {
        if (turret.dead || turret.hp <= 0) continue;
        const t = segmentCircleT(b.x, b.y, nx, ny, turret.x, turret.y, (turret.r || 16) + b.r);
        if (t !== null && t < turretT) {
          turretT = t;
          turretTarget = turret;
        }
      }
      const wallHit = closestObstacleHit(b.x, b.y, nx, ny, b.r || 1.5);
      const firstActorT = Math.min(playerT === null ? Infinity : playerT, turretT);
      if (wallHit && wallHit.t < firstActorT) {
        b.x = wallHit.x;
        b.y = wallHit.y;
        b.dead = true;
        if (b.rocket) explodeEnemyProjectile(b);
        spawnImpact(b.x, b.y, wallHit.angle, b.color, true);
      } else if (turretTarget && turretT <= (playerT === null ? Infinity : playerT)) {
        b.x = lerp(b.x, nx, turretT);
        b.y = lerp(b.y, ny, turretT);
        b.dead = true;
        if (turretTarget) damagePlayerTurret(turretTarget, b.damage, b.angle);
        if (b.rocket) explodeEnemyProjectile(b);
        spawnImpact(b.x, b.y, b.angle, b.color, true);
      } else if (playerT !== null && p.alive) {
        b.dead = true;
        b.x = lerp(b.x, nx, playerT);
        b.y = lerp(b.y, ny, playerT);
        if (p.holoShieldTimer > 0) {
          spawnShieldImpact();
          addText(b.x, b.y - 12, '护盾消除', '154, 227, 255', 0.5, 8, -16);
          Sfx.shieldHit();
        } else if (b.rocket) {
          explodeEnemyProjectile(b);
        } else {
          hurtPlayer(b.damage, b.angle, { poison: !!b.poison });
        }
        spawnImpact(b.x, b.y, b.angle, b.color, true);
      } else {
        b.x = nx;
        b.y = ny;
      }
      if (b.life <= 0) b.dead = true;
    }
    compactInPlace(game.enemyBullets, (b) => !b.dead);
  }

  /* ------------------------------------------------------------
     Campaign boss projectiles, poison and sentry turrets
     ------------------------------------------------------------ */
  function spawnHostileBullet(x, y, angle, opts = {}) {
    const speed = opts.speed ?? 380;
    const size = opts.size ?? 4;
    game.enemyBullets.push({
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: size,
      damage: opts.damage ?? 8,
      life: opts.life ?? 3,
      color: opts.color ?? '255, 122, 83',
      angle,
      dead: false,
      hostileBoss: !!opts.boss,
      poison: !!opts.poison,
      rocket: !!opts.rocket,
      splash: opts.splash || 0,
      splashRadius: opts.splashRadius || 0,
    });
    if (game.enemyBullets.length > 240) game.enemyBullets.shift();
  }

  function spawnCampaignRocket(source, angle, opts = {}) {
    const speed = opts.speed ?? 250;
    const x = source.x + Math.cos(angle) * (source.radius + 13);
    const y = source.y + Math.sin(angle) * (source.radius + 13);
    game.enemyRockets.push({
      x,
      y,
      px: x,
      py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      speed,
      turnRate: opts.turnRate ?? 0.3,
      damage: opts.damage ?? 22,
      splash: opts.splash ?? 30,
      radius: opts.radius ?? 92,
      life: opts.life ?? 4,
      trailTimer: 0,
      color: opts.color ?? '255, 145, 87',
      dead: false,
    });
  }

  function throwCampaignPoisonBottle(source, targetX, targetY) {
    const startX = source.x;
    const startY = source.y;
    game.campaignHazards.push({
      type: 'bottle',
      x: startX,
      y: startY,
      startX,
      startY,
      targetX,
      targetY,
      t: 0,
      flight: 0.92,
      radius: 88,
      damage: (source.damage || 12) * 0.5 + Math.max(0, game.campaign.levelIndex) * 1.5,
      life: 4.4,
      dead: false,
      spin: rand(0, TAU),
    });
  }

  function deployBossTurret(boss) {
    const alive = game.enemyTurrets.filter((t) => t.life > 0).length;
    if (alive >= 2) return;
    const found = findFreeSpotNear(
      boss.x + rand(-110, 110),
      boss.y + rand(-100, 100),
      18,
      120,
    );
    if (!found) return;
    const spot = game.campaign.arenaLocked ? clampPointToCampaignArena(found.x, found.y, 24) : found;
    if (!isPointFree(spot.x, spot.y, 20)) return;
    const turretHp = Math.round((155 + Math.max(0, game.campaign.levelIndex) * 35) * (game.campaign.rogue ? 1 + game.campaign.levelIndex * 0.08 : 1));
    game.enemyTurrets.push({
      x: spot.x,
      y: spot.y,
      r: 16,
      angle: boss.aimAngle,
      fireTimer: rand(0.4, 1.1),
      life: 12,
      maxLife: 12,
      hp: turretHp,
      maxHp: turretHp,
      hitFlash: 0,
      damage: Math.max(4, boss.damage * 0.42),
      range: 430,
      muzzleFlash: 0,
      spin: rand(0, TAU),
      dead: false,
    });
    addText(spot.x, spot.y - 25, '哨戒炮部署', '255, 133, 100', 1.2, 11, -22);
    Sfx.summon();
  }

  function explodeCampaignRocket(rocket) {
    if (rocket.dead) return;
    rocket.dead = true;
    const p = game.player;
    if (p && p.alive && dist(rocket.x, rocket.y, p.x, p.y) <= rocket.radius + p.r) {
      if (hasLineOfSight(rocket.x, rocket.y, p.x, p.y)) {
        const falloff = clamp(1 - 0.5 * (dist(rocket.x, rocket.y, p.x, p.y) / Math.max(1, rocket.radius)), 0.45, 1);
        hurtPlayer(rocket.splash * falloff, rocket.angle);
      }
    }
    game.shake = Math.max(game.shake, 7);
    game.flash = Math.max(game.flash || 0, 0.18);
    Sfx.explosion();
    game.portals.push({ x: rocket.x, y: rocket.y, life: 0.5, maxLife: 0.5, color: rocket.color, radius: rocket.radius * 1.15 });
    for (let i = 0; i < 24; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 3 === 0 ? 'shard' : 'spark',
        x: rocket.x + rand(-4, 4),
        y: rocket.y + rand(-4, 4),
        vx: Math.cos(a) * rand(40, 230),
        vy: Math.sin(a) * rand(40, 230),
        life: rand(0.2, 0.7),
        size: rand(1, 3.2),
        color: i % 3 === 0 ? '255, 125, 71' : '255, 189, 104',
        drag: 2.3,
        gravity: 40,
        alpha: 0.8,
      });
    }
    addDecal(rocket.x, rocket.y, rand(15, 25), 'scorch');
  }

  function damageEnemyTurret(turret, damage, angle = 0) {
    if (!turret || turret.dead || turret.hp <= 0) return;
    turret.hp -= damage;
    turret.hitFlash = 0.16;
    for (let i = 0; i < 3; i += 1) {
      addParticle({
        type: 'spark',
        x: turret.x + rand(-8, 8),
        y: turret.y + rand(-8, 8),
        vx: Math.cos(angle) * rand(20, 80) + rand(-24, 24),
        vy: Math.sin(angle) * rand(20, 80) + rand(-24, 24),
        life: rand(0.15, 0.35),
        size: rand(0.8, 1.9),
        color: '255, 177, 119',
        drag: 3,
        alpha: 0.8,
      });
    }
    if (turret.hp > 0) return;
    turret.hp = 0;
    turret.dead = true;
    turret.life = 0;
    game.shake = Math.max(game.shake, 5);
    Sfx.explosion();
    game.portals.push({ x: turret.x, y: turret.y, life: 0.55, maxLife: 0.55, color: '255, 136, 95', radius: 52 });
    addParticle({ type: 'flash', x: turret.x, y: turret.y, life: 0.15, size: 28, color: '255, 205, 144' });
    for (let i = 0; i < 22; i += 1) {
      const a = rand(0, TAU);
      addParticle({
        type: i % 3 === 0 ? 'smoke' : 'spark',
        x: turret.x + rand(-5, 5),
        y: turret.y + rand(-5, 5),
        vx: Math.cos(a) * rand(30, 180),
        vy: Math.sin(a) * rand(30, 180),
        life: rand(0.25, 0.75),
        size: rand(1.2, 7),
        color: i % 3 === 0 ? '80, 88, 85' : i % 2 === 0 ? '255, 151, 91' : '255, 205, 125',
        drag: 2.3,
        gravity: 42,
        alpha: 0.75,
      });
    }
    addText(turret.x, turret.y - 28, '哨戒炮已摧毁', '144, 255, 210', 1.4, 11, -22);
  }

  function updateCampaignHostiles(dt) {
    const p = game.player;
    if (!p) return;

    // Boss rockets: limited steering, wall collision, then player-radius blast.
    for (const rocket of game.enemyRockets) {
      if (rocket.dead) continue;
      rocket.life -= dt;
      rocket.trailTimer -= dt;
      if (rocket.turnRate > 0) {
        const targetAngle = Math.atan2(p.y - rocket.y, p.x - rocket.x);
        let diff = ((targetAngle - rocket.angle + Math.PI * 3) % TAU) - Math.PI;
        const maxTurn = rocket.turnRate * dt;
        rocket.angle += clamp(diff, -maxTurn, maxTurn);
        rocket.vx = Math.cos(rocket.angle) * rocket.speed;
        rocket.vy = Math.sin(rocket.angle) * rocket.speed;
      }
      rocket.px = rocket.x;
      rocket.py = rocket.y;
      const nx = rocket.x + rocket.vx * dt;
      const ny = rocket.y + rocket.vy * dt;
      const wallHit = closestObstacleHit(rocket.x, rocket.y, nx, ny, 4);
      const playerT = p.alive ? segmentCircleT(rocket.x, rocket.y, nx, ny, p.x, p.y, p.r + 6) : null;
      if (wallHit && (playerT === null || wallHit.t < playerT)) {
        rocket.x = wallHit.x;
        rocket.y = wallHit.y;
        explodeCampaignRocket(rocket);
      } else if (playerT !== null && p.alive) {
        rocket.x = lerp(rocket.x, nx, playerT);
        rocket.y = lerp(rocket.y, ny, playerT);
        explodeCampaignRocket(rocket);
      } else {
        rocket.x = nx;
        rocket.y = ny;
        if (rocket.life <= 0) explodeCampaignRocket(rocket);
      }
      if (rocket.trailTimer <= 0) {
        rocket.trailTimer = 0.035;
        addParticle({
          type: 'smoke',
          x: rocket.x - Math.cos(rocket.angle) * 7,
          y: rocket.y - Math.sin(rocket.angle) * 7,
          vx: rand(-15, 15),
          vy: rand(-15, 15),
          life: rand(0.3, 0.6),
          size: rand(3, 7),
          color: '102, 98, 89',
          alpha: 0.15,
          drag: 1.8,
        });
        addParticle({
          type: 'spark',
          x: rocket.x - Math.cos(rocket.angle) * 6,
          y: rocket.y - Math.sin(rocket.angle) * 6,
          vx: rand(-20, 20),
          vy: rand(-20, 20),
          life: 0.14,
          size: 1.2,
          color: rocket.color,
          alpha: 0.7,
        });
      }
    }
    compactInPlace(game.enemyRockets, (r) => !r.dead);

    // Poison bottles and pools.
    for (const hazard of game.campaignHazards) {
      if (hazard.dead) continue;
      if (hazard.type === 'bottle') {
        hazard.t += dt;
        const t = clamp(hazard.t / hazard.flight, 0, 1);
        hazard.x = lerp(hazard.startX, hazard.targetX, t);
        hazard.y = lerp(hazard.startY, hazard.targetY, t);
        hazard.z = Math.sin(t * Math.PI) * 58;
        if (t >= 1) {
          hazard.dead = true;
          game.campaignHazards.push({
            type: 'poison',
            x: hazard.targetX,
            y: hazard.targetY,
            radius: hazard.radius,
            life: hazard.life,
            maxLife: hazard.life,
            tick: 0.2,
            damage: hazard.damage,
          });
          for (let i = 0; i < 20; i += 1) {
            const a = rand(0, TAU);
            addParticle({
              type: 'smoke',
              x: hazard.targetX + Math.cos(a) * rand(2, 35),
              y: hazard.targetY + Math.sin(a) * rand(2, 25),
              vx: Math.cos(a) * rand(10, 60),
              vy: Math.sin(a) * rand(10, 60),
              life: rand(0.7, 1.6),
              size: rand(8, 22),
              color: '92, 142, 64',
              alpha: 0.13,
              drag: 1.2,
            });
          }
          Sfx.fire();
          addDecal(hazard.targetX, hazard.targetY, 21, 'scorch');
        }
      } else if (hazard.type === 'poison') {
        hazard.life -= dt;
        hazard.tick -= dt;
        if (hazard.tick <= 0) {
          hazard.tick += 0.5;
          if (p.alive && dist(p.x, p.y, hazard.x, hazard.y) <= hazard.radius + p.r * 0.65) {
            hurtPlayer(hazard.damage, 0, { poison: true });
            addText(p.x, p.y - 28, '中毒', '129, 241, 114', 0.8, 11, -22);
          }
          for (let i = 0; i < 3; i += 1) {
            const a = rand(0, TAU);
            addParticle({
              type: 'smoke',
              x: hazard.x + Math.cos(a) * rand(0, hazard.radius * 0.8),
              y: hazard.y + Math.sin(a) * rand(0, hazard.radius * 0.6),
              vx: rand(-18, 18),
              vy: rand(-22, 6),
              life: rand(0.6, 1.5),
              size: rand(6, 18),
              color: '81, 128, 59',
              alpha: 0.1,
              drag: 1.1,
            });
          }
        }
        if (hazard.life <= 0) hazard.dead = true;
      }
    }
    game.campaignHazards = game.campaignHazards.filter((h) => !h.dead);

    // Robot-deployed sentry turrets.
    for (const turret of game.enemyTurrets) {
      if (turret.dead || turret.hp <= 0) continue;
      turret.life -= dt;
      turret.fireTimer -= dt;
      turret.muzzleFlash = Math.max(0, turret.muzzleFlash - dt);
      turret.hitFlash = Math.max(0, turret.hitFlash - dt);
      const d = dist(turret.x, turret.y, p.x, p.y);
      const los = d <= turret.range && hasLineOfSight(turret.x, turret.y, p.x, p.y);
      if (los) {
        turret.angle = Math.atan2(p.y - turret.y, p.x - turret.x);
        if (turret.fireTimer <= 0 && p.alive) {
          turret.fireTimer = 0.34;
          turret.muzzleFlash = 0.08;
          spawnHostileBullet(
            turret.x + Math.cos(turret.angle) * 18,
            turret.y + Math.sin(turret.angle) * 18,
            turret.angle + rand(-0.025, 0.025),
            { speed: 420, damage: turret.damage, size: 3.2, color: '255, 119, 91', boss: true },
          );
          Sfx.turretShot();
        }
      }
      if (turret.life <= 0) turret.dead = true;
    }
    game.enemyTurrets = game.enemyTurrets.filter((t) => !t.dead && t.hp > 0);
  }

  /* ------------------------------------------------------------
     Loot and world particles
     ------------------------------------------------------------ */
  function addParticle(particle) {
    if (!particle) return;
    const cap = effectBudget(760);
    if (game.particles.length > cap) game.particles.splice(0, game.particles.length - cap + 1);
    game.particles.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0,
      alpha: 1,
      rot: 0,
      spin: 0,
      maxLife: particle.life || 0.5,
      ...particle,
    });
  }

  function addText(x, y, text, color, life = 0.8, size = 10, vy = -28) {
    const cap = effectBudget(120);
    if (game.texts.length >= cap) game.texts.splice(0, game.texts.length - cap + 1);
    game.texts.push({ x, y, text: String(text), color, life, maxLife: life, size, vy, rot: rand(-0.06, 0.06) });
  }

  function addDecal(x, y, r, type) {
    const cap = effectBudget(90);
    if (game.decals.length >= cap) game.decals.splice(0, game.decals.length - cap + 1);
    game.decals.push({
      x,
      y,
      r,
      type,
      rot: rand(0, TAU),
      seed: Math.random() * 9999,
    });
  }

  function spawnPortalBurst(enemy) {
    const color = enemy.type === 'boss' ? '255, 100, 84' : enemy.type === 'elite' ? '206, 144, 255' : '255, 137, 91';
    game.portals.push({
      x: enemy.x,
      y: enemy.y,
      life: enemy.type === 'boss' ? 1.5 : 0.85,
      maxLife: enemy.type === 'boss' ? 1.5 : 0.85,
      color,
      radius: enemy.type === 'boss' ? 94 : 42,
    });
    const count = enemy.type === 'boss' ? 28 : 10;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + rand(-0.08, 0.08);
      const speed = rand(35, enemy.type === 'boss' ? 190 : 100);
      addParticle({
        type: 'spark',
        x: enemy.x + Math.cos(a) * 12,
        y: enemy.y + Math.sin(a) * 12,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.25, 0.8),
        size: rand(1, 2.4),
        color,
        drag: 3.2,
      });
    }
    for (let i = 0; i < (enemy.type === 'boss' ? 7 : 3); i += 1) {
      addParticle({
        type: 'smoke',
        x: enemy.x + rand(-25, 25),
        y: enemy.y + rand(-25, 25),
        vx: rand(-20, 20),
        vy: rand(-20, 20),
        life: rand(0.5, 1.1),
        size: rand(12, enemy.type === 'boss' ? 36 : 22),
        color,
        alpha: 0.2,
        drag: 2,
      });
    }
  }

  function spawnMuzzleEffect(x, y, angle, color, weaponId) {
    const count = weaponId === 'lmg' ? 8 : weaponId === 'smg' ? 4 : 5;
    for (let i = 0; i < count; i += 1) {
      const a = angle + rand(-0.26, 0.26);
      const speed = rand(80, 260);
      addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.06, 0.2),
        size: rand(1, 2.2),
        color,
        drag: 2.8,
      });
    }
    addParticle({
      type: 'muzzleFlash',
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.06,
      size: weaponId === 'lmg' ? 32 : weaponId === 'pistol' ? 20 : 24,
      color,
      angle,
    });
    addParticle({
      type: 'smoke',
      x: x + Math.cos(angle) * 2,
      y: y + Math.sin(angle) * 2,
      vx: Math.cos(angle) * rand(20, 50),
      vy: Math.sin(angle) * rand(20, 50),
      life: rand(0.3, 0.6),
      size: rand(4, 8),
      color: '173, 188, 190',
      alpha: 0.13,
      drag: 2.2,
    });
  }

  function spawnEnemyMuzzle(x, y, angle, type) {
    const color = type === 'boss' ? '255, 98, 87' : type === 'elite' ? '224, 159, 255' : '255, 143, 100';
    for (let i = 0; i < (type === 'boss' ? 8 : 4); i += 1) {
      const a = angle + rand(-0.3, 0.3);
      addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * rand(40, 100),
        vy: Math.sin(a) * rand(40, 100),
        life: rand(0.06, 0.18),
        size: rand(0.8, 2),
        color,
        drag: 3,
      });
    }
    addParticle({
      type: 'muzzleFlash',
      x,
      y,
      life: 0.055,
      size: type === 'boss' ? 28 : type === 'elite' ? 16 : 13,
      color,
      angle,
    });
  }

  function spawnCasing(p, angle, hand = 'main') {
    const cap = effectBudget(120);
    if (game.casings.length >= cap) game.casings.splice(0, game.casings.length - cap + 1);
    const side = chance(0.5) ? 1 : -1;
    const a = angle + (Math.PI / 2) * side + rand(-0.5, 0.5);
    const speed = rand(35, 100);
    const lateral = hand === 'offhand' ? -4 : 4;
    game.casings.push({
      x: p.x + Math.cos(angle) * 13 + Math.cos(angle + Math.PI / 2) * lateral,
      y: p.y + Math.sin(angle) * 13 + Math.sin(angle + Math.PI / 2) * lateral,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      rot: rand(0, TAU),
      spin: rand(-12, 12),
      life: rand(1.6, 3.2),
      maxLife: 3.2,
    });
  }

  function spawnImpact(x, y, angle, color, enemyBullet = false) {
    const count = enemyBullet ? 4 : 5;
    for (let i = 0; i < count; i += 1) {
      const a = angle + rand(-0.95, 0.95);
      addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * rand(45, 170),
        vy: Math.sin(a) * rand(45, 170),
        life: rand(0.08, 0.3),
        size: rand(0.8, 2.2),
        color,
        drag: 4,
      });
    }
    addParticle({
      type: 'smoke',
      x,
      y,
      vx: Math.cos(angle) * 10,
      vy: Math.sin(angle) * 10,
      life: rand(0.22, 0.5),
      size: rand(3, 8),
      color: '144, 160, 158',
      alpha: 0.13,
    });
    addParticle({
      type: 'flash',
      x,
      y,
      life: 0.05,
      size: 9,
      color,
    });
    if (chance(0.7)) addDecal(x, y, rand(3, 7), 'scorch');
  }

  function spawnHitSparks(x, y, angle, color, count) {
    for (let i = 0; i < count; i += 1) {
      const a = angle + Math.PI + rand(-1.1, 1.1);
      addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * rand(50, 200),
        vy: Math.sin(a) * rand(50, 200),
        life: rand(0.1, 0.35),
        size: rand(1, 2.6),
        color,
        drag: 3.4,
      });
    }
    addParticle({ type: 'flash', x, y, life: 0.04, size: 14, color });
    addParticle({
      type: 'smoke',
      x,
      y,
      vx: rand(-15, 15),
      vy: rand(-15, 15),
      life: rand(0.2, 0.45),
      size: rand(2, 7),
      color: '136, 143, 139',
      alpha: 0.1,
    });
  }

  function spawnDamageSparks(x, y, angle) {
    for (let i = 0; i < 10; i += 1) {
      const a = angle + Math.PI + rand(-1.2, 1.2);
      addParticle({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * rand(40, 150),
        vy: Math.sin(a) * rand(40, 150),
        life: rand(0.12, 0.4),
        size: rand(1, 2.2),
        color: i % 3 === 0 ? '91, 239, 249' : '255, 110, 96',
        drag: 3.6,
      });
    }
    addParticle({ type: 'flash', x, y, life: 0.09, size: 24, color: '255, 92, 90' });
  }

  function spawnDeathEffect(enemy) {
    const color = enemy.type === 'boss' ? '255, 181, 113' : enemy.type === 'elite' ? '206, 145, 255' : '255, 147, 102';
    const boss = enemy.type === 'boss';
    const count = boss ? 56 : enemy.type === 'elite' ? 24 : 14;
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, TAU);
      const speed = rand(30, boss ? 310 : 180);
      addParticle({
        type: i % 3 === 0 ? 'shard' : 'spark',
        x: enemy.x + rand(-enemy.radius * 0.5, enemy.radius * 0.5),
        y: enemy.y + rand(-enemy.radius * 0.5, enemy.radius * 0.5),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.25, boss ? 1.2 : 0.7),
        size: rand(1.5, boss ? 6 : 4),
        color: i % 4 === 0 ? '110, 242, 247' : color,
        rot: rand(0, TAU),
        spin: rand(-10, 10),
        drag: 2.3,
        gravity: 30,
      });
    }
    addParticle({
      type: 'ring',
      x: enemy.x,
      y: enemy.y,
      life: boss ? 0.95 : 0.48,
      size: boss ? 130 : 42,
      color,
      alpha: 0.7,
    });
    for (let i = 0; i < (boss ? 16 : 5); i += 1) {
      addParticle({
        type: 'smoke',
        x: enemy.x + rand(-enemy.radius, enemy.radius),
        y: enemy.y + rand(-enemy.radius, enemy.radius),
        vx: rand(-45, 45),
        vy: rand(-45, 45),
        life: rand(0.5, boss ? 1.8 : 1),
        size: rand(8, boss ? 54 : 22),
        color: boss ? '114, 78, 63' : '95, 94, 94',
        alpha: 0.16,
        drag: 1.6,
      });
    }
  }

  function updateEffects(dt) {
    for (const p of game.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) {
        const f = Math.exp(-p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      if (p.spin) p.rot += p.spin * dt;
    }
    compactInPlace(game.particles, (p) => p.life > 0);

    for (const c of game.casings) {
      c.life -= dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx *= Math.exp(-2.7 * dt);
      c.vy *= Math.exp(-2.7 * dt);
      c.rot += c.spin * dt;
      c.spin *= Math.exp(-2.2 * dt);
    }
    compactInPlace(game.casings, (c) => c.life > 0);

    for (const t of game.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-1.8 * dt);
    }
    compactInPlace(game.texts, (t) => t.life > 0);

    for (const portal of game.portals) portal.life -= dt;
    compactInPlace(game.portals, (p) => p.life > 0);

    for (const d of game.decals) d.age = (d.age || 0) + dt;
    if (game.decals.length > 90) game.decals.splice(0, game.decals.length - 90);
  }

  function updateLoot(dt) {
    const p = game.player;
    if (!p) return;
    const strongMagnet = hasTalent('creditMagnet');
    for (const coin of game.coins) {
      coin.life -= dt;
      coin.phase += dt;
      if (coin.delay > 0 && !strongMagnet) {
        coin.delay -= dt;
        continue;
      }
      const d = dist(coin.x, coin.y, p.x, p.y);
      if (strongMagnet) {
        // Global vacuum: ignore distance, drag and cover, and pull the credit
        // directly toward the operative at high speed.
        coin.magnet = true;
        coin.delay = 0;
        const speed = 1900;
        if (d <= speed * dt + p.r + 10) {
          coin.x = p.x;
          coin.y = p.y;
        } else if (d > 0.001) {
          coin.x += ((p.x - coin.x) / d) * speed * dt;
          coin.y += ((p.y - coin.y) / d) * speed * dt;
        }
      } else {
        coin.x += coin.vx * dt;
        coin.y += coin.vy * dt;
        coin.vx *= Math.exp(-3.8 * dt);
        coin.vy *= Math.exp(-3.8 * dt);
        if (d < 165) coin.magnet = true;
        if (coin.magnet && d > 0.001) {
          const pull = 540;
          coin.vx += ((p.x - coin.x) / d) * pull * dt;
          coin.vy += ((p.y - coin.y) / d) * pull * dt;
          coin.vx *= Math.exp(-1.8 * dt);
          coin.vy *= Math.exp(-1.8 * dt);
        }
      }
      const collectDistance = dist(coin.x, coin.y, p.x, p.y);
      if (collectDistance < p.r + 10) {
        coin.collected = true;
        const coinAmount = Math.round(coin.amount * characterCreditMultiplier());
        p.credits += coinAmount;
        game.creditsEarned += coinAmount;
        addText(coin.x, coin.y - 8, `+${coinAmount} CR`, '255, 211, 122', 0.8, 9, -32);
        if (game.time >= (game.nextCoinSound || 0)) {
          Sfx.coin();
          game.nextCoinSound = game.time + 0.045;
        }
      }
    }
    compactInPlace(game.coins, (c) => !c.collected && c.life > 0);

    for (const item of game.pickups) {
      item.life -= dt;
      item.bob += dt * 2.4;
      const d = dist(item.x, item.y, p.x, p.y);
      if (d < p.r + 14 && p.hp < p.maxHp) {
        item.collected = true;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + 32);
        addText(p.x, p.y - 28, `+${Math.round(p.hp - before)} HP`, '143, 255, 195', 0.9, 10, -34);
        Sfx.heal();
      }
    }
    compactInPlace(game.pickups, (i) => !i.collected && i.life > 0);

    if (game.damageFlash > 0) {
      game.damageFlash = Math.max(0, game.damageFlash - dt * 2.8);
      dom.damageVignette.style.opacity = String(clamp(game.damageFlash, 0, 0.9));
    } else if (dom.damageVignette.style.opacity !== '0') {
      dom.damageVignette.style.opacity = '0';
    }
    if (game.hitFlash > 0) {
      game.hitFlash = Math.max(0, game.hitFlash - dt * 2.35);
      dom.hitFlash.style.opacity = String(clamp(game.hitFlash, 0, 0.88));
    } else if (dom.hitFlash.style.opacity !== '0') {
      dom.hitFlash.style.opacity = '0';
    }
    game.hitMarker = Math.max(0, game.hitMarker - dt);
    game.killMarker = Math.max(0, game.killMarker - dt);
    game.flash = Math.max(0, (game.flash || 0) - dt * 4);
  }

  /* ------------------------------------------------------------
     Simulation loop helpers / camera
     ------------------------------------------------------------ */
  function desiredMusicMode() {
    if (introState.active) return 'off';
    if (game.mode === 'settings' || game.mode === 'paused' || game.mode === 'shop' || game.mode === 'talents') return 'off';
    if (game.mode === 'menu' || game.mode === 'characters' || game.mode === 'bestiary') return 'menu';
    if (!game.player) return 'off';
    if (game.mode === 'dying' || game.mode === 'gameover' || game.mode === 'campaignComplete') return 'off';
    if (game.mode !== 'playing') return 'off';
    if (game.runMode === 'campaign') {
      if (!game.campaign.active) return 'off';
      return game.campaign.bossActive ? 'boss' : 'combat';
    }
    if (game.runMode === 'endless') {
      if (game.intermission) return 'calm';
      if (!game.waveActive) return 'calm';
      if (game.bossRef && !game.bossRef.dead) return 'boss';
      return 'combat';
    }
    return 'off';
  }

  function updateGame(dt, updateInterface = true) {
    const p = game.player;
    if (!p) return;
    game.runTime += dt;
    game.perfClock += dt;
    if (game.perfClock >= 0.5) {
      game.perfClock = 0;
      trimRuntimeCollections();
    }
    updatePlayer(dt);
    updateCharacterSkills(dt);
    updatePet(dt);
    updateEnemies(dt);
    updateTurrets(dt);
    updateBullets(dt);
    updatePlayerMissiles(dt);
    updateEnemyBullets(dt);
    updateCampaignHostiles(dt);
    updateGrenades(dt);
    updateLoot(dt);
    updateEffects(dt);
    if (game.mode === 'playing') {
      if (game.runMode === 'campaign') updateCampaign(dt);
      else if (game.runMode === 'training') updateTraining(dt);
      else if (game.runMode === 'story') updateStoryCombat(dt);
      else updateWave(dt);
    }
    updateCamera(dt);
    if (updateInterface) updateHUD();
    if (game.shake > 0.03) {
      game.shake *= Math.exp(-8.5 * dt);
    } else {
      game.shake = 0;
    }
  }

  function updateDying(dt) {
    game.deathTimer -= dt;
    updateEffects(dt * 0.5);
    updateCamera(dt);
    game.damageFlash = Math.max(0, game.damageFlash - dt * 1.5);
    dom.damageVignette.style.opacity = String(clamp(game.damageFlash, 0, 0.9));
    game.hitFlash = Math.max(0, game.hitFlash - dt * 1.7);
    dom.hitFlash.style.opacity = String(clamp(game.hitFlash, 0, 0.88));
    game.shake *= Math.exp(-4.5 * dt);
    if (game.deathTimer <= 0) finishGameOver();
  }

  function updateMenuScene(dt) {
    game.menuClock += dt;
    const t = game.menuClock;
    const targetX = 690 + Math.sin(t * 0.045) * 110 + Math.sin(t * 0.017) * 40;
    const targetY = 330 + Math.cos(t * 0.038) * 65;
    game.camera.targetX = clampCameraX(targetX);
    game.camera.targetY = clampCameraY(targetY);
    game.camera.x = lerp(game.camera.x, game.camera.targetX, 1 - Math.exp(-0.7 * dt));
    game.camera.y = lerp(game.camera.y, game.camera.targetY, 1 - Math.exp(-0.7 * dt));
    if (game.shake > 0.01) game.shake *= Math.exp(-6 * dt);
  }

  function clampCameraX(x) {
    const viewW = game.viewW / CAMERA_ZOOM;
    if (viewW >= WORLD.w) return (WORLD.w - viewW) / 2;
    return clamp(x, 0, WORLD.w - viewW);
  }

  function clampCameraY(y) {
    const viewH = game.viewH / CAMERA_ZOOM;
    if (viewH >= WORLD.h) return (WORLD.h - viewH) / 2;
    return clamp(y, 0, WORLD.h - viewH);
  }

  function updateCamera(dt) {
    const p = game.player;
    if (!p) return;
    const viewW = game.viewW / CAMERA_ZOOM;
    const viewH = game.viewH / CAMERA_ZOOM;
    const lookX = clamp(((input.screenX - game.viewW / 2) / CAMERA_ZOOM) * 0.04, -58, 58);
    const lookY = clamp(((input.screenY - game.viewH / 2) / CAMERA_ZOOM) * 0.03, -34, 34);
    let targetX = p.x - viewW / 2 + lookX;
    let targetY = p.y - viewH / 2 + lookY;
    const liveBoss = game.bossRef;
    if (liveBoss && !liveBoss.dead && !game.intermission) {
      targetX += clamp((liveBoss.x - p.x) * 0.3, -120, 120);
      targetY += clamp((liveBoss.y - p.y) * 0.42, -150, 150);
    }
    targetX = clampCameraX(targetX);
    targetY = clampCameraY(targetY);
    game.camera.targetX = targetX;
    game.camera.targetY = targetY;
    const ease = 1 - Math.exp(-7.2 * dt);
    game.camera.x = lerp(game.camera.x, targetX, ease);
    game.camera.y = lerp(game.camera.y, targetY, ease);
  }

  function resizeCanvas() {
    const dprCap = QUALITY_SETTINGS[game.quality]?.dprCap || 2;
    const dpr = Math.min(dprCap, Math.max(1, window.devicePixelRatio || 1));
    game.dpr = dpr;
    game.viewW = window.innerWidth;
    game.viewH = window.innerHeight;
    dom.canvas.width = Math.floor(game.viewW * dpr);
    dom.canvas.height = Math.floor(game.viewH * dpr);
    dom.canvas.style.width = `${game.viewW}px`;
    dom.canvas.style.height = `${game.viewH}px`;
    input.screenX = clamp(input.screenX, 0, game.viewW);
    input.screenY = clamp(input.screenY, 0, game.viewH);
    if (game.player) {
      game.camera.x = clampCameraX(game.camera.x);
      game.camera.y = clampCameraY(game.camera.y);
    }
    if (game.mode === 'menu') {
      game.camera.x = clampCameraX(690);
      game.camera.y = clampCameraY(330);
    }
  }

  /* ------------------------------------------------------------
     Input and UI bindings
     ------------------------------------------------------------ */
  function toggleSound() {
    Sfx.init();
    const muted = Sfx.toggle();
    applySoundUI();
    if (!muted) Sfx.click();
  }

  function updatePointerPosition(event) {
    input.screenX = clamp(event.clientX, 0, game.viewW);
    input.screenY = clamp(event.clientY, 0, game.viewH);
    if (game.mode === 'playing') input.overCanvas = event.target === dom.canvas;
  }

  function bindEvents() {
    document.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty));
    });
    document.querySelectorAll('[data-menu-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMenuMode(btn.dataset.menuMode));
    });
    dom.btnStart.addEventListener('click', () => startCurrentRun(true));
    dom.btnClearCheckpoint?.addEventListener('click', () => { clearEndlessCheckpoint(true); Sfx.init(); Sfx.click(); });
    dom.introSkip.addEventListener('click', finishIntro);
    dom.introEnter.addEventListener('click', finishIntro);
    dom.btnCampaignAgain.addEventListener('click', () => startCampaignRun(0, true));
    dom.btnCampaignMenu.addEventListener('click', returnToMenu);
    dom.btnMenuAudio.addEventListener('click', toggleSound);
    dom.btnMenuSettings.addEventListener('click', openSettings);
    dom.btnMenuCharacters.addEventListener('click', openCharacters);
    dom.btnMenuBestiary.addEventListener('click', openBestiary);
    dom.btnCharactersClose.addEventListener('click', closeCharacters);
    dom.btnBestiaryClose.addEventListener('click', closeBestiary);
    dom.charactersOverlay.addEventListener('click', (event) => {
      if (event.target === dom.charactersOverlay) closeCharacters();
    });
    dom.bestiaryOverlay.addEventListener('click', (event) => {
      if (event.target === dom.bestiaryOverlay) closeBestiary();
    });
    dom.characterGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-char-action]');
      if (!button) return;
      const id = button.dataset.characterId;
      if (button.dataset.charAction === 'unlock') unlockCharacter(id);
      else selectCharacter(id);
    });
    document.querySelectorAll('[data-roster-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setRosterTab(btn.dataset.rosterTab);
        Sfx.click();
      });
    });
    dom.petGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pet-action]');
      if (!button) return;
      if (button.dataset.petAction === 'unlock') unlockPet(button.dataset.petId);
      else if (button.dataset.petAction === 'select') selectPet(button.dataset.petId);
      else if (button.dataset.petAction === 'unequip') {
        game.selectedPet = '';
        storeString('labzero.selectedPet', '');
        renderPets();
        renderCharacters();
        Sfx.click();
        addToast('○', '已卸下宠物', '下一局将不再携带宠物出战', '', 2800);
      }
    });
    dom.bestiaryFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-bestiary-filter]');
      if (!button) return;
      game.bestiaryFilter = button.dataset.bestiaryFilter;
      renderBestiary();
    });
    dom.btnAudio.addEventListener('click', toggleSound);
    dom.btnSettings.addEventListener('click', openSettings);
    dom.btnSettingsClose.addEventListener('click', closeSettings);
    dom.btnSettingsBack.addEventListener('click', closeSettings);
    dom.settingsOverlay.addEventListener('click', (event) => {
      if (event.target === dom.settingsOverlay) closeSettings();
    });
    dom.settingsMute.addEventListener('click', toggleSound);
    dom.settingsSfx.addEventListener('input', () => {
      const value = clamp(Number(dom.settingsSfx.value) / 100, 0, 1);
      Sfx.setSfxVolume(value);
      setText(dom.settingsSfxValue, `${Math.round(value * 100)}%`);
    });
    dom.settingsMusic.addEventListener('input', () => {
      const value = clamp(Number(dom.settingsMusic.value) / 100, 0, 1);
      Sfx.setMusicVolume(value);
      setText(dom.settingsMusicValue, `${Math.round(value * 100)}%`);
    });
    document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
    });
    dom.btnDevEnable?.addEventListener('click', enableDeveloperMode);
    dom.btnDevDisable?.addEventListener('click', disableDeveloperMode);
    dom.devPassword?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        enableDeveloperMode();
      }
    });
    document.querySelectorAll('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => setQuality(btn.dataset.quality));
    });
    dom.btnFullscreen.addEventListener('click', toggleFullscreen);
    dom.btnPause.addEventListener('click', openPause);
    dom.btnSpeed.addEventListener('click', toggleGameSpeed);
    dom.btnResume.addEventListener('click', resumeGame);
    dom.btnPauseRestart.addEventListener('click', restartRun);
    dom.btnPauseMenu.addEventListener('click', returnToMenu);
    dom.btnRetry.addEventListener('click', restartRun);
    dom.btnMenu.addEventListener('click', returnToMenu);
    dom.shopClose.addEventListener('click', closeShop);
    dom.btnShop.addEventListener('click', () => {
      if (game.runMode === 'campaign') {
        Sfx.error();
        addToast('F', '需要在商店终端操作', '靠近实验区内的商店终端并按 F', 'danger', 2800);
        return;
      }
      openShop();
    });
    dom.btnNextWave.addEventListener('click', advanceWaveEarly);
    dom.btnInterShop.addEventListener('click', openShop);
    dom.btnInterTalents.addEventListener('click', openTalents);
    dom.btnBuyMedkit.addEventListener('click', buyMedkit);
    dom.btnTalents.addEventListener('click', openTalents);
    dom.talentClose.addEventListener('click', closeTalents);
    dom.btnCharacterSkill.addEventListener('click', useCharacterSkill);
    dom.btnTurret.addEventListener('click', deployTurret);
    document.querySelectorAll('[data-training-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleTrainingAction(btn.dataset.trainingAction));
    });
    dom.btnStoryExit?.addEventListener('click', returnToMenu);
    dom.storyOverlay?.addEventListener('click', (event) => {
      if (game.mode !== 'story' || event.target.closest('button')) return;
      if (game.story?.failed || game.story?.ending) return;
      advanceStory();
    });
    dom.storyChoices?.addEventListener('click', (event) => {
      const finalButton = event.target.closest('[data-story-final]');
      if (finalButton) {
        const action = finalButton.dataset.storyFinal;
        if (action === 'retry') retryStoryCombat();
        else if (action === 'restart') {
          const previous = game.story
            ? { previousCharacter: game.story.previousCharacter, previousDifficulty: game.story.previousDifficulty }
            : null;
          startStoryMode(false, previous);
        } else if (action === 'menu') returnToMenu();
        return;
      }
      const choice = event.target.closest('[data-story-choice]');
      if (choice) chooseStoryOption(Number(choice.dataset.storyChoice));
    });

    dom.talentOverlay.addEventListener('click', (event) => {
      if (event.target === dom.talentOverlay) closeTalents();
    });
    dom.talentTree.addEventListener('click', (event) => {
      const node = event.target.closest('.talent-node');
      if (!node || !game.player || game.mode !== 'talents') return;
      if (node.classList.contains('is-unlocked') && !isTraining()) return;
      unlockTalent(node.dataset.talentId);
    });

    dom.shopOverlay.addEventListener('click', (event) => {
      if (event.target === dom.shopOverlay) closeShop();
    });

    dom.grenadeSlots.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-grenade-select]');
      if (btn) selectGrenade(btn.dataset.grenadeSelect);
    });

    dom.grenadeList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-grenade-buy]');
      if (!btn || btn.disabled || !game.player) return;
      buyGrenade(btn.dataset.grenadeBuy);
    });

    dom.weaponList.addEventListener('click', (event) => {
      const card = event.target.closest('.weapon-card');
      if (!card || !game.player) return;
      buyWeapon(card.dataset.weaponId);
    });

    dom.modGrid.addEventListener('click', (event) => {
      const card = event.target.closest('.mod-card');
      if (!card || card.disabled || !game.player) return;
      upgradeMod(card.dataset.mod);
    });

    dom.campaignUpgradeList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-campaign-upgrade]');
      if (!card || card.disabled || !game.player) return;
      buyCampaignUpgrade(card.dataset.campaignUpgrade);
    });

    dom.weaponSlots.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (game.mode !== 'playing' || !game.player || !hasTalent('dualWield')) return;
      const slot = event.target.closest('.weapon-slot');
      if (!slot) return;
      const id = slot.dataset.weapon;
      if (!game.player.owned[id]) return;
      if (id === game.player.weapon) {
        addToast('i', '副手槽位不可与主手相同', '切换主手武器后再指定该副手', '', 2600);
        Sfx.error();
        return;
      }
      if (setOffhand(id)) {
        addToast('R', `副手已切换 · ${WEAPONS[id].name}`, '按住右键使用副手射击', 'gold', 2800);
        updateHUD();
      }
    });

    dom.weaponSlots.addEventListener('click', (event) => {
      const slot = event.target.closest('.weapon-slot');
      if (!slot || !game.player) return;
      const id = slot.dataset.weapon;
      if (game.player.owned[id]) {
        if (game.mode === 'playing') {
          setWeapon(id);
          updateHUD();
        }
      } else if (game.mode === 'playing') {
        openShop();
      }
    });

    dom.canvas.addEventListener('pointerdown', (event) => {
      if (game.mode !== 'playing' || game.player?.reviving) return;
      if (event.button !== 0 && event.button !== 2) return;
      Sfx.init();
      updatePointerPosition(event);
      input.pointerId = event.pointerId;
      input.overCanvas = true;
      try {
        dom.canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        /* pointer capture is optional */
      }
      if (event.button === 0) {
        input.firing = true;
        tryShoot('main');
      } else if (hasTalent('dualWield') && game.player?.offhand) {
        input.firingSecondary = true;
        tryShoot('offhand');
      }
      event.preventDefault();
    });

    window.addEventListener('pointermove', updatePointerPosition, { passive: true });
    dom.canvas.addEventListener('pointerenter', () => {
      input.overCanvas = true;
    });
    dom.canvas.addEventListener('pointerleave', () => {
      input.overCanvas = false;
    });
    window.addEventListener('pointerup', (event) => {
      if (event.button === 0) input.firing = false;
      if (event.button === 2) input.firingSecondary = false;
      if (input.pointerId === event.pointerId && !input.firing && !input.firingSecondary) input.pointerId = null;
    });
    window.addEventListener('pointercancel', () => {
      input.firing = false;
      input.firingSecondary = false;
      input.pointerId = null;
    });
    dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('contextmenu', (event) => {
      if (game.mode === 'playing' && event.target === dom.canvas) event.preventDefault();
    });
    dom.canvas.addEventListener('dragstart', (event) => event.preventDefault());

    window.addEventListener('keydown', (event) => {
      const code = event.code;
      const isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '');
      if (game.mode === 'settings' && code === 'Escape') {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (isTyping) return;
      if (introState.active) {
        if (!event.repeat && ['Enter', 'NumpadEnter', 'Escape', 'Space'].includes(code)) {
          event.preventDefault();
          finishIntro();
        }
        return;
      }

      if (game.mode === 'story') {
        if (code === 'Escape') {
          event.preventDefault();
          returnToMenu();
          return;
        }
        if ((code === 'Space' || code === 'Enter' || code === 'NumpadEnter') && !event.repeat) {
          if (event.target?.closest?.('button')) return;
          event.preventDefault();
          if (!game.story?.failed && !game.story?.ending) advanceStory();
        }
        return;
      }

      if (game.mode === 'campaignComplete') {
        if (!event.repeat && (code === 'Enter' || code === 'NumpadEnter')) {
          event.preventDefault();
          startCampaignRun(0, false, false);
        } else if (code === 'Escape') {
          event.preventDefault();
          returnToMenu();
        }
        return;
      }

      if (code === 'Escape') {
        event.preventDefault();
        if (game.mode === 'characters') closeCharacters();
        else if (game.mode === 'bestiary') closeBestiary();
        else if (game.mode === 'settings') closeSettings();
        else if (game.mode === 'talents') closeTalents();
        else if (game.mode === 'shop') closeShop();
        else if (game.mode === 'paused') resumeGame();
        else if (game.mode === 'playing') openPause();
        return;
      }

      if (code === 'KeyU' && !event.repeat && game.mode === 'playing') {
        event.preventDefault();
        if (!hasTalent('intelligenceCore')) {
          Sfx.error();
          addToast('U', '智慧核心未解锁', '在科技树「火力协议」中解锁终极天赋后启用', '', 3000);
        } else {
          game.autoAimEnabled = !game.autoAimEnabled;
          if (!game.autoAimEnabled) game.autoAimTarget = null;
          addToast('◎', `自动瞄准 ${game.autoAimEnabled ? '已开启' : '已关闭'}`, '按 U 随时切换 · 仅影响瞄准方向', game.autoAimEnabled ? 'gold' : '', 2600);
          Sfx.click();
        }
        return;
      }

      if (code === 'KeyT') {
        if (game.mode === 'talents') {
          event.preventDefault();
          closeTalents();
        } else if (game.mode === 'playing') {
          event.preventDefault();
          openTalents();
        }
        return;
      }

      if (code === 'KeyB' || code === 'Tab') {
        if (game.mode === 'playing' || game.mode === 'shop') {
          event.preventDefault();
          if (game.mode === 'shop') closeShop();
          else if (game.runMode === 'campaign') {
            Sfx.error();
            addToast('F', '需要在商店终端操作', '靠近实验区内的商店终端并按 F', 'danger', 2800);
          } else openShop();
        }
        return;
      }

      if (code === 'KeyM') {
        event.preventDefault();
        toggleSound();
        return;
      }

      if (game.mode === 'menu' && !event.repeat && (code === 'Enter' || code === 'NumpadEnter') && event.target?.tagName !== 'BUTTON') {
        event.preventDefault();
        startCurrentRun(true);
        return;
      }
      if (game.mode === 'gameover' && !event.repeat && (code === 'Enter' || code === 'NumpadEnter') && event.target?.tagName !== 'BUTTON') {
        event.preventDefault();
        restartRun();
        return;
      }

      if (game.mode !== 'playing') return;

      const movementCodes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (movementCodes.includes(code)) {
        input.keys.add(code);
        event.preventDefault();
        return;
      }

      if (event.repeat) return;
      if (code === 'KeyR') {
        startReload();
        event.preventDefault();
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        if (game.player?.characterId === 'valkyrie') input.keys.add(code);
        else startDash();
        event.preventDefault();
      } else if (code === 'KeyN') {
        if (game.intermission) {
          startNextWave();
          event.preventDefault();
        }
      } else if (code === 'KeyF') {
        if (game.runMode === 'campaign') tryCampaignInteract();
        else deployTurret();
        event.preventDefault();
      } else if (code === 'Space') {
        useCharacterSkill();
        event.preventDefault();
      } else if (code === 'KeyQ') {
        throwGrenade();
        event.preventDefault();
      } else if (code === 'KeyE') {
        if (game.runMode === 'campaign') searchNearbyCampaignObject();
        else cycleGrenade();
        event.preventDefault();
      } else if (code === 'KeyG') {
        cycleGrenade();
        event.preventDefault();
      } else if (/^Digit[1-5]$/.test(code)) {
        const idx = Number(code.slice(5)) - 1;
        const id = WEAPON_ORDER[idx];
        if (id && game.player.owned[id]) {
          setWeapon(id);
          updateHUD();
        }
        event.preventDefault();
      }
    });

    window.addEventListener('keyup', (event) => {
      input.keys.delete(event.code);
    });

    window.addEventListener('blur', () => {
      input.keys.clear();
      input.firing = false;
      input.firingSecondary = false;
      input.pointerId = null;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        input.keys.clear();
        input.firing = false;
        input.firingSecondary = false;
        if (game.mode === 'playing') openPause();
      }
    });

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    window.addEventListener('beforeunload', () => {
      if (game.mode !== 'menu') saveBestWave();
    });
  }

  /* ------------------------------------------------------------
     Rendering helpers
     ------------------------------------------------------------ */
  const rgba = (color, alpha) => `rgba(${color}, ${alpha})`;

  function inView(x, y, pad = 90, camX = game.camera.x, camY = game.camera.y) {
    const viewW = game.viewW / CAMERA_ZOOM;
    const viewH = game.viewH / CAMERA_ZOOM;
    return x >= camX - pad && x <= camX + viewW + pad && y >= camY - pad && y <= camY + viewH + pad;
  }

  function drawFloorGlows(ctx) {
    if (game.runMode === 'campaign') return;
    const t = game.time;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < DOORS.length; i += 1) {
      const door = DOORS[i];
      const pulse = 0.68 + Math.sin(t * 2.15 + i * 1.7) * 0.24 + Math.sin(t * 6.1 + i) * 0.05;
      const x = door.sx;
      const y = door.sy;
      const g = ctx.createRadialGradient(x, y, 4, x, y, 185);
      g.addColorStop(0, `rgba(255, 96, 70, ${0.085 * pulse})`);
      g.addColorStop(0.42, `rgba(255, 92, 65, ${0.035 * pulse})`);
      g.addColorStop(1, 'rgba(255, 92, 65, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 185, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.55 + i);
      ctx.strokeStyle = `rgba(255, 119, 87, ${0.11 * pulse})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 13]);
      ctx.beginPath();
      ctx.arc(0, 0, 46 + Math.sin(t * 1.8 + i) * 3, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawDecals(ctx, camX, camY) {
    for (const d of game.decals) {
      if (!inView(d.x, d.y, d.r + 20, camX, camY)) continue;
      const rng = mulberry32(Math.floor(d.seed) + 17);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      if (d.type === 'fluid') {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#160e0e';
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.ellipse((rng() - 0.5) * d.r, (rng() - 0.5) * d.r * 0.7, d.r * (0.4 + rng() * 0.7), d.r * (0.2 + rng() * 0.5), rng() * TAU, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#523b35';
        ctx.beginPath();
        ctx.ellipse(0, 0, d.r * 0.5, d.r * 0.3, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.34;
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, d.r);
        g.addColorStop(0, 'rgba(0,0,0,0.62)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, d.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#62c7c8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, d.r * 0.36, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPortals(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.portals) {
      if (!inView(p.x, p.y, p.radius + 20)) continue;
      const progress = 1 - p.life / p.maxLife;
      const alpha = Math.sin(clamp(progress, 0, 1) * Math.PI) * 0.8 + 0.08;
      const radius = p.radius * (0.16 + progress * 0.84);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(game.time * 0.8 + progress * 2);
      ctx.strokeStyle = rgba(p.color, alpha * 0.55);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(p.color, alpha * 0.28);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.68, 0.3, 2.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.68, Math.PI + 0.3, Math.PI + 2.15);
      ctx.stroke();
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      g.addColorStop(0, rgba(p.color, alpha * 0.12));
      g.addColorStop(0.65, rgba(p.color, alpha * 0.035));
      g.addColorStop(1, rgba(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCoins(ctx, camX, camY) {
    ctx.save();
    for (const coin of game.coins) {
      if (!inView(coin.x, coin.y, 30, camX, camY)) continue;
      const fade = coin.life < 6 ? clamp(coin.life / 6, 0, 1) : 1;
      const bob = Math.sin(game.time * 3.2 + coin.phase) * 1.8;
      ctx.save();
      ctx.translate(coin.x, coin.y + bob);
      ctx.rotate(game.time * 2.2 + coin.phase);
      ctx.globalAlpha = fade;
      ctx.shadowColor = 'rgba(255, 187, 90, 0.6)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffd17d';
      ctx.beginPath();
      ctx.moveTo(0, -coin.r);
      ctx.lineTo(coin.r * 0.8, 0);
      ctx.lineTo(0, coin.r);
      ctx.lineTo(-coin.r * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff2c3';
      ctx.beginPath();
      ctx.moveTo(0, -coin.r * 0.55);
      ctx.lineTo(coin.r * 0.3, 0);
      ctx.lineTo(0, coin.r * 0.35);
      ctx.lineTo(-coin.r * 0.3, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(109, 70, 27, 0.6)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -coin.r);
      ctx.lineTo(0, coin.r);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPickups(ctx, camX, camY) {
    for (const item of game.pickups) {
      if (!inView(item.x, item.y, 30, camX, camY)) continue;
      const bob = Math.sin(item.bob) * 3;
      ctx.save();
      ctx.translate(item.x, item.y + bob);
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 25);
      glow.addColorStop(0, 'rgba(108, 255, 172, 0.28)');
      glow.addColorStop(1, 'rgba(108, 255, 172, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 25, 0, TAU);
      ctx.fill();
      ctx.rotate(Math.sin(item.bob * 0.5) * 0.05);
      rrPath(ctx, -10, -8, 20, 16, 3);
      ctx.fillStyle = '#0c201a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(126, 255, 188, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#8affc1';
      ctx.fillRect(-2, -5, 4, 10);
      ctx.fillRect(-5, -2, 10, 4);
      ctx.fillStyle = 'rgba(198, 255, 224, 0.55)';
      ctx.fillRect(-8, -6, 4, 1);
      ctx.restore();
    }
  }

  function drawCasings(ctx, camX, camY) {
    ctx.save();
    ctx.fillStyle = '#c6a65e';
    for (const c of game.casings) {
      if (!inView(c.x, c.y, 20, camX, camY)) continue;
      const fade = clamp(c.life / 0.7, 0, 1);
      ctx.globalAlpha = fade * 0.7;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillRect(-2.5, -1, 5, 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTelegraphs(ctx, camX, camY) {
    const p = game.player;
    if (!p) return;
    for (const e of game.enemies) {
      if (e.dead || e.spawnTimer > 0) continue;
      if (!inView(e.x, e.y, 250, camX, camY) && !inView(p.x, p.y, 250, camX, camY)) continue;
      const color = e.type === 'boss' ? '255, 92, 79' : e.type === 'elite' ? '213, 140, 255' : '255, 132, 91';
      if (e.windup > 0 && e.hasLOS) {
        const charge = clamp(1 - e.windup / e.telegraph, 0, 1);
        const mx = e.x + Math.cos(e.aimAngle) * (e.radius + 9);
        const my = e.y + Math.sin(e.aimAngle) * (e.radius + 9);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(color, 0.1 + charge * 0.42);
        ctx.lineWidth = 0.8 + charge * 0.9;
        ctx.setLineDash([2.5, 7]);
        ctx.lineDashOffset = -game.time * 30;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 24 + charge * 26);
        g.addColorStop(0, rgba(color, 0.2 + charge * 0.26));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mx, my, 24 + charge * 26, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(color, 0.25 + charge * 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 13 + Math.sin(game.time * 11) * 1.5 + (1 - charge) * 18, 0, TAU);
        ctx.stroke();
        if (e.type === 'boss') {
          const count = e.phase2 ? 7 : 5;
          const spread = e.phase2 ? 0.66 : 0.54;
          for (let i = 0; i < count; i += 1) {
            const off = (i - (count - 1) / 2) * (spread / (count - 1));
            ctx.strokeStyle = rgba(color, 0.08 + charge * 0.14);
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(e.aimAngle + off) * 220, my + Math.sin(e.aimAngle + off) * 220);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (e.summonWindup > 0) {
        const charge = clamp(1 - e.summonWindup / 1.2, 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(e.x, e.y);
        ctx.rotate(game.time * 1.7);
        ctx.strokeStyle = rgba('255, 105, 92', 0.2 + charge * 0.5);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 9]);
        ctx.beginPath();
        ctx.arc(0, 0, 68 + charge * 24, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 3; i += 1) {
          ctx.rotate(TAU / 3);
          ctx.strokeStyle = rgba('255, 184, 118', 0.18 + charge * 0.35);
          ctx.beginPath();
          ctx.moveTo(46, -8);
          ctx.lineTo(62, 0);
          ctx.lineTo(46, 8);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawPlayerGun(ctx, p, hand = 'main') {
    const weaponId = hand === 'offhand' ? p.offhand : p.weapon;
    const w = WEAPONS[weaponId];
    if (!w) return;
    const reloading = hand === 'offhand' ? p.offhandReloading : p.reloading;
    const reloadTimer = hand === 'offhand' ? p.offhandReloadTimer : p.reloadTimer;
    const reloadDuration = hand === 'offhand' ? p.offhandReloadDuration : p.reloadDuration;
    const reloadProgress = reloading ? 1 - reloadTimer / Math.max(0.001, reloadDuration) : 0;
    const flashTimer = hand === 'offhand' ? p.offhandShootFlash : p.shootFlash;
    const recoil = flashTimer > 0 ? 1.5 : 0;
    const originX = 9;
    const originY = hand === 'offhand' ? -4 : 4;
    const tip = w.gunLength - originX;
    ctx.save();
    ctx.translate(originX - recoil, originY);
    if (reloading) {
      ctx.rotate(Math.sin(reloadProgress * Math.PI) * 0.36);
      ctx.translate(0, Math.sin(reloadProgress * Math.PI) * 2);
    }
    ctx.fillStyle = '#0a1012';
    ctx.strokeStyle = 'rgba(122, 161, 162, 0.3)';
    ctx.lineWidth = 0.8;

    if (weaponId === 'pistol') {
      rrPath(ctx, 0, -3.2, 15, 6.2, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#26383b';
      ctx.fillRect(1, -2.5, 12, 1.5);
      ctx.fillStyle = '#111b1d';
      ctx.fillRect(12, -1.8, tip - 12, 3.1);
      ctx.fillStyle = '#233537';
      ctx.fillRect(0, 3, 7, 7);
      ctx.strokeStyle = 'rgba(149, 193, 193, 0.25)';
      ctx.beginPath();
      ctx.arc(6, 3, 4.1, -0.2, 1.9);
      ctx.stroke();
      ctx.fillStyle = 'rgba(112, 235, 241, 0.55)';
      ctx.fillRect(2, -1.2, 5, 1);
    } else if (weaponId === 'smg') {
      ctx.fillStyle = '#10191b';
      ctx.fillRect(-10, -2.2, 10, 4.4);
      rrPath(ctx, 0, -3.4, 17, 6.6, 1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#26383a';
      ctx.fillRect(1, -2.6, 14, 1.5);
      ctx.fillStyle = '#121d1f';
      ctx.fillRect(17, -1.8, tip - 17, 3);
      ctx.fill();
      ctx.fillStyle = '#101a1c';
      ctx.fillRect(6, 3.2, 5.5, 11);
      ctx.fillStyle = '#213033';
      ctx.fillRect(8, 9, 2, 5);
      ctx.strokeStyle = 'rgba(155, 196, 193, 0.34)';
      ctx.strokeRect(17, -2.1, 4, 2);
      ctx.fillStyle = 'rgba(115, 240, 243, 0.58)';
      ctx.fillRect(2, -1.1, 5, 1);
    } else if (weaponId === 'ar') {
      ctx.fillStyle = '#111a1c';
      ctx.fillRect(-11, -2.4, 11, 4.8);
      rrPath(ctx, 0, -3.5, 23, 7, 1.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2a3b3d';
      ctx.fillRect(1, -2.6, 20, 1.4);
      ctx.fillStyle = '#152023';
      ctx.fillRect(23, -1.7, tip - 23, 2.8);
      ctx.fillRect(30, -2.8, tip - 30, 1.2);
      ctx.fillStyle = '#0d1618';
      ctx.fillRect(8, 3.5, 5.5, 11);
      ctx.save();
      ctx.rotate(0.2);
      ctx.fillRect(11, 10, 4, 7);
      ctx.restore();
      ctx.fillStyle = '#1b2c2d';
      rrPath(ctx, 7, -8.5, 11, 4, 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(114, 243, 245, 0.4)';
      ctx.beginPath();
      ctx.arc(16, -6.5, 1.5, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120, 244, 247, 0.6)';
      ctx.fillRect(2, -1, 6, 1);
    } else if (weaponId === 'lmg') {
      ctx.fillStyle = '#111a1c';
      ctx.fillRect(-12, -2.6, 12, 5.2);
      rrPath(ctx, 0, -4.3, 25, 8.5, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#293b3c';
      ctx.fillRect(1, -3.4, 22, 1.6);
      ctx.fillStyle = '#162224';
      ctx.fillRect(25, -2.1, tip - 25, 3.8);
      ctx.fillRect(25, -3.2, tip - 27, 1.1);
      ctx.fillStyle = '#0c1517';
      rrPath(ctx, 7, 4.5, 11, 8, 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(144, 179, 169, 0.3)';
      ctx.strokeRect(9, 5, 7, 5);
      ctx.fillStyle = '#1c2b2c';
      ctx.fillRect(29, 4, 2, 6);
      ctx.fillRect(11, -7, 11, 2.6);
      ctx.fillStyle = 'rgba(255, 155, 92, 0.55)';
      ctx.fillRect(3, -1.2, 5, 1);
    } else {
      // Heavy rocket tube with a warhead and a side grip.
      ctx.fillStyle = '#10191a';
      ctx.fillRect(-13, -3.4, 10, 6.8);
      rrPath(ctx, -2, -5, 25, 10, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 172, 122, 0.4)';
      ctx.stroke();
      ctx.fillStyle = '#1f2d2e';
      ctx.fillRect(-1, -4.2, 22, 2);
      ctx.fillStyle = '#111b1c';
      ctx.fillRect(23, -2.4, tip - 23, 4.8);
      ctx.fillStyle = '#342923';
      ctx.beginPath();
      ctx.moveTo(tip - 4, -4.2);
      ctx.lineTo(tip + 5, 0);
      ctx.lineTo(tip - 4, 4.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffb363';
      ctx.fillRect(tip - 2, -1.2, 4, 2.4);
      ctx.fillStyle = '#0c1516';
      rrPath(ctx, 5, 4.2, 7, 8, 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(155, 203, 197, 0.3)';
      ctx.strokeRect(7, 5, 4, 5);
      ctx.fillStyle = '#233537';
      rrPath(ctx, 3, -9, 12, 3.6, 1);
      ctx.fill();
      ctx.strokeStyle = 'rgba(122, 246, 246, 0.35)';
      ctx.beginPath();
      ctx.arc(9, -7.2, 1.5, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 174, 95, 0.58)';
      ctx.fillRect(0, -1.2, 5, 1);
    }

    // Hands, on top of the grip.
    ctx.fillStyle = '#172729';
    ctx.beginPath();
    ctx.arc(3.5, 3.5, 3.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#223437';
    ctx.beginPath();
    ctx.arc(0.5, 5, 2.5, 0, TAU);
    ctx.fill();

    if (flashTimer > 0) {
      const flash = flashTimer / 0.065;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flash;
      ctx.fillStyle = rgba(w.tracer, 0.95);
      const cx = tip + 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU + game.time * 40;
        const size = i % 2 === 0 ? 11 : 3.5;
        const x = cx + Math.cos(a) * size;
        const y = Math.sin(a) * size * 0.65;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fffceb';
      ctx.beginPath();
      ctx.arc(cx, 0, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPlayerActor(ctx) {
    const p = game.player;
    if (!p) return;
    if (!p.alive) {
      drawFallenPlayer(ctx);
      return;
    }
    const blink = p.invuln > 0 && Math.floor(game.time * 34) % 2 === 0;
    const stride = p.moving ? Math.sin(p.walkPhase) * 4.4 : 0;
    const character = getCharacterDef(p.characterId);
    const bodyScale = character.bodyScale || 1;
    const characterPalettes = {
      alan: { glow: '85, 231, 240', grad: ['#1a2b2d', '#0d1c1f', '#223638'], armor: '32, 53, 54', visor: '189, 255, 255' },
      lifeline: { glow: '126, 255, 199', grad: ['#18302b', '#0b1d1a', '#27443c'], armor: '41, 74, 63', visor: '190, 255, 224' },
      newcastle: { glow: '112, 190, 255', grad: ['#182633', '#0b1620', '#263b4c'], armor: '43, 66, 85', visor: '190, 229, 255' },
      caustic: { glow: '158, 238, 102', grad: ['#2b3020', '#171c10', '#41492e'], armor: '62, 73, 42', visor: '210, 255, 151' },
      valkyrie: { glow: '255, 217, 126', grad: ['#3c3018', '#1c160b', '#5a4826'], armor: '96, 76, 35', visor: '255, 235, 176' },
    };
    const charPalette = characterPalettes[character.id] || characterPalettes.alan;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.72;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(p.x, p.y + 4, 2, p.x, p.y + 4, 40);
    glow.addColorStop(0, `rgba(${charPalette.glow}, 0.17)`);
    glow.addColorStop(0.5, `rgba(${charPalette.glow}, 0.055)`);
    glow.addColorStop(1, `rgba(${charPalette.glow}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y + 4, 40, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${charPalette.glow}, 0.22)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 5, 25, 16, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ellipse(ctx, p.x + 3, p.y + 6, 17, 10, 'rgba(0, 0, 0, 0.46)');
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aimAngle);
    ctx.scale(1.12 * bodyScale, 1.12 * bodyScale);

    // Legs.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#081013';
    ctx.lineWidth = 6.2;
    ctx.beginPath();
    ctx.moveTo(-3, -6);
    ctx.lineTo(-10 + stride, -8);
    ctx.moveTo(-3, 6);
    ctx.lineTo(-10 - stride, 8);
    ctx.stroke();
    ctx.strokeStyle = '#26383a';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-9 + stride, -8);
    ctx.lineTo(-13 + stride, -8);
    ctx.moveTo(-9 - stride, 8);
    ctx.lineTo(-13 - stride, 8);
    ctx.stroke();

    // Backpack.
    rrPath(ctx, -16, -7.5, 8, 15, 2);
    ctx.fillStyle = '#071114';
    ctx.fill();
    ctx.strokeStyle = 'rgba(98, 169, 174, 0.28)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = 'rgba(102, 236, 242, 0.72)';
    ctx.fillRect(-13.5, -4.2, 2.2, 4);
    ctx.fillStyle = 'rgba(255, 157, 95, 0.6)';
    ctx.fillRect(-13.5, 1.8, 2.2, 2);

    // Torso / shoulder silhouette.
    ctx.beginPath();
    ctx.moveTo(-11, -9);
    ctx.lineTo(3, -12.5);
    ctx.lineTo(11, -7);
    ctx.lineTo(12, 0);
    ctx.lineTo(10, 7.5);
    ctx.lineTo(3, 12.5);
    ctx.lineTo(-11, 9);
    ctx.lineTo(-14, 0);
    ctx.closePath();
    const bodyGrad = ctx.createLinearGradient(-13, -10, 11, 11);
    bodyGrad.addColorStop(0, charPalette.grad[0]);
    bodyGrad.addColorStop(0.52, charPalette.grad[1]);
    bodyGrad.addColorStop(1, charPalette.grad[2]);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(125, 227, 231, 0.23)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Chest plate.
    ctx.beginPath();
    ctx.moveTo(-7, -7.5);
    ctx.lineTo(4, -8);
    ctx.lineTo(8, -2.8);
    ctx.lineTo(4, 3.5);
    ctx.lineTo(-7, 5);
    ctx.lineTo(-10, -1);
    ctx.closePath();
    ctx.fillStyle = `rgba(${charPalette.armor}, 0.72)`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(134, 207, 208, 0.16)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(110, 238, 242, 0.8)';
    ctx.fillRect(-3.5, -3.2, 3.5, 1.2);
    ctx.fillStyle = 'rgba(100, 119, 117, 0.4)';
    ctx.fillRect(-3.5, -1, 6.5, 1.5);
    if (character.id === 'lifeline') {
      ctx.fillStyle = 'rgba(190, 255, 227, 0.9)';
      ctx.fillRect(-1.5, -7.2, 3.2, 10.2);
      ctx.fillRect(-6, -3.5, 12, 3.2);
      ctx.strokeStyle = 'rgba(144, 255, 203, 0.65)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-7, -8.2, 15, 14);
    } else if (character.id === 'newcastle') {
      ctx.fillStyle = 'rgba(118, 188, 255, 0.22)';
      rrPath(ctx, -12, -11, 24, 22, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(147, 214, 255, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(170, 226, 255, 0.8)';
      ctx.fillRect(-3.5, -8, 7, 2);
    } else if (character.id === 'caustic') {
      ctx.fillStyle = 'rgba(141, 227, 84, 0.2)';
      rrPath(ctx, -19, -10, 7, 20, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(178, 255, 109, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(198, 255, 122, 0.8)';
      ctx.beginPath();
      ctx.arc(-15.5, -4, 2, 0, TAU);
      ctx.arc(-15.5, 3, 1.6, 0, TAU);
      ctx.fill();
    } else if (character.id === 'valkyrie') {
      ctx.strokeStyle = 'rgba(255, 220, 132, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(-25, -16);
      ctx.lineTo(-29, -3);
      ctx.moveTo(-10, 10);
      ctx.lineTo(-25, 16);
      ctx.lineTo(-29, 3);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 214, 118, 0.86)';
      ctx.fillRect(-3.2, -7, 6.4, 14);
      ctx.fillStyle = 'rgba(30, 22, 10, 0.9)';
      ctx.fillRect(-3.2, -7, 6.4, 3);
      ctx.fillStyle = 'rgba(255, 234, 175, 0.9)';
      ctx.beginPath();
      ctx.arc(-15, -5, 1.8, 0, TAU);
      ctx.arc(-15, 5, 1.8, 0, TAU);
      ctx.fill();
    }

    // Shoulders.
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#122023';
      ctx.beginPath();
      ctx.arc(-1, side * 10.2, 4.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(123, 208, 211, 0.25)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Arms reaching toward the weapon.
    ctx.strokeStyle = '#111f22';
    ctx.lineWidth = 4.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -9.5);
    ctx.lineTo(8, -1.8);
    ctx.moveTo(0, 9.5);
    ctx.lineTo(10, 5);
    if (hasTalent('dualWield') && p.offhand) {
      ctx.moveTo(0, -9.5);
      ctx.lineTo(8, -6);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(112, 185, 187, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -9.5);
    ctx.lineTo(7, -2);
    ctx.stroke();

    drawPlayerGun(ctx, p, 'main');
    if (hasTalent('dualWield') && p.offhand) drawPlayerGun(ctx, p, 'offhand');

    // Head and visor.
    ctx.fillStyle = '#081214';
    ctx.beginPath();
    ctx.arc(1.5, 0, 7.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(141, 220, 222, 0.25)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#1a2e30';
    ctx.beginPath();
    ctx.arc(1.2, -0.3, 5.2, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(4.4, 0);
    ctx.rotate(0.18);
    const visorGrad = ctx.createLinearGradient(-2, 0, 3, 0);
    visorGrad.addColorStop(0, 'rgba(74, 253, 255, 0.35)');
    visorGrad.addColorStop(1, `rgba(${charPalette.visor}, 0.95)`);
    ctx.fillStyle = visorGrad;
    ctx.shadowColor = '#6ef5ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.2, 4.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Tiny antenna.
    ctx.strokeStyle = 'rgba(160, 232, 231, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-2.2, -5.5);
    ctx.lineTo(-5.5, -10.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(111, 255, 244, 0.8)';
    ctx.beginPath();
    ctx.arc(-5.5, -10.5, 1.1, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (p.reviving) {
      const progress = 1 - p.reviveTimer / Math.max(0.001, p.reviveDuration);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(p.x, p.y);
      const pulse = 0.45 + Math.sin(game.time * 9) * 0.18;
      const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 48);
      g.addColorStop(0, `rgba(132, 246, 255, ${0.12 + pulse * 0.15})`);
      g.addColorStop(1, 'rgba(132, 246, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 48, 0, TAU);
      ctx.fill();
      ctx.rotate(game.time * 1.2);
      ctx.strokeStyle = `rgba(139, 250, 255, ${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(game.time * 5) * 3, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255, 190, 124, 0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, 23, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.stroke();
      ctx.restore();
    }

    if (p.shieldUnlocked && p.shield > 0) {
      const ratio = clamp(p.shield / Math.max(1, p.maxShield), 0, 1);
      const flash = p.shieldHitFlash > 0 ? p.shieldHitFlash / 0.24 : 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = `rgba(102, 239, 255, ${0.16 + ratio * 0.22 + flash * 0.35})`;
      ctx.lineWidth = 1.1 + flash * 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(201, 255, 255, ${0.05 + flash * 0.22})`;
      ctx.lineWidth = flash > 0 ? 3 : 1;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + flash * 4, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(96, 232, 255, ${0.012 + ratio * 0.025})`;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 3; i += 1) {
        ctx.strokeStyle = `rgba(133, 245, 255, ${0.07 + ratio * 0.08})`;
        ctx.beginPath();
        ctx.arc(0, 0, 25, i * 2.1 + game.time * 0.45, i * 2.1 + game.time * 0.45 + 0.75);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (p.hitFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = p.hitFlash * 2.6;
      ctx.fillStyle = 'rgba(255, 128, 117, 0.5)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFallenPlayer(ctx) {
    const p = game.player;
    if (!p) return;
    const alpha = game.mode === 'gameover' ? 0.5 : 0.82;
    ctx.save();
    ctx.globalAlpha = alpha;
    ellipse(ctx, p.x + 3, p.y + 6, 22, 12, 'rgba(0,0,0,0.52)');
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aimAngle + 0.55);
    ctx.strokeStyle = '#071013';
    ctx.lineWidth = 5.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, -5);
    ctx.lineTo(-15, -9);
    ctx.moveTo(-2, 5);
    ctx.lineTo(-11, 12);
    ctx.stroke();
    ctx.fillStyle = '#0b171a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 9.5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(92, 165, 168, 0.2)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#071112';
    ctx.beginPath();
    ctx.arc(7, 1, 6.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 240, 245, 0.25)';
    ctx.beginPath();
    ctx.moveTo(4.5, 2.5);
    ctx.lineTo(10, 3.2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(-10, -4, 14, 1);
    ctx.restore();
  }

  function drawEnemyWeapon(ctx, type, flash) {
    const palette = type === 'boss'
      ? { body: '#242b25', barrel: '#171e1a', trim: 'rgba(222, 183, 112, 0.65)' }
      : type === 'elite'
        ? { body: '#231d2a', barrel: '#17131d', trim: 'rgba(213, 155, 255, 0.65)' }
        : { body: '#241c19', barrel: '#171312', trim: 'rgba(255, 149, 100, 0.5)' };
    const len = type === 'boss' ? 36 : type === 'elite' ? 30 : 25;
    ctx.save();
    ctx.translate(7, 3);
    ctx.fillStyle = palette.body;
    ctx.strokeStyle = palette.trim;
    ctx.lineWidth = 0.8;
    rrPath(ctx, 0, -2.9, len - 14, 5.7, 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.barrel;
    ctx.fillRect(len - 14, -1.6, 14, 3.2);
    if (type === 'boss') {
      ctx.fillRect(len - 10, -3.2, 10, 1.2);
      ctx.fillStyle = 'rgba(255, 154, 92, 0.45)';
      ctx.fillRect(3, -1.3, 7, 1);
      ctx.fillStyle = '#101512';
     ctx.fillRect(6, 3, 8, 8);
      ctx.fillRect(17, 3, 4, 6);
    } else if (type === 'elite') {
      ctx.fillStyle = palette.barrel;
      ctx.fillRect(11, -6, 10, 2.6);
      ctx.fillStyle = 'rgba(214, 146, 255, 0.55)';
      ctx.fillRect(2, -1.2, 5, 1);
      ctx.fillRect(12, 3.1, 4.5, 9);
    } else {
      ctx.fillStyle = 'rgba(255, 139, 87, 0.46)';
      ctx.fillRect(2, -1.2, 4, 1);
    }
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(flash / 0.1, 0, 1);
      const color = type === 'boss' ? '255, 112, 88' : type === 'elite' ? '221, 151, 255' : '255, 147, 96';
      ctx.fillStyle = rgba(color, 0.9);
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU;
        const r = i % 2 === 0 ? 10 : 3;
        const x = len + Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawEnemyAura(ctx, e) {
    if (e.type === 'normal') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, 27);
      halo.addColorStop(0, 'rgba(255, 126, 83, 0.075)');
      halo.addColorStop(1, 'rgba(255, 126, 83, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 27, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const color = e.type === 'boss' ? '255, 91, 79' : '213, 146, 255';
    const baseRadius = e.type === 'boss' ? 72 : 40;
    const glow = ctx.createRadialGradient(e.x, e.y, e.radius * 0.5, e.x, e.y, baseRadius * 1.5);
    glow.addColorStop(0, rgba(color, e.type === 'boss' ? 0.13 : 0.055));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(e.x, e.y, baseRadius * 1.5, 0, TAU);
    ctx.fill();
    if (e.type === 'boss') {
      ctx.translate(e.x, e.y);
      ctx.rotate(game.time * 0.6);
      ctx.strokeStyle = `rgba(${color}, ${e.phase2 ? 0.3 : 0.15})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 14]);
      ctx.beginPath();
      ctx.arc(0, 0, 57, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-game.time * 1.4);
      ctx.strokeStyle = `rgba(255, 185, 116, ${e.phase2 ? 0.35 : 0.17})`;
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0.35, 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 46, Math.PI + 0.35, Math.PI + 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpecialEnemyBody(ctx, e) {
    const type = e.type;
    const t = game.time;
    const pulse = 0.7 + Math.sin(t * 5 + (e.pulse || 0)) * 0.2;
    ctx.save();
    ctx.translate(e.x, e.y);
    ellipse(ctx, 3, 6, e.radius * 1.05, e.radius * 0.65, 'rgba(0,0,0,0.42)');
    if (type === 'spider') {
      ctx.strokeStyle = '#1a2d1d';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i += 1) {
        const a = e.aimAngle + (i / 8) * TAU + Math.sin(t * 7 + i) * 0.13;
        const leg = e.radius * (1.05 + (i % 2) * 0.35);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * leg, Math.sin(a) * leg);
        ctx.lineTo(Math.cos(a + 0.35) * leg * 1.3, Math.sin(a + 0.35) * leg * 1.3);
        ctx.stroke();
      }
      ctx.rotate(e.aimAngle);
      ctx.fillStyle = '#283c24';
      ctx.strokeStyle = 'rgba(196, 255, 128, 0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, e.radius * 1.05, e.radius * 0.88, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8bbb58';
      ctx.beginPath();
      ctx.ellipse(-5, 0, e.radius * 0.65, e.radius * 0.48, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b1ff68';
      ctx.beginPath();
      ctx.arc(5, -4, 1.5, 0, TAU);
      ctx.arc(5, 4, 1.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(151, 255, 95, ${0.3 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(8, 0, 3.2, 0, TAU);
      ctx.stroke();
    } else if (type === 'zombie') {
      ctx.rotate(e.aimAngle);
      const stride = Math.sin(t * 8 + e.x * 0.04) * 3;
      ctx.strokeStyle = '#1d2617';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-3, -5);
      ctx.lineTo(-12 + stride, -8);
      ctx.moveTo(-3, 5);
      ctx.lineTo(-12 - stride, 8);
      ctx.stroke();
      ctx.fillStyle = '#455b36';
      ctx.beginPath();
      ctx.ellipse(0, 0, e.radius * 0.9, e.radius * 0.68, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 255, 156, 0.31)';
      ctx.stroke();
      const reach = e.attackAnim > 0 ? 7 : 3;
      ctx.strokeStyle = '#7f9d5f';
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(13 + reach, -10);
      ctx.moveTo(0, 7);
      ctx.lineTo(13 + reach, 10);
      ctx.stroke();
      ctx.fillStyle = '#9ab57a';
      ctx.beginPath();
      ctx.arc(8, 0, e.radius * 0.52, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8ff84';
      ctx.beginPath();
      ctx.arc(12, -3, 1.3, 0, TAU);
      ctx.arc(12, 3, 1.3, 0, TAU);
      ctx.fill();
    } else if (type === 'mutant') {
      ctx.rotate(e.aimAngle);
      ctx.fillStyle = '#374b2d';
      ctx.beginPath();
      ctx.ellipse(0, 0, e.radius * 1.04, e.radius * 0.9, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(196, 255, 113, ${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      for (let i = 0; i < 5; i += 1) {
        const a = i / 5 * TAU + t * 0.4;
        const rr = e.radius * (0.35 + (i % 2) * 0.2);
        ctx.fillStyle = `rgba(158, 255, 105, ${0.38 + pulse * 0.2})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 2.2 + (i % 2) * 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#8bbd63';
      ctx.beginPath();
      ctx.arc(7, 0, e.radius * 0.42, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(180, 255, 111, ${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius + 4 + pulse * 2, 0, TAU);
      ctx.stroke();
    } else if (type === 'combatRobot') {
      ctx.rotate(e.aimAngle);
      ctx.fillStyle = '#2d3d43';
      ctx.fillRect(-e.radius * 0.9, -e.radius * 0.65, e.radius * 1.7, e.radius * 1.3);
      ctx.strokeStyle = 'rgba(164, 245, 255, 0.45)';
      ctx.strokeRect(-e.radius * 0.9, -e.radius * 0.65, e.radius * 1.7, e.radius * 1.3);
      ctx.fillStyle = '#10191d';
      ctx.fillRect(-e.radius * 0.65, -e.radius * 0.9, e.radius * 0.65, e.radius * 1.8);
      ctx.fillStyle = '#6f9a9f';
      ctx.fillRect(e.radius * 0.25, -e.radius * 0.35, e.radius * 0.85, e.radius * 0.7);
      ctx.strokeStyle = `rgba(143, 238, 255, ${0.3 + pulse * 0.4})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius * 0.4 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#b4fbff';
      ctx.beginPath();
      ctx.arc(-e.radius * 0.35, 0, 2.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 235, 255, 0.55)';
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(e.radius * 0.5, i * 6);
        ctx.lineTo(e.radius * 1.15, i * 7);
        ctx.stroke();
      }
    } else if (type === 'repairRobot') {
      ctx.rotate(e.aimAngle);
      ctx.fillStyle = '#273b35';
      ctx.beginPath();
      ctx.arc(0, 0, e.radius * 0.92, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(145, 255, 199, 0.48)';
      ctx.stroke();
      ctx.strokeStyle = '#182824';
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, side * e.radius * 0.7);
        ctx.lineTo(-e.radius * 1.2, side * e.radius * 0.95);
        ctx.stroke();
      }
      ctx.fillStyle = '#8dffc9';
      ctx.fillRect(-2.5, -7, 5, 14);
      ctx.fillRect(-7, -2.5, 14, 5);
      ctx.strokeStyle = 'rgba(163, 255, 214, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius + 2 + pulse * 1.5, 0, TAU);
      ctx.stroke();
    } else if (type === 'gunnerRobot') {
      ctx.rotate(e.aimAngle);
      ctx.fillStyle = '#1b272b';
      ctx.fillRect(-e.radius * 1.05, -e.radius * 0.95, e.radius * 2.1, e.radius * 0.45);
      ctx.fillRect(-e.radius * 1.05, e.radius * 0.5, e.radius * 2.1, e.radius * 0.45);
      ctx.fillStyle = '#34484d';
      ctx.beginPath();
      ctx.ellipse(0, 0, e.radius * 0.95, e.radius * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = e.gunnerEnraged ? 'rgba(255, 123, 83, 0.75)' : 'rgba(255, 207, 132, 0.45)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = '#0c1417';
      ctx.fillRect(e.radius * 0.45, -e.radius * 0.62, e.radius * 1.0, e.radius * 0.4);
      ctx.fillRect(e.radius * 0.45, e.radius * 0.22, e.radius * 1.0, e.radius * 0.4);
      ctx.fillRect(e.radius * 0.8, -5, e.radius * 0.7, 10);
      ctx.fillStyle = e.gunnerEnraged ? '#ff8c63' : '#ffd194';
      ctx.beginPath();
      ctx.arc(-e.radius * 0.25, 0, 3.1 + pulse * 1.4, 0, TAU);
      ctx.fill();
      if (e.gunnerEnraged) {
        ctx.strokeStyle = 'rgba(255, 116, 79, 0.5)';
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, e.radius + 6 + pulse * 2, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (e.hitFlash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(e.hitFlash * 5, 0, 0.28);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, e.radius * 1.15, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemyStatusFx(ctx, e) {
    if (e.attackBuff) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const y = e.y - e.radius - 30;
      ctx.fillStyle = 'rgba(255, 209, 103, 0.9)';
      ctx.font = '700 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FIRE+', e.x, y);
      ctx.strokeStyle = 'rgba(255, 209, 103, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 7, -2.5, -1.2);
      ctx.stroke();
      ctx.restore();
    }
    if (e.type === 'elite' && game.eliteAura) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 203, 112, ${0.18 + Math.sin(game.time * 4) * 0.07})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 11, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (e.healBeam && e.healBeam.target && !e.healBeam.target.dead && e.healBeam.time > 0) {
      const target = e.healBeam.target;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(143, 255, 200, ${0.36 + Math.sin(game.time * 12) * 0.15})`;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (e.type === 'combatRobot' && e.zapTimer > 0) {
      const tx = e.zapTargetX ?? game.player.x;
      const ty = e.zapTargetY ?? game.player.y;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(173, 242, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const segs = 7;
      for (let i = 0; i <= segs; i += 1) {
        const tt = i / segs;
        const x = lerp(e.x, tx, tt) + (i > 0 && i < segs ? rand(-7, 7) : 0);
        const y = lerp(e.y, ty, tt) + (i > 0 && i < segs ? rand(-7, 7) : 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (e.poisoned > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(157, 255, 95, ${0.2 + Math.sin(game.time * 8) * 0.1})`;
      ctx.beginPath();
      ctx.arc(e.x + Math.sin(game.time * 5) * 5, e.y - e.radius - 10, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTrainingDummy(ctx, e) {
    const t = game.time;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(0,0,0,.42)';
    ctx.beginPath();
    ctx.ellipse(4, 32, 47, 14, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 219, 153, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 54 + Math.sin(t * 2) * 2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = e.hitFlash > 0 ? '#f5d99e' : '#7d5a34';
    ctx.strokeStyle = '#d6ab68';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-30, -38, 60, 76, 16);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 225, 164, 0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-22, 0); ctx.lineTo(22, 0);
    ctx.moveTo(-22, 18); ctx.lineTo(22, 18);
    ctx.stroke();
    ctx.fillStyle = '#4d351f';
    ctx.fillRect(-34, -6, 7, 42);
    ctx.fillStyle = '#d9ad69';
    ctx.fillRect(-31, -3, 26, 34);
    ctx.fillStyle = '#4b3220';
    ctx.font = '700 10px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('∞', 7, 20);
    ctx.fillStyle = 'rgba(255, 223, 158, 0.82)';
    ctx.font = '700 9px "SFMono-Regular", monospace';
    ctx.fillText('TRAINING SANDBAG', 0, -55);
    ctx.strokeStyle = 'rgba(255, 206, 126, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-18, -42); ctx.lineTo(18, -42);
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemyActor(ctx, e) {
    if (e.trainingDummy) {
      drawTrainingDummy(ctx, e);
      return;
    }
    if (e.dead) {
      drawEnemyCorpse(ctx, e);
      return;
    }
    const spawnProgress = e.spawnTimer > 0 ? clamp(1 - e.spawnTimer / e.spawnMax, 0, 1) : 1;
    if (e.spawnTimer > 0) {
      drawSpawnShield(ctx, e, spawnProgress);
    }
    if (['zombie', 'mutant', 'spider', 'combatRobot', 'repairRobot', 'gunnerRobot'].includes(e.type)) {
      drawSpecialEnemyBody(ctx, e);
      drawEnemyHealthBar(ctx, e);
      drawStunEffect(ctx, e);
      drawEnemyStatusFx(ctx, e);
      return;
    }
    drawEnemyAura(ctx, e);
    ellipse(ctx, e.x + 4, e.y + 7, e.radius * 1.1, e.radius * 0.7, 'rgba(0,0,0,0.5)');

    const scale = e.type === 'boss' ? 1.92 : e.type === 'elite' ? 1.34 : 1.12;
    let bodyColor = e.type === 'boss'
      ? { main: '#3d4633', light: '#69745a', dark: '#20271d', trim: 'rgba(230, 187, 113, 0.55)', visor: '255, 164, 92' }
      : e.type === 'elite'
        ? { main: '#33283d', light: '#65517a', dark: '#17121f', trim: 'rgba(212, 153, 255, 0.55)', visor: '234, 178, 255' }
        : { main: '#3f2b24', light: '#71493a', dark: '#1d1614', trim: 'rgba(255, 146, 100, 0.45)', visor: '255, 168, 111' };
    if (e.faction) {
      if (e.type === 'boss' && e.bossKind) {
        const bossPalette = e.bossKind === 'director'
          ? { main: '#314b45', light: '#6e9a82', dark: '#10241e', trim: 'rgba(148, 255, 188, 0.55)', visor: '139, 255, 178' }
          : e.bossKind === 'robot'
            ? { main: '#3c464b', light: '#7d8b90', dark: '#121a1e', trim: 'rgba(255, 128, 104, 0.55)', visor: '255, 104, 88' }
            : bodyColor;
        bodyColor = bossPalette;
      } else {
        const colors = CAMPAIGN_FACTIONS[e.faction]?.colors;
        if (colors) bodyColor = { ...colors };
      }
    }
    const flash = e.hitFlash > 0;
    const stride = Math.hypot(e.vx, e.vy) > 2 ? Math.sin(game.time * 9 + e.x * 0.03) * 4 : 0;

    ctx.save();
    ctx.globalAlpha = 0.28 + spawnProgress * 0.72;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.aimAngle);
    ctx.scale(scale, scale);

    // Legs.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0e1312';
    ctx.lineWidth = 6.4;
    ctx.beginPath();
    ctx.moveTo(-3, -6.5);
    ctx.lineTo(-12 + stride, -9);
    ctx.moveTo(-3, 6.5);
    ctx.lineTo(-12 - stride, 9);
    ctx.stroke();
    ctx.strokeStyle = bodyColor.dark;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-10 + stride, -9);
    ctx.lineTo(-14 + stride, -9.5);
    ctx.moveTo(-10 - stride, 9);
    ctx.lineTo(-14 - stride, 9.5);
    ctx.stroke();

    // Back silhouette.
    ctx.beginPath();
    ctx.moveTo(-12, -9);
    ctx.lineTo(1, -12);
    ctx.lineTo(10, -8);
    ctx.lineTo(13, 0);
    ctx.lineTo(10, 8);
    ctx.lineTo(1, 12);
    ctx.lineTo(-12, 9);
    ctx.lineTo(-15, 0);
    ctx.closePath();
    ctx.fillStyle = bodyColor.dark;
    ctx.fill();
    ctx.strokeStyle = bodyColor.trim;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Torso armor.
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(5, -9.5);
    ctx.lineTo(11, -4);
    ctx.lineTo(10, 5);
    ctx.lineTo(3, 9.5);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-11, -1);
    ctx.closePath();
    ctx.fillStyle = bodyColor.main;
    ctx.fill();
    ctx.strokeStyle = bodyColor.trim;
    ctx.stroke();

    // Shoulder guards.
    for (const side of [-1, 1]) {
      ctx.fillStyle = bodyColor.light;
      ctx.beginPath();
      ctx.ellipse(-1, side * 10.5, side < 0 ? 4.5 : 5.3, side < 0 ? 4.2 : 5, side < 0 ? -0.2 : 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = bodyColor.trim;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    if (game.runMode === 'campaign') {
      if (e.faction === 'lab') {
        ctx.fillStyle = 'rgba(123, 255, 170, 0.44)';
        ctx.fillRect(-4, -3, 4, 6);
        ctx.fillStyle = 'rgba(214, 255, 225, 0.2)';
        ctx.fillRect(-5, -8, 2, 2);
      } else if (e.faction === 'robot') {
        ctx.fillStyle = 'rgba(255, 90, 76, 0.7)';
        ctx.beginPath();
        ctx.arc(-1, 0, 2.1, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(180, 185, 188, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-6, -3);
        ctx.lineTo(-2, -3);
        ctx.moveTo(-6, 3);
        ctx.lineTo(-2, 3);
        ctx.stroke();
      } else if (e.faction === 'military') {
        ctx.fillStyle = 'rgba(255, 198, 101, 0.45)';
        ctx.fillRect(-5, -7, 6, 1.4);
        ctx.fillRect(-5, 5.6, 6, 1.4);
      }
    }
    if (e.type === 'boss') {
      ctx.fillStyle = 'rgba(255, 181, 100, 0.7)';
      ctx.fillRect(-2, -9, 3, 1.3);
      ctx.fillRect(-2, 7.7, 3, 1.3);
      ctx.strokeStyle = 'rgba(228, 190, 119, 0.35)';
      ctx.beginPath();
      ctx.moveTo(-6, -7);
      ctx.lineTo(4, -6);
      ctx.moveTo(-6, 7);
      ctx.lineTo(4, 6);
      ctx.stroke();
    } else if (e.type === 'elite') {
      ctx.fillStyle = 'rgba(214, 146, 255, 0.48)';
      ctx.fillRect(-4, -6.2, 5, 1);
      ctx.fillRect(-4, 5.2, 5, 1);
    }

    // Arms.
    ctx.strokeStyle = bodyColor.dark;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -9.5);
    ctx.lineTo(8, -2.4);
    ctx.moveTo(0, 9.5);
    ctx.lineTo(9, 4.6);
    ctx.stroke();
    ctx.strokeStyle = bodyColor.trim;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -9.5);
    ctx.lineTo(7, -2.8);
    ctx.stroke();

    drawEnemyWeapon(ctx, e.type, e.muzzleFlash);

    // Helmet.
    ctx.fillStyle = bodyColor.dark;
    ctx.beginPath();
    ctx.arc(1, 0, e.type === 'boss' ? 8.2 : 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = bodyColor.trim;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = bodyColor.main;
    ctx.beginPath();
    ctx.arc(0.8, 0, 5.4, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(4.8, 0.3);
    const visorGrad = ctx.createLinearGradient(0, -2, 3, 2);
    visorGrad.addColorStop(0, rgba(bodyColor.visor, 0.5));
    visorGrad.addColorStop(1, rgba(bodyColor.visor, 1));
    ctx.fillStyle = visorGrad;
    ctx.shadowColor = rgba(bodyColor.visor, 0.8);
    ctx.shadowBlur = e.type === 'boss' ? 13 : 7;
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.1, 4.1, 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (e.type === 'elite' || e.type === 'boss') {
      ctx.strokeStyle = rgba(bodyColor.visor, 0.35);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, 10.5, -0.6, 0.65);
      ctx.stroke();
    }

    if (e.type === 'boss') {
      ctx.save();
      ctx.rotate(-e.aimAngle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 113, 89, ${e.phase2 ? 0.33 : 0.17})`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 26, -0.8, 0.8);
      ctx.stroke();
      ctx.restore();
    }

    if (e.bomber) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + Math.sin((e.pulse || 0) * 1.5) * 0.25;
      ctx.strokeStyle = `rgba(151, 255, 105, ${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 17 + pulse * 2, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(143, 255, 106, ${0.2 + pulse * 0.2})`;
      ctx.beginPath();
      ctx.arc(0, 0, 5 + pulse * 1.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    if (flash) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(e.hitFlash * 5.5, 0, 0.22);
      ctx.fillStyle = e.type === 'elite' ? '#f1dcff' : e.type === 'boss' ? '#ffddba' : '#ffe4d0';
      ctx.beginPath();
      ctx.arc(0, 0, e.type === 'boss' ? 22 : 14, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (e.spawnTimer <= 0) {
      drawEnemyHealthBar(ctx, e);
      drawStunEffect(ctx, e);
      if (e.alertFlash > 0) {
        ctx.save();
        ctx.translate(e.x, e.y - e.radius - (e.type === 'boss' ? 37 : 25));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 137, 100, ${0.55 + Math.sin(game.time * 17) * 0.25})`;
        ctx.font = '800 16px "SFMono-Regular", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, 0);
        ctx.restore();
      }
      drawEnemyStatusFx(ctx, e);
    }
  }

  function drawStunEffect(ctx, e) {
    if (!e.stunTimer || e.stunTimer <= 0) return;
    const strength = clamp(e.stunTimer / 1.5, 0.25, 1);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.4 + Math.sin(game.time * 12) * 0.2;
    ctx.strokeStyle = `rgba(188, 248, 255, ${0.18 + pulse * 0.2})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius + 9, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      const angle = game.time * 2.4 + i * (TAU / 4);
      const orbit = e.radius + 9;
      const x = Math.cos(angle) * orbit;
      const y = Math.sin(angle) * orbit * 0.55 - e.radius - 8;
      ctx.fillStyle = `rgba(213, 254, 255, ${0.55 + strength * 0.3})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -2.4);
      ctx.lineTo(0.9, 0);
      ctx.lineTo(0, 2.4);
      ctx.lineTo(-0.9, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = `rgba(194, 250, 255, ${0.5 + pulse * 0.3})`;
    ctx.font = '600 9px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STUN', 0, -e.radius - 25);
    ctx.restore();
  }

  function drawSpawnShield(ctx, e, progress) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'lighter';
    const color = e.type === 'boss' ? '255, 100, 82' : e.type === 'elite' ? '214, 153, 255' : '255, 137, 93';
    const pulse = 0.45 + Math.sin(game.time * 16) * 0.12;
    ctx.strokeStyle = rgba(color, 0.25 + progress * 0.4);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 7]);
    ctx.lineDashOffset = -game.time * 42;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius * (2.1 - progress * 0.9), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const beam = ctx.createLinearGradient(0, -90, 0, 24);
    beam.addColorStop(0, rgba(color, 0));
    beam.addColorStop(0.7, rgba(color, 0.06 + progress * 0.1));
    beam.addColorStop(1, rgba(color, 0.2 + progress * 0.15));
    ctx.fillStyle = beam;
    ctx.fillRect(-e.radius * 0.8, -90, e.radius * 1.6, 114);
    ctx.globalAlpha = 0.18 + progress * 0.2;
    ctx.fillStyle = rgba(color, pulse);
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius * 1.15, e.radius * 0.65, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemyHealthBar(ctx, e) {
    const w = e.type === 'boss' ? 82 : e.type === 'elite' ? 46 : 24;
    const h = e.type === 'boss' ? 4 : 3;
    const x = e.x - w / 2;
    const y = e.y - e.radius - (e.type === 'boss' ? 25 : 17);
    ctx.save();
    ctx.globalAlpha = e.hp >= e.maxHp && e.type === 'normal' ? 0.5 : 1;
    ctx.fillStyle = 'rgba(2, 7, 9, 0.76)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = e.type === 'boss' ? 'rgba(255, 89, 78, 0.24)' : e.type === 'elite' ? 'rgba(217, 148, 255, 0.2)' : 'rgba(255, 128, 90, 0.18)';
    ctx.fillRect(x, y, w, h);
    const ratio = clamp(e.hp / e.maxHp, 0, 1);
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    if (e.type === 'boss') {
      grad.addColorStop(0, '#ff534a');
      grad.addColorStop(1, '#ffb36e');
    } else if (e.type === 'elite') {
      grad.addColorStop(0, '#aa65db');
      grad.addColorStop(1, '#e4b4ff');
    } else {
      grad.addColorStop(0, '#ce5847');
      grad.addColorStop(1, '#ff9e6b');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w * ratio, h);
    if (e.type === 'boss') {
      const bossDef = CAMPAIGN_BOSS_DEFS[e.bossKind || ENEMY_SYSTEMS[game.endlessBiome]?.bossKind] || null;
      ctx.fillStyle = 'rgba(255, 200, 155, 0.8)';
      ctx.font = '600 9px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bossDef ? bossDef.code : 'SECTOR GUARDIAN', e.x, y - 5);
    }
    ctx.restore();
  }

  function drawEnemyCorpse(ctx, e) {
    const maxAge = e.type === 'boss' ? 2.2 : 1.1;
    const alpha = clamp(1 - e.deathAge / maxAge, 0, 1);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha * 0.68;
    ctx.translate(e.x, e.y);
    ctx.rotate(e.aimAngle + 1.2);
    const scale = e.type === 'boss' ? 1.7 : e.type === 'elite' ? 1.15 : 1;
    ctx.scale(scale, scale);
    ctx.fillStyle = e.type === 'boss' ? '#20261b' : e.type === 'elite' ? '#17121d' : '#171311';
    ctx.beginPath();
    ctx.ellipse(0, 0, e.radius, e.radius * 0.58, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(132, 172, 166, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(8, 12, 12, 0.8)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5, -2);
    ctx.lineTo(-16, -7);
    ctx.moveTo(-4, 3);
    ctx.lineTo(-14, 11);
    ctx.stroke();
    if (e.type === 'boss') {
      ctx.fillStyle = 'rgba(203, 162, 94, 0.25)';
      ctx.fillRect(-11, -13, 14, 4);
      ctx.fillRect(3, 9, 10, 3);
    }
    ctx.restore();
  }

  function drawTurret(ctx, turret) {
    const t = game.time;
    const turretColor = turret.color || '145, 255, 218';
    const linkCount = Math.max(1, turret.linkCount || 1);
    if (turret.linkPrimary && !turret.linkPrimary.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(132, 231, 255, 0.3)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -game.time * 20;
      ctx.beginPath();
      ctx.moveTo(turret.x, turret.y);
      ctx.lineTo(turret.linkPrimary.x, turret.linkPrimary.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (turret.linkPartners) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(170, 243, 255, 0.24)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 7]);
      ctx.lineDashOffset = -game.time * 14;
      for (const partner of turret.linkPartners) {
        if (partner.dead || partner.hp <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(turret.x, turret.y);
        ctx.lineTo(partner.x, partner.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (turret.laserTimer > 0) {
      const target = turret.laserTarget && !turret.laserTarget.dead ? turret.laserTarget : null;
      const angle = turret.laserAngle || 0;
      const tx = target ? target.x : turret.x + Math.cos(angle) * 560;
      const ty = target ? target.y : turret.y + Math.sin(angle) * 560;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${turretColor}, ${0.35 + turret.laserTimer * 4})`;
      ctx.lineWidth = linkCount > 1 ? 13 : 8;
      ctx.beginPath();
      ctx.moveTo(turret.x, turret.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = linkCount > 1 ? 'rgba(190, 250, 255, 1)' : 'rgba(238, 255, 255, 0.95)';
      ctx.lineWidth = linkCount > 1 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(turret.x, turret.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ellipse(ctx, turret.x + 3, turret.y + 5, 19, 12, 'rgba(0,0,0,0.45)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(turret.x, turret.y, 2, turret.x, turret.y, 36);
    halo.addColorStop(0, `rgba(${turretColor}, 0.1)`);
    halo.addColorStop(1, `rgba(${turretColor}, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(turret.x, turret.y, 36, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.translate(turret.x, turret.y);
    ctx.rotate(t.aimAngle);
    // Tripod legs.
    ctx.strokeStyle = '#132528';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.lineTo(-15, -17);
    ctx.moveTo(-6, 12);
    ctx.lineTo(-15, 17);
    ctx.moveTo(-9, 0);
    ctx.lineTo(-18, 0);
    ctx.stroke();
    // Rotating head.
    rrPath(ctx, -10, -9, 20, 18, 3);
    ctx.fillStyle = '#102326';
    ctx.fill();
    ctx.strokeStyle = `rgba(${turretColor}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#1a3537';
    ctx.lineWidth = turret.tier === 'gatling' ? 3 : 4;
    if (turret.tier === 'rocket') {
      rrPath(ctx, 8, -7, 12, 14, 2);
      ctx.fillStyle = '#2b2920';
      ctx.fill();
      ctx.strokeStyle = `rgba(${turretColor}, 0.7)`;
      ctx.stroke();
      ctx.fillStyle = turretColor;
      ctx.fillRect(14, -4, 3, 2);
      ctx.fillRect(14, 2, 3, 2);
    } else if (turret.tier === 'laser') {
      ctx.strokeStyle = `rgba(${turretColor}, 0.65)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(7, -3);
      ctx.lineTo(21, 0);
      ctx.lineTo(7, 3);
      ctx.stroke();
      ctx.fillStyle = turretColor;
      ctx.beginPath();
      ctx.arc(20, 0, 2.2, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(20, 0);
      if (turret.tier === 'burst') {
        ctx.moveTo(8, -4);
        ctx.lineTo(19, -4);
        ctx.moveTo(8, 4);
        ctx.lineTo(19, 4);
      } else if (turret.tier === 'gatling') {
        ctx.moveTo(8, -3);
        ctx.lineTo(21, -3);
        ctx.moveTo(8, 3);
        ctx.lineTo(21, 3);
      }
      ctx.stroke();
    }
    ctx.fillStyle = turretColor;
    ctx.beginPath();
    ctx.arc(2, 0, 3.3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${turretColor}, 0.5)`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.stroke();
    if (turret.muzzleFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${turretColor}, 0.9)`;
      ctx.beginPath();
      ctx.arc(21, 0, 6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // Lifetime arc.
    ctx.rotate(-t.aimAngle);
    ctx.strokeStyle = `rgba(${turretColor}, 0.28)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(turret.life / turret.maxLife, 0, 1));
    ctx.stroke();
    ctx.restore();
    // Player turret health bar, drawn in world space above the tripod.
    const hpRatio = clamp(turret.hp / Math.max(1, turret.maxHp), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(2, 8, 10, 0.82)';
    ctx.fillRect(turret.x - 22, turret.y - 33, 44, 5);
    ctx.fillStyle = 'rgba(128, 203, 198, 0.22)';
    ctx.fillRect(turret.x - 21, turret.y - 32, 42, 3);
    ctx.fillStyle = hpRatio > 0.35 ? `rgba(${turretColor}, 0.9)` : 'rgba(255, 121, 92, 0.95)';
    ctx.fillRect(turret.x - 21, turret.y - 32, 42 * hpRatio, 3);
    ctx.fillStyle = 'rgba(200, 255, 244, 0.8)';
    ctx.font = '600 9px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`HP ${Math.ceil(turret.hp)}`, turret.x, turret.y - 38);
    ctx.fillStyle = `rgba(${turretColor}, 0.72)`;
    ctx.font = '600 7px "SFMono-Regular", monospace';
    ctx.fillText(turret.tierName || '单点', turret.x, turret.y - 47);
    if (linkCount > 1) {
      ctx.fillStyle = 'rgba(178, 247, 255, 0.92)';
      ctx.fillText(`LINK ×${Math.min(3, linkCount)}`, turret.x, turret.y - 56);
    }
    ctx.restore();
  }

  function drawFireZones(ctx, camX, camY) {
    for (const zone of game.fireZones) {
      if (!inView(zone.x, zone.y, zone.radius + 50, camX, camY)) continue;
      const lifeRatio = clamp(zone.life / Math.max(0.001, zone.maxLife), 0, 1);
      const fade = clamp(zone.life / 0.7, 0, 1);
      ctx.save();
      ctx.translate(zone.x, zone.y);
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, zone.radius * 1.15);
      glow.addColorStop(0, `rgba(255, 198, 84, ${0.34 * fade})`);
      glow.addColorStop(0.36, `rgba(255, 126, 42, ${0.2 * fade})`);
      glow.addColorStop(0.7, `rgba(255, 82, 31, ${0.07 * fade})`);
      glow.addColorStop(1, 'rgba(255, 76, 34, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, zone.radius * 1.15, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 156, 69, ${0.42 * fade})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, zone.radius, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 118, 43, ${0.08 * fade})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, zone.radius * 0.92, zone.radius * 0.68, 0, 0, TAU);
      ctx.fill();
      ctx.setLineDash([3, 9]);
      ctx.lineDashOffset = -game.time * 24;
      ctx.strokeStyle = `rgba(255, 202, 111, ${0.12 * fade})`;
      ctx.beginPath();
      ctx.arc(0, 0, zone.radius * (0.82 + Math.sin(game.time * 2) * 0.02), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      // Overlapping soft fire puffs read much better from a top-down view than
      // tall rigid triangles, especially on top of a dark laboratory floor.
      for (let i = 0; i < 26; i += 1) {
        const seed = i * 1.73;
        const angle = i * 2.399 + Math.sin(game.time * 0.55 + i * 1.4) * 0.28;
        const rr = zone.radius * (0.16 + ((i * 37) % 97) / 97 * 0.68);
        const x = Math.cos(angle) * rr;
        const y = Math.sin(angle) * rr * 0.66;
        const flick = 0.72 + Math.sin(game.time * 7.5 + i * 1.7) * 0.24;
        const size = (8 + (i % 5) * 3.6 + flick * 3.2) * (zone.radius / 112);
        const fire = ctx.createRadialGradient(x, y, 0, x, y, size);
        fire.addColorStop(0, `rgba(255, 231, 139, ${0.22 * fade * flick})`);
        fire.addColorStop(0.34, `rgba(255, 165, 57, ${0.2 * fade * flick})`);
        fire.addColorStop(0.72, `rgba(255, 88, 28, ${0.09 * fade * flick})`);
        fire.addColorStop(1, 'rgba(255, 68, 22, 0)');
        ctx.fillStyle = fire;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
      for (let i = 0; i < 9; i += 1) {
        const seed = i * 2.37 + game.time * (0.5 + (i % 3) * 0.12);
        const angle = (i / 9) * TAU + Math.sin(seed * 1.3) * 0.55;
        const radius = zone.radius * (0.2 + (i % 5) * 0.13);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.62;
        const flick = 0.8 + Math.sin(seed * 7) * 0.26;
        const height = (10 + (i % 4) * 3.6) * flick * fade;
        const width = 5 + (i % 3) * 2.2;
        const flame = ctx.createLinearGradient(x, y, x, y - height);
        flame.addColorStop(0, `rgba(255, 77, 25, ${0.46 * fade})`);
        flame.addColorStop(0.5, `rgba(255, 155, 42, ${0.52 * fade})`);
        flame.addColorStop(0.8, `rgba(255, 224, 108, ${0.34 * fade})`);
        flame.addColorStop(1, 'rgba(255, 246, 185, 0)');
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(x - width, y);
        ctx.bezierCurveTo(x - width * 0.9, y - height * 0.45, x - width * 0.25, y - height * 0.84, x, y - height);
        ctx.bezierCurveTo(x + width * 0.25, y - height * 0.84, x + width * 0.9, y - height * 0.45, x + width, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = lifeRatio * 0.2;
      ctx.fillStyle = 'rgba(255, 171, 72, 0.24)';
      ctx.beginPath();
      ctx.arc(0, 0, zone.radius * (0.6 + Math.sin(game.time * 9) * 0.02), 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCampaignHazards(ctx, camX, camY) {
    for (const hazard of game.campaignHazards) {
      if (hazard.dead) continue;
      if (hazard.type === 'poison') {
        if (!inView(hazard.x, hazard.y, hazard.radius + 20, camX, camY)) continue;
        const fade = clamp(hazard.life / Math.max(0.001, hazard.maxLife), 0, 1);
        ctx.save();
        ctx.translate(hazard.x, hazard.y);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, hazard.radius);
        g.addColorStop(0, `rgba(134, 255, 111, ${0.18 * fade})`);
        g.addColorStop(0.5, `rgba(86, 190, 73, ${0.11 * fade})`);
        g.addColorStop(1, 'rgba(59, 146, 57, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(34, 80, 43, ${0.2 * fade})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, hazard.radius * 0.88, hazard.radius * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = `rgba(125, 241, 106, ${0.24 * fade})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = -game.time * 14;
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius * (0.9 + Math.sin(game.time * 2.2) * 0.025), 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 8; i += 1) {
          const seed = i * 2.71 + game.time * (0.6 + i * 0.03);
          const a = i * 2.2 + Math.sin(seed) * 0.7;
          const r = hazard.radius * (0.15 + (i % 5) * 0.14);
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r * 0.65;
          const pulse = 0.5 + Math.sin(seed * 6) * 0.3;
          ctx.fillStyle = `rgba(154, 255, 112, ${0.12 + pulse * 0.14})`;
          ctx.beginPath();
          ctx.arc(x, y, 4 + (i % 3) * 3 + pulse * 3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      } else if (hazard.type === 'bottle') {
        const z = hazard.z || 0;
        const t = clamp(hazard.t / hazard.flight, 0, 1);
        if (!inView(hazard.x, hazard.y, 40, camX, camY)) continue;
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(hazard.x, hazard.y + 5, 8, 3.5, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.translate(hazard.x, hazard.y - z);
        ctx.rotate(hazard.spin + game.time * 6);
        ctx.fillStyle = '#163822';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 8, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(163, 255, 119, 0.85)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(145, 255, 103, 0.7)';
        ctx.fillRect(-3, -9, 6, 3);
        ctx.fillStyle = '#d8ffc0';
        ctx.beginPath();
        ctx.arc(0, -10, 1.4, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    for (const turret of game.enemyTurrets) {
      if (turret.dead || turret.hp <= 0) continue;
      if (!inView(turret.x, turret.y, 35, camX, camY)) continue;
      ctx.save();
      ctx.translate(turret.x, turret.y);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(3, 8, 17, 7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#202b2c';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 125, 100, 0.48)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.rotate(turret.angle);
      ctx.fillStyle = '#334244';
      ctx.fillRect(0, -4, 24, 8);
      ctx.fillStyle = 'rgba(255, 113, 89, 0.85)';
      ctx.fillRect(20, -2, 5, 4);
      ctx.fillStyle = '#627170';
      ctx.beginPath();
      ctx.arc(-3, 0, 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 95, 79, ${0.55 + Math.sin(game.time * 9) * 0.25})`;
      ctx.beginPath();
      ctx.arc(-3, 0, 2.2, 0, TAU);
      ctx.fill();
      ctx.restore();
      const hpRatio = clamp(turret.hp / Math.max(1, turret.maxHp), 0, 1);
      ctx.fillStyle = 'rgba(2, 8, 10, 0.82)';
      ctx.fillRect(turret.x - 22, turret.y - 33, 44, 5);
      ctx.fillStyle = 'rgba(255, 175, 130, 0.2)';
      ctx.fillRect(turret.x - 21, turret.y - 32, 42, 3);
      ctx.fillStyle = hpRatio > 0.35 ? 'rgba(255, 146, 104, 0.92)' : 'rgba(255, 78, 64, 0.96)';
      ctx.fillRect(turret.x - 21, turret.y - 32, 42 * hpRatio, 3);
      ctx.fillStyle = 'rgba(255, 223, 190, 0.75)';
      ctx.font = '600 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`HP ${Math.ceil(turret.hp)}`, turret.x, turret.y - 37);
      if (turret.hitFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = clamp(turret.hitFlash * 5, 0, 0.35);
        ctx.fillStyle = '#ffe2b0';
        ctx.beginPath();
        ctx.arc(turret.x, turret.y, 22, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      if (turret.muzzleFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255, 152, 105, ${turret.muzzleFlash * 6})`;
        ctx.beginPath();
        ctx.arc(turret.x + Math.cos(turret.angle) * 26, turret.y + Math.sin(turret.angle) * 26, 7, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      if (turret.life < 2.5) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 115, 92, ${0.2 + Math.sin(game.time * 11) * 0.15})`;
        ctx.beginPath();
        ctx.arc(turret.x, turret.y, 23, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawCampaignRockets(ctx, camX, camY) {
    for (const rocket of game.enemyRockets) {
      if (!inView(rocket.x, rocket.y, 30, camX, camY)) continue;
      ctx.save();
      ctx.translate(rocket.x, rocket.y);
      ctx.rotate(rocket.angle);
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(-7, 0, 0, -7, 0, 21);
      glow.addColorStop(0, 'rgba(255, 175, 103, 0.8)');
      glow.addColorStop(1, 'rgba(255, 87, 53, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(-7, 0, 21, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#33221e';
      ctx.fillRect(-9, -2.6, 17, 5.2);
      ctx.fillStyle = '#b79770';
      ctx.beginPath();
      ctx.moveTo(8, -3.6);
      ctx.lineTo(15, 0);
      ctx.lineTo(8, 3.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff8e5e';
      ctx.fillRect(-14, -2, 5, 4);
      ctx.restore();
    }
  }

  function drawGrenades(ctx, camX, camY) {
    for (const g of game.grenades) {
      if (!inView(g.x, g.y, 50, camX, camY)) continue;
      const def = GRENADES[g.type];
      if (!def) continue;
      const canSeeTarget = inView(g.targetX, g.targetY, 30, camX, camY);
      if (!g.landed) {
        const pulse = 0.65 + Math.sin(game.time * 10) * 0.25;
        // The full lob arc makes the small grenade readable at a glance.
        const arcHeight = Math.max(18, g.z || 0) + 22;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(${def.color}, 0.2)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 8]);
        ctx.lineDashOffset = -game.time * 24;
        ctx.beginPath();
        for (let i = 0; i <= 18; i += 1) {
          const t = i / 18;
          const ax = lerp(g.startX, g.targetX, t);
          const ay = lerp(g.startY, g.targetY, t) - Math.sin(t * Math.PI) * arcHeight;
          if (i === 0) ctx.moveTo(ax, ay);
          else ctx.lineTo(ax, ay);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        if (canSeeTarget) {
          ctx.save();
          ctx.translate(g.targetX, g.targetY);
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(${def.color}, ${0.48 * pulse})`;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([4, 6]);
          ctx.lineDashOffset = -game.time * 18;
          ctx.beginPath();
          ctx.arc(0, 0, 21 + Math.sin(game.time * 6) * 2, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(${def.color}, ${0.24 * pulse})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-8, 0);
          ctx.lineTo(8, 0);
          ctx.moveTo(0, -8);
          ctx.lineTo(0, 8);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.save();
      if (g.z > 0.5) {
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(g.x, g.y + 3, 7, 3.4, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `rgba(${def.color}, 0.2)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(g.x, g.y - g.z);
        ctx.stroke();
      }
      ctx.translate(g.x, g.y - g.z);
      const blink = g.landed && Math.sin(game.time * 24 + g.spin) > 0.15;
      const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, 15);
      halo.addColorStop(0, `rgba(${def.color}, 0.18)`);
      halo.addColorStop(1, `rgba(${def.color}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
      ctx.rotate(g.spin);
      ctx.fillStyle = '#17201d';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.8, 7.6, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(${def.color}, 0.95)`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = `rgba(${def.color}, 0.42)`;
      ctx.fillRect(-5.4, -2.2, 10.8, 1.3);
      ctx.fillRect(-4.4, 2.8, 8.8, 1.2);
      ctx.fillStyle = blink ? '#fff9cf' : `rgba(${def.color}, 0.95)`;
      ctx.shadowColor = `rgba(${def.color}, 0.95)`;
      ctx.shadowBlur = blink ? 12 : 5;
      ctx.beginPath();
      ctx.arc(0, -6.1, 1.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTurrets(ctx, camX, camY) {
    for (const turret of game.turrets) {
      if (turret.dead || turret.hp <= 0) continue;
      if (!inView(turret.x, turret.y, 50, camX, camY)) continue;
      drawTurret(ctx, turret);
    }
  }

  function drawPet(ctx) {
    const pet = game.pet;
    if (!pet) return;
    const def = PET_DEFS[pet.id];
    if (!def) return;
    const bob = Math.sin(pet.bob) * 2.2;
    ctx.save();
    ctx.translate(pet.x, pet.y + bob);
    if (def.type === 'drone') {
      if (pet.laserTimer > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255, 172, 104, ${0.3 + pet.laserTimer * 4})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(pet.laserX - pet.x, pet.laserY - pet.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 245, 202, 0.95)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(4, 15, 18, 7, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 183, 109, 0.7)';
      ctx.fillStyle = '#1b2a30';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0a1418';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 151, 87, ${0.7 + Math.sin(game.time * 8) * 0.2})`;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff1cd';
      ctx.beginPath();
      ctx.arc(-1, -1, 1.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#7e9ba3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -2); ctx.lineTo(-22, -8);
      ctx.moveTo(12, -2); ctx.lineTo(22, -8);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 195, 125, 0.55)';
      ctx.fillRect(-25, -11, 7, 3);
      ctx.fillRect(18, -11, 7, 3);
      ctx.fillStyle = 'rgba(255, 205, 132, 0.75)';
      ctx.font = '700 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('浮游炮', 0, -20);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath();
      ctx.ellipse(3, 12, 17, 6, 0, 0, TAU);
      ctx.fill();
      if (def.type === 'cat') {
        ctx.fillStyle = '#5db9df';
        ctx.strokeStyle = '#b8f3ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(-1, 4, 14, 9, -0.15, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-14, 5); ctx.lineTo(-9, -2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(5, 4); ctx.lineTo(9, -3); ctx.lineTo(13, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(9, -4, 8, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#5db9df';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-13, 4);
        ctx.quadraticCurveTo(-24, -4, -18, -13);
        ctx.stroke();
        ctx.fillStyle = '#163748';
        ctx.beginPath(); ctx.arc(7, -5, 1.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(12, -5, 1.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd777';
        ctx.beginPath(); ctx.arc(9.5, -1, 1.1, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(180, 243, 255, 0.75)';
        ctx.font = '700 8px "SFMono-Regular", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('凉屋', -2, -17);
      } else {
        ctx.fillStyle = '#dca641';
        ctx.strokeStyle = '#ffe6a1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(-1, 4, 15, 9, -0.12, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-14, 3); ctx.lineTo(-10, -5); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(4, 3); ctx.lineTo(9, -5); ctx.lineTo(13, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.arc(10, -4, 8, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#dca641';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-14, 3);
        ctx.quadraticCurveTo(-23, -7, -17, -14);
        ctx.stroke();
        ctx.fillStyle = '#4a2b1b';
        ctx.beginPath(); ctx.arc(7, -5, 1.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(12, -5, 1.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3ca98f';
        ctx.fillRect(4, -1, 11, 2);
        ctx.fillStyle = 'rgba(255, 230, 161, 0.8)';
        ctx.font = '700 8px "SFMono-Regular", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('旺财', -2, -17);
      }
    }
    ctx.restore();
  }

  function drawActorLayer(ctx, camX, camY) {
    const actors = [];
    for (const e of game.enemies) {
      if (!inView(e.x, e.y, 70, camX, camY)) continue;
      actors.push({ type: 'enemy', y: e.y, ref: e });
    }
    if (game.player) {
      const p = game.player;
      if (inView(p.x, p.y, 60, camX, camY)) actors.push({ type: 'player', y: p.y, ref: p });
    }
    if (game.pet && inView(game.pet.x, game.pet.y, 40, camX, camY)) {
      actors.push({ type: 'pet', y: game.pet.y, ref: game.pet });
    }
    actors.sort((a, b) => a.y - b.y);
    for (const actor of actors) {
      if (actor.type === 'player') drawPlayerActor(ctx);
      else if (actor.type === 'pet') drawPet(ctx);
      else drawEnemyActor(ctx, actor.ref);
    }
  }

  function drawBullets(ctx, camX, camY) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of game.bullets) {
      if (!inView(b.x, b.y, 30, camX, camY)) continue;
      if (b.kind === 'rocket') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        const g = ctx.createRadialGradient(-5, 0, 0, -5, 0, 22);
        g.addColorStop(0, 'rgba(255, 198, 109, 0.9)');
        g.addColorStop(0.4, 'rgba(255, 126, 67, 0.35)');
        g.addColorStop(1, 'rgba(255, 116, 59, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(-5, 0, 22, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#331f18';
        ctx.fillRect(-10, -2.5, 16, 5);
        ctx.fillStyle = '#e5b072';
        ctx.beginPath();
        ctx.moveTo(6, -3.4);
        ctx.lineTo(13, 0);
        ctx.lineTo(6, 3.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffb568';
        ctx.fillRect(-14, -2, 4, 4);
        ctx.restore();
        continue;
      }
      const tailX = b.x - (b.vx / Math.hypot(b.vx, b.vy || 0.001)) * 18;
      const tailY = b.y - (b.vy / Math.hypot(b.vx, b.vy || 0.001)) * 18;
      const grad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
      grad.addColorStop(0, rgba(b.color, 0));
      grad.addColorStop(0.7, rgba(b.color, 0.45));
      grad.addColorStop(1, rgba(b.color, 1));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = '#fffbe9';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 1.15, 0, TAU);
      ctx.fill();
    }
    for (const b of game.enemyBullets) {
      if (!inView(b.x, b.y, 40, camX, camY)) continue;
      if (b.rocket) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        const rg = ctx.createRadialGradient(-6, 0, 0, -6, 0, 23);
        rg.addColorStop(0, 'rgba(255, 213, 143, 0.95)');
        rg.addColorStop(0.36, 'rgba(255, 112, 60, 0.4)');
        rg.addColorStop(1, 'rgba(255, 90, 43, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(-6, 0, 23, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#34251e';
        ctx.fillRect(-10, -2.4, 17, 4.8);
        ctx.fillStyle = '#f2bf7f';
        ctx.beginPath();
        ctx.moveTo(7, -3.5);
        ctx.lineTo(15, 0);
        ctx.lineTo(7, 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff8653';
        ctx.fillRect(-15, -2, 5, 4);
        ctx.restore();
        continue;
      }
      const tx = b.x - (b.vx / Math.hypot(b.vx, b.vy || 0.001)) * 22;
      const ty = b.y - (b.vy / Math.hypot(b.vx, b.vy || 0.001)) * 22;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 4.5);
      g.addColorStop(0, rgba(b.color, 0.9));
      g.addColorStop(0.22, rgba(b.color, 0.5));
      g.addColorStop(1, rgba(b.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 4.5, 0, TAU);
      ctx.fill();
      const tg = ctx.createLinearGradient(tx, ty, b.x, b.y);
      tg.addColorStop(0, rgba(b.color, 0));
      tg.addColorStop(1, rgba(b.color, 0.7));
      ctx.strokeStyle = tg;
      ctx.lineWidth = b.r * 0.65;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = '#fff6ee';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.38, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles(ctx, camX, camY) {
    ctx.save();
    for (const p of game.particles) {
      if (!inView(p.x, p.y, 80, camX, camY)) continue;
      const alpha = clamp(p.life / p.maxLife, 0, 1) * (p.alpha ?? 1);
      if (p.type === 'smoke') {
        const grow = p.size * (1.5 - alpha * 0.55);
        ctx.globalAlpha = alpha * 0.65;
        ctx.fillStyle = rgba(p.color, 0.8);
        ctx.beginPath();
        ctx.arc(p.x, p.y, grow, 0, TAU);
        ctx.fill();
      } else if (p.type === 'dust') {
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = rgba(p.color, 0.8);
        ctx.fillRect(p.x, p.y, p.size, p.size);
      } else if (p.type === 'shard') {
        ctx.globalAlpha = alpha * 0.8;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = rgba(p.color, 0.9);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.type === 'ghost') {
        ctx.globalAlpha = alpha * p.alpha * 0.7;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillStyle = rgba(p.color, 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(p.color, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.64, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.particles) {
      if (!inView(p.x, p.y, 80, camX, camY)) continue;
      const alpha = clamp(p.life / p.maxLife, 0, 1) * (p.alpha ?? 1);
      if (p.type === 'spark') {
        const len = 2.6 + (p.size || 1) * 2.1;
        const mag = Math.hypot(p.vx, p.vy) || 1;
        ctx.strokeStyle = rgba(p.color, alpha * 0.9);
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / mag) * len, p.y - (p.vy / mag) * len);
        ctx.stroke();
      } else if (p.type === 'ring') {
        const radius = p.size * (1.22 - alpha * 0.72);
        ctx.strokeStyle = rgba(p.color, alpha * 0.55);
        ctx.lineWidth = 1 + alpha * 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, radius), 0, TAU);
        ctx.stroke();
      } else if (p.type === 'flash') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, rgba(p.color, alpha * 0.8));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.type === 'muzzleFlash') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = rgba(p.color, 0.75);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(p.size * 1.35, -p.size * 0.3);
        ctx.lineTo(p.size * 0.8, 0);
        ctx.lineTo(p.size * 1.35, p.size * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fffbed';
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.21, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawTexts(ctx, camX, camY) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of game.texts) {
      if (!inView(t.x, t.y, 80, camX, camY)) continue;
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `600 ${t.size}px "SFMono-Regular", "Cascadia Code", monospace`;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot);
      ctx.fillStyle = 'rgba(3, 8, 10, 0.7)';
      ctx.fillText(t.text, 1, 1);
      ctx.fillStyle = rgba(t.color, 0.95);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function campaignSearchableName(item) {
    const labels = {
      crate: '补给箱',
      cabinet: '实验柜',
      locker: '储物柜',
      specimen: '标本箱',
      server: '数据机柜',
    };
    return labels[item.type] || '补给箱';
  }

  function drawCampaignObject(ctx, item) {
    const pulse = 0.72 + Math.sin(game.time * 4.5 + item.seed) * 0.2;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(2, 8, 20, 8, 0, 0, TAU);
    ctx.fill();
    if (!item.searched) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 31);
      glow.addColorStop(0, `rgba(${game.campaign.level.theme.accent}, ${0.08 * pulse})`);
      glow.addColorStop(1, `rgba(${game.campaign.level.theme.accent}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = item.searched ? 0.48 : 1;
    const type = item.type;
    if (type === 'cabinet' || type === 'locker') {
      ctx.fillStyle = type === 'locker' ? '#1a2729' : '#1b2b2a';
      rrPath(ctx, -13, -23, 26, 42, 2);
      ctx.fill();
      ctx.strokeStyle = item.searched ? 'rgba(92, 116, 113, 0.25)' : 'rgba(132, 213, 195, 0.42)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(91, 143, 137, 0.3)';
      ctx.beginPath();
      ctx.moveTo(-11, -10);
      ctx.lineTo(11, -10);
      ctx.stroke();
      ctx.fillStyle = '#b99c68';
      ctx.fillRect(7, -5, 2, 7);
      if (!item.searched) {
        ctx.fillStyle = `rgba(${game.campaign.level.theme.accent}, ${0.35 + pulse * 0.28})`;
        ctx.fillRect(-10, -20, 3, 2);
      } else {
        ctx.strokeStyle = 'rgba(112, 132, 127, 0.25)';
        ctx.beginPath();
        ctx.moveTo(-11, 10);
        ctx.lineTo(11, 2);
        ctx.stroke();
      }
    } else if (type === 'server') {
      ctx.fillStyle = '#1b242b';
      rrPath(ctx, -16, -20, 32, 38, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(139, 208, 217, 0.35)';
      ctx.stroke();
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(111, 240, 252, 0.34)' : 'rgba(102, 128, 131, 0.3)';
        ctx.fillRect(-11, -14 + i * 7, 15, 2);
      }
      ctx.fillStyle = 'rgba(255, 159, 83, 0.45)';
      ctx.fillRect(9, -13, 2, 2);
    } else if (type === 'specimen') {
      ctx.fillStyle = '#14211e';
      rrPath(ctx, -14, -21, 28, 38, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(116, 236, 193, 0.38)';
      ctx.stroke();
      ctx.fillStyle = `rgba(102, 238, 174, ${0.06 + pulse * 0.06})`;
      ctx.beginPath();
      ctx.arc(0, 2, 10, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(146, 200, 188, 0.23)';
      ctx.beginPath();
      ctx.moveTo(-12, -10);
      ctx.lineTo(12, -10);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1b2828';
      rrPath(ctx, -17, -14, 34, 28, 2);
      ctx.fill();
      ctx.strokeStyle = item.searched ? 'rgba(94, 119, 114, 0.25)' : 'rgba(140, 205, 185, 0.38)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110, 157, 148, 0.28)';
      ctx.beginPath();
      ctx.moveTo(-15, -4);
      ctx.lineTo(15, -4);
      ctx.moveTo(-15, 6);
      ctx.lineTo(15, 6);
      ctx.moveTo(-6, -12);
      ctx.lineTo(-6, 12);
      ctx.stroke();
      if (!item.searched) {
        ctx.fillStyle = `rgba(${game.campaign.level.theme.accent}, ${0.4 + pulse * 0.3})`;
        ctx.fillRect(10, -11, 3, 2);
      }
    }
    if (item.searched) {
      ctx.fillStyle = 'rgba(113, 133, 127, 0.55)';
      ctx.font = '500 9px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('EMPTY', 0, 30);
    }
    ctx.restore();
  }

  function drawCampaignElevator(ctx, elevator) {
    const level = game.campaign.level;
    const accent = level.theme.accent;
    const isExit = elevator.kind === 'exit';
    const unlocked = !isExit || campaignExitUnlocked();
    const color = isExit ? (unlocked ? '122, 255, 191' : '255, 105, 88') : accent;
    ctx.save();
    ctx.translate(elevator.x, elevator.y);
    const pulse = 0.7 + Math.sin(game.time * 3.4) * 0.22;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
    g.addColorStop(0, `rgba(${color}, ${0.12 * pulse})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4, 12, 14, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${color}, ${unlocked ? 0.72 : 0.42})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${color}, 0.28)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -game.time * 20;
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // Elevator doors / up arrow.
    ctx.fillStyle = `rgba(${color}, 0.22)`;
    ctx.fillRect(-18, -27, 36, 8);
    ctx.strokeStyle = `rgba(${color}, 0.55)`;
    ctx.beginPath();
    ctx.moveTo(-12, 21);
    ctx.lineTo(0, 8);
    ctx.lineTo(12, 21);
    ctx.moveTo(-12, 10);
    ctx.lineTo(0, -3);
    ctx.lineTo(12, 10);
    ctx.stroke();
    ctx.fillStyle = `rgba(${color}, ${unlocked ? 0.88 : 0.55})`;
    ctx.font = '600 10px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isExit ? (unlocked ? 'EXIT READY' : 'EXIT LOCKED') : 'START', 0, 62);
    ctx.fillStyle = '#d7f4ea';
    ctx.font = '600 11px "Avenir Next", "PingFang SC", sans-serif';
    ctx.fillText(elevator.label, 0, -57);
    ctx.restore();
  }

  function drawCampaignShop(ctx, shop) {
    const t = game.time;
    const pulse = 0.68 + Math.sin(t * 3.8) * 0.22;
    ctx.save();
    ctx.translate(shop.x, shop.y);
    // Ground halo and service pad.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 8, 2, 0, 8, 88);
    halo.addColorStop(0, `rgba(116, 250, 255, ${0.12 + pulse * 0.05})`);
    halo.addColorStop(1, 'rgba(116, 250, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 8, 88, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 17, 48, 16, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#07171b';
    ctx.beginPath();
    ctx.ellipse(0, 14, 41, 13, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(128, 246, 255, ${0.25 + pulse * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(126, 247, 255, 0.14)';
    ctx.setLineDash([4, 7]);
    ctx.lineDashOffset = -t * 16;
    ctx.beginPath();
    ctx.ellipse(0, 14, 47, 16, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Beacon column.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, -155, 0, 4);
    beam.addColorStop(0, 'rgba(118, 250, 255, 0)');
    beam.addColorStop(0.55, `rgba(118, 250, 255, ${0.055 + pulse * 0.025})`);
    beam.addColorStop(1, `rgba(118, 250, 255, ${0.12 + pulse * 0.03})`);
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-18, 8);
    ctx.lineTo(18, 8);
    ctx.lineTo(7, -155);
    ctx.lineTo(-7, -155);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Back pylons and canopy.
    ctx.fillStyle = '#0a2227';
    ctx.fillRect(-31, -21, 8, 34);
    ctx.fillRect(23, -21, 8, 34);
    ctx.strokeStyle = 'rgba(124, 245, 252, 0.34)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-31, -21, 8, 34);
    ctx.strokeRect(23, -21, 8, 34);
    ctx.fillStyle = 'rgba(6, 25, 30, 0.96)';
    rrPath(ctx, -39, -36, 78, 11, 3);
    ctx.fill();
    ctx.strokeStyle = `rgba(125, 248, 255, ${0.3 + pulse * 0.18})`;
    ctx.stroke();
    ctx.fillStyle = `rgba(120, 247, 255, ${0.2 + pulse * 0.12})`;
    ctx.fillRect(-34, -34, 22, 2);
    ctx.fillRect(12, -34, 22, 2);

    // Main kiosk.
    ctx.fillStyle = 'rgba(5, 17, 21, 0.96)';
    rrPath(ctx, -29, -29, 58, 33, 3);
    ctx.fill();
    ctx.strokeStyle = `rgba(126, 243, 250, ${0.38 + pulse * 0.2})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const screen = ctx.createLinearGradient(-23, -26, 23, -3);
    screen.addColorStop(0, 'rgba(74, 238, 255, 0.23)');
    screen.addColorStop(0.55, 'rgba(26, 98, 112, 0.34)');
    screen.addColorStop(1, 'rgba(117, 255, 224, 0.12)');
    ctx.fillStyle = screen;
    ctx.fillRect(-23, -26, 46, 20);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-23, -26, 46, 20);
    ctx.clip();
    for (let i = 0; i < 4; i += 1) {
      const yy = -25 + ((t * 14 + i * 7) % 20);
      ctx.fillStyle = `rgba(124, 255, 249, ${0.06 + i * 0.018})`;
      ctx.fillRect(-23, yy, 46, 1);
    }
    ctx.fillStyle = `rgba(154, 255, 238, ${0.58 + pulse * 0.25})`;
    ctx.font = '700 11px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SUPPLY', 0, -13);
    ctx.fillStyle = 'rgba(217, 255, 255, 0.62)';
    ctx.font = '600 6px "SFMono-Regular", monospace';
    ctx.fillText('ARMORY TERMINAL', 0, -5);
    ctx.restore();
    ctx.strokeStyle = 'rgba(137, 255, 253, 0.18)';
    ctx.strokeRect(-23, -26, 46, 20);
    // Input shelf and floor lights.
    ctx.fillStyle = 'rgba(15, 44, 47, 0.95)';
    ctx.fillRect(-17, 2, 34, 4);
    ctx.fillStyle = `rgba(255, 198, 104, ${0.5 + pulse * 0.2})`;
    ctx.fillRect(-25, 7, 9, 2);
    ctx.fillStyle = `rgba(126, 255, 194, ${0.45 + pulse * 0.25})`;
    ctx.fillRect(16, 7, 9, 2);

    // Holographic diamond and link status.
    ctx.save();
    ctx.translate(0, -56 + Math.sin(t * 2.2) * 3);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = `rgba(126, 250, 255, ${0.45 + pulse * 0.25})`;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-7, -7, 14, 14);
    ctx.fillStyle = 'rgba(126, 250, 255, 0.13)';
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.fillStyle = `rgba(182, 255, 250, ${0.65 + pulse * 0.2})`;
    ctx.font = '600 9px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('补给终端 // SUPPLY', 0, -68);

    // Side canisters/crates.
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 50, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(0, 9, 14, 5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = side < 0 ? '#10292a' : '#29251a';
      rrPath(ctx, -10, -8, 20, 18, 2);
      ctx.fill();
      ctx.strokeStyle = side < 0 ? 'rgba(113, 236, 228, 0.25)' : 'rgba(255, 192, 105, 0.25)';
      ctx.stroke();
      ctx.fillStyle = side < 0 ? 'rgba(134, 255, 238, 0.45)' : 'rgba(255, 198, 112, 0.42)';
      ctx.fillRect(-6, -4, 12, 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCampaignObjects(ctx, camX, camY) {
    const campaign = game.campaign;
    if (!campaign.active || !campaign.level) return;
    for (const elevator of campaign.elevators) {
      if (!inView(elevator.x, elevator.y, 90, camX, camY)) continue;
      drawCampaignElevator(ctx, elevator);
    }
    for (const shop of campaign.shops) {
      if (!inView(shop.x, shop.y, 112, camX, camY)) continue;
      drawCampaignShop(ctx, shop);
    }
    for (const item of campaign.searchables) {
      if (!inView(item.x, item.y, 40, camX, camY)) continue;
      drawCampaignObject(ctx, item);
    }
  }

  function drawInteractionTag(ctx, x, y, key, text, accent = '111, 240, 201') {
    ctx.save();
    ctx.font = '600 11px "SFMono-Regular", "PingFang SC", monospace';
    const textWidth = ctx.measureText(text).width;
    const width = textWidth + 38;
    const height = 21;
    const left = x - width / 2;
    ctx.fillStyle = 'rgba(2, 9, 12, 0.88)';
    ctx.strokeStyle = `rgba(${accent}, 0.42)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y - height);
    ctx.lineTo(left + width - 6, y - height);
    ctx.lineTo(left + width, y - height + 6);
    ctx.lineTo(left + width, y);
    ctx.lineTo(left, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(${accent}, 0.66)`;
    ctx.fillRect(left, y - height, 24, height);
    ctx.fillStyle = '#071010';
    ctx.font = '700 11px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(key, left + 12, y - 6);
    ctx.fillStyle = '#d7f7f0';
    ctx.font = '600 11px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, left + 30, y - 6);
    ctx.restore();
  }

  function drawCampaignPrompts(ctx, camX, camY) {
    const campaign = game.campaign;
    if (!campaign.active || !campaign.prompt) return;
    const prompt = campaign.prompt;
    if (prompt.search) {
      drawInteractionTag(ctx, prompt.search.x, prompt.search.y - 30, 'E', `搜索 ${campaignSearchableName(prompt.search)}`, game.campaign.level.theme.accent);
    }
    if (prompt.shop) {
      drawInteractionTag(ctx, prompt.shop.x, prompt.shop.y - 28, 'F', '使用商店终端', '127, 243, 255');
    }
    if (prompt.elevator) {
      const elevator = prompt.elevator;
      const unlocked = campaignExitUnlocked();
      let text;
      if (elevator.kind === 'start') text = '确认起点电梯';
      else if (!unlocked) text = campaign.rogue ? '上行电梯已锁定' : '终点电梯已锁定';
      else if (campaign.rogue) text = '前往下一层';
      else text = campaign.levelIndex < 2 ? '前往下一区域' : '启动终点电梯';
      drawInteractionTag(ctx, elevator.x, elevator.y - 47, 'F', text, elevator.kind === 'exit' && !unlocked ? '255, 111, 91' : '124, 255, 199');
    }
    // Boss direction is handled by the normal HUD; no full-screen arrow here.
  }

  function drawCampaignArenaBarriers(ctx, camX, camY) {
    const campaign = game.campaign;
    if (!campaign.active || !campaign.arenaLocked || !campaign.arenaRoom) return;
    const room = campaign.arenaRoom;
    const time = game.time;
    const bars = campaign.arenaBarriers || [];
    ctx.save();
    // A faint sealed-room perimeter plus bright door barriers.
    ctx.strokeStyle = `rgba(255, 103, 83, ${0.1 + Math.sin(time * 4) * 0.03})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -time * 24;
    ctx.strokeRect(room.x + 4, room.y + 4, room.w - 8, room.h - 8);
    ctx.setLineDash([]);
    for (const bar of bars) {
      const mx = (bar.x1 + bar.x2) / 2;
      const my = (bar.y1 + bar.y2) / 2;
      if (!inView(mx, my, 70, camX, camY)) continue;
      const horizontal = Math.abs(bar.x2 - bar.x1) > Math.abs(bar.y2 - bar.y1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255, 93, 76, ${0.25 + Math.sin(time * 6) * 0.06})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(bar.x1, bar.y1);
      ctx.lineTo(bar.x2, bar.y2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 142, 108, ${0.82 + Math.sin(time * 8) * 0.12})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -time * 42;
      ctx.beginPath();
      ctx.moveTo(bar.x1, bar.y1);
      ctx.lineTo(bar.x2, bar.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 179, 123, 0.9)';
      for (const p of [{ x: bar.x1, y: bar.y1 }, { x: bar.x2, y: bar.y2 }]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      // Alternating lock teeth make the field read as a physical barrier.
      const len = Math.hypot(bar.x2 - bar.x1, bar.y2 - bar.y1);
      const nx = (bar.x2 - bar.x1) / (len || 1);
      const ny = (bar.y2 - bar.y1) / (len || 1);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 123, 91, 0.45)';
      ctx.lineWidth = 1;
      for (let d = 8; d < len; d += 16) {
        const x = bar.x1 + nx * d;
        const y = bar.y1 + ny * d;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 4, y + 3);
          ctx.lineTo(x + 8, y - 3);
        } else {
          ctx.moveTo(x - 5, y);
          ctx.lineTo(x + 3, y + 4);
          ctx.lineTo(x - 3, y + 8);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawCampaignSearchProgress(ctx, camX, camY) {
    const campaign = game.campaign;
    const item = campaign.searchTarget;
    if (!campaign.active || !item) return;
    if (!inView(item.x, item.y, 50, camX, camY)) return;
    const ratio = clamp(1 - campaign.searchTimer / Math.max(0.001, campaign.searchDuration), 0, 1);
    const accent = campaign.level.theme.accent;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${accent}, 0.18)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${accent}, 0.85)`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
    const barW = 82;
    const barH = 6;
    const bx = -barW / 2;
    const by = -43;
    ctx.fillStyle = 'rgba(2, 9, 12, 0.9)';
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = `rgba(${accent}, 0.16)`;
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = `rgba(${accent}, 0.9)`;
    ctx.fillRect(bx, by, barW * ratio, barH);
    ctx.fillStyle = '#e5fff9';
    ctx.font = '600 10px "SFMono-Regular", "PingFang SC", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`搜索中 ${Math.max(0, campaign.searchTimer).toFixed(1)}s`, 0, by - 7);
    ctx.fillStyle = `rgba(${accent}, 0.5)`;
    ctx.font = '500 9px "SFMono-Regular", monospace';
    ctx.fillText('SEARCHING', 0, 38);
    ctx.restore();
  }

  function drawCampaignVision(ctx, camX, camY) {
    const p = game.player;
    if (!p || game.runMode !== 'campaign' || isDeveloperMode()) return;
    const campaign = game.campaign;
    if (!campaign.active || !campaign.level) return;
    const sx = (p.x - camX) * CAMERA_ZOOM;
    const sy = (p.y - camY) * CAMERA_ZOOM;
    const radius = Math.max(120, campaign.visionRadius * CAMERA_ZOOM);
    const outer = radius * 1.06;
    const g = ctx.createRadialGradient(sx, sy, radius * 0.58, sx, sy, outer);
    g.addColorStop(0, 'rgba(1, 4, 6, 0)');
    g.addColorStop(0.56, 'rgba(1, 4, 6, 0.045)');
    g.addColorStop(0.83, 'rgba(1, 4, 6, 0.72)');
    g.addColorStop(1, 'rgba(1, 4, 6, 0.985)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, game.viewW, game.viewH);
    ctx.strokeStyle = 'rgba(132, 246, 241, 0.13)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 12]);
    ctx.lineDashOffset = -game.time * 12;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawPlayerPoisonZones(ctx, camX, camY) {
    for (const zone of game.playerPoisonZones) {
      if (!inView(zone.x, zone.y, zone.radius + 30, camX, camY)) continue;
      const fade = clamp(zone.life / 0.6, 0, 1);
      const pulse = 0.5 + Math.sin(game.time * 4) * 0.12;
      ctx.save();
      ctx.translate(zone.x, zone.y);
      const fog = ctx.createRadialGradient(0, 0, 4, 0, 0, zone.radius);
      fog.addColorStop(0, `rgba(118, 208, 72, ${0.2 * fade})`);
      fog.addColorStop(0.5, `rgba(83, 155, 55, ${0.16 * fade})`);
      fog.addColorStop(0.86, `rgba(53, 103, 36, ${0.08 * fade})`);
      fog.addColorStop(1, 'rgba(47, 91, 33, 0)');
      ctx.fillStyle = fog;
      ctx.beginPath();
      ctx.ellipse(0, 0, zone.radius, zone.radius * 0.68, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(156, 255, 105, ${0.28 * fade * pulse})`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -game.time * 22;
      ctx.beginPath();
      ctx.ellipse(0, 0, zone.radius * 0.86, zone.radius * 0.58, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 8; i += 1) {
        const a = game.time * 0.8 + i * 0.9;
        const rr = zone.radius * (0.25 + (i % 3) * 0.22);
        ctx.fillStyle = `rgba(190, 255, 121, ${(0.08 + (i % 3) * 0.03) * fade})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.58, 2 + (i % 3), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawValkyrieAura(ctx, p, camX, camY) {
    const t = game.time;
    const pulse = 0.72 + Math.sin(t * 5.2) * 0.18;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 58);
    glow.addColorStop(0, `rgba(255, 226, 149, ${0.2 * pulse})`);
    glow.addColorStop(0.42, `rgba(255, 190, 83, ${0.09 * pulse})`);
    glow.addColorStop(1, 'rgba(255, 172, 52, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 58, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 227, 152, ${0.24 + pulse * 0.12})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 31 + Math.sin(t * 3.1) * 2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // Jetpack exhaust.
    if (p.jetpackActive) {
      const tailAngle = Math.atan2(p.vy || 0, p.vx || 0) + Math.PI;
      for (const side of [-1, 1]) {
        const ox = Math.cos(tailAngle + side * 0.2) * 13;
        const oy = Math.sin(tailAngle + side * 0.2) * 13;
        const flame = ctx.createRadialGradient(p.x + ox, p.y + oy, 1, p.x + ox, p.y + oy, 23);
        flame.addColorStop(0, 'rgba(255, 250, 211, 0.8)');
        flame.addColorStop(0.35, 'rgba(255, 185, 74, 0.4)');
        flame.addColorStop(1, 'rgba(255, 111, 34, 0)');
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.arc(p.x + ox, p.y + oy, 23, 0, TAU);
        ctx.fill();
      }
    }
    // Full-screen lock brackets on living targets.
    ctx.strokeStyle = `rgba(255, 220, 136, ${0.22 + pulse * 0.1})`;
    ctx.lineWidth = 0.9;
    for (const enemy of game.enemies) {
      if (enemy.dead || enemy.spawnTimer > 0 || !isOnScreen(enemy.x, enemy.y, 60)) continue;
      const r = enemy.radius + 10;
      const len = Math.min(7, r * 0.34);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const cx = enemy.x + sx * r;
          const cy = enemy.y + sy * r;
          ctx.beginPath();
          ctx.moveTo(cx - sx * len, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy - sy * len);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawPlayerMissiles(ctx, camX, camY) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const missile of game.playerMissiles) {
      if (!inView(missile.x, missile.y, 40, camX, camY)) continue;
      const tailX = missile.x - Math.cos(missile.angle) * 28;
      const tailY = missile.y - Math.sin(missile.angle) * 28;
      const trail = ctx.createLinearGradient(tailX, tailY, missile.x, missile.y);
      trail.addColorStop(0, 'rgba(255, 112, 35, 0)');
      trail.addColorStop(0.62, 'rgba(255, 170, 62, 0.38)');
      trail.addColorStop(1, 'rgba(255, 238, 178, 0.9)');
      ctx.strokeStyle = trail;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(missile.x, missile.y);
      ctx.stroke();
      ctx.save();
      ctx.translate(missile.x, missile.y);
      ctx.rotate(missile.angle);
      ctx.fillStyle = '#fff0bd';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(1, -3);
      ctx.lineTo(-7, -2.4);
      ctx.lineTo(-9, 0);
      ctx.lineTo(-7, 2.4);
      ctx.lineTo(1, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#d9933c';
      ctx.fillRect(-8, -3.8, 4, 1.4);
      ctx.fillRect(-8, 2.4, 4, 1.4);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawAutoAimTarget(ctx) {
    const target = game.autoAimTarget;
    if (!target || target.dead || !hasTalent('intelligenceCore') || !game.autoAimEnabled) return;
    const pulse = 1 + Math.sin(game.time * 9) * 0.08;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.strokeStyle = 'rgba(255, 213, 137, 0.78)';
    ctx.lineWidth = 1.5;
    ctx.rotate(game.time * 1.7);
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI / 2;
      ctx.moveTo(Math.cos(a) * 18 * pulse, Math.sin(a) * 18 * pulse);
      ctx.lineTo(Math.cos(a + 0.5) * 26 * pulse, Math.sin(a + 0.5) * 26 * pulse);
    }
    ctx.stroke();
    ctx.rotate(-game.time * 1.7);
    ctx.fillStyle = 'rgba(255, 229, 169, 0.85)';
    ctx.font = '700 8px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AUTO', 0, -32);
    ctx.restore();
  }

  function drawPlayerReloadIndicator(ctx) {
    const p = game.player;
    if (!p || !p.alive) return;
    const bars = [];
    if (p.reloading && p.reloadDuration > 0) {
      bars.push({ label: '主', timer: p.reloadTimer, duration: p.reloadDuration, color: '112, 239, 248' });
    }
    if (p.offhandReloading && p.offhandReloadDuration > 0) {
      bars.push({ label: '副', timer: p.offhandReloadTimer, duration: p.offhandReloadDuration, color: '255, 210, 126' });
    }
    if (!bars.length) return;
    const barWidth = 7;
    const barHeight = 40;
    const gap = 13;
    const originX = p.x + Math.max(30, p.r + 20);
    const originY = p.y - barHeight / 2;
    ctx.save();
    bars.forEach((bar, index) => {
      const progress = clamp(1 - bar.timer / Math.max(0.001, bar.duration), 0, 1);
      const x = originX + index * gap;
      const innerHeight = barHeight - 2;
      const fillHeight = innerHeight * progress;
      ctx.fillStyle = 'rgba(2, 9, 12, 0.9)';
      ctx.fillRect(x, originY, barWidth + 2, barHeight + 2);
      ctx.strokeStyle = `rgba(${bar.color}, 0.55)`;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x, originY, barWidth + 2, barHeight + 2);
      const fill = ctx.createLinearGradient(0, originY + barHeight, 0, originY);
      fill.addColorStop(0, `rgba(${bar.color}, 0.92)`);
      fill.addColorStop(1, `rgba(${bar.color}, 0.38)`);
      ctx.fillStyle = fill;
      ctx.fillRect(x + 1, originY + 1 + innerHeight - fillHeight, barWidth, fillHeight);
      ctx.fillStyle = `rgba(${bar.color}, 0.98)`;
      ctx.font = '700 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bar.label, x + barWidth / 2, originY - 5);
      ctx.fillStyle = `rgba(${bar.color}, 0.82)`;
      ctx.font = '600 7px "SFMono-Regular", monospace';
      ctx.fillText(`${Math.round(progress * 100)}%`, x + barWidth / 2, originY + barHeight + 11);
      if (progress < 1) {
        const markerY = originY + 1 + innerHeight - fillHeight;
        ctx.fillStyle = `rgba(${bar.color}, ${0.5 + Math.sin(game.time * 12) * 0.22})`;
        ctx.fillRect(x - 2, markerY - 1, barWidth + 6, 2);
      }
    });
    ctx.restore();
  }

  function drawCharacterSkillFX(ctx, camX, camY) {
    const p = game.player;
    if (!p || !p.alive) return;
    if (p.characterId === 'valkyrie') drawValkyrieAura(ctx, p, camX, camY);
    if (p.holoShieldTimer > 0) {
      const pulse = 0.75 + Math.sin(game.time * 9) * 0.12;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(p.x, p.y);
      const glow = ctx.createRadialGradient(0, 0, 12, 0, 0, 54);
      glow.addColorStop(0, 'rgba(103, 190, 255, 0.06)');
      glow.addColorStop(1, 'rgba(103, 190, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 54, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(145, 221, 255, ${0.55 * pulse})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 39, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190, 240, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      ctx.lineDashOffset = -game.time * 25;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * TAU + game.time * 0.25;
        ctx.fillStyle = `rgba(158, 230, 255, ${0.22 + pulse * 0.18})`;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * 39, Math.sin(angle) * 39, 1.7, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    if (p.healDroneTimer > 0) {
      const t = game.time;
      const dx = p.x + Math.cos(t * 2.1) * 27;
      const dy = p.y - 25 + Math.sin(t * 2.7) * 6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(121, 255, 196, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(p.x, p.y - 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(dx, dy);
      ctx.fillStyle = '#0a201b';
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = i / 6 * TAU + t * 1.1;
        const rr = i % 2 === 0 ? 10 : 7;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.72;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(133, 255, 201, 0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(171, 255, 212, 0.95)';
      ctx.fillRect(-1.2, -5.2, 2.4, 10.4);
      ctx.fillRect(-5.2, -1.2, 10.4, 2.4);
      ctx.restore();
    }
    for (const bottle of game.playerPoisonBottles) {
      if (!inView(bottle.x, bottle.y - (bottle.z || 0), 40, camX, camY)) continue;
      const screenY = bottle.y - (bottle.z || 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(bottle.x, screenY, 1, bottle.x, screenY, 18);
      glow.addColorStop(0, 'rgba(180, 255, 106, 0.45)');
      glow.addColorStop(1, 'rgba(123, 221, 70, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(bottle.x, screenY, 18, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b7ff7b';
      ctx.beginPath();
      ctx.ellipse(bottle.x, screenY, 4.2, 6.2, Math.sin(game.time * 7) * 0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#395d27';
      ctx.fillRect(bottle.x - 1.2, screenY - 8, 2.4, 3);
      ctx.restore();
    }
  }

  function drawWorld(ctx, camX, camY) {
    drawFloorGlows(ctx);
    drawDecals(ctx, camX, camY);
    drawCampaignHazards(ctx, camX, camY);
    drawFireZones(ctx, camX, camY);
    drawPlayerPoisonZones(ctx, camX, camY);
    drawPortals(ctx);
    if (game.runMode === 'campaign') drawCampaignObjects(ctx, camX, camY);
    drawCoins(ctx, camX, camY);
    drawPickups(ctx, camX, camY);
    drawCasings(ctx, camX, camY);
    drawTelegraphs(ctx, camX, camY);
    drawTurrets(ctx, camX, camY);
    drawActorLayer(ctx, camX, camY);
    drawPlayerReloadIndicator(ctx);
    drawAutoAimTarget(ctx);
    drawCharacterSkillFX(ctx, camX, camY);
    drawBullets(ctx, camX, camY);
    drawPlayerMissiles(ctx, camX, camY);
    drawCampaignRockets(ctx, camX, camY);
    drawGrenades(ctx, camX, camY);
    drawParticles(ctx, camX, camY);
    if (game.runMode === 'campaign') {
      drawCampaignPrompts(ctx, camX, camY);
      drawCampaignSearchProgress(ctx, camX, camY);
      drawCampaignArenaBarriers(ctx, camX, camY);
    }
    drawTexts(ctx, camX, camY);
  }

  function drawEndlessBiomeOverlay(ctx) {
    if (game.runMode !== 'endless') return;
    const w = game.viewW;
    const h = game.viewH;
    const t = game.time;
    ctx.save();
    if (game.endlessBiome === 'military') {
      ctx.fillStyle = 'rgba(112, 68, 25, 0.085)';
      ctx.fillRect(0, 0, w, h);
      const entryLeft = Math.max(0, (game.biomeFxUntil || 0) - game.time);
      if (entryLeft > 0) {
        const alpha = clamp(entryLeft / 2.6, 0, 1);
        ctx.globalAlpha = 0.16 * alpha;
        ctx.strokeStyle = '#f2b45c';
        ctx.lineWidth = 1;
        for (let i = -h; i < w + h; i += 180) {
          ctx.beginPath();
          ctx.moveTo(i + (t * 8) % 180, 0);
          ctx.lineTo(i - h + (t * 8) % 180, h);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    } else if (game.endlessBiome === 'robot') {
      ctx.fillStyle = 'rgba(29, 68, 98, 0.075)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(132, 208, 255, 0.055)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 160) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 160) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(113, 205, 255, ${0.04 + Math.sin(t * 1.7) * 0.012})`;
      for (let i = 0; i < 10; i += 1) {
        const x = ((i * 247 + t * 14) % w);
        const y = ((i * 131 + 80) % h);
        ctx.fillRect(x, y, 34, 1);
        ctx.fillRect(x + 24, y - 12, 1, 13);
      }
    } else {
      ctx.fillStyle = 'rgba(44, 115, 76, 0.055)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(112, 255, 166, ${0.023 + Math.sin(t * 1.1) * 0.007})`;
      ctx.fillRect(0, h * 0.62, w, 1);
    }
    ctx.restore();
  }

  function drawScreenAtmosphere(ctx) {
    const w = game.viewW;
    const h = game.viewH;
    ctx.save();
    const vignette = ctx.createRadialGradient(w / 2, h * 0.48, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.78);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.64, 'rgba(0, 3, 6, 0.075)');
    vignette.addColorStop(1, 'rgba(0, 2, 4, 0.48)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    if (game.mode === 'menu') {
      ctx.globalCompositeOperation = 'screen';
      const sweepX = ((game.time * 42) % (w + 400)) - 200;
      const sweep = ctx.createLinearGradient(sweepX - 140, 0, sweepX + 140, 0);
      sweep.addColorStop(0, 'rgba(79, 227, 240, 0)');
      sweep.addColorStop(0.5, 'rgba(79, 227, 240, 0.018)');
      sweep.addColorStop(1, 'rgba(79, 227, 240, 0)');
      ctx.fillStyle = sweep;
      ctx.fillRect(sweepX - 140, 0, 280, h);
    }

    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 28; i += 1) {
      const speed = 3 + (i % 4) * 2.2;
      const px = ((i * 137.7 + game.time * speed) % (w + 60)) - 30;
      const py = ((i * 83.3 + Math.sin(game.time * 0.4 + i) * 24 + game.time * 0.9) % (h + 40)) - 20;
      const alpha = 0.035 + (i % 3) * 0.014;
      ctx.fillStyle = i % 7 === 0 ? `rgba(255, 214, 163, ${alpha})` : `rgba(154, 232, 235, ${alpha})`;
      ctx.fillRect(px, py, 1.2, 1.2);
    }
    ctx.restore();

    if (game.flash > 0.001) {
      ctx.fillStyle = `rgba(255, 238, 204, ${clamp(game.flash * 0.34, 0, 0.3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawReticle(ctx) {
    const p = game.player;
    if (!p || !p.alive || p.reviving || game.mode !== 'playing') return;
    if (!input.overCanvas && !input.firing && !input.firingSecondary) return;
    const stats = getWeaponStats();
    const x = input.screenX;
    const y = input.screenY;
    const gap = 7 + stats.spread * 1.2 + game.reticleBloom * 2.1;
    const length = 7 + stats.spread * 0.7;
    const alpha = input.firing ? 0.95 : 0.78;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(180, 255, 255, ${alpha})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(gap, 0);
      ctx.lineTo(gap + length, 0);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(98, 218, 226, ${alpha * 0.5})`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, gap + length + 5, 0.35, 1.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, gap + length + 5, Math.PI + 0.35, Math.PI + 1.25);
    ctx.stroke();
    ctx.fillStyle = `rgba(238, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(0, 0, 1.2, 0, TAU);
    ctx.fill();
    if (game.hitMarker > 0) {
      const n = game.killMarker > 0 ? 1 : 0;
      ctx.strokeStyle = n ? 'rgba(255, 211, 139, 0.95)' : 'rgba(240, 255, 255, 0.95)';
      ctx.lineWidth = n ? 2 : 1.4;
      const r0 = 4;
      const r1 = 9 + (n ? 2 : 0);
      for (let i = 0; i < 4; i += 1) {
        const sx = i % 2 === 0 ? -1 : 1;
        const sy = i < 2 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(sx * r0, sy * r0);
        ctx.lineTo(sx * r1, sy * r1);
        ctx.stroke();
      }
    }
    if (p.reloading) {
      const progress = 1 - p.reloadTimer / Math.max(0.001, p.reloadDuration);
      ctx.strokeStyle = 'rgba(111, 243, 252, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.stroke();
    } else if ((p.ammo[p.weapon] || 0) <= 0) {
      ctx.fillStyle = 'rgba(255, 150, 108, 0.9)';
      ctx.font = '500 8px "SFMono-Regular", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO AMMO', 0, 30);
    }
    if (hasTalent('dualWield') && p.offhandReloading) {
      const progress = 1 - p.offhandReloadTimer / Math.max(0.001, p.offhandReloadDuration);
      ctx.strokeStyle = 'rgba(255, 188, 108, 0.42)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBossDirection(ctx, camX, camY) {
    const boss = game.bossRef;
    if (!boss || boss.dead || game.mode !== 'playing') return;
    const bx = (boss.x - camX) * CAMERA_ZOOM;
    const by = (boss.y - camY) * CAMERA_ZOOM;
    const margin = 58;
    if (bx > margin && bx < game.viewW - margin && by > margin && by < game.viewH - margin) return;
    const cx = game.viewW / 2;
    const cy = game.viewH / 2;
    const dx = bx - cx;
    const dy = by - cy;
    const scale = Math.min(
      Math.abs(dx) > 1 ? (cx - margin) / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1 ? (cy - margin) / Math.abs(dy) : Infinity,
    );
    const x = cx + dx * scale;
    const y = cy + dy * scale;
    const a = Math.atan2(dy, dx);
    const pulse = 0.65 + Math.sin(game.time * 5) * 0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 94, 83, ${pulse})`;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 152, 104, ${pulse * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 11, -0.7, 0.7);
    ctx.stroke();
    ctx.restore();
  }

  function drawCampaignMinimap(c, w, h) {
    const campaign = game.campaign;
    const grid = campaign.grid;
    const level = campaign.level;
    if (!grid || !level) return;
    const cw = w / grid.cols;
    const ch = h / grid.rows;
    const accent = level.theme.accent;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#02090c';
    c.fillRect(0, 0, w, h);

    // Only explored floor cells are drawn: the unvisited layout stays dark.
    for (let r = 0; r < grid.rows; r += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const idx = r * grid.cols + col;
        if (!grid.walkable[idx] || !campaign.explored?.[idx]) continue;
        const hash = (col * 17 + r * 31) % 7;
        c.fillStyle = `rgba(${accent}, ${0.13 + hash * 0.012})`;
        c.fillRect(col * cw, r * ch, cw + 0.4, ch + 0.4);
        c.strokeStyle = `rgba(${accent}, 0.07)`;
        c.lineWidth = 0.45;
        c.strokeRect(col * cw + 0.25, r * ch + 0.25, cw - 0.5, ch - 0.5);
      }
    }

    // Explored static interactables.
    for (const item of campaign.searchables) {
      const cell = campaignCellAt(item.x, item.y);
      if (!campaign.explored?.[cell.r * grid.cols + cell.c]) continue;
      c.fillStyle = item.searched ? 'rgba(97, 117, 112, 0.45)' : 'rgba(255, 205, 123, 0.78)';
      c.fillRect(item.x / CAMPAIGN_TILE * cw - 0.8, item.y / CAMPAIGN_TILE * ch - 0.8, 1.6, 1.6);
    }
    for (const shop of campaign.shops) {
      const cell = campaignCellAt(shop.x, shop.y);
      if (!campaign.explored?.[cell.r * grid.cols + cell.c]) continue;
      c.strokeStyle = 'rgba(111, 245, 255, 0.85)';
      c.lineWidth = 1;
      c.strokeRect(shop.x / CAMPAIGN_TILE * cw - 1.8, shop.y / CAMPAIGN_TILE * ch - 1.8, 3.6, 3.6);
    }
    for (const elevator of campaign.elevators) {
      const cell = campaignCellAt(elevator.x, elevator.y);
      if (!campaign.explored?.[cell.r * grid.cols + cell.c]) continue;
      const isExit = elevator.kind === 'exit';
      c.fillStyle = isExit && !campaign.bossDefeated ? 'rgba(255, 105, 88, 0.85)' : 'rgba(127, 255, 196, 0.9)';
      c.beginPath();
      c.arc(elevator.x / CAMPAIGN_TILE * cw, elevator.y / CAMPAIGN_TILE * ch, 3.1, 0, TAU);
      c.fill();
    }

    // Enemies are only plotted while they are actually inside the current
    // circular sight radius. Explored rooms alone must not reveal hostiles.
    const p = game.player;
    const vision = campaign.visionRadius;
    for (const e of game.enemies) {
      if (e.dead || !p || dist(p.x, p.y, e.x, e.y) > vision + 35) continue;
      const x = e.x / CAMPAIGN_TILE * cw;
      const y = e.y / CAMPAIGN_TILE * ch;
      if (e.type === 'boss') {
        c.strokeStyle = 'rgba(255, 91, 79, 0.9)';
        c.fillStyle = 'rgba(255, 91, 79, 0.75)';
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(x, y, 5.8, 0, TAU);
        c.stroke();
        c.beginPath();
        c.arc(x, y, 2.2, 0, TAU);
        c.fill();
      } else if (e.type === 'elite') {
        c.fillStyle = 'rgba(217, 151, 255, 0.85)';
        c.save();
        c.translate(x, y);
        c.rotate(Math.PI / 4);
        c.fillRect(-1.8, -1.8, 3.6, 3.6);
        c.restore();
      } else {
        c.fillStyle = 'rgba(255, 138, 96, 0.8)';
        c.beginPath();
        c.arc(x, y, 1.35, 0, TAU);
        c.fill();
      }
    }

    if (p) {
      const px = p.x / CAMPAIGN_TILE * cw;
      const py = p.y / CAMPAIGN_TILE * ch;
      c.strokeStyle = `rgba(${accent}, 0.2)`;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(px, py, (vision / CAMPAIGN_TILE) * cw, 0, TAU);
      c.stroke();
      c.save();
      c.translate(px, py);
      c.rotate(p.aimAngle);
      c.fillStyle = '#8dfcff';
      c.shadowColor = 'rgba(112, 247, 255, 0.9)';
      c.shadowBlur = 7;
      c.beginPath();
      c.moveTo(5.5, 0);
      c.lineTo(-3.2, -3);
      c.lineTo(-1.4, 0);
      c.lineTo(-3.2, 3);
      c.closePath();
      c.fill();
      c.restore();
    }

    c.strokeStyle = `rgba(${accent}, 0.22)`;
    c.lineWidth = 1;
    c.strokeRect(1, 1, w - 2, h - 2);
    const sweep = (game.time * 19) % h;
    c.fillStyle = `rgba(${accent}, 0.045)`;
    c.fillRect(0, sweep, w, 1);
  }

  function drawMinimap() {
    const c = mapCtx;
    const w = 288;
    const h = 180;
    if (game.runMode === 'campaign' && game.campaign.grid) {
      drawCampaignMinimap(c, w, h);
      return;
    }
    const sx = w / WORLD.w;
    const sy = h / WORLD.h;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#041014';
    c.fillRect(0, 0, w, h);

    // Grid.
    c.strokeStyle = 'rgba(101, 202, 210, 0.08)';
    c.lineWidth = 1;
    for (let x = 0; x <= w; x += 36) {
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, h);
      c.stroke();
    }
    for (let y = 0; y <= h; y += 30) {
      c.beginPath();
      c.moveTo(0, y + 0.5);
      c.lineTo(w, y + 0.5);
      c.stroke();
    }

    // Walkable field.
    c.fillStyle = 'rgba(32, 62, 66, 0.18)';
    c.fillRect(WORLD.pad * sx, WORLD.pad * sy, (WORLD.w - WORLD.pad * 2) * sx, (WORLD.h - WORLD.pad * 2) * sy);

    // Walls.
    c.strokeStyle = 'rgba(125, 218, 223, 0.32)';
    c.lineWidth = 2;
    c.strokeRect(2, 2, w - 4, h - 4);

    // Doors.
    c.fillStyle = 'rgba(255, 130, 91, 0.6)';
    for (const d of DOORS) {
      c.fillRect(d.x * sx, d.y * sy, Math.max(2, d.w * sx), Math.max(2, d.h * sy));
    }

    // Props.
    for (const p of PROPS) {
      c.fillStyle = p.type === 'tank' || p.type === 'cryo' ? 'rgba(88, 194, 173, 0.22)' : 'rgba(108, 143, 145, 0.26)';
      c.strokeStyle = 'rgba(137, 203, 202, 0.2)';
      c.lineWidth = 0.6;
      if (p.shape === 'circle') {
        c.beginPath();
        c.arc(p.x * sx, p.y * sy, Math.max(1, p.r * sx), 0, TAU);
        c.fill();
        c.stroke();
      } else {
        c.fillRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy);
        c.strokeRect(p.x * sx, p.y * sy, p.w * sx, p.h * sy);
      }
    }

    // Camera view.
    if (game.player) {
      c.strokeStyle = 'rgba(135, 246, 255, 0.17)';
      c.lineWidth = 1;
      c.strokeRect(
        clamp(game.camera.x, 0, WORLD.w) * sx,
        clamp(game.camera.y, 0, WORLD.h) * sy,
        Math.min(game.viewW / CAMERA_ZOOM, WORLD.w) * sx,
        Math.min(game.viewH / CAMERA_ZOOM, WORLD.h) * sy,
      );
    }

    // Pickups and credits.
    c.fillStyle = 'rgba(255, 202, 108, 0.75)';
    for (const coin of game.coins) c.fillRect(coin.x * sx - 0.7, coin.y * sy - 0.7, 1.4, 1.4);

    // Enemies.
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (e.type === 'boss') {
        const pulse = 0.65 + Math.sin(game.time * 5) * 0.2;
        c.strokeStyle = `rgba(255, 94, 83, ${pulse})`;
        c.fillStyle = 'rgba(255, 94, 83, 0.85)';
        c.lineWidth = 1.4;
        c.beginPath();
        c.arc(e.x * sx, e.y * sy, 6.5, 0, TAU);
        c.stroke();
        c.beginPath();
        c.arc(e.x * sx, e.y * sy, 2.5, 0, TAU);
        c.fill();
      } else if (e.type === 'elite') {
        c.fillStyle = 'rgba(216, 151, 255, 0.9)';
        c.save();
        c.translate(e.x * sx, e.y * sy);
        c.rotate(Math.PI / 4);
        c.fillRect(-2.2, -2.2, 4.4, 4.4);
        c.restore();
      } else {
        c.fillStyle = 'rgba(255, 132, 91, 0.8)';
        c.beginPath();
        c.arc(e.x * sx, e.y * sy, 1.55, 0, TAU);
        c.fill();
      }
    }

    // Deployed turrets.
    for (const turret of game.turrets) {
      if (turret.dead || turret.hp <= 0) continue;
      c.fillStyle = 'rgba(131, 255, 209, 0.9)';
      c.fillRect(turret.x * sx - 1.5, turret.y * sy - 1.5, 3, 3);
    }

    // Player wedge.
    if (game.player) {
      const p = game.player;
      const px = p.x * sx;
      const py = p.y * sy;
      c.save();
      c.translate(px, py);
      c.rotate(p.aimAngle);
      c.fillStyle = p.reviving ? '#ffcf87' : '#8dfcff';
      c.shadowColor = p.reviving ? 'rgba(255, 200, 126, 0.8)' : 'rgba(112, 247, 255, 0.8)';
      c.shadowBlur = 8;
      c.beginPath();
      c.moveTo(6, 0);
      c.lineTo(-3.5, -3.2);
      c.lineTo(-1.5, 0);
      c.lineTo(-3.5, 3.2);
      c.closePath();
      c.fill();
      c.restore();
    }

    // Sweep line.
    const sweep = (game.time * 22) % h;
    c.fillStyle = 'rgba(127, 238, 246, 0.055)';
    c.fillRect(0, sweep, w, 1);
  }

  function render() {
    const ctx = gctx;
    const dpr = game.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, game.viewW, game.viewH);
    ctx.fillStyle = '#020508';
    ctx.fillRect(0, 0, game.viewW, game.viewH);

    let shakeX = 0;
    let shakeY = 0;
    if (game.shake > 0.04 && (game.mode === 'playing' || game.mode === 'dying')) {
      shakeX = rand(-game.shake, game.shake) * 0.55;
      shakeY = rand(-game.shake, game.shake) * 0.45;
    }
    const camX = game.camera.x + shakeX;
    const camY = game.camera.y + shakeY;

    ctx.save();
    ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);
    ctx.translate(-camX, -camY);
    if (envCanvas) ctx.drawImage(envCanvas, 0, 0, WORLD.w, WORLD.h);
    // A subtle metal rim around the world when camera outruns the map.
    ctx.strokeStyle = 'rgba(113, 186, 189, 0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WORLD.w - 2, WORLD.h - 2);
    if (game.mode !== 'menu' || game.player) drawWorld(ctx, camX, camY);
    else {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 22; i += 1) {
        const x = ((i * 347.7 + game.time * (2 + (i % 4) * 1.5)) % WORLD.w);
        const y = ((i * 191.2 + Math.sin(game.time * 0.23 + i) * 40) % WORLD.h);
        ctx.fillStyle = `rgba(147, 232, 232, ${0.035 + (i % 4) * 0.013})`;
        ctx.fillRect(x, y, 1.4, 1.4);
      }
      ctx.restore();
    }
    ctx.restore();

    drawEndlessBiomeOverlay(ctx);
    drawScreenAtmosphere(ctx);
    if (game.runMode === 'campaign' && game.player) drawCampaignVision(ctx, camX, camY);
    if (game.mode === 'playing') {
      if (game.runMode !== 'campaign') drawBossDirection(ctx, camX, camY);
      drawReticle(ctx);
    }
    if (game.player) drawMinimap();
  }

  /* ------------------------------------------------------------
     Boot
     ------------------------------------------------------------ */
  function frame(now) {
    if (document.hidden) {
      game.lastFrame = now;
      window.requestAnimationFrame(frame);
      return;
    }
    if (!game.lastFrame) game.lastFrame = now;
    const rawDt = (now - game.lastFrame) / 1000;
    game.lastFrame = now;
    const dt = clamp(rawDt, 0, 0.05);
    const fastEndless = game.mode === 'playing' && game.runMode === 'endless' && game.speedMultiplier === 2;
    game.time += dt;
    if (fastEndless) {
      updateGame(dt, false);
      if (game.mode === 'playing') {
        game.time += dt;
        updateGame(dt, true);
      } else {
        updateHUD();
      }
    } else if (game.mode === 'playing') {
      updateGame(dt);
    } else if (game.mode === 'dying') {
      updateDying(dt);
    } else if (game.mode === 'menu') {
      updateMenuScene(dt);
    } else if (game.mode === 'gameover') {
      game.shake *= Math.exp(-4 * dt);
      if (game.shake < 0.03) game.shake = 0;
    }

    Sfx.setMusicMode(desiredMusicMode());
    render();
    window.requestAnimationFrame(frame);
  }

  function mountAudioUnlock() {
    let primed = false;
    const prime = () => {
      if (primed) return;
      primed = true;
      Sfx.init();
      dom.menuAudioHint?.classList.add('is-hidden');
      window.removeEventListener('pointerdown', prime, true);
      window.removeEventListener('keydown', prime, true);
    };
    window.addEventListener('pointerdown', prime, true);
    window.addEventListener('keydown', prime, true);
  }

  function init() {
    buildEnvironment();
    buildWeaponDock();
    buildGrenadeHud();
    applyQualityClass();
    applySoundUI();
    updateCharacterTokenUI();
    reconcileCharacterRewards();
    if (isDeveloperMode()) applyDeveloperUnlocks();
    updateBestUI();
    syncDifficultyUI();
    syncMenuModeUI();
    resizeCanvas();
    bindEvents();
    mountAudioUnlock();
    startIntroSequence();
    game.camera.x = clampCameraX(690);
    game.camera.y = clampCameraY(330);
    game.camera.targetX = game.camera.x;
    game.camera.targetY = game.camera.y;
    game.lastFrame = performance.now();
    dom.hud.classList.add('is-hidden');
    dom.menu.classList.remove('is-hidden');
    dom.bossHud.classList.add('is-hidden');
    dom.intermission.classList.add('is-hidden');

    Object.assign(Debug, {
      game,
      startRun,
      startCurrentRun,
      startCampaignRun,
      startRogueRun,
      generateRogueLevel,
      openCharacters,
      openBestiary,
      useCharacterSkill,
      getCharacterDef,
      characterCreditMultiplier,
      renderBestiary,
      awardCharacterTokens,
      musicDebug: () => Sfx.musicDebug(),
      setupCampaignLevel,
      restartRun,
      returnToMenu,
      openShop,
      closeShop,
      beginWave,
      spawnEnemy,
      deployTurret,
      turretTierDef,
      turretLimit,
      turretDeployCooldown,
      grenadeMaxStock,
      grenadeDamageMultiplier,
      grenadeRadiusMultiplier,
      completeWave,
      finishGameOver,
      hurtPlayer,
      damageEnemy,
      killEnemy,
      countRemainingEnemies,
      updateHUD,
      setWeapon,
      addToast,
      obstacles: OBSTACLES,
      isPositionBlocked,
      getNavDirection,
      navFields,
      moveCircle,
      showBanner,
      showCampaignComplete,
      startCampaignBossFight,
      spawnCampaignBoss,
      startStoryMode,
      startStoryCombat,
      renderStoryBeat,
      advanceStory,
      tryCampaignInteract,
      searchCampaignObject,
      skipIntro: finishIntro,
    });
    window.LabZero = Debug;
    window.requestAnimationFrame(frame);
  }

  init();
})();



