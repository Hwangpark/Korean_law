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
  if (token.length <= 18) {
    return token;
  }

  return `${token.slice(0, 12)}...${token.slice(-10)}`;
}

function formatExpiry(seconds: number) {
  if (!seconds) {
    return 'n/a';
  }

  if (seconds >= 172800) {
    return `${Math.round(seconds / 86400)} days`;
  }

  if (seconds >= 3600) {
    return `${Math.round(seconds / 3600)} hours`;
  }

  return `${seconds}s`;
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
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PolicyRule({
  label,
  passed,
}: {
  label: string;
  passed: boolean;
}) {
  return (
    <div className={`policy-rule ${passed ? 'policy-rule-pass' : 'policy-rule-miss'}`}>
      <span className="policy-rule-state">{passed ? 'Ready' : 'Missing'}</span>
      <strong>{label}</strong>
    </div>
  );
}

function FlowStep({
  number,
  title,
  copy,
}: {
  number: string;
  title: string;
  copy: string;
}) {
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
    'Choose the auth endpoint, then create or reopen an account.',
  );
  const [busy, setBusy] = useState<BusyAction>(null);

  const signupPolicy = evaluatePasswordPolicy(signupPassword);
  const endpointDraft = normalizeBaseUrlDraft(authBaseUrlInput) || DEFAULT_AUTH_BASE_URL;
  const endpointDirty = endpointDraft !== authBaseUrl;
  const healthLabel = health
    ? `${health.service} @ ${new Date(health.time).toLocaleTimeString('ko-KR')}`
    : 'Unchecked';

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
        setStatusMessage(`Session ready for ${response.user.email}.`);
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
        setStatusMessage(
          error instanceof Error ? error.message : 'Session restore failed.',
        );
      })
      .finally(() => {
        if (active) {
          setBusy(null);
        }
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
    setStatusMessage('Creating account...');

    try {
      const response = await signup(authBaseUrl, {
        email: signupEmail,
        password: signupPassword,
      });
      applyAuthResponse(response, 'Account created and signed in.');
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : 'Signup failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('login');
    setStatusTone('neutral');
    setStatusMessage('Opening session...');

    try {
      const response = await login(authBaseUrl, {
        email: loginEmail,
        password: loginPassword,
      });
      applyAuthResponse(response, 'Session opened.');
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleHealthCheck() {
    setBusy('health');
    setStatusTone('neutral');
    setStatusMessage(`Checking ${endpointDraft}...`);

    try {
      const response = await checkHealth(endpointDraft);
      setHealth(response);
      setStatusTone('success');
      setStatusMessage(`Auth service responded from ${endpointDraft}.`);
    } catch (error) {
      setStatusTone('danger');
      setStatusMessage(
        error instanceof Error ? error.message : 'Health check failed.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleReconnect() {
    const nextToken = session?.token ?? storedToken;
    if (!nextToken) {
      setStatusTone('danger');
      setStatusMessage('No local token is available for revalidation.');
      return;
    }

    setBusy('restore');
    setStatusTone('neutral');
    setStatusMessage('Revalidating session...');

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
      setStatusMessage(`Session confirmed for ${response.user.email}.`);
    } catch (error) {
      if (error instanceof Error && /unauthorized/i.test(error.message)) {
        clearStoredToken();
        setStoredToken(null);
      }
      setSession(null);
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : 'Reconnect failed.');
    } finally {
      setBusy(null);
    }
  }

  function handleSaveBaseUrl() {
    const saved = saveAuthBaseUrl(authBaseUrlInput);
    setAuthBaseUrl(saved);
    setAuthBaseUrlInput(saved);
    setStatusTone('success');
    setStatusMessage(`Saved auth endpoint: ${saved}`);
  }

  function handleResetBaseUrl() {
    const next = saveAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    setAuthBaseUrl(next);
    setAuthBaseUrlInput(next);
    setStatusTone('neutral');
    setStatusMessage('Auth endpoint reset to the project default.');
  }

  function handleLogout() {
    clearStoredToken();
    setStoredToken(null);
    setSession(null);
    setStatusTone('neutral');
    setStatusMessage('Local session cleared.');
  }

  function copyToken() {
    const token = session?.token ?? storedToken;
    if (!token) {
      setStatusTone('danger');
      setStatusMessage('No token is available to copy.');
      return;
    }

    void navigator.clipboard
      .writeText(token)
      .then(() => {
        setStatusTone('success');
        setStatusMessage('Token copied to clipboard.');
      })
      .catch(() => {
        setStatusTone('danger');
        setStatusMessage('Copy failed in this browser context.');
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
        ? 'Creating account...'
        : 'Create account'
      : busy === 'login'
        ? 'Opening session...'
        : 'Open session';

  return (
    <div className="shell">
      <main className="workspace">
        <header className="masthead">
          <div className="brand-line">
            <span className="brand-name">KoreanLaw</span>
            <span className="brand-divider">/</span>
            <span className="brand-subtitle">identity layer</span>
          </div>
          <p className="masthead-note">
            Email verification lands next. Strong password policy is live now.
          </p>
          <div className={`masthead-state masthead-state-${session ? 'live' : 'idle'}`}>
            {session ? 'Authenticated' : 'Awaiting first sign-in'}
          </div>
        </header>

        <section className="hero-grid">
          <section className="hero-copy">
            <p className="section-number">01</p>
            <p className="eyebrow">Secure intake before legal analysis</p>
            <h1>Let the right people in before the legal agents touch the case.</h1>
            <p className="lede">
              This front door handles signup, login, saved-session recovery, and
              endpoint switching for the KoreanLaw stack. It is deliberately
              editorial, not a generic card grid, because the first impression of
              trust should feel intentional.
            </p>

            <div className="editorial-block">
              <span className="editorial-label">Operating rule</span>
              <p>
                User passwords require 9 or more characters, at least one English
                letter, one number, and one special character. PostgreSQL
                credentials stay separate and are still managed through the local
                environment.
              </p>
            </div>

            <div className="sequence-list">
              <FlowStep
                number="01"
                title="Create a strong account"
                copy="Sign up with a password that clears the same policy on the client and the API."
              />
              <FlowStep
                number="02"
                title="Persist the session locally"
                copy="The bearer token is stored in the browser so the intake shell can revalidate later."
              />
              <FlowStep
                number="03"
                title="Hand the case to the agents"
                copy="Once identity is stable, the next layer can attach intake, OCR, search, and legal analysis."
              />
            </div>
          </section>

          <aside className="auth-module">
            <div className="module-head">
              <p className="section-number">02</p>
              <h2>Account access</h2>
              <p>
                Set the live auth origin, then choose whether you are creating the
                first account or reopening an existing session.
              </p>
            </div>

            <div className="endpoint-zone">
              <Field
                label="Auth endpoint"
                type="text"
                placeholder="http://localhost:3001"
                value={authBaseUrlInput}
                onChange={setAuthBaseUrlInput}
                note="Full origin only. Save to make it the active session endpoint."
              />

              <div className="button-row">
                <button
                  className="button button-primary"
                  onClick={handleSaveBaseUrl}
                  type="button"
                  disabled={!endpointDirty}
                >
                  Save endpoint
                </button>
                <button
                  className="button button-ghost"
                  onClick={handleResetBaseUrl}
                  type="button"
                >
                  Reset
                </button>
                <button
                  className="button button-ghost"
                  onClick={handleHealthCheck}
                  type="button"
                  disabled={busy === 'health'}
                >
                  {busy === 'health' ? 'Checking...' : 'Check health'}
                </button>
              </div>

              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span>Saved endpoint</span>
                  <strong>{authBaseUrl}</strong>
                </div>
                <div className="telemetry-item">
                  <span>Health</span>
                  <strong>{healthLabel}</strong>
                </div>
              </div>
            </div>

            <div className="auth-switch" aria-label="Choose auth mode">
              <button
                className={`switch-button ${authMode === 'signup' ? 'switch-button-active' : ''}`}
                type="button"
                aria-pressed={authMode === 'signup'}
                onClick={() => setAuthMode('signup')}
              >
                Signup
              </button>
              <button
                className={`switch-button ${authMode === 'login' ? 'switch-button-active' : ''}`}
                type="button"
                aria-pressed={authMode === 'login'}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
            </div>

            <form
              className="auth-form"
              onSubmit={authMode === 'signup' ? handleSignup : handleLogin}
            >
              <Field
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={authMode === 'signup' ? signupEmail : loginEmail}
                onChange={authMode === 'signup' ? setSignupEmail : setLoginEmail}
              />

              <Field
                label="Password"
                type="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={
                  authMode === 'signup'
                    ? 'At least 9 chars, plus number and symbol'
                    : 'Enter your current password'
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

            {authMode === 'signup' ? (
              <div className="policy-grid" aria-label="Password requirements">
                <PolicyRule label="9 or more characters" passed={signupPolicy.minLength} />
                <PolicyRule label="Contains an English letter" passed={signupPolicy.hasLetter} />
                <PolicyRule label="Contains a number" passed={signupPolicy.hasNumber} />
                <PolicyRule label="Contains a special character" passed={signupPolicy.hasSpecial} />
              </div>
            ) : (
              <p className="micro-note">
                Existing accounts can log in immediately. Email verification will
                be inserted after the current identity layer stabilizes.
              </p>
            )}

            <div className={`status-panel status-panel-${statusTone}`} aria-live="polite">
              {statusMessage}
            </div>
          </aside>
        </section>

        <section className="signal-band">
          <div className="signal-item">
            <span>03 / Design stance</span>
            <strong>No duplicated auth cards. Typography carries the hierarchy.</strong>
          </div>
          <div className="signal-item">
            <span>Runtime</span>
            <strong>React + TypeScript UI, token auth API, Dockerized Postgres.</strong>
          </div>
          <div className="signal-item">
            <span>Next layer</span>
            <strong>Attach email verification without rebuilding the entry flow.</strong>
          </div>
        </section>

        <section className="lower-grid">
          <section className="panel panel-session">
            <div className="panel-head">
              <div>
                <p className="section-number">03</p>
                <h2>Session ledger</h2>
              </div>
              <p>
                Tokens stay local to the browser. Revalidate when the saved
                endpoint changes or when you want to confirm the account is still
                active.
              </p>
            </div>

            {session ? (
              <div className="session-grid">
                <div className="session-item">
                  <span>Signed in as</span>
                  <strong>{session.user.email}</strong>
                </div>
                <div className="session-item">
                  <span>User ID</span>
                  <strong>{session.user.id}</strong>
                </div>
                <div className="session-item">
                  <span>Token type</span>
                  <strong>{session.tokenType}</strong>
                </div>
                <div className="session-item">
                  <span>Issued at</span>
                  <strong>{new Date(session.issuedAt).toLocaleString('ko-KR')}</strong>
                </div>
                <div className="session-item">
                  <span>Expires in</span>
                  <strong>{formatExpiry(session.expiresIn)}</strong>
                </div>
                <div className="session-item session-item-token">
                  <span>Token preview</span>
                  <strong>{formatTokenPreview(session.token)}</strong>
                </div>
              </div>
            ) : (
              <p className="empty-state">
                No authenticated session is loaded yet. Create an account or log
                in first, then this ledger becomes the technical handoff to the
                multi-agent pipeline.
              </p>
            )}

            <div className="button-row">
              <button
                className="button button-ghost"
                onClick={handleReconnect}
                type="button"
                disabled={busy === 'restore' || !loadStoredToken()}
              >
                  {busy === 'restore' ? 'Revalidating...' : 'Revalidate session'}
              </button>
              <button
                className="button button-ghost"
                onClick={copyToken}
                type="button"
                disabled={!storedToken}
              >
                Copy token
              </button>
              <button
                className="button button-ghost"
                onClick={handleLogout}
                type="button"
                disabled={!storedToken}
              >
                Clear session
              </button>
            </div>
          </section>

          <section className="panel panel-protocol">
            <div className="panel-head">
              <div>
                <p className="section-number">04</p>
                <h2>What this layer guarantees</h2>
              </div>
              <p>
                The auth surface is now aligned across client hints, API
                enforcement, and smoke tests so the next product pass can focus on
                intake and case orchestration.
              </p>
            </div>

            <div className="protocol-list">
              <div className="protocol-item">
                <span>01</span>
                <p>One password rule across the frontend, backend, and automated checks.</p>
              </div>
              <div className="protocol-item">
                <span>02</span>
                <p>Saved endpoint control for local stacks, Docker ports, and future staging APIs.</p>
              </div>
              <div className="protocol-item">
                <span>03</span>
                <p>A calmer, more intentional landing page that does not collapse into a default SaaS shell.</p>
              </div>
              <div className="protocol-item">
                <span>04</span>
                <p>Email verification is intentionally deferred, not ignored, so the current auth flow stays replaceable.</p>
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
