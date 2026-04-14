import { useEffect, useState, type FormEvent } from 'react';

import './styles.css';
import {
  DEFAULT_AUTH_BASE_URL,
  requestEmailCode,
  analyzeCase,
  clearStoredToken,
  evaluatePasswordPolicy,
  fetchMe,
  getInitialAuthBaseUrl,
  getInitialGuestSession,
  loadStoredToken,
  login,
  saveGuestSession,
  saveStoredToken,
  signup,
  type AnalyzeCaseResponse,
  type AnalysisLegalResult,
  type AnalysisReferenceItem,
  type AuthResponse,
  type AuthUser,
  type GuestSession,
} from './lib/auth';

const AUTH_BASE_URL = getInitialAuthBaseUrl();
const ANALYSIS_BASE_URL = import.meta.env.VITE_ANALYSIS_BASE_URL ?? AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL;

type ContextType = 'community' | 'game_chat' | 'messenger' | 'other';
type View = 'input' | 'analyzing' | 'results' | 'signup' | 'login';
type AuthMode = 'login' | 'signup';

type Charge = {
  charge: string;
  basis: string;
  elements_met: string[];
  probability: 'high' | 'medium' | 'low';
  expected_penalty: string;
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
  reference_library?: AnalysisReferenceItem[];
  referenceLibrary?: AnalysisReferenceItem[];
  references?: AnalysisReferenceItem[];
  [key: string]: unknown;
};

type AnalysisResult = {
  can_sue: boolean;
  risk_level: number;
  summary: string;
  charges: Charge[];
  recommended_actions: string[];
  evidence_to_collect: string[];
  precedent_cards: PrecedentCard[];
  disclaimer: string;
  reference_library?: AnalysisReferenceItem[];
  law_reference_library?: AnalysisReferenceItem[];
  precedent_reference_library?: AnalysisReferenceItem[];
};

type PendingAnalysis = {
  text: string;
  contextType: ContextType;
};

type DetailReference = {
  kind?: string;
  title: string;
  summary: string;
  url?: string;
  href?: string;
  subtitle?: string;
};

type DetailPanelData = {
  eyebrow: string;
  title: string;
  summary: string;
  metadata: Array<{ label: string; value: string }>;
  highlights: string[];
  references: DetailReference[];
};

const CONTEXT_OPTIONS: { value: ContextType; label: string; icon: string; desc: string }[] = [
  { value: 'community', label: '커뮤니티', icon: '📋', desc: '인터넷 게시글·댓글' },
  { value: 'game_chat', label: '게임 채팅', icon: '🎮', desc: '인게임 채팅·메시지' },
  { value: 'messenger', label: '메신저', icon: '💬', desc: '카카오톡·라인 등' },
  { value: 'other', label: '기타', icon: '📄', desc: '그 외 온라인 대화' },
];

const AGENT_STEPS = [
  { id: 'ocr', label: '텍스트 추출', desc: '입력 내용을 파싱합니다' },
  { id: 'classifier', label: '법적 쟁점 분류', desc: '위법 행위 유형을 식별합니다' },
  { id: 'law', label: '법령 검색', desc: '관련 조문을 조회합니다' },
  { id: 'precedent', label: '판례 검색', desc: '유사 사건을 찾습니다' },
  { id: 'analysis', label: '종합 분석', desc: '법적 판단을 생성합니다' },
];

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
): DetailPanelData {
  return {
    eyebrow,
    title,
    summary,
    metadata,
    highlights,
    references: collectReferenceItems(referenceSource),
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
  );
}

