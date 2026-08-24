/**
 * Monkey Leap
 *
 * - Variable tree heights; jump arc adapts up/down.
 * - Every 10 trees: a tall tree with a banana (+20 score).
 * - Banana → monkey blinks and turns a bit browner (stages).
 */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;

/** Default / cliff platform height */
const PLATFORM_Y = 168;
const WATER_Y = 220;
const CLIFF_EDGE_START = 108;
let cliffEdge = CLIFF_EDGE_START;

/** Fur: cream → light brown → medium → dark (after bananas) */
const FUR_STAGES = ["#e8e0d4", "#c4a574", "#8b5e34", "#5a3a1a"];
const FACE_STAGES = ["#f5d6b0", "#e0c090", "#c9a06a", "#a07848"];

const state = {
  mode: "waiting",
  score: 0,
  best: Number(localStorage.getItem("monkeyLeapBest") || 0),
  speed: 0,
  time: 0,
  treesSpawned: 0,
  treesLanded: 0,
  bananas: 0,
  /** 0..3 browner after each banana */
  colorStage: 0,
};

const monkey = {
  x: CLIFF_EDGE_START - 22,
  y: PLATFORM_Y,
  vy: 0,
  grounded: true,
  /** @type {null | 'cliff' | number} */
  holdId: "cliff",
  ignoreId: null,
  targetId: null,
  assuredJump: false,
  flightSpeed: 0,
  airTime: 0,
  coyote: 0,
  jumpQueue: 0,
  jumpV: -340,
  grav: 1000,
  /** Blink white/brown flash after banana */
  blink: 0,
};

/**
 * @type {{
 *   id:number,x:number,platformY:number,trunkW:number,canopyW:number,
 *   canopyH:number,hasBanana:boolean,bananaTaken:boolean
 * }[]}
 */
let trees = [];
/**
 * @type {{x:number,y:number,vy:number,active:boolean,cooldown:number,bite:number,gapLeft:number,gapRight:number}[]}
 */
let fish = [];

const COYOTE_TIME = 0.32;
const JUMP_QUEUE_TIME = 0.32;
/** Wider catch so near-miss taps still grab the tree */
const CATCH_X = 38;
const BANANA_EVERY = 10;
const BANANA_POINTS = 20;

let nextTreeId = 1;

function currentGap() {
  return 100 + Math.min(18, Math.floor(state.score / 20) * 6);
}

function currentSpeed() {
  return 82 + Math.floor(state.score / 10) * 11;
}

function holdPlatformY() {
  if (monkey.holdId === "cliff" || monkey.holdId == null) return PLATFORM_Y;
  const t = trees.find((tr) => tr.id === monkey.holdId);
  return t ? t.platformY : PLATFORM_Y;
}

function applyJumpPhysics() {
  applyJumpPhysicsForHop(currentGap(), currentSpeed(), PLATFORM_Y, PLATFORM_Y);
}

/** Hop matched to distance, speed, and height change between platforms */
function applyJumpPhysicsForHop(dist, spd, fromY, toY) {
  // Slightly longer airtime = a bit more reach / forgiveness
  const air = Math.max(0.3, (dist / spd) * 1.06);
  const rise = Math.max(0, fromY - toY); // jumping UP (smaller Y)
  const peak = Math.min(88, 38 + dist * 0.15 + rise * 0.9 + 10);
  let v = (4 * peak) / air;
  v = Math.min(440, Math.max(285, v));
  monkey.jumpV = -v;
  monkey.grav = (2 * v) / air;
  monkey.flightSpeed = spd;
}

