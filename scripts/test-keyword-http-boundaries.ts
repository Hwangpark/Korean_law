import assert from "node:assert/strict";
import http from "node:http";

import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import type { AnalysisConfig } from "../apps/api/src/analysis/config.js";
import type { AnalysisStore, GuestUsageIdentity, GuestUsageResult } from "../apps/api/src/analysis/store.js";
import type { AuthConfig } from "../apps/api/src/auth/config.js";
import type { AuthService } from "../apps/api/src/auth/service.js";
import { createKeywordVerificationHandler } from "../apps/api/src/retrieval/http.js";
import { buildPublicKeywordVerificationResponse, buildStoredKeywordVerificationResponse } from "../apps/api/src/retrieval/privacy.js";
import { createKeywordVerificationService } from "../apps/api/src/retrieval/service.js";
import type { KeywordVerificationResponse } from "../apps/api/src/retrieval/types.js";
import type { KeywordVerificationStore } from "../apps/api/src/retrieval/store.js";

function createAuthConfig(): AuthConfig {
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

function createAnalysisConfig(): AnalysisConfig {
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

function createKeywordStoreStub(): KeywordVerificationStore {
  return {
    async ensureSchema() {
      return;
    },
    async saveRun() {
      return "keyword-http-run";
    }
  };
}

function createAnalysisStoreStub(): AnalysisStore {
  return {
    ensureSchema: async () => undefined,
    saveAnalysis: async () => ({
      caseId: "case-test",
      runId: "run-test",
      referenceLibrary: []
    }),
    saveReferenceLibrary: async (input) =>
      buildReferenceSeeds(input.result as Record<string, unknown>, input.providerMode).map((seed) => ({
        id: seed.sourceKey,
        kind: seed.kind,
        href: `/api/references/${seed.kind}/${encodeURIComponent(seed.sourceKey)}`,
        title: seed.title,
        subtitle: seed.subtitle,
        summary: seed.summary,
        details: seed.details,
        url: seed.url,
        articleNo: seed.articleNo,
        caseNo: seed.caseNo,
        court: seed.court,
        verdict: seed.verdict,
        penalty: seed.penalty,
        similarityScore: seed.similarityScore,
        sourceMode: seed.sourceMode,
        officialSourceLabel: seed.officialSourceLabel,
        authorityTier: seed.authorityTier,
        referenceDate: seed.referenceDate,
        freshnessStatus: seed.freshnessStatus,
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })),
    listHistory: async () => [],
    consumeGuestAnalysis: async (_identity: GuestUsageIdentity): Promise<GuestUsageResult> => ({
      guestId: "guest-test",
      usageCount: 1,
      limit: 10,
      remaining: 9,
      allowed: true
    }),
    searchReferences: async () => [],
    getReferenceByKindAndId: async () => null
  };
}

function createQuotaAnalysisStoreStub(limit = 2): AnalysisStore & { seenIps: string[] } {
  const base = createAnalysisStoreStub();
  const counts = new Map<string, number>();
  const seenIps: string[] = [];

  return {
    ...base,
    seenIps,
    async consumeGuestAnalysis(identity: GuestUsageIdentity): Promise<GuestUsageResult> {
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
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : "Unexpected error."
        }));
      });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind keyword boundary server.");
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

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  assert.equal(response.status, 200, "keyword verify request should succeed");
  return response.json() as Promise<Record<string, unknown>>;
}

async function postJsonSnapshot(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>
  };
}

function assertStoredBoundary(stored: Record<string, unknown>, internal: KeywordVerificationResponse): void {
  assert.deepEqual(
    stored,
    buildStoredKeywordVerificationResponse(internal),
    "stored keyword response should exactly match the storage privacy projection"
  );

  assert.equal("matched_laws" in stored, false, "stored response must not keep matched_laws cards");
  assert.equal("matched_precedents" in stored, false, "stored response must not keep matched_precedents cards");
  assert.equal("reference_library" in stored, false, "stored response must not keep top-level reference library");
  assert.equal("law_reference_library" in stored, false, "stored response must not keep top-level law reference library");
  assert.equal("precedent_reference_library" in stored, false, "stored response must not keep top-level precedent reference library");

  const pack = stored.retrieval_evidence_pack as Record<string, unknown>;
  assert.ok(pack, "stored response should keep a trimmed retrieval_evidence_pack");
  assert.deepEqual(
    Object.keys(pack).sort(),
    ["evidence_strength", "query", "run_id", "selected_reference_ids", "top_issue_types", "version"].sort(),
    "stored retrieval_evidence_pack should keep only the minimal stable fields"
  );
}

