import assert from "node:assert/strict";

import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import type { ReferenceLibraryItem } from "../apps/api/src/analysis/references.js";
import { loadRepoJson } from "../apps/api/src/lib/load-json.mjs";
import { buildKeywordQueryPlan } from "../apps/api/src/retrieval/planner.js";
import type {
  KeywordContextType,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  RetrievalTraceEvent
} from "../apps/api/src/retrieval/types.js";
import {
  buildLawVerificationCards,
  buildPrecedentVerificationCards,
  buildRetrievalEvidencePack
} from "../apps/api/src/retrieval/verification.js";

type RequestFixture = {
  context_type?: string;
  text?: string;
};

type ProviderLaw = LawDocumentRecord & {
  topics: string[];
  queries: string[];
};

type ProviderPrecedent = PrecedentDocumentRecord & {
  topics: string[];
};

async function loadRequestFixture(path: string): Promise<{ contextType: KeywordContextType; text: string }> {
  const fixture = await loadRepoJson(path) as RequestFixture;
  return {
    contextType: String(fixture.context_type ?? "other") as KeywordContextType,
    text: String(fixture.text ?? "")
  };
}

async function loadProviderLaws(): Promise<ProviderLaw[]> {
  return loadRepoJson("fixtures/providers/laws.json") as Promise<ProviderLaw[]>;
}

async function loadProviderPrecedents(): Promise<ProviderPrecedent[]> {
  return loadRepoJson("fixtures/providers/precedents.json") as Promise<ProviderPrecedent[]>;
}

function buildReferenceMap(items: Array<LawDocumentRecord | PrecedentDocumentRecord>, providerMode = "mock"): Map<string, ReferenceLibraryItem> {
  const seedInput = {
    law_search: {
      laws: items.filter((item): item is LawDocumentRecord => "law_name" in item)
    },
    precedent_search: {
      precedents: items.filter((item): item is PrecedentDocumentRecord => "case_no" in item)
    }
  };
  const seeds = buildReferenceSeeds(seedInput as Record<string, unknown>, providerMode);
  return new Map(
    seeds.map((seed) => [
      seed.sourceKey,
      {
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
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      } satisfies ReferenceLibraryItem
    ])
  );
}

function buildPlannerTrace(plan: KeywordQueryPlan): RetrievalTraceEvent {
  return {
    stage: "planner",
    tool: "build_query_plan",
    provider: "mock",
    duration_ms: 0,
    cache_hit: false,
    input_ref: `query:${plan.originalQuery}`,
    output_ref: plan.candidateIssues.map((issue) => issue.type),
    reason: `Built retrieval plan from ${plan.candidateIssues.length} candidate issues.`,
    query_refs: [
      ...(plan.lawQueryRefs ?? []),
      ...(plan.precedentQueryRefs ?? [])
    ]
  };
}

function selectLawFixtures(fixtures: ProviderLaw[], plan: KeywordQueryPlan): ProviderLaw[] {
  const issueTypes = new Set(plan.candidateIssues.map((issue) => issue.type));
  return fixtures.filter((law) => law.topics.some((topic) => issueTypes.has(topic)));
}

function selectPrecedentFixtures(fixtures: ProviderPrecedent[], plan: KeywordQueryPlan): ProviderPrecedent[] {
  const issueTypes = new Set(plan.candidateIssues.map((issue) => issue.type));
  return fixtures.filter((precedent) => precedent.topics.some((topic) => issueTypes.has(topic)));
}

async function buildVerificationArtifacts(path: string): Promise<{
  plan: KeywordQueryPlan;
  laws: ReturnType<typeof buildLawVerificationCards>;
  precedents: ReturnType<typeof buildPrecedentVerificationCards>;
  trace: RetrievalTraceEvent;
}> {
  const fixture = await loadRequestFixture(path);
  const plan = buildKeywordQueryPlan(fixture.text, fixture.contextType);
  const providerLaws = selectLawFixtures(await loadProviderLaws(), plan);
  const providerPrecedents = selectPrecedentFixtures(await loadProviderPrecedents(), plan);
  const references = buildReferenceMap([...providerLaws, ...providerPrecedents]);

  return {
    plan,
    laws: buildLawVerificationCards(plan, providerLaws, references),
    precedents: buildPrecedentVerificationCards(plan, providerPrecedents, references),
    trace: buildPlannerTrace(plan)
  };
}

