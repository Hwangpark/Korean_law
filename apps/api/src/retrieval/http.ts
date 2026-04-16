import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "../analysis/config.js";
import type { AnalysisStore } from "../analysis/store.js";
import { createKeywordEndpoint } from "./http-keywords.js";
import { jsonResponse, isRetrievalHttpPath, requestPath } from "./http-shared.js";
import { createToolsEndpoint } from "./http-tools.js";
import type { KeywordVerificationService } from "./service.js";

export function createKeywordVerificationHandler(
  authService: AuthService,
  authConfig: AuthConfig,
  analysisConfig: AnalysisConfig,
  analysisStore: AnalysisStore,
  keywordService: KeywordVerificationService
) {
  const toolsEndpoint = createToolsEndpoint({
    authService,
    authConfig,
    analysisConfig,
    analysisStore
  });
  const keywordEndpoint = createKeywordEndpoint({
    authService,
    authConfig,
    analysisConfig,
    analysisStore,
    keywordService
  });

  return async function handleKeywordVerificationRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const pathname = requestPath(req);

    if (req.method === "OPTIONS" && isRetrievalHttpPath(pathname)) {
      jsonResponse(res, authConfig, 204, null, req);
      return true;
    }

    for (const endpoint of [toolsEndpoint, keywordEndpoint]) {
      if (await endpoint(req, res, pathname)) {
        return true;
      }
    }

    return false;
  };
}
