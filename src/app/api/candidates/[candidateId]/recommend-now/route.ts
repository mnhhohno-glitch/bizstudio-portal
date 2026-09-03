import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import { runRecommendOnJobPlatform } from "@/lib/recommend/job-platform-run";
import { ensureAutoEvaluationSubmitted } from "@/lib/recommend/auto-eval-kick";

// T-189 追加: 求職者詳細の「今すぐ探す」ボタンの受け口。
//
// POST /api/candidates/[candidateId]/recommend-now
//   - 認証: getSessionUser() ＋ isAutoRecommendAdmin（自動配信トグルと同じ権限。他は403）。
//   - 前提: 当該求職者の autoRecommendEnabled=true（OFF なら 400 auto_recommend_off）。
//   - 処理:
//       1. job-platform の即時引き当て（POST /api/internal/recommend/run）を呼ぶ。
//          採用された求人は job-platform 側から portal の自動配信受け口（origin="auto"）に入る。
//       2. AI評価の投入はしない。受け口（from-job-platform の origin="auto" 分岐）が
//          行を作った直後に kickAutoEvaluation() で投入し、回収まで見届ける。
//       3. キックが走らなかった場合の保険だけを after() で仕掛ける（90秒後に台帳を見て、
//          投入が1件も無ければ1回だけ投入する）。
//       4. 評価完了の待機は画面側（recommend-collect のポーリング・最長10分）が従来どおり行う。
//   - 連打防止: 同一求職者につき60秒に1回（job-platform 側と二重で持つ）。
//
// T-189 修正: 以前はここでも runAnalyzeSubmit を呼んでいた。受け口キックと同時に走ると、
//   当時の二重投入ガード（台帳の照会）は台帳行を Anthropic 投入「後」に作っていたため
//   双方が素通りし、同一15ファイルが 0.355秒差で2バッチに投入された（2026-09-03 11:52・¥59の無駄）。
//   投入経路を受け口キックに一本化し、排他の正は台帳の事前予約（RESERVED）に置いた。
//
// レスポンス（200）: { created, skipped, reason, autoSentToday }
//   created       … job-platform が portal に新規作成したブックマーク件数
//   skipped       … 既出などで送られなかった件数
//   reason        … created=0 の理由（"daily_limit" = 本日の「今すぐ探す」上限に到達）。不明は null
//   autoSentToday … job-platform が返す本日の自動配信件数（返らなければ null）
// 400 { error: "auto_recommend_off" } / 404 { error: "no_condition" } / 429 { error: "cooldown" }

// job-platform 側の検索〜PDF化〜送信が数十秒かかる。余裕を持たせる。
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

  // 2. AI評価の投入はここでは行わない（受け口キックに一本化）。
  //    キックが走らなかった場合の保険だけをレスポンス返却後に仕掛ける。
  //    保険が投入しても二重にはならない（runAnalyzeSubmit が台帳を事前予約するため）。
  if (run.sent.created > 0) {
    after(() =>
      ensureAutoEvaluationSubmitted({
        candidateId: candidate.id,
        candidateNumber: candidate.candidateNumber,
        createdCount: run.sent.created,
      }),
    );
  }

  console.log(
    `[recommend-now] candidate=${candidate.candidateNumber} hit=${run.hit} adopted=${run.adopted} created=${run.sent.created} skipped=${run.sent.skipped} reason=${run.reason ?? "-"}（投入は受け口キックに委譲）`,
  );

  return NextResponse.json({
    created: run.sent.created,
    skipped: run.sent.skipped,
    // T-189 修正: created=0 の理由（"daily_limit" 等）。画面が上限到達を伝えるのに使う。
    reason: run.reason,
    // T-189 修正: 上限到達トーストに「（自動配信: 本日 N 件）」を添えるための件数。
    autoSentToday: run.autoSentToday,
  });
}
