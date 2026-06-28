(() => {
  'use strict';

  // ===== 定数 =====
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_COLOR = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };
  const RANK_LABELS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const RANK_NAMES_JA = {
    'high':       'ノーハンド（役なし）',
    'pair':       'ワンペア',
    'twopair':    'ツーペア',
    'three':      'スリーカード',
    'straight':   'ストレート',
    'flush':      'フラッシュ',
    'fullhouse':  'フルハウス',
    'four':       'フォーカード',
    'straightflush': 'ストレートフラッシュ',
    'royal':      'ロイヤルストレートフラッシュ',
  };
  const RANK_RANK = {
    'high': 0, 'pair': 1, 'twopair': 2, 'three': 3,
    'straight': 4, 'flush': 5, 'fullhouse': 6,
    'four': 7, 'straightflush': 8, 'royal': 9,
  };

  const LEVEL_HINTS = [
    '',
    'はじめてさん',
    'すこし弱い',
    'ふつう',
    'すこし強い',
    'さいきょう',
  ];

  // ===== 効果音 =====
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
      try { localStorage.setItem('poker_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('poker_sound');
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
    deal()  { this.tone(880, 0.06, 'triangle', 0.10, 1320); },
    flip()  { this.tone(660, 0.08, 'sine', 0.10, 1100); },
    click() { this.tone(1100, 0.06, 'triangle', 0.08, 1500); },
    win()   {
      const notes = [659, 784, 988, 1319];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'triangle', 0.16), i * 110));
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 480);
    },
    lose()  {
      const notes = [659, 523, 440];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.28, 'triangle', 0.13, f * 0.8), i * 160));
    },
    draw()  {
      this.tone(660, 0.18, 'triangle', 0.13);
      setTimeout(() => this.tone(880, 0.22, 'triangle', 0.13), 180);
    },
  };

  // ===== ゲーム状態 =====
  const state = {
    level: 3,
    deck: [],
    handMe: [],
    handCpu: [],
    discardSet: new Set(),
    phase: 'idle',         // 'draw' | 'showdown' | 'between'
    busy: false,
    revealCpu: false,
    meCommitted: false,
  };

  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $('screen-title'),
    game: $('screen-game'),
    result: $('screen-result'),
  };
  const meHandEl = $('me-hand');
  const cpuHandEl = $('cpu-hand');
  const messageEl = $('message');
  const actionsEl = $('actions');
  const meRankEl = $('me-rank-display');
  const cpuRankEl = $('cpu-rank-display');
  const cpuLabelEl = $('cpu-hand-label');

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== カード/デッキ =====
  function buildDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 13; r++) {
        d.push({ rank: r, suit: SUITS[s] });
      }
    }
    return d;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function draw(deck, n) { return deck.splice(0, n); }

  // ===== 役判定 =====
  function evaluateHand(hand) {
    const ranks = hand.map(c => c.rank).sort((a,b) => b-a);
    const suits = hand.map(c => c.suit);
    const counts = {};
    ranks.forEach(r => counts[r] = (counts[r] || 0) + 1);
    const groups = Object.entries(counts)
      .map(([r, n]) => ({ r: parseInt(r,10), n }))
      .sort((a,b) => b.n - a.n || b.r - a.r);

    const isFlush = suits.every(s => s === suits[0]);
    let isStraight = false;
    let straightHigh = -1;
    const uniqRanks = [...new Set(ranks)];
    if (uniqRanks.length === 5) {
      const high = uniqRanks[0];
      const low = uniqRanks[4];
      if (high - low === 4) { isStraight = true; straightHigh = high; }
      if (uniqRanks[0] === 12 && uniqRanks[1] === 3 && uniqRanks[2] === 2
          && uniqRanks[3] === 1 && uniqRanks[4] === 0) {
        isStraight = true; straightHigh = 3;
      }
    }
    if (isStraight && isFlush) {
      if (straightHigh === 12) return { type: 'royal', score: [12] };
      return { type: 'straightflush', score: [straightHigh] };
    }
    if (groups[0].n === 4) return { type: 'four', score: [groups[0].r, groups[1].r] };
    if (groups[0].n === 3 && groups[1].n === 2)
      return { type: 'fullhouse', score: [groups[0].r, groups[1].r] };
    if (isFlush) return { type: 'flush', score: ranks };
    if (isStraight) return { type: 'straight', score: [straightHigh] };
    if (groups[0].n === 3) {
      const kickers = groups.slice(1).map(g => g.r);
      return { type: 'three', score: [groups[0].r, ...kickers] };
    }
    if (groups[0].n === 2 && groups[1].n === 2) {
      const p1 = Math.max(groups[0].r, groups[1].r);
      const p2 = Math.min(groups[0].r, groups[1].r);
      return { type: 'twopair', score: [p1, p2, groups[2].r] };
    }
    if (groups[0].n === 2) {
      const kickers = groups.slice(1).map(g => g.r);
      return { type: 'pair', score: [groups[0].r, ...kickers] };
    }
    return { type: 'high', score: ranks };
  }

  function compareHands(a, b) {
    const ra = RANK_RANK[a.type];
    const rb = RANK_RANK[b.type];
    if (ra !== rb) return ra - rb;
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
      const va = a.score[i] || 0;
      const vb = b.score[i] || 0;
      if (va !== vb) return va - vb;
    }
    return 0;
  }

  function rankNameJa(ev) { return RANK_NAMES_JA[ev.type] || ''; }

  // ===== 描画 =====
  function makeCardEl(card, faceDown = false) {
    const el = document.createElement('div');
    el.className = 'card';
    if (faceDown) {
      el.classList.add('back');
      return el;
    }
    el.classList.add(SUIT_COLOR[card.suit]);
    const rankEl = document.createElement('div');
    rankEl.className = 'card-rank';
    rankEl.textContent = RANK_LABELS[card.rank];
    const suitEl = document.createElement('div');
    suitEl.className = 'card-suit';
    suitEl.textContent = card.suit;
    el.appendChild(rankEl);
    el.appendChild(suitEl);
    return el;
  }

  function renderHands() {
    meHandEl.innerHTML = '';
    state.handMe.forEach((c, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'card-wrap';
      const el = makeCardEl(c, false);
      if (state.phase === 'draw') {
        el.classList.add('clickable');
        if (state.discardSet.has(i)) wrap.classList.add('discard');
        wrap.addEventListener('click', () => toggleDiscard(i));
      }
      wrap.appendChild(el);
      meHandEl.appendChild(wrap);
    });

    cpuHandEl.innerHTML = '';
    state.handCpu.forEach((c) => {
      const faceDown = !state.revealCpu;
      const el = makeCardEl(c, faceDown);
      cpuHandEl.appendChild(el);
    });
  }

  function renderRanks() {
    if (state.meCommitted && state.handMe.length === 5) {
      const ev = evaluateHand(state.handMe);
      meRankEl.textContent = rankNameJa(ev);
    } else {
      meRankEl.textContent = '';
    }
    if (state.revealCpu && state.handCpu.length === 5) {
      const ev = evaluateHand(state.handCpu);
      cpuRankEl.textContent = rankNameJa(ev);
    } else {
      cpuRankEl.textContent = '';
    }
  }

  function setMessage(text) { messageEl.textContent = text || ''; }

  function clearActions() { actionsEl.innerHTML = ''; }
  function addAction(label, cls, onClick, disabled = false) {
    const btn = document.createElement('button');
    btn.className = `btn ${cls || ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', () => {
      if (state.busy) return;
      sound.click();
      onClick();
    });
    actionsEl.appendChild(btn);
    return btn;
  }

  function refresh() {
    renderHands();
    renderRanks();
  }

  // ===== ラウンド進行 =====
  function startRound() {
    state.deck = shuffle(buildDeck());
    state.handMe = draw(state.deck, 5);
    state.handCpu = draw(state.deck, 5);
    state.discardSet = new Set();
    state.revealCpu = false;
    state.meCommitted = false;
    state.phase = 'draw';
    state.busy = false;
    setMessage('捨てるカードを選んでね♪');
    sound.deal();
    refresh();
    renderDrawActions();
  }

  function toggleDiscard(idx) {
    if (state.phase !== 'draw' || state.busy) return;
    if (state.discardSet.has(idx)) state.discardSet.delete(idx);
    else state.discardSet.add(idx);
    sound.flip();
    refresh();
  }

  function renderDrawActions() {
    clearActions();
    addAction('捨てる', 'btn-primary', () => commitDraw());
    addAction('そのまま', '', () => { state.discardSet.clear(); commitDraw(); });
  }

  function commitDraw() {
    state.busy = true;
    const indices = Array.from(state.discardSet).sort((a,b)=>a-b);
    const newCards = draw(state.deck, indices.length);
    indices.forEach((i, k) => { state.handMe[i] = newCards[k]; });
    state.discardSet = new Set();
    state.meCommitted = true;
    sound.deal();
    setMessage('CPUが捨てるカードを選んでいるよ…');
    refresh();
    clearActions();

    setTimeout(() => {
      cpuDiscardAndDraw();
      sound.deal();
      refresh();
      setTimeout(() => showdown(), 700);
    }, 800);
  }

  // ===== CPUの交換ロジック =====
  function cpuDiscardAndDraw() {
    const lvl = state.level;
    let discardIdx;
    if (lvl === 1) {
      const n = Math.floor(Math.random() * 4);
      const all = [0,1,2,3,4];
      shuffle(all);
      discardIdx = all.slice(0, n);
    } else {
      discardIdx = optimalDiscard(state.handCpu, lvl);
    }
    const newCards = draw(state.deck, discardIdx.length);
    discardIdx.forEach((i, k) => { state.handCpu[i] = newCards[k]; });
  }

  function optimalDiscard(hand, lvl) {
    if (lvl === 2) {
      const counts = {};
      hand.forEach(c => counts[c.rank] = (counts[c.rank]||0)+1);
      const keep = hand.map((c) => counts[c.rank] >= 2);
      if (!keep.some(k => k)) {
        return hand.map((c, i) => c.rank >= 10 ? -1 : i).filter(i => i >= 0);
      }
      return hand.map((_, i) => keep[i] ? -1 : i).filter(i => i >= 0);
    }
    const trials = lvl === 3 ? 80 : (lvl === 4 ? 200 : 400);
    let bestMask = 0;
    let bestEv = -Infinity;
    for (let mask = 0; mask < 32; mask++) {
      const keepIdx = [];
      const discIdx = [];
      for (let i = 0; i < 5; i++) {
        if (mask & (1<<i)) keepIdx.push(i);
        else discIdx.push(i);
      }
      const ev = simulateMask(hand, keepIdx, discIdx, trials);
      if (ev > bestEv) { bestEv = ev; bestMask = mask; }
    }
    const result = [];
    for (let i = 0; i < 5; i++) if (!(bestMask & (1<<i))) result.push(i);
    return result;
  }

  function simulateMask(hand, keepIdx, discIdx, trials) {
    if (discIdx.length === 0) return handStrengthScore(evaluateHand(hand));
    const used = new Set(hand.map(c => c.rank * 4 + SUITS.indexOf(c.suit)));
    const remaining = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 13; r++) {
        const id = r * 4 + s;
        if (!used.has(id)) remaining.push({ rank: r, suit: SUITS[s] });
      }
    }
    let total = 0;
    for (let t = 0; t < trials; t++) {
      const pool = remaining.slice();
      for (let i = 0; i < discIdx.length; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const newHand = hand.slice();
      discIdx.forEach((idx, k) => { newHand[idx] = pool[k]; });
      total += handStrengthScore(evaluateHand(newHand));
    }
    return total / trials;
  }

  function handStrengthScore(ev) {
    let s = RANK_RANK[ev.type] * 1000000;
    let mult = 10000;
    for (const v of ev.score) {
      s += v * mult;
      mult /= 13;
    }
    return s;
  }

  // ===== ショーダウン =====
  function showdown() {
    state.phase = 'showdown';
    state.busy = true;
    state.revealCpu = true;
    refresh();

    const evMe = evaluateHand(state.handMe);
    const evCpu = evaluateHand(state.handCpu);
    const cmp = compareHands(evMe, evCpu);

    let outcome, title;
    if (cmp > 0) {
      title = `あなたの勝ち♥`;
      outcome = 'win';
    } else if (cmp < 0) {
      title = `CPUの勝ち…`;
      outcome = 'lose';
    } else {
      title = `引き分け`;
      outcome = 'draw';
    }
    setMessage(title);

    if (outcome === 'win') sound.win();
    else if (outcome === 'lose') sound.lose();
    else sound.draw();

    setTimeout(() => goToResult(outcome, evMe, evCpu), 4400);
  }

  // ===== 結果画面 =====
  function goToResult(outcome, evMe, evCpu) {
    let title;
    if (outcome === 'win') title = 'あなたの勝ち♥';
    else if (outcome === 'lose') title = 'CPUの勝ち…';
    else title = '引き分け';
    $('result-title').textContent = title;

    const meHand = $('result-me-hand');
    const cpuHand = $('result-cpu-hand');
    meHand.innerHTML = '';
    cpuHand.innerHTML = '';
    state.handMe.forEach(c => meHand.appendChild(makeCardEl(c, false)));
    state.handCpu.forEach(c => cpuHand.appendChild(makeCardEl(c, false)));
    $('result-me-rank').textContent = rankNameJa(evMe);
    $('result-cpu-rank').textContent = rankNameJa(evCpu);

    showScreen('result');
  }

  function newGame() {
    cpuLabelEl.textContent = `CPU(Lv${state.level})の手札`;
    showScreen('game');
    startRound();
  }

  function setupTitleUI() {
    const slider = $('level-slider');
    const display = $('level-display');
    const hint = $('level-hint');
    const updateLevel = (v) => {
      state.level = parseInt(v, 10);
      display.textContent = state.level;
      hint.textContent = LEVEL_HINTS[state.level] || '';
    };
    slider.addEventListener('input', (e) => updateLevel(e.target.value));
    slider.addEventListener('change', () => sound.click());
    updateLevel(slider.value);

    $('btn-start').addEventListener('click', () => {
      sound.click();
      newGame();
    });

    const soundToggle = $('sound-toggle');
    soundToggle.checked = sound.enabled;
    soundToggle.addEventListener('change', () => {
      sound.setEnabled(soundToggle.checked);
      if (soundToggle.checked) sound.click();
    });
  }

  function setupGameUI() {
    $('btn-back').addEventListener('click', () => {
      sound.click();
      showScreen('title');
    });
  }

  function setupResultUI() {
    $('btn-replay').addEventListener('click', () => {
      sound.click();
      newGame();
    });
    $('btn-result-back').addEventListener('click', () => {
      sound.click();
      showScreen('title');
    });
  }

  function setupAudioUnlock() {
    const unlock = () => { sound.init(); sound.resume(); };
    document.addEventListener('pointerdown', unlock, { once: false });
    document.addEventListener('touchstart', unlock, { once: false });
    document.addEventListener('keydown', unlock, { once: false });
  }

  function init() {
    sound.loadPref();
    setupAudioUnlock();
    setupTitleUI();
    setupGameUI();
    setupResultUI();
  }

  init();
})();
