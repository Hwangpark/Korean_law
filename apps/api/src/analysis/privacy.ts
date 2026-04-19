import { buildAnswerDisposition } from "./answer-disposition.mjs";
import { sanitizePublicProfileContext } from "./profile-context.js";
import type { ReferenceLibraryItem } from "./references.js";

const PHONE_NUMBER_PATTERN =
  /(?<!\d)(?:\+?82[-.\s]?)?0(?:10|11|16|17|18|19|2|[3-6][0-9]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const RESIDENT_REGISTRATION_PATTERN = /\b\d{6}-?[1-4]\d{6}\b/gu;
const ADDRESS_PATTERN =
  /(?:[가-힣]+(?:특별시|광역시|자치시|시|도)\s+)?[가-힣0-9]+(?:시|군|구)\s+[가-힣0-9\s-]+(?:읍|면|동|로|길)\s*\d*(?:-\d+)?/gu;
const NAME_LABEL_PATTERN =
  /(\b(?:이름|실명|성함|닉네임)\s*[:：]\s*)([가-힣A-Za-z][가-힣A-Za-z0-9._-]{1,19})/gu;
const CONTACT_LABEL_PATTERN =
  /(\b(?:전화번호|연락처|휴대폰|핸드폰)\s*[:：]\s*)([^\n,]+)/gu;
const ADDRESS_LABEL_PATTERN = /(\b(?:주소)\s*[:：]\s*)([^\n,]+)/gu;
const EMAIL_LABEL_PATTERN = /(\b(?:이메일|메일)\s*[:：]\s*)([^\n,]+)/gu;

export interface PublicAnalysisResult {
  job_id: string;
  status: "completed";
  ocr: Record<string, unknown>;
  classification: Record<string, unknown>;
  retrieval_plan: Record<string, unknown>;
  law_search: Record<string, unknown>;
  precedent_search: Record<string, unknown>;
  legal_analysis: Record<string, unknown>;
  reference_library: {
    items: ReferenceLibraryItem[];
  };
  meta: {
    provider_mode: string;
    provider_source: string;
    provider_notice: string;
    generated_at: string;
    input_type: string;
    context_type: string;
  };
  timeline: Array<Record<string, unknown>>;
  case_id?: string;
  run_id?: string;
  profile_context?: Record<string, unknown>;
}

export interface StoredRuntimeArtifacts {
  preview: Record<string, unknown>;
  trace: Array<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown, fallback = ""): string {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function asBoolean(value: unknown): boolean {
  return Boolean(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    : [];
}

function sanitizeScopeFlags(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    proceduralHeavy: asBoolean(record.proceduralHeavy),
    insufficientFacts: asBoolean(record.insufficientFacts),
    unsupportedIssuePresent: asBoolean(record.unsupportedIssuePresent)
  };
}

function sanitizeClassifierExtraction(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    mode: asString(record.mode, "rule_fallback"),
    model: asNullableString(record.model),
    used_llm: asBoolean(record.used_llm),
    warning: asNullableString(record.warning),
    warnings: sanitizeStringArray(record.warnings),
    unsupported_issue_types: sanitizeStringArray(record.unsupported_issue_types),
    issue_hypotheses_source: asString(record.issue_hypotheses_source, "rule_fallback")
  };
}

function sanitizeOcrReview(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    status: asString(record.status, "not_needed"),
    confidence_score: typeof record.confidence_score === "number" ? asNumber(record.confidence_score) : null,
    requires_human_review: asBoolean(record.requires_human_review),
    reasons: sanitizeStringArray(record.reasons),
    recommended_action: asNullableString(record.recommended_action)
  };
}

function sanitizeIssueList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      type: asString(item.type),
      severity: asString(item.severity),
      ...(item.reason !== undefined ? { reason: asString(item.reason) } : {}),
      ...(typeof item.confidence === "number" ? { confidence: asNumber(item.confidence) } : {})
    }))
    .filter((item) => item.type);
}

function sanitizePreviewCardList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      id: asString(item.id),
      title: asString(item.title),
      summary: asString(item.summary)
    }))
    .filter((item) => item.id || item.title);
}

