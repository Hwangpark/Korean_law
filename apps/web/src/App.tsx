import { useEffect, useState, type FormEvent } from 'react';

import './styles.css';
import {
  DEFAULT_AUTH_BASE_URL,
  PASSWORD_POLICY_HINT,
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
  type AuthResponse,
  type AuthUser,
  type GuestSession,
} from './lib/auth';

const AUTH_BASE_URL = getInitialAuthBaseUrl();
const ANALYSIS_BASE_URL = import.meta.env.VITE_ANALYSIS_BASE_URL ?? AUTH_BASE_URL ?? DEFAULT_AUTH_BASE_URL;

type ContextType = 'community' | 'game_chat' | 'messenger' | 'other';
type View = 'input' | 'analyzing' | 'results';
type AuthMode = 'login' | 'signup';

type Charge = {
  charge: string;
  basis: string;
  elements_met: string[];
  probability: 'high' | 'medium' | 'low';
  expected_penalty: string;
};

type PrecedentCard = {
  case_no: string;
  court: string;
  verdict: string;
  summary: string;
  similarity_score: number;
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
};

type AnalyzeResponse = {
  legal_analysis?: AnalysisResult;
  guest_id?: string;
  guest_remaining?: number;
  meta?: {
    guest_id?: string;
    guest_remaining?: number;
  };
};

