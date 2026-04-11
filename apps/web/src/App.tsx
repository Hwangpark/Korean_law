import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import {
  analyzeCase,
  DEFAULT_AUTH_BASE_URL,
  PASSWORD_POLICY_HINT,
  checkHealth,
  clearStoredToken,
  evaluatePasswordPolicy,
  fetchHistory,
  fetchMe,
  getInitialAuthBaseUrl,
  loadStoredToken,
  login,
  saveAuthBaseUrl,
  saveStoredToken,
  signup,
  type AnalysisHistoryItem,
  type AuthResponse,
  type AuthUser,
  type HealthResponse,
} from './lib/auth';

import './styles.css';

const DEFAULT_ANALYSIS_BASE_URL = import.meta.env.VITE_ANALYSIS_BASE_URL ?? DEFAULT_AUTH_BASE_URL;

type AuthMode = 'signup' | 'login';
type InputMode = 'text' | 'image' | 'link';
type ContextType = 'community' | 'game_chat' | 'messenger' | 'other';
type StatusTone = 'neutral' | 'success' | 'danger';
type BusyAction = 'signup' | 'login' | 'health' | 'restore' | 'analyze' | null;
type PipelineStage = 'orchestrator' | 'ocr' | 'classifier' | 'law' | 'precedent' | 'analysis';

type SessionState = {
  user: AuthUser;
  token: string;
  issuedAt: string;
  expiresIn: number;
  tokenType: string;
};

type DraftImage = {
  name: string;
  size: number;
  type: string;
  preview: string;
};

type IssueCard = {
  title: string;
  basis: string;
  probability: 'high' | 'medium' | 'low';
  expected_penalty: string;
  checklist: string[];
};

type PrecedentCard = {
  case_no: string;
  court: string;
  verdict: string;
  summary: string;
  similarity_score: number;
};

type TimelineEvent = {
  type: string;
  agent: PipelineStage | string;
  at: string;
  duration_ms?: number;
};

type AnalysisMeta = {
  provider_mode?: string;
  generated_at?: string;
  input_type?: string;
  context_type?: string;
};

type AnalysisResult = {
  canSue: boolean;
  riskLevel: number;
  summary: string;
  issueCards: IssueCard[];
  recommendedActions: string[];
  evidenceToCollect: string[];
  precedentCards: PrecedentCard[];
  disclaimer: string;
  meta?: AnalysisMeta;
  timeline: TimelineEvent[];
  sourceLabel: string;
};

type DraftCase = {
  title: string;
  contextType: ContextType;
  mode: InputMode;
  bodyText: string;
  linkUrl: string;
  image: DraftImage | null;
};

const CONTEXT_OPTIONS: Array<{
  value: ContextType;
  label: string;
  subtitle: string;
}> = [
  { value: 'community', label: '커뮤니티', subtitle: '게시글, 댓글, 캡처' },
  { value: 'game_chat', label: '게임 채팅', subtitle: '인게임 대화, 신고 메모' },
  { value: 'messenger', label: '메신저', subtitle: '카카오톡, DM, 단체방' },
  { value: 'other', label: '기타', subtitle: '링크, 메일, 문서' },
];

const INPUT_MODES: Array<{
  value: InputMode;
  label: string;
  subtitle: string;
}> = [
  { value: 'text', label: '텍스트', subtitle: '복사한 원문을 넣습니다' },
  { value: 'image', label: '이미지', subtitle: '캡처 업로드 + OCR 메모' },
  { value: 'link', label: '링크', subtitle: 'URL 입력 + 크롤링 메모' },
];

const PIPELINE_STAGES: Array<{
  id: PipelineStage;
  label: string;
  subtitle: string;
}> = [
  { id: 'orchestrator', label: 'Orchestrator', subtitle: '사건 파일을 분해하고 흐름을 조율' },
  { id: 'ocr', label: 'OCR Agent', subtitle: '텍스트, 이미지, 링크의 입력을 정제' },
  { id: 'classifier', label: 'Classifier Agent', subtitle: '법적 쟁점과 유형을 분류' },
  { id: 'law', label: 'Law Search Agent', subtitle: '관련 법령과 조문을 검색' },
  { id: 'precedent', label: 'Precedent Agent', subtitle: '유사 판례와 판단 경향을 검색' },
  { id: 'analysis', label: 'Legal Analysis Agent', subtitle: '고소 가능성, 증거, 대응을 정리' },
];

const SAMPLE_TEXT = [
  '너는 사기꾼이라고 게시글에 올리고 다 퍼뜨리겠다.',
  '대화 상대가 여러 사람 앞에서 반복적으로 모욕적인 표현을 했고,',
  '전화번호와 얼굴 사진을 함께 올리겠다고 협박했다.',
].join(' ');

const SAMPLE_LINK = 'https://example.com/post/12345';

