import assert from "node:assert/strict";
import http from "node:http";

import { runLegalAnalysisAgent } from "../apps/api/src/agents/legal-analysis-agent.mjs";
import { runOcrAgent } from "../apps/api/src/agents/ocr-agent.mjs";
import type { AnalysisConfig } from "../apps/api/src/analysis/config.js";
import {
  buildPublicAnalysisStreamEvent
} from "../apps/api/src/analysis/http-envelope.js";
import { createAnalysisHandler } from "../apps/api/src/analysis/http.js";
import { persistAnalysisRun } from "../apps/api/src/analysis/http-persistence.js";
import { createAnalysisJobManager } from "../apps/api/src/analysis/jobs.js";
import {
  buildPublicAgentResult,
  buildPublicAnalysisResult,
  buildStoredAnalysisResult,
  buildStoredRuntimeArtifacts
} from "../apps/api/src/analysis/privacy.js";
import { applyPreOutputSafetyGate } from "../apps/api/src/analysis/safety-gate.mjs";
import { buildPreAnalysisVerifier } from "../apps/api/src/analysis/verifier.mjs";
import { createAnalysisStore, type AnalysisStore, type GuestUsageIdentity, type GuestUsageResult } from "../apps/api/src/analysis/store.js";
import type { AuthConfig } from "../apps/api/src/auth/config.js";
import type { PostgresClient } from "../apps/api/src/auth/postgres.js";
import type { AuthService } from "../apps/api/src/auth/service.js";
import { createKeywordVerificationHandler } from "../apps/api/src/retrieval/http.js";
import type { KeywordVerificationService } from "../apps/api/src/retrieval/service.js";
import { runAnalysis } from "../apps/api/src/orchestrator/run-analysis.mjs";

type ResponseSnapshot = {
  status: number;
  body: Record<string, unknown>;
};

interface QuotaTrackingStore extends AnalysisStore {
  seenIps: string[];
}

function createTestAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
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
    requestIdPrefix: "test",
    ...overrides
  };
}

function createTestAnalysisConfig(overrides: Partial<AnalysisConfig> = {}): AnalysisConfig {
  return {
    providerMode: "mock",
    requestBodyLimit: 1_000_000,
    crawlTimeoutMs: 1_000,
    crawlMaxBytes: 100_000,
    crawlFollowRedirects: 0,
    ...overrides
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

function createQuotaTrackingStore(limit = 2): QuotaTrackingStore {
  const counts = new Map<string, number>();
  const seenIps: string[] = [];

  async function consumeGuestAnalysis(identity: GuestUsageIdentity): Promise<GuestUsageResult> {
    seenIps.push(identity.ipAddress);
    const usageCount = (counts.get(identity.ipAddress) ?? 0) + 1;
    counts.set(identity.ipAddress, usageCount);

    return {
      guestId: String(identity.guestId ?? "").trim() || null,
      usageCount,
      limit,
      remaining: Math.max(limit - usageCount, 0),
      allowed: usageCount <= limit
    };
  }

  return {
    seenIps,
    ensureSchema: async () => undefined,
    saveAnalysis: async () => ({
      caseId: "case-test",
      runId: "run-test",
      referenceLibrary: []
    }),
    saveReferenceLibrary: async () => [],
    listHistory: async () => [],
    consumeGuestAnalysis,
    searchReferences: async () => [],
    getReferenceByKindAndId: async () => null
  };
}

function createMockKeywordService(): KeywordVerificationService {
  return {
    verifyKeyword: async () => ({
      run_id: "keyword-test-run",
      query: {
        original: "insult",
        normalized: "insult",
        context_type: "community"
      },
      plan: {
        tokens: [],
        candidate_issues: [
          {
            type: "모욕",
            severity: "low",
            reason: "test"
          }
        ],
        broad_law_queries: [],
        precise_law_queries: [],
        broad_precedent_queries: [],
        precise_precedent_queries: [],
        law_queries: [],
        precedent_queries: [],
        warnings: [],
        supported_issues: ["모욕"],
        unsupported_issues: [],
        scope_warnings: [],
        scope_flags: {
          proceduralHeavy: false,
          insufficientFacts: false,
          unsupportedIssuePresent: false
        }
      },
      verification: {
        headline: "ok",
        interpretation: "ok",
        warnings: [],
        disclaimer: "test disclaimer"
      },
      retrieval_evidence_pack: {
        version: "v2",
        query: {
          original: "insult",
          normalized: "insult",
          context_type: "community"
        },
        plan: {
          tokens: [],
          candidate_issues: [
            {
              type: "모욕",
              severity: "low",
              reason: "test"
            }
          ],
          broad_law_queries: [],
          precise_law_queries: [],
          broad_precedent_queries: [],
          precise_precedent_queries: [],
          law_queries: [],
          precedent_queries: [],
          warnings: [],
          supported_issues: ["모욕"],
          unsupported_issues: [],
          scope_warnings: [],
          scope_flags: {
            proceduralHeavy: false,
            insufficientFacts: false,
            unsupportedIssuePresent: false
          }
        },
        retrieval_preview: {
          law: null,
          precedent: null
        },
        retrieval_trace: [],
        matched_laws: [],
        matched_precedents: [],
        selected_reference_ids: ["law:test"],
        top_issue_types: ["모욕"],
        evidence_strength: "medium"
      },
      matched_laws: [],
      matched_precedents: [],
      legal_analysis: {
        can_sue: false,
        risk_level: 1,
        summary: "ok",
        scope_assessment: {
          supported_issues: ["모욕"],
          unsupported_issues: [],
          procedural_heavy: false,
          insufficient_facts: false,
          unsupported_issue_present: false,
          warnings: []
        },
        verifier: {
          stage: "pre_analysis_verifier",
          status: "passed",
          evidence_sufficient: true,
          citation_integrity: true,
          contradiction_detected: false,
          selected_reference_count: 1,
          issue_count: 1,
          confidence_calibration: {
            score: 0.62,
            label: "medium"
          },
          warnings: []
        },
        safety_gate: {
          stage: "pre_output_safety_gate",
          status: "passed",
          adjusted_output: false,
          blocked_reasons: [],
          warnings: []
        },
        grounding_evidence: {
          top_issue: "모욕",
          evidence_strength: "medium"
        },
        selected_reference_ids: ["law:test"],
        charges: [],
        recommended_actions: [],
        evidence_to_collect: [],
        precedent_cards: [],
        disclaimer: "test disclaimer"
      }
    })
  };
}

async function withServer(
  createHandler: () => (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const handler = createHandler();
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
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : "Unexpected error."
        }));
      });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server.");
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

async function getJson(url: string, headers: Record<string, string> = {}): Promise<ResponseSnapshot> {
  const response = await fetch(url, {
    method: "GET",
    headers
  });

  const payload = await response.json() as Record<string, unknown>;
  return {
    status: response.status,
    body: payload
  };
}

async function postJson(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ResponseSnapshot> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json() as Record<string, unknown>;
  return {
    status: response.status,
    body: payload
  };
}

