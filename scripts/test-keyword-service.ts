import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import { createKeywordVerificationService } from "../apps/api/src/retrieval/service.js";
import type { AnalysisStore } from "../apps/api/src/analysis/store.js";
import type { KeywordVerificationStore } from "../apps/api/src/retrieval/store.js";

type KeywordService = ReturnType<typeof createKeywordVerificationService>;
type VerificationResult = Awaited<ReturnType<KeywordService["verifyKeyword"]>>;

function createReferenceLibraryStub(): Pick<AnalysisStore, "saveReferenceLibrary"> {
  return {
    async saveReferenceLibrary(input) {
      return buildReferenceSeeds(input.result as Record<string, unknown>, input.providerMode).map((seed) => ({
        id: seed.sourceKey,
        kind: seed.kind,
        href: `/api/references/${seed.kind}/${encodeURIComponent(seed.sourceKey)}`,
        title: seed.title,
        subtitle: seed.subtitle,
        summary: seed.summary,
        details: seed.details,
        url: seed.url,
        articleNo: seed.articleNo,
        caseNo: seed.caseNo,
        court: seed.court,
        verdict: seed.verdict,
        penalty: seed.penalty,
        similarityScore: seed.similarityScore,
        sourceMode: seed.sourceMode,
        officialSourceLabel: seed.officialSourceLabel,
        authorityTier: seed.authorityTier,
        referenceDate: seed.referenceDate,
        freshnessStatus: seed.freshnessStatus,
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }));
    }
  };
}

function createKeywordStoreStub(): KeywordVerificationStore {
  return {
    async ensureSchema() {
      return;
    },
    async saveRun() {
      return "stub-run-id";
    }
  };
}

function assertNoUnexpectedNestedPayloads(result: VerificationResult): void {
  if ("verification" in (result.retrieval_evidence_pack as Record<string, unknown>)) {
    throw new Error("retrieval_evidence_pack must not embed verification payload.");
  }

  if ("legal_analysis" in (result.retrieval_evidence_pack as Record<string, unknown>)) {
    throw new Error("retrieval_evidence_pack must not embed legal_analysis payload.");
  }

  if ("query" in (result.legal_analysis as Record<string, unknown>)) {
    throw new Error("legal_analysis must not embed top-level query payload.");
  }

  if ("plan" in (result.legal_analysis as Record<string, unknown>)) {
    throw new Error("legal_analysis must not embed top-level plan payload.");
  }

  if ("verification" in (result.legal_analysis as Record<string, unknown>)) {
    throw new Error("legal_analysis must not embed top-level verification payload.");
  }
}

function assertReferencePayloadConsistency(result: VerificationResult): void {
  const topLevelReferenceIds = result.reference_library.items.map((item) => item.id);
  const legalAnalysisReferenceIds = result.legal_analysis.reference_library.map((item) => item.id);
  const lawReferenceIds = result.law_reference_library.map((item) => item.id);
  const precedentReferenceIds = result.precedent_reference_library.map((item) => item.id);
  const matchedLawReferenceIds = result.matched_laws.map((item) => item.reference.id);
  const matchedPrecedentReferenceIds = result.matched_precedents.map((item) => item.reference.id);

  if (JSON.stringify(topLevelReferenceIds) !== JSON.stringify(legalAnalysisReferenceIds)) {
    throw new Error("expected legal_analysis reference_library to stay aligned with top-level reference_library.");
  }

  if (JSON.stringify(lawReferenceIds) !== JSON.stringify(matchedLawReferenceIds)) {
    throw new Error("expected law_reference_library to stay aligned with matched_laws references.");
  }

  if (JSON.stringify(precedentReferenceIds) !== JSON.stringify(matchedPrecedentReferenceIds)) {
    throw new Error("expected precedent_reference_library to stay aligned with matched_precedents references.");
  }

  for (const charge of result.legal_analysis.charges) {
    for (const reference of charge.reference_library) {
      if (!topLevelReferenceIds.includes(reference.id)) {
        throw new Error("charge reference_library must only point at top-level reference_library items.");
      }
    }
  }

  for (const card of result.legal_analysis.precedent_cards) {
    for (const reference of card.reference_library) {
      if (!topLevelReferenceIds.includes(reference.id)) {
        throw new Error("precedent card reference_library must only point at top-level reference_library items.");
      }
    }
  }
}

