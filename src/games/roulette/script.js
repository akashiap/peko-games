(() => {
  'use strict';

  // ===== 話題プール =====
  const TOPICS = [
    '最近ハマっていること',
    'もし1億円もらったら',
    '子どものころのゆめ',
    '無人島に持っていく3つ',
    '最近みた映画やドラマ',
    'すきな食べものトップ3',
    '行ってみたい場所',
    '人生で一番の失敗談',
    'もう一度行きたい旅行先',
    'そんけいする人',
    '最近わらったこと',
    '10年後の自分は何してる？',
    'リフレッシュ方法',
    '今いちばんほしいもの',
    'マイブーム',
    'すきな季節とその理由',
    'はじめてのアルバイト',
    '思い出にのこる先生',
    '休日の過ごしかた',
    'もう一度食べたい給食',
  ];

  const REEL_ITEM_HEIGHT = 88;

  // ===== 効果音（Web Audio API） =====
  const sound = {
    ctx: null,
    enabled: true,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    },
    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    setEnabled(on) {
      this.enabled = !!on;
      try { localStorage.setItem('roulette_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('roulette_sound');
        if (v !== null) this.enabled = v === '1';
      } catch (e) {}
    },
    tone(freq, dur, type = 'sine', gain = 0.18, freqEnd = null) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    spin() { this.tone(420, 0.08, 'square', 0.06); },
    stop() { this.tone(660, 0.12, 'triangle', 0.16, 330); },
    cheer() {
      this.tone(523, 0.1, 'triangle', 0.18);
      setTimeout(() => this.tone(659, 0.1, 'triangle', 0.18), 110);
      setTimeout(() => this.tone(784, 0.18, 'triangle', 0.2), 220);
    },
    click() { this.tone(880, 0.04, 'square', 0.08); },
  };

  // ===== 状態 =====
  const state = {
    spinning: false,
    raf: null,
    spinTimer: null,
    result: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $('#' + id).classList.add('active');
  }

  function rand(n) { return Math.floor(Math.random() * n); }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ===== タイトル画面 =====
  function setupTitle() {
    $('#btn-start').addEventListener('click', () => {
      sound.init(); sound.resume(); sound.click();
      startTurn();
    });

    const soundToggle = $('#sound-toggle');
    sound.loadPref();
    soundToggle.checked = sound.enabled;
    soundToggle.addEventListener('change', () => {
      sound.setEnabled(soundToggle.checked);
      sound.init(); sound.resume();
    });
  }

  // ===== ゲーム画面 =====
  function startTurn() {
    state.spinning = false;
    state.result = null;
    stopReelAnimation();

    const reel = $('#reel-0');
    reel.classList.remove('locked', 'spinning');
    const strip = reel.querySelector('.reel-strip');
    strip.style.transform = 'translateY(0)';
    strip.innerHTML = '<div class="reel-item">？？？</div>';

    updateTurnIndicator();
    setMessage('スタートをおして、ドラムをまわそう！');
    $('#btn-spin').textContent = 'スタート';
    $('#btn-spin').disabled = false;
    showScreen('screen-game');
  }

  function updateTurnIndicator() {
    const ind = $('#turn-indicator');
    ind.textContent = 'みんなでおはなしするわだい';
    if (state.spinning) {
      ind.classList.add('spinning');
    } else {
      ind.classList.remove('spinning');
    }
  }

  function setMessage(msg) {
    $('#message').textContent = msg;
  }

  function buildSpinStrip(finalIndex) {
    const items = [];
    const repeat = 6;
    for (let r = 0; r < repeat; r++) {
      for (let i = 0; i < TOPICS.length; i++) {
        items.push(TOPICS[i]);
      }
    }
    items.push(TOPICS[finalIndex]);
    return items;
  }

  function startReelSpin() {
    if (state.spinning || state.result !== null) return;

    const reel = $('#reel-0');
    const strip = reel.querySelector('.reel-strip');

    const finalIndex = rand(TOPICS.length);
    const items = buildSpinStrip(finalIndex);
    strip.innerHTML = items.map((t) => `<div class="reel-item">${escapeHtml(t)}</div>`).join('');

    state.result = TOPICS[finalIndex];
    state.spinning = true;
    reel.classList.add('spinning');

    const loopHeight = TOPICS.length * REEL_ITEM_HEIGHT;
    let y = 0;
    const speed = 1400;
    let last = performance.now();

    function frame(now) {
      if (!state.spinning) return;
      const dt = (now - last) / 1000;
      last = now;
      y -= speed * dt;
      while (y <= -loopHeight) y += loopHeight;
      strip.style.transform = `translateY(${y}px)`;
      state.raf = requestAnimationFrame(frame);
    }
    last = performance.now();
    state.raf = requestAnimationFrame(frame);

    state.spinTimer = setInterval(() => sound.spin(), 80);

    updateTurnIndicator();
    setMessage('ぐるぐる…');
    $('#btn-spin').textContent = 'ストップ！';
    $('#btn-spin').disabled = false;
  }

  function stopReelAnimation() {
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = null;
    }
    if (state.spinTimer) {
      clearInterval(state.spinTimer);
      state.spinTimer = null;
    }
  }

  function stopReel(onDone) {
    if (!state.spinning) return;
    stopReelAnimation();
    state.spinning = false;

    const reel = $('#reel-0');
    const strip = reel.querySelector('.reel-strip');
    reel.classList.remove('spinning');

    const m = strip.style.transform.match(/translateY\(([-\d.]+)px\)/);
    const currentY = m ? parseFloat(m[1]) : 0;

    const totalItems = strip.children.length;
    const finalY = -(totalItems - 1) * REEL_ITEM_HEIGHT;

    const loopHeight = TOPICS.length * REEL_ITEM_HEIGHT;
    let normY = currentY;
    while (normY > 0) normY -= loopHeight;
    while (normY <= -loopHeight) normY += loopHeight;
    let delta = finalY - normY;
    while (delta > 0) delta -= loopHeight;
    if (delta > -loopHeight * 0.6) delta -= loopHeight;

    const startY = normY;
    const endY = normY + delta;
    const duration = 900;
    const t0 = performance.now();

    function ease(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(now) {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      const y = startY + (endY - startY) * e;
      strip.style.transform = `translateY(${y}px)`;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        reel.classList.add('locked');
        sound.stop();
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(frame);

    updateTurnIndicator();
    setMessage('…');
    $('#btn-spin').disabled = true;
  }

  function onSpinButton() {
    sound.init(); sound.resume();

    if (!state.spinning && state.result === null) {
      startReelSpin();
    } else if (state.spinning) {
      stopReel(() => {
        setTimeout(() => {
          showResult();
        }, 400);
      });
    }
  }

  function showResult() {
    sound.cheer();
    $('#result-topic').textContent = state.result;
    const comments = [
      'みんなで話してみよう！',
      'どんな話がきけるかな？',
      'ゆっくり聞いてみよう♪',
      'おもしろそう！',
      'みんなで盛り上がろう♥',
    ];
    $('#result-comment').textContent = comments[rand(comments.length)];
    showScreen('screen-result');
  }

  // ===== 初期化 =====
  function init() {
    sound.loadPref();
    setupTitle();

    $('#btn-spin').addEventListener('click', onSpinButton);

    $('#btn-back').addEventListener('click', () => {
      sound.click();
      stopReelAnimation();
      showScreen('screen-title');
    });

    $('#btn-next').addEventListener('click', () => {
      sound.click();
      startTurn();
    });

    $('#btn-result-back').addEventListener('click', () => {
      sound.click();
      showScreen('screen-title');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
