import type { CandidateIssue, EvidenceQueryRef, KeywordQueryPlan, QuerySourceKind } from "./types.js";

interface MatchSignalInput {
  preciseMatches: string[];
  broadMatches: string[];
  directMatches?: string[];
  specificMatches?: string[];
  topicMatches?: string[];
}

export interface RerankSignalSummary {
  querySourceTags: QuerySourceKind[];
  legalElementCoverage: number;
  supportedMatchCount: number;
  unsupportedMatchCount: number;
  hypothesisConfidence: number;
  provenanceBoost: number;
  scopePenalty: number;
  scopeNotes: string[];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueSources(values: QuerySourceKind[]): QuerySourceKind[] {
  return [...new Set(values.filter(Boolean))];
}

function getIssueMeta(plan: KeywordQueryPlan, matchedIssueTypes: string[]): CandidateIssue[] {
  return plan.candidateIssues.filter((issue) => matchedIssueTypes.includes(issue.type));
}

function countSupportedMatches(plan: KeywordQueryPlan, matchedIssueTypes: string[]): {
  supported: number;
  unsupported: number;
} {
  return {
    supported: matchedIssueTypes.filter((issue) => plan.supportedIssues.includes(issue)).length,
    unsupported: matchedIssueTypes.filter((issue) => plan.unsupportedIssues.includes(issue)).length
  };
}

function getLegalElementCoverage(
  issueMeta: CandidateIssue[],
  matchedQueries: EvidenceQueryRef[]
): number {
  const issueSignals = uniqueStrings(issueMeta.flatMap((issue) => issue.legalElementSignals ?? []));
  const querySignals = uniqueStrings(matchedQueries.flatMap((query) => query.legal_element_signals ?? []));
  if (issueSignals.length === 0 || querySignals.length === 0) {
    return 0;
  }
  return issueSignals.filter((signal) => querySignals.includes(signal)).length;
}

function getHypothesisConfidence(issueMeta: CandidateIssue[]): number {
  return issueMeta.reduce((max, issue) => Math.max(max, issue.hypothesisConfidence ?? 0), 0);
}

function getQuerySourceTags(issueMeta: CandidateIssue[], matchedQueries: EvidenceQueryRef[]): QuerySourceKind[] {
  return uniqueSources([
    ...issueMeta.flatMap((issue) => issue.querySources ?? []),
    ...matchedQueries.flatMap((query) => query.sources ?? [])
  ]);
}

function getProvenanceBoost(tags: QuerySourceKind[], matchSignals: MatchSignalInput): number {
  let boost = 0;
  const hasPrecise = matchSignals.preciseMatches.length > 0;
  const hasBroad = matchSignals.broadMatches.length > 0;
  const hasSpecific = (matchSignals.specificMatches?.length ?? 0) > 0 || (matchSignals.directMatches?.length ?? 0) > 0;

  if (tags.includes("legal_element") && hasPrecise) {
    boost += 0.1;
  }
  if (tags.includes("hypothesis") && (hasPrecise || hasSpecific)) {
    boost += 0.08;
  }
  if (tags.includes("query_hint") && (hasPrecise || hasBroad)) {
    boost += 0.04;
  }
  if (tags.includes("profile") && hasPrecise) {
    boost += 0.03;
  }
  if (tags.includes("scope_warning") && !hasPrecise && !hasSpecific) {
    boost -= 0.02;
  }

  return boost;
}

function getScopePenalty(
  kind: "law" | "precedent",
  plan: KeywordQueryPlan,
  matchSignals: MatchSignalInput,
  supportedMatchCount: number,
  unsupportedMatchCount: number,
  legalElementCoverage: number
): { penalty: number; notes: string[] } {
  let penalty = 0;
  const notes: string[] = [];
  const hasPreciseSupport = matchSignals.preciseMatches.length > 0 || (matchSignals.directMatches?.length ?? 0) > 0;
  const hasSpecificSupport = hasPreciseSupport || (matchSignals.specificMatches?.length ?? 0) > 0 || legalElementCoverage > 0;

  if (plan.scopeFlags.proceduralHeavy) {
    if (!hasSpecificSupport) {
      penalty += kind === "precedent" ? 0.26 : 0.18;
      notes.push("절차법 문맥 비중이 높아 보수적으로 낮춤");
    } else {
      penalty += 0.05;
    }
  }

  if (plan.scopeFlags.insufficientFacts) {
    if (!hasPreciseSupport && legalElementCoverage === 0) {
      penalty += kind === "precedent" ? 0.18 : 0.12;
      notes.push("사실관계가 부족해 broad match만 남음");
    } else {
      penalty += 0.04;
    }
  }

  if (unsupportedMatchCount > 0 && supportedMatchCount === 0) {
    penalty += kind === "precedent" ? 0.22 : 0.16;
    notes.push("지원 범위 밖 이슈와만 연결됨");
  } else if (unsupportedMatchCount > 0) {
    penalty += 0.06;
    notes.push("지원 이슈와 비지원 이슈가 혼재함");
  }

  if (plan.scopeFlags.unsupportedIssuePresent && supportedMatchCount === 0) {
    penalty += kind === "precedent" ? 0.14 : 0.1;
  }

  return { penalty, notes };
}

export function buildRerankSignalSummary(
  kind: "law" | "precedent",
  plan: KeywordQueryPlan,
  matchedIssueTypes: string[],
  matchedQueries: EvidenceQueryRef[],
  matchSignals: MatchSignalInput
): RerankSignalSummary {
  const issueMeta = getIssueMeta(plan, matchedIssueTypes);
  const { supported, unsupported } = countSupportedMatches(plan, matchedIssueTypes);
  const legalElementCoverage = getLegalElementCoverage(issueMeta, matchedQueries);
  const hypothesisConfidence = getHypothesisConfidence(issueMeta);
  const querySourceTags = getQuerySourceTags(issueMeta, matchedQueries);
  const provenanceBoost = getProvenanceBoost(querySourceTags, matchSignals);
  const { penalty, notes } = getScopePenalty(
    kind,
    plan,
    matchSignals,
    supported,
    unsupported,
    legalElementCoverage
  );

  return {
    querySourceTags,
    legalElementCoverage,
    supportedMatchCount: supported,
    unsupportedMatchCount: unsupported,
    hypothesisConfidence,
    provenanceBoost,
    scopePenalty: penalty,
    scopeNotes: notes
  };
}
