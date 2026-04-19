export type ProviderSource = 'fixture' | 'live' | 'live_fallback';
export type AnswerDisposition = 'direct_answer' | 'limited_answer' | 'handoff_recommended' | 'safety_first_handoff';

export type RuntimeTrustLike = {
  providerMode?: string;
  providerSource: ProviderSource;
};

export type AuthoritySignalLevel = 'review_ready' | 'limited' | 'handoff';
export type FreshnessSignalLevel = 'live' | 'fixture' | 'fallback';

export type AuthoritySignalInput = {
  answerDisposition?: AnswerDisposition | null;
  handoffRecommended?: boolean;
  abstainReasons?: string[];
  uncertaintyReasons?: string[];
  evidenceSufficient?: boolean;
  claimSupportOverall?: string | null;
  missingPointCount?: number;
  unsupportedPointCount?: number;
};

export type AuthoritySignal = {
  level: AuthoritySignalLevel;
  label: string;
  headline: string;
  description: string;
  reasons: string[];
};

export type FreshnessSignal = {
  level: FreshnessSignalLevel;
  label: string;
  headline: string;
  description: string;
};

export function formatVerifierStatus(status: string) {
  if (status === 'ready' || status === 'passed') {
    return '검증 통과';
  }
  if (status === 'warning') {
    return '주의 신호';
  }
  if (status === 'needs_caution') {
    return '주의 필요';
  }
  return status || '확인 필요';
}

export function formatConfidenceLabel(label: string) {
  if (label === 'high') {
    return '높음';
  }
  if (label === 'medium') {
    return '보통';
  }
  if (label === 'low') {
    return '낮음';
  }
  return label || '미상';
}

export function formatSupportLevel(level: string) {
  if (level === 'direct') {
    return '직접 뒷받침';
  }
  if (level === 'partial') {
    return '부분 뒷받침';
  }
  return '근거 부족';
}

export function formatProviderSourceLabel(providerSource: ProviderSource) {
  if (providerSource === 'live') {
    return '실제 provider';
  }

  if (providerSource === 'live_fallback') {
    return 'fixture fallback';
  }

  return 'mock fixture';
}

export function getRuntimeTrustHeadline(trust: RuntimeTrustLike) {
  if (trust.providerSource === 'live') {
    return `${formatProviderSourceLabel(trust.providerSource)} 조회 결과`;
  }

  if (trust.providerSource === 'live_fallback') {
    return `${formatProviderSourceLabel(trust.providerSource)} 결과`;
  }

  return trust.providerMode === 'live' ? 'fixture 기준 응답' : `${formatProviderSourceLabel('fixture')} 결과`;
}

export function getFreshnessSignal(trust: RuntimeTrustLike): FreshnessSignal {
  if (trust.providerSource === 'live') {
    return {
      level: 'live',
      label: '실시간 근거',
      headline: '실제 provider에서 조회한 근거입니다.',
      description: '그래도 결과는 참고용이며 원문과 최신 개정 여부를 함께 확인해야 합니다.',
    };
  }

  if (trust.providerSource === 'live_fallback') {
    return {
      level: 'fallback',
      label: 'fallback 근거',
      headline: 'live 요청이 fixture 근거로 대체됐습니다.',
      description: '실시간 법령·판례 조회가 아니므로 상담 또는 원문 조회 전 단계로 봐야 합니다.',
    };
  }

  return {
    level: 'fixture',
    label: trust.providerMode === 'live' ? 'fixture 대체' : 'mock 근거',
    headline: '로컬 fixture 기준으로 만든 참고 결과입니다.',
    description: '실시간 법령·판례 조회가 아니므로 최신성 확인과 전문가 검토가 필요할 수 있습니다.',
  };
}

export function getAuthoritySignal(input: AuthoritySignalInput): AuthoritySignal {
  const abstainReasons = input.abstainReasons ?? [];
  const uncertaintyReasons = input.uncertaintyReasons ?? [];
  const evidenceLimited = input.evidenceSufficient === false;
  const claimLimited = Boolean(input.claimSupportOverall && input.claimSupportOverall !== 'direct');
  const missingPointCount = input.missingPointCount ?? 0;
  const unsupportedPointCount = input.unsupportedPointCount ?? 0;
  const reasons = [
    ...abstainReasons.map((reason) => `판단 보류: ${reason}`),
    ...uncertaintyReasons.map((reason) => `추가 확인: ${reason}`),
    evidenceLimited ? '근거가 충분하지 않아 결론 강도를 낮춥니다.' : '',
    claimLimited ? `클레임 지원이 ${formatSupportLevel(input.claimSupportOverall ?? 'missing')} 상태입니다.` : '',
    missingPointCount > 0 ? `빠진 사실 ${missingPointCount}개가 있습니다.` : '',
    unsupportedPointCount > 0 ? `미확인 주장 ${unsupportedPointCount}개가 있습니다.` : '',
  ].filter((reason): reason is string => reason.length > 0);

  if (input.answerDisposition === 'safety_first_handoff') {
    return {
      level: 'handoff',
      label: '안전 우선 인계',
      headline: '법률 판단보다 안전 확보와 전문가 연결을 먼저 봐야 하는 상태입니다.',
      description: '고위험 신호가 있어 일반 안내보다 안전 조치, 증거 보존, 즉시 상담 여부 확인이 우선입니다.',
      reasons,
    };
  }

  if (input.answerDisposition === 'handoff_recommended' || input.handoffRecommended || abstainReasons.length > 0) {
    return {
      level: 'handoff',
      label: '전문가 인계 필요',
      headline: '현재 결과는 확정 판단이 아니라 전문가 검토 전 단계입니다.',
      description: '판단 보류 또는 중대한 불확실성이 있어 상담과 원자료 확인을 우선해야 합니다.',
      reasons,
    };
  }

  if (input.answerDisposition === 'limited_answer') {
    return {
      level: 'limited',
      label: '제한적 참고',
      headline: '근거가 일부 제한되어 결론을 낮은 강도로 봐야 합니다.',
      description: '누락 사실과 지원 수준을 확인하기 전에는 고소 가능성이나 책임 판단을 단정하지 않습니다.',
      reasons,
    };
  }

  if (input.answerDisposition === 'direct_answer') {
    return {
      level: 'review_ready',
      label: '근거 기반 참고',
      headline: '현재 입력과 연결 근거 안에서는 검토 가능한 상태입니다.',
      description: '그래도 본 결과는 참고용이며 법적 효력이나 전문가 의견을 대체하지 않습니다.',
      reasons,
    };
  }

  if (reasons.length > 0) {
    return {
      level: 'limited',
      label: '제한적 참고',
      headline: '근거가 일부 제한되어 결론을 낮은 강도로 봐야 합니다.',
      description: '누락 사실과 지원 수준을 확인하기 전에는 고소 가능성이나 책임 판단을 단정하지 않습니다.',
      reasons,
    };
  }

  return {
    level: 'review_ready',
    label: '근거 기반 참고',
    headline: '현재 입력과 연결 근거 안에서는 검토 가능한 상태입니다.',
    description: '그래도 본 결과는 참고용이며 법적 효력이나 전문가 의견을 대체하지 않습니다.',
    reasons: [],
  };
}
