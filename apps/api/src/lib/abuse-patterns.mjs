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
  return normalizeText(value).replace(/[^0-9a-z가-힣]/g, "");
}

const SPECIAL_KEYWORD_RULES = {
  패드립: {
    collapsedVariants: ["패드립"],
    regexes: [
      /(?:^|[^가-힣])(?:느금|느그|니|네|너거|너네|니네|너검|니앰)(?:[\s._·ㆍ-]*)(?:엄마|어머니|애미|애비|아빠|아버지|부모|가족|앰|맘|마|매)(?:[^가-힣]|$)/u
    ]
  },
  병신: {
    collapsedVariants: ["병신", "븅신", "빙신"],
    regexes: [/(?:^|[^0-9a-z가-힣])ㅂㅅ(?:[^0-9a-z가-힣]|$)/u]
  },
  개새끼: {
    collapsedVariants: ["개새끼", "개새", "개색기", "개색끼", "개시키"],
    regexes: [/(?:개\s*(?:새|색)\s*(?:끼|기))/u]
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
