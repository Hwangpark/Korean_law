import { loadRepoJson, uniqueBy } from "../lib/load-json.mjs";

export async function runLawSearchAgent(classificationResult, options = {}) {
  const provider = options.providerMode ?? "mock";
  const laws = await loadRepoJson("fixtures/providers/laws.json");
  const queries = new Set(
    classificationResult.issues.flatMap((issue) => [issue.type, ...issue.law_search_queries])
  );

  const matches = laws.filter((law) =>
    law.topics.some((topic) => queries.has(topic)) ||
    law.queries.some((query) =>
      [...queries].some((requested) => query.includes(requested) || requested.includes(query))
    )
  );

  return {
    provider,
    laws: uniqueBy(matches, (law) => `${law.law_name}:${law.article_no}`)
  };
}
