export type AuthProfile = {
  displayName?: string;
  birthDate?: string;
  name?: string;
  birth_date?: string;
  gender?: string;
  nationality?: string;
  ageYears?: number;
  ageBand?: string;
  isMinor?: boolean;
  age_years?: number;
  age_band?: string;
  is_minor?: boolean;
  [key: string]: unknown;
};

export type AuthUser = {
  id: number;
  email: string;
  profile?: AuthProfile | null;
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

export type AnalyzeCasePayload = {
  title?: string;
  context_type: string;
  input_mode: 'text' | 'image' | 'link';
  text?: string;
  url?: string;
  image_base64?: string;
  image_name?: string;
  image_mime_type?: string;
  guest_id?: string;
};

export type AnalysisHistoryItem = {
  caseId: string;
  inputMode: string;
  contextType: string;
  title: string;
  sourceUrl: string | null;
  createdAt: string;
  summary: string;
  riskLevel: number;
  canSue: boolean;
};

export type AnalysisHistoryDetailResponse = AnalyzeCaseResponse & {
  case_id?: string;
  run_id?: string;
  title?: string;
  input_mode?: string;
  context_type?: string;
  created_at?: string;
  source_url?: string | null;
  timeline?: Array<Record<string, unknown>>;
  profile_context?: Record<string, unknown>;
};

export type AnalysisReferenceItem = {
  id?: string;
  kind?: 'law' | 'precedent' | string;
  href?: string;
  title?: string;
  subtitle?: string;
  summary?: string;
  details?: string;
  note?: string;
  description?: string;
  url?: string;
  link?: string;
  source_url?: string;
  law_name?: string;
  article_no?: string;
  articleNo?: string;
  case_no?: string;
  caseNo?: string;
  court?: string;
  verdict?: string;
  label?: string;
  category?: string;
  confidence_score?: number;
  confidenceScore?: number;
  match_reason?: string;
  matchReason?: string;
  matchedQueries?: string[];
  matched_queries?: string[];
  matchedQueryRefs?: Array<Record<string, unknown>>;
  matched_query_refs?: Array<Record<string, unknown>>;
  matchedIssueTypes?: string[];
  matched_issue_types?: string[];
  referenceKey?: string;
  reference_key?: string;
  citationId?: string;
  citation_id?: string;
  referenceId?: string;
  reference_id?: string;
  lawReferenceId?: string;
  law_reference_id?: string;
  precedentReferenceIds?: string[];
  precedent_reference_ids?: string[];
  snippet?: {
    field?: string;
    text?: string;
  };
  sourceMode?: string;
  similarityScore?: number;
  tags?: string[];
  keywords?: string[];
  references?: AnalysisReferenceItem[];
  laws?: AnalysisReferenceItem[];
  precedents?: AnalysisReferenceItem[];
  items?: AnalysisReferenceItem[];
};

export type AnalysisLegalResult = {
  can_sue?: boolean;
  risk_level?: number;
  summary?: string;
  charges?: Array<Record<string, unknown> & {
    charge?: string;
    basis?: string;
    elements_met?: string[];
    probability?: 'high' | 'medium' | 'low';
    expected_penalty?: string;
    reference_library?: AnalysisReferenceItem[];
    referenceLibrary?: AnalysisReferenceItem[];
    references?: AnalysisReferenceItem[];
  }>;
  recommended_actions?: string[];
  evidence_to_collect?: string[];
  precedent_cards?: Array<Record<string, unknown> & {
    case_no?: string;
    court?: string;
    verdict?: string;
    summary?: string;
    similarity_score?: number;
    reference_library?: AnalysisReferenceItem[];
    referenceLibrary?: AnalysisReferenceItem[];
    references?: AnalysisReferenceItem[];
  }>;
  disclaimer?: string;
  reference_library?: AnalysisReferenceItem[];
  law_reference_library?: AnalysisReferenceItem[];
  precedent_reference_library?: AnalysisReferenceItem[];
  matched_laws?: AnalysisReferenceItem[];
  matched_precedents?: AnalysisReferenceItem[];
  user_profile?: AuthProfile | null;
  profile_context?: AuthProfile | null;
  profile_guidance?:
    | {
        title?: string;
        summary?: string;
        items?: string[];
        note?: string;
      }
    | string[];
  age_band?: string;
  age_years?: number;
  is_minor?: boolean;
};

export type AnalyzeCaseResponse = {
  legal_analysis?: AnalysisLegalResult;
  reference_library?: {
    items?: AnalysisReferenceItem[];
  } | AnalysisReferenceItem[];
  guest_id?: string;
  guest_remaining?: number;
  meta?: {
    guest_id?: string;
    guest_remaining?: number;
  };
  [key: string]: unknown;
};

export type AnalyzeJobStartResponse = {
  job_id: string;
  stream_url?: string;
  result_url?: string;
  guest_id?: string;
  guest_remaining?: number;
  meta?: {
    guest_id?: string;
    guest_remaining?: number;
  };
  [key: string]: unknown;
};

export type GuestSession = {
  guestId: string;
  guestRemaining: number;
};

export type PasswordPolicyState = {
  minLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  valid: boolean;
};

type RawAuthUser = Partial<AuthUser> & {
  profile?: Partial<AuthProfile> | null;
};

type RawAuthResponse = Partial<AuthResponse> & {
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  issuedAt?: string;
  user?: RawAuthUser;
};

type RawMeResponse = Partial<MeResponse> & {
  tokenType?: string;
  user?: RawAuthUser;
};

export const DEFAULT_AUTH_BASE_URL =
  import.meta.env.VITE_AUTH_BASE_URL ?? 'http://localhost:3001';
export const PASSWORD_POLICY_HINT =
  '9자 이상, 영문, 숫자, 특수문자를 모두 포함해야 합니다.';

const AUTH_BASE_URL_STORAGE_KEY = 'korean-law.auth.base-url';
const AUTH_TOKEN_STORAGE_KEY = 'korean-law.auth.token';
const GUEST_SESSION_STORAGE_KEY = 'korean-law.guest.session';
const DEFAULT_GUEST_LIMIT = 10;
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

function createGuestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeGuestSession(payload: unknown): GuestSession | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const guestId =
    typeof (payload as { guestId?: unknown }).guestId === 'string'
      ? (payload as { guestId: string }).guestId
      : typeof (payload as { guest_id?: unknown }).guest_id === 'string'
        ? (payload as { guest_id: string }).guest_id
        : null;

  const guestRemainingValue =
    typeof (payload as { guestRemaining?: unknown }).guestRemaining === 'number'
      ? (payload as { guestRemaining: number }).guestRemaining
      : typeof (payload as { guest_remaining?: unknown }).guest_remaining === 'number'
        ? (payload as { guest_remaining: number }).guest_remaining
        : null;

  if (!guestId || guestRemainingValue === null || Number.isNaN(guestRemainingValue)) {
    return null;
  }

  return {
    guestId,
    guestRemaining: Math.max(0, Math.min(DEFAULT_GUEST_LIMIT, Math.floor(guestRemainingValue))),
  };
}