async function main(): Promise<void> {
  const service = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore: createReferenceLibraryStub() as AnalysisStore,
    keywordStore: createKeywordStoreStub()
  });

  const result = await service.verifyKeyword({
    query: "카카오톡 단톡방에 허위사실을 올리고 전화번호를 공개했습니다",
    contextType: "messenger",
    limit: 3,
    profileContext: {
      birthDate: "2010-01-01",
      nationality: "foreign",
      ageYears: 16,
      ageBand: "child",
      isMinor: true,
      legalNotes: ["미성년자 검토 필요"]
    }
  });

  if (!result.legal_analysis) {
    throw new Error("keyword service did not produce legal_analysis.");
  }

  if (!result.verification.headline || !result.verification.interpretation || !result.verification.disclaimer) {
    throw new Error("expected verification core payload to remain on the top-level response.");
  }

  if (result.matched_laws.length === 0) {
    throw new Error("expected at least one matched law.");
  }

  if (result.reference_library.items.length === 0) {
    throw new Error("expected reference_library items.");
  }

  if (result.plan.candidate_issues[0]?.type !== "명예훼손") {
    throw new Error("expected query to map to 명예훼손 as the top issue.");
  }

  if ((result.plan.precise_law_queries?.length ?? 0) === 0) {
    throw new Error("expected precise law queries.");
  }

  if (!result.matched_laws.every((item) => Array.isArray(item.querySourceTags))) {
    throw new Error("expected matched laws to expose query source tags.");
  }

  if (!result.matched_precedents.every((item) => Array.isArray(item.querySourceTags))) {
    throw new Error("expected matched precedents to expose query source tags.");
  }

  if (typeof result.plan.scope_flags?.proceduralHeavy !== "boolean") {
    throw new Error("expected scope flags on the query plan.");
  }

  if (!Array.isArray(result.plan.supported_issues) || !Array.isArray(result.plan.unsupported_issues)) {
    throw new Error("expected supported/unsupported issue lists on the query plan.");
  }

  if (!Array.isArray(result.plan.scope_warnings)) {
    throw new Error("expected scope warnings on the query plan.");
  }

  if (
    JSON.stringify(result.plan.scope_filter)
    !== JSON.stringify({
      supported_issues: result.plan.supported_issues,
      unsupported_issues: result.plan.unsupported_issues,
      scope_warnings: result.plan.scope_warnings
    })
  ) {
    throw new Error("expected scope_filter snapshot to stay aligned with the legacy scope fields.");
  }

  if ((result.legal_analysis.profile_considerations?.length ?? 0) === 0) {
    throw new Error("expected profile considerations.");
  }

  if (!result.retrieval_preview?.law || !result.retrieval_preview?.precedent) {
    throw new Error("expected retrieval previews from the shared tool runtime.");
  }

  if (!Array.isArray(result.retrieval_trace) || result.retrieval_trace.length < 2) {
    throw new Error("expected retrieval trace from the shared tool runtime.");
  }

  if (!result.retrieval_evidence_pack) {
    throw new Error("expected retrieval_evidence_pack.");
  }

  if (result.retrieval_evidence_pack.run_id !== result.run_id) {
    throw new Error("expected retrieval_evidence_pack to keep the run id.");
  }

  if (JSON.stringify(result.retrieval_evidence_pack.query) !== JSON.stringify(result.query)) {
    throw new Error("expected retrieval_evidence_pack query snapshot to match top-level query.");
  }

  if (JSON.stringify(result.retrieval_evidence_pack.plan) !== JSON.stringify(result.plan)) {
    throw new Error("expected retrieval_evidence_pack plan snapshot to match top-level plan.");
  }

  if (JSON.stringify(result.retrieval_evidence_pack.matched_laws) !== JSON.stringify(result.matched_laws)) {
    throw new Error("expected retrieval_evidence_pack matched_laws to match top-level matched_laws.");
  }

  if (JSON.stringify(result.retrieval_evidence_pack.matched_precedents) !== JSON.stringify(result.matched_precedents)) {
    throw new Error("expected retrieval_evidence_pack matched_precedents to match top-level matched_precedents.");
  }

  if (JSON.stringify(result.retrieval_evidence_pack.reference_library) !== JSON.stringify(result.reference_library)) {
    throw new Error("expected retrieval_evidence_pack reference_library to match top-level reference_library.");
  }

  if ((result.retrieval_evidence_pack.selected_reference_ids?.length ?? 0) === 0) {
    throw new Error("expected retrieval_evidence_pack selected references.");
  }

  if (!result.legal_analysis.scope_assessment) {
    throw new Error("expected legal_analysis scope assessment.");
  }

  if (!result.legal_analysis.grounding_evidence) {
    throw new Error("expected legal_analysis grounding evidence.");
  }

  if (result.legal_analysis.claim_support?.overall !== result.legal_analysis.verifier?.claim_support?.overall) {
    throw new Error("expected legal_analysis claim_support to stay aligned with verifier claim_support.");
  }

  if (result.legal_analysis.safety_gate?.stage !== "pre_output_safety_gate") {
    throw new Error("expected keyword legal_analysis to expose pre_output_safety_gate metadata.");
  }

  if (result.legal_analysis.safety_gate?.status !== "passed" && result.legal_analysis.can_sue !== false) {
    throw new Error("expected adjusted keyword safety gate outputs to downgrade can_sue.");
  }

  if (!result.legal_analysis.review_recommendation) {
    throw new Error("expected keyword legal_analysis to expose review recommendation metadata.");
  }

  if (!Array.isArray(result.legal_analysis.review_recommendation.abstain_reasons)) {
    throw new Error("expected keyword review recommendation abstain reasons.");
  }

  if (
    result.legal_analysis.answer_disposition !== "direct_answer"
    && result.legal_analysis.answer_disposition !== "limited_answer"
    && result.legal_analysis.answer_disposition !== "handoff_recommended"
    && result.legal_analysis.answer_disposition !== "safety_first_handoff"
  ) {
    throw new Error("expected keyword legal_analysis to expose a stable answer disposition.");
  }

  if (result.legal_analysis.safety_gate?.status !== "passed") {
    if (result.legal_analysis.review_recommendation.abstain_reasons.length === 0) {
      throw new Error("expected adjusted keyword outputs to explain why the answer abstained.");
    }

    if (
      result.legal_analysis.answer_disposition !== "handoff_recommended"
      && result.legal_analysis.answer_disposition !== "safety_first_handoff"
    ) {
      throw new Error("expected adjusted keyword outputs to force a handoff disposition.");
    }
  }

  if (typeof result.legal_analysis.can_sue !== "boolean" || typeof result.legal_analysis.risk_level !== "number") {
    throw new Error("expected legal_analysis judgment outputs.");
  }

  if ((result.legal_analysis.selected_reference_ids?.length ?? 0) === 0) {
    throw new Error("expected legal_analysis selected reference ids.");
  }

  if (result.legal_analysis.grounding_evidence.top_issue !== result.retrieval_evidence_pack.top_issue_types[0]) {
    throw new Error("expected top issue to match between legal_analysis and retrieval_evidence_pack.");
  }

  if (result.legal_analysis.grounding_evidence.evidence_strength !== result.retrieval_evidence_pack.evidence_strength) {
    throw new Error("expected evidence strength to match between legal_analysis and retrieval_evidence_pack.");
  }

  if (
    JSON.stringify(result.legal_analysis.selected_reference_ids)
    !== JSON.stringify(result.retrieval_evidence_pack.selected_reference_ids)
  ) {
    throw new Error("expected selected reference ids to match between legal_analysis and retrieval_evidence_pack.");
  }

  if (result.plan.scope_flags.proceduralHeavy !== result.legal_analysis.scope_assessment?.procedural_heavy) {
    throw new Error("expected procedural scope flag mapping to stay aligned.");
  }

  if (result.plan.scope_flags.insufficientFacts !== result.legal_analysis.scope_assessment?.insufficient_facts) {
    throw new Error("expected insufficient facts scope flag mapping to stay aligned.");
  }

  if (
    result.plan.scope_flags.unsupportedIssuePresent
    !== result.legal_analysis.scope_assessment?.unsupported_issue_present
  ) {
    throw new Error("expected unsupported issue scope flag mapping to stay aligned.");
  }

  if (
    JSON.stringify(result.plan.supported_issues)
    !== JSON.stringify(result.legal_analysis.scope_assessment?.supported_issues)
  ) {
    throw new Error("expected supported issue mapping to stay aligned.");
  }

  if (
    JSON.stringify(result.plan.unsupported_issues)
    !== JSON.stringify(result.legal_analysis.scope_assessment?.unsupported_issues)
  ) {
    throw new Error("expected unsupported issue mapping to stay aligned.");
  }

  assertNoUnexpectedNestedPayloads(result);
  assertReferencePayloadConsistency(result);

  process.stdout.write("Keyword service contract checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
