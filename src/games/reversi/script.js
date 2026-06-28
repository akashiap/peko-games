(() => {
  'use strict';

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const SIZE = 8;
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1],
  ];

  // 位置評価テーブル（中・強AIで使用）
  const POSITION_WEIGHTS = [
    [ 120, -20,  20,   5,   5,  20, -20, 120],
    [ -20, -40,  -5,  -5,  -5,  -5, -40, -20],
    [  20,  -5,  15,   3,   3,  15,  -5,  20],
    [   5,  -5,   3,   3,   3,   3,  -5,   5],
    [   5,  -5,   3,   3,   3,   3,  -5,   5],
    [  20,  -5,  15,   3,   3,  15,  -5,  20],
    [ -20, -40,  -5,  -5,  -5,  -5, -40, -20],
    [ 120, -20,  20,   5,   5,  20, -20, 120],
  ];

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
      try { localStorage.setItem('reversi_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('reversi_sound');
        if (v !== null) this.enabled = v === '1';
      } catch (e) {}
    },
    // 単音を鳴らす（周波数・長さ・波形・音量・周波数の終点）
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
    // 短いノイズバースト（打音用）
    noise(dur, gain = 0.12, hp = 800) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = hp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },
    // ===== 効果音プリセット（やわらかく可愛い音色） =====
    place() {
      // 「ぽこっ」：木琴っぽい丸い音
      this.tone(880, 0.12, 'triangle', 0.16, 440);
      this.tone(1320, 0.08, 'sine', 0.08, 880);
    },
    flip(index = 0) {
      // 反転：「ぴこ♪」キラキラ上昇
      const base = 880 + index * 110;
      this.tone(base, 0.09, 'triangle', 0.09, base * 1.4);
    },
    pass() {
      // 「ぽよ〜ん」
      this.tone(660, 0.16, 'sine', 0.13, 880);
      setTimeout(() => this.tone(880, 0.18, 'triangle', 0.12, 660), 140);
    },
    win() {
      // ファンファーレ：C E G C (高め)
      const notes = [659, 784, 988, 1319];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'triangle', 0.16), i * 110));
      // キラッ
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 480);
    },
    lose() {
      // しょんぼり：A F D
      const notes = [659, 523, 440];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.28, 'triangle', 0.13, f * 0.8), i * 160));
    },
    draw() {
      // とんとん♪
      this.tone(660, 0.18, 'triangle', 0.13);
      setTimeout(() => this.tone(880, 0.22, 'triangle', 0.13), 180);
    },
    click() {
      // 「ぴょ」やさしいクリック
      this.tone(1100, 0.06, 'triangle', 0.08, 1500);
    },
  };

  // ===== ゲーム状態 =====
  const state = {
    board: null,
    turn: BLACK,
    mode: 'pvp',           // 'pvp' | 'cpu'
    level: 3,              // 1〜10
    playerOrder: 'first',  // 'first'（プレイヤー=黒）| 'second'（プレイヤー=白）
    aiColor: WHITE,
    busy: false,
    gameOver: false,
  };

  const LEVEL_HINTS = [
    '',
    'はじめてさん',
    'とても弱い',
    '弱い',
    'すこし弱い',
    'ふつう',
    'すこし強い',
    '強い',
    'とても強い',
    'かなり強い',
    'さいきょう',
  ];

  // ===== DOM参照 =====
  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $('screen-title'),
    game: $('screen-game'),
    result: $('screen-result'),
  };
  const boardEl = $('board');
  const turnIndicator = $('turn-indicator');
  const countBlackEl = $('count-black');
  const countWhiteEl = $('count-white');
  const infoBlack = $('info-black');
  const infoWhite = $('info-white');
  const messageEl = $('message');
  const thinkingEl = $('thinking');
  const difficultyArea = $('difficulty-area');

  // ===== 画面遷移 =====
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== 盤面ロジック =====
  function createInitialBoard() {
    const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    b[3][3] = WHITE;
    b[3][4] = BLACK;
    b[4][3] = BLACK;
    b[4][4] = WHITE;
    return b;
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  // 指定セルに置いた場合に反転される石の座標一覧を返す
  function getFlips(board, row, col, color) {
    if (board[row][col] !== EMPTY) return [];
    const flips = [];
    const opp = opponent(color);
    for (const [dr, dc] of DIRS) {
      const line = [];
      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c) && board[r][c] === opp) {
        line.push([r, c]);
        r += dr;
        c += dc;
      }
      if (line.length > 0 && inBounds(r, c) && board[r][c] === color) {
        flips.push(...line);
      }
    }
    return flips;
  }

  function getLegalMoves(board, color) {
    const moves = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const flips = getFlips(board, r, c, color);
        if (flips.length > 0) {
          moves.push({ r, c, flips });
        }
      }
    }
    return moves;
  }

  function applyMove(board, move, color) {
    board[move.r][move.c] = color;
    for (const [r, c] of move.flips) {
      board[r][c] = color;
    }
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  function countStones(board) {
    let black = 0, white = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === BLACK) black++;
        else if (board[r][c] === WHITE) white++;
      }
    }
    return { black, white };
  }

  // ===== 描画 =====
  function buildBoardDOM() {
    boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener('click', onCellClick);
        boardEl.appendChild(cell);
      }
    }
  }

  function renderBoard() {
    const legalMoves = state.gameOver ? [] : getLegalMoves(state.board, state.turn);
    const legalSet = new Set(legalMoves.map((m) => `${m.r},${m.c}`));
    const showLegal = !state.gameOver
      && !state.busy
      && (state.mode === 'pvp' || state.turn !== state.aiColor);

    const cells = boardEl.children;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cells[r * SIZE + c];
        const v = state.board[r][c];
        cell.innerHTML = '';
        cell.classList.remove('legal');
        if (v === BLACK) {
          const s = document.createElement('div');
          s.className = 'stone stone-black';
          cell.appendChild(s);
        } else if (v === WHITE) {
          const s = document.createElement('div');
          s.className = 'stone stone-white';
          cell.appendChild(s);
        } else if (showLegal && legalSet.has(`${r},${c}`)) {
          cell.classList.add('legal');
        }
      }
    }

    const counts = countStones(state.board);
    countBlackEl.textContent = counts.black;
    countWhiteEl.textContent = counts.white;

    infoBlack.classList.toggle('active', !state.gameOver && state.turn === BLACK);
    infoWhite.classList.toggle('active', !state.gameOver && state.turn === WHITE);

    if (!state.gameOver) {
      const turnName = state.turn === BLACK ? 'くろ' : 'しろ';
      const isAI = state.mode === 'cpu' && state.turn === state.aiColor;
      turnIndicator.textContent = isAI ? `${turnName}（CPU）の番♪` : `${turnName}の番♪`;
    }

    return legalMoves;
  }

  function setMessage(text) {
    messageEl.textContent = text || '';
  }

  function setThinking(on) {
    thinkingEl.classList.toggle('hidden', !on);
  }

  // ===== ゲーム進行 =====
  function startGame() {
    state.board = createInitialBoard();
    state.turn = BLACK;
    state.busy = false;
    state.gameOver = false;
    setMessage('');
    showScreen('game');
    proceedTurn();
  }

  function proceedTurn() {
    const legalMoves = renderBoard();

    if (legalMoves.length === 0) {
      // 自分が打てない → 相手が打てるかチェック
      const oppMoves = getLegalMoves(state.board, opponent(state.turn));
      if (oppMoves.length === 0) {
        endGame();
        return;
      }
      // パス
      const passName = state.turn === BLACK ? 'くろ' : 'しろ';
      setMessage(`${passName}はおけるところがないからパス！`);
      sound.pass();
      state.busy = true;
      setTimeout(() => {
        state.turn = opponent(state.turn);
        state.busy = false;
        setMessage('');
        proceedTurn();
      }, 1100);
      return;
    }

    // CPUの番なら自動で打つ
    if (state.mode === 'cpu' && state.turn === state.aiColor) {
      runAI(legalMoves);
    }
  }

  function onCellClick(e) {
    if (state.busy || state.gameOver) return;
    if (state.mode === 'cpu' && state.turn === state.aiColor) return;

    const r = parseInt(e.currentTarget.dataset.r, 10);
    const c = parseInt(e.currentTarget.dataset.c, 10);
    const flips = getFlips(state.board, r, c, state.turn);
    if (flips.length === 0) return;

    applyMove(state.board, { r, c, flips }, state.turn);
    playPlaceSounds(flips.length);
    state.turn = opponent(state.turn);
    setMessage('');
    proceedTurn();
  }

  function playPlaceSounds(flipCount) {
    sound.place();
    for (let i = 0; i < flipCount; i++) {
      setTimeout(() => sound.flip(i), 90 + i * 60);
    }
  }

  function endGame() {
    state.gameOver = true;
    renderBoard();
    const counts = countStones(state.board);
    $('result-black').textContent = counts.black;
    $('result-white').textContent = counts.white;
    let title;
    let outcome;
    if (counts.black > counts.white) { title = 'くろの勝ち♥'; outcome = BLACK; }
    else if (counts.white > counts.black) { title = 'しろの勝ち♥'; outcome = WHITE; }
    else { title = 'ひきわけ！'; outcome = 0; }
    $('result-title').textContent = title;
    setTimeout(() => {
      if (outcome === 0) sound.draw();
      else if (state.mode === 'cpu') {
        if (outcome === state.aiColor) sound.lose();
        else sound.win();
      } else {
        sound.win();
      }
      showScreen('result');
    }, 600);
  }

  // ===== AI =====
  function runAI(legalMoves) {
    state.busy = true;
    setThinking(true);
    setTimeout(() => {
      const move = chooseAIMove(state.level, state.board, state.turn, legalMoves);
      applyMove(state.board, move, state.turn);
      playPlaceSounds(move.flips.length);
      state.turn = opponent(state.turn);
      state.busy = false;
      setThinking(false);
      proceedTurn();
    }, 350);
  }

  // 10段階のAI振り分け
  function chooseAIMove(level, board, color, moves) {
    switch (level) {
      case 1: return aiRandom(moves);
      case 2: return Math.random() < 0.75 ? aiRandom(moves) : aiPosition(moves);
      case 3: return Math.random() < 0.4  ? aiRandom(moves) : aiPosition(moves);
      case 4: return aiPosition(moves);
      case 5: return aiSearch(board, color, 2);
      case 6: return aiSearch(board, color, 3);
      case 7: return aiSearch(board, color, 4);
      case 8: return aiSearch(board, color, 5);
      case 9: return aiSearch(board, color, 6);
      case 10: {
        // 終盤完全読み（残りマス12以下）/ それ以外は深さ6
        const empties = countEmpty(board);
        if (empties <= 12) return aiSearch(board, color, empties);
        return aiSearch(board, color, 6);
      }
      default: return aiPosition(moves);
    }
  }

  function countEmpty(board) {
    let n = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (board[r][c] === EMPTY) n++;
    return n;
  }

  function aiRandom(moves) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  function aiPosition(moves) {
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const score = POSITION_WEIGHTS[m.r][m.c] + m.flips.length * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  // ミニマックス + αβ枝刈り（指定深さ）
  function aiSearch(board, color, depth) {
    let moves = getLegalMoves(board, color);
    // 着手順をソート（コーナー優先）して枝刈り効率を上げる
    moves = moves.slice().sort((a, b) =>
      POSITION_WEIGHTS[b.r][b.c] - POSITION_WEIGHTS[a.r][a.c]);

    let best = moves[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    for (const m of moves) {
      const next = cloneBoard(board);
      applyMove(next, m, color);
      const score = minimax(next, opponent(color), color, depth - 1, alpha, beta, false);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
      if (score > alpha) alpha = score;
    }
    return best;
  }

  function minimax(board, turn, aiColor, depth, alpha, beta, isMax) {
    let moves = getLegalMoves(board, turn);
    if (depth === 0) {
      return evaluate(board, aiColor);
    }
    if (moves.length === 0) {
      const oppMoves = getLegalMoves(board, opponent(turn));
      if (oppMoves.length === 0) {
        // 終局
        const counts = countStones(board);
        const my = aiColor === BLACK ? counts.black : counts.white;
        const op = aiColor === BLACK ? counts.white : counts.black;
        if (my > op) return 100000;
        if (my < op) return -100000;
        return 0;
      }
      // パスして相手番
      return minimax(board, opponent(turn), aiColor, depth - 1, alpha, beta, !isMax);
    }

    // 着手順ソート（コーナー優先）で枝刈り効率向上
    moves = moves.slice().sort((a, b) =>
      POSITION_WEIGHTS[b.r][b.c] - POSITION_WEIGHTS[a.r][a.c]);

    if (isMax) {
      let value = -Infinity;
      for (const m of moves) {
        const next = cloneBoard(board);
        applyMove(next, m, turn);
        value = Math.max(value, minimax(next, opponent(turn), aiColor, depth - 1, alpha, beta, false));
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break;
      }
      return value;
    } else {
      let value = Infinity;
      for (const m of moves) {
        const next = cloneBoard(board);
        applyMove(next, m, turn);
        value = Math.min(value, minimax(next, opponent(turn), aiColor, depth - 1, alpha, beta, true));
        beta = Math.min(beta, value);
        if (alpha >= beta) break;
      }
      return value;
    }
  }

  function evaluate(board, aiColor) {
    let score = 0;
    let myCount = 0, opCount = 0;
    const opp = opponent(aiColor);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = board[r][c];
        if (v === aiColor) {
          score += POSITION_WEIGHTS[r][c];
          myCount++;
        } else if (v === opp) {
          score -= POSITION_WEIGHTS[r][c];
          opCount++;
        }
      }
    }
    // 機動力（合法手の数）
    const myMobility = getLegalMoves(board, aiColor).length;
    const opMobility = getLegalMoves(board, opp).length;
    score += (myMobility - opMobility) * 5;

    // 終盤は石数差を重視
    const total = myCount + opCount;
    if (total >= 50) {
      score += (myCount - opCount) * 10;
    }
    return score;
  }

  // ===== タイトル画面のUI操作 =====
  function setupTitleUI() {
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.mode = btn.dataset.mode;
        difficultyArea.classList.toggle('hidden', state.mode !== 'cpu');
        sound.click();
      });
    });
    modeButtons[0].classList.add('selected');
    state.mode = 'pvp';

    const orderButtons = document.querySelectorAll('.order-btn');
    orderButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        orderButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.playerOrder = btn.dataset.order;
        sound.click();
      });
    });

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
      // 先攻=プレイヤーが黒、後攻=プレイヤーが白
      state.aiColor = (state.playerOrder === 'first') ? WHITE : BLACK;
      sound.click();
      startGame();
    });

    const soundToggle = $('sound-toggle');
    soundToggle.checked = sound.enabled;
    soundToggle.addEventListener('change', () => {
      sound.setEnabled(soundToggle.checked);
      if (soundToggle.checked) sound.click();
    });
  }

  function setupGameUI() {
    $('btn-reset').addEventListener('click', () => {
      if (state.busy) return;
      sound.click();
      startGame();
    });
    $('btn-back').addEventListener('click', () => {
      if (state.busy) return;
      sound.click();
      showScreen('title');
    });
  }

  function setupResultUI() {
    $('btn-replay').addEventListener('click', () => {
      sound.click();
      startGame();
    });
    $('btn-result-back').addEventListener('click', () => {
      sound.click();
      showScreen('title');
    });
  }

  // 最初のユーザー操作で AudioContext を初期化（ブラウザの自動再生制限対策）
  function setupAudioUnlock() {
    const unlock = () => {
      sound.init();
      sound.resume();
    };
    document.addEventListener('pointerdown', unlock, { once: false });
    document.addEventListener('touchstart', unlock, { once: false });
    document.addEventListener('keydown', unlock, { once: false });
  }

  // ===== 初期化 =====
  function init() {
    sound.loadPref();
    setupAudioUnlock();
    buildBoardDOM();
    setupTitleUI();
    setupGameUI();
    setupResultUI();
  }

  init();
})();