function setupWaitingWorld() {
  state.mode = "waiting";
  state.score = 0;
  state.speed = 0;
  state.time = 0;
  state.treesSpawned = 0;
  state.treesLanded = 0;
  state.bananas = 0;
  state.colorStage = 0;
  cliffEdge = CLIFF_EDGE_START;
  nextTreeId = 1;

  monkey.x = CLIFF_EDGE_START - 22;
  monkey.y = PLATFORM_Y;
  monkey.vy = 0;
  monkey.grounded = true;
  monkey.holdId = "cliff";
  monkey.ignoreId = null;
  monkey.targetId = null;
  monkey.assuredJump = false;
  monkey.flightSpeed = 0;
  monkey.airTime = 0;
  monkey.coyote = 0;
  monkey.jumpQueue = 0;
  monkey.blink = 0;
  applyJumpPhysics();

  const gap = currentGap();
  trees = [];
  let x = monkey.x + gap;
  for (let i = 0; i < 7; i++) {
    trees.push(makeTree(x));
    x += gap;
  }
  placeFishInGaps();
}

function startRunAndJump() {
  state.mode = "running";
  state.speed = currentSpeed();
  applyJumpPhysics();
  doJumpFromPlatform();
}

function pickPlatformY(forceTall) {
  if (forceTall) {
    // Tall tree — banana lives up here (needs a higher hop)
    return 128 + Math.floor(Math.random() * 8); // ~128–135
  }
  // Normal variety: a bit lower / same / a bit higher than cliff
  const choices = [158, 168, 168, 178, 148, 188];
  return choices[Math.floor(Math.random() * choices.length)];
}

function makeTree(x) {
  state.treesSpawned += 1;
  const isBananaTree =
    state.treesSpawned > 0 && state.treesSpawned % BANANA_EVERY === 0;

  return {
    id: nextTreeId++,
    x,
    platformY: pickPlatformY(isBananaTree),
    trunkW: 8,
    canopyW: 48,
    canopyH: 22,
    hasBanana: isBananaTree,
    bananaTaken: false,
  };
}

function canJumpNow() {
  return monkey.grounded || monkey.coyote > 0;
}

function findNextTree() {
  let best = null;
  for (const t of trees) {
    if (t.id === monkey.holdId || t.id === monkey.ignoreId) continue;
    if (t.x < monkey.x - 4) continue;
    if (!best || t.x < best.x) best = t;
  }
  return best;
}

function doJumpFromPlatform() {
  const next = findNextTree();
  monkey.targetId = next ? next.id : null;
  monkey.assuredJump = true;
  monkey.ignoreId = monkey.holdId;
  const fromY = holdPlatformY();
  monkey.holdId = null;

  const spd = currentSpeed();
  state.speed = spd;
  const dist = next ? Math.max(50, next.x - monkey.x) : currentGap();
  const toY = next ? next.platformY : PLATFORM_Y;
  applyJumpPhysicsForHop(dist, spd, fromY, toY);

  monkey.vy = monkey.jumpV;
  monkey.grounded = false;
  monkey.airTime = 0;
  monkey.coyote = 0;
  monkey.jumpQueue = 0;
}

function tryConsumeJump() {
  if (monkey.jumpQueue <= 0) return false;
  if (state.mode !== "running") return false;
  if (!canJumpNow()) return false;
  doJumpFromPlatform();
  return true;
}

function jump() {
  if (state.mode === "dead") {
    setupWaitingWorld();
    return;
  }
  if (state.mode === "waiting") {
    startRunAndJump();
    return;
  }
  if (state.mode !== "running") return;
  monkey.jumpQueue = JUMP_QUEUE_TIME;
  tryConsumeJump();
}

function die() {
  if (state.mode === "dead") return;
  state.mode = "dead";
  state.speed = 0;
  if (state.score > state.best) {
    state.best = Math.floor(state.score);
    localStorage.setItem("monkeyLeapBest", String(state.best));
  }
}

function monkeyRect() {
  return { x: monkey.x - 6, y: monkey.y + 2, w: 12, h: 16 };
}

function treeHitRange(t) {
  // Extra-wide safe zone so edge taps still count
  return {
    left: t.x - t.canopyW / 2 - 10,
    right: t.x + t.canopyW / 2 + 10,
  };
}

