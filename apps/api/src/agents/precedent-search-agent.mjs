export async function runPrecedentSearchAgent(retrievalPlan, options = {}) {
  const provider = options.providerMode ?? "mock";
  const retrievalTools = options.retrievalTools;

  if (!retrievalTools || typeof retrievalTools.searchPrecedents !== "function") {
    throw new Error("retrievalTools.searchPrecedents is required for precedent search.");
  }

  const limit = Math.max(1, Math.min(Number(options.limit ?? 4), 6));
  const result = await retrievalTools.searchPrecedents(limit, retrievalPlan, options.profileContext);

  return {
    provider: result.provider ?? provider,
    precedents: Array.isArray(result.precedents) ? result.precedents : [],
    retrieval_preview: result.retrieval_preview ?? null,
    retrieval_trace: Array.isArray(result.retrieval_trace) ? result.retrieval_trace : []
  };
}
