/**
 * T-131 step2: 手動アップPDFの job-platform 投入「滞留」拾い直しスクリプト。
 *
 * アップ時の自動投入（extract-text の fire-and-forget）が失敗・取りこぼした行を、後追いで再投入して
 * 無言消失を防ぐ。job-platform 側は内容ハッシュで二重登録を弾くため、二重投入になっても安全。
 *
 * 対象条件（全て満たす）:
 *   - PDF由来ブックマーク（sourceType=NULL・category=BOOKMARK・archivedAt=NULL）
 *   - テキスト抽出済み（extractedText あり）＋ Drive実体あり（driveFileId あり）
 *   - 未紐付け（externalJobRef 未設定）
 *   - 「作成 または 直近投入試行(platformSubmittedAt) から 30分以上経過」
 *   - createdAt >= CUTOFF（本日以降のみ。遡及4,204件は対象外＝step4で別設計）
 *
 * 動作:
 *   - 既定は DRY-RUN（対象一覧と件数を出力・DB/HTTPとも触らない）
 *   - --execute で再投入（1回の実行上限 50件・各件の成否をログ）
 *
 * 実行（本番コンテナ上・要 INTERNAL_INGEST_API_KEY / GOOGLE_SERVICE_ACCOUNT_KEY / DATABASE_URL）:
 *   railway ssh → npx tsx scripts/t131-resubmit-stale.ts             # DRY-RUN
 *                 npx tsx scripts/t131-resubmit-stale.ts --execute   # 本実行（上限50件）
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { submitPdfToJobPlatform } from "@/lib/job-platform-ingest";

const EXECUTE = process.argv.includes("--execute");
const BATCH_CAP = 50;
// 正規のフル投入は41秒〜数分＋受け側タイムアウト60秒のため、30分で「変換中の作りたてを誤って拾う」余地は実質ゼロ（T-133 FU-9で2時間から短縮）
const STALE_MS = 30 * 60 * 1000; // 30分
// 遡及（本機能ローンチ前の4,204件）を対象外にする作成日時の下限。env で上書き可。
const CUTOFF = new Date(process.env.T131_STALE_CUTOFF ?? "2026-07-04T00:00:00+09:00");

async function main() {
  const now = Date.now();
  const staleBefore = new Date(now - STALE_MS);

  const rows = await prisma.candidateFile.findMany({
    where: {
      sourceType: null,
      externalJobRef: null,
      category: "BOOKMARK",
      archivedAt: null,
      extractedText: { not: null },
      driveFileId: { not: null },
      createdAt: { gte: CUTOFF },
    },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      driveFileId: true,
      createdAt: true,
      platformSubmittedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 「作成 または 直近試行から30分以上経過」= max(createdAt, platformSubmittedAt) が30分前より古い
  const stale = rows.filter((r) => {
    const lastTouch = r.platformSubmittedAt ?? r.createdAt;
    return lastTouch <= staleBefore;
  });

  console.log(
    `[t131-resubmit] CUTOFF=${CUTOFF.toISOString()} / 候補(未紐付け・抽出済) ${rows.length}件 / うち滞留(30分超) ${stale.length}件 / mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"}`,
  );

  const target = stale.slice(0, BATCH_CAP);
  if (stale.length > BATCH_CAP) {
    console.log(`[t131-resubmit] 上限 ${BATCH_CAP} 件のため今回は ${target.length}件を処理（残 ${stale.length - BATCH_CAP}件は次回）`);
  }

  for (const r of target) {
    const tag = `fileId=${r.id} cand=${r.candidateId} file=${r.fileName}`;
    if (!EXECUTE) {
      console.log(`  [DRY] ${tag} created=${r.createdAt.toISOString()} lastSubmit=${r.platformSubmittedAt?.toISOString() ?? "-"}`);
      continue;
    }
    try {
      const { base64 } = await downloadFileFromDrive(r.driveFileId!);
      const pdfBuffer = Buffer.from(base64, "base64");
      const res = await submitPdfToJobPlatform({ fileId: r.id, fileName: r.fileName, pdfBuffer });
      if (res.ok) {
        await prisma.candidateFile.update({
          where: { id: r.id },
          data: { externalJobRef: res.sourceJobId, platformSubmittedAt: new Date() },
        });
        console.log(`  [OK] ${tag} → ${res.sourceJobId} (status=${res.status} deduped=${res.deduped})`);
      } else {
        await prisma.candidateFile.update({
          where: { id: r.id },
          data: { platformSubmittedAt: new Date() }, // 試行時刻を刻んで30分間は再試行しない
        });
        console.error(`  [NG] ${tag}: ${res.error}`);
      }
    } catch (e) {
      // Drive取得失敗等。試行時刻だけ刻んで継続（1件の失敗で全体を止めない）。
      try {
        await prisma.candidateFile.update({ where: { id: r.id }, data: { platformSubmittedAt: new Date() } });
      } catch {
        /* noop */
      }
      console.error(`  [ERR] ${tag}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`[t131-resubmit] 完了（mode=${EXECUTE ? "EXECUTE" : "DRY-RUN"} / 対象${target.length}件）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
