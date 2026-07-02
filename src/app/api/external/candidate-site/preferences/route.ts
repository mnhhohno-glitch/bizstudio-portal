import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-128: 求職者サイト向け「面談由来の希望条件」API。
// 「条件が近い求人」レーンの seed 供給口。mypage BFF が本人希望があればこれを seed に、
// なければ CAおすすめ類似にフォールバックする（2段化）。
//
// GET /api/external/candidate-site/preferences?candidateNumber=... （または candidateId）
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（全401）。T2 と同一。
// - スコープ: リクエストが指す候補者に厳密スコープ。全クエリで candidateId を条件に含める。
// - ホワイトリスト: 希望職種・希望勤務地(都道府県)・希望年収 と 出典メタ(面談日) のみ返す。
//   面談ログ本文・退職理由・所感・評価等の面談情報は一切返さない。
// - 変換なし: job-platform 検索パラメータへのマッピングは mypage 側 seed 関数の責務。素の値を返すだけ。
// - 希望条件が無い候補者は 200 で hasPreferences:false（404 にしない。mypage のフォールバック判定用）。

type Preferences = {
  desiredJobTypes: string[]; // 保存されている名称のまま（"営業 / 法人営業 / 新規開拓" 等）。複数可。
  desiredPrefectures: string[]; // 都道府県レベル。複数可。
  desiredSalaryMin: number | null; // 万円
  desiredSalaryMax: number | null; // 万円
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// desiredAreas JSON（[{ area, prefecture, city }]）から都道府県だけを安全に取り出す。
function prefecturesFromAreasJson(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const out: string[] = [];
  for (const item of json) {
    if (item && typeof item === "object" && "prefecture" in item) {
      const p = (item as { prefecture?: unknown }).prefecture;
      if (typeof p === "string" && p.trim()) out.push(p.trim());
    }
  }
  return out;
}

function uniqNonEmpty(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

type DetailSubset = {
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredPrefecture: string | null;
  desiredAreas: unknown;
  desiredSalaryMin: number | null;
  desiredSalaryMax: number | null;
};

// detail から希望条件を抽出。ホワイトリストのフィールドのみ参照。
function extractPreferences(detail: DetailSubset): Preferences {
  const desiredJobTypes = uniqNonEmpty([detail.desiredJobType1, detail.desiredJobType2]);
  const desiredPrefectures = uniqNonEmpty([
    ...prefecturesFromAreasJson(detail.desiredAreas),
    detail.desiredPrefecture,
  ]);
  return {
    desiredJobTypes,
    desiredPrefectures,
    desiredSalaryMin: detail.desiredSalaryMin ?? null,
    desiredSalaryMax: detail.desiredSalaryMax ?? null,
  };
}

function hasAnyPreference(p: Preferences): boolean {
  return (
    p.desiredJobTypes.length > 0 ||
    p.desiredPrefectures.length > 0 ||
    p.desiredSalaryMin !== null ||
    p.desiredSalaryMax !== null
  );
}

export async function GET(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const candidate = await resolveScopedCandidate({
    candidateId: searchParams.get("candidateId"),
    candidateNumber: searchParams.get("candidateNumber"),
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 候補者スコープの面談を新しい順に取得し、希望条件を持つ最新の面談を採用する。
  // 最新面談に希望条件が無い場合でも、より古い面談に希望条件があれば seed として有用なため
  // 「希望条件を持つ最新の面談」を採用（採用した面談日を source.interviewDate で明示）。
  // 参照するのはホワイトリストのフィールドのみ（面談ログ本文・退職理由・所感等は select しない）。
  const interviews = await prisma.interviewRecord.findMany({
    where: { candidateId: candidate.id },
    orderBy: { interviewDate: "desc" },
    select: {
      interviewDate: true,
      detail: {
        select: {
          desiredJobType1: true,
          desiredJobType2: true,
          desiredPrefecture: true,
          desiredAreas: true,
          desiredSalaryMin: true,
          desiredSalaryMax: true,
        },
      },
    },
  });

  for (const iv of interviews) {
    if (!iv.detail) continue;
    const prefs = extractPreferences(iv.detail);
    if (hasAnyPreference(prefs)) {
      return NextResponse.json({
        ok: true,
        candidateNumber: candidate.candidateNumber,
        hasPreferences: true,
        preferences: prefs,
        source: { interviewDate: iv.interviewDate.toISOString().slice(0, 10) },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    candidateNumber: candidate.candidateNumber,
    hasPreferences: false,
    preferences: null,
    source: null,
  });
}
