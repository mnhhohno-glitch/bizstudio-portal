import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

// T-128 T2: 求職者サイト（mypage BFF）→ portal のサーバー間信頼境界。
//
// 認証モデル:
// - 求職者の本人確認（ShareToken＋誕生日）は mypage BFF が既存機構で行う。portal は誕生日を扱わない。
// - portal はサーバー間シークレット（X-Auth-Key = CANDIDATE_SITE_API_KEY）でのみ mypage BFF を信頼する。
// - リクエストには mypage が検証済みの candidateNumber / candidateId を含める。portal は該当候補者の
//   存在を確認し、以降のデータアクセスをその候補者に厳密スコープする（他候補者のデータを返さない）。
//
// fail-closed: CANDIDATE_SITE_API_KEY 未設定なら全リクエスト 401。

export const CANDIDATE_SITE_AUTH_HEADER = "x-auth-key";

/** X-Auth-Key を検証。env 未設定・ヘッダ欠落・不一致はすべて false（fail-closed）。 */
export function verifyCandidateSiteKey(request: Request): boolean {
  const expected = process.env.CANDIDATE_SITE_API_KEY;
  if (!expected) return false; // fail-closed: キー未設定なら誰も通さない
  const provided = request.headers.get(CANDIDATE_SITE_AUTH_HEADER);
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual は同長必須
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export type ScopedCandidate = { id: string; candidateNumber: string; name: string };

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * リクエストが指す候補者を1名だけ解決する。candidateId(cuid) 優先、無ければ candidateNumber。
 * 見つからなければ null。呼び出し側は返り値の id で全データアクセスをスコープすること。
 */
export async function resolveScopedCandidate(input: {
  candidateId?: unknown;
  candidateNumber?: unknown;
}): Promise<ScopedCandidate | null> {
  const idRaw = str(input.candidateId);
  const numRaw = str(input.candidateNumber);
  const key = idRaw ?? numRaw;
  if (!key) return null;

  const candidate = await prisma.candidate.findFirst({
    where: idRaw
      ? { id: idRaw }
      : key.startsWith("cm")
        ? { id: key }
        : { candidateNumber: key },
    select: { id: true, candidateNumber: true, name: true },
  });
  return candidate;
}
