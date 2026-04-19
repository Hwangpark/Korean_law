import type { ReferenceLibraryItem } from "../analysis/references.js";
import {
  buildJudgmentCore,
  buildJudgmentProfileConsiderations
} from "../analysis/judgment-core.mjs";
import { buildClaimSupport } from "../analysis/claim-support.mjs";
import { buildAnswerDisposition } from "../analysis/answer-disposition.mjs";
import { applyPreOutputSafetyGate } from "../analysis/safety-gate.mjs";
import type {
  CandidateIssue,
  EvidenceCitation,
  KeywordVerificationRequest,
  KeywordQueryPlan,
  KeywordVerificationResponse,
  VerifiedReferenceCard
} from "./types.js";

export interface VerificationCorePayloadInput {
  plan: KeywordQueryPlan;
  responsePlan: KeywordVerificationResponse["plan"];
  summary: string;
  interpretation: string;
  disclaimer: string;
  retrievalPreview: NonNullable<KeywordVerificationResponse["retrieval_preview"]>;
  retrievalTrace: NonNullable<KeywordVerificationResponse["retrieval_trace"]>;
  retrievalEvidencePack: KeywordVerificationResponse["retrieval_evidence_pack"];
}

export interface LegalAnalysisPayloadInput {
  request: KeywordVerificationRequest;
  matchedLaws: VerifiedReferenceCard[];
  matchedPrecedents: VerifiedReferenceCard[];
  allReferences: ReferenceLibraryItem[];
  retrievalEvidencePack: KeywordVerificationResponse["retrieval_evidence_pack"];
  scopeAssessment: NonNullable<KeywordVerificationResponse["legal_analysis"]["scope_assessment"]>;
  groundingEvidence: NonNullable<KeywordVerificationResponse["legal_analysis"]["grounding_evidence"]>;
  issueCandidates: CandidateIssue[];
  summary: string;
  disclaimer: string;
  riskLevel: number;
  profileConsiderations: string[];
  verifier?: NonNullable<KeywordVerificationResponse["legal_analysis"]["verifier"]>;
}

export interface ReferencePayloadInput {
  matchedLaws: VerifiedReferenceCard[];
  matchedPrecedents: VerifiedReferenceCard[];
  allReferences: ReferenceLibraryItem[];
}

export interface RetrievalPreviewInput {
  law: NonNullable<KeywordVerificationResponse["retrieval_preview"]>["law"];
  precedent: NonNullable<KeywordVerificationResponse["retrieval_preview"]>["precedent"];
}

export const VERIFICATION_DISCLAIMER =
  "본 결과는 참고용 법률 정보이며, 실제 고소 가능성과 전체 쟁점은 원문과 증거, 맥락을 기준으로 별도 검토가 필요합니다.";

const DEFAULT_EXPECTED_PENALTY = "공식 조문 확인 필요";
const DEFAULT_PRECEDENT_VERDICT = "판결";

