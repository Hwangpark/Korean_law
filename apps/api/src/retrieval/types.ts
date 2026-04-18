import type { ReferenceLibraryItem } from "../analysis/references.js";

export type KeywordContextType = "community" | "game_chat" | "messenger" | "other";
export type VerificationActor = {
  userId?: number;
  guestId?: string;
};

export type ProfileContext = {
  displayName?: string;
  birthDate?: string;
  gender?: string;
  nationality?: string;
  ageYears?: number;
  ageBand?: string;
  isMinor?: boolean;
  legalNotes?: string[];
};

export interface RetrievalIssueDefinition {
  type: string;
  severity: "low" | "medium" | "high";
  chargeLabel: string;
  keywords: string[];
  lawQueries: string[];
  precedentQueries: string[];
  preciseTerms: string[];
}

export interface CandidateIssue {
  type: string;
  severity: "low" | "medium" | "high";
  matchedTerms: string[];
  lawQueries: string[];
  precedentQueries: string[];
  reason: string;
  signalScore?: number;
  hypothesisConfidence?: number;
  hypothesisReason?: string;
  legalElementSignals?: string[];
  factHints?: string[];
  querySources?: Array<"keyword" | "fact" | "llm" | "hypothesis" | "query_hint" | "legal_element" | "profile" | "scope_warning">;
  broadLawQueries?: string[];
  preciseLawQueries?: string[];
  broadPrecedentQueries?: string[];
  precisePrecedentQueries?: string[];
}

export interface ScopeFlags {
  proceduralHeavy: boolean;
  insufficientFacts: boolean;
  unsupportedIssuePresent: boolean;
}

export interface ScopeFilterResult {
  supportedIssues: string[];
  unsupportedIssues: string[];
  scopeWarnings: string[];
  scopeFlags: ScopeFlags;
}

export type EvidenceQueryBucket = "broad" | "precise";
export type QuerySourceKind = "keyword" | "fact" | "llm" | "hypothesis" | "query_hint" | "legal_element" | "profile" | "scope_warning";

export interface EvidenceQueryRef {
  text: string;
  bucket: EvidenceQueryBucket;
  channel: "law" | "precedent";
  sources?: QuerySourceKind[];
  issue_types?: string[];
  legal_element_signals?: string[];
}

export interface QueryProvenanceRef extends EvidenceQueryRef {}

export interface EvidenceSnippet {
  field: "content" | "article_title" | "summary" | "key_reasoning" | "sentence" | "penalty";
  text: string;
}

export interface EvidenceCitation {
  citation_id: string;
  reference_id: string;
  reference_key: string;
  kind: "law" | "precedent";
  statement_type: "summary" | "charge" | "issue_card" | "precedent_card" | "grounding_evidence";
  statement_path: string;
  title: string;
  confidence_score: number;
  match_reason: string;
  matched_issue_types: string[];
  query_refs: EvidenceQueryRef[];
  query_source_tags: string[];
  snippet: EvidenceSnippet | null;
}

export interface EvidenceCitationMap {
  version: "v2";
  citations: EvidenceCitation[];
  by_reference_id: Record<string, string[]>;
  by_statement_path: Record<string, string[]>;
}

export interface ClaimSupportEntry {
  claim_type: "summary" | "charge";
  claim_path: string;
  title: string;
  support_level: "direct" | "partial" | "missing";
  citation_ids: string[];
  reference_ids: string[];
  evidence_count: number;
  precedent_count?: number;
  has_snippet?: boolean;
  match_reason?: string;
}

export interface ClaimSupportSummary {
  overall: "direct" | "partial" | "missing";
  direct_count: number;
  partial_count: number;
  missing_count: number;
  entries: ClaimSupportEntry[];
}

export interface RetrievalEvidenceSeed {
  reference_key: string;
  kind: "law" | "precedent";
  provider: string;
  matched_queries: EvidenceQueryRef[];
  matched_issue_types: string[];
  snippet?: EvidenceSnippet | null;
}

export type RetrievalProviderSource = "fixture" | "live" | "live_fallback";

export interface RetrievalAdapterProviderInfo {
  requested_mode: string;
  provider: string;
  source: RetrievalProviderSource;
  live_enabled: boolean;
  fallback_reason?: string;
}

