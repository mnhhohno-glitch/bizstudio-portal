// T-189 修正: 自動配信行が届いた直後に AI評価バッチへ投入する（受け口からの起動）。
//
// 背景: 投入（analyze-submit）は毎朝 07:30 の GitHub Actions 1回だけだったため、
//   日中に job-platform から届いた自動配信行は翌朝まで未評価のまま滞留していた
//   （承認ページで「未評価」として並び、CA が判断できない）。
//   受け口（/api/external/bookmarks/from-job-platform の origin="auto" 分岐）で行を作った
//   直後にこの関数を呼び、「今すぐ探す」と同じ runAnalyzeSubmit を当該求職者に対して起動する。
//
// 設計:
//   - 呼び出しは受け口のレスポンス返却後（after()）。受け口の応答時間には一切影響させない。
//   - 失敗しても受け口は 200 のまま（作成は成功している）。翌朝の定時 submit が安全網として拾い直す。
//   - 同一求職者で 60 秒以内の多重起動は 1 回にまとめる。プロセス内メモリ（Railway 単一インスタンス）
//     を第一段、投入台帳（recommend_analyze_batches の直近60秒）を第二段に置く二段構え。
//     複数インスタンス構成になっても台帳側のガードで二重投入を抑止できる。
//   - runAnalyzeSubmit 自体が冪等（対象は origin="auto" / PENDING / aiAnalyzedAt=null かつ
//     SUBMITTED 台帳に載っていない行のみ）なので、万一二重に走っても同じ行は二度投入されない。
import { prisma } from "@/lib/prisma";
import { runAnalyzeSubmit } from "@/lib/recommend/analyze-batch-run";

const LOG = "[auto-eval-kick]";
const DEBOUNCE_MS = 60_000;

/** プロセス内 debounce（第一段）。candidateId → 直近に起動した時刻(ms)。 */
const lastKickedAt = new Map<string, number>();

/** 台帳側 debounce（第二段）。直近60秒に同一求職者の投入があれば起動しない。 */
async function submittedRecently(candidateId: string): Promise<boolean> {
  const since = new Date(Date.now() - DEBOUNCE_MS);
  const recent = await prisma.recommendAnalyzeBatch.findFirst({
    where: { candidateId, submittedAt: { gte: since } },
    select: { batchId: true },
  });
  return recent !== null;
}

/**
 * 当該求職者の未評価の自動配信行を AI評価バッチへ投入する。
 * 例外は投げない（呼び出し元＝受け口の応答に影響させないため、ここで握って握りつぶす）。
 */
export async function kickAutoEvaluation(args: {
  candidateId: string;
  candidateNumber: string;
  createdCount: number;
}): Promise<void> {
  const { candidateId, candidateNumber, createdCount } = args;
  try {
    const now = Date.now();
    const last = lastKickedAt.get(candidateId);
    if (last !== undefined && now - last < DEBOUNCE_MS) {
      console.log(
        `${LOG} skip(debounce/memory) candidate=${candidateNumber} created=${createdCount} ` +
          `前回起動から ${Math.round((now - last) / 1000)}秒`,
      );
      return;
    }
    lastKickedAt.set(candidateId, now);

    if (await submittedRecently(candidateId)) {
      console.log(`${LOG} skip(debounce/ledger) candidate=${candidateNumber} created=${createdCount}`);
      return;
    }

    const startedAt = Date.now();
    const submit = await runAnalyzeSubmit({ willExecute: true, candidateId });
    const elapsed = Date.now() - startedAt;
    if (submit.ledgerSaveFailed) {
      console.error(
        `${LOG} 台帳保存に失敗 candidate=${candidateNumber} batch=${submit.batchId ?? "-"}（要手動回収）`,
      );
    }
    console.log(
      `${LOG} submitted candidate=${candidateNumber} created=${createdCount} ` +
        `targetFiles=${submit.targetFiles} requests=${submit.requests} ` +
        `batch=${submit.batchId ?? "-"} ${elapsed}ms`,
    );
  } catch (e) {
    // 失敗しても受け口の作成は成功扱い。未評価のまま残るので翌朝の定時 submit が拾い直す。
    console.error(
      `${LOG} failed candidate=${candidateNumber} created=${createdCount}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}