async function verifyAnalysisGuestQuotaIgnoresForgedForwardedFor(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore(2);

  await withServer(
    () => createAnalysisHandler(authService, authConfig, analysisConfig, store, createAnalysisJobManager()),
    async (baseUrl) => {
      const first = await postJson(
        `${baseUrl}/api/analyze`,
        {
          input_mode: "text",
          context_type: "community",
          text: "first analysis request",
          guest_id: "guest-analysis"
        },
        { "x-forwarded-for": "198.51.100.10" }
      );
      assert.equal(first.status, 202, "first analysis request should be accepted");
      assert.equal(first.body.guest_remaining, 1, "accepted request should decrement remaining quota");

      const second = await postJson(
        `${baseUrl}/api/analyze`,
        {
          input_mode: "text",
          context_type: "community",
          text: "second analysis request",
          guest_id: "guest-analysis"
        },
        { "x-forwarded-for": "198.51.100.11" }
      );
      assert.equal(second.status, 202, "forged forwarded IP should not reset the analysis quota");
      assert.equal(second.body.guest_remaining, 0, "second accepted request should exhaust the quota");

      const third = await postJson(
        `${baseUrl}/api/analyze`,
        {
          input_mode: "text",
          context_type: "community",
          text: "third analysis request",
          guest_id: "guest-analysis"
        },
        { "x-forwarded-for": "198.51.100.12" }
      );
      assert.equal(third.status, 429, "third request should hit the HTTP guest quota");
    }
  );

  assert.deepEqual(
    store.seenIps,
    ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
    "analysis quota should use the socket IP when no trusted proxy is configured"
  );
}

async function verifyKeywordGuestQuotaIgnoresForgedForwardedFor(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore(2);
  const keywordService = createMockKeywordService();

  await withServer(
    () => createKeywordVerificationHandler(authService, authConfig, analysisConfig, store, keywordService),
    async (baseUrl) => {
      const first = await postJson(
        `${baseUrl}/api/keywords/verify`,
        {
          query: "insult",
          context_type: "community",
          guest_id: "guest-keyword"
        },
        { "x-forwarded-for": "203.0.113.20" }
      );
      assert.equal(first.status, 200, "first keyword request should be accepted");
      assert.equal(first.body.guest_remaining, 1, "accepted keyword request should decrement remaining quota");

      const second = await postJson(
        `${baseUrl}/api/keywords/verify`,
        {
          query: "insult",
          context_type: "community",
          guest_id: "guest-keyword"
        },
        { "x-forwarded-for": "203.0.113.21" }
      );
      assert.equal(second.status, 200, "forged forwarded IP should not reset the keyword quota");
      assert.equal(second.body.guest_remaining, 0, "second keyword request should exhaust the quota");

      const third = await postJson(
        `${baseUrl}/api/keywords/verify`,
        {
          query: "insult",
          context_type: "community",
          guest_id: "guest-keyword"
        },
        { "x-forwarded-for": "203.0.113.22" }
      );
      assert.equal(third.status, 429, "third keyword request should hit the HTTP guest quota");
    }
  );

  assert.deepEqual(
    store.seenIps,
    ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
    "keyword quota should use the socket IP when no trusted proxy is configured"
  );
}

async function verifyTrustedProxyCanForwardClientIp(): Promise<void> {
  const authConfig = createTestAuthConfig({
    trustedProxyAddresses: ["127.0.0.1"]
  });
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore(2);
  const keywordService = createMockKeywordService();

  await withServer(
    () => createKeywordVerificationHandler(authService, authConfig, analysisConfig, store, keywordService),
    async (baseUrl) => {
      const response = await postJson(
        `${baseUrl}/api/keywords/verify`,
        {
          query: "insult",
          context_type: "community",
          guest_id: "guest-trusted"
        },
        { "x-forwarded-for": "198.51.100.77" }
      );
      assert.equal(response.status, 200, "trusted proxy requests should still succeed");
    }
  );

  assert.deepEqual(
    store.seenIps,
    ["198.51.100.77"],
    "trusted proxy configuration should opt in to forwarded client IPs"
  );
}

async function verifyInvalidAnalysisDoesNotConsumeGuestQuota(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore(2);

  await withServer(
    () => createAnalysisHandler(authService, authConfig, analysisConfig, store, createAnalysisJobManager()),
    async (baseUrl) => {
      const invalid = await postJson(
        `${baseUrl}/api/analyze`,
        {
          input_mode: "text",
          context_type: "community",
          guest_id: "guest-invalid"
        },
        { "x-forwarded-for": "198.51.100.30" }
      );
      assert.equal(invalid.status, 422, "invalid analysis request should fail validation");

      const valid = await postJson(
        `${baseUrl}/api/analyze`,
        {
          input_mode: "text",
          context_type: "community",
          text: "valid analysis request after invalid input",
          guest_id: "guest-invalid"
        },
        { "x-forwarded-for": "198.51.100.31" }
      );
      assert.equal(valid.status, 202, "valid analysis request should still be accepted");
      assert.equal(valid.body.guest_remaining, 1, "invalid input should not consume the guest quota");
    }
  );

  assert.deepEqual(
    store.seenIps,
    ["127.0.0.1"],
    "analysis quota should be consumed only after request validation succeeds"
  );
}

async function verifyRetrievalToolGuestQuotaIgnoresForgedForwardedFor(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore(2);
  const keywordService = createMockKeywordService();

  await withServer(
    () => createKeywordVerificationHandler(authService, authConfig, analysisConfig, store, keywordService),
    async (baseUrl) => {
      const invalid = await postJson(
        `${baseUrl}/api/tools/search_law_tool`,
        {
          context_type: "community",
          guest_id: "guest-tool"
        },
        { "x-forwarded-for": "203.0.113.30" }
      );
      assert.equal(invalid.status, 422, "missing tool query should fail before quota consumption");

      const first = await postJson(
        `${baseUrl}/api/tools/search_law_tool`,
        {
          query: "명예훼손 허위사실",
          context_type: "community",
          guest_id: "guest-tool"
        },
        { "x-forwarded-for": "203.0.113.31" }
      );
      assert.equal(first.status, 200, "first law tool request should be accepted");

      const second = await postJson(
        `${baseUrl}/api/tools/search_precedent_tool`,
        {
          query: "명예훼손 단체대화방",
          context_type: "community",
          guest_id: "guest-tool"
        },
        { "x-forwarded-for": "203.0.113.32" }
      );
      assert.equal(second.status, 200, "forged forwarded IP should not reset the tool quota");

      const third = await postJson(
        `${baseUrl}/api/tools/search_law_tool`,
        {
          query: "모욕",
          context_type: "community",
          guest_id: "guest-tool"
        },
        { "x-forwarded-for": "203.0.113.33" }
      );
      assert.equal(third.status, 429, "third retrieval tool request should hit the guest quota");
    }
  );

  assert.deepEqual(
    store.seenIps,
    ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
    "retrieval tool quota should use the socket IP when no trusted proxy is configured"
  );
}

