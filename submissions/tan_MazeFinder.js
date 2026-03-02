/**
 * MazeFinder — Pure DFS (Depth-First Search) strategy
 *
 * Each bot uses a stack-based DFS approach:
 * - Explore as deep as possible before backtracking
 * - Once exit is found, use BFS distance map to sprint
 * - Bots alternate between right-hand and left-hand wall following
 *   for diversity, but the core exploration is stack-based DFS
 */
class MazeFinder {
    constructor(noOfBot) {
        this.DIR = { STAY: 0, SOUTH: 1, NORTH: 2, WEST: 4, EAST: 8 };
        this.numBots = noOfBot;
        this.maxSize = 51;
        this.maxCells = this.maxSize * this.maxSize;

        // Grid knowledge
        this.grid = new Uint8Array(this.maxCells);
        this.dist = new Int16Array(this.maxCells);
        this.dist.fill(-1);

        // Exit state
        this.exitIdx = -1;
        this.exitDir = 0;
        this.exitFound = false;
        this.distMapReady = false;
        this.goalKnown = false;

        // Bot state
        this.botFinished = new Uint8Array(noOfBot);
        this.botX = new Int16Array(noOfBot);
        this.botY = new Int16Array(noOfBot);
        this.botLastDir = new Uint8Array(noOfBot);

        // DFS stack per bot: stores cell indices for backtracking
        this.botStack = new Array(noOfBot);
        this.botStackLen = new Int32Array(noOfBot);
        this.botVisitedSet = new Array(noOfBot);
        for (let i = 0; i < noOfBot; i++) {
            this.botStack[i] = new Int32Array(this.maxCells);
            this.botStackLen[i] = 0;
            this.botVisitedSet[i] = new Uint8Array(this.maxCells);
        }

        // Direction tables
        this.dirList = new Uint8Array([1, 2, 4, 8]);
        this.dx = new Int8Array(16);
        this.dy = new Int8Array(16);
        this.dx[8] = 1; this.dy[8] = 0;
        this.dx[4] = -1; this.dy[4] = 0;
        this.dx[2] = 0; this.dy[2] = -1;
        this.dx[1] = 0; this.dy[1] = 1;

        this.oppDir = new Uint8Array(16);
        this.oppDir[8] = 4; this.oppDir[4] = 8;
        this.oppDir[2] = 1; this.oppDir[1] = 2;

        this.dirToBit = new Uint8Array(16);
        this.dirToBit[1] = 0; this.dirToBit[2] = 1;
        this.dirToBit[4] = 2; this.dirToBit[8] = 3;

        this.bfsQueue = new Int32Array(this.maxCells);

        // Each bot gets a different direction priority for DFS branching diversity
        this.dirPrio = new Array(noOfBot);
        const allDirOrders = [
            [8, 1, 4, 2],  // E, S, W, N
            [4, 2, 8, 1],  // W, N, E, S
            [1, 8, 2, 4],  // S, E, N, W
            [2, 4, 1, 8],  // N, W, S, E
            [8, 2, 4, 1],  // E, N, W, S
        ];
        for (let i = 0; i < noOfBot; i++) {
            this.dirPrio[i] = allDirOrders[i % allDirOrders.length];
        }

        this.moves = new Uint8Array(noOfBot);

        // 2D distMap wrapper for rendering compatibility
        this.distMap = new Array(this.maxSize);
        for (let x = 0; x < this.maxSize; x++) {
            this.distMap[x] = this.dist.subarray(x * this.maxSize, (x + 1) * this.maxSize);
        }

        // Path backtrack for bridging to dist region
        this.pathParent = new Int32Array(this.maxCells);
        this.pathParent.fill(-1);
        this.pathDir = new Uint8Array(this.maxCells);
        this.pathQueue = new Int32Array(this.maxCells);
        this.pathVisited = new Int32Array(this.maxCells);

        // Global coordination to reduce overlap between bots.
        this.globalVisited = new Uint8Array(this.maxCells);
        this.globalEdgeUse = new Map();
    }

