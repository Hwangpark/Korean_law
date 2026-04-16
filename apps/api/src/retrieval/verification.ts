import type { ReferenceLibraryItem } from "../analysis/references.js";
import {
  buildLawReferenceKey,
  buildPrecedentReferenceKey
} from "../analysis/reference-keys.mjs";
import {
  buildEvidenceStrengthFromScores,
  clampEvidenceScore,
  includesEvidenceQueries,
  normalizeEvidenceText,
  uniqueEvidenceValues
} from "../analysis/evidence-shared.mjs";
import { selectBestEvidenceSnippet } from "./snippets.js";
import type {
  CandidateIssue,
  EvidenceCitation,
  EvidenceCitationMap,
  EvidenceQueryRef,
  EvidenceSnippet,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  RetrievalEvidencePack,
  RetrievalPreview,
  RetrievalTraceEvent,
  VerifiedReferenceCard
} from "./types.js";
import { buildRerankSignalSummary } from "./rerank-scoring.js";

interface VerificationMessageOptions {
  scopeAssessment?: {
    procedural_heavy?: boolean;
    insufficient_facts?: boolean;
    warnings?: string[];
  };
  evidenceStrength?: "high" | "medium" | "low";
}

interface ScoreResult {
  score: number;
  reason: string;
  matchedQueries: EvidenceQueryRef[];
  matchedIssueTypes: string[];
  querySourceTags: string[];
  snippet: EvidenceSnippet | null;
  hasSpecificMatch?: boolean;
}

function normalizeText(value: unknown): string {
  return normalizeEvidenceText(value);
}

function unique<T>(values: T[]): T[] {
  return uniqueEvidenceValues(values);
}

function includesAny(text: string, queries: string[]): string[] {
  return includesEvidenceQueries(text, queries);
}

function clampScore(value: number): number {
  return clampEvidenceScore(value);
}

function buildIssueLabels(candidateIssues: CandidateIssue[]): string[] {
  return candidateIssues
    .map((issue) => issue.type)
    .filter(Boolean);
}

function buildSpecificTerms(plan: KeywordQueryPlan): string[] {
  return [...new Set(
    plan.candidateIssues
      .flatMap((issue) => issue.matchedTerms)
      .filter((term) => term && !buildIssueLabels(plan.candidateIssues).includes(term))
  )];
}

function lawSearchText(law: LawDocumentRecord): string {
  return normalizeText(
    [
      law.law_name,
      law.article_no,
      law.article_title,
      law.content,
      law.penalty,
      ...law.topics,
      ...law.queries
    ].join(" ")
  );
}

function precedentSearchText(precedent: PrecedentDocumentRecord): string {
  return normalizeText(
    [
      precedent.case_no,
      precedent.court,
      precedent.summary,
      precedent.verdict,
      precedent.sentence,
      precedent.key_reasoning,
      ...precedent.topics
    ].join(" ")
  );
}

function buildQueryRefs(
  plan: KeywordQueryPlan,
  searchable: string,
  channel: "law" | "precedent",
  existing: EvidenceQueryRef[] = []
): EvidenceQueryRef[] {
  if (existing.length > 0) {
    return existing;
  }

  const broadQueries = channel === "law" ? plan.broadLawQueries : plan.broadPrecedentQueries;
  const preciseQueries = channel === "law" ? plan.preciseLawQueries : plan.precisePrecedentQueries;
  const preciseMatches = includesAny(searchable, preciseQueries).map((query) => ({
    text: query,
    bucket: "precise" as const,
    channel
  }));
  const broadMatches = includesAny(searchable, broadQueries)
    .filter((query) => !preciseMatches.some((match) => match.text === query))
    .map((query) => ({
      text: query,
      bucket: "broad" as const,
      channel
    }));

  return [...preciseMatches, ...broadMatches];
}

function appendQuerySourceReason(reason: string, querySourceTags: string[], scopeNotes: string[]): string {
  const extra: string[] = [];

  if (querySourceTags.length > 0) {
    extra.push(`query_source=${querySourceTags.join(",")}`);
  }
  if (scopeNotes.length > 0) {
    extra.push(`scope_note=${scopeNotes.join("|")}`);
  }

  return extra.length > 0 ? `${reason} ${extra.join(" ")}` : reason;
}

