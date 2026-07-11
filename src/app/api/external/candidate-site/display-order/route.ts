import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-133 FU-14a: 求人カードの手動並び順（displayOrder）。CA専用・単一目的エンドポイント（FU-13a display-overrides と同慣例）。
//
// PATCH /api/external/candidate-site/display-order
//   body: {
//     candidateNumber|candidateId,
//     actor: "ca",              // CAのみ。actor="user" は 403（本人は並び替え不可）。その他/欠落は 400。
//
//     // --- 次のいずれか一方（両方指定は 400） ---
//     orders?: [{ fileId, displayOrder }, ...],
//                               //  一括順序更新。displayOrder は整数（小さいほど先頭）または null（その行の手動順を解除）。
//                               //  並べ替え操作1回で「対象タブ内の順序」をまとめて保存する用途。1リクエスト最大500行。
//     clearAll?: true,          //  この候補者の全 BOOKMARK 行の手動順を解除（＝並びを既定に戻す）。
//   }
//
// 設計方針:
//   - 並び順は「候補者×求人行」ごと（CandidateFile.displayOrder）。他の求職者の並びには波及しない。
//   - 対象行は同一候補者・category="BOOKMARK"・非アーカイブに限定（スコープ外の fileId は 404 で明示的に弾く＝サイレント無視しない）。
//   - favorites GET の返却順は displayOrder ASC（NULL は後続）→ 既存ソート（createdAt DESC）。
//     全行 NULL なら従来と完全に同一の並び（後方互換）。
//   - 認証は X-Auth-Key（共有鍵・mypage BFF 信頼境界）。actor は body 申告（display-overrides / response-status と同一慣例）。
//     プレビューの管理者ゲート（actor=ca 経路）を通ったリクエストのみ actor="ca" で到達する想定。

const MAX_ORDERS = 500;
// Int32（Prisma Int = PostgreSQL INTEGER）の範囲。
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function PATCH(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId,
    candidateNumber: body.candidateNumber,
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // CAゲート: actor="ca" のみ許可。"user" は 403、その他/欠落は 400。
  const actor = body.actor;
  if (actor !== "ca" && actor !== "user") {
    return NextResponse.json({ error: "actor must be 'user' or 'ca'" }, { status: 400 });
  }
  if (actor === "user") {
    return NextResponse.json(
      { error: "actor=user cannot change displayOrder (CA only)" },
      { status: 403 },
    );
  }

  const hasOrders = "orders" in body && body.orders !== undefined && body.orders !== null;
  const clearAll = body.clearAll === true;

  if (hasOrders && clearAll) {
    return NextResponse.json(
      { error: "orders and clearAll are mutually exclusive" },
      { status: 400 },
    );
  }
  if (!hasOrders && !clearAll) {
    return NextResponse.json({ error: "orders or clearAll is required" }, { status: 400 });
  }

  // --- clearAll: 候補者の全 BOOKMARK 行の手動順を解除（既定の並びへ復帰） ---
  if (clearAll) {
    const res = await prisma.candidateFile.updateMany({
      where: {
        candidateId: candidate.id,
        category: "BOOKMARK",
        archivedAt: null,
        displayOrder: { not: null }, // 既に NULL の行は触らない（updatedAt の無用な更新を避ける）
      },
      data: { displayOrder: null },
    });
    return NextResponse.json({ ok: true, cleared: true, updated: res.count });
  }

  // --- orders: 一括順序更新 ---
  const rawOrders = body.orders;
  if (!Array.isArray(rawOrders)) {
    return NextResponse.json({ error: "orders must be an array" }, { status: 400 });
  }
  if (rawOrders.length === 0) {
    return NextResponse.json({ error: "orders must not be empty" }, { status: 400 });
  }
  if (rawOrders.length > MAX_ORDERS) {
    return NextResponse.json(
      { error: `orders exceeds max ${MAX_ORDERS} items` },
      { status: 400 },
    );
  }

  const parsed: { fileId: string; displayOrder: number | null }[] = [];
  const seen = new Set<string>();
  for (const [i, item] of rawOrders.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return NextResponse.json({ error: `orders[${i}] must be an object` }, { status: 400 });
    }
    const o = item as Record<string, unknown>;

    const fileId = typeof o.fileId === "string" ? o.fileId.trim() : "";
    if (!fileId) {
      return NextResponse.json({ error: `orders[${i}].fileId is required` }, { status: 400 });
    }
    if (seen.has(fileId)) {
      return NextResponse.json(
        { error: `orders[${i}].fileId is duplicated: ${fileId}` },
        { status: 400 },
      );
    }
    seen.add(fileId);

    const rawOrder = o.displayOrder;
    let displayOrder: number | null;
    if (rawOrder === null) {
      displayOrder = null; // その行の手動順を解除
    } else if (
      typeof rawOrder === "number" &&
      Number.isInteger(rawOrder) &&
      rawOrder >= INT32_MIN &&
      rawOrder <= INT32_MAX
    ) {
      displayOrder = rawOrder;
    } else {
      return NextResponse.json(
        { error: `orders[${i}].displayOrder must be a 32-bit integer or null` },
        { status: 400 },
      );
    }

    parsed.push({ fileId, displayOrder });
  }

  // スコープ検証: 同一候補者・BOOKMARK・非アーカイブの行だけを対象にする。
  // スコープ外/存在しない fileId はサイレント無視せず 404 で返す（部分適用も行わない）。
  const inScope = await prisma.candidateFile.findMany({
    where: {
      id: { in: parsed.map((p) => p.fileId) },
      candidateId: candidate.id,
      category: "BOOKMARK",
      archivedAt: null,
    },
    select: { id: true },
  });
  const inScopeIds = new Set(inScope.map((r) => r.id));
  const unknownFileIds = parsed.filter((p) => !inScopeIds.has(p.fileId)).map((p) => p.fileId);
  if (unknownFileIds.length > 0) {
    return NextResponse.json(
      { ok: false, updated: 0, reason: "not-found", unknownFileIds },
      { status: 404 },
    );
  }

  // 一括更新（全件成功 or 全件失敗）。displayOrder のみを data に含める＝他列は機械的に変更不可。
  await prisma.$transaction(
    parsed.map((p) =>
      prisma.candidateFile.update({
        where: { id: p.fileId },
        data: { displayOrder: p.displayOrder },
      }),
    ),
  );

  return NextResponse.json({
    ok: true,
    updated: parsed.length,
    orders: parsed,
  });
}
