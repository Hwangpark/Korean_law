import {
  CONTEXT_HINTS,
  ISSUE_CATALOG
} from "../lib/issue-catalog.mjs";
import type { KeywordContextType, RetrievalIssueDefinition } from "./types.js";

export const RETRIEVAL_ISSUE_CATALOG: RetrievalIssueDefinition[] = ISSUE_CATALOG.map((issue: (typeof ISSUE_CATALOG)[number]) => ({
  type: issue.type,
  severity: issue.severity,
  chargeLabel: issue.charge_label,
  keywords: issue.keywords,
  lawQueries: issue.law_search_queries,
  precedentQueries: issue.precedent_queries,
  preciseTerms: issue.precise_terms
}));

export const CONTEXT_PRECEDENT_HINTS: Record<KeywordContextType, string[]> = CONTEXT_HINTS;
export const CONTEXT_LAW_HINTS: Record<KeywordContextType, string[]> = CONTEXT_HINTS;