function sanitizeQueryRefList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      text: asString(item.text),
      bucket: asString(item.bucket),
      channel: asString(item.channel),
      sources: sanitizeStringArray(item.sources),
      issue_types: sanitizeStringArray(item.issue_types),
      legal_element_signals: sanitizeStringArray(item.legal_element_signals)
    }))
    .filter((item) => item.text);
}

function sanitizeEvidenceSnippet(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  const text = asString(record.text);
  if (!text) {
    return null;
  }

  return {
    field: asString(record.field),
    text
  };
}

function sanitizeRetrievalPreview(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    headline: asString(record.headline),
    top_issues: sanitizeStringArray(record.top_issues),
    top_laws: sanitizePreviewCardList(record.top_laws),
    top_precedents: sanitizePreviewCardList(record.top_precedents),
    profile_flags: sanitizeStringArray(record.profile_flags),
    disclaimer: asString(record.disclaimer)
  };
}

function sanitizePublicRetrievalPlan(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    candidate_issues: sanitizeIssueList(record.candidateIssues),
    warnings: sanitizeStringArray(record.warnings),
    supported_issues: sanitizeStringArray(record.supportedIssues),
    unsupported_issues: sanitizeStringArray(record.unsupportedIssues),
    scope_warnings: sanitizeStringArray(record.scopeWarnings),
    scope_flags: sanitizeScopeFlags(record.scopeFlags),
    scope_filter: {
      supported_issues: sanitizeStringArray(record.supportedIssues),
      unsupported_issues: sanitizeStringArray(record.unsupportedIssues),
      scope_warnings: sanitizeStringArray(record.scopeWarnings)
    },
    broad_law_queries_count: sanitizeStringArray(record.broadLawQueries).length,
    precise_law_queries_count: sanitizeStringArray(record.preciseLawQueries).length,
    broad_precedent_queries_count: sanitizeStringArray(record.broadPrecedentQueries).length,
    precise_precedent_queries_count: sanitizeStringArray(record.precisePrecedentQueries).length
  };
}

function sanitizePublicSearchStageResult(
  agent: "law" | "precedent",
  value: unknown
): Record<string, unknown> {
  const base = buildPublicAgentResult(agent, value);
  const record = asRecord(value);
  return {
    ...base,
    retrieval_preview: record.retrieval_preview
      ? sanitizeRetrievalPreview(record.retrieval_preview)
      : null
  };
}

function sanitizeClaimSupport(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const entries = Array.isArray(record.entries)
    ? record.entries
      .map((item) => asRecord(item))
      .map((item) => ({
        claim_type: asString(item.claim_type),
        claim_path: asString(item.claim_path),
        title: asString(item.title),
        support_level: asString(item.support_level),
        citation_ids: sanitizeStringArray(item.citation_ids),
        reference_ids: sanitizeStringArray(item.reference_ids),
        evidence_count: asNumber(item.evidence_count),
        precedent_count: asNumber(item.precedent_count),
        has_snippet: asBoolean(item.has_snippet),
        match_reason: asString(item.match_reason)
      }))
      .filter((item) => item.claim_path || item.title)
    : [];

  return {
    overall: asString(record.overall),
    direct_count: asNumber(record.direct_count),
    partial_count: asNumber(record.partial_count),
    missing_count: asNumber(record.missing_count),
    entries
  };
}

function sanitizeVerifier(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const confidence = asRecord(record.confidence_calibration);
  return {
    stage: asString(record.stage),
    status: asString(record.status),
    evidence_sufficient: asBoolean(record.evidence_sufficient),
    citation_integrity: asBoolean(record.citation_integrity),
    contradiction_detected: asBoolean(record.contradiction_detected),
    selected_reference_count: asNumber(record.selected_reference_count),
    issue_count: asNumber(record.issue_count),
    confidence_calibration: {
      score: asNumber(confidence.score),
      label: asString(confidence.label)
    },
    claim_support: sanitizeClaimSupport(record.claim_support),
    warnings: sanitizeStringArray(record.warnings)
  };
}

