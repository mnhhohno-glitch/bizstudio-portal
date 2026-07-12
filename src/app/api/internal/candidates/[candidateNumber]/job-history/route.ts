import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { normalizeCompanyKey, parseCompanyFromBookmarkFileName } from "@/lib/company-name-key";

// 求職者選択モード Phase 1a: 引き当て履歴の照合API。
//
// GET /api/internal/candidates/{candidateNumber}/job-history
//   認証: x-api-key（INTERNAL_API_KEY・auto-expire / resubmit-stale と同一の内部鍵）。未設定/不一致は 401。
//   用途: job-platform のCA向け求人検索「求職者選択モード」が、検索結果の各求人に
//         引き当て履歴フラグ（応募したい/気になる/引き当て済み/対象外）と同社フラグを重ねるための突合材料。
//
// 方針:
//   - **全履歴**を返す（archivedAt の有無を問わず category="BOOKMARK" 全行）。アーカイブ済みも
//     「過去に引き当てた事実」としてフラグ表示の対象にする（archived:true を添えて呼び出し側に判断材料を渡す）。
//   - externalJobRef が null の行（未昇格PDF等）も**除外せず返す**。job-platform 側で突合できないだけで、
//     履歴としては存在するため（同社フラグ用の会社名は拾える）。
//   - 読み出しのみ。1候補者あたり CandidateFile 1クエリ＋JobEntry 1クエリ＋整形（N+1なし）。最大数百行想定。
//
// Phase 2b（2026-07-13）: status にエントリー系3値（OFFER / DOC_PASS / ENTRY）を追加。
//   JobEntry を kyuujinJobId で突合して、選考が進んでいる求人にはエントリー系を返す。
//   既存4値（APPLY/INTERESTED/INTRODUCED/EXCLUDED）の判定・レスポンス形は不変（後方互換）。

export const dynamic = "force-dynamic";

/**
 * 表示フラグ判定用の1値。
 * Phase 2b でエントリー系3値（OFFER / DOC_PASS / ENTRY）を追加した。
 * 優先順位（強い順）: OFFER > DOC_PASS > ENTRY > APPLY > INTERESTED > INTRODUCED > EXCLUDED
 */
export type JobHistoryStatus =
  | "OFFER"
  | "DOC_PASS"
  | "ENTRY"
  | "APPLY"
  | "INTERESTED"
  | "INTRODUCED"
  | "EXCLUDED";

/** エントリー系の3値（JobEntry 由来）。responseStatus 由来の4値より必ず強い。 */
type EntryStageStatus = "OFFER" | "DOC_PASS" | "ENTRY";

/**
 * JobEntry.entryFlag が「応募到達済み」を示す値（＝求人紹介段階を超えている）。
 * 出所: src/lib/dailyReport/metrics.ts の entryFlagPostApplication（実績表の「エントリー数」と同一定義）。
 * entryFlag="求人紹介"（既定値）のままの行は **まだエントリーしていない**ため ENTRY にしない。
 */
const ENTRY_FLAG_POST_APPLICATION = new Set([
  "応募",
  "エントリー",
  "書類選考",
  "面接",
  "内定",
  "入社済",
]);

/**
 * responseStatus（箱A CandidateFile.responseStatus・箱B feedback_status と同一7値）→ 表示フラグ。
 *   APPLY       → "APPLY"       （応募したい）
 *   INTERESTED  → "INTERESTED"  （気になる）
 *   EXCLUDED    → "EXCLUDED"    （対象外）
 *   上記以外（null / UNANSWERED / PENDING / IN_SELECTION / SELECTION_ENDED）
 *               → "INTRODUCED"  （引き当て済み＝CAが引き当てた事実のみ。求職者の意思表示なし）
 * ※ IN_SELECTION / SELECTION_ENDED は箱B由来の休眠列で、選考の実態は JobEntry が正のため
 *    ここでは従来どおり INTRODUCED に畳む（Phase 2b でも変更なし＝後方互換）。
 */
function toHistoryStatus(responseStatus: string | null): JobHistoryStatus {
  if (responseStatus === "APPLY") return "APPLY";
  if (responseStatus === "INTERESTED") return "INTERESTED";
  if (responseStatus === "EXCLUDED") return "EXCLUDED";
  return "INTRODUCED";
}

/**
 * JobEntry 1件 → エントリー系フラグ。エントリー系に該当しなければ null（＝従来判定へフォールバック）。
 *
 * 判定規則（既存運用に準拠。独自定義はしない）:
 *   - OFFER    : offerDate 非null
 *   - DOC_PASS : documentPassDate 非null
 *       ※ 日付が非nullの時点で求人紹介段階を超えているため entryFlag のホワイトリストは掛けない。
 *         出所: src/lib/dailyReport/metrics.ts（実績表の書類通過/内定と同一の判定）。
 *   - ENTRY    : entryFlag が応募到達済み（ENTRY_FLAG_POST_APPLICATION）
 *       ※ entryFlag="求人紹介" のままの行は除外（まだエントリーしていない）。
 */
