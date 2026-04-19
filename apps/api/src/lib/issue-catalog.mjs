import { findMatchedKeywords, matchesKeywordText, normalizeText as normalizeSearchText } from "./abuse-patterns.mjs";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export const SUPPORTED_ISSUE_TYPES = [
  "명예훼손",
  "협박/공갈",
  "모욕",
  "개인정보 유출",
  "스토킹",
  "사기"
];

export const CONTEXT_HINTS = {
  community: ["온라인 게시글", "커뮤니티 게시판", "SNS 공개"],
  game_chat: ["게임 채팅", "음성 채팅", "길드 채팅"],
  messenger: ["메신저 대화", "카카오톡 대화", "단체대화방"],
  other: ["온라인 대화", "문자 대화"]
};

export const PROCEDURAL_KEYWORDS = [
  "항소",
  "파기",
  "파기환송",
  "상고",
  "고소장",
  "재판",
  "판결",
  "결정",
  "공판기일",
  "증거능력",
  "관할",
  "법리오해",
  "소송절차"
];

export const UNSUPPORTED_ISSUE_KEYWORDS = [
  "강간",
  "강제추행",
  "성매매",
  "불법촬영",
  "리벤지포르노",
  "업무방해",
  "상해",
  "폭행",
  "마약",
  "절도",
  "횡령",
  "배임"
];

const LABEL_ONLY_TERMS = {
  "명예훼손": ["명예훼손"],
  "협박/공갈": ["협박", "공갈"],
  "모욕": ["모욕"],
  "개인정보 유출": ["개인정보", "유출"],
  "스토킹": ["스토킹"],
  "사기": ["사기"]
};

const FRAUD_DECEPTION_TERMS = [
  "돈만 받고",
  "환불 안",
  "먹튀",
  "잠수",
  "편취",
  "기망",
  "속였",
  "속임",
  "거짓말",
  "물건 안 보내",
  "물품 안 보내",
  "못 받"
];

const FRAUD_PROPERTY_TERMS = [
  "입금",
  "송금",
  "계좌",
  "결제",
  "대금",
  "물건값",
  "물품대금",
  "물건",
  "거래",
  "보냈",
  "돈"
];

const FRAUD_ACCUSATION_TERMS = [
  "사기꾼이라고",
  "사기꾼이라",
  "사기라고",
  "사기라며",
  "먹튀라고",
  "사기범이라고",
  "사기범이라",
  "허위",
  "허위사실",
  "거짓",
  "소문",
  "비방",
  "명예훼손",
  "유포",
  "퍼뜨",
  "게시",
  "공개",
  "단톡",
  "단체방",
  "커뮤니티"
];

export const ISSUE_CATALOG = [
  {
    type: "명예훼손",
    severity: "high",
    criminal: true,
    civil: true,
    charge_label: "사이버 명예훼손",
    keywords: ["명예훼손", "허위사실", "거짓말", "유포", "게시", "퍼뜨", "사실적시", "대상 식별"],
    law_search_queries: ["명예훼손", "허위사실 적시", "형법 제307조"],
    precedent_queries: ["온라인 게시글 명예훼손", "단체대화방 허위사실 적시", "카카오톡 명예훼손"],
    precise_terms: ["공연성", "특정성", "허위사실", "사실 적시"]
  },
  {
    type: "협박/공갈",
    severity: "high",
    criminal: true,
    civil: false,
    charge_label: "협박",
    keywords: ["협박", "죽이", "가만 안 둬", "해코지", "돈 안 주면", "공갈", "가족 해", "찾아가"],
    law_search_queries: ["협박", "공갈", "형법 제283조"],
    precedent_queries: ["메신저 협박", "금전 요구 협박", "온라인 공갈"],
    precise_terms: ["해악 고지", "금전 요구", "반복 협박"]
  },
  {
    type: "모욕",
    severity: "medium",
    criminal: true,
    civil: true,
    charge_label: "모욕",
    keywords: ["모욕", "병신", "쓰레기", "개새끼", "미친", "븅신", "정신병자", "니애미", "느금마", "패드립"],
    law_search_queries: ["모욕", "형법 제311조", "공연성 모욕"],
    precedent_queries: ["게임 채팅 모욕", "온라인 모욕", "단체대화방 모욕"],
    precise_terms: ["경멸적 표현", "공연성", "특정 가능성"]
  },
  {
    type: "개인정보 유출",
    severity: "high",
    criminal: true,
    civil: true,
    charge_label: "개인정보 유출",
    keywords: ["전화번호", "실명", "주소", "주민번호", "개인정보", "신상", "학교", "회사", "사진 유포"],
    law_search_queries: ["개인정보 유출", "개인정보보호법", "신상 공개"],
    precedent_queries: ["전화번호 공개 개인정보 유출", "주소 공개 개인정보 유출", "실명 공개 개인정보보호법"],
    precise_terms: ["생계 정보", "공개 전파", "동의 없음"]
  },
  {
    type: "스토킹",
    severity: "high",
    criminal: true,
    civil: true,
    charge_label: "스토킹",
    keywords: ["스토킹", "계속 연락", "집 앞", "미행", "따라다니", "감시", "찾아오", "반복 연락"],
    law_search_queries: ["스토킹", "스토킹처벌법", "지속적 접근"],
    precedent_queries: ["반복 연락 스토킹", "주거지 방문 스토킹", "메신저 스토킹"],
    precise_terms: ["반복성", "접근", "불안감 조성"]
  },
  {
    type: "사기",
    severity: "high",
    criminal: true,
    civil: true,
    charge_label: "사기",
    keywords: ["사기", "먹튀", "돈만 받고", "잠수", "입금", "송금", "편취", "환불 안"],
    law_search_queries: ["사기", "형법 제347조", "편취"],
    precedent_queries: ["중고거래 사기", "게임 아이템 사기", "입금 후 잠수"],
    precise_terms: ["기망", "재산상 처분행위", "금전 손해"]
  }
];