function buildLawSnippet(
  law: LawDocumentRecord,
  matchedQueries: EvidenceQueryRef[],
  matchedIssueTypes: string[]
): EvidenceSnippet | null {
  const existing = law.retrieval_evidence?.snippet ?? null;
  if (existing?.text) {
    return existing;
  }

  return selectBestEvidenceSnippet({
    sources: [
      ...(law.content ? [{ field: "content" as const, text: law.content }] : []),
      ...(law.article_title ? [{ field: "article_title" as const, text: law.article_title }] : []),
      ...(law.penalty ? [{ field: "penalty" as const, text: law.penalty }] : [])
    ],
    matchedQueries,
    issueTypes: matchedIssueTypes
  });
}

function buildPrecedentSnippet(
  precedent: PrecedentDocumentRecord,
  matchedQueries: EvidenceQueryRef[],
  matchedIssueTypes: string[]
): EvidenceSnippet | null {
  const existing = precedent.retrieval_evidence?.snippet ?? null;
  if (existing?.text) {
    return existing;
  }

  return selectBestEvidenceSnippet({
    sources: [
      ...(precedent.summary ? [{ field: "summary" as const, text: precedent.summary }] : []),
      ...(precedent.key_reasoning ? [{ field: "key_reasoning" as const, text: precedent.key_reasoning }] : []),
      ...(precedent.sentence ? [{ field: "sentence" as const, text: precedent.sentence }] : [])
    ],
    matchedQueries,
    issueTypes: matchedIssueTypes
  });
}

function buildQuerySourceTags(
  plan: KeywordQueryPlan,
  matchedIssueTypes: string[],
  matchedQueries: EvidenceQueryRef[],
  kind: "law" | "precedent",
  matchSignals: {
    preciseMatches: string[];
    broadMatches: string[];
    directMatches?: string[];
    specificMatches?: string[];
    topicMatches?: string[];
  }
): string[] {
  return buildRerankSignalSummary(kind, plan, matchedIssueTypes, matchedQueries, matchSignals).querySourceTags;
}

function scoreLaw(plan: KeywordQueryPlan, law: LawDocumentRecord): ScoreResult {
  const searchable = lawSearchText(law);
  const directMatches = includesAny(searchable, [plan.normalizedQuery, ...plan.tokens]);
  const matchedQueries = buildQueryRefs(plan, searchable, "law", law.retrieval_evidence?.matched_queries ?? []);
  const preciseMatches = matchedQueries.filter((match) => match.bucket === "precise").map((match) => match.text);
  const broadMatches = matchedQueries.filter((match) => match.bucket === "broad").map((match) => match.text);
  const matchedIssueTypes = law.retrieval_evidence?.matched_issue_types?.length
    ? law.retrieval_evidence.matched_issue_types
    : buildIssueLabels(plan.candidateIssues).filter((issue) => law.topics.includes(issue));
  const snippet = buildLawSnippet(law, matchedQueries, matchedIssueTypes);
  const snippetText = normalizeText(snippet?.text);
  const snippetPreciseMatches = includesAny(snippetText, preciseMatches);
  const snippetBroadMatches = includesAny(snippetText, broadMatches);
  const rerank = buildRerankSignalSummary("law", plan, matchedIssueTypes, matchedQueries, {
    preciseMatches,
    broadMatches,
    directMatches,
    topicMatches: matchedIssueTypes
  });

  let score = 0.18;
  if (matchedIssueTypes.length > 0) {
    score += 0.2;
  }
  if (directMatches.length > 0) {
    score += 0.12;
  }
  if (preciseMatches.length > 0) {
    score += 0.18;
  } else if (broadMatches.length > 0) {
    score += 0.08;
  }
  if (law.penalty) {
    score += 0.04;
  }
  if (snippetPreciseMatches.length > 0) {
    score += 0.07;
  } else if (snippetBroadMatches.length > 0) {
    score += 0.03;
  }
  score += Math.min(rerank.legalElementCoverage * 0.05, 0.15);
  score += Math.min(rerank.hypothesisConfidence * 0.18, 0.18);
  score += rerank.provenanceBoost;
  score -= rerank.scopePenalty;

  let reason = "입력과 직접 연결되는 조문 후보입니다.";
  if (preciseMatches.length > 0) {
    reason = `정밀 질의 ${preciseMatches.slice(0, 2).join(", ")} 와 직접 맞닿은 조문입니다.`;
  } else if (directMatches.length > 0) {
    reason = `입력 표현 ${directMatches.slice(0, 2).join(", ")} 이 조문 설명과 직접 겹칩니다.`;
  } else if (matchedIssueTypes.length > 0) {
    reason = `쟁점 ${matchedIssueTypes.join(", ")} 과 직접 연결되는 조문입니다.`;
  } else if (broadMatches.length > 0) {
    reason = `확장 질의 ${broadMatches.slice(0, 2).join(", ")} 기준으로 포착된 조문입니다.`;
  }

  return {
    score: clampScore(score),
    reason: appendQuerySourceReason(reason, rerank.querySourceTags, rerank.scopeNotes),
    matchedQueries,
    matchedIssueTypes,
    querySourceTags: rerank.querySourceTags,
    snippet
  };
}

