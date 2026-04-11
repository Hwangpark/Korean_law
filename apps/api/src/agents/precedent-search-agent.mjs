import { searchPrecedentsByQueries } from "../lib/law-open-api.mjs";
import { loadRepoJson } from "../lib/load-json.mjs";

export async function runPrecedentSearchAgent(classificationResult, options = {}) {
  const provider = options.providerMode ?? "mock";
  const topics = new Set(classificationResult.issues.map((issue) => issue.type));

  if (provider === "live") {
    const queries = classificationResult.issues.flatMap((issue) => [
      issue.type,
      ...issue.law_search_queries
    ]);
    const precedents = await searchPrecedentsByQueries(queries, [...topics], 3);

    return {
      provider,
      precedents
    };
  }

  const precedents = await loadRepoJson("fixtures/providers/precedents.json");

  const matches = precedents
    .map((precedent) => {
      const overlap = precedent.topics.filter((topic) => topics.has(topic));
      const similarity = topics.size === 0 ? 0 : overlap.length / topics.size;

      return {
        ...precedent,
        similarity_score: Number(similarity.toFixed(2))
      };
    })
    .filter((precedent) => precedent.similarity_score > 0)
    .sort((left, right) => right.similarity_score - left.similarity_score)
    .slice(0, 3);

  return {
    provider,
    precedents: matches
  };
}
