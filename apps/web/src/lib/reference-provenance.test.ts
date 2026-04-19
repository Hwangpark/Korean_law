import { formatReferenceConfidenceScore, formatReferenceSourceMode } from './reference-provenance';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(formatReferenceSourceMode('live'), '실제 provider', 'live source mode');
assertEqual(formatReferenceSourceMode('live_fallback'), 'fixture fallback', 'live fallback source mode');
assertEqual(formatReferenceSourceMode('fixture'), 'mock fixture', 'fixture source mode');
assertEqual(formatReferenceSourceMode('mock'), 'mock fixture', 'mock source mode');
assertEqual(formatReferenceSourceMode('custom_provider'), 'custom_provider', 'unknown source mode');
assertEqual(formatReferenceSourceMode(''), '', 'empty source mode');

assertEqual(formatReferenceConfidenceScore(0.73), '73%', 'fraction confidence score');
assertEqual(formatReferenceConfidenceScore(1), '100%', 'full confidence score');
assertEqual(formatReferenceConfidenceScore(Number.NaN), '', 'invalid confidence score');
assertEqual(formatReferenceConfidenceScore('0.73'), '', 'string confidence score');