function scorePrecedent(plan: KeywordQueryPlan, precedent: PrecedentDocumentRecord): ScoreResult {
  const searchable = precedentSearchText(precedent);
  const directMatches = includesAny(searchable, [plan.normalizedQuery, ...plan.tokens]);
  const matchedQueries = buildQueryRefs(plan, searchable, "precedent", precedent.retrieval_evidence?.matched_queries ?? []);
  const preciseMatches = matchedQueries.filter((match) => match.bucket === "precise").map((match) => match.text);
  const broadMatches = matchedQueries.filter((match) => match.bucket === "broad").map((match) => match.text);
  const specificTerms = buildSpecificTerms(plan);
  const specificMatches = includesAny(searchable, specificTerms);
  const matchedIssueTypes = precedent.retrieval_evidence?.matched_issue_types?.length
    ? precedent.retrieval_evidence.matched_issue_types
    : buildIssueLabels(plan.candidateIssues).filter((issue) => precedent.topics.includes(issue));
  const snippet = buildPrecedentSnippet(precedent, matchedQueries, matchedIssueTypes);
  const snippetText = normalizeText(snippet?.text);
  const snippetPreciseMatches = includesAny(snippetText, preciseMatches);
  const snippetSpecificMatches = includesAny(snippetText, specificTerms);
  const rerank = buildRerankSignalSummary("precedent", plan, matchedIssueTypes, matchedQueries, {
    preciseMatches,
    broadMatches,
    directMatches,
    specificMatches,
    topicMatches: matchedIssueTypes
  });

  let score = typeof precedent.similarity_score === "number" ? precedent.similarity_score * 0.38 : 0.16;
  if (matchedIssueTypes.length > 0) {
    score += 0.18;
  }
  if (specificMatches.length > 0) {
    score += 0.14;
  }
  if (directMatches.length > 0) {
    score += 0.12;
  }
  if (preciseMatches.length > 0) {
    score += 0.14;
  } else if (broadMatches.length > 0) {
    score += 0.06;
  }
  if (snippetPreciseMatches.length > 0 || snippetSpecificMatches.length > 0) {
    score += 0.06;
  }
  score += Math.min(rerank.legalElementCoverage * 0.04, 0.12);
  score += Math.min(rerank.hypothesisConfidence * 0.16, 0.16);
  score += rerank.provenanceBoost;
  score -= rerank.scopePenalty;

  let reason = "입력과 법적 맥락이 유사한 판례입니다.";
  if (specificMatches.length > 0) {
    reason = `입력과 직접 연결된 표현 ${specificMatches.slice(0, 2).join(", ")} 이 판례 요지에 포함됩니다.`;
  } else if (preciseMatches.length > 0) {
    reason = `정밀 질의 ${preciseMatches.slice(0, 2).join(", ")} 와 직접 겹치는 판례입니다.`;
  } else if (directMatches.length > 0) {
    reason = `입력 표현 ${directMatches.slice(0, 2).join(", ")} 이 판례 요지와 맞닿아 있습니다.`;
  } else if (matchedIssueTypes.length > 0) {
    reason = `쟁점 ${matchedIssueTypes.join(", ")} 에 대한 유사 사례입니다.`;
  } else if (broadMatches.length > 0) {
    reason = `확장 질의 ${broadMatches.slice(0, 2).join(", ")} 기준으로 포착된 판례입니다.`;
  }

  return {
    score: clampScore(score),
    reason: appendQuerySourceReason(reason, rerank.querySourceTags, rerank.scopeNotes),
    hasSpecificMatch: specificMatches.length > 0 || directMatches.length > 0 || preciseMatches.length > 0,
    matchedQueries,
    matchedIssueTypes,
    querySourceTags: rerank.querySourceTags,
    snippet
  };
}

