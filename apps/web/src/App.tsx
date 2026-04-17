import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import './styles.css';
import {
  DEFAULT_AUTH_BASE_URL,
  requestEmailCode,
  analyzeCase,
  clearStoredToken,
  verifyEmailCode,
  evaluatePasswordPolicy,
  fetchAnalysisResult,
  fetchHistory,
  fetchMe,
  getInitialAuthBaseUrl,
  getInitialGuestSession,
  loadStoredToken,
  login,
  saveGuestSession,
  saveStoredToken,
  signup,
  verifyKeyword,
  type AnalysisHistoryItem,
  type AnalyzeCaseResponse,
  type AnalyzeJobStartResponse,
  type AnalysisLegalResult,
  type AnalysisReferenceItem,
  type AuthResponse,
  type AuthUser,
  type GuestSession,
  type SignupPayload,
} from './lib/auth';
import { DetailPanel } from './components/DetailPanel';
import { RuntimeDashboard } from './components/RuntimeDashboard';
import type {
  AnalysisRunSnapshot,
  DetailGrounding,
  DetailPanelData,
  DetailQueryRef,
  DetailReference,
  RuntimeTimelineItem,
} from './types/app-ui';

const AUTH_BASE_URL = getInitialAuthBaseUrl();
const ANALYSIS_BASE_URL = import.meta.env.VITE_ANALYSIS_BASE_URL ?? AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL;
const RUNTIME_MODE = (import.meta.env.VITE_LAW_PROVIDER ?? 'mock').toLowerCase();
const RUNTIME_IS_LIVE = RUNTIME_MODE === 'live';
const RUNTIME_BADGE = RUNTIME_IS_LIVE ? 'LIVE' : 'MOCK';
const RUNTIME_NOTICE = RUNTIME_IS_LIVE
  ? 'LIVE 설정입니다. 실제 provider가 주입되지 않으면 서버가 fixture fallback을 사용할 수 있습니다.'
  : '현재 로컬 검색은 law.go.kr 실시간 조회가 아니라 mock fixture 기반입니다. 그래서 응답이 매우 빠르게 끝납니다.';

type ContextType = 'community' | 'game_chat' | 'messenger' | 'other';
type View = 'input' | 'analyzing' | 'results' | 'signup' | 'login';
type AuthMode = 'login' | 'signup';
type IconName = 'community' | 'game' | 'messenger' | 'document';

type Charge = {
  charge: string;
  basis: string;
  elements_met: string[];
  probability: 'high' | 'medium' | 'low';
  expected_penalty: string;
  grounding?: DetailGrounding | null;
  reference_library?: AnalysisReferenceItem[];
  referenceLibrary?: AnalysisReferenceItem[];
  references?: AnalysisReferenceItem[];
  [key: string]: unknown;
};

type PrecedentCard = {
  case_no: string;
  court: string;
  verdict: string;
  summary: string;
  similarity_score: number;
  grounding?: DetailGrounding | null;
  reference_library?: AnalysisReferenceItem[];
  referenceLibrary?: AnalysisReferenceItem[];
  references?: AnalysisReferenceItem[];
  [key: string]: unknown;
};

type UserProfileContext = {
  displayName?: string;
  birthDate?: string;
  gender?: string;
  nationality?: string;
  ageYears?: number;
  ageBand?: string;
  isMinor?: boolean;
  legalNotes?: string[];
  [key: string]: unknown;
};

type AnalysisResult = {
  can_sue: boolean;
  risk_level: number;
  summary: string;
  summary_grounding?: DetailGrounding | null;
  charges: Charge[];
  recommended_actions: string[];
  evidence_to_collect: string[];
  precedent_cards: PrecedentCard[];
  disclaimer: string;
  reference_library?: AnalysisReferenceItem[];
  law_reference_library?: AnalysisReferenceItem[];
  precedent_reference_library?: AnalysisReferenceItem[];
  profile_context?: UserProfileContext | null;
  profile_considerations?: string[];
  profile_guidance?: ProfileGuidance | null;
};

type AnalysisLegalResultWithProfile = AnalysisLegalResult & {
  user_profile?: UserProfileContext | null;
  profile_context?: UserProfileContext | null;
  profile_considerations?: string[];
  age_band?: string;
  age_years?: number;
  is_minor?: boolean;
};

type ProfileGuidance = {
  title: string;
  summary: string;
  items: string[];
  note?: string;
};

type PendingAnalysis = {
  inputMode: 'text' | 'image';
  contextType: ContextType;
  text?: string;
  imageFile?: File;
};

type PendingKeyword = {
  keyword: string;
  contextType: ContextType;
};

type ComposerMode = 'text' | 'image';

type AnalysisStreamEvent = {
  type?: string;
  agent?: string;
  at?: string;
  duration_ms?: number;
  result?: unknown;
  analysis?: unknown;
  message?: string;
};

function normalizeProfileContext(value: unknown): UserProfileContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const legalNotes = toTextList(value.legalNotes ?? value.legal_notes);

  const context: UserProfileContext = {
    displayName: firstText(value.displayName, value.display_name, value.name),
    birthDate: firstText(value.birthDate, value.birth_date),
    gender: firstText(value.gender),
    nationality: firstText(value.nationality),
    ageYears:
      typeof value.ageYears === 'number'
        ? value.ageYears
        : typeof value.age_years === 'number'
          ? value.age_years
          : undefined,
    ageBand: firstText(value.ageBand, value.age_band),
    isMinor:
      typeof value.isMinor === 'boolean'
        ? value.isMinor
        : typeof value.is_minor === 'boolean'
          ? value.is_minor
          : undefined,
    legalNotes: legalNotes.length > 0 ? legalNotes : undefined,
  };

  if (
    !context.displayName &&
    !context.birthDate &&
    !context.gender &&
    !context.nationality &&
    context.ageYears === undefined &&
    !context.ageBand &&
    context.isMinor === undefined &&
    (!context.legalNotes || context.legalNotes.length === 0)
  ) {
    return null;
  }

  return context;
}

function formatProfileNationality(value: string) {
  if (value === 'korean') {
    return '내국인';
  }
  if (value === 'foreign') {
    return '외국인';
  }
  return value;
}

function formatProfileGender(value: string) {
  if (value === 'male') {
    return '남성';
  }
  if (value === 'female') {
    return '여성';
  }
  return value;
}

function formatProfileAgeBand(value: string) {
  if (value === 'child') {
    return '18세 미만';
  }
  if (value === 'minor') {
    return '미성년';
  }
  if (value === 'adult') {
    return '성인';
  }
  return value;
}

function normalizeProfileGuidance(value: unknown): ProfileGuidance | null {
  if (typeof value === 'string') {
    const summary = value.trim();
    if (!summary) {
      return null;
    }

    return {
      title: '프로필 기반 안내',
      summary,
      items: [],
    };
  }

  if (Array.isArray(value)) {
    const items = toTextList(value);
    if (items.length === 0) {
      return null;
    }

    return {
      title: '프로필 기반 안내',
      summary: items[0],
      items,
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const items = toTextList(value.items ?? value.notes ?? value.legalNotes ?? value.legal_notes);
  const profileContext = normalizeProfileContext(value);
  const summary = firstText(
    value.summary,
    value.description,
    value.note,
    profileContext?.ageBand,
    typeof profileContext?.ageYears === 'number' ? `${profileContext.ageYears}세 기준으로 검토하세요.` : '',
    profileContext?.isMinor ? '미성년자 관련 절차를 우선 확인하세요.' : '',
  );
  const title = firstText(value.title, value.heading, value.label) || '프로필 기반 안내';

  if (!summary && items.length === 0 && !profileContext) {
    return null;
  }

  return {
    title,
    summary: summary || '프로필 정보를 반영한 참고 안내입니다.',
    items:
      items.length > 0
        ? items
        : profileContext
          ? [
              profileContext.displayName ? `대상자: ${profileContext.displayName}` : '',
              profileContext.birthDate ? `생년월일: ${profileContext.birthDate}` : '',
              profileContext.nationality ? `국적: ${formatProfileNationality(profileContext.nationality)}` : '',
              profileContext.gender ? `성별: ${formatProfileGender(profileContext.gender)}` : '',
            ].filter((item): item is string => item.length > 0)
          : [],
    note: firstText(value.note, value.footnote),
  };
}

const CONTEXT_OPTIONS: { value: ContextType; label: string; icon: IconName; desc: string }[] = [
  { value: 'community', label: '커뮤니티', icon: 'community', desc: '인터넷 게시글·댓글' },
  { value: 'game_chat', label: '게임 채팅', icon: 'game', desc: '인게임 채팅·메시지' },
  { value: 'messenger', label: '메신저', icon: 'messenger', desc: '카카오톡·라인 등' },
  { value: 'other', label: '기타', icon: 'document', desc: '그 외 온라인 대화' },
];

const DEMO_SCENARIOS: Array<{ title: string; contextType: ContextType; text: string }> = [
  {
    title: '커뮤니티 허위사실 유포',
    contextType: 'community',
    text: '동네 카페 게시판에 "저 사람 사기꾼이고 남의 돈 떼먹고 다닌다"는 글이 반복해서 올라왔고, 댓글로 제 실명과 직장까지 함께 적혀 퍼지고 있습니다.',
  },
  {
    title: '메신저 협박',
    contextType: 'messenger',
    text: '상대가 카카오톡으로 "오늘 안에 돈 안 보내면 네 가족 연락처랑 사진 전부 퍼뜨리겠다"라고 말했고, 욕설과 함께 여러 차례 반복했습니다.',
  },
  {
    title: '게임 채팅 모욕',
    contextType: 'game_chat',
    text: '게임 채팅에서 여러 명이 보는 자리에서 저를 향해 "정신병자, 인생 망한 사람, 사람도 아니다" 같은 표현을 계속 보냈고 닉네임과 길드명도 함께 언급했습니다.',
  },
];

const AGENT_STEPS = [
  { id: 'ocr', label: '텍스트 추출', desc: '입력 내용을 파싱합니다' },
  { id: 'classifier', label: '법적 쟁점 분류', desc: '위법 행위 유형을 식별합니다' },
  { id: 'law', label: '법령 검색', desc: '관련 조문을 조회합니다' },
  { id: 'precedent', label: '판례 검색', desc: '유사 사건을 찾습니다' },
  { id: 'analysis', label: '종합 분석', desc: '법적 판단을 생성합니다' },
];

function ScaleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v18" />
      <path d="M5 6h14" />
      <path d="M7 6l-4 7h8L7 6Z" />
      <path d="M17 6l-4 7h8l-4-7Z" />
      <path d="M8 21h8" />
    </svg>
  );
}

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M21 12.2 12.8 20a6 6 0 0 1-8.3-8.6l9.3-8.9a4 4 0 0 1 5.6 5.7l-9.2 8.8a2 2 0 0 1-2.8-2.9l8.5-8.1" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}

function ContextIcon({ name }: { name: IconName }) {
  const commonProps = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
  } as const;

  if (name === 'community') {
    return (
      <span className="context-icon">
        <svg {...commonProps}>
          <path d="M5 6.5h14" />
          <path d="M5 12h10" />
          <path d="M5 17.5h7" />
          <path d="M4 3h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8l-4 3v-3H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        </svg>
      </span>
    );
  }

  if (name === 'game') {
    return (
      <span className="context-icon">
        <svg {...commonProps}>
          <path d="M7 10h4" />
          <path d="M9 8v4" />
          <path d="M16 10h.01" />
          <path d="M18 13h.01" />
          <path d="M7.5 6h9A5.5 5.5 0 0 1 22 11.5v2A4.5 4.5 0 0 1 17.5 18c-1.3 0-2.2-.8-3-1.6A3.5 3.5 0 0 0 12 15.3a3.5 3.5 0 0 0-2.5 1.1c-.8.8-1.7 1.6-3 1.6A4.5 4.5 0 0 1 2 13.5v-2A5.5 5.5 0 0 1 7.5 6Z" />
        </svg>
      </span>
    );
  }

  if (name === 'messenger') {
    return (
      <span className="context-icon">
        <svg {...commonProps}>
          <path d="M4 11.5C4 7.9 7.6 5 12 5s8 2.9 8 6.5S16.4 18 12 18a9.4 9.4 0 0 1-2-.2L5 20l1.3-3.1A6.2 6.2 0 0 1 4 11.5Z" />
          <path d="M8 11.5h.01" />
          <path d="M12 11.5h.01" />
          <path d="M16 11.5h.01" />
        </svg>
      </span>
    );
  }

  return (
    <span className="context-icon">
      <svg {...commonProps}>
        <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v6h5" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </svg>
    </span>
  );
}

