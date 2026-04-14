function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function collapseForMatch(value) {
  return normalizeText(value).replace(/[^0-9a-z가-힣]+/g, "");
}

const SPECIAL_KEYWORD_RULES = {
  패드립: {
    collapsedVariants: [
      "패드립",
      "니애미",
      "네애미",
      "느금마",
      "느금애미",
      "니엄마",
      "네엄마",
      "느그엄마",
      "니애비",
      "네애비",
      "느금빠",
      "니아빠",
      "네아빠"
    ],
    regexes: [
      /(?:^|[^가-힣])(?:니|네|느그|느금)\s*(?:애미|애비|엄마|아빠)(?:[^가-힣]|$)/u
    ]
  },
  병신: {
    collapsedVariants: ["병신", "븅신", "빙신"],
    regexes: []
  },
  개새: {
    collapsedVariants: ["개새", "개새끼", "개쉐", "개쉑", "개시키"],
    regexes: [/(?:개\s*(?:새|쉐|쉑|새끼|시키))/u]
  },
  정신병자: {
    collapsedVariants: ["정신병자", "정병"],
    regexes: []
  }
};

export function matchesKeywordText(text, keyword) {
  const normalizedText = normalizeText(text);
  const collapsedText = collapseForMatch(text);
  const normalizedKeyword = normalizeText(keyword);
  const collapsedKeyword = collapseForMatch(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  if (normalizedText.includes(normalizedKeyword) || collapsedText.includes(collapsedKeyword)) {
    return true;
  }

  const rule = SPECIAL_KEYWORD_RULES[normalizedKeyword];
  if (!rule) {
    return false;
  }

  if (rule.collapsedVariants.some((variant) => collapsedText.includes(collapseForMatch(variant)))) {
    return true;
  }

  return rule.regexes.some((regex) => regex.test(normalizedText));
}

export function findMatchedKeywords(text, keywords) {
  return unique(
    keywords.filter((keyword) => matchesKeywordText(text, keyword)).map((keyword) => normalizeText(keyword))
  );
}
