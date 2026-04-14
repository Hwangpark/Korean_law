import type http from "node:http";

import type { AuthConfig } from "./config.js";
import type { AuthService } from "./service.js";

interface HttpError extends Error {
  status?: number;
}

function resolveOrigin(config: AuthConfig, req: http.IncomingMessage): string {
  const origin = req.headers.origin ?? "";
  const allowed = config.corsOrigins;
  if (allowed.includes("*") || allowed.includes(origin)) return origin || allowed[0];
  return allowed[0];
}

function jsonResponse(
  res: http.ServerResponse,
  config: AuthConfig,
  status: number,
  body: unknown,
  req?: http.IncomingMessage
): void {
  const hasBody = status !== 204;
  const payload = hasBody ? JSON.stringify(body) : "";
  const origin = req ? resolveOrigin(config, req) : config.corsOrigins[0];
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "vary": "Origin"
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
        jsonResponse(res, config, 204, null, req);
        return;
      }

      if (pathname === "/health") {
        jsonResponse(res, config, 200, {
          ok: true,
          service: "auth",
          time: new Date().toISOString()
        }, req);
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/signup", "/auth/register", "/api/auth/signup", "/api/auth/register"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.signup(payload);
        jsonResponse(res, config, result.status, result.body, req);
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/login", "/api/auth/login"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.login(payload);
        jsonResponse(res, config, result.status, result.body, req);
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/request-email-code", "/api/auth/request-email-code"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.requestEmailCode(payload);
        jsonResponse(res, config, result.status, result.body, req);
        return;
      }

      if (req.method === "POST" && isPath(pathname, ["/auth/verify-email-code", "/api/auth/verify-email-code"])) {
        const payload = await readJsonBody(req, config.requestBodyLimit);
        const result = await service.verifyEmailCode(payload);
        jsonResponse(res, config, result.status, result.body, req);
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
        const userId = Number(claims.sub);
        if (!Number.isFinite(userId)) {
          const error = new Error("Unauthorized.") as HttpError;
          error.status = 401;
          throw error;
        }

        const profile = await service.getUserProfile(userId);
        jsonResponse(res, config, 200, {
          user: {
            id: userId,
            email: claims.email,
            profile
          },
          profile,
          tokenType: "Bearer",
          token_type: "Bearer"
        }, req);
        return;
      }

      jsonResponse(res, config, 404, { error: "Not found." }, req);
    } catch (error) {
      const err = error as HttpError;
      jsonResponse(res, config, err.status ?? 500, {
        error: err.message || "Internal server error."
      }, req);
    }
  };
}
