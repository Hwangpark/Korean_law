import http from "node:http";

import { createAuthHandler, createAuthService, loadAuthConfig } from "./auth/index.js";

async function main(): Promise<void> {
  const config = loadAuthConfig();
  const service = createAuthService(config);

  await service.ensureSchema();

  const handler = createAuthHandler(service, config);
  const server = http.createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end("Internal server error.");
    });
  });

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`Auth server listening on http://0.0.0.0:${config.port}\n`);
  });

  const shutdown = async (): Promise<void> => {
    await service.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
