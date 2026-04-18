import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import { jsonResponse, type AnalysisHttpRouteHandler, extractBearerToken } from "./http-shared.js";
import { buildPublicAnalysisResult } from "./privacy.js";
import type { AnalysisHttpError } from "./http-request-context.js";
import type { AnalysisStore } from "./store.js";

interface CreateHistoryEndpointInput {
  authService: AuthService;
  authConfig: AuthConfig;
  store: AnalysisStore;
}

export function createHistoryEndpoint(
  input: CreateHistoryEndpointInput
): AnalysisHttpRouteHandler {
  return async function handleHistoryRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const isHistoryList = req.method === "GET" && pathname === "/api/history";
    const detailMatch = req.method === "GET" ? /^\/api\/history\/([^/]+)$/.exec(pathname) : null;
    if (!isHistoryList && !detailMatch) {
      return false;
    }

    try {
      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        const error = new Error("Unauthorized.") as AnalysisHttpError;
        error.status = 401;
        throw error;
      }

      const claims = await input.authService.verifyToken(token);
      const userId = Number(claims.sub);

      if (detailMatch) {
        const caseId = decodeURIComponent(detailMatch[1] ?? "");
        const item = await input.store.getHistoryDetail(userId, caseId);
        if (!item) {
          const error = new Error("History item not found.") as AnalysisHttpError;
          error.status = 404;
          throw error;
        }

        const resultRecord = item.result ?? {};
        const publicResult = buildPublicAnalysisResult(
          item.caseId,
          {
            ...resultRecord,
            timeline: item.timeline,
            legal_analysis: {
              ...(((resultRecord as Record<string, unknown>).legal_analysis ?? {}) as Record<string, unknown>),
              ...(item.profileContext ? { profile_context: item.profileContext } : {})
            }
          },
          item.referenceLibrary,
          { caseId: item.caseId }
        );

        jsonResponse(res, input.authConfig, 200, {
          ...publicResult,
          title: item.title,
          input_mode: item.inputMode,
          context_type: item.contextType,
          created_at: item.createdAt,
          source_url: item.sourceUrl
        }, req);
        return true;
      }

      const items = await input.store.listHistory(userId);
      jsonResponse(res, input.authConfig, 200, { items }, req);
    } catch (error) {
      const err = error as AnalysisHttpError;
      jsonResponse(
        res,
        input.authConfig,
        err.status ?? 500,
        {
          error: err.message || "Internal server error."
        },
        req
      );
    }

    return true;
  };
}
