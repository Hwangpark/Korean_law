import { ISSUE_CATALOG, matchesKeyword, normalizeText } from "../lib/issue-catalog.mjs";

export async function runClassifierAgent(ocrResult) {
  const searchableText = normalizeText(
    [ocrResult.raw_text, ...(ocrResult.utterances ?? []).map((item) => item.text)].join(" ")
  );

  const issues = ISSUE_CATALOG.filter((issue) =>
    issue.keywords.some((keyword) => matchesKeyword(searchableText, keyword))
  ).map((issue) => ({
    type: issue.type,
    severity: issue.severity,
    keywords: issue.keywords.filter((keyword) => matchesKeyword(searchableText, keyword)),
    law_search_queries: issue.law_search_queries,
    charge_label: issue.charge_label
  }));

  return {
    issues,
    is_criminal: issues.length > 0,
    is_civil: issues.some((issue) => issue.type !== "협박/공갈"),
    searchable_text: searchableText
  };
}
