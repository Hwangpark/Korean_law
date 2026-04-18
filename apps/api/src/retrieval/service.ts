import type { ReferenceLibraryItem } from "../analysis/references.js";
import type { AnalysisStore } from "../analysis/store.js";
import { buildCanonicalGroundingArtifacts } from "../analysis/grounding-pipeline.mjs";
import type {
  KeywordVerificationRequest,
  KeywordQueryPlan,
  KeywordVerificationResponse,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  VerificationActor,
  VerifiedReferenceCard
} from "./types.js";
import type { KeywordVerificationStore } from "./store.js";
import { createRetrievalTools } from "./tools.js";
import {
  buildVerificationHeadline,
  buildVerificationInterpretation
} from "./verification.js";
import {
  buildLegalAnalysisPayload,
  buildProfileConsiderations,
  buildReferencePayload,
  buildResponsePlan,
  buildRetrievalPreview,
  buildVerificationCorePayload,
  VERIFICATION_DISCLAIMER,
  severityToRiskLevel
} from "./verification-core.js";

export interface KeywordVerificationService {
  verifyKeyword(
    request: KeywordVerificationRequest,
    actor?: VerificationActor
  ): Promise<KeywordVerificationResponse>;
}

interface KeywordVerificationServiceDeps {
  providerMode: string;
  analysisStore: AnalysisStore;
  keywordStore: KeywordVerificationStore;
}

interface LawSearchRuntimeResult {
  provider: string;
  laws: LawDocumentRecord[];
  retrieval_preview: NonNullable<KeywordVerificationResponse["retrieval_preview"]>["law"];
  retrieval_trace: NonNullable<KeywordVerificationResponse["retrieval_trace"]>;
}

interface PrecedentSearchRuntimeResult {
  provider: string;
  precedents: PrecedentDocumentRecord[];
  retrieval_preview: NonNullable<KeywordVerificationResponse["retrieval_preview"]>["precedent"];
  retrieval_trace: NonNullable<KeywordVerificationResponse["retrieval_trace"]>;
}

interface VerificationArtifacts {
  responsePlan: KeywordVerificationResponse["plan"];
  retrievalPreview: NonNullable<KeywordVerificationResponse["retrieval_preview"]>;
  retrievalTrace: NonNullable<KeywordVerificationResponse["retrieval_trace"]>;
  matchedLaws: VerifiedReferenceCard[];
  matchedPrecedents: VerifiedReferenceCard[];
  allReferences: ReferenceLibraryItem[];
  retrievalEvidencePack: KeywordVerificationResponse["retrieval_evidence_pack"];
  scopeAssessment: NonNullable<KeywordVerificationResponse["legal_analysis"]["scope_assessment"]>;
  groundingEvidence: NonNullable<KeywordVerificationResponse["legal_analysis"]["grounding_evidence"]>;
  verifier: NonNullable<KeywordVerificationResponse["legal_analysis"]["verifier"]>;
}

async function buildVerificationArtifacts(input: {
  providerMode: string;
  plan: KeywordQueryPlan;
  limit: number;
  lawSearch: LawSearchRuntimeResult;
  precedentSearch: PrecedentSearchRuntimeResult;
  saveReferenceLibrary(result: Record<string, unknown>): Promise<ReferenceLibraryItem[]>;
}): Promise<VerificationArtifacts> {
  const canonicalArtifacts = await buildCanonicalGroundingArtifacts({
    providerMode: input.providerMode,
    retrievalPlan: input.plan,
    lawSearch: input.lawSearch,
    precedentSearch: input.precedentSearch,
    limit: input.limit,
    saveReferenceLibrary: input.saveReferenceLibrary
  });

  return {
    responsePlan: buildResponsePlan(input.plan),
    retrievalPreview: buildRetrievalPreview(canonicalArtifacts.retrievalPreview),
    retrievalTrace: canonicalArtifacts.retrievalTrace,
    matchedLaws: canonicalArtifacts.matchedLaws,
    matchedPrecedents: canonicalArtifacts.matchedPrecedents,
    allReferences: canonicalArtifacts.allReferences,
    retrievalEvidencePack: canonicalArtifacts.retrievalEvidencePack,
    scopeAssessment: canonicalArtifacts.scopeAssessment,
    groundingEvidence: canonicalArtifacts.groundingEvidence,
    verifier: canonicalArtifacts.verifier
  };
}

export function createKeywordVerificationService(
  deps: KeywordVerificationServiceDeps
): KeywordVerificationService {
  const retrievalTools = createRetrievalTools({
    providerMode: deps.providerMode,
    analysisStore: deps.analysisStore
  });

  return {
    async verifyKeyword(request, actor = {}) {
      const plan = retrievalTools.buildQueryPlan(request.query, request.contextType, request.profileContext);
      const limit = Math.max(1, Math.min(request.limit ?? 4, 6));

      const [lawSearchResult, precedentSearchResult] = await Promise.all([
        retrievalTools.searchLaws(limit, plan, request.profileContext),
        retrievalTools.searchPrecedents(limit, plan, request.profileContext)
      ]);
      const effectiveProviderMode = lawSearchResult.provider || precedentSearchResult.provider || deps.providerMode;

      const {
        responsePlan,
        retrievalPreview,
        retrievalTrace,
        matchedLaws,
        matchedPrecedents,
        allReferences,
        retrievalEvidencePack,
        scopeAssessment,
        groundingEvidence,
        verifier
      } = await buildVerificationArtifacts({
        providerMode: effectiveProviderMode,
        plan,
        limit,
        lawSearch: lawSearchResult,
        precedentSearch: precedentSearchResult,
        saveReferenceLibrary: (result) => retrievalTools.saveReferenceLibrary(result)
      });

      const riskLevel = severityToRiskLevel(plan.candidateIssues[0]?.severity);
      const headline = buildVerificationHeadline(plan, matchedLaws.length + matchedPrecedents.length, {
        scopeAssessment,
        evidenceStrength: groundingEvidence.evidence_strength
      });
      const interpretation = buildVerificationInterpretation(plan, matchedLaws.length + matchedPrecedents.length, {
        scopeAssessment,
        evidenceStrength: groundingEvidence.evidence_strength
      });
      const profileConsiderations = buildProfileConsiderations(request.profileContext);

      const responseWithoutId: Omit<KeywordVerificationResponse, "run_id"> = {
        ...(request.profileContext ? { profile_context: request.profileContext } : {}),
        ...buildVerificationCorePayload({
          plan,
          responsePlan,
          summary: headline,
          interpretation,
          disclaimer: VERIFICATION_DISCLAIMER,
          retrievalPreview,
          retrievalTrace,
          retrievalEvidencePack
        }),
        ...buildReferencePayload({
          matchedLaws,
          matchedPrecedents,
          allReferences
        }),
        legal_analysis: buildLegalAnalysisPayload({
          request,
          matchedLaws,
          matchedPrecedents,
          allReferences,
          retrievalEvidencePack,
          scopeAssessment,
          groundingEvidence,
          issueCandidates: plan.candidateIssues,
          summary: headline,
          disclaimer: VERIFICATION_DISCLAIMER,
          riskLevel,
          profileConsiderations,
          verifier
        })
      };

      const runId = await deps.keywordStore.saveRun({
        actor,
        providerMode: effectiveProviderMode,
        request,
        plan,
        profileSnapshot: request.profileContext ?? null,
        response: responseWithoutId
      });

      return {
        ...responseWithoutId,
        run_id: runId,
        retrieval_evidence_pack: {
          ...responseWithoutId.retrieval_evidence_pack,
          run_id: runId
        }
      };
    }
  };
}
