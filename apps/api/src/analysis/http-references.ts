import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import {
  extractBearerToken,
  jsonResponse,
  parseReferenceRoute,
  type AnalysisHttpRouteHandler
} from "./http-shared.js";
import type { AnalysisHttpError } from "./http-request-context.js";
import type { AnalysisStore } from "./store.js";

interface CreateReferencesEndpointInput {
  authConfig: AuthConfig;
  authService: AuthService;
  store: AnalysisStore;
}

async function requireReferenceAccess(
  authService: AuthService,
  authorizationHeader: string | undefined
): Promise<void> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    const error = new Error("Authentication is required for reference access.") as AnalysisHttpError;
    error.status = 401;
    throw error;
  }

  await authService.verifyToken(token);
}

export function createReferencesEndpoint(
  input: CreateReferencesEndpointInput
): AnalysisHttpRouteHandler {
  return async function handleReferencesRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (req.method === "GET" && pathname === "/api/references/search") {
      try {
        await requireReferenceAccess(input.authService, req.headers.authorization);
        const searchUrl = new URL(req.url ?? "/api/references/search", "http://localhost");
        const query = String(searchUrl.searchParams.get("q") ?? "").trim();
        if (!query) {
          const error = new Error("q query parameter is required.") as AnalysisHttpError;
          error.status = 422;
          throw error;
        }

        const items = await input.store.searchReferences(query, 12);
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
    }

    if (req.method !== "GET") {
      return false;
    }

    const referenceRoute = parseReferenceRoute(pathname);
    if (!referenceRoute) {
      return false;
    }

    try {
      await requireReferenceAccess(input.authService, req.headers.authorization);
      const item = await input.store.getReferenceByKindAndId(
        referenceRoute.kind,
        referenceRoute.id
      );
      if (!item) {
        const error = new Error("Reference not found.") as AnalysisHttpError;
        error.status = 404;
        throw error;
      }

      jsonResponse(res, input.authConfig, 200, { item }, req);
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