export interface KeywordQueryPlan {
  originalQuery: string;
  normalizedQuery: string;
  contextType: KeywordContextType;
  tokens: string[];
  candidateIssues: CandidateIssue[];
  broadLawQueries: string[];
  preciseLawQueries: string[];
  broadPrecedentQueries: string[];
  precisePrecedentQueries: string[];
  lawQueries: string[];
  precedentQueries: string[];
  lawQueryRefs?: QueryProvenanceRef[];
  precedentQueryRefs?: QueryProvenanceRef[];
  warnings: string[];
  supportedIssues: string[];
  unsupportedIssues: string[];
  scopeWarnings: string[];
  scopeFlags: ScopeFlags;
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
  retrieval_evidence?: RetrievalEvidenceSeed;
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
  retrieval_evidence?: RetrievalEvidenceSeed;
}

export interface KeywordVerificationRequest {
  query: string;
  contextType: KeywordContextType;
  limit?: number;
  profileContext?: ProfileContext;
}

export interface RetrievalToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

export interface RetrievalPreviewCard {
  id: string;
  title: string;
  summary: string;
}

export interface RetrievalPreview {
  headline: string;
  top_issues: string[];
  top_laws: RetrievalPreviewCard[];
  top_precedents: RetrievalPreviewCard[];
  profile_flags: string[];
  disclaimer: string;
}

export interface RetrievalTraceEvent {
  stage: "planner" | "law" | "precedent" | "detail";
  tool: string;
  provider: string;
  duration_ms: number;
  cache_hit: boolean;
  input_ref: string;
  output_ref: string[];
  reason: string;
  query_refs?: QueryProvenanceRef[];
}

export interface VerifiedReferenceCard {
  id: string;
  referenceKey: string;
  kind: "law" | "precedent";
  title: string;
  subtitle: string;
  summary: string;
  confidenceScore: number;
  matchReason: string;
  querySourceTags?: string[];
  matchedQueries: EvidenceQueryRef[];
  matchedIssueTypes: string[];
  snippet?: EvidenceSnippet | null;
  source: {
    law_name?: string;
    article_no?: string;
    article_title?: string;
    penalty?: string;
    url?: string;
    case_no?: string;
    court?: string;
    verdict?: string;
    sentence?: string;
  };
  reference: ReferenceLibraryItem;
}

export interface RetrievalEvidencePack {
  version: "v2";
  run_id?: string;
  query: {
    original: string;
    normalized: string;
    context_type: KeywordContextType;
  };
  plan: {
    tokens: string[];
    candidate_issues: CandidateIssue[];
    broad_law_queries: string[];
    precise_law_queries: string[];
    broad_precedent_queries: string[];
    precise_precedent_queries: string[];
    law_queries: string[];
    precedent_queries: string[];
    warnings: string[];
    supported_issues: string[];
    unsupported_issues: string[];
    scope_warnings: string[];
    scope_flags: ScopeFlags;
    scope_filter?: {
      supported_issues: string[];
      unsupported_issues: string[];
      scope_warnings: string[];
    };
  };
  retrieval_preview: {
    law: RetrievalPreview | null;
    precedent: RetrievalPreview | null;
  };
  retrieval_trace: RetrievalTraceEvent[];
  matched_laws: VerifiedReferenceCard[];
  matched_precedents: VerifiedReferenceCard[];
  reference_library?: {
    items: ReferenceLibraryItem[];
  };
  selected_reference_ids: string[];
  top_issue_types: string[];
  evidence_strength: "high" | "medium" | "low";
  citation_map: EvidenceCitationMap;
}

