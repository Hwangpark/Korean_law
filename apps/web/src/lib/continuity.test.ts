import {
  buildContinuityDraft,
  canRestoreContinuityText,
  formatContinuityDraftTitle,
  sanitizeContinuityDraftForStorage,
} from './continuity';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNotIncludes(actual: string, unexpected: string, label: string) {
  if (actual.includes(unexpected)) {
    throw new Error(`${label}: expected ${actual} not to include ${unexpected}`);
  }
}

const textDraft = buildContinuityDraft({
  composerMode: 'text',
  contextType: 'messenger',
  text: '홍길동 010-1234-5678 협박 대화 원문',
  updatedAt: '2026-04-19T00:00:00.000Z',
});
const storedTextDraft = sanitizeContinuityDraftForStorage(textDraft);

assertEqual(storedTextDraft.text, '', 'stored text draft redacts raw text');
assertEqual(storedTextDraft.textLength, textDraft.text.length, 'stored text draft keeps text length');
assertEqual(canRestoreContinuityText(storedTextDraft), false, 'stored text draft is not restorable without raw text');
assertEqual(canRestoreContinuityText(textDraft), true, 'in-memory text draft remains restorable');
assertEqual(
  formatContinuityDraftTitle(storedTextDraft),
  `텍스트 초안 ${textDraft.text.length}자`,
  'stored text draft title uses length only',
);
assertNotIncludes(formatContinuityDraftTitle(storedTextDraft), '010-1234-5678', 'stored text title hides phone number');
assertNotIncludes(formatContinuityDraftTitle(storedTextDraft), '홍길동', 'stored text title hides name');

const imageDraft = buildContinuityDraft({
  composerMode: 'image',
  contextType: 'community',
  imageName: 'capture.png',
  updatedAt: '2026-04-19T00:00:00.000Z',
});

assertEqual(imageDraft.text, '', 'image draft does not keep text');
assertEqual(formatContinuityDraftTitle(imageDraft), 'capture.png', 'image draft title uses image filename');