function stillOnHoldPlatform() {
  if (monkey.holdId === "cliff") {
    return monkey.x <= cliffEdge - 2 && cliffEdge > 30;
  }
  const t = trees.find((tr) => tr.id === monkey.holdId);
  if (!t) return false;
  const { left, right } = treeHitRange(t);
  return monkey.x >= left && monkey.x <= right;
}

function collectBanana(t) {
  if (!t.hasBanana || t.bananaTaken) return;
  t.bananaTaken = true;
  state.bananas += 1;
  state.score += BANANA_POINTS;
  state.colorStage = Math.min(3, state.bananas);
  monkey.blink = 0.55;
}

function attachTo(id) {
  const t = trees.find((tr) => tr.id === id);
  const py = t ? t.platformY : PLATFORM_Y;

  monkey.y = py;
  monkey.vy = 0;
  monkey.grounded = true;
  monkey.holdId = id;
  monkey.ignoreId = null;
  monkey.targetId = null;
  monkey.assuredJump = false;
  monkey.flightSpeed = 0;
  monkey.coyote = 0;

  if (t) {
    state.treesLanded += 1;
    collectBanana(t);
  }

  tryConsumeJump();
}

function tryLandOnTarget() {
  if (!monkey.assuredJump || monkey.targetId == null) return false;

  const t = trees.find((tr) => tr.id === monkey.targetId);
  if (!t) {
    monkey.targetId = null;
    monkey.assuredJump = false;
    monkey.flightSpeed = 0;
    return false;
  }

  const dx = t.x - monkey.x;
  // Stay forgiving a bit longer after the tree center passes
  if (dx < -CATCH_X - 22) {
    monkey.targetId = null;
    monkey.assuredJump = false;
    monkey.flightSpeed = 0;
    return false;
  }

  const py = t.platformY;
  const nearBranch =
    monkey.airTime > 0.05 &&
    monkey.y >= py - 22 &&
    monkey.y <= py + 22;

  if (nearBranch && Math.abs(dx) <= CATCH_X) {
    attachTo(t.id);
    return true;
  }
  return false;
}

function placeFishInGaps() {
  fish = [];
  const edges = [cliffEdge, ...trees.map((t) => t.x)];
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i];
    const right = edges[i + 1];
    fish.push({
      x: (left + right) / 2,
      y: WATER_Y + 10,
      vy: 0,
      active: false,
      cooldown: 0.7 + i * 0.4 + Math.random() * 0.5,
      bite: 0,
      gapLeft: left,
      gapRight: right,
    });
  }
}

function syncFishGaps() {
  const anchors = [];
  if (cliffEdge > -20) anchors.push(cliffEdge);
  for (const t of trees) anchors.push(t.x);
  anchors.sort((a, b) => a - b);

  const needed = Math.max(0, anchors.length - 1);
  while (fish.length < needed) {
    fish.push({
      x: 0,
      y: WATER_Y + 10,
      vy: 0,
      active: false,
      cooldown: 0.8 + Math.random(),
      bite: 0,
      gapLeft: 0,
      gapRight: 0,
    });
  }
  while (fish.length > needed) fish.pop();

  for (let i = 0; i < needed; i++) {
    fish[i].gapLeft = anchors[i];
    fish[i].gapRight = anchors[i + 1];
    if (!fish[i].active) {
      fish[i].x = (anchors[i] + anchors[i + 1]) / 2;
    }
  }
}

