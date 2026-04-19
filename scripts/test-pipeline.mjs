import assert from "node:assert/strict";

import { loadJson } from "../apps/api/src/lib/load-json.mjs";
import { fromRepo } from "../apps/api/src/lib/paths.mjs";
import { runAnalysis } from "../apps/api/src/orchestrator/run-analysis.mjs";

async function runCase(relativePath) {
  const request = await loadJson(fromRepo(relativePath));
  return runAnalysis(request, { providerMode: "mock" });
}

async function main() {
  const textResult = await runCase("fixtures/requests/sample-community.json");
  assert.ok(textResult.classification.issues.length >= 2, "text fixture should detect multiple issues");
  assert.ok(textResult.classification.facts, "classification should expose facts");
  assert.ok(textResult.classification.signals, "classification should expose signal detection output");
  assert.ok(Array.isArray(textResult.classification.issue_hypotheses), "classification should expose issue hypotheses");
  assert.ok(textResult.classification.query_hints?.law?.precise?.length >= 1, "classification should expose precise law query hints");
  assert.equal(typeof textResult.classification.scope_flags?.proceduralHeavy, "boolean", "classification should expose scope flags");
  assert.ok(Array.isArray(textResult.classification.supported_issues), "classification should expose supported issues");
  assert.ok(Array.isArray(textResult.classification.unsupported_issues), "classification should expose unsupported issues");
  assert.ok(Array.isArray(textResult.classification.scope_warnings), "classification should expose scope warnings");
  assert.ok(textResult.law_search.laws.length >= 2, "text fixture should map to laws");
  assert.ok(textResult.legal_analysis.disclaimer.includes("법적 효력"), "legal analysis should include disclaimer");
  assert.ok(Array.isArray(textResult.legal_analysis.issue_cards), "legal analysis should include formatted cards");
  assert.ok(textResult.verifier, "analysis result should expose pre-analysis verifier output");
  assert.ok(textResult.legal_analysis.scope_assessment, "legal analysis should expose scope assessment");
  assert.ok(textResult.legal_analysis.verifier, "legal analysis should retain verifier snapshot");
  assert.ok(textResult.legal_analysis.safety_gate, "legal analysis should expose safety gate output");
  assert.ok(textResult.legal_analysis.grounding_evidence, "legal analysis should expose grounding evidence");
  assert.ok(Array.isArray(textResult.legal_analysis.selected_reference_ids), "legal analysis should expose selected reference ids");
  assert.ok(textResult.legal_analysis.decision_axis, "legal analysis should expose aligned decision axis");
  assert.ok(textResult.legal_analysis.charges.every((charge) => Array.isArray(charge.fact_hints)), "charges should expose fact hints");
  assert.ok(Array.isArray(textResult.legal_analysis.fact_sheet?.key_points), "legal analysis should expose fact sheet key points");
  assert.ok(Array.isArray(textResult.legal_analysis.fact_sheet?.missing_points), "legal analysis should expose fact sheet missing points");
  assert.ok(textResult.meta?.retrieval_preview?.law, "analysis meta should include law retrieval preview");
  assert.ok(textResult.meta?.retrieval_preview?.precedent, "analysis meta should include precedent retrieval preview");
  assert.ok(Array.isArray(textResult.meta?.retrieval_trace), "analysis meta should include retrieval trace");
  assert.ok(textResult.meta.retrieval_trace.length >= 2, "analysis meta should include both retrieval stages");
  assert.ok(textResult.retrieval_evidence_pack, "analysis result should include retrieval evidence pack");
  assert.ok(
    Array.isArray(textResult.retrieval_evidence_pack.selected_reference_ids),
    "analysis evidence pack should include selected reference ids"
  );
  assert.equal(
    textResult.retrieval_evidence_pack.evidence_strength,
    textResult.legal_analysis.grounding_evidence.evidence_strength,
    "analysis evidence pack and legal analysis should agree on evidence strength"
  );
  assert.equal(
    textResult.retrieval_evidence_pack.top_issue_types[0] ?? null,
    textResult.legal_analysis.grounding_evidence.top_issue ?? null,
    "analysis evidence pack and legal analysis should agree on top issue"
  );
  assert.deepEqual(
    textResult.retrieval_evidence_pack.selected_reference_ids,
    textResult.legal_analysis.selected_reference_ids,
    "analysis evidence pack and legal analysis should share selected reference ids"
  );
  assert.ok(textResult.retrieval_plan.preciseLawQueries.length >= 1, "retrieval plan should keep precise law queries");
  assert.ok(textResult.retrieval_plan.precisePrecedentQueries.length >= 1, "retrieval plan should keep precise precedent queries");
  assert.ok(Array.isArray(textResult.retrieval_plan.supportedIssues), "retrieval plan should expose supported issues");
  assert.ok(Array.isArray(textResult.retrieval_plan.unsupportedIssues), "retrieval plan should expose unsupported issues");
  assert.ok(Array.isArray(textResult.retrieval_plan.scopeWarnings), "retrieval plan should expose scope warnings");
  assert.equal("report" in textResult, false, "report stage should be removed");

  const imageResult = await runCase("fixtures/requests/sample-messenger-image.json");
  assert.equal(imageResult.ocr.source_type, "messenger");
  assert.ok(imageResult.precedent_search.precedents.length >= 1, "image fixture should find precedents");

  const agentsDone = imageResult.timeline.filter((event) => event.type === "agent_done").map((event) => event.agent);
  assert.deepEqual(
    agentsDone.sort(),
    ["analysis", "classifier", "law", "ocr", "precedent"].sort(),
    "pipeline should complete every runtime agent stage"
  );
  const agentDoneEvents = imageResult.timeline.filter((event) => event.type === "agent_done");
  const classifierEvent = agentDoneEvents.find((event) => event.agent === "classifier");
  const lawEvent = agentDoneEvents.find((event) => event.agent === "law");
  const precedentEvent = agentDoneEvents.find((event) => event.agent === "precedent");
  const analysisEvent = agentDoneEvents.find((event) => event.agent === "analysis");
  assert.deepEqual(
    classifierEvent?.summary?.logical_substeps,
    ["signal_detection", "guided_extraction", "scope_filter"],
    "classifier timeline should expose logical substeps"
  );
  assert.deepEqual(
    lawEvent?.summary?.logical_substeps,
    ["retrieval_planner", "law_retrieval"],
    "law timeline should expose logical substeps"
  );
  assert.deepEqual(
    precedentEvent?.summary?.logical_substeps,
    ["retrieval_planner", "precedent_retrieval"],
    "precedent timeline should expose logical substeps"
  );
  assert.deepEqual(
    analysisEvent?.summary?.logical_substeps,
    ["evidence_rerank", "evidence_pack_builder", "pre_analysis_verifier", "grounded_analysis", "pre_output_safety_gate"],
    "analysis timeline should expose logical substeps"
  );
  assert.ok(analysisEvent?.summary?.verifier, "analysis timeline should include verifier summary");
  assert.ok(analysisEvent?.summary?.safety_gate, "analysis timeline should include safety gate summary");
  assert.ok(imageResult.law_search.retrieval_preview, "law search should expose a preview");
  assert.ok(imageResult.precedent_search.retrieval_preview, "precedent search should expose a preview");

  process.stdout.write("Mock pipeline checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