function assertStoredProjectionSanitizesPreviewBoundary(internal: KeywordVerificationResponse): void {
  const stored = buildStoredKeywordVerificationResponse({
    ...internal,
    retrieval_preview: {
      law: {
        ...(internal.retrieval_preview?.law ?? {
          headline: "law",
          top_issues: [],
          top_laws: [],
          top_precedents: [],
          profile_flags: [],
          disclaimer: ""
        }),
        top_laws: [
          {
            id: "law-preview",
            title: "형법 제307조",
            summary: "명예훼손",
            reference: { secret: true }
          } as Record<string, unknown>
        ]
      },
      precedent: {
        ...(internal.retrieval_preview?.precedent ?? {
          headline: "precedent",
          top_issues: [],
          top_laws: [],
          top_precedents: [],
          profile_flags: [],
          disclaimer: ""
        }),
        top_precedents: [
          {
            id: "precedent-preview",
            title: "대법원 2024도1",
            summary: "판례",
            citation_map: { leaked: true }
          } as Record<string, unknown>
        ]
      }
    }
  });

  assert.deepEqual(
    stored.retrieval_preview,
    {
      law: {
        headline: (internal.retrieval_preview?.law?.headline ?? "law"),
        top_issues: internal.retrieval_preview?.law?.top_issues ?? [],
        top_laws: [
          {
            id: "law-preview",
            title: "형법 제307조",
            summary: "명예훼손"
          }
        ],
        top_precedents: internal.retrieval_preview?.law?.top_precedents ?? [],
        profile_flags: internal.retrieval_preview?.law?.profile_flags ?? [],
        disclaimer: internal.retrieval_preview?.law?.disclaimer ?? ""
      },
      precedent: {
        headline: (internal.retrieval_preview?.precedent?.headline ?? "precedent"),
        top_issues: internal.retrieval_preview?.precedent?.top_issues ?? [],
        top_laws: internal.retrieval_preview?.precedent?.top_laws ?? [],
        top_precedents: [
          {
            id: "precedent-preview",
            title: "대법원 2024도1",
            summary: "판례"
          }
        ],
        profile_flags: internal.retrieval_preview?.precedent?.profile_flags ?? [],
        disclaimer: internal.retrieval_preview?.precedent?.disclaimer ?? ""
      }
    },
    "stored retrieval_preview should drop future provenance/reference payload additions"
  );
}

function assertStoredProjectionSanitizesTraceBoundary(internal: KeywordVerificationResponse): void {
  const stored = buildStoredKeywordVerificationResponse({
    ...internal,
    retrieval_trace: [
      {
        ...(internal.retrieval_trace?.[0] ?? {
          stage: "law",
          tool: "search_law",
          provider: "fixture",
          duration_ms: 12,
          cache_hit: false,
          input_ref: "query:law",
          output_ref: ["law-1"],
          reason: "fixture"
        }),
        query_refs: [
          {
            text: "명예훼손 허위사실",
            bucket: "precise",
            channel: "law",
            sources: ["keyword"],
            issue_types: ["defamation"],
            legal_element_signals: ["publicity"],
            internal_score: 99,
            private_debug: "leak"
          } as unknown as Record<string, unknown>
        ],
        private_debug: "should-drop",
        provider_payload: { raw: true }
      } as unknown as NonNullable<KeywordVerificationResponse["retrieval_trace"]>[number]
    ]
  });

  assert.deepEqual(
    stored.retrieval_trace,
    [
      {
        stage: internal.retrieval_trace?.[0]?.stage ?? "law",
        tool: internal.retrieval_trace?.[0]?.tool ?? "search_law",
        provider: internal.retrieval_trace?.[0]?.provider ?? "fixture",
        duration_ms: internal.retrieval_trace?.[0]?.duration_ms ?? 12,
        cache_hit: internal.retrieval_trace?.[0]?.cache_hit ?? false,
        input_ref: internal.retrieval_trace?.[0]?.input_ref ?? "query:law",
        output_ref: internal.retrieval_trace?.[0]?.output_ref ?? ["law-1"],
        reason: internal.retrieval_trace?.[0]?.reason ?? "fixture",
        query_refs: [
          {
            text: "명예훼손 허위사실",
            bucket: "precise",
            channel: "law",
            sources: ["keyword"],
            issue_types: ["defamation"],
            legal_element_signals: ["publicity"],
            source_summary: ["keyword", "defamation", "publicity"],
            redacted: false
          }
        ]
      }
    ],
    "stored retrieval_trace should drop future debug/provider payload additions"
  );
}

