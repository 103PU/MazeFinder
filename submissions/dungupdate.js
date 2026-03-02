/**
 * MazeFinder - Frontier-based A* Strategy
 * Tối ưu hóa cho Competition Server:
 * 1. Global Mapping: Chia sẻ kiến thức giữa tất cả robot.
 * 2. Frontier Exploration: Luôn tìm đường ngắn nhất đến ô chưa khám phá (triệt tiêu bước thừa DFS).
 * 3. A* Sprint: Khi thấy đích, tất cả robot tập trung chạy về theo đường ngắn nhất.
 * 4. Collision Prevention: Tránh robot dẫm chân nhau gây lãng phí bước đi.
 */
class MazeFinder {
    constructor(noOfBot) {
        this.DIR = { STAY: 0, SOUTH: 1, NORTH: 2, WEST: 4, EAST: 8 };
        this.numBots = noOfBot;
        // Server dùng tối đa size 50, dùng 52 để an toàn biên
        this.maxSize = 52;
        this.maxCells = this.maxSize * this.maxSize;

        // Khởi tạo bộ nhớ hiệu suất cao
        this.grid = new Uint8Array(this.maxCells);    // Lưu bitmask các hướng mở
        this.visited = new Uint8Array(this.maxCells); // Đánh dấu ô robot đã thực sự dẫm vào

        this.exitIdx = -1;
        this.exitFound = false;

        // Hướng đi và Vector di chuyển
        this.dirList = [1, 2, 4, 8];
        this.opp = { 1: 2, 2: 1, 4: 8, 8: 4 };
        this.dx = { 1: 0, 2: 0, 4: -1, 8: 1 };
        this.dy = { 1: 1, 2: -1, 4: 0, 8: 0 };

        // Queue dùng chung cho BFS để tiết kiệm bộ nhớ (tránh tạo mới liên tục)
        this.bfsQueue = new Int32Array(this.maxCells);
        this.parent = new Int32Array(this.maxCells);
        this.dist = new Int16Array(this.maxCells);
    }

    idx(x, y) {
        return x * this.maxSize + y;
    }

    /**
     * Cập nhật bản đồ từ dữ liệu server trả về
     */
    updateKnowledge(statuses) {
        for (let i = 0; i < this.numBots; i++) {
            const s = statuses[i];
            if (s.dir === 0) continue; // Robot đã về đích hoặc kẹt

            const ci = this.idx(s.x, s.y);
            this.visited[ci] = 1;
            this.grid[ci] |= s.dir; // Cập nhật các hướng mở tại ô hiện tại

            // Kiểm tra lối thoát (nằm ngoài biên tọa độ mê cung hiện tại)
            for (let d of this.dirList) {
                if (s.dir & d) {
                    const nx = s.x + this.dx[d];
                    const ny = s.y + this.dy[d];
                    const ni = this.idx(nx, ny);

                    // Cập nhật thông tin hướng ngược lại cho ô lân cận
                    this.grid[ni] |= this.opp[d];

                    // Nếu tọa độ hàng xóm vượt quá giới hạn server (ví dụ 50x50) 
                    // hoặc là tọa độ đích (theo logic server là x=size-1, y=size-1)
                    // Ở đây ta đơn giản hóa: nếu dir mở dẫn đến ô có tọa độ đích
                    if (s.isExit) { // Một số server trả về flag isExit
                        this.exitFound = true;
                        this.exitIdx = ci;
                    }
                }
            }
        }
    }

    /**
     * BFS tìm đường ngắn nhất:
     * - Nếu mode = 'exit': Tìm đường về đích.
     * - Nếu mode = 'frontier': Tìm ô gần nhất đã biết đường nhưng chưa dẫm vào.
     */
    findNextMove(startX, startY, mode) {
        const startIdx = this.idx(startX, startY);
        this.parent.fill(-1);
        this.dist.fill(-1);

        let head = 0, tail = 0;
        this.bfsQueue[tail++] = startIdx;
        this.dist[startIdx] = 0;

        while (head < tail) {
            const curr = this.bfsQueue[head++];
            const cx = Math.floor(curr / this.maxSize);
            const cy = curr % this.maxSize;

            // Điều kiện dừng
            if (mode === 'exit' && curr === this.exitIdx) return this.backtrack(curr, startIdx);
            if (mode === 'frontier' && !this.visited[curr]) return this.backtrack(curr, startIdx);

            const possible = this.grid[curr];
            for (let d of this.dirList) {
                if (possible & d) {
                    const nx = cx + this.dx[d];
                    const ny = cy + this.dy[d];
                    const ni = this.idx(nx, ny);

                    if (this.dist[ni] === -1) {
                        this.dist[ni] = this.dist[curr] + 1;
                        this.parent[ni] = curr;
                        this.bfsQueue[tail++] = ni;
                    }
                }
            }
        }
        return 0;
    }

    backtrack(targetIdx, startIdx) {
        let curr = targetIdx;
        while (this.parent[curr] !== -1 && this.parent[curr] !== startIdx) {
            curr = this.parent[curr];
        }
        const cx = Math.floor(curr / this.maxSize);
        const cy = curr % this.maxSize;
        const sx = Math.floor(startIdx / this.maxSize);
        const sy = startIdx % this.maxSize;

        if (cx > sx) return 8; // EAST
        if (cx < sx) return 4; // WEST
        if (cy > sy) return 1; // SOUTH
        if (cy < sy) return 2; // NORTH
        return 0;
    }

    nextMove(statuses) {
        this.updateKnowledge(statuses);

        // Kiểm tra xem đã ai chạm đích chưa (theo competition_engine logic)
        for (let s of statuses) {
            if (s.dir === 0) { // STAY nghĩa là đang đứng tại đích
                this.exitFound = true;
                this.exitIdx = this.idx(s.x, s.y);
            }
        }

        const finalMoves = new Array(this.numBots).fill(0);
        const nextPositions = new Set();

        for (let i = 0; i < this.numBots; i++) {
            const s = statuses[i];
            if (s.dir === 0) continue;

            let move = 0;
            if (this.exitFound) {
                move = this.findNextMove(s.x, s.y, 'exit');
            }

            if (move === 0) {
                move = this.findNextMove(s.x, s.y, 'frontier');
            }

            // Fallback nếu không có đường đi tối ưu
            if (move === 0) {
                for (let d of this.dirList) {
                    if (s.dir & d) { move = d; break; }
                }
            }

            // Collision Avoidance: Kiểm tra ô dự định tới
            const nx = s.x + this.dx[move];
            const ny = s.y + this.dy[move];
            const nIdx = this.idx(nx, ny);

            if (nextPositions.has(nIdx) && move !== 0) {
                // Nếu trùng vị trí với robot khác đã tính, robot này STAY 1 lượt
                finalMoves[i] = 0;
            } else {
                finalMoves[i] = move;
                if (move !== 0) nextPositions.add(nIdx);
            }
        }

        return finalMoves;
    }
}

if (typeof module !== "undefined") {
    module.exports = MazeFinder;
}