const FALLBACK_RULES = [
  {
    title: '사기',
    basis: '형법 제347조',
    penalty: '10년 이하의 징역 또는 2천만원 이하의 벌금',
    keywords: ['사기', '기망', '송금', '환불', '돈', '거짓'],
    checklist: ['기망 표현 보존', '송금/거래 흐름 정리', '피해 금액 산정'],
  },
  {
    title: '명예훼손',
    basis: '형법 제307조 / 정보통신망법 제70조',
    penalty: '사안에 따라 벌금형 또는 징역형',
    keywords: ['명예훼손', '허위', '퍼뜨리', '유포', '게시글', '루머'],
    checklist: ['공연성 확인', '사실 적시 여부 확인', '게시 범위 캡처'],
  },
  {
    title: '협박/공갈',
    basis: '형법 제283조 / 제350조',
    penalty: '3년 이하의 징역부터 중형 가능',
    keywords: ['협박', '위협', '공갈', '안 하면', '가만두지', '퍼뜨리'],
    checklist: ['위협 문장 원문 확보', '도달 경로 기록', '반복성 확인'],
  },
  {
    title: '모욕',
    basis: '형법 제311조',
    penalty: '1년 이하의 징역 또는 벌금형',
    keywords: ['모욕', '욕', '병신', '쓰레기', '멍청'],
    checklist: ['공연성 확인', '특정성 확인', '발언 전후 맥락 보존'],
  },
  {
    title: '스토킹',
    basis: '스토킹처벌법',
    penalty: '반복 연락·접근에 따라 처벌 가능',
    keywords: ['스토킹', '계속 연락', '찾아가', '반복', '집 앞'],
    checklist: ['반복성 캡처', '접근 경로 정리', '차단 이력 정리'],
  },
  {
    title: '개인정보 유출',
    basis: '개인정보보호법',
    penalty: '고의 유출 여부와 범위에 따라 판단',
    keywords: ['전화번호', '주소', '주민번호', '신상', '개인정보', '사진'],
    checklist: ['노출 항목 목록화', '원본/재업로드 경로 확인', '동의 여부 확인'],
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeBaseUrlDraft(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokenPreview(token: string) {
  if (token.length <= 18) {
    return token;
  }

  return `${token.slice(0, 12)}…${token.slice(-10)}`;
}

function formatIssuedAt(value: string) {
  try {
    return new Date(value).toLocaleString('ko-KR');
  } catch {
    return value;
  }
}

function formatSimilarity(score: number) {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

function formatSourceLabel(mode: InputMode) {
  switch (mode) {
    case 'image':
      return '이미지 입력';
    case 'link':
      return '링크 입력';
    default:
      return '텍스트 입력';
  }
}

function formatContextLabel(contextType: ContextType) {
  const option = CONTEXT_OPTIONS.find((item) => item.value === contextType);
  return option ? option.label : '기타';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => (typeof entry === 'string' ? [entry] : []));
}

function normalizeProbability(value: unknown): IssueCard['probability'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizeIssueCards(value: unknown): IssueCard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const checklist = toStringArray(entry.checklist ?? entry.elements_met);
    const title = String(entry.title ?? entry.charge ?? '추가 검토 필요');
    const basis = String(entry.basis ?? '근거 확인 필요');
    const expectedPenalty = String(entry.expected_penalty ?? '추가 검토 필요');

    return [
      {
        title,
        basis,
        probability: normalizeProbability(entry.probability),
        expected_penalty: expectedPenalty,
        checklist,
      },
    ];
  });
}

function normalizePrecedentCards(value: unknown): PrecedentCard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    return [
      {
        case_no: String(entry.case_no ?? entry.caseNo ?? '예시 사건'),
        court: String(entry.court ?? '법원 미상'),
        verdict: String(entry.verdict ?? '결과 요약 필요'),
        summary: String(entry.summary ?? '유사한 사건 요약이 표시됩니다.'),
        similarity_score: Number(entry.similarity_score ?? entry.similarityScore ?? 0),
      },
    ];
  });
}

function normalizeTimeline(value: unknown): TimelineEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    return [
      {
        type: String(entry.type ?? 'event'),
        agent: String(entry.agent ?? 'unknown'),
        at: String(entry.at ?? ''),
        duration_ms: typeof entry.duration_ms === 'number' ? entry.duration_ms : undefined,
      },
    ];
  });
}

