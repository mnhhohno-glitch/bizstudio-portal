import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-133 FU-13a: 求人内容の「求職者向け表示だけ」の上書き（displayOverrides）。CA専用。
//
// PATCH /api/external/candidate-site/display-overrides
//   body: {
//     candidateNumber|candidateId,
//     fileId?,                 // 対象特定（優先）。無ければ externalJobRef。
//     externalJobRef?,
//     actor: "ca",             // CAのみ。actor="user" は 403（本人は表示上書き不可）。その他/欠落は 400。
//     displayOverrides?: { [key]: string|null } | null,
//                              //  - オブジェクト: キー単位マージ。値 string=上書き設定、値 null=そのキーの上書き解除。
//                              //  - null: 全解除（列を SQL NULL に戻す＝undo）。
//                              //  - キー自体を省略: displayOverrides は変更しない。
//     caComment?: string|null, // 既存 ca_comment 列を更新（overrides に入れず別列管理＝二重管理回避）。
//                              //   キー省略で変更なし。null/空文字 でクリア。
//   }
//
// 設計方針:
//   - 反映先は「この求職者に見せる表示」のみ。元求人データ（job-platform / kyuujin Job）は一切書き換えない（非破壊・undo容易）。
//   - 受け入れキーは旧 EditJobModal 準拠の13項目に限定。未知キーは 400。
//   - caComment は displayOverrides(JSON) に含めず既存 caComment 列で管理する（値の二重管理を避けるため）。
//   - 認証は X-Auth-Key（共有鍵・mypage BFF 信頼境界）。actor は body 申告（response-status と同一慣例）。
//     プレビューの管理者ゲート（P4 の actor=ca 経路）を通ったリクエストのみ actor="ca" で到達する想定。

// 旧 EditJobModal の14項目のうち displayOverrides(JSON) に格納する13キー。
// caComment は本JSONに入れず既存 ca_comment 列で管理（設計方針: 二重管理回避）。
const DISPLAY_OVERRIDE_KEYS = [
  "companyName",
  "jobTitle",
  "workLocation",
  "nearestStation",
  "salary",
  "salaryMonthly",
  "bonus",
  "jobDescription",
  "requirements",
  "holidays",
  "overtime",
  "benefits",
  "transfer",
] as const;
const ALLOWED_KEYS = new Set<string>(DISPLAY_OVERRIDE_KEYS);
const MAX_LEN = 10000;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
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
      { error: "actor=user cannot edit displayOverrides (CA only)" },
      { status: 403 },
    );
  }

  // 対象特定: fileId 優先、無ければ externalJobRef（favorites メモPATCHと同一慣例）。
  const fileId = str(body.fileId);
  const externalJobRef = str(body.externalJobRef);
  if (!fileId && !externalJobRef) {
    return NextResponse.json({ error: "fileId or externalJobRef is required" }, { status: 400 });
  }

  // displayOverrides / caComment の少なくとも一方が body にあること（キーの有無で判定）。
  const hasOverrides = "displayOverrides" in body;
  const hasCaComment = "caComment" in body;
  if (!hasOverrides && !hasCaComment) {
    return NextResponse.json(
      { error: "displayOverrides or caComment is required" },
      { status: 400 },
    );
  }

  // --- displayOverrides の検証 ---
  // 受理形: null（全解除） | オブジェクト（キー:文字列|null）。配列・プリミティブは 400。
  const rawOverrides = body.displayOverrides;
  let overridesMode: "clear-all" | "merge" | "skip" = "skip";
  const patchMap: Record<string, string | null> = {};
  if (hasOverrides) {
    if (rawOverrides === null) {
      overridesMode = "clear-all";
    } else if (typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
      overridesMode = "merge";
      for (const [k, v] of Object.entries(rawOverrides as Record<string, unknown>)) {
        if (!ALLOWED_KEYS.has(k)) {
          return NextResponse.json({ error: `Unknown displayOverrides key: ${k}` }, { status: 400 });
        }
        if (v === null) {
          patchMap[k] = null; // そのキーの上書き解除
        } else if (typeof v === "string") {
          if (v.length > MAX_LEN) {
            return NextResponse.json(
              { error: `displayOverrides.${k} exceeds ${MAX_LEN} chars` },
              { status: 400 },
            );
          }
          patchMap[k] = v;
        } else {
          return NextResponse.json(
            { error: `displayOverrides.${k} must be a string or null` },
            { status: 400 },
          );
        }
      }
    } else {
      return NextResponse.json(
        { error: "displayOverrides must be an object or null" },
        { status: 400 },
      );
    }
  }

  // --- caComment の検証（別列） ---
  let caCommentUpdate: string | null | undefined = undefined; // undefined = 変更しない
  if (hasCaComment) {
    const rawCa = body.caComment;
    if (rawCa === null) {
      caCommentUpdate = null;
    } else if (typeof rawCa === "string") {
      if (rawCa.length > MAX_LEN) {
        return NextResponse.json({ error: `caComment exceeds ${MAX_LEN} chars` }, { status: 400 });
      }
      caCommentUpdate = rawCa.trim().length ? rawCa : null;
    } else {
      return NextResponse.json({ error: "caComment must be a string or null" }, { status: 400 });
    }
  }

  // 対象行（候補者スコープ・BOOKMARK・非アーカイブ）。現在の displayOverrides もマージ用に取得。
  const row = await prisma.candidateFile.findFirst({
    where: fileId
      ? { id: fileId, candidateId: candidate.id, category: "BOOKMARK", archivedAt: null }
      : { candidateId: candidate.id, category: "BOOKMARK", externalJobRef, archivedAt: null },
    select: { id: true, displayOverrides: true },
  });
  if (!row) {
    return NextResponse.json({ ok: false, updated: false, reason: "not-found" }, { status: 404 });
  }

  const data: Prisma.CandidateFileUpdateInput = {};

  if (overridesMode === "clear-all") {
    data.displayOverrides = Prisma.DbNull; // 列を SQL NULL に戻す（全解除・undo）
  } else if (overridesMode === "merge") {
    const current: Record<string, string> =
      row.displayOverrides && typeof row.displayOverrides === "object" && !Array.isArray(row.displayOverrides)
        ? { ...(row.displayOverrides as Record<string, string>) }
        : {};
    for (const [k, v] of Object.entries(patchMap)) {
      if (v === null) delete current[k];
      else current[k] = v;
    }
    // 全キーが消えたら列を NULL に戻す（空オブジェクトを残さない＝GET/undo の一貫性）。
    data.displayOverrides =
      Object.keys(current).length === 0 ? Prisma.DbNull : (current as Prisma.InputJsonValue);
  }

  if (caCommentUpdate !== undefined) {
    data.caComment = caCommentUpdate;
  }

  const updated = await prisma.candidateFile.update({
    where: { id: row.id },
    data,
    select: { id: true, displayOverrides: true, caComment: true },
  });

  return NextResponse.json({
    ok: true,
    updated: true,
    fileId: updated.id,
    displayOverrides: updated.displayOverrides ?? null,
    caComment: updated.caComment,
  });
}