function sanitizeSafetyGate(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    stage: asString(record.stage),
    status: asString(record.status),
    adjusted_output: asBoolean(record.adjusted_output),
    blocked_reasons: sanitizeStringArray(record.blocked_reasons),
    warnings: sanitizeStringArray(record.warnings)
  };
}

function sanitizeTimeline(timeline: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(timeline)) {
    return [];
  }

  return timeline
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.type === "string" && typeof entry.agent === "string")
    .map((entry) => {
      const summary = asRecord(entry.summary);
      return {
        type: entry.type,
        agent: entry.agent,
        at: entry.at,
        ...(typeof entry.duration_ms === "number" ? { duration_ms: entry.duration_ms } : {}),
        ...(Array.isArray(summary.logical_substeps)
          || typeof summary.evidence_strength === "string"
          || Boolean(summary.verifier)
          || Boolean(summary.safety_gate)
          ? {
              summary: {
                ...(Array.isArray(summary.logical_substeps)
                  ? { logical_substeps: sanitizeStringArray(summary.logical_substeps) }
                  : {}),
                ...(typeof summary.evidence_strength === "string"
                  ? { evidence_strength: asString(summary.evidence_strength) }
                  : {}),
                ...(summary.extraction
                  ? { extraction: sanitizeClassifierExtraction(summary.extraction) }
                  : {}),
                ...(Array.isArray(summary.selected_reference_ids)
                  ? { selected_reference_ids: sanitizeStringArray(summary.selected_reference_ids) }
                  : {}),
                ...(summary.verifier ? { verifier: sanitizeVerifier(summary.verifier) } : {}),
                ...(summary.safety_gate ? { safety_gate: sanitizeSafetyGate(summary.safety_gate) } : {}),
                ...(summary.scope_flags
                  ? {
                      scope_flags: {
                        proceduralHeavy: asBoolean(asRecord(summary.scope_flags).proceduralHeavy),
                        insufficientFacts: asBoolean(asRecord(summary.scope_flags).insufficientFacts),
                        unsupportedIssuePresent: asBoolean(asRecord(summary.scope_flags).unsupportedIssuePresent)
                      }
                    }
                  : {}),
                ...(Array.isArray(summary.supported_issues)
                  ? { supported_issues: sanitizeStringArray(summary.supported_issues) }
                  : {}),
                ...(Array.isArray(summary.unsupported_issues)
                  ? { unsupported_issues: sanitizeStringArray(summary.unsupported_issues) }
                  : {})
              }
            }
          : {})
      };
    });
}

function sanitizeChargeList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => {
      const grounding = asRecord(item.grounding);
      return {
        issue_type: asString(item.issue_type),
        charge: asString(item.charge),
        basis: asString(item.basis),
        probability: asString(item.probability),
        expected_penalty: asString(item.expected_penalty),
        elements_met: sanitizeStringArray(item.elements_met),
        supporting_precedents: sanitizeStringArray(item.supporting_precedents),
        grounding: {
          law_reference_id: asString(grounding.law_reference_id),
          reference_key: asString(grounding.reference_key),
          citation_id: asString(grounding.citation_id),
          precedent_reference_ids: sanitizeStringArray(grounding.precedent_reference_ids),
          precedent_citation_ids: sanitizeStringArray(grounding.precedent_citation_ids),
          evidence_count: asNumber(grounding.evidence_count),
          query_refs: sanitizeQueryRefList(grounding.query_refs),
          match_reason: asString(grounding.match_reason),
          snippet: sanitizeEvidenceSnippet(grounding.snippet)
        }
      };
    })
    .filter((item) => item.charge);
}

function sanitizeSharedGrounding(value: unknown): Record<string, unknown> {
  const grounding = asRecord(value);
  return {
    law_reference_id: asString(grounding.law_reference_id),
    reference_key: asString(grounding.reference_key),
    citation_id: asString(grounding.citation_id),
    precedent_reference_ids: sanitizeStringArray(grounding.precedent_reference_ids),
    precedent_citation_ids: sanitizeStringArray(grounding.precedent_citation_ids),
    evidence_count: asNumber(grounding.evidence_count),
    query_refs: sanitizeQueryRefList(grounding.query_refs),
    match_reason: asString(grounding.match_reason),
    snippet: sanitizeEvidenceSnippet(grounding.snippet)
  };
}

