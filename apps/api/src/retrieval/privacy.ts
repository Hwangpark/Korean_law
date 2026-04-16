import type {
  CandidateIssue,
  KeywordVerificationResponse,
  ScopeFlags,
  VerifiedReferenceCard
} from "./types.js";

function sanitizeString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function sanitizeBoolean(value: unknown): boolean {
  return Boolean(value);
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
}

function sanitizeScopeFlags(value: ScopeFlags | Record<string, unknown> | undefined) {
  return {
    proceduralHeavy: sanitizeBoolean(value?.proceduralHeavy),
    insufficientFacts: sanitizeBoolean(value?.insufficientFacts),
    unsupportedIssuePresent: sanitizeBoolean(value?.unsupportedIssuePresent)
  };
}

function sanitizePublicScopeFilter(
  plan: KeywordVerificationResponse["plan"]
): Record<string, unknown> {
  return {
    supported_issues: sanitizeStringArray(plan?.supported_issues),
    unsupported_issues: sanitizeStringArray(plan?.unsupported_issues),
    scope_warnings: sanitizeStringArray(plan?.scope_warnings)
  };
}

function sanitizePreviewCardList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {}))
    .map((item) => ({
      id: sanitizeString(item.id),
      title: sanitizeString(item.title),
      summary: sanitizeString(item.summary)
    }))
    .filter((item) => item.id || item.title);
}

function sanitizePublicRetrievalPreview(
  preview: KeywordVerificationResponse["retrieval_preview"]
): Record<string, unknown> | null {
  if (!preview) {
    return null;
  }

  const sanitizeEntry = (value: unknown) => {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return {
      headline: sanitizeString(record.headline),
      top_issues: sanitizeStringArray(record.top_issues),
      top_laws: sanitizePreviewCardList(record.top_laws),
      top_precedents: sanitizePreviewCardList(record.top_precedents),
      profile_flags: sanitizeStringArray(record.profile_flags),
      disclaimer: sanitizeString(record.disclaimer)
    };
  };

  return {
    law: sanitizeEntry(preview.law),
    precedent: sanitizeEntry(preview.precedent)
  };
}

function sanitizePublicPlan(
  plan: KeywordVerificationResponse["plan"]
): Record<string, unknown> {
  return {
    candidate_issues: Array.isArray(plan?.candidate_issues)
      ? plan.candidate_issues.map((issue) => ({
        type: sanitizeString((issue as CandidateIssue | Record<string, unknown>)?.type),
        severity: sanitizeString((issue as CandidateIssue | Record<string, unknown>)?.severity),
        reason: sanitizeString((issue as CandidateIssue | Record<string, unknown>)?.reason)
      })).filter((issue) => issue.type)
      : [],
    warnings: sanitizeStringArray(plan?.warnings),
    supported_issues: sanitizeStringArray(plan?.supported_issues),
    unsupported_issues: sanitizeStringArray(plan?.unsupported_issues),
    scope_warnings: sanitizeStringArray(plan?.scope_warnings),
    scope_flags: sanitizeScopeFlags(plan?.scope_flags),
    scope_filter: sanitizePublicScopeFilter(plan)
  };
}

function sanitizePublicReferenceCard(card: VerifiedReferenceCard): Record<string, unknown> {
  return {
    id: sanitizeString(card.id),
    referenceKey: sanitizeString(card.referenceKey),
    kind: card.kind,
    title: sanitizeString(card.title),
    subtitle: sanitizeString(card.subtitle),
    summary: sanitizeString(card.summary),
    confidenceScore: sanitizeNumber(card.confidenceScore),
    matchReason: sanitizeString(card.matchReason),
    matchedQueries: Array.isArray(card.matchedQueries)
      ? card.matchedQueries.map((query) => sanitizeString(query?.text)).filter(Boolean)
      : [],
    matchedIssueTypes: sanitizeStringArray(card.matchedIssueTypes),
    snippet: sanitizeString(card.snippet?.text),
    source: {
      law_name: sanitizeString(card.source?.law_name),
      article_no: sanitizeString(card.source?.article_no),
      article_title: sanitizeString(card.source?.article_title),
      penalty: sanitizeString(card.source?.penalty),
      url: sanitizeString(card.source?.url),
      case_no: sanitizeString(card.source?.case_no),
      court: sanitizeString(card.source?.court),
      verdict: sanitizeString(card.source?.verdict),
      sentence: sanitizeString(card.source?.sentence)
    }
  };
}

function sanitizeGroundingEvidenceSummary(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    top_issue: sanitizeString(record.top_issue),
    evidence_strength: sanitizeString(record.evidence_strength, "low")
  };
}