async function verifySnippetEvidenceFixture(): Promise<void> {
  const { plan, laws, precedents, trace } = await buildVerificationArtifacts(
    "fixtures/requests/sample-snippet-community-defamation.json"
  );

  assert.ok(laws.length >= 1, "snippet fixture should produce at least one law card");
  assert.ok(precedents.length >= 1, "snippet fixture should produce at least one precedent card");

  const topLaw = laws[0];
  const topPrecedent = precedents[0];

  assert.ok(topLaw.matchedIssueTypes.includes("명예훼손"), "top law should stay attached to defamation");
  assert.ok(topLaw.snippet?.text?.length, "top law should expose a snippet");
  assert.ok(
    ["content", "article_title", "penalty"].includes(String(topLaw.snippet?.field ?? "")),
    "top law snippet should come from a clause-like law field"
  );
  assert.ok(topLaw.matchedQueries.length > 0, "top law should keep matched query refs");
  assert.ok(topLaw.querySourceTags?.includes("keyword"), "top law should keep query source tags");
  assert.match(topLaw.matchReason, /query_source=/, "top law match reason should expose provenance");

  assert.ok(topPrecedent.matchedIssueTypes.includes("명예훼손"), "top precedent should stay attached to defamation");
  assert.ok(topPrecedent.snippet?.text?.length, "top precedent should expose a snippet");
  assert.ok(
    ["summary", "key_reasoning", "sentence"].includes(String(topPrecedent.snippet?.field ?? "")),
    "top precedent snippet should come from a precedent summary/reasoning field"
  );
  assert.ok(topPrecedent.matchedQueries.length > 0, "top precedent should keep matched query refs");
  assert.match(topPrecedent.matchReason, /query_source=/, "top precedent match reason should expose provenance");

  assert.ok((trace.query_refs?.length ?? 0) > 0, "planner trace should carry structured query refs");
  assert.ok(
    trace.query_refs?.some((ref) => ref.channel === "law" && ref.bucket === "precise"),
    "planner trace should include precise law query refs"
  );
  assert.ok(
    trace.query_refs?.some((ref) => ref.channel === "precedent" && ref.bucket === "precise"),
    "planner trace should include precise precedent query refs"
  );

  const pack = buildRetrievalEvidencePack({
    runId: "snippet-rerank-run-id",
    plan,
    retrievalPreview: { law: null, precedent: null },
    retrievalTrace: [trace],
    matchedLaws: laws,
    matchedPrecedents: precedents
  });
  assert.equal(pack.top_issue_types[0], "명예훼손", "evidence pack should keep top issue ordering");
  assert.ok(pack.selected_reference_ids.length >= 2, "evidence pack should retain selected references");
}

async function verifyProceduralSupportedRerankFixture(): Promise<void> {
  const { plan, laws, precedents, trace } = await buildVerificationArtifacts(
    "fixtures/requests/sample-mixed-procedural-defamation.json"
  );

  assert.equal(plan.scopeFlags.proceduralHeavy, true, "mixed procedural fixture should stay procedural-heavy");
  assert.ok(laws.length >= 1, "mixed procedural fixture should still retrieve substantive laws");
  assert.ok(precedents.length >= 1, "mixed procedural fixture should still retrieve substantive precedents");
  assert.ok(laws[0].matchedIssueTypes.includes("명예훼손"), "top law should stay anchored on the supported issue");
  assert.ok(precedents[0].matchedIssueTypes.includes("명예훼손"), "top precedent should stay anchored on the supported issue");
  assert.ok(
    laws.every((card, index, cards) => index === 0 || cards[index - 1].confidenceScore >= card.confidenceScore),
    "law cards should remain confidence-sorted under procedural-heavy scope"
  );
  assert.ok(
    precedents.every((card, index, cards) => index === 0 || cards[index - 1].confidenceScore >= card.confidenceScore),
    "precedent cards should remain confidence-sorted under procedural-heavy scope"
  );
  assert.ok(
    trace.query_refs?.some((ref) => ref.issue_types?.includes("명예훼손")),
    "planner trace should keep issue-type provenance in procedural-supported cases"
  );
}

async function verifyFraudThreatOrderingFixture(): Promise<void> {
  const { plan, laws, precedents } = await buildVerificationArtifacts(
    "fixtures/requests/sample-mixed-fraud-threat.json"
  );

  assert.ok(laws.length >= 2, "fraud+threat fixture should produce multiple law candidates");
  assert.ok(precedents.length >= 1, "fraud+threat fixture should produce precedent candidates");
  assert.ok(
    laws.some((card) => card.matchedIssueTypes.includes("사기")),
    "fraud+threat fixture should surface a fraud law card"
  );
  assert.ok(
    laws.some((card) => card.matchedIssueTypes.includes("협박/공갈")),
    "fraud+threat fixture should surface a threat law card"
  );
  assert.ok(
    plan.preciseLawQueries.includes("해악 고지") && plan.preciseLawQueries.includes("금전 손해"),
    "fraud+threat plan should preserve legal-element-driven precise law queries for rerank inputs"
  );
  assert.ok(
    laws.some((card) => card.matchedQueries.some((query) => query.bucket === "precise"))
      && laws.some((card) => card.querySourceTags?.includes("keyword")),
    "fraud+threat law cards should preserve precise-query and query-source provenance"
  );
  assert.ok(
    laws.every((card, index, cards) => index === 0 || cards[index - 1].confidenceScore >= card.confidenceScore),
    "fraud+threat law cards should stay globally sorted by confidence"
  );
}

async function main(): Promise<void> {
  await verifySnippetEvidenceFixture();
  await verifyProceduralSupportedRerankFixture();
  await verifyFraudThreatOrderingFixture();

  process.stdout.write("Retrieval snippet/rerank checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