function confidenceToProbability(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) {
    return "high";
  }
  if (score >= 0.45) {
    return "medium";
  }
  return "low";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildReviewRecommendation(
  legalAnalysis: KeywordVerificationResponse["legal_analysis"]
): NonNullable<KeywordVerificationResponse["legal_analysis"]["review_recommendation"]> {
  const safetyGate = legalAnalysis.safety_gate;
  const verifier = legalAnalysis.verifier;
  const claimSupport = legalAnalysis.claim_support;
  const scopeAssessment = legalAnalysis.scope_assessment;
  const confidenceLabel = verifier?.confidence_calibration?.label ?? "";
  const handoffRecommended =
    Number(legalAnalysis.risk_level ?? 0) >= 4
    || Boolean(scopeAssessment?.procedural_heavy)
    || Boolean(scopeAssessment?.insufficient_facts)
    || Boolean(scopeAssessment?.unsupported_issue_present)
    || Boolean(safetyGate?.adjusted_output)
    || verifier?.status === "needs_caution"
    || confidenceLabel === "low";

  const abstainReasons = uniqueStrings([
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && scopeAssessment?.insufficient_facts)
      ? "핵심 사실이 더 필요해 확정 판단을 보류했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && scopeAssessment?.procedural_heavy)
      ? "절차 중심 사안이라 개별 사실판단보다 절차 확인과 전문가 검토를 우선했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && scopeAssessment?.unsupported_issue_present)
      ? "지원 범위를 벗어난 쟁점이 섞여 있어 단정 결론을 제한했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && safetyGate?.blocked_reasons?.includes("citation_integrity"))
      ? "직접 연결된 법령·판례 인용이 완전하지 않아 단정 결론을 피했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && claimSupport?.overall === "missing")
      ? "최종 판단 문장에 직접 연결된 근거가 부족해 보수적으로 답했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && claimSupport?.overall === "partial")
      ? "일부 판단 문장이 부분 근거만 연결돼 있어 단정 표현을 줄였습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && verifier?.contradiction_detected)
      ? "지원 범위와 내부 쟁점 신호 사이 충돌 가능성이 있어 확정 판단을 보류했습니다."
      : undefined,
    ((!legalAnalysis.can_sue || safetyGate?.adjusted_output) && confidenceLabel === "low")
      ? "현재 근거 신뢰도가 낮아 참고용 안내로 제한했습니다."
      : undefined
  ]).slice(0, 4);

  const uncertaintyReasons = uniqueStrings([
    scopeAssessment?.insufficient_facts ? "사실관계가 더 필요해 추가 검토가 안전합니다." : undefined,
    scopeAssessment?.procedural_heavy ? "절차 중심 사안이라 개별 대응은 전문가 검토가 안전합니다." : undefined,
    scopeAssessment?.unsupported_issue_present ? "지원 범위를 벗어난 쟁점이 섞여 있어 단정적 안내를 피해야 합니다." : undefined,
    Number(legalAnalysis.risk_level ?? 0) >= 4 ? "고위험 사안일 수 있어 변호사 상담 필요성을 함께 검토하는 편이 안전합니다." : undefined,
    confidenceLabel === "low" ? "현재 근거 신뢰도가 낮아 추가 검토가 필요합니다." : undefined,
    ...(Array.isArray(safetyGate?.warnings) ? safetyGate.warnings : []),
    ...(Array.isArray(verifier?.warnings) ? verifier.warnings : [])
  ]).slice(0, 4);

  return {
    handoff_recommended: handoffRecommended,
    abstain_reasons: abstainReasons,
    uncertainty_reasons: uncertaintyReasons
  };
}

export function buildProfileConsiderations(
  profileContext?: KeywordVerificationRequest["profileContext"]
): string[] {
  return buildJudgmentProfileConsiderations({
    profileContext
  });
}

export function severityToRiskLevel(severity: "low" | "medium" | "high" | undefined): number {
  switch (severity) {
    case "high":
      return 5;
    case "medium":
      return 3;
    default:
      return 1;
  }
}

export function buildResponsePlan(plan: KeywordQueryPlan): KeywordVerificationResponse["plan"] {
  return {
    tokens: plan.tokens,
    candidate_issues: plan.candidateIssues,
    broad_law_queries: plan.broadLawQueries,
    precise_law_queries: plan.preciseLawQueries,
    broad_precedent_queries: plan.broadPrecedentQueries,
    precise_precedent_queries: plan.precisePrecedentQueries,
    law_queries: plan.lawQueries,
    precedent_queries: plan.precedentQueries,
    warnings: plan.warnings,
    supported_issues: plan.supportedIssues,
    unsupported_issues: plan.unsupportedIssues,
    scope_warnings: plan.scopeWarnings,
    scope_flags: plan.scopeFlags,
    scope_filter: {
      supported_issues: plan.supportedIssues,
      unsupported_issues: plan.unsupportedIssues,
      scope_warnings: plan.scopeWarnings
    }
  };
}

export function buildRetrievalPreview(
  input: RetrievalPreviewInput
): NonNullable<KeywordVerificationResponse["retrieval_preview"]> {
  return {
    law: input.law,
    precedent: input.precedent
  };
}

function buildCitationByReference(
  retrievalEvidencePack: KeywordVerificationResponse["retrieval_evidence_pack"]
): Map<string, EvidenceCitation> {
  const citations = new Map<string, EvidenceCitation>();

  for (const citation of retrievalEvidencePack.citation_map?.citations ?? []) {
    citations.set(citation.reference_id, citation);
    citations.set(citation.reference_key, citation);
  }

  return citations;
}

