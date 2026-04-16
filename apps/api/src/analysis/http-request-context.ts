import { randomUUID } from "node:crypto";
import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import { resolveClientIp } from "../http/client-ip.js";
import { ingestLink } from "../ingest/index.js";
import type { AnalysisConfig } from "./config.js";
import type { AnalysisStore, GuestUsageResult } from "./store.js";

export interface AnalysisHttpError extends Error {
  status?: number;
  guestUsage?: GuestUsageResult | null;
}

export interface AnalyzePayload {
  title?: string;
  context_type?: string;
  input_mode?: "text" | "image" | "link";
  text?: string;
  url?: string;
  image_base64?: string;
  image_name?: string;
  image_mime_type?: string;
  guest_id?: string;
}

export interface PreparedAnalysisRequestContext {
  request: Record<string, unknown>;
  claims: Awaited<ReturnType<AuthService["verifyToken"]>> | null;
  guestUsage: GuestUsageResult | null;
  profileContext: Record<string, unknown> | null;
  inputMode: "text" | "image" | "link";
  contextType: string;
  title: string;
  sourceKind: "manual" | "ocr" | "crawl";
  sourceUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
}

interface PrepareAnalysisRequestContextInput {
  req: http.IncomingMessage;
  payload: AnalyzePayload;
  authService: AuthService;
  authConfig: AuthConfig;
  analysisConfig: AnalysisConfig;
  store: AnalysisStore;
  loadProfileContext: (userId: number) => Promise<Record<string, unknown> | null>;
}

function createHttpError(message: string, status: number): AnalysisHttpError {
  const error = new Error(message) as AnalysisHttpError;
  error.status = status;
  return error;
}

function createGuestLimitError(guestUsage: GuestUsageResult): AnalysisHttpError {
  const error = createHttpError(
    "비로그인 사용자는 IP 기준으로 하루 10회까지만 분석할 수 있습니다.",
    429
  );
  error.guestUsage = guestUsage;
  return error;
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const [scheme, token] = String(authorizationHeader ?? "").split(" ");
  return scheme === "Bearer" && token ? token : null;
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
    throw createHttpError(message, 422);
  }
  return normalized;
}

function requireGuestId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = String(candidate ?? "").trim();
  if (!normalized) {
    throw createHttpError("guest_id is required for guest analysis.", 422);
  }
  if (normalized.length > 128) {
    throw createHttpError("guest_id is too long.", 422);
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
      return "이미지 증거 파일";
    case "link":
      return "링크 증거 파일";
    default:
      return "텍스트 증거 파일";
  }
}

async function consumeGuestUsageOrThrow(
  store: AnalysisStore,
  guestId: string | null,
  clientIp: string
): Promise<GuestUsageResult> {
  const guestUsage = await store.consumeGuestAnalysis(
    {
      guestId,
      ipAddress: clientIp
    },
    10
  );

  if (!guestUsage.allowed) {
    throw createGuestLimitError(guestUsage);
  }

  return guestUsage;
}