function update(dt) {
  state.time += dt;
  if (monkey.blink > 0) monkey.blink = Math.max(0, monkey.blink - dt);

  if (state.mode !== "running") return;

  state.score += dt * 10;

  if (!monkey.grounded && monkey.assuredJump && monkey.flightSpeed > 0) {
    state.speed = monkey.flightSpeed;
  } else {
    state.speed = currentSpeed();
  }

  const dx = state.speed * dt;
  cliffEdge -= dx;
  for (const t of trees) t.x -= dx;

  while (trees.length && trees[0].x < -50) trees.shift();
  while (trees.length < 7) {
    const last = trees[trees.length - 1];
    trees.push(makeTree(last.x + currentGap()));
  }

  syncFishGaps();

  if (monkey.coyote > 0) monkey.coyote -= dt;
  if (monkey.jumpQueue > 0) monkey.jumpQueue -= dt;
  tryConsumeJump();

  if (monkey.grounded && monkey.holdId != null) {
    monkey.y = holdPlatformY();
    monkey.vy = 0;
    tryConsumeJump();
    if (!stillOnHoldPlatform()) {
      monkey.grounded = false;
      monkey.holdId = null;
      monkey.targetId = null;
      monkey.assuredJump = false;
      monkey.flightSpeed = 0;
      monkey.coyote = COYOTE_TIME;
      monkey.airTime = 0;
      tryConsumeJump();
    }
  } else {
    monkey.airTime += dt;
    monkey.vy += monkey.grav * dt;
    monkey.y += monkey.vy * dt;
    tryLandOnTarget();
  }

  if (monkey.y > WATER_Y - 4) {
    die();
    return;
  }

  for (const f of fish) {
    f.cooldown -= dt;

    if (!f.active && f.cooldown <= 0 && f.gapRight - f.gapLeft > 50) {
      f.active = true;
      const heightBoost = Math.min(70, Math.max(0, state.score - 40) * 0.35);
      f.vy = -(120 + heightBoost) - Math.random() * 18;
      f.y = WATER_Y + 10;
      f.x = (f.gapLeft + f.gapRight) / 2;
      f.bite = 0;
    }

    if (f.active) {
      f.vy += 900 * 0.9 * dt;
      f.y += f.vy * dt;

      if (f.vy > -40 && f.vy < 80 && f.y < WATER_Y - 20) {
        f.bite = Math.min(1, f.bite + dt * 6);
      } else {
        f.bite = Math.max(0, f.bite - dt * 4);
      }

      if (f.y >= WATER_Y + 10) {
        f.y = WATER_Y + 10;
        f.active = false;
        f.bite = 0;
        f.cooldown = 1 + Math.random() * 1.5;
        f.cooldown *= Math.max(0.45, 1 - state.score / 400);
      }
      // Fish are visual only — no collision kill
    }
  }
}

function drawPixelRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function monkeyColors() {
  const stage = state.colorStage;
  let fur = FUR_STAGES[stage];
  let face = FACE_STAGES[stage];
  // Blink: flash brighter then settle on new brown
  if (monkey.blink > 0) {
    const flash = Math.sin(monkey.blink * 28) > 0;
    if (flash) {
      fur = "#ffffff";
      face = "#ffe8c8";
    }
  }
  return { fur, face, dark: "#3a2a1a" };
}

function drawCliff() {
  if (cliffEdge < -30) return;
  const left = Math.min(0, cliffEdge - CLIFF_EDGE_START);
  const width = cliffEdge - left;

  drawPixelRect(left, PLATFORM_Y, width, H - PLATFORM_Y, "#1c1c1c");
  drawPixelRect(left, PLATFORM_Y - 4, width, 4, "#d8d8d8");
  drawPixelRect(left, PLATFORM_Y - 6, Math.max(0, width - 4), 2, "#3a3a3a");

  const e = cliffEdge;
  ctx.fillStyle = "#141414";
  ctx.beginPath();
  ctx.moveTo(e, PLATFORM_Y);
  ctx.lineTo(e + 2, PLATFORM_Y + 14);
  ctx.lineTo(e - 4, PLATFORM_Y + 28);
  ctx.lineTo(e + 4, PLATFORM_Y + 42);
  ctx.lineTo(e - 2, WATER_Y);
  ctx.lineTo(e + 6, H);
  ctx.lineTo(left, H);
  ctx.lineTo(left, PLATFORM_Y);
  ctx.closePath();
  ctx.fill();

  drawPixelRect(e - 10, PLATFORM_Y + 18, 6, 4, "#2a2a2a");
  drawPixelRect(e - 16, PLATFORM_Y + 36, 8, 3, "#252525");
}

