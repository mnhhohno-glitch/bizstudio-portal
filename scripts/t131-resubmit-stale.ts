/**
 * T-131 step2: 手動アップPDFの job-platform 投入「滞留」拾い直しスクリプト（手動実行の薄いラッパ）。
 *
 * 本体ロジックは src/lib/t131-resubmit-stale.ts の runResubmitStale に集約（定期自動の
 * /api/internal/bookmarks/resubmit-stale と共有）。FU-8恒久修正で投入前クレーム方式に整合済み:
 *   - 対象滞留 = externalJobRef=null かつ（platformSubmittedAt=null または 30分以上前）
 *   - 拾う際に再クレーム（platformSubmittedAt=now）してから再送信し、二重送信を排他する。
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
import { runResubmitStale } from "@/lib/t131-resubmit-stale";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  await runResubmitStale({ execute: EXECUTE, log: (m) => console.log(m) });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
