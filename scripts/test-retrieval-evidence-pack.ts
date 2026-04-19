import assert from "node:assert/strict";

import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import type { AnalysisStore } from "../apps/api/src/analysis/store.js";
import { createKeywordVerificationService } from "../apps/api/src/retrieval/service.js";
import { buildRetrievalEvidencePack } from "../apps/api/src/retrieval/verification.js";
import type {
  KeywordQueryPlan,
  KeywordVerificationResponse,
  RetrievalEvidencePack,
  RetrievalTraceEvent,
  VerifiedReferenceCard
} from "../apps/api/src/retrieval/types.js";
import type { KeywordVerificationStore } from "../apps/api/src/retrieval/store.js";

type ConcreteRetrievalEvidencePack = RetrievalEvidencePack & {
  run_id: string;
  retrieval_preview: NonNullable<KeywordVerificationResponse["retrieval_preview"]>;
  retrieval_trace: RetrievalTraceEvent[];
  matched_laws: VerifiedReferenceCard[];
  matched_precedents: VerifiedReferenceCard[];
  reference_library: KeywordVerificationResponse["reference_library"];
};

function createReferenceLibraryStub(): Pick<AnalysisStore, "saveReferenceLibrary"> {
  return {
    async saveReferenceLibrary(input) {
      return buildReferenceSeeds(input.result as Record<string, unknown>, input.providerMode).map((seed) => ({
        id: seed.sourceKey,
        kind: seed.kind,
        href: `/api/references/${seed.kind}/${encodeURIComponent(seed.sourceKey)}`,
        title: seed.title,
        subtitle: seed.subtitle,
        summary: seed.summary,
        details: seed.details,
        url: seed.url,
        articleNo: seed.articleNo,
        caseNo: seed.caseNo,
        court: seed.court,
        verdict: seed.verdict,
        penalty: seed.penalty,
        similarityScore: seed.similarityScore,
        sourceMode: seed.sourceMode,
        officialSourceLabel: seed.officialSourceLabel,
        authorityTier: seed.authorityTier,
        referenceDate: seed.referenceDate,
        freshnessStatus: seed.freshnessStatus,
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }));
    }
  };
}

function createKeywordStoreStub(): KeywordVerificationStore {
  return {
    async ensureSchema() {
      return;
    },
    async saveRun() {
      return "evidence-pack-run-id";
    }
  };
}