    idx(x, y) {
        return x * this.maxSize + y;
    }

    edgeKey(a, b) {
        return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    edgeUse(fromIdx, toIdx) {
        return this.globalEdgeUse.get(this.edgeKey(fromIdx, toIdx)) || 0;
    }

    addEdgeUse(fromIdx, toIdx) {
        const key = this.edgeKey(fromIdx, toIdx);
        this.globalEdgeUse.set(key, (this.globalEdgeUse.get(key) || 0) + 1);
    }

    updateKnowledge(x, y, availableDirs) {
        const ci = this.idx(x, y);
        this.grid[ci] |= 16;
        const openBits = availableDirs & 15;
        this.grid[ci] = (this.grid[ci] & 0xF0) | openBits | 32;

        for (let di = 0; di < 4; di++) {
            const d = this.dirList[di];
            const nx = x + this.dx[d];
            const ny = y + this.dy[d];
            if (nx >= 0 && ny >= 0 && nx < this.maxSize && ny < this.maxSize) {
                const ni = this.idx(nx, ny);
                const opp = this.oppDir[d];
                const oppBit = this.dirToBit[opp];
                if (availableDirs & d) {
                    this.grid[ni] |= (1 << oppBit);
                } else {
                    this.grid[ni] &= ~(1 << oppBit);
                }
            }
        }
    }

    detectExit(x, y, availableDirs) {
        for (let di = 0; di < 4; di++) {
            const d = this.dirList[di];
            if (!(availableDirs & d)) continue;
            const nx = x + this.dx[d];
            const ny = y + this.dy[d];
            if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) {
                return d;
            }
        }
        return 0;
    }

