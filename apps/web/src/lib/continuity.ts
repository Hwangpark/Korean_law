export type ContinuityComposerMode = 'text' | 'image';
export type ContinuityContextType = 'community' | 'game_chat' | 'messenger' | 'other';

export type ContinuityDraft = {
  composerMode: ContinuityComposerMode;
  contextType: ContinuityContextType;
  text: string;
  textLength: number;
  imageName?: string | null;
  updatedAt: string;
};

type BuildContinuityDraftInput = {
  composerMode: ContinuityComposerMode;
  contextType: ContinuityContextType;
  text?: string;
  imageName?: string | null;
  updatedAt: string;
};

function normalizeTextLength(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function buildContinuityDraft(input: BuildContinuityDraftInput): ContinuityDraft {
  const text = input.composerMode === 'text' ? input.text ?? '' : '';

  return {
    composerMode: input.composerMode,
    contextType: input.contextType,
    text,
    textLength: text.length,
    imageName: input.imageName ?? null,
    updatedAt: input.updatedAt,
  };
}

export function sanitizeContinuityDraftForStorage(draft: ContinuityDraft): ContinuityDraft {
  return {
    ...draft,
    text: '',
    textLength: normalizeTextLength(draft.textLength, draft.text.length),
  };
}

export function formatContinuityDraftTitle(draft: ContinuityDraft) {
  if (draft.composerMode === 'image') {
    return draft.imageName?.trim() || '이미지 업로드 초안';
  }

  const textLength = normalizeTextLength(draft.textLength, draft.text.length);
  return textLength > 0 ? `텍스트 초안 ${textLength}자` : '텍스트 초안';
}

export function canRestoreContinuityText(draft: ContinuityDraft) {
  return draft.composerMode === 'text' && draft.text.trim().length > 0;
}
