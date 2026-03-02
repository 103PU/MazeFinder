/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

/**
 * Constants for Directions and Bitmasks
 */
const DIR = {
  STAY: 0,
  SOUTH: 1,
  NORTH: 2,
  WEST: 4,
  EAST: 8,
};

/**
 * Load solver from file with VM sandboxing
 */
function loadSolver(filePath) {
  const abs = path.resolve(filePath);
  try {
    const loaded = require(abs);
    if (typeof loaded === "function") return loaded;
  } catch (_) {
    // Fallback to VM
  }

  const code = fs.readFileSync(abs, "utf8");
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(`${code}\nthis.__MazeFinder = MazeFinder;`, ctx);
  return ctx.__MazeFinder;
}

/**
 * Deterministic PRNG
 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildEmptyMaze(n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ n: false, s: false, w: false, e: false }))
  );
}

function carvePassage(maze, x1, y1, x2, y2) {
  if (x2 === x1 + 1) {
    maze[y1][x1].e = true;
    maze[y2][x2].w = true;
  } else if (x2 === x1 - 1) {
    maze[y1][x1].w = true;
    maze[y2][x2].e = true;
  } else if (y2 === y1 + 1) {
    maze[y1][x1].s = true;
    maze[y2][x2].n = true;
  } else if (y2 === y1 - 1) {
    maze[y1][x1].n = true;
    maze[y2][x2].s = true;
  }
}

/**
 * Enhanced Maze Generation with Multiple Algorithms
 * @param {number} n Size
 * @param {function} rand PRNG
 * @param {string} type 'dfs' or 'prim'
 */
function generateMaze(n, rand, type = 'dfs') {
  const maze = buildEmptyMaze(n);
  const visited = Array.from({ length: n }, () => Array(n).fill(false));

  if (type === 'dfs') {
    // Recursive Backtracker - Long winding corridors
    const stack = [{ x: 0, y: 0 }];
    visited[0][0] = true;
    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const neighbors = [];
      if (cur.x > 0 && !visited[cur.y][cur.x - 1]) neighbors.push({ x: cur.x - 1, y: cur.y });
      if (cur.x + 1 < n && !visited[cur.y][cur.x + 1]) neighbors.push({ x: cur.x + 1, y: cur.y });
      if (cur.y > 0 && !visited[cur.y - 1][cur.x]) neighbors.push({ x: cur.y - 1, y: cur.y });
      if (cur.y + 1 < n && !visited[cur.y + 1][cur.x]) neighbors.push({ x: cur.x, y: cur.y + 1 });

      if (neighbors.length === 0) {
        stack.pop();
      } else {
        const pick = neighbors[Math.floor(rand() * neighbors.length)];
        carvePassage(maze, cur.x, cur.y, pick.x, pick.y);
        visited[pick.y][pick.x] = true;
        stack.push(pick);
      }
    }
  } else {
    // Randomized Prim's - Many short branches
    const walls = [];
    visited[0][0] = true;
    const addWalls = (x, y) => {
      if (x > 0) walls.push({ x1: x, y1: y, x2: x - 1, y2: y });
      if (x + 1 < n) walls.push({ x1: x, y1: y, x2: x + 1, y2: y });
      if (y > 0) walls.push({ x1: x, y1: y, x2: x, y2: y - 1 });
      if (y + 1 < n) walls.push({ x1: x, y1: y, x2: x, y2: y + 1 });
    };
    addWalls(0, 0);
    while (walls.length > 0) {
      const idx = Math.floor(rand() * walls.length);
      const { x1, y1, x2, y2 } = walls.splice(idx, 1)[0];
      if (visited[y1][x1] !== visited[y2][x2]) {
        carvePassage(maze, x1, y1, x2, y2);
        const next = visited[y1][x1] ? { x: x2, y: y2 } : { x: x1, y: y1 };
        visited[next.y][next.x] = true;
        addWalls(next.x, next.y);
      }
    }
  }

  // Add random shortcuts (Cycles)
  const extra = Math.floor((n * n) / 10);
  for (let k = 0; k < extra; k++) {
    const x = Math.floor(rand() * n);
    const y = Math.floor(rand() * n);
    const dirs = [];
    if (x + 1 < n) dirs.push({ x: x + 1, y });
    if (y + 1 < n) dirs.push({ x, y: y + 1 });
    if (dirs.length > 0) {
      const to = dirs[Math.floor(rand() * dirs.length)];
      carvePassage(maze, x, y, to.x, to.y);
    }
  }

  return maze;
}

