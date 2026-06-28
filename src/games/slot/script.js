(() => {
  'use strict';

  // ===== 単語プール =====
  const POOLS = [
    // だれが
    [
      'オカメインコが', 'タヌキが', 'おばあちゃんが', '宇宙人が',
      'となりの犬が', '校長先生が', 'ロボットが', 'ペンギンが',
      '妖怪が', 'シェフが', 'アイドルが', '忍者が',
      'ねぼすけが', 'カピバラが', 'サンタさんが', '魔法使いが',
      '赤ちゃんが', 'カエルの王子が', 'ねこ部長が', 'パン屋さんが',
    ],
    // どこで
    [
      'ハワイで', 'トイレで', '月面で', 'コンビニで',
      'ジャングルで', '図書館で', '雲の上で', 'お風呂で',
      '富士山で', '渋谷で', '海底で', '屋根の上で',
      '火山の中で', 'プールで', '回転寿司で', '宇宙ステーションで',
      '満員電車で', '花畑で', '冷蔵庫の中で', '校長室で',
    ],
    // どうする
    [
      'ダッシュする', 'おどる', 'ねむる', 'うたう',
      'さけぶ', 'なく', '食べまくる', 'ジャンプする',
      'ばく笑する', '戦う', 'ころぶ', 'めいそうする',
      'こっそりかくれる', '宙がえりする', '昼寝する', 'ナンパする',
      'スキップする', 'おならをする', 'プロポーズする', '修行する',
    ],
  ];

  const REEL_ITEM_HEIGHT = 64;

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
      try { localStorage.setItem('slot_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('slot_sound');
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
    playerCount: 2,
    currentSlot: 0,    // 0..2
    results: [null, null, null],
    spinning: [false, false, false],
    rafs: [null, null, null],
    spinTimers: [null, null, null],
  };

  // ===== ユーティリティ =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $('#' + id).classList.add('active');
  }

  function rand(n) { return Math.floor(Math.random() * n); }

  function whoseTurn() {
    // プレイヤー数に応じて、currentSlot を担当する人を決める
    // 1人: 全部1人 → プレイヤー1
    // 2人: スロット0=P1, スロット1=P2, スロット2=P1（交互）
    // 3人: スロット0=P1, スロット1=P2, スロット2=P3
    if (state.playerCount === 1) return 1;
    if (state.playerCount === 3) return state.currentSlot + 1;
    // 2人
    return (state.currentSlot % 2) + 1;
  }

  // ===== タイトル画面 =====
  function setupTitle() {
    const modeBtns = $$('.mode-btn');
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.init(); sound.resume(); sound.click();
        modeBtns.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.playerCount = parseInt(btn.dataset.players, 10);
      });
    });

    $('#btn-start').addEventListener('click', () => {
      sound.init(); sound.resume(); sound.click();
      startGame();
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
  function startGame() {
    state.currentSlot = 0;
    state.results = [null, null, null];
    state.spinning = [false, false, false];

    // リールを初期化
    for (let i = 0; i < 3; i++) {
      stopReelAnimation(i);
      const reel = $('#reel-' + i);
      reel.classList.remove('locked', 'spinning');
      const strip = reel.querySelector('.reel-strip');
      strip.style.transform = 'translateY(0)';
      strip.innerHTML = '<div class="reel-item">？？？</div>';
    }

    updateTurnIndicator();
    setMessage('レバーをひいてスタート！');
    $('#btn-spin').textContent = 'レバーをひく';
    $('#btn-spin').disabled = false;
    showScreen('screen-game');
  }

  function updateTurnIndicator() {
    const ind = $('#turn-indicator');
    if (state.currentSlot >= 3) {
      ind.textContent = '完成！';
      ind.classList.remove('spinning');
      return;
    }
    const labels = ['だれが', 'どこで', 'どうする'];
    if (state.playerCount === 1) {
      ind.textContent = `${labels[state.currentSlot]}（${state.currentSlot + 1}つ目）`;
    } else {
      ind.textContent = `プレイヤー${whoseTurn()}のばん（${labels[state.currentSlot]}）`;
    }
    if (state.spinning[state.currentSlot]) {
      ind.classList.add('spinning');
    } else {
      ind.classList.remove('spinning');
    }
  }

  function setMessage(msg) {
    $('#message').textContent = msg;
  }

  function buildSpinStrip(slotIdx, finalIndex) {
    // 高速回転中に見せる十分な長さの帯を組み立てる
    const pool = POOLS[slotIdx];
    const items = [];
    // 多めに繰り返してから最後に finalIndex を置く
    const repeat = 8;
    for (let r = 0; r < repeat; r++) {
      for (let i = 0; i < pool.length; i++) {
        items.push(pool[i]);
      }
    }
    items.push(pool[finalIndex]);
    return items;
  }

  function startReelSpin(slotIdx) {
    if (state.spinning[slotIdx] || state.results[slotIdx] !== null) return;

    const reel = $('#reel-' + slotIdx);
    const strip = reel.querySelector('.reel-strip');

    // 最終結果を先に決めておく
    const finalIndex = rand(POOLS[slotIdx].length);
    const items = buildSpinStrip(slotIdx, finalIndex);
    strip.innerHTML = items.map((t) => `<div class="reel-item">${escapeHtml(t)}</div>`).join('');

    // 結果を保存（停止時に確定）
    state.results[slotIdx] = POOLS[slotIdx][finalIndex];
    state.spinning[slotIdx] = true;
    reel.classList.add('spinning');

    const totalItems = items.length;
    const finalY = -(totalItems - 1) * REEL_ITEM_HEIGHT;

    // スピン中は無限ループ風に動かす（finalY に向かってじわじわ進む見せ方ではなく、
    // 高速ループしてからストップ時にイージングで finalY にスナップ）
    const loopHeight = (POOLS[slotIdx].length) * REEL_ITEM_HEIGHT;
    let y = 0;
    const speed = 1100; // px/sec
    let last = performance.now();

    function frame(now) {
      if (!state.spinning[slotIdx]) return;
      const dt = (now - last) / 1000;
      last = now;
      y -= speed * dt;
      // ループさせる
      while (y <= -loopHeight) y += loopHeight;
      strip.style.transform = `translateY(${y}px)`;
      state.rafs[slotIdx] = requestAnimationFrame(frame);
    }
    last = performance.now();
    state.rafs[slotIdx] = requestAnimationFrame(frame);

    // スピン中の効果音
    state.spinTimers[slotIdx] = setInterval(() => sound.spin(), 80);

    updateTurnIndicator();
  }

  function stopReelAnimation(slotIdx) {
    if (state.rafs[slotIdx]) {
      cancelAnimationFrame(state.rafs[slotIdx]);
      state.rafs[slotIdx] = null;
    }
    if (state.spinTimers[slotIdx]) {
      clearInterval(state.spinTimers[slotIdx]);
      state.spinTimers[slotIdx] = null;
    }
  }

  function stopReel(slotIdx, onDone) {
    if (!state.spinning[slotIdx]) return;
    stopReelAnimation(slotIdx);
    state.spinning[slotIdx] = false;

    const reel = $('#reel-' + slotIdx);
    const strip = reel.querySelector('.reel-strip');
    reel.classList.remove('spinning');

    // 現在のtranslateY値を取得
    const m = strip.style.transform.match(/translateY\(([-\d.]+)px\)/);
    const currentY = m ? parseFloat(m[1]) : 0;

    // 最終位置：strip の最後の要素（finalIndex を置いた位置）の見える位置に来る
    // strip の総アイテム数
    const totalItems = strip.children.length;
    const finalY = -(totalItems - 1) * REEL_ITEM_HEIGHT;

    // currentY から finalY まで、滑らかに減速して止める
    // 360°内のループ位置を考慮し、currentY からマイナス方向に進めて finalY に到達させる
    const loopHeight = POOLS[slotIdx].length * REEL_ITEM_HEIGHT;
    let normY = currentY;
    while (normY > 0) normY -= loopHeight;
    while (normY <= -loopHeight) normY += loopHeight;
    // 目標までの差分（必ずマイナス方向に進む）
    let delta = finalY - normY;
    while (delta > 0) delta -= loopHeight;
    // 最低でも1ループは回したい
    if (delta > -loopHeight * 0.6) delta -= loopHeight;

    const startY = normY;
    const endY = normY + delta;
    const duration = 800;
    const t0 = performance.now();

    function ease(t) {
      // easeOutCubic
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
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function onSpinButton() {
    sound.init(); sound.resume();
    const idx = state.currentSlot;
    if (idx >= 3) return;

    if (!state.spinning[idx] && state.results[idx] === null) {
      // スピン開始
      sound.click();
      startReelSpin(idx);
      $('#btn-spin').textContent = 'ストップ！';
      setMessage('タイミングよくストップ！');
    } else if (state.spinning[idx]) {
      // 停止
      $('#btn-spin').disabled = true;
      stopReel(idx, () => {
        // 次の人へ
        state.currentSlot += 1;
        if (state.currentSlot >= 3) {
          // 完了
          setMessage('ぜんぶ そろった！');
          updateTurnIndicator();
          setTimeout(() => showResult(), 700);
        } else {
          updateTurnIndicator();
          setMessage('レバーをひいてスタート！');
          $('#btn-spin').textContent = 'レバーをひく';
          $('#btn-spin').disabled = false;
        }
      });
    }
  }

  // ===== 結果画面 =====
  const COMMENTS = [
    'なんだかへんてこ！', 'シュールだね…', 'ありえなさすぎ！',
    '名作の予感！', 'なぞの説得力！', 'こわい！', '笑える！',
    '深い…のかも？', 'もう一回やろう！', 'すごい組み合わせ！',
  ];

  function showResult() {
    sound.cheer();
    for (let i = 0; i < 3; i++) {
      $('#result-part-' + i).textContent = state.results[i] || '―';
    }
    $('#result-comment').textContent = COMMENTS[rand(COMMENTS.length)];
    showScreen('screen-result');
  }

  // ===== ボタン束ね =====
  function setupGame() {
    $('#btn-spin').addEventListener('click', onSpinButton);
    $('#btn-back').addEventListener('click', () => {
      sound.click();
      cleanupReels();
      showScreen('screen-title');
    });
  }

  function cleanupReels() {
    for (let i = 0; i < 3; i++) stopReelAnimation(i);
    state.spinning = [false, false, false];
  }

  function setupResult() {
    $('#btn-replay').addEventListener('click', () => {
      sound.click();
      startGame();
    });
    $('#btn-result-back').addEventListener('click', () => {
      sound.click();
      showScreen('screen-title');
    });
  }

  // ===== 初期化 =====
  function init() {
    setupTitle();
    setupGame();
    setupResult();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