function buildVerifiedCard(
  kind: "law" | "precedent",
  reference: ReferenceLibraryItem,
  score: number,
  reason: string,
  querySourceTags: string[],
  matchedQueries: EvidenceQueryRef[],
  matchedIssueTypes: string[],
  snippet: EvidenceSnippet | null,
  source: VerifiedReferenceCard["source"]
): VerifiedReferenceCard {
  return {
    id: reference.id,
    referenceKey: reference.id,
    kind,
    title: reference.title,
    subtitle: reference.subtitle,
    summary: reference.summary,
    confidenceScore: score,
    matchReason: reason,
    querySourceTags,
    matchedQueries,
    matchedIssueTypes,
    snippet,
    source,
    reference
  };
}

function buildCitationId(kind: "law" | "precedent", index: number): string {
  return `${kind}-${index + 1}`;
}

function buildIssueChargePathMap(plan: KeywordQueryPlan): Map<string, string> {
  const paths = new Map<string, string>();

  plan.candidateIssues.forEach((issue) => {
    const type = String(issue.type ?? "").trim();
    if (!type || paths.has(type)) {
      return;
    }
    paths.set(type, `legal_analysis.charges[${paths.size}]`);
  });

  return paths;
}

function resolveCardIssueType(
  card: VerifiedReferenceCard,
  issueChargePaths: Map<string, string>
): string | null {
  for (const issueType of card.matchedIssueTypes ?? []) {
    if (issueChargePaths.has(issueType)) {
      return issueType;
    }
  }

  const onlyIssueType = issueChargePaths.size === 1 ? [...issueChargePaths.keys()][0] : null;
  if (onlyIssueType && (!card.matchedIssueTypes || card.matchedIssueTypes.length === 0)) {
    return onlyIssueType;
  }

  return null;
}

function buildLawStatementTarget(
  card: VerifiedReferenceCard,
  index: number,
  issueChargePaths: Map<string, string>
): Pick<EvidenceCitation, "statement_type" | "statement_path"> {
  const issueType = resolveCardIssueType(card, issueChargePaths);
  const chargePath = issueType ? issueChargePaths.get(issueType) : null;

  if (chargePath) {
    return {
      statement_type: "charge",
      statement_path: chargePath
    };
  }

  return {
    statement_type: "grounding_evidence",
    statement_path: `legal_analysis.grounding_evidence.laws[${index}]`
  };
}

function buildEvidenceCitation(
  card: VerifiedReferenceCard,
  index: number,
  target: Pick<EvidenceCitation, "statement_type" | "statement_path">
): EvidenceCitation {
  return {
    citation_id: buildCitationId(card.kind, index),
    reference_id: card.id,
    reference_key: card.referenceKey,
    kind: card.kind,
    statement_type: target.statement_type,
    statement_path: target.statement_path,
    title: card.title,
    confidence_score: card.confidenceScore,
    match_reason: card.matchReason,
    matched_issue_types: card.matchedIssueTypes,
    query_refs: card.matchedQueries,
    query_source_tags: card.querySourceTags ?? [],
    snippet: card.snippet ?? null
  };
}

function indexCitations(
  citations: EvidenceCitation[],
  key: "reference_id" | "statement_path"
): Record<string, string[]> {
  return citations.reduce<Record<string, string[]>>((accumulator, citation) => {
    const value = citation[key];
    if (!accumulator[value]) {
      accumulator[value] = [];
    }
    accumulator[value].push(citation.citation_id);
    return accumulator;
  }, {});
}