function buildResultDetail(result: AnalysisResult): DetailPanelData | null {
  const firstCharge = result.charges[0];
  if (firstCharge) {
    return buildChargeDetail(firstCharge, 0);
  }

  const firstPrecedent = result.precedent_cards[0];
  if (firstPrecedent) {
    return buildPrecedentDetail(firstPrecedent, 0);
  }

  const references = collectReferenceItems({
    reference_library: result.reference_library,
    law_reference_library: result.law_reference_library,
    precedent_reference_library: result.precedent_reference_library,
  });

  if (references.length > 0) {
    return {
      eyebrow: '근거 라이브러리',
      title: '참고 자료',
      summary: result.summary,
      metadata: [{ label: '참고 수', value: `${references.length}개` }],
      highlights: [],
      references,
    };
  }

  return null;
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
  result: AnalysisLegalResult | undefined,
  responseReferenceLibrary: DetailReference[] = [],
): AnalysisResult | null {
  if (!result) {
    return null;
  }

  const mergedTopLevelReferences = collectReferenceItems(result.reference_library);
  const mergedLawReferences = collectReferenceItems(result.law_reference_library);
  const mergedPrecedentReferences = collectReferenceItems(result.precedent_reference_library);
  const allReferences =
    responseReferenceLibrary.length > 0
      ? responseReferenceLibrary
      : mergedTopLevelReferences;
  const splitReferences = splitReferenceGroups(allReferences);
  const lawReferences = mergedLawReferences.length > 0 ? mergedLawReferences : splitReferences.law;
  const precedentReferences =
    mergedPrecedentReferences.length > 0 ? mergedPrecedentReferences : splitReferences.precedent;
  const fallbackReferences = allReferences.length > 0 ? allReferences : [...lawReferences, ...precedentReferences];

  return {
    can_sue: Boolean(result.can_sue),
    risk_level: Number(result.risk_level ?? 0),
    summary: getText(result.summary) || '분석 결과',
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
    law_reference_library: lawReferences,
    precedent_reference_library: precedentReferences,
  };
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
  const [text, setText] = useState('');
  const [contextType, setContextType] = useState<ContextType>('community');
  const [agentProgress, setAgentProgress] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<DetailPanelData | null>(null);

  const [session, setSession] = useState<{ user: AuthUser; token: string } | null>(null);
  const [guestSession, setGuestSession] = useState<GuestSession>(() => getInitialGuestSession());

  const [authMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);

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
    if (!result) {
      setSelectedDetail(null);
      return;
    }

    setSelectedDetail(buildResultDetail(result));
  }, [result]);

  const passwordPolicy = evaluatePasswordPolicy(authPassword);
  const canUseGuest = guestSession.guestRemaining > 0;

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
    setView('analyzing');
    setAuthError(null);

    AGENT_STEPS.forEach((step, index) => {
      window.setTimeout(() => {
        setAgentProgress((prev) => (prev.includes(step.id) ? prev : [...prev, step.id]));
      }, index * 600);
    });

    try {
      const response = (await analyzeCase(ANALYSIS_BASE_URL, token, {
        title: '텍스트 분석',
        input_mode: 'text',
        text: snapshot.text.trim(),
        context_type: snapshot.contextType,
        ...(token
          ? {}
          : {
              guest_id: guestSession.guestId,
            }),
      })) as AnalyzeCaseResponse;

      await delay(AGENT_STEPS.length * 600 + 300);

      const analysis = normalizeAnalysisResult(
        response.legal_analysis,
        collectReferenceItems(response.reference_library),
      );
      if (!analysis) {
        throw new Error('분석 결과를 불러오지 못했습니다.');
      }

      if (!token) {
        const nextRemaining =
          typeof response.guest_remaining === 'number'
            ? Math.max(0, response.guest_remaining)
            : Math.max(0, guestSession.guestRemaining - 1);

        setGuestSession({
          guestId: response.guest_id ?? response.meta?.guest_id ?? guestSession.guestId,
          guestRemaining: nextRemaining,
        });
      }

      setResult(analysis);
      setPendingAnalysis(null);
      setView('results');
    } catch (err) {
      const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
      const unauthorized = /unauthorized|401/i.test(message);

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

  async function handleAnalyzeClick() {
    if (!text.trim()) {
      return;
    }

    const snapshot = { text, contextType };

    if (session) {
      await runAnalysis(snapshot, session.token);
      return;
    }

    setPendingAnalysis(snapshot);
    openLoginPage(canUseGuest ? undefined : '게스트 무료 3회를 모두 사용했습니다. 로그인 또는 회원가입이 필요합니다.');
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
    if (!pendingAnalysis || guestSession.guestRemaining <= 0) return;
    const snapshot = pendingAnalysis;
    setPendingAnalysis(null);
    await runAnalysis(snapshot, null);
  }

  function handleReset() {
    setText('');
    setResult(null);
    setAgentProgress([]);
    setAnalysisError(null);
    setSelectedDetail(null);
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
    setView('signup');
  }

  async function handleRequestCode() {
    const email = authEmail.trim();
    if (!email) return;
    setVerifyStep('sending');
    setVerifyError(null);
    try {
      await requestEmailCode(AUTH_BASE_URL, email);
      setVerifyStep('sent');
      setVerifyTimer(180); // 3분 카운트다운
    } catch (err) {
      setVerifyStep('idle');
      setVerifyError(err instanceof Error ? err.message : '코드 발송에 실패했습니다.');
    }
  }

  async function handleSignupPageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifyStep !== 'verified') {
      setAuthError('이메일 인증을 먼저 완료해주세요.');
      return;
    }
    if (authPassword !== signupConfirmPassword) {
      setAuthError('비밀번호가 일치하지 않습니다.');
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const response = await signup(AUTH_BASE_URL, {
        email: authEmail.trim(),
        password: authPassword,
        verification_code: verifyCode,
      });
      saveStoredToken(response.token);
      setSession({ user: response.user, token: response.token });
      setAuthBusy(false);
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
            게스트 {guestSession.guestRemaining}/3
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
              <span className="context-icon">{opt.icon}</span>
              <span className="context-label">{opt.label}</span>
              <span className="context-desc">{opt.desc}</span>
            </button>
          ))}
        </div>

        <div className="section-label" style={{ marginTop: '24px' }}>
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

        {analysisError && <div className="error-banner">{analysisError}</div>}

        <button className="analyze-btn" onClick={() => void handleAnalyzeClick()} disabled={!text.trim()} type="button">
          법적 분석 시작
          <span className="analyze-arrow">→</span>
        </button>

        <p className="guest-note">
          비로그인 상태에서는 게스트로 총 3회까지 사용할 수 있습니다. 남은 횟수는 우측 상단에서
          확인할 수 있습니다.
        </p>

        <p className="input-disclaimer">
          업로드된 내용은 분석 후 즉시 삭제되며 서버에 저장되지 않습니다. 본 서비스는
          법률 정보 제공 목적이며 법적 효력이 없습니다.
        </p>
      </div>

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
      <div className="analyzing-card">
        <div className="spinner" />
        <h2 className="analyzing-title">분석 중입니다</h2>
        <p className="analyzing-sub">법령과 판례 데이터베이스를 조회하고 있습니다</p>

        <div className="pipeline">
          {AGENT_STEPS.map((step, i) => {
            const done = agentProgress.includes(step.id);
            const active = agentProgress.length === i;
            return (
              <div
                key={step.id}
                className={`pipeline-step ${done ? 'step-done' : active ? 'step-active' : 'step-waiting'}`}
              >
                <div className="step-indicator">
                  {done ? '✓' : active ? <span className="step-dot-pulse" /> : <span className="step-dot" />}
                </div>
                <div className="step-info">
                  <strong>{step.label}</strong>
                  <span>{step.desc}</span>
                </div>
              </div>
            );
          })}
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
          </div>
        </div>
        <div className={`can-sue-badge ${result.can_sue ? 'sue-yes' : 'sue-no'}`}>
          {result.can_sue ? '고소 가능' : '고소 어려움'}
        </div>
      </div>

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
          <section className="result-section result-detail-panel">
            <div className="detail-panel-head">
              <div>
                <h3 className="section-title">상세 보기</h3>
                <p className="detail-panel-sub">
                  카드를 누르면 법령·판례 근거와 참고 정보를 확인할 수 있습니다.
                </p>
              </div>
              {selectedDetail && (
                <span className="detail-panel-count">
                  {selectedDetail.references.length > 0
                    ? `${selectedDetail.references.length}개 근거`
                    : '카드 상세'}
                </span>
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
                    <span className="evidence-icon">📎</span>
                    {ev}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="disclaimer-box">
            <span className="disclaimer-icon">ⓘ</span>
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
          <span className="signup-logo-icon">⚖</span>
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
                onChange={(e) => { setAuthEmail(e.target.value); setVerifyStep('idle'); setVerifyError(null); }}
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
                  disabled={verifyCode.length !== 6}
                  onClick={() => {
                    // client-side: pass code into signup — verified on server
                    setVerifyStep('verified');
                    setVerifyTimer(0);
                    setVerifyError(null);
                  }}
                >
                  인증 확인
                </button>
              </div>
            )}
          </div>

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
          <span className="signup-logo-icon">⚖</span>
          <span className="signup-logo-text">KoreanLaw</span>
        </div>

        {pendingAnalysis && (
          <div className="auth-page-notice">
            로그인 후 분석이 자동으로 시작됩니다
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

          {pendingAnalysis && canUseGuest && (
            <button
              className="signup-submit auth-guest-btn"
              type="button"
              onClick={() => void handleGuestContinue()}
            >
              게스트로 계속 ({guestSession.guestRemaining}회 남음)
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
          <span className="logo-icon">⚖</span>
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
