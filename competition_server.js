/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { evaluateDirectory } = require("./competition_engine");

const PORT = Number(process.env.PORT || 3000);
const SUBMISSION_DIR = path.join(__dirname, "submissions");

// Hardcore Evaluation Options
const EVAL_OPTIONS = {
    sizes: [20, 30, 40, 50],
    botsList: [1, 2, 3],
    trialsPerConfig: 4, // 48 trials total per submission
    baseSeed: 20260302, // Deterministic seed for competition
};

if (!fs.existsSync(SUBMISSION_DIR)) fs.mkdirSync(SUBMISSION_DIR, { recursive: true });

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

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API: Get Leaderboard (The core challenge)
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        try {
            console.time("Evaluation");
            const ranked = evaluateDirectory(SUBMISSION_DIR, EVAL_OPTIONS);
            console.timeEnd("Evaluation");

            return sendJson(res, 200, {
                generatedAt: new Date().toISOString(),
                config: EVAL_OPTIONS,
                leaderboard: ranked.map((r, i) => ({
                    rank: i + 1,
                    name: r.name,
                    score: `${r.completed}/${r.total}`,
                    avgSteps: r.avgSteps === Infinity ? "N/A" : r.avgSteps.toFixed(2),
                    avgCpuMs: r.avgCpuMs.toFixed(4),
                    failures: r.failureReasons
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
            const safeName = teamName.replace(/[^a-z0-9_-]/gi, "_").slice(0, 20);
            fs.writeFileSync(path.join(SUBMISSION_DIR, `${safeName}_MazeFinder.js`), code);
            return sendJson(res, 200, { message: "Submission successful", team: safeName });
        } catch (error) {
            return sendJson(res, 400, { error: "Invalid submission" });
        }
    }

    sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`[HARDCORE MODE] Competition server at http://localhost:${PORT}`);
});