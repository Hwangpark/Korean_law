export type ProviderSource = 'fixture' | 'live' | 'live_fallback';

export type RuntimeTrustLike = {
  providerMode?: string;
  providerSource: ProviderSource;
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
