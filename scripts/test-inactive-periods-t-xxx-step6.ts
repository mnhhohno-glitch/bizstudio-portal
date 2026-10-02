/**
 * T-XXX step6: 稼働しない期間の登録と、退職後の成果の集計を確かめる。AI を呼ばない。
 * **ローカル DB 専用**（DATABASE_URL が localhost でないと止まる）。step5 の架空データの上に、このテスト用の行を足して使う。
 *
 *   DATABASE_URL=postgresql://postgres:t5@localhost:55432/t5 npx tsx scripts/seed-analytics-fixture-t-xxx-step5.ts
 *   DATABASE_URL=postgresql://postgres:t5@localhost:55432/t5 [BASE_URL=http://localhost:3100] npx tsx scripts/test-inactive-periods-t-xxx-step6.ts
 *
 * 確かめること:
 *   [A] 入力検証・重複判定・稼働日数の按分（月の途中開始/終了・終了未定・入社日/退職日と重なる）
 *   [B] 保存（追加・編集・削除・重複の拒否）、get_ca_roster の期間と月ごとの稼働日数、CA の月の行の availability、休業中の活動の警告
 *   [C] 退職後の成果: 全体（ALL）に含まれる・元担当の postExit に分けて出る・CA の行（活動の分母）に入らない（4 ツール）
 *   [D] 稼働しない期間を入れても company-kpi の全社の値が変わらない
 *   [E] （BASE_URL があれば）画面の API: admin は一覧・追加・編集・削除、重複 409、入力誤り 400、admin 以外 403、理由は保存しない
 */
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}

import { prisma } from "@/lib/prisma";
import {
  parseInactivePeriodInput,
  periodsOverlap,
  monthAvailability,
  saveInactivePeriod,
  listInactivePeriods,
  InactivePeriodOverlapError,
} from "@/lib/employee-inactive-periods";
import { buildCaRoster } from "@/lib/aiRead/analytics/roster";
import { buildAcceptRevenue } from "@/lib/aiRead/analytics/revenue";
import { buildSelectionConversion } from "@/lib/aiRead/analytics/conversion";
import { buildPipelineNow } from "@/lib/aiRead/analytics/pipeline";
import { buildForecastInputs } from "@/lib/aiRead/analytics/forecast";
import { buildCohortFunnel } from "@/lib/aiRead/analytics/cohort";
import { buildCompanyKpiResponse } from "@/lib/aiRead/companyKpiResponse";

type J = Record<string, unknown>;
let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}
function checkTrue(label: string, cond: boolean, detail = ""): void {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}
const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const arr = (b: J, k: string) => (b[k] ?? []) as J[];
const findRow = (rs: J[], ca: string, month: string | null) => rs.find((r) => r.ca === ca && (r.month ?? null) === month) as J | undefined;

async function expectOverlap(label: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
    checkTrue(label, false, "重複なのに保存された");
  } catch (e) {
    checkTrue(label, e instanceof InactivePeriodOverlapError, String(e));
  }
}

