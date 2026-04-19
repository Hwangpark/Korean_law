import { randomUUID } from "node:crypto";

import { isIngestionError } from "./errors.js";
import { assertSafeUrl, assertSafeTarget } from "./net.js";
import { evaluateRobotsPolicy } from "./robots.js";
import { fetchHtml } from "./transport.js";
import { normalizeHtmlContent } from "./html.js";
import type {
  FetchHtmlOptions,
  LinkAnalysisEnvelope,
  LinkIngestionInput,
  LinkIngestionResult,
  LinkIngestionTraceEvent
} from "./types.js";

export interface LinkIngestionServiceOptions {
  defaultContextType?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  followRedirects?: number;
}

const DEFAULT_OPTIONS: Required<LinkIngestionServiceOptions> = {
  defaultContextType: "community",
  userAgent: "KoreanLawLinkBot/0.1 (+local development)",
  timeoutMs: 12_000,
  maxBytes: 2_000_000,
  followRedirects: 3
};

function now() {
  return new Date().toISOString();
}

function pushTrace(
  trace: LinkIngestionTraceEvent[],
  step: string,
  status: "ok" | "blocked" | "error",
  startedAt: string,
  detail?: string
) {
  trace.push({
    step,
    status,
    startedAt,
    endedAt: now(),
    durationMs: Date.now() - Date.parse(startedAt),
    detail
  });
}

function mergeOptions(options: LinkIngestionServiceOptions = {}) {
  return { ...DEFAULT_OPTIONS, ...options };
}

function buildEnvelope(
  requestId: string,
  contextType: string,
  sourceUrl: string,
  finalUrl: string,
  contentType: string,
  ipAddress: string,
  httpStatus: number,
  documentTitle: string,
  documentText: string
): LinkAnalysisEnvelope {
  const normalizedText = documentText.trim();
  const combinedText = documentTitle ? `${documentTitle}\n\n${normalizedText}` : normalizedText;

  return {
    request_id: requestId,
    input_type: "text",
    context_type: contextType,
    source: {
      kind: "link",
      url: sourceUrl,
      finalUrl,
      title: documentTitle,
      contentType,
      ipAddress,
      httpStatus
    },
    text: combinedText,
    title: documentTitle
  };
}

function blockedResult(
  requestId: string,
  sourceUrl: string,
  reason: string,
  trace: LinkIngestionTraceEvent[],
  warnings: string[],
  detail?: string
): LinkIngestionResult {
  return {
    status: "blocked",
    requestId,
    sourceUrl,
    safety: {
      allowed: false,
      reason,
      detail
    },
    robots: {
      checked: false,
      allowed: true,
      userAgent: DEFAULT_OPTIONS.userAgent,
      detail: "Crawl blocked before robots evaluation."
    },
    trace,
    warnings,
    blockedReason: reason
  };
}

