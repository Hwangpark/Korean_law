/**
 * KoreanLaw Analysis API Server
 * POST /api/analyze  — runs the full multi-agent pipeline
 * GET  /health       — liveness check
 */

import http from "node:http";
import { runAnalysis } from "./orchestrator/run-analysis.mjs";

const PORT = process.env.ANALYSIS_PORT ?? 3002;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    return json(res, 200, { status: "ok", service: "analysis", time: new Date().toISOString() });
  }

  if (req.url === "/api/analyze" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }

    const { text, context_type = "community" } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return json(res, 422, { error: "text 필드가 필요합니다." });
    }

    const request = {
      request_id: `web-${Date.now()}`,
      input_type: "text",
      context_type,
      text: text.trim(),
    };

    try {
      const result = await runAnalysis(request, { providerMode: "mock" });
      return json(res, 200, result);
    } catch (err) {
      console.error("Analysis error:", err);
      return json(res, 500, { error: err.message ?? "분석 중 오류가 발생했습니다." });
    }
  }

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`Analysis API listening on http://0.0.0.0:${PORT}\n`);
});