function verifyVerifierAndSafetyGateContracts(): void {
  const verifier = buildPreAnalysisVerifier({
    classificationResult: {
      supported_issues: []
    },
    retrievalPlan: {
      candidateIssues: [{ type: "스토킹" }]
    },
    retrievalEvidencePack: {
      selected_reference_ids: [],
      evidence_strength: "low",
      citation_map: {
        citations: [
          {
            reference_id: "law:test"
          }
        ]
      }
    },
    scopeAssessment: {
      unsupported_issue_present: true,
      insufficient_facts: true,
      procedural_heavy: false
    },
    evidencePack: {
      evidence_strength: "low"
    }
  });

  assert.deepEqual(
    verifier,
    {
      stage: "pre_analysis_verifier",
      status: "needs_caution",
      evidence_sufficient: false,
      citation_integrity: false,
      contradiction_detected: true,
      confidence_calibration: {
        score: 0.1,
        label: "low"
      },
      claim_support: {
        overall: "missing",
        direct_count: 0,
        partial_count: 0,
        missing_count: 0,
        entries: []
      },
      selected_reference_count: 0,
      issue_count: 1,
      warnings: [
        "현재 근거만으로는 강한 결론을 내리기 어렵습니다.",
        "근거 인용 연결이 완전하지 않아 출력 표현을 보수적으로 유지해야 합니다.",
        "지원 범위 밖 이슈와 내부 쟁점 가설 사이에 충돌 가능성이 있습니다."
      ]
    },
    "pre-analysis verifier should flag low-evidence, broken-citation contradictions conservatively"
  );

  const gated = applyPreOutputSafetyGate(
    {
      can_sue: true,
      risk_level: 4,
      summary: "단정적 표현이 남아 있습니다.",
      recommended_actions: ["증거를 정리하세요."]
    },
    {
      verifier,
      scopeAssessment: {
        unsupported_issue_present: true,
        insufficient_facts: true,
        procedural_heavy: false
      }
    }
  );

  assert.equal(gated.legalAnalysis.can_sue, false, "safety gate should downgrade can_sue when verifier needs caution");
  assert.match(
    String(gated.legalAnalysis.summary),
    /^현재 확보된 근거 기준 참고용 판단입니다\./,
    "safety gate should prefix cautious wording when confidence is low"
  );
  assert.ok(
    gated.legalAnalysis.recommended_actions.some((item: unknown) => String(item).includes("변호사 상담")),
    "safety gate should add lawyer-consult guidance for high-risk outputs"
  );
  assert.deepEqual(
    gated.safetyGate,
    {
      stage: "pre_output_safety_gate",
      status: "adjusted",
      adjusted_output: true,
      blocked_reasons: ["unsupported_issue_present", "insufficient_grounding", "citation_integrity"],
      warnings: [
        "지원 범위 밖 이슈가 포함될 수 있어 단정적 해석을 피했습니다.",
        "사실관계 또는 근거가 부족해 참고 수준 표현으로 제한했습니다.",
        "인용 연결이 완전하지 않아 요약 표현을 보수적으로 유지했습니다.",
        "고위험 상황 상담 권고를 보강했습니다."
      ]
    },
    "safety gate should surface stable adjusted-output metadata"
  );
}

async function verifyAnalysisCitationMapMatchesFinalCharges(): Promise<void> {
  const result = await runAnalysis(
    {
      request_id: "citation-map-mixed",
      input_type: "text",
      context_type: "community",
      text: "카카오톡 단톡방 게시판에 제 실명과 전화번호를 공개하고 제가 회사 돈을 떼먹은 사기꾼이라고 허위사실을 퍼뜨렸습니다."
    },
    { providerMode: "mock" }
  );
  const charges = result.legal_analysis.charges as Array<Record<string, any>>;
  const citations = result.retrieval_evidence_pack.citation_map.citations as Array<Record<string, any>>;

  assert.equal(
    charges.some((charge) => charge.issue_type === "사기"),
    false,
    "false accusation text should not create an actual fraud charge"
  );

  for (const [index, charge] of charges.entries()) {
    const citationId = charge.grounding?.citation_id;
    if (!citationId) {
      continue;
    }
    const citation = citations.find((candidate) => candidate.citation_id === citationId);
    assert.ok(citation, `charge citation ${citationId} should exist in the citation map`);
    assert.equal(citation.statement_path, `legal_analysis.charges[${index}]`);
    assert.equal(citation.reference_id, charge.grounding.law_reference_id);
  }

  for (const citation of citations.filter((candidate) =>
    String(candidate.statement_path).startsWith("legal_analysis.charges[")
  )) {
    const match = /charges\[(\d+)\]/.exec(String(citation.statement_path));
    assert.ok(match, "charge citation path should include a concrete charge index");
    const charge = charges[Number(match[1])];
    assert.ok(charge, "charge citation path should point to an existing final charge");
    assert.equal(citation.reference_id, charge.grounding?.law_reference_id);
  }
}

async function verifyReferenceEndpointsRequireAuthentication(): Promise<void> {
  const authConfig = createTestAuthConfig();
  const analysisConfig = createTestAnalysisConfig();
  const authService = createMockAuthService();
  const store = createQuotaTrackingStore();
  store.searchReferences = async () => [{
    id: "law:test",
    kind: "law",
    sourceKey: "law:test",
    sourceMode: "mock",
    title: "형법 제307조",
    subtitle: "명예훼손",
    summary: "요약",
    details: "상세",
    url: "https://example.com/law",
    articleNo: "307",
    caseNo: null,
    court: null,
    verdict: null,
    penalty: "2년 이하",
    similarityScore: null,
    keywords: [],
    payload: {}
  }];
  store.getReferenceByKindAndId = async () => ({
    id: "law:test",
    kind: "law",
    sourceKey: "law:test",
    sourceMode: "mock",
    title: "형법 제307조",
    subtitle: "명예훼손",
    summary: "요약",
    details: "상세",
    url: "https://example.com/law",
    articleNo: "307",
    caseNo: null,
    court: null,
    verdict: null,
    penalty: "2년 이하",
    similarityScore: null,
    keywords: [],
    payload: {}
  });

  await withServer(
    () => createAnalysisHandler(authService, authConfig, analysisConfig, store, createAnalysisJobManager()),
    async (baseUrl) => {
      const unauthenticatedSearch = await getJson(`${baseUrl}/api/references/search?q=%EB%AA%85%EC%98%88%ED%9B%BC%EC%86%90`);
      assert.equal(unauthenticatedSearch.status, 401, "reference search should reject unauthenticated requests");

      const unauthenticatedDetail = await getJson(`${baseUrl}/api/references/law/law%3Atest`);
      assert.equal(unauthenticatedDetail.status, 401, "reference detail should reject unauthenticated requests");

      const authenticatedSearch = await getJson(
        `${baseUrl}/api/references/search?q=%EB%AA%85%EC%98%88%ED%9B%BC%EC%86%90`,
        { authorization: "Bearer test-token" }
      );
      assert.equal(authenticatedSearch.status, 200, "reference search should allow authenticated requests");

      const authenticatedDetail = await getJson(
        `${baseUrl}/api/references/law/law%3Atest`,
        { authorization: "Bearer test-token" }
      );
      assert.equal(authenticatedDetail.status, 200, "reference detail should allow authenticated requests");
    }
  );
}

