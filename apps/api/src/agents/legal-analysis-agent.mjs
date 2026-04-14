import { SEVERITY_TO_RISK } from "../lib/issue-catalog.mjs";

function buildElements(issueType) {
  switch (issueType) {
    case "명예훼손":
      return ["공연성 검토 필요", "사실 또는 허위사실 적시 여부", "비방 목적 검토"];
    case "협박/공갈":
      return ["해악 고지 표현 여부", "상대방 도달 가능성", "반복성 여부"];
    case "모욕":
      return ["경멸적 표현 존재", "대상 특정 가능성", "공연성 여부"];
    case "개인정보 유출":
      return ["식별 가능 정보 포함", "공개 또는 전달 행위", "정보주체 동의 여부"];
    case "스토킹":
      return ["반복성", "불안감 조성", "연락 또는 접근 행위"];
    case "사기":
      return ["기망 행위", "재산상 처분행위", "손해 발생 여부"];
    default:
      return ["추가 사실관계 확인 필요"];
  }
}

function buildActions(issueTypes) {
  const actions = [
    "원본 대화, URL, 작성 시각이 보이도록 스크린샷을 보존하세요.",
    "플랫폼 신고와 함께 삭제 전 원본 보존 조치를 먼저 하세요.",
    "피해 경위와 상대방 식별 단서를 메모로 정리하세요."
  ];

  if (issueTypes.has("개인정보 유출")) {
    actions.push("노출된 전화번호, 계정, 주소 등은 즉시 비공개 전환 및 변경을 검토하세요.");
  }

  if (issueTypes.has("스토킹") || issueTypes.has("협박/공갈")) {
    actions.push("반복 연락과 위협이 지속되면 경찰 신고와 접근 차단을 우선 검토하세요.");
  }

  if (issueTypes.has("명예훼손") || issueTypes.has("모욕")) {
    actions.push("게시글 링크, 댓글 흐름, 조회 가능 범위를 함께 수집하세요.");
  }

  return actions;
}

function buildSummary(charges) {
  return charges.length === 0
    ? "현재 fixture 기준으로 명확한 법적 쟁점이 충분히 식별되지 않았습니다."
    : `현재 입력에서는 ${charges.length}건의 주요 법적 쟁점이 탐지되었습니다.`;
}

function buildProfileConsiderations(profileContext, issueTypes) {
  const considerations = [];

  if (!profileContext) {
    return considerations;
  }

  if (profileContext.displayName) {
    considerations.push(`${profileContext.displayName} 기준으로 안내 문구를 개인화했습니다.`);
  }

  if (profileContext.ageBand || typeof profileContext.ageYears === "number") {
    const ageLabel = profileContext.ageBand || `${profileContext.ageYears}세`;
    considerations.push(`${ageLabel} 기준으로 적용되는 절차와 책임 범위를 함께 확인하세요.`);
  }

  if (profileContext.isMinor) {
    considerations.push("미성년자 관련 사안은 보호자 또는 법정대리인 개입이 필요한 절차를 별도로 검토하세요.");
  }

  if (profileContext.nationality && profileContext.nationality !== "korean") {
    considerations.push("외국인 관련 사안은 관할, 통지, 번역, 체류 정보 같은 절차 변수를 함께 확인하세요.");
  }

  if (Array.isArray(profileContext.legalNotes)) {
    for (const note of profileContext.legalNotes) {
      if (typeof note === "string" && note.trim()) {
        considerations.push(note.trim());
      }
    }
  }

  if (issueTypes.has("개인정보 유출")) {
    considerations.push("프로필 정보와 결합된 노출 여부를 별도로 확인해야 합니다.");
  }

  return Array.from(new Set(considerations));
}

function buildIssueCards(charges) {
  return charges.map((charge) => ({
    title: charge.charge,
    basis: charge.basis,
    probability: charge.probability,
    expected_penalty: charge.expected_penalty,
    checklist: charge.elements_met
  }));
}

function buildPrecedentCards(precedents) {
  return precedents.map((precedent) => ({
    case_no: precedent.case_no,
    court: precedent.court,
    verdict: precedent.verdict,
    summary: precedent.summary,
    similarity_score: precedent.similarity_score
  }));
}

export async function runLegalAnalysisAgent(
  classificationResult,
  lawSearchResult,
  precedentSearchResult,
  options = {}
) {
  const providerMode = options.providerMode ?? "mock";
  const profileContext = options.profileContext ?? options.userContext ?? null;
  const issueTypes = new Set(classificationResult.issues.map((issue) => issue.type));

  const charges = classificationResult.issues.map((issue) => {
    const matchingLaw = lawSearchResult.laws.find((law) => law.topics.includes(issue.type));
    const relatedPrecedents = precedentSearchResult.precedents
      .filter((precedent) => precedent.topics.includes(issue.type))
      .map((precedent) => precedent.case_no);

    return {
      charge: issue.charge_label,
      basis: matchingLaw ? `${matchingLaw.law_name} ${matchingLaw.article_no}` : "추가 조회 필요",
      elements_met: buildElements(issue.type),
      probability: issue.severity === "high" ? "high" : "medium",
      expected_penalty: matchingLaw?.penalty ?? "API 연동 후 구체화 예정",
      supporting_precedents: relatedPrecedents
    };
  });

  const riskLevel = charges.length === 0
    ? 1
    : Math.max(...classificationResult.issues.map((issue) => SEVERITY_TO_RISK[issue.severity] ?? 1));

  const recommendedActions = buildActions(issueTypes);
  const evidenceToCollect = [
    "원본 이미지 또는 원문 대화",
    "게시 시간과 URL 또는 방 정보",
    "반복성 입증을 위한 추가 캡처",
    "상대방 식별 가능 정보"
  ];
  const profileConsiderations = buildProfileConsiderations(profileContext, issueTypes);
  const disclaimer = providerMode === "live"
    ? "본 분석은 공식 법령 API와 판례 데이터를 참고한 안내이며 법적 효력은 없습니다. 구체적인 법률 자문은 변호사와 상담해야 합니다."
    : "본 분석은 mock 데이터에 기반한 참고용 초안이며 법적 효력이 없습니다. 구체적인 법률 자문은 변호사와 상담해야 합니다.";
  const summary = buildSummary(charges);

  return {
    mode: providerMode,
    can_sue: charges.length > 0,
    risk_level: riskLevel,
    charges,
    recommended_actions: recommendedActions,
    evidence_to_collect: evidenceToCollect,
    disclaimer,
    summary,
    issue_cards: buildIssueCards(charges),
    precedent_cards: buildPrecedentCards(precedentSearchResult.precedents),
    next_steps: recommendedActions,
    profile_context: profileContext ?? undefined,
    profile_considerations: profileConsiderations,
    share_text: `${summary} 자세한 검토 전까지는 원본 증거 보존과 플랫폼 신고 이력을 함께 정리하는 것이 좋습니다.`
  };
}
