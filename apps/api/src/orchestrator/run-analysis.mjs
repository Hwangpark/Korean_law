import { runClassifierAgent } from "../agents/classifier-agent.mjs";
import { runLawSearchAgent } from "../agents/law-search-agent.mjs";
import { runLegalAnalysisAgent } from "../agents/legal-analysis-agent.mjs";
import { runOcrAgent } from "../agents/ocr-agent.mjs";
import { runPrecedentSearchAgent } from "../agents/precedent-search-agent.mjs";

async function runStage(timeline, agent, task) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  timeline.push({
    type: "agent_start",
    agent,
    at: startedAt
  });

  const result = await task();

  timeline.push({
    type: "agent_done",
    agent,
    at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs
  });

  return result;
}

export async function runAnalysis(request, options = {}) {
  const providerMode = options.providerMode ?? process.env.LAW_PROVIDER ?? "mock";
  const timeline = [];

  const ocr = await runStage(timeline, "ocr", () => runOcrAgent(request));
  const classification = await runStage(timeline, "classifier", () => runClassifierAgent(ocr));

  const [lawSearch, precedentSearch] = await Promise.all([
    runStage(timeline, "law", () => runLawSearchAgent(classification, { providerMode })),
    runStage(timeline, "precedent", () => runPrecedentSearchAgent(classification, { providerMode }))
  ]);

  const legalAnalysis = await runStage(timeline, "analysis", () =>
    runLegalAnalysisAgent(classification, lawSearch, precedentSearch, { providerMode })
  );

  return {
    meta: {
      provider_mode: providerMode,
      generated_at: new Date().toISOString(),
      input_type: request.input_type,
      context_type: request.context_type
    },
    timeline,
    ocr,
    classification,
    law_search: lawSearch,
    precedent_search: precedentSearch,
    legal_analysis: legalAnalysis
  };
}
