/**
 * T-064: スカウト配信実績集計 失敗通知 API 疎通確認
 *
 * 実行: npx tsx scripts/test-scout-import-failed.ts
 *
 * 確認項目:
 *  1. 正常リクエスト → NOTIFIED（LINE WORKS に実際に通知が飛ぶ）
 *  2. 認証なし → 403
 *  3. targetDate 未指定 → 400
 *  4. errorMessage 未指定 → 400
 *  5. processLog なし → NOTIFIED（省略OK）
 */

import "dotenv/config";

const BASE_URL =
  process.env.PORTAL_BASE_URL ||
  "https://bizstudio-portal-staging-production.up.railway.app";
const RPA_SECRET = process.env.RPA_API_SECRET;
const ENDPOINT = `${BASE_URL}/api/rpa/scout/import-failed`;

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function postJson(
  body: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

async function main() {
  console.log(`\n=== T-064 スカウト集計失敗通知 疎通確認 ===`);
  console.log(`  ENDPOINT: ${ENDPOINT}\n`);

  if (!RPA_SECRET) {
    console.error("  ERROR: RPA_API_SECRET が .env に設定されていません");
    process.exit(1);
  }

  // 1. 認証なし → 403
  console.log("[1] 認証なしリクエスト → 403");
  const r1 = await postJson({ targetDate: "2026-05-25", errorMessage: "test" });
  check("status=403", r1.status === 403, `actual=${r1.status}`);

  // 2. targetDate なし → 400
  console.log("\n[2] targetDate なし → 400");
  const r2 = await postJson(
    { errorMessage: "test" },
    { "x-rpa-secret": RPA_SECRET },
  );
  check("status=400", r2.status === 400, `actual=${r2.status}`);

  // 3. errorMessage なし → 400
  console.log("\n[3] errorMessage なし → 400");
  const r3 = await postJson(
    { targetDate: "2026-05-25" },
    { "x-rpa-secret": RPA_SECRET },
  );
  check("status=400", r3.status === 400, `actual=${r3.status}`);

  // 4. processLog なし正常リクエスト → NOTIFIED or SKIPPED
  console.log("\n[4] processLog なし正常リクエスト");
  const r4 = await postJson(
    { targetDate: "2026-05-25", errorMessage: "テスト通知（processLogなし）" },
    { "x-rpa-secret": RPA_SECRET },
  );
  check("status=200", r4.status === 200, `actual=${r4.status}`);
  check(
    "status=NOTIFIED or SKIPPED",
    r4.body.status === "NOTIFIED" || r4.body.status === "SKIPPED",
    `${r4.body.status}`,
  );

  // 5. processLog あり正常リクエスト → NOTIFIED or SKIPPED（実際の通知テスト）
  console.log("\n[5] processLog あり正常リクエスト（実際の通知）");
  const r5 = await postJson(
    {
      targetDate: "2026-05-25",
      errorMessage: "2号機ファイルアクセス失敗（疎通テスト）",
      processLog: [
        "OK: 1号機 当日 157件 (スキャン 196 行)",
        "ERROR: 2号機 ファイルが他のプログラムによって使用されています",
        "OK: 3号機 当日 89件 (スキャン 112 行)",
      ],
    },
    { "x-rpa-secret": RPA_SECRET },
  );
  check("status=200", r5.status === 200, `actual=${r5.status}`);
  check(
    "status=NOTIFIED or SKIPPED",
    r5.body.status === "NOTIFIED" || r5.body.status === "SKIPPED",
    `${r5.body.status}`,
  );
  check("targetDate=2026-05-25", r5.body.targetDate === "2026-05-25");

  console.log("\n=== 結果 ===");
  console.log(`  PASS: ${pass}`);
  console.log(`  FAIL: ${fail}`);

  if (r5.body.status === "SKIPPED") {
    console.log(
      "\n  ⚠️ LINE WORKS 環境変数未設定のため通知は SKIPPED。route 登録・バリデーションは正常。",
    );
  } else if (r5.body.status === "NOTIFIED") {
    console.log("\n  ✅ LINE WORKS に通知が送信されました。トークルームを確認してください。");
  }

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
