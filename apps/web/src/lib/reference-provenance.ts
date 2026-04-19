export function formatReferenceSourceMode(value: unknown) {
  const sourceMode = String(value ?? '').trim().toLowerCase();

  if (!sourceMode) {
    return '';
  }

  if (sourceMode === 'live') {
    return '실제 provider';
  }

  if (sourceMode === 'live_fallback') {
    return 'fixture fallback';
  }

  if (sourceMode === 'fixture' || sourceMode === 'mock') {
    return 'mock fixture';
  }

  return sourceMode;
}

export function formatReferenceConfidenceScore(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }

  return `${Math.round(value * 100)}%`;
}