function drawBanana(t) {
  if (!t.hasBanana || t.bananaTaken) return;
  const bx = Math.round(t.x);
  const by = Math.round(t.platformY - 28);
  // Simple pixel banana
  drawPixelRect(bx - 1, by, 3, 2, "#e8c84a");
  drawPixelRect(bx - 3, by + 2, 3, 3, "#f0d060");
  drawPixelRect(bx, by + 2, 3, 3, "#f0d060");
  drawPixelRect(bx - 4, by + 5, 2, 2, "#d4a830");
  drawPixelRect(bx + 2, by + 5, 2, 2, "#d4a830");
  drawPixelRect(bx - 1, by - 2, 2, 2, "#3a5a20"); // stem
}

function drawTree(t) {
  const py = t.platformY;
  const trunkTop = py - 4;
  const trunkBottom = WATER_Y + 6;
  const trunkH = trunkBottom - trunkTop;

  drawPixelRect(t.x - t.trunkW / 2, trunkTop, t.trunkW, trunkH, "#2b1d12");
  drawPixelRect(t.x - t.trunkW / 2 + 2, trunkTop, 2, trunkH, "#3a2918");
  drawPixelRect(t.x - t.trunkW / 2 - 3, WATER_Y - 2, 4, 5, "#2b1d12");
  drawPixelRect(t.x + t.trunkW / 2 - 1, WATER_Y - 2, 4, 5, "#2b1d12");

  const cx = t.x;
  const cy = py - 8;
  const layers = [
    { y: cy - 16, w: t.canopyW * 0.55, h: 10 },
    { y: cy - 10, w: t.canopyW * 0.85, h: 12 },
    { y: cy - 2, w: t.canopyW, h: 12 },
  ];
  for (const L of layers) {
    drawPixelRect(cx - L.w / 2, L.y, L.w, L.h, "#1f3d1f");
    drawPixelRect(cx - L.w / 2 + 2, L.y + 2, L.w - 4, 3, "#2d5a2d");
  }
  drawPixelRect(cx - t.canopyW / 2 + 3, py - 4, t.canopyW - 6, 4, "#cfcfcf");
  drawBanana(t);
}

function drawFish(f) {
  if (!f.active && state.mode === "waiting") {
    drawPixelRect(f.x - 5, WATER_Y + 6, 10, 4, "#1a2838");
    return;
  }
  if (!f.active) return;

  const bite = f.bite;
  const body = "#bdbdbd";
  drawPixelRect(f.x - 7, f.y - 6, 12, 8, body);
  drawPixelRect(f.x - 11, f.y - 3, 4, 4, body);
  drawPixelRect(f.x + 1, f.y - 4, 2, 2, "#111");
  const jawOpen = Math.round(bite * 5);
  drawPixelRect(f.x + 5, f.y - 5 - jawOpen, 5, 3, body);
  drawPixelRect(f.x + 5, f.y - 1 + jawOpen, 5, 3, body);
  if (bite > 0.25) {
    drawPixelRect(f.x + 6, f.y - 2 - jawOpen, 1, 2, "#fff");
    drawPixelRect(f.x + 8, f.y - 2 - jawOpen, 1, 2, "#fff");
    drawPixelRect(f.x + 6, f.y - 1 + jawOpen, 1, 2, "#fff");
    drawPixelRect(f.x + 8, f.y - 1 + jawOpen, 1, 2, "#fff");
  }
}

