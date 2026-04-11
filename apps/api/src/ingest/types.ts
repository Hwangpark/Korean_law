export type LinkIngestionStatus = "ok" | "blocked" | "error";

export type LinkIngestionBlockReason =
  | "invalid_url"
  | "invalid_scheme"
  | "unsafe_host"
  | "robots_disallowed"
  | "non_html_content"
  | "payload_too_large"
  | "timeout"
  | "fetch_failed";

export interface LinkIngestionInput {
  url: string;
  requestId?: string;
  userId?: string | number;
  contextType?: string;
  userAgent?: string;
  maxBytes?: number;
  timeoutMs?: number;
  followRedirects?: number;
}

export interface LinkIngestionTraceEvent {
  step: string;
  status: "ok" | "blocked" | "error";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  detail?: string;
}

export interface LinkSafetyDecision {
  allowed: boolean;
  reason?: LinkIngestionBlockReason | string;
  detail?: string;
  resolvedAddresses?: string[];
}

export interface RobotsDecision {
  checked: boolean;
  allowed: boolean;
  sourceUrl?: string;
  userAgent: string;
  detail?: string;
  rules?: {
    allow: string[];
    disallow: string[];
  };
}

export interface NormalizedContent {
  title: string;
  text: string;
  excerpt: string;
  wordCount: number;
  contentHash: string;
}

export interface LinkAnalysisEnvelope {
  request_id: string;
  input_type: "text";
  context_type: string;
  source: {
    kind: "link";
    url: string;
    finalUrl: string;
    title: string;
    contentType: string;
    ipAddress: string;
    httpStatus: number;
  };
  text: string;
  title: string;
}

export interface LinkIngestionResult {
  status: LinkIngestionStatus;
  requestId: string;
  sourceUrl: string;
  finalUrl?: string;
  contentType?: string;
  httpStatus?: number;
  ipAddress?: string;
  safety: LinkSafetyDecision;
  robots: RobotsDecision;
  document?: NormalizedContent;
  analysisEnvelope?: LinkAnalysisEnvelope;
  trace: LinkIngestionTraceEvent[];
  warnings: string[];
  blockedReason?: LinkIngestionBlockReason | string;
}

export interface FetchHtmlOptions {
  timeoutMs: number;
  maxBytes: number;
  userAgent: string;
  followRedirects: number;
}

export interface FetchHtmlResult {
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  ipAddress: string;
  body: string;
}
