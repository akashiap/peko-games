(() => {
  'use strict';

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
      try { localStorage.setItem('okameran_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('okameran_sound');
        if (v === '0') this.enabled = false;
      } catch (e) {}
    },
    beep(freq, dur, type = 'sine', vol = 0.18) {
      if (!this.enabled || !this.ctx) return;
      try {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = 0;
        o.connect(g); g.connect(this.ctx.destination);
        const t = this.ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t);
        o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    seq(list) {
      let d = 0;
      for (const [f, dur, type, vol] of list) {
        setTimeout(() => this.beep(f, dur, type || 'square', vol || 0.16), d * 1000);
        d += dur * 0.7;
      }
    },
    jump()    { this.beep(700, 0.10, 'square',   0.14); },
    bump()    { this.beep(180, 0.06, 'square',   0.16); },
    coin()    { this.beep(990, 0.05, 'sine',     0.16); setTimeout(() => this.beep(1320, 0.09, 'sine', 0.16), 50); },
    powerup() { this.seq([[523, .08],[659, .08],[784, .08],[1046, .14]]); },
    fire()    { this.beep(880, 0.05, 'sawtooth', 0.10); },
    stomp()   { this.beep(380, 0.08, 'triangle', 0.16); },
    kick()    { this.beep(220, 0.10, 'square',   0.14); },
    hurt()    { this.seq([[330, .10, 'square', .18], [220, .14, 'square', .18]]); },
    die()     { this.seq([[440, .14, 'triangle', .18],[330, .14, 'triangle', .18],[220, .26, 'triangle', .18]]); },
    clear()   { this.seq([[523, .12],[659, .12],[784, .12],[1046, .12],[784, .12],[1046, .26]]); },
    flag()    { this.beep(660, 0.08, 'sine', 0.14); setTimeout(() => this.beep(880, 0.16, 'sine', 0.14), 80); },
  };

  // ===== 定数 =====
  const TILE = 24;
  const VIEW_W = 480;
  const VIEW_H = 288;
  const ROWS = VIEW_H / TILE; // 12
  const GRAVITY = 0.55;
  const MAX_FALL = 11;
  const RUN_SPEED = 2.6;

  // 難易度別パラメータ
  const JUMP_VEL_BY_LEVEL = [0, -12.5, -12, -11.5];
  const TIME_BY_LEVEL = [0, 260, 200, 150];
  const HINT_BY_LEVEL = ['', 'やさしい', 'ふつう', 'むずかしい'];

  // ===== レベルデータ =====
  // 文字: ' '=空, '#'=地面(壊れない), 'B'=ブロック(大きいと壊せる),
  //       'M'=ブロック+ミカン, 'C'=ブロック+とうもろこし, 'G'=空中の宝石,
  //       'c'=猫, 'k'=ワシ
  // M / C は普通の B ブロックに変換され、その上にアイテムが置かれる。
  // G は空中に浮いている宝石（点数のみ）。タイル自体は空気。
  // 難易度に応じて違うコースを連結する。Lv1 はセグメント1のみ。Lv2 はセグメント1+2。Lv3 はセグメント1+2+3。
  const LEVEL_SEGMENTS = [
    // ===== セグメント1: 既存レイアウト（オープニング） =====
    [
      "",
      "",
      "",
      "",
      "",
      "       G                         G                                    G                                       G                        G",
      "             BBB       BMB            BBBBB         BBBBCBBBB                               BBB                         BBB               BBCBB     BBB",
      "",
      "                              k                              k                            k                        k                             k",
      "                                            MBBB                                          #",
      "                  c          c                                  c         c               ##        c                                       c",
      "##############################  ################################################  #################################################  ################################",
    ],
    // ===== セグメント2: ブロック群とワシ多めの空中ステージ =====
    [
      "",
      "",
      "",
      "",
      "",
      "   G        G        G        G                              G        G        G                              G        G        G",
      "                              BBBBBB              BBBB              BBBBBBB              BBCBBB              BBBB              BBBBB",
      "",
      "     k        k        k        k        k        k        k        k        k        k        k        k        k        k        k",
      "                                                                                  BBBB                              MBBB",
      "           c              c              c              c              c              c              c              c              c          c",
      "############  ############  ############  ############  ############  ############  ############  ############  ############  ############  ############  ###########",
    ],
    // ===== セグメント3: 細かい足場と敵の連続 =====
    [
      "",
      "",
      "",
      "   G G G                                       G G G                                       G G G                              G G G G",
      "",
      "     G   G   G                G   G   G                G   G   G                G   G   G                G   G   G                  G",
      "             BBBMBB              BBBBBBB              BBCBB              BBMBBB              BBBBBBC              BBBB              BBBB",
      "",
      "        k          k        k          k        k          k        k          k        k          k        k          k        k          k",
      "     BB        BB        BB        BB        BB        BB        BB        BB        BB        BB        BB        BB        BB        BB        BB",
      "  c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c   c",
      "##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  ##########  #########",
    ],
  ];
  const BASE_LEVEL_W = 165;
  const BASE_GOAL_OFFSET = 10; // ゴール後の余白（コラム数）
  // 難易度に応じて長さが変わる: 難易度N → BASE_LEVEL_W × N
  let LEVEL_W = BASE_LEVEL_W;
  let GOAL_COL = BASE_LEVEL_W - BASE_GOAL_OFFSET; // オカメインコの家（鳥かご）の中心

  let grid = [];
  let enemySpawns = [];
  let itemSpawns = [];

  function buildLevel() {
    // 難易度別の長さ倍率（Lv1=1, Lv2=2, Lv3=3）— セグメント数の上限まで
    const factor = Math.max(1, Math.min(LEVEL_SEGMENTS.length, game.level | 0));
    LEVEL_W = BASE_LEVEL_W * factor;
    GOAL_COL = LEVEL_W - BASE_GOAL_OFFSET;
    grid = [];
    enemySpawns = [];
    itemSpawns = [];
    const SPACE_PAD = '                                                                                                                                              ';
    for (let r = 0; r < ROWS; r++) {
      // 難易度に応じて異なるセグメントを連結（毎セグメントを BASE_LEVEL_W に揃えてから結合）
      let padded = '';
      for (let s = 0; s < factor; s++) {
        const seg = LEVEL_SEGMENTS[s];
        const src = (seg[r] || '');
        padded += (src + SPACE_PAD).slice(0, BASE_LEVEL_W);
      }
      const row = [];
      for (let c = 0; c < LEVEL_W; c++) {
        const ch = padded[c] || ' ';
        if (ch === 'c' || ch === 'k') {
          enemySpawns.push({ col: c, row: r, type: ch === 'c' ? 'cat' : 'eagle', spawned: false });
          row.push(' ');
        } else if (ch === 'M' || ch === 'C') {
          // 普通のブロックに変換しつつ、その上に置くアイテムを記録
          itemSpawns.push({ col: c, row: r, kind: ch === 'M' ? 'mikan' : 'corn', onBrick: true });
          row.push('B');
        } else if (ch === 'G') {
          // 空中の宝石: 自身は空気タイルだがアイテムが浮かぶ
          itemSpawns.push({ col: c, row: r, kind: 'gem', onBrick: false });
          row.push(' ');
        } else {
          row.push(ch);
        }
      }
      grid.push(row);
    }
  }

  function tileAt(c, r) {
    if (r < 0 || r >= ROWS || c < 0 || c >= LEVEL_W) return ' ';
    return grid[r][c];
  }
  function setTile(c, r, ch) {
    if (r < 0 || r >= ROWS || c < 0 || c >= LEVEL_W) return;
    grid[r][c] = ch;
  }
  function isSolid(ch) {
    return ch === '#' || ch === 'B';
  }

  // ===== 状態 =====
  const player = {
    x: 32, y: 0,
    vx: 0, vy: 0,
    w: 18, h: 22,
    state: 'small', // 'small' | 'big' （サイズのみ。無敵かどうかは flapTimer で別管理）
    growStage: 0,   // 0 = ちび、1 = ふつう、2 以上 = みかんで段階的にでかくなる
    onGround: false,
    invuln: 0,
    alive: true,
    frame: 0,
    starJump: 0,    // クリア後の演出用
    cleared: false,
    deadTimer: 0,
    bumpAnim: 0,
    growAnim: 0,
    flapTimer: 0,   // とうもろこしで発動する無敵時間（フレーム）。サイズ状態とは独立
  };

  const game = {
    score: 0,
    high: 0,
    lives: 3,
    timeLeft: 200,
    timeFrames: 0,
    level: 2,
    running: false,
    paused: false,
    finishTimer: 0,
  };

  const enemies = [];   // {x,y,vx,vy,w,h,type,onGround,alive,dyingTimer,frame,sineT,baseY}
  const items = [];     // {x,y,vx,vy,w,h,kind,emerging,emergeY,onGround}
  const fireballs = []; // {x,y,vx,vy,r,life,bounceCount}
  const particles = []; // {x,y,vx,vy,life,kind,color}
  const popups = [];    // {x,y,life,text}
  const camera = { x: 0 };

  let inputJump = false;
  let jumpEdge = false; // press edge for variable height
  let inputFire = false;
  let fireEdge = false;

  function loadHigh() {
    try {
      const v = parseInt(localStorage.getItem('okameran_high') || '0', 10);
      if (v > 0) game.high = v;
    } catch (e) {}
  }
  function saveHigh() {
    try { localStorage.setItem('okameran_high', String(game.high)); } catch (e) {}
  }

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const screens = {
    title: $('screen-title'),
    game: $('screen-game'),
    result: $('screen-result'),
  };
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  const canvas = $('board');
  const ctx = canvas.getContext('2d');

  // ===== オカメインコのスプライト（okame.svg）=====
  // SVG は背景が透明なので白抜き処理は不要。ゲーム向けサイズへラスタライズして、
  // 念のため bbox を検出して余白をクロップする。
  const okameSprite = { canvas: null, w: 0, h: 0, ready: false, useRaw: false, rawImg: null };
  function loadOkameSprite() {
    const img = new Image();
    img.onload = () => {
      okameSprite.rawImg = img;
      try {
        // (1) 高品質サイズ（高さ192）でラスタライズ
        const TARGET_H = 192;
        const natW = img.naturalWidth  || 160;
        const natH = img.naturalHeight || 100;
        const ratio = natW / natH;
        const tw = Math.max(1, Math.round(TARGET_H * ratio));
        const raster = document.createElement('canvas');
        raster.width = tw;
        raster.height = TARGET_H;
        const rctx = raster.getContext('2d');
        rctx.imageSmoothingEnabled = true;
        rctx.imageSmoothingQuality = 'high';
        rctx.drawImage(img, 0, 0, tw, TARGET_H);

        // (2) bbox 検出（透明ピクセル alpha=0 なので 32 超で判定）
        const data = rctx.getImageData(0, 0, tw, TARGET_H);
        const px = data.data;
        let minX = tw, minY = TARGET_H, maxX = -1, maxY = -1;
        for (let y = 0; y < TARGET_H; y++) {
          for (let x = 0; x < tw; x++) {
            if (px[(y * tw + x) * 4 + 3] > 32) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // (3) bbox にクロップ（余白がある場合のみ）
        if (maxX >= 0 &&
            (minX > 0 || minY > 0 || maxX < tw - 1 || maxY < TARGET_H - 1)) {
          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          const out = document.createElement('canvas');
          out.width = bw;
          out.height = bh;
          out.getContext('2d').drawImage(raster, -minX, -minY);
          okameSprite.canvas = out;
          okameSprite.w = bw;
          okameSprite.h = bh;
        } else {
          okameSprite.canvas = raster;
          okameSprite.w = tw;
          okameSprite.h = TARGET_H;
        }
      } catch (e) {
        // getImageData が拒否される等の場合は、加工なしで元画像を直接使う
        console.warn('okame sprite processing failed, falling back to raw image:', e);
        okameSprite.useRaw = true;
        okameSprite.canvas = img;
        okameSprite.w = img.naturalWidth  || 160;
        okameSprite.h = img.naturalHeight || 100;
      }
      okameSprite.ready = true;
    };
    img.onerror = () => {
      console.warn('okame.svg load failed');
      okameSprite.ready = false;
    };
    img.src = 'img/okame.svg';
  }

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(VIEW_W * dpr);
    canvas.height = Math.round(VIEW_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function updateUI() {
    $('score-value').textContent = game.score;
    $('lives-value').textContent = Math.max(0, game.lives);
    $('time-value').textContent = Math.max(0, Math.floor(game.timeLeft));
    // 無敵モード中は「むてき」ボタンが点灯
    const fireBtn = $('btn-fire');
    if (fireBtn) {
      fireBtn.classList.toggle('disabled', player.flapTimer <= 0);
      fireBtn.textContent = player.flapTimer > 0
        ? `むてき ${Math.ceil(player.flapTimer / 60)}`
        : 'むてき';
    }
  }

  let messageTimer = 0;
  function setMessage(text, ms = 1300) {
    const el = $('message');
    el.textContent = text;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    messageTimer = ms;
  }
  function tickMessage(dtMs) {
    if (messageTimer > 0) {
      messageTimer -= dtMs;
      if (messageTimer <= 0) $('message').textContent = '';
    }
  }

  // ===== AABB 衝突判定（プレイヤー vs タイル） =====
  function moveAndCollide(ent, dx, dy) {
    // X方向
    ent.x += dx;
    if (dx !== 0) {
      const dir = dx > 0 ? 1 : -1;
      const probeX = dir > 0 ? ent.x + ent.w : ent.x;
      const c = Math.floor(probeX / TILE) - (dir < 0 && probeX % TILE === 0 ? 1 : 0);
      const r0 = Math.floor(ent.y / TILE);
      const r1 = Math.floor((ent.y + ent.h - 0.01) / TILE);
      let collided = false;
      for (let r = r0; r <= r1; r++) {
        if (isSolid(tileAt(c, r))) { collided = true; break; }
      }
      if (collided) {
        if (dir > 0) ent.x = c * TILE - ent.w - 0.001;
        else ent.x = (c + 1) * TILE + 0.001;
        ent.vx = 0;
        ent._hitWallX = dir;
      } else {
        ent._hitWallX = 0;
      }
    }
    // Y方向
    ent.y += dy;
    if (dy !== 0) {
      ent.onGround = false;
      const dir = dy > 0 ? 1 : -1;
      const probeY = dir > 0 ? ent.y + ent.h : ent.y;
      const r = Math.floor(probeY / TILE) - (dir < 0 && probeY % TILE === 0 ? 1 : 0);
      const c0 = Math.floor(ent.x / TILE);
      const c1 = Math.floor((ent.x + ent.w - 0.01) / TILE);
      let collided = false;
      let hitCol = -1;
      for (let c = c0; c <= c1; c++) {
        if (isSolid(tileAt(c, r))) { collided = true; hitCol = c; break; }
      }
      if (collided) {
        if (dir > 0) {
          ent.y = r * TILE - ent.h - 0.001;
          ent.onGround = true;
        } else {
          ent.y = (r + 1) * TILE + 0.001;
          ent._headHitCol = hitCol;
          ent._headHitRow = r;
        }
        ent.vy = 0;
      }
    }
  }

  // ===== プレイヤー =====
  const MAX_GROW_STAGE = 2;     // 0=ちび, 1=ふつう, 2=でかい（みかんで段階的に成長）
  const GROW_STEP_RATIO = 1.42; // ふつう以降、1段階あたりのサイズ倍率

  function setPlayerStage(stage) {
    const s = Math.max(0, Math.min(MAX_GROW_STAGE, stage));
    const prevH = player.h;
    if (s === 0) {
      player.w = 18; player.h = 22;
      player.state = 'small';
    } else {
      const factor = Math.pow(GROW_STEP_RATIO, s - 1);
      player.w = Math.round(42 * factor);
      player.h = Math.round(52 * factor);
      player.state = 'big';
    }
    player.growStage = s;
    // 大きさが変わった分、足元を維持
    player.y -= (player.h - prevH);
    // 巨大化でブロックや地面に挟まった場合の救済
    resolvePlayerStuck();
  }
  // 後方互換のラッパー（既存の呼び出し箇所のため残す）
  function setPlayerState(newState) {
    setPlayerStage(newState === 'small' ? 0 : 1);
  }

  // プレイヤーの bbox に重なっているソリッドタイルを探して、可能なら破壊／不可なら横に押し出す
  function resolvePlayerStuck() {
    const overlappingTiles = () => {
      const out = [];
      const c0 = Math.floor(player.x / TILE);
      const c1 = Math.floor((player.x + player.w - 0.01) / TILE);
      const r0 = Math.floor(player.y / TILE);
      const r1 = Math.floor((player.y + player.h - 0.01) / TILE);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (isSolid(tileAt(c, r))) out.push({ c, r });
        }
      }
      return out;
    };

    // (1) まず、重なっているブロックのうち壊せるもの（'B'）を破壊
    let blockers = overlappingTiles();
    if (blockers.length === 0) return;
    for (const t of blockers) {
      if (tileAt(t.c, t.r) === 'B') {
        setTile(t.c, t.r, ' ');
        sound.kick();
        addScore(20, t.c * TILE + TILE / 2, t.r * TILE);
        for (let i = 0; i < 6; i++) {
          particles.push({
            x: t.c * TILE + TILE / 2,
            y: t.r * TILE + TILE / 2,
            vx: (Math.random() - 0.5) * 5,
            vy: -3 - Math.random() * 3,
            life: 50,
            kind: 'brick',
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 0.4,
          });
        }
      }
    }

    // (2) まだ壊せないタイルに重なっていれば、左右に押し出して空きを探す
    blockers = overlappingTiles();
    if (blockers.length === 0) return;
    const fits = (px) => {
      const c0 = Math.floor(px / TILE);
      const c1 = Math.floor((px + player.w - 0.01) / TILE);
      const r0 = Math.floor(player.y / TILE);
      const r1 = Math.floor((player.y + player.h - 0.01) / TILE);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (isSolid(tileAt(c, r))) return false;
        }
      }
      return true;
    };
    // 1px ずつ右→左→右→… と探していき、最大 2 タイル分まで動かす
    for (let d = 1; d <= TILE * 2; d++) {
      if (fits(player.x + d)) { player.x += d; return; }
      if (fits(player.x - d)) { player.x -= d; return; }
    }
    // (3) どうしても収まらない最後の手段：頭上の使用済ブロック ('U') も砕く
    for (const t of overlappingTiles()) {
      if (tileAt(t.c, t.r) === 'U') setTile(t.c, t.r, ' ');
    }
  }

  function spawnPlayer() {
    setPlayerState('small');
    player.x = 32;
    player.y = (ROWS - 2) * TILE - player.h;
    player.vx = 0;
    player.vy = 0;
    player.invuln = 0;
    player.alive = true;
    player.cleared = false;
    player.starJump = 0;
    player.deadTimer = 0;
    player.bumpAnim = 0;
    player.growAnim = 0;
    player.flapTimer = 0;
  }

  function damagePlayer() {
    if (player.invuln > 0 || !player.alive || player.cleared) return;
    // とうもろこしの無敵モード中はノーダメージ
    if (player.flapTimer > 0) return;
    if (player.growStage > 0) {
      setPlayerStage(player.growStage - 1);
      player.invuln = 90;
      sound.hurt();
      player.growAnim = -20;
    } else {
      killPlayer();
    }
  }

  function killPlayer() {
    if (!player.alive) return;
    player.alive = false;
    player.deadTimer = 90;
    player.vy = -10;
    player.vx = 0;
    sound.die();
  }

  function clearPlayer() {
    if (player.cleared) return;
    player.cleared = true;
    game.finishTimer = 120;
    sound.flag();
    setTimeout(() => sound.clear(), 280);
    setMessage('ただいま！', 1600);
  }

  // ===== ブロック叩き =====
  function hitBlockFromBelow(c, r) {
    const ch = tileAt(c, r);
    if (ch === 'B') {
      // ブロックの上にアイテムが乗っているなら、それも一緒に飛ばす（演出兼回収）
      for (const it of items) {
        if (!it._dead && it.brickCol === c && it.brickRow === r) {
          it._popped = true;     // ぴょんと跳ねるアニメ
          it._popVy = -4;
          it._popLife = 30;
        }
      }
      if (player.state !== 'small') {
        // 壊す
        setTile(c, r, ' ');
        sound.kick();
        addScore(20, c * TILE + TILE / 2, r * TILE);
        // 破片
        for (let i = 0; i < 6; i++) {
          particles.push({
            x: c * TILE + TILE / 2,
            y: r * TILE + TILE / 2,
            vx: (Math.random() - 0.5) * 5,
            vy: -3 - Math.random() * 3,
            life: 50,
            kind: 'brick',
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 0.4,
          });
        }
      } else {
        sound.bump();
        addParticle(c * TILE + TILE / 2, r * TILE, 'blockbump', { col: c, row: r });
        // 上に乗っている敵にヒット（簡易：上のタイルにいる敵）
        for (const e of enemies) {
          if (!e.alive) continue;
          if (e.y + e.h <= r * TILE + 4 && e.y + e.h >= r * TILE - 8) {
            const ec = (e.x + e.w / 2) / TILE;
            if (ec >= c - 0.5 && ec <= c + 1.5) killEnemy(e, true);
          }
        }
      }
    }
  }

  // レベル開始時に itemSpawns の情報をもとにアイテムを配置する
  function spawnInitialItems() {
    items.length = 0;
    for (const s of itemSpawns) {
      const isGem = s.kind === 'gem';
      // 宝石サイズ: 横幅を前回の半分に縮め、縦幅はそのまま
      const w = isGem ? Math.round((TILE - 4) * 1.5) : TILE - 4;  // 30
      const h = isGem ? Math.round((TILE - 4) * 1.5) : TILE - 4;  // 30
      // ブロックの上に乗せる場合は s.row が「ブロック行」、その 1 つ上に置く。
      // 宝石など空中アイテムは s.row 自体が配置位置（タイル中央）
      const baseY = s.onBrick ? (s.row * TILE - h) : (s.row * TILE + (TILE - h) / 2);
      items.push({
        brickCol: s.onBrick ? s.col : -1,
        brickRow: s.onBrick ? s.row : -1,
        x: s.col * TILE + (TILE - w) / 2,
        baseY,
        y: baseY,
        w, h,
        kind: s.kind,
        bornFrame: game.timeFrames,
      });
    }
  }

  // ===== アイテム（ブロックの上に静止し、プレイヤーが触れたら効果発動） =====
  function updateItems() {
    for (const it of items) {
      if (it._dead) continue;
      // ブロックを下から叩かれたときの「ぴょん」アニメ
      if (it._popped) {
        it.y += it._popVy;
        it._popVy += 0.35;
        it._popLife--;
        if (it._popLife <= 0 || it.y >= it.baseY) {
          it.y = it.baseY;
          it._popped = false;
          it._popVy = 0;
        }
      } else {
        // 軽くふわふわ浮く（注目を引く演出）
        it.y = it.baseY + Math.sin((game.timeFrames + it.brickCol * 8) * 0.08) * 1.2;
      }
      // プレイヤーとの接触で効果発動
      if (player.alive && !player.cleared && aabb(it, player)) {
        applyItemEffect(it.kind, it.x + it.w / 2, it.y);
        it._dead = true;
      }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]._dead) items.splice(i, 1);
    }
  }

  function applyItemEffect(kind, popX, popY) {
    const px = popX != null ? popX : (player.x + player.w / 2);
    const py = popY != null ? popY : player.y;
    if (kind === 'mikan') {
      if (player.growStage < MAX_GROW_STAGE) {
        const wasSmall = player.growStage === 0;
        setPlayerStage(player.growStage + 1);
        player.growAnim = 30;
        sound.powerup();
        addScore(wasSmall ? 1000 : 600, px, py);
      } else {
        // これ以上大きくなれない（最大サイズ）
        addScore(200, px, py);
        sound.coin();
      }
    } else if (kind === 'corn') {
      // とうもろこし: 5 秒間の無敵（羽ばたきモード）。サイズは変えない。
      // 小さいまま取れば小さいまま無敵になり、終わっても小さいまま。
      player.flapTimer = 300; // 60fps × 5 秒
      player.invuln = 0;       // 既存のダメージ点滅を打ち消す
      sound.powerup();
      addScore(1500, px, py);
    } else if (kind === 'gem') {
      // 宝石: 点数だけ獲得
      sound.coin();
      addScore(500, px, py);
    }
  }

  // ===== 敵 =====
  function spawnEnemiesInView() {
    const visMin = camera.x / TILE - 2;
    const visMax = (camera.x + VIEW_W) / TILE + 4;
    for (const s of enemySpawns) {
      if (s.spawned) continue;
      if (s.col >= visMin && s.col <= visMax && s.col > player.x / TILE - 2) {
        s.spawned = true;
        if (s.type === 'cat') {
          enemies.push({
            x: s.col * TILE,
            y: s.row * TILE - 8, // 大きくなった分だけ少し上から開始
            vx: -1.0,
            vy: 0,
            w: 30,
            h: 30,
            type: 'cat',
            onGround: false,
            alive: true,
            dyingTimer: 0,
            frame: 0,
          });
        } else {
          enemies.push({
            x: s.col * TILE,
            y: s.row * TILE,
            vx: -1.5,
            vy: 0,
            w: 38,
            h: 26,
            type: 'eagle',
            onGround: false,
            alive: true,
            dyingTimer: 0,
            frame: 0,
            baseY: s.row * TILE,
            sineT: 0,
          });
        }
      }
    }
  }

  function updateEnemies() {
    for (const e of enemies) {
      e.frame++;
      if (!e.alive) {
        e.dyingTimer--;
        e.vy += GRAVITY;
        e.y += e.vy;
        e.x += e.vx;
        if (e.dyingTimer <= 0 || e.y > VIEW_H + 80) e._dead = true;
        continue;
      }
      if (e.type === 'cat') {
        e.vy = Math.min(MAX_FALL, e.vy + GRAVITY);
        moveAndCollide(e, e.vx, 0);
        if (e._hitWallX !== 0) e.vx = -e.vx;
        moveAndCollide(e, 0, e.vy);
        // 端で折り返し（足元の崖検出）
        if (e.onGround) {
          const probeX = (e.vx > 0) ? e.x + e.w + 1 : e.x - 1;
          const probeR = Math.floor((e.y + e.h + 2) / TILE);
          const probeC = Math.floor(probeX / TILE);
          if (!isSolid(tileAt(probeC, probeR))) {
            e.vx = -e.vx;
          }
        }
      } else if (e.type === 'eagle') {
        e.sineT += 0.08;
        e.x += e.vx;
        e.y = e.baseY + Math.sin(e.sineT) * 18;
      }
      // 画面外に大きくはみ出したら除去
      if (e.x + e.w < camera.x - 200 || e.y > VIEW_H + 100) e._dead = true;
      // プレイヤーとの判定
      if (player.alive && !player.cleared && aabb(e, player)) {
        if (player.flapTimer > 0) {
          // 無敵モード: 触れた敵は吹き飛ばす
          killEnemyByFire(e);
        } else {
          // 上から踏んだ判定: プレイヤーの下端が敵の上端付近、かつ落下中
          const playerBottom = player.y + player.h;
          const enemyTop = e.y;
          if (player.vy > 1.2 && playerBottom <= enemyTop + 14) {
            killEnemy(e, false);
            player.vy = -8.5; // バウンド
            if (inputJump) player.vy = -10;
          } else {
            damagePlayer();
          }
        }
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i]._dead) enemies.splice(i, 1);
    }
  }

  function killEnemy(e, byBlock) {
    if (!e.alive) return;
    e.alive = false;
    e.vy = -6;
    e.vx = byBlock ? 0 : 0;
    e.dyingTimer = 60;
    sound.stomp();
    addScore(100, e.x + e.w / 2, e.y);
  }

  function killEnemyByFire(e) {
    if (!e.alive) return;
    e.alive = false;
    e.vy = -5;
    e.vx = 1.5 * (Math.random() < 0.5 ? -1 : 1);
    e.dyingTimer = 70;
    sound.kick();
    addScore(200, e.x + e.w / 2, e.y);
  }

  // ===== 火の玉 =====
  function shootFire() {
    if (player.state !== 'fire' || !player.alive || player.cleared) return;
    if (fireballs.length >= 2) return;
    fireballs.push({
      x: player.x + player.w,
      y: player.y + player.h * 0.4,
      vx: 5.5,
      vy: 0,
      r: 6,
      life: 90,
      bounceCount: 0,
    });
    sound.fire();
  }

  function updateFireballs() {
    for (const f of fireballs) {
      f.life--;
      f.vy = Math.min(MAX_FALL, f.vy + GRAVITY * 0.6);
      // 移動と簡易衝突
      const ent = { x: f.x - f.r, y: f.y - f.r, w: f.r * 2, h: f.r * 2, vx: f.vx, vy: f.vy };
      moveAndCollide(ent, f.vx, 0);
      if (ent._hitWallX !== 0) { f.life = 0; }
      moveAndCollide(ent, 0, f.vy);
      if (ent.onGround) {
        f.vy = -5;
        f.bounceCount++;
        if (f.bounceCount > 3) f.life = 0;
      }
      f.x = ent.x + f.r;
      f.y = ent.y + f.r;
      if (f.x < camera.x - 40 || f.x > camera.x + VIEW_W + 40 || f.y > VIEW_H + 40) {
        f.life = 0;
      }
      // 敵判定
      for (const e of enemies) {
        if (!e.alive) continue;
        if (f.x + f.r > e.x && f.x - f.r < e.x + e.w &&
            f.y + f.r > e.y && f.y - f.r < e.y + e.h) {
          killEnemyByFire(e);
          f.life = 0;
        }
      }
    }
    for (let i = fireballs.length - 1; i >= 0; i--) {
      if (fireballs[i].life <= 0) fireballs.splice(i, 1);
    }
  }

  // ===== ユーティリティ =====
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function addScore(pts, x, y) {
    game.score += pts;
    popups.push({ x, y, text: '+' + pts, life: 40 });
    updateUI();
  }
  function addParticle(x, y, kind, extra = {}) {
    particles.push({ x, y, kind, life: 12, ...extra });
  }
  function tickPopups() {
    for (const p of popups) { p.y -= 0.6; p.life--; }
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].life <= 0) popups.splice(i, 1);
  }
  function tickParticles() {
    for (const p of particles) {
      if (p.kind === 'brick') {
        p.vy = Math.min(MAX_FALL, (p.vy || 0) + GRAVITY);
        p.x += p.vx;
        p.y += p.vy;
        p.rot = (p.rot || 0) + (p.vr || 0);
      }
      p.life--;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  }

  // ===== プレイヤー更新 =====
  function updatePlayer() {
    if (player.invuln > 0) player.invuln--;
    if (player.bumpAnim > 0) player.bumpAnim--;
    player.frame++;
    if (player.growAnim !== 0) {
      player.growAnim += player.growAnim > 0 ? -1 : 1;
    }
    // とうもろこしの無敵時間: カウントダウンのみ。サイズはいじらない。
    if (player.flapTimer > 0) {
      player.flapTimer--;
      if (player.flapTimer % 60 === 0) updateUI(); // 残秒数表示の更新（1 秒毎）
      if (player.flapTimer === 0) {
        sound.coin();
        updateUI();
      }
    }

    if (!player.alive) {
      player.deadTimer--;
      player.vy += GRAVITY * 0.5;
      player.y += player.vy;
      if (player.deadTimer <= 0) {
        afterDeath();
      }
      return;
    }

    if (player.cleared) {
      // 鳥かごの中で停止し、地面に着地するまで落下
      player.vx = 0;
      player.vy = Math.min(MAX_FALL, player.vy + GRAVITY);
      moveAndCollide(player, 0, player.vy);
      return;
    }

    // 横移動: 自動で右へ
    let speed = RUN_SPEED;
    if (game.timeFrames < 30) speed *= game.timeFrames / 30; // スタート時の助走
    moveAndCollide(player, speed, 0);

    // ジャンプ
    if (jumpEdge && player.onGround) {
      player.vy = JUMP_VEL_BY_LEVEL[game.level];
      player.onGround = false;
      sound.jump();
    }
    jumpEdge = false;

    // 可変ジャンプ高さ
    let g = GRAVITY;
    if (player.vy < 0 && inputJump) g *= 0.55;
    player.vy = Math.min(MAX_FALL, player.vy + g);

    // 縦移動
    player._headHitCol = -1;
    moveAndCollide(player, 0, player.vy);
    if (player._headHitCol >= 0) {
      // ブロックの下端にヒット
      const probeC0 = Math.floor(player.x / TILE);
      const probeC1 = Math.floor((player.x + player.w - 0.01) / TILE);
      const r = player._headHitRow;
      // プレイヤーの中心に近いブロックを叩く
      const cx = player.x + player.w / 2;
      let bestC = probeC0;
      let bestD = Infinity;
      for (let c = probeC0; c <= probeC1; c++) {
        if (!isSolid(tileAt(c, r))) continue;
        const d = Math.abs((c + 0.5) * TILE - cx);
        if (d < bestD) { bestD = d; bestC = c; }
      }
      hitBlockFromBelow(bestC, r);
      player.bumpAnim = 8;
    }

    // 落下死
    if (player.y > VIEW_H + 30) {
      killPlayer();
    }

    // ゴール
    if (player.x + player.w / 2 >= GOAL_COL * TILE) {
      clearPlayer();
    }
  }

  function afterDeath() {
    game.lives--;
    if (game.lives <= 0) {
      endGame(false);
    } else {
      // 復帰
      enemies.length = 0;
      items.length = 0;
      fireballs.length = 0;
      particles.length = 0;
      popups.length = 0;
      // スポーンフラグを使用済みのまま戻すと進行不能になるので、リセット
      for (const s of enemySpawns) s.spawned = false;
      spawnInitialItems();
      spawnPlayer();
      camera.x = 0;
      game.timeLeft = TIME_BY_LEVEL[game.level];
      setMessage(`のこり ${game.lives} かい`, 1200);
    }
    updateUI();
  }

  // ===== カメラ =====
  function updateCamera() {
    const target = player.x - VIEW_W * 0.35;
    camera.x = Math.max(0, Math.min(LEVEL_W * TILE - VIEW_W, target));
  }

  // ===== タイマー =====
  function updateTimer() {
    if (!game.running || player.cleared || !player.alive) return;
    game.timeFrames++;
    if (game.timeFrames % 60 === 0) {
      game.timeLeft--;
      if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        killPlayer();
      }
      updateUI();
    }
  }

  // ===== 描画 =====
  function render() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawSky();
    drawClouds();
    drawBuildings();
    drawHills();

    // ワールド変換
    ctx.save();
    ctx.translate(-camera.x, 0);

    drawTiles();
    drawGoal();
    drawItems();
    drawEnemies();
    drawFireballs();
    drawParticles();
    drawPlayer();
    drawPopups();

    ctx.restore();
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#bfe5ff');
    g.addColorStop(0.6, '#dff0ff');
    g.addColorStop(1, '#fff4d4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  function drawClouds() {
    ctx.save();
    const off = camera.x * 0.3;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 180 + 60 - off) % (VIEW_W + 240)) - 80;
      const y = 28 + (i * 23) % 60;
      drawCloud(x, y, 1 + (i % 2) * 0.4);
    }
    ctx.restore();
  }
  function drawCloud(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.arc(14, -4, 14, 0, Math.PI * 2);
    ctx.arc(28, 0, 11, 0, Math.PI * 2);
    ctx.arc(40, 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(8, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===== 背景の街並み（ビルと家）=====
  function drawBuildings() {
    ctx.save();
    const off = camera.x * 0.4; // 雲(0.3) と 丘(0.5) の中間で奥行き感
    const baseY = (ROWS - 1) * TILE; // 地面タイル上端に建物の足元を揃える
    // 1 つの繰り返しユニットの幅
    const periodW = 540;
    let startX = -((off % periodW) + periodW) % periodW - 80;
    for (let baseX = startX; baseX < VIEW_W + periodW; baseX += periodW) {
      // ユニット内のレイアウト（決まった配置）
      drawBuilding(baseX +  20, baseY,  60, 96, 'office');
      drawHouse   (baseX +  98, baseY,  68, 50, 'red');
      drawBuilding(baseX + 188, baseY,  44, 116, 'glass');
      drawHouse   (baseX + 250, baseY,  60, 44, 'green');
      drawBuilding(baseX + 330, baseY,  72, 84, 'tile');
      drawHouse   (baseX + 422, baseY,  56, 40, 'blue');
      drawBuilding(baseX + 498, baseY,  36, 70, 'office');
    }
    ctx.restore();
  }

  function drawBuilding(x, baseY, w, h, kind) {
    const top = baseY - h;
    // 背後の影
    ctx.fillStyle = 'rgba(140,150,170,0.35)';
    ctx.fillRect(x + 2, top + 4, w, h);

    if (kind === 'office') {
      // 普通のオフィスビル（淡い青グレー）
      const grd = ctx.createLinearGradient(x, top, x, top + h);
      grd.addColorStop(0, '#dde6ef');
      grd.addColorStop(1, '#b8c4d2');
      ctx.fillStyle = grd;
      ctx.fillRect(x, top, w, h);
      ctx.strokeStyle = 'rgba(70,90,110,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      // 窓（格子状）
      const winW = 6, winH = 8, padX = 4, padY = 6;
      const cols = Math.floor((w - padX * 2 + 2) / (winW + 2));
      const rows = Math.floor((h - padY * 2 + 2) / (winH + 2));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x + padX + c * (winW + 2);
          const wy = top + padY + r * (winH + 2);
          // 一部だけ「灯り」が点いている
          ctx.fillStyle = ((r * 7 + c * 3 + Math.floor(x / 11)) % 5 === 0) ? '#fff4b8' : '#7d92a8';
          ctx.fillRect(wx, wy, winW, winH);
        }
      }
      // 屋上の塔
      ctx.fillStyle = '#a8b4c4';
      ctx.fillRect(x + w / 2 - 3, top - 6, 6, 6);
      ctx.fillStyle = '#ff5e5e';
      ctx.fillRect(x + w / 2 - 1, top - 9, 2, 3);
    } else if (kind === 'glass') {
      // ガラス張りの細いビル
      ctx.fillStyle = '#c5d8e8';
      ctx.fillRect(x, top, w, h);
      ctx.strokeStyle = 'rgba(50,80,110,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      // 横ストライプの窓
      ctx.fillStyle = '#5e8aa6';
      for (let yy = top + 6; yy < top + h - 4; yy += 7) {
        ctx.fillRect(x + 3, yy, w - 6, 3);
      }
      // 縦の継ぎ目
      ctx.strokeStyle = 'rgba(80,110,140,0.35)';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, top + 2);
      ctx.lineTo(x + w / 2, top + h - 2);
      ctx.stroke();
      // 屋上アンテナ
      ctx.strokeStyle = '#8898a8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, top);
      ctx.lineTo(x + w / 2, top - 14);
      ctx.stroke();
      ctx.fillStyle = '#ff5e5e';
      ctx.beginPath();
      ctx.arc(x + w / 2, top - 14, 1.4, 0, Math.PI * 2);
      ctx.fill();
    } else { // 'tile' タイル張りの少し低めのビル
      const grd = ctx.createLinearGradient(x, top, x, top + h);
      grd.addColorStop(0, '#f0d8b8');
      grd.addColorStop(1, '#c8a888');
      ctx.fillStyle = grd;
      ctx.fillRect(x, top, w, h);
      ctx.strokeStyle = 'rgba(120,80,40,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      // 窓
      const winW = 8, winH = 6, padX = 4, padY = 8;
      const cols = Math.floor((w - padX * 2 + 2) / (winW + 2));
      const rows = Math.floor((h - padY * 2 + 2) / (winH + 2));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x + padX + c * (winW + 2);
          const wy = top + padY + r * (winH + 2);
          ctx.fillStyle = ((r * 5 + c * 7 + Math.floor(x / 13)) % 6 === 0) ? '#fff0b0' : '#7a5a40';
          ctx.fillRect(wx, wy, winW, winH);
        }
      }
      // 看板
      ctx.fillStyle = '#ff8fb0';
      ctx.fillRect(x + 4, top + 6, w - 8, 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 6, top + 8, w - 12, 2);
    }
  }

  function drawHouse(x, baseY, w, h, color) {
    const top = baseY - h;
    const wallTop = top + h * 0.32;
    // 背後の影
    ctx.fillStyle = 'rgba(140,120,90,0.30)';
    ctx.fillRect(x + 2, wallTop + 2, w, h - h * 0.32);
    // 壁（クリーム色）
    ctx.fillStyle = '#fff5e0';
    ctx.fillRect(x, wallTop, w, h - h * 0.32);
    ctx.strokeStyle = 'rgba(140,100,70,0.5)';
    ctx.lineWidth = 0.9;
    ctx.strokeRect(x + 0.5, wallTop + 0.5, w - 1, h - h * 0.32 - 1);
    // 屋根
    let roofFill, roofStroke;
    if (color === 'red')   { roofFill = '#d76a72'; roofStroke = '#a04050'; }
    else if (color === 'green') { roofFill = '#7ac48a'; roofStroke = '#3a8050'; }
    else { roofFill = '#7aa6d0'; roofStroke = '#3e6e9a'; }
    ctx.fillStyle = roofFill;
    ctx.beginPath();
    ctx.moveTo(x - 4, wallTop);
    ctx.lineTo(x + w / 2, top);
    ctx.lineTo(x + w + 4, wallTop);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = roofStroke;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 煙突
    ctx.fillStyle = '#a86a4a';
    ctx.fillRect(x + w * 0.72, top + h * 0.06, 5, 8);
    // ドア
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(x + w / 2 - 4, baseY - 14, 8, 14);
    ctx.strokeStyle = 'rgba(60,30,15,0.55)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x + w / 2 - 3.5, baseY - 13.5, 7, 13);
    // ドアノブ
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(x + w / 2 + 1.5, baseY - 8, 1.4, 1.4);
    // 窓
    ctx.fillStyle = '#a8d4ec';
    ctx.fillRect(x + 6, wallTop + 6, 9, 9);
    ctx.fillRect(x + w - 15, wallTop + 6, 9, 9);
    ctx.strokeStyle = 'rgba(60,80,100,0.55)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x + 6 + 0.5, wallTop + 6 + 0.5, 8, 8);
    ctx.strokeRect(x + w - 15 + 0.5, wallTop + 6 + 0.5, 8, 8);
    // 窓の十字
    ctx.beginPath();
    ctx.moveTo(x + 10.5, wallTop + 6); ctx.lineTo(x + 10.5, wallTop + 14);
    ctx.moveTo(x + 6, wallTop + 10.5); ctx.lineTo(x + 14, wallTop + 10.5);
    ctx.moveTo(x + w - 10.5, wallTop + 6); ctx.lineTo(x + w - 10.5, wallTop + 14);
    ctx.moveTo(x + w - 15, wallTop + 10.5); ctx.lineTo(x + w - 7, wallTop + 10.5);
    ctx.stroke();
  }

  function drawHills() {
    ctx.save();
    const off = camera.x * 0.5;
    ctx.fillStyle = '#9bd5a3';
    for (let i = -1; i < 8; i++) {
      const x = i * 220 + 60 - (off % 220);
      const y = VIEW_H - 56;
      ctx.beginPath();
      ctx.moveTo(x, y + 60);
      ctx.quadraticCurveTo(x + 60, y - 50, x + 120, y + 60);
      ctx.fill();
    }
    ctx.fillStyle = '#7ec48b';
    for (let i = -1; i < 8; i++) {
      const x = i * 160 + 130 - (off * 1.4 % 160);
      const y = VIEW_H - 40;
      ctx.beginPath();
      ctx.moveTo(x, y + 60);
      ctx.quadraticCurveTo(x + 50, y - 30, x + 100, y + 60);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTiles() {
    const c0 = Math.max(0, Math.floor(camera.x / TILE) - 1);
    const c1 = Math.min(LEVEL_W - 1, Math.floor((camera.x + VIEW_W) / TILE) + 1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = grid[r][c];
        if (ch === ' ') continue;
        const x = c * TILE;
        const y = r * TILE;
        // ブロックの bump アニメ
        let yOff = 0;
        for (const p of particles) {
          if (p.kind === 'blockbump' && p.col === c && p.row === r) {
            const t = 1 - p.life / 12;
            yOff = -Math.sin(t * Math.PI) * 8;
          }
        }
        if (ch === '#') drawGround(x, y + yOff, c, r);
        else if (ch === 'B') drawBrick(x, y + yOff);
      }
    }
  }

  function drawGround(x, y, c, r) {
    // 上に空気がある？（ベースは地面）
    const top = tileAt(c, r - 1);
    const isTop = !isSolid(top);
    ctx.fillStyle = isTop ? '#7ec48b' : '#a07a4a';
    ctx.fillRect(x, y, TILE, TILE);
    if (isTop) {
      // 草の天辺
      ctx.fillStyle = '#5fa86d';
      ctx.fillRect(x, y, TILE, 5);
      ctx.fillStyle = '#a07a4a';
      ctx.fillRect(x, y + 5, TILE, TILE - 5);
      // 土のドット模様
      ctx.fillStyle = 'rgba(110, 70, 30, 0.5)';
      ctx.fillRect(x + 4, y + 10, 3, 3);
      ctx.fillRect(x + 14, y + 16, 2, 2);
      ctx.fillRect(x + 8, y + 19, 2, 2);
      // 草の縁
      ctx.fillStyle = '#83cf90';
      ctx.fillRect(x + 2, y + 4, 2, 2);
      ctx.fillRect(x + 12, y + 4, 3, 2);
      ctx.fillRect(x + 20, y + 4, 2, 2);
    } else {
      // 地中
      ctx.fillStyle = 'rgba(110, 70, 30, 0.5)';
      ctx.fillRect(x + 4, y + 6, 3, 3);
      ctx.fillRect(x + 14, y + 14, 2, 2);
      ctx.fillRect(x + 8, y + 18, 2, 2);
    }
    // 縁
    ctx.strokeStyle = 'rgba(60, 36, 16, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  function drawBrick(x, y) {
    ctx.fillStyle = '#d97a4a';
    ctx.fillRect(x, y, TILE, TILE);
    // レンガ目地
    ctx.strokeStyle = 'rgba(70,30,15,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + TILE / 2); ctx.lineTo(x + TILE, y + TILE / 2);
    ctx.moveTo(x + TILE / 2, y); ctx.lineTo(x + TILE / 2, y + TILE / 2);
    ctx.moveTo(x + TILE / 4, y + TILE / 2); ctx.lineTo(x + TILE / 4, y + TILE);
    ctx.moveTo(x + TILE * 3 / 4, y + TILE / 2); ctx.lineTo(x + TILE * 3 / 4, y + TILE);
    ctx.stroke();
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 1, y + 1, TILE - 2, 2);
    // 縁
    ctx.strokeStyle = 'rgba(70,30,15,0.7)';
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  function drawQBlock(x, y) {
    // 黄色いベース
    const grd = ctx.createLinearGradient(x, y, x, y + TILE);
    grd.addColorStop(0, '#ffe48a');
    grd.addColorStop(1, '#e89a3a');
    ctx.fillStyle = grd;
    ctx.fillRect(x, y, TILE, TILE);
    // 内枠
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 2, y + 2, TILE - 4, 3);
    // ?マーク（点滅）
    const flick = (Math.floor(game.timeFrames / 10) % 4 === 0) ? '#fff8d0' : '#fff';
    ctx.fillStyle = flick;
    ctx.font = 'bold 18px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + TILE / 2, y + TILE / 2 + 1);
    // 鋲
    ctx.fillStyle = '#a06a20';
    for (const [px, py] of [[3,3],[TILE-5,3],[3,TILE-5],[TILE-5,TILE-5]]) {
      ctx.fillRect(x + px, y + py, 2, 2);
    }
    // 縁
    ctx.strokeStyle = 'rgba(110,70,20,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  function drawUsedBlock(x, y) {
    ctx.fillStyle = '#9a6a2a';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#7a4a1a';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = 'rgba(50,20,5,0.7)';
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }

  function drawGoal() {
    // オカメインコの家：鳥かご
    const cx = GOAL_COL * TILE + TILE / 2;
    const cageW = TILE * 3;
    const cageH = TILE * 5;
    const left = cx - cageW / 2;
    const right = cx + cageW / 2;
    const bottom = (ROWS - 1) * TILE;     // 地面の上
    const top = bottom - cageH;            // 縦バーのてっぺん
    const domeH = TILE * 1.3;
    const domeTop = top - domeH;
    const ringY = domeTop - 6;

    ctx.save();

    // ベース（木製のトレイ）
    const baseH = 10;
    const baseGrad = ctx.createLinearGradient(0, bottom - baseH, 0, bottom);
    baseGrad.addColorStop(0, '#b39068');
    baseGrad.addColorStop(1, '#7c5e3a');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(left - 5, bottom - baseH, cageW + 10, baseH);
    ctx.strokeStyle = '#5a3e22';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(left - 5 + 0.5, bottom - baseH + 0.5, cageW + 10 - 1, baseH - 1);
    // 木目
    ctx.strokeStyle = 'rgba(70,40,15,0.35)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(left - 4, bottom - baseH + 2 + i * 2.8);
      ctx.lineTo(right + 4, bottom - baseH + 2 + i * 2.8);
      ctx.stroke();
    }

    // 下の横リング
    ctx.strokeStyle = '#cfd2d8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(left, bottom - baseH);
    ctx.lineTo(right, bottom - baseH);
    ctx.stroke();

    // 縦のバー
    const bars = 7;
    ctx.strokeStyle = '#bcc0c8';
    ctx.lineWidth = 1.6;
    for (let i = 0; i <= bars; i++) {
      const x = left + (cageW / bars) * i;
      ctx.beginPath();
      ctx.moveTo(x, bottom - baseH);
      ctx.lineTo(x, top);
      ctx.stroke();
    }
    // バーのハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= bars; i++) {
      const x = left + (cageW / bars) * i - 0.5;
      ctx.beginPath();
      ctx.moveTo(x, bottom - baseH);
      ctx.lineTo(x, top);
      ctx.stroke();
    }

    // 上の横リング
    ctx.strokeStyle = '#cfd2d8';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(right, top);
    ctx.stroke();

    // ドーム（屋根）
    ctx.strokeStyle = '#bcc0c8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.quadraticCurveTo(cx, domeTop - 6, right, top);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(left + 1, top - 1);
    ctx.quadraticCurveTo(cx, domeTop - 7, right - 1, top - 1);
    ctx.stroke();
    // 放射状のバー
    ctx.strokeStyle = '#bcc0c8';
    ctx.lineWidth = 1.4;
    for (let i = 1; i < bars; i++) {
      const xLin = left + (cageW / bars) * i;
      const t = (xLin - left) / cageW; // 0..1
      const yDome = top - Math.sin(t * Math.PI) * domeH;
      ctx.beginPath();
      ctx.moveTo(xLin, top);
      ctx.lineTo(xLin, yDome);
      ctx.stroke();
    }

    // 吊り下げハンドル（リング）
    ctx.strokeStyle = '#bcc0c8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, ringY, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx - 1.5, ringY - 1.5, 5.4, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    // 止まり木
    const perchY = bottom - baseH - TILE * 1.5;
    ctx.fillStyle = '#9a6a3a';
    ctx.fillRect(left + 8, perchY - 1.5, cageW - 16, 3);
    ctx.strokeStyle = 'rgba(60,30,10,0.7)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(left + 8 + 0.5, perchY - 1 + 0.5, cageW - 17, 2);
    // 支柱
    ctx.fillStyle = '#7a4f28';
    ctx.fillRect(left + 8,  perchY,     2, bottom - baseH - perchY);
    ctx.fillRect(right - 10, perchY,    2, bottom - baseH - perchY);

    // 餌入れカップ（左下）
    const cupX = left + 6;
    const cupY = bottom - baseH - 7;
    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.moveTo(cupX, cupY);
    ctx.lineTo(cupX + 12, cupY);
    ctx.lineTo(cupX + 10.5, cupY + 7);
    ctx.lineTo(cupX + 1.5, cupY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9a8068';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 餌（黄色いつぶつぶ）
    ctx.fillStyle = '#f0c948';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cupX + 3 + (i * 2.4), cupY + 2.4, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 屋根の上のハート（おうちらしさ）
    const heartPulse = 1 + Math.sin(game.timeFrames * 0.15) * 0.08;
    ctx.save();
    ctx.translate(cx + cageW * 0.30, domeTop - 2);
    ctx.scale(heartPulse, heartPulse);
    ctx.fillStyle = '#ff7aa0';
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-7, -2, -7, -8, -3, -8);
    ctx.bezierCurveTo(-1, -8, 0, -6, 0, -4);
    ctx.bezierCurveTo(0, -6, 1, -8, 3, -8);
    ctx.bezierCurveTo(7, -8, 7, -2, 0, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // クリア後のキラキラ
    if (player.cleared) {
      ctx.fillStyle = '#fff7c2';
      const t = game.timeFrames * 0.12;
      for (let i = 0; i < 5; i++) {
        const a = t + i * 1.3;
        const sx = cx + Math.cos(a) * (cageW * 0.35);
        const sy = (top + bottom) / 2 + Math.sin(a * 0.8 + i) * (cageH * 0.30);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawItems() {
    for (const it of items) {
      if (it._dead) continue;
      if (it.kind === 'mikan') drawMikan(it.x, it.y, it.w, it.h);
      else if (it.kind === 'corn') drawCorn(it.x, it.y, it.w, it.h, game.timeFrames);
      else if (it.kind === 'gem')  drawGem(it.x, it.y, it.w, it.h, game.timeFrames);
    }
  }

  function drawMikan(x, y, w, h) {
    // ミカン
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.translate(cx, cy);

    const r = Math.min(w, h) * 0.45;

    // 本体（オレンジ色のグラデーション）
    const grd = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.2);
    grd.addColorStop(0, '#ffd089');
    grd.addColorStop(0.55, '#ff9a3a');
    grd.addColorStop(1, '#d56b1a');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.05, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a8540f';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 表面の毛穴（細かいドット）
    ctx.fillStyle = 'rgba(180,90,20,0.45)';
    const dots = [[-r*0.45, -r*0.05],[-r*0.20,  r*0.25],[ r*0.10, -r*0.15],
                  [ r*0.30,  r*0.15],[-r*0.05,  r*0.45],[ r*0.50, -r*0.05],
                  [-r*0.55,  r*0.30],[ r*0.05, -r*0.45],[ r*0.40,  r*0.45]];
    for (const [dx, dy] of dots) {
      ctx.beginPath();
      ctx.arc(dx, dy, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.30, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // ヘタのくぼみ
    ctx.fillStyle = '#c8550d';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.78, r * 0.12, r * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();

    // ヘタ（緑の葉）
    ctx.fillStyle = '#5fa86d';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.quadraticCurveTo(r * 0.55, -r * 1.05, r * 0.20, -r * 1.10);
    ctx.quadraticCurveTo(0, -r * 0.95, 0, -r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a7050';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 葉脈
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.quadraticCurveTo(r * 0.20, -r * 0.95, r * 0.30, -r * 1.05);
    ctx.stroke();

    ctx.restore();
  }

  function drawCorn(x, y, w, h, t) {
    const cx = x + w / 2;
    const cy = y + h / 2 + Math.sin(t * 0.12) * 1.2;
    ctx.save();
    ctx.translate(cx, cy);

    const bw = w * 0.32;   // 半径
    const bh = h * 0.40;

    // === 後ろのヒゲ（皮の葉） ===
    ctx.fillStyle = '#7ec48a';
    ctx.beginPath();
    ctx.moveTo(-bw * 1.10, -bh * 0.60);
    ctx.quadraticCurveTo(-bw * 1.40, -bh * 0.20, -bw * 0.95, bh * 0.40);
    ctx.lineTo(-bw * 0.50, bh * 0.30);
    ctx.quadraticCurveTo(-bw * 0.85, -bh * 0.10, -bw * 0.80, -bh * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a8050';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = '#7ec48a';
    ctx.beginPath();
    ctx.moveTo(bw * 1.10, -bh * 0.60);
    ctx.quadraticCurveTo(bw * 1.40, -bh * 0.20, bw * 0.95, bh * 0.40);
    ctx.lineTo(bw * 0.50, bh * 0.30);
    ctx.quadraticCurveTo(bw * 0.85, -bh * 0.10, bw * 0.80, -bh * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // === とうもろこしの実（黄色いオーバル） ===
    ctx.beginPath();
    ctx.ellipse(0, 0, bw, bh, 0, 0, Math.PI * 2);
    const grd = ctx.createLinearGradient(-bw, 0, bw, 0);
    grd.addColorStop(0, '#fff5a0');
    grd.addColorStop(0.5, '#f0c948');
    grd.addColorStop(1, '#c89020');
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = '#8a5a10';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 粒（kernels）— ジグザグ格子
    ctx.fillStyle = '#fff080';
    ctx.strokeStyle = 'rgba(120,80,15,0.55)';
    ctx.lineWidth = 0.5;
    const rows = 5;
    const cols = 4;
    for (let r = 0; r < rows; r++) {
      const ky = -bh * 0.78 + (bh * 1.56) * (r + 0.5) / rows;
      const offsetCol = (r % 2) * 0.5;
      for (let c = 0; c < cols; c++) {
        const kx = -bw * 0.65 + bw * 1.30 * (c + offsetCol) / cols;
        // 縦長の粒
        ctx.beginPath();
        ctx.ellipse(kx, ky, 1.6, 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.45, -bh * 0.10, bw * 0.18, bh * 0.50, 0, 0, Math.PI * 2);
    ctx.fill();

    // 上のヒゲ束（コーンシルク）
    ctx.strokeStyle = '#c8a868';
    ctx.lineWidth = 1.0;
    ctx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * bw * 0.10, -bh);
      ctx.quadraticCurveTo(i * bw * 0.20, -bh * 1.40, i * bw * 0.28 + Math.sin(i) * 1.5, -bh * 1.65);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawGem(x, y, w, h, t) {
    const cx = x + w / 2;
    const cy = y + h / 2 + Math.sin(t * 0.15) * 1.5;
    const sparklePhase = (t * 0.2) % 1;
    // 横長のダイヤ: 横と縦で別々に半径を取る
    const rx = w * 0.45;
    const ry = h * 0.45;

    ctx.save();
    ctx.translate(cx, cy);

    // 後ろのオーラ
    const aura = ctx.createRadialGradient(0, 0, ry * 0.2, 0, 0, rx * 1.4);
    aura.addColorStop(0, 'rgba(255,200,255,0.45)');
    aura.addColorStop(1, 'rgba(255,200,255,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 1.4, ry * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // ダイヤ型の宝石（底辺を半分に絞った五角形）
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(rx, -ry * 0.20);
    ctx.lineTo(rx * 0.35, ry * 0.95);
    ctx.lineTo(-rx * 0.35, ry * 0.95);
    ctx.lineTo(-rx, -ry * 0.20);
    ctx.closePath();
    const grd = ctx.createLinearGradient(-rx, -ry, rx, ry);
    grd.addColorStop(0, '#fff0fb');
    grd.addColorStop(0.40, '#ff8fc5');
    grd.addColorStop(1, '#7a3ec0');
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.strokeStyle = '#4a1080';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // ファセット線
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, -ry);
    ctx.lineTo(0, ry * 0.95);
    ctx.moveTo(-rx, -ry * 0.20);
    ctx.lineTo(rx, -ry * 0.20);
    ctx.moveTo(-rx * 0.50, -ry);
    ctx.lineTo(-rx * 0.35, ry * 0.95);
    ctx.moveTo(rx * 0.50, -ry);
    ctx.lineTo(rx * 0.35, ry * 0.95);
    ctx.stroke();

    // 中央のハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.25, -ry * 0.30, rx * 0.20, ry * 0.10, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // きらめき（外側の小さな星）
    ctx.fillStyle = `rgba(255,255,255,${0.4 + sparklePhase * 0.6})`;
    const sparkAngle = sparklePhase * Math.PI * 2;
    const sx = Math.cos(sparkAngle) * rx * 1.15;
    const sy = Math.sin(sparkAngle) * ry * 1.40;
    ctx.beginPath();
    ctx.moveTo(sx - 3, sy);
    ctx.lineTo(sx, sy - 3);
    ctx.lineTo(sx + 3, sy);
    ctx.lineTo(sx, sy + 3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.type === 'cat') drawCat(e);
      else if (e.type === 'eagle') drawEagle(e);
    }
  }

  function drawCat(e) {
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h);
    if (!e.alive) ctx.scale(1, -1);
    const wob = e.alive ? Math.sin(e.frame * 0.25) * 1.5 : 0;

    const bodyDk = '#5a5048';
    const bodyMd = '#807870';
    const bodyLt = '#a8a098';
    const earInner = '#ff9aa8';
    const stripe = 'rgba(40,30,20,0.45)';

    // === 体（横長・背中アーチの猫体型） ===
    const bodyGrad = ctx.createLinearGradient(0, -e.h * 0.70, 0, 0);
    bodyGrad.addColorStop(0, bodyLt);
    bodyGrad.addColorStop(1, bodyDk);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-e.w * 0.30, -e.h * 0.60); // 肩のトップ
    // 胸〜お腹の前: 肩から腹底へ
    ctx.bezierCurveTo(
      -e.w * 0.42, -e.h * 0.45,
      -e.w * 0.40, -e.h * 0.22,
      -e.w * 0.30, -e.h * 0.14
    );
    // 腹の下面: 前足付け根 → 後足付け根
    ctx.bezierCurveTo(
      -e.w * 0.05, -e.h * 0.04,
       e.w * 0.20, -e.h * 0.04,
       e.w * 0.40, -e.h * 0.14
    );
    // 後脚〜お尻: 腹底から後尻部のトップへ
    ctx.bezierCurveTo(
       e.w * 0.55, -e.h * 0.30,
       e.w * 0.56, -e.h * 0.55,
       e.w * 0.42, -e.h * 0.62
    );
    // 背中: アーチ状に肩へ戻る
    ctx.bezierCurveTo(
       e.w * 0.18, -e.h * 0.70,
      -e.w * 0.05, -e.h * 0.68,
      -e.w * 0.30, -e.h * 0.60
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a302a';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 体の縞模様（背中から腹に向かう縦線、トラ模様）
    ctx.strokeStyle = stripe;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const xx = -e.w * 0.08 + i * e.w * 0.12;
      ctx.beginPath();
      ctx.moveTo(xx, -e.h * 0.66);
      ctx.quadraticCurveTo(xx + 1, -e.h * 0.40, xx - 1.5, -e.h * 0.18);
      ctx.stroke();
    }

    // === しっぽ ===
    ctx.strokeStyle = bodyDk;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(e.w * 0.45, -e.h * 0.50);
    ctx.quadraticCurveTo(e.w * 0.70, -e.h * 0.70, e.w * 0.58, -e.h * 1.05 + wob);
    ctx.stroke();
    // しっぽ縞
    ctx.strokeStyle = stripe;
    ctx.lineWidth = 1.2;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const tx = e.w * (0.45 + 0.16 * t);
      const ty = -e.h * (0.50 + 0.50 * t) + (i === 3 ? wob : 0);
      ctx.beginPath();
      ctx.arc(tx, ty, 2.5, 0, Math.PI);
      ctx.stroke();
    }

    // === 頭（大きめ） ===
    const headX = -e.w * 0.10;
    const headY = -e.h * 0.70 + wob;
    const headR = e.w * 0.36;
    ctx.fillStyle = bodyMd;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a302a';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    // 頭頂のおでこ縞
    ctx.strokeStyle = stripe;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.4, headY - headR * 0.55);
    ctx.lineTo(headX, headY - headR * 0.85);
    ctx.lineTo(headX + headR * 0.4, headY - headR * 0.55);
    ctx.stroke();

    // === 大きく目立つ耳（左右、外周＋内側のピンク） ===
    // 左耳
    const earL_outer = [
      [headX - headR * 1.05, headY - headR * 0.40], // 根元 左
      [headX - headR * 0.65, headY - headR * 1.65], // 先端
      [headX - headR * 0.20, headY - headR * 0.80], // 根元 右
    ];
    ctx.fillStyle = bodyDk;
    ctx.beginPath();
    ctx.moveTo(...earL_outer[0]);
    ctx.lineTo(...earL_outer[1]);
    ctx.lineTo(...earL_outer[2]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a302a';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    // 左耳 内側ピンク
    ctx.fillStyle = earInner;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.85, headY - headR * 0.55);
    ctx.lineTo(headX - headR * 0.62, headY - headR * 1.40);
    ctx.lineTo(headX - headR * 0.32, headY - headR * 0.78);
    ctx.closePath();
    ctx.fill();

    // 右耳
    const earR_outer = [
      [headX + headR * 0.20, headY - headR * 0.78],
      [headX + headR * 0.65, headY - headR * 1.65],
      [headX + headR * 1.05, headY - headR * 0.40],
    ];
    ctx.fillStyle = bodyDk;
    ctx.beginPath();
    ctx.moveTo(...earR_outer[0]);
    ctx.lineTo(...earR_outer[1]);
    ctx.lineTo(...earR_outer[2]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a302a';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    // 右耳 内側ピンク
    ctx.fillStyle = earInner;
    ctx.beginPath();
    ctx.moveTo(headX + headR * 0.32, headY - headR * 0.78);
    ctx.lineTo(headX + headR * 0.62, headY - headR * 1.40);
    ctx.lineTo(headX + headR * 0.85, headY - headR * 0.55);
    ctx.closePath();
    ctx.fill();

    // === 目（黄色＋黒い縦長瞳） ===
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(headX - headR * 0.40, headY - headR * 0.05, headR * 0.18, 0, Math.PI * 2);
    ctx.arc(headX + headR * 0.10, headY - headR * 0.05, headR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a08020';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // 縦の瞳孔
    ctx.fillStyle = '#1a1612';
    ctx.fillRect(headX - headR * 0.42, headY - headR * 0.18, 1.6, 6);
    ctx.fillRect(headX + headR * 0.08, headY - headR * 0.18, 1.6, 6);

    // === 鼻 ===
    ctx.fillStyle = '#ff9aa8';
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.10, headY + headR * 0.20);
    ctx.lineTo(headX + headR * 0.05, headY + headR * 0.20);
    ctx.lineTo(headX - headR * 0.02, headY + headR * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#a05060';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // 口
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.02, headY + headR * 0.32);
    ctx.lineTo(headX - headR * 0.02, headY + headR * 0.50);
    ctx.moveTo(headX - headR * 0.02, headY + headR * 0.50);
    ctx.quadraticCurveTo(headX - headR * 0.20, headY + headR * 0.55, headX - headR * 0.30, headY + headR * 0.40);
    ctx.moveTo(headX - headR * 0.02, headY + headR * 0.50);
    ctx.quadraticCurveTo(headX + headR * 0.16, headY + headR * 0.55, headX + headR * 0.26, headY + headR * 0.40);
    ctx.strokeStyle = '#3a2820';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // === ヒゲ ===
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.30, headY + headR * 0.30);
    ctx.lineTo(headX - headR * 0.95, headY + headR * 0.20);
    ctx.moveTo(headX - headR * 0.30, headY + headR * 0.40);
    ctx.lineTo(headX - headR * 0.95, headY + headR * 0.45);
    ctx.moveTo(headX + headR * 0.20, headY + headR * 0.30);
    ctx.lineTo(headX + headR * 0.85, headY + headR * 0.20);
    ctx.moveTo(headX + headR * 0.20, headY + headR * 0.40);
    ctx.lineTo(headX + headR * 0.85, headY + headR * 0.45);
    ctx.stroke();

    // === 足（前足は肩の下、後足は尻の下、歩行アニメ） ===
    ctx.fillStyle = '#3a322a';
    const legPhase = Math.sin(e.frame * 0.30);
    ctx.fillRect(-e.w * 0.30, -5 - Math.max(0, legPhase) * 3, 6, 6);   // 前足
    ctx.fillRect( e.w * 0.32, -5 - Math.max(0, -legPhase) * 3, 6, 6);  // 後足

    ctx.restore();
  }

  function drawEagle(e) {
    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (!e.alive) ctx.scale(1, -1);
    // 翼の羽ばたき
    const wing = Math.sin(e.frame * 0.32) * 0.8;

    const brown = '#5a3a1c';
    const brownLight = '#8a5e30';
    const white = '#f4ebd8';
    const yellow = '#f0b840';
    const yellowDk = '#a07820';

    // === 体（茶色） ===
    const bodyGrad = ctx.createLinearGradient(0, -e.h * 0.4, 0, e.h * 0.4);
    bodyGrad.addColorStop(0, brownLight);
    bodyGrad.addColorStop(1, brown);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(e.w * 0.05, e.h * 0.05, e.w * 0.36, e.h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // 体の羽根模様（茶色濃淡のV字）
    ctx.strokeStyle = 'rgba(40,20,5,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const yy = e.h * (-0.08 + i * 0.14);
      ctx.beginPath();
      ctx.moveTo(-e.w * 0.18, yy);
      ctx.quadraticCurveTo(e.w * 0.05, yy + 2, e.w * 0.30, yy);
      ctx.stroke();
    }

    // === 翼（広く、上下にはためく） ===
    // 後ろ翼（背景レイヤー）
    ctx.fillStyle = brown;
    ctx.beginPath();
    ctx.moveTo(e.w * 0.05, -e.h * 0.10);
    ctx.quadraticCurveTo(e.w * 0.55, -e.h * 0.85 - wing * 10, e.w * 0.78, -e.h * 0.20 - wing * 8);
    ctx.quadraticCurveTo(e.w * 0.55, e.h * 0.05, e.w * 0.20, e.h * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 翼の羽根（縦線）
    ctx.strokeStyle = 'rgba(40,20,5,0.55)';
    ctx.lineWidth = 0.7;
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const tipX = e.w * 0.05 + (e.w * 0.73) * t;
      const tipY = -e.h * 0.10 + Math.sin(t * Math.PI) * (-e.h * 0.65 - wing * 8);
      ctx.beginPath();
      ctx.moveTo(e.w * 0.05, -e.h * 0.05);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }

    // 前翼（手前レイヤー、明るめ）
    ctx.fillStyle = brownLight;
    ctx.beginPath();
    ctx.moveTo(-e.w * 0.05, -e.h * 0.05);
    ctx.quadraticCurveTo(-e.w * 0.20, -e.h * 0.55 - wing * 8, -e.w * 0.36, -e.h * 0.18 - wing * 4);
    ctx.lineTo(-e.w * 0.10, e.h * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // === 頭（白） ===
    const headX = -e.w * 0.30;
    const headY = -e.h * 0.20;
    const headR = e.h * 0.42;
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a89a78';
    ctx.lineWidth = 1.0;
    ctx.stroke();
    // 頭のふわふわ（小さな影でテクスチャ）
    ctx.fillStyle = 'rgba(160,140,110,0.35)';
    ctx.beginPath();
    ctx.arc(headX + headR * 0.05, headY + headR * 0.30, headR * 0.55, 0.15, Math.PI - 0.15);
    ctx.fill();

    // === くちばし（鉤型・黄色） ===
    ctx.fillStyle = yellow;
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.30, headY + headR * 0.05);
    ctx.lineTo(headX - headR * 1.20, headY + headR * 0.10);
    ctx.quadraticCurveTo(headX - headR * 1.30, headY + headR * 0.40, headX - headR * 0.95, headY + headR * 0.50);
    ctx.lineTo(headX - headR * 0.30, headY + headR * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = yellowDk;
    ctx.lineWidth = 1.0;
    ctx.stroke();
    // くちばしの裂け目
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.30, headY + headR * 0.30);
    ctx.lineTo(headX - headR * 1.10, headY + headR * 0.30);
    ctx.stroke();
    // 鼻孔
    ctx.fillStyle = 'rgba(120,80,20,0.6)';
    ctx.beginPath();
    ctx.arc(headX - headR * 0.65, headY + headR * 0.20, 0.9, 0, Math.PI * 2);
    ctx.fill();

    // === 目（黄色＋黒、鋭い眉） ===
    // 眉 (黒い茶色のひさし)
    ctx.fillStyle = '#1a1208';
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.55, headY - headR * 0.30);
    ctx.lineTo(headX - headR * 0.05, headY - headR * 0.18);
    ctx.lineTo(headX - headR * 0.10, headY - headR * 0.05);
    ctx.lineTo(headX - headR * 0.50, headY - headR * 0.10);
    ctx.closePath();
    ctx.fill();
    // 眼球（黄色）
    ctx.fillStyle = yellow;
    ctx.beginPath();
    ctx.arc(headX - headR * 0.30, headY - headR * 0.05, headR * 0.20, 0, Math.PI * 2);
    ctx.fill();
    // 黒目
    ctx.fillStyle = '#1a1208';
    ctx.beginPath();
    ctx.arc(headX - headR * 0.35, headY - headR * 0.05, headR * 0.10, 0, Math.PI * 2);
    ctx.fill();
    // ハイライト
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(headX - headR * 0.37, headY - headR * 0.10, headR * 0.04, 0, Math.PI * 2);
    ctx.fill();

    // === 尾羽 ===
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.moveTo(e.w * 0.30, e.h * 0.10);
    ctx.lineTo(e.w * 0.55, e.h * 0.05);
    ctx.lineTo(e.w * 0.58, e.h * 0.30);
    ctx.lineTo(e.w * 0.30, e.h * 0.30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#a89a78';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    // 尾羽の縦縞
    ctx.strokeStyle = 'rgba(120,100,70,0.6)';
    ctx.lineWidth = 0.6;
    for (let i = 1; i <= 3; i++) {
      const xx = e.w * (0.30 + i * 0.07);
      ctx.beginPath();
      ctx.moveTo(xx, e.h * 0.07);
      ctx.lineTo(xx, e.h * 0.30);
      ctx.stroke();
    }

    // === 爪（黄色い鉤爪） ===
    ctx.strokeStyle = yellow;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-e.w * 0.05, e.h * 0.40);
    ctx.lineTo(-e.w * 0.05, e.h * 0.55);
    ctx.moveTo(e.w * 0.10, e.h * 0.40);
    ctx.lineTo(e.w * 0.10, e.h * 0.55);
    ctx.stroke();
    ctx.fillStyle = yellow;
    // 爪先
    for (const fx of [-e.w * 0.08, -e.w * 0.02, e.w * 0.07, e.w * 0.13]) {
      ctx.beginPath();
      ctx.moveTo(fx, e.h * 0.55);
      ctx.lineTo(fx + 1.2, e.h * 0.62);
      ctx.lineTo(fx - 1.2, e.h * 0.60);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawFireballs() {
    for (const f of fireballs) {
      const t = game.timeFrames * 0.3 + f.x * 0.05;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(t);
      // 外炎
      const grd = ctx.createRadialGradient(0, 0, 1, 0, 0, f.r * 1.4);
      grd.addColorStop(0, '#fff8c8');
      grd.addColorStop(0.5, '#ffae3a');
      grd.addColorStop(1, '#ff4a1a');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, f.r + 2, 0, Math.PI * 2);
      ctx.fill();
      // ハイライト
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(-f.r * 0.3, -f.r * 0.3, f.r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      if (p.kind === 'brick') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = '#d97a4a';
        ctx.fillRect(-4, -3, 8, 6);
        ctx.strokeStyle = 'rgba(70,30,15,0.7)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-4, -3, 8, 6);
        ctx.restore();
      }
    }
  }

  function drawPlayer() {
    if (!player.alive && player.deadTimer <= 0) return;
    // 無敵中の点滅
    if (player.invuln > 0 && Math.floor(player.invuln / 4) % 2 === 0) return;

    const x = player.x;
    const y = player.y + (player.bumpAnim > 0 ? Math.sin((1 - player.bumpAnim / 8) * Math.PI) * -3 : 0);
    const w = player.w;
    const h = player.h;
    drawOkame(x, y, w, h, player.state, player.frame, player.onGround, player.alive);
  }

  function drawOkamePlaceholder(x, y, w, h, state, frame, onGround, alive) {
    const cx = x + w / 2;
    const baseY = y + h;
    const isFlap = player.flapTimer > 0;
    const flap = Math.sin(frame * (isFlap ? 1.4 : (onGround ? 0.42 : 0.7)));
    ctx.save();
    ctx.translate(cx, baseY);
    if (!alive) ctx.scale(1, -1);
    // 体（黄色の丸）
    ctx.fillStyle = '#ffe16a';
    ctx.strokeStyle = '#a88820';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.35, w * 0.5, h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 頭
    ctx.beginPath();
    ctx.arc(w * 0.15, -h * 0.7, w * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 冠羽
    ctx.beginPath();
    ctx.moveTo(w * 0.10, -h * 0.95);
    ctx.quadraticCurveTo(w * 0.30, -h * 1.20, w * 0.20, -h * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 目
    ctx.fillStyle = '#1a1612';
    ctx.beginPath();
    ctx.arc(w * 0.30, -h * 0.70, w * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // ほっぺ
    ctx.fillStyle = '#ff9a78';
    ctx.beginPath();
    ctx.arc(w * 0.20, -h * 0.55, w * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // くちばし
    ctx.fillStyle = '#ffb39c';
    ctx.beginPath();
    ctx.moveTo(w * 0.50, -h * 0.65);
    ctx.lineTo(w * 0.70, -h * 0.60);
    ctx.lineTo(w * 0.50, -h * 0.55);
    ctx.closePath();
    ctx.fill();
    // 翼（パタパタ — 無敵モード時は大きく速く）
    ctx.fillStyle = '#f8d860';
    const flapAmp = isFlap ? 6 : 2;
    ctx.beginPath();
    ctx.ellipse(-w * 0.05, -h * 0.30 + flap * flapAmp, w * 0.30, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawOkame(x, y, w, h, state, frame, onGround, alive) {
    // スプライトがまだロードできていない場合のフォールバック（黄色のプレースホルダー）
    if (!okameSprite.ready || !okameSprite.canvas) {
      drawOkamePlaceholder(x, y, w, h, state, frame, onGround, alive);
      return;
    }
    const isFlap = player.flapTimer > 0;
    const isBig = state === "big";

    // 足元中心へ
    const cx = x + w / 2;
    const baseY = y + h;

    // 歩行中の上下バウンド（足踏み2拍）と前後の重心移動
    const stepPhase = onGround ? Math.sin(frame * 0.34) : 0;
    const bob = onGround ? -Math.abs(stepPhase) * 3.5 : 0;
    // 体の傾き（歩行で左右に揺れる）
    const tilt = onGround ? Math.sin(frame * 0.34) * 0.07 : Math.sin(frame * 0.5) * 0.03;
    // 歩行に合わせた squash & stretch
    const squashY = onGround ? 1 + stepPhase * 0.04 : 1.04;
    const squashX = onGround ? 1 - stepPhase * 0.03 : 1.0;
    // 翼パタパタの追加スケール（無敵モード時は速く・大きく）
    const flapSpeed = isFlap ? 1.4 : (onGround ? 0.55 : 0.85);
    const flapAmp   = isFlap ? 0.18 : 0.06;
    const flapY = 1 + Math.sin(frame * flapSpeed) * flapAmp;

    // スプライトはバウンディングボックスにクロップ済みなので、
    // 高さをプレイヤーの当たり判定にぴったり合わせる（小は少し大きめに見えるよう微調整）
    // 当たり判定がすでに 1.5 倍に拡大されているので、スプライトのスケール係数は
    // 大小どちらも 1.32 で統一すれば描画上もぴったり 1.5 倍になる
    const spriteH = h * 1.32;
    const spriteW = spriteH * (okameSprite.w / okameSprite.h);

    ctx.save();
    // スプライトの足元（画像下端）が baseY に来るように。bob で持ち上げ
    ctx.translate(cx, baseY + bob);
    if (!alive) {
      // やられ演出: ひっくり返る
      ctx.scale(1, -1);
    }
    ctx.rotate(tilt);
    ctx.scale(squashX, squashY * flapY);
    if (isFlap) {
      // 無敵モード: 残像つきの虹色フラッシュ
      const tone = (frame % 24) / 24;
      ctx.filter = `hue-rotate(${Math.round(tone * 360)}deg) saturate(1.6) brightness(1.20)`;
    } else if (player.invuln > 0) {
      ctx.filter = "brightness(1.3)";
    }
    // 画像中央 X = 0、下端 = 0 に揃える
    ctx.drawImage(
      okameSprite.canvas,
      -spriteW / 2,
      -spriteH,
      spriteW,
      spriteH
    );
    ctx.restore();
  }

  function drawPopups() {
    ctx.save();
    ctx.font = 'bold 12px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      const a = Math.min(1, p.life / 30);
      ctx.fillStyle = `rgba(255,122,156,${a})`;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  // ===== ゲームフロー =====
  function startGame() {
    sound.init();
    sound.resume();
    buildLevel();
    game.score = 0;
    game.lives = 3;
    game.timeLeft = TIME_BY_LEVEL[game.level];
    game.timeFrames = 0;
    game.running = true;
    game.finishTimer = 0;
    enemies.length = 0;
    items.length = 0;
    fireballs.length = 0;
    particles.length = 0;
    popups.length = 0;
    spawnInitialItems();
    spawnPlayer();
    camera.x = 0;
    updateUI();
    showScreen('game');
    setMessage('スタート！', 900);
  }

  function endGame(cleared) {
    game.running = false;
    let total = game.score;
    if (cleared) {
      total += game.timeLeft * 50;
    }
    game.score = total;
    if (game.score > game.high) {
      game.high = game.score;
      saveHigh();
    }
    $('result-score').textContent = game.score;
    $('result-high').textContent = game.high;
    $('result-title').textContent = cleared ? 'おうちにかえれた！' : 'ゲームオーバー';
    $('result-image').hidden = !cleared;
    setTimeout(() => showScreen('result'), 700);
  }

  // ===== ループ =====
  let lastTime = 0;
  function loop(now) {
    const dt = now - lastTime;
    lastTime = now;
    if (game.running) {
      spawnEnemiesInView();
      updatePlayer();
      updateItems();
      updateEnemies();
      updateFireballs();
      tickParticles();
      tickPopups();
      updateCamera();
      updateTimer();
      // クリア後の遷移
      if (player.cleared) {
        game.finishTimer--;
        if (game.finishTimer <= 0) {
          game.running = false;
          endGame(true);
        }
      }
    }
    tickMessage(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ===== 入力 =====
  function bindCtrlButton(el, onPress, onRelease) {
    const press = (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      sound.init(); sound.resume();
      onPress();
    };
    const release = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('pressed');
      onRelease && onRelease();
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (!inputJump) jumpEdge = true;
        inputJump = true;
        $('btn-jump').classList.add('pressed');
      }
      // ファイア用キー（X/Z/Shift）は廃止。誤押下されても何もしない。
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        inputJump = false;
        $('btn-jump').classList.remove('pressed');
      }
    });
  }

  // ===== 初期化 =====
  function init() {
    sound.loadPref();
    loadHigh();
    $('sound-toggle').checked = sound.enabled;
    $('sound-toggle').addEventListener('change', (e) => sound.setEnabled(e.target.checked));

    const slider = $('level-slider');
    const display = $('level-display');
    const hint = $('level-hint');
    slider.value = String(game.level);
    display.textContent = String(game.level);
    hint.textContent = HINT_BY_LEVEL[game.level];
    slider.addEventListener('input', (e) => {
      game.level = parseInt(e.target.value, 10);
      display.textContent = String(game.level);
      hint.textContent = HINT_BY_LEVEL[game.level];
    });

    $('btn-start').addEventListener('click', startGame);
    $('btn-replay').addEventListener('click', startGame);
    $('btn-result-back').addEventListener('click', () => showScreen('title'));
    $('btn-back').addEventListener('click', () => {
      game.running = false;
      showScreen('title');
    });
    $('btn-reset').addEventListener('click', () => {
      if (confirm('リセットして最初からやり直す？')) startGame();
    });

    bindCtrlButton($('btn-jump'),
      () => { if (!inputJump) jumpEdge = true; inputJump = true; },
      () => { inputJump = false; }
    );
    // ファイアボタンは押しても何もしない（無敵モードはアイテム取得で自動発動）
    bindKeys();

    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    // スプライト読み込み
    loadOkameSprite();

    // タイトル画面でもレンダループが動くため、grid を先に初期化しておく
    buildLevel();
    spawnPlayer();

    requestAnimationFrame((t) => { lastTime = t; loop(t); });
  }

  init();
})();