function drawMonkey() {
  const gx = Math.round(monkey.x);
  const gy = Math.round(monkey.y);
  const { fur, face, dark } = monkeyColors();

  const onCliff =
    state.mode === "waiting" ||
    monkey.holdId === "cliff" ||
    (monkey.grounded && cliffEdge > monkey.x + 10);

  if (!monkey.grounded && state.mode === "running") {
    drawMonkeyJumping(gx, gy, fur, dark, face);
    return;
  }
  if (onCliff) drawMonkeySitting(gx, gy, fur, dark, face);
  else drawMonkeyHanging(gx, gy, fur, dark, face);
}

function drawMonkeySitting(gx, gy, fur, dark, face) {
  let bob = 0;
  if (state.mode === "waiting") bob = Math.sin(state.time * 2.5) > 0 ? 0 : 1;
  const seat = gy;
  drawPixelRect(gx - 5, seat - 5 + bob, 10, 5, fur);
  drawPixelRect(gx - 1, seat + bob, 3, 4, fur);
  drawPixelRect(gx + 3, seat + bob, 3, 4, fur);
  drawPixelRect(gx - 4, seat - 12 + bob, 8, 8, fur);
  drawPixelRect(gx - 5, seat - 20 + bob, 10, 8, fur);
  drawPixelRect(gx - 7, seat - 19 + bob, 3, 3, fur);
  drawPixelRect(gx + 4, seat - 19 + bob, 3, 3, fur);
  drawPixelRect(gx - 3, seat - 17 + bob, 6, 4, face);
  drawPixelRect(gx - 2, seat - 16 + bob, 2, 2, dark);
  drawPixelRect(gx + 1, seat - 16 + bob, 2, 2, dark);
  drawPixelRect(gx - 1, seat - 13 + bob, 3, 1, dark);
  drawPixelRect(gx - 6, seat - 10 + bob, 3, 5, fur);
  drawPixelRect(gx + 3, seat - 10 + bob, 3, 5, fur);
  drawPixelRect(gx - 8, seat - 6 + bob, 4, 2, fur);
  drawPixelRect(gx - 9, seat - 8 + bob, 2, 3, fur);
}

function drawMonkeyHanging(gx, gy, fur, dark, face) {
  const swing = Math.sin(state.time * 2.2) * 2;
  drawPixelRect(gx - 5, gy - 1, 4, 3, fur);
  drawPixelRect(gx + 1, gy - 1, 4, 3, fur);
  drawPixelRect(gx - 4, gy + 2, 3, 6, fur);
  drawPixelRect(gx + 1, gy + 2, 3, 6, fur);
  const hy = gy + 7 + Math.round(swing * 0.3);
  drawPixelRect(gx - 5, hy, 10, 8, fur);
  drawPixelRect(gx - 7, hy + 1, 3, 3, fur);
  drawPixelRect(gx + 4, hy + 1, 3, 3, fur);
  drawPixelRect(gx - 3, hy + 3, 6, 4, face);
  drawPixelRect(gx - 2, hy + 4, 2, 2, dark);
  drawPixelRect(gx + 1, hy + 4, 2, 2, dark);
  drawPixelRect(gx - 1, hy + 7, 3, 1, dark);
  const ty = hy + 8;
  drawPixelRect(gx - 4, ty, 8, 7, fur);
  drawPixelRect(gx - 4 + Math.round(swing), ty + 7, 3, 6, fur);
  drawPixelRect(gx + 1 - Math.round(swing), ty + 7, 3, 6, fur);
  drawPixelRect(gx + 4, ty + 3, 5, 2, fur);
  drawPixelRect(gx + 7, ty + 1, 2, 3, fur);
}

