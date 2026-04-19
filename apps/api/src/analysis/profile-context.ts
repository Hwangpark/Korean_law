export type UserGender = "male" | "female";
export type UserNationality = "korean" | "foreign";
export type UserAgeBand = "child" | "minor" | "adult" | "unknown";

export interface UserProfileContext {
  displayName?: string;
  birthDate?: string;
  gender?: UserGender;
  nationality?: UserNationality;
  ageYears?: number;
  ageBand: UserAgeBand;
  isMinor: boolean;
  legalNotes: string[];
}

type ProfileLike = {
  displayName?: unknown;
  display_name?: unknown;
  name?: unknown;
  birthDate?: unknown;
  birth_date?: unknown;
  gender?: unknown;
  nationality?: unknown;
  ageYears?: unknown;
  age_years?: unknown;
  ageBand?: unknown;
  age_band?: unknown;
  isMinor?: unknown;
  is_minor?: unknown;
};

function normalizeText(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function normalizeBirthDate(value: unknown): string | undefined {
  const raw = normalizeText(value);
  if (!raw) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    return undefined;
  }

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeGender(value: unknown): UserGender | undefined {
  if (value === "male" || value === "남" || value === "남성") {
    return "male";
  }
  if (value === "female" || value === "여" || value === "여성") {
    return "female";
  }
  return undefined;
}

function normalizeNationality(value: unknown): UserNationality | undefined {
  if (value === "korean" || value === "내국인") {
    return "korean";
  }
  if (value === "foreign" || value === "외국인") {
    return "foreign";
  }
  return undefined;
}

function calculateAgeYears(birthDate: string, now = new Date()): number {
  const [year, month, day] = birthDate.split("-").map((value) => Number.parseInt(value, 10));
  let age = now.getUTCFullYear() - year;
  const hasHadBirthday =
    now.getUTCMonth() + 1 > month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);

  if (!hasHadBirthday) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function deriveAgeBand(ageYears: number | undefined): UserAgeBand {
  if (typeof ageYears !== "number" || Number.isNaN(ageYears)) {
    return "unknown";
  }

  if (ageYears < 18) {
    return "child";
  }

  if (ageYears < 19) {
    return "minor";
  }

  return "adult";
}

function normalizeAgeYears(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAgeBand(value: unknown): UserAgeBand | undefined {
  return value === "child" || value === "minor" || value === "adult" || value === "unknown"
    ? value
    : undefined;
}

function buildLegalNotes(context: {
  ageBand: UserAgeBand;
  isMinor: boolean;
  nationality?: UserNationality;
}): string[] {
  const notes: string[] = [];

  if (context.isMinor) {
    notes.push("미성년자 사건은 보호자 또는 법정대리인 동행 여부와 제출 절차를 함께 확인하는 편이 안전합니다.");
  }

  if (context.ageBand === "child") {
    notes.push("18세 미만이면 아동·청소년 보호 관점에서 증거 보존과 접근 차단 조치를 더 우선 검토하세요.");
  }

  if (context.nationality === "foreign") {
    notes.push("외국인 사용자는 여권 또는 외국인등록증 등 신분 자료와 번역 필요 여부를 함께 확인하세요.");
  }

  return notes;
}

export function buildProfileContext(profile: ProfileLike | null | undefined): UserProfileContext | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const displayName = normalizeText(profile.displayName ?? profile.display_name ?? profile.name);
  const birthDate = normalizeBirthDate(profile.birthDate ?? profile.birth_date);
  const gender = normalizeGender(profile.gender);
  const nationality = normalizeNationality(profile.nationality);
  const ageYears = normalizeAgeYears(profile.ageYears ?? profile.age_years) ?? (birthDate ? calculateAgeYears(birthDate) : undefined);
  const ageBand = normalizeAgeBand(profile.ageBand ?? profile.age_band) ?? deriveAgeBand(ageYears);
  const isMinor = typeof profile.isMinor === "boolean"
    ? profile.isMinor
    : typeof profile.is_minor === "boolean"
      ? profile.is_minor
      : typeof ageYears === "number"
        ? ageYears < 19
        : false;

  return {
    displayName,
    birthDate,
    gender,
    nationality,
    ...(typeof ageYears === "number" ? { ageYears } : {}),
    ageBand,
    isMinor,
    legalNotes: buildLegalNotes({
      ageBand,
      isMinor,
      nationality
    })
  };
}

export function sanitizePublicProfileContext(profile: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  const gender = normalizeGender(profile.gender);
  const nationality = normalizeNationality(profile.nationality);
  const ageYears = normalizeAgeYears(profile.ageYears ?? profile.age_years);
  const ageBand = normalizeAgeBand(profile.ageBand ?? profile.age_band) ?? deriveAgeBand(ageYears);
  const isMinor = typeof profile.isMinor === "boolean"
    ? profile.isMinor
    : typeof profile.is_minor === "boolean"
      ? profile.is_minor
      : typeof ageYears === "number"
        ? ageYears < 19
        : false;
  const legalNotes = Array.isArray(profile.legalNotes)
    ? profile.legalNotes.map((item) => String(item ?? "").trim()).filter(Boolean)
    : Array.isArray(profile.legal_notes)
      ? profile.legal_notes.map((item) => String(item ?? "").trim()).filter(Boolean)
      : buildLegalNotes({ ageBand, isMinor, nationality });

  const sanitized = {
    ...(gender ? { gender } : {}),
    ...(nationality ? { nationality } : {}),
    ageBand,
    isMinor,
    ...(legalNotes.length > 0 ? { legalNotes } : {})
  };

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
