import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "./config.js";
import { createAnalyzeEndpoint } from "./http-analyze.js";
import { createHistoryEndpoint } from "./http-history.js";
import { isAnalysisHttpPath, jsonResponse, requestPath } from "./http-shared.js";
import { createReferencesEndpoint } from "./http-references.js";
import { buildProfileContext } from "./profile-context.js";
import type { AnalysisJobManager } from "./jobs.js";
import type { AnalysisStore } from "./store.js";

export function createAnalysisHandler(
  authService: AuthService,
  authConfig: AuthConfig,
  analysisConfig: AnalysisConfig,
  store: AnalysisStore,
  jobManager: AnalysisJobManager
) {
  const authProfileService = authService as AuthService & {
    getUserProfile?: (userId: number) => Promise<Record<string, unknown> | null>;
  };

  async function loadProfileContext(userId: number): Promise<Record<string, unknown> | null> {
    if (!authProfileService.getUserProfile) {
      return null;
    }

    const profile = await authProfileService.getUserProfile(userId);
    const context = buildProfileContext(profile);
    return context ? (context as unknown as Record<string, unknown>) : null;
  }

  const analyzeEndpoint = createAnalyzeEndpoint({
    authService,
    authConfig,
    analysisConfig,
    store,
    jobManager,
    loadProfileContext
  });
  const historyEndpoint = createHistoryEndpoint({
    authService,
    authConfig,
    store
  });
  const referencesEndpoint = createReferencesEndpoint({
    authConfig,
    store
  });

  return async function handleAnalysisRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const pathname = requestPath(req);

    if (req.method === "OPTIONS" && isAnalysisHttpPath(pathname)) {
      jsonResponse(res, authConfig, 204, null, req);
      return true;
    }

    for (const endpoint of [analyzeEndpoint, historyEndpoint, referencesEndpoint]) {
      if (await endpoint(req, res, pathname)) {
        return true;
      }
    }

    return false;
  };
}