function assertPublicBoundary(publicBody: Record<string, unknown>, internal: KeywordVerificationResponse): void {
  const { guest_id, guest_remaining, ...publicProjection } = publicBody;

  assert.deepEqual(
    publicProjection,
    buildPublicKeywordVerificationResponse(internal),
    "public keyword response should exactly match the public privacy projection"
  );

  assert.equal(typeof guest_id, "string", "public keyword response should keep guest_id envelope metadata");
  assert.equal(typeof guest_remaining, "number", "public keyword response should keep guest_remaining envelope metadata");

  assert.equal("retrieval_evidence_pack" in publicBody, false, "public keyword response must not expose retrieval_evidence_pack");
  assert.equal("retrieval_trace" in publicBody, false, "public keyword response must not expose retrieval_trace");
  assert.ok(publicBody.retrieval_preview, "public keyword response should expose retrieval_preview");
  assert.equal("reference_library" in publicBody, false, "public keyword response must not expose internal reference_library");
  assert.equal("law_reference_library" in publicBody, false, "public keyword response must not expose law reference snapshots");
  assert.equal("precedent_reference_library" in publicBody, false, "public keyword response must not expose precedent reference snapshots");

  const plan = publicBody.plan as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(plan).sort(),
    ["candidate_issues", "scope_flags", "scope_filter", "warnings", "supported_issues", "unsupported_issues", "scope_warnings"].sort(),
    "public plan should expose only the reduced safe plan payload"
  );
  assert.deepEqual(
    plan.scope_filter,
    {
      supported_issues: internal.plan.supported_issues,
      unsupported_issues: internal.plan.unsupported_issues,
      scope_warnings: internal.plan.scope_warnings
    },
    "public plan should expose canonical scope_filter snapshot"
  );

  const matchedLaw = Array.isArray(publicBody.matched_laws)
    ? publicBody.matched_laws[0] as Record<string, unknown>
    : null;
  const internalLaw = internal.matched_laws[0];
  assert.ok(matchedLaw, "public keyword response should keep matched law cards");
  assert.ok(internalLaw, "regression fixture should include at least one matched law");
  assert.equal("reference" in matchedLaw, false, "matched law card must not embed ReferenceLibraryItem");
  assert.equal("createdAt" in matchedLaw, false, "matched law card must not expose storage freshness timestamps");
  assert.equal("updatedAt" in matchedLaw, false, "matched law card must not expose storage freshness timestamps");
  assert.equal(matchedLaw.referenceKey, internalLaw.referenceKey, "public matched law should retain stable reference key");
  assert.equal(matchedLaw.subtitle, internalLaw.subtitle, "public matched law should retain article-bearing subtitle authority metadata");
  assert.ok(Array.isArray(matchedLaw.matchedQueries), "matched law card should keep legacy matchedQueries text list");
  assert.ok(Array.isArray(matchedLaw.matchedQueryRefs), "matched law card should expose structured matchedQueryRefs");
  assert.ok((matchedLaw.matchedQueryRefs as Array<unknown>).length > 0, "matched law card should expose at least one matched query ref");
  assert.deepEqual(
    Object.keys((matchedLaw.matchedQueryRefs as Array<Record<string, unknown>>)[0] ?? {}).sort(),
    ["bucket", "channel", "issue_types", "legal_element_signals", "redacted", "source_summary", "sources", "text"].sort(),
    "public matchedQueryRefs should keep only the safe provenance fields"
  );
  assert.deepEqual(
    matchedLaw.provenanceSummary,
    {
      matched_query_count: (matchedLaw.matchedQueryRefs as Array<unknown>).length,
      redacted_query_count: 0,
      source_tags: ((matchedLaw.matchedQueryRefs as Array<Record<string, unknown>>).flatMap((item) => item.sources as string[])).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index),
      issue_types: ((matchedLaw.matchedQueryRefs as Array<Record<string, unknown>>).flatMap((item) => item.issue_types as string[])).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index)
    },
    "public matched law card should expose a stable provenance summary"
  );
  assert.equal(matchedLaw.sourceMode, "fixture", "public matched law card should expose safe sourceMode");
  assert.equal(matchedLaw.provider_source, "fixture", "public matched law card should expose provider_source");
  assert.equal(matchedLaw.official_source_label, "법제처 국가법령정보", "public matched law should expose safe official source label");
  assert.equal(matchedLaw.authority_tier, "statute", "public matched law should expose safe authority tier");
  assert.equal(matchedLaw.freshness_status, "unknown", "public matched law should default freshness to unknown when no upstream status exists");

  const lawSource = matchedLaw.source as Record<string, unknown>;
  assert.deepEqual(
    {
      law_name: lawSource.law_name,
      article_no: lawSource.article_no,
      article_title: lawSource.article_title,
      penalty: lawSource.penalty,
      url: lawSource.url
    },
    {
      law_name: internalLaw.source.law_name ?? "",
      article_no: internalLaw.source.article_no ?? "",
      article_title: internalLaw.source.article_title ?? "",
      penalty: internalLaw.source.penalty ?? "",
      url: internalLaw.source.url ?? ""
    },
    "public matched law should retain authority metadata needed to identify the controlling statute"
  );

  const matchedPrecedent = Array.isArray(publicBody.matched_precedents)
    ? publicBody.matched_precedents[0] as Record<string, unknown>
    : null;
  const internalPrecedent = internal.matched_precedents[0];
  assert.ok(matchedPrecedent, "public keyword response should keep matched precedent cards");
  assert.ok(internalPrecedent, "regression fixture should include at least one matched precedent");
  assert.equal("reference" in matchedPrecedent, false, "matched precedent card must not embed ReferenceLibraryItem");
  assert.equal("createdAt" in matchedPrecedent, false, "matched precedent card must not expose storage freshness timestamps");
  assert.equal("updatedAt" in matchedPrecedent, false, "matched precedent card must not expose storage freshness timestamps");
  assert.equal(matchedPrecedent.referenceKey, internalPrecedent.referenceKey, "public matched precedent should retain stable reference key");
  assert.equal(matchedPrecedent.subtitle, internalPrecedent.subtitle, "public matched precedent should retain date-bearing subtitle freshness metadata");
  assert.match(String(matchedPrecedent.subtitle), /\d{4}-\d{2}-\d{2}/, "public matched precedent subtitle should preserve precedent date metadata");
  assert.equal(matchedPrecedent.provider_source, internalPrecedent.reference.sourceMode, "public matched precedent should expose safe provider source");
  assert.equal(matchedPrecedent.sourceMode, internalPrecedent.reference.sourceMode, "public matched precedent should expose safe sourceMode");
  assert.equal(matchedPrecedent.official_source_label, internalPrecedent.reference.officialSourceLabel ?? internalPrecedent.reference.court ?? "법원 판례", "public matched precedent should expose safe official source label");
  assert.equal(matchedPrecedent.authority_tier, internalPrecedent.reference.authorityTier ?? "unknown", "public matched precedent should expose derived authority tier");
  assert.equal(matchedPrecedent.reference_date, internalPrecedent.reference.referenceDate ?? "", "public matched precedent should expose safe decision date metadata");
  assert.equal(matchedPrecedent.freshness_status, internalPrecedent.reference.freshnessStatus ?? "unknown", "public matched precedent should default freshness to unknown without explicit upstream status");

  const precedentSource = matchedPrecedent.source as Record<string, unknown>;
  assert.deepEqual(
    {
      case_no: precedentSource.case_no,
      court: precedentSource.court,
      verdict: precedentSource.verdict,
      sentence: precedentSource.sentence
    },
    {
      case_no: internalPrecedent.source.case_no ?? "",
      court: internalPrecedent.source.court ?? "",
      verdict: internalPrecedent.source.verdict ?? "",
      sentence: internalPrecedent.source.sentence ?? ""
    },
    "public matched precedent should retain authority metadata needed to judge precedent weight"
  );

  const legalAnalysis = publicBody.legal_analysis as Record<string, unknown>;
  assert.ok(legalAnalysis, "public keyword response should keep legal_analysis");
  assert.equal("reference_library" in legalAnalysis, false, "public legal_analysis must not expose duplicated reference library");
  assert.equal("law_reference_library" in legalAnalysis, false, "public legal_analysis must not expose law reference snapshots");
  assert.equal("precedent_reference_library" in legalAnalysis, false, "public legal_analysis must not expose precedent reference snapshots");
  assert.deepEqual(
    legalAnalysis.grounding_evidence,
    {
      top_issue: internal.legal_analysis.grounding_evidence?.top_issue ?? "",
      evidence_strength: internal.legal_analysis.grounding_evidence?.evidence_strength ?? "low"
    },
    "public keyword legal_analysis should keep only coarse grounding evidence summary"
  );

  const publicCharges = Array.isArray(legalAnalysis.charges)
    ? legalAnalysis.charges as Array<Record<string, unknown>>
    : [];
  assert.ok(publicCharges[0]?.grounding, "public keyword legal_analysis should retain charge grounding");
  assert.equal(
    (publicCharges[0]?.grounding as Record<string, unknown>)?.citation_id,
    internal.legal_analysis.charges[0]?.grounding?.citation_id ?? "",
    "public keyword legal_analysis should retain charge citation ids"
  );
  assert.ok(
    ((publicCharges[0]?.grounding as Record<string, unknown>)?.provenance_summary as Record<string, unknown>)?.matched_query_count !== undefined,
    "public keyword charge grounding should expose provenance_summary"
  );

  const publicPrecedents = Array.isArray(legalAnalysis.precedent_cards)
    ? legalAnalysis.precedent_cards as Array<Record<string, unknown>>
    : [];
  assert.ok(publicPrecedents[0]?.grounding, "public keyword legal_analysis should retain precedent grounding");
  assert.equal(
    (publicPrecedents[0]?.grounding as Record<string, unknown>)?.citation_id,
    internal.legal_analysis.precedent_cards[0]?.grounding?.citation_id ?? "",
    "public keyword legal_analysis should retain precedent citation ids"
  );
  assert.ok(
    ((publicPrecedents[0]?.grounding as Record<string, unknown>)?.provenance_summary as Record<string, unknown>)?.matched_query_count !== undefined,
    "public keyword precedent grounding should expose provenance_summary"
  );

  const citationMap = legalAnalysis.citation_map as Record<string, unknown>;
  assert.ok(citationMap, "public keyword legal_analysis should retain citation_map");
  assert.equal(citationMap.version, internal.legal_analysis.citation_map?.version ?? "", "public keyword legal_analysis should retain citation_map version");
  assert.deepEqual(
    (citationMap.by_statement_path as Record<string, unknown>)?.["legal_analysis.summary"],
    internal.legal_analysis.citation_map?.by_statement_path?.["legal_analysis.summary"] ?? [],
    "public keyword legal_analysis should retain summary citation path indexing"
  );
  assert.deepEqual(
    (citationMap.by_statement_path as Record<string, unknown>)?.["legal_analysis.issue_cards[0]"],
    internal.legal_analysis.citation_map?.by_statement_path?.["legal_analysis.issue_cards[0]"] ?? [],
    "public keyword legal_analysis should retain issue card citation path indexing"
  );
  assert.ok(
    ((citationMap.citations as Array<Record<string, unknown>>)?.[0]?.provenance_summary as Record<string, unknown>)?.matched_query_count !== undefined,
    "public keyword citation_map should expose provenance_summary per citation"
  );
}

