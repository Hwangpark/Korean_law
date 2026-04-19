const ANSWER_DISPOSITIONS = new Set([
  "direct_answer",
  "limited_answer",
  "handoff_recommended",
  "safety_first_handoff"
]);

function toStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function hasSafetyFirstSignal(input) {
  if (Boolean(input?.highRiskTriggered) || Boolean(input?.highRiskEmergency)) {
    return true;
  }

  return toStringArray(input?.blockedReasons)
    .some((reason) => reason.includes("escalation") || reason.includes("emergency"));
}

export function sanitizeAnswerDisposition(value) {
  const disposition = String(value ?? "").trim();
  return ANSWER_DISPOSITIONS.has(disposition) ? disposition : "direct_answer";
}

export function buildAnswerDisposition(input = {}) {
  if (hasSafetyFirstSignal(input)) {
    return "safety_first_handoff";
  }

  if (Boolean(input.handoffRecommended)) {
    return "handoff_recommended";
  }

  if (
    toStringArray(input.abstainReasons).length > 0
    || toStringArray(input.uncertaintyReasons).length > 0
    || input.verifierStatus === "warning"
  ) {
    return "limited_answer";
  }

  return "direct_answer";
}
