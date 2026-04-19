import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "../analysis/config.js";
import type { AnalysisStore, GuestUsageResult } from "../analysis/store.js";
import { resolveClientIp } from "../http/client-ip.js";
import {
  buildKeywordGuestEnvelope,
  buildKeywordGuestLimitEnvelope
} from "./http-envelope.js";
import {
  extractBearerToken,
  jsonResponse,
  readJsonBody,
  type RetrievalHttpError,
  type RetrievalHttpRouteHandler
} from "./http-shared.js";
import type { KeywordContextType } from "./types.js";
import { createRetrievalTools, listTools } from "./tools.js";

interface VerifyPayload {
  query?: string;
  context_type?: KeywordContextType;
  guest_id?: string;
  limit?: number;
  profile_context?: Record<string, unknown>;
  law_id?: string;
  precedent_id?: string;
}

interface CreateToolsEndpointInput {
  authService: AuthService;
  authConfig: AuthConfig;
  analysisConfig: AnalysisConfig;
  analysisStore: AnalysisStore;
}

interface SearchAuthorization {
  token: string | null;
  guestUsage: GuestUsageResult | null;
}

interface GuestLimitHttpError extends RetrievalHttpError {
  guestUsage?: GuestUsageResult;
}

function createRetrievalHttpError(message: string, status: number): RetrievalHttpError {
  const error = new Error(message) as RetrievalHttpError;
  error.status = status;
  return error;
}

function requireString(value: unknown, message: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw createRetrievalHttpError(message, 422);
  }
  return normalized;
}

function requireGuestId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 128) {
    throw createRetrievalHttpError("guest_id is too long.", 422);
  }
  return normalized;
}

async function authorizeSearchRequest(
  input: CreateToolsEndpointInput,
  req: http.IncomingMessage,
  payload: VerifyPayload
): Promise<SearchAuthorization> {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    await input.authService.verifyToken(token);
    return {
      token,
      guestUsage: null
    };
  }

  const guestId = requireGuestId(req.headers["x-guest-id"] ?? payload.guest_id ?? "");
  const guestUsage = await input.analysisStore.consumeGuestAnalysis(
    {
      guestId,
      ipAddress: resolveClientIp(input.authConfig, req)
    },
    10
  );

  if (!guestUsage.allowed) {
    const error = createRetrievalHttpError(
      String(buildKeywordGuestLimitEnvelope(guestUsage).error),
      429
    ) as GuestLimitHttpError;
    error.guestUsage = guestUsage;
    throw error;
  }

  return {
    token: null,
    guestUsage
  };
}

function buildToolSearchEnvelope(
  result: object,
  authorization: SearchAuthorization
): Record<string, unknown> {
  const publicResult = result as Record<string, unknown>;
  if (!authorization.guestUsage) {
    return publicResult;
  }

  return buildKeywordGuestEnvelope(publicResult, authorization.guestUsage);
}

export function createToolsEndpoint(
  input: CreateToolsEndpointInput
): RetrievalHttpRouteHandler {
  const retrievalTools = createRetrievalTools({
    providerMode: input.analysisConfig.providerMode,
    authService: input.authService,
    analysisStore: input.analysisStore
  });

  return async function handleToolsRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const isToolListPath = pathname === "/api/tools" || pathname === "/tools";
    const searchLawPath = pathname === "/api/tools/search_law_tool" || pathname === "/tools/search_law_tool";
    const getLawPath = pathname === "/api/tools/get_law_detail_tool" || pathname === "/tools/get_law_detail_tool";
    const searchPrecedentPath =
      pathname === "/api/tools/search_precedent_tool" || pathname === "/tools/search_precedent_tool";
    const getPrecedentPath =
      pathname === "/api/tools/get_precedent_detail_tool" || pathname === "/tools/get_precedent_detail_tool";

    if (req.method === "GET" && isToolListPath) {
      jsonResponse(res, input.authConfig, 200, listTools(), req);
      return true;
    }

    if (req.method === "POST" && searchLawPath) {
      try {
        const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as VerifyPayload;
        requireString(payload.query, "query field is required.");
        const authorization = await authorizeSearchRequest(input, req, payload);
        const result = await retrievalTools.searchLawTool({
          query: payload.query,
          context_type: payload.context_type,
          limit: payload.limit,
          profile_context: payload.profile_context,
          token: authorization.token
        });

        jsonResponse(
          res,
          input.authConfig,
          200,
          buildToolSearchEnvelope(result as unknown as Record<string, unknown>, authorization),
          req
        );
      } catch (error) {
        const err = error as GuestLimitHttpError;
        const guestLimitEnvelope = err.status === 429 && err.guestUsage
          ? buildKeywordGuestLimitEnvelope(err.guestUsage)
          : null;
        jsonResponse(
          res,
          input.authConfig,
          err.status ?? 500,
          guestLimitEnvelope ?? { error: err.message || "Internal server error." },
          req
        );
      }
      return true;
    }

    if (req.method === "POST" && searchPrecedentPath) {
      try {
        const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as VerifyPayload;
        requireString(payload.query, "query field is required.");
        const authorization = await authorizeSearchRequest(input, req, payload);
        const result = await retrievalTools.searchPrecedentTool({
          query: payload.query,
          context_type: payload.context_type,
          limit: payload.limit,
          profile_context: payload.profile_context,
          token: authorization.token
        });

        jsonResponse(
          res,
          input.authConfig,
          200,
          buildToolSearchEnvelope(result as unknown as Record<string, unknown>, authorization),
          req
        );
      } catch (error) {
        const err = error as GuestLimitHttpError;
        const guestLimitEnvelope = err.status === 429 && err.guestUsage
          ? buildKeywordGuestLimitEnvelope(err.guestUsage)
          : null;
        jsonResponse(
          res,
          input.authConfig,
          err.status ?? 500,
          guestLimitEnvelope ?? { error: err.message || "Internal server error." },
          req
        );
      }
      return true;
    }

    if (req.method === "POST" && getLawPath) {
      try {
        const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as VerifyPayload;
        const result = await retrievalTools.getLawDetailTool({
          law_id: payload.law_id
        });
        jsonResponse(res, input.authConfig, 200, result, req);
      } catch (error) {
        const err = error as RetrievalHttpError;
        jsonResponse(
          res,
          input.authConfig,
          err.status ?? 500,
          { error: err.message || "Internal server error." },
          req
        );
      }
      return true;
    }

    if (req.method === "POST" && getPrecedentPath) {
      try {
        const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as VerifyPayload;
        const result = await retrievalTools.getPrecedentDetailTool({
          precedent_id: payload.precedent_id
        });
        jsonResponse(res, input.authConfig, 200, result, req);
      } catch (error) {
        const err = error as RetrievalHttpError;
        jsonResponse(
          res,
          input.authConfig,
          err.status ?? 500,
          { error: err.message || "Internal server error." },
          req
        );
      }
      return true;
    }

    return false;
  };
}