function toEntryStage(e: {
  entryFlag: string | null;
  documentPassDate: Date | null;
  offerDate: Date | null;
}): EntryStageStatus | null {
  if (e.offerDate) return "OFFER";
  if (e.documentPassDate) return "DOC_PASS";
  if (e.entryFlag && ENTRY_FLAG_POST_APPLICATION.has(e.entryFlag)) return "ENTRY";
  return null;
}

/** エントリー系の強さ（小さいほど強い）。同一求人に複数エントリーがある場合に最も強い1つを採る。 */
const ENTRY_STAGE_RANK: Record<EntryStageStatus, number> = { OFFER: 1, DOC_PASS: 2, ENTRY: 3 };

/**
 * 行の会社名: CAの表示上書き（FU-13a displayOverrides.companyName）を優先し、
 * 無ければ fileName から復元（求人票_ / circus / マイナビ の3形式に対応）。
 * ※ favorites API の会社名抽出は「求人票_」形式のみの簡易版で別実装（mypage の表示挙動を変えないため据置）。
 */
function resolveCompanyName(row: { fileName: string; displayOverrides: unknown }): string | null {
  const ov = row.displayOverrides;
  if (ov && typeof ov === "object" && !Array.isArray(ov)) {
    const c = (ov as Record<string, unknown>).companyName;
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return parseCompanyFromBookmarkFileName(row.fileName);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateNumber: string }> },
) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { candidateNumber } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      supportStatus: true,
      // 全履歴（archivedAt 問わず）。BOOKMARK のみ。
      files: {
        where: { category: "BOOKMARK" },
        select: {
          externalJobRef: true,
          kyuujinJobId: true,
          responseStatus: true,
          fileName: true,
          displayOverrides: true,
          archivedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // --- Phase 2b: エントリー系ステータスの突合材料（この候補者の JobEntry を1クエリで取得＝N+1にしない） ---
  //
  // 対象エントリーの柵（**エントリーボードの既定表示と同一**。独自定義はしない）:
  //   - archivedAt = null      … アーカイブ（削除扱い）は対象外
  //   - isActive   = true      … 無効エントリーは対象外
  //       無効化の条件は entry-flag-rules.ts の INACTIVE_TRIGGERS（personFlag「見送り通知送信済/見送り通知済み」・
  //       companyFlag「辞退報告済」）＝選考が終わった行。/api/entries も既定で isActive=true のみを出す。
  //       これらはフラグ上「選考中」ではないため、エントリー系にせず従来判定（引き当て済み等）へフォールバックする。
  //       ※「入社済」は INACTIVE_TRIGGERS から意図的に除外されている＝isActive のまま＝OFFER として出る。
  //   - externalJobId != 0     … 0 は手動作成エントリーで求人IDを持たず突合不能（誤ってENTRY化させない）
  //
  // 突合キー: JobEntry.externalJobId(Int) = CandidateFile.kyuujinJobId(Int)（同一候補者内）。
  const entries = await prisma.jobEntry.findMany({
    where: {
      candidateId: candidate.id,
      archivedAt: null,
      isActive: true,
      externalJobId: { not: 0 },
    },
    select: {
      externalJobId: true,
      entryFlag: true,
      documentPassDate: true,
      offerDate: true,
    },
  });

  // externalJobId → その求人で最も強いエントリー系ステータス（同一求人に複数エントリーがありうる）。
  const entryStageByJobId = new Map<number, EntryStageStatus>();
  for (const e of entries) {
    const stage = toEntryStage(e);
    if (!stage) continue; // entryFlag="求人紹介" のまま等＝まだエントリーしていない
    const cur = entryStageByJobId.get(e.externalJobId);
    if (!cur || ENTRY_STAGE_RANK[stage] < ENTRY_STAGE_RANK[cur]) {
      entryStageByJobId.set(e.externalJobId, stage);
    }
  }

  const jobs = candidate.files.map((f) => {
    const companyName = resolveCompanyName(f);
    // エントリー系（OFFER/DOC_PASS/ENTRY）は responseStatus 由来の4値より必ず強い。
    // kyuujinJobId 未紐付け（null）の行は突合できないため従来判定のまま（後方互換）。
    const entryStage = f.kyuujinJobId != null ? entryStageByJobId.get(f.kyuujinJobId) : undefined;
    return {
      externalJobRef: f.externalJobRef, // job-platform の source_job_id（null あり）
      kyuujinJobId: f.kyuujinJobId, // kyuujinPDF の Job 内部ID（null あり）
      status: entryStage ?? toHistoryStatus(f.responseStatus),
      archived: f.archivedAt !== null,
      companyName,
    };
  });

  // 同社フラグ用: 正規化済み会社名キーの一意リスト（job-platform normalizeCompanyName と同一規則）。
  const companyKeys = [
    ...new Set(
      jobs
        .map((j) => (j.companyName ? normalizeCompanyKey(j.companyName) : ""))
        .filter((k) => k.length > 0),
    ),
  ];

  return NextResponse.json(
    {
      candidate: {
        candidateNumber: candidate.candidateNumber,
        name: candidate.name,
        supportStatus: candidate.supportStatus,
      },
      jobs,
      companyKeys,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
