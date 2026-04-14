export async function runLawSearchAgent(retrievalPlan, options = {}) {
  const provider = options.providerMode ?? "mock";
  const retrievalTools = options.retrievalTools;

  if (!retrievalTools || typeof retrievalTools.searchLaws !== "function") {
    throw new Error("retrievalTools.searchLaws is required for law search.");
  }

  const limit = Math.max(1, Math.min(Number(options.limit ?? 4), 6));
  const result = await retrievalTools.searchLaws(limit, retrievalPlan, options.profileContext);

  return {
    provider: result.provider ?? provider,
    laws: Array.isArray(result.laws) ? result.laws : [],
    retrieval_preview: result.retrieval_preview ?? null,
    retrieval_trace: Array.isArray(result.retrieval_trace) ? result.retrieval_trace : []
  };
}
