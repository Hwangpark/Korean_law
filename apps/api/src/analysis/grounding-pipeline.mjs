import {
  buildReferenceSeeds,
  materializeReferenceSeed
} from "./references.js";
import {
  buildGroundingEvidenceFromRetrievalPack,
  buildScopeAssessment
} from "./evidence.mjs";
import { buildPreAnalysisVerifier } from "./verifier.mjs";
import {
  buildLawVerificationCards,
  buildPrecedentVerificationCards,
  buildRetrievalEvidencePack
} from "../retrieval/verification.js";

function buildPseudoAnalysisResult(lawSearch, precedentSearch) {
  return {
    law_search: {
      laws: Array.isArray(lawSearch?.laws) ? lawSearch.laws : [],
      retrieval_trace: Array.isArray(lawSearch?.retrieval_trace) ? lawSearch.retrieval_trace : []
    },
    precedent_search: {
      precedents: Array.isArray(precedentSearch?.precedents) ? precedentSearch.precedents : [],
      retrieval_trace: Array.isArray(precedentSearch?.retrieval_trace) ? precedentSearch.retrieval_trace : []
    }
  };
}

function buildReferenceMap(items) {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

async function buildReferenceLibrary({ providerMode, lawSearch, precedentSearch, saveReferenceLibrary }) {
  const pseudoResult = buildPseudoAnalysisResult(lawSearch, precedentSearch);
  const referenceSeeds = buildReferenceSeeds(pseudoResult, providerMode);

  if (typeof saveReferenceLibrary === "function") {
    const savedItems = await saveReferenceLibrary(pseudoResult);
    return {
      referenceSeeds,
      referenceLibrary: Array.isArray(savedItems) ? savedItems : []
    };
  }

  return {
    referenceSeeds,
    referenceLibrary: referenceSeeds.map((seed) =>
      materializeReferenceSeed(seed, {
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    )
  };
}

export async function buildCanonicalGroundingArtifacts({
  providerMode,
  retrievalPlan,
  lawSearch,
  precedentSearch,
  classificationResult,
  limit,
  saveReferenceLibrary
}) {
  const laws = Array.isArray(lawSearch?.laws) ? lawSearch.laws : [];
  const precedents = Array.isArray(precedentSearch?.precedents) ? precedentSearch.precedents : [];
  const cappedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : null;
  const { referenceSeeds, referenceLibrary } = await buildReferenceLibrary({
    providerMode,
    lawSearch,
    precedentSearch,
    saveReferenceLibrary
  });
  const referencesByKey = buildReferenceMap(referenceLibrary);
  const matchedLaws = buildLawVerificationCards(retrievalPlan, laws, referencesByKey);
  const matchedPrecedents = buildPrecedentVerificationCards(retrievalPlan, precedents, referencesByKey);
  const limitedLaws = cappedLimit ? matchedLaws.slice(0, cappedLimit) : matchedLaws;
  const limitedPrecedents = cappedLimit ? matchedPrecedents.slice(0, cappedLimit) : matchedPrecedents;
  const allReferences = referenceSeeds
    .map((seed) => referencesByKey.get(seed.sourceKey))
    .filter(Boolean);
  const retrievalPreview = {
    law: lawSearch?.retrieval_preview ?? null,
    precedent: precedentSearch?.retrieval_preview ?? null
  };
  const retrievalTrace = [
    ...(Array.isArray(lawSearch?.retrieval_trace) ? lawSearch.retrieval_trace : []),
    ...(Array.isArray(precedentSearch?.retrieval_trace) ? precedentSearch.retrieval_trace : [])
  ];
  const retrievalEvidencePack = buildRetrievalEvidencePack({
    plan: retrievalPlan,
    retrievalPreview,
    retrievalTrace,
    matchedLaws: limitedLaws,
    matchedPrecedents: limitedPrecedents,
    referenceLibraryItems: allReferences
  });
  const scopeAssessment = buildScopeAssessment(
    classificationResult ?? { issues: retrievalPlan?.candidateIssues },
    retrievalPlan
  );
  const groundingEvidence = buildGroundingEvidenceFromRetrievalPack(retrievalEvidencePack);
  const verifier = buildPreAnalysisVerifier({
    classificationResult,
    retrievalPlan,
    retrievalEvidencePack,
    scopeAssessment,
    evidencePack: groundingEvidence
  });

  return {
    retrievalPreview,
    retrievalTrace,
    matchedLaws: limitedLaws,
    matchedPrecedents: limitedPrecedents,
    allReferences,
    retrievalEvidencePack,
    scopeAssessment,
    groundingEvidence,
    verifier,
    referenceLibrary
  };
}