export function loadStoredGuestSession() {
  try {
    const raw = window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeGuestSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getInitialGuestSession() {
  return loadStoredGuestSession() ?? {
    guestId: createGuestId(),
    guestRemaining: DEFAULT_GUEST_LIMIT,
  };
}

export function saveGuestSession(session: GuestSession) {
  try {
    window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage failures in privacy-restricted browsers.
  }
}

export function clearStoredGuestSession() {
  try {
    window.localStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
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

  const rawUser = payload.user;

  return {
    token,
    token_type: payload.token_type ?? payload.tokenType ?? 'Bearer',
    expires_in: payload.expires_in ?? payload.expiresIn ?? 0,
    user: rawUser
      ? {
          id: typeof rawUser.id === 'number' ? rawUser.id : 0,
          email: typeof rawUser.email === 'string' ? rawUser.email : '',
          profile: rawUser.profile
            ? {
              ...rawUser.profile,
                displayName:
                  typeof rawUser.profile.displayName === 'string' ? rawUser.profile.displayName : undefined,
                name: typeof rawUser.profile.name === 'string' ? rawUser.profile.name : undefined,
                birthDate:
                  typeof rawUser.profile.birthDate === 'string' ? rawUser.profile.birthDate : undefined,
                birth_date:
                  typeof rawUser.profile.birth_date === 'string' ? rawUser.profile.birth_date : undefined,
                gender: typeof rawUser.profile.gender === 'string' ? rawUser.profile.gender : undefined,
                nationality:
                  typeof rawUser.profile.nationality === 'string' ? rawUser.profile.nationality : undefined,
                ageYears:
                  typeof rawUser.profile.ageYears === 'number' ? rawUser.profile.ageYears : undefined,
                ageBand:
                  typeof rawUser.profile.ageBand === 'string' ? rawUser.profile.ageBand : undefined,
                isMinor:
                  typeof rawUser.profile.isMinor === 'boolean' ? rawUser.profile.isMinor : undefined,
                age_years:
                  typeof rawUser.profile.age_years === 'number' ? rawUser.profile.age_years : undefined,
                age_band:
                  typeof rawUser.profile.age_band === 'string' ? rawUser.profile.age_band : undefined,
                is_minor:
                  typeof rawUser.profile.is_minor === 'boolean' ? rawUser.profile.is_minor : undefined,
              }
            : null,
        }
      : { id: 0, email: '' },
    issued_at: payload.issued_at ?? payload.issuedAt ?? new Date().toISOString(),
    message: payload.message,
  };
}

function normalizeMeResponse(payload: RawMeResponse): MeResponse {
  const rawUser = payload.user;

  return {
    user: rawUser
      ? {
          id: typeof rawUser.id === 'number' ? rawUser.id : 0,
          email: typeof rawUser.email === 'string' ? rawUser.email : '',
          profile: rawUser.profile
            ? {
              ...rawUser.profile,
                displayName:
                  typeof rawUser.profile.displayName === 'string' ? rawUser.profile.displayName : undefined,
                name: typeof rawUser.profile.name === 'string' ? rawUser.profile.name : undefined,
                birthDate:
                  typeof rawUser.profile.birthDate === 'string' ? rawUser.profile.birthDate : undefined,
                birth_date:
                  typeof rawUser.profile.birth_date === 'string' ? rawUser.profile.birth_date : undefined,
                gender: typeof rawUser.profile.gender === 'string' ? rawUser.profile.gender : undefined,
                nationality:
                  typeof rawUser.profile.nationality === 'string' ? rawUser.profile.nationality : undefined,
                ageYears:
                  typeof rawUser.profile.ageYears === 'number' ? rawUser.profile.ageYears : undefined,
                ageBand:
                  typeof rawUser.profile.ageBand === 'string' ? rawUser.profile.ageBand : undefined,
                isMinor:
                  typeof rawUser.profile.isMinor === 'boolean' ? rawUser.profile.isMinor : undefined,
                age_years:
                  typeof rawUser.profile.age_years === 'number' ? rawUser.profile.age_years : undefined,
                age_band:
                  typeof rawUser.profile.age_band === 'string' ? rawUser.profile.age_band : undefined,
                is_minor:
                  typeof rawUser.profile.is_minor === 'boolean' ? rawUser.profile.is_minor : undefined,
              }
            : null,
        }
      : { id: 0, email: '' },
    token_type: payload.token_type ?? payload.tokenType ?? 'Bearer',
  };
}

export type EmailCodeResponse = {
  message: string;
  delivery?: 'email' | 'debug' | string;
  debug_code?: string;
};

export type EmailCodeVerificationResponse = {
  message: string;
  verified: boolean;
};

export type SignupPayload = {
  email: string;
  password: string;
  verification_code: string;
  name: string;
  birth_date: string;
  gender: string;
  nationality: string;
};

export async function requestEmailCode(baseUrl: string, email: string): Promise<EmailCodeResponse> {
  return requestJson<EmailCodeResponse>(`${normalizeBaseUrl(baseUrl)}/auth/request-email-code`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyEmailCode(
  baseUrl: string,
  payload: { email: string; verification_code: string },
): Promise<EmailCodeVerificationResponse> {
  return requestJson<EmailCodeVerificationResponse>(`${normalizeBaseUrl(baseUrl)}/auth/verify-email-code`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function signup(
  baseUrl: string,
  payload: SignupPayload,
) {
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

export async function analyzeCase(
  baseUrl: string,
  token: string | null | undefined,
  payload: AnalyzeCasePayload,
) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return requestJson<AnalyzeJobStartResponse>(`${normalizeBaseUrl(baseUrl)}/api/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export async function fetchAnalysisResult(baseUrl: string, jobId: string) {
  return requestJson<AnalyzeCaseResponse>(`${normalizeBaseUrl(baseUrl)}/api/analyze/${encodeURIComponent(jobId)}`, {
    method: 'GET',
  });
}

export type KeywordVerifyPayload = {
  keyword: string;
  context_type: string;
  guest_id?: string;
};

export async function verifyKeyword(
  baseUrl: string,
  token: string | null | undefined,
  payload: KeywordVerifyPayload,
) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return requestJson<AnalyzeCaseResponse>(`${normalizeBaseUrl(baseUrl)}/api/keywords/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: payload.keyword,
      context_type: payload.context_type,
      ...(payload.guest_id ? { guest_id: payload.guest_id } : {}),
      limit: 4,
    }),
  });
}

export async function fetchHistory(baseUrl: string, token: string) {
  const response = await requestJson<{ items?: AnalysisHistoryItem[] }>(
    `${normalizeBaseUrl(baseUrl)}/api/history`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );

  return Array.isArray(response.items) ? response.items : [];
}

export async function fetchHistoryDetail(baseUrl: string, token: string, caseId: string) {
  return requestJson<AnalysisHistoryDetailResponse>(
    `${normalizeBaseUrl(baseUrl)}/api/history/${encodeURIComponent(caseId)}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  );
}
