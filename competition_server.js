/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { evaluateDirectory } = require("./competition_engine");

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
};

const server = http.createServer(requestHandler);

if (require.main === module) {
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`[HARDCORE MODE] Competition server at http://localhost:${PORT}`);
    });
}

module.exports = requestHandler;