function RiskBadge({ level }: { level: number }) {
  const configs = [
    { color: 'risk-1', label: '위험 낮음' },
    { color: 'risk-2', label: '주의 필요' },
    { color: 'risk-3', label: '위험 보통' },
    { color: 'risk-4', label: '위험 높음' },
    { color: 'risk-5', label: '매우 위험' },
  ];
  const cfg = configs[(level ?? 1) - 1] ?? configs[0];
  return (
    <div className={`risk-badge ${cfg.color}`}>
      <div className="risk-gauge">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className={`risk-bar ${n <= level ? 'risk-bar-filled' : ''}`} />
        ))}
      </div>
      <span className="risk-level-num">Lv.{level}</span>
      <span className="risk-level-label">{cfg.label}</span>
    </div>
  );
}

function ProbabilityPill({ prob }: { prob: 'high' | 'medium' | 'low' }) {
  const map = {
    high: ['성립 가능성 높음', 'prob-high'],
    medium: ['성립 가능성 보통', 'prob-medium'],
    low: ['성립 가능성 낮음', 'prob-low'],
  } as const;
  const [label, cls] = map[prob] ?? map.low;
  return <span className={`prob-pill ${cls}`}>{label}</span>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = getText(value);
    if (text) {
      return text;
    }
  }
  return '';
}

function toTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => getText(item))
    .filter((item) => item.length > 0);
}

function normalizeQueryRefs(value: unknown): DetailQueryRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<DetailQueryRef[]>((items, item) => {
    if (!isRecord(item)) {
      return items;
    }

    const text = getText(item.text);
    if (!text) {
      return items;
    }

    items.push({
      text,
      bucket: firstText(item.bucket) || undefined,
      channel: firstText(item.channel) || undefined,
      sources: toTextList(item.sources),
      issueTypes: toTextList(item.issue_types ?? item.issueTypes),
      legalElementSignals: toTextList(item.legal_element_signals ?? item.legalElementSignals),
    });
    return items;
  }, []);
}

function normalizeGrounding(value: unknown): DetailGrounding | null {
  if (!isRecord(value)) {
    return null;
  }

  const snippet = isRecord(value.snippet) ? value.snippet : {};
  const evidenceCount = typeof value.evidence_count === 'number'
    ? value.evidence_count
    : typeof value.evidenceCount === 'number'
      ? value.evidenceCount
      : undefined;
  const grounding: DetailGrounding = {
    citationId: firstText(value.citation_id, value.citationId),
    lawReferenceId: firstText(value.law_reference_id, value.lawReferenceId),
    precedentReferenceIds: toTextList(value.precedent_reference_ids ?? value.precedentReferenceIds),
    referenceId: firstText(value.reference_id, value.referenceId),
    referenceKey: firstText(value.reference_key, value.referenceKey),
    matchReason: firstText(value.match_reason, value.matchReason),
    snippetField: firstText(snippet.field),
    snippetText: firstText(snippet.text),
    evidenceCount,
    queryRefs: normalizeQueryRefs(value.query_refs ?? value.queryRefs),
  };

  if (
    !grounding.citationId &&
    !grounding.lawReferenceId &&
    grounding.precedentReferenceIds.length === 0 &&
    !grounding.referenceId &&
    !grounding.referenceKey &&
    !grounding.matchReason &&
    !grounding.snippetText &&
    grounding.queryRefs.length === 0
  ) {
    return null;
  }

  return grounding;
}

function getGroundingLead(grounding?: DetailGrounding | null) {
  if (!grounding) {
    return '';
  }

  return firstText(
    grounding.matchReason,
    grounding.snippetText,
    grounding.queryRefs[0]?.text,
    grounding.citationId,
    grounding.lawReferenceId,
    grounding.referenceId,
  );
}

function getGroundingMeta(grounding?: DetailGrounding | null) {
  if (!grounding) {
    return [] as string[];
  }

  const items = [
    grounding.citationId ? `인용 ${grounding.citationId}` : '',
    grounding.lawReferenceId ? `법령 ${grounding.lawReferenceId}` : '',
    grounding.referenceId ? `판례 ${grounding.referenceId}` : '',
    grounding.precedentReferenceIds.length > 0 ? `연결 판례 ${grounding.precedentReferenceIds.length}건` : '',
    typeof grounding.evidenceCount === 'number' ? `증거 ${grounding.evidenceCount}건` : '',
  ].filter((item): item is string => item.length > 0);

  return items.slice(0, 3);
}