function assertSensitiveQueryProvenanceBoundary(internal: KeywordVerificationResponse): void {
  const sharedSensitiveRef = {
    text: "피해자 실명 김민수 010-1234-5678",
    bucket: "precise",
    channel: "law",
    sources: ["fact", "profile"],
    issue_types: ["명예훼손"],
    legal_element_signals: ["공개성"]
  };

  const publicProjection = buildPublicKeywordVerificationResponse({
    ...internal,
    matched_laws: internal.matched_laws.map((card, index) => index === 0
      ? {
          ...card,
          matchedQueries: [sharedSensitiveRef, ...card.matchedQueries]
        }
      : card),
    legal_analysis: {
      ...internal.legal_analysis,
      charges: internal.legal_analysis.charges.map((charge, index) => index === 0
        ? {
            ...charge,
            grounding: {
              ...charge.grounding,
              query_refs: [sharedSensitiveRef, ...(charge.grounding?.query_refs ?? [])]
            }
          }
        : charge),
      citation_map: internal.legal_analysis.citation_map
        ? {
            ...internal.legal_analysis.citation_map,
            citations: internal.legal_analysis.citation_map.citations.map((citation, index) => index === 0
              ? {
                  ...citation,
                  query_refs: [sharedSensitiveRef, ...citation.query_refs]
                }
              : citation)
          }
        : internal.legal_analysis.citation_map
    }
  });

  const redactedRef = ((publicProjection.matched_laws as Array<Record<string, unknown>>)[0]?.matchedQueryRefs as Array<Record<string, unknown>>)?.[0];
  assert.equal(redactedRef?.text, "비공개 질의(fact,profile)", "sensitive public matched query provenance should redact raw text");
  assert.equal(redactedRef?.redacted, true, "sensitive public matched query provenance should mark redaction");

  const matchedSummary = ((publicProjection.matched_laws as Array<Record<string, unknown>>)[0]?.provenanceSummary as Record<string, unknown>);
  assert.equal(matchedSummary?.redacted_query_count, 1, "matched law provenance summary should count redacted queries");

  const groundingRef = (((publicProjection.legal_analysis as Record<string, unknown>).charges as Array<Record<string, unknown>>)[0]?.grounding as Record<string, unknown>);
  assert.equal((((groundingRef.query_refs as Array<Record<string, unknown>>)[0])?.text), "비공개 질의(fact,profile)", "charge grounding should redact sensitive query text");
  assert.equal(((groundingRef.provenance_summary as Record<string, unknown>)?.redacted_query_count), 1, "charge grounding provenance summary should count redactions");

  const citationRef = ((((publicProjection.legal_analysis as Record<string, unknown>).citation_map as Record<string, unknown>).citations as Array<Record<string, unknown>>)[0]);
  assert.equal((((citationRef.query_refs as Array<Record<string, unknown>>)[0])?.text), "비공개 질의(fact,profile)", "citation_map should redact sensitive query text");
  assert.equal(((citationRef.provenance_summary as Record<string, unknown>)?.redacted_query_count), 1, "citation_map provenance summary should count redactions");
}

