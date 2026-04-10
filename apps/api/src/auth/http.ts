import type http from "node:http";

import type { AuthConfig } from "./config.js";
import type { AuthService } from "./service.js";

interface HttpError extends Error {
  status?: number;
}

function jsonResponse(
  res: http.ServerResponse,
  config: AuthConfig,
  status: number,
  body: unknown
): void {
  const hasBody = status !== 204;
  const payload = hasBody ? JSON.stringify(body) : "";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(hasBody ? payload : undefined);
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

function isPath(pathname: string, allowed: string[]): boolean {
  return allowed.includes(pathname);
}

export function createAuthHandler(service: AuthService, config: AuthConfig) {
  return async function handleAuthRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const pathname = requestPath(req);

      if (req.method === "OPTIONS") {
        jsonResponse(res, config, 204, null);
        return;
      }

      if (pathname === "/health") {
        jsonResponse(res, config, 200, {
          ok: true,
          service: "auth",
          time: new Date().toISOString()
        });
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/signup", "/auth/register", "/api/auth/signup", "/api/auth/register"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.signup(payload);
        jsonResponse(res, config, result.status, result.body);
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/login", "/api/auth/login"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.login(payload);
        jsonResponse(res, config, result.status, result.body);
        return;
      }

      if (req.method === "GET" && isPath(pathname, ["/auth/me", "/api/auth/me"])) {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
          const error = new Error("Unauthorized.") as HttpError;
          error.status = 401;
          throw error;
        }

        const claims = await service.verifyToken(token);
        jsonResponse(res, config, 200, {
          user: {
            id: Number(claims.sub),
            email: claims.email
          },
          tokenType: "Bearer",
          token_type: "Bearer"
        });
        return;
      }

      jsonResponse(res, config, 404, { error: "Not found." });
    } catch (error) {
      const err = error as HttpError;
      jsonResponse(res, config, err.status ?? 500, {
        error: err.message || "Internal server error."
      });
    }
  };
}
