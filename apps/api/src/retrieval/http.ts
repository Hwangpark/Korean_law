import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "../analysis/config.js";
import type { ReferenceLibraryItem } from "../analysis/references.js";
import { planKeywordVerification } from "./planner.js";
import { searchLawCandidates, searchPrecedentCandidates } from "./mcp-adapter.js";
import { scoreLawCandidate, scorePrecedentCandidate, summarizeVerification } from "./scoring.js";
import type { RetrievalStore } from "./store.js";
import type { KeywordVerificationOutput, KeywordVerificationRequest, RetrievalProviderMode } from "./types.js";

interface ReferenceWriter {
  saveReferenceLibrary(input: { providerMode: string; result: Record<string, unknown>; caseId?: string | null; runId?: string | null; }): Promise<ReferenceLibraryItem[]>;
}

interface HttpError extends Error {
  status?: number;
}

interface VerificationPayload {
  q?: string;
  query?: string;
  text?: string;
  context_type?: string;
  provider_mode?: string;
  limit?: number;
}

function resolveOrigin(config: AuthConfig, req: http.IncomingMessage): string {
  const origin = req.headers.origin ?? "";
  const allowed = config.corsOrigins;
  if (allowed.includes("*") || allowed.includes(origin)) return origin || allowed[0];
  return allowed[0];
}

function jsonResponse(
  res: http.ServerResponse,
  config: AuthConfig,
  status: number,
  body: unknown,
  req?: http.IncomingMessage
): void {
  const payload = status === 204 ? "" : JSON.stringify(body);
  const origin = req ? resolveOrigin(config, req) : config.corsOrigins[0];
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "vary": "Origin"
  });
  res.end(status === 204 ? undefined : payload);
}

async function readJsonBody(req: http.IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      const error = new Error("Request body is too large.") as HttpError;
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    const error = new Error("Request body must be valid JSON.") as HttpError;
    error.status = 400;
    throw error;
  }
}

function requestPath(req: http.IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const [scheme, token] = String(authorizationHeader ?? "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function normalizeProviderMode(value: unknown, fallback: RetrievalProviderMode): RetrievalProviderMode {
  const candidate = String(value ?? "").trim().toLowerCase();
  return candidate === "live" ? "live" : candidate === "mock" ? "mock" : fallback;
}

function normalizeQueryPayload(payload: VerificationPayload): string {
  return String(payload.q ?? payload.query ?? payload.text ?? "").trim();
}

function normalizeLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(12, Math.trunc(parsed)));
}

function toVerificationRequest(
  payload: VerificationPayload,
  analysisConfig: AnalysisConfig,
  userId: number | null
): KeywordVerificationRequest {
  const query = normalizeQueryPayload(payload);
  if (!query) {
    const error = new Error("q, query, or text field is required.") as HttpError;
    error.status = 422;
    throw error;
  }

  return {
    query,
    contextType: String(payload.context_type ?? process.env.DEFAULT_CONTEXT_TYPE ?? "community"),
    providerMode: normalizeProviderMode(payload.provider_mode, analysisConfig.providerMode as RetrievalProviderMode),
    limit: normalizeLimit(payload.limit, 6),
    userId
  };
}

function referencePayload(
  laws: ReturnType<typeof scoreLawCandidate>[],
  precedents: ReturnType<typeof scorePrecedentCandidate>[]
): Record<string, unknown> {
  return {
    law_search: {
      provider: laws[0]?.provider ?? "mock",
      laws
    },
    precedent_search: {
      provider: precedents[0]?.provider ?? "mock",
      precedents
    }
  };
}

async function readOptionalUserId(
  authService: AuthService,
  req: http.IncomingMessage
): Promise<number | null> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  const claims = await authService.verifyToken(token);
  const userId = Number(claims.sub);
  return Number.isFinite(userId) ? userId : null;
}