function buildCitationMap(
  plan: KeywordQueryPlan,
  matchedLaws: VerifiedReferenceCard[],
  matchedPrecedents: VerifiedReferenceCard[]
): EvidenceCitationMap {
  const issueChargePaths = buildIssueChargePathMap(plan);
  const citations = [
    ...matchedLaws.map((card, index) => buildEvidenceCitation(
      card,
      index,
      buildLawStatementTarget(card, index, issueChargePaths)
    )),
    ...matchedPrecedents.map((card, index) => buildEvidenceCitation(
      card,
      index,
      {
        statement_type: "precedent_card",
        statement_path: `legal_analysis.precedent_cards[${index}]`
      }
    ))
  ];

  return {
    version: "v2",
    citations,
    by_reference_id: indexCitations(citations, "reference_id"),
    by_statement_path: indexCitations(citations, "statement_path")
  };
}

export function buildLawVerificationCards(
  plan: KeywordQueryPlan,
  laws: LawDocumentRecord[],
  referencesByKey: Map<string, ReferenceLibraryItem>
): VerifiedReferenceCard[] {
  return laws
    .map((law) => {
      const referenceKey = law.retrieval_evidence?.reference_key ?? buildLawReferenceKey(law.law_name, law.article_no);
      const reference = referencesByKey.get(referenceKey);
      if (!reference) {
        return null;
      }
      const { score, reason, matchedQueries, matchedIssueTypes, querySourceTags, snippet } = scoreLaw(plan, law);
      return buildVerifiedCard("law", reference, score, reason, querySourceTags, matchedQueries, matchedIssueTypes, snippet, {
        law_name: law.law_name,
        article_no: law.article_no,
        article_title: law.article_title,
        penalty: law.penalty,
        url: law.url
      });
    })
    .filter((card): card is VerifiedReferenceCard => Boolean(card))
    .sort((left, right) => right.confidenceScore - left.confidenceScore);
}

export function buildPrecedentVerificationCards(
  plan: KeywordQueryPlan,
  precedents: PrecedentDocumentRecord[],
  referencesByKey: Map<string, ReferenceLibraryItem>
): VerifiedReferenceCard[] {
  const specificTerms = buildSpecificTerms(plan);
  const cards = precedents
    .map((precedent) => {
      const referenceKey = precedent.retrieval_evidence?.reference_key ?? buildPrecedentReferenceKey(precedent.case_no);
      const reference = referencesByKey.get(referenceKey);
      if (!reference) {
        return null;
      }
      const { score, reason, hasSpecificMatch, matchedQueries, matchedIssueTypes, querySourceTags, snippet } = scorePrecedent(plan, precedent);
      return {
        card: buildVerifiedCard("precedent", reference, score, reason, querySourceTags, matchedQueries, matchedIssueTypes, snippet, {
          case_no: precedent.case_no,
          court: precedent.court,
          verdict: precedent.verdict,
          sentence: precedent.sentence,
          url: precedent.url
        }),
        hasSpecificMatch: Boolean(hasSpecificMatch)
      };
    })
    .filter((entry): entry is { card: VerifiedReferenceCard; hasSpecificMatch: boolean } => Boolean(entry))
    .sort((left, right) => right.card.confidenceScore - left.card.confidenceScore);

  if (specificTerms.length > 0 && cards.some((entry) => entry.hasSpecificMatch)) {
    return cards
      .filter((entry) => entry.hasSpecificMatch)
      .map((entry) => entry.card);
  }

  return cards.map((entry) => entry.card);
}

