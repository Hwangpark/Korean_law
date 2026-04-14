import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "../analysis/config.js";
import { buildProfileContext } from "../analysis/profile-context.js";
import type { AnalysisStore, GuestUsageResult } from "../analysis/store.js";
import { createRetrievalAdapter } from "./mcp-adapter.js";
import { buildKeywordQueryPlan } from "./planner.js";
import type { KeywordVerificationService } from "./service.js";
import type { KeywordContextType } from "./types.js";

interface HttpError extends Error {
  status?: number;
}

interface VerifyPayload {
  query?: string;
  context_type?: KeywordContextType;
  guest_id?: string;
  limit?: number;
  profile_context?: Record<string, unknown>;
  law_id?: string;
  precedent_id?: string;
}

const ALLOWED_CONTEXT_TYPES = new Set<KeywordContextType>([
  "community",
  "game_chat",
  "messenger",
  "other"
]);

const TOOL_DESCRIPTIONS = [
  {
    name: "search_law_tool",
    description: "입력어와 문맥에 맞는 관련 법령을 검색합니다.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_law_detail_tool",
    description: "search_law_tool 결과에서 받은 law_id로 법령 상세를 조회합니다.",
    parameters: {
      law_id: "string"
    }
  },
  {
    name: "search_precedent_tool",
    description: "입력어와 문맥에 맞는 유사 판례를 검색합니다.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_precedent_detail_tool",
    description: "search_precedent_tool 결과에서 받은 precedent_id로 판례 상세를 조회합니다.",
    parameters: {
      precedent_id: "string"
    }
  }
];