export const SEVERITY_TO_RISK = {
  low: 1,
  medium: 3,
  high: 5
};

export function normalizeText(value) {
  return normalizeSearchText(value);
}

export function matchesKeyword(text, keyword) {
  return matchesKeywordText(text, keyword);
}

export function findIssueKeywords(text, keywords) {
  return findMatchedKeywords(text, keywords);
}

export function detectSignals(text) {
  return Object.fromEntries(
    ISSUE_CATALOG.map((issue) => {
      const matchedKeywords = findIssueKeywords(text, issue.keywords);
      const rawScore = matchedKeywords.length === 0
        ? 0
        : Math.min(1, 0.25 + matchedKeywords.length * 0.2);
      return [issue.type, Number(rawScore.toFixed(2))];
    }).filter(([, score]) => score > 0)
  );
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function issueDefinition(issueType) {
  return ISSUE_CATALOG.find((issue) => issue.type === issueType);
}

function factEnabled(facts, key) {
  return facts?.[key] === true;
}

function factList(facts, key) {
  return Array.isArray(facts?.[key])
    ? facts[key].map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
}

function hasFraudVictimScenario(normalizedText) {
  return hasAny(normalizedText, FRAUD_DECEPTION_TERMS) && hasAny(normalizedText, FRAUD_PROPERTY_TERMS);
}

function hasFalseFraudAccusationContext(normalizedText) {
  return hasAny(normalizedText, FRAUD_ACCUSATION_TERMS);
}

function hasStrongSignalForIssue(issueType, normalizedText, matchedTerms) {
  const matchedSet = new Set(matchedTerms);

  switch (issueType) {
    case "명예훼손":
      return hasAny(normalizedText, ["허위", "거짓", "유포", "게시", "퍼뜨", "단체방", "커뮤니티", "sns"]);
    case "협박/공갈":
      return hasAny(normalizedText, ["죽이", "해코지", "가만 안 둬", "돈 안 주면", "공갈", "입금", "송금"]);
    case "모욕":
      return matchedSet.has("병신") ||
        matchedSet.has("븅신") ||
        matchedSet.has("쓰레기") ||
        matchedSet.has("개새끼") ||
        matchedSet.has("미친") ||
        matchedSet.has("정신병자") ||
        matchedSet.has("패드립") ||
        hasAny(normalizedText, ["느금마", "니애미", "너거매"]);
    case "개인정보 유출":
      return hasAny(normalizedText, ["전화번호", "주소", "실명", "주민번호", "학교", "회사"]);
    case "스토킹":
      return hasAny(normalizedText, ["계속 연락", "반복 연락", "집 앞", "찾아오", "미행", "따라다니", "감시"]);
    case "사기":
      return hasFraudVictimScenario(normalizedText);
    default:
      return matchedTerms.length >= 2;
  }
}

function shouldSuppressProceduralHypothesis(issueType, matchedTerms, normalizedText, scopeFlags) {
  if (!scopeFlags.proceduralHeavy) {
    return false;
  }

  if (hasStrongSignalForIssue(issueType, normalizedText, matchedTerms)) {
    return false;
  }

  const labelTerms = LABEL_ONLY_TERMS[issueType] ?? [];
  const nonLabelMatches = matchedTerms.filter((term) => !labelTerms.includes(term));
  return nonLabelMatches.length === 0;
}

function shouldSuppressContextualHypothesis(issueType, matchedTerms, normalizedText) {
  if (issueType !== "사기") {
    return false;
  }

  const isFraudVictim = hasFraudVictimScenario(normalizedText);
  if (hasFalseFraudAccusationContext(normalizedText) && !isFraudVictim) {
    return true;
  }

  if (isFraudVictim) {
    return false;
  }

  const labelTerms = LABEL_ONLY_TERMS[issueType] ?? [];
  const nonLabelMatches = matchedTerms.filter((term) => !labelTerms.includes(term));
  if (nonLabelMatches.length > 0) {
    return true;
  }

  return hasAny(normalizedText, ["사기꾼", "허위", "허위사실", "거짓", "유포", "퍼뜨", "게시", "공개", "단톡", "커뮤니티", "소문", "지칭"]);
}

export function buildIssueHypotheses(text, contextType = "other") {
  const normalizedText = normalizeText(text);
  const provisionalIssueCount = ISSUE_CATALOG.reduce((count, issue) => {
    const matchedTerms = findIssueKeywords(normalizedText, issue.keywords);
    return count + (matchedTerms.length > 0 ? 1 : 0);
  }, 0);
  const scopeFlags = buildScopeFlags(normalizedText, provisionalIssueCount);

  return ISSUE_CATALOG
    .map((issue) => {
      const matchedTerms = findIssueKeywords(normalizedText, issue.keywords);
      if (matchedTerms.length === 0) {
        return null;
      }

      if (shouldSuppressProceduralHypothesis(issue.type, matchedTerms, normalizedText, scopeFlags)) {
        return null;
      }
      if (shouldSuppressContextualHypothesis(issue.type, matchedTerms, normalizedText)) {
        return null;
      }

      const confidence = Math.min(0.98, 0.35 + matchedTerms.length * 0.15);
      const contextHints = CONTEXT_HINTS[contextType] ?? CONTEXT_HINTS.other;

      return {
        type: issue.type,
        confidence: Number(confidence.toFixed(2)),
        matched_terms: matchedTerms,
        supported: true,
        reason: `${issue.type} 관련 표현(${matchedTerms.join(", ")})이 감지됐고 문맥을 ${contextHints[0]} 계열 분쟁으로 해석할 여지가 있습니다.`
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.confidence - left.confidence);
}

function makeFactHypothesis(issueType, confidence, matchedTerms, reason) {
  if (!issueDefinition(issueType)) {
    return null;
  }

  return {
    type: issueType,
    confidence: Number(confidence.toFixed(2)),
    matched_terms: unique(matchedTerms),
    supported: true,
    source: "fact",
    sources: ["fact"],
    reason
  };
}

function mergeIssueHypotheses(groups) {
  const merged = new Map();

  for (const hypothesis of groups.flat().filter(Boolean)) {
    const existing = merged.get(hypothesis.type);
    if (!existing) {
      merged.set(hypothesis.type, {
        ...hypothesis,
        sources: unique(hypothesis.sources ?? [hypothesis.source ?? "keyword"])
      });
      continue;
    }

    const sources = unique([
      ...(existing.sources ?? []),
      ...(hypothesis.sources ?? [hypothesis.source ?? "keyword"])
    ]);
    const confidence = Math.max(existing.confidence ?? 0, hypothesis.confidence ?? 0);
    merged.set(hypothesis.type, {
      ...existing,
      confidence: Number(confidence.toFixed(2)),
      matched_terms: unique([...(existing.matched_terms ?? []), ...(hypothesis.matched_terms ?? [])]),
      source: sources.includes("fact") ? "fact" : existing.source ?? hypothesis.source ?? "keyword",
      sources,
      reason: sources.includes("fact") ? existing.reason : `${existing.reason} ${hypothesis.reason}`.trim()
    });
  }

  return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
}

export function buildRuleBasedIssueHypotheses(text, contextType = "other", facts = {}) {
  const normalizedText = normalizeText(text);
  const keywordHypotheses = buildIssueHypotheses(text, contextType).map((hypothesis) => ({
    ...hypothesis,
    source: "keyword",
    sources: ["keyword"]
  }));
  const factHypotheses = [];
  const contextHints = CONTEXT_HINTS[contextType] ?? CONTEXT_HINTS.other;
  const abusiveTypes = factList(facts, "abusive_expression_types");

  if (factEnabled(facts, "public_exposure") && (factEnabled(facts, "false_fact_signal") || factEnabled(facts, "target_identifiable"))) {
    factHypotheses.push(makeFactHypothesis(
      "명예훼손",
      factEnabled(facts, "false_fact_signal") ? 0.88 : 0.78,
      unique([
        "공개 전파",
        factEnabled(facts, "false_fact_signal") ? "허위/거짓 사실 신호" : "",
        factEnabled(facts, "target_identifiable") ? "대상 특정 가능성" : ""
      ]),
      `공개 전파와 허위 또는 특정성 facts가 먼저 잡혀 ${contextHints[0]} 명예훼손 검색 가설로 확장했습니다.`
    ));
  }

  if (factEnabled(facts, "threat_signal")) {
    factHypotheses.push(makeFactHypothesis(
      "협박/공갈",
      factEnabled(facts, "money_request") ? 0.9 : 0.84,
      unique(["해악 고지", factEnabled(facts, "money_request") ? "금전 요구" : ""]),
      "해악 고지 facts가 먼저 잡혀 협박/공갈 검색 가설로 확장했습니다."
    ));
  }

  if (factEnabled(facts, "insulting_expression")) {
    factHypotheses.push(makeFactHypothesis(
      "모욕",
      factEnabled(facts, "family_directed_insult") ? 0.86 : 0.8,
      unique([
        "경멸적 표현",
        factEnabled(facts, "family_directed_insult") ? "가족비하 표현" : "",
        ...abusiveTypes
      ]),
      "욕설 단어 매칭이 아니라 경멸적 표현 또는 가족비하 흐름을 facts가 먼저 잡혀 모욕 검색 가설로 확장했습니다."
    ));
  }

  if (factEnabled(facts, "personal_info_exposed")) {
    factHypotheses.push(makeFactHypothesis(
      "개인정보 유출",
      factEnabled(facts, "public_exposure") ? 0.86 : 0.76,
      unique(["생계정보", factEnabled(facts, "public_exposure") ? "공개 전파" : ""]),
      "전화번호, 주소, 실명 등 생계정보 facts가 먼저 잡혀 개인정보 유출 검색 가설로 확장했습니다."
    ));
  }

  if (factEnabled(facts, "repeated_contact") && (
    factEnabled(facts, "direct_message") ||
    factEnabled(facts, "threat_signal") ||
    factEnabled(facts, "money_request")
  )) {
    factHypotheses.push(makeFactHypothesis(
      "스토킹",
      0.82,
      unique(["반복성", factEnabled(facts, "direct_message") ? "직접 연락" : "", factEnabled(facts, "threat_signal") ? "불안 유발 가능성" : ""]),
      "반복 연락 facts가 먼저 잡혀 스토킹 검색 가설로 확장했습니다."
    ));
  }

  if (factEnabled(facts, "money_request") && hasFraudVictimScenario(normalizedText)) {
    factHypotheses.push(makeFactHypothesis(
      "사기",
      0.84,
      ["금전 이전", "기망/잠수 신호"],
      "금전 또는 재산 이전과 기망 또는 잠수 facts가 함께 잡혀 사기 검색 가설로 확장했습니다."
    ));
  }

  return mergeIssueHypotheses([factHypotheses, keywordHypotheses]);
}

export function buildLegalElements(text, issues, facts = {}) {
  const result = {};
  const normalized = normalizeText(text);

  for (const issue of issues) {
    switch (issue.type) {
      case "명예훼손":
        result[issue.type] = {
          public_disclosure: factEnabled(facts, "public_exposure") || hasAny(normalized, ["게시", "공개", "단체방", "커뮤니티", "sns"]),
          fact_assertion: hasAny(normalized, ["허위사실", "사실", "유포", "퍼뜨"]),
          falsity_signal: factEnabled(facts, "false_fact_signal") || hasAny(normalized, ["허위", "거짓", "조작"]),
          target_identifiable: factEnabled(facts, "target_identifiable") || hasAny(normalized, ["실명", "학교", "회사", "전화번호", "주소"])
        };
        break;
      case "협박/공갈":
        result[issue.type] = {
          threat_of_harm: factEnabled(facts, "threat_signal") || hasAny(normalized, ["죽이", "해코지", "가만 안 둬", "찾아가"]),
          money_or_property_request: factEnabled(facts, "money_request") || hasAny(normalized, ["돈", "입금", "보내", "송금", "합의금"]),
          continued_pressure: factEnabled(facts, "repeated_contact") || hasAny(normalized, ["계속", "반복", "또 연락", "지속"])
        };
        break;
      case "모욕":
        result[issue.type] = {
          insulting_expression: factEnabled(facts, "insulting_expression") || hasAny(normalized, ["병신", "쓰레기", "개새끼", "미친"]),
          family_directed_insult: factEnabled(facts, "family_directed_insult"),
          public_disclosure: factEnabled(facts, "public_exposure") || hasAny(normalized, ["단체방", "커뮤니티", "게시", "공개"]),
          target_identifiable: factEnabled(facts, "target_identifiable") || hasAny(normalized, ["실명", "닉네임", "학교", "회사"])
        };
        break;
      case "개인정보 유출":
        result[issue.type] = {
          personal_identifier_present: factEnabled(facts, "personal_info_exposed") || hasAny(normalized, ["전화번호", "주소", "실명", "주민번호", "학교", "회사"]),
          public_exposure: factEnabled(facts, "public_exposure") || hasAny(normalized, ["공개", "게시", "유포", "올려"]),
          consent_signal_absent: !hasAny(normalized, ["동의", "허락"])
        };
        break;
      case "스토킹":
        result[issue.type] = {
          repeated_contact: factEnabled(facts, "repeated_contact") || hasAny(normalized, ["계속", "반복", "지속", "또 연락"]),
          contact_or_following: hasAny(normalized, ["집 앞", "찾아오", "미행", "따라다니", "감시"]),
          fear_or_anxiety: hasAny(normalized, ["무섭", "불안", "겁", "두려"])
        };
        break;
      case "사기":
        result[issue.type] = {
          deception_signal: hasAny(normalized, FRAUD_DECEPTION_TERMS),
          property_transfer: hasAny(normalized, FRAUD_PROPERTY_TERMS),
          financial_loss: hasAny(normalized, ["잠수", "환불 안", "먹튀", "못 받"])
        };
        break;
      default:
        result[issue.type] = {};
    }
  }

  return result;
}

export function buildQueryHints(issues, contextType = "other") {
  const contextHints = CONTEXT_HINTS[contextType] ?? CONTEXT_HINTS.other;
  const lawBroad = unique(issues.flatMap((issue) => issue.law_search_queries));
  const precedentBroad = unique(issues.flatMap((issue) => issue.precedent_queries));
  const lawPrecise = unique(
    issues.flatMap((issue) =>
      unique([
        ...issue.precise_terms,
        ...issue.keywords.slice(0, 3).map((term) => `${issue.type} ${term}`),
        ...contextHints.map((hint) => `${hint} ${issue.type}`)
      ])
    )
  );
  const precedentPrecise = unique(
    issues.flatMap((issue) =>
      unique([
        ...issue.precedent_queries,
        ...issue.precise_terms.map((term) => `${issue.type} ${term}`),
        ...contextHints.map((hint) => `${hint} ${issue.type}`)
      ])
    )
  );

  return {
    broad: unique([...lawBroad, ...precedentBroad]),
    precise: unique([...lawPrecise, ...precedentPrecise]),
    law: {
      broad: lawBroad,
      precise: lawPrecise
    },
    precedent: {
      broad: precedentBroad,
      precise: precedentPrecise
    }
  };
}

export function buildScopeFlags(text, issueCount) {
  const normalized = normalizeText(text);
  return {
    proceduralHeavy: hasAny(normalized, PROCEDURAL_KEYWORDS),
    insufficientFacts: normalized.length < 30 || issueCount === 0,
    unsupportedIssuePresent: hasAny(normalized, UNSUPPORTED_ISSUE_KEYWORDS)
  };
}