function assertReferenceSeedsInferActualProviderSource(): void {
  const seeds = buildReferenceSeeds({
    law_search: {
      laws: [{ law_name: "형법", article_no: "제307조", content: "허위사실 적시에 대한 기본 조문" }],
      retrieval_trace: [{ reason: "Returned 1 law matches. provider_source=live_fallback" }]
    },
    precedent_search: {
      precedents: []
    }
  }, "live");

  assert.equal(seeds[0]?.sourceMode, "live_fallback", "reference seeds should prefer actual provider_source over requested provider mode");
}

function assertProfileContextBoundary(internal: KeywordVerificationResponse): void {
  const publicProjection = buildPublicKeywordVerificationResponse({
    ...internal,
    profile_context: {
      displayName: "김민수",
      birthDate: "2008-04-12",
      ageYears: 17,
      ageBand: "child",
      isMinor: true,
      gender: "male",
      nationality: "korean",
      legalNotes: ["보호자 동행 확인"]
    }
  });

  assert.deepEqual(
    publicProjection.profile_context,
    {
      ageBand: "child",
      isMinor: true,
      gender: "male",
      nationality: "korean",
      legalNotes: ["보호자 동행 확인"]
    },
    "public keyword response should expose only scrubbed profile context"
  );
}

async function assertRetrievalToolsShareGuestQuotaBoundary(): Promise<void> {
  const authConfig = createAuthConfig();
  const analysisConfig = createAnalysisConfig();
  const authService = createMockAuthService();
  const analysisStore = createQuotaAnalysisStoreStub(2);
  const keywordService = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore,
    keywordStore: createKeywordStoreStub()
  });
  const handler = createKeywordVerificationHandler(
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    keywordService
  );

  await withServer(handler, async (baseUrl) => {
    const invalid = await postJsonSnapshot(
      `${baseUrl}/api/tools/search_law_tool`,
      {
        context_type: "community",
        guest_id: "guest-tool"
      },
      { "x-forwarded-for": "203.0.113.10" }
    );
    assert.equal(invalid.status, 422, "invalid retrieval tool input should fail before quota consumption");

    const first = await postJsonSnapshot(
      `${baseUrl}/api/tools/search_law_tool`,
      {
        query: "명예훼손 허위사실",
        context_type: "community",
        guest_id: "guest-tool"
      },
      { "x-forwarded-for": "203.0.113.11" }
    );
    assert.equal(first.status, 200, "first guest retrieval tool request should succeed");
    assert.equal(first.body.guest_id, "guest-tool", "tool success envelope should expose guest_id");
    assert.equal(first.body.guest_remaining, 1, "tool success envelope should expose remaining guest quota");

    const second = await postJsonSnapshot(
      `${baseUrl}/api/tools/search_precedent_tool`,
      {
        query: "명예훼손 단체대화방",
        context_type: "community",
        guest_id: "guest-tool"
      },
      { "x-forwarded-for": "203.0.113.12" }
    );
    assert.equal(second.status, 200, "forged x-forwarded-for should not reset tool quota");
    assert.equal(second.body.guest_remaining, 0, "second tool request should exhaust guest quota");

    const third = await postJsonSnapshot(
      `${baseUrl}/api/tools/search_law_tool`,
      {
        query: "모욕",
        context_type: "community",
        guest_id: "guest-tool"
      },
      { "x-forwarded-for": "203.0.113.13" }
    );
    assert.equal(third.status, 429, "third retrieval tool request should hit guest quota");
    assert.equal(third.body.guest_remaining, 0, "tool 429 envelope should match keyword guest limit envelope");
    assert.deepEqual(
      third.body.guest_usage,
      {
        guest_id: "guest-tool",
        used: 3,
        limit: 2,
        remaining: 0
      },
      "tool 429 response should include guest usage details"
    );
  });

  assert.deepEqual(
    analysisStore.seenIps,
    ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
    "retrieval tool quota should use socket IP unless a trusted proxy is configured"
  );
}

