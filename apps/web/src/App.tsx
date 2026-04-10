import { useEffect, useState, type FormEvent } from 'react';

import {
  DEFAULT_AUTH_BASE_URL,
  checkHealth,
  clearStoredToken,
  fetchMe,
  getInitialAuthBaseUrl,
  loadStoredToken,
  saveAuthBaseUrl,
  saveStoredToken,
  signup,
  login,
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

function formatTokenPreview(token: string) {
  if (token.length <= 18) {
    return token;
  }

  return `${token.slice(0, 10)}…${token.slice(-8)}`;
}

function Field({
  label,
  value,
  onChange,
  type,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
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

function AuthCard({
  title,
  tone,
  helper,
  submitLabel,
  busy,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  title: string;
  tone: 'amber' | 'teal';
  helper: string;
  submitLabel: string;
  busy: boolean;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <article className={`card auth-card auth-card-${tone}`}>
      <div className="card-head">
        <div>
          <p className="card-kicker">{title}</p>
          <p className="card-helper">{helper}</p>
        </div>
      </div>

      <form className="form" onSubmit={onSubmit}>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={onEmailChange}
        />
        <Field
          label="Password"
          type="password"
          autoComplete={tone === 'amber' ? 'new-password' : 'current-password'}
          placeholder="At least 8 characters"
          value={password}
          onChange={onPasswordChange}
        />

        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Working…' : submitLabel}
        </button>
      </form>
    </article>
  );
}

export default function App() {
  const [authBaseUrl, setAuthBaseUrl] = useState(getInitialAuthBaseUrl);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [session, setSession] = useState<SessionState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [statusMessage, setStatusMessage] = useState(
    'Choose a base URL, then sign up or log in.',
  );
  const [busy, setBusy] = useState<BusyAction>(null);

  useEffect(() => {
    const token = loadStoredToken();
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
        setStatusMessage(`Restored session for ${response.user.email}.`);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        clearStoredToken();
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
  }, []);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('signup');
    setStatusTone('neutral');
    setStatusMessage('Submitting signup request…');

    try {
      const response = await signup(authBaseUrl, {
        email: signupEmail,
        password: signupPassword,
      });
      applyAuthResponse(response, 'Signup completed.');
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
    setStatusMessage('Submitting login request…');

    try {
      const response = await login(authBaseUrl, {
        email: loginEmail,
        password: loginPassword,
      });
      applyAuthResponse(response, 'Login successful.');
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
    setStatusMessage('Checking service health…');

    try {
      const response = await checkHealth(authBaseUrl);
      setHealth(response);
      setStatusTone('success');
      setStatusMessage(`Auth service is healthy at ${response.time}.`);
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
    if (!session?.token) {
      setStatusTone('danger');
      setStatusMessage('No local token is available for reconnection.');
      return;
    }

    setBusy('restore');
    setStatusTone('neutral');
    setStatusMessage('Revalidating local session…');

    try {
      const response = await fetchMe(authBaseUrl, session.token);
      setSession((current) =>
        current
          ? {
              ...current,
              user: response.user,
            }
          : current,
      );
      setStatusTone('success');
      setStatusMessage(`Session is valid for ${response.user.email}.`);
    } catch (error) {
      clearStoredToken();
      setSession(null);
      setStatusTone('danger');
      setStatusMessage(error instanceof Error ? error.message : 'Reconnect failed.');
    } finally {
      setBusy(null);
    }
  }

  function handleSaveBaseUrl() {
    const saved = saveAuthBaseUrl(authBaseUrl);
    setAuthBaseUrl(saved);
    setStatusTone('success');
    setStatusMessage(`Saved auth base URL: ${saved}`);
  }

  function handleResetBaseUrl() {
    const next = saveAuthBaseUrl(DEFAULT_AUTH_BASE_URL);
    setAuthBaseUrl(next);
    setStatusTone('neutral');
    setStatusMessage('Base URL reset to the configured default.');
  }

  function handleLogout() {
    clearStoredToken();
    setSession(null);
    setStatusTone('neutral');
    setStatusMessage('Local session cleared.');
  }

  function copyToken() {
    if (!session?.token) {
      return;
    }

    void navigator.clipboard
      .writeText(session.token)
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

  const healthLabel = health
    ? `${health.service} @ ${new Date(health.time).toLocaleTimeString('ko-KR')}`
    : 'Unchecked';

  return (
    <div className="shell">
      <main className="workspace">
        <section className="card hero">
          <div className="hero-copy">
            <p className="eyebrow">KoreanLaw / auth scaffold</p>
            <h1>Logged-in intake before the legal agents wake up.</h1>
            <p className="lede">
              A minimal Vite + React + TypeScript front end for signup, login,
              and session validation against a configurable auth base URL.
            </p>

            <div className="hero-pills" aria-label="frontend highlights">
              <span>React + TypeScript</span>
              <span>Configurable API base URL</span>
              <span>Token-backed sessions</span>
            </div>
          </div>

          <div className="hero-aside">
            <div className="metric">
              <span>Base URL</span>
              <strong>{authBaseUrl}</strong>
            </div>
            <div className="metric">
              <span>Session</span>
              <strong>{session ? session.user.email : 'none'}</strong>
            </div>
            <div className="metric">
              <span>Health</span>
              <strong>{healthLabel}</strong>
            </div>
          </div>
        </section>

        <section className="card control-bar">
          <div className="control-copy">
            <p className="card-kicker">Auth endpoint</p>
            <p className="card-helper">
              Use a full origin, for example `http://localhost:3001`.
            </p>
          </div>

          <div className="control-actions">
            <label className="field field-inline">
              <span className="field-label">Auth base URL</span>
              <input
                className="input"
                value={authBaseUrl}
                onChange={(event) => setAuthBaseUrl(event.target.value)}
                placeholder="http://localhost:3001"
                spellCheck={false}
              />
            </label>

            <div className="button-row">
              <button className="button button-secondary" onClick={handleSaveBaseUrl} type="button">
                Save
              </button>
              <button
                className="button button-secondary"
                onClick={handleResetBaseUrl}
                type="button"
              >
                Reset
              </button>
              <button
                className="button button-secondary"
                onClick={handleHealthCheck}
                type="button"
                disabled={busy === 'health'}
              >
                {busy === 'health' ? 'Checking…' : 'Check health'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid-auth">
          <AuthCard
            title="Signup"
            tone="amber"
            helper="Create a local account in Postgres, then receive a bearer token."
            submitLabel="Create account"
            busy={busy === 'signup'}
            email={signupEmail}
            password={signupPassword}
            onEmailChange={setSignupEmail}
            onPasswordChange={setSignupPassword}
            onSubmit={handleSignup}
          />

          <AuthCard
            title="Login"
            tone="teal"
            helper="Reuse an existing account and refresh the local token."
            submitLabel="Log in"
            busy={busy === 'login'}
            email={loginEmail}
            password={loginPassword}
            onEmailChange={setLoginEmail}
            onPasswordChange={setLoginPassword}
            onSubmit={handleLogin}
          />
        </section>

        <section className="card session-card">
          <div className="card-head">
            <div>
              <p className="card-kicker">Session</p>
              <p className="card-helper">
                The API returns a bearer token, which this shell stores locally
                for reuse against `/auth/me`.
              </p>
            </div>

            <div className={`status status-${statusTone}`} aria-live="polite">
              {statusMessage}
            </div>
          </div>

          {session ? (
            <div className="session-grid">
              <div className="session-block">
                <span>Signed in as</span>
                <strong>{session.user.email}</strong>
              </div>
              <div className="session-block">
                <span>User ID</span>
                <strong>{session.user.id}</strong>
              </div>
              <div className="session-block">
                <span>Token type</span>
                <strong>{session.tokenType}</strong>
              </div>
              <div className="session-block">
                <span>Issued at</span>
                <strong>{new Date(session.issuedAt).toLocaleString('ko-KR')}</strong>
              </div>
              <div className="session-block">
                <span>Expires in</span>
                <strong>{session.expiresIn ? `${session.expiresIn}s` : 'n/a'}</strong>
              </div>
              <div className="session-block session-token">
                <span>Token</span>
                <strong>{formatTokenPreview(session.token)}</strong>
              </div>
            </div>
          ) : (
            <p className="empty-state">
              No session is stored yet. Use signup or login to seed the token,
              then revalidate with `/auth/me`.
            </p>
          )}

          <div className="button-row">
            <button className="button button-secondary" onClick={handleReconnect} type="button" disabled={!session || busy === 'restore'}>
              {busy === 'restore' ? 'Reconnecting…' : 'Revalidate session'}
            </button>
            <button className="button button-secondary" onClick={copyToken} type="button" disabled={!session}>
              Copy token
            </button>
            <button className="button button-secondary" onClick={handleLogout} type="button" disabled={!session}>
              Clear session
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
