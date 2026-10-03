/**
 * 書類通過日をエントリー編集画面から選考段階に関係なく確認・訂正・空欄化できることを確かめる。AI を呼ばない。
 * **ローカル DB 専用**（DATABASE_URL が localhost でないと止まる）。テスト用の行を作って最後に消す。
 *
 *   DATABASE_URL=postgresql://postgres@localhost:55432/t5 BASE_URL=http://localhost:3100 npx tsx scripts/test-document-pass-date.ts
 *
 * 確かめること:
 *   [A] 日付定義（JST 日付 ↔ 保存値）・書類通過日だけの更新の判定・段階変更の自動入力ルール（既存値を上書きしない）
 *   [B] PATCH /api/entries/[id]（エントリー編集画面・書類選考タブのセルと同じ保存処理）で
 *       面接・内定・選考終了のエントリーの書類通過日を 入力・訂正・空欄化 → 再取得で同じ JST 日付。
 *       他の列（フラグ・連絡状況・有効/無効・他の日付）は 1 つも変わらない。選考ステータス履歴も増えない
 *   [C] 月別集計（実績表 computeWeeklyMatrix）：訂正後の JST 日付の月に数えられ、元の月から消える
 *   [D] 段階変更（PATCH /api/entries/[id]/flags）で、確定済みの書類通過日を当日に上書きしない
 *   [E] 入力誤りは 400 で DB を変えない
 */
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}

import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { SESSION_COOKIE_NAME } from "@/lib/session-token";
import {
  documentPassDateToInput,
  documentPassDateFromInput,
  isDocumentPassDateOnlyUpdate,
  isValidDocumentPassDateBody,
  stageAutoDates,
} from "@/lib/entries/documentPassDate";
import { computeWeeklyMatrix } from "@/lib/performance/weeklyMatrix";
import { jstDateStart, jstDateEnd, todayJstDateString } from "@/lib/dailyReport/jstDate";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";
let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}

const TAG = `t-dpd-${Date.now()}`;
const D = (iso: string) => new Date(iso);

