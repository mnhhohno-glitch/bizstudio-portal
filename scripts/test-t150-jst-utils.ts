/**
 * T-150 Phase 2-1: 期日計算ユーティリティ（src/lib/schedule-agent/jst.ts）のユニットテスト。
 *
 * 本リポジトリにはテストフレームワーク（vitest/jest）が導入されていないため、
 * scripts/ 配下の tsx 実行スクリプトとして自己完結のアサーションランナーで実装している。
 *
 * 実行:
 *   TZ=UTC npx tsx scripts/test-t150-jst-utils.ts        （bash）
 *   $env:TZ="UTC"; npx tsx scripts/test-t150-jst-utils.ts （PowerShell）
 *
 * ★必ず TZ=UTC で実行すること。本番 Railway は UTC 稼働であり、ローカル JST で通っても
 *   本番で壊れるのが罠#17 のサーバー側事例（T-033）。TZ が UTC でない場合はテストを失敗させる。
 *
 * 終了コード: 全件パス=0 / 1件でも失敗=1
 */

import {
  jstYmd,
  thisWeekFridayYmd,
  nextMondayYmd,
  addBusinessDaysYmd,
  clampNotPastYmd,
  isBusinessDayYmd,
} from "@/lib/schedule-agent/jst";

let passed = 0;
let failed = 0;

function eq(label: string, actual: string | boolean, expected: string | boolean) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${label}  → ${actual}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}  → 実際: ${actual} / 期待: ${expected}`);
  }
}

// --- 前提: TZ=UTC で走っていること（本番 Railway と同条件） ---
const offset = new Date().getTimezoneOffset();
console.log(`\n[前提確認] process.env.TZ=${process.env.TZ ?? "(未設定)"} / getTimezoneOffset=${offset}`);
if (offset !== 0) {
  console.error(
    "✗ TZ が UTC ではありません。`TZ=UTC npx tsx scripts/test-t150-jst-utils.ts` で実行してください。",
  );
  process.exit(1);
}
console.log("  ✓ UTC 環境で実行中（本番 Railway と同条件）");

// 2026年8月のカレンダー（JST）
//   8/2(日) 8/3(月) 8/4(火) 8/5(水) 8/6(木) 8/7(金) 8/8(土) 8/9(日) 8/10(月) ... 8/14(金)
console.log("\n[1] thisWeekFridayYmd — 「今週中」→ その週の金曜");
eq("月曜に「今週中」 2026-08-03", thisWeekFridayYmd("2026-08-03"), "2026-08-07");
eq("金曜に「今週中」 2026-08-07（当日）", thisWeekFridayYmd("2026-08-07"), "2026-08-07");
eq("土曜に「今週中」 2026-08-08（翌週金曜）", thisWeekFridayYmd("2026-08-08"), "2026-08-14");
eq("日曜に「今週中」 2026-08-02", thisWeekFridayYmd("2026-08-02"), "2026-08-07");
eq("火曜に「今週中」 2026-08-04", thisWeekFridayYmd("2026-08-04"), "2026-08-07");

console.log("\n[2] nextMondayYmd — 「週明け」→ 次の月曜");
eq("月曜に「週明け」 2026-08-03（翌週）", nextMondayYmd("2026-08-03"), "2026-08-10");
eq("金曜に「週明け」 2026-08-07", nextMondayYmd("2026-08-07"), "2026-08-10");
eq("日曜に「週明け」 2026-08-02", nextMondayYmd("2026-08-02"), "2026-08-03");
eq("土曜に「週明け」 2026-08-08", nextMondayYmd("2026-08-08"), "2026-08-10");

console.log("\n[3] addBusinessDaysYmd — N営業日後（当日は数えない・土日祝を除外）");
// 8/6(木) から3営業日: 8/7(金) → 8/10(月) → 8/11(火)。※8/11 は山の日（祝日）なので実際は 8/12(水)
eq("木曜から3営業日 2026-08-06", addBusinessDaysYmd("2026-08-06", 3), "2026-08-12");
// 8/3(月) から3営業日: 8/4 → 8/5 → 8/6
eq("月曜から3営業日 2026-08-03", addBusinessDaysYmd("2026-08-03", 3), "2026-08-06");
// 8/7(金) から3営業日: 8/10(月) → 8/11(祝) スキップ → 8/12(水) → 8/13(木)
eq("金曜から3営業日 2026-08-07（週跨ぎ）", addBusinessDaysYmd("2026-08-07", 3), "2026-08-13");
// 年跨ぎ: 12/30(水) から3営業日。12/31(木)・1/1(祝)・1/2(金)・1/3(土)・1/4(日)・1/5(月)
eq("年跨ぎ 2026-12-30 から3営業日", addBusinessDaysYmd("2026-12-30", 3), "2027-01-05");
eq("1営業日 = 翌営業日と一致（金曜）", addBusinessDaysYmd("2026-08-07", 1), "2026-08-10");

console.log("\n[4] clampNotPastYmd — 過去日ガード");
const today = jstYmd();
eq("大過去は今日に切り上げ", clampNotPastYmd("2020-01-01"), today);
eq("今日はそのまま", clampNotPastYmd(today), today);
eq("未来日はそのまま", clampNotPastYmd("2099-12-31"), "2099-12-31");

console.log("\n[5] 祝日・土日判定の裏取り（isBusinessDayYmd）");
eq("2026-08-11 は山の日（祝日）", isBusinessDayYmd("2026-08-11"), false);
eq("2026-08-08 は土曜", isBusinessDayYmd("2026-08-08"), false);
eq("2026-08-07 は平日", isBusinessDayYmd("2026-08-07"), true);
eq("2027-01-01 は元日", isBusinessDayYmd("2027-01-01"), false);

console.log("\n[6] 罠#17 の回帰確認 — UTC 環境で JST 月曜早朝の曜日がずれないこと");
// UTC 稼働のサーバーで new Date().getDay() を使うと JST 月曜 0:00〜8:59 が日曜扱いになり、
// thisWeekFridayYmd が「日曜扱い＝5日後」を返して1週間ずれる。暦日文字列経由なら影響を受けない。
eq("JST 月曜(2026-08-03)は必ず 8/7 金曜", thisWeekFridayYmd("2026-08-03"), "2026-08-07");
eq("JST 日曜(2026-08-02)は 8/7 金曜（月曜と同じ週になる）", thisWeekFridayYmd("2026-08-02"), "2026-08-07");

console.log(`\n===== 結果: ${passed} passed / ${failed} failed （計 ${passed + failed} 件） =====\n`);
process.exit(failed === 0 ? 0 : 1);
