import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// ピックアップ: CAがマイページプレビューで「先頭固定」を付けた求人。CA専用・単一目的エンドポイント
// （FU-13a display-overrides / FU-14a display-order と同慣例）。
//
// PATCH /api/external/candidate-site/pickup
//   body: {
//     candidateNumber|candidateId,
//     actor: "ca",              // CAのみ。actor="user" は 403（本人はピックアップ操作不可）。その他/欠落は 400。
//     fileId: string,           // 対象の CandidateFile.id（BOOKMARK・非アーカイブ・同一候補者）。
//     pickup: true | false,     // true=ON（pickedUpAt にサーバ時刻を設定）/ false=OFF（pickedUpAt=null）。
//   }
//
// 設計方針:
//   - 上限3件／求職者。ON時に既存ピックアップが 3件以上あれば 409 で拒否（DB は更新しない）。
//   - 同時に複数のONが来ても4件目が入らないよう SERIALIZABLE トランザクションでガード。
//     count 判定と update を同一トランザクションに閉じ、Postgres の直列化検出で片方を弾く。
//     Prisma は直列化失敗を P2034 で throw する → 上位で捕捉して 409 に落とす（クライアントは
//     「上限に達しています」表示 or 数秒後リトライで到達可）。
//   - 冪等性: 既にONの求人にON→ pickedUpAt を書き直さない（順序が変わらない）。既にOFFの求人にOFF→ no-op。
//   - 対象行は同一候補者・category="BOOKMARK"・非アーカイブに限定（スコープ外は 404）。
//   - 認証は X-Auth-Key（共有鍵・mypage BFF 信頼境界）。actor は body 申告（display-order / display-overrides と同慣例）。
//     プレビューの管理者ゲート（actor=ca 経路）を通ったリクエストのみ actor="ca" で到達する想定。

const MAX_PICKUP = 3;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

type TxOutcome =
  | { kind: "not-found" }
  | { kind: "max-reached"; current: number }
  | { kind: "on"; pickedUpAt: Date }
  | { kind: "already-on"; pickedUpAt: Date }
  | { kind: "off" }
  | { kind: "already-off" };

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
      { error: "actor=user cannot change pickup (CA only)" },
      { status: 403 },
    );
  }

  const fileId = str(body.fileId);
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const rawPickup = body.pickup;
  if (typeof rawPickup !== "boolean") {
    return NextResponse.json({ error: "pickup must be boolean" }, { status: 400 });
  }
  const pickup = rawPickup;

  // count 判定と update を同一 SERIALIZABLE トランザクションに閉じ、並列 ON リクエストで
  // 4件目が入る競合を Postgres の直列化検出で弾く。直列化失敗は P2034 で throw される。
  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const target = await tx.candidateFile.findFirst({
          where: {
            id: fileId,
            candidateId: candidate.id,
            category: "BOOKMARK",
            archivedAt: null,
          },
          select: { id: true, pickedUpAt: true },
        });
        if (!target) return { kind: "not-found" as const };

        if (pickup) {
          // 冪等: 既にONなら pickedUpAt を書き直さない（順序保持）。
          if (target.pickedUpAt) {
            return { kind: "already-on" as const, pickedUpAt: target.pickedUpAt };
          }
          const current = await tx.candidateFile.count({
            where: {
              candidateId: candidate.id,
              category: "BOOKMARK",
              archivedAt: null,
              pickedUpAt: { not: null },
            },
          });
          if (current >= MAX_PICKUP) {
            return { kind: "max-reached" as const, current };
          }
          const now = new Date();
          await tx.candidateFile.update({
            where: { id: target.id },
            data: { pickedUpAt: now },
          });
          return { kind: "on" as const, pickedUpAt: now };
        }

        // OFF: 冪等 no-op（既にOFF）。
        if (!target.pickedUpAt) return { kind: "already-off" as const };
        await tx.candidateFile.update({
          where: { id: target.id },
          data: { pickedUpAt: null },
        });
        return { kind: "off" as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    // P2034: 直列化失敗（同時ONで別トランザクションと衝突）→ 409 に落として上限扱いにする。
    // クライアント側は「上限に達しています」の再確認 or 少し後にリトライで到達可能。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return NextResponse.json(
        {
          ok: false,
          reason: "serialization-conflict",
          max: MAX_PICKUP,
          error: "同時更新により競合しました。少し待って再度お試しください",
        },
        { status: 409 },
      );
    }
    throw e;
  }

  if (outcome.kind === "not-found") {
    return NextResponse.json(
      { ok: false, reason: "not-found", error: "File not found" },
      { status: 404 },
    );
  }
  if (outcome.kind === "max-reached") {
    return NextResponse.json(
      {
        ok: false,
        reason: "max-pickup-reached",
        max: MAX_PICKUP,
        current: outcome.current,
        error: `ピックアップは${MAX_PICKUP}件までです`,
      },
      { status: 409 },
    );
  }

  const pickedUpAt =
    outcome.kind === "on" || outcome.kind === "already-on"
      ? outcome.pickedUpAt.toISOString()
      : null;

  return NextResponse.json({
    ok: true,
    fileId,
    pickup,
    pickedUpAt,
    changed: outcome.kind === "on" || outcome.kind === "off",
  });
}
