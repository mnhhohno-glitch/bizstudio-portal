import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/external/bookmarks/job-attributes
 * T-196: ブックマーク行の「エリア」「職種」の埋め戻し（既存分 約5,000行の一括更新）。
 *
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。from-job-platform と同一。
 * - 値の出どころは job-platform（求人プラットフォーム）が取り込み時に自社マスタの対応表で
 *   機械的に確定した値。portal 側では推測・生成をしない（AI呼び出しなし）。
 * - 対象は externalJobRef が一致する **全** CandidateFile（category="BOOKMARK"・archivedAt 問わず）。
 *   同一求人は求職者をまたいで同じ属性を持つため、行ごとの出し分けはしない。
 * - 既に値が入っている行も上書きする（job-platform が正）。null を送れば消える。
 * - 1リクエスト最大 500 件。
 *
 * body: { items: Array<{ externalJobRef: string; jobArea: string|null; jobCategory: string|null; jobCategoryPath: string|null }> }
 * res : { matchedRefs: number; updatedRows: number }
 */

const MAX_ITEMS = 500;
const MAX_LEN = 200; // 表示用の短い文字列。超過は切り詰め（受信自体は失敗させない）

type Item = {
  externalJobRef?: unknown;
  jobArea?: unknown;
  jobCategory?: unknown;
  jobCategoryPath?: unknown;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function strMax(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }
  if (rawItems.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `items must be ${MAX_ITEMS} or fewer (got ${rawItems.length})` },
      { status: 400 },
    );
  }

  let matchedRefs = 0;
  let updatedRows = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = (rawItems[i] ?? {}) as Item;
    const externalJobRef = str(item.externalJobRef);
    if (!externalJobRef) {
      errors.push({ index: i, error: "externalJobRef is required" });
      continue;
    }
    try {
      // 3項目とも「送られてきた値で上書き」。未指定（undefined）も null 扱いで消す
      //  ＝ job-platform 側の現在値をそのまま写す（部分更新はしない）。
      const result = await prisma.candidateFile.updateMany({
        where: { category: "BOOKMARK", externalJobRef },
        data: {
          jobArea: strMax(item.jobArea),
          jobCategory: strMax(item.jobCategory),
          jobCategoryPath: strMax(item.jobCategoryPath),
        },
      });
      if (result.count > 0) matchedRefs++;
      updatedRows += result.count;
    } catch (e) {
      console.error("[external/bookmarks/job-attributes] update failed:", e);
      errors.push({ index: i, error: "update failed" });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    received: rawItems.length,
    matchedRefs, // 1行以上更新できた externalJobRef の数
    updatedRows, // 実際に更新した CandidateFile の行数
    errors,
  });
}