async function main() {
  // ---------------- [A] 純粋関数 ----------------
  check("[A] 入力: 終了空欄は終了未定", parseInactivePeriodInput({ startDate: "2026-10-01", endDate: "" }), { ok: true, value: { startDate: "2026-10-01", endDate: null } });
  check("[A] 入力: 理由キーは読まない", parseInactivePeriodInput({ startDate: "2026-10-01", endDate: null, reason: "産休" }), { ok: true, value: { startDate: "2026-10-01", endDate: null } });
  check("[A] 入力: 終了<開始は拒否", parseInactivePeriodInput({ startDate: "2026-10-10", endDate: "2026-10-01" }).ok, false);
  check("[A] 入力: 存在しない日付は拒否", parseInactivePeriodInput({ startDate: "2026-02-30" }).ok, false);
  check("[A] 入力: 開始なしは拒否", parseInactivePeriodInput({ endDate: "2026-10-01" }).ok, false);
  check("[A] 重複: 端が 1 日重なる", periodsOverlap({ startDate: "2026-10-01", endDate: "2026-10-31" }, { startDate: "2026-10-31", endDate: null }), true);
  check("[A] 重複: 隣接は重ならない", periodsOverlap({ startDate: "2026-10-01", endDate: "2026-10-31" }, { startDate: "2026-11-01", endDate: null }), false);
  check("[A] 重複: 終了未定どうし", periodsOverlap({ startDate: "2026-10-01", endDate: null }, { startDate: "2027-05-01", endDate: null }), true);
  const pick = (a: ReturnType<typeof monthAvailability>) => [a.employedDays, a.inactiveDays, a.activeDays, a.fte];
  const base = { hireYmd: "2024-06-01", resignYmd: null };
  check("[A] 按分: 月の途中開始（10/16〜未定）→ 10 月 15/31", pick(monthAvailability({ ...base, periods: [{ startDate: "2026-10-16", endDate: null }] }, "2026-10")), [31, 16, 15, 0.484]);
  check("[A] 按分: 終了未定の翌月は 0", pick(monthAvailability({ ...base, periods: [{ startDate: "2026-10-16", endDate: null }] }, "2026-11")), [30, 30, 0, 0]);
  check("[A] 按分: 月の途中終了（9/1〜9/15）→ 9 月 0.5", pick(monthAvailability({ ...base, periods: [{ startDate: "2026-09-01", endDate: "2026-09-15" }] }, "2026-09")), [30, 15, 15, 0.5]);
  check("[A] 按分: 期間前の月は 1", pick(monthAvailability({ ...base, periods: [{ startDate: "2026-10-01", endDate: null }] }, "2026-09")), [30, 0, 30, 1]);
  check("[A] 按分: 入社日と重なる（入社 7/15・休 7/10〜7/20）→ 在籍 17・休 6", pick(monthAvailability({ hireYmd: "2026-07-15", resignYmd: null, periods: [{ startDate: "2026-07-10", endDate: "2026-07-20" }] }, "2026-07")), [17, 6, 11, 0.355]);
  check("[A] 按分: 退職日と重なる（退職 7/31・休 7/25〜未定）→ 7 月 在籍 31・休 7", pick(monthAvailability({ hireYmd: "2025-01-01", resignYmd: "2026-07-31", periods: [{ startDate: "2026-07-25", endDate: null }] }, "2026-07")), [31, 7, 24, 0.774]);
  check("[A] 按分: 退職後の月は 0", pick(monthAvailability({ hireYmd: "2025-01-01", resignYmd: "2026-07-31", periods: [] }, "2026-08")), [0, 0, 0, 0]);
  check("[A] 按分: 2 期間（8/1〜8/10・8/21〜未定）→ 10 日", pick(monthAvailability({ ...base, periods: [{ startDate: "2026-08-01", endDate: "2026-08-10" }, { startDate: "2026-08-21", endDate: null }] }, "2026-08")), [31, 21, 10, 0.323]);

  // ---------------- 準備 ----------------
  const emp = async (no: string) => prisma.employee.findUniqueOrThrow({ where: { employeeNumber: no } });
  const caA = await emp("9001");
  const caD = await emp("9004"); // 退職済み（退職日 2026-07-31・disabled）
  await prisma.employeeInactivePeriod.deleteMany({});
  // このテストで足した行を消す（2 回目以降の実行用）
  const old = await prisma.candidate.findMany({ where: { name: { startsWith: "step6 架空" } }, select: { id: true } });
  if (old.length) {
    await prisma.jobEntry.deleteMany({ where: { candidateId: { in: old.map((c) => c.id) } } });
    await prisma.interviewRecord.deleteMany({ where: { candidateId: { in: old.map((c) => c.id) } } });
    await prisma.candidate.deleteMany({ where: { id: { in: old.map((c) => c.id) } } });
  }

  // [D] の比較元（稼働しない期間が無い状態の全社）
  const ck0 = (await buildCompanyKpiResponse({ year: null, month: "2026-08" })).body as J;

  // ---------------- [C] 退職後の成果 ----------------
  const range = { from: "2026-05", to: "2026-09" };
  const [rev0, conv0, pipe0] = await Promise.all([buildAcceptRevenue(range), buildSelectionConversion(range), buildPipelineNow({})]);
  const allRev0 = findRow(arr(rev0, "total"), "ALL", null)!;
  const allConv0 = findRow(arr(conv0, "total"), "ALL", null)!;
  const pipeAll0 = arr(pipe0, "rows").find((r) => r.ca === "ALL")!;
  const caRev0 = arr(rev0, "total").filter((r) => r.ca !== "ALL").map((r) => [r.ca, r.revenue]);

  // 9004 の担当の求職者: 退職前（7/20）にエントリー → 退職後（8/10）に承諾 60 万円、退職後（8/05）にエントリーして選考中
  let seq = 0;
  const mkCand = async (employeeId: string) => {
    seq += 1;
    return prisma.candidate.create({ data: { candidateNumber: String(9600000 + seq), name: `step6 架空 ${seq}`, employeeId, supportStatus: "ACTIVE", supportSubStatus: "求人紹介前" } });
  };
  const px = await mkCand(caD.id);
  const base6 = { externalJobId: 0, companyName: "架空株式会社", jobTitle: "営業" };
  await prisma.jobEntry.create({
    data: { ...base6, candidateId: px.id, entryDate: D("2026-07-20"), introducedAt: D("2026-07-20"), entryFlag: "内定", entryFlagDetail: "承諾", offerDate: D("2026-08-05"), acceptanceDate: D("2026-08-10"), revenue: 600_000, jobDbCost: 0, cost: 0 } as never,
  });
  await prisma.jobEntry.create({
    data: { ...base6, candidateId: px.id, entryDate: D("2026-08-05"), introducedAt: D("2026-08-05"), entryFlag: "書類選考", entryFlagDetail: "選考中" } as never,
  });

  const [rev1, conv1, pipe1, fc1] = await Promise.all([buildAcceptRevenue(range), buildSelectionConversion(range), buildPipelineNow({}), buildForecastInputs({ baseFrom: "2026-05", baseTo: "2026-09" })]);
  const allRev1 = findRow(arr(rev1, "total"), "ALL", null)!;
  check("[C] 承諾売上: ALL に退職後の承諾が入る（+600,000・+1 件）", [(allRev1.revenue as number) - (allRev0.revenue as number), (allRev1.deals as number) - (allRev0.deals as number)], [600000, 1]);
  check("[C] 承諾売上: 2026-08 の ALL にも入る", (findRow(arr(rev1, "byMonth"), "ALL", "2026-08")!.revenue as number) - (findRow(arr(rev0, "byMonth"), "ALL", "2026-08")!.revenue as number), 600000);
  const pr = arr(rev1, "postExit").find((r) => r.ca === "9004");
  check("[C] 承諾売上: postExit に元担当 9004 で分けて出る", [pr?.resignDate, (pr?.total as J)?.revenue, (pr?.total as J)?.deals, ((pr?.byMonth as J[]) ?? []).map((m) => m.month)], ["2026-07-31", 600000, 1, ["2026-08"]]);
  check("[C] 承諾売上: 在籍 CA の行は変わらない", arr(rev1, "total").filter((r) => r.ca !== "ALL").map((r) => [r.ca, r.revenue]), caRev0);
  checkTrue("[C] 承諾売上: 退職済み 9004 は CA の行に出ない（既定の対象外）", !arr(rev1, "total").some((r) => r.ca === "9004"));
  const revD = await buildAcceptRevenue({ ...range, caId: "9004" });
  const revDTotal = findRow(arr(revD, "total"), "9004", null)!;
  check("[C] caId=9004: CA の行には退職後の承諾が入らず postExit に出る", [revDTotal.revenue, (arr(revD, "postExit")[0]?.total as J)?.revenue], [0, 600000]);
  check("[C] caId=9004: 退職後の月の CA 行は無い", arr(revD, "byMonth").filter((r) => r.ca === "9004").map((r) => r.month), ["2026-05", "2026-06", "2026-07"]);

  const allConv1 = findRow(arr(conv1, "total"), "ALL", null)!;
  check("[C] 応募: ALL に 2 件増える（退職前 7/20・退職後 8/05）", (allConv1.records as number) - (allConv0.records as number), 2);
  const pc = arr(conv1, "postExit").find((r) => r.ca === "9004");
  check("[C] 応募: postExit は退職後のエントリー 1 件（1 名なので内訳は伏せる）", [(pc?.total as J)?.records, (pc?.total as J)?.suppressed], [1, true]);

  const pipeAll1 = arr(pipe1, "rows").find((r) => r.ca === "ALL")!;
  check("[C] 進行中: ALL の選考中 +1", ((pipeAll1.inSelection as J).records as number) - ((pipeAll0.inSelection as J).records as number), 1);
  const pp = arr(pipe1, "postExit").find((r) => r.ca === "9004");
  check("[C] 進行中: postExit に 9004 の選考中 1・承諾済み未入社 1", [((pp?.inSelection as J) ?? {}).records, ((pp?.acceptedNotJoined as J) ?? {}).records, pp?.resignDate], [1, 1, "2026-07-31"]);
  checkTrue("[C] 進行中: rows に 9004 は無い", !arr(pipe1, "rows").some((r) => r.ca === "9004"));

  const fp = arr(fc1, "postExit").find((r) => r.ca === "9004");
  check("[C] 予測材料: postExit の承諾 1 件 600,000・退職後エントリー 1 件（選考中 1）", [(fp?.acceptedAfterExit as J)?.deals, (fp?.acceptedAfterExit as J)?.revenue, (fp?.entriesAfterExit as J)?.records, (fp?.entriesAfterExit as J)?.inProgress], [1, 600000, 1, 1]);
  const fAll = arr(fc1, "scopes").find((r) => r.ca === "ALL")!;
  checkTrue("[C] 予測材料: ALL の承諾件数に退職後の分が入る", ((fAll.revenue as J).deals as number) === (allRev1.deals as number), `${(fAll.revenue as J).deals} vs ${allRev1.deals}`);
  const fD = await buildForecastInputs({ baseFrom: "2026-05", baseTo: "2026-09", caId: "9004" });
  const fDScope = arr(fD, "scopes").find((r) => r.ca === "9004")!;
  check("[C] 予測材料 caId=9004: CA の scope は退職後の承諾を数えない・稼働人月は 5〜7 月の 3", [(fDScope.revenue as J).deals, fDScope.activeMonths], [0, 3]);

  // ---------------- [B] 稼働しない期間 ----------------
  const p1 = await saveInactivePeriod({ employeeId: caA.id, period: { startDate: "2026-08-16", endDate: null }, actorUserId: null });
  check("[B] 追加（終了未定）", [p1?.startDate, p1?.endDate], ["2026-08-16", null]);
  await expectOverlap("[B] 重複（9/1〜9/10）は拒否", saveInactivePeriod({ employeeId: caA.id, period: { startDate: "2026-09-01", endDate: "2026-09-10" }, actorUserId: null }));
  await expectOverlap("[B] 重複（前から食い込む 8/1〜8/16）は拒否", saveInactivePeriod({ employeeId: caA.id, period: { startDate: "2026-08-01", endDate: "2026-08-16" }, actorUserId: null }));
  const p1e = await saveInactivePeriod({ employeeId: caA.id, id: p1!.id, period: { startDate: "2026-08-16", endDate: "2026-08-31" }, actorUserId: null });
  check("[B] 編集（終了日を入れる）", [p1e?.startDate, p1e?.endDate], ["2026-08-16", "2026-08-31"]);
  const p2 = await saveInactivePeriod({ employeeId: caA.id, period: { startDate: "2026-09-21", endDate: null }, actorUserId: null });
  checkTrue("[B] 重ならない 2 件目は追加できる", !!p2);
  await expectOverlap("[B] 編集で 2 件目と重なる（8/16〜9/25）は拒否", saveInactivePeriod({ employeeId: caA.id, id: p1!.id, period: { startDate: "2026-08-16", endDate: "2026-09-25" }, actorUserId: null }));
  check("[B] 自分自身とは重複扱いしない（同じ値で再保存）", (await saveInactivePeriod({ employeeId: caA.id, id: p2!.id, period: { startDate: "2026-09-21", endDate: null }, actorUserId: null }))?.startDate, "2026-09-21");
  check("[B] 別の社員の id では更新できない", await saveInactivePeriod({ employeeId: caD.id, id: p2!.id, period: { startDate: "2027-01-01", endDate: null }, actorUserId: null }), null);
  const tmp = await saveInactivePeriod({ employeeId: caD.id, period: { startDate: "2027-03-01", endDate: "2027-03-31" }, actorUserId: null });
  await prisma.employeeInactivePeriod.delete({ where: { id: tmp!.id } });
  check("[B] 削除で消える（9004）", (await listInactivePeriods(caD.id)).length, 0);
  check("[B] 9001 の一覧", (await listInactivePeriods(caA.id)).map((p) => [p.startDate, p.endDate]), [["2026-08-16", "2026-08-31"], ["2026-09-21", null]]);
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'employee_inactive_periods' ORDER BY ordinal_position`);
  check("[B] 表に理由の列が無い", cols.map((c) => c.column_name), ["id", "employee_id", "start_date", "end_date", "created_by_user_id", "created_at", "updated_at"]);

  // 休業中（8/20）に記録された面談（今の担当 9001）
  const ivCand = await mkCand(caA.id);
  const scout = await emp("9101");
  await prisma.interviewRecord.create({
    data: { candidateId: ivCand.id, interviewDate: D("2026-08-20"), startTime: "10:00", endTime: "10:30", interviewTool: "Zoom", interviewerUserId: scout.id, interviewType: "新規面談", interviewCount: 1, resultFlag: "継続", createdByUserId: scout.id, status: "complete" } as never,
  });

  const roster = await buildCaRoster();
  const rA = (roster.cas as J[]).find((c) => c.employeeNumber === "9001")!;
  check("[B] roster: 期間（日付だけ）", rA.inactivePeriods, [{ startDate: "2026-08-16", endDate: "2026-08-31" }, { startDate: "2026-09-21", endDate: null }]);
  const av = (c: J, m: string) => (c.availabilityByMonth as J[]).find((x) => x.month === m)!;
  check("[B] roster: 9001 の 8 月は 15/31・9 月は 20/30・5 月は 1", [av(rA, "2026-08").activeDays, av(rA, "2026-08").fte, av(rA, "2026-09").activeDays, av(rA, "2026-09").fte, av(rA, "2026-05").fte], [15, 0.484, 20, 0.667, 1]);
  const rB = (roster.cas as J[]).find((c) => c.employeeNumber === "9002")!;
  check("[B] roster: 9002（7/15 入社）の 6 月は 0・7 月は 17/31", [av(rB, "2026-06").fte, av(rB, "2026-07").activeDays, av(rB, "2026-07").fte], [0, 17, 0.548]);
  const rD = (roster.cas as J[]).find((c) => c.employeeNumber === "9004")!;
  check("[B] roster: 9004（7/31 退職）の 8 月以降は 0", [av(rD, "2026-07").fte, av(rD, "2026-08").fte, av(rD, "2026-09").fte], [1, 0, 0]);
  checkTrue("[B] roster: 理由のキーを返さない", !JSON.stringify(roster).includes("reason"));
  checkTrue("[B] roster: 休業中の活動の警告（9001 面談 1 件以上）", (roster.warnings as string[]).some((w) => w.includes("稼働しない期間に記録された活動") && /9001（CA 甲）面談 [1-9]/.test(w)), JSON.stringify(roster.warnings));
  checkTrue("[B] roster: 退職済みの警告（postExit の案内）", (roster.warnings as string[]).some((w) => w.includes("9004") && w.includes("postExit")));
  check("[B] roster: counts", [(roster.counts as J).withInactivePeriods, (roster.counts as J).exited], [1, 1]);

  const conv2 = await buildSelectionConversion(range);
  const a08 = findRow(arr(conv2, "byMonth"), "9001", "2026-08")!;
  check("[B] CA の月の行に availability（9001 2026-08）", a08.availability, { calendarDays: 31, activeDays: 15, inactiveDays: 16, fte: 0.484 });
  check("[B] CA の期間合計の行に activeMonths（9001: 5〜7 月 3 + 0.484 + 0.667）", findRow(arr(conv2, "total"), "9001", null)!.activeMonths, 4.151);
  checkTrue("[B] ALL の行には availability を付けない", findRow(arr(conv2, "byMonth"), "ALL", "2026-08")!.availability === undefined);
  const coh = await buildCohortFunnel({ cohortFrom: "2026-05", cohortTo: "2026-09" });
  checkTrue("[B] cohort の CA 行にも availability", (findRow(arr(coh, "byMonth"), "9001", "2026-09")!.availability as J).fte === 0.667);
  checkTrue("[B] 定義に稼働人月・退職後の成果の説明", typeof (conv2.definitions as J).availability === "string" && typeof (conv2.definitions as J).postExit === "string");

  // ---------------- [D] 全社の値は変わらない ----------------
  // ck0 の後に足したのは 9004 の 7/20・8/05 エントリーと 8/10 承諾、9001 の 8/20 面談。これを除けば同じはず → 稼働しない期間だけを消し入れして比べる
  const ckWith = (await buildCompanyKpiResponse({ year: null, month: "2026-08" })).body as J;
  await prisma.employeeInactivePeriod.deleteMany({});
  const ckWithout = (await buildCompanyKpiResponse({ year: null, month: "2026-08" })).body as J;
  check("[D] company-kpi の全社（2026-08）は稼働しない期間の有無で変わらない", JSON.stringify((ckWith as J).month), JSON.stringify((ckWithout as J).month));
  checkTrue("[D] company-kpi の全社は退職後の承諾を含む（+600,000）", (((ckWith.month as J).invoiceRevenue as number) - ((ck0.month as J).invoiceRevenue as number)) === 600000);
  // 期間を戻しておく（[E] で使う）
  await saveInactivePeriod({ employeeId: caA.id, period: { startDate: "2026-08-16", endDate: "2026-08-31" }, actorUserId: null });

  // ---------------- [E] 画面の API ----------------
  const BASE = process.env.BASE_URL;
  if (BASE) {
    const login = async (email: string) => {
      const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "pass1234" }) });
      return /bs_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    };
    const adminCookie = await login("admin@example.test");
    const memberCookie = await login("member@example.test");
    const url = `${BASE}/api/admin/employees/${caA.id}/inactive-periods`;
    const call = async (cookie: string, method: string, body?: unknown) => {
      const res = await fetch(url, { method, headers: { "content-type": "application/json", cookie: `bs_session=${cookie}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json().catch(() => null)) as J | null };
    };
    const g = await call(adminCookie, "GET");
    check("[E] admin GET", [g.status, ((g.json?.periods as J[]) ?? []).length], [200, 1]);
    const post = await call(adminCookie, "POST", { startDate: "2026-10-01", endDate: "", reason: "産休" });
    check("[E] admin POST（終了未定）201・理由は返さない", [post.status, (post.json?.period as J)?.endDate, JSON.stringify(post.json).includes("産休")], [201, null, false]);
    const newId = (post.json?.period as J)?.id as string;
    check("[E] 重複 POST は 409", (await call(adminCookie, "POST", { startDate: "2026-12-01", endDate: null })).status, 409);
    check("[E] 入力誤り（終了<開始）は 400", (await call(adminCookie, "POST", { startDate: "2027-02-10", endDate: "2027-02-01" })).status, 400);
    const patch = await call(adminCookie, "PATCH", { id: newId, startDate: "2026-10-01", endDate: "2026-12-31" });
    check("[E] admin PATCH 200", [patch.status, (patch.json?.period as J)?.endDate], [200, "2026-12-31"]);
    check("[E] admin 以外の GET は 403", (await call(memberCookie, "GET")).status, 403);
    check("[E] admin 以外の POST は 403", (await call(memberCookie, "POST", { startDate: "2027-05-01" })).status, 403);
    check("[E] admin 以外の DELETE は 403", (await call(memberCookie, "DELETE", { id: newId })).status, 403);
    check("[E] 未ログインは 401/403/307", [401, 403, 307].includes((await call("", "GET")).status), true);
    check("[E] admin DELETE 200", (await call(adminCookie, "DELETE", { id: newId })).status, 200);
    check("[E] 削除後は 1 件", ((await call(adminCookie, "GET")).json?.periods as J[]).length, 1);
    const page = await fetch(`${BASE}/admin/users/${caA.userId}`, { headers: { cookie: `bs_session=${adminCookie}` } });
    const html = await page.text();
    check("[E] 社員詳細画面に「稼働しない期間」が出る", [page.status, html.includes("稼働しない期間")], [200, true]);
    checkTrue("[E] 社員詳細画面に理由の入力欄が無い", !html.includes("休業理由") && !html.includes("産休"));
  } else {
    console.log("SKIP [E] BASE_URL 未指定（画面の API は確かめていない）");
  }

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