function sanitizeIssueCards(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => ({
      title: asString(item.title),
      basis: asString(item.basis),
      probability: asString(item.probability),
      expected_penalty: asString(item.expected_penalty),
      checklist: sanitizeStringArray(item.checklist),
      supporting_precedents: sanitizeStringArray(item.supporting_precedents),
      grounding: sanitizeSharedGrounding(item.grounding)
    }))
    .filter((item) => item.title);
}

function sanitizePrecedentCards(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .map((item) => {
      const grounding = asRecord(item.grounding);
      return {
        case_no: asString(item.case_no),
        court: asString(item.court),
        verdict: asString(item.verdict),
        summary: asString(item.summary),
        similarity_score: asNumber(item.similarity_score),
        match_reason: asString(item.match_reason),
        grounding: {
          reference_id: asString(grounding.reference_id),
          reference_key: asString(grounding.reference_key),
          citation_id: asString(grounding.citation_id),
          evidence_count: asNumber(grounding.evidence_count),
          query_refs: sanitizeQueryRefList(grounding.query_refs),
          match_reason: asString(grounding.match_reason),
          snippet: sanitizeEvidenceSnippet(grounding.snippet)
        }
      };
    })
    .filter((item) => item.case_no);
}

function sanitizeScopeAssessment(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    supported_issues: sanitizeStringArray(record.supported_issues),
    unsupported_issues: sanitizeStringArray(record.unsupported_issues),
    procedural_heavy: asBoolean(record.procedural_heavy),
    insufficient_facts: asBoolean(record.insufficient_facts),
    unsupported_issue_present: asBoolean(record.unsupported_issue_present),
    warnings: sanitizeStringArray(record.warnings)
  };
}

function sanitizeFactSheet(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    key_points: sanitizeStringArray(record.key_points),
    missing_points: sanitizeStringArray(record.missing_points),
    unsupported_points: sanitizeStringArray(record.unsupported_points),
    recommended_focus: sanitizeStringArray(record.recommended_focus)
  };
}