async function assertAuthenticatedRetrievalToolsDoNotUseGuestQuota(): Promise<void> {
  const authConfig = createAuthConfig();
  const analysisConfig = createAnalysisConfig();
  const authService = createMockAuthService();
  const analysisStore = createQuotaAnalysisStoreStub(0);
  const keywordService = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore,
    keywordStore: createKeywordStoreStub()
  });
  const handler = createKeywordVerificationHandler(
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    keywordService
  );

  await withServer(handler, async (baseUrl) => {
    const response = await postJsonSnapshot(
      `${baseUrl}/api/tools/search_law_tool`,
      {
        query: "명예훼손 허위사실",
        context_type: "community"
      },
      { authorization: "Bearer test-token" }
    );

    assert.equal(response.status, 200, "authenticated retrieval tool request should succeed without guest quota");
    assert.equal("guest_remaining" in response.body, false, "authenticated tool response should not expose guest quota envelope");
  });

  assert.deepEqual(analysisStore.seenIps, [], "authenticated retrieval tools should not consume guest quota");
}

async function main(): Promise<void> {
  const authConfig = createAuthConfig();
  const analysisConfig = createAnalysisConfig();
  const authService = createMockAuthService();
  const analysisStore = createAnalysisStoreStub();
  const keywordService = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore,
    keywordStore: createKeywordStoreStub()
  });
  const query = "카카오톡 단톡방에 허위사실을 올리고 전화번호를 공개했다";

  const internal = await keywordService.verifyKeyword({
    query,
    contextType: "messenger",
    limit: 3
  });

  assertStoredBoundary(buildStoredKeywordVerificationResponse(internal), internal);
  assertStoredProjectionSanitizesPreviewBoundary(internal);
  assertStoredProjectionSanitizesTraceBoundary(internal);
  assertSensitiveQueryProvenanceBoundary(internal);
  assertReferenceSeedsInferActualProviderSource();
  assertProfileContextBoundary(internal);

  const handler = createKeywordVerificationHandler(
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    keywordService
  );

  await withServer(handler, async (baseUrl) => {
    const body = await postJson(`${baseUrl}/api/keywords/verify`, {
      query,
      context_type: "messenger",
      limit: 3,
      guest_id: "guest-boundary"
    });

    assertPublicBoundary(body, internal);
  });

  await assertRetrievalToolsShareGuestQuotaBoundary();
  await assertAuthenticatedRetrievalToolsDoNotUseGuestQuota();

  process.stdout.write("Keyword HTTP boundary checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
