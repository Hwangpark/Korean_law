import {
  ISSUE_CATALOG,
  buildLegalElements,
  buildQueryHints,
  buildRuleBasedIssueHypotheses,
  detectSignals,
  findIssueKeywords,
  normalizeText
} from "../lib/issue-catalog.mjs";
import { buildClassifierFacts } from "../lib/classification-facts.mjs";
import { runGuidedExtractionAgent } from "./guided-extraction-agent.mjs";
import { buildScopeFilter } from "../lib/scope-filter.mjs";

function inferContextType(ocrResult) {
  const sourceType = String(ocrResult?.source_type ?? "").trim();
  if (sourceType === "community" || sourceType === "game_chat" || sourceType === "messenger") {
    return sourceType;
  }
  return "other";
}

function buildLegacyIssues(searchableText, hypotheses) {
  return hypotheses
    .map((hypothesis) => {
      const issue = ISSUE_CATALOG.find((item) => item.type === hypothesis.type);
      if (!issue) {
        return null;
      }
      const matchedKeywords = findIssueKeywords(searchableText, issue.keywords);

      return {
        type: issue.type,
        severity: issue.severity,
        criminal: issue.criminal,
        civil: issue.civil,
        keywords: matchedKeywords.length > 0 ? matchedKeywords : hypothesis.matched_terms ?? [],
        law_search_queries: issue.law_search_queries,
        charge_label: issue.charge_label,
        hypothesis_source: hypothesis.source ?? "keyword",
        hypothesis_sources: hypothesis.sources ?? [hypothesis.source ?? "keyword"]
      };
    })
    .filter(Boolean);
}

function mergeLegalElements(fallbackElements, guidedElements) {
  const result = { ...(fallbackElements ?? {}) };
  for (const [issueType, elements] of Object.entries(guidedElements ?? {})) {
    result[issueType] = {
      ...(result[issueType] ?? {}),
      ...(elements ?? {})
    };
  }
  return result;
}

function mergeQueryHints(fallbackHints, guidedHints) {
  const unique = (values) => [...new Set((values ?? []).filter(Boolean))];
  return {
    broad: unique([...(guidedHints?.broad ?? []), ...(fallbackHints?.broad ?? [])]),
    precise: unique([...(guidedHints?.precise ?? []), ...(fallbackHints?.precise ?? [])]),
    law: {
      broad: unique([...(guidedHints?.law?.broad ?? []), ...(fallbackHints?.law?.broad ?? [])]),
      precise: unique([...(guidedHints?.law?.precise ?? []), ...(fallbackHints?.law?.precise ?? [])])
    },
    precedent: {
      broad: unique([...(guidedHints?.precedent?.broad ?? []), ...(fallbackHints?.precedent?.broad ?? [])]),
      precise: unique([...(guidedHints?.precedent?.precise ?? []), ...(fallbackHints?.precedent?.precise ?? [])])
    }
  };
}

export async function runClassifierAgent(ocrResult) {
  const searchableText = normalizeText(
    [ocrResult?.raw_text, ...(ocrResult?.utterances ?? []).map((item) => item?.text)].join(" ")
  );
  const contextType = inferContextType(ocrResult);
  const signalHints = buildClassifierFacts(ocrResult, searchableText, contextType);
  const guidedExtraction = await runGuidedExtractionAgent({
    searchableText,
    contextType,
    signalHints
  });
  const extraction = guidedExtraction.extraction;
  const facts = extraction?.facts ?? signalHints;
  const hasLlmIssueHypotheses = extraction?.issue_hypotheses?.length > 0;
  const issueHypotheses = hasLlmIssueHypotheses
    ? extraction.issue_hypotheses
    : buildRuleBasedIssueHypotheses(searchableText, contextType, facts);
  const issueHypothesesSource = hasLlmIssueHypotheses
    ? "llm"
    : extraction
      ? "rule_from_llm_facts"
      : "rule_fallback";
  const supportedIssues = issueHypotheses.map((hypothesis) => hypothesis.type);
  const issues = buildLegacyIssues(searchableText, issueHypotheses);
  const queryHintIssues = issueHypotheses
    .map((hypothesis) => ISSUE_CATALOG.find((catalogItem) => catalogItem.type === hypothesis.type))
    .filter(Boolean);
  const fallbackLegalElements = buildLegalElements(searchableText, issues, facts);
  const fallbackQueryHints = buildQueryHints(queryHintIssues, contextType);
  const extractionWarnings = extraction?.warnings ?? [];
  const extractionUnsupportedIssues = extraction?.unsupported_issue_types ?? [];
  const runtimeWarnings = [
    ...(guidedExtraction.warning ? [guidedExtraction.warning] : []),
    ...extractionWarnings
  ];
  const scopeFilter = buildScopeFilter(searchableText, supportedIssues, facts, {
    warnings: extractionWarnings,
    unsupportedIssues: extractionUnsupportedIssues
  });

  return {
    issues,
    facts,
    signal_hints: signalHints,
    extraction: {
      mode: guidedExtraction.mode,
      model: guidedExtraction.model,
      used_llm: guidedExtraction.mode === "openai",
      warning: guidedExtraction.warning,
      warnings: runtimeWarnings,
      unsupported_issue_types: extractionUnsupportedIssues,
      issue_hypotheses_source: issueHypothesesSource
    },
    signals: detectSignals(searchableText),
    issue_hypotheses: issueHypotheses,
    legal_elements: mergeLegalElements(fallbackLegalElements, extraction?.legal_elements),
    query_hints: mergeQueryHints(fallbackQueryHints, extraction?.query_hints),
    scope_flags: scopeFilter.scope_flags,
    supported_issues: scopeFilter.supported_issues,
    unsupported_issues: scopeFilter.unsupported_issues,
    scope_warnings: scopeFilter.scope_warnings,
    is_criminal: issues.some((issue) => Boolean(issue?.criminal)),
    is_civil: issues.some((issue) => Boolean(issue?.civil)),
    searchable_text: searchableText
  };
}
