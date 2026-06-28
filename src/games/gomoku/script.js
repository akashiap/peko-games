(() => {
  'use strict';

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const WIN = 5;
  const DEFAULT_SIZE = 15;
  let SIZE = DEFAULT_SIZE;

  function center() { return Math.floor(SIZE / 2); }

  // 盤サイズに応じた星（天元 + 隅近傍）の位置
  function starPoints() {
    const c = center();
    if (SIZE >= 13) {
      return [[3, 3], [3, SIZE - 4], [SIZE - 4, 3], [SIZE - 4, SIZE - 4], [c, c]];
    }
    // 9路盤
    return [[2, 2], [2, SIZE - 3], [SIZE - 3, 2], [SIZE - 3, SIZE - 3], [c, c]];
  }

  // 4方向（横・縦・斜め2種）
  const LINE_DIRS = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

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
      try { localStorage.setItem('gomoku_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('gomoku_sound');
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
    place() {
      // 「ぱちっ」石を置く音
      this.tone(660, 0.06, 'square', 0.05, 320);
      this.tone(1320, 0.10, 'triangle', 0.10, 660);
    },
    win() {
      const notes = [659, 784, 988, 1319];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'triangle', 0.16), i * 110));
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 480);
    },
    lose() {
      const notes = [659, 523, 440];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.28, 'triangle', 0.13, f * 0.8), i * 160));
    },
    draw() {
      this.tone(660, 0.18, 'triangle', 0.13);
      setTimeout(() => this.tone(880, 0.22, 'triangle', 0.13), 180);
    },
    click() {
      this.tone(1100, 0.06, 'triangle', 0.08, 1500);
    },
  };

  // ===== ゲーム状態 =====
  const state = {
    board: null,
    turn: BLACK,
    mode: 'pvp',
    level: 3,
    playerOrder: 'first',
    aiColor: WHITE,
    busy: false,
    gameOver: false,
    history: [],          // [{r,c,color}]
    lastMove: null,       // {r,c}
    winLine: null,        // [[r,c], ...]
    boardSize: DEFAULT_SIZE,
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
  const infoBlack = $('info-black');
  const infoWhite = $('info-white');
  const messageEl = $('message');
  const thinkingEl = $('thinking');
  const difficultyArea = $('difficulty-area');
  const undoBtn = $('btn-undo');

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ===== 画面遷移 =====
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== 盤面ロジック =====
  function createInitialBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function opponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  function cloneBoard(board) {
    return board.map((row) => row.slice());
  }

  // (r,c) に色 color の石を置いた直後に、その石を含む 5連 があるか判定
  function findWinLine(board, r, c, color) {
    for (const [dr, dc] of LINE_DIRS) {
      const line = [[r, c]];
      let i = 1;
      while (inBounds(r + dr * i, c + dc * i) && board[r + dr * i][c + dc * i] === color) {
        line.push([r + dr * i, c + dc * i]);
        i++;
      }
      i = 1;
      while (inBounds(r - dr * i, c - dc * i) && board[r - dr * i][c - dc * i] === color) {
        line.unshift([r - dr * i, c - dc * i]);
        i++;
      }
      if (line.length >= WIN) return line.slice(0, WIN);
    }
    return null;
  }

  function isBoardFull(board) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) return false;
      }
    }
    return true;
  }

  // ===== 描画（盤面はSVG） =====
  function buildBoardSVG() {
    const V = 420;
    const margin = 14;
    const cell = (V - margin * 2) / (SIZE - 1);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${V} ${V}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.dataset.margin = margin;
    svg.dataset.cell = cell;

    // グリッド
    const grid = document.createElementNS(SVG_NS, 'g');
    for (let i = 0; i < SIZE; i++) {
      const p = margin + i * cell;
      // 縦線
      const v = document.createElementNS(SVG_NS, 'line');
      v.setAttribute('x1', p); v.setAttribute('y1', margin);
      v.setAttribute('x2', p); v.setAttribute('y2', V - margin);
      v.setAttribute('class', (i === 0 || i === SIZE - 1) ? 'grid-edge' : 'grid-line');
      grid.appendChild(v);
      // 横線
      const h = document.createElementNS(SVG_NS, 'line');
      h.setAttribute('x1', margin); h.setAttribute('y1', p);
      h.setAttribute('x2', V - margin); h.setAttribute('y2', p);
      h.setAttribute('class', (i === 0 || i === SIZE - 1) ? 'grid-edge' : 'grid-line');
      grid.appendChild(h);
    }
    svg.appendChild(grid);

    // 星（天元 + 4隅近く）
    const stars = starPoints();
    for (const [r, c] of stars) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', margin + c * cell);
      dot.setAttribute('cy', margin + r * cell);
      dot.setAttribute('r', 3);
      dot.setAttribute('class', 'star-point');
      svg.appendChild(dot);
    }

    // 石レイヤー
    const stoneLayer = document.createElementNS(SVG_NS, 'g');
    stoneLayer.setAttribute('id', 'stones');
    svg.appendChild(stoneLayer);

    // クリック受け（透明セル + 合法マーカー）
    const hitLayer = document.createElementNS(SVG_NS, 'g');
    hitLayer.setAttribute('id', 'hits');
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cx = margin + c * cell;
        const cy = margin + r * cell;
        const hit = document.createElementNS(SVG_NS, 'rect');
        hit.setAttribute('x', cx - cell / 2);
        hit.setAttribute('y', cy - cell / 2);
        hit.setAttribute('width', cell);
        hit.setAttribute('height', cell);
        hit.setAttribute('class', 'cell-hit');
        hit.dataset.r = r;
        hit.dataset.c = c;
        hit.addEventListener('click', onCellClick);
        hitLayer.appendChild(hit);

        const mark = document.createElementNS(SVG_NS, 'circle');
        mark.setAttribute('cx', cx);
        mark.setAttribute('cy', cy);
        mark.setAttribute('r', cell * 0.18);
        mark.setAttribute('class', 'legal-mark');
        mark.dataset.r = r;
        mark.dataset.c = c;
        hitLayer.appendChild(mark);
      }
    }
    svg.appendChild(hitLayer);

    boardEl.innerHTML = '';
    boardEl.appendChild(svg);
    ensureGradients(svg);
  }

  function getCellMetrics() {
    const svg = boardEl.querySelector('svg');
    return {
      svg,
      margin: parseFloat(svg.dataset.margin),
      cell: parseFloat(svg.dataset.cell),
    };
  }

  function renderBoard() {
    const { svg, margin, cell } = getCellMetrics();
    const stoneLayer = svg.querySelector('#stones');
    stoneLayer.innerHTML = '';

    const winSet = new Set();
    if (state.winLine) {
      for (const [r, c] of state.winLine) winSet.add(`${r},${c}`);
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state.board[r][c];
        if (v === EMPTY) continue;
        const cx = margin + c * cell;
        const cy = margin + r * cell;
        const stone = document.createElementNS(SVG_NS, 'circle');
        stone.setAttribute('cx', cx);
        stone.setAttribute('cy', cy);
        stone.setAttribute('r', cell * 0.42);
        stone.setAttribute('fill', v === BLACK
          ? 'url(#stoneBlackGrad)' : 'url(#stoneWhiteGrad)');
        stone.setAttribute('stroke', v === BLACK ? '#000' : '#aaa');
        stone.setAttribute('stroke-width', '0.5');
        let cls = 'stone-svg';
        if (state.lastMove && state.lastMove.r === r && state.lastMove.c === c) {
          cls += ' last-move';
        }
        if (winSet.has(`${r},${c}`)) cls += ' win-stone';
        stone.setAttribute('class', cls);
        stoneLayer.appendChild(stone);
      }
    }

    ensureGradients(svg);

    // 合法マーカーの表示
    const showLegal = !state.gameOver
      && !state.busy
      && (state.mode === 'pvp' || state.turn !== state.aiColor);
    const hits = svg.querySelectorAll('.cell-hit');
    const marks = svg.querySelectorAll('.legal-mark');
    for (let i = 0; i < hits.length; i++) {
      const r = parseInt(hits[i].dataset.r, 10);
      const c = parseInt(hits[i].dataset.c, 10);
      const empty = state.board[r][c] === EMPTY;
      hits[i].classList.toggle('disabled', !empty || state.gameOver);
      // 全空マスを毎回マーキングすると点が多すぎるので、近傍 or 中央付近だけ
      const showThis = showLegal && empty && shouldShowLegalHint(r, c);
      hits[i].classList.toggle('show-legal', showThis);
    }

    infoBlack.classList.toggle('active', !state.gameOver && state.turn === BLACK);
    infoWhite.classList.toggle('active', !state.gameOver && state.turn === WHITE);

    if (!state.gameOver) {
      const turnName = state.turn === BLACK ? 'くろ' : 'しろ';
      const isAI = state.mode === 'cpu' && state.turn === state.aiColor;
      turnIndicator.textContent = isAI ? `${turnName}（CPU）の番♪` : `${turnName}の番♪`;
    }

    undoBtn.disabled = state.busy || !hasPlayerMoves() || state.gameOver;
  }

  // 候補表示: 1手目は天元、それ以降は既存石の近傍（距離2以内）の空マス
  function shouldShowLegalHint(r, c) {
    if (state.history.length === 0) {
      const cc = center();
      return r === cc && c === cc;
    }
    for (const m of state.history) {
      const dr = Math.abs(m.r - r);
      const dc = Math.abs(m.c - c);
      if (dr <= 2 && dc <= 2 && !(dr === 0 && dc === 0)) return true;
    }
    return false;
  }

  function ensureGradients(svg) {
    if (svg.querySelector('defs')) return;
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <radialGradient id="stoneBlackGrad" cx="0.35" cy="0.28" r="0.85">
        <stop offset="0%" stop-color="#7a7a7a"/>
        <stop offset="55%" stop-color="#2a2a2a"/>
        <stop offset="100%" stop-color="#0a0a0a"/>
      </radialGradient>
      <radialGradient id="stoneWhiteGrad" cx="0.35" cy="0.28" r="0.9">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="55%" stop-color="#f0f0f0"/>
        <stop offset="100%" stop-color="#c8c8c8"/>
      </radialGradient>
    `;
    svg.insertBefore(defs, svg.firstChild);
  }

  function setMessage(text) {
    messageEl.textContent = text || '';
  }

  function setThinking(on) {
    thinkingEl.classList.toggle('hidden', !on);
  }

  // ===== ゲーム進行 =====
  function startGame() {
    SIZE = state.boardSize;
    buildBoardSVG();
    state.board = createInitialBoard();
    state.turn = BLACK;
    state.busy = false;
    state.gameOver = false;
    state.history = [];
    state.lastMove = null;
    state.winLine = null;
    setMessage('');
    showScreen('game');
    renderBoard();
    proceedTurn();
  }

  function proceedTurn() {
    renderBoard();
    if (state.gameOver) return;
    if (state.mode === 'cpu' && state.turn === state.aiColor) {
      runAI();
    }
  }

  function placeStone(r, c, color) {
    state.board[r][c] = color;
    state.history.push({ r, c, color });
    state.lastMove = { r, c };
    sound.place();
    const winLine = findWinLine(state.board, r, c, color);
    if (winLine) {
      state.winLine = winLine;
      endGame(color);
      return true;
    }
    if (isBoardFull(state.board)) {
      endGame(0);
      return true;
    }
    state.turn = opponent(state.turn);
    return false;
  }

  function onCellClick(e) {
    if (state.busy || state.gameOver) return;
    if (state.mode === 'cpu' && state.turn === state.aiColor) return;
    const r = parseInt(e.currentTarget.dataset.r, 10);
    const c = parseInt(e.currentTarget.dataset.c, 10);
    if (state.board[r][c] !== EMPTY) return;

    const ended = placeStone(r, c, state.turn);
    setMessage('');
    if (ended) { renderBoard(); return; }
    proceedTurn();
  }

  function hasPlayerMoves() {
    if (state.mode !== 'cpu') return state.history.length > 0;
    for (const m of state.history) {
      if (m.color !== state.aiColor) return true;
    }
    return false;
  }

  function undoMove() {
    if (state.busy) return;
    if (state.history.length === 0) return;
    let undoCount = 1;
    if (state.mode === 'cpu') {
      const last = state.history[state.history.length - 1];
      if (last.color === state.aiColor) {
        // 直前は AI。プレイヤーが打った手まで戻す
        if (state.history.length < 2) return;
        undoCount = 2;
      }
    }
    for (let i = 0; i < undoCount; i++) {
      const m = state.history.pop();
      if (!m) break;
      state.board[m.r][m.c] = EMPTY;
      state.turn = m.color;
    }
    state.lastMove = state.history.length
      ? { r: state.history[state.history.length - 1].r,
          c: state.history[state.history.length - 1].c } : null;
    state.gameOver = false;
    state.winLine = null;
    setMessage('');
    sound.click();
    renderBoard();
  }

  function endGame(winnerColor) {
    state.gameOver = true;
    renderBoard();
    let title;
    if (winnerColor === 0) {
      title = 'ひきわけ！';
    } else if (winnerColor === BLACK) {
      title = 'くろの勝ち♥';
    } else {
      title = 'しろの勝ち♥';
    }
    $('result-title').textContent = title;
    const blackSide = $('result-side-black');
    const whiteSide = $('result-side-white');
    blackSide.classList.toggle('winner', winnerColor === BLACK);
    whiteSide.classList.toggle('winner', winnerColor === WHITE);
    $('result-black-label').textContent =
      winnerColor === BLACK ? '勝ち' : (winnerColor === 0 ? '　' : '負け');
    $('result-white-label').textContent =
      winnerColor === WHITE ? '勝ち' : (winnerColor === 0 ? '　' : '負け');

    setTimeout(() => {
      if (winnerColor === 0) sound.draw();
      else if (state.mode === 'cpu') {
        if (winnerColor === state.aiColor) sound.lose();
        else sound.win();
      } else {
        sound.win();
      }
      showScreen('result');
    }, 800);
  }

  // ===== AI =====
  function runAI() {
    state.busy = true;
    setThinking(true);
    renderBoard();
    setTimeout(() => {
      const move = chooseAIMove(state.level, state.board, state.aiColor);
      const ended = placeStone(move.r, move.c, state.aiColor);
      state.busy = false;
      setThinking(false);
      setMessage('');
      if (ended) { renderBoard(); return; }
      proceedTurn();
    }, 320);
  }

  // 候補手の生成: 既存の石から距離 dist 以内の空マス。
  // 石が無いときは中央。
  function generateCandidates(board, dist = 2) {
    const set = new Set();
    let any = false;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        any = true;
        for (let dr = -dist; dr <= dist; dr++) {
          for (let dc = -dist; dc <= dist; dc++) {
            const nr = r + dr, nc = c + dc;
            if (!inBounds(nr, nc)) continue;
            if (board[nr][nc] !== EMPTY) continue;
            set.add(nr * SIZE + nc);
          }
        }
      }
    }
    if (!any) { const cc = center(); return [{ r: cc, c: cc }]; }
    const list = [];
    for (const k of set) {
      list.push({ r: Math.floor(k / SIZE), c: k % SIZE });
    }
    return list;
  }

  // ある方向（dr,dc）について、(r,c)に color を置いたときのスコア
  function scoreDir(board, r, c, dr, dc, color) {
    const opp = opponent(color);
    // 連続カウント（隣接）
    let countL = 0, countR = 0;
    let endL = 'block', endR = 'block';
    for (let i = 1; i <= 5; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (!inBounds(nr, nc)) { endR = 'block'; break; }
      const v = board[nr][nc];
      if (v === color) { countR++; continue; }
      if (v === EMPTY) { endR = 'open'; break; }
      endR = 'block'; break;
    }
    for (let i = 1; i <= 5; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (!inBounds(nr, nc)) { endL = 'block'; break; }
      const v = board[nr][nc];
      if (v === color) { countL++; continue; }
      if (v === EMPTY) { endL = 'open'; break; }
      endL = 'block'; break;
    }
    const count = countL + countR + 1;
    const opens = (endL === 'open' ? 1 : 0) + (endR === 'open' ? 1 : 0);

    // 隣接連続パターンによるスコア
    let s = 0;
    if (count >= 5) s = 1000000;
    else if (count === 4) s = (opens === 2 ? 80000 : (opens === 1 ? 8000 : 0));
    else if (count === 3) s = (opens === 2 ? 8000 : (opens === 1 ? 300 : 0));
    else if (count === 2) s = (opens === 2 ? 300 : (opens === 1 ? 30 : 0));
    else if (count === 1) s = opens * 5;

    // 5マスの窓スコア（「飛び」パターンも拾う）
    let bestWindow = 0;
    for (let off = -4; off <= 0; off++) {
      let my = 0, ok = true;
      for (let k = 0; k < 5; k++) {
        const nr = r + dr * (off + k), nc = c + dc * (off + k);
        if (!inBounds(nr, nc)) { ok = false; break; }
        const v = board[nr][nc];
        if (v === opp) { ok = false; break; }
        if (v === color) my++;
      }
      if (!ok) continue;
      const m = my + 1;
      let ws = 0;
      if (m >= 5) ws = 1000000;
      else if (m === 4) ws = 6000;
      else if (m === 3) ws = 200;
      else if (m === 2) ws = 15;
      if (ws > bestWindow) bestWindow = ws;
    }
    if (bestWindow > s) s = bestWindow;
    return s;
  }

  function scoreCellForColor(board, r, c, color) {
    let total = 0;
    for (const [dr, dc] of LINE_DIRS) {
      total += scoreDir(board, r, c, dr, dc, color);
    }
    // 中央寄り加点（ごく軽め）
    const cc = center();
    const dx = Math.abs(c - cc), dy = Math.abs(r - cc);
    total += Math.max(0, 6 - dx - dy);
    return total;
  }

  // (r,c) に置く価値（攻撃 + 防御）
  function scoreMove(board, r, c, color) {
    const opp = opponent(color);
    const off = scoreCellForColor(board, r, c, color);
    // 5連系は攻撃側が1000000なので即勝ちは判別可能
    if (off >= 1000000) return off;
    const def = scoreCellForColor(board, r, c, opp);
    // 相手が「次にここに打って4を作ってくる」「3を作ってくる」を抑止
    return off + def * 0.92;
  }

  function aiRandom(board) {
    const cands = generateCandidates(board, 1);
    return cands[Math.floor(Math.random() * cands.length)];
  }

  function aiHeuristic(board, color, randomness = 0) {
    const cands = generateCandidates(board, 2);
    let bestMoves = [];
    let bestScore = -Infinity;
    for (const m of cands) {
      const s = scoreMove(board, m.r, m.c, color)
        + (randomness > 0 ? Math.random() * randomness : 0);
      if (s > bestScore) {
        bestScore = s;
        bestMoves = [m];
      } else if (s === bestScore) {
        bestMoves.push(m);
      }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  // 静的評価: aiColor 視点
  function evaluatePosition(board, aiColor) {
    const opp = opponent(aiColor);
    let mine = 0, theirs = 0;
    // 各方向 × 各空きマス で寄与スコアを集計するのは重いため、
    // 既存の石の周囲（候補マス）のみを評価
    const cands = generateCandidates(board, 2);
    for (const { r, c } of cands) {
      mine += scoreCellForColor(board, r, c, aiColor) * 0.1;
      theirs += scoreCellForColor(board, r, c, opp) * 0.1;
    }
    return mine - theirs;
  }

  // ミニマックス + αβ。即勝ち・即負けは早期終了で扱う。
  function minimax(board, depth, alpha, beta, turn, aiColor, lastMove) {
    // 直前手で勝敗が決していれば即返す
    if (lastMove) {
      const winLine = findWinLine(board, lastMove.r, lastMove.c, lastMove.color);
      if (winLine) {
        return lastMove.color === aiColor ? 900000 + depth : -900000 - depth;
      }
    }
    if (depth === 0) {
      return evaluatePosition(board, aiColor);
    }
    const candsAll = generateCandidates(board, 2);
    if (candsAll.length === 0) return 0;

    // 候補数を絞る（評価値順 上位 K 件のみ展開）
    const K = Math.min(candsAll.length, 12);
    const scored = candsAll.map((m) => ({
      m, s: scoreMove(board, m.r, m.c, turn),
    }));
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, K).map((x) => x.m);

    if (turn === aiColor) {
      let best = -Infinity;
      for (const m of top) {
        board[m.r][m.c] = turn;
        const v = minimax(board, depth - 1, alpha, beta,
          opponent(turn), aiColor, { r: m.r, c: m.c, color: turn });
        board[m.r][m.c] = EMPTY;
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const m of top) {
        board[m.r][m.c] = turn;
        const v = minimax(board, depth - 1, alpha, beta,
          opponent(turn), aiColor, { r: m.r, c: m.c, color: turn });
        board[m.r][m.c] = EMPTY;
        if (v < best) best = v;
        if (best < beta) beta = best;
        if (alpha >= beta) break;
      }
      return best;
    }
  }

  function aiSearch(board, color, depth, topK = 10) {
    // 即勝ち手があれば即採用
    const cands = generateCandidates(board, 2);
    for (const m of cands) {
      board[m.r][m.c] = color;
      const win = findWinLine(board, m.r, m.c, color);
      board[m.r][m.c] = EMPTY;
      if (win) return m;
    }
    // 相手の即勝ち手はブロック
    const opp = opponent(color);
    const oppWins = [];
    for (const m of cands) {
      board[m.r][m.c] = opp;
      const win = findWinLine(board, m.r, m.c, opp);
      board[m.r][m.c] = EMPTY;
      if (win) oppWins.push(m);
    }
    if (oppWins.length > 0) return oppWins[0];

    // 通常探索: 上位 topK のみ
    const scored = cands.map((m) => ({
      m, s: scoreMove(board, m.r, m.c, color),
    }));
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, Math.min(topK, scored.length)).map((x) => x.m);

    let best = top[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;
    for (const m of top) {
      board[m.r][m.c] = color;
      const v = minimax(board, depth - 1, alpha, beta,
        opponent(color), color, { r: m.r, c: m.c, color });
      board[m.r][m.c] = EMPTY;
      if (v > bestScore) {
        bestScore = v;
        best = m;
      }
      if (v > alpha) alpha = v;
    }
    return best;
  }

  function chooseAIMove(level, board, color) {
    // どのレベルでも、即勝ちと相手即勝ちブロックは行う
    if (level <= 1) {
      // それでも完全ランダムにすると勝てないので、即勝ちと致命ブロックだけは実施
      const safe = aiSafeRandom(board, color);
      return safe;
    }
    switch (level) {
      case 2:  return aiHeuristic(board, color, 600);
      case 3:  return aiHeuristic(board, color, 200);
      case 4:  return aiHeuristic(board, color, 30);
      case 5:  return aiSearch(board, color, 2, 10);
      case 6:  return aiSearch(board, color, 2, 14);
      case 7:  return aiSearch(board, color, 3, 10);
      case 8:  return aiSearch(board, color, 3, 14);
      case 9:  return aiSearch(board, color, 4, 10);
      case 10: return aiSearch(board, color, 4, 14);
      default: return aiHeuristic(board, color, 50);
    }
  }

  function aiSafeRandom(board, color) {
    const cands = generateCandidates(board, 2);
    if (cands.length === 0) { const cc = center(); return { r: cc, c: cc }; }
    // 即勝ち
    for (const m of cands) {
      board[m.r][m.c] = color;
      const w = findWinLine(board, m.r, m.c, color);
      board[m.r][m.c] = EMPTY;
      if (w) return m;
    }
    // 相手即勝ちブロック
    const opp = opponent(color);
    for (const m of cands) {
      board[m.r][m.c] = opp;
      const w = findWinLine(board, m.r, m.c, opp);
      board[m.r][m.c] = EMPTY;
      if (w) return m;
    }
    return cands[Math.floor(Math.random() * cands.length)];
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

    const sizeButtons = document.querySelectorAll('.size-btn');
    sizeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        sizeButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.boardSize = parseInt(btn.dataset.size, 10);
        sound.click();
      });
    });

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
    undoBtn.addEventListener('click', () => {
      undoMove();
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

  function setupAudioUnlock() {
    const unlock = () => {
      sound.init();
      sound.resume();
    };
    document.addEventListener('pointerdown', unlock, { once: false });
    document.addEventListener('touchstart', unlock, { once: false });
    document.addEventListener('keydown', unlock, { once: false });
  }

  function init() {
    sound.loadPref();
    setupAudioUnlock();
    buildBoardSVG();
    setupTitleUI();
    setupGameUI();
    setupResultUI();
  }

  init();
})();
