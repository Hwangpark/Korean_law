import { useEffect, useState, type FormEvent } from 'react';

import {
  DEFAULT_AUTH_BASE_URL,
  PASSWORD_POLICY_HINT,
  checkHealth,
  clearStoredToken,
  evaluatePasswordPolicy,
  fetchMe,
  getInitialAuthBaseUrl,
  loadStoredToken,
  login,
  saveAuthBaseUrl,
  saveStoredToken,
  signup,
  type AuthResponse,
  type AuthUser,
  type HealthResponse,
} from './lib/auth';

type SessionState = {
  user: AuthUser;
  token: string;
  issuedAt: string;
  expiresIn: number;
  tokenType: string;
};

type StatusTone = 'neutral' | 'success' | 'danger';
type BusyAction = 'signup' | 'login' | 'health' | 'restore' | null;
type AuthMode = 'signup' | 'login';

function normalizeBaseUrlDraft(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function formatTokenPreview(token: string) {
  if (token.length <= 18) return token;
  return `${token.slice(0, 12)}…${token.slice(-10)}`;
}

function formatExpiry(seconds: number) {
  if (!seconds) return '확인 전';
  if (seconds >= 172800) return `${Math.round(seconds / 86400)}일`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}시간`;
  return `${seconds}초`;
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
    <label className="field">
      <span className="field-label">{label}</span>
      {note ? <span className="field-note">{note}</span> : null}
      <input
        className="input"
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function PolicyRule({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className={`policy-rule ${passed ? 'policy-rule-pass' : 'policy-rule-miss'}`}>
      <span className="policy-rule-state">{passed ? '✓' : '·'}</span>
      <strong>{label}</strong>
    </div>
  );
}

function FlowStep({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <article className="flow-step">
      <span className="flow-step-number">{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </article>
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
    '로그인 또는 회원가입 후 사건 분석 화면으로 이어집니다.',
  );
  const [busy, setBusy] = useState<BusyAction>(null);

  const signupPolicy = evaluatePasswordPolicy(signupPassword);
  const endpointDraft = normalizeBaseUrlDraft(authBaseUrlInput) || DEFAULT_AUTH_BASE_URL;
  const endpointDirty = endpointDraft !== authBaseUrl;
  const healthLabel = health
    ? `${health.service} @ ${new Date(health.time).toLocaleTimeString('ko-KR')}`
    : '미확인';

  useEffect(() => {
    const token = storedToken;
    if (!token) return;

    let active = true;
    setBusy('restore');
    fetchMe(authBaseUrl, token)
      .then((response) => {
        if (!active) return;
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
        if (!active) return;
        if (error instanceof Error && /unauthorized/i.test(error.message)) {
          clearStoredToken();
          setStoredToken(null);
        }
        setSession(null);
        setStatusTone('danger');
        setStatusMessage(error instanceof Error ? error.message : '세션 복원에 실패했습니다.');
      })
      .finally(() => {
        if (active) setBusy(null);
      });

    return () => {
      active = false;
    };
  }, [authBaseUrl]);

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
      applyAuthResponse(
        await signup(authBaseUrl, { email: signupEmail, password: signupPassword }),
        '회원가입이 완료되었고 바로 로그인되었습니다.',
      );
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
      applyAuthResponse(
        await login(authBaseUrl, { email: loginEmail, password: loginPassword }),
        '로그인되었습니다.',
      );
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
    setStatusMessage(`${endpointDraft} 상태를 확인하고 있습니다...`);
    try {
      const response = await checkHealth(endpointDraft);
      setHealth(response);
      setStatusTone('success');
      setStatusMessage('인증 서버가 정상 응답했습니다.');
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : '헬스 체크에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }

  async function handleReconnect() {
    const nextToken = session?.token ?? storedToken;
    if (!nextToken) {
      setStatusTone('danger');
      setStatusMessage('재검증할 로컬 세션 토큰이 없습니다.');
      return;
    }
    setBusy('restore');
    setStatusTone('neutral');
    setStatusMessage('세션을 다시 확인하고 있습니다...');
    try {
      const response = await fetchMe(authBaseUrl, nextToken);
      setSession((current) => ({
        user: response.user,
        token: current?.token ?? nextToken,
        issuedAt: current?.issuedAt ?? new Date().toISOString(),
        expiresIn: current?.expiresIn ?? 0,
        tokenType: response.token_type,
      }));
      setStatusTone('success');
      setStatusMessage(`${response.user.email} 계정 세션이 유효합니다.`);
    } catch (error) {
      if (error instanceof Error && /unauthorized/i.test(error.message)) {
        clearStoredToken();
        setStoredToken(null);
      }
      setSession(null);
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : '세션 재확인에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }

  function handleSaveBaseUrl() {
    const saved = saveAuthBaseUrl(authBaseUrlInput);
    setAuthBaseUrl(saved);
    setAuthBaseUrlInput(saved);
    setStatusTone('success');
    setStatusMessage(`인증 API 주소를 ${saved}로 저장했습니다.`);
  }

  function handleResetBaseUrl() {
    const next = saveAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    setAuthBaseUrl(next);
    setAuthBaseUrlInput(next);
    setStatusTone('neutral');
    setStatusMessage('인증 API 주소를 기본값으로 되돌렸습니다.');
  }

  function handleLogout() {
    clearStoredToken();
    setStoredToken(null);
    setSession(null);
    setStatusTone('neutral');
    setStatusMessage('로컬 세션을 정리했습니다.');
  }

  function copyToken() {
    const token = session?.token ?? storedToken;
    if (!token) {
      setStatusTone('danger');
      setStatusMessage('복사할 토큰이 없습니다.');
      return;
    }
    void navigator.clipboard
      .writeText(token)
      .then(() => {
        setStatusTone('success');
        setStatusMessage('토큰을 클립보드에 복사했습니다.');
      })
      .catch(() => {
        setStatusTone('danger');
        setStatusMessage('현재 브라우저 환경에서는 복사에 실패했습니다.');
      });
  }

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
    setSignupEmail(response.user.email);
    setLoginEmail(response.user.email);
    setSignupPassword('');
    setLoginPassword('');
    setStatusTone('success');
    setStatusMessage(message);
  }

  const activeBusy = authMode === 'signup' ? busy === 'signup' : busy === 'login';
  const primaryActionLabel =
    authMode === 'signup'
      ? busy === 'signup'
        ? '가입 중...'
        : '회원가입'
      : busy === 'login'
        ? '로그인 중...'
        : '로그인';

  return (
    <div className="shell">
      <main className="workspace">

        {/* ── Nav ── */}
        <header className="masthead">
          <div className="brand-line">
            <div className="brand-icon">⚖</div>
            <span className="brand-name">KoreanLaw</span>
            <span className="brand-divider">/</span>
            <span className="brand-subtitle">법률 분석</span>
          </div>
          <p className="masthead-note">
            커뮤니티 글, 게임 채팅, 메신저 캡처를 멀티에이전트 법률 분석으로 연결합니다.
          </p>
          <div className={`masthead-state ${session ? 'masthead-state-live' : ''}`}>
            {session ? '세션 활성' : '로그인 대기'}
          </div>
        </header>

        {/* ── Hero + Auth ── */}
        <section className="hero-grid">

          {/* Left: copy */}
          <section className="hero-copy">
            <p className="eyebrow">AI 기반 법률 분석 플랫폼</p>
            <h1>
              텍스트와 이미지를{' '}
              <em>법적 판단</em>으로
            </h1>
            <p className="lede">
              커뮤니티 익명글, 게임 채팅, 메신저 캡처를 입력받아
              관련 법령 조회·판례 비교·형사·민사 쟁점 판단까지
              멀티에이전트 파이프라인으로 분석합니다.
            </p>

            <div className="sequence-list">
              <FlowStep
                number="01"
                title="입력 수집"
                copy="커뮤니티 글, 게임 채팅, 메신저 캡처 이미지를 분석 입력으로 연결합니다."
              />
              <FlowStep
                number="02"
                title="멀티에이전트 분석"
                copy="OCR → 쟁점 분류 → 법령 검색 → 판례 검색 → 법적 판단 순서로 파이프라인이 이어집니다."
              />
              <FlowStep
                number="03"
                title="결과 리포트"
                copy="고소 가능성, 관련 조문, 유사 판례, 예상 리스크를 한 화면에 정리합니다."
              />
            </div>

            <div className="editorial-block">
              <span className="editorial-label">현재 단계</span>
              <p>
                이메일 인증은 다음 단계에서 추가됩니다. 현재는 회원가입·로그인·
                세션 복구·인증 API 상태 확인까지 안정화된 상태입니다.
              </p>
            </div>
          </section>

          {/* Right: auth */}
          <aside className="auth-module">
            <div className="module-head">
              <p className="section-number">02 · 계정 확인</p>
              <h2>시작하기</h2>
              <p>인증 API 주소 확인 후 회원가입 또는 로그인으로 바로 진입합니다.</p>
            </div>

            {/* Endpoint */}
            <div className="endpoint-zone">
              <Field
                label="인증 API 주소"
                type="text"
                placeholder="http://localhost:3001"
                value={authBaseUrlInput}
                onChange={setAuthBaseUrlInput}
                note="로컬 또는 스테이징 인증 서버 주소를 입력하고 저장하세요."
              />
              <div className="button-row">
                <button
                  className="button button-ghost"
                  onClick={handleSaveBaseUrl}
                  type="button"
                  disabled={!endpointDirty}
                >
                  저장
                </button>
                <button
                  className="button button-ghost"
                  onClick={handleResetBaseUrl}
                  type="button"
                >
                  기본값
                </button>
                <button
                  className="button button-ghost"
                  onClick={handleHealthCheck}
                  type="button"
                  disabled={busy === 'health'}
                >
                  {busy === 'health' ? '확인 중...' : '헬스 체크'}
                </button>
              </div>
              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span>저장된 주소</span>
                  <strong>{authBaseUrl}</strong>
                </div>
                <div className="telemetry-item">
                  <span>서버 상태</span>
                  <strong>{healthLabel}</strong>
                </div>
              </div>
            </div>

            {/* Tab switch */}
            <div className="auth-switch" aria-label="인증 모드 선택">
              <button
                className={`switch-button ${authMode === 'signup' ? 'switch-button-active' : ''}`}
                type="button"
                aria-pressed={authMode === 'signup'}
                onClick={() => setAuthMode('signup')}
              >
                회원가입
              </button>
              <button
                className={`switch-button ${authMode === 'login' ? 'switch-button-active' : ''}`}
                type="button"
                aria-pressed={authMode === 'login'}
                onClick={() => setAuthMode('login')}
              >
                로그인
              </button>
            </div>

            {/* Form */}
            <form
              className="auth-form"
              onSubmit={authMode === 'signup' ? handleSignup : handleLogin}
            >
              <Field
                label="이메일"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={authMode === 'signup' ? signupEmail : loginEmail}
                onChange={authMode === 'signup' ? setSignupEmail : setLoginEmail}
              />
              <Field
                label="비밀번호"
                type="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={
                  authMode === 'signup' ? '영문·숫자·특수문자 포함 9자 이상' : '현재 비밀번호 입력'
                }
                value={authMode === 'signup' ? signupPassword : loginPassword}
                onChange={authMode === 'signup' ? setSignupPassword : setLoginPassword}
                note={authMode === 'signup' ? PASSWORD_POLICY_HINT : undefined}
              />
              <button
                className="button button-primary button-wide"
                type="submit"
                disabled={
                  activeBusy ||
                  (authMode === 'signup'
                    ? !signupEmail.trim() || !signupPolicy.valid
                    : !loginEmail.trim() || !loginPassword.trim())
                }
              >
                {primaryActionLabel}
              </button>
            </form>

            {/* Policy / hint */}
            {authMode === 'signup' ? (
              <div className="policy-grid" aria-label="비밀번호 요구사항">
                <PolicyRule label="9자 이상" passed={signupPolicy.minLength} />
                <PolicyRule label="영문 포함" passed={signupPolicy.hasLetter} />
                <PolicyRule label="숫자 포함" passed={signupPolicy.hasNumber} />
                <PolicyRule label="특수문자" passed={signupPolicy.hasSpecial} />
              </div>
            ) : (
              <p className="micro-note">이메일 인증은 다음 단계에서 추가될 예정입니다.</p>
            )}

            {/* Status */}
            <div className={`status-panel status-panel-${statusTone}`} aria-live="polite">
              {statusMessage}
            </div>
          </aside>
        </section>

        {/* ── Signal Band ── */}
        <div className="signal-band">
          <div className="signal-item">
            <span>입력 범위</span>
            <strong>커뮤니티 글, 게임 채팅, 메신저 캡처를 분석 대상으로 준비 중입니다.</strong>
          </div>
          <div className="signal-item">
            <span>예상 출력</span>
            <strong>관련 법령, 유사 판례, 형사·민사 쟁점, 대응 포인트를 단계별로 안내합니다.</strong>
          </div>
          <div className="signal-item">
            <span>현재 스택</span>
            <strong>React + TypeScript, Node.js API, Docker PostgreSQL 연결 완료.</strong>
          </div>
        </div>

        {/* ── Lower Grid ── */}
        <section className="lower-grid">

          {/* Session Panel */}
          <section className="panel panel-session">
            <div className="panel-head">
              <p className="section-number">03 · 세션 상태</p>
              <h2>현재 세션</h2>
              <p>
                로그인 후 세션 토큰은 브라우저에 저장됩니다.
                인증 주소 변경 시 또는 세션 재확인이 필요할 때 사용하세요.
              </p>
            </div>

            {session ? (
              <div className="session-grid">
                <div className="session-item">
                  <span>로그인 계정</span>
                  <strong>{session.user.email}</strong>
                </div>
                <div className="session-item">
                  <span>사용자 ID</span>
                  <strong>{session.user.id}</strong>
                </div>
                <div className="session-item">
                  <span>토큰 타입</span>
                  <strong>{session.tokenType}</strong>
                </div>
                <div className="session-item">
                  <span>발급 시각</span>
                  <strong>{new Date(session.issuedAt).toLocaleString('ko-KR')}</strong>
                </div>
                <div className="session-item">
                  <span>만료까지</span>
                  <strong>{formatExpiry(session.expiresIn)}</strong>
                </div>
                <div className="session-item session-item-token">
                  <span>토큰 미리보기</span>
                  <strong>{formatTokenPreview(session.token)}</strong>
                </div>
              </div>
            ) : (
              <p className="empty-state">
                아직 로그인된 세션이 없습니다. 회원가입 또는 로그인 후 진행할 수 있습니다.
              </p>
            )}

            <div className="button-row">
              <button
                className="button button-ghost"
                onClick={handleReconnect}
                type="button"
                disabled={busy === 'restore' || !storedToken}
              >
                {busy === 'restore' ? '재확인 중...' : '세션 재확인'}
              </button>
              <button
                className="button button-ghost"
                onClick={copyToken}
                type="button"
                disabled={!storedToken}
              >
                토큰 복사
              </button>
              <button
                className="button button-ghost"
                onClick={handleLogout}
                type="button"
                disabled={!storedToken}
              >
                세션 정리
              </button>
            </div>
          </section>

          {/* Protocol Panel */}
          <section className="panel panel-protocol">
            <div className="panel-head">
              <p className="section-number">04 · 분석 흐름</p>
              <h2>로그인 후 이어질 파이프라인</h2>
              <p>
                인증 완료 후 사건 입력과 멀티에이전트 분석 화면이 이 구조 위에 연결됩니다.
              </p>
            </div>

            <div className="protocol-list">
              <div className="protocol-item">
                <span>01</span>
                <p>이미지 업로드 또는 텍스트 입력을 받아 OCR과 전처리 단계를 시작합니다.</p>
              </div>
              <div className="protocol-item">
                <span>02</span>
                <p>쟁점 분류 에이전트가 명예훼손·모욕·협박·사기 등 법적 이슈를 추출합니다.</p>
              </div>
              <div className="protocol-item">
                <span>03</span>
                <p>법령 검색과 판례 검색이 병렬로 실행되어 관련 조문과 유사 사건을 수집합니다.</p>
              </div>
              <div className="protocol-item">
                <span>04</span>
                <p>최종 법적 판단 에이전트가 고소 가능성·리스크·대응 포인트를 사용자용으로 정리합니다.</p>
              </div>
            </div>
          </section>

        </section>
      </main>
    </div>
  );
}