type PendingAnalysis = {
  text: string;
  contextType: ContextType;
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

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  placeholder,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  autoComplete?: string;
  placeholder?: string;
  note?: string;
}) {
  return (
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      {note ? <span className="auth-field-note">{note}</span> : null}
      <input
        className="input auth-input"
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
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

  const [session, setSession] = useState<{ user: AuthUser; token: string } | null>(null);
  const [guestSession, setGuestSession] = useState<GuestSession>(() => getInitialGuestSession());

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);

  useEffect(() => {
    saveGuestSession(guestSession);
  }, [guestSession]);

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
    if (!authModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAuthModalOpen(false);
        setAuthError(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authModalOpen]);

  const passwordPolicy = evaluatePasswordPolicy(authPassword);
  const canUseGuest = guestSession.guestRemaining > 0;

  function openAuthModal(mode: AuthMode) {
    setAuthMode(mode);
    setAuthError(null);
    setAuthModalOpen(true);
  }

  function closeAuthModal() {
    setAuthModalOpen(false);
    setAuthBusy(false);
    setAuthError(null);
    setAuthPassword('');
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
    setAuthModalOpen(false);
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
      })) as AnalyzeResponse;

      await delay(AGENT_STEPS.length * 600 + 300);

      const analysis = response.legal_analysis;
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
        setAuthMode('login');
        setAuthError('세션이 만료되었습니다. 다시 로그인하세요.');
        setAuthModalOpen(true);
        setView('input');
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
    setAuthMode('login');
    setAuthError(
      canUseGuest
        ? null
        : '게스트 무료 3회를 모두 사용했습니다. 로그인 또는 회원가입이 필요합니다.',
    );
    setAuthModalOpen(true);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);

    const payload = {
      email: authEmail.trim(),
      password: authPassword,
    };

    try {
      const response: AuthResponse =
        authMode === 'signup'
          ? await signup(AUTH_BASE_URL, payload)
          : await login(AUTH_BASE_URL, payload);

      saveStoredToken(response.token);
      setSession({ user: response.user, token: response.token });
      setAuthBusy(false);
      setAuthModalOpen(false);
      setAuthPassword('');

      if (pendingAnalysis) {
        const snapshot = pendingAnalysis;
        setPendingAnalysis(null);
        await runAnalysis(snapshot, response.token);
      }
    } catch (err) {
      setAuthBusy(false);
      setAuthError(err instanceof Error ? err.message : '인증 처리 중 오류가 발생했습니다.');
    }
  }

  async function handleGuestContinue() {
    if (!pendingAnalysis || guestSession.guestRemaining <= 0) {
      setAuthError('게스트 무료 횟수가 남아 있지 않습니다. 로그인 또는 회원가입이 필요합니다.');
      return;
    }

    const snapshot = pendingAnalysis;
    setPendingAnalysis(null);
    await runAnalysis(snapshot, null);
  }

  function handleReset() {
    setText('');
    setResult(null);
    setAgentProgress([]);
    setAnalysisError(null);
    setView('input');
  }

  const headerActions = (
    <div className="auth-controls">
      {!session ? (
        <>
          <span className={`guest-pill ${guestSession.guestRemaining > 0 ? 'guest-pill-ready' : 'guest-pill-empty'}`}>
            게스트 {guestSession.guestRemaining}/3
          </span>
          <button className="auth-btn auth-btn-ghost" onClick={() => openAuthModal('login')} type="button">
            로그인
          </button>
          <button className="auth-btn auth-btn-solid" onClick={() => openAuthModal('signup')} type="button">
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
                      <span className="charge-name">{charge.charge}</span>
                      <ProbabilityPill prob={charge.probability} />
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
                      <span className="precedent-no">{p.case_no}</span>
                      <span className="precedent-court">{p.court}</span>
                      <span
                        className={`verdict-badge ${p.verdict === '유죄' ? 'verdict-guilty' : 'verdict-not-guilty'}`}
                      >
                        {p.verdict}
                      </span>
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

      {authModalOpen && (
        <div className="modal-backdrop" onClick={closeAuthModal} role="presentation">
          <div className="auth-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="auth-modal-aside">
              <p className="auth-modal-kicker">계정 인증</p>
              <h2 className="auth-modal-title">분석을 이어가려면 로그인하거나 게스트로 진행하세요</h2>
              <p className="auth-modal-copy">
                로그인하면 분석 이력과 세션 복원이 가능하고, 게스트는 총 3회까지 바로 사용할 수 있습니다.
              </p>

              <div className="auth-modal-stat">
                <span>게스트 잔여</span>
                <strong>{guestSession.guestRemaining}/3</strong>
              </div>

              <div className="auth-modal-note">
                <span className="disclaimer-icon">ⓘ</span>
                <p>
                  비밀번호는 {PASSWORD_POLICY_HINT} 기준을 만족해야 합니다. 이메일 인증은 추후에 추가할 수
                  있도록 현재는 제외했습니다.
                </p>
              </div>
            </div>

            <div className="auth-modal-panel">
              <div className="auth-tabs" role="tablist" aria-label="인증 방식">
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'login' ? 'auth-tab-active' : ''}`}
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError(null);
                  }}
                >
                  로그인
                </button>
                <button
                  type="button"
                  className={`auth-tab ${authMode === 'signup' ? 'auth-tab-active' : ''}`}
                  onClick={() => {
                    setAuthMode('signup');
                    setAuthError(null);
                  }}
                >
                  회원가입
                </button>
              </div>

              <form className="auth-form" onSubmit={(event) => void handleAuthSubmit(event)}>
                <Field
                  label="이메일"
                  value={authEmail}
                  onChange={setAuthEmail}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                />

                <Field
                  label="비밀번호"
                  value={authPassword}
                  onChange={setAuthPassword}
                  type="password"
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="비밀번호 입력"
                  note={authMode === 'signup' ? PASSWORD_POLICY_HINT : undefined}
                />

                {authMode === 'signup' ? (
                  <ul className="policy-list">
                    <PolicyRule label="9자 이상" passed={passwordPolicy.minLength} />
                    <PolicyRule label="영문 포함" passed={passwordPolicy.hasLetter} />
                    <PolicyRule label="숫자 포함" passed={passwordPolicy.hasNumber} />
                    <PolicyRule label="특수문자 포함" passed={passwordPolicy.hasSpecial} />
                  </ul>
                ) : (
                  <p className="auth-helper">기존 계정으로 바로 로그인하면 분석을 이어갈 수 있습니다.</p>
                )}

                {authError ? <div className="error-banner">{authError}</div> : null}

                <div className="auth-actions">
                  <button
                    className="auth-btn auth-btn-solid auth-submit"
                    disabled={authBusy || !authEmail.trim() || !authPassword.trim() || (authMode === 'signup' && !passwordPolicy.valid)}
                    type="submit"
                  >
                    {authBusy ? '처리 중...' : authMode === 'login' ? '로그인' : '회원가입'}
                  </button>
                  <button
                    className="auth-btn auth-btn-ghost"
                    disabled={!pendingAnalysis || !canUseGuest}
                    onClick={() => void handleGuestContinue()}
                    type="button"
                  >
                    {canUseGuest ? `게스트로 계속 (${guestSession.guestRemaining}회 남음)` : '게스트 횟수 소진'}
                  </button>
                  <button className="auth-close" onClick={closeAuthModal} type="button">
                    닫기
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