function drawMonkeyJumping(gx, gy, fur, dark, face) {
  const up = monkey.vy < 0;
  drawPixelRect(gx - 2, gy - (up ? 4 : 1), 3, 4, fur);
  drawPixelRect(gx + 2, gy - (up ? 5 : 0), 3, 4, fur);
  drawPixelRect(gx - 5, gy + 2, 10, 8, fur);
  drawPixelRect(gx - 7, gy + 3, 3, 3, fur);
  drawPixelRect(gx + 4, gy + 3, 3, 3, fur);
  drawPixelRect(gx - 3, gy + 5, 6, 4, face);
  drawPixelRect(gx - 2, gy + 6, 2, 2, dark);
  drawPixelRect(gx + 1, gy + 6, 2, 2, dark);
  drawPixelRect(gx - 4, gy + 10, 8, 6, fur);
  drawPixelRect(gx - 5, gy + 15, 3, 5, fur);
  drawPixelRect(gx + 2, gy + 15, 3, 4, fur);
  drawPixelRect(gx + 4, gy + 12, 5, 2, fur);
}

function drawWater() {
  drawPixelRect(0, WATER_Y, W, H - WATER_Y, "#071018");
  for (let i = 0; i < W; i += 10) {
    const wave = Math.sin(state.time * 2.5 + i * 0.15) > 0 ? 1 : 0;
    drawPixelRect(i, WATER_Y + wave, 7, 2, "#0f2438");
  }
}

function draw() {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(0, PLATFORM_Y + 40);
  ctx.lineTo(40, PLATFORM_Y - 30);
  ctx.lineTo(90, PLATFORM_Y + 10);
  ctx.lineTo(140, PLATFORM_Y - 50);
  ctx.lineTo(200, PLATFORM_Y + 20);
  ctx.lineTo(260, PLATFORM_Y - 20);
  ctx.lineTo(320, PLATFORM_Y + 30);
  ctx.lineTo(W, PLATFORM_Y);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  drawWater();
  for (const t of trees) drawTree(t);
  drawCliff();
  for (const f of fish) drawFish(f);
  drawMonkey();

  ctx.fillStyle = "#e0e0e0";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText("SCORE " + Math.floor(state.score), 8, 14);
  ctx.textAlign = "right";
  ctx.fillText("BEST " + state.best, W - 8, 14);
  if (state.bananas > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#f0d060";
    ctx.fillText("BANANAS " + state.bananas, 8, 26);
  }

  ctx.textAlign = "center";
  if (state.mode === "waiting") {
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px monospace";
    ctx.fillText("MONKEY LEAP", W / 2, 40);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText("SPACE / TAP TO JUMP", W / 2, 56);
    ctx.fillText("GRAB BANANAS ON TALL TREES", W / 2, 70);
  }

  if (state.mode === "dead") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("OUCH!", W / 2, H / 2 - 10);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#cccccc";
    ctx.fillText("SCORE " + Math.floor(state.score), W / 2, H / 2 + 8);
    ctx.fillText("SPACE / TAP TO RETRY", W / 2, H / 2 + 22);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    if (e.repeat) return;
    jump();
  }
  if (e.code === "KeyR") setupWaitingWorld();
});

// Phone / tablet / laptop: tap or click anywhere (game or gray area) = Space
let lastTapJump = 0;
function onScreenJump(e) {
  // Don't steal clicks from nothing special — whole screen is the control
  if (e.target && e.target.closest && e.target.closest("a, button, input")) return;
  e.preventDefault();
  const now = performance.now();
  if (now - lastTapJump < 40) return;
  lastTapJump = now;
  canvas.focus();
  jump();
}

canvas.addEventListener("pointerdown", onScreenJump);
canvas.addEventListener("touchstart", onScreenJump, { passive: false });

const wrap = document.getElementById("wrap");
if (wrap) {
  wrap.addEventListener("pointerdown", onScreenJump);
  wrap.addEventListener("touchstart", onScreenJump, { passive: false });
}
document.body.addEventListener("pointerdown", onScreenJump);
document.body.addEventListener("touchstart", onScreenJump, { passive: false });

canvas.tabIndex = 0;
canvas.style.outline = "none";
window.addEventListener("load", () => canvas.focus());
canvas.addEventListener("mouseenter", () => canvas.focus());

setupWaitingWorld();
requestAnimationFrame(loop);
