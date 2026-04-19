function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function evaluateHighRiskEscalation({
  text = "",
  facts = {},
  issueTypes = [],
  profileContext,
  scopeAssessment
} = {}) {
  const normalizedText = normalizeText(text);
  const issueSet = new Set((issueTypes ?? []).filter(Boolean));
  const triggers = [];
  const immediateActions = [];
  const evidenceActions = [];
  const warnings = [];

  const imminentViolence = facts.threat_signal && hasAny(normalizedText, ["죽이", "살해", "해치", "칼", "찾아가", "가만안둬", "보복"]);
  const stalkingOrPursuit = facts.repeated_contact || issueSet.has("스토킹");
  const doxxing = facts.personal_info_exposed || issueSet.has("개인정보 유출");
  const sexualExposure = hasAny(normalizedText, ["불법촬영", "리벤지포르노", "성관계영상", "나체사진", "유포", "협박"]);
  const extortionExposure = issueSet.has("협박/공갈") && (facts.money_request || doxxing || sexualExposure);
  const evidenceDeletionRisk = hasAny(normalizedText, ["삭제", "지우", "지운", "폭파", "증거없애", "기록없애", "메시지회수", "증거인멸"]);
  const minorInvolved = Boolean(profileContext?.isMinor) || hasAny(normalizedText, ["미성년자", "학생", "중학생", "고등학생", "아동", "청소년"]);

  if (imminentViolence) {
    triggers.push("imminent_violence");
    warnings.push("신체 안전 위험이 의심되어 일반 정보 제공보다 즉시 안전 확보가 우선입니다.");
    immediateActions.push("지금 위험이 가까우면 즉시 112에 신고하고 안전한 장소로 이동하세요.");
  }

  if (stalkingOrPursuit && (facts.threat_signal || hasAny(normalizedText, ["집앞", "회사앞", "학교앞", "따라", "미행"]))) {
    triggers.push("stalking_escalation");
    warnings.push("반복 접근 또는 스토킹 위험이 보여 빠른 신고 검토가 필요합니다.");
    immediateActions.push("접근, 미행, 주거지 주변 대기가 이어지면 차단만 하지 말고 시간순 기록과 함께 112 신고 여부를 바로 검토하세요.");
  }

  if (sexualExposure) {
    triggers.push("sexual_exposure");
    warnings.push("성적 이미지 유포 또는 협박 의심 사안이라 더 보수적으로 대응해야 합니다.");
    immediateActions.push("성적 이미지 유포나 협박이 의심되면 링크, 계정, 대화 원본을 보존하고 즉시 신고 및 전문 상담을 검토하세요.");
  }

  if (extortionExposure) {
    triggers.push("extortion_exposure");
    immediateActions.push("추가 송금, 합의금 지급, 개인정보 추가 제공은 멈추고 원본 증거를 먼저 보존하세요.");
  }

  if (doxxing) {
    triggers.push("privacy_exposure");
    immediateActions.push("노출된 전화번호, 계정, 주소, 학교·직장 정보는 즉시 비공개 전환, 비밀번호 변경, 계정 보호 조치를 검토하세요.");
  }

  if (minorInvolved) {
    triggers.push("minor_involved");
    warnings.push("미성년자 관련 사안일 수 있어 보호자 또는 법정대리인 관여를 우선 검토해야 합니다.");
    immediateActions.push("미성년자가 관련되면 보호자 또는 법정대리인과 함께 신고, 보존, 상담 절차를 진행하는 편이 안전합니다.");
  }

  if (evidenceDeletionRisk) {
    triggers.push("evidence_deletion_risk");
    warnings.push("증거 삭제 위험이 보여 보존 조치가 시급합니다.");
    immediateActions.push("삭제 전 화면 녹화, 전체 캡처, URL, 계정 식별정보, 시간표시를 먼저 확보하세요.");
    evidenceActions.push("삭제 또는 회수 전후가 드러나는 전체 대화 캡처와 화면 녹화");
  }

  if (scopeAssessment?.unsupported_issue_present && (sexualExposure || minorInvolved)) {
    warnings.push("지원 범위를 넘어서는 고위험 요소가 있어 단정 대신 즉시 신고·전문상담 중심으로 안내해야 합니다.");
  }

  if (stalkingOrPursuit) {
    evidenceActions.push("반복 연락 횟수, 시간대, 접근 장소가 보이는 기록");
  }
  if (doxxing) {
    evidenceActions.push("노출된 개인정보 항목과 공개 범위가 한 번에 보이는 화면");
  }
  if (sexualExposure) {
    evidenceActions.push("유포 링크, 파일명, 계정 URL, 협박 문구가 함께 보이는 원본");
  }

  const emergency = triggers.some((trigger) => [
    "imminent_violence",
    "stalking_escalation",
    "sexual_exposure",
    "extortion_exposure",
    "minor_involved"
  ].includes(trigger));

  return {
    triggered: triggers.length > 0,
    emergency,
    triggers: unique(triggers),
    warnings: unique(warnings),
    immediate_actions: unique(immediateActions),
    evidence_actions: unique(evidenceActions)
  };
}
