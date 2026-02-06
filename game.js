(() => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const statusEl = document.getElementById("status");
  const overlayEl = document.getElementById("overlay");
  const finalScoreEl = document.getElementById("final-score");
  const overlayTitleEl = document.getElementById("overlay-title");
  const levelEl = document.getElementById("level");
  const timerEl = document.getElementById("timer");
  const prizeBtn = document.getElementById("prize-btn");
  const overlayWinEl = document.getElementById("overlay-win");
  const overlayPrizeEl = document.getElementById("overlay-prize");
  const recordsEl = document.getElementById("records");
  const startBtn = document.getElementById("start");
  const restartBtn = document.getElementById("restart");
  const pauseBtn = document.getElementById("pause");
  const mobileControls = document.querySelectorAll(".mobile-controls button[data-dir]");

  const GRID = 25;
  const BASE_TICK_MS = 120;
  const LEVEL_TARGETS = [3, 3, 3, 3, 3];
  const LEVEL_COLORS = ["#ef4444", "#f97316", "#3b82f6", "#6366f1", "#8b5cf6"];
  const LEVEL_APPLE_INTERVALS = [2000, 1500, 1000, 500, 200];
  const WORM_MOVE_MS = 800;

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
    return {
      snake: [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 },
      ],
      direction: "right",
      pendingDirection: "right",
      food: { x: 14, y: 10 },
      apples: 0,
      level: 1,
      worms: [],
      gameOver: false,
      win: false,
      running: false,
      paused: false,
    };
  }

  function inBounds(pos) {
    return pos.x >= 0 && pos.x < GRID && pos.y >= 0 && pos.y < GRID;
  }

  function isCellOccupied(snake, pos) {
    return snake.some((segment) => segment.x === pos.x && segment.y === pos.y);
  }

  function isWormOccupied(worms, pos) {
    return worms.some((worm) => worm.x === pos.x && worm.y === pos.y);
  }

  function getNextHead(head, direction) {
    const dir = DIRS[direction];
    return { x: head.x + dir.x, y: head.y + dir.y };
  }

  function placeFood(state, rng = Math.random) {
    const empty = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        if (!isCellOccupied(state.snake, { x, y }) && !isWormOccupied(state.worms, { x, y })) {
          empty.push({ x, y });
        }
      }
    }
    if (empty.length === 0) {
      return state.food;
    }
    const idx = Math.floor(rng() * empty.length);
    return empty[idx];
  }

  function nextState(state, inputDirection, rng = Math.random) {
    if (state.gameOver || !state.running || state.paused) {
      return state;
    }

    let direction = state.direction;
    if (inputDirection && inputDirection !== OPPOSITE[direction]) {
      direction = inputDirection;
    }

    const head = state.snake[0];
    const newHead = getNextHead(head, direction);

    if (!inBounds(newHead)) {
      return { ...state, direction, gameOver: true, running: false };
    }

    const tail = state.snake[state.snake.length - 1];
    const hitsSelf = isCellOccupied(state.snake, newHead) &&
      !(newHead.x === tail.x && newHead.y === tail.y);

    if (hitsSelf) {
      return { ...state, direction, gameOver: true, running: false };
    }

    if (isWormOccupied(state.worms, newHead)) {
      return { ...state, direction, gameOver: true, running: false };
    }

    const ateFood = newHead.x === state.food.x && newHead.y === state.food.y;
    const newSnake = [newHead, ...state.snake];

    if (!ateFood) {
      newSnake.pop();
    }

    const newFood = ateFood ? placeFood({ ...state, snake: newSnake }, rng) : state.food;
    let nextApples = ateFood ? state.apples + 1 : state.apples;
    let nextLevel = state.level;
    let nextWorms = state.worms;
    let win = false;

    if (ateFood) {
      const target = LEVEL_TARGETS[state.level - 1] ?? LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
      if (nextApples >= target) {
        if (state.level >= 5) {
          win = true;
        } else {
          nextLevel = state.level + 1;
          nextApples = 0;
          nextWorms = [...state.worms, spawnWorm({ ...state, snake: newSnake }, rng)];
        }
      }
    }

    return {
      ...state,
      snake: newSnake,
      direction,
      pendingDirection: direction,
      food: newFood,
      apples: nextApples,
      level: nextLevel,
      worms: nextWorms,
      win,
      gameOver: win ? false : state.gameOver,
      running: win ? false : state.running,
    };
  }

  let state = createInitialState();
  let timerId = null;
  let clockId = null;
  let recordedWin = false;
  let elapsedMs = 0;
  let lastStartTs = null;
  const winRecords = [];
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
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

  function resizeCanvas() {
    const size = Math.min(420, Math.floor(window.innerWidth * 0.88));
    canvas.width = size;
    canvas.height = size;
  }

  function draw() {
    const cell = canvas.width / GRID;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#1f2a36";
    for (let i = 0; i <= GRID; i += 1) {
      const pos = i * cell;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(canvas.width, pos);
      ctx.stroke();
    }

    drawApple(state.food.x * cell + cell / 2, state.food.y * cell + cell / 2, cell * 0.42);

    state.worms.forEach((worm) => {
      drawWorm(worm, cell);
    });

    state.snake.forEach((segment, idx) => {
      ctx.fillStyle = idx === 0 ? "#a7f3b2" : "#6be675";
      ctx.fillRect(segment.x * cell, segment.y * cell, cell, cell);
      if (idx === 0) {
        drawTongue(segment, cell, state.direction);
      }
    });
  }

  function drawApple(cx, cy, r) {
    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy, r * 0.75, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.35, cy, r * 0.75, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.2, r * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#5b3a1b";
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.1);
    ctx.lineTo(cx, cy - r * 0.5);
    ctx.stroke();

    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.45, cy - r * 0.9, r * 0.5, r * 0.25, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorm(worm, cell) {
    const cx = worm.x * cell + cell / 2;
    const cy = worm.y * cell + cell / 2;
    const r = cell * 0.35;
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = Math.max(2, r * 0.6);
    ctx.lineCap = "round";
    ctx.beginPath();
    const sway = r * 0.6;
    const step = r * 0.7;
    const direction = worm.phase ? -1 : 1;
    ctx.moveTo(cx - step, cy);
    ctx.bezierCurveTo(cx - step * 0.6, cy + sway * direction, cx, cy - sway * direction, cx + step * 0.6, cy + sway * direction);
    ctx.stroke();
  }

  function drawTongue(head, cell, direction) {
    const baseX = head.x * cell + cell / 2;
    const baseY = head.y * cell + cell / 2;
    const offset = cell;
    const fork = cell * 0.2;
    let tipX = baseX;
    let tipY = baseY;
    let fx = 0;
    let fy = 0;

    if (direction === "up") { tipY = baseY - offset; fx = fork; fy = 0; }
    if (direction === "down") { tipY = baseY + offset; fx = fork; fy = 0; }
    if (direction === "left") { tipX = baseX - offset; fx = 0; fy = fork; }
    if (direction === "right") { tipX = baseX + offset; fx = 0; fy = fork; }

    ctx.strokeStyle = "#ff6b8a";
    ctx.lineWidth = Math.max(2, cell * 0.08);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX + fx, tipY + fy);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - fx, tipY - fy);
    ctx.stroke();
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateUI() {
    const target = LEVEL_TARGETS[state.level - 1] ?? LEVEL_TARGETS[LEVEL_TARGETS.length - 1];
    scoreEl.textContent = `${state.apples}/${target}`;
    levelEl.textContent = `Level ${state.level}`;
    levelEl.style.color = LEVEL_COLORS[state.level - 1] ?? LEVEL_COLORS[LEVEL_COLORS.length - 1];
    timerEl.textContent = formatTime(getElapsedMs());
    if (state.win) {
      stopClock();
      setStatus("");
      overlayTitleEl.textContent = "You Win!";
      finalScoreEl.textContent = `${state.apples}/${target}`;
      overlayEl.style.display = "grid";
      overlayEl.setAttribute("aria-hidden", "false");
      overlayEl.classList.add("win");
      overlayWinEl.hidden = false;
      overlayPrizeEl.hidden = true;
      prizeBtn.style.display = "inline-flex";
      return;
    }
    if (state.gameOver) {
      stopClock();
      setStatus("Game over. Press Restart.");
      overlayTitleEl.textContent = "Game Over";
      finalScoreEl.textContent = `${state.apples}/${target}`;
      overlayEl.style.display = "grid";
      overlayEl.setAttribute("aria-hidden", "false");
      overlayEl.classList.remove("win");
      overlayWinEl.hidden = false;
      overlayPrizeEl.hidden = true;
      prizeBtn.style.display = "none";
    } else if (!state.running) {
      setStatus("Press Start to play.");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      overlayEl.classList.remove("win");
      overlayWinEl.hidden = false;
      overlayPrizeEl.hidden = true;
      prizeBtn.style.display = "none";
    } else if (state.paused) {
      setStatus("Paused.");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      overlayEl.classList.remove("win");
      overlayWinEl.hidden = false;
      overlayPrizeEl.hidden = true;
      prizeBtn.style.display = "none";
    } else {
      setStatus("");
      overlayEl.style.display = "none";
      overlayEl.setAttribute("aria-hidden", "true");
      overlayEl.classList.remove("win");
      overlayWinEl.hidden = false;
      overlayPrizeEl.hidden = true;
      prizeBtn.style.display = "none";
    }
  }

  function tick() {
    const prevState = state;
    state = nextState(state, state.pendingDirection);
    const moved = prevState.snake[0].x !== state.snake[0].x || prevState.snake[0].y !== state.snake[0].y;
    const ateFood = prevState.food.x === state.snake[0].x && prevState.food.y === state.snake[0].y;
    if (moved && prevState.running && !prevState.paused && !prevState.gameOver && !prevState.win) {
      playTone(220, 30, "square", 0.03);
    }
    if (ateFood) {
      playTone(520, 80, "triangle", 0.08);
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
      addWinRecord(getElapsedMs());
    }
    updateUI();
    draw();
    scheduleTick();
  }

  function getTickMs(level) {
    const speedup = Math.pow(0.95, Math.max(0, level - 1));
    return Math.max(40, Math.round(BASE_TICK_MS * speedup));
  }

  function scheduleTick() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (!state.running || state.gameOver || state.win || state.paused) {
      return;
    }
    const delay = getTickMs(state.level);
    timerId = setTimeout(tick, delay);
  }

  function startGame() {
    if (state.gameOver) {
      return;
    }
    if (!state.running) {
      state = { ...state, running: true, paused: false };
      if (lastStartTs === null) {
        lastStartTs = performance.now();
      }
    }
    ensureAudio();
    scheduleTick();
    startClock();
    updateUI();
  }

  function pauseGame() {
    if (!state.running || state.gameOver) {
      return;
    }
    ensureAudio();
    state = { ...state, paused: !state.paused };
    if (state.paused) {
      stopClock();
    } else {
      startClock();
    }
    scheduleTick();
    updateUI();
  }

  function restartGame() {
    state = createInitialState();
    state.food = placeFood(state);
    recordedWin = false;
    elapsedMs = 0;
    lastStartTs = null;
    stopClock();
    updateUI();
    draw();
  }

  function handleDirectionChange(dir) {
    if (!DIRS[dir]) {
      return;
    }
    if (dir === OPPOSITE[state.direction]) {
      return;
    }
    state = { ...state, pendingDirection: dir };
  }

  function handleKey(e) {
    const key = e.key.toLowerCase();
    ensureAudio();
    const isArrow = key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright";
    if ((state.gameOver || state.win) && isArrow) {
      restartGame();
      handleDirectionChange(key.replace("arrow", ""));
      startGame();
      return;
    }
    if (!state.running && !state.gameOver && isArrow) {
      handleDirectionChange(key.replace("arrow", ""));
      startGame();
      return;
    }
    if (key === "arrowup" || key === "w") handleDirectionChange("up");
    if (key === "arrowdown" || key === "s") handleDirectionChange("down");
    if (key === "arrowleft" || key === "a") handleDirectionChange("left");
    if (key === "arrowright" || key === "d") handleDirectionChange("right");
    if (key === " " || key === "p") pauseGame();
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

  function addWinRecord(ms) {
    winRecords.unshift(ms);
    if (winRecords.length > 5) winRecords.pop();
    renderRecords();
  }

  function renderRecords() {
    recordsEl.textContent = "";
    if (winRecords.length === 0) {
      recordsEl.textContent = "No wins yet.";
      return;
    }
    winRecords.forEach((ms, idx) => {
      const line = document.createElement("div");
      line.textContent = `Win ${idx + 1}: ${formatTime(ms)}`;
      recordsEl.appendChild(line);
    });
  }

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", restartGame);
  pauseBtn.addEventListener("click", pauseGame);
  window.addEventListener("keydown", handleKey);
  window.addEventListener("resize", () => {
    resizeCanvas();
    draw();
  });

  mobileControls.forEach((btn) => {
    btn.addEventListener("click", () => handleDirectionChange(btn.dataset.dir));
  });

  function spawnWorm(stateForSpawn, rng = Math.random) {
    const empty = [];
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const pos = { x, y };
        if (!isCellOccupied(stateForSpawn.snake, pos) &&
            !isWormOccupied(stateForSpawn.worms, pos) &&
            !(stateForSpawn.food.x === x && stateForSpawn.food.y === y)) {
          empty.push(pos);
        }
      }
    }
    if (empty.length === 0) {
      return { x: 0, y: 0 };
    }
    const idx = Math.floor(rng() * empty.length);
    return { ...empty[idx], phase: false };
  }

  function moveWorms() {
    if (!state.running || state.paused || state.gameOver || state.win) {
      return;
    }
    const dirs = Object.values(DIRS);
    const nextWorms = state.worms.map((worm) => {
      const options = [];
      dirs.forEach((dir) => {
        const next = { x: worm.x + dir.x, y: worm.y + dir.y };
        if (!inBounds(next)) return;
        if (isCellOccupied(state.snake, next)) return;
        if (isWormOccupied(state.worms, next)) return;
        if (state.food.x === next.x && state.food.y === next.y) return;
        options.push(next);
      });
      if (options.length === 0) return { ...worm, phase: !worm.phase };
      const idx = Math.floor(Math.random() * options.length);
      return { ...options[idx], phase: !worm.phase };
    });
    state = { ...state, worms: nextWorms };
    draw();
  }

  function moveAppleRandomly() {
    if (!state.running || state.paused || state.gameOver || state.win) {
      scheduleAppleMove();
      return;
    }
    const dirs = Object.values(DIRS);
    const options = [];
    const { x, y } = state.food;
    dirs.forEach((dir) => {
      const next = { x: x + dir.x, y: y + dir.y };
      if (inBounds(next) && !isCellOccupied(state.snake, next) && !isWormOccupied(state.worms, next)) {
        options.push(next);
      }
    });
    if (options.length > 0) {
      const idx = Math.floor(Math.random() * options.length);
      state = { ...state, food: options[idx] };
      draw();
    }
    scheduleAppleMove();
  }

  function scheduleAppleMove() {
    const base = LEVEL_APPLE_INTERVALS[state.level - 1] ?? LEVEL_APPLE_INTERVALS[LEVEL_APPLE_INTERVALS.length - 1];
    const delay = base;
    setTimeout(moveAppleRandomly, delay);
  }

  resizeCanvas();
  state.food = placeFood(state);
  renderRecords();
  updateUI();
  draw();
  scheduleAppleMove();
  setInterval(moveWorms, WORM_MOVE_MS);

  prizeBtn.addEventListener("click", () => {
    overlayWinEl.hidden = true;
    overlayPrizeEl.hidden = false;
  });

  // Expose pure functions for optional manual testing in console.
  window.SnakeLogic = { createInitialState, nextState, placeFood };
})();
