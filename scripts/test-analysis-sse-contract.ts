import assert from "node:assert/strict";
import http from "node:http";

import { buildPublicAnalysisEvent } from "../apps/api/src/analysis/http-envelope.js";
import { createAnalysisHandler } from "../apps/api/src/analysis/http.js";
import { createAnalysisJobManager } from "../apps/api/src/analysis/jobs.js";
import type { AnalysisConfig } from "../apps/api/src/analysis/config.js";
import type { AnalysisStore, GuestUsageIdentity, GuestUsageResult } from "../apps/api/src/analysis/store.js";
import type { AuthConfig } from "../apps/api/src/auth/config.js";
import type { AuthService } from "../apps/api/src/auth/service.js";

type HttpJsonResponse = {
  status: number;
  body: Record<string, unknown>;
};

type SseEventSnapshot = {
  event: string;
  data: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertPublicClassifierExtraction(payload: unknown, label: string): void {
  const classification = asRecord(payload);
  const extraction = asRecord(classification.extraction);

  assert.equal(typeof extraction.mode, "string", `${label} should expose extraction.mode`);
  assert.ok(
    extraction.model === null || typeof extraction.model === "string",
    `${label} should expose extraction.model as string or null`
  );
  assert.equal(typeof extraction.used_llm, "boolean", `${label} should expose extraction.used_llm`);
  assert.ok(
    extraction.warning === null || typeof extraction.warning === "string",
    `${label} should expose extraction.warning as string or null`
  );
  assert.ok(Array.isArray(extraction.warnings), `${label} should expose extraction.warnings`);
  assert.ok(
    Array.isArray(extraction.unsupported_issue_types),
    `${label} should expose extraction.unsupported_issue_types`
  );
  assert.equal(
    typeof extraction.issue_hypotheses_source,
    "string",
    `${label} should expose extraction.issue_hypotheses_source`
  );
  assert.equal(
    "prompt" in extraction || "raw_request" in extraction || "raw_response" in extraction || "provider_response" in extraction,
    false,
    `${label} should not leak prompt/raw provider internals`
  );
}

function createTestAuthConfig(): AuthConfig {
  return {
    port: 0,
    corsOrigins: ["http://localhost:5173"],
    trustedProxyAddresses: [],
    database: {
      host: "127.0.0.1",
      port: 5432,
      database: "koreanlaw",
      user: "tester",
      password: "tester"
    },
    jwt: {
      secret: "test-secret",
      issuer: "test-issuer",
      audience: "test-audience",
      expiresInSeconds: 3600
    },
    email: {
      user: "tester@example.com",
      appPassword: "",
      enabled: false,
      baseUrl: "http://localhost:3001"
    },
    nodeEnv: "test",
    requestBodyLimit: 1_000_000,
    requestIdPrefix: "test"
  };
}

function createTestAnalysisConfig(): AnalysisConfig {
  return {
    providerMode: "mock",
    requestBodyLimit: 1_000_000,
    crawlTimeoutMs: 1_000,
    crawlMaxBytes: 100_000,
    crawlFollowRedirects: 0
  };
}

function createMockAuthService(): AuthService {
  return {
    ensureSchema: async () => undefined,
    requestEmailCode: async () => ({ status: 200, body: {} }),
    verifyEmailCode: async () => ({ status: 200, body: {} }),
    signup: async () => ({ status: 200, body: {} }),
    login: async () => ({ status: 200, body: {} }),
    getUserProfile: async () => null,
    verifyToken: async () => ({
      sub: "1",
      email: "tester@example.com",
      iat: 0,
      exp: 0,
      iss: "test-issuer",
      aud: "test-audience",
      type: "access"
    }),
    close: async () => undefined
  };
}

function createAnalysisStoreStub(limit = 10): AnalysisStore {
  return {
    ensureSchema: async () => undefined,
    saveAnalysis: async () => ({
      caseId: "case-test",
      runId: "run-test",
      referenceLibrary: []
    }),
    saveReferenceLibrary: async () => [],
    listHistory: async () => [],
    consumeGuestAnalysis: async (_identity: GuestUsageIdentity): Promise<GuestUsageResult> => ({
      guestId: "guest-sse",
      usageCount: 1,
      limit,
      remaining: limit - 1,
      allowed: true
    }),
    searchReferences: async () => [],
    getReferenceByKindAndId: async () => null
  };
}

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer((req, res) => {
    void handler(req, res)
      .then((handled) => {
        if (handled || res.writableEnded) {
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found." }));
      })
      .catch((error: unknown) => {
        if (res.writableEnded) {
          return;
        }
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Unexpected error."
          })
        );
      });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind analysis SSE contract server.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<HttpJsonResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

async function getJson(url: string): Promise<HttpJsonResponse> {
  const response = await fetch(url);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

async function waitForTerminalResult(resultUrl: string, attempts = 40): Promise<HttpJsonResponse> {
  for (let index = 0; index < attempts; index += 1) {
    const snapshot = await getJson(resultUrl);
    if (snapshot.status === 200 || snapshot.status === 500) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for terminal analysis result.");
}

function parseSsePayload(raw: string): SseEventSnapshot[] {
  return raw
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) {
        throw new Error(`Malformed SSE payload: ${chunk}`);
      }

      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>
      };
    });
}

