import { sanitizePublicProfileContext } from "../analysis/profile-context.js";
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

const SENSITIVE_QUERY_SOURCES = new Set(["fact", "profile", "llm", "hypothesis"]);

function buildSafeQueryRef(value: unknown): Record<string, unknown> {
  const query = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sources = sanitizeStringArray(query.sources);
  const issueTypes = sanitizeStringArray(query.issue_types);
  const legalElementSignals = sanitizeStringArray(query.legal_element_signals);
  const sensitiveSources = sources.filter((source) => SENSITIVE_QUERY_SOURCES.has(source));
  const rawText = sanitizeString(query.text);
  const redacted = sensitiveSources.length > 0;
  const text = redacted
    ? `비공개 질의(${sensitiveSources.join(",")})`
    : rawText;

  return {
    text,
    bucket: sanitizeString(query.bucket),
    channel: sanitizeString(query.channel),
    sources,
    issue_types: issueTypes,
    legal_element_signals: legalElementSignals,
    source_summary: [...new Set([...sources, ...issueTypes, ...legalElementSignals])],
    redacted
  };
}

function buildProvenanceSummary(queryRefs: Array<Record<string, unknown>>): Record<string, unknown> {
  const sourceTags = [...new Set(queryRefs.flatMap((query) => sanitizeStringArray(query.sources)))];
  const issueTypes = [...new Set(queryRefs.flatMap((query) => sanitizeStringArray(query.issue_types)))];
  return {
    matched_query_count: queryRefs.length,
    redacted_query_count: queryRefs.filter((query) => sanitizeBoolean(query.redacted)).length,
    source_tags: sourceTags,
    issue_types: issueTypes
  };
}

function sanitizePublicQueryRefs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((query) => buildSafeQueryRef(query))
    .filter((query) => sanitizeString(query.text));
}

function sanitizeRetrievalTrace(value: KeywordVerificationResponse["retrieval_trace"]): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as unknown as Record<string, unknown>
      : {}))
    .map((entry) => ({
      stage: sanitizeString(entry.stage),
      tool: sanitizeString(entry.tool),
      provider: sanitizeString(entry.provider),
      duration_ms: sanitizeNumber(entry.duration_ms),
      cache_hit: sanitizeBoolean(entry.cache_hit),
      input_ref: sanitizeString(entry.input_ref),
      output_ref: sanitizeStringArray(entry.output_ref),
      reason: sanitizeString(entry.reason),
      ...(entry.query_refs !== undefined ? { query_refs: sanitizePublicQueryRefs(entry.query_refs) } : {})
    }))
    .filter((entry) => entry.stage || entry.tool || entry.provider || entry.input_ref || entry.reason || entry.output_ref.length > 0);
}

function sanitizePublicReferenceCard(card: VerifiedReferenceCard): Record<string, unknown> {
  const matchedQueryRefs = sanitizePublicQueryRefs(card.matchedQueries);
  const providerSource = sanitizeString(card.reference?.sourceMode);
  return {
    id: sanitizeString(card.id),
    referenceKey: sanitizeString(card.referenceKey),
    kind: card.kind,
    title: sanitizeString(card.title),
    subtitle: sanitizeString(card.subtitle),
    summary: sanitizeString(card.summary),
    confidenceScore: sanitizeNumber(card.confidenceScore),
    matchReason: sanitizeString(card.matchReason),
    matchedQueries: matchedQueryRefs.map((query) => sanitizeString(query.text)).filter(Boolean),
    matchedQueryRefs: matchedQueryRefs,
    provenanceSummary: buildProvenanceSummary(matchedQueryRefs),
    matchedIssueTypes: sanitizeStringArray(card.matchedIssueTypes),
    snippet: sanitizeString(card.snippet?.text),
    ...(providerSource ? {
      sourceMode: providerSource,
      source_mode: providerSource,
      providerSource,
      provider_source: providerSource
    } : {}),
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

function sanitizeClaimSupport(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    overall: sanitizeString(record.overall),
    direct_count: sanitizeNumber(record.direct_count),
    partial_count: sanitizeNumber(record.partial_count),
    missing_count: sanitizeNumber(record.missing_count),
    entries: Array.isArray(record.entries)
      ? record.entries
        .map((item) => (item && typeof item === "object" && !Array.isArray(item)
          ? item as Record<string, unknown>
          : {}))
        .map((item) => ({
          claim_type: sanitizeString(item.claim_type),
          claim_path: sanitizeString(item.claim_path),
          title: sanitizeString(item.title),
          support_level: sanitizeString(item.support_level),
          citation_ids: sanitizeStringArray(item.citation_ids),
          reference_ids: sanitizeStringArray(item.reference_ids),
          evidence_count: sanitizeNumber(item.evidence_count),
          precedent_count: sanitizeNumber(item.precedent_count),
          has_snippet: sanitizeBoolean(item.has_snippet),
          match_reason: sanitizeString(item.match_reason)
        }))
        .filter((item) => item.claim_path || item.title)
      : []
  };
}

function sanitizeVerifier(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    stage: sanitizeString(record.stage),
    status: sanitizeString(record.status),
    evidence_sufficient: sanitizeBoolean(record.evidence_sufficient),
    citation_integrity: sanitizeBoolean(record.citation_integrity),
    contradiction_detected: sanitizeBoolean(record.contradiction_detected),
    selected_reference_count: sanitizeNumber(record.selected_reference_count),
    issue_count: sanitizeNumber(record.issue_count),
    confidence_calibration: {
      score: sanitizeNumber((record.confidence_calibration as Record<string, unknown> | undefined)?.score),
      label: sanitizeString((record.confidence_calibration as Record<string, unknown> | undefined)?.label)
    },
    claim_support: sanitizeClaimSupport(record.claim_support),
    warnings: sanitizeStringArray(record.warnings)
  };
}

