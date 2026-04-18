import { runClassifierAgent } from "../agents/classifier-agent.mjs";
import { runLawSearchAgent } from "../agents/law-search-agent.mjs";
import { runLegalAnalysisAgent } from "../agents/legal-analysis-agent.mjs";
import { runOcrAgent } from "../agents/ocr-agent.mjs";
import { runPrecedentSearchAgent } from "../agents/precedent-search-agent.mjs";
import { buildCanonicalGroundingArtifacts } from "../analysis/grounding-pipeline.mjs";
import { createRetrievalTools } from "../retrieval/tools.js";
import { applyPreOutputSafetyGate } from "../analysis/safety-gate.mjs";

function emitTimelineEvent(timeline, event, onEvent) {
  timeline.push(event);
  if (typeof onEvent === "function") {
    onEvent(event);
  }
}

function annotateLastAgentDone(timeline, agent, summary) {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry?.type === "agent_done" && entry?.agent === agent) {
      timeline[index] = {
        ...entry,
        summary: {
          ...(entry.summary ?? {}),
          ...summary
        }
      };
      return;
    }
  }
}

async function runStage(timeline, agent, task, onEvent) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  emitTimelineEvent(timeline, {
    type: "agent_start",
    agent,
    at: startedAt
  }, onEvent);

  const result = await task();

  emitTimelineEvent(timeline, {
    type: "agent_done",
    agent,
    at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
    result
  }, onEvent);

  return result;
}

export async function runAnalysis(request, options = {}) {
  const providerMode = options.providerMode ?? process.env.LAW_PROVIDER ?? "mock";
  const userContext = options.userContext ?? request.user_context ?? null;
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
  const timeline = [];

  const ocr = await runStage(timeline, "ocr", () => runOcrAgent(request), onEvent);
  const classification = await runStage(timeline, "classifier", () => runClassifierAgent(ocr), onEvent);
  annotateLastAgentDone(timeline, "classifier", {
    logical_substeps: ["signal_detection", "guided_extraction", "scope_filter"],
    extraction: classification.extraction,
    scope_flags: classification.scope_flags,
    supported_issues: classification.supported_issues,
    unsupported_issues: classification.unsupported_issues
  });
  const retrievalTools = createRetrievalTools({ providerMode });
  const retrievalPlan = retrievalTools.buildAnalysisPlan(request, ocr, classification, userContext ?? undefined);

  const [lawSearch, precedentSearch] = await Promise.all([
    runStage(timeline, "law", () =>
      runLawSearchAgent(retrievalPlan, {
        providerMode,
        retrievalTools,
        profileContext: userContext ?? undefined
      }),
      onEvent
    ),
    runStage(timeline, "precedent", () =>
      runPrecedentSearchAgent(retrievalPlan, {
        providerMode,
        retrievalTools,
        profileContext: userContext ?? undefined
      }),
      onEvent
    )
  ]);
  annotateLastAgentDone(timeline, "law", {
    logical_substeps: ["retrieval_planner", "law_retrieval"],
    scope_flags: retrievalPlan.scopeFlags,
    supported_issues: retrievalPlan.supportedIssues,
    unsupported_issues: retrievalPlan.unsupportedIssues
  });
  annotateLastAgentDone(timeline, "precedent", {
    logical_substeps: ["retrieval_planner", "precedent_retrieval"],
    scope_flags: retrievalPlan.scopeFlags,
    supported_issues: retrievalPlan.supportedIssues,
    unsupported_issues: retrievalPlan.unsupportedIssues
  });
  const retrievalMeta = retrievalTools.buildCombinedRetrievalMeta({
    law_search: lawSearch,
    precedent_search: precedentSearch
  });
  const {
    retrievalEvidencePack,
    scopeAssessment,
    verifier
  } = await buildCanonicalGroundingArtifacts({
    providerMode,
    retrievalPlan,
    lawSearch: {
      ...lawSearch,
      retrieval_preview: retrievalMeta.retrieval_preview?.law ?? lawSearch.retrieval_preview,
      retrieval_trace: Array.isArray(retrievalMeta.retrieval_trace)
        ? retrievalMeta.retrieval_trace.filter((entry) => entry?.stage === "law")
        : lawSearch.retrieval_trace
    },
    precedentSearch: {
      ...precedentSearch,
      retrieval_preview: retrievalMeta.retrieval_preview?.precedent ?? precedentSearch.retrieval_preview,
      retrieval_trace: Array.isArray(retrievalMeta.retrieval_trace)
        ? retrievalMeta.retrieval_trace.filter((entry) => entry?.stage === "precedent")
        : precedentSearch.retrieval_trace
    },
    classificationResult: classification
  });

  const legalAnalysisDraft = await runStage(
    timeline,
    "analysis",
    () => runLegalAnalysisAgent(classification, lawSearch, precedentSearch, {
      providerMode,
      userContext,
      profileContext: userContext ?? undefined,
      retrievalPlan,
      retrievalEvidencePack,
      verifier,
      request,
      ocr
    }),
    onEvent
  );
  const { legalAnalysis, safetyGate } = applyPreOutputSafetyGate(legalAnalysisDraft, {
    verifier,
    scopeAssessment
  });
  if (legalAnalysis?.citation_map) {
    retrievalEvidencePack.citation_map = legalAnalysis.citation_map;
  }
  annotateLastAgentDone(timeline, "analysis", {
    logical_substeps: ["evidence_rerank", "evidence_pack_builder", "pre_analysis_verifier", "grounded_analysis", "pre_output_safety_gate"],
    evidence_strength: retrievalEvidencePack.evidence_strength,
    selected_reference_ids: retrievalEvidencePack.selected_reference_ids,
    verifier,
    safety_gate: safetyGate
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
    retrieval_evidence_pack: retrievalEvidencePack,
    verifier,
    legal_analysis: legalAnalysis
  };
}
