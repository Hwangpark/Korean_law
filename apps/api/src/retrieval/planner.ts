import { normalizeText as normalizeIssueText } from "../lib/issue-catalog.mjs";
import { buildScopeFilter } from "../lib/scope-filter.mjs";
import { buildClassifierFacts } from "../lib/classification-facts.mjs";
import {
  CONTEXT_LAW_HINTS,
  CONTEXT_PRECEDENT_HINTS,
  RETRIEVAL_ISSUE_CATALOG
} from "./catalog.js";
import type {
  CandidateIssue,
  KeywordContextType,
  KeywordQueryPlan,
  ProfileContext,
  QueryProvenanceRef,
  QuerySourceKind,
  ScopeFilterResult,
  ScopeFlags
} from "./types.js";

interface ClassificationIssueLike {
  type?: unknown;
  severity?: unknown;
  keywords?: unknown;
  law_search_queries?: unknown;
}

interface ClassificationHypothesisLike {
  type?: unknown;
  confidence?: unknown;
  matched_terms?: unknown;
  reason?: unknown;
  source?: unknown;
  sources?: unknown;
}

interface QueryHintBucketLike {
  broad?: unknown;
  precise?: unknown;
}

interface ClassificationQueryHintsLike {
  law?: QueryHintBucketLike;
  precedent?: QueryHintBucketLike;
  broad?: unknown;
  precise?: unknown;
}

interface ScopeFlagsLike {
  procedural_heavy?: unknown;
  proceduralHeavy?: unknown;
  insufficient_facts?: unknown;
  insufficientFacts?: unknown;
  unsupported_issue_present?: unknown;
  unsupportedIssuePresent?: unknown;
}

interface ClassificationResultLike {
  searchable_text?: unknown;
  issues?: unknown;
  issue_hypotheses?: unknown;
  legal_elements?: unknown;
  facts?: unknown;
  query_hints?: unknown;
  scope_flags?: unknown;
  supported_issues?: unknown;
  unsupported_issues?: unknown;
  scope_warnings?: unknown;
}