function sanitizeGroundingEvidenceSummary(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    top_issue: asString(record.top_issue),
    evidence_strength: asString(record.evidence_strength)
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildReviewRecommendation(record: Record<string, unknown>): Record<string, unknown> {
  const verifier = sanitizeVerifier(record.verifier);
  const safetyGate = sanitizeSafetyGate(record.safety_gate);
  const scopeAssessment = sanitizeScopeAssessment(record.scope_assessment);
  const claimSupport = sanitizeClaimSupport(record.claim_support);
  const highRiskEscalation = asRecord(record.high_risk_escalation);
  const riskLevel = asNumber(record.risk_level, 0);
  const canSue = asBoolean(record.can_sue);
  const confidenceLabel = asString(asRecord(verifier.confidence_calibration).label);
  const handoffRecommended =
    riskLevel >= 4
    || asBoolean(highRiskEscalation.triggered)
    || scopeAssessment.procedural_heavy === true
    || scopeAssessment.insufficient_facts === true
    || scopeAssessment.unsupported_issue_present === true
    || safetyGate.adjusted_output === true
    || verifier.status === "needs_caution"
    || confidenceLabel === "low";

  const abstainReasons = uniqueStrings([
    ...((!canSue || safetyGate.adjusted_output) && scopeAssessment.insufficient_facts
      ? ["핵심 사실이 더 필요해 확정 판단을 보류했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && scopeAssessment.procedural_heavy
      ? ["절차 중심 사안이라 개별 사실판단보다 절차 확인과 전문가 검토를 우선했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && scopeAssessment.unsupported_issue_present
      ? ["지원 범위를 벗어난 쟁점이 섞여 있어 단정 결론을 제한했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && sanitizeStringArray(safetyGate.blocked_reasons).includes("citation_integrity")
      ? ["직접 연결된 법령·판례 인용이 완전하지 않아 단정 결론을 피했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && claimSupport.overall === "missing"
      ? ["최종 판단 문장에 직접 연결된 근거가 부족해 보수적으로 답했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && claimSupport.overall === "partial"
      ? ["일부 판단 문장이 부분 근거만 연결돼 있어 단정 표현을 줄였습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && verifier.contradiction_detected
      ? ["지원 범위와 내부 쟁점 신호 사이 충돌 가능성이 있어 확정 판단을 보류했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && confidenceLabel === "low"
      ? ["현재 근거 신뢰도가 낮아 참고용 안내로 제한했습니다."]
      : []),
    ...((!canSue || safetyGate.adjusted_output) && asBoolean(highRiskEscalation.triggered)
      ? ["긴급 또는 고위험 신호가 있어 법률 판단보다 안전 확보와 증거 보존을 우선했습니다."]
      : [])
  ]).slice(0, 4);

  const uncertaintyReasons = uniqueStrings([
    ...(scopeAssessment.insufficient_facts ? ["사실관계가 더 필요해 추가 검토가 안전합니다."] : []),
    ...(scopeAssessment.procedural_heavy ? ["절차 중심 사안이라 개별 대응은 전문가 검토가 안전합니다."] : []),
    ...(scopeAssessment.unsupported_issue_present ? ["지원 범위를 벗어난 쟁점이 섞여 있어 단정적 안내를 피해야 합니다."] : []),
    ...(riskLevel >= 4 ? ["고위험 사안일 수 있어 변호사 상담 필요성을 함께 검토하는 편이 안전합니다."] : []),
    ...(asBoolean(highRiskEscalation.triggered) ? ["긴급성 또는 고위험 신호가 감지되어 일반 안내만으로는 부족할 수 있습니다."] : []),
    ...(confidenceLabel === "low" ? ["현재 근거 신뢰도가 낮아 추가 검토가 필요합니다."] : []),
    ...sanitizeStringArray(safetyGate.warnings),
    ...sanitizeStringArray(verifier.warnings)
  ]).slice(0, 4);

  return {
    handoff_recommended: handoffRecommended,
    abstain_reasons: abstainReasons,
    uncertainty_reasons: uncertaintyReasons
  };
}

function sanitizeCitationMap(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  const citations = Array.isArray(record.citations)
    ? record.citations
      .map((item) => asRecord(item))
      .map((item) => ({
        citation_id: asString(item.citation_id),
        reference_id: asString(item.reference_id),
        reference_key: asString(item.reference_key),
        kind: asString(item.kind),
        statement_type: asString(item.statement_type),
        statement_path: asString(item.statement_path),
        title: asString(item.title),
        confidence_score: asNumber(item.confidence_score),
        match_reason: asString(item.match_reason),
        matched_issue_types: sanitizeStringArray(item.matched_issue_types),
        query_refs: sanitizeQueryRefList(item.query_refs),
        query_source_tags: sanitizeStringArray(item.query_source_tags),
        snippet: sanitizeEvidenceSnippet(item.snippet)
      }))
      .filter((item) => item.citation_id)
    : [];

  if (!asString(record.version) && citations.length === 0) {
    return null;
  }

  const sanitizeIndex = (input: unknown): Record<string, string[]> => {
    const source = asRecord(input);
    return Object.fromEntries(
      Object.entries(source)
        .map(([key, entry]) => [asString(key), sanitizeStringArray(entry)] as const)
        .filter(([key]) => Boolean(key))
    );
  };

  return {
    version: asString(record.version),
    citations,
    by_reference_id: sanitizeIndex(record.by_reference_id),
    by_statement_path: sanitizeIndex(record.by_statement_path)
  };
}

function sanitizePublicLegalAnalysis(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const reviewRecommendation = buildReviewRecommendation(record);
  const verifier = sanitizeVerifier(record.verifier);
  const safetyGate = sanitizeSafetyGate(record.safety_gate);

  return {
    mode: asString(record.mode, "mock"),
    can_sue: asBoolean(record.can_sue),
    risk_level: asNumber(record.risk_level, 0),
    summary: asString(record.summary, "분석 결과"),
    summary_grounding: sanitizeSharedGrounding(record.summary_grounding),
    fact_sheet: sanitizeFactSheet(record.fact_sheet),
    disclaimer: asString(record.disclaimer),
    charges: sanitizeChargeList(record.charges),
    recommended_actions: sanitizeStringArray(record.recommended_actions),
    evidence_to_collect: sanitizeStringArray(record.evidence_to_collect),
    issue_cards: sanitizeIssueCards(record.issue_cards),
    precedent_cards: sanitizePrecedentCards(record.precedent_cards),
    next_steps: sanitizeStringArray(record.next_steps),
    profile_considerations: sanitizeStringArray(record.profile_considerations),
    scope_assessment: sanitizeScopeAssessment(record.scope_assessment),
    claim_support: sanitizeClaimSupport(record.claim_support),
    verifier,
    safety_gate: safetyGate,
    review_recommendation: reviewRecommendation,
    answer_disposition: buildAnswerDisposition({
      handoffRecommended: asBoolean(asRecord(reviewRecommendation).handoff_recommended),
      abstainReasons: asRecord(reviewRecommendation).abstain_reasons,
      uncertaintyReasons: asRecord(reviewRecommendation).uncertainty_reasons,
      verifierStatus: asString(verifier.status),
      highRiskTriggered: asBoolean(asRecord(record.high_risk_escalation).triggered),
      highRiskEmergency: asBoolean(asRecord(record.high_risk_escalation).emergency),
      blockedReasons: safetyGate.blocked_reasons
    }),
    grounding_evidence: sanitizeGroundingEvidenceSummary(record.grounding_evidence),
    selected_reference_ids: sanitizeStringArray(record.selected_reference_ids),
    citation_map: sanitizeCitationMap(record.citation_map),
    share_text: asString(record.share_text)
  };
}

function sanitizeStoredLegalAnalysis(value: unknown): Record<string, unknown> {
  const publicShape = sanitizePublicLegalAnalysis(value);
  return {
    mode: publicShape.mode,
    can_sue: publicShape.can_sue,
    risk_level: publicShape.risk_level,
    summary: publicShape.summary,
    fact_sheet: publicShape.fact_sheet,
    disclaimer: publicShape.disclaimer,
    charges: publicShape.charges,
    recommended_actions: publicShape.recommended_actions,
    evidence_to_collect: publicShape.evidence_to_collect,
    scope_assessment: publicShape.scope_assessment,
    claim_support: publicShape.claim_support,
    verifier: publicShape.verifier,
    safety_gate: publicShape.safety_gate,
    review_recommendation: publicShape.review_recommendation,
    answer_disposition: publicShape.answer_disposition,
    grounding_evidence: publicShape.grounding_evidence,
    selected_reference_ids: publicShape.selected_reference_ids,
    share_text: publicShape.share_text
  };
}

export function maskPersonalInfoText(value: unknown): string {
  return String(value ?? "")
    .replace(NAME_LABEL_PATTERN, "$1[이름 마스킹]")
    .replace(CONTACT_LABEL_PATTERN, "$1[전화번호 마스킹]")
    .replace(ADDRESS_LABEL_PATTERN, "$1[주소 마스킹]")
    .replace(EMAIL_LABEL_PATTERN, "$1[이메일 마스킹]")
    .replace(EMAIL_PATTERN, "[이메일 마스킹]")
    .replace(PHONE_NUMBER_PATTERN, "[전화번호 마스킹]")
    .replace(RESIDENT_REGISTRATION_PATTERN, "[주민등록번호 마스킹]")
    .replace(ADDRESS_PATTERN, "[주소 마스킹]");
}

export function createSpeakerAlias(index: number): string {
  const normalizedIndex = Math.max(0, Math.floor(index));
  const alphabetIndex = normalizedIndex % 26;
  const cycle = Math.floor(normalizedIndex / 26);
  return cycle === 0
    ? String.fromCharCode(65 + alphabetIndex)
    : `${String.fromCharCode(65 + alphabetIndex)}${cycle + 1}`;
}

export function buildPublicAgentResult(agent: string, result: unknown): Record<string, unknown> {
  const record = asRecord(result);

  switch (agent) {
    case "ocr":
      return {
        source_type: asString(record.source_type, "unknown"),
        utterance_count: Array.isArray(record.utterances) ? record.utterances.length : 0,
        review: sanitizeOcrReview(record.review)
      };
    case "classifier": {
      const issues = Array.isArray(record.issues)
        ? record.issues
          .map((issue) => asRecord(issue))
          .map((issue) => asString(issue.type))
          .filter(Boolean)
        : [];
      const hypotheses = Array.isArray(record.issue_hypotheses)
        ? record.issue_hypotheses
          .map((item) => asRecord(item))
          .slice(0, 3)
          .map((item) => ({
            type: asString(item.type),
            confidence: asNumber(item.confidence)
          }))
          .filter((item) => item.type)
        : [];

      return {
        issues,
        top_hypotheses: hypotheses,
        extraction: sanitizeClassifierExtraction(record.extraction),
        facts: asRecord(record.facts),
        scope_flags: sanitizeScopeFlags(record.scope_flags),
        scope_filter: {
          supported_issues: sanitizeStringArray(record.supported_issues),
          unsupported_issues: sanitizeStringArray(record.unsupported_issues),
          scope_warnings: sanitizeStringArray(record.scope_warnings)
        },
        supported_issues: sanitizeStringArray(record.supported_issues),
        unsupported_issues: sanitizeStringArray(record.unsupported_issues),
        scope_warnings: sanitizeStringArray(record.scope_warnings),
        is_criminal: Boolean(record.is_criminal),
        is_civil: Boolean(record.is_civil)
      };
    }
    case "law": {
      const laws = Array.isArray(record.laws)
        ? record.laws
          .map((law) => asRecord(law))
          .slice(0, 3)
          .map((law) => ({
            law_name: asString(law.law_name),
            article_no: asString(law.article_no),
            article_title: asString(law.article_title)
          }))
        : [];

      return {
        count: Array.isArray(record.laws) ? record.laws.length : 0,
        laws
      };
    }
    case "precedent": {
      const precedents = Array.isArray(record.precedents)
        ? record.precedents
          .map((precedent) => asRecord(precedent))
          .slice(0, 3)
          .map((precedent) => ({
            case_no: asString(precedent.case_no),
            court: asString(precedent.court),
            verdict: asString(precedent.verdict)
          }))
        : [];

      return {
        count: Array.isArray(record.precedents) ? record.precedents.length : 0,
        precedents
      };
    }
    case "analysis": {
      const legal = sanitizePublicLegalAnalysis(record);
      return {
        summary: asString(legal.summary, "분석 결과"),
        risk_level: asNumber(legal.risk_level, 0),
        can_sue: Boolean(legal.can_sue),
        scope_assessment: legal.scope_assessment
      };
    }
    default:
      return {};
  }
}

export function buildStoredAnalysisResult(result: Record<string, unknown>): Record<string, unknown> {
  const meta = asRecord(result.meta);
  const legalAnalysis = asRecord(result.legal_analysis);
  const providerMode = asString(meta.provider_mode, "mock");
  const providerSource = inferProviderSource(result);

  return {
    meta: {
      provider_mode: providerMode,
      provider_source: providerSource,
      provider_notice: buildProviderNotice(providerMode, providerSource),
      generated_at: asString(meta.generated_at, new Date().toISOString()),
      input_type: asString(meta.input_type, "text"),
      context_type: asString(meta.context_type, "other")
    },
    legal_analysis: sanitizeStoredLegalAnalysis(legalAnalysis)
  };
}

function inferProviderSource(result: Record<string, unknown>): string {
  const meta = asRecord(result.meta);
  const traceEntries = [
    ...(Array.isArray(meta.retrieval_trace) ? meta.retrieval_trace : []),
    ...(Array.isArray(asRecord(result.law_search).retrieval_trace) ? asRecord(result.law_search).retrieval_trace as unknown[] : []),
    ...(Array.isArray(asRecord(result.precedent_search).retrieval_trace) ? asRecord(result.precedent_search).retrieval_trace as unknown[] : [])
  ];

  for (const rawEntry of traceEntries) {
    const entry = asRecord(rawEntry);
    const reason = asString(entry.reason).toLowerCase();
    if (reason.includes("provider_source=live_fallback")) {
      return "live_fallback";
    }
    if (reason.includes("provider_source=live")) {
      return "live";
    }
    if (reason.includes("provider_source=fixture")) {
      return "fixture";
    }
  }

  return asString(meta.provider_mode, "mock") === "live" ? "live" : "fixture";
}

function buildProviderNotice(providerMode: string, providerSource: string): string {
  if (providerSource === "live") {
    return "실제 provider 결과를 공용 retrieval 계약으로 정규화해 표시했습니다.";
  }

  if (providerSource === "live_fallback") {
    return "live 모드로 요청됐지만 현재 실행에서는 실제 provider가 연결되지 않아 fixture 결과로 대체했습니다.";
  }

  return providerMode === "live"
    ? "live 모드 설정이지만 이번 응답은 fixture 기준으로 처리됐습니다."
    : "mock fixture 기준 결과입니다.";
}

export function buildStoredRuntimeArtifacts(result: Record<string, unknown>): StoredRuntimeArtifacts {
  const meta = asRecord(result.meta);
  const preview = asRecord(meta.retrieval_preview);
  const trace = Array.isArray(meta.retrieval_trace)
    ? meta.retrieval_trace
      .map((entry) => asRecord(entry))
      .filter((entry) => Object.keys(entry).length > 0)
      .map((entry) => ({
        ...(entry.stage !== undefined ? { stage: asString(entry.stage) } : {}),
        ...(entry.tool !== undefined ? { tool: asString(entry.tool) } : {}),
        ...(entry.provider !== undefined ? { provider: asString(entry.provider) } : {}),
        ...(entry.duration_ms !== undefined ? { duration_ms: asNumber(entry.duration_ms, 0) } : {}),
        ...(entry.input_ref !== undefined ? { input_ref: asString(entry.input_ref) } : {}),
        ...(entry.output_ref !== undefined ? { output_ref: sanitizeStringArray(entry.output_ref) } : {}),
        ...(entry.reason !== undefined ? { reason: asString(entry.reason) } : {}),
        ...(entry.cache_hit !== undefined ? { cache_hit: asBoolean(entry.cache_hit) } : {})
      }))
    : [];

  return {
    preview,
    trace
  };
}

export function buildPublicAnalysisResult(
  jobId: string,
  result: Record<string, unknown>,
  referenceLibrary: ReferenceLibraryItem[],
  persisted?: { caseId?: string; runId?: string }
): PublicAnalysisResult {
  const meta = asRecord(result.meta);
  const legalAnalysis = asRecord(result.legal_analysis);
  const profileContext = sanitizePublicProfileContext(legalAnalysis.profile_context as Record<string, unknown> | null | undefined);
  const providerMode = asString(meta.provider_mode, "mock");
  const providerSource = inferProviderSource(result);

  return {
    job_id: jobId,
    status: "completed",
    ocr: buildPublicAgentResult("ocr", result.ocr),
    classification: buildPublicAgentResult("classifier", result.classification),
    retrieval_plan: sanitizePublicRetrievalPlan(result.retrieval_plan),
    law_search: sanitizePublicSearchStageResult("law", result.law_search),
    precedent_search: sanitizePublicSearchStageResult("precedent", result.precedent_search),
    legal_analysis: sanitizePublicLegalAnalysis(legalAnalysis),
    reference_library: {
      items: referenceLibrary
    },
    meta: {
      provider_mode: providerMode,
      provider_source: providerSource,
      provider_notice: buildProviderNotice(providerMode, providerSource),
      generated_at: asString(meta.generated_at, new Date().toISOString()),
      input_type: asString(meta.input_type, "text"),
      context_type: asString(meta.context_type, "other")
    },
    timeline: sanitizeTimeline(result.timeline),
    ...(persisted?.caseId ? { case_id: persisted.caseId } : {}),
    ...(persisted?.runId ? { run_id: persisted.runId } : {}),
    ...(profileContext ? { profile_context: profileContext } : {})
  };
}