async function runKeywordVerification(
  authService: AuthService,
  analysisConfig: AnalysisConfig,
  req: http.IncomingMessage,
  payload: VerificationPayload,
  store: RetrievalStore,
  referenceWriter: ReferenceWriter
): Promise<KeywordVerificationOutput & {
  query_run: unknown;
  query_hits: unknown[];
  reference_library: { items: ReferenceLibraryItem[] };
}> {
  const userId = await readOptionalUserId(authService, req);
  const request = toVerificationRequest(payload, analysisConfig, userId);
  const plan = await planKeywordVerification(request);
  const [laws, precedents] = await Promise.all([
    searchLawCandidates(plan),
    searchPrecedentCandidates(plan)
  ]);

  const scoredLaws = laws.map((law) => scoreLawCandidate(plan, law)).sort((left, right) => right.score - left.score).slice(0, request.limit);
  const scoredPrecedents = precedents.map((precedent) => scorePrecedentCandidate(plan, precedent)).sort((left, right) => right.score - left.score).slice(0, request.limit);
  const verification = summarizeVerification(plan, scoredLaws, scoredPrecedents);
  const normalizedResult = referencePayload(scoredLaws, scoredPrecedents);
  const referenceLibrary = await referenceWriter.saveReferenceLibrary({
    providerMode: request.providerMode,
    result: normalizedResult
  });

  const saved = await store.saveQueryRun({
    userId: request.userId,
    plan,
    verification,
    resultCount: scoredLaws.length + scoredPrecedents.length,
    topScore: verification.score,
    hits: [
      ...scoredLaws.map((law, index) => ({
        kind: "law" as const,
        sourceKey: `law:${law.law_name}:${law.article_no}`,
        score: law.score,
        rank: index + 1,
        matchedTerms: law.matchedTerms,
        referenceSnapshot: law as unknown as Record<string, unknown>
      })),
      ...scoredPrecedents.map((precedent, index) => ({
        kind: "precedent" as const,
        sourceKey: `precedent:${precedent.case_no}`,
        score: precedent.score,
        rank: scoredLaws.length + index + 1,
        matchedTerms: precedent.matchedTerms,
        referenceSnapshot: precedent as unknown as Record<string, unknown>
      }))
    ]
  });

  return {
    meta: {
      provider_mode: request.providerMode,
      generated_at: new Date().toISOString(),
      query: request.query,
      context_type: request.contextType
    },
    planner: plan,
    verification,
    law_search: {
      provider: request.providerMode,
      laws: scoredLaws
    },
    precedent_search: {
      provider: request.providerMode,
      precedents: scoredPrecedents
    },
    query_run: saved.run,
    query_hits: saved.hits,
    reference_library: {
      items: referenceLibrary
    }
  };
}

export function createRetrievalHandler(
  authService: AuthService,
  authConfig: AuthConfig,
  analysisConfig: AnalysisConfig,
  store: RetrievalStore,
  referenceWriter: ReferenceWriter
) {
  return async function handleRetrievalRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const pathname = requestPath(req);

    if (
      req.method === "OPTIONS" &&
      (pathname === "/api/retrieval/verify" ||
        pathname === "/api/retrieval/search" ||
        pathname.startsWith("/api/retrieval/runs/"))
    ) {
      jsonResponse(res, authConfig, 204, null, req);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/retrieval/verify") {
      try {
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerificationPayload;
        const result = await runKeywordVerification(authService, analysisConfig, req, payload, store, referenceWriter);
        jsonResponse(res, authConfig, 200, result, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, {
          error: err.message || "Internal server error."
        }, req);
      }
      return true;
    }

    if (req.method === "GET" && pathname === "/api/retrieval/search") {
      try {
        const searchUrl = new URL(req.url ?? "/api/retrieval/search", "http://localhost");
        const payload: VerificationPayload = {
          q: searchUrl.searchParams.get("q") ?? "",
          context_type: searchUrl.searchParams.get("context_type") ?? undefined,
          provider_mode: searchUrl.searchParams.get("provider_mode") ?? undefined,
          limit: Number(searchUrl.searchParams.get("limit") ?? "")
        };
        const result = await runKeywordVerification(authService, analysisConfig, req, payload, store, referenceWriter);
        jsonResponse(res, authConfig, 200, result, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, {
          error: err.message || "Internal server error."
        }, req);
      }
      return true;
    }

    const runMatch = /^\/api\/retrieval\/runs\/([^/]+)$/.exec(pathname);
    if (req.method === "GET" && runMatch) {
      try {
        const detail = await store.getRun(decodeURIComponent(runMatch[1]));
        if (!detail) {
          const error = new Error("Keyword verification run not found.") as HttpError;
          error.status = 404;
          throw error;
        }
        jsonResponse(res, authConfig, 200, detail, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, {
          error: err.message || "Internal server error."
        }, req);
      }
      return true;
    }

    return false;
  };
}
