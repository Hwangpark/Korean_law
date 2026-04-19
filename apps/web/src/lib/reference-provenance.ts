import { formatProviderSourceLabel } from './trust-status';

export function formatReferenceSourceMode(value: unknown) {
  const sourceMode = String(value ?? '').trim().toLowerCase();

  if (!sourceMode) {
    return '';
  }

  if (sourceMode === 'live' || sourceMode === 'live_fallback' || sourceMode === 'fixture' || sourceMode === 'mock') {
    return formatProviderSourceLabel(sourceMode === 'mock' ? 'fixture' : sourceMode);
  }

  return '출처 확인 필요';
}

export function formatReferenceConfidenceScore(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }

  return `${Math.round(value * 100)}%`;
}
