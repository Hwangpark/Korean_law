export type AuthUser = {
  id: number;
  email: string;
};

export type AuthResponse = {
  token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
  issued_at: string;
  message?: string;
};

export type MeResponse = {
  user: AuthUser;
  token_type: string;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  time: string;
};

export type PasswordPolicyState = {
  minLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  valid: boolean;
};

type RawAuthResponse = Partial<AuthResponse> & {
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  issuedAt?: string;
};

type RawMeResponse = Partial<MeResponse> & {
  tokenType?: string;
};

export const DEFAULT_AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL ?? 'http://localhost:3001';
export const PASSWORD_POLICY_HINT =
  'Use at least 9 characters with English letters, numbers, and a special character.';

const AUTH_BASE_URL_STORAGE_KEY = 'korean-law.auth.base-url';
const AUTH_TOKEN_STORAGE_KEY = 'korean-law.auth.token';
const LETTER_PATTERN = /[A-Za-z]/;
const NUMBER_PATTERN = /\d/;
const SPECIAL_PATTERN = /[!-/:-@[-`{-~]/;

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in privacy-restricted browsers.
  }
}

export function getInitialAuthBaseUrl() {
  const stored = readStorage(AUTH_BASE_URL_STORAGE_KEY);
  return normalizeBaseUrl(stored || DEFAULT_AUTH_BASE_URL) || DEFAULT_AUTH_BASE_URL;
}

export function saveAuthBaseUrl(value: string) {
  const next = normalizeBaseUrl(value) || DEFAULT_AUTH_BASE_URL;
  writeStorage(AUTH_BASE_URL_STORAGE_KEY, next);
  return next;
}

export function loadStoredToken() {
  return readStorage(AUTH_TOKEN_STORAGE_KEY);
}

export function saveStoredToken(token: string) {
  writeStorage(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures in privacy-restricted browsers.
  }
}

export function evaluatePasswordPolicy(password: string): PasswordPolicyState {
  const minLength = password.length >= 9;
  const hasLetter = LETTER_PATTERN.test(password);
  const hasNumber = NUMBER_PATTERN.test(password);
  const hasSpecial = SPECIAL_PATTERN.test(password);

  return {
    minLength,
    hasLetter,
    hasNumber,
    hasSpecial,
    valid: minLength && hasLetter && hasNumber && hasSpecial,
  };
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as { error?: unknown }).error === 'string'
  ) {
    return (payload as { error: string }).error;
  }

  return fallback;
}

async function requestJson<T>(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');

  const response = await fetch(url, {
    ...init,
    headers,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      extractErrorMessage(payload, `Request failed with ${response.status}.`),
    );
  }

  return payload as T;
}

function normalizeAuthResponse(payload: RawAuthResponse): AuthResponse {
  const token = payload.token ?? payload.accessToken;
  if (!token) {
    throw new Error('Auth response is missing a token.');
  }

  return {
    token,
    token_type: payload.token_type ?? payload.tokenType ?? 'Bearer',
    expires_in: payload.expires_in ?? payload.expiresIn ?? 0,
    user: payload.user as AuthUser,
    issued_at: payload.issued_at ?? payload.issuedAt ?? new Date().toISOString(),
    message: payload.message,
  };
}

function normalizeMeResponse(payload: RawMeResponse): MeResponse {
  return {
    user: payload.user as AuthUser,
    token_type: payload.token_type ?? payload.tokenType ?? 'Bearer',
  };
}

export async function signup(baseUrl: string, payload: { email: string; password: string }) {
  const response = await requestJson<RawAuthResponse>(`${normalizeBaseUrl(baseUrl)}/auth/signup`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizeAuthResponse(response);
}

export async function login(baseUrl: string, payload: { email: string; password: string }) {
  const response = await requestJson<RawAuthResponse>(`${normalizeBaseUrl(baseUrl)}/auth/login`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizeAuthResponse(response);
}

export async function fetchMe(baseUrl: string, token: string) {
  const response = await requestJson<RawMeResponse>(`${normalizeBaseUrl(baseUrl)}/auth/me`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  return normalizeMeResponse(response);
}

export function checkHealth(baseUrl: string) {
  return requestJson<HealthResponse>(`${normalizeBaseUrl(baseUrl)}/health`, {
    method: 'GET',
  });
}