function dirMask(maze, x, y) {
  let mask = 0;
  const c = maze[y][x];
  if (c.e) mask |= DIR.EAST;
  if (c.w) mask |= DIR.WEST;
  if (c.n) mask |= DIR.NORTH;
  if (c.s) mask |= DIR.SOUTH;
  return mask;
}

function applyMove(p, mv) {
  if (mv === DIR.EAST) return { x: p.x + 1, y: p.y };
  if (mv === DIR.WEST) return { x: p.x - 1, y: p.y };
  if (mv === DIR.NORTH) return { x: p.x, y: p.y - 1 };
  if (mv === DIR.SOUTH) return { x: p.x, y: p.y + 1 };
  return p;
}

/**
 * Hardcore Runner: Multi-agent, Random Goal, Collision Physics
 */
function runOneMaze(Solver, size, bots, seed) {
  const rand = mulberry32(seed);

  // Complexity upgrade: Maze type diversity
  const type = rand() > 0.5 ? 'dfs' : 'prim';
  const maze = generateMaze(size, rand, type);

  // Complexity upgrade: Random Goal position (Not just N-1, N-1)
  const goal = {
    x: Math.floor(rand() * (size - 2)) + 1,
    y: Math.floor(rand() * (size - 2)) + 1
  };

  // Complexity upgrade: Unsolvable Trap (5% chance)
  const isTrap = rand() < 0.05;
  if (isTrap) {
    maze[goal.y][goal.x] = { n: false, s: false, w: false, e: false };
    if (goal.x > 0) maze[goal.y][goal.x - 1].e = false;
    if (goal.x < size - 1) maze[goal.y][goal.x + 1].w = false;
    if (goal.y > 0) maze[goal.y - 1][goal.x].s = false;
    if (goal.y < size - 1) maze[goal.y + 1][goal.x].n = false;
  }

  const pos = [];
  const set = new Set();
  while (set.size < bots) {
    const rx = Math.floor(rand() * size);
    const ry = Math.floor(rand() * size);
    if (rx === goal.x && ry === goal.y) continue;
    const key = `${rx},${ry}`;
    if (!set.has(key)) {
      set.add(key);
      pos.push({ x: rx, y: ry });
    }
  }

  // Complexity upgrade: Tighter Step Limit
  const stepLimit = Math.floor(size * size * 1.5) + (bots * size);
  const solver = new Solver(bots);

  let totalCpuMs = 0;
  let totalPathMoves = 0;

  for (let step = 0; step < stepLimit; step++) {
    const statuses = pos.map((p) => {
      if (p.x === goal.x && p.y === goal.y) return { x: p.x, y: p.y, dir: DIR.STAY, isExit: true };
      return { x: p.x, y: p.y, dir: dirMask(maze, p.x, p.y), isExit: false };
    });

    if (statuses.every((s) => s.dir === DIR.STAY)) {
      return { completed: !isTrap, steps: step, path: totalPathMoves, cpuMs: totalCpuMs, reason: isTrap ? "trapped_ok" : "ok" };
    }

    let moves;
    const t0 = performance.now();
    try {
      moves = solver.nextMove(statuses);
    } catch (error) {
      return { completed: false, steps: stepLimit, path: totalPathMoves, cpuMs: totalCpuMs, reason: `exception: ${error.message}` };
    }
    totalCpuMs += performance.now() - t0;

    if (!Array.isArray(moves) || moves.length !== bots) {
      return { completed: false, steps: stepLimit, path: totalPathMoves, cpuMs: totalCpuMs, reason: "invalid return shape" };
    }

    const nextPositions = new Set();
    for (let i = 0; i < bots; i++) {
      if (statuses[i].dir === DIR.STAY) {
        nextPositions.add(`${pos[i].x},${pos[i].y}`);
        continue;
      }

      const mv = moves[i];
      if ((statuses[i].dir & mv) === 0 && mv !== DIR.STAY) {
        return { completed: false, steps: stepLimit, path: totalPathMoves, cpuMs: totalCpuMs, reason: "illegal move" };
      }

      const nextP = applyMove(pos[i], mv);
      const pKey = `${nextP.x},${nextP.y}`;

      // Complexity upgrade: No-Collision rule (except at goal)
      if (mv !== DIR.STAY && nextPositions.has(pKey) && (nextP.x !== goal.x || nextP.y !== goal.y)) {
        return { completed: false, steps: stepLimit, path: totalPathMoves, cpuMs: totalCpuMs, reason: "collision" };
      }

      nextPositions.add(pKey);
      if (mv !== DIR.STAY) totalPathMoves += 1;
      pos[i] = nextP;
    }
  }

  return { completed: false, steps: stepLimit, path: totalPathMoves, cpuMs: totalCpuMs, reason: isTrap ? "trapped_fail" : "step limit" };
}

