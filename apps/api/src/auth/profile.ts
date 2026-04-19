export interface UserProfileInput {
  name: string;
  birthDate: string;
  gender: string;
  nationality: string;
}

export interface ProfileRowLike {
  profile_display_name: string | null;
  profile_birth_date: string | null;
  profile_gender: string | null;
  profile_nationality: string | null;
}

export interface PublicUserProfile extends Record<string, unknown> {
  displayName: string;
  birthDate: string | null;
  gender: string | null;
  nationality: string | null;
  ageYears: number | null;
  ageBand: "child" | "minor" | "adult" | null;
  isMinor: boolean | null;
}

export type ProfileValidationResult =
  | { ok: true; value: UserProfileInput }
  | { ok: false; error: string };

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isValidBirthDate(value: string): boolean {
  if (!BIRTH_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function calculateAgeYears(birthDate: string): number | null {
  if (!isValidBirthDate(birthDate)) {
    return null;
  }

  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - parsed.getUTCMonth();
  const dayDiff = today.getUTCDate() - parsed.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function normalizeGenderValue(value: string): string | null {
  switch (value) {
    case "male":
    case "남":
    case "남성":
      return "male";
    case "female":
    case "여":
    case "여성":
      return "female";
    default:
      return null;
  }
}

function normalizeNationalityValue(value: string): string | null {
  switch (value) {
    case "korean":
    case "내국인":
      return "korean";
    case "foreign":
    case "외국인":
      return "foreign";
    default:
      return null;
  }
}

export function normalizeProfilePayload(payload: Record<string, unknown>): ProfileValidationResult {
  const displayName = firstString(payload, ["displayName", "name", "signupName", "display_name"]);
  if (!displayName) {
    return { ok: false, error: "이름을 입력해주세요." };
  }

  const birthDate = firstString(payload, ["birthDate", "birth_date", "signupBirthday"]);
  if (!birthDate) {
    return { ok: false, error: "생년월일을 입력해주세요." };
  }
  if (!isValidBirthDate(birthDate)) {
    return { ok: false, error: "생년월일은 YYYY-MM-DD 형식으로 입력해주세요." };
  }
  if (calculateAgeYears(birthDate) === null) {
    return { ok: false, error: "생년월일은 미래일 수 없습니다." };
  }

  const genderInput = firstString(payload, ["gender", "signupGender"]);
  const gender = genderInput ? normalizeGenderValue(genderInput) : null;
  if (!gender) {
    return { ok: false, error: "성별은 male 또는 female 값이어야 합니다." };
  }

  const nationalityInput = firstString(payload, ["nationality", "signupNationality"]);
  const nationality = nationalityInput ? normalizeNationalityValue(nationalityInput) : null;
  if (!nationality) {
    return { ok: false, error: "국적 구분은 korean 또는 foreign 값이어야 합니다." };
  }

  return {
    ok: true,
    value: {
      name: displayName,
      birthDate,
      gender,
      nationality
    }
  };
}

export function createPublicUserProfile(input: UserProfileInput): PublicUserProfile {
  const ageYears = calculateAgeYears(input.birthDate);
  const ageBand = ageYears === null ? null : ageYears < 18 ? "child" : ageYears < 19 ? "minor" : "adult";

  return {
    displayName: input.name,
    birthDate: input.birthDate,
    gender: input.gender,
    nationality: input.nationality,
    ageYears,
    ageBand,
    isMinor: ageYears === null ? null : ageYears < 19
  };
}

export function toPublicUserProfile(row: ProfileRowLike | null): PublicUserProfile | null {
  if (!row || !row.profile_display_name) {
    return null;
  }

  return createPublicUserProfile({
    name: row.profile_display_name,
    birthDate: row.profile_birth_date ?? "",
    gender: row.profile_gender ?? "",
    nationality: row.profile_nationality ?? ""
  });
}