function sanitizePublicCharges(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {}))
    .map((item) => ({
      charge: sanitizeString(item.charge),
      basis: sanitizeString(item.basis),
      elements_met: sanitizeStringArray(item.elements_met),
      probability: sanitizeString(item.probability),
      expected_penalty: sanitizeString(item.expected_penalty)
    }))
    .filter((item) => item.charge);
}

function sanitizePublicPrecedentCards(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {}))
    .map((item) => ({
      case_no: sanitizeString(item.case_no),
      court: sanitizeString(item.court),
      verdict: sanitizeString(item.verdict),
      summary: sanitizeString(item.summary),
      similarity_score: sanitizeNumber(item.similarity_score),
      match_reason: sanitizeString(item.match_reason)
    }))
    .filter((item) => item.case_no);
}

function sanitizePublicLegalAnalysis(
  legalAnalysis: KeywordVerificationResponse["legal_analysis"]
): Record<string, unknown> {
  return {
    can_sue: sanitizeBoolean(legalAnalysis?.can_sue),
    risk_level: sanitizeNumber(legalAnalysis?.risk_level),
    summary: sanitizeString(legalAnalysis?.summary, "분석 결과"),
    disclaimer: sanitizeString(legalAnalysis?.disclaimer),
    scope_assessment: {
      supported_issues: sanitizeStringArray(legalAnalysis?.scope_assessment?.supported_issues),
      unsupported_issues: sanitizeStringArray(legalAnalysis?.scope_assessment?.unsupported_issues),
      procedural_heavy: sanitizeBoolean(legalAnalysis?.scope_assessment?.procedural_heavy),
      insufficient_facts: sanitizeBoolean(legalAnalysis?.scope_assessment?.insufficient_facts),
      unsupported_issue_present: sanitizeBoolean(legalAnalysis?.scope_assessment?.unsupported_issue_present),
      warnings: sanitizeStringArray(legalAnalysis?.scope_assessment?.warnings)
    },
    grounding_evidence: sanitizeGroundingEvidenceSummary(legalAnalysis?.grounding_evidence),
    selected_reference_ids: sanitizeStringArray(legalAnalysis?.selected_reference_ids),
    charges: sanitizePublicCharges(legalAnalysis?.charges),
    recommended_actions: sanitizeStringArray(legalAnalysis?.recommended_actions),
    evidence_to_collect: sanitizeStringArray(legalAnalysis?.evidence_to_collect),
    precedent_cards: sanitizePublicPrecedentCards(legalAnalysis?.precedent_cards),
    profile_considerations: sanitizeStringArray(legalAnalysis?.profile_considerations)
  };
}

export function buildPublicKeywordVerificationResponse(
  response: KeywordVerificationResponse
): Record<string, unknown> {
  return {
    run_id: response.run_id,
    ...(response.profile_context ? { profile_context: response.profile_context } : {}),
    query: response.query,
    plan: sanitizePublicPlan(response.plan),
    verification: response.verification,
    ...(response.retrieval_preview ? { retrieval_preview: sanitizePublicRetrievalPreview(response.retrieval_preview) } : {}),
    matched_laws: response.matched_laws.map((card) => sanitizePublicReferenceCard(card)),
    matched_precedents: response.matched_precedents.map((card) => sanitizePublicReferenceCard(card)),
    legal_analysis: sanitizePublicLegalAnalysis(response.legal_analysis)
  };
}

export function buildStoredKeywordVerificationResponse(
  response: KeywordVerificationResponse
): Record<string, unknown> {
  return {
    run_id: response.run_id,
    ...(response.profile_context ? { profile_context: response.profile_context } : {}),
    query: response.query,
    plan: sanitizePublicPlan(response.plan),
    verification: response.verification,
    ...(response.retrieval_preview ? { retrieval_preview: response.retrieval_preview } : {}),
    ...(response.retrieval_trace ? { retrieval_trace: response.retrieval_trace } : {}),
    retrieval_evidence_pack: {
      version: response.retrieval_evidence_pack.version,
      run_id: response.retrieval_evidence_pack.run_id ?? response.run_id,
      query: response.retrieval_evidence_pack.query,
      selected_reference_ids: sanitizeStringArray(response.retrieval_evidence_pack.selected_reference_ids),
      top_issue_types: sanitizeStringArray(response.retrieval_evidence_pack.top_issue_types),
      evidence_strength: sanitizeString(response.retrieval_evidence_pack.evidence_strength, "low")
    },
    legal_analysis: sanitizePublicLegalAnalysis(response.legal_analysis)
  };
}