function buildLawGrounding(
  item: VerifiedReferenceCard,
  citation?: EvidenceCitation
): NonNullable<KeywordVerificationResponse["legal_analysis"]["charges"][number]["grounding"]> {
  return {
    law_reference_id: item.referenceKey,
    precedent_reference_ids: [],
    evidence_count: citation ? 1 : 0,
    ...(citation
      ? {
          citation_id: citation.citation_id,
          reference_key: citation.reference_key,
          query_refs: citation.query_refs,
          match_reason: citation.match_reason,
          snippet: citation.snippet
        }
      : {})
  };
}

function buildPrecedentGrounding(
  item: VerifiedReferenceCard,
  citation?: EvidenceCitation
): NonNullable<KeywordVerificationResponse["legal_analysis"]["precedent_cards"][number]["grounding"]> {
  return {
    reference_id: item.referenceKey,
    reference_key: item.referenceKey,
    evidence_count: citation ? 1 : 0,
    ...(citation
      ? {
          citation_id: citation.citation_id,
          query_refs: citation.query_refs,
          match_reason: citation.match_reason,
          snippet: citation.snippet
        }
      : {})
  };
}

function indexCitations(citations: EvidenceCitation[], key: "reference_id" | "statement_path"): Record<string, string[]> {
  return citations.reduce<Record<string, string[]>>((accumulator, citation) => {
    const value = citation[key];
    if (!value) {
      return accumulator;
    }
    if (!accumulator[value]) {
      accumulator[value] = [];
    }
    accumulator[value].push(citation.citation_id);
    return accumulator;
  }, {});
}

function buildDerivedCitationId(citation: EvidenceCitation, statementType: EvidenceCitation["statement_type"], statementPath: string): string {
  return `${citation.citation_id}:${statementType}:${statementPath}`;
}

function buildLegalAnalysisCitationMap(
  retrievalEvidencePack: KeywordVerificationResponse["retrieval_evidence_pack"],
  charges: KeywordVerificationResponse["legal_analysis"]["charges"],
  precedentCards: KeywordVerificationResponse["legal_analysis"]["precedent_cards"],
  summary: string
): KeywordVerificationResponse["legal_analysis"]["citation_map"] {
  const baseCitations = Array.isArray(retrievalEvidencePack.citation_map?.citations)
    ? retrievalEvidencePack.citation_map.citations
    : [];
  if (baseCitations.length === 0) {
    return undefined;
  }

  const citationByReference = buildCitationByReference(retrievalEvidencePack);
  const citations: EvidenceCitation[] = [...baseCitations];
  const seenIds = new Set(baseCitations.map((citation) => citation.citation_id));
  const addDerived = (
    referenceKey: string | undefined,
    statementType: EvidenceCitation["statement_type"],
    statementPath: string
  ) => {
    if (!referenceKey) {
      return;
    }
    const citation = citationByReference.get(referenceKey);
    if (!citation) {
      return;
    }
    const derivedCitationId = buildDerivedCitationId(citation, statementType, statementPath);
    if (seenIds.has(derivedCitationId)) {
      return;
    }
    citations.push({
      ...citation,
      citation_id: derivedCitationId,
      statement_type: statementType,
      statement_path: statementPath
    });
    seenIds.add(derivedCitationId);
  };

  charges.forEach((charge, index) => {
    addDerived(charge.grounding?.law_reference_id, "issue_card", `legal_analysis.issue_cards[${index}]`);
  });
  precedentCards.forEach((_card, _index) => {
    return;
  });
  if (summary && charges[0]?.grounding?.law_reference_id) {
    addDerived(charges[0].grounding.law_reference_id, "summary", "legal_analysis.summary");
  }

  return {
    version: "v2",
    citations,
    by_reference_id: indexCitations(citations, "reference_id"),
    by_statement_path: indexCitations(citations, "statement_path")
  };
}

export function buildVerificationCorePayload(input: VerificationCorePayloadInput): Pick<
  KeywordVerificationResponse,
  "query" | "plan" | "verification" | "retrieval_preview" | "retrieval_trace" | "retrieval_evidence_pack"
> {
  return {
    query: {
      original: input.plan.originalQuery,
      normalized: input.plan.normalizedQuery,
      context_type: input.plan.contextType
    },
    plan: input.responsePlan,
    verification: {
      headline: input.summary,
      interpretation: input.interpretation,
      warnings: input.plan.warnings,
      disclaimer: input.disclaimer
    },
    retrieval_preview: input.retrievalPreview,
    retrieval_trace: [...input.retrievalTrace],
    retrieval_evidence_pack: input.retrievalEvidencePack
  };
}

