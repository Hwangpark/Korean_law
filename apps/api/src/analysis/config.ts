export interface AnalysisConfig {
  providerMode: string;
  requestBodyLimit: number;
  crawlTimeoutMs: number;
  crawlMaxBytes: number;
  crawlFollowRedirects: number;
}

function parseIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAnalysisConfig(env: NodeJS.ProcessEnv = process.env): AnalysisConfig {
  const providerMode = env.LAW_PROVIDER || "mock";

  if (providerMode === "live" && !env.LAW_API_KEY) {
    throw new Error("LAW_API_KEY is required when LAW_PROVIDER=live.");
  }

  return {
    providerMode,
    requestBodyLimit: parseIntOr(env.ANALYSIS_BODY_LIMIT_BYTES, 12 * 1024 * 1024),
    crawlTimeoutMs: parseIntOr(env.CRAWL_TIMEOUT_MS, 12_000),
    crawlMaxBytes: parseIntOr(env.CRAWL_MAX_BYTES, 2_000_000),
    crawlFollowRedirects: parseIntOr(env.CRAWL_FOLLOW_REDIRECTS, 3)
  };
}
