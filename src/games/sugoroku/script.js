(() => {
  'use strict';

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
      try { localStorage.setItem('sugoroku_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('sugoroku_sound');
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
    roll() {
      // サイコロ振り：カラカラ音
      this.noise(0.18, 0.10, 1200);
    },
    diceStop(value) {
      // サイコロ確定音
      this.tone(660 + value * 30, 0.10, 'triangle', 0.16, 880);
    },
    step() {
      // 一歩進む：ぴょこ
      this.tone(880, 0.06, 'triangle', 0.10, 1100);
    },
    forward() {
      // 進む：上昇
      [880, 1100, 1320].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.10, 'triangle', 0.13), i * 70));
    },
    back() {
      // 戻る：下降
      [880, 660, 440].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.12, 'triangle', 0.13), i * 90));
    },
    skip() {
      // 一回休み：おやすみ音
      this.tone(440, 0.20, 'sine', 0.13, 220);
    },
    restart() {
      // 振り出しに戻る：しょんぼり
      [659, 523, 440, 349].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.18, 'triangle', 0.13), i * 110));
    },
    win() {
      const notes = [659, 784, 988, 1319];
      notes.forEach((f, i) => setTimeout(() =>
        this.tone(f, 0.22, 'triangle', 0.16), i * 110));
      setTimeout(() => this.tone(2093, 0.18, 'sine', 0.10), 480);
    },
    click() {
      this.tone(1100, 0.06, 'triangle', 0.08, 1500);
    },
  };

  // ===== マスの種類 =====
  // type: 'normal' | 'forward' | 'back' | 'skip' | 'restart' | 'start' | 'goal'
  // value: forward/back のマス数
  const EVENT_TEMPLATES = [
    { type: 'forward', value: 2, icon: '🌟', label: '2すすむ' },
    { type: 'forward', value: 3, icon: '🚀', label: '3すすむ' },
    { type: 'back',    value: 2, icon: '💧', label: '2もどる' },
    { type: 'back',    value: 3, icon: '🌀', label: '3もどる' },
    { type: 'skip',    value: 1, icon: '💤', label: '1かいやすみ' },
    { type: 'restart', value: 0, icon: '⤺',  label: 'ふりだしへ' },
  ];

  // ===== プレイヤーキャラクター =====
  const PLAYERS_DEF = [
    { name: 'インコちゃん', animal: '🦜', species: 'インコ' },
    { name: 'リスちゃん',   animal: '🐿️', species: 'リス' },
    { name: 'パカちゃん',   animal: '🦙', species: 'アルパカ' },
    { name: 'ネコちゃん',   animal: '🐱', species: 'ネコ' },
  ];

  // ===== ゲーム状態 =====
  const state = {
    cells: [],          // 各マスの定義
    players: [],        // {id, name, pos, skipTurns, finished, rank}
    turn: 0,            // 現在の手番のプレイヤーindex
    boardLength: 30,
    playerCount: 3,
    busy: false,
    finishedCount: 0,
  };

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $('screen-title'),
    game: $('screen-game'),
    result: $('screen-result'),
  };
  const boardEl = $('board');
  const playersBar = $('players-bar');
  const turnIndicator = $('turn-indicator');
  const messageEl = $('message');
  const diceEl = $('dice');
  const diceFaceEl = $('dice-face');
  const btnRoll = $('btn-roll');

  // ===== 画面遷移 =====
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== ボード生成 =====
  function generateBoard(length) {
    const cells = [];
    cells.push({ type: 'start', icon: '🏁', label: 'スタート' });
    // 中間マス：イベントマスをランダムに配置（連続イベントは避ける）
    const middle = length - 2;
    let lastWasEvent = false;
    for (let i = 1; i <= middle; i++) {
      // 30%の確率でイベントマス、ただし直前がイベントならスキップ
      const makeEvent = !lastWasEvent && Math.random() < 0.32;
      if (makeEvent) {
        const tpl = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
        cells.push({ ...tpl });
        lastWasEvent = true;
      } else {
        cells.push({ type: 'normal', icon: '', label: '' });
        lastWasEvent = false;
      }
    }
    cells.push({ type: 'goal', icon: '🎀', label: 'ゴール' });
    return cells;
  }

  // ===== 盤面レイアウト：ジグザグ =====
  // length に応じて列数を決め、行ごとに左→右、右→左を交互に
  function computeLayout(length) {
    // 30マスなら6×5、20マスなら5×4、40マスなら8×5 程度を狙う
    let cols;
    if (length <= 20) cols = 5;
    else if (length <= 30) cols = 6;
    else cols = 8;
    const rows = Math.ceil(length / cols);
    return { cols, rows };
  }

  function indexToGrid(index, cols, rows) {
    // 下の行から上の行へ進む（ヘビ型）
    // 一番下の行がスタート
    const rowFromBottom = Math.floor(index / cols);
    const inRow = index % cols;
    const row = rows - 1 - rowFromBottom;
    // 偶数行（下から見て）は左→右、奇数行は右→左
    const col = (rowFromBottom % 2 === 0) ? inRow : (cols - 1 - inRow);
    return { row, col };
  }

  // 次のマスへの進行方向（'right' | 'left' | 'up'）。ゴールは null。
  function arrowDirection(index, cols, rows, total) {
    if (index >= total - 1) return null;
    const cur = indexToGrid(index, cols, rows);
    const nxt = indexToGrid(index + 1, cols, rows);
    if (nxt.row < cur.row) return 'up';
    if (nxt.col > cur.col) return 'right';
    if (nxt.col < cur.col) return 'left';
    return null;
  }

  // ===== 盤面描画 =====
  function renderBoard() {
    const { cols, rows } = computeLayout(state.cells.length);
    boardEl.style.setProperty('--cols', cols);
    boardEl.style.setProperty('--rows', rows);
    boardEl.innerHTML = '';

    state.cells.forEach((cell, idx) => {
      const { row, col } = indexToGrid(idx, cols, rows);
      const div = document.createElement('div');
      div.className = 'cell';
      div.dataset.index = idx;
      div.style.gridRow = (row + 1).toString();
      div.style.gridColumn = (col + 1).toString();

      if (cell.type === 'start') div.classList.add('start');
      else if (cell.type === 'goal') div.classList.add('goal');
      else if (cell.type === 'forward') div.classList.add('event-forward');
      else if (cell.type === 'back') div.classList.add('event-back');
      else if (cell.type === 'skip') div.classList.add('event-skip');
      else if (cell.type === 'restart') div.classList.add('event-restart');

      const labelEl = document.createElement('span');
      labelEl.className = 'cell-label';
      labelEl.textContent = idx;
      div.appendChild(labelEl);

      if (cell.type === 'start' || cell.type === 'goal') {
        const textEl = document.createElement('span');
        textEl.className = 'cell-text';
        textEl.textContent = cell.type === 'start' ? 'スタート' : 'ゴール';
        div.appendChild(textEl);
      } else if (cell.icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'cell-icon';
        iconEl.textContent = cell.icon;
        div.appendChild(iconEl);
      }

      if (cell.label && cell.type !== 'start' && cell.type !== 'goal' && cell.type !== 'normal') {
        const evLabel = document.createElement('span');
        evLabel.className = 'cell-event-label';
        evLabel.textContent = cell.label;
        div.appendChild(evLabel);
      }

      const dir = arrowDirection(idx, cols, rows, state.cells.length);
      if (dir) {
        const arrowEl = document.createElement('span');
        arrowEl.className = `cell-arrow arrow-${dir}`;
        arrowEl.textContent = dir === 'up' ? '▲' : (dir === 'right' ? '▶' : '◀');
        div.appendChild(arrowEl);
      }

      const tokensEl = document.createElement('div');
      tokensEl.className = 'cell-tokens';
      div.appendChild(tokensEl);

      boardEl.appendChild(div);
    });
    renderTokens();
  }

  function renderTokens() {
    // 各セルのトークンを再描画
    boardEl.querySelectorAll('.cell-tokens').forEach((el) => el.innerHTML = '');
    state.players.forEach((p) => {
      if (p.finished) return;
      const cellEl = boardEl.querySelector(`.cell[data-index="${p.pos}"] .cell-tokens`);
      if (!cellEl) return;
      const tk = document.createElement('span');
      tk.className = `token token-${p.id}`;
      tk.textContent = p.animal;
      cellEl.appendChild(tk);
    });
  }

  function renderPlayers() {
    playersBar.innerHTML = '';
    state.players.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'player-info';
      if (i === state.turn && !p.finished) div.classList.add('active');
      if (p.skipTurns > 0) div.classList.add('skip');

      const tk = document.createElement('span');
      tk.className = `token token-${p.id}`;
      tk.textContent = p.animal;
      div.appendChild(tk);

      const name = document.createElement('span');
      name.className = 'player-label';
      name.textContent = p.name;
      div.appendChild(name);

      const pos = document.createElement('span');
      pos.className = 'player-pos';
      if (p.finished) {
        pos.textContent = `${p.rank}位`;
      } else {
        pos.textContent = `${p.pos}/${state.cells.length - 1}`;
      }
      div.appendChild(pos);

      playersBar.appendChild(div);
    });
  }

  function updateTurnIndicator() {
    const p = state.players[state.turn];
    if (!p) return;
    if (p.finished) {
      turnIndicator.textContent = '';
    } else if (p.skipTurns > 0) {
      turnIndicator.textContent = `${p.name} は おやすみ中...`;
    } else {
      turnIndicator.textContent = `${p.name} のばん`;
    }
  }

  // ===== サイコロ =====
  function rollDice() {
    return Math.floor(Math.random() * 6) + 1;
  }

  function animateDice() {
    return new Promise((resolve) => {
      diceEl.classList.add('rolling');
      sound.roll();
      let n = 0;
      const flicker = setInterval(() => {
        diceFaceEl.textContent = (Math.floor(Math.random() * 6) + 1).toString();
        n++;
        if (n > 8) {
          clearInterval(flicker);
          diceEl.classList.remove('rolling');
          const final = rollDice();
          diceFaceEl.textContent = final.toString();
          sound.diceStop(final);
          resolve(final);
        }
      }, 70);
    });
  }

  // ===== マス移動 =====
  async function moveSteps(player, steps) {
    // ゴールを超えないように、超えた分は戻る
    const goalIdx = state.cells.length - 1;
    let target = player.pos + steps;
    let bounceMsg = '';
    if (target > goalIdx) {
      const over = target - goalIdx;
      target = goalIdx - over;
      bounceMsg = `（${over}マスもどる）`;
    }
    // 一マスずつアニメーション
    const dir = target > player.pos ? 1 : (target < player.pos ? -1 : 0);
    while (player.pos !== target) {
      player.pos += dir;
      sound.step();
      flashCell(player.pos);
      renderTokens();
      renderPlayers();
      await sleep(180);
    }
    return bounceMsg;
  }

  function flashCell(idx) {
    const cell = boardEl.querySelector(`.cell[data-index="${idx}"]`);
    if (!cell) return;
    cell.classList.remove('highlight');
    void cell.offsetWidth;
    cell.classList.add('highlight');
  }

  // ===== マスのイベント処理 =====
  async function processCellEvent(player) {
    const cell = state.cells[player.pos];
    if (!cell) return;
    if (cell.type === 'goal') return;

    if (cell.type === 'forward') {
      messageEl.textContent = `${cell.icon} ${cell.value}マスすすむ！`;
      sound.forward();
      await sleep(500);
      await moveSteps(player, cell.value);
      // 連鎖は1段だけ（ゴール処理のために）
    } else if (cell.type === 'back') {
      messageEl.textContent = `${cell.icon} ${cell.value}マスもどる...`;
      sound.back();
      await sleep(500);
      // 0未満にならないよう調整
      const target = Math.max(0, player.pos - cell.value);
      const diff = player.pos - target;
      if (diff > 0) {
        for (let i = 0; i < diff; i++) {
          player.pos -= 1;
          sound.step();
          flashCell(player.pos);
          renderTokens();
          renderPlayers();
          await sleep(180);
        }
      }
    } else if (cell.type === 'skip') {
      messageEl.textContent = `${cell.icon} つぎは1かいおやすみ！`;
      sound.skip();
      player.skipTurns = 1;
      await sleep(700);
    } else if (cell.type === 'restart') {
      messageEl.textContent = `${cell.icon} ふりだしにもどる！`;
      sound.restart();
      await sleep(500);
      while (player.pos > 0) {
        player.pos -= 1;
        sound.step();
        flashCell(player.pos);
        renderTokens();
        renderPlayers();
        await sleep(90);
      }
    }
  }

  // ===== ターン処理 =====
  async function takeTurn() {
    if (state.busy) return;
    const p = state.players[state.turn];
    if (!p || p.finished || p.skipTurns > 0) {
      nextTurn();
      return;
    }

    state.busy = true;
    btnRoll.disabled = true;

    const value = await animateDice();
    messageEl.textContent = `${p.name}: ${value} がでた！`;
    await sleep(380);

    const bounceMsg = await moveSteps(p, value);
    if (bounceMsg) {
      messageEl.textContent = `ゴールこえちゃった！${bounceMsg}`;
      await sleep(600);
    }

    // ゴール判定（イベント処理前に確定）
    if (p.pos === state.cells.length - 1) {
      state.finishedCount += 1;
      p.finished = true;
      p.rank = state.finishedCount;
      messageEl.textContent = `🎉 ${p.name} ゴール！ ${p.rank}位！`;
      sound.win();
      renderTokens();
      renderPlayers();
      await sleep(1200);

      // 全員ゴール、または1人を除いてゴールなら終了
      const remaining = state.players.filter((pp) => !pp.finished).length;
      if (remaining <= 1) {
        // 残り1人にも順位をつける
        state.players.forEach((pp) => {
          if (!pp.finished) {
            state.finishedCount += 1;
            pp.finished = true;
            pp.rank = state.finishedCount;
          }
        });
        state.busy = false;
        showResult();
        return;
      }
      state.busy = false;
      btnRoll.disabled = false;
      nextTurn();
      return;
    }

    // イベントマス処理
    await processCellEvent(p);
    // イベントの結果ゴールに到達したら判定
    if (p.pos === state.cells.length - 1) {
      state.finishedCount += 1;
      p.finished = true;
      p.rank = state.finishedCount;
      messageEl.textContent = `🎉 ${p.name} ゴール！ ${p.rank}位！`;
      sound.win();
      renderTokens();
      renderPlayers();
      await sleep(1200);
      const remaining = state.players.filter((pp) => !pp.finished).length;
      if (remaining <= 1) {
        state.players.forEach((pp) => {
          if (!pp.finished) {
            state.finishedCount += 1;
            pp.finished = true;
            pp.rank = state.finishedCount;
          }
        });
        state.busy = false;
        showResult();
        return;
      }
    }

    state.busy = false;
    btnRoll.disabled = false;
    await sleep(400);
    nextTurn();
  }

  async function nextTurn() {
    // 次の未ゴールプレイヤーを探す
    let n = state.players.length;
    let next = state.turn;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (!state.players[next].finished) break;
    }
    state.turn = next;
    renderPlayers();
    updateTurnIndicator();
    diceFaceEl.textContent = '?';
    const p = state.players[state.turn];

    // おやすみ中なら自動で消費して次へ
    if (p.skipTurns > 0) {
      messageEl.textContent = `${p.name} は おやすみ中...💤`;
      sound.skip();
      p.skipTurns -= 1;
      renderPlayers();
      await sleep(1000);
      nextTurn();
      return;
    }

    messageEl.textContent = `${p.name}：サイコロをふってね！`;
  }

  // ===== 結果画面 =====
  function showResult() {
    const ranked = [...state.players].sort((a, b) => a.rank - b.rank);
    const winner = ranked[0];
    $('result-title').textContent = '🎀 ゴール！ 🎀';
    const winnerToken = $('winner-token');
    winnerToken.className = `winner-token token-${winner.id}`;
    winnerToken.textContent = winner.animal;
    $('winner-name').textContent = `${winner.name}（${winner.species}）`;

    const rankList = $('ranking');
    rankList.innerHTML = '';
    ranked.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      const num = document.createElement('span');
      num.className = 'rank-num';
      num.textContent = `${p.rank}位`;
      row.appendChild(num);
      const tk = document.createElement('span');
      tk.className = `token token-${p.id}`;
      tk.textContent = p.animal;
      row.appendChild(tk);
      const nm = document.createElement('span');
      nm.className = 'rank-name';
      nm.textContent = `${p.name}（${p.species}）`;
      row.appendChild(nm);
      rankList.appendChild(row);
    });

    showScreen('result');
  }

  // ===== ゲーム開始 =====
  function startGame() {
    state.cells = generateBoard(state.boardLength);
    state.players = [];
    state.finishedCount = 0;
    state.turn = 0;
    state.busy = false;
    for (let i = 0; i < state.playerCount; i++) {
      const def = PLAYERS_DEF[i];
      state.players.push({
        id: i + 1,
        name: def.name,
        animal: def.animal,
        species: def.species,
        pos: 0,
        skipTurns: 0,
        finished: false,
        rank: 0,
      });
    }
    renderBoard();
    renderPlayers();
    updateTurnIndicator();
    diceFaceEl.textContent = '?';
    messageEl.textContent = `${state.players[0].name}：サイコロをふってね！`;
    btnRoll.disabled = false;
    showScreen('game');
  }

  // ===== ユーティリティ =====
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ===== イベント設定 =====
  function setupEvents() {
    // 人数選択
    document.querySelectorAll('.count-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.count-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.playerCount = parseInt(btn.dataset.count, 10);
        sound.click();
      });
    });
    // 長さ選択
    document.querySelectorAll('.length-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.length-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.boardLength = parseInt(btn.dataset.length, 10);
        sound.click();
      });
    });

    // 効果音
    const soundToggle = $('sound-toggle');
    sound.loadPref();
    soundToggle.checked = sound.enabled;
    soundToggle.addEventListener('change', () => {
      sound.setEnabled(soundToggle.checked);
      if (soundToggle.checked) {
        sound.init();
        sound.resume();
        sound.click();
      }
    });

    // はじめる
    $('btn-start').addEventListener('click', () => {
      sound.init();
      sound.resume();
      sound.click();
      startGame();
    });

    // サイコロ
    btnRoll.addEventListener('click', () => {
      sound.init();
      sound.resume();
      takeTurn();
    });

    // タイトルへ
    $('btn-back').addEventListener('click', () => {
      sound.click();
      showScreen('title');
    });
    $('btn-result-back').addEventListener('click', () => {
      sound.click();
      showScreen('title');
    });

    // もう一度
    $('btn-replay').addEventListener('click', () => {
      sound.click();
      startGame();
    });
  }

  // ===== 起動 =====
  setupEvents();
})();
