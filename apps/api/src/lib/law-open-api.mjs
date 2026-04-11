function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function getLawApiBaseUrl() {
  return ensureTrailingSlash(process.env.LAW_API_BASE_URL || "https://www.law.go.kr/DRF/");
}

function getLawApiKey() {
  const key = String(process.env.LAW_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("LAW_API_KEY is required for live provider mode.");
  }
  return key;
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function stripHtml(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
  );
}

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function buildApiUrl(path, params) {
  const url = new URL(path, getLawApiBaseUrl());
  url.searchParams.set("OC", getLawApiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchLawApi(path, params) {
  const url = buildApiUrl(path, params);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`law.go.kr request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (payload?.LawSearch?.resultCode && payload.LawSearch.resultCode !== "00") {
    throw new Error(payload.LawSearch.resultMsg || "law.go.kr law search failed.");
  }
  return payload;
}

function matchesLawName(entry, lawName) {
  const target = normalizeText(lawName);
  const name = normalizeText(entry?.["법령명한글"]);
  const alias = normalizeText(entry?.["법령약칭명"]);
  return name === target || alias === target || name.includes(target);
}

function findLawArticle(articleUnits, articleNo) {
  const normalizedArticleNo = String(articleNo ?? "").replace(/\s+/g, "");
  return toArray(articleUnits).find((article) =>
    String(article?.["조문내용"] ?? "").replace(/\s+/g, "").startsWith(normalizedArticleNo)
  );
}

function flattenArticle(article) {
  const parts = [];

  const push = (value) => {
    const normalized = stripHtml(value);
    if (normalized) {
      parts.push(normalized);
    }
  };

  push(article?.["조문내용"]);
  for (const hang of toArray(article?.["항"])) {
    push(hang?.["항내용"]);
    for (const ho of toArray(hang?.["호"])) {
      push(ho?.["호내용"]);
      for (const mok of toArray(ho?.["목"])) {
        push(mok?.["목내용"]);
      }
    }
  }

  return [...new Set(parts)].join("\n");
}

function extractPenalty(text, fallback = "공식 조문 확인 필요") {
  const normalized = normalizeText(text);
  const match = normalized.match(/([^.\n]*(징역|금고|벌금|구류|과료)[^.\n]*)/);
  return match?.[1] ?? fallback;
}

function derivePrecedentVerdict(detail) {
  const body = stripHtml(detail?.["판례내용"]);
  if (body.includes("무죄")) {
    return "무죄";
  }
  if (body.includes("유죄")) {
    return "유죄";
  }
  if (body.includes("상고기각")) {
    return "상고기각";
  }
  if (body.includes("파기환송")) {
    return "파기환송";
  }
  return normalizeText(detail?.["판결유형"]) || "판결";
}

function summarizePrecedent(detail) {
  const summary =
    stripHtml(detail?.["판결요지"]) ||
    stripHtml(detail?.["판시사항"]) ||
    stripHtml(detail?.["판례내용"]).slice(0, 220);
  return summary || "판례 요약을 불러오지 못했습니다.";
}

export async function fetchLawArticleByName(lawName, articleNo) {
  const searchPayload = await fetchLawApi("lawSearch.do", {
    target: "law",
    type: "JSON",
    search: 1,
    query: lawName,
    display: 20,
    page: 1
  });
  const candidates = toArray(searchPayload?.LawSearch?.law);
  const matchedLaw = candidates.find((entry) => matchesLawName(entry, lawName));
  if (!matchedLaw) {
    return null;
  }

  const detailPayload = await fetchLawApi("lawService.do", {
    target: "law",
    type: "JSON",
    MST: matchedLaw["법령일련번호"]
  });

  const lawRoot = detailPayload?.["법령"] ?? {};
  const articleUnits = lawRoot?.["조문"]?.["조문단위"] ?? [];
  const matchedArticle = findLawArticle(articleUnits, articleNo);
  if (!matchedArticle) {
    return null;
  }

  const content = flattenArticle(matchedArticle);
  return {
    law_name: lawRoot?.["기본정보"]?.["법령명_한글"] ?? matchedLaw["법령명한글"] ?? lawName,
    article_no: articleNo,
    article_title: matchedArticle["조문제목"] ?? "",
    content,
    penalty: extractPenalty(content),
    url: matchedLaw["법령상세링크"]
      ? `https://www.law.go.kr${matchedLaw["법령상세링크"]}`
      : buildApiUrl("lawService.do", {
          target: "law",
          type: "HTML",
          MST: matchedLaw["법령일련번호"]
        }).toString()
  };
}

export async function searchPrecedentsByQueries(queries, topics, limit = 3) {
  const deduped = new Map();

  for (const query of queries) {
    const payload = await fetchLawApi("lawSearch.do", {
      target: "prec",
      type: "JSON",
      search: 1,
      query,
      display: limit,
      page: 1
    });

    const items = toArray(payload?.PrecSearch?.prec);
    for (const item of items) {
      const precedentId = String(item?.["판례일련번호"] ?? "");
      if (precedentId && !deduped.has(precedentId)) {
        deduped.set(precedentId, item);
      }
      if (deduped.size >= limit * 2) {
        break;
      }
    }
  }

  const results = [];
  let rank = 0;
  for (const item of deduped.values()) {
    if (results.length >= limit) {
      break;
    }
    rank += 1;
    const precedentId = String(item?.["판례일련번호"] ?? "");
    const detail = (await fetchLawApi("lawService.do", {
      target: "prec",
      type: "JSON",
      ID: precedentId
    }))?.PrecService;

    results.push({
      case_no: detail?.["사건번호"] ?? item?.["사건번호"] ?? "사건번호 미상",
      court: detail?.["법원명"] ?? item?.["법원명"] ?? "법원 미상",
      date: detail?.["선고일자"] ?? item?.["선고일자"] ?? "",
      summary: summarizePrecedent(detail),
      verdict: derivePrecedentVerdict(detail),
      sentence: "",
      key_reasoning: stripHtml(detail?.["판시사항"]),
      similarity_score: Number(Math.max(0.45, 0.9 - (rank - 1) * 0.15).toFixed(2)),
      url: item?.["판례상세링크"]
        ? `https://www.law.go.kr${item["판례상세링크"]}`
        : buildApiUrl("lawService.do", {
            target: "prec",
            type: "HTML",
            ID: precedentId
          }).toString(),
      topics
    });
  }

  return results;
}
