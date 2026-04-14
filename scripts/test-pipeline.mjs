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
  assert.ok(textResult.law_search.laws.length >= 2, "text fixture should map to laws");
  assert.ok(textResult.legal_analysis.disclaimer.includes("법적 효력"), "legal analysis should include disclaimer");
  assert.ok(Array.isArray(textResult.legal_analysis.issue_cards), "legal analysis should include formatted cards");
  assert.ok(textResult.meta?.retrieval_preview?.law, "analysis meta should include law retrieval preview");
  assert.ok(textResult.meta?.retrieval_preview?.precedent, "analysis meta should include precedent retrieval preview");
  assert.ok(Array.isArray(textResult.meta?.retrieval_trace), "analysis meta should include retrieval trace");
  assert.ok(textResult.meta.retrieval_trace.length >= 2, "analysis meta should include both retrieval stages");
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
  assert.ok(imageResult.law_search.retrieval_preview, "law search should expose a preview");
  assert.ok(imageResult.precedent_search.retrieval_preview, "precedent search should expose a preview");

  process.stdout.write("Mock pipeline checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