    // BFS from exit for sprint phase
    runBFS() {
        this.dist.fill(-1);
        if (this.exitIdx < 0) return;
        let head = 0, tail = 0;
        this.dist[this.exitIdx] = 0;
        this.bfsQueue[tail++] = this.exitIdx;

        while (head < tail) {
            const ci = this.bfsQueue[head++];
            const cx = (ci / this.maxSize) | 0;
            const cy = ci % this.maxSize;
            const cd = this.dist[ci];
            const cellBits = this.grid[ci] & 15;

            for (let di = 0; di < 4; di++) {
                const d = this.dirList[di];
                const nx = cx + this.dx[d];
                const ny = cy + this.dy[d];
                if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) continue;
                const ni = this.idx(nx, ny);
                if (this.dist[ni] !== -1) continue;
                const bitFromHere = this.dirToBit[d];
                const passageFromHere = cellBits & (1 << bitFromHere);
                const opp = this.oppDir[d];
                const bitFromThere = this.dirToBit[opp];
                const passageFromThere = this.grid[ni] & (1 << bitFromThere);
                if (passageFromHere || passageFromThere) {
                    this.dist[ni] = cd + 1;
                    this.bfsQueue[tail++] = ni;
                }
            }
        }
        this.distMapReady = true;
    }

    sprintMove(x, y, availableDirs) {
        const ci = this.idx(x, y);
        const curDist = this.dist[ci];
        if (curDist === 0) return this.exitDir;
        if (curDist < 0) return 0;

        let bestDir = 0;
        let bestDist = curDist;
        for (let di = 0; di < 4; di++) {
            const d = this.dirList[di];
            if (!(availableDirs & d)) continue;
            const nx = x + this.dx[d];
            const ny = y + this.dy[d];
            if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) {
                return d;
            }
            const nd = this.dist[this.idx(nx, ny)];
            if (nd >= 0 && nd < bestDist) {
                bestDist = nd;
                bestDir = d;
            }
        }
        return bestDir;
    }

    // Find a path from bot's position to a cell with known distance
    findPathToDistRegion(x, y) {
        const startIdx = this.idx(x, y);
        let visitedLen = 0;
        this.pathParent[startIdx] = startIdx;
        this.pathVisited[visitedLen++] = startIdx;
        let head = 0, tail = 0;
        this.pathQueue[tail++] = startIdx;
        let resultDir = 0;

        while (head < tail) {
            const ci = this.pathQueue[head++];
            const cx = (ci / this.maxSize) | 0;
            const cy = ci % this.maxSize;
            const cellBits = this.grid[ci] & 15;

            for (let di = 0; di < 4; di++) {
                const d = this.dirList[di];
                const nx = cx + this.dx[d];
                const ny = cy + this.dy[d];
                if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) continue;
                const ni = this.idx(nx, ny);
                if (this.pathParent[ni] !== -1) continue;
                const bitFromHere = this.dirToBit[d];
                const passageFromHere = cellBits & (1 << bitFromHere);
                const opp = this.oppDir[d];
                const bitFromThere = this.dirToBit[opp];
                const passageFromThere = this.grid[ni] & (1 << bitFromThere);
                if (passageFromHere || passageFromThere) {
                    this.pathParent[ni] = ci;
                    this.pathDir[ni] = d;
                    this.pathVisited[visitedLen++] = ni;
                    if (this.dist[ni] >= 0) {
                        let cur = ni;
                        while (this.pathParent[cur] !== startIdx) {
                            cur = this.pathParent[cur];
                        }
                        resultDir = this.pathDir[cur];
                        head = tail;
                        break;
                    }
                    this.pathQueue[tail++] = ni;
                }
            }
        }
        for (let i = 0; i < visitedLen; i++) {
            this.pathParent[this.pathVisited[i]] = -1;
        }
        return resultDir;
    }

    /**
     * DFS exploration move for a single bot.
     *
     * Strategy: push current cell to bot's DFS stack, then pick an
     * unvisited neighbor. If all neighbors are visited or blocked,
     * backtrack by popping from the stack.
     */
    dfsMove(botIdx, x, y, availableDirs) {
        const ci = this.idx(x, y);
        const prio = this.dirPrio[botIdx];
        const visited = this.botVisitedSet[botIdx];
        const stack = this.botStack[botIdx];

        // Mark current cell as visited in this bot's DFS
        if (!visited[ci]) {
            visited[ci] = 1;
            stack[this.botStackLen[botIdx]++] = ci;
        }

        // Try to find an unvisited neighbor (DFS: go deep).
        // Prefer globally less-explored branches to improve completion rate.
        let bestFreshDir = 0;
        let bestFreshScore = 1e9;
        let bestLocalDir = 0;
        let bestLocalScore = 1e9;
        for (let di = 0; di < 4; di++) {
            const d = prio[di];
            if (!(availableDirs & d)) continue;
            const nx = x + this.dx[d];
            const ny = y + this.dy[d];

            // Exit found!
            if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) {
                return d;
            }

            const ni = this.idx(nx, ny);
            if (!visited[ni]) {
                let score = this.edgeUse(ci, ni) * 10 + di;
                // Single-bot acceleration: mildly bias toward farther frontier
                // so the bot reaches distant goal regions earlier.
                if (this.numBots === 1) {
                    score -= ((nx + ny) >> 2);
                }
                if (!this.globalVisited[ni]) {
                    if (score < bestFreshScore) {
                        bestFreshScore = score;
                        bestFreshDir = d;
                    }
                } else if (score < bestLocalScore) {
                    bestLocalScore = score;
                    bestLocalDir = d;
                }
            }
        }
        if (bestFreshDir !== 0) return bestFreshDir;
        if (bestLocalDir !== 0) return bestLocalDir;

        // All neighbors visited — backtrack via stack
        if (this.botStackLen[botIdx] > 1) {
            // Pop current cell
            this.botStackLen[botIdx]--;
            // Peek at previous cell in stack
            const prevIdx = stack[this.botStackLen[botIdx] - 1];
            const px = (prevIdx / this.maxSize) | 0;
            const py = prevIdx % this.maxSize;

            // Find direction to go back to previous cell
            for (let di = 0; di < 4; di++) {
                const d = this.dirList[di];
                if (!(availableDirs & d)) continue;
                const nx = x + this.dx[d];
                const ny = y + this.dy[d];
                if (nx === px && ny === py) {
                    return d;
                }
            }
        }

        // Fallback: pick least-used available edge.
        let bestAnyDir = 0;
        let bestAnyScore = 1e9;
        for (let di = 0; di < 4; di++) {
            const d = prio[di];
            if (!(availableDirs & d)) continue;
            const nx = x + this.dx[d];
            const ny = y + this.dy[d];
            if (nx < 0 || ny < 0 || nx >= this.maxSize || ny >= this.maxSize) return d;
            const ni = this.idx(nx, ny);
            let score = this.edgeUse(ci, ni) * 10 + di;
            if (this.numBots === 1) {
                score -= ((nx + ny) >> 2);
            }
            if (score < bestAnyScore) {
                bestAnyScore = score;
                bestAnyDir = d;
            }
        }
        return bestAnyDir;
    }

    nextMove(statuses) {
        // Phase 1: Update knowledge
        for (let i = 0; i < this.numBots; i++) {
            const s = statuses[i];
            if (s.dir === 0) {
                this.botFinished[i] = 1;
                this.moves[i] = 0;
                if (!this.goalKnown) {
                    this.goalKnown = true;
                    this.exitIdx = this.idx(s.x, s.y);
                    this.exitDir = 0;
                    this.exitFound = true;
                }
                continue;
            }
            this.botX[i] = s.x;
            this.botY[i] = s.y;
            this.updateKnowledge(s.x, s.y, s.dir);
            this.globalVisited[this.idx(s.x, s.y)] = 1;

            if (!this.exitFound) {
                const ed = this.detectExit(s.x, s.y, s.dir);
                if (ed !== 0) {
                    this.exitIdx = this.idx(s.x, s.y);
                    this.exitDir = ed;
                    this.exitFound = true;
                }
            }
        }

        // Phase 2: BFS from exit when found
        if (this.exitFound) {
            this.runBFS();
        }

        // Phase 3: Compute moves
        for (let i = 0; i < this.numBots; i++) {
            if (this.botFinished[i]) {
                this.moves[i] = 0;
                continue;
            }
            const s = statuses[i];
            const x = s.x, y = s.y;
            let move;

            if (this.exitFound && this.distMapReady) {
                const ci = this.idx(x, y);
                const curDist = this.dist[ci];
                if (curDist >= 0) {
                    // Sprint to exit via distance gradient
                    move = this.sprintMove(x, y, s.dir);
                } else {
                    // Try to find path to known-distance region
                    move = this.findPathToDistRegion(x, y);
                    if (move === 0) {
                        // DFS explore to discover new passages
                        move = this.dfsMove(i, x, y, s.dir);
                    }
                }
            } else {
                // Pure DFS exploration
                move = this.dfsMove(i, x, y, s.dir);
            }

            this.moves[i] = move;
            if (move !== 0) {
                this.botLastDir[i] = move;
                const fromIdx = this.idx(x, y);
                const nx = x + this.dx[move];
                const ny = y + this.dy[move];
                if (nx >= 0 && ny >= 0 && nx < this.maxSize && ny < this.maxSize) {
                    const toIdx = this.idx(nx, ny);
                    this.addEdgeUse(fromIdx, toIdx);
                }
            }
        }

        const result = new Array(this.numBots);
        for (let i = 0; i < this.numBots; i++) {
            result[i] = this.moves[i];
        }
        return result;
    }
}

if (typeof module !== "undefined") {
    module.exports = MazeFinder;
}