function normalizeReferenceItem(value: unknown): DetailReference | null {
  if (typeof value === 'string') {
    return {
      title: value.trim(),
      summary: value.trim(),
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const title = firstText(
    value.title,
    value.name,
    value.label,
    value.law_name,
    value.case_no,
    value.article_no,
    value.article,
    value.heading,
  );
  const summary = firstText(
    value.summary,
    value.details,
    value.description,
    value.note,
    value.excerpt,
    value.text,
    value.basis,
    title,
  );
  const subtitle = firstText(value.subtitle, value.court, value.verdict, value.category);
  const url = firstText(value.url, value.link, value.source_url, value.href);
  const href = firstText(value.href);
  const kind = firstText(value.kind, value.category);

  if (!title && !summary) {
    return null;
  }

  return {
    kind: kind || undefined,
    title: title || summary,
    summary: summary || title,
    subtitle: subtitle || undefined,
    url: url || undefined,
    href: href || undefined,
  };
}

function collectReferenceItems(value: unknown): DetailReference[] {
  const items: DetailReference[] = [];

  if (Array.isArray(value)) {
    value.forEach((item) => {
      const normalized = normalizeReferenceItem(item);
      if (normalized) {
        items.push(normalized);
      }
    });
    return items;
  }

  if (!isRecord(value)) {
    return items;
  }

  const nestedSources = [
    value.reference_library,
    value.referenceLibrary,
    value.references,
    value.law_reference_library,
    value.precedent_reference_library,
    value.laws,
    value.precedents,
    value.items,
  ];

  nestedSources.forEach((source) => {
    if (Array.isArray(source)) {
      source.forEach((item) => {
        const normalized = normalizeReferenceItem(item);
        if (normalized) {
          items.push(normalized);
        }
      });
    }
  });

  if (items.length === 0) {
    const normalized = normalizeReferenceItem(value);
    if (normalized) {
      items.push(normalized);
    }
  }

  return items;
}

function buildDetailPanelData(
  eyebrow: string,
  title: string,
  summary: string,
  metadata: Array<{ label: string; value: string }>,
  highlights: string[],
  referenceSource: unknown,
  provenance?: DetailGrounding | null,
): DetailPanelData {
  return {
    eyebrow,
    title,
    summary,
    metadata,
    highlights,
    references: collectReferenceItems(referenceSource),
    provenance: provenance ?? null,
  };
}

function buildChargeDetail(charge: Charge, index: number): DetailPanelData {
  return buildDetailPanelData(
    '탐지된 법적 쟁점',
    charge.charge,
    charge.basis,
    [
      { label: '성립 가능성', value: charge.probability === 'high' ? '높음' : charge.probability === 'medium' ? '보통' : '낮음' },
      { label: '예상 처벌', value: charge.expected_penalty || '추가 조회 필요' },
      { label: '우선순위', value: `#${index + 1}` },
    ],
    charge.elements_met,
    {
      reference_library: charge.reference_library,
      referenceLibrary: charge.referenceLibrary,
      references: charge.references,
    },
    charge.grounding ?? normalizeGrounding(charge.grounding),
  );
}

function buildPrecedentDetail(precedent: PrecedentCard, index: number): DetailPanelData {
  return buildDetailPanelData(
    '유사 판례',
    precedent.case_no,
    precedent.summary,
    [
      { label: '법원', value: precedent.court || '미상' },
      { label: '결론', value: precedent.verdict || '미상' },
      { label: '유사도', value: `${Math.round((precedent.similarity_score ?? 0) * 100)}%` },
      { label: '우선순위', value: `#${index + 1}` },
    ],
    [
      precedent.case_no,
      precedent.court,
      precedent.verdict,
      precedent.summary,
    ].filter((item): item is string => Boolean(item)),
    {
      reference_library: precedent.reference_library,
      referenceLibrary: precedent.referenceLibrary,
      references: precedent.references,
    },
    precedent.grounding ?? normalizeGrounding(precedent.grounding),
  );
}

function buildReferenceDetail(
  reference: AnalysisReferenceItem,
  kind: 'law' | 'precedent',
  index: number,
): DetailPanelData {
  const confidenceScore =
    typeof reference.confidence_score === 'number'
      ? reference.confidence_score
      : typeof reference.confidenceScore === 'number'
        ? reference.confidenceScore
        : null;
  const provenance = normalizeGrounding({
    ...reference,
    query_refs: reference.matchedQueryRefs ?? reference.matched_query_refs,
  });
  const title = firstText(
    reference.title,
    reference.law_name,
    reference.case_no,
    reference.label,
    reference.article_no,
  ) || (kind === 'law' ? '법령 근거' : '판례 근거');
  const summary = firstText(
    reference.summary,
    reference.details,
    reference.description,
    reference.note,
    reference.title,
    reference.law_name,
    reference.case_no,
  ) || '참고용 근거입니다.';
  const subtitle = firstText(reference.subtitle, reference.court, reference.verdict, reference.category);
  const metadata = [
    { label: '유형', value: kind === 'law' ? '법령' : '판례' },
    { label: '우선순위', value: `#${index + 1}` },
    ...(confidenceScore !== null ? [{ label: '근거 점수', value: `${Math.round(confidenceScore * 100)}%` }] : []),
  ];

  return {
    eyebrow: kind === 'law' ? '매칭 법령' : '매칭 판례',
    title,
    summary,
    metadata: subtitle ? [...metadata, { label: '출처', value: subtitle }] : metadata,
    highlights: toTextList(reference.keywords ?? reference.tags),
    references: collectReferenceItems(reference),
    provenance,
  };
}

function describeGrounding(grounding?: DetailGrounding | null) {
  if (!grounding) {
    return [] as string[];
  }

  return [
    grounding.citationId ? `인용 ${grounding.citationId}` : '',
    grounding.evidenceCount ? `증거 ${grounding.evidenceCount}건` : '',
    grounding.queryRefs.length > 0 ? `질의 ${grounding.queryRefs.length}개` : '',
  ].filter((item): item is string => item.length > 0);
}

function splitReferenceGroups(references: DetailReference[]) {
  const law = references.filter((reference) => reference.kind === 'law');
  const precedent = references.filter((reference) => reference.kind === 'precedent');

  return {
    law,
    precedent,
  };
}

function findMatchingPrecedentReferences(precedent: PrecedentCard, references: DetailReference[]) {
  const target = precedent.case_no.trim();
  if (!target) {
    return references;
  }

  const matches = references.filter((reference) =>
    reference.title.includes(target) || reference.summary.includes(target),
  );

  return matches.length > 0 ? matches : references;
}

function normalizeAnalysisResult(
  result: AnalysisLegalResultWithProfile | undefined,
  responseReferenceLibrary: DetailReference[] = [],
): AnalysisResult | null {
  if (!result) {
    return null;
  }

  const mergedTopLevelReferences = collectReferenceItems(result.reference_library);
  const mergedLawReferences = collectReferenceItems(result.law_reference_library ?? result.matched_laws);
  const mergedPrecedentReferences = collectReferenceItems(result.precedent_reference_library ?? result.matched_precedents);
  const allReferences =
    responseReferenceLibrary.length > 0
      ? responseReferenceLibrary
      : mergedTopLevelReferences;
  const splitReferences = splitReferenceGroups(allReferences);
  const lawReferences = mergedLawReferences.length > 0 ? mergedLawReferences : splitReferences.law;
  const precedentReferences =
    mergedPrecedentReferences.length > 0 ? mergedPrecedentReferences : splitReferences.precedent;
  const fallbackReferences = allReferences.length > 0 ? allReferences : [...lawReferences, ...precedentReferences];
  const profileContext =
    normalizeProfileContext(result.profile_context) ??
    normalizeProfileContext(result.user_profile) ??
    normalizeProfileContext({
      ageBand: result.age_band,
      ageYears: result.age_years,
      isMinor: result.is_minor,
    });
  const profileConsiderations = [
    ...toTextList(result.profile_considerations),
    ...toTextList(profileContext?.legalNotes),
  ];

  return {
    can_sue: Boolean(result.can_sue),
    risk_level: Number(result.risk_level ?? 0),
    summary: getText(result.summary) || '분석 결과',
    summary_grounding: normalizeGrounding((result as Record<string, unknown>).summary_grounding ?? (result as Record<string, unknown>).summaryGrounding),
    profile_guidance: normalizeProfileGuidance(
      result.profile_guidance ?? result.profile_context ?? result.user_profile,
    ),
    charges: Array.isArray(result.charges)
      ? result.charges.map((charge) => ({
          ...charge,
          charge: getText(charge.charge) || '법적 쟁점',
          basis: getText(charge.basis) || '추가 조회 필요',
          elements_met: toTextList(charge.elements_met),
          probability:
            charge.probability === 'high' || charge.probability === 'medium' || charge.probability === 'low'
              ? charge.probability
              : 'low',
          expected_penalty: getText(charge.expected_penalty) || '추가 조회 필요',
          grounding: normalizeGrounding(charge.grounding),
          reference_library: (() => {
            const local = collectReferenceItems(charge.reference_library ?? charge.referenceLibrary ?? charge.references);
            return local.length > 0 ? local : fallbackReferences;
          })(),
          referenceLibrary: (() => {
            const local = collectReferenceItems(charge.referenceLibrary ?? charge.reference_library ?? charge.references);
            return local.length > 0 ? local : fallbackReferences;
          })(),
          references: (() => {
            const local = collectReferenceItems(charge.references ?? charge.reference_library ?? charge.referenceLibrary);
            return local.length > 0 ? local : fallbackReferences;
          })(),
        }))
      : [],
    recommended_actions: Array.isArray(result.recommended_actions)
      ? result.recommended_actions.map((item) => getText(item)).filter((item) => item.length > 0)
      : [],
    evidence_to_collect: Array.isArray(result.evidence_to_collect)
      ? result.evidence_to_collect.map((item) => getText(item)).filter((item) => item.length > 0)
      : [],
    precedent_cards: Array.isArray(result.precedent_cards)
      ? result.precedent_cards.map((precedent) => {
          const normalizedPrecedent: PrecedentCard = {
            ...precedent,
            case_no: getText(precedent.case_no) || '사건번호 미상',
            court: getText(precedent.court) || '법원 미상',
            verdict: getText(precedent.verdict) || '미상',
            summary: getText(precedent.summary) || '요약 없음',
            similarity_score:
              typeof precedent.similarity_score === 'number' && !Number.isNaN(precedent.similarity_score)
                ? precedent.similarity_score
                : 0,
            grounding: normalizeGrounding(precedent.grounding),
          };

          return {
            ...normalizedPrecedent,
            reference_library: (() => {
              const local = collectReferenceItems(precedent.reference_library ?? precedent.referenceLibrary ?? precedent.references);
              return local.length > 0 ? local : findMatchingPrecedentReferences(normalizedPrecedent, precedentReferences);
            })(),
            referenceLibrary: (() => {
              const local = collectReferenceItems(precedent.referenceLibrary ?? precedent.reference_library ?? precedent.references);
              return local.length > 0 ? local : findMatchingPrecedentReferences(normalizedPrecedent, precedentReferences);
            })(),
            references: (() => {
              const local = collectReferenceItems(precedent.references ?? precedent.reference_library ?? precedent.referenceLibrary);
              return local.length > 0 ? local : findMatchingPrecedentReferences(normalizedPrecedent, precedentReferences);
            })(),
          };
        })
      : [],
    disclaimer: getText(result.disclaimer) || '본 분석은 참고용입니다.',
    reference_library: allReferences,
    law_reference_library:
      Array.isArray(result.matched_laws) && result.matched_laws.length > 0
        ? result.matched_laws
        : lawReferences,
    precedent_reference_library:
      Array.isArray(result.matched_precedents) && result.matched_precedents.length > 0
        ? result.matched_precedents
        : precedentReferences,
    profile_context: profileContext,
    profile_considerations: profileConsiderations,
  };
}

function mergeProfileResult(analysis: AnalysisResult, response: Record<string, unknown>): AnalysisResult {
  const payload = response;
  const responseProfileContext = normalizeProfileContext(payload.profile_context);
  const responseProfileGuidance = normalizeProfileGuidance(payload.profile_guidance);
  const responseProfileConsiderations = toTextList(payload.profile_considerations);

  return {
    ...analysis,
    profile_context: analysis.profile_context ?? responseProfileContext,
    profile_guidance: analysis.profile_guidance ?? responseProfileGuidance,
    profile_considerations:
      analysis.profile_considerations && analysis.profile_considerations.length > 0
        ? analysis.profile_considerations
        : responseProfileConsiderations,
  };
}

function readGuestRemaining(payload: Record<string, unknown>, fallback: number) {
  if (typeof payload.guest_remaining === 'number') {
    return Math.max(0, payload.guest_remaining);
  }

  if (
    payload.meta &&
    typeof payload.meta === 'object' &&
    typeof (payload.meta as { guest_remaining?: unknown }).guest_remaining === 'number'
  ) {
    return Math.max(0, (payload.meta as { guest_remaining: number }).guest_remaining);
  }

  return fallback;
}

function looksLikeFinalAnalysis(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    'can_sue' in value ||
    'risk_level' in value ||
    'summary' in value ||
    'charges' in value ||
    'precedent_cards' in value ||
    'disclaimer' in value ||
    'recommended_actions' in value ||
    'evidence_to_collect' in value ||
    'reference_library' in value ||
    'law_reference_library' in value ||
    'precedent_reference_library' in value
  );
}

function normalizeCompletedAnalysisResponse(response: unknown): AnalysisResult | null {
  const source = unwrapCompletedAnalysis(response);
  if (!looksLikeFinalAnalysis(source)) {
    return null;
  }

  const responseRecord = isRecord(response) ? response : {};
  const referenceSource =
    responseRecord.reference_library ??
    responseRecord.referenceLibrary ??
    responseRecord.references ??
    responseRecord.law_reference_library ??
    responseRecord.precedent_reference_library ??
    responseRecord.laws ??
    responseRecord.precedents ??
    source;

  return normalizeAnalysisResult(source as AnalysisLegalResultWithProfile, collectReferenceItems(referenceSource));
}

function unwrapCompletedAnalysis(value: unknown): unknown {
  let current = value;

  while (isRecord(current)) {
    const next = current.legal_analysis ?? current.analysis ?? current.result;
    if (!isRecord(next)) {
      break;
    }
    current = next;
  }

  return current;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지 파일을 읽는 데 실패했습니다.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function buildAnalyzeJobPayload(
  snapshot: PendingAnalysis,
  guestId: string | null,
): Promise<Parameters<typeof analyzeCase>[2]> | Parameters<typeof analyzeCase>[2] {
  if (snapshot.inputMode === 'image') {
    const imageFile = snapshot.imageFile;
    if (!imageFile) {
      throw new Error('이미지 파일이 선택되지 않았습니다.');
    }

    return (async () => {
      const imageBase64 = await fileToBase64(imageFile);
      return {
        title: imageFile.name || '이미지 분석',
        context_type: snapshot.contextType,
        input_mode: 'image',
        image_base64: imageBase64,
        image_name: imageFile.name,
        image_mime_type: imageFile.type || 'application/octet-stream',
        ...(guestId ? { guest_id: guestId } : {}),
      };
    })();
  }

  return {
    title: '텍스트 분석',
    context_type: snapshot.contextType,
    input_mode: 'text',
    text: snapshot.text?.trim() ?? '',
    ...(guestId ? { guest_id: guestId } : {}),
  };
}


function formatContextType(value: string) {
  return CONTEXT_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

function formatInputMode(value: 'text' | 'image') {
  return value === 'image' ? '이미지 OCR' : '텍스트 입력';
}

function formatKoreanDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(durationMs?: number) {
  if (!durationMs || Number.isNaN(durationMs)) {
    return '진행 중';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}초`;
}

function PolicyRule({ label, passed }: { label: string; passed: boolean }) {
  return (
    <li className={`policy-rule ${passed ? 'policy-rule-pass' : 'policy-rule-miss'}`}>
      <span className="policy-rule-state">{passed ? 'Ready' : 'Missing'}</span>
      <span>{label}</span>
    </li>
  );
}

export default function App() {
  const [view, setView] = useState<View>('input');
  const [composerMode, setComposerMode] = useState<ComposerMode>('text');
  const [text, setText] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [contextType, setContextType] = useState<ContextType>('community');
  const [agentProgress, setAgentProgress] = useState<string[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<DetailPanelData | null>(null);
  const [keywordText, setKeywordText] = useState('');
  const [keywordResult, setKeywordResult] = useState<AnalysisResult | null>(null);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [selectedKeywordDetail, setSelectedKeywordDetail] = useState<DetailPanelData | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryItem[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [runtimeTimeline, setRuntimeTimeline] = useState<RuntimeTimelineItem[]>(
    AGENT_STEPS.map((step) => ({
      agentId: step.id,
      label: step.label,
      description: step.desc,
      status: 'pending',
    })),
  );
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<AnalysisRunSnapshot | null>(null);

  const [session, setSession] = useState<{ user: AuthUser; token: string } | null>(null);
  const [guestSession, setGuestSession] = useState<GuestSession>(() => getInitialGuestSession());

  const [authMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [pendingKeyword, setPendingKeyword] = useState<PendingKeyword | null>(null);

  const [signupName, setSignupName] = useState('');
  const [signupBirthday, setSignupBirthday] = useState('');
  const [signupGender, setSignupGender] = useState<'male' | 'female' | null>(null);
  const [signupNationality, setSignupNationality] = useState<'korean' | 'foreign'>('korean');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // email verification flow
  const [verifyStep, setVerifyStep] = useState<'idle' | 'sending' | 'sent' | 'verified'>('idle');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyTimer, setVerifyTimer] = useState(0);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyInfo, setVerifyInfo] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const analysisStreamRef = useRef<EventSource | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const detailPanelRef = useRef<HTMLElement | null>(null);
  const keywordDetailPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveGuestSession(guestSession);
  }, [guestSession]);

  useEffect(() => {
    if (verifyTimer <= 0) return;
    const id = window.setTimeout(() => setVerifyTimer((t) => t - 1), 1000);
    return () => window.clearTimeout(id);
  }, [verifyTimer]);

  useEffect(() => {
    const token = loadStoredToken();
    if (!token) {
      return;
    }

    let active = true;
    fetchMe(AUTH_BASE_URL, token)
      .then((response) => {
        if (!active) {
          return;
        }

        setSession({ user: response.user, token });
      })
      .catch(() => {
        if (!active) {
          return;
        }

        clearStoredToken();
        setSession(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      const currentStream = analysisStreamRef.current;
      if (currentStream) {
        currentStream.close();
      }
      analysisStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!session?.token) {
      setAnalysisHistory([]);
      return;
    }

    let active = true;
    setHistoryBusy(true);
    fetchHistory(ANALYSIS_BASE_URL, session.token)
      .then((items) => {
        if (active) {
          setAnalysisHistory(items);
        }
      })
      .catch(() => {
        if (active) {
          setAnalysisHistory([]);
        }
      })
      .finally(() => {
        if (active) {
          setHistoryBusy(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session?.token]);

  useEffect(() => {
    setSelectedDetail(null);
  }, [result]);

  useEffect(() => {
    setSelectedKeywordDetail(null);
  }, [keywordResult]);

  useEffect(() => {
    if (!selectedDetail || window.innerWidth > 960) {
      return;
    }

    window.setTimeout(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [selectedDetail]);

  useEffect(() => {
    if (!selectedKeywordDetail) {
      return;
    }

    window.setTimeout(() => {
      keywordDetailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [selectedKeywordDetail]);

  const passwordPolicy = evaluatePasswordPolicy(authPassword);
  const canUseGuest = guestSession.guestRemaining > 0;
  const provenanceSummary = result
    ? [
        result.summary_grounding?.citationId ? `요약 인용 ${result.summary_grounding.citationId}` : '',
        result.law_reference_library?.length ? `법령 ${result.law_reference_library.length}건` : '',
        result.precedent_reference_library?.length ? `판례 ${result.precedent_reference_library.length}건` : '',
      ].filter((item): item is string => item.length > 0)
    : [];

  function closeAnalysisStream() {
    const currentStream = analysisStreamRef.current;
    if (currentStream) {
      currentStream.close();
    }
    analysisStreamRef.current = null;
  }

  function resetRuntimeTimeline() {
    setRuntimeTimeline(
      AGENT_STEPS.map((step) => ({
        agentId: step.id,
        label: step.label,
        description: step.desc,
        status: 'pending',
      })),
    );
  }

  function markTimelineStep(agentId: string, next: Partial<RuntimeTimelineItem>) {
    setRuntimeTimeline((prev) =>
      prev.map((step) => (step.agentId === agentId ? { ...step, ...next } : step)),
    );
  }

  function syncGuestQuota(payload: Record<string, unknown>, token: string | null) {
    if (token) {
      return;
    }

    setGuestSession((prev) => ({
      guestId:
        typeof payload.guest_id === 'string'
          ? payload.guest_id
          : payload.meta &&
              typeof payload.meta === 'object' &&
              typeof (payload.meta as { guest_id?: unknown }).guest_id === 'string'
            ? ((payload.meta as { guest_id: string }).guest_id)
            : prev.guestId,
      guestRemaining: readGuestRemaining(payload, prev.guestRemaining),
    }));
  }

  function applyCompletedAnalysis(response: unknown, token: string | null) {
    const analysis = normalizeCompletedAnalysisResponse(response);
    if (!analysis) {
      throw new Error('분석 결과를 불러오지 못했습니다.');
    }

    const responseRecord = isRecord(response) ? response : {};
    syncGuestQuota(responseRecord, token);
    setActiveAgentId(null);
    setResult(mergeProfileResult(analysis, responseRecord));
    setPendingAnalysis(null);
    setView('results');
    setAnalysisHistory((prev) => prev);
    if (token) {
      void fetchHistory(ANALYSIS_BASE_URL, token)
        .then((items) => setAnalysisHistory(items))
        .catch(() => undefined);
    }
  }

  function openLoginPage(errorMessage?: string) {
    setAuthError(errorMessage ?? null);
    setAuthEmail('');
    setAuthPassword('');
    setView('login');
  }

  function handleLogout() {
    clearStoredToken();
    setSession(null);
    setAuthError(null);
  }

  async function runAnalysis(snapshot: PendingAnalysis, token: string | null) {
    setAnalysisError(null);
    setAgentProgress([]);
    setActiveAgentId(null);
    setActiveJobId(null);
    setCurrentRun({
      inputMode: snapshot.inputMode,
      contextType: snapshot.contextType,
      submittedAt: new Date().toISOString(),
      textLength: snapshot.text?.trim().length ?? 0,
      imageName: snapshot.imageFile?.name,
    });
    resetRuntimeTimeline();
    setView('analyzing');
    setAuthError(null);
    closeAnalysisStream();

    try {
      const payload = await buildAnalyzeJobPayload(snapshot, token ? null : guestSession.guestId);
      const startResponse = (await analyzeCase(ANALYSIS_BASE_URL, token, payload as Parameters<typeof analyzeCase>[2])) as AnalyzeJobStartResponse;

      syncGuestQuota(startResponse as Record<string, unknown>, token);

      const jobId = typeof startResponse.job_id === 'string' ? startResponse.job_id : '';
      if (!jobId) {
        throw new Error('분석 작업 ID를 받지 못했습니다.');
      }
      setActiveJobId(jobId);

      const streamPath =
        typeof startResponse.stream_url === 'string' && startResponse.stream_url
          ? startResponse.stream_url
          : `/api/analyze/${encodeURIComponent(jobId)}/stream`;
      const streamUrl = /^https?:\/\//i.test(streamPath)
        ? streamPath
        : `${ANALYSIS_BASE_URL.replace(/\/+$/, '')}${streamPath.startsWith('/') ? '' : '/'}${streamPath}`;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const stream = new EventSource(streamUrl);
        analysisStreamRef.current = stream;

        const closeStream = () => {
          stream.close();
          if (analysisStreamRef.current === stream) {
            analysisStreamRef.current = null;
          }
        };

        const failStream = async (fallbackMessage?: string) => {
          if (settled) {
            return;
          }

          try {
            const response = await fetchAnalysisResult(ANALYSIS_BASE_URL, jobId);
            if (normalizeCompletedAnalysisResponse(response)) {
              settled = true;
              closeStream();
              applyCompletedAnalysis(response, token);
              resolve();
              return;
            }
          } catch {
            // Ignore fallback fetch failures and surface the original stream issue below.
          }

          settled = true;
          closeStream();
          reject(new Error(fallbackMessage ?? '분석 스트림 연결 중 오류가 발생했습니다.'));
        };

        stream.addEventListener('agent_start', (event) => {
          if (!(event instanceof MessageEvent)) {
            return;
          }

          try {
            const payload = JSON.parse(event.data) as AnalysisStreamEvent;
            if (typeof payload.agent === 'string') {
              const startedAt = typeof payload.at === 'string' ? payload.at : new Date().toISOString();
              setActiveAgentId(payload.agent);
              markTimelineStep(payload.agent, { status: 'active', startedAt });
            }
          } catch {
            // Ignore malformed stream payloads.
          }
        });

        stream.addEventListener('agent_done', (event) => {
          if (!(event instanceof MessageEvent)) {
            return;
          }

          try {
            const payload = JSON.parse(event.data) as AnalysisStreamEvent;
            if (typeof payload.agent === 'string') {
              const finishedAt = typeof payload.at === 'string' ? payload.at : new Date().toISOString();
              setAgentProgress((prev) => (prev.includes(payload.agent as string) ? prev : [...prev, payload.agent as string]));
              setActiveAgentId((prev) => (prev === payload.agent ? null : prev));
              markTimelineStep(payload.agent, {
                status: 'done',
                finishedAt,
                durationMs: typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
              });
            }
          } catch {
            // Ignore malformed stream payloads.
          }
        });

        stream.addEventListener('complete', (event) => {
          if (!(event instanceof MessageEvent) || settled) {
            return;
          }

          try {
            const payload = JSON.parse(event.data) as AnalysisStreamEvent;
            const response = payload.analysis ?? payload.result ?? payload;
            settled = true;
            closeStream();
            applyCompletedAnalysis(response, token);
            resolve();
          } catch (error) {
            settled = true;
            closeStream();
            reject(error instanceof Error ? error : new Error('분석 결과를 처리하지 못했습니다.'));
          }
        });

        stream.addEventListener('error', (event) => {
          if (settled) {
            return;
          }

          if (event instanceof MessageEvent) {
            try {
              const payload = JSON.parse(event.data) as AnalysisStreamEvent;
              void failStream(payload.message || '분석 중 오류가 발생했습니다.');
              return;
            } catch {
              void failStream('분석 중 오류가 발생했습니다.');
              return;
            }
          }

          void failStream();
        });

        stream.onerror = () => {
          if (!settled) {
            void failStream();
          }
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
      const unauthorized = /unauthorized|401/i.test(message);
      closeAnalysisStream();
      setActiveAgentId(null);
      setActiveJobId(null);

      if (unauthorized && token) {
        clearStoredToken();
        setSession(null);
        setPendingAnalysis(snapshot);
        openLoginPage('세션이 만료되었습니다. 다시 로그인하세요.');
        return;
      }

      setAnalysisError(message);
      setView('input');
    }
  }

  async function runKeywordVerify(snapshot: PendingKeyword, token: string | null) {
    setKeywordError(null);
    setKeywordLoading(true);
    setAuthError(null);

    try {
      const response = (await verifyKeyword(ANALYSIS_BASE_URL, token, {
        keyword: snapshot.keyword.trim(),
        context_type: snapshot.contextType,
        ...(token
          ? {}
          : {
              guest_id: guestSession.guestId,
            }),
      })) as AnalyzeCaseResponse;

      const analysis = normalizeAnalysisResult(
        response.legal_analysis,
        collectReferenceItems(response.reference_library),
      );
      if (!analysis) {
        throw new Error('검증 결과를 불러오지 못했습니다.');
      }

      syncGuestQuota(response as Record<string, unknown>, token);

      setKeywordResult(mergeProfileResult(analysis, response));
      setPendingKeyword(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '검증 중 오류가 발생했습니다.';
      const unauthorized = /unauthorized|401/i.test(message);

      if (unauthorized && token) {
        clearStoredToken();
        setSession(null);
        setPendingKeyword(snapshot);
        openLoginPage('세션이 만료되었습니다. 다시 로그인하세요.');
        return;
      }

      setKeywordError(message);
    } finally {
      setKeywordLoading(false);
    }
  }

  function clearImageSelection() {
    setSelectedImageFile(null);
    setImageError(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }

  function selectComposerMode(mode: ComposerMode) {
    setComposerMode(mode);
    if (mode === 'text') {
      clearImageSelection();
      return;
    }
    setText('');
  }

  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      clearImageSelection();
      return;
    }

    if (!file.type.startsWith('image/')) {
      clearImageSelection();
      setImageError('이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    setImageError(null);
    setSelectedImageFile(file);
  }

  async function handleAnalyzeClick() {
    if (!text.trim() && !selectedImageFile) {
      return;
    }

    const snapshot: PendingAnalysis = composerMode === 'image'
      ? { inputMode: 'image', contextType, imageFile: selectedImageFile ?? undefined }
      : { inputMode: 'text', contextType, text };
    setPendingKeyword(null);

    if (session) {
      await runAnalysis(snapshot, session.token);
      return;
    }

    if (canUseGuest) {
      await runAnalysis(snapshot, null);
      return;
    }

    setPendingAnalysis(snapshot);
    openLoginPage('비로그인 분석은 IP 기준 하루 10회 제한입니다. 로그인 또는 회원가입이 필요합니다.');
  }

  async function handleKeywordVerifyClick() {
    const keyword = keywordText.trim();
    if (!keyword) {
      return;
    }

    const snapshot = { keyword, contextType };
    setPendingAnalysis(null);

    if (session) {
      await runKeywordVerify(snapshot, session.token);
      return;
    }

    if (canUseGuest) {
      await runKeywordVerify(snapshot, null);
      return;
    }

    setPendingKeyword(snapshot);
    openLoginPage('비로그인 검증은 IP 기준 하루 10회 제한입니다. 로그인 또는 회원가입이 필요합니다.');
  }

  async function handleLoginPageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const response: AuthResponse = await login(AUTH_BASE_URL, { email: authEmail.trim(), password: authPassword });
      saveStoredToken(response.token);
      setSession({ user: response.user, token: response.token });
      setAuthBusy(false);
      setAuthPassword('');
      if (pendingKeyword) {
        const snapshot = pendingKeyword;
        setPendingKeyword(null);
        await runKeywordVerify(snapshot, response.token);
        return;
      }
      if (pendingAnalysis) {
        const snapshot = pendingAnalysis;
        setPendingAnalysis(null);
        await runAnalysis(snapshot, response.token);
      } else {
        setView('input');
      }
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    }
  }

  async function handleGuestContinue() {
    if (guestSession.guestRemaining <= 0) return;
    if (pendingKeyword) {
      const snapshot = pendingKeyword;
      setPendingKeyword(null);
      await runKeywordVerify(snapshot, null);
      return;
    }
    if (pendingAnalysis) {
      const snapshot = pendingAnalysis;
      setPendingAnalysis(null);
      await runAnalysis(snapshot, null);
    }
  }

  function handleReset() {
    closeAnalysisStream();
    setText('');
    setComposerMode('text');
    clearImageSelection();
    setResult(null);
    setAgentProgress([]);
    setActiveAgentId(null);
    setActiveJobId(null);
    setCurrentRun(null);
    resetRuntimeTimeline();
    setAnalysisError(null);
    setSelectedDetail(null);
    setKeywordResult(null);
    setSelectedKeywordDetail(null);
    setKeywordError(null);
    setView('input');
  }

  function openSignupPage() {
    setAuthError(null);
    setAuthEmail('');
    setAuthPassword('');
    setSignupName('');
    setSignupBirthday('');
    setSignupGender(null);
    setSignupNationality('korean');
    setSignupConfirmPassword('');
    setShowSignupPassword(false);
    setVerifyStep('idle');
    setVerifyCode('');
    setVerifyTimer(0);
    setVerifyError(null);
    setVerifyInfo(null);
    setVerifyBusy(false);
    setView('signup');
  }

  async function handleRequestCode() {
    const email = authEmail.trim();
    if (!email) return;
    setVerifyStep('sending');
    setVerifyError(null);
    setVerifyInfo(null);
    try {
      const response = await requestEmailCode(AUTH_BASE_URL, email);
      setVerifyStep('sent');
      setVerifyTimer(180); // 3분 카운트다운
      if (response.debug_code) {
        setVerifyCode(response.debug_code);
        setVerifyInfo('메일 설정이 비활성이라 개발용 인증 코드가 자동 입력되었습니다.');
      } else {
        setVerifyInfo(response.message);
      }
    } catch (err) {
      setVerifyStep('idle');
      setVerifyError(err instanceof Error ? err.message : '코드 발송에 실패했습니다.');
    }
  }

  async function handleConfirmCode() {
    const email = authEmail.trim();
    if (!email || verifyCode.length !== 6) {
      return;
    }

    setVerifyBusy(true);
    setVerifyError(null);
    setVerifyInfo(null);
    try {
      const response = await verifyEmailCode(AUTH_BASE_URL, {
        email,
        verification_code: verifyCode,
      });
      if (!response.verified) {
        throw new Error('인증 코드 확인에 실패했습니다.');
      }

      setVerifyStep('verified');
      setVerifyTimer(0);
      setVerifyInfo(response.message || '이메일 인증이 완료되었습니다.');
    } catch (err) {
      setVerifyStep('sent');
      setVerifyError(err instanceof Error ? err.message : '인증 코드 확인에 실패했습니다.');
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleSignupPageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifyStep !== 'verified') {
      setAuthError('이메일 인증을 먼저 완료해주세요.');
      return;
    }
    if (!signupName.trim() || !signupBirthday.trim() || !signupGender || !signupNationality) {
      setAuthError('이름, 생년월일, 성별, 내국인/외국인 정보를 모두 입력해주세요.');
      return;
    }
    if (!/^\d{8}$/.test(signupBirthday.trim())) {
      setAuthError('생년월일은 8자리 숫자여야 합니다.');
      return;
    }
    if (authPassword !== signupConfirmPassword) {
      setAuthError('비밀번호가 일치하지 않습니다.');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const birthDate = signupBirthday.trim();
      const signupPayload: SignupPayload = {
        email: authEmail.trim(),
        password: authPassword,
        verification_code: verifyCode,
        name: signupName.trim(),
        birth_date: `${birthDate.slice(0, 4)}-${birthDate.slice(4, 6)}-${birthDate.slice(6, 8)}`,
        gender: signupGender,
        nationality: signupNationality,
      };
      const response = await signup(AUTH_BASE_URL, signupPayload);
      saveStoredToken(response.token);
      setSession({ user: response.user, token: response.token });
      setAuthBusy(false);
      if (pendingKeyword) {
        const snapshot = pendingKeyword;
        setPendingKeyword(null);
        await runKeywordVerify(snapshot, response.token);
        return;
      }
      if (pendingAnalysis) {
        const snapshot = pendingAnalysis;
        setPendingAnalysis(null);
        await runAnalysis(snapshot, response.token);
        return;
      }
      setView('input');
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : '회원가입 중 오류가 발생했습니다.');
    }
  }

  const headerActions = (
    <div className="auth-controls">
      {!session ? (
        <>
          <span className={`guest-pill ${guestSession.guestRemaining > 0 ? 'guest-pill-ready' : 'guest-pill-empty'}`}>
            비로그인 잔여 {guestSession.guestRemaining}/10
          </span>
          <button className="auth-btn auth-btn-ghost" onClick={() => openLoginPage()} type="button">
            로그인
          </button>
          <button className="auth-btn auth-btn-solid" onClick={openSignupPage} type="button">
            회원가입
          </button>
        </>
      ) : (
        <>
          <span className="session-pill">{session.user.email}</span>
          <button className="auth-btn auth-btn-ghost" onClick={handleLogout} type="button">
            로그아웃
          </button>
        </>
      )}
    </div>
  );

  const inputView = (
    <main className="input-main">
      <section className="hero">
        <p className="hero-tag">무료 · 즉시 분석 · 익명 사용 가능</p>
        <h1 className="hero-title">
          온라인 피해, 법적으로
          <br />
          따져드립니다
        </h1>
        <p className="hero-desc">
          커뮤니티 게시글, 게임 채팅, 메신저 대화를 붙여넣으면
          <br />
          명예훼손·협박·모욕 등 법적 쟁점과 관련 법령·판례를 분석해드립니다.
        </p>
        <div className="demo-scenario-row">
          {DEMO_SCENARIOS.map((scenario) => (
            <button
              key={scenario.title}
              type="button"
              className="demo-scenario-chip"
              onClick={() => {
                setContextType(scenario.contextType);
                setComposerMode('text');
                setText(scenario.text);
                clearImageSelection();
              }}
            >
              {scenario.title}
            </button>
          ))}
        </div>
      </section>

      <div className="input-card">
        <div className="section-label">대화 출처</div>
        <div className="context-grid">
          {CONTEXT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`context-btn ${contextType === opt.value ? 'context-btn-active' : ''}`}
              onClick={() => setContextType(opt.value)}
              type="button"
            >
              <ContextIcon name={opt.icon} />
              <span className="context-label">{opt.label}</span>
              <span className="context-desc">{opt.desc}</span>
            </button>
          ))}
        </div>

        <div className="section-label" style={{ marginTop: '24px' }}>
          분석 입력 방식 <span className="label-required">*</span>
        </div>
        <div className="composer-mode-row">
          <button
            type="button"
            className={`composer-mode-btn ${composerMode === 'text' ? 'composer-mode-btn-active' : ''}`}
            onClick={() => selectComposerMode('text')}
          >
            텍스트 직접 입력
          </button>
          <button
            type="button"
            className={`composer-mode-btn ${composerMode === 'image' ? 'composer-mode-btn-active' : ''}`}
            onClick={() => selectComposerMode('image')}
          >
            캡처 이미지 OCR
          </button>
        </div>
        <p className="composer-mode-note">
          한 번에 한 가지 입력만 받습니다. 텍스트 분석과 이미지 OCR을 분리해서 어떤 경로로 처리되는지 더 명확하게 보여줍니다.
        </p>

        {composerMode === 'text' ? (
          <>
            <div className="section-label" style={{ marginTop: '20px' }}>
              분석할 내용 <span className="label-required">*</span>
            </div>
            <textarea
              className="text-input"
              placeholder={`상대방이 한 말, 게시글 내용, 대화 내용을 그대로 붙여넣어 주세요.\n\n예: "너 사기꾼인 거 다 퍼뜨리겠다. 네 신상이랑 전화번호 올려버릴 거야."`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
            />
            <div className="char-count">{text.length}자</div>
          </>
        ) : (
          <>
            <div className="section-label" style={{ marginTop: '20px' }}>
              이미지 업로드 <span className="label-required">*</span>
            </div>
            <div className="image-upload-block">
          <input
            ref={imageInputRef}
            id="case-image-upload"
            type="file"
            accept="image/*"
            onChange={handleImageFileChange}
            className="image-upload-input"
          />
          <label className="image-upload-label" htmlFor="case-image-upload">
            <span className="image-upload-icon">
              <AttachmentIcon />
            </span>
            <span className="image-upload-copy">
              <strong>대화 캡처 이미지 선택</strong>
              <span>PNG, JPG 등 이미지 파일을 OCR 분석 경로로 전송합니다.</span>
            </span>
          </label>
          <p className="keyword-note" style={{ marginTop: 0 }}>
            대화 캡처를 올리면 OCR 추출 후 법적 쟁점 분석으로 이어집니다. 민감 정보는 서버 측 마스킹 규칙을 거칩니다.
          </p>
          {selectedImageFile && (
            <div className="image-file-card">
              <div>
                <strong>{selectedImageFile.name}</strong>
                <span>
                  {(selectedImageFile.size / (1024 * 1024)).toFixed(2)} MB ·{' '}
                  {selectedImageFile.type || 'image/*'}
                </span>
              </div>
              <button className="auth-btn auth-btn-ghost" type="button" onClick={clearImageSelection}>
                파일 제거
              </button>
            </div>
          )}
          {imageError && <div className="error-banner">{imageError}</div>}
        </div>
          </>
        )}

        {analysisError && <div className="error-banner">{analysisError}</div>}

        <button
          className="analyze-btn"
          onClick={() => void handleAnalyzeClick()}
          disabled={composerMode === 'image' ? !selectedImageFile : !text.trim()}
          type="button"
        >
          {composerMode === 'image' ? '이미지 업로드 분석 시작' : '법적 분석 시작'}
          <span className="analyze-arrow">→</span>
        </button>

        <div className="keyword-verify">
          <div className="section-label section-label-tight">키워드 검증</div>
          <div className="keyword-row">
            <input
              className="keyword-input"
              type="text"
              placeholder="짧은 단어 또는 구문 입력 예: 모욕, 사기, 개인정보 유출"
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleKeywordVerifyClick();
                }
              }}
            />
            <button
              className="keyword-btn"
              type="button"
              disabled={!keywordText.trim() || keywordLoading}
              onClick={() => void handleKeywordVerifyClick()}
            >
              {keywordLoading ? '검증 중...' : '검증'}
            </button>
          </div>
            <p className="keyword-note">
              짧은 키워드를 넣으면 관련 법령과 판례를 빠르게 확인합니다. 비로그인 상태는 IP 기준
              하루 10회 제한을 따릅니다.
            </p>
          {keywordError && <div className="error-banner">{keywordError}</div>}
        </div>

        <p className="guest-note">
          비로그인 상태에서는 IP 기준으로 하루 10회까지 사용할 수 있습니다. 남은 횟수는 우측
          상단에서 확인할 수 있습니다.
        </p>
        <p className="input-disclaimer">
          업로드된 이미지는 분석 후 저장하지 않으며 OCR 결과의 연락처·주소 등 식별 정보는 마스킹
          처리됩니다. 비로그인 사용은 IP 기준 일일 제한이 적용되고, 본 서비스는 법률 정보 제공 목적이며
          법적 효력이 없습니다.
        </p>
      </div>

      {keywordResult && (
        <section className="result-section keyword-result-section">
          <div className="keyword-result-head">
            <div>
              <h3 className="section-title">키워드 검증 결과</h3>
              <p className="keyword-result-sub">
                <strong>{keywordText.trim()}</strong> 기준으로 가까운 법령과 판례를 바로 묶었습니다.
              </p>
            </div>
            <span className="keyword-result-pill">
              {keywordResult.charges.length + keywordResult.precedent_cards.length}개 매칭
            </span>
          </div>

          <div className="keyword-result-grid">
            <div className="keyword-result-col">
              <h4 className="keyword-column-title">매칭 법령</h4>
              <div className="keyword-mini-list">
                {(keywordResult.law_reference_library?.length
                  ? keywordResult.law_reference_library.map((reference, index) => (
                      <div key={`${reference.title ?? reference.law_name ?? index}`} className="keyword-mini-card">
                        <div className="keyword-mini-card-main">
                          <strong>{reference.title ?? reference.law_name ?? '법령 근거'}</strong>
                          <span>{reference.summary ?? reference.note ?? '관련 법령 근거'}</span>
                        </div>
                        <button
                          className="card-detail-btn"
                          type="button"
                          onClick={() => setSelectedKeywordDetail(buildReferenceDetail(reference, 'law', index))}
                        >
                          상세 보기
                        </button>
                      </div>
                    ))
                  : keywordResult.charges.map((charge, index) => (
                      <div key={`${charge.charge}-${index}`} className="keyword-mini-card">
                        <div className="keyword-mini-card-main">
                          <strong>{charge.charge}</strong>
                          <span>{charge.basis}</span>
                        </div>
                        <button
                          className="card-detail-btn"
                          type="button"
                          onClick={() => setSelectedKeywordDetail(buildChargeDetail(charge, index))}
                        >
                          상세 보기
                        </button>
                      </div>
                    )))}
              </div>
            </div>

            <div className="keyword-result-col">
              <h4 className="keyword-column-title">매칭 판례</h4>
              <div className="keyword-mini-list">
                {(keywordResult.precedent_reference_library?.length
                  ? keywordResult.precedent_reference_library.map((reference, index) => (
                      <div key={`${reference.title ?? reference.case_no ?? index}`} className="keyword-mini-card">
                        <div className="keyword-mini-card-main">
                          <strong>{reference.title ?? reference.case_no ?? '판례 근거'}</strong>
                          <span>{reference.summary ?? reference.details ?? '관련 판례 근거'}</span>
                        </div>
                        <button
                          className="card-detail-btn"
                          type="button"
                          onClick={() => setSelectedKeywordDetail(buildReferenceDetail(reference, 'precedent', index))}
                        >
                          상세 보기
                        </button>
                      </div>
                    ))
                  : keywordResult.precedent_cards.map((precedent, index) => (
                      <div key={`${precedent.case_no}-${index}`} className="keyword-mini-card">
                        <div className="keyword-mini-card-main">
                          <strong>{precedent.case_no}</strong>
                          <span>{precedent.summary}</span>
                        </div>
                        <button
                          className="card-detail-btn"
                          type="button"
                          onClick={() => setSelectedKeywordDetail(buildPrecedentDetail(precedent, index))}
                        >
                          상세 보기
                        </button>
                      </div>
                    )))}
              </div>
            </div>
          </div>

          <div className="keyword-detail-shell" ref={keywordDetailPanelRef}>
            {selectedKeywordDetail ? (
              <div className="detail-panel-body detail-panel-body-inline">
                <div className="detail-panel-toolbar">
                  <span className="detail-panel-count">
                    {selectedKeywordDetail.references.length > 0
                      ? `${selectedKeywordDetail.references.length}개 근거`
                      : '선택한 근거'}
                  </span>
                  <button
                    className="detail-close-btn"
                    type="button"
                    onClick={() => setSelectedKeywordDetail(null)}
                  >
                    닫기
                  </button>
                </div>
                <div className="detail-panel-kicker">{selectedKeywordDetail.eyebrow}</div>
                <h4 className="detail-panel-title">{selectedKeywordDetail.title}</h4>
                <p className="detail-panel-summary">{selectedKeywordDetail.summary}</p>

                {selectedKeywordDetail.metadata.length > 0 && (
                  <div className="detail-metadata">
                    {selectedKeywordDetail.metadata.map((meta) => (
                      <div key={`${meta.label}-${meta.value}`} className="detail-metadata-item">
                        <span>{meta.label}</span>
                        <strong>{meta.value}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {selectedKeywordDetail.highlights.length > 0 && (
                  <div className="detail-highlight-list">
                    {selectedKeywordDetail.highlights.map((item) => (
                      <div key={item} className="detail-highlight-item">
                        <span className="detail-highlight-dot" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedKeywordDetail.references.length > 0 ? (
                  <div className="detail-reference-list">
                    {selectedKeywordDetail.references.map((ref) =>
                      ref.url ? (
                        <a
                          key={`${ref.title}-${ref.summary}-${ref.url}`}
                          className="detail-reference-item"
                          href={ref.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="detail-reference-text">
                            <strong>{ref.title}</strong>
                            <span>{ref.summary}</span>
                          </div>
                          {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                          <span className="detail-reference-link">원문</span>
                        </a>
                      ) : (
                        <div key={`${ref.title}-${ref.summary}`} className="detail-reference-item detail-reference-static">
                          <div className="detail-reference-text">
                            <strong>{ref.title}</strong>
                            <span>{ref.summary}</span>
                          </div>
                          {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="detail-empty">
                검증된 키워드를 누르면 이 영역에서 관련 법령과 판례 상세를 확인할 수 있습니다.
              </div>
            )}
          </div>
        </section>
      )}

      <div className="how-it-works">
        <div className="hiw-step">
          <div className="hiw-num">1</div>
          <div className="hiw-text">
            <strong>내용 붙여넣기</strong>
            <span>피해를 입은 대화·게시글 내용 입력</span>
          </div>
        </div>
        <div className="hiw-arrow">→</div>
        <div className="hiw-step">
          <div className="hiw-num">2</div>
          <div className="hiw-text">
            <strong>AI 분석</strong>
            <span>법령·판례 기반 자동 쟁점 분류</span>
          </div>
        </div>
        <div className="hiw-arrow">→</div>
        <div className="hiw-step">
          <div className="hiw-num">3</div>
          <div className="hiw-text">
            <strong>결과 확인</strong>
            <span>혐의·근거·권장 행동 리포트 제공</span>
          </div>
        </div>
      </div>
    </main>
  );

  const analyzingView = (
    <main className="analyzing-main">
      <div className="analyzing-card analyzing-card-wide">
        <div className="spinner" />
        <h2 className="analyzing-title">분석 중입니다</h2>
        <p className="analyzing-sub">
          {RUNTIME_IS_LIVE
            ? '법령과 판례 provider를 조회하고 있습니다.'
            : '로컬 fixture 기반 mock 검색이라 실제 API보다 빠르게 완료될 수 있습니다.'}
        </p>

        <div className="runtime-observer-grid">
          <section className="runtime-panel">
            <div className="runtime-panel-head">
              <strong>런타임 상태</strong>
              <span className={`runtime-badge runtime-badge-${RUNTIME_IS_LIVE ? 'live' : 'mock'}`}>{RUNTIME_BADGE}</span>
            </div>
            <p className="runtime-panel-copy">{RUNTIME_NOTICE}</p>
            <div className="runtime-meta-grid">
              {currentRun && (
                <>
                  <div className="runtime-meta-item"><span>입력 방식</span><strong>{formatInputMode(currentRun.inputMode)}</strong></div>
                  <div className="runtime-meta-item"><span>출처</span><strong>{formatContextType(currentRun.contextType)}</strong></div>
                  <div className="runtime-meta-item"><span>제출 시각</span><strong>{formatKoreanDateTime(currentRun.submittedAt)}</strong></div>
                  <div className="runtime-meta-item"><span>입력 크기</span><strong>{currentRun.inputMode === 'image' ? currentRun.imageName ?? '이미지 1건' : `${currentRun.textLength}자`}</strong></div>
                </>
              )}
              {activeJobId && <div className="runtime-meta-item runtime-meta-item-wide"><span>작업 ID</span><strong>{activeJobId}</strong></div>}
            </div>
          </section>

          <section className="runtime-panel">
            <div className="runtime-panel-head">
              <strong>에이전트 타임라인</strong>
              <span className="runtime-muted">{runtimeTimeline.filter((item) => item.status === 'done').length}/{runtimeTimeline.length} 완료</span>
            </div>
            <div className="pipeline">
              {runtimeTimeline.map((step) => {
                const done = step.status === 'done';
                const active = step.status === 'active';
                return (
                  <div
                    key={step.agentId}
                    className={`pipeline-step ${done ? 'step-done' : active ? 'step-active' : 'step-waiting'}`}
                  >
                    <div className="step-indicator">
                      {done ? '✓' : active ? <span className="step-dot-pulse" /> : <span className="step-dot" />}
                    </div>
                    <div className="step-info">
                      <strong>{step.label}</strong>
                      <span>{step.description}</span>
                      <small>{done ? formatDuration(step.durationMs) : active ? '현재 실행 중' : '대기 중'}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );

  const resultsView = result ? (
    <main className="results-main">
      <div className={`summary-banner ${result.can_sue ? 'banner-warn' : 'banner-info'}`}>
        <div className="banner-left">
          <RiskBadge level={result.risk_level} />
          <div className="banner-text">
            <h2 className="banner-title">{result.summary}</h2>
            <p className="banner-sub">
              {result.can_sue
                ? '형사 고소 또는 민사 손해배상을 검토해볼 수 있습니다.'
                : '현재 입력 기준으로 명확한 법적 쟁점이 식별되지 않았습니다.'}
            </p>
            {provenanceSummary.length > 0 && (
              <div className="provenance-chip-row">
                {provenanceSummary.map((item) => (
                  <span key={item} className="provenance-chip">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={`can-sue-badge ${result.can_sue ? 'sue-yes' : 'sue-no'}`}>
          {result.can_sue ? '고소 가능' : '고소 어려움'}
        </div>
      </div>

      {result.summary_grounding && (
        <section className="result-section grounding-summary-section">
          <div className="grounding-summary-head">
            <div>
              <h3 className="section-title">분석 근거 요약</h3>
              <p className="grounding-summary-sub">이번 판단이 어떤 법령, 판례, 질의 신호에 연결됐는지 바로 보여줍니다.</p>
            </div>
            <button
              className="card-detail-btn"
              type="button"
              onClick={() => setSelectedDetail(buildDetailPanelData(
                '요약 판단 근거',
                '종합 판단 근거',
                result.summary,
                [
                  { label: '판단', value: result.can_sue ? '고소 가능' : '고소 어려움' },
                  { label: '위험도', value: `Lv.${result.risk_level}` },
                ],
                result.summary_grounding?.queryRefs.map((query) => query.text) ?? [],
                {
                  reference_library: result.reference_library,
                  law_reference_library: result.law_reference_library,
                  precedent_reference_library: result.precedent_reference_library,
                },
                result.summary_grounding,
              ))}
            >
              근거 상세 보기
            </button>
          </div>

          <div className="grounding-summary-card">
            <div className="grounding-summary-copy">
              <strong>{getGroundingLead(result.summary_grounding) || '종합 판단과 연결된 근거가 있습니다.'}</strong>
              {result.summary_grounding.snippetText && (
                <blockquote className="detail-provenance-snippet grounding-summary-snippet">
                  {result.summary_grounding.snippetField && <span>{result.summary_grounding.snippetField}</span>}
                  {result.summary_grounding.snippetText}
                </blockquote>
              )}
            </div>
            <div className="grounding-summary-meta">
              {getGroundingMeta(result.summary_grounding).map((item) => (
                <span key={item} className="grounding-meta-pill">{item}</span>
              ))}
              {result.summary_grounding.queryRefs.slice(0, 4).map((query, index) => (
                <span key={`${query.text}-${index}`} className="detail-query-chip">{query.text}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {result.summary_grounding && (
        <section className="result-section provenance-overview-section">
          <div className="provenance-overview-head">
            <div>
              <h3 className="section-title">분석 근거 요약</h3>
              <p className="detail-panel-sub">요약 문장이 어떤 인용과 검색 근거를 바탕으로 만들어졌는지 빠르게 보여줍니다.</p>
            </div>
            <button
              className="card-detail-btn"
              type="button"
              onClick={() =>
                setSelectedDetail(
                  buildDetailPanelData(
                    '분석 요약 근거',
                    '최종 분석 요약',
                    result.summary,
                    [
                      { label: '법령 근거', value: String(result.law_reference_library?.length ?? 0) },
                      { label: '판례 근거', value: String(result.precedent_reference_library?.length ?? 0) },
                    ],
                    provenanceSummary,
                    {
                      reference_library: result.reference_library,
                      law_reference_library: result.law_reference_library,
                      precedent_reference_library: result.precedent_reference_library,
                    },
                    result.summary_grounding,
                  ),
                )
              }
            >
              상세 보기
            </button>
          </div>
          <div className="provenance-chip-row">
            {describeGrounding(result.summary_grounding).map((item) => (
              <span key={item} className="provenance-chip provenance-chip-strong">{item}</span>
            ))}
            {result.summary_grounding.matchReason && (
              <span className="provenance-inline-copy">{result.summary_grounding.matchReason}</span>
            )}
          </div>
          {result.summary_grounding.snippetText && (
            <blockquote className="detail-provenance-snippet provenance-overview-snippet">
              {result.summary_grounding.snippetField && <span>{result.summary_grounding.snippetField}</span>}
              {result.summary_grounding.snippetText}
            </blockquote>
          )}
        </section>
      )}

      {currentRun && (
        <section className="result-section runtime-recap-section">
          <div className="runtime-panel-head">
            <div>
              <h3 className="section-title">이번 실행 정보</h3>
              <p className="detail-panel-sub">어떤 입력 경로와 런타임으로 분석했는지 다시 확인할 수 있습니다.</p>
            </div>
            <span className={`runtime-badge runtime-badge-${RUNTIME_IS_LIVE ? 'live' : 'mock'}`}>{RUNTIME_BADGE}</span>
          </div>
          <div className="runtime-meta-grid">
            <div className="runtime-meta-item"><span>입력 방식</span><strong>{formatInputMode(currentRun.inputMode)}</strong></div>
            <div className="runtime-meta-item"><span>출처</span><strong>{formatContextType(currentRun.contextType)}</strong></div>
            <div className="runtime-meta-item"><span>분석 시작</span><strong>{formatKoreanDateTime(currentRun.submittedAt)}</strong></div>
            <div className="runtime-meta-item"><span>입력 요약</span><strong>{currentRun.inputMode === 'image' ? currentRun.imageName ?? '이미지 1건' : `${currentRun.textLength}자 텍스트`}</strong></div>
            <div className="runtime-meta-item runtime-meta-item-wide"><span>타임라인</span><strong>{runtimeTimeline.filter((item) => item.status === 'done').length}단계 완료, {runtimeTimeline.find((item) => item.status === 'active')?.label ?? '모든 단계 종료'}</strong></div>
          </div>
        </section>
      )}

      {(result.profile_context || (result.profile_considerations?.length ?? 0) > 0) && (
        <section className="result-section">
          <h3 className="section-title">프로필 기반 안내</h3>
          {result.profile_context && (
            <div className="detail-metadata">
              {result.profile_context.displayName && (
                <div className="detail-metadata-item">
                  <span>이름</span>
                  <strong>{result.profile_context.displayName}</strong>
                </div>
              )}
              {result.profile_context.ageBand && (
                <div className="detail-metadata-item">
                  <span>연령대</span>
                  <strong>{formatProfileAgeBand(result.profile_context.ageBand)}</strong>
                </div>
              )}
              {typeof result.profile_context.ageYears === 'number' && (
                <div className="detail-metadata-item">
                  <span>나이</span>
                  <strong>{result.profile_context.ageYears}세</strong>
                </div>
              )}
              {result.profile_context.birthDate && (
                <div className="detail-metadata-item">
                  <span>생년월일</span>
                  <strong>{result.profile_context.birthDate}</strong>
                </div>
              )}
              {result.profile_context.nationality && (
                <div className="detail-metadata-item">
                  <span>국적</span>
                  <strong>{formatProfileNationality(result.profile_context.nationality)}</strong>
                </div>
              )}
              {result.profile_context.gender && (
                <div className="detail-metadata-item">
                  <span>성별</span>
                  <strong>{formatProfileGender(result.profile_context.gender)}</strong>
                </div>
              )}
              {typeof result.profile_context.isMinor === 'boolean' && (
                <div className="detail-metadata-item">
                  <span>미성년 여부</span>
                  <strong>{result.profile_context.isMinor ? '미성년자' : '성인'}</strong>
                </div>
              )}
            </div>
          )}

          {(result.profile_considerations?.length ?? 0) > 0 && (
            <div className="detail-highlight-list" style={{ marginTop: 12 }}>
              {result.profile_considerations?.map((item) => (
                <div key={item} className="detail-highlight-item">
                  <span className="detail-highlight-dot" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}

          {result.profile_guidance && (
            <div className="detail-panel-body detail-panel-body-inline" style={{ marginTop: 16 }}>
              <div className="detail-panel-kicker">{result.profile_guidance.title}</div>
              <h4 className="detail-panel-title">{result.profile_guidance.summary}</h4>
              {result.profile_guidance.items.length > 0 && (
                <div className="detail-highlight-list">
                  {result.profile_guidance.items.map((item) => (
                    <div key={item} className="detail-highlight-item">
                      <span className="detail-highlight-dot" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {result.profile_guidance.note && (
                <p className="detail-panel-sub" style={{ marginTop: 10 }}>
                  {result.profile_guidance.note}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="results-grid">
        <div className="results-col">
          {result.charges.length > 0 && (
            <section className="result-section">
              <h3 className="section-title">탐지된 법적 쟁점</h3>
              <div className="charge-list">
                {result.charges.map((charge, i) => (
                  <div key={i} className="charge-card">
                    <div className="charge-header">
                      <div className="charge-header-main">
                        <span className="charge-name">{charge.charge}</span>
                        <ProbabilityPill prob={charge.probability} />
                      </div>
                      <button
                        className="card-detail-btn"
                        type="button"
                        onClick={() => setSelectedDetail(buildChargeDetail(charge, i))}
                      >
                        상세 보기
                      </button>
                    </div>
                    <div className="charge-basis">{charge.basis}</div>
                    {charge.grounding && (
                      <div className="grounding-inline-card">
                        <strong>근거 연결</strong>
                        <p>{getGroundingLead(charge.grounding) || '관련 법령·판례 근거와 연결되었습니다.'}</p>
                        <div className="grounding-inline-meta">
                          {getGroundingMeta(charge.grounding).map((item) => (
                            <span key={item} className="grounding-meta-pill">{item}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {charge.expected_penalty && (
                      <div className="charge-penalty">
                        <span className="penalty-label">예상 처벌</span>
                        {charge.expected_penalty}
                      </div>
                    )}
                    <div className="elements-list">
                      {charge.elements_met.map((el, j) => (
                        <div key={j} className="element-item">
                          <span className="element-dot" />
                          {el}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {result.precedent_cards.length > 0 && (
            <section className="result-section">
              <h3 className="section-title">유사 판례</h3>
              <div className="precedent-list">
                {result.precedent_cards.map((p, i) => (
                  <div key={i} className="precedent-card">
                    <div className="precedent-header">
                      <div className="precedent-header-main">
                        <span className="precedent-no">{p.case_no}</span>
                        <span className="precedent-court">{p.court}</span>
                        <span
                          className={`verdict-badge ${p.verdict === '유죄' ? 'verdict-guilty' : 'verdict-not-guilty'}`}
                        >
                          {p.verdict}
                        </span>
                      </div>
                      <button
                        className="card-detail-btn"
                        type="button"
                        onClick={() => setSelectedDetail(buildPrecedentDetail(p, i))}
                      >
                        상세 보기
                      </button>
                    </div>
                    {p.summary && <p className="precedent-summary">{p.summary}</p>}
                    {p.grounding && (
                      <div className="grounding-inline-card grounding-inline-card-precedent">
                        <strong>매칭 근거</strong>
                        <p>{getGroundingLead(p.grounding) || '이 판례가 현재 사안과 연결된 이유가 있습니다.'}</p>
                        <div className="grounding-inline-meta">
                          {getGroundingMeta(p.grounding).map((item) => (
                            <span key={item} className="grounding-meta-pill">{item}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {p.similarity_score > 0 && (
                      <div className="similarity">
                        유사도
                        <div className="similarity-bar">
                          <div className="similarity-fill" style={{ width: `${p.similarity_score * 100}%` }} />
                        </div>
                        <span>{Math.round(p.similarity_score * 100)}%</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="results-col results-col-side">
          <section className="result-section result-detail-panel" ref={detailPanelRef}>
            <div className="detail-panel-head">
              <div>
                <h3 className="section-title">상세 보기</h3>
                <p className="detail-panel-sub">
                  카드를 누르면 법령·판례 근거와 참고 정보를 확인할 수 있습니다.
                </p>
              </div>
              {selectedDetail && (
                <div className="detail-panel-actions">
                  <span className="detail-panel-count">
                    {selectedDetail.references.length > 0
                      ? `${selectedDetail.references.length}개 근거`
                      : '카드 상세'}
                  </span>
                  <button className="detail-close-btn" type="button" onClick={() => setSelectedDetail(null)}>
                    닫기
                  </button>
                </div>
              )}
            </div>

            {selectedDetail ? (
              <div className="detail-panel-body">
                <div className="detail-panel-kicker">{selectedDetail.eyebrow}</div>
                <h4 className="detail-panel-title">{selectedDetail.title}</h4>
                <p className="detail-panel-summary">{selectedDetail.summary}</p>

                {selectedDetail.metadata.length > 0 && (
                  <div className="detail-metadata">
                    {selectedDetail.metadata.map((meta) => (
                      <div key={`${meta.label}-${meta.value}`} className="detail-metadata-item">
                        <span>{meta.label}</span>
                        <strong>{meta.value}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDetail.highlights.length > 0 && (
                  <div className="detail-highlight-list">
                    {selectedDetail.highlights.map((item) => (
                      <div key={item} className="detail-highlight-item">
                        <span className="detail-highlight-dot" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDetail.provenance && (
                  <div className="detail-provenance">
                    <div className="detail-provenance-head">
                      <strong>근거 연결</strong>
                      {selectedDetail.provenance.citationId && (
                        <span>{selectedDetail.provenance.citationId}</span>
                      )}
                    </div>

                    {(selectedDetail.provenance.referenceKey ||
                      selectedDetail.provenance.lawReferenceId ||
                      selectedDetail.provenance.referenceId ||
                      selectedDetail.provenance.precedentReferenceIds.length > 0) && (
                      <div className="detail-provenance-grid">
                        {selectedDetail.provenance.referenceKey && (
                          <div>
                            <span>참조 키</span>
                            <strong>{selectedDetail.provenance.referenceKey}</strong>
                          </div>
                        )}
                        {selectedDetail.provenance.lawReferenceId && (
                          <div>
                            <span>법령 근거</span>
                            <strong>{selectedDetail.provenance.lawReferenceId}</strong>
                          </div>
                        )}
                        {selectedDetail.provenance.referenceId && (
                          <div>
                            <span>판례 근거</span>
                            <strong>{selectedDetail.provenance.referenceId}</strong>
                          </div>
                        )}
                        {selectedDetail.provenance.precedentReferenceIds.length > 0 && (
                          <div>
                            <span>연결 판례</span>
                            <strong>{selectedDetail.provenance.precedentReferenceIds.join(', ')}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedDetail.provenance.matchReason && (
                      <p className="detail-provenance-reason">{selectedDetail.provenance.matchReason}</p>
                    )}

                    {selectedDetail.provenance.snippetText && (
                      <blockquote className="detail-provenance-snippet">
                        {selectedDetail.provenance.snippetField && (
                          <span>{selectedDetail.provenance.snippetField}</span>
                        )}
                        {selectedDetail.provenance.snippetText}
                      </blockquote>
                    )}

                    {selectedDetail.provenance.queryRefs.length > 0 && (
                      <div className="detail-query-list">
                        {selectedDetail.provenance.queryRefs.slice(0, 8).map((query, queryIndex) => (
                          <span
                            key={`${query.text}-${query.bucket}-${query.channel}-${queryIndex}`}
                            className="detail-query-chip"
                            title={[...query.sources, ...query.issueTypes, ...query.legalElementSignals].join(', ')}
                          >
                            {query.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedDetail.references.length > 0 ? (
                  <div className="detail-reference-list">
                    {selectedDetail.references.map((ref) => (
                      ref.url ? (
                        <a
                          key={`${ref.title}-${ref.summary}-${ref.url}`}
                          className="detail-reference-item"
                          href={ref.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="detail-reference-text">
                            <strong>{ref.title}</strong>
                            <span>{ref.summary}</span>
                          </div>
                          {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                          <span className="detail-reference-link">원문</span>
                        </a>
                      ) : (
                        <div key={`${ref.title}-${ref.summary}`} className="detail-reference-item detail-reference-static">
                          <div className="detail-reference-text">
                            <strong>{ref.title}</strong>
                            <span>{ref.summary}</span>
                          </div>
                          {ref.subtitle && <span className="detail-reference-subtitle">{ref.subtitle}</span>}
                        </div>
                      )
                    ))}
                  </div>
                ) : (
                  <div className="detail-empty">
                    참고 라이브러리가 없으면 카드의 핵심 정보만 우선 표시됩니다.
                  </div>
                )}
              </div>
            ) : (
              <div className="detail-empty">
                카드의 <strong>상세 보기</strong>를 누르면 여기에서 판례와 근거를 확인할 수 있습니다.
              </div>
            )}
          </section>

          <section className="result-section">
            <h3 className="section-title">권장 행동</h3>
            <div className="action-list">
              {result.recommended_actions.map((action, i) => (
                <div key={i} className="action-item">
                  <div className="action-check">
                    <span>{i + 1}</span>
                  </div>
                  <p>{action}</p>
                </div>
              ))}
            </div>
          </section>

          {result.evidence_to_collect.length > 0 && (
            <section className="result-section">
              <h3 className="section-title">수집해야 할 증거</h3>
              <div className="evidence-list">
                {result.evidence_to_collect.map((ev, i) => (
                  <div key={i} className="evidence-item">
                    <span className="evidence-icon">
                      <AttachmentIcon />
                    </span>
                    {ev}
                  </div>
                ))}
              </div>
            </section>
          )}

          {session && (
            <section className="result-section">
              <div className="runtime-panel-head">
                <div>
                  <h3 className="section-title">최근 분석 기록</h3>
                  <p className="detail-panel-sub">백엔드에 저장된 내 최근 분석 요약입니다.</p>
                </div>
                <span className="runtime-muted">{historyBusy ? '불러오는 중...' : `${analysisHistory.length}건`}</span>
              </div>
              <div className="history-list">
                {analysisHistory.length > 0 ? analysisHistory.slice(0, 6).map((item) => (
                  <div key={`${item.caseId}-${item.createdAt}`} className="history-card">
                    <div className="history-card-top">
                      <strong>{item.title}</strong>
                      <span>{formatKoreanDateTime(item.createdAt)}</span>
                    </div>
                    <p>{item.summary}</p>
                    <div className="provenance-chip-row provenance-chip-row-tight">
                      <span className="provenance-chip">{formatContextType(item.contextType as ContextType)}</span>
                      <span className="provenance-chip">위험도 Lv.{item.riskLevel}</span>
                      <span className="provenance-chip">{item.canSue ? '고소 가능' : '고소 어려움'}</span>
                    </div>
                  </div>
                )) : <div className="detail-empty">저장된 분석 기록이 아직 없습니다.</div>}
              </div>
            </section>
          )}

          <div className="disclaimer-box">
            <span className="disclaimer-icon">
              <InfoIcon />
            </span>
            <p>{result.disclaimer}</p>
          </div>
        </div>
      </div>

      <div className="results-footer">
        <button className="analyze-btn analyze-btn-outline" onClick={handleReset} type="button">
          다른 내용 분석하기
        </button>
      </div>
    </main>
  ) : null;

  const signupPageView = (
    <div className="signup-page">
      <div className="signup-container">
        <div className="signup-logo">
          <span className="signup-logo-icon">
            <ScaleIcon />
          </span>
          <span className="signup-logo-text">KoreanLaw</span>
        </div>

        <form className="signup-card" onSubmit={(e) => void handleSignupPageSubmit(e)}>

          {/* ── Step 1: 이메일 인증 ── */}
          <div className="signup-field-group">
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </span>
              <input
                className="signup-input"
                type="email"
                placeholder="이메일 (아이디)"
                value={authEmail}
                onChange={(e) => { setAuthEmail(e.target.value); setVerifyStep('idle'); setVerifyError(null); setVerifyInfo(null); }}
                autoComplete="email"
                disabled={verifyStep === 'verified'}
                required
              />
              {verifyStep === 'verified' ? (
                <span className="signup-verified-badge">✓ 인증완료</span>
              ) : (
                <button
                  type="button"
                  className="signup-code-btn"
                  disabled={!authEmail.trim() || verifyStep === 'sending'}
                  onClick={() => void handleRequestCode()}
                >
                  {verifyStep === 'sending' ? '발송중...' : verifyStep === 'sent' ? '재전송' : '인증 요청'}
                </button>
              )}
            </div>

            {(verifyStep === 'sent') && (
              <div className="signup-field signup-code-row">
                <span className="signup-field-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M8 6V4a2 2 0 0 1 4 0v2"/></svg>
                </span>
                <input
                  className="signup-input"
                  type="text"
                  placeholder="인증 코드 6자리"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  autoComplete="one-time-code"
                />
                {verifyTimer > 0 && (
                  <span className="signup-code-timer">
                    {String(Math.floor(verifyTimer / 60)).padStart(2, '0')}:{String(verifyTimer % 60).padStart(2, '0')}
                  </span>
                )}
                <button
                  type="button"
                  className="signup-code-btn"
                  disabled={verifyCode.length !== 6 || verifyBusy}
                  onClick={() => void handleConfirmCode()}
                >
                  {verifyBusy ? '확인중...' : '인증 확인'}
                </button>
              </div>
            )}
          </div>

          {verifyInfo && <div className="signup-info">{verifyInfo}</div>}
          {verifyError && <div className="signup-error">{verifyError}</div>}

          {/* ── Step 2: 비밀번호 ── */}
          <div className={`signup-field-group ${verifyStep !== 'verified' ? 'signup-group-locked' : ''}`}>
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input
                className="signup-input"
                type={showSignupPassword ? 'text' : 'password'}
                placeholder="비밀번호"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                autoComplete="new-password"
                disabled={verifyStep !== 'verified'}
                required
              />
              <button type="button" className="signup-eye" disabled={verifyStep !== 'verified'} onClick={() => setShowSignupPassword((v) => !v)}>
                {showSignupPassword
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input
                className="signup-input"
                type="password"
                placeholder="비밀번호 재입력"
                value={signupConfirmPassword}
                onChange={(e) => setSignupConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={verifyStep !== 'verified'}
                required
              />
            </div>
          </div>

          {authPassword.length > 0 && verifyStep === 'verified' && (
            <ul className="signup-policy-list">
              <PolicyRule label="9자 이상" passed={passwordPolicy.minLength} />
              <PolicyRule label="영문 포함" passed={passwordPolicy.hasLetter} />
              <PolicyRule label="숫자 포함" passed={passwordPolicy.hasNumber} />
              <PolicyRule label="특수문자 포함" passed={passwordPolicy.hasSpecial} />
            </ul>
          )}

          {/* ── Step 3: 개인 정보 ── */}
          <div className={`signup-field-group ${verifyStep !== 'verified' ? 'signup-group-locked' : ''}`}>
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input
                className="signup-input"
                type="text"
                placeholder="이름"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                disabled={verifyStep !== 'verified'}
              />
            </div>
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
              <input
                className="signup-input"
                type="text"
                placeholder="생년월일 8자리 (예: 19901231)"
                value={signupBirthday}
                onChange={(e) => setSignupBirthday(e.target.value.replace(/\D/g, '').slice(0, 8))}
                maxLength={8}
                disabled={verifyStep !== 'verified'}
              />
            </div>
            <div className="signup-toggles-row">
              <button type="button" className={`signup-toggle ${signupGender === 'male' ? 'signup-toggle-active' : ''}`} onClick={() => setSignupGender('male')} disabled={verifyStep !== 'verified'}>남</button>
              <button type="button" className={`signup-toggle ${signupGender === 'female' ? 'signup-toggle-active' : ''}`} onClick={() => setSignupGender('female')} disabled={verifyStep !== 'verified'}>여</button>
              <button type="button" className={`signup-toggle ${signupNationality === 'korean' ? 'signup-toggle-active' : ''}`} onClick={() => setSignupNationality('korean')} disabled={verifyStep !== 'verified'}>내국인</button>
              <button type="button" className={`signup-toggle ${signupNationality === 'foreign' ? 'signup-toggle-active' : ''}`} onClick={() => setSignupNationality('foreign')} disabled={verifyStep !== 'verified'}>외국인</button>
            </div>
          </div>

          {authError && <div className="signup-error">{authError}</div>}

          <button
            className="signup-submit"
            type="submit"
            disabled={authBusy || verifyStep !== 'verified' || !passwordPolicy.valid || authPassword !== signupConfirmPassword}
          >
            {authBusy ? '처리 중...' : '가입하기'}
          </button>
        </form>

        <div className="signup-footer-links">
          이미 계정이 있으신가요?&nbsp;
          <button type="button" className="signup-link" onClick={() => openLoginPage()}>로그인</button>
        </div>
      </div>
    </div>
  );

  const loginPageView = (
    <div className="signup-page">
      <div className="signup-container">
        <div className="signup-logo">
          <span className="signup-logo-icon">
            <ScaleIcon />
          </span>
          <span className="signup-logo-text">KoreanLaw</span>
        </div>

        {pendingAnalysis && (
          <div className="auth-page-notice">
            로그인 후 분석이 자동으로 시작됩니다
          </div>
        )}
        {pendingKeyword && (
          <div className="auth-page-notice">
            로그인 후 키워드 검증이 자동으로 시작됩니다
          </div>
        )}

        <form className="signup-card" onSubmit={(e) => void handleLoginPageSubmit(e)}>
          <div className="signup-field-group">
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              </span>
              <input
                className="signup-input"
                type="email"
                placeholder="이메일"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="signup-field">
              <span className="signup-field-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input
                className="signup-input"
                type="password"
                placeholder="비밀번호"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {authError && <div className="signup-error">{authError}</div>}

          <button
            className="signup-submit"
            type="submit"
            disabled={authBusy || !authEmail.trim() || !authPassword.trim()}
          >
            {authBusy ? '처리 중...' : '로그인'}
          </button>

          {(pendingAnalysis || pendingKeyword) && canUseGuest && (
            <button
              className="signup-submit auth-guest-btn"
              type="button"
              onClick={() => void handleGuestContinue()}
            >
              비로그인으로 계속 ({guestSession.guestRemaining}회 남음)
            </button>
          )}
        </form>

        <div className="signup-footer-links">
          계정이 없으신가요?&nbsp;
          <button type="button" className="signup-link" onClick={openSignupPage}>회원가입</button>
          {!pendingAnalysis && (
            <>
              &nbsp;·&nbsp;
              <button type="button" className="signup-link" onClick={() => setView('input')}>돌아가기</button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (view === 'login') return loginPageView;
  if (view === 'signup') return signupPageView;

  return (
    <div className="page">
      <header className="top-bar">
        <div className="logo">
          <span className="logo-icon">
            <ScaleIcon />
          </span>
          <span className="logo-text">KoreanLaw</span>
        </div>
        <span className="top-bar-sub">AI 법률 분석 서비스</span>
        <div className="top-bar-spacer" />
        {headerActions}
      </header>

      {view === 'input' ? inputView : view === 'analyzing' ? analyzingView : resultsView}
    </div>
  );
}