export async function prepareAnalysisRequestContext(
  input: PrepareAnalysisRequestContextInput
): Promise<PreparedAnalysisRequestContext> {
  const token = extractBearerToken(input.req.headers.authorization);
  const inputMode = input.payload.input_mode ?? "text";
  const contextType = String(
    input.payload.context_type ?? process.env.DEFAULT_CONTEXT_TYPE ?? "community"
  );
  const requestId = `case-${randomUUID()}`;
  const title = inferTitle(input.payload, inputMode);
  const isAuthenticated = Boolean(token);
  const guestIdCandidate = String(
    input.req.headers["x-guest-id"] ?? input.payload.guest_id ?? ""
  ).trim();
  const guestId = guestIdCandidate ? requireGuestId(guestIdCandidate) : null;
  const clientIp = resolveClientIp(input.authConfig, input.req);
  const metadata: Record<string, unknown> = {
    request_id: requestId
  };

  let claims: Awaited<ReturnType<AuthService["verifyToken"]>> | null = null;
  let guestUsage: GuestUsageResult | null = null;
  let profileContext: Record<string, unknown> | null = null;

  if (isAuthenticated) {
    claims = await input.authService.verifyToken(String(token));
    profileContext = await input.loadProfileContext(Number(claims.sub));
  }

  if (inputMode === "link") {
    const url = requireString(input.payload.url, "url field is required for link analysis.");
    const linkNote = String(input.payload.text ?? "").trim();
    if (!isAuthenticated) {
      guestUsage = await consumeGuestUsageOrThrow(input.store, guestId, clientIp);
    }
    const ingested = await ingestLink(
      {
        url,
        requestId,
        userId: isAuthenticated ? claims?.sub : undefined,
        contextType,
        timeoutMs: input.analysisConfig.crawlTimeoutMs,
        maxBytes: input.analysisConfig.crawlMaxBytes,
        followRedirects: input.analysisConfig.crawlFollowRedirects
      },
      {
        defaultContextType: contextType,
        timeoutMs: input.analysisConfig.crawlTimeoutMs,
        maxBytes: input.analysisConfig.crawlMaxBytes,
        followRedirects: input.analysisConfig.crawlFollowRedirects
      }
    );

    if (ingested.status !== "ok" || !ingested.analysisEnvelope) {
      throw createHttpError(ingested.blockedReason ?? "Link ingestion blocked.", 422);
    }

    const analysisText = linkNote
      ? `${ingested.analysisEnvelope.text}\n\n링크 메모:\n${linkNote}`.trim()
      : ingested.analysisEnvelope.text;

    Object.assign(metadata, {
      crawl_trace: ingested.trace,
      crawl_warnings: ingested.warnings,
      crawl_safety: ingested.safety,
      crawl_robots: ingested.robots,
      crawl_note: linkNote
    });

    return {
      request: {
        ...(ingested.analysisEnvelope as unknown as Record<string, unknown>),
        text: analysisText
      },
      claims,
      guestUsage,
      profileContext,
      inputMode,
      contextType,
      title,
      sourceKind: "crawl",
      sourceUrl: ingested.finalUrl ?? url,
      metadata
    };
  }

  if (inputMode === "image") {
    const rawImage = requireString(
      input.payload.image_base64,
      "image_base64 field is required for image analysis."
    );
    const parsedDataUrl = parseDataUrl(rawImage);
    const base64 = parsedDataUrl ? parsedDataUrl.base64 : rawImage;
    const mimeType = parsedDataUrl?.mimeType ?? input.payload.image_mime_type ?? "image/png";
    const originalFilename = String(input.payload.image_name ?? "upload-image");
    const ocrNote = String(input.payload.text ?? "");

    if (!isAuthenticated) {
      guestUsage = await consumeGuestUsageOrThrow(input.store, guestId, clientIp);
    }

    metadata.ocr_note = ocrNote;

    return {
      request: {
        request_id: requestId,
        input_type: "image",
        context_type: contextType,
        text: ocrNote,
        image_base64: base64,
        image_mime_type: mimeType,
        image_name: originalFilename
      },
      claims,
      guestUsage,
      profileContext,
      inputMode,
      contextType,
      title,
      sourceKind: "ocr",
      originalFilename,
      mimeType,
      metadata
    };
  }

  const contentText = requireString(input.payload.text, "text field is required for text analysis.");
  if (!isAuthenticated) {
    guestUsage = await consumeGuestUsageOrThrow(input.store, guestId, clientIp);
  }
  return {
    request: {
      request_id: requestId,
      input_type: "text",
      context_type: contextType,
      text: contentText
    },
    claims,
    guestUsage,
    profileContext,
    inputMode,
    contextType,
    title,
    sourceKind: "manual",
    metadata
  };
}