function sanitizeSafetyGate(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    stage: sanitizeString(record.stage),
    status: sanitizeString(record.status),
    adjusted_output: sanitizeBoolean(record.adjusted_output),
    blocked_reasons: sanitizeStringArray(record.blocked_reasons),
    warnings: sanitizeStringArray(record.warnings)
  };
}

function sanitizeQueryRefs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => buildSafeQueryRef(item))
    .filter((item) => sanitizeString(item.text));
}

function sanitizeSnippet(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    field: sanitizeString(record.field),
    text: sanitizeString(record.text)
  };
}

function sanitizeChargeGrounding(value: unknown): Record<string, unknown> {
  const grounding = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const queryRefs = sanitizeQueryRefs(grounding.query_refs);
  return {
    citation_id: sanitizeString(grounding.citation_id),
    law_reference_id: sanitizeString(grounding.law_reference_id),
    precedent_reference_ids: sanitizeStringArray(grounding.precedent_reference_ids),
    reference_key: sanitizeString(grounding.reference_key),
    query_refs: queryRefs,
    provenance_summary: buildProvenanceSummary(queryRefs),
    match_reason: sanitizeString(grounding.match_reason),
    snippet: sanitizeSnippet(grounding.snippet),
    evidence_count: sanitizeNumber(grounding.evidence_count)
  };
}

function sanitizePrecedentGrounding(value: unknown): Record<string, unknown> {
  const grounding = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const queryRefs = sanitizeQueryRefs(grounding.query_refs);
  return {
    citation_id: sanitizeString(grounding.citation_id),
    reference_id: sanitizeString(grounding.reference_id),
    reference_key: sanitizeString(grounding.reference_key),
    query_refs: queryRefs,
    provenance_summary: buildProvenanceSummary(queryRefs),
    match_reason: sanitizeString(grounding.match_reason),
    snippet: sanitizeSnippet(grounding.snippet),
    evidence_count: sanitizeNumber(grounding.evidence_count)
  };
}

function sanitizeCitationMap(value: unknown): Record<string, unknown> | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const citations = Array.isArray(record.citations)
    ? record.citations
      .map((item) => (item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}))
      .map((item) => {
        const queryRefs = sanitizeQueryRefs(item.query_refs);
        return {
          citation_id: sanitizeString(item.citation_id),
          reference_id: sanitizeString(item.reference_id),
          reference_key: sanitizeString(item.reference_key),
          kind: sanitizeString(item.kind),
          statement_type: sanitizeString(item.statement_type),
          statement_path: sanitizeString(item.statement_path),
          title: sanitizeString(item.title),
          confidence_score: sanitizeNumber(item.confidence_score),
          match_reason: sanitizeString(item.match_reason),
          matched_issue_types: sanitizeStringArray(item.matched_issue_types),
          query_refs: queryRefs,
          provenance_summary: buildProvenanceSummary(queryRefs),
          query_source_tags: sanitizeStringArray(item.query_source_tags),
          snippet: sanitizeSnippet(item.snippet)
        };
      })
      .filter((item) => item.citation_id)
    : [];

  if (!sanitizeString(record.version) && citations.length === 0) {
    return null;
  }

  const sanitizeIndex = (input: unknown): Record<string, string[]> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .map(([key, entry]) => [sanitizeString(key), sanitizeStringArray(entry)] as const)
        .filter(([key]) => Boolean(key))
    );
  };

  return {
    version: sanitizeString(record.version),
    citations,
    by_reference_id: sanitizeIndex(record.by_reference_id),
    by_statement_path: sanitizeIndex(record.by_statement_path)
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
      expected_penalty: sanitizeString(item.expected_penalty),
      grounding: sanitizeChargeGrounding(item.grounding)
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
      match_reason: sanitizeString(item.match_reason),
      grounding: sanitizePrecedentGrounding(item.grounding)
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
    claim_support: sanitizeClaimSupport(legalAnalysis?.claim_support),
    verifier: sanitizeVerifier(legalAnalysis?.verifier),
    safety_gate: sanitizeSafetyGate(legalAnalysis?.safety_gate),
    selected_reference_ids: sanitizeStringArray(legalAnalysis?.selected_reference_ids),
    charges: sanitizePublicCharges(legalAnalysis?.charges),
    recommended_actions: sanitizeStringArray(legalAnalysis?.recommended_actions),
    evidence_to_collect: sanitizeStringArray(legalAnalysis?.evidence_to_collect),
    precedent_cards: sanitizePublicPrecedentCards(legalAnalysis?.precedent_cards),
    citation_map: sanitizeCitationMap(legalAnalysis?.citation_map),
    profile_considerations: sanitizeStringArray(legalAnalysis?.profile_considerations)
  };
}

export function buildPublicKeywordVerificationResponse(
  response: KeywordVerificationResponse
): Record<string, unknown> {
  const publicProfileContext = sanitizePublicProfileContext(response.profile_context as Record<string, unknown> | null | undefined);

  return {
    run_id: response.run_id,
    ...(publicProfileContext ? { profile_context: publicProfileContext } : {}),
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
  const publicProfileContext = sanitizePublicProfileContext(response.profile_context as Record<string, unknown> | null | undefined);

  return {
    run_id: response.run_id,
    ...(publicProfileContext ? { profile_context: publicProfileContext } : {}),
    query: response.query,
    plan: sanitizePublicPlan(response.plan),
    verification: response.verification,
    ...(response.retrieval_preview ? { retrieval_preview: sanitizePublicRetrievalPreview(response.retrieval_preview) } : {}),
    ...(response.retrieval_trace ? { retrieval_trace: sanitizeRetrievalTrace(response.retrieval_trace) } : {}),
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