async function readSse(url: string): Promise<SseEventSnapshot[]> {
  const response = await fetch(url, {
    headers: {
      accept: "text/event-stream"
    }
  });

  assert.equal(response.status, 200, "analysis SSE endpoint should respond with 200");
  assert.match(
    String(response.headers.get("content-type") ?? ""),
    /text\/event-stream/i,
    "analysis SSE endpoint should use text/event-stream"
  );

  const payload = await response.text();
  return parseSsePayload(payload);
}

async function waitForJobState(
  getState: () => string | undefined,
  expectedState: string,
  attempts = 40
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (getState() === expectedState) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for job state: ${expectedState}`);
}

async function verifyReplayAndCompleteShape(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const analysisStore = createAnalysisStoreStub();
  const jobManager = createAnalysisJobManager();
  const handler = createAnalysisHandler(
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    jobManager
  );

  await withServer(handler, async (baseUrl) => {
    const accepted = await postJson(`${baseUrl}/api/analyze`, {
      input_mode: "text",
      context_type: "messenger",
      text: "카카오톡 단톡방에서 허위사실을 퍼뜨렸어요",
      guest_id: "guest-sse"
    });

    assert.equal(accepted.status, 202, "analysis create should accept the request");
    const jobId = String(accepted.body.job_id ?? "");
    const streamUrl = `${baseUrl}${String(accepted.body.stream_url ?? "")}`;
    const resultUrl = `${baseUrl}${String(accepted.body.result_url ?? "")}`;
    assert.ok(jobId, "accepted response should include job_id");
    assert.match(
      streamUrl,
      new RegExp(`/api/analyze/${encodeURIComponent(jobId)}/stream\\?access_token=`),
      "accepted response should include stream_url with an access token"
    );
    assert.match(
      resultUrl,
      new RegExp(`/api/analyze/${encodeURIComponent(jobId)}\\?access_token=`),
      "accepted response should include result_url with an access token"
    );

    const unauthorizedResult = await getJson(`${baseUrl}/api/analyze/${encodeURIComponent(jobId)}`);
    assert.equal(unauthorizedResult.status, 404, "result endpoint should require the analysis access token");

    const completed = await waitForTerminalResult(resultUrl);
    assert.equal(
      completed.status,
      200,
      `analysis result should eventually complete: ${JSON.stringify(completed.body)}`
    );
    assert.equal(completed.body.job_id, jobId, "terminal result should preserve job id");
    assert.equal(completed.body.status, "completed", "terminal result should be completed");

    const events = await readSse(streamUrl);
    assert.ok(events.length >= 2, "completed replay stream should include progress and terminal events");

    const agentDoneEvent = events.find((event) => event.event === "agent_done");
    assert.ok(agentDoneEvent, "replay stream should include at least one agent_done event");
    assert.equal(agentDoneEvent.data.job_id, jobId, "agent_done event should carry job_id");
    assert.equal(agentDoneEvent.data.status, "running", "agent_done event should carry running status");
    assert.equal(
      "retrieval_evidence_pack" in ((agentDoneEvent.data.result as Record<string, unknown> | undefined) ?? {}),
      false,
      "agent_done event should not leak internal retrieval evidence payloads"
    );

    const progressEventKeys = events
      .filter((event) => event.event === "agent_start" || event.event === "agent_done")
      .map((event) => `${event.event}:${String(event.data.agent ?? "")}`);
    assert.equal(
      new Set(progressEventKeys).size,
      progressEventKeys.length,
      `replay stream should not duplicate stage events: ${progressEventKeys.join(", ")}`
    );

    const classifierDoneEvent = events.find(
      (event) => event.event === "agent_done" && event.data.agent === "classifier"
    );
    assert.ok(classifierDoneEvent, "replay stream should include classifier agent_done event");
    assertPublicClassifierExtraction(
      asRecord(classifierDoneEvent?.data.result),
      "classifier agent_done result"
    );

    const completeEvent = events.at(-1);
    assert.ok(completeEvent, "replay stream should include a terminal event");
    assert.equal(completeEvent?.event, "complete", "completed replay stream should end with complete");
    assert.equal(completeEvent?.data.job_id, jobId, "complete event should carry job_id");
    assert.equal(completeEvent?.data.status, "completed", "complete event should carry completed status");

    const result = (completeEvent?.data.result ?? null) as Record<string, unknown> | null;
    assert.ok(result, "complete event should include the final public result");
    assert.equal(result?.job_id, jobId, "complete event result should preserve job id");
    assert.equal(result?.status, "completed", "complete event result should preserve completed status");
    assert.equal(
      "retrieval_evidence_pack" in (result ?? {}),
      false,
      "complete event result should not expose internal retrieval evidence pack"
    );
    assert.ok(result?.classification, "complete event result should include public classification payload");
    assertPublicClassifierExtraction(
      result?.classification,
      "complete event result.classification"
    );
    assert.ok(result?.retrieval_plan, "complete event result should include public retrieval plan payload");
    assert.deepEqual(
      result,
      completed.body,
      "SSE complete payload should match the GET /api/analyze/:job_id public result"
    );
  });
}

async function verifyReplayErrorShape(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const analysisStore = createAnalysisStoreStub();
  const jobManager = createAnalysisJobManager();
  const handler = createAnalysisHandler(
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    jobManager
  );

  const failedJob = jobManager.createJob();
  jobManager.startJob(failedJob.id, async ({ emit }) => {
    emit(
      buildPublicAnalysisEvent({
        type: "agent_start",
        agent: "classifier",
        at: "t-start"
      })
    );
    throw new Error("forced analysis failure");
  });

  await waitForJobState(
    () => jobManager.getJob(failedJob.id)?.status,
    "failed"
  );

  await withServer(handler, async (baseUrl) => {
    const unauthorizedStream = await fetch(`${baseUrl}/api/analyze/${encodeURIComponent(failedJob.id)}/stream`, {
      headers: {
        accept: "text/event-stream"
      }
    });
    assert.equal(unauthorizedStream.status, 404, "SSE endpoint should require the analysis access token");

    const events = await readSse(
      `${baseUrl}/api/analyze/${encodeURIComponent(failedJob.id)}/stream?access_token=${encodeURIComponent(failedJob.accessToken)}`
    );
    assert.ok(events.length >= 1, "failed replay stream should include at least one event");

    const errorEvent = events.at(-1);
    assert.ok(errorEvent, "failed replay stream should include a terminal event");
    assert.equal(errorEvent?.event, "error", "failed replay stream should end with error");
    assert.equal(errorEvent?.data.job_id, failedJob.id, "error event should carry job_id");
    assert.equal(errorEvent?.data.status, "failed", "error event should carry failed status");
    assert.equal(errorEvent?.data.message, "forced analysis failure", "error event should preserve the public failure message");
    assert.equal(errorEvent?.data.error, "forced analysis failure", "error event should normalize error field");
  });
}

async function main(): Promise<void> {
  await verifyReplayAndCompleteShape();
  await verifyReplayErrorShape();
  process.stdout.write("Analysis SSE contract checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
