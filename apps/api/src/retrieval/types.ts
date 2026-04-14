import type { ReferenceLibraryItem } from "../analysis/references.js";

export type KeywordContextType = "community" | "game_chat" | "messenger" | "other";
export type VerificationActor = {
  userId?: number;
  guestId?: string;
};

export interface RetrievalIssueDefinition {
  type: string;
  severity: "low" | "medium" | "high";
  chargeLabel: string;
  keywords: string[];
  lawQueries: string[];
}

export interface CandidateIssue {
  type: string;
  severity: "low" | "medium" | "high";
  matchedTerms: string[];
  lawQueries: string[];
  precedentQueries: string[];
  reason: string;
}

export interface KeywordQueryPlan {
  originalQuery: string;
  normalizedQuery: string;
  contextType: KeywordContextType;
  tokens: string[];
  candidateIssues: CandidateIssue[];
  lawQueries: string[];
  precedentQueries: string[];
  warnings: string[];
}

export interface LawDocumentRecord {
  law_name: string;
  article_no: string;
  article_title: string;
  content: string;
  penalty: string;
  url: string;
  topics: string[];
  queries: string[];
  is_complaint_required?: boolean;
}

export interface PrecedentDocumentRecord {
  case_no: string;
  court: string;
  date: string;
  summary: string;
  verdict: string;
  sentence: string;
  key_reasoning: string;
  url: string;
  topics: string[];
  similarity_score?: number;
}

export interface KeywordVerificationRequest {
  query: string;
  contextType: KeywordContextType;
  limit?: number;
}

export interface VerifiedReferenceCard {
  id: string;
  kind: "law" | "precedent";
  title: string;
  subtitle: string;
  summary: string;
  confidenceScore: number;
  matchReason: string;
  reference: ReferenceLibraryItem;
}

export interface KeywordVerificationResponse {
  run_id: string;
  query: {
    original: string;
    normalized: string;
    context_type: KeywordContextType;
  };
  plan: {
    tokens: string[];
    candidate_issues: CandidateIssue[];
    law_queries: string[];
    precedent_queries: string[];
    warnings: string[];
  };
  verification: {
    headline: string;
    interpretation: string;
    warnings: string[];
    disclaimer: string;
  };
  matched_laws: VerifiedReferenceCard[];
  matched_precedents: VerifiedReferenceCard[];
  legal_analysis: {
    can_sue: boolean;
    risk_level: number;
    summary: string;
    charges: Array<{
      charge: string;
      basis: string;
      elements_met: string[];
      probability: "high" | "medium" | "low";
      expected_penalty: string;
      reference_library: ReferenceLibraryItem[];
    }>;
    recommended_actions: string[];
    evidence_to_collect: string[];
    precedent_cards: Array<{
      case_no: string;
      court: string;
      verdict: string;
      summary: string;
      similarity_score: number;
      reference_library: ReferenceLibraryItem[];
    }>;
    disclaimer: string;
    reference_library: ReferenceLibraryItem[];
    law_reference_library: ReferenceLibraryItem[];
    precedent_reference_library: ReferenceLibraryItem[];
  };
  law_reference_library: ReferenceLibraryItem[];
  precedent_reference_library: ReferenceLibraryItem[];
  reference_library: {
    items: ReferenceLibraryItem[];
  };
}

export interface SaveKeywordVerificationRunInput {
  actor: VerificationActor;
  providerMode: string;
  request: KeywordVerificationRequest;
  plan: KeywordQueryPlan;
  response: Omit<KeywordVerificationResponse, "run_id">;
}
