import { runClassifierAgent } from "../agents/classifier-agent.mjs";
import { runLawSearchAgent } from "../agents/law-search-agent.mjs";
import { runLegalAnalysisAgent } from "../agents/legal-analysis-agent.mjs";
import { runOcrAgent } from "../agents/ocr-agent.mjs";
import { runPrecedentSearchAgent } from "../agents/precedent-search-agent.mjs";
import { createRetrievalTools } from "../retrieval/tools.js";

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
  const userContext = options.userContext ?? request.user_context ?? null;
  const timeline = [];

  const ocr = await runStage(timeline, "ocr", () => runOcrAgent(request));
  const classification = await runStage(timeline, "classifier", () => runClassifierAgent(ocr));
  const retrievalTools = createRetrievalTools({ providerMode });
  const retrievalPlan = retrievalTools.buildAnalysisPlan(request, ocr, classification, userContext ?? undefined);

  const [lawSearch, precedentSearch] = await Promise.all([
    runStage(timeline, "law", () =>
      runLawSearchAgent(retrievalPlan, {
        providerMode,
        retrievalTools,
        profileContext: userContext ?? undefined
      })
    ),
    runStage(timeline, "precedent", () =>
      runPrecedentSearchAgent(retrievalPlan, {
        providerMode,
        retrievalTools,
        profileContext: userContext ?? undefined
      })
    )
  ]);

  const legalAnalysis = await runStage(timeline, "analysis", () =>
    runLegalAnalysisAgent(classification, lawSearch, precedentSearch, { providerMode, userContext })
  );
  const retrievalMeta = retrievalTools.buildCombinedRetrievalMeta({
    law_search: lawSearch,
    precedent_search: precedentSearch
  });

  return {
    meta: {
      provider_mode: providerMode,
      generated_at: new Date().toISOString(),
      input_type: request.input_type,
      context_type: request.context_type,
      ...(userContext ? { profile_context: userContext } : {}),
      ...retrievalMeta
    },
    timeline,
    ocr,
    classification,
    retrieval_plan: retrievalPlan,
    law_search: lawSearch,
    precedent_search: precedentSearch,
    legal_analysis: legalAnalysis
  };
}
