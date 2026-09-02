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
import { runAnalyzeSubmit, runAnalyzeCollect } from "@/lib/recommend/analyze-batch-run";

const LOG = "[auto-eval-kick]";
const DEBOUNCE_MS = 60_000;

// T-189 修正: 投入したら回収まで自前でやる（定時の GitHub Actions を待たない）。
//
// 背景: 投入は受け口到着の1秒後に走るようになったが、回収は GitHub Actions の定時のみだった。
//   GitHub Actions の schedule は混雑時に大幅に遅延する（実測: 2026-09-02 は 07:30 JST 予定の
//   ジョブが 09:23 JST 発火 ＝ 113分遅延）。2026-09-03 も 07:00:08 投入 → 07:05:14 に Anthropic 側は
//   完了していたのに、07:56 時点で定時の collect が未発火で「未評価—」のまま滞留していた。
//   → 投入した本人が、完了するまで数分おきに回収を試みる。
//
// 打ち切り: 最長 20分。バッチの実測完了は 5〜6分なので十分な余裕がある。
//   打ち切った分は定時の collect（安全網・そのまま残す）が拾う。
// 排他: runAnalyzeCollect が台帳行を SUBMITTED → COLLECTING でアトミックに掴むので、
//   定時 collect や画面ポーリングと同時に走っても片方が空振りするだけ（二重回収しない）。
const COLLECT_MAX_MS = 20 * 60_000;
const COLLECT_FIRST_DELAY_MS = 30_000;
const COLLECT_MAX_DELAY_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * 投入したバッチが回収されるまで、30秒 → 60秒 → 120秒（上限）間隔でポーリングする。
 * 完了判定は「当該 batchId の台帳行に SUBMITTED / COLLECTING が1件も残っていない」こと。
 * 評価保存・D自動却下・PDF先行生成は runAnalyzeCollect の中で既存どおり行われる。
 * 例外は投げない（after() の中で走るため）。
 */
async function collectUntilDone(args: {
  candidateId: string;
  candidateNumber: string;
  batchId: string;
}): Promise<void> {
  const { candidateId, candidateNumber, batchId } = args;
  const startedAt = Date.now();
  const deadline = startedAt + COLLECT_MAX_MS;
  let delay = COLLECT_FIRST_DELAY_MS;
  let attempts = 0;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay * 2, COLLECT_MAX_DELAY_MS);
    attempts++;
    try {
      const r = await runAnalyzeCollect({ willExecute: true, candidateId });
      // 自分が投入したバッチの行が捌け切ったか（他経路が回収した場合もここで 0 になる）。
      const remaining = await prisma.recommendAnalyzeBatch.count({
        where: { batchId, status: { in: ["SUBMITTED", "COLLECTING"] } },
      });
      if (remaining === 0) {
        console.log(
          `${LOG} collected candidate=${candidateNumber} batch=${batchId} ` +
            `attempts=${attempts} saved=${r.savedFiles} skipped=${r.skippedFiles} ` +
            `autoRejectedD=${r.autoRejectedD} pdf=${r.pdfGenerated}/${r.pdfTargets} ` +
            `${Math.round((Date.now() - startedAt) / 1000)}秒`,
        );
        return;
      }
    } catch (e) {
      // 一時的な失敗（Anthropic API・DB）は次の周回で拾い直す。打ち切りは deadline のみ。
      console.error(
        `${LOG} collect_failed candidate=${candidateNumber} batch=${batchId} attempt=${attempts}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  console.warn(
    `${LOG} collect_timeout candidate=${candidateNumber} batch=${batchId} ` +
      `attempts=${attempts} ${Math.round((Date.now() - startedAt) / 1000)}秒で打ち切り（定時の collect に委ねる）`,
  );
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

    // T-189 修正: 投入できたら、そのまま回収まで見届ける（定時の collect は安全網として残す）。
    // 台帳保存に失敗した場合は回収できる行が無いのでポーリングしない。
    if (submit.batchId && !submit.ledgerSaveFailed) {
      await collectUntilDone({ candidateId, candidateNumber, batchId: submit.batchId });
    }
  } catch (e) {
    // 失敗しても受け口の作成は成功扱い。未評価のまま残るので翌朝の定時 submit が拾い直す。
    console.error(
      `${LOG} failed candidate=${candidateNumber} created=${createdCount}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}