async function verifySaveAnalysisUsesTransactionBoundary(): Promise<void> {
  const events: string[] = [];
  let committedCaseInserted = false;
  let committedRunInserted = false;

  const db: PostgresClient = {
    async query() {
      throw new Error("top-level query should not be used for saveAnalysis");
    },
    async withTransaction(fn) {
      events.push("BEGIN");
      let caseInserted = false;
      let runInserted = false;
      const client: PostgresClient = {
        async query(text: string) {
          if (text.includes("INSERT INTO analysis_cases")) {
            caseInserted = true;
            return { rows: [{ id: "case-1" }], rowCount: 1 };
          }
          if (text.includes("INSERT INTO analysis_runs")) {
            runInserted = true;
            return { rows: [{ id: "run-1" }], rowCount: 1 };
          }
          if (text.includes("INSERT INTO reference_library")) {
            throw new Error("reference write failed");
          }
          throw new Error(`Unexpected query: ${text}`);
        },
        async withTransaction(innerFn) {
          return innerFn(client);
        },
        async close() {
          return undefined;
        }
      };

      try {
        const result = await fn(client);
        events.push("COMMIT");
        committedCaseInserted = caseInserted;
        committedRunInserted = runInserted;
        return result;
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    },
    async close() {
      return undefined;
    }
  };

  const store = createAnalysisStore(db);
  await assert.rejects(
    () => store.saveAnalysis({
      userId: 1,
      inputMode: "text",
      contextType: "community",
      title: "test",
      sourceKind: "manual",
      contentText: "",
      providerMode: "mock",
      result: {
        legal_analysis: {},
        law_search: {
          laws: [{
            law_name: "형법",
            article_no: "제307조",
            article_title: "명예훼손",
            content: "공연히 사실을 적시하여 명예를 훼손한 자",
            penalty: "2년 이하 징역"
          }]
        }
      },
      timeline: []
    }),
    /reference write failed/
  );

  assert.deepEqual(events, ["BEGIN", "ROLLBACK"], "saveAnalysis should rollback the whole transaction on reference persistence failure");
  assert.equal(committedCaseInserted, false, "failed transaction must not commit inserted case rows");
  assert.equal(committedRunInserted, false, "failed transaction must not commit inserted run rows");
}

function verifyHighRiskEscalationPolicy(): void {
  const gated = applyPreOutputSafetyGate(
    {
      can_sue: true,
      risk_level: 5,
      summary: "스토킹과 협박 정황이 보입니다.",
      recommended_actions: ["기본 정리만 하세요."],
      evidence_to_collect: ["원본 대화 캡처"],
      high_risk_escalation: {
        triggered: true,
        emergency: true,
        triggers: ["stalking_escalation", "evidence_deletion_risk", "minor_involved"],
        warnings: [
          "반복 접근 또는 스토킹 위험이 보여 빠른 신고 검토가 필요합니다.",
          "증거 삭제 위험이 보여 보존 조치가 시급합니다."
        ],
        immediate_actions: [
          "접근, 미행, 주거지 주변 대기가 이어지면 차단만 하지 말고 시간순 기록과 함께 112 신고 여부를 바로 검토하세요.",
          "삭제 전 화면 녹화, 전체 캡처, URL, 계정 식별정보, 시간표시를 먼저 확보하세요."
        ],
        evidence_actions: [
          "삭제 또는 회수 전후가 드러나는 전체 대화 캡처와 화면 녹화"
        ]
      }
    },
    {
      verifier: {
        stage: "pre_analysis_verifier",
        status: "warning",
        evidence_sufficient: true,
        citation_integrity: true,
        contradiction_detected: false,
        confidence_calibration: { score: 0.82, label: "high" },
        selected_reference_count: 2,
        issue_count: 1,
        warnings: []
      },
      scopeAssessment: {
        unsupported_issue_present: false,
        insufficient_facts: false,
        procedural_heavy: false
      }
    }
  );

  assert.match(String(gated.legalAnalysis.summary), /^긴급성 있는 고위험 신호가 있어 일반 참고보다 안전 확보와 증거 보존을 우선해야 합니다\./);
  assert.ok(gated.legalAnalysis.recommended_actions.some((item: unknown) => String(item).includes("112")), "high-risk gate should force 112 guidance for emergency cases");
  assert.ok(gated.legalAnalysis.evidence_to_collect.some((item: unknown) => String(item).includes("화면 녹화")), "high-risk gate should add preservation-heavy evidence guidance");
  assert.ok(gated.safetyGate.blocked_reasons.includes("stalking_escalation"), "high-risk triggers should become stable block reasons");
  assert.equal((gated.safetyGate as Record<string, unknown>).adjusted_output, true, "high-risk triggers should always adjust output");
}

async function main() {
  const ocr = await runOcrAgent({
    input_type: "text",
    context_type: "messenger",
    text: "\uD64D\uAE38\uB3D9: 010-1234-5678 \uC11C\uC6B8\uC2DC \uAC15\uB0A8\uAD6C \uD14C\uD5E4\uB780\uB85C 123"
  });

  assert.equal(ocr.utterances[0]?.speaker, "A", "speaker labels should be pseudonymized");
  assert.ok(!String(ocr.raw_text).includes("010-1234-5678"), "raw phone numbers must not leak");
  assert.ok(!String(ocr.raw_text).includes("\uD64D\uAE38\uB3D9"), "raw speaker names must not leak");
  assert.ok(
    !String(ocr.raw_text).includes("\uC11C\uC6B8\uC2DC \uAC15\uB0A8\uAD6C \uD14C\uD5E4\uB780\uB85C 123"),
    "raw addresses must not leak"
  );

  const stored = buildStoredAnalysisResult({
    meta: {
      provider_mode: "mock",
      generated_at: "2026-04-14T00:00:00.000Z",
      input_type: "text",
      context_type: "community",
      retrieval_preview: { law: { headline: "should not persist" } }
    },
    legal_analysis: {
      summary: "analysis summary"
    },
    ocr: {
      raw_text: "should not persist"
    }
  });

  assert.deepEqual(
    Object.keys(stored).sort(),
    ["legal_analysis", "meta"],
    "stored analysis payload should keep only minimal safe fields"
  );
  assert.deepEqual(
    stored.legal_analysis?.verifier,
    {
      stage: "",
      status: "",
      evidence_sufficient: false,
      citation_integrity: false,
      contradiction_detected: false,
      selected_reference_count: 0,
      issue_count: 0,
      confidence_calibration: {
        score: 0,
        label: ""
      },
      claim_support: {
        overall: "",
        direct_count: 0,
        partial_count: 0,
        missing_count: 0,
        entries: []
      },
      warnings: []
    },
    "stored analysis payload should retain a stable verifier contract even when absent"
  );
  assert.deepEqual(
    stored.legal_analysis?.safety_gate,
    {
      stage: "",
      status: "",
      adjusted_output: false,
      blocked_reasons: [],
      warnings: []
    },
    "stored analysis payload should retain a stable safety gate contract even when absent"
  );
  assert.equal("ocr" in stored, false, "stored analysis payload must exclude raw OCR content");
  assert.deepEqual(
    stored.legal_analysis?.grounding_evidence,
    {
      top_issue: "",
      evidence_strength: ""
    },
    "stored analysis payload should keep only coarse grounding evidence summary"
  );
  assert.equal(
    "citation_map" in (stored.legal_analysis ?? {}),
    false,
    "stored analysis payload must not persist citation path indexes"
  );

  const publicResult = buildPublicAnalysisResult(
    "job-test",
    {
      ocr: {
        source_type: "messenger",
        utterances: [{ speaker: "A", text: "hello" }],
        raw_text: "should not be public"
      },
      classification: {
        issues: [{ type: "명예훼손" }],
        issue_hypotheses: [{ type: "명예훼손", confidence: 0.88 }],
        facts: {
          public_exposure: true,
          false_fact_signal: true
        },
        scope_flags: {
          proceduralHeavy: false,
          insufficientFacts: false,
          unsupportedIssuePresent: false
        },
        supported_issues: ["명예훼손"],
        unsupported_issues: [],
        scope_warnings: [],
        searchable_text: "should not be public",
        is_criminal: true,
        is_civil: true
      },
      retrieval_plan: {
        candidateIssues: [{ type: "명예훼손", severity: "high", reason: "test" }],
        warnings: [],
        supportedIssues: ["명예훼손"],
        unsupportedIssues: [],
        scopeWarnings: [],
        scopeFlags: {
          proceduralHeavy: false,
          insufficientFacts: false,
          unsupportedIssuePresent: false
        },
        broadLawQueries: ["명예훼손"],
        preciseLawQueries: ["명예훼손 허위사실 공연성"],
        broadPrecedentQueries: ["명예훼손"],
        precisePrecedentQueries: ["단톡 명예훼손"]
      },
      law_search: {
        laws: [{ law_name: "형법", article_no: "307", article_title: "명예훼손" }],
        retrieval_preview: { headline: "law preview", top_issues: ["명예훼손"] },
        retrieval_trace: [{ stage: "law" }]
      },
      precedent_search: {
        precedents: [{ case_no: "2024도1", court: "대법원", verdict: "유죄" }],
        retrieval_preview: { headline: "precedent preview", top_issues: ["명예훼손"] },
        retrieval_trace: [{ stage: "precedent" }]
      },
      meta: {
        provider_mode: "mock",
        generated_at: "2026-04-14T00:00:00.000Z",
        input_type: "text",
        context_type: "community",
        retrieval_preview: { law: { headline: "should not be public" } },
        retrieval_trace: [{ stage: "law" }]
      },
      retrieval_evidence_pack: {
        version: "v2"
      },
      legal_analysis: {
        summary: "public summary",
        verifier: {
          stage: "pre_analysis_verifier",
          status: "warning",
          evidence_sufficient: true,
          citation_integrity: true,
          contradiction_detected: false,
          selected_reference_count: 2,
          issue_count: 1,
          confidence_calibration: {
            score: 0.62,
            label: "medium"
          },
          claim_support: {
            overall: "partial",
            direct_count: 0,
            partial_count: 1,
            missing_count: 0,
            entries: [
              {
                claim_type: "summary",
                claim_path: "legal_analysis.summary",
                title: "public summary",
                support_level: "partial",
                citation_ids: [],
                reference_ids: ["law:test", "precedent:test"],
                evidence_count: 2,
                precedent_count: 1,
                has_snippet: true,
                match_reason: "요건이 직접 맞닿아 있습니다."
              }
            ]
          },
          warnings: ["careful"]
        },
        safety_gate: {
          stage: "pre_output_safety_gate",
          status: "passed",
          adjusted_output: false,
          blocked_reasons: [],
          warnings: []
        },
        summary_grounding: {
          law_reference_id: "law:test",
          reference_key: "law:test",
          citation_id: "law-citation:test",
          precedent_reference_ids: ["precedent:test"],
          precedent_citation_ids: ["precedent-citation:test"],
          evidence_count: 2,
          query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law" }],
          match_reason: "요건이 직접 맞닿아 있습니다.",
          snippet: { field: "content", text: "should not be public" }
        },
        issue_cards: [
          {
            title: "명예훼손",
            grounding: {
              law_reference_id: "law:test",
              reference_key: "law:test",
              citation_id: "law-citation:test",
              precedent_reference_ids: ["precedent:test"],
              precedent_citation_ids: ["precedent-citation:test"],
              evidence_count: 2,
              query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law" }],
              match_reason: "요건이 직접 맞닿아 있습니다.",
              snippet: { field: "content", text: "should not be public" }
            }
          }
        ],
        grounding_evidence: {
          top_issue: "명예훼손",
          evidence_strength: "high",
          laws: [
            {
              reference_key: "law:test",
              snippet: "should not be public"
            }
          ],
          precedents: [
            {
              reference_key: "precedent:test",
              snippet: "should not be public"
            }
          ]
        },
        selected_reference_ids: ["law:test"],
        citation_map: {
          version: "v2",
          citations: [
            {
              citation_id: "law-citation:test",
              reference_id: "law:test",
              reference_key: "law:test",
              kind: "law",
              statement_type: "summary",
              statement_path: "legal_analysis.summary",
              title: "형법 제307조",
              confidence_score: 0.94,
              match_reason: "요건이 직접 맞닿아 있습니다.",
              matched_issue_types: ["명예훼손"],
              query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law" }],
              query_source_tags: ["keyword"],
              snippet: { field: "content", text: "공연히 사실을 적시하여 명예를 훼손한 경우" }
            },
            {
              citation_id: "law-citation:issue-1",
              reference_id: "law:test",
              reference_key: "law:test",
              kind: "law",
              statement_type: "issue_card",
              statement_path: "legal_analysis.issue_cards[0]",
              title: "형법 제307조",
              confidence_score: 0.91,
              match_reason: "카드 체크리스트를 직접 뒷받침합니다.",
              matched_issue_types: ["명예훼손"],
              query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law" }],
              query_source_tags: ["keyword"],
              snippet: { field: "content", text: "공연히 사실을 적시하여 명예를 훼손한 경우" }
            }
          ],
          by_reference_id: {
            "law:test": ["law-citation:test", "law-citation:issue-1"]
          },
          by_statement_path: {
            "legal_analysis.summary": ["law-citation:test"],
            "legal_analysis.issue_cards[0]": ["law-citation:issue-1"]
          }
        }
      }
    },
    []
  );

  assert.equal(
    "retrieval_evidence_pack" in publicResult,
    false,
    "public analysis response must not expose internal retrieval evidence pack"
  );
  assert.equal(
    "retrieval_preview" in publicResult.meta,
    false,
    "public analysis meta must not expose retrieval preview"
  );
  assert.equal(
    "retrieval_trace" in publicResult.meta,
    false,
    "public analysis meta must not expose retrieval trace"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.verifier,
    {
      stage: "pre_analysis_verifier",
      status: "warning",
      evidence_sufficient: true,
      citation_integrity: true,
      contradiction_detected: false,
      selected_reference_count: 2,
      issue_count: 1,
      confidence_calibration: {
        score: 0.62,
        label: "medium"
      },
      claim_support: {
        overall: "partial",
        direct_count: 0,
        partial_count: 1,
        missing_count: 0,
        entries: [
          {
            claim_type: "summary",
            claim_path: "legal_analysis.summary",
            title: "public summary",
            support_level: "partial",
            citation_ids: [],
            reference_ids: ["law:test", "precedent:test"],
            evidence_count: 2,
            precedent_count: 1,
            has_snippet: true,
            match_reason: "요건이 직접 맞닿아 있습니다."
          }
        ]
      },
      warnings: ["careful"]
    },
    "public analysis response should expose sanitized verifier metadata"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.safety_gate,
    {
      stage: "pre_output_safety_gate",
      status: "passed",
      adjusted_output: false,
      blocked_reasons: [],
      warnings: []
    },
    "public analysis response should expose sanitized safety gate metadata"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.grounding_evidence,
    {
      top_issue: "명예훼손",
      evidence_strength: "high"
    },
    "public analysis response should expose only coarse grounding evidence summary"
  );
  assert.equal(
    publicResult.legal_analysis?.verifier?.stage,
    "pre_analysis_verifier",
    "public analysis response should expose verifier status"
  );
  assert.equal(
    publicResult.legal_analysis?.safety_gate?.stage,
    "pre_output_safety_gate",
    "public analysis response should expose safety gate status"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.summary_grounding,
    {
      law_reference_id: "law:test",
      reference_key: "law:test",
      citation_id: "law-citation:test",
      precedent_reference_ids: ["precedent:test"],
      precedent_citation_ids: ["precedent-citation:test"],
      evidence_count: 2,
      query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law", sources: [], issue_types: [], legal_element_signals: [] }],
      match_reason: "요건이 직접 맞닿아 있습니다.",
      snippet: { field: "content", text: "should not be public" }
    },
    "public analysis response should expose sanitized summary grounding"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.issue_cards?.[0]?.grounding,
    {
      law_reference_id: "law:test",
      reference_key: "law:test",
      citation_id: "law-citation:test",
      precedent_reference_ids: ["precedent:test"],
      precedent_citation_ids: ["precedent-citation:test"],
      evidence_count: 2,
      query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law", sources: [], issue_types: [], legal_element_signals: [] }],
      match_reason: "요건이 직접 맞닿아 있습니다.",
      snippet: { field: "content", text: "should not be public" }
    },
    "public analysis response should expose sanitized issue card grounding"
  );
  assert.deepEqual(
    publicResult.legal_analysis?.citation_map,
    {
      version: "v2",
      citations: [
        {
          citation_id: "law-citation:test",
          reference_id: "law:test",
          reference_key: "law:test",
          kind: "law",
          statement_type: "summary",
          statement_path: "legal_analysis.summary",
          title: "형법 제307조",
          confidence_score: 0.94,
          match_reason: "요건이 직접 맞닿아 있습니다.",
          matched_issue_types: ["명예훼손"],
          query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law", sources: [], issue_types: [], legal_element_signals: [] }],
          query_source_tags: ["keyword"],
          snippet: { field: "content", text: "공연히 사실을 적시하여 명예를 훼손한 경우" }
        },
        {
          citation_id: "law-citation:issue-1",
          reference_id: "law:test",
          reference_key: "law:test",
          kind: "law",
          statement_type: "issue_card",
          statement_path: "legal_analysis.issue_cards[0]",
          title: "형법 제307조",
          confidence_score: 0.91,
          match_reason: "카드 체크리스트를 직접 뒷받침합니다.",
          matched_issue_types: ["명예훼손"],
          query_refs: [{ text: "명예훼손", bucket: "precise", channel: "law", sources: [], issue_types: [], legal_element_signals: [] }],
          query_source_tags: ["keyword"],
          snippet: { field: "content", text: "공연히 사실을 적시하여 명예를 훼손한 경우" }
        }
      ],
      by_reference_id: {
        "law:test": ["law-citation:test", "law-citation:issue-1"]
      },
      by_statement_path: {
        "legal_analysis.summary": ["law-citation:test"],
        "legal_analysis.issue_cards[0]": ["law-citation:issue-1"]
      }
    },
    "public analysis response should retain sanitized citation path indexing for summary and issue cards"
  );
  assert.equal(publicResult.ocr?.source_type, "messenger", "public analysis response should expose minimal OCR metadata");
  assert.equal("raw_text" in (publicResult.ocr ?? {}), false, "public OCR payload must not expose raw_text");
  assert.deepEqual(
    publicResult.classification?.scope_filter,
    {
      supported_issues: ["명예훼손"],
      unsupported_issues: [],
      scope_warnings: []
    },
    "public classification payload should expose a reduced scope filter snapshot"
  );
  assert.equal(
    "searchable_text" in (publicResult.classification ?? {}),
    false,
    "public classification payload must not expose searchable_text"
  );
  assert.deepEqual(
    publicResult.retrieval_plan?.scope_filter,
    {
      supported_issues: ["명예훼손"],
      unsupported_issues: [],
      scope_warnings: []
    },
    "public retrieval plan should expose canonical scope filter fields"
  );
  assert.equal(publicResult.law_search?.retrieval_preview?.headline, "law preview", "public law search should expose preview");
  assert.equal(
    "retrieval_trace" in (publicResult.law_search ?? {}),
    false,
    "public law search payload must not expose retrieval trace"
  );
  assert.equal(publicResult.precedent_search?.retrieval_preview?.headline, "precedent preview", "public precedent search should expose preview");
  assert.equal(
    "retrieval_trace" in (publicResult.precedent_search ?? {}),
    false,
    "public precedent search payload must not expose retrieval trace"
  );

  const runtimeArtifacts = buildStoredRuntimeArtifacts({
    meta: {
      retrieval_preview: {
        law: { headline: "preview headline" }
      },
      retrieval_trace: [
        {
          stage: "law",
          tool: "search_law_tool"
        }
      ]
    }
  });

  assert.deepEqual(
    runtimeArtifacts.preview,
    {
      law: { headline: "preview headline" }
    },
    "stored runtime preview should preserve retrieval preview data"
  );
  assert.deepEqual(
    runtimeArtifacts.trace,
    [
      {
        stage: "law",
        tool: "search_law_tool"
      }
    ],
    "stored runtime trace should preserve retrieval trace events"
  );

  const persistedPublicResult = await persistAnalysisRun({
    store: createQuotaTrackingStore(),
    providerMode: "mock",
    jobId: "job-persist-test",
    result: {
      meta: {
        provider_mode: "mock",
        generated_at: "2026-04-16T00:00:00.000Z",
        input_type: "text",
        context_type: "community",
        retrieval_preview: {
          law: { headline: "preview headline" }
        },
        retrieval_trace: [
          {
            stage: "law",
            tool: "search_law_tool"
          }
        ]
      },
      ocr: {
        source_type: "messenger",
        utterances: [{ speaker: "A", text: "masked" }],
        raw_text: "private"
      },
      classification: {
        issues: [{ type: "모욕", severity: "low" }],
        is_criminal: true,
        is_civil: false
      },
      retrieval_plan: {
        candidateIssues: [{ type: "모욕", severity: "low", reason: "test" }]
      },
      law_search: {
        laws: []
      },
      precedent_search: {
        precedents: []
      },
      legal_analysis: {
        summary: "분석 결과",
        verifier: {
          stage: "pre_analysis_verifier",
          status: "passed",
          evidence_sufficient: true,
          citation_integrity: true,
          contradiction_detected: false,
          selected_reference_count: 1,
          issue_count: 1,
          confidence_calibration: {
            score: 0.84,
            label: "high"
          },
          warnings: []
        },
        safety_gate: {
          stage: "pre_output_safety_gate",
          status: "passed",
          adjusted_output: false,
          blocked_reasons: [],
          warnings: []
        },
        can_sue: false,
        risk_level: 1,
        disclaimer: "참고용",
        scope_assessment: {
          supported_issues: ["모욕"],
          unsupported_issues: [],
          procedural_heavy: false,
          insufficient_facts: false,
          unsupported_issue_present: false,
          warnings: []
        }
      },
      timeline: []
    },
    timeline: [],
    profileContext: null,
    userId: null,
    inputMode: "text",
    contextType: "community",
    title: "테스트 사건",
    sourceKind: "manual",
    metadata: {
      request_id: "req-persist-test"
    }
  });

  assert.equal(
    persistedPublicResult.job_id,
    "job-persist-test",
    "persistAnalysisRun should preserve the public job id"
  );
  assert.equal(
    persistedPublicResult.legal_analysis.summary,
    "분석 결과",
    "persistAnalysisRun should return the final public analysis result"
  );
  assert.equal(
    persistedPublicResult.legal_analysis.verifier?.status,
    "passed",
    "persistAnalysisRun should preserve sanitized verifier metadata in the public result"
  );

  const agentDoneStreamEvent = buildPublicAnalysisStreamEvent("job-stream-test", {
    type: "agent_done",
    agent: "ocr",
    at: "t-agent",
    result: {
      source_type: "messenger",
      utterance_count: 1
    }
  });
  assert.deepEqual(
    agentDoneStreamEvent,
    {
      type: "agent_done",
      agent: "ocr",
      at: "t-agent",
      result: {
        source_type: "messenger",
        utterance_count: 1
      },
      job_id: "job-stream-test",
      status: "running"
    },
    "stream agent_done event should carry running status and the public agent result"
  );

  const completeStreamEvent = buildPublicAnalysisStreamEvent("job-stream-test", {
    type: "complete",
    at: "t-complete",
    analysis: {
      job_id: "job-stream-test",
      status: "completed"
    }
  });
  assert.deepEqual(
    completeStreamEvent,
    {
      type: "complete",
      job_id: "job-stream-test",
      status: "completed",
      at: "t-complete",
      result: {
        job_id: "job-stream-test",
        status: "completed"
      }
    },
    "stream complete event should expose result payload in the public envelope"
  );

  const errorStreamEvent = buildPublicAnalysisStreamEvent("job-stream-test", {
    type: "error",
    at: "t-error",
    message: "analysis failed"
  });
  assert.deepEqual(
    errorStreamEvent,
    {
      type: "error",
      job_id: "job-stream-test",
      status: "failed",
      at: "t-error",
      message: "analysis failed",
      error: "analysis failed"
    },
    "stream error event should expose failed status and normalized error fields"
  );

  const factsFirstAnalysis = await runLegalAnalysisAgent(
    {
      issues: [],
      issue_hypotheses: [
        {
          type: "협박/공갈",
          confidence: 0.91,
          matched_terms: ["돈", "죽이겠다"],
          reason: "threat and money demand"
        }
      ],
      legal_elements: {
        "협박/공갈": {
          threat_of_harm: true,
          money_or_property_request: true
        }
      },
      facts: {
        threat_signal: true,
        money_request: true,
        repeated_contact: true,
        text_length: 18
      },
      supported_issues: ["협박/공갈"],
      unsupported_issues: [],
      scope_flags: {
        proceduralHeavy: false,
        insufficientFacts: false,
        unsupportedIssuePresent: false
      },
      scope_warnings: []
    },
    { laws: [], retrieval_preview: null, retrieval_trace: [] },
    { precedents: [], retrieval_preview: null, retrieval_trace: [] },
    { providerMode: "mock" }
  );
  assert.equal(factsFirstAnalysis.can_sue, false, "low evidence should keep facts-only analysis conservative");
  assert.equal(factsFirstAnalysis.verifier?.stage, "pre_analysis_verifier", "analysis agent should expose verifier output");
  assert.equal(
    typeof factsFirstAnalysis.decision_axis?.fact_signal_count,
    "number",
    "facts-first analysis should expose decision axis"
  );
  assert.ok(Array.isArray(factsFirstAnalysis.charges[0]?.fact_hints), "facts-first analysis should carry fact-hint metadata into charges");
  assert.ok(
    factsFirstAnalysis.evidence_to_collect.length > 3,
    "facts-first analysis should expand evidence collection guidance from facts and legal elements"
  );

  const sharedQueryRef = {
    text: "협박 해악 고지",
    bucket: "precise" as const,
    channel: "law" as const,
    sources: ["legal_element" as const],
    issue_types: ["협박/공갈"],
    legal_element_signals: ["threat_of_harm"]
  };
  const citationLinkedAnalysis = await runLegalAnalysisAgent(
    {
      issue_hypotheses: [
        {
          type: "협박/공갈",
          confidence: 0.88,
          matched_terms: ["죽이겠다"],
          reason: "threat signal"
        }
      ],
      legal_elements: {
        "협박/공갈": {
          threat_of_harm: true
        }
      },
      facts: {
        threat_signal: true,
        text_length: 24
      },
      supported_issues: ["협박/공갈"],
      unsupported_issues: [],
      scope_flags: {
        proceduralHeavy: false,
        insufficientFacts: false,
        unsupportedIssuePresent: false
      },
      scope_warnings: []
    },
    { laws: [], retrieval_preview: null, retrieval_trace: [] },
    { precedents: [], retrieval_preview: null, retrieval_trace: [] },
    {
      providerMode: "mock",
      retrievalEvidencePack: {
        version: "v2",
        query: {
          original: "돈 안 주면 죽이겠다고 했어요",
          normalized: "돈 안 주면 죽이겠다",
          context_type: "messenger"
        },
        plan: {
          tokens: ["돈", "죽이겠다"],
          candidate_issues: [],
          broad_law_queries: [],
          precise_law_queries: [],
          broad_precedent_queries: [],
          precise_precedent_queries: [],
          law_queries: [],
          precedent_queries: [],
          warnings: [],
          supported_issues: ["협박/공갈"],
          unsupported_issues: [],
          scope_warnings: [],
          scope_flags: {
            proceduralHeavy: false,
            insufficientFacts: false,
            unsupportedIssuePresent: false
          }
        },
        retrieval_preview: {
          law: null,
          precedent: null
        },
        retrieval_trace: [],
        matched_laws: [
          {
            id: "law::형법::제283조",
            referenceKey: "law::형법::제283조",
            kind: "law",
            title: "형법 제283조",
            subtitle: "협박",
            summary: "해악 고지 관련 조문",
            confidenceScore: 0.91,
            matchReason: "해악 고지 신호와 직접 맞닿아 있습니다.",
            querySourceTags: ["legal_element"],
            matchedQueries: [sharedQueryRef],
            matchedIssueTypes: ["협박/공갈"],
            snippet: {
              field: "content",
              text: "사람을 협박한 자는 처벌될 수 있다."
            },
            source: {
              law_name: "형법",
              article_no: "제283조",
              article_title: "협박",
              penalty: "3년 이하 징역",
              url: "https://example.test/law"
            },
            reference: {
              id: "law::형법::제283조",
              title: "형법 제283조"
            }
          }
        ],
        matched_precedents: [
          {
            id: "precedent::2026도123",
            referenceKey: "precedent::2026도123",
            kind: "precedent",
            title: "2026도123",
            subtitle: "대법원",
            summary: "메신저 협박 판례",
            confidenceScore: 0.82,
            matchReason: "메신저 해악 고지 구조가 유사합니다.",
            querySourceTags: ["legal_element"],
            matchedQueries: [{
              ...sharedQueryRef,
              channel: "precedent" as const
            }],
            matchedIssueTypes: ["협박/공갈"],
            snippet: {
              field: "summary",
              text: "메신저로 해악을 고지한 사안."
            },
            source: {
              case_no: "2026도123",
              court: "대법원",
              verdict: "판결",
              sentence: "유죄 취지"
            },
            reference: {
              id: "precedent::2026도123",
              caseNo: "2026도123",
              court: "대법원",
              verdict: "판결"
            }
          }
        ],
        selected_reference_ids: ["law::형법::제283조", "precedent::2026도123"],
        top_issue_types: ["협박/공갈"],
        evidence_strength: "high",
        citation_map: {
          version: "v2",
          citations: [
            {
              citation_id: "law-1",
              reference_id: "law::형법::제283조",
              reference_key: "law::형법::제283조",
              kind: "law",
              statement_type: "charge",
              statement_path: "legal_analysis.charges[0]",
              title: "형법 제283조",
              confidence_score: 0.91,
              match_reason: "해악 고지 신호와 직접 맞닿아 있습니다.",
              matched_issue_types: ["협박/공갈"],
              query_refs: [sharedQueryRef],
              query_source_tags: ["legal_element"],
              snippet: {
                field: "content",
                text: "사람을 협박한 자는 처벌될 수 있다."
              }
            },
            {
              citation_id: "precedent-1",
              reference_id: "precedent::2026도123",
              reference_key: "precedent::2026도123",
              kind: "precedent",
              statement_type: "precedent_card",
              statement_path: "legal_analysis.precedent_cards[0]",
              title: "2026도123",
              confidence_score: 0.82,
              match_reason: "메신저 해악 고지 구조가 유사합니다.",
              matched_issue_types: ["협박/공갈"],
              query_refs: [{
                ...sharedQueryRef,
                channel: "precedent" as const
              }],
              query_source_tags: ["legal_element"],
              snippet: {
                field: "summary",
                text: "메신저로 해악을 고지한 사안."
              }
            }
          ],
          by_reference_id: {
            "law::형법::제283조": ["law-1"],
            "precedent::2026도123": ["precedent-1"]
          },
          by_statement_path: {
            "legal_analysis.charges[0]": ["law-1"],
            "legal_analysis.precedent_cards[0]": ["precedent-1"]
          }
        }
      }
    }
  );
  assert.equal(citationLinkedAnalysis.charges[0]?.grounding?.citation_id, "law-1");
  assert.equal(citationLinkedAnalysis.charges[0]?.grounding?.query_refs?.[0]?.text, "협박 해악 고지");
  assert.equal(citationLinkedAnalysis.precedent_cards[0]?.grounding?.citation_id, "precedent-1");
  assert.deepEqual(
    citationLinkedAnalysis.citation_map?.by_statement_path?.["legal_analysis.charges[0]"],
    ["law-1"],
    "normalized analysis should retain citation path indexing"
  );
  assert.equal(citationLinkedAnalysis.verifier?.citation_integrity, true, "citation-linked analysis should preserve verifier integrity result");
  assert.equal(citationLinkedAnalysis.claim_support?.overall, "direct", "citation-linked analysis should expose direct claim support when statement citations are present");
  assert.equal(citationLinkedAnalysis.verifier?.claim_support?.overall, "direct", "verifier should mirror claim support coverage");

  const orchestratedCitationLinkedAnalysis = await runAnalysis(
    {
      request_id: "citation-linked-safety-gate",
      input_type: "text",
      context_type: "messenger",
      text: "돈 안 주면 죽이겠다고 했어요"
    },
    { providerMode: "mock" }
  );
  assert.equal(
    orchestratedCitationLinkedAnalysis.legal_analysis?.safety_gate?.stage,
    "pre_output_safety_gate",
    "orchestrated analysis should attach the safety gate output before returning"
  );
  assert.equal(
    orchestratedCitationLinkedAnalysis.timeline.find((entry: Record<string, unknown>) => entry.agent === "analysis" && entry.type === "agent_done")?.summary?.safety_gate?.stage,
    "pre_output_safety_gate",
    "analysis timeline summary should surface sanitized safety gate metadata"
  );

  const publicCitationLinkedAnalysis = buildPublicAnalysisResult(
    "job-citation-test",
    {
      ocr: {},
      classification: {},
      retrieval_plan: {},
      law_search: {},
      precedent_search: {},
      legal_analysis: citationLinkedAnalysis,
      meta: {},
      timeline: []
    },
    []
  );
  const publicLegalAnalysis = publicCitationLinkedAnalysis.legal_analysis as {
    charges: Array<{ grounding?: { citation_id?: string } }>;
    precedent_cards: Array<{ grounding?: { citation_id?: string } }>;
  };
  assert.equal(
    publicLegalAnalysis.charges[0]?.grounding?.citation_id,
    "law-1",
    "public analysis should retain safe charge citation ids"
  );
  assert.equal(
    publicLegalAnalysis.precedent_cards[0]?.grounding?.citation_id,
    "precedent-1",
    "public analysis should retain safe precedent citation ids"
  );

  const manager = createAnalysisJobManager();
  const job = manager.createJob();
  const observedEvents: string[] = [];

  const completion = new Promise<void>((resolve) => {
    const unsubscribe = manager.subscribe(job.id, (event) => {
      observedEvents.push(String(event.type));
      if (event.type === "complete") {
        unsubscribe?.();
        resolve();
      }
    });
  });

  manager.startJob(job.id, async ({ emit }) => {
    emit({ type: "agent_start", agent: "ocr", at: "t1" });
    emit({
      type: "agent_done",
      agent: "ocr",
      at: "t2",
      result: buildPublicAgentResult("ocr", {
        source_type: "messenger",
        utterances: [{ speaker: "A", text: "masked" }]
      })
    });

    return {
      job_id: job.id,
      status: "completed"
    };
  });

  await completion;

  const snapshot = manager.getJob(job.id);
  assert.equal(snapshot?.status, "completed", "job manager should transition jobs to completed");
  assert.deepEqual(
    observedEvents,
    ["agent_start", "agent_done", "complete"],
    "job manager should emit progress and completion events in order"
  );

  verifyVerifierAndSafetyGateContracts();
  verifyHighRiskEscalationPolicy();

  await verifyAnalysisGuestQuotaIgnoresForgedForwardedFor();
  await verifyInvalidAnalysisDoesNotConsumeGuestQuota();
  await verifyKeywordGuestQuotaIgnoresForgedForwardedFor();
  await verifyRetrievalToolGuestQuotaIgnoresForgedForwardedFor();
  await verifyTrustedProxyCanForwardClientIp();
  await verifyAnalysisCitationMapMatchesFinalCharges();
  await verifyReferenceEndpointsRequireAuthentication();
  await verifySaveAnalysisUsesTransactionBoundary();

  process.stdout.write("Analysis architecture checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
