import { NextResponse } from "next/server";
import { requireAutoRecommendAdmin } from "@/lib/recommend/auto-approval-auth";
import { REJECT_REASON_CHOICES } from "@/lib/recommend/auto-approval";
import { rejectAutoFiles } from "@/lib/recommend/auto-approval-sync";

// T-189 Phase3-1: ✗却下。
//   - 対象: 自動由来（autoSourcedAt != null）かつ PENDING の行のみ（他の状態は無視＝冪等）。
//   - approvalStatus="REJECTED"・rejectedReason 必須（定型 or 「その他: 自由記述」）。
//   - T-189 修正: 却下＝紹介保留と同一扱い。archivedAt/archivedReason(=却下理由)/archivedById(=操作者) も立てる
//     （受け口の冪等判定は自動配信行なら archivedAt を問わないので再送されない）。
//   - introducedAt / supportSubStatus は触らない。
export async function POST(req: Request) {
  const auth = await requireAutoRecommendAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    fileIds?: unknown;
    reason?: unknown;
    note?: unknown;
  };
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (fileIds.length === 0) return NextResponse.json({ error: "fileIds は必須です" }, { status: 400 });

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!(REJECT_REASON_CHOICES as readonly string[]).includes(reason)) {
    return NextResponse.json({ error: "却下理由を選択してください" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (reason === "その他" && !note) {
    return NextResponse.json({ error: "「その他」の場合は理由を入力してください" }, { status: 400 });
  }
  const rejectedReason = reason === "その他" ? `その他: ${note}` : note ? `${reason}（${note}）` : reason;

  try {
    const rejected = await rejectAutoFiles({ fileIds, rejectedReason, archivedById: auth.user.id });
    console.log(`[admin/auto-recommend/reject] by=${auth.user.id} files=${fileIds.length} rejected=${rejected} reason=${rejectedReason}`);
    return NextResponse.json({ ok: true, rejected, rejectedReason });
  } catch (e) {
    console.error("[admin/auto-recommend/reject] failed:", e);
    return NextResponse.json({ error: "却下に失敗しました" }, { status: 500 });
  }
}
