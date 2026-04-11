import { fetchLawArticleByName } from "../lib/law-open-api.mjs";
import { loadRepoJson, uniqueBy } from "../lib/load-json.mjs";

const OFFICIAL_LAW_NAME_ALIASES = {
  형법: "형법",
  정보통신망법: "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
  개인정보보호법: "개인정보 보호법",
  "스토킹범죄의 처벌 등에 관한 법률": "스토킹범죄의 처벌 등에 관한 법률"
};

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

  if (provider === "live") {
    const hydrated = await Promise.all(
      matches.map(async (law) => {
        try {
          const officialLawName = OFFICIAL_LAW_NAME_ALIASES[law.law_name] ?? law.law_name;
          const article = await fetchLawArticleByName(officialLawName, law.article_no);
          if (!article) {
            return {
              ...law,
              provider,
              url: law.url
            };
          }

          return {
            ...law,
            ...article,
            provider
          };
        } catch {
          return {
            ...law,
            provider
          };
        }
      })
    );

    return {
      provider,
      laws: uniqueBy(hydrated, (law) => `${law.law_name}:${law.article_no}`)
    };
  }

  return {
    provider,
    laws: uniqueBy(matches, (law) => `${law.law_name}:${law.article_no}`)
  };
}
