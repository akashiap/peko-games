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
      try { localStorage.setItem('pinball_sound', on ? '1' : '0'); } catch (e) {}
    },
    loadPref() {
      try {
        const v = localStorage.getItem('pinball_sound');
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
    bumper() { this.beep(880, 0.12, 'triangle', 0.22); },
    flip()   { this.beep(440, 0.06, 'square',  0.15); },
    wall()   { this.beep(220, 0.04, 'sine',    0.10); },
    launch() { this.beep(330, 0.20, 'sawtooth',0.18); },
    drain()  { this.beep(150, 0.30, 'sine',    0.20); },
    over()   {
      this.beep(440, 0.18, 'triangle', 0.20);
      setTimeout(() => this.beep(330, 0.18, 'triangle', 0.20), 180);
      setTimeout(() => this.beep(220, 0.30, 'triangle', 0.20), 360);
    },
  };

  // ===== 定数 =====
  const W = 360, H = 540;
  const BALL_R = 9;
  const FRICTION = 0.998;
  const RESTITUTION = 0.78;
  const MAX_SPEED = 16;

  const GRAVITY_BY_LEVEL = [0, 0.12, 0.15, 0.18, 0.21, 0.25];
  const HINT_BY_LEVEL = ['', 'とてもやさしい', 'やさしい', 'ふつう', 'むずかしい', 'とてもむずかしい'];

  // ===== レイアウト =====
  function topArcSegments() {
    const segs = [];
    const N = 22;
    const cx = 180, cy = 80, rx = 168, ry = 64;
    for (let i = 0; i < N; i++) {
      const a1 = Math.PI - Math.PI * i / N;
      const a2 = Math.PI - Math.PI * (i + 1) / N;
      segs.push({
        x1: cx + rx * Math.cos(a1), y1: cy - ry * Math.sin(a1),
        x2: cx + rx * Math.cos(a2), y2: cy - ry * Math.sin(a2),
        kind: 'arc',
      });
    }
    return segs;
  }

  const walls = [
    ...topArcSegments(),
    { x1: 12,  y1: 80,  x2: 12,  y2: 410, kind: 'wall' },
    { x1: 12,  y1: 410, x2: 110, y2: 484, kind: 'sling', side: 'L', frontNx: 0.602, frontNy: -0.798 },
    { x1: 348, y1: 80,  x2: 348, y2: 510, kind: 'wall' },
    { x1: 308, y1: 200, x2: 308, y2: 510, kind: 'wall' },
    { x1: 308, y1: 410, x2: 250, y2: 484, kind: 'sling', side: 'R', frontNx: -0.787, frontNy: -0.617 },
    { x1: 308, y1: 510, x2: 348, y2: 510, kind: 'wall' },
  ];

  const bumpers = [
    { x: 100, y: 180, r: 20, color: '#ff8fb0', score: 30,  flash: 0 },
    { x: 260, y: 180, r: 20, color: '#ffb359', score: 30,  flash: 0 },
    { x: 180, y: 120, r: 20, color: '#a8dcb5', score: 100, flash: 0 },
    { x: 180, y: 290, r: 14, color: '#c9aef0', score: 50,  flash: 0 },
  ];

  // 釘（小さなクロームポスト・10点）
  const pegs = [
    { x: 140, y: 220, r: 3.5, flash: 0 },
    { x: 220, y: 220, r: 3.5, flash: 0 },
    { x: 180, y: 240, r: 3.5, flash: 0 },
    { x: 130, y: 340, r: 3.5, flash: 0 },
    { x: 230, y: 340, r: 3.5, flash: 0 },
    { x: 90,  y: 400, r: 3.5, flash: 0 },
    { x: 270, y: 400, r: 3.5, flash: 0 },
    { x: 180, y: 420, r: 3.5, flash: 0 },
    { x: 110, y: 445, r: 3.5, flash: 0 },
    { x: 250, y: 445, r: 3.5, flash: 0 },
  ];

  const FL = {
    pivotX: 110, pivotY: 484, length: 54,
    restAngle: 0.42, activeAngle: -0.55,
    angle: 0.42, omega: 0, active: false, dir: 1,
  };
  const FR = {
    pivotX: 250, pivotY: 484, length: 54,
    restAngle: Math.PI - 0.42, activeAngle: Math.PI + 0.55,
    angle: Math.PI - 0.42, omega: 0, active: false, dir: -1,
  };

  // ===== 状態 =====
  const state = {
    score: 0,
    high: 0,
    balls: 3,
    level: 3,
    gravity: GRAVITY_BY_LEVEL[3],
    running: false,
    popups: [],
  };

  const ball = {
    x: 328, y: 501,
    vx: 0, vy: 0,
    trail: [],
  };

  function loadHigh() {
    try {
      const v = parseInt(localStorage.getItem('pinball_high') || '0', 10);
      if (v > 0) state.high = v;
    } catch (e) {}
  }
  function saveHigh() {
    try { localStorage.setItem('pinball_high', String(state.high)); } catch (e) {}
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

  function fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ===== UI =====
  function updateUI() {
    $('score-value').textContent = state.score;
    $('balls-value').textContent = Math.max(0, state.balls);
  }

  let messageTimer = 0;
  function setMessage(text, ms = 1500) {
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
      if (messageTimer <= 0) {
        $('message').textContent = '';
      }
    }
  }

  // ===== 物理 =====
  function clampSpeed() {
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
      ball.vx = ball.vx / sp * MAX_SPEED;
      ball.vy = ball.vy / sp * MAX_SPEED;
    }
  }

  function step() {
    if (!state.running) return;

    ball.vy += state.gravity;
    ball.vx *= FRICTION;
    ball.vy *= FRICTION;
    clampSpeed();

    const speed = Math.hypot(ball.vx, ball.vy);
    const substeps = Math.max(1, Math.ceil(speed / (BALL_R * 0.5)));
    const sx = ball.vx / substeps, sy = ball.vy / substeps;
    for (let i = 0; i < substeps; i++) {
      ball.x += sx;
      ball.y += sy;
      collideAll();
    }

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 6) ball.trail.shift();

    if (ball.y > H + 30) {
      drain();
    }
  }

  function collideAll() {
    for (const w of walls) collideLine(w);
    for (const p of pegs) collidePeg(p);
    for (const b of bumpers) collideBumper(b);
    collideFlipper(FL);
    collideFlipper(FR);
  }

  function collidePeg(p) {
    const dx = ball.x - p.x, dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy);
    const sumR = BALL_R + p.r;
    if (dist >= sumR || dist <= 0) return;
    const nx = dx / dist, ny = dy / dist;
    const overlap = sumR - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) {
      ball.vx -= (1 + 0.85) * dot * nx;
      ball.vy -= (1 + 0.85) * dot * ny;
      p.flash = 6;
      sound.wall();
    }
  }

  function collideLine(w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return;
    let t = ((ball.x - w.x1) * dx + (ball.y - w.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = w.x1 + t * dx, cy = w.y1 + t * dy;
    const ddx = ball.x - cx, ddy = ball.y - cy;
    const dist = Math.hypot(ddx, ddy);
    if (dist >= BALL_R || dist <= 0) return;
    const nx = ddx / dist, ny = ddy / dist;
    // 一方向の壁（裏側からは衝突しない）
    if (w.frontNx !== undefined) {
      if (nx * w.frontNx + ny * w.frontNy < 0) return;
    }
    const overlap = BALL_R - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) {
      const r = w.kind === 'sling' ? 0.85 : RESTITUTION;
      ball.vx -= (1 + r) * dot * nx;
      ball.vy -= (1 + r) * dot * ny;
      if (w.kind === 'sling') {
        ball.vx += nx * 4.5;
        ball.vy += ny * 4.5;
        sound.bumper();
      } else if (Math.abs(dot) > 1.5) {
        sound.wall();
      }
    }
  }

  function collideBumper(b) {
    const dx = ball.x - b.x, dy = ball.y - b.y;
    const dist = Math.hypot(dx, dy);
    const sumR = BALL_R + b.r;
    if (dist >= sumR || dist <= 0) return;
    const nx = dx / dist, ny = dy / dist;
    const overlap = sumR - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) {
      ball.vx -= (1 + 0.9) * dot * nx;
      ball.vy -= (1 + 0.9) * dot * ny;
    }
    ball.vx += nx * 5.5;
    ball.vy += ny * 5.5;
    clampSpeed();
    b.flash = 12;
    addScore(b.score, b.x, b.y);
    sound.bumper();
  }

  function collideFlipper(f) {
    const tx = f.pivotX + f.length * Math.cos(f.angle);
    const ty = f.pivotY + f.length * Math.sin(f.angle);
    const dx = tx - f.pivotX, dy = ty - f.pivotY;
    const len2 = dx * dx + dy * dy;
    let t = ((ball.x - f.pivotX) * dx + (ball.y - f.pivotY) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = f.pivotX + t * dx, cy = f.pivotY + t * dy;
    const ddx = ball.x - cx, ddy = ball.y - cy;
    const dist = Math.hypot(ddx, ddy);
    const FW = 7;
    const sumR = BALL_R + FW;
    if (dist >= sumR || dist <= 0) return;
    const nx = ddx / dist, ny = ddy / dist;
    const overlap = sumR - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const rx = cx - f.pivotX, ry = cy - f.pivotY;
    const flipVx = -f.omega * ry;
    const flipVy = f.omega * rx;

    const relVx = ball.vx - flipVx;
    const relVy = ball.vy - flipVy;
    const dot = relVx * nx + relVy * ny;
    if (dot < 0) {
      ball.vx -= (1 + 0.7) * dot * nx;
      ball.vy -= (1 + 0.7) * dot * ny;
      if (f.active && Math.abs(f.omega) > 0.05) {
        const boost = 6 + Math.abs(f.omega) * 5;
        ball.vx += nx * boost * 0.5;
        ball.vy += ny * boost * 0.5;
        clampSpeed();
      }
      sound.flip();
    }
  }

  function updateFlipper(f) {
    const target = f.active ? f.activeAngle : f.restAngle;
    const prev = f.angle;
    const speed = 0.5;
    if (Math.abs(target - prev) <= speed) {
      f.angle = target;
    } else {
      f.angle += Math.sign(target - prev) * speed;
    }
    f.omega = f.angle - prev;
  }

  // ===== スコア =====
  function addScore(pts, x, y) {
    state.score += pts;
    state.popups.push({ x, y, text: '+' + pts, life: 40 });
    updateUI();
  }

  function tickPopups() {
    for (const p of state.popups) {
      p.y -= 0.6;
      p.life--;
    }
    state.popups = state.popups.filter(p => p.life > 0);
  }

  // ===== ゲームフロー =====
  function startGame() {
    state.score = 0;
    state.balls = 3;
    state.gravity = GRAVITY_BY_LEVEL[state.level];
    state.popups = [];
    state.running = true;
    resetBall();
    updateUI();
    showScreen('game');
    sound.init();
    sound.resume();
  }

  function resetBall() {
    ball.x = 328;
    ball.y = 501;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail = [];
  }

  function launch() {
    if (!state.running) return;
    const inLane = ball.x > 308 && ball.y > 460;
    const slow = Math.hypot(ball.vx, ball.vy) < 1.5;
    if (inLane && slow) {
      ball.vy = -14 - Math.random() * 2;
      ball.vx = -1.2 - Math.random() * 0.5;
      sound.launch();
      setMessage('GO！', 800);
    }
  }

  function drain() {
    sound.drain();
    state.balls--;
    updateUI();
    if (state.balls <= 0) {
      endGame();
    } else {
      resetBall();
      setMessage(`のこり ${state.balls} 個`, 1200);
    }
  }

  function endGame() {
    state.running = false;
    if (state.score > state.high) {
      state.high = state.score;
      saveHigh();
    }
    $('result-score').textContent = state.score;
    $('result-high').textContent = state.high;
    $('result-title').textContent = 'ゲームオーバー';
    sound.over();
    setTimeout(() => showScreen('result'), 700);
  }

  // ===== 描画 =====
  function render() {
    ctx.clearRect(0, 0, W, H);

    drawBackground();
    drawPlayfieldArt();
    drawSlingshotBodies();
    drawWalls();
    drawSlingshotRubbers();
    drawPegs();
    drawBumpers();
    drawFlipperShadow(FL);
    drawFlipperShadow(FR);
    drawFlipper(FL);
    drawFlipper(FR);
    drawPlunger();
    drawBall();
    drawPopups();
  }

  function drawBackground() {
    ctx.save();
    // 全体グラデ（プレイフィールド表面）
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#ffe1ec');
    bg.addColorStop(0.45, '#fff0d8');
    bg.addColorStop(1, '#dceedf');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ビネット
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 320);
    vg.addColorStop(0, 'rgba(255,255,255,0.45)');
    vg.addColorStop(1, 'rgba(120, 60, 90, 0.20)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // 細かいドット模様（プレイフィールド印刷風）
    ctx.fillStyle = 'rgba(180,120,140,0.10)';
    for (let y = 60; y < H - 30; y += 18) {
      for (let x = (Math.floor(y / 18) % 2 ? 16 : 26); x < W - 12; x += 20) {
        ctx.beginPath();
        ctx.arc(x, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPlayfieldArt() {
    ctx.save();

    // 大きな装飾ハート（中央の薄い背景）
    ctx.save();
    ctx.translate(180, 380);
    ctx.scale(2.2, 2.2);
    ctx.fillStyle = 'rgba(255,170,200,0.10)';
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.bezierCurveTo(-30, -8, -30, -36, -16, -36);
    ctx.bezierCurveTo(-4, -36, 0, -22, 0, -16);
    ctx.bezierCurveTo(0, -22, 4, -36, 16, -36);
    ctx.bezierCurveTo(30, -36, 30, -8, 0, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // インレーンの矢印
    drawArrow(45, 430, 0.7);
    drawArrow(315, 430, 0.7);
    drawArrow(45, 460, 0.45);
    drawArrow(315, 460, 0.45);

    // 装飾の花・葉・しずく（背景になじむ非円形）
    drawFlower(60, 250, 10, 'rgba(255,180,200,0.30)');
    drawFlower(300, 250, 10, 'rgba(255,180,200,0.30)');
    drawLeaf(50, 340, 12, -0.4, 'rgba(168,220,181,0.35)');
    drawLeaf(310, 340, 12, 0.4 + Math.PI, 'rgba(168,220,181,0.35)');
    drawDiamond(140, 380, 8, 'rgba(255,230,160,0.35)');
    drawDiamond(220, 380, 8, 'rgba(255,230,160,0.35)');

    // 装飾の星（角ばった非円形）
    drawStar(36, 130, 4, 'rgba(255,200,220,0.55)');
    drawStar(324, 130, 4, 'rgba(255,200,220,0.55)');
    drawStar(180, 60, 5, 'rgba(255,255,255,0.65)');
    drawStar(80, 80, 3, 'rgba(255,235,200,0.65)');
    drawStar(280, 80, 3, 'rgba(255,235,200,0.65)');

    // ランチレーンの「LAUNCH」文字
    ctx.save();
    ctx.translate(328, 350);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(120,80,100,0.35)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LAUNCH', 0, 0);
    ctx.restore();

    // ランチレーンの溝（やや暗く）
    ctx.fillStyle = 'rgba(180,140,160,0.15)';
    ctx.fillRect(310, 90, 36, 415);

    ctx.restore();
  }

  function drawArrow(x, y, alpha) {
    ctx.save();
    ctx.fillStyle = `rgba(255,143,176,${alpha})`;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.8})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 4);
    ctx.lineTo(x - 1, y - 4);
    ctx.lineTo(x - 1, y - 7);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x - 1, y + 7);
    ctx.lineTo(x - 1, y + 4);
    ctx.lineTo(x - 6, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawStar(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? size : size * 0.45;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFlower(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i * Math.PI * 2) / petals - Math.PI / 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.55, size * 0.42, size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 中央
    ctx.fillStyle = 'rgba(255,220,140,0.5)';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawLeaf(x, y, size, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * 0.7, size, 0);
    ctx.quadraticCurveTo(0, size * 0.7, -size, 0);
    ctx.closePath();
    ctx.fill();
    // 葉脈
    ctx.strokeStyle = 'rgba(120,160,130,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawDiamond(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawSlingshotBodies() {
    ctx.save();
    for (const w of walls) {
      if (w.kind !== 'sling') continue;
      ctx.beginPath();
      if (w.side === 'L') {
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.lineTo(12, 484);
        ctx.lineTo(12, w.y1);
      } else {
        ctx.moveTo(w.x1, w.y1);
        ctx.lineTo(w.x2, w.y2);
        ctx.lineTo(308, 484);
        ctx.lineTo(308, w.y1);
      }
      ctx.closePath();
      const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
      const g = ctx.createRadialGradient(cx, cy - 10, 4, cx, cy, 80);
      g.addColorStop(0, '#fff0f5');
      g.addColorStop(0.5, '#ffc4d4');
      g.addColorStop(1, '#d77a96');
      ctx.fillStyle = g;
      ctx.fill();
      // 縁取り
      ctx.strokeStyle = '#a85070';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSlingshotRubbers() {
    ctx.save();
    ctx.lineCap = 'round';
    for (const w of walls) {
      if (w.kind !== 'sling') continue;
      // ゴム影
      ctx.strokeStyle = 'rgba(80, 20, 40, 0.5)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1 + 1);
      ctx.lineTo(w.x2, w.y2 + 1);
      ctx.stroke();
      // ゴム本体
      const gr = ctx.createLinearGradient(w.x1, w.y1, w.x2, w.y2);
      gr.addColorStop(0, '#ff5476');
      gr.addColorStop(0.5, '#ff8ba6');
      gr.addColorStop(1, '#ff5476');
      ctx.strokeStyle = gr;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
      // ゴムハイライト
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1 - 1.5);
      ctx.lineTo(w.x2, w.y2 - 1.5);
      ctx.stroke();
      // ポスト（クロームの留めポスト）
      drawPost(w.x1, w.y1);
      drawPost(w.x2, w.y2);
    }
    ctx.restore();
  }

  function drawPost(x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 1.5, 5.5, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#d8d8e0');
    g.addColorStop(1, '#5a5a64');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x - 1.4, y - 1.4, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWalls() {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // レール影
    ctx.strokeStyle = 'rgba(80,40,60,0.45)';
    ctx.lineWidth = 7;
    for (const w of walls) {
      if (w.kind === 'sling') continue;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1 + 2);
      ctx.lineTo(w.x2, w.y2 + 2);
      ctx.stroke();
    }
    // クロームレール本体
    for (const w of walls) {
      if (w.kind === 'sling') continue;
      const grd = ctx.createLinearGradient(
        (w.x1 + w.x2) / 2 - 4, (w.y1 + w.y2) / 2,
        (w.x1 + w.x2) / 2 + 4, (w.y1 + w.y2) / 2
      );
      grd.addColorStop(0, '#7a7a85');
      grd.addColorStop(0.4, '#e0e0e8');
      grd.addColorStop(0.7, '#ffffff');
      grd.addColorStop(1, '#9a9aa5');
      ctx.strokeStyle = grd;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }
    // ハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    for (const w of walls) {
      if (w.kind === 'sling') continue;
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1 - 1);
      ctx.lineTo(w.x2, w.y2 - 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPegs() {
    for (const p of pegs) {
      // 床の影
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(p.x + 0.6, p.y + 1.8, p.r + 0.8, (p.r + 0.8) * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // ヒット時の小ハロー
      if (p.flash > 0) {
        const haloR = p.r + 2 + p.flash;
        const halo = ctx.createRadialGradient(p.x, p.y, p.r, p.x, p.y, haloR);
        halo.addColorStop(0, `rgba(255,240,180,${p.flash / 10})`);
        halo.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        p.flash--;
      }

      // クローム本体
      const g = ctx.createRadialGradient(p.x - 1.2, p.y - 1.4, 0.3, p.x, p.y + 0.5, p.r * 1.3);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, '#d8d8e0');
      g.addColorStop(1, '#3a3a44');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();

      // 縁の暗線
      ctx.strokeStyle = 'rgba(20,15,25,0.6)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();

      // ハイライト
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(p.x - 1.2, p.y - 1.3, p.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBumpers() {
    for (const b of bumpers) {
      // 床の影
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(b.x + 2, b.y + 5, b.r + 2, (b.r + 2) * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // ヒット時のハロー
      if (b.flash > 0) {
        const haloR = b.r + 4 + b.flash * 0.7;
        const halo = ctx.createRadialGradient(b.x, b.y, b.r, b.x, b.y, haloR);
        halo.addColorStop(0, `rgba(255,240,180,${b.flash / 14})`);
        halo.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(b.x, b.y, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      // スカート（衝突半径と同じ）
      const skirtR = b.r;
      const skirt = ctx.createRadialGradient(
        b.x - skirtR * 0.25, b.y - skirtR * 0.25, skirtR * 0.3,
        b.x, b.y + skirtR * 0.4, skirtR * 1.1
      );
      skirt.addColorStop(0, '#ffffff');
      skirt.addColorStop(0.55, '#f0e0e8');
      skirt.addColorStop(1, '#988893');
      ctx.fillStyle = skirt;
      ctx.beginPath();
      ctx.arc(b.x, b.y, skirtR, 0, Math.PI * 2);
      ctx.fill();
      // スカートのリング
      ctx.strokeStyle = '#6a4a5a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, skirtR - 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, skirtR - 3, 0, Math.PI * 2);
      ctx.stroke();

      // キャップ（中央の光るドーム）
      const flashScale = b.flash > 0 ? 1 + b.flash * 0.012 : 1;
      const capR = b.r * 0.66 * flashScale;
      const cap = ctx.createRadialGradient(
        b.x - capR * 0.4, b.y - capR * 0.45, capR * 0.05,
        b.x, b.y + capR * 0.2, capR * 1.1
      );
      cap.addColorStop(0, '#ffffff');
      cap.addColorStop(0.45, b.color);
      cap.addColorStop(1, shade(b.color, -35));
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.arc(b.x, b.y, capR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(b.color, -45);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, capR - 0.3, 0, Math.PI * 2);
      ctx.stroke();
      // ハイライト
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(b.x - capR * 0.32, b.y - capR * 0.42, capR * 0.32, capR * 0.22, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // 数字
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = `bold ${Math.round(capR * 0.65)}px "Hiragino Maru Gothic ProN", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.score), b.x, b.y + 1);

      if (b.flash > 0) b.flash--;
    }
  }

  function drawFlipperShadow(f) {
    const tx = f.pivotX + f.length * Math.cos(f.angle);
    const ty = f.pivotY + f.length * Math.sin(f.angle);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(f.pivotX + 2, f.pivotY + 5);
    ctx.lineTo(tx + 2, ty + 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawFlipper(f) {
    const tx = f.pivotX + f.length * Math.cos(f.angle);
    const ty = f.pivotY + f.length * Math.sin(f.angle);
    ctx.save();
    ctx.lineCap = 'round';

    // 外枠（ダークピンク）
    ctx.strokeStyle = '#a83e62';
    ctx.lineWidth = 17;
    ctx.beginPath();
    ctx.moveTo(f.pivotX, f.pivotY);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // 本体グラデ
    const ux = (tx - f.pivotX) / f.length, uy = (ty - f.pivotY) / f.length;
    const px = -uy, py = ux;
    const fg = ctx.createLinearGradient(
      f.pivotX + px * 8, f.pivotY + py * 8,
      f.pivotX - px * 8, f.pivotY - py * 8
    );
    fg.addColorStop(0, '#ffd0de');
    fg.addColorStop(0.4, '#ff8fb0');
    fg.addColorStop(1, '#c44d72');
    ctx.strokeStyle = fg;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(f.pivotX, f.pivotY);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // グロスハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(f.pivotX + ux * 5 + px * 3.5, f.pivotY + uy * 5 + py * 3.5);
    ctx.lineTo(tx - ux * 5 + px * 3.5, ty - uy * 5 + py * 3.5);
    ctx.stroke();

    // 下端の影
    ctx.strokeStyle = 'rgba(80,20,40,0.55)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(f.pivotX + ux * 4 - px * 5, f.pivotY + uy * 4 - py * 5);
    ctx.lineTo(tx - ux * 4 - px * 5, ty - uy * 4 - py * 5);
    ctx.stroke();

    // ピボットボルト（クローム）
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(f.pivotX + 1, f.pivotY + 2, 6, 0, Math.PI * 2);
    ctx.fill();
    const bg = ctx.createRadialGradient(f.pivotX - 2, f.pivotY - 2, 0.5, f.pivotX, f.pivotY, 6);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, '#d0d0d8');
    bg.addColorStop(1, '#4a4a52');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(f.pivotX, f.pivotY, 6, 0, Math.PI * 2);
    ctx.fill();
    // ボルトの十字
    ctx.strokeStyle = 'rgba(40,30,40,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.pivotX - 2.5, f.pivotY);
    ctx.lineTo(f.pivotX + 2.5, f.pivotY);
    ctx.moveTo(f.pivotX, f.pivotY - 2.5);
    ctx.lineTo(f.pivotX, f.pivotY + 2.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlunger() {
    ctx.save();
    // プランジャーケース
    ctx.fillStyle = 'rgba(80,40,60,0.18)';
    ctx.fillRect(322, 510, 12, 26);
    // スプリングコイル
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) {
      const yy = 514 + i * 3.5;
      ctx.beginPath();
      ctx.ellipse(328, yy, 6, 1.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      const yy = 513.5 + i * 3.5;
      ctx.beginPath();
      ctx.ellipse(328, yy, 6, 1.4, 0, 0, Math.PI);
      ctx.stroke();
    }
    // プランジャーの皿（玉受け）
    const pg = ctx.createLinearGradient(316, 504, 340, 510);
    pg.addColorStop(0, '#a8674a');
    pg.addColorStop(0.4, '#ffd590');
    pg.addColorStop(0.7, '#ffe8b4');
    pg.addColorStop(1, '#a8674a');
    ctx.fillStyle = pg;
    ctx.strokeStyle = '#5a3a28';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(316, 502, 24, 8, 3);
    ctx.fill();
    ctx.stroke();
    // 金属反射
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(319, 503, 18, 1.5);
    ctx.restore();
  }

  function drawBall() {
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const a = (i + 1) / ball.trail.length * 0.25;
      ctx.fillStyle = `rgba(255,143,176,${a})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.4 + i / ball.trail.length * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    const grad = ctx.createRadialGradient(
      ball.x - 3, ball.y - 3, 1, ball.x, ball.y, BALL_R
    );
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#f0f0f0');
    grad.addColorStop(1, '#c8c8d0');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(ball.x - 3, ball.y - 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPopups() {
    ctx.save();
    ctx.font = 'bold 14px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.textAlign = 'center';
    for (const p of state.popups) {
      const a = Math.min(1, p.life / 30);
      ctx.fillStyle = `rgba(255,122,156,${a})`;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function shade(hex, percent) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const f = (1 + percent / 100);
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // ===== ループ =====
  let lastTime = 0;
  function loop(now) {
    const dt = now - lastTime;
    lastTime = now;
    updateFlipper(FL);
    updateFlipper(FR);
    if (state.running) step();
    tickPopups();
    tickMessage(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ===== 入力 =====
  function bindFlipperButton(el, fl) {
    const press = (e) => {
      e.preventDefault();
      fl.active = true;
      el.classList.add('pressed');
      sound.init(); sound.resume();
    };
    const release = (e) => {
      if (e) e.preventDefault();
      fl.active = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
  }

  function bindLaunchButton(el) {
    const press = (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      launch();
      sound.init(); sound.resume();
    };
    const release = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        FL.active = true;
        $('btn-flip-left').classList.add('pressed');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        FR.active = true;
        $('btn-flip-right').classList.add('pressed');
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        launch();
        $('btn-launch').classList.add('pressed');
        setTimeout(() => $('btn-launch').classList.remove('pressed'), 120);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        FL.active = false;
        $('btn-flip-left').classList.remove('pressed');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        FR.active = false;
        $('btn-flip-right').classList.remove('pressed');
      }
    });
  }

  // ===== 初期化 =====
  function init() {
    sound.loadPref();
    loadHigh();
    $('sound-toggle').checked = sound.enabled;
    $('sound-toggle').addEventListener('change', (e) => {
      sound.setEnabled(e.target.checked);
    });

    const slider = $('level-slider');
    const display = $('level-display');
    const hint = $('level-hint');
    slider.value = String(state.level);
    display.textContent = String(state.level);
    hint.textContent = HINT_BY_LEVEL[state.level];
    slider.addEventListener('input', (e) => {
      state.level = parseInt(e.target.value, 10);
      display.textContent = String(state.level);
      hint.textContent = HINT_BY_LEVEL[state.level];
    });

    $('btn-start').addEventListener('click', startGame);
    $('btn-replay').addEventListener('click', startGame);
    $('btn-result-back').addEventListener('click', () => showScreen('title'));
    $('btn-back').addEventListener('click', () => {
      state.running = false;
      showScreen('title');
    });
    $('btn-reset').addEventListener('click', () => {
      if (confirm('リセットして最初からやり直す？')) startGame();
    });

    bindFlipperButton($('btn-flip-left'), FL);
    bindFlipperButton($('btn-flip-right'), FR);
    bindLaunchButton($('btn-launch'));
    bindKeys();

    fitCanvas();
    window.addEventListener('resize', fitCanvas);

    if (!CanvasRenderingContext2D.prototype.roundRect) {
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
      };
    }

    requestAnimationFrame((t) => { lastTime = t; loop(t); });
  }

  init();
})();
