(() => {
  'use strict';

  // ===== カードに使う絵柄（最大15ペア） =====
  const SYMBOLS = [
    '🌸', '🍓', '🎀', '🍰', '🐰', '⭐',
    '💖', '🍎', '🌈', '🎈', '🦋', '🍒',
    '🌷', '🐱', '🍩'
  ];

  // ===== レベル定義 =====
  const LEVELS = {
    easy:    { cols: 4, rows: 3, label: 'かんたん' },
    normal:  { cols: 4, rows: 4, label: 'ふつう' },
    hard:    { cols: 5, rows: 4, label: 'むずかしい' },
    extreme: { cols: 6, rows: 5, label: 'とくべつ' },
  };

  // ===== 効果音（Web Audio API） =====
  const sound = {
    ctx: null,
    enabled: true,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        this.ctx = null;
      }
    },
    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },
    setEnabled(on) {
      this.enabled = !!on;
      try { localStorage.setItem('memory_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('memory_sound');
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
      g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    flip() {
      // めくる音「ぴこっ」
      this.tone(880, 0.08, 'triangle', 0.14, 1320);
    },
    match() {
      // 一致「きらきら♪」
      this.tone(988, 0.10, 'triangle', 0.14, 1319);
      setTimeout(() => this.tone(1319, 0.14, 'triangle', 0.13, 1760), 90);
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 200);
    },
    miss() {
      // 不一致「ぽよん」
      this.tone(440, 0.14, 'sine', 0.12, 280);
    },
    win() {
      // クリア：ファンファーレ
      const notes = [659, 784, 988, 1319];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'triangle', 0.16), i * 110));
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 480);
    },
    lose() {
      const notes = [440, 392, 349, 294];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'sine', 0.13), i * 130));
    },
  };

  // ===== ゲーム状態 =====
  const state = {
    mode: 'solo',         // 'solo' | 'pvp'
    level: 'normal',
    cols: 4,
    rows: 4,
    cards: [],            // {id, symbol, matched, revealed}
    first: null,          // 1枚目のカード index
    locked: false,        // めくり中の入力ロック
    moves: 0,             // ひとり用：めくった回数（ペア単位）
    startTime: 0,
    elapsed: 0,
    timerId: null,
    matchedCount: 0,
    totalPairs: 0,
    turn: 0,              // pvp: 0 or 1
    scores: [0, 0],
  };

  // ===== ユーティリティ =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#' + id).classList.add('active');
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== 盤面の準備 =====
  function buildBoard() {
    const lv = LEVELS[state.level];
    state.cols = lv.cols;
    state.rows = lv.rows;
    const total = lv.cols * lv.rows;
    state.totalPairs = total / 2;

    const symbols = SYMBOLS.slice(0, state.totalPairs);
    const deck = shuffle([...symbols, ...symbols].map((sym, idx) => ({
      id: idx,
      symbol: sym,
      matched: false,
      revealed: false,
    })));
    state.cards = deck;

    const board = $('#board');
    board.style.setProperty('--cols', lv.cols);
    board.style.setProperty('--rows', lv.rows);
    board.innerHTML = '';

    deck.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.idx = i;
      el.innerHTML = `
        <div class="card-inner">
          <div class="card-face card-back"></div>
          <div class="card-face card-front"><span class="card-symbol">${card.symbol}</span></div>
        </div>
      `;
      el.addEventListener('click', onCardClick);
      board.appendChild(el);
    });
  }

  function resetGameState() {
    state.first = null;
    state.locked = false;
    state.moves = 0;
    state.matchedCount = 0;
    state.elapsed = 0;
    state.turn = 0;
    state.scores = [0, 0];
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  // ===== ゲーム開始 =====
  function startGame() {
    resetGameState();
    buildBoard();
    setupHeader();
    state.startTime = Date.now();
    if (state.mode === 'solo') {
      state.timerId = setInterval(updateMessage, 500);
    }
    updateMessage();
    showScreen('screen-game');
  }

  function setupHeader() {
    const labelP1 = $('#label-p1');
    const labelP2 = $('#label-p2');
    const infoP1 = $('#info-p1');
    const infoP2 = $('#info-p2');
    if (state.mode === 'solo') {
      labelP1.textContent = 'めくり';
      labelP2.textContent = 'ペア';
      $('#count-p1').textContent = '0';
      $('#count-p2').textContent = `0 / ${state.totalPairs}`;
      infoP1.classList.remove('active');
      infoP2.classList.remove('active');
    } else {
      labelP1.textContent = '1P';
      labelP2.textContent = '2P';
      $('#count-p1').textContent = '0';
      $('#count-p2').textContent = '0';
      updateActivePlayer();
    }
  }

  function updateActivePlayer() {
    const infoP1 = $('#info-p1');
    const infoP2 = $('#info-p2');
    if (state.mode !== 'pvp') {
      infoP1.classList.remove('active');
      infoP2.classList.remove('active');
      return;
    }
    infoP1.classList.toggle('active', state.turn === 0);
    infoP2.classList.toggle('active', state.turn === 1);
  }

  function updateMessage() {
    const msg = $('#message');
    const turn = $('#turn-indicator');
    if (state.mode === 'solo') {
      const sec = Math.floor((Date.now() - state.startTime) / 1000);
      state.elapsed = sec;
      turn.textContent = `タイム ${formatTime(sec)}`;
      $('#count-p1').textContent = state.moves;
      $('#count-p2').textContent = `${state.matchedCount} / ${state.totalPairs}`;
      msg.textContent = state.matchedCount === 0
        ? '同じ絵柄をさがしてね♪'
        : (state.matchedCount === state.totalPairs ? 'クリア！' : '');
    } else {
      turn.textContent = state.turn === 0 ? '1Pの番' : '2Pの番';
      $('#count-p1').textContent = state.scores[0];
      $('#count-p2').textContent = state.scores[1];
      msg.textContent = '';
    }
  }

  // ===== カードめくり =====
  function onCardClick(ev) {
    sound.init();
    sound.resume();
    const el = ev.currentTarget;
    const idx = Number(el.dataset.idx);
    const card = state.cards[idx];
    if (state.locked) return;
    if (card.matched || card.revealed) return;

    revealCard(idx);
    sound.flip();

    if (state.first === null) {
      state.first = idx;
      return;
    }
    if (state.first === idx) return;

    // 2枚目
    state.locked = true;
    if (state.mode === 'solo') {
      state.moves += 1;
    }
    const a = state.cards[state.first];
    const b = state.cards[idx];
    if (a.symbol === b.symbol) {
      // 一致
      setTimeout(() => {
        markMatched(state.first);
        markMatched(idx);
        state.matchedCount += 1;
        if (state.mode === 'pvp') state.scores[state.turn] += 1;
        sound.match();
        state.first = null;
        state.locked = false;
        updateMessage();
        if (state.mode === 'pvp') updateMessage();
        if (state.matchedCount === state.totalPairs) {
          finishGame();
        }
      }, 280);
    } else {
      // 不一致
      const i1 = state.first, i2 = idx;
      setTimeout(() => {
        sound.miss();
        addShake(i1);
        addShake(i2);
      }, 500);
      setTimeout(() => {
        hideCard(i1);
        hideCard(i2);
        removeShake(i1);
        removeShake(i2);
        state.first = null;
        state.locked = false;
        if (state.mode === 'pvp') {
          state.turn = 1 - state.turn;
          updateActivePlayer();
        }
        updateMessage();
      }, 1100);
    }
  }

  function cardEl(idx) {
    return document.querySelector(`.card[data-idx="${idx}"]`);
  }

  function revealCard(idx) {
    state.cards[idx].revealed = true;
    cardEl(idx).classList.add('revealed');
  }
  function hideCard(idx) {
    state.cards[idx].revealed = false;
    cardEl(idx).classList.remove('revealed');
  }
  function markMatched(idx) {
    state.cards[idx].matched = true;
    const el = cardEl(idx);
    el.classList.add('matched');
    el.classList.add('locked');
  }
  function addShake(idx) { cardEl(idx).classList.add('shake'); }
  function removeShake(idx) { cardEl(idx).classList.remove('shake'); }

  // ===== 終局 =====
  function finishGame() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    setTimeout(() => {
      sound.win();
      showResult();
    }, 600);
  }

  function showResult() {
    const body = $('#result-body');
    const title = $('#result-title');
    if (state.mode === 'solo') {
      title.textContent = 'クリア！';
      body.innerHTML = `
        <div class="result-row"><span>タイム</span><strong>${formatTime(state.elapsed)}</strong></div>
        <div class="result-row"><span>めくり回数</span><strong>${state.moves} 回</strong></div>
        <div class="result-row"><span>むずかしさ</span><strong>${LEVELS[state.level].label}</strong></div>
      `;
    } else {
      const [a, b] = state.scores;
      let resultText;
      if (a > b) resultText = '1Pのかち！';
      else if (b > a) resultText = '2Pのかち！';
      else resultText = 'ひきわけ';
      title.textContent = resultText;
      body.className = 'result-counts';
      body.innerHTML = `
        <div class="result-vs">
          <div class="result-side ${a > b ? 'winner' : ''}">
            <span class="player-mark mark-p1">♥</span>
            <span class="player-label">1P</span>
            <span class="result-num">${a}</span>
          </div>
          <div class="result-side ${b > a ? 'winner' : ''}">
            <span class="player-mark mark-p2">♣</span>
            <span class="player-label">2P</span>
            <span class="result-num">${b}</span>
          </div>
        </div>
      `;
    }
    showScreen('screen-result');
  }

  // ===== タイトル画面のイベント =====
  function bindTitle() {
    $$('.mode-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.mode-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        state.mode = b.dataset.mode;
      });
    });
    $$('.level-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.level-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        state.level = b.dataset.level;
        $('#level-label').textContent = LEVELS[state.level].label;
      });
    });

    $('#btn-start').addEventListener('click', () => {
      sound.init();
      sound.resume();
      startGame();
    });

    const soundToggle = $('#sound-toggle');
    sound.loadPref();
    soundToggle.checked = sound.enabled;
    soundToggle.addEventListener('change', () => {
      sound.setEnabled(soundToggle.checked);
    });
  }

  function bindGame() {
    $('#btn-reset').addEventListener('click', () => {
      startGame();
    });
    $('#btn-back').addEventListener('click', () => {
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
      showScreen('screen-title');
    });
  }

  function bindResult() {
    $('#btn-replay').addEventListener('click', () => {
      startGame();
    });
    $('#btn-result-back').addEventListener('click', () => {
      showScreen('screen-title');
    });
  }

  // ===== 起動 =====
  document.addEventListener('DOMContentLoaded', () => {
    bindTitle();
    bindGame();
    bindResult();
  });
})();
