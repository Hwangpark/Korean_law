import type { AnalysisJobEvent } from "./jobs.js";
import { buildPublicAgentResult } from "./privacy.js";
import type { GuestUsageResult } from "./store.js";

function formatGuestUsage(usage: GuestUsageResult): Record<string, unknown> {
  return {
    ...(usage.guestId ? { guest_id: usage.guestId } : {}),
    used: usage.usageCount,
    limit: usage.limit,
    remaining: usage.remaining
  };
}

function buildGuestUsageFields(
  usage: GuestUsageResult | null | undefined
): Record<string, unknown> {
  if (!usage) {
    return {};
  }

  return {
    guest_usage: formatGuestUsage(usage),
    guest_remaining: usage.remaining
  };
}

export function buildAnalysisAcceptedEnvelope(
  jobId: string,
  guestUsage?: GuestUsageResult | null
): Record<string, unknown> {
  return {
    job_id: jobId,
    stream_url: `/api/analyze/${encodeURIComponent(jobId)}/stream`,
    result_url: `/api/analyze/${encodeURIComponent(jobId)}`,
    ...buildGuestUsageFields(guestUsage)
  };
}

export function buildAnalysisPendingEnvelope(
  jobId: string,
  status: string
): Record<string, unknown> {
  return {
    job_id: jobId,
    status
  };
}

export function buildAnalysisFailedEnvelope(
  jobId: string,
  status: string,
  errorMessage: string
): Record<string, unknown> {
  return {
    error: errorMessage,
    job_id: jobId,
    status
  };
}

export function buildAnalysisGuestLimitEnvelope(
  usage: GuestUsageResult
): Record<string, unknown> {
  return {
    error:
      "\ube44\ub85c\uadf8\uc778 \uc0ac\uc6a9\uc790\ub294 IP \uae30\uc900\uc73c\ub85c \ud558\ub8e8 10\ud68c\uae4c\uc9c0\ub9cc \ubd84\uc11d\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
    ...buildGuestUsageFields(usage)
  };
}

export function buildAnalysisErrorEnvelope(
  errorMessage: string,
  usage?: GuestUsageResult | null
): Record<string, unknown> {
  return {
    error: errorMessage,
    ...buildGuestUsageFields(usage)
  };
}

export function buildPublicAnalysisEvent(
  event: AnalysisJobEvent
): AnalysisJobEvent {
  if (event.type === "agent_done") {
    return {
      ...event,
      result: buildPublicAgentResult(String(event.agent ?? ""), event.result)
    };
  }

  return {
    type: event.type,
    agent: event.agent,
    at: event.at
  };
}

export function buildPublicAnalysisStreamEvent(
  jobId: string,
  event: AnalysisJobEvent
): AnalysisJobEvent {
  if (event.type === "complete") {
    const result = (event.analysis ?? event.result ?? null) as unknown;
    return {
      type: "complete",
      job_id: jobId,
      status: "completed",
      ...(event.at ? { at: event.at } : {}),
      result
    };
  }

  if (event.type === "error") {
    const message = String(event.message ?? "Analysis job failed.");
    return {
      type: "error",
      job_id: jobId,
      status: "failed",
      ...(event.at ? { at: event.at } : {}),
      message,
      error: message
    };
  }

  return {
    ...event,
    job_id: jobId,
    status: "running"
  };
}
