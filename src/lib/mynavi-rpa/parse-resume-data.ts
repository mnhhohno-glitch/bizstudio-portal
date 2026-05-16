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
  };
}