interface CandidateIssueBuildOptions {
  fallbackLawQueries?: string[];
  additionalPreciseLawQueries?: string[];
  additionalPrecisePrecedentQueries?: string[];
  hypothesisConfidence?: number;
  hypothesisReason?: string;
  legalElementSignals?: string[];
  factHints?: string[];
  querySources?: QuerySourceKind[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(value: string): string {
  return normalizeIssueText(value);
}

function tokenize(value: string): string[] {
  return unique(
    normalizeText(value)
      .split(/[\s,./|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function uniqueSorted(values: string[]): string[] {
  return unique(values).sort();
}

function uniqueQuerySources(values: QuerySourceKind[]): QuerySourceKind[] {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getLegalElementSignals(classificationResult: ClassificationResultLike, issueType: string): string[] {
  const legalElements = asRecord(classificationResult.legal_elements);
  const issueElements = asRecord(legalElements[issueType]);

  return unique(
    Object.entries(issueElements)
      .filter(([, enabled]) => enabled === true)
      .map(([signal]) => signal)
  );
}

function buildLegalElementQueryExpansions(issueType: string, signals: string[]): {
  preciseLawQueries: string[];
  precisePrecedentQueries: string[];
  factHints: string[];
} {
  const signalSet = new Set(signals);
  const preciseLawQueries: string[] = [];
  const precisePrecedentQueries: string[] = [];
  const factHints: string[] = [];

  const addSignal = (signal: string, label: string, queries: string[] = [`${issueType} ${label}`]) => {
    if (!signalSet.has(signal)) {
      return;
    }
    factHints.push(label);
    preciseLawQueries.push(...queries);
    precisePrecedentQueries.push(...queries);
  };

  switch (issueType) {
    case "명예훼손":
      addSignal("public_disclosure", "공연성");
      addSignal("fact_assertion", "사실 적시");
      addSignal("falsity_signal", "허위사실");
      addSignal("target_identifiable", "특정성");
      if (signalSet.has("public_disclosure") && signalSet.has("falsity_signal")) {
        preciseLawQueries.push("명예훼손 허위사실 공연성");
        precisePrecedentQueries.push("명예훼손 허위사실 공연성");
      }
      break;
    case "협박/공갈":
      addSignal("threat_of_harm", "해악의 고지");
      addSignal("money_or_property_request", "금전 요구");
      addSignal("continued_pressure", "반복 압박");
      if (signalSet.has("threat_of_harm") && signalSet.has("money_or_property_request")) {
        preciseLawQueries.push("공갈 해악의 고지 금전 요구");
        precisePrecedentQueries.push("공갈 해악의 고지 금전 요구");
      }
      break;
    case "모욕":
      addSignal("insulting_expression", "경멸적 표현");
      addSignal("public_disclosure", "공연성");
      addSignal("target_identifiable", "특정성");
      if (signalSet.has("insulting_expression") && signalSet.has("public_disclosure")) {
        preciseLawQueries.push("모욕 경멸적 표현 공연성");
        precisePrecedentQueries.push("모욕 경멸적 표현 공연성");
      }
      break;
    case "개인정보 유출":
      addSignal("personal_identifier_present", "식별정보");
      addSignal("public_exposure", "공개");
      addSignal("consent_signal_absent", "동의 없음");
      if (signalSet.has("personal_identifier_present") && signalSet.has("public_exposure")) {
        preciseLawQueries.push("개인정보 유출 식별정보 공개");
        precisePrecedentQueries.push("개인정보 유출 식별정보 공개");
      }
      break;
    case "스토킹":
      addSignal("repeated_contact", "반복성");
      addSignal("contact_or_following", "접근 또는 연락");
      addSignal("fear_or_anxiety", "불안감");
      if (signalSet.has("repeated_contact") && signalSet.has("contact_or_following")) {
        preciseLawQueries.push("스토킹 반복 연락");
        precisePrecedentQueries.push("스토킹 반복 연락");
      }
      break;
    case "사기":
      addSignal("deception_signal", "기망");
      addSignal("property_transfer", "재산상 처분행위");
      addSignal("financial_loss", "금전 손해");
      if (signalSet.has("deception_signal") && signalSet.has("property_transfer")) {
        preciseLawQueries.push("사기 기망 재산상 처분행위");
        precisePrecedentQueries.push("사기 기망 재산상 처분행위");
      }
      break;
    default:
      break;
  }

  return {
    preciseLawQueries: unique(preciseLawQueries),
    precisePrecedentQueries: unique(precisePrecedentQueries),
    factHints: unique(factHints)
  };
}

function buildQueryRefKey(query: QueryProvenanceRef): string {
  return [query.channel, query.bucket, normalizeText(query.text)].join("::");
}

function mergeQueryRefs(...groups: Array<QueryProvenanceRef[] | undefined>): QueryProvenanceRef[] {
  const map = new Map<string, QueryProvenanceRef>();

  for (const group of groups) {
    for (const query of group ?? []) {
      if (!query?.text) {
        continue;
      }

      const key = buildQueryRefKey(query);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...query,
          sources: uniqueQuerySources(query.sources ?? []),
          issue_types: uniqueSorted(query.issue_types ?? []),
          legal_element_signals: uniqueSorted(query.legal_element_signals ?? [])
        });
        continue;
      }

      map.set(key, {
        ...existing,
        sources: uniqueQuerySources([...(existing.sources ?? []), ...(query.sources ?? [])]),
        issue_types: uniqueSorted([...(existing.issue_types ?? []), ...(query.issue_types ?? [])]),
        legal_element_signals: uniqueSorted([
          ...(existing.legal_element_signals ?? []),
          ...(query.legal_element_signals ?? [])
        ])
      });
    }
  }

  return [...map.values()];
}

function buildIssueQueryRefs(
  candidateIssues: CandidateIssue[],
  channel: "law" | "precedent"
): QueryProvenanceRef[] {
  return candidateIssues.flatMap((issue) => {
    const broadQueries = channel === "law"
      ? (issue.broadLawQueries ?? issue.lawQueries)
      : (issue.broadPrecedentQueries ?? issue.precedentQueries);
    const preciseQueries = channel === "law"
      ? (issue.preciseLawQueries ?? issue.matchedTerms)
      : (issue.precisePrecedentQueries ?? issue.matchedTerms);
    const basePayload = {
      sources: uniqueQuerySources(issue.querySources ?? ["keyword"]),
      issue_types: [issue.type],
      legal_element_signals: uniqueSorted(issue.legalElementSignals ?? [])
    };

    return [
      ...broadQueries.map((text) => ({
        text,
        bucket: "broad" as const,
        channel,
        ...basePayload
      })),
      ...preciseQueries.map((text) => ({
        text,
        bucket: "precise" as const,
        channel,
        ...basePayload
      }))
    ];
  });
}

function buildAuxiliaryQueryRefs(input: {
  queries: string[];
  bucket: "broad" | "precise";
  channel: "law" | "precedent";
  source: QuerySourceKind;
  issueTypes?: string[];
}): QueryProvenanceRef[] {
  return input.queries.map((text) => ({
    text,
    bucket: input.bucket,
    channel: input.channel,
    sources: [input.source],
    issue_types: uniqueSorted(input.issueTypes ?? []),
    legal_element_signals: []
  }));
}

function normalizeScopeFlags(value: ScopeFlagsLike | undefined, fallback: ScopeFlags): ScopeFlags {
  return {
    proceduralHeavy: typeof value?.proceduralHeavy === "boolean"
      ? value.proceduralHeavy
      : typeof value?.procedural_heavy === "boolean"
        ? value.procedural_heavy
        : fallback.proceduralHeavy,
    insufficientFacts: typeof value?.insufficientFacts === "boolean"
      ? value.insufficientFacts
      : typeof value?.insufficient_facts === "boolean"
        ? value.insufficient_facts
        : fallback.insufficientFacts,
    unsupportedIssuePresent: typeof value?.unsupportedIssuePresent === "boolean"
      ? value.unsupportedIssuePresent
      : typeof value?.unsupported_issue_present === "boolean"
        ? value.unsupported_issue_present
        : fallback.unsupportedIssuePresent
  };
}

function normalizeScopeFilter(
  value: ClassificationResultLike | undefined,
  fallback: ScopeFilterResult
): ScopeFilterResult {
  const normalizedFlags = normalizeScopeFlags(value?.scope_flags as ScopeFlagsLike | undefined, fallback.scopeFlags);
  return {
    supportedIssues: unique([
      ...fallback.supportedIssues,
      ...asStringArray(value?.supported_issues)
    ]),
    unsupportedIssues: unique([
      ...fallback.unsupportedIssues,
      ...asStringArray(value?.unsupported_issues)
    ]),
    scopeWarnings: unique([
      ...fallback.scopeWarnings,
      ...asStringArray(value?.scope_warnings)
    ]),
    scopeFlags: {
      proceduralHeavy: normalizedFlags.proceduralHeavy,
      insufficientFacts: normalizedFlags.insufficientFacts,
      unsupportedIssuePresent: normalizedFlags.unsupportedIssuePresent
    }
  };
}

function buildReason(type: string, matchedTerms: string[], contextType: KeywordContextType): string {
  const contextHint = CONTEXT_PRECEDENT_HINTS[contextType]?.[0] ?? "온라인 분쟁";
  if (matchedTerms.length === 0) {
    return `${type} 쟁점으로 보이지만 근거 표현이 약해 기본 질의로만 확장했습니다.`;
  }
  return `${type} 관련 표현(${matchedTerms.join(", ")})이 감지되었고 ${contextHint} 문맥을 반영해 질의를 확장했습니다.`;
}

function normalizeHypothesisSources(hypothesis: ClassificationHypothesisLike): QuerySourceKind[] {
  const rawSources = unique([
    ...asStringArray(hypothesis.sources),
    String(hypothesis.source ?? "").trim()
  ]);
  const sources: QuerySourceKind[] = ["hypothesis"];

  if (rawSources.includes("fact")) {
    sources.push("fact");
  }

  if (rawSources.includes("llm")) {
    sources.push("llm");
  }

  if (rawSources.includes("keyword")) {
    sources.push("keyword");
  }

  return unique(sources) as QuerySourceKind[];
}

function buildCandidateIssue(
  type: string,
  severity: "low" | "medium" | "high",
  matchedTerms: string[],
  contextType: KeywordContextType,
  signalScore?: number,
  options: CandidateIssueBuildOptions = {}
): CandidateIssue | null {
  const definition = RETRIEVAL_ISSUE_CATALOG.find((issue) => issue.type === type);
  if (!definition) {
    return null;
  }

  const broadLawQueries = unique([...definition.lawQueries, ...(options.fallbackLawQueries ?? []), type]);
  const preciseLawQueries = unique([
    ...definition.preciseTerms,
    ...matchedTerms.map((term) => `${type} ${term}`),
    ...CONTEXT_LAW_HINTS[contextType].map((hint) => `${hint} ${type}`),
    ...(options.additionalPreciseLawQueries ?? [])
  ]);
  const broadPrecedentQueries = unique([...definition.precedentQueries, type]);
  const precisePrecedentQueries = unique([
    ...definition.preciseTerms.map((term) => `${type} ${term}`),
    ...matchedTerms.map((term) => `${term} ${type}`),
    ...CONTEXT_PRECEDENT_HINTS[contextType].map((hint) => `${hint} ${type}`),
    ...(options.additionalPrecisePrecedentQueries ?? [])
  ]);

  return {
    type,
    severity,
    matchedTerms,
    lawQueries: unique([...broadLawQueries, ...preciseLawQueries]),
    precedentQueries: unique([...broadPrecedentQueries, ...precisePrecedentQueries]),
    reason: buildReason(type, matchedTerms, contextType),
    signalScore,
    hypothesisConfidence: options.hypothesisConfidence,
    hypothesisReason: options.hypothesisReason,
    legalElementSignals: options.legalElementSignals,
    factHints: options.factHints,
    querySources: options.querySources,
    broadLawQueries,
    preciseLawQueries,
    broadPrecedentQueries,
    precisePrecedentQueries
  };
}

function buildCandidateIssuesFromCatalog(
  normalizedQuery: string,
  tokens: string[],
  contextType: KeywordContextType
): CandidateIssue[] {
  const issues = RETRIEVAL_ISSUE_CATALOG
    .map((issue) => {
      const matchedTerms = unique(
        issue.keywords.filter((keyword) =>
          normalizedQuery.includes(normalizeText(keyword)) ||
          tokens.some((token) => token.includes(normalizeText(keyword)) || normalizeText(keyword).includes(token))
        )
      );
      if (matchedTerms.length === 0) {
        return null;
      }

      const signalScore = Math.min(1, 0.35 + matchedTerms.length * 0.15);
      return buildCandidateIssue(issue.type, issue.severity, matchedTerms, contextType, Number(signalScore.toFixed(2)), {
        querySources: ["keyword"]
      });
    })
    .filter((issue): issue is CandidateIssue => Boolean(issue))
    .sort((left, right) => (right.signalScore ?? 0) - (left.signalScore ?? 0));

  if (issues.length > 0) {
    return issues;
  }

  return [
    {
      type: "일반 키워드 검증",
      severity: "low",
      matchedTerms: tokens.length > 0 ? tokens : [normalizedQuery],
      lawQueries: unique([normalizedQuery, ...tokens]),
      precedentQueries: unique([normalizedQuery, ...tokens]),
      reason: "명확한 지원 이슈가 잡히지 않아 원문 키워드 중심 검색으로 확장했습니다.",
      broadLawQueries: unique([normalizedQuery]),
      preciseLawQueries: unique(tokens),
      broadPrecedentQueries: unique([normalizedQuery]),
      precisePrecedentQueries: unique(tokens)
    }
  ];
}

function buildProfileAwareHints(profileContext?: ProfileContext): {
  lawBroad: string[];
  lawPrecise: string[];
  precedentBroad: string[];
  precedentPrecise: string[];
  warnings: string[];
} {
  if (!profileContext) {
    return {
      lawBroad: [],
      lawPrecise: [],
      precedentBroad: [],
      precedentPrecise: [],
      warnings: []
    };
  }

  const lawBroad: string[] = [];
  const lawPrecise: string[] = [];
  const precedentBroad: string[] = [];
  const precedentPrecise: string[] = [];
  const warnings: string[] = [];

  if (profileContext.isMinor) {
    lawBroad.push("미성년자", "법정대리인");
    precedentBroad.push("미성년자 피해", "청소년 온라인 분쟁");
    warnings.push("미성년자 사안은 보호자 또는 법정대리인 동행 필요 여부를 별도로 확인해야 합니다.");
  }

  if (profileContext.ageBand === "child") {
    lawPrecise.push("아동", "청소년");
    precedentPrecise.push("아동 온라인 모욕", "청소년 게임 채팅");
  }

  if (profileContext.nationality === "foreign") {
    warnings.push("외국적 사용자라면 통역, 번역, 체류 관련 메모가 필요한지 추가 확인하는 편이 안전합니다.");
  }

  return {
    lawBroad: unique(lawBroad),
    lawPrecise: unique(lawPrecise),
    precedentBroad: unique(precedentBroad),
    precedentPrecise: unique(precedentPrecise),
    warnings: unique(warnings.concat(profileContext.legalNotes ?? []))
  };
}

function buildQueryBuckets(candidateIssues: CandidateIssue[], profileContext?: ProfileContext) {
  const profileHints = buildProfileAwareHints(profileContext);

  const broadLawQueries = unique([
    ...candidateIssues.flatMap((issue) => issue.broadLawQueries ?? issue.lawQueries),
    ...profileHints.lawBroad
  ]);
  const preciseLawQueries = unique([
    ...candidateIssues.flatMap((issue) => issue.preciseLawQueries ?? issue.matchedTerms),
    ...profileHints.lawPrecise
  ]);
  const broadPrecedentQueries = unique([
    ...candidateIssues.flatMap((issue) => issue.broadPrecedentQueries ?? issue.precedentQueries),
    ...profileHints.precedentBroad
  ]);
  const precisePrecedentQueries = unique([
    ...candidateIssues.flatMap((issue) => issue.precisePrecedentQueries ?? issue.matchedTerms),
    ...profileHints.precedentPrecise
  ]);

  const lawQueryRefs = mergeQueryRefs(
    buildIssueQueryRefs(candidateIssues, "law"),
    buildAuxiliaryQueryRefs({
      queries: profileHints.lawBroad,
      bucket: "broad",
      channel: "law",
      source: "profile",
      issueTypes: candidateIssues.map((issue) => issue.type)
    }),
    buildAuxiliaryQueryRefs({
      queries: profileHints.lawPrecise,
      bucket: "precise",
      channel: "law",
      source: "profile",
      issueTypes: candidateIssues.map((issue) => issue.type)
    })
  );
  const precedentQueryRefs = mergeQueryRefs(
    buildIssueQueryRefs(candidateIssues, "precedent"),
    buildAuxiliaryQueryRefs({
      queries: profileHints.precedentBroad,
      bucket: "broad",
      channel: "precedent",
      source: "profile",
      issueTypes: candidateIssues.map((issue) => issue.type)
    }),
    buildAuxiliaryQueryRefs({
      queries: profileHints.precedentPrecise,
      bucket: "precise",
      channel: "precedent",
      source: "profile",
      issueTypes: candidateIssues.map((issue) => issue.type)
    })
  );

  return {
    broadLawQueries,
    preciseLawQueries,
    broadPrecedentQueries,
    precisePrecedentQueries,
    lawQueries: unique([...broadLawQueries, ...preciseLawQueries]),
    precedentQueries: unique([...broadPrecedentQueries, ...precisePrecedentQueries]),
    lawQueryRefs,
    precedentQueryRefs,
    warnings: profileHints.warnings
  };
}

export function buildKeywordQueryPlan(
  query: string,
  contextType: KeywordContextType,
  profileContext?: ProfileContext
): KeywordQueryPlan {
  const normalizedQuery = normalizeText(query);
  const tokens = tokenize(query);
  const warnings: string[] = [];

  if (normalizedQuery.length < 2) {
    warnings.push("입력이 너무 짧아 검색 결과가 부정확할 수 있습니다.");
  }

  if (tokens.length === 1) {
    warnings.push("단일 키워드만으로는 공연성, 반복성, 고의성을 판단하기 어렵습니다.");
  }

  const candidateIssues = buildCandidateIssuesFromCatalog(normalizedQuery, tokens, contextType);
  const buckets = buildQueryBuckets(candidateIssues, profileContext);
  const inferredFacts = buildClassifierFacts(
    { source_type: contextType, utterances: [] },
    query,
    contextType
  );
  const scopeFilter = buildScopeFilter(
    normalizedQuery,
    candidateIssues.map((issue) => issue.type),
    inferredFacts
  );

  return {
    originalQuery: query.trim(),
    normalizedQuery,
    contextType,
    tokens,
    candidateIssues,
    broadLawQueries: buckets.broadLawQueries,
    preciseLawQueries: buckets.preciseLawQueries,
    broadPrecedentQueries: buckets.broadPrecedentQueries,
    precisePrecedentQueries: buckets.precisePrecedentQueries,
    lawQueries: buckets.lawQueries,
    precedentQueries: buckets.precedentQueries,
    lawQueryRefs: buckets.lawQueryRefs,
    precedentQueryRefs: buckets.precedentQueryRefs,
    warnings: unique([...warnings, ...buckets.warnings, ...scopeFilter.scope_warnings]),
    supportedIssues: scopeFilter.supported_issues,
    unsupportedIssues: scopeFilter.unsupported_issues,
    scopeWarnings: scopeFilter.scope_warnings,
    scopeFlags: scopeFilter.scope_flags
  };
}

function normalizeClassificationIssues(
  classificationResult: ClassificationResultLike
): ClassificationIssueLike[] {
  return Array.isArray(classificationResult.issues)
    ? classificationResult.issues.filter((issue): issue is ClassificationIssueLike => Boolean(issue))
    : [];
}

function normalizeIssueHypotheses(
  classificationResult: ClassificationResultLike
): ClassificationHypothesisLike[] {
  return Array.isArray(classificationResult.issue_hypotheses)
    ? classificationResult.issue_hypotheses.filter((issue): issue is ClassificationHypothesisLike => Boolean(issue))
    : [];
}

function buildAnalysisCandidateIssues(
  classificationResult: ClassificationResultLike,
  contextType: KeywordContextType
): CandidateIssue[] {
  const hypotheses = normalizeIssueHypotheses(classificationResult);
  if (hypotheses.length > 0) {
    const fromHypotheses = hypotheses
      .map((hypothesis) => {
        const type = String(hypothesis.type ?? "").trim();
        if (!type) {
          return null;
        }

        const matchedTerms = unique(asStringArray(hypothesis.matched_terms));
        const legalElementSignals = getLegalElementSignals(classificationResult, type);
        const legalElementExpansions = buildLegalElementQueryExpansions(type, legalElementSignals);
        return buildCandidateIssue(
          type,
          "high",
          matchedTerms.length > 0 ? matchedTerms : [type],
          contextType,
          typeof hypothesis.confidence === "number" ? hypothesis.confidence : undefined,
          {
            hypothesisConfidence: typeof hypothesis.confidence === "number" ? hypothesis.confidence : undefined,
            hypothesisReason: String(hypothesis.reason ?? "").trim() || undefined,
            legalElementSignals,
            factHints: legalElementExpansions.factHints,
            additionalPreciseLawQueries: legalElementExpansions.preciseLawQueries,
            additionalPrecisePrecedentQueries: legalElementExpansions.precisePrecedentQueries,
            querySources: unique([
              ...normalizeHypothesisSources(hypothesis),
              ...(legalElementSignals.length > 0 ? ["legal_element"] : [])
            ]) as QuerySourceKind[]
          }
        );
      })
      .filter((issue): issue is CandidateIssue => Boolean(issue));

    if (fromHypotheses.length > 0) {
      return fromHypotheses;
    }
  }

  return normalizeClassificationIssues(classificationResult)
    .map((issue) => {
      const type = String(issue.type ?? "").trim();
      if (!type) {
        return null;
      }

      const severity = issue.severity === "high" || issue.severity === "medium" || issue.severity === "low"
        ? issue.severity
        : "low";
      const matchedTerms = unique([...asStringArray(issue.keywords), type]);
      const legalElementSignals = getLegalElementSignals(classificationResult, type);
      const legalElementExpansions = buildLegalElementQueryExpansions(type, legalElementSignals);

      return buildCandidateIssue(
        type,
        severity,
        matchedTerms,
        contextType,
        undefined,
        {
          fallbackLawQueries: asStringArray(issue.law_search_queries),
          legalElementSignals,
          factHints: legalElementExpansions.factHints,
          additionalPreciseLawQueries: legalElementExpansions.preciseLawQueries,
          additionalPrecisePrecedentQueries: legalElementExpansions.precisePrecedentQueries,
          querySources: unique([
            "keyword",
            ...(legalElementSignals.length > 0 ? ["legal_element"] : [])
          ]) as QuerySourceKind[]
        }
      );
    })
    .filter((issue): issue is CandidateIssue => Boolean(issue));
}

function normalizeQueryHints(queryHints: ClassificationQueryHintsLike | undefined) {
  return {
    lawBroad: asStringArray(queryHints?.law?.broad),
    lawPrecise: asStringArray(queryHints?.law?.precise),
    precedentBroad: asStringArray(queryHints?.precedent?.broad),
    precedentPrecise: asStringArray(queryHints?.precedent?.precise),
    broad: asStringArray(queryHints?.broad),
    precise: asStringArray(queryHints?.precise)
  };
}

export function buildAnalysisRetrievalPlan(
  classificationResult: ClassificationResultLike,
  contextType: KeywordContextType,
  profileContext?: ProfileContext,
  rawText?: string
): KeywordQueryPlan {
  const sourceText = String(rawText ?? classificationResult.searchable_text ?? "").trim();
  const fallbackText = normalizeClassificationIssues(classificationResult)
    .flatMap((issue) => [
      String(issue.type ?? "").trim(),
      ...asStringArray(issue.keywords),
      ...asStringArray(issue.law_search_queries)
    ])
    .filter(Boolean)
    .join(" ");
  const baseQuery = sourceText || fallbackText;
  const basePlan = buildKeywordQueryPlan(baseQuery || "일반 키워드 검증", contextType, profileContext);
  const candidateIssues = buildAnalysisCandidateIssues(classificationResult, contextType);
  const buckets = buildQueryBuckets(candidateIssues, profileContext);
  const queryHints = normalizeQueryHints(classificationResult.query_hints as ClassificationQueryHintsLike | undefined);
  const fallbackScopeFilter = buildScopeFilter(
    baseQuery || basePlan.originalQuery,
    candidateIssues.map((issue) => issue.type),
    classificationResult.facts
  );
  const scopeFilter = normalizeScopeFilter(classificationResult, {
    supportedIssues: fallbackScopeFilter.supported_issues,
    unsupportedIssues: fallbackScopeFilter.unsupported_issues,
    scopeWarnings: fallbackScopeFilter.scope_warnings,
    scopeFlags: fallbackScopeFilter.scope_flags
  });

  if (candidateIssues.length === 0) {
    return {
      ...basePlan,
      warnings: unique([...basePlan.warnings, ...scopeFilter.scopeWarnings]),
      supportedIssues: scopeFilter.supportedIssues,
      unsupportedIssues: scopeFilter.unsupportedIssues,
      scopeWarnings: scopeFilter.scopeWarnings,
      scopeFlags: scopeFilter.scopeFlags
    };
  }

  const broadLawQueries = unique([
    ...queryHints.lawBroad,
    ...queryHints.broad,
    ...buckets.broadLawQueries,
    ...basePlan.broadLawQueries
  ]);
  const preciseLawQueries = unique([
    ...queryHints.lawPrecise,
    ...queryHints.precise,
    ...buckets.preciseLawQueries,
    ...basePlan.preciseLawQueries
  ]);
  const broadPrecedentQueries = unique([
    ...queryHints.precedentBroad,
    ...queryHints.broad,
    ...buckets.broadPrecedentQueries,
    ...basePlan.broadPrecedentQueries
  ]);
  const precisePrecedentQueries = unique([
    ...queryHints.precedentPrecise,
    ...queryHints.precise,
    ...buckets.precisePrecedentQueries,
    ...basePlan.precisePrecedentQueries
  ]);

  const lawQueryRefs = mergeQueryRefs(
    basePlan.lawQueryRefs,
    buckets.lawQueryRefs,
    buildAuxiliaryQueryRefs({
      queries: [...queryHints.lawBroad, ...queryHints.broad],
      bucket: "broad",
      channel: "law",
      source: "query_hint",
      issueTypes: candidateIssues.map((issue) => issue.type)
    }),
    buildAuxiliaryQueryRefs({
      queries: [...queryHints.lawPrecise, ...queryHints.precise],
      bucket: "precise",
      channel: "law",
      source: "query_hint",
      issueTypes: candidateIssues.map((issue) => issue.type)
    }),
    scopeFilter.scopeWarnings.length > 0
      ? buildAuxiliaryQueryRefs({
        queries: [],
        bucket: "precise",
        channel: "law",
        source: "scope_warning"
      })
      : []
  );
  const precedentQueryRefs = mergeQueryRefs(
    basePlan.precedentQueryRefs,
    buckets.precedentQueryRefs,
    buildAuxiliaryQueryRefs({
      queries: [...queryHints.precedentBroad, ...queryHints.broad],
      bucket: "broad",
      channel: "precedent",
      source: "query_hint",
      issueTypes: candidateIssues.map((issue) => issue.type)
    }),
    buildAuxiliaryQueryRefs({
      queries: [...queryHints.precedentPrecise, ...queryHints.precise],
      bucket: "precise",
      channel: "precedent",
      source: "query_hint",
      issueTypes: candidateIssues.map((issue) => issue.type)
    })
  );

  const normalizedLawQueryRefs = mergeQueryRefs(
    lawQueryRefs,
    scopeFilter.scopeWarnings.length > 0
      ? buildAuxiliaryQueryRefs({
        queries: preciseLawQueries,
        bucket: "precise",
        channel: "law",
        source: "scope_warning",
        issueTypes: candidateIssues.map((issue) => issue.type)
      })
      : []
  );
  const normalizedPrecedentQueryRefs = mergeQueryRefs(
    precedentQueryRefs,
    scopeFilter.scopeWarnings.length > 0
      ? buildAuxiliaryQueryRefs({
        queries: precisePrecedentQueries,
        bucket: "precise",
        channel: "precedent",
        source: "scope_warning",
        issueTypes: candidateIssues.map((issue) => issue.type)
      })
      : []
  );

  return {
    ...basePlan,
    originalQuery: baseQuery || basePlan.originalQuery,
    normalizedQuery: normalizeText(baseQuery || basePlan.originalQuery),
    candidateIssues,
    broadLawQueries,
    preciseLawQueries,
    broadPrecedentQueries,
    precisePrecedentQueries,
    lawQueries: unique([...broadLawQueries, ...preciseLawQueries]),
    precedentQueries: unique([...broadPrecedentQueries, ...precisePrecedentQueries]),
    lawQueryRefs: normalizedLawQueryRefs,
    precedentQueryRefs: normalizedPrecedentQueryRefs,
    warnings: unique([
      ...basePlan.warnings,
      ...scopeFilter.scopeWarnings,
      sourceText ? "입력 원문과 분류 결과를 함께 사용해 검색 범위를 조정했습니다." : ""
    ]),
    supportedIssues: scopeFilter.supportedIssues,
    unsupportedIssues: scopeFilter.unsupportedIssues,
    scopeWarnings: scopeFilter.scopeWarnings,
    scopeFlags: scopeFilter.scopeFlags
  };
}
