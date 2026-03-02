/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { loadSolver, evaluateSolver } = require("./competition_engine");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = !!process.env.VERCEL;
const SUBMISSION_DIR = IS_VERCEL ? path.join("/tmp", "submissions") : path.join(__dirname, "submissions");

// Hardcore Evaluation Options
const EVAL_OPTIONS = {
    sizes: [20, 30, 40, 50],
    botsList: [1, 2, 3],
    trialsPerConfig: 4, // 48 trials total per submission
    baseSeed: 20260302, // Deterministic seed for competition
};

if (!fs.existsSync(SUBMISSION_DIR)) {
    fs.mkdirSync(SUBMISSION_DIR, { recursive: true });
}

// Ensure bundled submissions are available in /tmp on Vercel
if (IS_VERCEL) {
    const bundledDir = path.join(__dirname, "submissions");
    if (fs.existsSync(bundledDir)) {
        for (const file of fs.readdirSync(bundledDir)) {
            if (file.endsWith(".js") && !fs.existsSync(path.join(SUBMISSION_DIR, file))) {
                fs.copyFileSync(path.join(bundledDir, file), path.join(SUBMISSION_DIR, file));
            }
        }
    }
}

function sendJson(res, statusCode, payload) {
    const data = JSON.stringify(payload);
    res.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(data);
}

async function readBody(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    return body;
}

const requestHandler = async (req, res) => {
    const host = req.headers.host || "localhost";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const url = new URL(req.url, `${protocol}://${host}`);

    // API: Get Leaderboard (The core challenge)
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        try {
            const submissions = await prisma.submission.findMany({
                orderBy: [
                    { completed: 'desc' },
                    { avgSteps: 'asc' },
                    { avgPath: 'asc' },
                    { avgCpuMs: 'asc' }
                ],
                take: 10 // top 10 competitors
            });

            return sendJson(res, 200, {
                generatedAt: new Date().toISOString(),
                config: EVAL_OPTIONS,
                leaderboard: submissions.map((r, i) => ({
                    rank: i + 1,
                    name: r.teamName,
                    score: `${r.completed}/${r.total}`,
                    avgSteps: (r.avgSteps === null || r.avgSteps >= 9999999) ? "N/A" : r.avgSteps.toFixed(2),
                    avgPath: (r.avgPath === null || r.avgPath >= 9999999) ? "N/A" : r.avgPath.toFixed(2),
                    avgTimeMs: (r.avgCpuMs === null || r.avgCpuMs >= 9999999) ? "N/A" : r.avgCpuMs.toFixed(4),
                    failures: r.failureReasons || {}
                })),
            });
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // API: Submit Code
    if (req.method === "POST" && url.pathname === "/api/submit") {
        try {
            const body = await readBody(req);
            const { teamName, code } = JSON.parse(body);
            const safeName = teamName.replace(/[^a-z0-9a-zA-Z_-]/gi, "_").slice(0, 20);
            // Execute code safely in memory VM (Vercel serverless friendly)
            const vm = require("vm");
            const ctx = { console, module: { exports: {} } };
            vm.createContext(ctx);

            try {
                // Compile and execute the user string in the VM
                vm.runInContext(code + '\n;if(typeof MazeFinder !== "undefined" && typeof module.exports !== "function") module.exports = MazeFinder;', ctx, { timeout: 2000 });
            } catch (compileError) {
                return sendJson(res, 400, { error: "Compile Error: " + compileError.message });
            }

            const Solver = ctx.module.exports;
            if (typeof Solver !== "function") throw new Error("Solver must be a class/function (Make sure to export MazeFinder)");

            const results = evaluateSolver(safeName, Solver, EVAL_OPTIONS);

            // Save to DB
            const dataToSave = {
                code: code,
                completed: results.completed,
                total: results.total,
                avgSteps: results.avgSteps === Infinity ? 9999999.99 : results.avgSteps,
                avgPath: results.avgPath === Infinity ? 9999999.99 : results.avgPath,
                avgCpuMs: results.avgCpuMs === Infinity ? 9999999.99 : results.avgCpuMs,
                failureReasons: results.failureReasons
            };

            await prisma.submission.upsert({
                where: { teamName: safeName },
                update: dataToSave,
                create: {
                    teamName: safeName,
                    ...dataToSave
                }
            });

            // No cleanup needed for VM

            return sendJson(res, 200, { message: "Submission successful and evaluated!", team: safeName });
        } catch (error) {
            console.error(error);
            return sendJson(res, 400, { error: error.message || "Invalid submission" });
        }
    }

    sendJson(res, 404, { error: "Not found" });
};

const server = http.createServer(requestHandler);

if (require.main === module) {
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`[HARDCORE MODE] Competition server at http://localhost:${PORT}`);
    });
}

module.exports = requestHandler;