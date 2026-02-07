(() => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const statusEl = document.getElementById("status");
  const overlayEl = document.getElementById("overlay");
  const finalScoreEl = document.getElementById("final-score");
  const overlayTitleEl = document.getElementById("overlay-title");
  const overlaySubtextEl = document.getElementById("overlay-subtext");
  const overlayActionEl = document.getElementById("overlay-action");
  const overlayArtEl = document.getElementById("overlay-art");
  const levelEl = document.getElementById("level");
  const timerEl = document.getElementById("timer");
  const startBtn = document.getElementById("start");
  const restartBtn = document.getElementById("restart");
  const pauseBtn = document.getElementById("pause");
  const mobileControls = document.querySelectorAll(".mobile-controls button[data-dir]");

  const GRID = 25;
  const GRID_ROWS = 25;
  let gridCols = 25;
  let cellSize = 20;
  const BASE_TICK_MS = 138;
  const LEVEL_TARGETS = [1, 2, 3, 4, 5];
  const LEVEL_COLORS = ["#ef4444", "#f97316", "#3b82f6", "#6366f1", "#8b5cf6"];
  const LEVEL_APPLE_INTERVALS = [2000, 1500, 1000, 500, 200];
  const WORM_MOVE_MS = 680;
  const WORM_LENGTH = 2;
  const GOLD_EFFECT_MS = 5000;
  const TUNNEL_COLOR = "#4b2e1f";
  const TUNNEL_MIN_DISTANCE = 10;
  const TUNNEL_EDGE_BUFFER = 2;

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const OPPOSITE = {
    up: "down",
    down: "up",
    left: "right",
    right: "left",
  };

  function createInitialState() {
    const startX = Math.floor(gridCols / 2);
    const startY = Math.floor(GRID_ROWS / 2);

    return {
      snake: [
        { x: startX, y: startY },
        { x: startX - 1, y: startY },
        { x: startX - 2, y: startY },
        { x: startX - 3, y: startY },
        { x: startX - 4, y: startY },
      ],
      direction: "right",
      pendingDirection: "right",
      apples: [],
      applesEaten: 0,
      level: 1,
      worms: [],
      tunnels: [],
      justTeleported: false,
      goldApplePos: null,
      goldEffectUntil: 0,
      goldAppleUsedThisLevel: false,
      running: false,
      paused: false,
      gameOver: false,
      win: false,
    };
  }

  function inBounds(pos) {
    return pos.x >= 0 && pos.x < gridCols && pos.y >= 0 && pos.y < GRID_ROWS;
  }

  function isCellOccupied(snake, pos) {
    return snake.some((segment) => segment.x === pos.x && segment.y === pos.y);
  }

  function getWormCells(worm) {
    if (worm.cells && worm.cells.length) return worm.cells;
    const len = worm.length ?? WORM_LENGTH;
    const cells = [];
    for (let i = 0; i < len; i += 1) {
      cells.push({
        x: worm.x - DIRS[worm.dir].x * i,
        y: worm.y - DIRS[worm.dir].y * i,
      });
    }
    return cells;
  }

  function isWormOccupied(worms, pos) {
    return worms.some((worm) => getWormCells(worm).some((cell) => cell.x === pos.x && cell.y === pos.y));
  }

  function isWormOccupiedExcept(worms, pos, index) {
    return worms.some((worm, idx) => {
      if (idx === index) return false;
      return getWormCells(worm).some((cell) => cell.x === pos.x && cell.y === pos.y);
    });
  }

  function isGoldActive(nowMs) {
    return state.goldEffectUntil && nowMs < state.goldEffectUntil;
  }

  function placeFood(state, rng = Math.random) {
    const empty = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < gridCols; x += 1) {
        if (!isCellOccupied(state.snake, { x, y }) &&
            !isWormOccupied(state.worms, { x, y }) &&
            !state.apples.some((apple) => apple.x === x && apple.y === y) &&
            !state.tunnels.some((tunnel) => tunnel.x === x && tunnel.y === y) &&
            !(state.goldApplePos && state.goldApplePos.x === x && state.goldApplePos.y === y)) {
          empty.push({ x, y });
        }
      }
    }
    if (empty.length === 0) return null;
    const idx = Math.floor(rng() * empty.length);
    return empty[idx];
  }

  function spawnOneRedApple(rng = Math.random) {
    if (state.apples.length > 0) return;
    const pos = placeFood(state, rng);
    if (pos) {
      state = { ...state, apples: [pos] };
    }
  }

  let redAppleTimeout = null;
  function scheduleRedAppleRespawn() {
    if (redAppleTimeout) {
      clearTimeout(redAppleTimeout);
      redAppleTimeout = null;
    }
    const delay = 600 + Math.random() * 600;
    redAppleTimeout = setTimeout(() => {
      spawnOneRedApple();
      draw();
    }, delay);
  }

  function placeGoldApple(state, rng = Math.random) {
    const empty = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < gridCols; x += 1) {
        const pos = { x, y };
        if (isCellOccupied(state.snake, pos)) continue;
        if (isWormOccupied(state.worms, pos)) continue;
        if (state.apples.some((apple) => apple.x === x && apple.y === y)) continue;
        if (state.tunnels.some((tunnel) => tunnel.x === x && tunnel.y === y)) continue;
        empty.push(pos);
      }
    }
    if (empty.length === 0) return null;
    const idx = Math.floor(rng() * empty.length);
    return empty[idx];
  }

  function nextState(state, inputDirection, rng = Math.random, nowMs = Date.now()) {
    if (state.gameOver || !state.running || state.paused) return state;

    let direction = state.direction;
    if (inputDirection && inputDirection !== OPPOSITE[direction]) {
      direction = inputDirection;
    }

    const head = state.snake[0];
    let newHead = { x: head.x + DIRS[direction].x, y: head.y + DIRS[direction].y };
    let didTeleport = false;

    if (!inBounds(newHead)) {
      return { ...state, direction, gameOver: true, running: false };
    }

    if (!state.justTeleported && state.tunnels.length === 2) {
      const [A, B] = state.tunnels;
      if (newHead.x === A.x && newHead.y === A.y) {
        newHead = { x: B.x, y: B.y };
        didTeleport = true;
      } else if (newHead.x === B.x && newHead.y === B.y) {
        newHead = { x: A.x, y: A.y };
        didTeleport = true;
      }
    }

    const tail = state.snake[state.snake.length - 1];
    const hitsSelf = isCellOccupied(state.snake, newHead) &&
      !(newHead.x === tail.x && newHead.y === tail.y);

    if (hitsSelf || isWormOccupied(state.worms, newHead)) {
      return { ...state, direction, gameOver: true, running: false };
    }

    let goldApplePos = state.goldApplePos;
    let goldAppleUsedThisLevel = state.goldAppleUsedThisLevel;
    let goldEffectUntil = state.goldEffectUntil;
    if (goldApplePos && newHead.x === goldApplePos.x && newHead.y === goldApplePos.y) {
      goldApplePos = null;
      goldAppleUsedThisLevel = true;
      goldEffectUntil = nowMs + GOLD_EFFECT_MS;
      clearGoldMove();
      sfxPlayerGoldenApple();
    }

    const appleIndex = state.apples.findIndex((apple) => apple.x === newHead.x && apple.y === newHead.y);
    const ateFood = appleIndex !== -1;
    const newSnake = [newHead, ...state.snake];

    if (!ateFood) {
      newSnake.pop();
    }

    const newApples = state.apples.slice();
    if (ateFood) newApples.splice(appleIndex, 1);

    let nextApplesEaten = ateFood ? state.applesEaten + 1 : state.applesEaten;
    let nextLevel = state.level;
    let nextWorms = state.worms;
    let win = false;

    if (ateFood) {
      const target = LEVEL_TARGETS[state.level - 1] ?? LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
      if (nextApplesEaten >= target) {
        if (state.level >= 5) {
          win = true;
        } else {
          nextLevel = state.level + 1;
          nextApplesEaten = 0;
          goldAppleUsedThisLevel = false;
          nextWorms = [...state.worms, spawnWorm({ ...state, snake: newSnake }, rng)];
        }
      }
    }

    return {
      ...state,
      snake: newSnake,
      direction,
      pendingDirection: direction,
      apples: newApples,
      applesEaten: nextApplesEaten,
      level: nextLevel,
      worms: nextWorms,
      goldApplePos,
      goldAppleUsedThisLevel,
      goldEffectUntil,
      justTeleported: didTeleport,
      win,
      gameOver: win ? false : state.gameOver,
      running: win ? false : state.running,
    };
  }

  let state = null;
  let timerId = null;
  let clockId = null;
  let recordedWin = false;
  let elapsedMs = 0;
  let lastStartTs = null;
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function playTone(freq, durationMs, type = "sine", gainValue = 0.06) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  }

  function playLevelUp() {
    ensureAudio();
    playTone(523, 90, "triangle", 0.08);
    setTimeout(() => playTone(659, 90, "triangle", 0.08), 90);
    setTimeout(() => playTone(784, 120, "triangle", 0.08), 180);
    setStatus("Level up!");
    setTimeout(() => {
      if (!state.gameOver && !state.win) setStatus("");
    }, 900);
  }

  function sfxWormRedApple() {
    ensureAudio();
    playTone(160, 60, "square", 0.05);
    setTimeout(() => playTone(120, 60, "square", 0.05), 70);
  }

  function sfxWormGoldenApple() {
    ensureAudio();
    playTone(880, 50, "triangle", 0.06);
    setTimeout(() => playTone(660, 70, "triangle", 0.06), 60);
  }

  function sfxPlayerGoldenApple() {
    ensureAudio();
    playTone(523, 70, "triangle", 0.07);
    setTimeout(() => playTone(659, 70, "triangle", 0.07), 80);
    setTimeout(() => playTone(784, 90, "triangle", 0.07), 160);
  }

  let boardPadding = 0;

  function resizeCanvas() {
    const app = document.querySelector(".app");
    const controls = document.querySelector(".controls");
    const hint = document.querySelector(".hint");
    const mobile = document.querySelector(".mobile-controls");
    const hudTop = document.querySelector(".hud-top");

    const appStyle = window.getComputedStyle(app);
    const gap = parseFloat(appStyle.gap || "0");
    const padY = parseFloat(appStyle.paddingTop || "0") + parseFloat(appStyle.paddingBottom || "0");

    const controlsH = controls ? controls.getBoundingClientRect().height : 0;
    const hintH = hint ? hint.getBoundingClientRect().height : 0;
    const mobileH = mobile ? mobile.getBoundingClientRect().height : 0;
    const hudTopH = hudTop ? hudTop.getBoundingClientRect().height : 0;

    const availableHeight = window.innerHeight - (controlsH + hintH + mobileH + hudTopH + padY + gap * 3);
    const size = Math.min(860, Math.floor(Math.min(window.innerWidth, availableHeight) * 0.95));

    gridCols = GRID;
    cellSize = Math.floor(size / (GRID + 0.4));
    boardPadding = Math.floor(cellSize * 0.2);
    const boardSize = gridCols * cellSize + boardPadding * 2;
    canvas.width = boardSize;
    canvas.height = boardSize;
  }

  function drawRoundedCell(ctxRef, x, y, w, h, r) {
    drawSegment(ctxRef, x, y, w, h, r, true, true, true, true);
  }

  function drawSegment(ctxRef, x, y, w, h, r, tl, tr, br, bl) {
    const r2 = Math.min(r, w / 2, h / 2);
    ctxRef.beginPath();
    ctxRef.moveTo(x + (tl ? r2 : 0), y);
    ctxRef.lineTo(x + w - (tr ? r2 : 0), y);
    if (tr) ctxRef.arcTo(x + w, y, x + w, y + r2, r2);
    ctxRef.lineTo(x + w, y + h - (br ? r2 : 0));
    if (br) ctxRef.arcTo(x + w, y + h, x + w - r2, y + h, r2);
    ctxRef.lineTo(x + (bl ? r2 : 0), y + h);
    if (bl) ctxRef.arcTo(x, y + h, x, y + h - r2, r2);
    ctxRef.lineTo(x, y + (tl ? r2 : 0));
    if (tl) ctxRef.arcTo(x, y, x + r2, y, r2);
    ctxRef.closePath();
    ctxRef.fill();
  }

  function drawFaintGrid(ctxRef, cell, pad) {
    ctxRef.save();
    ctxRef.strokeStyle = "rgba(255,255,255,0.06)";
    ctxRef.lineWidth = 1;

    for (let x = 0; x <= gridCols; x += 1) {
      const px = pad + x * cell;
      ctxRef.beginPath();
      ctxRef.moveTo(px + 0.5, pad);
      ctxRef.lineTo(px + 0.5, pad + GRID_ROWS * cell);
      ctxRef.stroke();
    }
    for (let y = 0; y <= GRID_ROWS; y += 1) {
      const py = pad + y * cell;
      ctxRef.beginPath();
      ctxRef.moveTo(pad, py + 0.5);
      ctxRef.lineTo(pad + gridCols * cell, py + 0.5);
      ctxRef.stroke();
    }
    ctxRef.restore();
  }

  function draw() {
    const cell = cellSize;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pad = boardPadding;
    if (pad > 0) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(0, 0, canvas.width, pad);
      ctx.fillRect(0, canvas.height - pad, canvas.width, pad);
      ctx.fillRect(0, 0, pad, canvas.height);
      ctx.fillRect(canvas.width - pad, 0, pad, canvas.height);
    }
    drawFaintGrid(ctx, cell, pad);

    state.apples.forEach((apple) => {
      drawApple(ctx, pad + apple.x * cell + cell / 2, pad + apple.y * cell + cell / 2, cell * 0.32);
    });

    if (state.goldApplePos) {
      const t = performance.now();
      const period = 480;
      const phase = (t % period) / period;
      const tri = phase < 0.5 ? phase / 0.5 : (1 - phase) / 0.5;
      const pulse = 1 - 0.2 * tri;
      drawGoldenApple(ctx, pad + state.goldApplePos.x * cell + cell / 2, pad + state.goldApplePos.y * cell + cell / 2, cell * 0.4 * pulse);
    }

    state.tunnels.forEach((tunnel) => {
      drawHole(ctx, pad + tunnel.x * cell + cell / 2, pad + tunnel.y * cell + cell / 2, cell * 0.6);
    });

    const now = performance.now();
    state.worms.forEach((worm) => drawWorm(ctx, worm, cell, now, pad));

    const goldActive = isGoldActive(Date.now());
    state.snake.forEach((segment, idx) => {
      if (goldActive) {
        ctx.fillStyle = "#f5c542";
      } else {
        ctx.fillStyle = idx === 0 ? "#a7f3b2" : "#6be675";
      }
      if (idx === 0) {
        const next = state.snake[1];
        const dir = next ? { x: segment.x - next.x, y: segment.y - next.y } : { x: 1, y: 0 };
        let tl = false; let tr = false; let br = false; let bl = false;
        if (dir.x === 1) { tr = true; br = true; }
        if (dir.x === -1) { tl = true; bl = true; }
        if (dir.y === 1) { bl = true; br = true; }
        if (dir.y === -1) { tl = true; tr = true; }
        drawSegment(ctx, pad + segment.x * cell, pad + segment.y * cell, cell, cell, cell * 0.22, tl, tr, br, bl);
      } else if (idx === state.snake.length - 1) {
        const prev = state.snake[idx - 1];
        const dir = { x: prev.x - segment.x, y: prev.y - segment.y };
        let tl = false; let tr = false; let br = false; let bl = false;
        if (dir.x === 1) { tl = true; bl = true; }
        if (dir.x === -1) { tr = true; br = true; }
        if (dir.y === 1) { tl = true; tr = true; }
        if (dir.y === -1) { bl = true; br = true; }
        drawSegment(ctx, pad + segment.x * cell, pad + segment.y * cell, cell, cell, cell * 0.22, tl, tr, br, bl);
      } else {
        ctx.fillRect(pad + segment.x * cell, pad + segment.y * cell, cell, cell);
      }
      if (idx === 0) {
        drawTongue(segment, cell, state.direction, pad);
        drawSnakeEyes(segment, cell, state.direction, pad);
      }
    });
  }

  function drawApple(ctxRef, cx, cy, r) {
    drawGoldenApple(ctxRef, cx, cy, r, {
      body: "#ef4444",
      mid: "#f87171",
      leaf: "#22c55e",
      stem: "#6b3f1d",
      highlight: "rgba(255,255,255,0.65)",
      shadow: "rgba(0,0,0,0.22)",
    });
  }

  function drawGoldenApple(ctxRef, cx, cy, r, palette = null) {
    const bodyW = r * 1.6;
    const bodyH = r * 1.8;
    const colors = palette || {
      body: "#f5c542",
      mid: "#f7d774",
      leaf: "#a3e635",
      stem: "#8a5a00",
      highlight: "rgba(255,255,255,0.6)",
      shadow: "rgba(0,0,0,0.22)",
    };

    ctxRef.fillStyle = colors.shadow;
    ctxRef.beginPath();
    ctxRef.ellipse(cx, cy + r * 0.85, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.fillStyle = colors.body;
    ctxRef.beginPath();
    ctxRef.moveTo(cx, cy - bodyH * 0.55);
    ctxRef.bezierCurveTo(
      cx - bodyW * 0.7, cy - bodyH * 0.85,
      cx - bodyW * 1.1, cy - bodyH * 0.15,
      cx - bodyW * 0.7, cy + bodyH * 0.45
    );
    ctxRef.bezierCurveTo(
      cx - bodyW * 0.2, cy + bodyH * 0.9,
      cx + bodyW * 0.2, cy + bodyH * 0.9,
      cx + bodyW * 0.7, cy + bodyH * 0.45
    );
    ctxRef.bezierCurveTo(
      cx + bodyW * 1.1, cy - bodyH * 0.15,
      cx + bodyW * 0.7, cy - bodyH * 0.85,
      cx, cy - bodyH * 0.55
    );
    ctxRef.closePath();
    ctxRef.fill();

    ctxRef.fillStyle = colors.mid;
    ctxRef.beginPath();
    ctxRef.ellipse(cx, cy + bodyH * 0.1, bodyW * 0.55, bodyH * 0.5, 0, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.strokeStyle = colors.stem;
    ctxRef.lineWidth = Math.max(1, r * 0.12);
    ctxRef.beginPath();
    ctxRef.moveTo(cx, cy - bodyH * 0.95);
    ctxRef.lineTo(cx, cy - bodyH * 0.6);
    ctxRef.stroke();

    ctxRef.fillStyle = colors.leaf;
    ctxRef.beginPath();
    ctxRef.ellipse(cx + bodyW * 0.35, cy - bodyH * 0.8, bodyW * 0.35, bodyH * 0.18, -0.5, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.fillStyle = colors.highlight;
    ctxRef.beginPath();
    ctxRef.ellipse(cx - bodyW * 0.25, cy - bodyH * 0.15, bodyW * 0.18, bodyH * 0.25, -0.2, 0, Math.PI * 2);
    ctxRef.fill();
  }

  function drawWorm(ctxRef, worm, cell, t, pad) {
    const dir = DIRS[worm.dir];
    const lenCells = Math.max(2, worm.length || 2);

    const head = { x: worm.x, y: worm.y };
    const tail = { x: worm.x - dir.x * Math.min(1, lenCells - 1), y: worm.y - dir.y * Math.min(1, lenCells - 1) };

    const hx = pad + head.x * cell + cell / 2;
    const hy = pad + head.y * cell + cell / 2;
    const tx = pad + tail.x * cell + cell / 2;
    const ty = pad + tail.y * cell + cell / 2;

    const dx = hx - tx;
    const dy = hy - ty;
    const L = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / L;
    const uy = dy / L;

    const px = -uy;
    const py = ux;

    const phase = worm.phase ?? 0;
    const speed = 0.006;
    const wiggle = cell * 0.14;
    const s = Math.sin(t * speed + phase);

    const c1x = tx + dx * 0.33 + px * wiggle * s;
    const c1y = ty + dy * 0.33 + py * wiggle * s;
    const c2x = tx + dx * 0.66 - px * wiggle * s;
    const c2y = ty + dy * 0.66 - py * wiggle * s;

    ctxRef.save();

    ctxRef.strokeStyle = "rgba(0,0,0,0.18)";
    ctxRef.lineWidth = cell * 0.34;
    ctxRef.lineCap = "round";
    ctxRef.lineJoin = "round";
    ctxRef.beginPath();
    ctxRef.moveTo(tx, ty + cell * 0.06);
    ctxRef.bezierCurveTo(c1x, c1y + cell * 0.06, c2x, c2y + cell * 0.06, hx, hy + cell * 0.06);
    ctxRef.stroke();

    ctxRef.strokeStyle = "#f472b6";
    ctxRef.lineWidth = cell * 0.30;
    ctxRef.beginPath();
    ctxRef.moveTo(tx, ty);
    ctxRef.bezierCurveTo(c1x, c1y, c2x, c2y, hx, hy);
    ctxRef.stroke();

    ctxRef.strokeStyle = "rgba(255,255,255,0.22)";
    ctxRef.lineWidth = Math.max(1, cell * 0.06);
    const ringCount = 4;
    for (let i = 1; i <= ringCount; i += 1) {
      const u = i / (ringCount + 1);
      const bx = cubicBezier(tx, c1x, c2x, hx, u);
      const by = cubicBezier(ty, c1y, c2y, hy, u);
      const txd = cubicBezierDeriv(tx, c1x, c2x, hx, u);
      const tyd = cubicBezierDeriv(ty, c1y, c2y, hy, u);
      const tlen = Math.max(1, Math.hypot(txd, tyd));
      const nx = -tyd / tlen;
      const ny = txd / tlen;
      const ringHalf = cell * 0.12;
      ctxRef.beginPath();
      ctxRef.moveTo(bx - nx * ringHalf, by - ny * ringHalf);
      ctxRef.lineTo(bx + nx * ringHalf, by + ny * ringHalf);
      ctxRef.stroke();
    }

    const headLen = cell * 0.30;
    const headRad = cell * 0.14;
    const fx = ux * headLen;
    const fy = uy * headLen;

    ctxRef.fillStyle = "#f9a8d4";
    ctxRef.beginPath();
    ctxRef.arc(hx - fx * 0.25, hy - fy * 0.25, headRad, 0, Math.PI * 2);
    ctxRef.arc(hx + fx * 0.25, hy + fy * 0.25, headRad, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.fillStyle = "#111827";
    const eyeSide = cell * 0.06;
    const eyeFwd = cell * 0.05;
    ctxRef.beginPath();
    ctxRef.arc(hx + ux * eyeFwd + px * eyeSide, hy + uy * eyeFwd + py * eyeSide, cell * 0.035, 0, Math.PI * 2);
    ctxRef.arc(hx + ux * eyeFwd - px * eyeSide, hy + uy * eyeFwd - py * eyeSide, cell * 0.035, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.restore();
  }

  function cubicBezier(a, b, c, d, t) {
    const mt = 1 - t;
    return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
  }

  function cubicBezierDeriv(a, b, c, d, t) {
    const mt = 1 - t;
    return 3 * mt * mt * (b - a) + 6 * mt * t * (c - b) + 3 * t * t * (d - c);
  }

  function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return (u ** 3) * p0 +
      3 * (u ** 2) * t * p1 +
      3 * u * (t ** 2) * p2 +
      (t ** 3) * p3;
  }

  function drawHole(ctxRef, cx, cy, r) {
    ctxRef.fillStyle = TUNNEL_COLOR;
    ctxRef.beginPath();
    ctxRef.ellipse(cx, cy, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
    ctxRef.fill();

    ctxRef.fillStyle = "#0b0f14";
    ctxRef.beginPath();
    ctxRef.ellipse(cx, cy + r * 0.1, r * 0.75, r * 0.55, 0, 0, Math.PI * 2);
    ctxRef.fill();
  }

  function drawTongue(head, cell, direction, pad) {
    let baseX = (pad || 0) + head.x * cell + cell / 2;
    let baseY = (pad || 0) + head.y * cell + cell / 2;
    const offset = cell * 0.75;
    const fork = cell * 0.2;
    let tipX = baseX;
    let tipY = baseY;
    let fx = 0;
    let fy = 0;

    if (direction === "up") { baseY -= cell / 2; tipY = baseY - offset; fx = 0; fy = fork; }
    if (direction === "down") { baseY += cell / 2; tipY = baseY + offset; fx = 0; fy = fork; }
    if (direction === "left") { baseX -= cell / 2; tipX = baseX - offset; fx = 0; fy = fork; }
    if (direction === "right") { baseX += cell / 2; tipX = baseX + offset; fx = 0; fy = fork; }

    let baseAngle = 0;
    if (direction === "up") baseAngle = -Math.PI / 2;
    if (direction === "down") baseAngle = Math.PI / 2;
    if (direction === "left") baseAngle = Math.PI;
    if (direction === "right") baseAngle = 0;

    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.rotate(baseAngle);

    ctx.strokeStyle = "#ff6b8a";
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(offset, 0);
    ctx.lineTo(offset + fx, fy);
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset - fx, -fy);
    ctx.stroke();
    ctx.restore();
  }

  function drawSnakeEyes(head, cell, direction, pad) {
    const baseX = (pad || 0) + head.x * cell;
    const baseY = (pad || 0) + head.y * cell;
    let eye1 = { x: baseX + cell * 0.65, y: baseY + cell * 0.3 };
    let eye2 = { x: baseX + cell * 0.65, y: baseY + cell * 0.7 };

    if (direction === "left") {
      eye1 = { x: baseX + cell * 0.35, y: baseY + cell * 0.3 };
      eye2 = { x: baseX + cell * 0.35, y: baseY + cell * 0.7 };
    } else if (direction === "up") {
      eye1 = { x: baseX + cell * 0.3, y: baseY + cell * 0.35 };
      eye2 = { x: baseX + cell * 0.7, y: baseY + cell * 0.35 };
    } else if (direction === "down") {
      eye1 = { x: baseX + cell * 0.3, y: baseY + cell * 0.65 };
      eye2 = { x: baseX + cell * 0.7, y: baseY + cell * 0.65 };
    }

    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(eye1.x, eye1.y, cell * 0.08, 0, Math.PI * 2);
    ctx.arc(eye2.x, eye2.y, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateUI() {
    const target = LEVEL_TARGETS[state.level - 1] ?? LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
    scoreEl.textContent = `${state.applesEaten}/${target}`;
    levelEl.textContent = `Level ${state.level}`;
    levelEl.style.color = LEVEL_COLORS[state.level - 1] ?? LEVEL_COLORS[LEVEL_COLORS.length - 1];
    timerEl.textContent = formatTime(getElapsedMs());

    if (state.gameOver) {
      stopClock();
      setStatus("Game over.");
      overlayEl.style.display = "flex";
      overlayEl.setAttribute("aria-hidden", "false");
      overlayTitleEl.textContent = "";
      overlaySubtextEl.textContent = "Press Space to restart.";
      finalScoreEl.textContent = `${state.applesEaten}`;
      overlayActionEl.textContent = "Restart";
      if (overlayArtEl) {
        overlayArtEl.src = "assets/angryworm.png";
        overlayArtEl.style.display = "block";
      }
      return;
    }

    if (state.win) {
      stopClock();
      setStatus("");
      overlayEl.style.display = "flex";
      overlayEl.setAttribute("aria-hidden", "false");
      overlayTitleEl.textContent = "You win!";
      overlaySubtextEl.textContent = "You must really like apples =)";
      finalScoreEl.textContent = `${state.applesEaten}`;
      overlayActionEl.textContent = "Next Level";
      if (overlayArtEl) {
        overlayArtEl.style.display = "none";
      }
      return;
    }

    if (!state.running) {
      setStatus("Press Start to play.");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      if (overlayArtEl) overlayArtEl.style.display = "none";
    } else if (state.paused) {
      setStatus("Paused.");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      if (overlayArtEl) overlayArtEl.style.display = "none";
    } else {
      setStatus("");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      if (overlayArtEl) overlayArtEl.style.display = "none";
    }
  }

  function tick() {
    const prevState = state;
    const nowMs = Date.now();
    state = nextState(state, state.pendingDirection, Math.random, nowMs);
    if (state.justTeleported) {
      state = { ...state, justTeleported: false };
    }

    const moved = prevState.snake[0].x !== state.snake[0].x || prevState.snake[0].y !== state.snake[0].y;
    const ateFood = prevState.apples.some((apple) => apple.x === state.snake[0].x && apple.y === state.snake[0].y);

    if (moved && prevState.running && !prevState.paused && !prevState.gameOver && !prevState.win) {
      playTone(220, 30, "square", 0.03);
    }
    if (ateFood) {
      playTone(520, 80, "triangle", 0.08);
      scheduleRedAppleRespawn();
    }
    if (!prevState.gameOver && state.gameOver) {
      playTone(140, 220, "sawtooth", 0.09);
    }
    if (!prevState.win && state.win) {
      playTone(660, 180, "triangle", 0.08);
      setTimeout(() => playTone(880, 180, "triangle", 0.08), 120);
    }

    if (state.win && !recordedWin) {
      recordedWin = true;
    }
    if (prevState.level !== state.level) {
      ensureApplesForLevel(state.level);
      ensureTunnelsForLevel(state.level);
      ensureGoldAppleForLevel(state.level);
      playLevelUp();
    }

    updateUI();
    draw();
    scheduleTick();
  }

  function getTickMs(level) {
    const speedup = Math.pow(0.95, Math.max(0, level - 1));
    const base = Math.max(40, Math.round(BASE_TICK_MS * speedup));
    if (isGoldActive(Date.now())) return Math.round(base * 2);
    return base;
  }

  function scheduleTick() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (!state.running || state.gameOver || state.win || state.paused) return;
    const delay = getTickMs(state.level);
    timerId = setTimeout(tick, delay);
  }

  function startGame() {
    if (state.gameOver) return;
    if (!state.running) {
      state = { ...state, running: true, paused: false };
      if (lastStartTs === null) lastStartTs = performance.now();
      ensureGoldAppleForLevel(state.level);
    }
    ensureAudio();
    scheduleTick();
    startClock();
    updateUI();
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    ensureAudio();
    state = { ...state, paused: !state.paused };
    if (state.paused) stopClock(); else startClock();
    scheduleTick();
    updateUI();
  }

  function restartGame() {
    state = createInitialState();
    ensureApplesForLevel(state.level);
    ensureTunnelsForLevel(state.level);
    ensureGoldAppleForLevel(state.level);
    recordedWin = false;
    elapsedMs = 0;
    lastStartTs = null;
    stopClock();
    clearGoldMove();
    updateUI();
    draw();
  }

  function handleDirectionChange(dir) {
    if (!DIRS[dir]) return;
    if (dir === OPPOSITE[state.direction]) return;
    state = { ...state, pendingDirection: dir };
  }

  function handleKey(e) {
    const key = e.key.toLowerCase();
    ensureAudio();
    const isMoveKey = key.startsWith("arrow") || key === " " || key === "w" || key === "a" || key === "s" || key === "d";
    if (isMoveKey) e.preventDefault();

    if (e.code === "Space") {
      if (state.win || state.gameOver) {
        restartGame();
      } else {
        pauseGame();
      }
      return;
    }

    const isArrow = key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright";
    if (!state.running && !state.gameOver && isArrow) {
      handleDirectionChange(key.replace("arrow", ""));
      startGame();
      return;
    }

    if (key === "arrowup" || key === "w") handleDirectionChange("up");
    if (key === "arrowdown" || key === "s") handleDirectionChange("down");
    if (key === "arrowleft" || key === "a") handleDirectionChange("left");
    if (key === "arrowright" || key === "d") handleDirectionChange("right");
  }

  function getElapsedMs() {
    if (state.running && !state.paused && lastStartTs !== null) {
      return elapsedMs + (performance.now() - lastStartTs);
    }
    return elapsedMs;
  }

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function startClock() {
    if (clockId) return;
    if (lastStartTs === null) lastStartTs = performance.now();
    clockId = setInterval(() => {
      timerEl.textContent = formatTime(getElapsedMs());
    }, 250);
  }

  function stopClock() {
    if (clockId) {
      clearInterval(clockId);
      clockId = null;
    }
    if (lastStartTs !== null) {
      elapsedMs += performance.now() - lastStartTs;
      lastStartTs = null;
    }
  }

  function spawnWorm(stateForSpawn, rng = Math.random) {
    const empty = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < gridCols; x += 1) {
        const pos = { x, y };
        const dirs = Object.keys(DIRS);
        dirs.forEach((dir) => {
          const cells = [];
          for (let i = 0; i < WORM_LENGTH; i += 1) {
            cells.push({ x: x - DIRS[dir].x * i, y: y - DIRS[dir].y * i });
          }
          if (cells.some((cell) => !inBounds(cell))) return;
          if (cells.some((cell) => isCellOccupied(stateForSpawn.snake, cell))) return;
          if (cells.some((cell) => isWormOccupied(stateForSpawn.worms, cell))) return;
          if (cells.some((cell) => stateForSpawn.apples.some((apple) => apple.x === cell.x && apple.y === cell.y))) return;
          if (cells.some((cell) => stateForSpawn.tunnels.some((tunnel) => tunnel.x === cell.x && tunnel.y === cell.y))) return;
          empty.push({ x, y, dir });
        });
      }
    }
    if (empty.length === 0) {
      const cells = [];
      for (let i = 0; i < WORM_LENGTH; i += 1) {
        cells.push({ x: 0 - i, y: 0 });
      }
      return { x: 0, y: 0, dir: "right", length: WORM_LENGTH, phase: Math.random() * Math.PI * 2, cells };
    }
    const idx = Math.floor(rng() * empty.length);
    const picked = empty[idx];
    const cells = [];
    for (let i = 0; i < WORM_LENGTH; i += 1) {
      cells.push({ x: picked.x - DIRS[picked.dir].x * i, y: picked.y - DIRS[picked.dir].y * i });
    }
    return { ...picked, length: WORM_LENGTH, phase: Math.random() * Math.PI * 2, cells };
  }

  function spawnWormNear(worm, rng = Math.random) {
    const dirs = Object.keys(DIRS);
    for (let i = 0; i < dirs.length; i += 1) {
      const dirKey = dirs[Math.floor(rng() * dirs.length)];
      const dir = DIRS[dirKey];
      const head = { x: worm.x + dir.x, y: worm.y + dir.y };
      const tail = { x: head.x - dir.x, y: head.y - dir.y };
      if (!inBounds(head) || !inBounds(tail)) continue;
      if (isCellOccupied(state.snake, head) || isCellOccupied(state.snake, tail)) continue;
      if (isWormOccupied(state.worms, head) || isWormOccupied(state.worms, tail)) continue;
      if (state.apples.some((apple) => (apple.x === head.x && apple.y === head.y) || (apple.x === tail.x && apple.y === tail.y))) continue;
      if (state.tunnels.some((tunnel) => (tunnel.x === head.x && tunnel.y === head.y) || (tunnel.x === tail.x && tunnel.y === tail.y))) continue;
      if (state.goldApplePos && ((state.goldApplePos.x === head.x && state.goldApplePos.y === head.y) ||
        (state.goldApplePos.x === tail.x && state.goldApplePos.y === tail.y))) continue;
      const cells = [];
      for (let i = 0; i < WORM_LENGTH; i += 1) {
        cells.push({ x: head.x - dir.x * i, y: head.y - dir.y * i });
      }
      return { x: head.x, y: head.y, dir: dirKey, length: WORM_LENGTH, phase: rng() * Math.PI * 2, cells };
    }
    return spawnWorm(state, rng);
  }

  function getWormTarget() {
    if (state.goldApplePos) return state.goldApplePos;
    if (state.apples.length) return state.apples[0];
    return null;
  }

  function moveWorms() {
    if (!state.running || state.paused || state.gameOver || state.win) return;
    const dirs = Object.keys(DIRS);
    const nextWorms = state.worms.map((worm, wormIndex) => {
      const options = [];
      const len = worm.length ?? WORM_LENGTH;
      const currentCells = getWormCells(worm);
      dirs.forEach((dirKey) => {
        const dir = DIRS[dirKey];
        const newHead = { x: worm.x + dir.x, y: worm.y + dir.y };
        const nextCells = [newHead, ...currentCells].slice(0, len);
        const cells = nextCells;
        if (cells.some((cell) => !inBounds(cell))) return;
        if (cells.some((cell) => isCellOccupied(state.snake, cell))) return;
        if (cells.some((cell) => isWormOccupiedExcept(state.worms, cell, wormIndex))) return;
        if (cells.some((cell) => state.tunnels.some((tunnel) => tunnel.x === cell.x && tunnel.y === cell.y))) return;
        options.push({ x: newHead.x, y: newHead.y, dir: dirKey, cells: nextCells });
      });
      if (options.length === 0) return { ...worm, length: len, cells: currentCells };
      const target = getWormTarget();
      if (target) {
        options.sort((a, b) => {
          const da = Math.abs(a.x - target.x) + Math.abs(a.y - target.y);
          const db = Math.abs(b.x - target.x) + Math.abs(b.y - target.y);
          return da - db;
        });
        if (Math.random() < 0.9) return { ...options[0], phase: worm.phase, length: len };
      }
      const idx = Math.floor(Math.random() * options.length);
      return { ...options[idx], phase: worm.phase, length: len };
    });
    let nextState = { ...state, worms: nextWorms };
    let appleEaten = false;
    let appleEaterIndex = -1;
    const apple = nextState.apples[0];
    if (apple) {
      appleEaterIndex = nextWorms.findIndex((worm) => worm.x === apple.x && worm.y === apple.y);
      if (appleEaterIndex !== -1) {
        appleEaten = true;
      }
    }

    if (appleEaten) {
      const grown = nextWorms.map((worm, idx) => {
        if (idx !== appleEaterIndex) return worm;
        const newLen = (worm.length ?? WORM_LENGTH) + 1;
        const cells = worm.cells ? worm.cells.slice() : getWormCells(worm);
        while (cells.length < newLen) {
          const tail = cells[cells.length - 1];
          cells.push({ x: tail.x, y: tail.y });
        }
        return { ...worm, length: newLen, cells };
      });
      nextState = { ...nextState, worms: grown, apples: [] };
      sfxWormRedApple();
      scheduleRedAppleRespawn();
    }

    if (nextState.goldApplePos) {
      const eater = nextWorms.find((worm) => worm.x === nextState.goldApplePos.x && worm.y === nextState.goldApplePos.y);
      if (eater) {
        const extra = spawnWormNear(eater);
        nextState = {
          ...nextState,
          goldApplePos: null,
          goldAppleUsedThisLevel: true,
          worms: [...nextState.worms, extra],
        };
        clearGoldMove();
        sfxWormGoldenApple();
      }
    }
    state = nextState;
    draw();
  }

  function moveAppleRandomly() {
    if (!state.running || state.paused || state.gameOver || state.win) {
      scheduleAppleMove();
      return;
    }
    const dirs = Object.values(DIRS);
    if (state.apples.length > 0) {
      const appleIdx = Math.floor(Math.random() * state.apples.length);
      const current = state.apples[appleIdx];
      const options = [];
      dirs.forEach((dir) => {
        const next = { x: current.x + dir.x, y: current.y + dir.y };
        if (!inBounds(next)) return;
        if (isCellOccupied(state.snake, next) || isWormOccupied(state.worms, next)) return;
        if (state.tunnels.some((tunnel) => tunnel.x === next.x && tunnel.y === next.y)) return;
        if (state.apples.some((apple, idx) => idx !== appleIdx && apple.x === next.x && apple.y === next.y)) return;
        if (state.goldApplePos && state.goldApplePos.x === next.x && state.goldApplePos.y === next.y) return;
        options.push(next);
      });
      if (options.length > 0) {
        const idx = Math.floor(Math.random() * options.length);
        const nextApples = state.apples.slice();
        nextApples[appleIdx] = options[idx];
        state = { ...state, apples: nextApples };
        draw();
      }
    }
    scheduleAppleMove();
  }

  function ensureApplesForLevel() {
    if (state.apples.length === 0) {
      spawnOneRedApple();
    }
  }

  function ensureTunnelsForLevel(level) {
    if (level < 3) {
      state = { ...state, tunnels: [] };
      return;
    }
    const tunnels = [];
    let attempts = 0;
    while (tunnels.length < 2 && attempts < 500) {
      attempts += 1;
      const pos = {
        x: Math.floor(Math.random() * gridCols),
        y: Math.floor(Math.random() * GRID_ROWS),
      };
      if (pos.x < TUNNEL_EDGE_BUFFER || pos.x >= gridCols - TUNNEL_EDGE_BUFFER) continue;
      if (pos.y < TUNNEL_EDGE_BUFFER || pos.y >= GRID_ROWS - TUNNEL_EDGE_BUFFER) continue;
      if (isCellOccupied(state.snake, pos)) continue;
      if (isWormOccupied(state.worms, pos)) continue;
      if (state.apples.some((apple) => apple.x === pos.x && apple.y === pos.y)) continue;
      if (state.goldApplePos && state.goldApplePos.x === pos.x && state.goldApplePos.y === pos.y) continue;
      if (tunnels.some((h) => h.x === pos.x && h.y === pos.y)) continue;
      if (tunnels.length === 1) {
        const dx = pos.x - tunnels[0].x;
        const dy = pos.y - tunnels[0].y;
        if (Math.sqrt(dx * dx + dy * dy) < TUNNEL_MIN_DISTANCE) continue;
      }
      tunnels.push(pos);
    }
    state = { ...state, tunnels };
  }

  function scheduleAppleMove() {
    const base = LEVEL_APPLE_INTERVALS[state.level - 1] ?? LEVEL_APPLE_INTERVALS[LEVEL_APPLE_INTERVALS.length - 1];
    const delay = base;
    setTimeout(moveAppleRandomly, delay);
  }

  function ensureGoldAppleForLevel(level) {
    if (level < 2) return;
    if (state.goldApplePos) return;
    if (state.goldAppleUsedThisLevel) return;
    const pos = placeGoldApple(state);
    if (pos) {
      state = { ...state, goldApplePos: pos };
      draw();
      scheduleGoldAppleMove();
    }
  }

  let goldMoveTimeout = null;

  function clearGoldMove() {
    if (goldMoveTimeout) {
      clearTimeout(goldMoveTimeout);
      goldMoveTimeout = null;
    }
  }

  function moveGoldAppleOnce() {
    if (!state.goldApplePos) return;
    if (!state.running || state.paused || state.gameOver || state.win) {
      scheduleGoldAppleMove();
      return;
    }
    const dirs = Object.values(DIRS);
    const options = [];
    dirs.forEach((d) => {
      const next = { x: state.goldApplePos.x + d.x, y: state.goldApplePos.y + d.y };
      if (!inBounds(next)) return;
      if (isCellOccupied(state.snake, next)) return;
      if (isWormOccupied(state.worms, next)) return;
      if (state.tunnels.some((tunnel) => tunnel.x === next.x && tunnel.y === next.y)) return;
      if (state.apples.length && next.x === state.apples[0].x && next.y === state.apples[0].y) return;
      options.push(next);
    });
    if (options.length) {
      const idx = Math.floor(Math.random() * options.length);
      state = { ...state, goldApplePos: options[idx] };
      draw();
    }
    scheduleGoldAppleMove();
  }

  function scheduleGoldAppleMove() {
    clearGoldMove();
    if (!state.goldApplePos) return;
    const delay = 600 + Math.random() * 600;
    goldMoveTimeout = setTimeout(moveGoldAppleOnce, delay);
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", restartGame);
  pauseBtn.addEventListener("click", pauseGame);
  window.addEventListener("keydown", handleKey, { passive: false });
  window.addEventListener("resize", resizeCanvas);

  mobileControls.forEach((btn) => {
    btn.addEventListener("click", () => handleDirectionChange(btn.dataset.dir));
  });

  resizeCanvas();
  state = createInitialState();
  ensureApplesForLevel(state.level);
  ensureTunnelsForLevel(state.level);
  ensureGoldAppleForLevel(state.level);
  updateUI();
  draw();
  scheduleAppleMove();
  setInterval(moveWorms, WORM_MOVE_MS);

  overlayActionEl.addEventListener("click", () => {
    if (state.win) {
      restartGame();
      startGame();
      return;
    }
    if (state.gameOver) {
      restartGame();
    }
  });
})();
