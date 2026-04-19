import {
  formatConfidenceLabel,
  formatProviderSourceLabel,
  formatSupportLevel,
  formatVerifierStatus,
  getAuthoritySignal,
  getRuntimeTrustHeadline,
} from './trust-status';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(formatVerifierStatus('passed'), '검증 통과', 'passed verifier status');
assertEqual(formatVerifierStatus('warning'), '주의 신호', 'warning verifier status');
assertEqual(formatVerifierStatus('needs_caution'), '주의 필요', 'needs_caution verifier status');
assertEqual(formatVerifierStatus(''), '확인 필요', 'empty verifier status');

assertEqual(formatConfidenceLabel('high'), '높음', 'high confidence label');
assertEqual(formatConfidenceLabel('medium'), '보통', 'medium confidence label');
assertEqual(formatConfidenceLabel('low'), '낮음', 'low confidence label');
assertEqual(formatConfidenceLabel(''), '미상', 'empty confidence label');

assertEqual(formatSupportLevel('direct'), '직접 뒷받침', 'direct support label');
assertEqual(formatSupportLevel('partial'), '부분 뒷받침', 'partial support label');
assertEqual(formatSupportLevel('missing'), '근거 부족', 'missing support label');

assertEqual(formatProviderSourceLabel('live'), '실제 provider', 'live provider source label');
assertEqual(formatProviderSourceLabel('live_fallback'), 'fixture fallback', 'fallback provider source label');
assertEqual(formatProviderSourceLabel('fixture'), 'mock fixture', 'fixture provider source label');

assertEqual(
  getRuntimeTrustHeadline({ providerMode: 'mock', providerSource: 'fixture' }),
  'mock fixture 결과',
  'mock fixture provider label',
);
assertEqual(
  getRuntimeTrustHeadline({ providerMode: 'live', providerSource: 'fixture' }),
  'fixture 기준 응답',
  'live mode fixture provider label',
);
assertEqual(
  getRuntimeTrustHeadline({ providerMode: 'live', providerSource: 'live' }),
  '실제 provider 조회 결과',
  'live provider label',
);
assertEqual(
  getRuntimeTrustHeadline({ providerMode: 'live', providerSource: 'live_fallback' }),
  'fixture fallback 결과',
  'live fallback provider label',
);

assertEqual(
  getAuthoritySignal({
    evidenceSufficient: true,
    claimSupportOverall: 'direct',
    missingPointCount: 0,
    unsupportedPointCount: 0,
  }).level,
  'review_ready',
  'authority review-ready level',
);
assertEqual(
  getAuthoritySignal({
    evidenceSufficient: false,
    claimSupportOverall: 'partial',
    missingPointCount: 2,
    unsupportedPointCount: 0,
  }).label,
  '제한적 참고',
  'authority limited label',
);
assertEqual(
  getAuthoritySignal({
    handoffRecommended: true,
    abstainReasons: ['상대방 신원 확인 필요'],
    evidenceSufficient: false,
    claimSupportOverall: 'missing',
  }).level,
  'handoff',
  'authority handoff level',
);