function getRetrievalEvidencePack(
  response: KeywordVerificationResponse
): ConcreteRetrievalEvidencePack | null {
  return response.retrieval_evidence_pack as ConcreteRetrievalEvidencePack | null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractChargeIndex(statementPath: string): number | null {
  const match = /^legal_analysis\.charges\[(\d+)\]$/.exec(statementPath);
  return match ? Number(match[1]) : null;
}

function assertNoCitationPointsPastIssueChargeSpace(response: KeywordVerificationResponse): void {
  const pack = getRetrievalEvidencePack(response);
  assert.ok(pack, "expected retrieval evidence pack.");

  const issueTypes = unique(
    response.plan.candidate_issues
      .map((issue) => String(issue.type ?? "").trim())
      .filter(Boolean)
  );
  const chargeSpaceSize = issueTypes.length;

  for (const citation of pack.citation_map.citations) {
    const chargeIndex = extractChargeIndex(citation.statement_path);
    if (chargeIndex === null) {
      continue;
    }
    assert.ok(
      chargeIndex < chargeSpaceSize,
      `citation ${citation.citation_id} points outside issue charge space: ${citation.statement_path}`
    );
  }

  for (const statementPath of Object.keys(pack.citation_map.by_statement_path)) {
    const chargeIndex = extractChargeIndex(statementPath);
    if (chargeIndex === null) {
      continue;
    }
    assert.ok(
      chargeIndex < chargeSpaceSize,
      `citation index contains non-existent issue charge path: ${statementPath}`
    );
  }
}

function assertCurrentRetrievalPrecursors(response: KeywordVerificationResponse): void {
  assert.equal(response.run_id, "evidence-pack-run-id", "keyword verification should remain run-scoped");
  assert.ok(response.retrieval_preview?.law, "current response should expose law retrieval preview");
  assert.ok(response.retrieval_preview?.precedent, "current response should expose precedent retrieval preview");
  assert.ok(Array.isArray(response.retrieval_trace), "current response should expose retrieval trace");
  assert.ok((response.retrieval_trace?.length ?? 0) >= 2, "retrieval trace should include at least planner/search stages");
  assert.ok(response.matched_laws.length > 0, "current response should expose matched law cards");
  assert.ok(response.matched_precedents.length > 0, "current response should expose matched precedent cards");
  assert.ok(
    response.reference_library.items.length >= response.matched_laws.length + response.matched_precedents.length,
    "reference library should cover the matched retrieval references"
  );
  assert.ok(response.legal_analysis.verifier, "keyword verification response should expose pre-analysis verifier metadata");
}

function assertPackIsolation(response: KeywordVerificationResponse, pack: ConcreteRetrievalEvidencePack): void {
  assert.equal("verification" in (pack as unknown as Record<string, unknown>), false, "evidence pack must not embed verification payload");
  assert.equal("legal_analysis" in (pack as unknown as Record<string, unknown>), false, "evidence pack must not embed legal analysis payload");
  assert.equal("law_reference_library" in (pack as unknown as Record<string, unknown>), false, "evidence pack must not embed split law reference libraries");
  assert.equal("precedent_reference_library" in (pack as unknown as Record<string, unknown>), false, "evidence pack must not embed split precedent reference libraries");
  assert.deepEqual(pack.query, response.query, "evidence pack should snapshot the top-level query");
  assert.deepEqual(pack.plan, response.plan, "evidence pack should snapshot the top-level plan");
  assert.deepEqual(pack.retrieval_preview, response.retrieval_preview, "evidence pack should snapshot retrieval previews");
  assert.deepEqual(pack.retrieval_trace, response.retrieval_trace, "evidence pack should snapshot retrieval trace");
  assert.deepEqual(pack.matched_laws, response.matched_laws, "evidence pack should snapshot matched_laws");
  assert.deepEqual(pack.matched_precedents, response.matched_precedents, "evidence pack should snapshot matched_precedents");
  assert.deepEqual(pack.reference_library, response.reference_library, "evidence pack should snapshot reference_library");
}

function assertLegalAnalysisCitationCoverage(response: KeywordVerificationResponse): void {
  const citationMap = response.legal_analysis.citation_map;
  assert.ok(citationMap, "legal_analysis should expose citation_map");
  assert.equal(citationMap.version, "v2", "legal_analysis citation_map should keep v2 contract");

  const verifier = response.legal_analysis.verifier;
  assert.ok(verifier, "legal_analysis should include verifier snapshot");
  assert.equal(verifier.stage, "pre_analysis_verifier", "verifier should expose the pre-analysis stage name");
  assert.equal(
    verifier.selected_reference_count,
    response.retrieval_evidence_pack.selected_reference_ids.length,
    "verifier should count the same selected references as the retrieval evidence pack"
  );
  assert.equal(
    verifier.issue_count,
    response.plan.candidate_issues.length,
    "verifier should track the same candidate issue count as the response plan"
  );
  assert.equal(
    verifier.evidence_sufficient,
    response.legal_analysis.grounding_evidence?.evidence_strength !== "low",
    "verifier evidence sufficiency should stay aligned with grounding evidence strength for well-scoped fixtures"
  );

  const summaryCitations = citationMap.citations.filter((citation) => citation.statement_path === "legal_analysis.summary");
  assert.ok(summaryCitations.length > 0, "summary should retain at least one supporting citation");
  assert.ok(
    citationMap.by_statement_path["legal_analysis.summary"]?.length,
    "citation_map should index legal_analysis.summary"
  );

  for (const [index, _card] of response.legal_analysis.charges.entries()) {
    const statementPath = `legal_analysis.issue_cards[${index}]`;
    const issueCardCitations = citationMap.citations.filter((citation) => citation.statement_path === statementPath);
    assert.ok(issueCardCitations.length > 0, `issue card ${index} should retain supporting citations`);
    assert.ok(
      issueCardCitations.every((citation) => citation.statement_type === "issue_card"),
      `issue card ${index} citations should be tagged as issue_card`
    );
    assert.ok(citationMap.by_statement_path[statementPath]?.length, `citation_map should index ${statementPath}`);
  }
}

function assertEvidencePackContract(response: KeywordVerificationResponse): void {
  const pack = getRetrievalEvidencePack(response);
  assert.ok(pack, "expected KeywordVerificationResponse.retrieval_evidence_pack to exist.");

  assertPackIsolation(response, pack);

  assert.equal(pack.run_id, response.run_id, "evidence pack should carry the same run_id as the parent response");
  assert.equal(pack.version, "v2", "evidence pack should expose the v2 citation contract");
  assert.equal(
    pack.evidence_strength,
    response.legal_analysis.grounding_evidence?.evidence_strength,
    "evidence pack and legal analysis should agree on evidence strength"
  );
  assert.equal(
    pack.top_issue_types[0] ?? null,
    response.legal_analysis.grounding_evidence?.top_issue ?? null,
    "evidence pack and legal analysis should agree on the top issue"
  );
  assert.deepEqual(
    pack.selected_reference_ids,
    [...new Set([
      ...pack.matched_laws.map((item) => item.referenceKey),
      ...pack.matched_precedents.map((item) => item.referenceKey)
    ])],
    "selected reference ids should match the unique matched reference keys"
  );

  const referenceIds = new Set(pack.reference_library.items.map((item) => item.id));
  for (const referenceId of pack.selected_reference_ids) {
    assert.ok(referenceIds.has(referenceId), "reference library should cover every selected reference id");
  }

  for (const item of [...pack.matched_laws, ...pack.matched_precedents]) {
    assert.equal(item.referenceKey, item.reference.id, "matched card referenceKey should stay aligned with reference id");
    assert.ok(Array.isArray(item.matchedQueries), "matched cards should keep matched query provenance");
    assert.ok(item.matchedQueries.length > 0, "matched cards should include at least one matched query");
    assert.ok(Array.isArray(item.querySourceTags), "matched cards should expose query source tags");
    assert.ok(item.snippet?.text?.length, "matched cards should expose a selected evidence snippet");
  }

  assert.ok(pack.citation_map, "evidence pack v2 should expose a citation_map");
  assert.equal(pack.citation_map.version, "v2", "citation_map should carry its own schema version");
  assert.equal(
    pack.citation_map.citations.length,
    pack.matched_laws.length + pack.matched_precedents.length,
    "citation_map should contain one citation per selected reference card"
  );

  for (const citation of pack.citation_map.citations) {
    assert.ok(pack.selected_reference_ids.includes(citation.reference_id), "citation should point at a selected reference id");
    assert.equal(citation.reference_id, citation.reference_key, "citation should carry both reference_id and reference_key aliases");
    assert.ok(citation.statement_path.startsWith("legal_analysis."), "citation should link to a legal analysis statement path");
    assert.ok(citation.match_reason.length > 0, "citation should retain match_reason");
    assert.ok(citation.snippet?.text?.length, "citation should retain snippet provenance");
    assert.ok(Array.isArray(citation.query_refs), "citation should retain structured query refs");
    assert.ok(citation.query_refs.length > 0, "citation should retain at least one query ref");
    assert.ok(
      pack.citation_map.by_reference_id[citation.reference_id]?.includes(citation.citation_id),
      "citation_map should index citations by reference id"
    );
    assert.ok(
      pack.citation_map.by_statement_path[citation.statement_path]?.includes(citation.citation_id),
      "citation_map should index citations by statement path"
    );
  }

  const citationById = new Map(pack.citation_map.citations.map((item) => [item.citation_id, item]));
  for (const charge of response.legal_analysis.charges) {
    const citationId = charge.grounding?.citation_id;
    assert.ok(citationId, "each charge should keep a grounding citation id");
    const citation = citationById.get(citationId);
    assert.ok(citation, "charge grounding should link to an existing citation");
    assert.equal(charge.grounding?.citation_id, citation.citation_id, "charge grounding should link to citation_map");
    assert.equal(charge.grounding?.law_reference_id, citation.reference_id, "charge grounding should link to law reference");
    assert.ok(charge.grounding?.query_refs?.length, "charge grounding should retain query refs");
  }

  for (const [index, card] of response.legal_analysis.precedent_cards.entries()) {
    const citation = pack.citation_map.citations.find((item) => item.statement_path === `legal_analysis.precedent_cards[${index}]`);
    assert.ok(citation, "each precedent card should have a citation");
    assert.equal(card.grounding?.citation_id, citation.citation_id, "precedent grounding should link to citation_map");
    assert.equal(card.grounding?.reference_id, citation.reference_id, "precedent grounding should link to precedent reference");
    assert.ok(card.grounding?.query_refs?.length, "precedent grounding should retain query refs");
  }

  for (const law of response.legal_analysis.grounding_evidence?.laws ?? []) {
    assert.ok(law.citation_id, "grounding law should carry citation_id");
    assert.ok(law.reference_id, "grounding law should carry reference_id");
    assert.ok(law.query_refs?.length, "grounding law should carry query_refs");
    assert.ok(law.source_field, "grounding law should carry snippet source field");
  }

  for (const precedent of response.legal_analysis.grounding_evidence?.precedents ?? []) {
    assert.ok(precedent.citation_id, "grounding precedent should carry citation_id");
    assert.ok(precedent.reference_id, "grounding precedent should carry reference_id");
    assert.ok(precedent.query_refs?.length, "grounding precedent should carry query_refs");
    assert.ok(precedent.source_field, "grounding precedent should carry snippet source field");
  }

  assert.ok(
    pack.retrieval_trace.some((event) => Array.isArray(event.query_refs) && event.query_refs.length > 0),
    "retrieval trace should keep structured query_refs"
  );

  assert.deepEqual(
    response.legal_analysis.reference_library.map((item) => item.id),
    response.reference_library.items.map((item) => item.id),
    "top-level and legal-analysis reference libraries should stay aligned"
  );

  assertNoCitationPointsPastIssueChargeSpace(response);
}

function createReference(id: string, kind: "law" | "precedent") {
  return {
    id,
    kind,
    href: `/api/references/${kind}/${id}`,
    title: id,
    subtitle: id,
    summary: id,
    details: id,
    sourceMode: "mock",
    keywords: [],
    caseId: null,
    runId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function createLawCard(id: string, issueType: string): VerifiedReferenceCard {
  return {
    id,
    referenceKey: id,
    kind: "law",
    title: id,
    subtitle: id,
    summary: id,
    confidenceScore: 0.82,
    matchReason: `${issueType} match`,
    querySourceTags: ["query_source=legal_element"],
    matchedQueries: [{
      text: issueType,
      bucket: "precise",
      channel: "law",
      sources: ["legal_element"],
      issue_types: [issueType]
    }],
    matchedIssueTypes: [issueType],
    snippet: {
      field: "content",
      text: `${issueType} snippet`
    },
    source: {},
    reference: createReference(id, "law")
  };
}

function createMixedIssuePlan(): KeywordQueryPlan {
  return {
    originalQuery: "mixed defamation privacy",
    normalizedQuery: "mixed defamation privacy",
    contextType: "messenger",
    tokens: [],
    candidateIssues: [
      {
        type: "명예훼손",
        severity: "medium",
        matchedTerms: [],
        lawQueries: [],
        precedentQueries: [],
        reason: "defamation issue",
        querySources: ["llm"]
      },
      {
        type: "개인정보 유출",
        severity: "medium",
        matchedTerms: [],
        lawQueries: [],
        precedentQueries: [],
        reason: "privacy issue",
        querySources: ["llm"]
      }
    ],
    broadLawQueries: [],
    preciseLawQueries: [],
    broadPrecedentQueries: [],
    precisePrecedentQueries: [],
    lawQueries: [],
    precedentQueries: [],
    warnings: [],
    supportedIssues: ["명예훼손", "개인정보 유출"],
    unsupportedIssues: [],
    scopeWarnings: [],
    scopeFlags: {
      proceduralHeavy: false,
      insufficientFacts: false,
      unsupportedIssuePresent: false
    }
  };
}

function assertMixedDefamationPrivacyCitationContract(): void {
  const plan = createMixedIssuePlan();
  const matchedLaws = [
    createLawCard("law-defamation-1", "명예훼손"),
    createLawCard("law-defamation-2", "명예훼손"),
    createLawCard("law-privacy-1", "개인정보 유출")
  ];
  const pack = buildRetrievalEvidencePack({
    plan,
    retrievalPreview: {
      law: null,
      precedent: null
    },
    retrievalTrace: [],
    matchedLaws,
    matchedPrecedents: [],
    referenceLibraryItems: matchedLaws.map((law) => law.reference)
  }) as ConcreteRetrievalEvidencePack;

  const issueTypes = unique(plan.candidateIssues.map((issue) => issue.type));
  const lawCitations = pack.citation_map.citations.filter((citation) => citation.kind === "law");
  assert.ok(lawCitations.length > issueTypes.length, "regression fixture should have more law cards than issue charges");
  const statementPaths = lawCitations.map((citation) => citation.statement_path);

  assert.deepEqual(
    statementPaths,
    [
      "legal_analysis.charges[0]",
      "legal_analysis.charges[0]",
      "legal_analysis.charges[1]"
    ],
    "mixed law citations should align by issue charge path, not raw law-card order"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(pack.citation_map.by_statement_path, "legal_analysis.charges[2]"),
    false,
    "citation map must not create a charge path for the third law card"
  );

  const chargeStatementPaths = lawCitations
    .map((citation) => citation.statement_path)
    .filter((path) => path.startsWith("legal_analysis.charges["));
  assert.ok(
    new Set(chargeStatementPaths).size <= issueTypes.length,
    "law citations should collapse onto issue-aligned charge paths instead of raw law-card order"
  );
}

async function main(): Promise<void> {
  assertMixedDefamationPrivacyCitationContract();

  const service = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore: createReferenceLibraryStub() as AnalysisStore,
    keywordStore: createKeywordStoreStub()
  });

  const response = await service.verifyKeyword({
    query: "카카오톡 단톡방에 허위사실을 유포하고 전화번호를 공개했다",
    contextType: "messenger",
    limit: 3
  });

  assertCurrentRetrievalPrecursors(response);
  assertEvidencePackContract(response);
  assertLegalAnalysisCitationCoverage(response);

  process.stdout.write("Retrieval evidence pack checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
