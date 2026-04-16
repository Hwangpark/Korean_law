import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AnalysisHttpError } from "./http-request-context.js";

export interface ParsedAnalysisRoute {
  jobId: string;
  stream: boolean;
}

export interface ParsedReferenceRoute {
  kind: "law" | "precedent";
  id: string;
}

export type AnalysisHttpRouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
) => Promise<boolean>;

export function resolveOrigin(config: AuthConfig, req: http.IncomingMessage): string {
  const origin = req.headers.origin ?? "";
  const allowed = config.corsOrigins;
  if (allowed.includes("*") || allowed.includes(origin)) return origin || allowed[0];
  return allowed[0];
}

export function jsonResponse(
  res: http.ServerResponse,
  config: AuthConfig,
  status: number,
  body: unknown,
  req?: http.IncomingMessage
): void {
  const payload = status === 204 ? "" : JSON.stringify(body);
  const origin = req ? resolveOrigin(config, req) : config.corsOrigins[0];
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization, x-guest-id",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    vary: "Origin"
  });
  res.end(status === 204 ? undefined : payload);
}

export async function readJsonBody(
  req: http.IncomingMessage,
  limitBytes: number
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      const error = new Error("Request body is too large.") as AnalysisHttpError;
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
    const error = new Error("Request body must be valid JSON.") as AnalysisHttpError;
    error.status = 400;
    throw error;
  }
}

export function requestPath(req: http.IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

export function parseReferenceRoute(pathname: string): ParsedReferenceRoute | null {
  const match = /^\/api\/references\/([^/]+)\/(.+)$/.exec(pathname);
  if (!match) {
    return null;
  }

  const kind = match[1];
  if (kind !== "law" && kind !== "precedent") {
    return null;
  }

  return {
    kind,
    id: decodeURIComponent(match[2] ?? "")
  };
}

export function parseAnalysisRoute(pathname: string): ParsedAnalysisRoute | null {
  const match = /^\/api\/analyze\/([^/]+)(\/stream)?$/.exec(pathname);
  if (!match) {
    return null;
  }

  return {
    jobId: decodeURIComponent(match[1] ?? ""),
    stream: match[2] === "/stream"
  };
}

export function writeSseEvent(
  res: http.ServerResponse,
  eventName: string,
  payload: Record<string, unknown>
): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function isAnalysisHttpPath(pathname: string): boolean {
  return (
    pathname === "/api/analyze" ||
    pathname.startsWith("/api/analyze/") ||
    pathname === "/api/history" ||
    pathname === "/api/references/search" ||
    pathname.startsWith("/api/references/")
  );
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const [scheme, token] = String(authorizationHeader ?? "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}
