import http from "node:http";

import { createAuthHandler, createAuthService, loadAuthConfig } from "./auth/index.js";
import { createPostgresClient } from "./auth/postgres.js";
import { loadAnalysisConfig } from "./analysis/config.js";
import { createAnalysisHandler } from "./analysis/http.js";
import { createAnalysisJobManager } from "./analysis/jobs.js";
import { createAnalysisStore } from "./analysis/store.js";
import {
  createKeywordVerificationHandler,
  createKeywordVerificationService,
  createKeywordVerificationStore
} from "./retrieval/index.js";

async function main(): Promise<void> {
  const config = loadAuthConfig();
  const analysisConfig = loadAnalysisConfig();
  const service = createAuthService(config);
  const analysisDb = createPostgresClient(config.database);
  const analysisStore = createAnalysisStore(analysisDb);
  const analysisJobManager = createAnalysisJobManager();
  const keywordStore = createKeywordVerificationStore(analysisDb);
  const keywordService = createKeywordVerificationService({
    providerMode: analysisConfig.providerMode,
    analysisStore,
    keywordStore
  });

  await service.ensureSchema();
  await analysisStore.ensureSchema();
  await keywordStore.ensureSchema();

  const handler = createAuthHandler(service, config);
  const analysisHandler = createAnalysisHandler(
    service,
    config,
    analysisConfig,
    analysisStore,
    analysisJobManager
  );
  const keywordHandler = createKeywordVerificationHandler(
    service,
    config,
    analysisConfig,
    analysisStore,
    keywordService
  );
  const server = http.createServer((req, res) => {
    void Promise.resolve()
      .then(async () => {
        const keywordHandled = await keywordHandler(req, res);
        if (keywordHandled) return;

        const analysisHandled = await analysisHandler(req, res);
        if (analysisHandled) return;

        await handler(req, res);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end("Internal server error.");
      });
  });

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`KoreanLaw API listening on http://0.0.0.0:${config.port}\n`);
  });

  const shutdown = async (): Promise<void> => {
    await service.close();
    await analysisDb.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
