function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function hasIssue(issueTypes, target) {
  return issueTypes.has(target);
}

export function buildRecommendedActions({ scopeAssessment, facts = {}, issueCandidates = [], issueTypes = new Set() }) {
  const actions = [
    "원본 대화, 게시글 URL, 작성 시각이 보이는 형태로 원본을 보관해 두세요.",
    "발언 순서와 맥락이 드러나도록 앞뒤 대화까지 함께 정리해 두세요."
  ];

  if (scopeAssessment?.procedural_heavy) {
    actions.unshift("현재 입력은 절차 설명이 함께 섞여 있으니 실제 피해 사실과 발화 내용을 따로 정리해 다시 보는 편이 안전합니다.");
  }

  if (scopeAssessment?.insufficient_facts) {
    actions.push("공개 범위, 반복 여부, 허위 여부, 금전 요구 여부 같은 핵심 사실관계를 추가로 적어 주세요.");
  }

  if (facts.personal_info_exposed || hasIssue(issueTypes, "개인정보 유출")) {
    actions.push("전화번호·계정·주소처럼 노출된 정보가 있다면 즉시 비공개 전환과 차단 조치를 검토하세요.");
  }

  if (facts.threat_signal || facts.repeated_contact || hasIssue(issueTypes, "협박/공갈") || hasIssue(issueTypes, "스토킹")) {
    actions.push("반복 연락이나 위협이 이어지면 차단 전 원본을 보관하고 필요하면 신고 여부를 검토하세요.");
  }

  if (facts.public_exposure || hasIssue(issueTypes, "명예훼손") || hasIssue(issueTypes, "모욕")) {
    actions.push("게시 범위, 조회 가능 범위, 실명·닉네임 노출 여부를 함께 정리해 두세요.");
  }

  if (issueCandidates.some((issue) => issue?.legal_element_signals?.includes("public_disclosure"))) {
    actions.push("단체방·커뮤니티·게임 채팅처럼 제3자가 볼 수 있었는지 분리해서 적어 두세요.");
  }

  if (issueCandidates.some((issue) => issue?.legal_element_signals?.includes("target_identifiable"))) {
    actions.push("피해자가 누구인지 다른 사람이 알아볼 수 있었는지, 실명·닉네임·프로필 단서가 있는지 확인해 두세요.");
  }

  return unique(actions);
}

export function buildEvidenceToCollect({ scopeAssessment, facts = {}, issueCandidates = [], issueTypes = new Set() }) {
  const items = [
    "원본 캡처 또는 원문 텍스트",
    "게시·전송 시각과 URL 또는 방 이름",
    "상대방 계정명, 닉네임, 식별 가능한 프로필 정보"
  ];

  if (facts.personal_info_exposed || hasIssue(issueTypes, "개인정보 유출")) {
    items.push("노출된 개인정보 항목이 한 번에 보이는 화면");
  }

  if (facts.money_request || hasIssue(issueTypes, "사기")) {
    items.push("입금 내역, 송금 계좌, 거래 약속 내용");
  }

  if (facts.repeated_contact || facts.threat_signal || hasIssue(issueTypes, "협박/공갈") || hasIssue(issueTypes, "스토킹")) {
    items.push("반복 연락 횟수와 시간대가 보이는 기록");
  }

  if (facts.public_exposure) {
    items.push("게시 범위와 조회 가능 상태가 보이는 화면");
  }

  if (scopeAssessment?.insufficient_facts) {
    items.push("공개 범위, 반복 여부, 피해 발생 시점에 대한 추가 설명");
  }

  if (issueCandidates.some((issue) => issue?.legal_element_signals?.includes("public_disclosure"))) {
    items.push("제3자가 볼 수 있었는지 확인 가능한 방 구조 또는 게시 범위 정보");
  }

  if (issueCandidates.some((issue) => issue?.legal_element_signals?.includes("target_identifiable"))) {
    items.push("피해자를 특정할 수 있는 실명, 닉네임, 사진, 프로필 단서");
  }

  return unique(items);
}

export function buildProfileConsiderations({ profileContext, facts = {}, issueTypes = new Set() }) {
  if (!profileContext || typeof profileContext !== "object") {
    return [];
  }

  const considerations = [];

  if (profileContext.displayName) {
    considerations.push(`${String(profileContext.displayName)} 기준으로 안내 문구를 개인화했습니다.`);
  }

  if (typeof profileContext.ageYears === "number") {
    considerations.push(`${profileContext.ageYears}세 기준으로 적용 요건을 추가 확인해 보세요.`);
  } else if (profileContext.ageBand) {
    considerations.push(`${String(profileContext.ageBand)} 기준으로 적용 요건을 추가 확인해 보세요.`);
  }

  if (profileContext.isMinor) {
    considerations.push("미성년자 관련 사안일 수 있어 보호자 또는 법정대리인과 함께 확인하는 편이 안전합니다.");
  }

  if (profileContext.nationality && profileContext.nationality !== "korean") {
    considerations.push("외국인 사용자인 경우 통역, 번역, 체류 관련 추가 이슈가 있는지 함께 확인해 보세요.");
  }

  if (facts.personal_info_exposed || hasIssue(issueTypes, "개인정보 유출")) {
    considerations.push("프로필 정보까지 결합되면 개인정보 노출 범위가 더 커질 수 있습니다.");
  }

  if (Array.isArray(profileContext.legalNotes)) {
    for (const note of profileContext.legalNotes) {
      if (typeof note === "string" && note.trim()) {
        considerations.push(note.trim());
      }
    }
  }

  return unique(considerations);
}