export async function ingestLink(
  input: LinkIngestionInput,
  options: LinkIngestionServiceOptions = {}
): Promise<LinkIngestionResult> {
  const config = mergeOptions(options);
  const trace: LinkIngestionTraceEvent[] = [];
  const warnings: string[] = [];
  const requestId = input.requestId ?? `ingest-${randomUUID()}`;
  const sourceUrl = String(input.url ?? "").trim();

  if (!sourceUrl) {
    return blockedResult(requestId, sourceUrl, "invalid_url", trace, warnings, "URL is required.");
  }

  const ingestStartedAt = now();

  try {
    const candidateUrl = assertSafeUrl(sourceUrl);
    const targetCheck = await assertSafeTarget(candidateUrl);
    pushTrace(trace, "validate-url", "ok", ingestStartedAt, "URL validated and resolved.");

    const fetchOptions: FetchHtmlOptions = {
      timeoutMs: input.timeoutMs ?? config.timeoutMs,
      maxBytes: input.maxBytes ?? config.maxBytes,
      userAgent: input.userAgent ?? config.userAgent,
      followRedirects: input.followRedirects ?? config.followRedirects
    };

    const robotsStartedAt = now();
    const robots = await evaluateRobotsPolicy(candidateUrl, fetchOptions, fetchOptions.userAgent);
    pushTrace(
      trace,
      "robots",
      robots.allowed ? "ok" : "blocked",
      robotsStartedAt,
      robots.detail
    );

    if (!robots.allowed) {
      return {
        status: "blocked",
        requestId,
        sourceUrl,
        safety: {
          allowed: false,
          reason: "robots_disallowed",
          resolvedAddresses: targetCheck.addresses
        },
        robots,
        trace,
        warnings,
        blockedReason: "robots_disallowed"
      };
    }

    if (!robots.checked) {
      warnings.push("robots.txt could not be verified; manual policy review is still required.");
    }

    const fetchStartedAt = now();
    const fetched = await fetchHtml(candidateUrl, fetchOptions);
    pushTrace(trace, "fetch-html", "ok", fetchStartedAt, `${fetched.httpStatus} ${fetched.contentType}`);

    const normalizedContentType = fetched.contentType.toLowerCase();
    if (
      !normalizedContentType.startsWith("text/html") &&
      !normalizedContentType.startsWith("application/xhtml+xml")
    ) {
      pushTrace(trace, "normalize", "blocked", now(), "Non-HTML response.");
      return {
        status: "blocked",
        requestId,
        sourceUrl,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        httpStatus: fetched.httpStatus,
        ipAddress: fetched.ipAddress,
        safety: {
          allowed: false,
          reason: "non_html_content",
          resolvedAddresses: targetCheck.addresses
        },
        robots,
        trace,
        warnings: [...warnings, "Response was not HTML or XHTML."],
        blockedReason: "non_html_content"
      };
    }

    const normalizeStartedAt = now();
    const document = normalizeHtmlContent(fetched.body, candidateUrl.hostname);
    pushTrace(trace, "normalize", "ok", normalizeStartedAt, `title=${document.title || "n/a"}`);

    const analysisEnvelope = buildEnvelope(
      requestId,
      input.contextType ?? config.defaultContextType,
      sourceUrl,
      fetched.finalUrl,
      fetched.contentType,
      fetched.ipAddress,
      fetched.httpStatus,
      document.title,
      document.text
    );

    pushTrace(trace, "build-envelope", "ok", now(), "analysis envelope ready.");

    return {
      status: "ok",
      requestId,
      sourceUrl,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      httpStatus: fetched.httpStatus,
      ipAddress: fetched.ipAddress,
      safety: {
        allowed: true,
        resolvedAddresses: targetCheck.addresses
      },
      robots,
      document,
      analysisEnvelope,
      trace,
      warnings
    };
  } catch (error) {
    const ingestError = isIngestionError(error)
      ? error
      : null;
    pushTrace(
      trace,
      ingestError?.code === "timeout" ? "timeout" : "error",
      "error",
      ingestStartedAt,
      error instanceof Error ? error.message : "Unknown ingestion failure."
    );

    if (ingestError) {
      return {
        status: "blocked",
        requestId,
        sourceUrl,
        safety: {
          allowed: false,
          reason: ingestError.code,
          detail: ingestError.detail
        },
        robots: {
          checked: false,
          allowed: true,
          userAgent: config.userAgent,
          detail: "Crawl stopped by safety validation."
        },
        trace,
        warnings,
        blockedReason: ingestError.code
      };
    }

    return {
      status: "error",
      requestId,
      sourceUrl,
      safety: {
        allowed: false,
        reason: "fetch_failed",
        detail: error instanceof Error ? error.message : "Unknown failure."
      },
      robots: {
        checked: false,
        allowed: true,
        userAgent: config.userAgent,
        detail: "Crawl failed before robots evaluation."
      },
      trace,
      warnings,
      blockedReason: "fetch_failed"
    };
  }
}

export function toAnalysisRequest(result: LinkIngestionResult) {
  if (!result.analysisEnvelope) {
    throw new Error("Ingestion result does not contain an analysis envelope.");
  }

  return result.analysisEnvelope;
}