function resolveOrigin(config: AuthConfig, req: http.IncomingMessage): string {
  const origin = req.headers.origin ?? "";
  const allowed = config.corsOrigins;
  if (allowed.includes("*") || allowed.includes(origin)) {
    return origin || allowed[0];
  }
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
    "access-control-allow-headers": "content-type, authorization, x-guest-id",
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

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const [scheme, token] = String(authorizationHeader ?? "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

function requestPath(req: http.IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function requireString(value: unknown, message: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error(message) as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function requireGuestId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error("guest_id is required for guest verification.") as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function parseContextType(value: unknown): KeywordContextType {
  const normalized = String(value ?? "community").trim() as KeywordContextType;
  if (!ALLOWED_CONTEXT_TYPES.has(normalized)) {
    const error = new Error("context_type must be one of community, game_chat, messenger, other.") as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function formatGuestUsage(usage: GuestUsageResult): Record<string, unknown> {
  return {
    guest_id: usage.guestId,
    used: usage.usageCount,
    limit: usage.limit,
    remaining: usage.remaining
  };
}

export function createKeywordVerificationHandler(
  authService: AuthService,
  authConfig: AuthConfig,
  analysisConfig: AnalysisConfig,
  analysisStore: AnalysisStore,
  keywordService: KeywordVerificationService
) {
  const authProfileService = authService as AuthService & {
    getUserProfile?: (userId: number) => Promise<Record<string, unknown> | null>;
  };
  const adapter = createRetrievalAdapter(analysisConfig.providerMode);

  async function loadProfileContext(userId: number): Promise<Record<string, unknown> | null> {
    if (!authProfileService.getUserProfile) {
      return null;
    }

    const profile = await authProfileService.getUserProfile(userId);
    const context = buildProfileContext(profile);
    return context ? (context as unknown as Record<string, unknown>) : null;
  }

  async function resolveProfileContext(
    token: string | null,
    payloadProfileContext: Record<string, unknown> | undefined
  ): Promise<Record<string, unknown> | null> {
    const explicitContext = buildProfileContext(payloadProfileContext);
    if (explicitContext) {
      return explicitContext as unknown as Record<string, unknown>;
    }

    if (!token) {
      return null;
    }

    const claims = await authService.verifyToken(token);
    return loadProfileContext(Number(claims.sub));
  }

  return async function handleKeywordVerificationRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const pathname = requestPath(req);
    const isToolListPath = pathname === "/api/tools" || pathname === "/tools";
    const searchLawPath = pathname === "/api/tools/search_law_tool" || pathname === "/tools/search_law_tool";
    const getLawPath = pathname === "/api/tools/get_law_detail_tool" || pathname === "/tools/get_law_detail_tool";
    const searchPrecedentPath =
      pathname === "/api/tools/search_precedent_tool" || pathname === "/tools/search_precedent_tool";
    const getPrecedentPath =
      pathname === "/api/tools/get_precedent_detail_tool" || pathname === "/tools/get_precedent_detail_tool";

    if (
      req.method === "OPTIONS" &&
      (
        pathname === "/api/keywords/verify" ||
        isToolListPath ||
        pathname.startsWith("/api/tools/") ||
        pathname.startsWith("/tools/")
      )
    ) {
      jsonResponse(res, authConfig, 204, null, req);
      return true;
    }

    if (req.method === "GET" && isToolListPath) {
      jsonResponse(res, authConfig, 200, { tools: TOOL_DESCRIPTIONS }, req);
      return true;
    }

    if (req.method === "POST" && searchLawPath) {
      try {
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerifyPayload;
        const token = extractBearerToken(req.headers.authorization);
        const query = requireString(payload.query, "query field is required.");
        const contextType = parseContextType(payload.context_type);
        const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? Math.min(Math.max(Math.floor(payload.limit), 1), 10)
          : 5;
        const profileContext = await resolveProfileContext(token, payload.profile_context);
        const plan = buildKeywordQueryPlan(query, contextType, profileContext ?? undefined);
        const laws = await adapter.searchLaws(plan, limit);
        const items = await analysisStore.saveReferenceLibrary({
          providerMode: analysisConfig.providerMode,
          result: { law_search: { laws } }
        });

        jsonResponse(res, authConfig, 200, {
          query,
          context_type: contextType,
          count: items.length,
          items
        }, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, { error: err.message || "Internal server error." }, req);
      }
      return true;
    }

    if (req.method === "POST" && searchPrecedentPath) {
      try {
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerifyPayload;
        const token = extractBearerToken(req.headers.authorization);
        const query = requireString(payload.query, "query field is required.");
        const contextType = parseContextType(payload.context_type);
        const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? Math.min(Math.max(Math.floor(payload.limit), 1), 10)
          : 5;
        const profileContext = await resolveProfileContext(token, payload.profile_context);
        const plan = buildKeywordQueryPlan(query, contextType, profileContext ?? undefined);
        const precedents = await adapter.searchPrecedents(plan, limit);
        const items = await analysisStore.saveReferenceLibrary({
          providerMode: analysisConfig.providerMode,
          result: { precedent_search: { precedents } }
        });

        jsonResponse(res, authConfig, 200, {
          query,
          context_type: contextType,
          count: items.length,
          items
        }, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, { error: err.message || "Internal server error." }, req);
      }
      return true;
    }

    if (req.method === "POST" && getLawPath) {
      try {
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerifyPayload;
        const lawId = requireString(payload.law_id, "law_id field is required.");
        const item = await analysisStore.getReferenceByKindAndId("law", lawId);
        if (!item) {
          const error = new Error("Law reference not found.") as HttpError;
          error.status = 404;
          throw error;
        }
        jsonResponse(res, authConfig, 200, { item }, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, { error: err.message || "Internal server error." }, req);
      }
      return true;
    }

    if (req.method === "POST" && getPrecedentPath) {
      try {
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerifyPayload;
        const precedentId = requireString(payload.precedent_id, "precedent_id field is required.");
        const item = await analysisStore.getReferenceByKindAndId("precedent", precedentId);
        if (!item) {
          const error = new Error("Precedent reference not found.") as HttpError;
          error.status = 404;
          throw error;
        }
        jsonResponse(res, authConfig, 200, { item }, req);
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, { error: err.message || "Internal server error." }, req);
      }
      return true;
    }

    if (pathname !== "/api/keywords/verify") {
      return false;
    }

    if (req.method !== "POST") {
      jsonResponse(res, authConfig, 405, { error: "Method not allowed." }, req);
      return true;
    }

    try {
      const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as VerifyPayload;
      const query = requireString(payload.query, "query field is required.");
      const contextType = parseContextType(payload.context_type);
      const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.min(Math.max(Math.floor(payload.limit), 1), 6)
        : 4;
      const token = extractBearerToken(req.headers.authorization);

      if (token) {
        const claims = await authService.verifyToken(token);
        const profileContext = await loadProfileContext(Number(claims.sub));
        const result = await keywordService.verifyKeyword(
          {
            query,
            contextType,
            limit,
            profileContext: profileContext ?? undefined
          },
          {
            userId: Number(claims.sub)
          }
        );
        jsonResponse(
          res,
          authConfig,
          200,
          profileContext
            ? {
                ...result,
                profile_context: result.profile_context ?? profileContext
              }
            : result,
          req
        );
        return true;
      }

      const guestId = requireGuestId(req.headers["x-guest-id"] ?? payload.guest_id);
      const guestUsage = await analysisStore.consumeGuestAnalysis(guestId, 3);
      if (!guestUsage.allowed) {
        jsonResponse(
          res,
          authConfig,
          429,
          {
            error: "비로그인 사용자는 검증을 3회까지만 사용할 수 있습니다.",
            guest_usage: formatGuestUsage(guestUsage),
            guest_remaining: guestUsage.remaining
          },
          req
        );
        return true;
      }

      const result = await keywordService.verifyKeyword(
        {
          query,
          contextType,
          limit
        },
        {
          guestId
        }
      );

      jsonResponse(
        res,
        authConfig,
        200,
        {
          ...result,
          guest_id: guestUsage.guestId,
          guest_remaining: guestUsage.remaining
        },
        req
      );
      return true;
    } catch (error) {
      const err = error as HttpError;
      jsonResponse(res, authConfig, err.status ?? 500, {
        error: err.message || "Internal server error."
      }, req);
      return true;
    }
  };
}
