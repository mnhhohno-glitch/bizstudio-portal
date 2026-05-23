/**
 * Gemini API（gemini-resume-parser）が返す履歴書 JSON から
 * Candidate 登録・送信可否判定に必要なフィールドを抽出する。
 *
 * Gemini レスポンスは name / furigana / birthday / gender / phone / address /
 * email を含む。キー名のゆらぎにも対応するため複数候補で探索する。
 * 抽出できなければ null を返し、呼び出し側で AI_FAILED として扱う。
 */

export type ParsedResumeFields = {
  name: string | null;
  nameKana: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: Date | null;
  phone: string | null;
  address: string | null;
  gender: string | null;
  email: string | null;
  consultantName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredIndustry1: string | null;
  desiredIndustry2: string | null;
  desiredPrefecture1: string | null;
  desiredPrefecture2: string | null;
  desiredEmploymentType: string | null;
  desiredSalaryMin: number | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/** resumeData の top-level + 1段ネストを平坦化してキー探索しやすくする */
function flatten(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...data };
  for (const v of Object.values(data)) {
    const nested = asRecord(v);
    if (nested) {
      for (const [nk, nv] of Object.entries(nested)) {
        if (flat[nk] === undefined) flat[nk] = nv;
      }
    }
  }
  return flat;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** 文字列から生年月日を抽出（YYYY-MM-DD / YYYY/MM/DD / YYYY年MM月DD日 等） */
export function parseBirthDate(raw: string | null): Date | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeGender(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/男|male|m/i.test(s) && !/female/i.test(s)) return "male";
  if (/女|female|f/i.test(s)) return "female";
  return null;
}

export function parseResumeData(resumeData: unknown): ParsedResumeFields {
  const root = asRecord(resumeData);
  if (!root) {
    return {
      name: null,
      nameKana: null,
      lastName: null,
      firstName: null,
      birthDate: null,
      phone: null,
      address: null,
      gender: null,
      email: null,
      consultantName: null,
      applicationRoute: null,
      mediaSource: null,
      desiredJobType1: null,
      desiredJobType2: null,
      desiredIndustry1: null,
      desiredIndustry2: null,
      desiredPrefecture1: null,
      desiredPrefecture2: null,
      desiredEmploymentType: null,
      desiredSalaryMin: null,
    };
  }

  const flat = flatten(root);

  const lastName = pickString(flat, [
    "lastName",
    "last_name",
    "familyName",
    "family_name",
    "sei",
    "姓",
  ]);
  const firstName = pickString(flat, [
    "firstName",
    "first_name",
    "givenName",
    "given_name",
    "mei",
    "名",
  ]);

  let name = pickString(flat, [
    "name",
    "fullName",
    "full_name",
    "candidateName",
    "candidate_name",
    "氏名",
    "名前",
  ]);
  if (!name && (lastName || firstName)) {
    name = [lastName, firstName].filter(Boolean).join(" ");
  }

  const birthRaw = pickString(flat, [
    "birthDate",
    "birth_date",
    "birthday",
    "dateOfBirth",
    "date_of_birth",
    "生年月日",
  ]);
  const birthDate = parseBirthDate(birthRaw);

  const phone = pickString(flat, [
    "phone",
    "phoneNumber",
    "phone_number",
    "tel",
    "telephone",
    "電話番号",
    "携帯電話",
  ]);

  const address = pickString(flat, [
    "address",
    "currentAddress",
    "current_address",
    "住所",
    "現住所",
  ]);

  const email = pickString(flat, ["email", "mail", "mailAddress", "メールアドレス"]);

  const gender = normalizeGender(
    pickString(flat, ["gender", "sex", "性別"]),
  );

  const nameKana = pickString(flat, [
    "nameKana",
    "name_kana",
    "kana",
    "furigana",
    "フリガナ",
    "ふりがな",
  ]);

  const consultantName = pickString(flat, [
    "consultantName",
    "consultant_name",
    "コンサルタント名",
  ]);

  const applicationRoute = pickString(flat, [
    "applicationRoute",
    "application_route",
    "応募経路",
  ]);

  const mediaSource = pickString(flat, [
    "mediaSource",
    "media_source",
    "媒体",
    "媒体名",
  ]);

  const desiredJobType1 = pickString(flat, [
    "desiredJobType1",
    "desired_job_type_1",
    "希望職種1",
    "希望職種_第1希望",
  ]);

  const desiredJobType2 = pickString(flat, [
    "desiredJobType2",
    "desired_job_type_2",
    "希望職種2",
    "希望職種_第2希望",
  ]);

  const desiredIndustry1 = pickString(flat, [
    "desiredIndustry1",
    "desired_industry_1",
    "希望業種",
    "希望業種1",
  ]);

  const desiredIndustry2 = pickString(flat, [
    "desiredIndustry2",
    "desired_industry_2",
    "desired_industry2",
    "希望業種2",
    "希望業種_第2希望",
  ]);

  const desiredPrefecture1 = pickString(flat, [
    "desiredPrefecture1",
    "desiredPrefecture",
    "desired_prefecture_1",
    "desired_prefecture1",
    "desired_prefecture",
    "希望勤務地",
    "希望勤務地1",
    "希望都道府県",
    "希望都道府県1",
  ]);

  const desiredPrefecture2 = pickString(flat, [
    "desiredPrefecture2",
    "desired_prefecture_2",
    "desired_prefecture2",
    "希望勤務地2",
    "希望都道府県2",
  ]);

  const desiredEmploymentType = pickString(flat, [
    "desiredEmploymentType",
    "desired_employment_type",
    "希望雇用形態",
  ]);

  const desiredSalaryRaw = flat.desiredSalaryMin ?? flat.desired_salary_min ?? flat["希望年収"];
  let desiredSalaryMin: number | null = null;
  if (typeof desiredSalaryRaw === "number" && Number.isFinite(desiredSalaryRaw)) {
    desiredSalaryMin = Math.trunc(desiredSalaryRaw);
  } else if (typeof desiredSalaryRaw === "string") {
    const numMatch = desiredSalaryRaw.match(/\d+/);
    if (numMatch) {
      const parsed = parseInt(numMatch[0], 10);
      if (Number.isFinite(parsed)) desiredSalaryMin = parsed;
    }
  }

  return {
    name,
    nameKana,
    lastName,
    firstName,
    birthDate,
    phone,
    address,
    gender,
    email,
    consultantName,
    applicationRoute,
    mediaSource,
    desiredJobType1,
    desiredJobType2,
    desiredIndustry1,
    desiredIndustry2,
    desiredPrefecture1,
    desiredPrefecture2,
    desiredEmploymentType,
    desiredSalaryMin,
  };
}
