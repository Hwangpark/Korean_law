import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import { jsonResponse, type AnalysisHttpRouteHandler, extractBearerToken } from "./http-shared.js";
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
    if (!(req.method === "GET" && pathname === "/api/history")) {
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
      const items = await input.store.listHistory(Number(claims.sub));
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