export function buildRetrievalEvidencePack(input: {
  runId?: string;
  plan: KeywordQueryPlan;
  retrievalPreview: {
    law: RetrievalPreview | null;
    precedent: RetrievalPreview | null;
  };
  retrievalTrace: RetrievalTraceEvent[];
  matchedLaws: VerifiedReferenceCard[];
  matchedPrecedents: VerifiedReferenceCard[];
  referenceLibraryItems?: ReferenceLibraryItem[];
}): RetrievalEvidencePack {
  return {
    version: "v2",
    ...(input.runId ? { run_id: input.runId } : {}),
    query: {
      original: input.plan.originalQuery,
      normalized: input.plan.normalizedQuery,
      context_type: input.plan.contextType
    },
    plan: {
      tokens: input.plan.tokens,
      candidate_issues: input.plan.candidateIssues,
      broad_law_queries: input.plan.broadLawQueries,
      precise_law_queries: input.plan.preciseLawQueries,
      broad_precedent_queries: input.plan.broadPrecedentQueries,
      precise_precedent_queries: input.plan.precisePrecedentQueries,
      law_queries: input.plan.lawQueries,
      precedent_queries: input.plan.precedentQueries,
      warnings: input.plan.warnings,
      supported_issues: input.plan.supportedIssues,
      unsupported_issues: input.plan.unsupportedIssues,
      scope_warnings: input.plan.scopeWarnings,
      scope_flags: input.plan.scopeFlags,
      scope_filter: {
        supported_issues: input.plan.supportedIssues,
        unsupported_issues: input.plan.unsupportedIssues,
        scope_warnings: input.plan.scopeWarnings
      }
    },
    retrieval_preview: input.retrievalPreview,
    retrieval_trace: input.retrievalTrace,
    matched_laws: input.matchedLaws,
    matched_precedents: input.matchedPrecedents,
    ...(input.referenceLibraryItems
      ? {
          reference_library: {
            items: input.referenceLibraryItems
          }
        }
      : {}),
    selected_reference_ids: unique([
      ...input.matchedLaws.map((item) => item.referenceKey),
      ...input.matchedPrecedents.map((item) => item.referenceKey)
    ]),
    top_issue_types: buildIssueLabels(input.plan.candidateIssues),
    evidence_strength: buildEvidenceStrengthFromScores(
      input.matchedLaws[0]?.confidenceScore ?? 0,
      input.matchedPrecedents[0]?.confidenceScore ?? 0
    ),
    citation_map: buildCitationMap(input.plan, input.matchedLaws, input.matchedPrecedents)
  };
}

export function buildVerificationHeadline(
  plan: KeywordQueryPlan,
  totalMatches: number,
  options: VerificationMessageOptions = {}
): string {
  if (totalMatches === 0) {
    return `입력 "${plan.originalQuery}" 에 직접 대응되는 근거를 찾지 못했습니다.`;
  }

  const topIssue = plan.candidateIssues[0];
  if (options.scopeAssessment?.procedural_heavy) {
    return `입력 "${plan.originalQuery}" 관련 자료를 찾았지만 절차법 비중이 높아 바로 결론 내리기 어렵습니다.`;
  }
  if (options.scopeAssessment?.insufficient_facts) {
    return `입력 "${plan.originalQuery}" 관련 자료를 찾았지만 사실관계가 부족해 참고 수준으로 보셔야 합니다.`;
  }
  if (options.evidenceStrength === "low") {
    return `입력 "${plan.originalQuery}" 관련 자료를 찾았지만 현재 근거 강도는 낮습니다.`;
  }
  if (topIssue) {
    return `입력 "${plan.originalQuery}" 은 ${topIssue.type} 쟁점으로 우선 검토되었습니다.`;
  }

  return `입력 "${plan.originalQuery}" 과 관련된 근거 ${totalMatches}건을 찾았습니다.`;
}

export function buildVerificationInterpretation(
  plan: KeywordQueryPlan,
  totalMatches: number,
  options: VerificationMessageOptions = {}
): string {
  if (totalMatches === 0) {
    return "입력만으로는 명확한 법적 평가가 어렵습니다. 전체 문장과 대화 맥락을 조금 더 구체적으로 입력해 주세요.";
  }

  const issueTypes = buildIssueLabels(plan.candidateIssues);
  if (options.scopeAssessment?.procedural_heavy) {
    return "현재 입력은 절차법 설명이 많이 섞여 있어, 실제 피해 사실과 발화 맥락을 별도로 적어 주셔야 더 정확한 검토가 가능합니다.";
  }
  if (options.scopeAssessment?.insufficient_facts) {
    return "현재 결과는 탐색적 검색에 가깝고, 공개 범위·반복성·금전 요구 여부 같은 핵심 사실관계를 더 적어 주셔야 합니다.";
  }
  if (options.evidenceStrength === "low") {
    return `${issueTypes.join(", ")} 관련 자료를 우선 찾았지만 현재는 broad match 비중이 높습니다. 원문 표현과 구체적 사실관계를 추가로 확인하는 편이 안전합니다.`;
  }
  if (issueTypes.length > 0) {
    return `${issueTypes.join(", ")} 관련 조문과 판례를 우선 정리했습니다. 아래 근거가 실제 사실관계와 맞는지 검토해 보세요.`;
  }

  return "입력과 관련성이 있는 조문과 판례를 정리했습니다.";
}
