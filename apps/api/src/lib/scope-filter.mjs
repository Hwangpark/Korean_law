import {
  PROCEDURAL_KEYWORDS,
  UNSUPPORTED_ISSUE_KEYWORDS,
  normalizeText
} from "./issue-catalog.mjs";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function detectUnsupportedIssues(normalizedText) {
  return unique(
    UNSUPPORTED_ISSUE_KEYWORDS.filter((keyword) => normalizedText.includes(normalizeText(keyword)))
  );
}

function normalizeStringList(values, maxItems = 12) {
  return unique((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)).slice(0, maxItems);
}

function toBoolean(value) {
  return value === true;
}

function toNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeFacts(facts, normalizedText) {
  return {
    utteranceCount: toNumber(facts?.utterance_count, 0),
    textLength: toNumber(facts?.text_length, normalizedText.length),
    publicExposure: toBoolean(facts?.public_exposure),
    repeatedContact: toBoolean(facts?.repeated_contact),
    moneyRequest: toBoolean(facts?.money_request),
    personalInfoExposed: toBoolean(facts?.personal_info_exposed),
    threatSignal: toBoolean(facts?.threat_signal),
    insultingExpression: toBoolean(facts?.insulting_expression),
    familyDirectedInsult: toBoolean(facts?.family_directed_insult),
    falseFactSignal: toBoolean(facts?.false_fact_signal),
    targetIdentifiable: toBoolean(facts?.target_identifiable),
    directMessage: toBoolean(facts?.direct_message),
    proceduralSignal: toBoolean(facts?.procedural_signal),
    unsupportedIssueSignal: toBoolean(facts?.unsupported_issue_signal)
  };
}

function countFactSignals(facts) {
  return [
    facts.publicExposure,
    facts.repeatedContact,
    facts.moneyRequest,
    facts.personalInfoExposed,
    facts.threatSignal,
    facts.insultingExpression,
    facts.familyDirectedInsult,
    facts.falseFactSignal,
    facts.targetIdentifiable,
    facts.directMessage
  ].filter(Boolean).length;
}

function hasActionableFactPattern(facts, factSignalCount) {
  if (factSignalCount >= 3) {
    return true;
  }

  if (facts.threatSignal || facts.moneyRequest || facts.personalInfoExposed) {
    return true;
  }

  if (facts.insultingExpression || facts.familyDirectedInsult) {
    return true;
  }

  if (facts.publicExposure && (facts.falseFactSignal || facts.targetIdentifiable)) {
    return true;
  }

  if (facts.repeatedContact && (facts.threatSignal || facts.moneyRequest || facts.directMessage)) {
    return true;
  }

  return false;
}

function detectInsufficientFacts(facts, normalizedSupportedIssues, scopeFlags) {
  const factSignalCount = countFactSignals(facts);
  const hasNarrativeLength = facts.textLength >= 30 || facts.utteranceCount >= 2;
  const hasActionableFacts = hasActionableFactPattern(facts, factSignalCount);

  if (scopeFlags.proceduralHeavy) {
    return facts.textLength < 20 && factSignalCount === 0 && normalizedSupportedIssues.length === 0;
  }

  if (scopeFlags.unsupportedIssuePresent) {
    return !hasNarrativeLength && factSignalCount === 0;
  }

  if (normalizedSupportedIssues.length > 0) {
    return !hasNarrativeLength && factSignalCount === 0;
  }

  if (!hasNarrativeLength) {
    return !hasActionableFacts;
  }

  return !hasActionableFacts;
}

export function buildScopeFilter(searchableText, supportedIssues = [], facts = undefined, guidance = undefined) {
  const normalizedText = normalizeText(searchableText);
  const normalizedSupportedIssues = unique(
    supportedIssues.map((issue) => String(issue ?? "").trim()).filter(Boolean)
  );
  const guidanceWarnings = normalizeStringList(guidance?.warnings);
  const guidanceUnsupportedIssues = normalizeStringList(guidance?.unsupportedIssues ?? guidance?.unsupported_issues);
  const unsupportedIssues = unique([
    ...detectUnsupportedIssues(normalizedText),
    ...guidanceUnsupportedIssues
  ]);
  const normalizedFacts = normalizeFacts(facts, normalizedText);
  const scopeFlags = {
    proceduralHeavy: normalizedFacts.proceduralSignal || hasAny(normalizedText, PROCEDURAL_KEYWORDS),
    insufficientFacts: false,
    unsupportedIssuePresent:
      normalizedFacts.unsupportedIssueSignal || unsupportedIssues.length > 0
  };

  scopeFlags.insufficientFacts = detectInsufficientFacts(
    normalizedFacts,
    normalizedSupportedIssues,
    scopeFlags
  );

  const scopeWarnings = [];

  if (scopeFlags.proceduralHeavy) {
    scopeWarnings.push(
      "현재 입력은 절차법 또는 판결 요지 중심 내용일 수 있어 사실관계 기반 판단 정확도가 낮을 수 있습니다."
    );
  }

  if (scopeFlags.insufficientFacts) {
    scopeWarnings.push(
      "공개 범위, 반복성, 금전 요구, 실명/연락처 노출 여부 같은 사실관계를 더 보완해 주세요."
    );
  }

  if (scopeFlags.unsupportedIssuePresent) {
    scopeWarnings.push("현재 서비스 범위 밖 이슈가 포함되어 있을 수 있습니다.");
  }

  if (guidanceUnsupportedIssues.length > 0) {
    scopeWarnings.push(`지원 범위 밖 이슈 후보가 감지되었습니다: ${guidanceUnsupportedIssues.join(", ")}`);
  }

  scopeWarnings.push(...guidanceWarnings);

  return {
    scope_flags: scopeFlags,
    supported_issues: normalizedSupportedIssues,
    unsupported_issues: unsupportedIssues,
    scope_warnings: unique(scopeWarnings)
  };
}