// 書類通過日以外に変わってはいけない列（updatedAt は @updatedAt なので除外）
function snapshotExcept(row: Record<string, unknown>, ...skip: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "updatedAt" || k === "candidate" || skip.includes(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

async function main() {
  // ---------- [A] ----------
  check("[A] UTC正午で保存された値は同じJST日付", documentPassDateToInput("2026-09-30T12:00:00.000Z"), "2026-09-30");
  check("[A] UTC0時で保存された値（段階変更の自動入力）も同じJST日付", documentPassDateToInput("2026-10-01T00:00:00.000Z"), "2026-10-01");
  check("[A] JST0時で保存された値も月別集計と同じJST日付", documentPassDateToInput("2026-09-29T15:00:00.000Z"), "2026-09-30");
  check("[A] 空は空欄", documentPassDateToInput(null), "");
  check("[A] 入力→保存値（書類選考タブのセルと同じUTC正午）", documentPassDateFromInput("2026-09-30"), "2026-09-30T12:00:00.000Z");
  check("[A] 空欄→null（クリア）", documentPassDateFromInput(""), null);
  check("[A] 書類通過日だけの本文", isDocumentPassDateOnlyUpdate({ documentPassDate: null }), true);
  check("[A] 他の項目を含む本文は対象外", isDocumentPassDateOnlyUpdate({ documentPassDate: null, memo: "x" }), false);
  check("[A] 不正な日付は不可", isValidDocumentPassDateBody("abc"), false);
  const ex = { documentSubmitDate: null, documentPassDate: D("2026-09-30T12:00:00.000Z"), offerDate: null, acceptanceDate: null };
  check("[A] 確定済みの書類通過日は段階変更（面接→内定）で上書きしない",
    Object.keys(stageAutoDates({ entryFlag: "内定" }, ex, "2026-10-04")).sort(), ["offerDate"]);
  check("[A] 空の書類通過日は従来どおり当日を入れる",
    stageAutoDates({ entryFlag: "面接" }, { ...ex, documentPassDate: null }, "2026-10-04").documentPassDate?.toISOString(), "2026-10-04T00:00:00.000Z");

  // ---------- データ準備 ----------
  const user = await prisma.user.create({ data: { name: `テスト${TAG}`, email: `${TAG}@example.com`, passwordHash: "x", role: "admin" } });
  const employee = await prisma.employee.create({ data: { employeeNumber: TAG, name: `テストCA${TAG}`, userId: user.id } });
  const candidate = await prisma.candidate.create({ data: { candidateNumber: TAG, name: "テスト 求職者", employeeId: employee.id } });
  const base = {
    candidateId: candidate.id, externalJobId: 0, jobTitle: "営業", jobDb: "HITO-Link",
    entryDate: D("2026-09-10T12:00:00.000Z"), introducedAt: D("2026-09-10T12:00:00.000Z"),
    documentSubmitDate: D("2026-09-20T00:00:00.000Z"),
  };
  // 面接中：書類通過日は段階変更で 10/01 に自動入力された想定。有効/無効は手動で無効（フラグからの再計算なら有効になる組み合わせ）
  const interview = await prisma.jobEntry.create({ data: { ...base, companyName: "面接中株式会社", entryFlag: "面接", entryFlagDetail: "一次面接実施前",
    companyFlag: null, personFlag: null, isActive: false, documentPassDate: D("2026-10-01T00:00:00.000Z"),
    firstInterviewDate: D("2026-10-08T12:00:00.000Z"), firstInterviewTime: "14:00" } });
  // 内定
  const offer = await prisma.jobEntry.create({ data: { ...base, companyName: "内定株式会社", entryFlag: "内定", entryFlagDetail: null,
    isActive: true, documentPassDate: null, offerDate: D("2026-10-02T00:00:00.000Z") } });
  // 選考終了（本人へ見送り通知済み → 無効）
  const ended = await prisma.jobEntry.create({ data: { ...base, companyName: "終了株式会社", entryFlag: "面接", entryFlagDetail: "見送り",
    personFlag: "見送り通知送信済", isActive: false, documentPassDate: D("2026-09-25T12:00:00.000Z") } });

  const { token } = await createSession(user.id);
  const headers = { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=${token}` };
  const patch = (id: string, body: unknown, path = "") =>
    fetch(`${BASE_URL}/api/entries/${id}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  const getEntry = async (id: string) => (await (await fetch(`${BASE_URL}/api/entries/${id}`, { headers })).json()).entry as Record<string, unknown>;
  const historyCount = (id: string) => prisma.jobEntryStatusHistory.count({ where: { jobEntryId: id } });

  const septFrom = jstDateStart("2026-09-01"), septTo = jstDateEnd("2026-09-30");
  const octFrom = jstDateStart("2026-10-01"), octTo = jstDateEnd("2026-10-31");
  const monthCount = async (from: Date, to: Date) =>
    (await computeWeeklyMatrix({ employeeId: employee.id, userId: user.id, from, to })).selection.documentPassRecs;

  check("[C] 訂正前：9月の書類通過は1件（選考終了の 9/25）", await monthCount(septFrom, septTo), 1);
  check("[C] 訂正前：10月の書類通過は1件（面接中の 10/01）", await monthCount(octFrom, octTo), 1);

  // ---------- [B] 面接中：訂正（10/01 → 9/30） ----------
  const before = snapshotExcept((await getEntry(interview.id)), "documentPassDate");
  const h0 = await historyCount(interview.id);
  let res = await patch(interview.id, { documentPassDate: documentPassDateFromInput("2026-09-30") });
  check("[B] 面接中：訂正の保存 200", res.status, 200);
  let after = await getEntry(interview.id);
  check("[B] 面接中：再表示は 2026-09-30", documentPassDateToInput(after.documentPassDate as string), "2026-09-30");
  check("[B] 面接中：他の列（フラグ・連絡状況・有効/無効・他の日付）は不変", snapshotExcept(after, "documentPassDate"), before);
  check("[B] 面接中：手動の無効は無効のまま", after.isActive, false);
  check("[B] 面接中：選考ステータス履歴は増えない", await historyCount(interview.id), h0);

  check("[C] 訂正後：9月の書類通過は2件", await monthCount(septFrom, septTo), 2);
  check("[C] 訂正後：10月の書類通過は0件", await monthCount(octFrom, octTo), 0);

  // ---------- [B] 空欄化 → 再入力 ----------
  res = await patch(interview.id, { documentPassDate: documentPassDateFromInput("") });
  after = await getEntry(interview.id);
  check("[B] 空欄化の保存 200", res.status, 200);
  check("[B] 空欄化：再表示は空欄", documentPassDateToInput(after.documentPassDate as string), "");
  check("[B] 空欄化：他の列は不変", snapshotExcept(after, "documentPassDate"), before);
  check("[C] 空欄化後：9月は1件", await monthCount(septFrom, septTo), 1);
  await patch(interview.id, { documentPassDate: documentPassDateFromInput("2026-09-30") });
  after = await getEntry(interview.id);
  check("[B] 再入力：再表示は 2026-09-30", documentPassDateToInput(after.documentPassDate as string), "2026-09-30");

  // ---------- [B] 内定：空欄 → 入力 ----------
  const offerBefore = snapshotExcept(await getEntry(offer.id), "documentPassDate");
  res = await patch(offer.id, { documentPassDate: documentPassDateFromInput("2026-09-28") });
  after = await getEntry(offer.id);
  check("[B] 内定：入力の保存 200", res.status, 200);
  check("[B] 内定：再表示は 2026-09-28", documentPassDateToInput(after.documentPassDate as string), "2026-09-28");
  check("[B] 内定：他の列は不変", snapshotExcept(after, "documentPassDate"), offerBefore);

  // ---------- [B] 選考終了：訂正 ----------
  const endedBefore = snapshotExcept(await getEntry(ended.id), "documentPassDate");
  const he = await historyCount(ended.id);
  res = await patch(ended.id, { documentPassDate: documentPassDateFromInput("2026-09-24") });
  after = await getEntry(ended.id);
  check("[B] 選考終了：訂正の保存 200", res.status, 200);
  check("[B] 選考終了：再表示は 2026-09-24", documentPassDateToInput(after.documentPassDate as string), "2026-09-24");
  check("[B] 選考終了：他の列（無効・見送り通知送信済）は不変", snapshotExcept(after, "documentPassDate"), endedBefore);
  check("[B] 選考終了：選考ステータス履歴は増えない", await historyCount(ended.id), he);

  // ---------- [C] JST 月境界 ----------
  await patch(offer.id, { documentPassDate: documentPassDateFromInput("2026-10-01") });
  check("[C] 10/01 入力は10月に数える", await monthCount(octFrom, octTo), 1);
  check("[C] 10/01 入力は9月に入らない（9月=面接中9/30・終了9/24）", await monthCount(septFrom, septTo), 2);

  // ---------- [D] 段階変更で上書きしない ----------
  res = await patch(interview.id, { entryFlag: "内定", entryFlagDetail: "", companyFlag: null, personFlag: null }, "/flags");
  after = await getEntry(interview.id);
  check("[D] 面接→内定の段階変更 200", res.status, 200);
  check("[D] 段階変更後も書類通過日は 2026-09-30 のまま", documentPassDateToInput(after.documentPassDate as string), "2026-09-30");
  check("[D] 内定日は空欄だったので当日が入る（従来どおり）", documentPassDateToInput(after.offerDate as string), todayJstDateString());

  // ---------- [E] 入力誤り ----------
  const eBefore = await getEntry(ended.id);
  res = await patch(ended.id, { documentPassDate: "abc" });
  check("[E] 不正な日付は 400", res.status, 400);
  check("[E] 400 のとき DB は変わらない", (await getEntry(ended.id)).documentPassDate, eBefore.documentPassDate);

  // ---------- 後片付け ----------
  await prisma.jobEntryStatusHistory.deleteMany({ where: { candidateId: candidate.id } });
  await prisma.jobEntry.deleteMany({ where: { candidateId: candidate.id } });
  await prisma.candidate.delete({ where: { id: candidate.id } });
  await prisma.userSession.deleteMany({ where: { userId: user.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${checks - failures}/${checks} PASS`);
  if (failures > 0) process.exit(1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
