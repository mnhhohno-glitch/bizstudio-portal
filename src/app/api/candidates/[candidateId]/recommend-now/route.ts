import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import { runRecommendOnJobPlatform } from "@/lib/recommend/job-platform-run";
import { runAnalyzeSubmit } from "@/lib/recommend/analyze-batch-run";

// T-189 追加: 求職者詳細の「今すぐ探す」ボタンの受け口。
//
// POST /api/candidates/[candidateId]/recommend-now
//   - 認証: getSessionUser() ＋ isAutoRecommendAdmin（自動配信トグルと同じ権限。他は403）。
//   - 前提: 当該求職者の autoRecommendEnabled=true（OFF なら 400 auto_recommend_off）。
//   - 処理:
//       1. job-platform の即時引き当て（POST /api/internal/recommend/run）を呼ぶ。
//          採用された求人は job-platform 側から portal の自動配信受け口（origin="auto"）に入る。
//       2. created>0 なら、その求職者の未評価分だけを AI評価バッチへ投入する
//          （夜間 cron と同一の runAnalyzeSubmit。対象条件・プロンプトとも共通）。
//       3. 回収は待たない。画面が recommend-collect をポーリングする。
//   - 連打防止: 同一求職者につき60秒に1回（job-platform 側と二重で持つ）。
//
// レスポンス（200）: { created, skipped, submitted, batchId }
//   created   … job-platform が portal に新規作成したブックマーク件数
//   skipped   … 既出などで送られなかった件数
//   submitted … 今回 AI評価バッチへ投入したファイル件数
// 400 { error: "auto_recommend_off" } / 404 { error: "no_condition" } / 429 { error: "cooldown" }

// job-platform 側の検索〜PDF化〜送信が数十秒かかる。投入まで含めて余裕を持たせる。
export const maxDuration = 300;

const COOLDOWN_MS = 60_000;
const lastAcceptedAt = new Map<string, number>();

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!isAutoRecommendAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { candidateId } = await params;
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, candidateNumber: true, autoRecommendEnabled: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }
  if (!candidate.autoRecommendEnabled) {
    return NextResponse.json({ error: "auto_recommend_off" }, { status: 400 });
  }

  // 連打防止（プロセス内メモリ。job-platform 側にも同じ60秒ガードがある）。
  const now = Date.now();
  const last = lastAcceptedAt.get(candidateId);
  if (last !== undefined && now - last < COOLDOWN_MS) {
    return NextResponse.json(
      {
        error: "cooldown",
        retryAfterSeconds: Math.ceil((COOLDOWN_MS - (now - last)) / 1000),
      },
      { status: 429 },
    );
  }
  lastAcceptedAt.set(candidateId, now);

  // 1. job-platform で即時引き当て
  const run = await runRecommendOnJobPlatform({ candidateNumber: candidate.candidateNumber });
  if (!run.ok) {
    // 失敗時はクールダウンを解放する（条件保存などを直してすぐ再実行できるように）。
    lastAcceptedAt.delete(candidateId);
    console.error(
      `[recommend-now] job-platform run 失敗 candidate=${candidate.candidateNumber} status=${run.status}: ${run.error}`,
    );
    // 404 は2種類ある。JSON で返ってきた 404 だけが job-platform の「配信条件が未保存」。
    // HTML の 404（notJson）は引き当てAPI自体が存在しない＝設定・デプロイの問題なので区別する。
    if (run.status === 404 && !run.notJson) {
      return NextResponse.json({ error: "no_condition" }, { status: 404 });
    }
    if (run.status === 404 && run.notJson) {
      return NextResponse.json(
        {
          error: "job_platform_error",
          detail: "job-platform に /api/internal/recommend/run がありません（未デプロイ）",
        },
        { status: 502 },
      );
    }
    if (run.status === 429) {
      return NextResponse.json({ error: "cooldown" }, { status: 429 });
    }
    return NextResponse.json({ error: "job_platform_error", detail: run.error }, { status: 502 });
  }

  // 2. 新規に入った求人があれば、その求職者の未評価分だけAI評価バッチへ投入する。
  //    （投入は冪等: 対象は origin="auto" かつ aiAnalyzedAt IS NULL かつ未投入の行のみ）
  let submitted = 0;
  let batchId: string | null = null;
  if (run.sent.created > 0) {
    try {
      const submit = await runAnalyzeSubmit({ willExecute: true, candidateId });
      submitted = submit.targetFiles;
      batchId = submit.batchId ?? null;
      if (submit.ledgerSaveFailed) {
        console.error(`[recommend-now] 台帳保存に失敗 batchId=${batchId}（要手動回収）`);
      }
    } catch (e) {
      console.error(`[recommend-now] AI評価投入に失敗 candidate=${candidateId}:`, e);
      // 引き当て自体は成功しているので 200 で返し、投入失敗だけを伝える
      // （未評価のまま残るので翌日の cron が拾い直す）。
      return NextResponse.json({
        created: run.sent.created,
        skipped: run.sent.skipped,
        submitted: 0,
        batchId: null,
        submitError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(
    `[recommend-now] candidate=${candidate.candidateNumber} hit=${run.hit} adopted=${run.adopted} created=${run.sent.created} skipped=${run.sent.skipped} submitted=${submitted} batch=${batchId ?? "-"}`,
  );

  return NextResponse.json({
    created: run.sent.created,
    skipped: run.sent.skipped,
    submitted,
    batchId,
  });
}