export function buildLegalAnalysisPayload(
  input: LegalAnalysisPayloadInput
): KeywordVerificationResponse["legal_analysis"] {
  const citationByReference = buildCitationByReference(input.retrievalEvidencePack);
  const charges = input.matchedLaws.map((item) => {
    const citation = citationByReference.get(item.referenceKey);
    return {
      charge: item.title,
      basis: item.matchReason,
      elements_met: [item.summary, item.reference.details].filter(Boolean),
      probability: confidenceToProbability(item.confidenceScore),
      expected_penalty: item.reference.penalty ?? DEFAULT_EXPECTED_PENALTY,
      reference_library: [item.reference],
      grounding: buildLawGrounding(item, citation)
    };
  });
  const judgment = buildJudgmentCore({
    charges,
    scopeAssessment: input.scopeAssessment,
    groundingEvidence: input.groundingEvidence,
    issueCandidates: input.issueCandidates,
    baseRiskLevel: input.riskLevel,
    profileContext: input.request.profileContext
  });
  const precedent_cards = input.matchedPrecedents.map((item) => {
    const citation = citationByReference.get(item.referenceKey);
    return {
      case_no: item.reference.caseNo ?? item.title,
      court: item.reference.court ?? item.reference.subtitle,
      verdict: item.reference.verdict ?? DEFAULT_PRECEDENT_VERDICT,
      summary: item.matchReason,
      similarity_score: item.confidenceScore,
      reference_library: [item.reference],
      grounding: buildPrecedentGrounding(item, citation)
    };
  });
  const citation_map = buildLegalAnalysisCitationMap(
    input.retrievalEvidencePack,
    charges,
    precedent_cards,
    input.summary
  );
  const claim_support = buildClaimSupport({
    summary: input.summary,
    charges,
    citationMap: citation_map
  });
  const legalAnalysis = {
    can_sue: judgment.can_sue,
    risk_level: judgment.risk_level,
    summary: input.summary,
    scope_assessment: judgment.scope_assessment,
    grounding_evidence: input.groundingEvidence,
    selected_reference_ids: input.retrievalEvidencePack.selected_reference_ids,
    charges,
    recommended_actions: judgment.recommended_actions,
    evidence_to_collect: judgment.evidence_to_collect,
    decision_axis: judgment.decision_axis,
    precedent_cards,
    disclaimer: input.disclaimer,
    citation_map,
    claim_support,
    reference_library: input.allReferences,
    law_reference_library: input.matchedLaws.map((item) => item.reference),
    precedent_reference_library: input.matchedPrecedents.map((item) => item.reference),
    ...(input.request.profileContext ? { profile_context: input.request.profileContext } : {}),
    ...(input.profileConsiderations.length > 0 ? { profile_considerations: input.profileConsiderations } : {}),
    ...(input.verifier ? { verifier: { ...input.verifier, claim_support } } : {})
  };

  const { legalAnalysis: gatedAnalysis } = applyPreOutputSafetyGate(legalAnalysis, {
    verifier: legalAnalysis.verifier,
    scopeAssessment: input.scopeAssessment
  });

  const reviewRecommendation = buildReviewRecommendation(gatedAnalysis);

  return {
    ...gatedAnalysis,
    review_recommendation: reviewRecommendation,
    answer_disposition: buildAnswerDisposition({
      handoffRecommended: reviewRecommendation.handoff_recommended,
      abstainReasons: reviewRecommendation.abstain_reasons,
      uncertaintyReasons: reviewRecommendation.uncertainty_reasons,
      verifierStatus: gatedAnalysis.verifier?.status,
      blockedReasons: gatedAnalysis.safety_gate?.blocked_reasons
    })
  };
}

export function buildReferencePayload(input: ReferencePayloadInput): Pick<
  KeywordVerificationResponse,
  "matched_laws" | "matched_precedents" | "law_reference_library" | "precedent_reference_library" | "reference_library"
> {
  return {
    matched_laws: input.matchedLaws,
    matched_precedents: input.matchedPrecedents,
    law_reference_library: input.matchedLaws.map((item) => item.reference),
    precedent_reference_library: input.matchedPrecedents.map((item) => item.reference),
    reference_library: {
      items: input.allReferences
    }
  };
}
