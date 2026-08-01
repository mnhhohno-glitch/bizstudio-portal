/**
 * T-150 Phase 2-2: 候補 JSON の剥がし・正規化・期日変換（src/lib/advisor/suggested-tasks.ts）のテスト。
 *
 * AI を呼ばずに、サーバー側の防御（種別ホワイトリスト・fail-open・期日変換）だけを検証する。
 * 実 AI での誤検出確認は staging での動作確認1〜5で行う。
 *
 * 実行:
 *   TZ=UTC npx tsx scripts/test-t150-suggested-tasks.ts
 *
 * ★必ず TZ=UTC で実行すること（本番 Railway は UTC 稼働。罠#17）。
 */

import { extractSuggestedTasks, normalizeSuggestedTasks, resolveDueDate } from "@/lib/advisor/suggested-tasks";
import { jstYmd, addDaysYmd, thisWeekFridayYmd, nextMondayYmd, addBusinessDaysYmd } from "@/lib/schedule-agent/jst";

let passed = 0;
let failed = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}  → ${a}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}\n      実際: ${a}\n      期待: ${e}`);
  }
}

const offset = new Date().getTimezoneOffset();
console.log(`\n[前提確認] TZ=${process.env.TZ ?? "(未設定)"} / getTimezoneOffset=${offset}`);
if (offset !== 0) {
  console.error("✗ TZ=UTC で実行してください。");
  process.exit(1);
}
const today = jstYmd();
console.log(`  ✓ UTC 環境で実行中 / JST today = ${today}`);

const block = (json: string) => `本文です。\n\n<<<T150_TASKS\n${json}\nT150_TASKS>>>`;

console.log("\n[1] 剥がし処理（本文に JSON を残さない）");
{
  const r = extractSuggestedTasks(block(`{"tasks":[{"kind":"JOB_SEARCH_SEND","due":"this_week"}]}`));
  eq("本文からマーカーが消える", r.cleanContent, "本文です。");
  eq("候補が1件取れる", r.suggestedTasks.length, 1);
  eq("kind が正しい", r.suggestedTasks[0].kind, "JOB_SEARCH_SEND");
  eq("dueDate = 今週の金曜", r.suggestedTasks[0].dueDate, thisWeekFridayYmd(today));
}
{
  const r = extractSuggestedTasks("マーカーの無い普通の応答です。");
  eq("マーカー無しは本文そのまま", r.cleanContent, "マーカーの無い普通の応答です。");
  eq("マーカー無しは候補0件", r.suggestedTasks, []);
}

console.log("\n[2] fail-open（壊れた JSON でもチャットを壊さない）");
{
  const r = extractSuggestedTasks(block(`{"tasks":[{"kind":"JOB_SEARCH_SEND",`)); // 途中で切れた JSON
  eq("壊れた JSON でも本文は復元される", r.cleanContent, "本文です。");
  eq("壊れた JSON は候補0件", r.suggestedTasks, []);
}
{
  const r = extractSuggestedTasks(block(`"ただの文字列"`));
  eq("配列でもオブジェクトでもない → 0件", r.suggestedTasks, []);
}

console.log("\n[3] 種別ホワイトリスト（自由抽出をサーバー側で禁止）");
eq(
  "未知の kind は破棄",
  normalizeSuggestedTasks({ tasks: [{ kind: "SEND_DOCUMENT", due: "tomorrow" }] }),
  [],
);
eq(
  "既知と未知の混在 → 既知のみ",
  normalizeSuggestedTasks({
    tasks: [{ kind: "CALL_CANDIDATE", due: "tomorrow" }, { kind: "FORM_SURVEY", due: "tomorrow" }],
  }).map((t) => t.kind),
  ["FORM_SURVEY"],
);
eq(
  "同一 kind の重複は1件のみ",
  normalizeSuggestedTasks({
    tasks: [
      { kind: "JOB_SEARCH_SEND", due: "this_week" },
      { kind: "JOB_SEARCH_SEND", due: "tomorrow" },
    ],
  }).length,
  1,
);
eq(
  "2種別なら2件まで",
  normalizeSuggestedTasks({
    tasks: [{ kind: "JOB_SEARCH_SEND", due: "none" }, { kind: "FORM_SURVEY", due: "none" }],
  }).length,
  2,
);
eq("tasks キーが無い形 → 0件", normalizeSuggestedTasks({ foo: 1 }), []);
eq("null → 0件", normalizeSuggestedTasks(null), []);

console.log("\n[4] 期日変換（相対表現 → JST 日付）");
eq("this_week", resolveDueDate("this_week", today), thisWeekFridayYmd(today));
eq("next_monday", resolveDueDate("next_monday", today), nextMondayYmd(today));
eq("tomorrow", resolveDueDate("tomorrow", today), addDaysYmd(today, 1));
eq("in_days:5", resolveDueDate("in_days:5", today), addDaysYmd(today, 5));
eq("none → 3営業日後", resolveDueDate("none", today), addBusinessDaysYmd(today, 3));
eq("未知の値 → none 扱い", resolveDueDate("来週の火曜", today), addBusinessDaysYmd(today, 3));
eq("空文字 → none 扱い", resolveDueDate("", today), addBusinessDaysYmd(today, 3));

console.log("\n[5] 過去日ガード（AI が負値を出しても期日は今日以降）");
eq("in_days:-1 は今日に丸める", resolveDueDate("in_days:-1", today), today);
eq("in_days:-30 は今日に丸める", resolveDueDate("in_days:-30", today), today);
eq("in_days:9999 は既定値(3営業日後)へ", resolveDueDate("in_days:9999", today), addBusinessDaysYmd(today, 3));

console.log("\n[6] 年ズレ防止（AI が日付を出しても採用しない）");
{
  const r = normalizeSuggestedTasks({
    tasks: [{ kind: "JOB_SEARCH_SEND", due: "2025-08-07", dueDate: "2025-08-07" }],
  });
  eq("AI 由来の日付は無視され、サーバー計算値になる", r[0].dueDate, addBusinessDaysYmd(today, 3));
  eq("年は必ず今年以降", r[0].dueDate.slice(0, 4) >= today.slice(0, 4), true);
}

console.log(`\n===== 結果: ${passed} passed / ${failed} failed （計 ${passed + failed} 件） =====\n`);
process.exit(failed === 0 ? 0 : 1);
