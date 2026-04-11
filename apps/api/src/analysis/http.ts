import type http from "node:http";
import { randomUUID } from "node:crypto";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import { ingestLink } from "../ingest/index.js";
import type { AnalysisConfig } from "./config.js";
import type { AnalysisStore } from "./store.js";

interface HttpError extends Error {
  status?: number;
}

interface AnalyzePayload {
  title?: string;
  context_type?: string;
  input_mode?: "text" | "image" | "link";
  text?: string;
  url?: string;
  image_base64?: string;
  image_name?: string;
  image_mime_type?: string;
}

function jsonResponse(
  res: http.ServerResponse,
  config: AuthConfig,
  status: number,
  body: unknown
): void {
  const payload = status === 204 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(status === 204 ? undefined : payload);
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

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function requireString(value: unknown, message: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error(message) as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function inferTitle(payload: AnalyzePayload, inputMode: "text" | "image" | "link"): string {
  const title = String(payload.title ?? "").trim();
  if (title) {
    return title;
  }
  switch (inputMode) {
    case "image":
      return "이미지 사건 파일";
    case "link":
      return "링크 사건 파일";
    default:
      return "텍스트 사건 파일";
  }
}

async function runAnalysisBridge(
  request: Record<string, unknown>,
  options: { providerMode: string }
): Promise<Record<string, unknown>> {
  // @ts-expect-error Legacy runtime pipeline is still implemented in .mjs.
  const module = await import("../orchestrator/run-analysis.mjs");
  return module.runAnalysis(request, options) as Promise<Record<string, unknown>>;
}

export function createAnalysisHandler(
  authService: AuthService,
  authConfig: AuthConfig,
  analysisConfig: AnalysisConfig,
  store: AnalysisStore
) {
  return async function handleAnalysisRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const pathname = requestPath(req);

    if (req.method === "OPTIONS" && (pathname === "/api/analyze" || pathname === "/api/history")) {
      jsonResponse(res, authConfig, 204, null);
      return true;
    }

    if (req.method === "GET" && pathname === "/api/history") {
      try {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
          const error = new Error("Unauthorized.") as HttpError;
          error.status = 401;
          throw error;
        }

        const claims = await authService.verifyToken(token);
        const items = await store.listHistory(Number(claims.sub));
        jsonResponse(res, authConfig, 200, { items });
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, {
          error: err.message || "Internal server error."
        });
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/analyze") {
      try {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
          const error = new Error("Unauthorized.") as HttpError;
          error.status = 401;
          throw error;
        }

        const claims = await authService.verifyToken(token);
        const payload = (await readJsonBody(req, analysisConfig.requestBodyLimit)) as AnalyzePayload;
        const inputMode = payload.input_mode ?? "text";
        const contextType = String(payload.context_type ?? process.env.DEFAULT_CONTEXT_TYPE ?? "community");
        const requestId = `case-${randomUUID()}`;
        const title = inferTitle(payload, inputMode);

        let request: Record<string, unknown>;
        let sourceKind: "manual" | "ocr" | "crawl";
        let sourceUrl: string | undefined;
        let originalFilename: string | undefined;
        let mimeType: string | undefined;
        let contentText = "";
        const metadata: Record<string, unknown> = { request_id: requestId };

        if (inputMode === "link") {
          const url = requireString(payload.url, "url field is required for link analysis.");
          const linkNote = String(payload.text ?? "").trim();
          const ingested = await ingestLink(
            {
              url,
              requestId,
              userId: claims.sub,
              contextType,
              timeoutMs: analysisConfig.crawlTimeoutMs,
              maxBytes: analysisConfig.crawlMaxBytes,
              followRedirects: analysisConfig.crawlFollowRedirects
            },
            {
              defaultContextType: contextType,
              timeoutMs: analysisConfig.crawlTimeoutMs,
              maxBytes: analysisConfig.crawlMaxBytes,
              followRedirects: analysisConfig.crawlFollowRedirects
            }
          );

          if (ingested.status !== "ok" || !ingested.analysisEnvelope) {
            const error = new Error(ingested.blockedReason ?? "Link ingestion blocked.") as HttpError;
            error.status = 422;
            throw error;
          }

          const analysisText = linkNote
            ? `${ingested.analysisEnvelope.text}\n\n링크 메모:\n${linkNote}`.trim()
            : ingested.analysisEnvelope.text;

          request = ingested.analysisEnvelope as unknown as Record<string, unknown>;
          request.text = analysisText;
          sourceKind = "crawl";
          sourceUrl = ingested.finalUrl ?? url;
          contentText = analysisText;
          Object.assign(metadata, {
            crawl_trace: ingested.trace,
            crawl_warnings: ingested.warnings,
            crawl_safety: ingested.safety,
            crawl_robots: ingested.robots,
            crawl_note: linkNote
          });
        } else if (inputMode === "image") {
          const rawImage = requireString(
            payload.image_base64,
            "image_base64 field is required for image analysis."
          );
          const parsedDataUrl = parseDataUrl(rawImage);
          const base64 = parsedDataUrl ? parsedDataUrl.base64 : rawImage;
          mimeType = parsedDataUrl?.mimeType ?? payload.image_mime_type ?? "image/png";
          originalFilename = String(payload.image_name ?? "upload-image");
          contentText = String(payload.text ?? "");
          request = {
            request_id: requestId,
            input_type: "image",
            context_type: contextType,
            text: contentText,
            image_base64: base64,
            image_mime_type: mimeType,
            image_name: originalFilename
          };
          sourceKind = "ocr";
          metadata.ocr_note = contentText;
        } else {
          contentText = requireString(payload.text, "text field is required for text analysis.");
          request = {
            request_id: requestId,
            input_type: "text",
            context_type: contextType,
            text: contentText
          };
          sourceKind = "manual";
        }

        const result = await runAnalysisBridge(request, {
          providerMode: analysisConfig.providerMode
        });
        const ocr = (result.ocr ?? {}) as { raw_text?: string };
        const timeline = Array.isArray(result.timeline) ? result.timeline : [];

        const saved = await store.saveAnalysis({
          userId: Number(claims.sub),
          inputMode,
          contextType,
          title,
          sourceKind,
          sourceUrl,
          originalFilename,
          mimeType,
          contentText: typeof ocr.raw_text === "string" && ocr.raw_text.trim() ? ocr.raw_text : contentText,
          metadata,
          providerMode: analysisConfig.providerMode,
          result: result as Record<string, unknown>,
          timeline
        });

        jsonResponse(res, authConfig, 200, {
          ...result,
          case_id: saved.caseId,
          run_id: saved.runId
        });
      } catch (error) {
        const err = error as HttpError;
        jsonResponse(res, authConfig, err.status ?? 500, {
          error: err.message || "Internal server error."
        });
      }
      return true;
    }

    return false;
  };
}
