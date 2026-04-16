import type { ReferenceLibraryItem } from "../apps/api/src/analysis/references.js";
import {
  buildLegalAnalysisPayload,
  buildProfileConsiderations,
  buildReferencePayload,
  buildResponsePlan,
  buildRetrievalPreview,
  buildVerificationCorePayload,
  VERIFICATION_DISCLAIMER,
  severityToRiskLevel
} from "../apps/api/src/retrieval/verification-core.js";
import type {
  CandidateIssue,
  EvidenceQueryRef,
  KeywordQueryPlan,
  KeywordVerificationRequest,
  RetrievalEvidencePack,
  VerifiedReferenceCard
} from "../apps/api/src/retrieval/types.js";

function buildReference(id: string, kind: "law" | "precedent"): ReferenceLibraryItem {
  return {
    id,
    kind,
    href: `/api/references/${kind}/${id}`,
    title: `${kind}-${id}`,
    subtitle: `${kind}-subtitle`,
    summary: `${kind}-summary`,
    details: `${kind}-details`,
    url: null,
    articleNo: kind === "law" ? "제1조" : null,
    caseNo: kind === "precedent" ? "2026다12345" : null,
    court: kind === "precedent" ? "대법원" : null,
    verdict: kind === "precedent" ? "판결" : null,
    penalty: kind === "law" ? "3년 이하 징역" : null,
    similarityScore: null,
    sourceMode: "mock",
    keywords: ["명예훼손"],
    caseId: null,
    runId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function buildMatchedQuery(text: string): EvidenceQueryRef {
  return {
    text,
    bucket: "precise",
    channel: "law"
  };
}

function buildLawCard(reference: ReferenceLibraryItem): VerifiedReferenceCard {
  return {
    id: "law-card-1",
    referenceKey: reference.id,
    kind: "law",
    title: "형법 제307조",
    subtitle: "허위사실 적시",
    summary: "허위사실 적시 명예훼손 조항",
    confidenceScore: 0.88,
    matchReason: "허위사실 적시와 공연성 표현이 직접 맞닿아 있습니다.",
    matchedQueries: [buildMatchedQuery("명예훼손 허위사실 공연성")],
    matchedIssueTypes: ["명예훼손"],
    snippet: {
      field: "content",
      text: "공연히 사실 또는 허위 사실을 적시..."
    },
    source: {
      law_name: "형법",
      article_no: "제307조",
      article_title: "명예훼손",
      penalty: "3년 이하 징역",
      url: "https://example.test/law"
    },
    reference
  };
}

function buildPrecedentCard(reference: ReferenceLibraryItem): VerifiedReferenceCard {
  return {
    id: "precedent-card-1",
    referenceKey: reference.id,
    kind: "precedent",
    title: "2026다12345",
    subtitle: "대법원 2026. 4. 1.",
    summary: "단톡방 허위사실 적시 판례",
    confidenceScore: 0.76,
    matchReason: "단체 대화방과 허위사실 적시 구조가 유사합니다.",
    matchedQueries: [buildMatchedQuery("카카오톡 단톡방 허위사실")],
    matchedIssueTypes: ["명예훼손"],
    snippet: {
      field: "summary",
      text: "단체 대화방에서 허위 사실을 적시한 사안..."
    },
    source: {
      case_no: "2026다12345",
      court: "대법원",
      verdict: "판결",
      sentence: "유죄 취지"
    },
    reference
  };
}

function buildPlan(candidateIssues: CandidateIssue[]): KeywordQueryPlan {
  return {
    originalQuery: "카카오톡 단톡방에 허위사실을 올렸어요",
    normalizedQuery: "카카오톡 단톡방 허위사실",
    contextType: "messenger",
    tokens: ["카카오톡", "단톡방", "허위사실"],
    candidateIssues,
    broadLawQueries: ["명예훼손"],
    preciseLawQueries: ["명예훼손 허위사실 공연성"],
    broadPrecedentQueries: ["명예훼손 단톡방"],
    precisePrecedentQueries: ["카카오톡 단톡방 허위사실"],
    lawQueries: ["명예훼손 허위사실 공연성"],
    precedentQueries: ["카카오톡 단톡방 허위사실"],
    warnings: ["참고용 법률 정보입니다."],
    supportedIssues: ["명예훼손"],
    unsupportedIssues: [],
    scopeWarnings: [],
    scopeFlags: {
      proceduralHeavy: false,
      insufficientFacts: false,
      unsupportedIssuePresent: false
    }
  };
}

async function main(): Promise<void> {
  const candidateIssues: CandidateIssue[] = [{
    type: "명예훼손",
    severity: "high",
    matchedTerms: ["허위사실", "단톡방"],
    lawQueries: ["명예훼손 허위사실 공연성"],
    precedentQueries: ["카카오톡 단톡방 허위사실"],
    reason: "허위사실 적시와 공연성 신호가 모두 보입니다."
  }];

  const plan = buildPlan(candidateIssues);
  const responsePlan = buildResponsePlan(plan);
  if (
    JSON.stringify(responsePlan.scope_filter)
    !== JSON.stringify({
      supported_issues: responsePlan.supported_issues,
      unsupported_issues: responsePlan.unsupported_issues,
      scope_warnings: responsePlan.scope_warnings
    })
  ) {
    throw new Error("response plan must keep scope_filter aligned with the legacy scope fields.");
  }
  const retrievalPreview = buildRetrievalPreview({
    law: {
      headline: "명예훼손 관련 법령 후보",
      top_issues: ["명예훼손"],
      top_laws: [{ id: "law-1", title: "형법 제307조", summary: "명예훼손 조항" }],
      top_precedents: [],
      profile_flags: ["미성년자"],
      disclaimer: VERIFICATION_DISCLAIMER
    },
    precedent: {
      headline: "명예훼손 관련 판례 후보",
      top_issues: ["명예훼손"],
      top_laws: [],
      top_precedents: [{ id: "prec-1", title: "2026다12345", summary: "단톡방 허위사실 판례" }],
      profile_flags: [],
      disclaimer: VERIFICATION_DISCLAIMER
    }
  });

  const lawReference = buildReference("law::형법::제307조", "law");
  const precedentReference = buildReference("precedent::2026다12345", "precedent");
  const matchedLaws = [buildLawCard(lawReference)];
  const matchedPrecedents = [buildPrecedentCard(precedentReference)];
  const allReferences = [lawReference, precedentReference];

  const retrievalEvidencePack: RetrievalEvidencePack = {
    version: "v2",
    query: {
      original: plan.originalQuery,
      normalized: plan.normalizedQuery,
      context_type: plan.contextType
    },
    plan: responsePlan,
    retrieval_preview: retrievalPreview,
    retrieval_trace: [],
    matched_laws: matchedLaws,
    matched_precedents: matchedPrecedents,
    reference_library: {
      items: allReferences
    },
    selected_reference_ids: allReferences.map((item) => item.id),
    top_issue_types: ["명예훼손"],
    evidence_strength: "high"
  };

  const verificationCore = buildVerificationCorePayload({
    plan,
    responsePlan,
    summary: "명예훼손 쟁점이 가장 강합니다.",
    interpretation: "허위사실 적시와 공연성 신호가 함께 확인됩니다.",
    disclaimer: VERIFICATION_DISCLAIMER,
    retrievalPreview,
    retrievalTrace: [],
    retrievalEvidencePack
  });

  if (verificationCore.query.original !== plan.originalQuery) {
    throw new Error("verification core must preserve the original query.");
  }

  if (verificationCore.verification.disclaimer !== VERIFICATION_DISCLAIMER) {
    throw new Error("verification core must preserve the shared disclaimer.");
  }

  const profileContext: KeywordVerificationRequest["profileContext"] = {
    ageYears: 16,
    ageBand: "child",
    isMinor: true,
    nationality: "foreign",
    legalNotes: ["미성년자 검토 필요"]
  };
  const considerations = buildProfileConsiderations(profileContext);

  if (considerations.length < 4) {
    throw new Error("expected profile considerations to cover age, minor status, nationality, and notes.");
  }

  if (severityToRiskLevel("high") !== 5 || severityToRiskLevel("medium") !== 3 || severityToRiskLevel("low") !== 1) {
    throw new Error("severityToRiskLevel must keep the agreed severity mapping.");
  }

  const referencePayload = buildReferencePayload({
    matchedLaws,
    matchedPrecedents,
    allReferences
  });

  if (referencePayload.reference_library.items.length !== 2) {
    throw new Error("reference payload must preserve all reference items.");
  }

  const analysisPayload = buildLegalAnalysisPayload({
    request: {
      query: plan.originalQuery,
      contextType: plan.contextType,
      profileContext
    },
    matchedLaws,
    matchedPrecedents,
    allReferences,
    retrievalEvidencePack,
    scopeAssessment: {
      supported_issues: ["명예훼손"],
      unsupported_issues: [],
      procedural_heavy: false,
      insufficient_facts: false,
      unsupported_issue_present: false,
      warnings: []
    },
    groundingEvidence: {
      top_issue: "명예훼손",
      evidence_strength: "high"
    },
    issueCandidates: candidateIssues,
    summary: "명예훼손 쟁점이 가장 강합니다.",
    disclaimer: VERIFICATION_DISCLAIMER,
    riskLevel: 5,
    profileConsiderations: considerations
  });

  if (analysisPayload.charges[0]?.expected_penalty !== "3년 이하 징역") {
    throw new Error("analysis payload must preserve explicit law penalties.");
  }

  if (analysisPayload.precedent_cards[0]?.verdict !== "판결") {
    throw new Error("analysis payload must default precedent verdict to 판결.");
  }

  if ((analysisPayload.profile_considerations?.length ?? 0) === 0) {
    throw new Error("analysis payload must keep profile considerations.");
  }

  if ((analysisPayload.recommended_actions?.length ?? 0) === 0 || (analysisPayload.evidence_to_collect?.length ?? 0) === 0) {
    throw new Error("analysis payload must build shared guidance items.");
  }

  process.stdout.write("Verification core checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
