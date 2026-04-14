import { ISSUE_CATALOG, findIssueKeywords, normalizeText } from "../lib/issue-catalog.mjs";

export async function runClassifierAgent(ocrResult) {
  const searchableText = normalizeText(
    [ocrResult.raw_text, ...(ocrResult.utterances ?? []).map((item) => item.text)].join(" ")
  );

  const issues = ISSUE_CATALOG.map((issue) => {
    const matchedKeywords = findIssueKeywords(searchableText, issue.keywords);
    if (matchedKeywords.length === 0) {
      return null;
    }

    return {
      type: issue.type,
      severity: issue.severity,
      keywords: matchedKeywords,
      law_search_queries: issue.law_search_queries,
      charge_label: issue.charge_label
    };
  }).filter(Boolean);

  return {
    issues,
    is_criminal: issues.length > 0,
    is_civil: issues.some((issue) => issue.type !== "협박/공갈"),
    searchable_text: searchableText
  };
}