export interface KeywordVerificationResponse {
  run_id: string;
  profile_context?: ProfileContext;
  query: {
    original: string;
    normalized: string;
    context_type: KeywordContextType;
  };
  plan: {
    tokens: string[];
    candidate_issues: CandidateIssue[];
    broad_law_queries: string[];
    precise_law_queries: string[];
    broad_precedent_queries: string[];
    precise_precedent_queries: string[];
    law_queries: string[];
    precedent_queries: string[];
    warnings: string[];
    supported_issues: string[];
    unsupported_issues: string[];
    scope_warnings: string[];
    scope_flags: ScopeFlags;
    scope_filter?: {
      supported_issues: string[];
      unsupported_issues: string[];
      scope_warnings: string[];
    };
  };
  verification: {
    headline: string;
    interpretation: string;
    warnings: string[];
    disclaimer: string;
  };
  retrieval_preview?: {
    law: RetrievalPreview | null;
    precedent: RetrievalPreview | null;
  };
  retrieval_trace?: RetrievalTraceEvent[];
  retrieval_evidence_pack: RetrievalEvidencePack;
  matched_laws: VerifiedReferenceCard[];
  matched_precedents: VerifiedReferenceCard[];
  legal_analysis: {
    can_sue: boolean;
    risk_level: number;
    summary: string;
    scope_assessment?: {
      supported_issues: string[];
      unsupported_issues: string[];
      procedural_heavy: boolean;
      insufficient_facts: boolean;
      unsupported_issue_present: boolean;
      warnings: string[];
    };
    grounding_evidence?: {
      top_issue: string | null;
      evidence_strength: "high" | "medium" | "low";
      laws: Array<{
        reference_key: string;
        law_name: string;
        article_no: string;
        article_title: string;
        penalty: string;
        url: string;
        confidence_score: number;
        match_reason: string;
        matched_issue_types: string[];
        matched_queries: string[];
        query_refs?: EvidenceQueryRef[];
        citation_id?: string;
        reference_id?: string;
        source_field?: string;
        snippet: string;
      }>;
      precedents: Array<{
        reference_key: string;
        case_no: string;
        court: string;
        verdict: string;
        sentence: string;
        url: string;
        confidence_score: number;
        match_reason: string;
        matched_issue_types: string[];
        matched_queries: string[];
        query_refs?: EvidenceQueryRef[];
        citation_id?: string;
        reference_id?: string;
        source_field?: string;
        snippet: string;
      }>;
    };
    decision_axis?: {
      blocked_by_scope: boolean;
      scope_block_reasons?: string[];
      evidence_strength: "high" | "medium" | "low";
      actionable_charge_count: number;
      fact_signal_count: number;
      supported_issue_count?: number;
      base_risk_level?: number;
      fact_risk_boost?: number;
    };
    selected_reference_ids?: string[];
    fact_sheet?: {
      key_points: string[];
      missing_points: string[];
      unsupported_points: string[];
      recommended_focus: string[];
    };
    charges: Array<{
      charge: string;
      basis: string;
      elements_met: string[];
      probability: "high" | "medium" | "low";
      expected_penalty: string;
      reference_library: ReferenceLibraryItem[];
      grounding?: {
        citation_id?: string;
        law_reference_id?: string;
        precedent_reference_ids?: string[];
        reference_key?: string;
        query_refs?: EvidenceQueryRef[];
        match_reason?: string;
        snippet?: EvidenceSnippet | null;
        evidence_count?: number;
      };
    }>;
    recommended_actions: string[];
    evidence_to_collect: string[];
    claim_support?: ClaimSupportSummary;
    precedent_cards: Array<{
      case_no: string;
      court: string;
      verdict: string;
      summary: string;
      similarity_score: number;
      reference_library: ReferenceLibraryItem[];
      grounding?: {
        citation_id?: string;
        reference_id?: string;
        reference_key?: string;
        query_refs?: EvidenceQueryRef[];
        match_reason?: string;
        snippet?: EvidenceSnippet | null;
        evidence_count?: number;
      };
    }>;
    disclaimer: string;
    citation_map?: EvidenceCitationMap;
    reference_library: ReferenceLibraryItem[];
    law_reference_library: ReferenceLibraryItem[];
    precedent_reference_library: ReferenceLibraryItem[];
    profile_context?: ProfileContext;
    profile_considerations?: string[];
    verifier?: {
      stage: string;
      status: string;
      evidence_sufficient: boolean;
      citation_integrity: boolean;
      contradiction_detected: boolean;
      selected_reference_count: number;
      issue_count: number;
      confidence_calibration: {
        score: number;
        label: string;
      };
      claim_support?: ClaimSupportSummary;
      warnings: string[];
    };
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
  profileSnapshot?: ProfileContext | null;
  response: Omit<KeywordVerificationResponse, "run_id">;
}
