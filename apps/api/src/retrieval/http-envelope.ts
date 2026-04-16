import type { GuestUsageResult } from "../analysis/store.js";

function formatGuestUsage(usage: GuestUsageResult): Record<string, unknown> {
  return {
    ...(usage.guestId ? { guest_id: usage.guestId } : {}),
    used: usage.usageCount,
    limit: usage.limit,
    remaining: usage.remaining
  };
}

function buildGuestSuccessFields(
  usage: GuestUsageResult | null | undefined
): Record<string, unknown> {
  if (!usage) {
    return {};
  }

  return {
    ...(usage.guestId ? { guest_id: usage.guestId } : {}),
    guest_remaining: usage.remaining
  };
}

export function buildKeywordAuthenticatedEnvelope(
  publicResult: Record<string, unknown>,
  profileContext: Record<string, unknown> | null
): Record<string, unknown> {
  if (!profileContext) {
    return publicResult;
  }

  return {
    ...publicResult,
    profile_context:
      (publicResult.profile_context as Record<string, unknown> | undefined) ??
      profileContext
  };
}

export function buildKeywordGuestEnvelope(
  publicResult: Record<string, unknown>,
  usage: GuestUsageResult
): Record<string, unknown> {
  return {
    ...publicResult,
    ...buildGuestSuccessFields(usage)
  };
}

export function buildKeywordGuestLimitEnvelope(
  usage: GuestUsageResult
): Record<string, unknown> {
  return {
    error:
      "\ube44\ub85c\uadf8\uc778 \uc0ac\uc6a9\uc790\ub294 IP \uae30\uc900\uc73c\ub85c \ud558\ub8e8 10\ud68c\uae4c\uc9c0\ub9cc \uac80\uc99d\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
    guest_usage: formatGuestUsage(usage),
    guest_remaining: usage.remaining
  };
}