function evaluateSolver(name, Solver, options) {
  const sizes = options.sizes || [20, 30, 40, 50];
  const botsList = options.botsList || [1, 2, 3];
  const trialsPerConfig = options.trialsPerConfig || 5;
  const baseSeed = options.baseSeed || Date.now();

  const details = [];
  let completed = 0;
  let total = 0;
  let sumSteps = 0;
  let sumPath = 0;
  let sumCpuMs = 0;
  const failureReasons = new Map();

  for (const size of sizes) {
    for (const bots of botsList) {
      for (let t = 0; t < trialsPerConfig; t++) {
        total += 1;
        const seed = baseSeed + size * 1000 + bots * 100 + t;
        const r = runOneMaze(Solver, size, bots, seed);
        sumCpuMs += r.cpuMs;
        if (r.completed) {
          completed += 1;
          sumSteps += r.steps;
          sumPath += r.path;
        } else {
          failureReasons.set(r.reason, (failureReasons.get(r.reason) || 0) + 1);
        }
        details.push({ size, bots, trial: t, completed: r.completed, steps: r.steps, path: r.path, cpuMs: r.cpuMs, reason: r.reason });
      }
    }
  }

  return {
    name,
    completed,
    total,
    avgSteps: completed > 0 ? sumSteps / completed : Infinity,
    avgPath: completed > 0 ? sumPath / completed : Infinity,
    avgCpuMs: total > 0 ? sumCpuMs / total : Infinity,
    failureReasons: Object.fromEntries([...failureReasons.entries()].sort((a, b) => b[1] - a[1])),
    details,
  };
}

function rankResults(results) {
  return [...results].sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    if (a.avgSteps !== b.avgSteps) return a.avgSteps - b.avgSteps;
    return a.avgCpuMs - b.avgCpuMs;
  });
}

function evaluateDirectory(submissionDir, options = {}) {
  const dir = path.resolve(submissionDir);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".js"));
  const results = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const Solver = loadSolver(fullPath);
      if (typeof Solver !== "function") throw new Error("Not a class");
      results.push(evaluateSolver(file, Solver, options));
    } catch (error) {
      results.push({ name: file, completed: 0, total: 0, avgSteps: Infinity, failureReasons: { [`load error: ${error.message}`]: 1 } });
    }
  }
  return rankResults(results);
}

module.exports = { DIR, loadSolver, evaluateDirectory, evaluateSolver, rankResults };