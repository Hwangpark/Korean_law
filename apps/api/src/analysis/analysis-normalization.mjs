import { buildScopeFilter } from "../lib/scope-filter.mjs";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function asStringArray(value) {
  return Array.isArray(value)
    ? unique(value.map((item) => String(item ?? "").trim()).filter(Boolean))
    : [];
}

function asBoolean(value) {
  return Boolean(value);
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getNormalizedIssueTypes(classificationResult) {
  return unique(
    Array.isArray(classificationResult?.issues)
      ? classificationResult.issues.map((issue) => String(issue?.type ?? "").trim()).filter(Boolean)
      : []
  );
}

export function getIssueHypothesisConfidenceMap(classificationResult) {
  const map = new Map();
  if (!Array.isArray(classificationResult?.issue_hypotheses)) {
    return map;
  }

  for (const hypothesis of classificationResult.issue_hypotheses) {
    const type = String(hypothesis?.type ?? "").trim();
    const confidence = Number(hypothesis?.confidence ?? 0);
    if (type && Number.isFinite(confidence)) {
      map.set(type, confidence);
    }
  }

  return map;
}

export function getNormalizedLegalElements(classificationResult, issueType) {
  if (!classificationResult?.legal_elements || typeof classificationResult.legal_elements !== "object") {
    return {};
  }

  const candidate = classificationResult.legal_elements[issueType];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
}

export function getNormalizedFacts(classificationResult) {
  const facts = classificationResult?.facts && typeof classificationResult.facts === "object"
    ? classificationResult.facts
    : {};

  return {
    source_type: String(facts.source_type ?? "").trim() || "text",
    context_type: String(facts.context_type ?? "").trim() || "other",
    utterance_count: asNumber(facts.utterance_count),
    text_length: asNumber(facts.text_length),
    public_exposure: asBoolean(facts.public_exposure),
    direct_message: asBoolean(facts.direct_message),
    repeated_contact: asBoolean(facts.repeated_contact),
    threat_signal: asBoolean(facts.threat_signal),
    money_request: asBoolean(facts.money_request),
    personal_info_exposed: asBoolean(facts.personal_info_exposed),
    insulting_expression: asBoolean(facts.insulting_expression),
    false_fact_signal: asBoolean(facts.false_fact_signal),
    target_identifiable: asBoolean(facts.target_identifiable),
    procedural_signal: asBoolean(facts.procedural_signal),
    unsupported_issue_signal: asBoolean(facts.unsupported_issue_signal),
    detected_keywords: asStringArray(facts.detected_keywords)
  };
}

export function getFactsInferredIssueTypes(classificationResult) {
  const facts = getNormalizedFacts(classificationResult);
  const inferred = [];

  if (facts.false_fact_signal && (facts.public_exposure || facts.target_identifiable)) {
    inferred.push("명예훼손");
  }

  if (facts.insulting_expression && (facts.public_exposure || facts.target_identifiable || !facts.direct_message)) {
    inferred.push("모욕");
  }

  if (facts.threat_signal || (facts.money_request && facts.threat_signal)) {
    inferred.push("협박/공갈");
  }

  if (facts.personal_info_exposed) {
    inferred.push("개인정보 유출");
  }

  if (facts.repeated_contact && (facts.direct_message || facts.public_exposure)) {
    inferred.push("스토킹");
  }

  if (facts.money_request && !facts.threat_signal) {
    inferred.push("사기");
  }

  return unique(inferred);
}

export function getCanonicalIssueTypes(classificationResult) {
  const hypothesisTypes = Array.isArray(classificationResult?.issue_hypotheses)
    ? classificationResult.issue_hypotheses
      .map((hypothesis) => String(hypothesis?.type ?? "").trim())
      .filter(Boolean)
    : [];

  return unique([
    ...hypothesisTypes,
    ...getFactsInferredIssueTypes(classificationResult),
    ...getNormalizedIssueTypes(classificationResult)
  ]);
}

export function resolveAnalysisScopeFlags(classificationResult, retrievalPlan) {
  if (retrievalPlan?.scopeFlags) {
    return retrievalPlan.scopeFlags;
  }

  if (classificationResult?.scope_flags) {
    return classificationResult.scope_flags;
  }

  const fallbackScope = buildScopeFilter(
    String(classificationResult?.searchable_text ?? "").trim(),
    getCanonicalIssueTypes(classificationResult),
    getNormalizedFacts(classificationResult)
  );
  return fallbackScope.scope_flags;
}

export function buildAnalysisWarnings(scopeFlags) {
  const warnings = [];

  if (scopeFlags.proceduralHeavy) {
    warnings.push("현재 입력은 절차법 또는 판결 요지 중심일 수 있어 사실관계 기반 판단과 다를 수 있습니다.");
  }
  if (scopeFlags.insufficientFacts) {
    warnings.push("공개 범위, 반복성, 금전 요구, 실명/연락처 노출 여부 같은 사실관계를 더 보완해 주세요.");
  }
  if (scopeFlags.unsupportedIssuePresent) {
    warnings.push("현재 서비스 범위 밖 이슈가 포함될 수 있습니다.");
  }

  return warnings;
}

export function resolveAnalysisScopeSnapshot(classificationResult, retrievalPlan) {
  const scopeFlags = resolveAnalysisScopeFlags(classificationResult, retrievalPlan);
  const fallbackScope = buildScopeFilter(
    String(classificationResult?.searchable_text ?? "").trim(),
    getCanonicalIssueTypes(classificationResult),
    getNormalizedFacts(classificationResult)
  );
  const supportedIssues = unique(
    retrievalPlan?.supportedIssues ??
    classificationResult?.supported_issues ??
    fallbackScope.supported_issues
  );
  const unsupportedIssues = unique(
    retrievalPlan?.unsupportedIssues ??
    classificationResult?.unsupported_issues ??
    fallbackScope.unsupported_issues
  );
  const scopeWarnings = unique([
    ...buildAnalysisWarnings(scopeFlags),
    ...asStringArray(classificationResult?.scope_warnings),
    ...asStringArray(retrievalPlan?.scopeWarnings),
    ...asStringArray(fallbackScope.scope_warnings)
  ]);

  return {
    scopeFlags,
    supportedIssues,
    unsupportedIssues,
    scopeWarnings
  };
}