function createIssueCards(draft: DraftCase): IssueCard[] {
  const text = `${draft.title}\n${draft.bodyText}\n${draft.linkUrl}\n${draft.image?.name ?? ''}`.toLowerCase();

  const matched = FALLBACK_RULES.flatMap((rule) => {
    const score = rule.keywords.reduce((count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score === 0) {
      return [];
    }

    const probability: IssueCard['probability'] = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';

    return [
      {
        title: rule.title,
        basis: rule.basis,
        probability,
        expected_penalty: rule.penalty,
        checklist: [...rule.checklist],
      },
    ];
  });

  if (matched.length > 0) {
    return matched.slice(0, 3);
  }

  return [
    {
      title: '추가 사실관계 확인',
      basis: '발언 주체, 공개 범위, 반복성 확인',
      probability: 'low',
      expected_penalty: '원본 보존 후 세부 검토 필요',
      checklist: ['원본 증거 보존', '전후 맥락 확보', '상대방 식별 단서 정리'],
    },
  ];
}

function createPrecedentCards(draft: DraftCase, issueCards: IssueCard[]): PrecedentCard[] {
  const baseScore = Math.min(0.92, 0.34 + issueCards.length * 0.18 + (draft.mode === 'image' ? 0.08 : 0));

  return [
    {
      case_no: '샘플 2024-01',
      court: '지방법원',
      verdict: '유사 쟁점 참고',
      summary: '캡처와 대화 맥락을 함께 제출하면 표현의 공개성 판단이 선명해집니다.',
      similarity_score: Number(baseScore.toFixed(2)),
    },
    {
      case_no: '샘플 2023-17',
      court: '고등법원',
      verdict: '증거 보강 필요',
      summary: '반복성, 게시 범위, 상대방 식별 가능성이 핵심 판단 요소로 정리됩니다.',
      similarity_score: Number(Math.max(0.18, baseScore - 0.12).toFixed(2)),
    },
  ];
}

function createRecommendedActions(draft: DraftCase, issueCards: IssueCard[]) {
  const actions = [
    '원본 캡처와 화면 URL, 작성 시각이 보이도록 보관하세요.',
    '게시/대화 흐름 전후를 같이 남겨 공연성과 반복성을 정리하세요.',
    '상대방 식별 가능 정보와 피해 경위를 한 문단으로 요약하세요.',
  ];

  if (draft.mode === 'image') {
    actions.push('이미지 파일의 원본 메타데이터와 업로드 경로를 함께 저장하세요.');
  }

  if (draft.mode === 'link') {
    actions.push('링크 페이지 전체와 하위 스레드까지 같이 보존하세요.');
  }

  if (issueCards.some((item) => item.title.includes('스토킹') || item.title.includes('협박'))) {
    actions.push('반복 연락과 접근 차단 이력, 신고 기록을 먼저 묶어두세요.');
  }

  return actions;
}

function createEvidenceList(draft: DraftCase) {
  const evidence = [
    '원본 캡처 또는 원문 대화',
    '게시 시간, URL, 방 번호, 프로필 정보',
    '전후 대화 흐름과 반복성 증빙',
  ];

  if (draft.mode === 'image') {
    evidence.push('이미지 원본 파일과 파일명');
  }

  if (draft.mode === 'link') {
    evidence.push('링크 페이지 전체 캡처와 작성자 정보');
  }

  return evidence;
}

function createFallbackAnalysis(draft: DraftCase): AnalysisResult {
  const issueCards = createIssueCards(draft);
  const precedentCards = createPrecedentCards(draft, issueCards);
  const riskLevel = Math.max(1, Math.min(5, issueCards.length + (draft.mode === 'image' ? 1 : 0) + (draft.contextType === 'messenger' ? 1 : 0)));

  return {
    canSue: riskLevel >= 3,
    riskLevel,
    summary:
      issueCards.length > 0
        ? `${issueCards.length}개의 주요 쟁점이 탐지되었습니다.`
        : '명확한 쟁점이 적어서 사실관계 보강이 필요합니다.',
    issueCards,
    recommendedActions: createRecommendedActions(draft, issueCards),
    evidenceToCollect: createEvidenceList(draft),
    precedentCards,
    disclaimer: '이 결과는 UI 초안에서 생성한 참고용 분석이며 법적 효력이 없습니다.',
    meta: {
      provider_mode: 'local',
      generated_at: new Date().toISOString(),
      input_type: draft.mode,
      context_type: draft.contextType,
    },
    timeline: [],
    sourceLabel: formatSourceLabel(draft.mode),
  };
}

function normalizeAnalysisResponse(payload: unknown, draft: DraftCase): AnalysisResult {
  if (!isRecord(payload)) {
    return createFallbackAnalysis(draft);
  }

  const root = payload as Record<string, unknown>;
  const analysis = isRecord(root.legal_analysis)
    ? (root.legal_analysis as Record<string, unknown>)
    : isRecord(root.analysis)
      ? (root.analysis as Record<string, unknown>)
      : root;

  const issueCards = normalizeIssueCards(analysis.issue_cards ?? analysis.charges);
  const precedentCards = normalizePrecedentCards(analysis.precedent_cards);
  const meta = isRecord(root.meta)
    ? {
        provider_mode: typeof root.meta.provider_mode === 'string' ? root.meta.provider_mode : undefined,
        generated_at: typeof root.meta.generated_at === 'string' ? root.meta.generated_at : undefined,
        input_type: typeof root.meta.input_type === 'string' ? root.meta.input_type : undefined,
        context_type: typeof root.meta.context_type === 'string' ? root.meta.context_type : undefined,
      }
    : undefined;

  return {
    canSue: Boolean(analysis.can_sue ?? analysis.canSue ?? issueCards.length > 0),
    riskLevel: Number(analysis.risk_level ?? analysis.riskLevel ?? Math.max(1, issueCards.length)),
    summary: String(analysis.summary ?? analysis.headline ?? '분석 결과'),
    issueCards,
    recommendedActions: toStringArray(analysis.recommended_actions ?? analysis.next_steps),
    evidenceToCollect: toStringArray(analysis.evidence_to_collect ?? analysis.evidenceToCollect),
    precedentCards,
    disclaimer: String(analysis.disclaimer ?? '법률 자문이 아닌 참고용 안내입니다.'),
    meta,
    timeline: normalizeTimeline(root.timeline),
    sourceLabel: formatSourceLabel(draft.mode),
  };
}

function ModeButton({
  active,
  label,
  subtitle,
  onClick,
}: {
  active: boolean;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`mode-button ${active ? 'mode-button-active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <span>{label}</span>
      <small>{subtitle}</small>
    </button>
  );
}

function ContextButton({
  active,
  label,
  subtitle,
  onClick,
}: {
  active: boolean;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`context-button ${active ? 'context-button-active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <strong>{label}</strong>
      <span>{subtitle}</span>
    </button>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'danger' | 'accent' | 'warn';
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  note?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {note ? <span className="field-note">{note}</span> : null}
      <input
        className="input"
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 8,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  note?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {note ? <span className="field-note">{note}</span> : null}
      <textarea
        className="textarea"
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PolicyRule({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className={`policy-rule ${passed ? 'policy-rule-pass' : 'policy-rule-miss'}`}>
      <span className="policy-rule-state">{passed ? 'OK' : '필요'}</span>
      <strong>{label}</strong>
    </div>
  );
}

function StageRow({
  stage,
  status,
}: {
  stage: { id: PipelineStage; label: string; subtitle: string };
  status: 'done' | 'active' | 'pending';
}) {
  return (
    <div className={`pipeline-row pipeline-row-${status}`}>
      <div className="pipeline-index">{stage.label.slice(0, 2).toUpperCase()}</div>
      <div className="pipeline-copy">
        <strong>{stage.label}</strong>
        <span>{stage.subtitle}</span>
      </div>
      <span className={`pipeline-state pipeline-state-${status}`}>
        {status === 'done' ? '완료' : status === 'active' ? '진행' : '대기'}
      </span>
    </div>
  );
}

function RiskMeter({ level }: { level: number }) {
  const clamped = Math.max(1, Math.min(5, level || 1));
  return (
    <div className="risk-meter" aria-label={`위험도 Lv.${clamped}`}>
      {[1, 2, 3, 4, 5].map((bar) => (
        <span key={bar} className={`risk-meter-bar ${bar <= clamped ? 'risk-meter-bar-fill' : ''}`} />
      ))}
    </div>
  );
}

function FilePreview({
  image,
  onClear,
  onPick,
}: {
  image: DraftImage | null;
  onClear: () => void;
  onPick: () => void;
}) {
  return (
    <div className={`dropzone ${image ? 'dropzone-active' : ''}`} role="button" tabIndex={0} onClick={onPick}>
      {image ? (
        <div className="dropzone-preview">
          <img className="dropzone-image" src={image.preview} alt={image.name} />
          <div className="dropzone-meta">
            <strong>{image.name}</strong>
            <span>{formatBytes(image.size)}</span>
            <span>{image.type || 'image/*'}</span>
            <button className="ghost-btn" type="button" onClick={(event) => { event.stopPropagation(); onClear(); }}>
              제거
            </button>
          </div>
        </div>
      ) : (
        <div className="dropzone-empty">
          <strong>캡처 이미지를 드래그하거나 클릭해서 추가</strong>
          <span>OCR 전 단계에서 이미지 원본과 메모를 함께 묶습니다.</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [authBaseUrl, setAuthBaseUrl] = useState(() => getInitialAuthBaseUrl());
  const [authBaseUrlInput, setAuthBaseUrlInput] = useState(() => getInitialAuthBaseUrl());
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [storedToken, setStoredToken] = useState<string | null>(() => loadStoredToken());
  const [session, setSession] = useState<SessionState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [statusMessage, setStatusMessage] = useState(
    '사건 파일을 입력하면 OCR, 분류, 법령, 판례, 판단이 한 화면에서 이어집니다.',
  );
  const [busy, setBusy] = useState<BusyAction>(null);
  const [draft, setDraft] = useState<DraftCase>({
    title: '새 사건 파일',
    contextType: 'messenger',
    mode: 'text',
    bodyText: '',
    linkUrl: '',
    image: null,
  });
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [animationIndex, setAnimationIndex] = useState(0);
  const [historyItems, setHistoryItems] = useState<AnalysisHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const signupPolicy = evaluatePasswordPolicy(signupPassword);
  const endpointDraft = normalizeBaseUrlDraft(authBaseUrlInput) || DEFAULT_AUTH_BASE_URL;
  const endpointDirty = endpointDraft !== authBaseUrl;
  const analysisBaseUrl = normalizeBaseUrlDraft(authBaseUrl) || DEFAULT_ANALYSIS_BASE_URL;
  const authHealthLabel = health
    ? `${health.service} ${new Date(health.time).toLocaleTimeString('ko-KR')}`
    : '미확인';

  useEffect(() => {
    const token = storedToken;
    if (!token) {
      return;
    }

    let active = true;
    setBusy('restore');
    fetchMe(authBaseUrl, token)
      .then((response) => {
        if (!active) {
          return;
        }

        setSession({
          user: response.user,
          token,
          issuedAt: new Date().toISOString(),
          expiresIn: 0,
          tokenType: response.token_type,
        });
        setStatusTone('success');
        setStatusMessage(`${response.user.email} 계정으로 세션을 복원했습니다.`);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        if (error instanceof Error && /unauthorized/i.test(error.message)) {
          clearStoredToken();
          setStoredToken(null);
        }

        setSession(null);
        setStatusTone('danger');
        setStatusMessage(error instanceof Error ? error.message : '세션 복원에 실패했습니다.');
      })
      .finally(() => {
        if (active) {
          setBusy(null);
        }
      });

    return () => {
      active = false;
    };
  }, [authBaseUrl, storedToken]);

  useEffect(() => {
    if (busy !== 'analyze') {
      setAnimationIndex(analysisResult ? PIPELINE_STAGES.length : 0);
      return;
    }

    setAnimationIndex(0);
    const timer = window.setInterval(() => {
      setAnimationIndex((current) => Math.min(current + 1, PIPELINE_STAGES.length - 1));
    }, 420);

    return () => {
      window.clearInterval(timer);
    };
  }, [analysisResult, busy]);

  useEffect(() => {
    const token = session?.token;
    if (!token) {
      setHistoryItems([]);
      return;
    }

    let active = true;
    setHistoryLoading(true);

    fetchHistory(analysisBaseUrl, token)
      .then((items) => {
        if (active) {
          setHistoryItems(items);
        }
      })
      .catch(() => {
        if (active) {
          setHistoryItems([]);
        }
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [analysisBaseUrl, session?.token]);

  function applyAuthResponse(response: AuthResponse, message: string) {
    saveStoredToken(response.token);
    setStoredToken(response.token);
    setSession({
      user: response.user,
      token: response.token,
      issuedAt: response.issued_at,
      expiresIn: response.expires_in,
      tokenType: response.token_type,
    });
    setStatusTone('success');
    setStatusMessage(message);
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!signupPolicy.valid) {
      setStatusTone('danger');
      setStatusMessage(PASSWORD_POLICY_HINT);
      return;
    }

    setBusy('signup');
    setStatusTone('neutral');
    setStatusMessage('회원가입을 처리하고 있습니다...');

    try {
      const response = await signup(authBaseUrl, {
        email: signupEmail,
        password: signupPassword,
      });
      applyAuthResponse(response, '회원가입 후 세션을 자동으로 열었습니다.');
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : '회원가입에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('login');
    setStatusTone('neutral');
    setStatusMessage('로그인 중입니다...');

    try {
      const response = await login(authBaseUrl, {
        email: loginEmail,
        password: loginPassword,
      });
      applyAuthResponse(response, '로그인이 완료되었습니다.');
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : '로그인에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }

  async function handleHealthCheck() {
    setBusy('health');
    setStatusTone('neutral');
    setStatusMessage('Auth health를 검사하고 있습니다...');

    try {
      const response = await checkHealth(endpointDraft);
      setHealth(response);
      setStatusTone('success');
      setStatusMessage(`Auth API가 ${new Date(response.time).toLocaleTimeString('ko-KR')} 기준으로 응답했습니다.`);
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : 'Health check에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }

  function handleSaveEndpoint() {
    const next = saveAuthBaseUrl(endpointDraft);
    setAuthBaseUrl(next);
    setAuthBaseUrlInput(next);
    setStatusTone('success');
    setStatusMessage(`Auth endpoint를 ${next} 로 저장했습니다.`);
  }

  function handleResetEndpoint() {
    setAuthBaseUrlInput(DEFAULT_AUTH_BASE_URL);
    setAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    saveAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    setStatusTone('neutral');
    setStatusMessage('Auth endpoint를 기본값으로 되돌렸습니다.');
  }

  function handleLogout() {
    clearStoredToken();
    setStoredToken(null);
    setSession(null);
    setHistoryItems([]);
    setStatusTone('neutral');
    setStatusMessage('세션을 해제했습니다.');
  }

  function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({
        ...current,
        mode: 'image',
        image: {
          name: file.name,
          size: file.size,
          type: file.type,
          preview: String(reader.result ?? ''),
        },
      }));
    };
    reader.readAsDataURL(file);
  }

  function loadSample(mode: InputMode) {
    if (mode === 'text') {
      setDraft({
        title: '커뮤니티 게시글 쟁점 검토',
        contextType: 'community',
        mode: 'text',
        bodyText: SAMPLE_TEXT,
        linkUrl: '',
        image: null,
      });
      setAnalysisError(null);
      return;
    }

    if (mode === 'link') {
      setDraft({
        title: '링크 크롤링 검토',
        contextType: 'other',
        mode: 'link',
        bodyText: '게시글 전체 문맥과 댓글 구조를 확인해야 합니다.',
        linkUrl: SAMPLE_LINK,
        image: null,
      });
      setAnalysisError(null);
      return;
    }

    setDraft({
      title: '메신저 캡처 OCR 검토',
      contextType: 'messenger',
      mode: 'image',
      bodyText: '상대방이 여러 차례 반복적으로 협박과 모욕을 했다는 정황이 보입니다.',
      linkUrl: '',
      image: {
        name: 'sample-messenger.png',
        size: 248_112,
        type: 'image/png',
        preview:
          'data:image/svg+xml;charset=UTF-8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="560">
              <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#f8f2e8"/>
                  <stop offset="100%" stop-color="#dfe7f2"/>
                </linearGradient>
              </defs>
              <rect width="920" height="560" fill="url(#bg)"/>
              <rect x="66" y="70" width="788" height="420" rx="26" fill="#ffffff" stroke="#163552" stroke-width="3"/>
              <rect x="110" y="116" width="280" height="34" rx="17" fill="#163552"/>
              <rect x="110" y="184" width="604" height="18" rx="9" fill="#9bb0c9"/>
              <rect x="110" y="228" width="520" height="18" rx="9" fill="#c5d0df"/>
              <rect x="110" y="272" width="476" height="18" rx="9" fill="#c5d0df"/>
              <rect x="110" y="316" width="566" height="18" rx="9" fill="#c5d0df"/>
              <rect x="110" y="360" width="420" height="18" rx="9" fill="#c5d0df"/>
              <text x="110" y="92" fill="#163552" font-size="28" font-family="serif">OCR Sample</text>
              <text x="110" y="456" fill="#5d6877" font-size="24" font-family="sans-serif">이미지 업로드 시 OCR Agent 연결 예정</text>
            </svg>`,
          ),
      },
    });
    setAnalysisError(null);
  }

  function resetDraft() {
    setDraft({
      title: '새 사건 파일',
      contextType: 'messenger',
      mode: 'text',
      bodyText: '',
      linkUrl: '',
      image: null,
    });
    setAnalysisResult(null);
    setAnalysisError(null);
    setStatusTone('neutral');
    setStatusMessage('사건 파일을 비웠습니다.');
  }

  function composeAnalysisText(nextDraft: DraftCase) {
    const parts = [
      `사건 제목: ${nextDraft.title}`,
      `분류: ${formatContextLabel(nextDraft.contextType)}`,
      `입력 방식: ${formatSourceLabel(nextDraft.mode)}`,
    ];

    if (nextDraft.mode === 'text' && nextDraft.bodyText.trim()) {
      parts.push(`원문:\n${nextDraft.bodyText.trim()}`);
    }

    if (nextDraft.mode === 'image') {
      parts.push(`이미지 파일: ${nextDraft.image ? `${nextDraft.image.name} (${formatBytes(nextDraft.image.size)})` : '첨부되지 않음'}`);
      if (nextDraft.bodyText.trim()) {
        parts.push(`OCR 메모:\n${nextDraft.bodyText.trim()}`);
      }
    }

    if (nextDraft.mode === 'link') {
      parts.push(`링크: ${nextDraft.linkUrl.trim()}`);
      if (nextDraft.bodyText.trim()) {
        parts.push(`크롤링 메모:\n${nextDraft.bodyText.trim()}`);
      }
    }

    return parts.join('\n\n').trim();
  }

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token) {
      setAnalysisError('로그인 후 사건 분석을 시작할 수 있습니다.');
      setStatusTone('danger');
      setStatusMessage('분석을 시작하려면 로그인 또는 회원가입이 필요합니다.');
      return;
    }

    const hasText = draft.bodyText.trim().length > 0;
    const hasImage = draft.mode === 'image' && Boolean(draft.image);
    const hasLink = draft.mode === 'link' && draft.linkUrl.trim().length > 0;

    if (draft.mode === 'text' && !hasText) {
      setAnalysisError('텍스트를 입력한 뒤 분석을 시작하세요.');
      return;
    }

    if (draft.mode === 'image' && !hasImage) {
      setAnalysisError('이미지 파일을 먼저 추가한 뒤 분석을 시작하세요.');
      return;
    }

    if (draft.mode === 'link' && !hasLink && !hasText) {
      setAnalysisError('링크 주소 또는 크롤링 메모를 먼저 넣어주세요.');
      return;
    }

    setBusy('analyze');
    setAnalysisError(null);
    setStatusTone('neutral');
    setStatusMessage('OCR, 분류, 법령, 판례, 판단 순서로 분석하고 있습니다...');

    try {
      const payload =
        draft.mode === 'image'
          ? await analyzeCase(analysisBaseUrl, session.token, {
              title: draft.title,
              context_type: draft.contextType,
              input_mode: 'image',
              text: draft.bodyText.trim(),
              image_base64: draft.image?.preview,
              image_name: draft.image?.name,
              image_mime_type: draft.image?.type,
            })
          : draft.mode === 'link'
            ? await analyzeCase(analysisBaseUrl, session.token, {
                title: draft.title,
                context_type: draft.contextType,
                input_mode: 'link',
                text: draft.bodyText.trim(),
                url: draft.linkUrl.trim(),
              })
            : await analyzeCase(analysisBaseUrl, session.token, {
                title: draft.title,
                context_type: draft.contextType,
                input_mode: 'text',
                text: composeAnalysisText(draft),
              });
      const normalized = normalizeAnalysisResponse(payload, draft);
      setAnalysisResult(normalized);
      setAnalysisError(null);
      setStatusTone('success');
      setStatusMessage('분석 결과를 불러왔습니다.');
      const nextHistory = await fetchHistory(analysisBaseUrl, session.token);
      setHistoryItems(nextHistory);
    } catch (error) {
      setAnalysisResult(null);
      setAnalysisError(error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.');
      setStatusTone('danger');
      setStatusMessage(
        error instanceof Error
          ? `분석 요청에 실패했습니다. (${error.message})`
          : '분석 요청에 실패했습니다.',
      );
    } finally {
      setBusy(null);
    }
  }

  const pipelineStatus = PIPELINE_STAGES.map((stage, index) => {
    if (analysisResult) {
      return { stage, status: 'done' as const };
    }

    if (busy === 'analyze') {
      if (index < animationIndex) {
        return { stage, status: 'done' as const };
      }

      if (index === animationIndex) {
        return { stage, status: 'active' as const };
      }

      return { stage, status: 'pending' as const };
    }

    return {
      stage,
      status: index === 0 && analysisResult ? ('done' as const) : ('pending' as const),
    };
  });

  const currentSourceChip = draft.mode === 'image' ? '이미지 OCR' : draft.mode === 'link' ? '링크 크롤링' : '텍스트 분석';
  const activeContext = formatContextLabel(draft.contextType);
  const result = analysisResult;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">K</div>
          <div className="brand-copy">
            <p className="brand-kicker">KoreanLaw / legal intelligence workspace</p>
            <h1 className="brand-name">KoreanLaw</h1>
            <p className="brand-subtitle">사건 파일 · OCR · 법령 · 판례 · 판단이 한 화면에서 이어집니다</p>
          </div>
        </div>
        <div className="topbar-right">
          <Pill tone={session ? 'success' : 'neutral'}>{session ? session.user.email : '로그인 필요'}</Pill>
          <Pill tone="accent">{authHealthLabel}</Pill>
          <Pill tone="warn">{currentSourceChip}</Pill>
        </div>
      </header>

      <main className="workspace">
        <section className="hero-panel panel">
          <div className="hero-copy">
            <p className="hero-label">6-agent pipeline · auth ready · case-first UX</p>
            <h2 className="hero-title">캡처, 텍스트, 링크를 한 사건 파일로 묶어 법적 판단까지 끌고 갑니다.</h2>
            <p className="hero-text">
              KoreanLaw는 로그인과 세션 복원을 유지하면서, OCR Agent, Classifier Agent, Law Search
              Agent, Precedent Agent, Legal Analysis Agent의 흐름을 한 화면 안에 보여주는 법률
              작업대입니다.
            </p>
            <div className="hero-meta">
              <Pill tone="neutral">{activeContext}</Pill>
              <Pill tone="neutral">{draft.title}</Pill>
              <Pill tone="neutral">{session ? '세션 복원됨' : '세션 대기'}</Pill>
            </div>
          </div>

          <div className="hero-rail">
            <div className="hero-stat-row">
              <div className="hero-stat">
                <strong className="hero-stat-value">3</strong>
                <span className="hero-stat-label">입력 방식</span>
              </div>
              <div className="hero-stat">
                <strong className="hero-stat-value">6</strong>
                <span className="hero-stat-label">에이전트 단계</span>
              </div>
              <div className="hero-stat">
                <strong className="hero-stat-value">1</strong>
                <span className="hero-stat-label">Auth / DB 계층</span>
              </div>
            </div>

            <div className="hero-rule">
              <span className="tiny-label">작업 원칙</span>
              <p className="hero-rule-note">
                이메일 + 비밀번호로 계정을 만들고, 캡처 이미지는 OCR 슬롯으로, 링크는 크롤링 슬롯으로,
                텍스트는 본문 슬롯으로 들어갑니다.
              </p>
            </div>
          </div>
        </section>

        <section className="studio-grid">
          <div className="main-column">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Case Desk</p>
                  <h3 className="panel-title">사건 입력</h3>
                  <p className="panel-subtitle">텍스트, 이미지, 링크를 하나의 파일로 묶어서 분석에 넘깁니다.</p>
                </div>
                <div className="chip-row">
                  <Pill tone={draft.mode === 'text' ? 'accent' : 'neutral'}>텍스트</Pill>
                  <Pill tone={draft.mode === 'image' ? 'accent' : 'neutral'}>이미지</Pill>
                  <Pill tone={draft.mode === 'link' ? 'accent' : 'neutral'}>링크</Pill>
                </div>
              </div>

              <div className="input-row">
                {INPUT_MODES.map((item) => (
                  <ModeButton
                    key={item.value}
                    active={draft.mode === item.value}
                    label={item.label}
                    subtitle={item.subtitle}
                    onClick={() => setDraft((current) => ({ ...current, mode: item.value }))}
                  />
                ))}
              </div>

              <div className="input-grid">
                <Field
                  label="사건 제목"
                  value={draft.title}
                  onChange={(value) => setDraft((current) => ({ ...current, title: value }))}
                  placeholder="예: 메신저 협박 / 게시글 명예훼손"
                />

                <div className="field">
                  <span className="field-label">사건 출처</span>
                  <div className="context-row">
                    {CONTEXT_OPTIONS.map((item) => (
                      <ContextButton
                        key={item.value}
                        active={draft.contextType === item.value}
                        label={item.label}
                        subtitle={item.subtitle}
                        onClick={() => setDraft((current) => ({ ...current, contextType: item.value }))}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="panel-divider" />

              {draft.mode === 'text' ? (
                <TextAreaField
                  label="분석할 텍스트"
                  note="복사한 원문, 게시글, 대화 내용을 그대로 넣으세요."
                  value={draft.bodyText}
                  onChange={(value) => setDraft((current) => ({ ...current, bodyText: value }))}
                  placeholder="상대방이 어떤 표현을 했는지, 게시 범위가 어떤지, 피해가 어떤지 적어주세요."
                  rows={10}
                />
              ) : null}

              {draft.mode === 'image' ? (
                <div className="field">
                  <span className="field-label">캡처 이미지</span>
                  <span className="field-note">이미지 파일을 올리면 OCR Agent 슬롯이 채워집니다.</span>
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                  />
                  <FilePreview
                    image={draft.image}
                    onPick={() => fileInputRef.current?.click()}
                    onClear={() => setDraft((current) => ({ ...current, image: null }))}
                  />
                  <TextAreaField
                    label="OCR 메모"
                    note="이미지 안에서 눈에 띄는 문장, 발화자, 반복성을 메모로 남기세요."
                    value={draft.bodyText}
                    onChange={(value) => setDraft((current) => ({ ...current, bodyText: value }))}
                    placeholder="예: 상대가 '사기꾼'이라고 여러 번 말했고, 전화번호 공개를 언급했다."
                    rows={5}
                  />
                </div>
              ) : null}

              {draft.mode === 'link' ? (
                <div className="field">
                  <span className="field-label">분석할 링크</span>
                  <span className="field-note">링크를 보내면 후속 crawler agent 슬롯으로 이어질 수 있습니다.</span>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
                    value={draft.linkUrl}
                    onChange={(event) => setDraft((current) => ({ ...current, linkUrl: event.target.value }))}
                  />
                  <div className="dropzone dropzone-active">
                    <div className="dropzone-empty">
                      <strong>{draft.linkUrl.trim() || '링크 미입력'}</strong>
                      <span>{draft.linkUrl.trim() ? '크롤링 슬롯이 이 주소를 기준으로 동작합니다.' : 'URL을 넣으면 원문 구조와 댓글 흐름을 함께 읽을 수 있습니다.'}</span>
                    </div>
                  </div>
                  <TextAreaField
                    label="링크 메모"
                    note="무엇을 확인해야 하는지 한 줄만 적어도 충분합니다."
                    value={draft.bodyText}
                    onChange={(value) => setDraft((current) => ({ ...current, bodyText: value }))}
                    placeholder="예: 작성자, 댓글 흐름, 삭제 여부를 확인하고 싶습니다."
                    rows={4}
                  />
                </div>
              ) : null}

              {analysisError ? <div className="status-banner status-banner-danger">{analysisError}</div> : null}

              <div className="launch-bar">
                <div className="launch-copy">
                  <span className="tiny-label">입력 상태</span>
                  <strong>{draft.mode === 'image' ? (draft.image ? '이미지 준비됨' : '이미지를 추가하세요') : draft.mode === 'link' ? (draft.linkUrl.trim() ? '링크 준비됨' : '링크를 추가하세요') : draft.bodyText.trim() ? '텍스트 준비됨' : '텍스트를 추가하세요'}</strong>
                  <p>{statusMessage}</p>
                </div>
                <div className="launch-actions">
                  <button className="secondary-btn" type="button" onClick={() => loadSample('text')}>
                    텍스트 예시
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => loadSample('image')}>
                    이미지 예시
                  </button>
                  <button className="secondary-btn" type="button" onClick={() => loadSample('link')}>
                    링크 예시
                  </button>
                  <button className="ghost-btn" type="button" onClick={resetDraft}>
                    파일 초기화
                  </button>
                </div>
              </div>

              <form onSubmit={handleAnalyze} className="panel-foot">
                <button className="primary-btn" type="submit" disabled={busy === 'analyze'}>
                  {busy === 'analyze' ? '분석 중...' : '사건 분석 시작'}
                </button>
              </form>
            </article>

            <article className="panel result-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Decision Rail</p>
                  <h3 className="panel-title">분석 결과</h3>
                  <p className="panel-subtitle">
                    OCR, 분류, 법령, 판례, 판단 결과를 한 번에 읽을 수 있도록 재배치했습니다.
                  </p>
                </div>
                <div className="chip-row">
                  <Pill tone={result?.meta?.provider_mode === 'local' ? 'warn' : 'success'}>
                    {result?.meta?.provider_mode === 'local' ? '로컬 초안' : 'API 연결됨'}
                  </Pill>
                  <Pill tone={result?.canSue ? 'success' : 'neutral'}>{result?.canSue ? '고소 검토 가능' : '추가 검토 필요'}</Pill>
                </div>
              </div>

              {result ? (
                <>
                  <div className="result-banner">
                    <div className="result-banner-main">
                      <RiskMeter level={result.riskLevel} />
                      <div>
                        <span className="tiny-label">핵심 판단</span>
                        <h4>{result.summary}</h4>
                        <p>{result.canSue ? '증거를 묶으면 실무 검토를 바로 시작할 수 있습니다.' : '추가 사실관계를 보강하면 판단 품질이 올라갑니다.'}</p>
                      </div>
                    </div>
                    <div className="result-meta">
                      <div className="result-meta-item">
                        <span className="result-meta-label">입력 방식</span>
                        <strong className="result-meta-value">{result.sourceLabel}</strong>
                      </div>
                      <div className="result-meta-item">
                        <span className="result-meta-label">분류</span>
                        <strong className="result-meta-value">{activeContext}</strong>
                      </div>
                      <div className="result-meta-item">
                        <span className="result-meta-label">생성 시각</span>
                        <strong className="result-meta-value">
                          {result.meta?.generated_at ? formatIssuedAt(result.meta.generated_at) : '확인 전'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="result-grid">
                    <section className="result-card">
                      <div className="result-card-head">
                        <div>
                          <p className="panel-kicker">쟁점 카드</p>
                          <h4 className="result-card-title">법적 쟁점</h4>
                        </div>
                        <Pill tone="accent">{result.issueCards.length}건</Pill>
                      </div>
                      <div className="result-list">
                        {result.issueCards.map((item) => (
                          <article className="result-list-item" key={`${item.title}-${item.basis}`}>
                            <div className="result-list-bullet" />
                            <div>
                              <strong>{item.title}</strong>
                              <p>{item.basis}</p>
                              <div className="chip-row">
                                <Pill tone={item.probability === 'high' ? 'danger' : item.probability === 'medium' ? 'warn' : 'neutral'}>
                                  {item.probability === 'high' ? '높음' : item.probability === 'medium' ? '보통' : '낮음'}
                                </Pill>
                                <span className="session-key">{item.expected_penalty}</span>
                              </div>
                              {item.checklist.length > 0 ? (
                                <ul className="mini-list">
                                  {item.checklist.map((line) => (
                                    <li key={line} className="mini-list-item">
                                      <span className="mini-list-dot" />
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="result-card">
                      <div className="result-card-head">
                        <div>
                          <p className="panel-kicker">판례 카드</p>
                          <h4 className="result-card-title">유사 판례</h4>
                        </div>
                        <Pill tone="neutral">similarity</Pill>
                      </div>
                      <div className="result-list">
                        {result.precedentCards.map((item) => (
                          <article className="result-list-item" key={`${item.case_no}-${item.court}`}>
                            <div className="result-list-bullet" />
                            <div>
                              <strong>{item.case_no}</strong>
                              <p>
                                {item.court} · {item.verdict} · {formatSimilarity(item.similarity_score)}
                              </p>
                              <span>{item.summary}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="result-card">
                      <div className="result-card-head">
                        <div>
                          <p className="panel-kicker">Evidence Stack</p>
                          <h4 className="result-card-title">증거 체크리스트</h4>
                        </div>
                        <Pill tone="warn">{result.evidenceToCollect.length}</Pill>
                      </div>
                      <ul className="bullet-stack">
                        {result.evidenceToCollect.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>

                    <section className="result-card">
                      <div className="result-card-head">
                        <div>
                          <p className="panel-kicker">Action Plan</p>
                          <h4 className="result-card-title">권장 대응</h4>
                        </div>
                        <Pill tone="success">{result.recommendedActions.length}</Pill>
                      </div>
                      <ul className="bullet-stack">
                        {result.recommendedActions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  </div>

                  <section className="pipeline-panel-inner">
                    <div className="panel-head">
                      <div>
                        <p className="panel-kicker">Pipeline Trace</p>
                        <h4 className="result-card-title">에이전트 진행 상태</h4>
                      </div>
                      <Pill tone={result.timeline.length > 0 ? 'success' : 'neutral'}>
                        {result.timeline.length > 0 ? '실제 타임라인' : '작업 타임라인 없음'}
                      </Pill>
                    </div>
                    <div className="pipeline-list">
                      {pipelineStatus.map(({ stage, status }) => (
                        <StageRow key={stage.id} stage={stage} status={status} />
                      ))}
                    </div>
                  </section>

                  <div className="status-banner status-banner-neutral">
                    <strong>Disclaimer</strong>
                    <p>{result.disclaimer}</p>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h4 className="empty-state-title">아직 결과가 없습니다.</h4>
                  <p className="empty-state-copy">
                    텍스트, 이미지, 링크 중 하나를 넣고 분석을 시작하면 이 영역에 법적 쟁점, 판례, 증거,
                    권장 대응이 표시됩니다.
                  </p>
                </div>
              )}
            </article>
          </div>

          <aside className="rail">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Access</p>
                  <h3 className="panel-title">회원가입 / 로그인</h3>
                  <p className="panel-subtitle">Auth session은 로컬 저장소와 JWT 검증으로 유지됩니다.</p>
                </div>
                <div className="auth-tabs">
                  <button
                    className={`mode-button ${authMode === 'signup' ? 'mode-button-active' : ''}`}
                    type="button"
                    onClick={() => setAuthMode('signup')}
                  >
                    회원가입
                  </button>
                  <button
                    className={`mode-button ${authMode === 'login' ? 'mode-button-active' : ''}`}
                    type="button"
                    onClick={() => setAuthMode('login')}
                  >
                    로그인
                  </button>
                </div>
              </div>

              <form className="auth-form" onSubmit={authMode === 'signup' ? handleSignup : handleLogin}>
                <Field
                  label="이메일"
                  value={authMode === 'signup' ? signupEmail : loginEmail}
                  onChange={authMode === 'signup' ? setSignupEmail : setLoginEmail}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                />
                <Field
                  label="비밀번호"
                  value={authMode === 'signup' ? signupPassword : loginPassword}
                  onChange={authMode === 'signup' ? setSignupPassword : setLoginPassword}
                  type="password"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="9자 이상, 영문+숫자+특수문자"
                  note={authMode === 'signup' ? PASSWORD_POLICY_HINT : '가입한 비밀번호를 입력하세요.'}
                />

                {authMode === 'signup' ? (
                  <div className="policy-grid">
                    <PolicyRule label="9자 이상" passed={signupPolicy.minLength} />
                    <PolicyRule label="영문 포함" passed={signupPolicy.hasLetter} />
                    <PolicyRule label="숫자 포함" passed={signupPolicy.hasNumber} />
                    <PolicyRule label="특수문자 포함" passed={signupPolicy.hasSpecial} />
                  </div>
                ) : null}

                <button
                  className="primary-btn"
                  type="submit"
                  disabled={busy === 'signup' || busy === 'login' || (authMode === 'signup' && !signupPolicy.valid)}
                >
                  {busy === 'signup' ? '가입 처리 중...' : busy === 'login' ? '로그인 처리 중...' : authMode === 'signup' ? '회원가입' : '로그인'}
                </button>
              </form>

              <div className={`status-banner status-banner-${statusTone}`}>
                <strong>{statusTone === 'success' ? 'Ready' : statusTone === 'danger' ? '주의' : '상태'}</strong>
                <p>{statusMessage}</p>
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Session</p>
                  <h3 className="panel-title">세션 / 엔드포인트</h3>
                  <p className="panel-subtitle">계정, 토큰, health check, 저장된 endpoint를 함께 관리합니다.</p>
                </div>
                <Pill tone={session ? 'success' : 'neutral'}>{session ? 'signed in' : 'guest'}</Pill>
              </div>

              <Field
                label="Auth API Base URL"
                value={authBaseUrlInput}
                onChange={setAuthBaseUrlInput}
                placeholder="http://localhost:3001"
                note="회원가입 / 로그인 / 세션 복원에 사용되는 주소입니다."
              />

              <div className="button-row">
                <button className="secondary-btn" type="button" onClick={handleSaveEndpoint} disabled={!endpointDirty}>
                  저장
                </button>
                <button className="ghost-btn" type="button" onClick={handleResetEndpoint}>
                  초기화
                </button>
                <button className="ghost-btn" type="button" onClick={handleHealthCheck} disabled={busy === 'health'}>
                  {busy === 'health' ? '확인 중...' : 'Health'}
                </button>
              </div>

              {session ? (
                <div className="session-card">
                  <div className="session-grid">
                    <div className="session-cell">
                      <span className="session-key">User</span>
                      <strong className="session-value">{session.user.email}</strong>
                    </div>
                    <div className="session-cell">
                      <span className="session-key">Token</span>
                      <div className="session-token-row">
                        <code className="session-token">{formatTokenPreview(session.token)}</code>
                        <button
                          className="copy-btn"
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(session.token);
                            setStatusTone('success');
                            setStatusMessage('토큰을 클립보드에 복사했습니다.');
                          }}
                        >
                          copy
                        </button>
                      </div>
                    </div>
                    <div className="session-cell">
                      <span className="session-key">Issued</span>
                      <strong className="session-value">{formatIssuedAt(session.issuedAt)}</strong>
                    </div>
                    <div className="session-cell">
                      <span className="session-key">Expires</span>
                      <strong className="session-value">
                        {session.expiresIn > 0 ? `${Math.round(session.expiresIn / 3600)}h` : 'unknown'}
                      </strong>
                    </div>
                  </div>
                  <div className="session-actions">
                    <Pill tone="neutral">{session.tokenType}</Pill>
                    <button className="ghost-btn" type="button" onClick={handleLogout}>
                      로그아웃
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <h4 className="empty-state-title">세션이 아직 없습니다.</h4>
                  <p className="empty-state-copy">
                    회원가입 또는 로그인 후 저장된 토큰을 이용해 세션이 자동 복원됩니다.
                  </p>
                </div>
              )}
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Pipeline</p>
                  <h3 className="panel-title">멀티에이전트 레일</h3>
                  <p className="panel-subtitle">현재 6단계 구조를 한눈에 확인할 수 있습니다.</p>
                </div>
                <Pill tone={analysisResult ? 'success' : 'neutral'}>{analysisResult ? '완료' : '대기'}</Pill>
              </div>

              <div className="pipeline-list">
                {pipelineStatus.map(({ stage, status }) => (
                  <StageRow key={stage.id} stage={stage} status={status} />
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Ops</p>
                  <h3 className="panel-title">연결 정보</h3>
                  <p className="panel-subtitle">DB, 분석 API, OCR, 크롤러 슬롯을 붙이기 위한 기준점입니다.</p>
                </div>
              </div>

              <div className="ops-grid">
                <div className="ops-item">
                  <span className="ops-item-label">Auth</span>
                  <strong className="ops-item-value">{authBaseUrl}</strong>
                </div>
                <div className="ops-item">
                  <span className="ops-item-label">Analysis</span>
                  <strong className="ops-item-value">{analysisBaseUrl}</strong>
                </div>
                <div className="ops-item">
                  <span className="ops-item-label">DB</span>
                  <strong className="ops-item-value">PostgreSQL / Docker</strong>
                </div>
                <div className="ops-item">
                  <span className="ops-item-label">Crawler</span>
                  <strong className="ops-item-value">Link slot ready</strong>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">History</p>
                  <h3 className="panel-title">최근 분석</h3>
                  <p className="panel-subtitle">로그인한 사용자 기준으로 저장된 최근 케이스입니다.</p>
                </div>
                <Pill tone={historyItems.length > 0 ? 'success' : 'neutral'}>
                  {historyLoading ? '불러오는 중' : `${historyItems.length}건`}
                </Pill>
              </div>

              {historyItems.length > 0 ? (
                <div className="result-list">
                  {historyItems.map((item) => (
                    <article className="result-list-item" key={item.caseId}>
                      <div className="result-list-bullet" />
                      <div>
                        <strong>{item.title}</strong>
                        <p>
                          {item.inputMode} · 위험도 {item.riskLevel || 0} ·{' '}
                          {new Date(item.createdAt).toLocaleString('ko-KR')}
                        </p>
                        <span>{item.summary}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h4 className="empty-state-title">저장된 분석이 아직 없습니다.</h4>
                  <p className="empty-state-copy">
                    로그인 후 분석을 실행하면 이 영역에 최근 케이스가 누적됩니다.
                  </p>
                </div>
              )}
            </article>
          </aside>
        </section>
      </main>
    </div>
  );
}
