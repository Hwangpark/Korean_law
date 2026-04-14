export type RetrievalProviderMode = "mock" | "live";
export type RetrievalKind = "law" | "precedent";

export interface KeywordVerificationRequest {
  query: string;
  contextType: string;
  providerMode: RetrievalProviderMode;
  limit: number;
  userId: number | null;
}

export interface PlannedIssue {
  type: string;
  severity: "low" | "medium" | "high";
  criminal: boolean;
  civil: boolean;
  chargeLabel: string;
  matchedKeywords: string[];
  lawSearchQueries: string[];
}

export interface KeywordVerificationPlan {
  query: string;
  normalizedQuery: string;
  contextType: string;
  providerMode: RetrievalProviderMode;
  limit: number;
  tokens: string[];
  matchedIssues: PlannedIssue[];
  searchQueries: string[];
  rationale: string;
}

export interface LawCandidate {
  law_name: string;
  article_no: string;
  article_title: string;
  content: string;
  penalty: string;
  is_complaint_required: boolean;
  url: string;
  topics: string[];
  queries: string[];
  provider: RetrievalProviderMode;
}

export interface PrecedentCandidate {
  case_no: string;
  court: string;
  date: string;
  summary: string;
  verdict: string;
  sentence: string;
  key_reasoning: string;
  similarity_score: number;
  url: string;
  topics: string[];
  provider: RetrievalProviderMode;
}

export interface ScoredLawCandidate extends LawCandidate {
  score: number;
  matchedTerms: string[];
  relevance: "strong" | "moderate" | "weak";
}

export interface ScoredPrecedentCandidate extends PrecedentCandidate {
  score: number;
  matchedTerms: string[];
  relevance: "strong" | "moderate" | "weak";
}

export interface KeywordVerificationOutput {
  meta: {
    provider_mode: RetrievalProviderMode;
    generated_at: string;
    query: string;
    context_type: string;
  };
  planner: KeywordVerificationPlan;
  verification: {
    summary: string;
    score: number;
    matched_issue_types: string[];
    focus: RetrievalKind[];
    recommended_keywords: string[];
  };
  law_search: {
    provider: RetrievalProviderMode;
    laws: ScoredLawCandidate[];
  };
  precedent_search: {
    provider: RetrievalProviderMode;
    precedents: ScoredPrecedentCandidate[];
  };
}

export interface QueryRunRecord {
  id: string;
  query_text: string;
  context_type: string;
  provider_mode: string;
  user_id: number | null;
  planner_json: Record<string, unknown>;
  verification_json: Record<string, unknown>;
  result_count: number;
  top_score: number;
  created_at: string;
  updated_at: string;
}

export interface QueryHitRecord {
  id: string;
  run_id: string;
  kind: RetrievalKind;
  source_key: string;
  score: number;
  rank: number;
  matched_terms: string[];
  reference_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface RetrievalRunDetail {
  run: QueryRunRecord;
  hits: QueryHitRecord[];
}
