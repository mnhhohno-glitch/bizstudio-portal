/**
 * T-XXX step5B: 変更履歴（選考ステータス・支援状況・希望条件）と日次スナップショットの記録を、ローカル dev サーバー経由で検証する。
 * ローカル DB 専用。前提と環境変数は scripts/test-session-auth-t-xxx-step5.ts と同じ。
 *
 *   DATABASE_URL=... BASE_URL=http://localhost:3100 INTERNAL_API_KEY=... npx tsx scripts/test-histories-t-xxx-step5.ts
 *
 * 確かめること（§D-B）: 各経路で変更時のみ 1 行増える／変わらない保存では増えない／スナップショットが同日 2 回で重複しない。
 */
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}
import { prisma } from "@/lib/prisma";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}

let cookie = "";
const h = () => ({ "content-type": "application/json", cookie: `bs_session=${cookie}` });
const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: h(), body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json: json as Record<string, unknown> | null };
};

const entryHist = (jobEntryId: string) => prisma.jobEntryStatusHistory.findMany({ where: { jobEntryId }, orderBy: { changedAt: "asc" } });
const supportHist = (candidateId: string) => prisma.candidateSupportStatusHistory.findMany({ where: { candidateId }, orderBy: { changedAt: "asc" } });
const prefHist = (candidateId: string) => prisma.candidatePreferenceHistory.findMany({ where: { candidateId }, orderBy: { changedAt: "asc" } });

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: "pass1234" }) });
  cookie = /bs_session=([^;]*)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
  check("[0] ログイン", login.status, 200);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.test" } });

  // 対象の求職者（架空・支援中）
  const cand = await prisma.candidate.findFirstOrThrow({ where: { supportStatus: "ACTIVE", candidateNumber: "9000001" } });
  await prisma.jobEntryStatusHistory.deleteMany({ where: { candidateId: cand.id } });
  await prisma.candidateSupportStatusHistory.deleteMany({ where: { candidateId: cand.id } });
  await prisma.candidatePreferenceHistory.deleteMany({ where: { candidateId: cand.id } });

  // --- 選考ステータス ---
  const created = await api("POST", "/api/entries", { candidateId: cand.id, companyName: "履歴テスト株式会社" });
  check("[1] entry_create 201", created.status, 201);
  const entryId = ((created.json?.entry as Record<string, unknown>)?.id as string) ?? "";
  let hs = await entryHist(entryId);
  check("[1] 作成で 1 行（event=create・from NULL・to エントリー/検討中）", [hs.length, hs[0]?.event, hs[0]?.fromEntryFlag, hs[0]?.toEntryFlag, hs[0]?.toEntryFlagDetail, hs[0]?.route, hs[0]?.changedByUserId === admin.id], [1, "create", null, "エントリー", "検討中", "entry_create", true]);

  check("[1] flags 書類選考へ 200", (await api("PATCH", `/api/entries/${entryId}/flags`, { entryFlag: "書類選考", entryFlagDetail: "選考中" })).status, 200);
  hs = await entryHist(entryId);
  check("[1] フラグ変更で +1（entry_flags・changedFields）", [hs.length, hs[1]?.route, hs[1]?.fromEntryFlag, hs[1]?.toEntryFlag, hs[1]?.changedFields], [2, "entry_flags", "エントリー", "書類選考", ["entryFlag", "entryFlagDetail"]]);

  check("[1] 同じフラグで再保存 200", (await api("PATCH", `/api/entries/${entryId}/flags`, { entryFlag: "書類選考", entryFlagDetail: "選考中" })).status, 200);
  check("[1] 変わらない保存では増えない", (await entryHist(entryId)).length, 2);

  check("[1] メモだけの PATCH 200", (await api("PATCH", `/api/entries/${entryId}`, { memo: "履歴テスト" })).status, 200);
  check("[1] ステータス以外の編集では増えない", (await entryHist(entryId)).length, 2);

  check("[1] PATCH で選考落ち 200", (await api("PATCH", `/api/entries/${entryId}`, { entryFlagDetail: "選考落ち", personFlag: "見送り通知送信済" })).status, 200);
  hs = await entryHist(entryId);
  check("[1] 見送りで +1（entry_update・isActive false へ）", [hs.length, hs[2]?.route, hs[2]?.toEntryFlagDetail, hs[2]?.toPersonFlag, hs[2]?.fromIsActive, hs[2]?.toIsActive], [3, "entry_update", "選考落ち", "見送り通知送信済", true, false]);

  check("[1] bulk-flags 再開（選考中）200", (await api("PATCH", "/api/entries/bulk-flags", { entryIds: [entryId], entryFlagDetail: "選考中", personFlag: "選考通過連絡前" })).status, 200);
  hs = await entryHist(entryId);
  check("[1] 再開で +1（bulk_flags・isActive true へ）", [hs.length, hs[3]?.route, hs[3]?.toIsActive], [4, "bulk_flags", true]);

  check("[1] auto-progress 200", (await api("POST", "/api/entries/auto-progress", { updates: [{ id: entryId, entryFlagDetail: "選考中", companyFlag: "辞退報告前" }] })).status, 200);
  hs = await entryHist(entryId);
  check("[1] auto_progress で +1（companyFlag）", [hs.length, hs[4]?.route, hs[4]?.changedFields], [5, "auto_progress", ["companyFlag"]]);

  check("[1] bulk-archive 200", (await api("POST", "/api/entries/bulk-archive", { entryIds: [entryId] })).status, 200);
  hs = await entryHist(entryId);
  check("[1] アーカイブで +1（archived）", [hs.length, hs[5]?.route, hs[5]?.fromArchived, hs[5]?.toArchived], [6, "bulk_archive", false, true]);

  check("[1] DELETE 200", (await api("DELETE", `/api/entries/${entryId}`)).status, 200);
  hs = await entryHist(entryId);
  check("[1] 削除で +1（event=delete・行は残る）", [hs.length, hs[6]?.event, hs[6]?.route, hs[6]?.toEntryFlag], [7, "delete", "entry_delete", null]);

  // 一括作成（求人マイページ経由）
  const bulk = await api("POST", `/api/candidates/${cand.id}/entries`, { entryDate: "2026-10-01", entries: [{ externalJobId: 777001, companyName: "一括テスト1", jobTitle: "営業", introducedAt: "2026-10-01" }, { externalJobId: 777002, companyName: "一括テスト2", jobTitle: "事務", introducedAt: "2026-10-01" }] });
  check("[2] 一括作成 2xx", bulk.status >= 200 && bulk.status < 300, true);
  const bulkRows = await prisma.jobEntryStatusHistory.count({ where: { candidateId: cand.id, route: "candidate_entries_create", event: "create" } });
  check("[2] 一括作成で 2 行（candidate_entries_create）", bulkRows, 2);
  const bulkIds = (await prisma.jobEntry.findMany({ where: { candidateId: cand.id, externalJobId: { in: [777001, 777002] } }, select: { id: true } })).map((e) => e.id);
  check("[2] revert-bulk 200", (await api("POST", `/api/candidates/${cand.id}/entries/revert-bulk`, { entryIds: bulkIds })).status, 200);
  check("[2] 戻すと delete 2 行（revert_bulk）", await prisma.jobEntryStatusHistory.count({ where: { candidateId: cand.id, route: "revert_bulk", event: "delete" } }), 2);

  // --- 支援状況 ---
  const before = await supportHist(cand.id);
  check("[3] 支援状況の履歴（エントリー操作による中項目の自動再計算分）", before.every((r) => r.route === "sub_status_auto"), true);
  check("[3] WAITING へ 200", (await api("PATCH", `/api/candidates/${cand.id}/update`, { supportStatus: "WAITING" })).status, 200);
  let ss = await supportHist(cand.id);
  const last = ss[ss.length - 1];
  check("[3] 大項目の変更で +1（candidate_update ACTIVE→WAITING）", [ss.length - before.length, last?.route, last?.fromSupportStatus, last?.toSupportStatus, last?.toSupportSubStatus], [1, "candidate_update", "ACTIVE", "WAITING", "待機"]);
  check("[3] 同じ値で再保存 200", (await api("PATCH", `/api/candidates/${cand.id}/update`, { supportStatus: "WAITING" })).status, 200);
  check("[3] 変わらない保存では増えない", (await supportHist(cand.id)).length, ss.length);
  check("[3] 一括 change_status ENDED 200", (await api("POST", "/api/master/candidates/bulk-update", { action: "change_status", candidateIds: [cand.id], payload: { newStatus: "ENDED", endReasons: { [cand.id]: "本人希望" } } })).status, 200);
  ss = await supportHist(cand.id);
  check("[3] 一括変更で +1（bulk_change_status・終了理由）", [ss[ss.length - 1]?.route, ss[ss.length - 1]?.toSupportStatus, ss[ss.length - 1]?.toSupportEndReason], ["bulk_change_status", "ENDED", "本人希望"]);
  check("[3] ACTIVE へ戻す 200", (await api("PATCH", `/api/candidates/${cand.id}/update`, { supportStatus: "ACTIVE" })).status, 200);
  ss = await supportHist(cand.id);
  check("[3] 再開で +1（終了理由が消える）", [ss[ss.length - 1]?.fromSupportStatus, ss[ss.length - 1]?.toSupportStatus, ss[ss.length - 1]?.fromSupportEndReason, ss[ss.length - 1]?.toSupportEndReason], ["ENDED", "ACTIVE", "本人希望", null]);

  // 面談結果からの自動反映
  const iv = await prisma.interviewRecord.findFirstOrThrow({ where: { candidateId: cand.id }, orderBy: { interviewDate: "desc" } });
  check("[3] 面談結果を辞退に 200", (await api("PATCH", `/api/interviews/${iv.id}`, { resultFlag: "連絡あり辞退" })).status, 200);
  ss = await supportHist(cand.id);
  check("[3] 面談結果で +1（interview_result ACTIVE→ENDED・変更者あり）", [ss[ss.length - 1]?.route, ss[ss.length - 1]?.toSupportStatus, ss[ss.length - 1]?.changedByUserId === admin.id], ["interview_result", "ENDED", true]);
  const n3 = ss.length;
  check("[3] 同じ面談結果で再保存 200", (await api("PATCH", `/api/interviews/${iv.id}`, { resultFlag: "連絡あり辞退" })).status, 200);
  check("[3] 変わらなければ増えない", (await supportHist(cand.id)).length, n3);
  await api("PATCH", `/api/interviews/${iv.id}`, { resultFlag: "継続" });

  // --- 希望条件 ---
  const p0 = (await prefHist(cand.id)).length;
  check("[4] 求職者の希望職種を変更 200", (await api("PATCH", `/api/candidates/${cand.id}/update`, { desiredJobType1: "販売", desiredSalaryMin: 350 })).status, 200);
  let ps = await prefHist(cand.id);
  check("[4] candidate 側で 2 行（desiredJobType1・desiredSalaryMin）", [ps.length - p0, ps.slice(-2).map((r) => r.field).sort(), ps[ps.length - 1]?.source, ps[ps.length - 1]?.route], [2, ["desiredJobType1", "desiredSalaryMin"], "candidate", "candidate_update"]);
  check("[4] 同じ値で再保存 200", (await api("PATCH", `/api/candidates/${cand.id}/update`, { desiredJobType1: "販売", desiredSalaryMin: 350 })).status, 200);
  check("[4] 変わらない保存では増えない", (await prefHist(cand.id)).length, ps.length);

  const p1 = ps.length;
  check("[4] 面談詳細の希望年収を変更（PATCH）200", (await api("PATCH", `/api/interviews/${iv.id}`, { detail: { desiredSalaryMin: 420, desiredJobTypes: ["営業", "企画"], freeMemo: "文章欄は対象外" } })).status, 200);
  ps = await prefHist(cand.id);
  check("[4] interview_detail 側で 2 行（文章欄は記録しない）", [ps.length - p1, ps.slice(-2).map((r) => r.field).sort(), ps[ps.length - 1]?.source, ps[ps.length - 1]?.interviewRecordId], [2, ["desiredJobTypes", "desiredSalaryMin"], "interview_detail", iv.id]);
  const jsonRow = ps.find((r) => r.field === "desiredJobTypes" && r.interviewRecordId === iv.id);
  check("[4] JSON は正規化した文字列", jsonRow?.toValue, JSON.stringify(["営業", "企画"]));
  const p2 = ps.length;
  check("[4] 自動保存で同じ値 200", (await api("PATCH", `/api/interviews/${iv.id}/autosave`, { detail: { desiredSalaryMin: 420, desiredJobTypes: ["営業", "企画"] } })).status, 200);
  check("[4] 同じ値の自動保存では増えない", (await prefHist(cand.id)).length, p2);
  check("[4] 自動保存で変更 200", (await api("PATCH", `/api/interviews/${iv.id}/autosave`, { detail: { desiredSalaryMin: 430 } })).status, 200);
  ps = await prefHist(cand.id);
  check("[4] 自動保存の変更で +1（interview_autosave 420→430）", [ps.length - p2, ps[ps.length - 1]?.route, ps[ps.length - 1]?.fromValue, ps[ps.length - 1]?.toValue], [1, "interview_autosave", "420", "430"]);

  // 面談の新規作成: 前回の値を写しただけなら増えない、変えた項目だけ増える
  const emp = await prisma.employee.findFirstOrThrow({ where: { userId: admin.id } });
  const p3 = ps.length;
  const prevDetail = await prisma.interviewDetail.findUniqueOrThrow({ where: { interviewRecordId: iv.id } });
  const copy = { desiredSalaryMin: prevDetail.desiredSalaryMin, desiredJobTypes: prevDetail.desiredJobTypes, desiredJobType1: prevDetail.desiredJobType1, currentSalary: prevDetail.currentSalary };
  const c1 = await api("POST", "/api/interviews", { candidateId: cand.id, interviewDate: "2026-10-02", startTime: "10:00", endTime: "10:30", interviewTool: "Zoom", interviewerUserId: emp.id, interviewType: "既存面談", detail: copy });
  check("[4] 面談の新規作成（前回の写し）200", c1.status, 200);
  check("[4] 写しだけでは増えない", (await prefHist(cand.id)).length, p3);
  const c2 = await api("POST", "/api/interviews", { candidateId: cand.id, interviewDate: "2026-10-02", startTime: "11:00", endTime: "11:30", interviewTool: "Zoom", interviewerUserId: emp.id, interviewType: "既存面談", detail: { ...copy, jobChangeTimeline: "半年以内" } });
  check("[4] 面談の新規作成（1 項目変更）200", c2.status, 200);
  ps = await prefHist(cand.id);
  check("[4] 変えた 1 項目だけ +1（interview_create）", [ps.length - p3, ps[ps.length - 1]?.field, ps[ps.length - 1]?.route], [1, "jobChangeTimeline", "interview_create"]);

  // --- 日次スナップショット ---
  await prisma.caPipelineDailySnapshot.deleteMany({});
  const key = process.env.INTERNAL_API_KEY ?? "";
  const s1 = await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=false`, { method: "POST", headers: { "x-api-key": key } }).then((r) => r.json());
  const s2 = await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=false`, { method: "POST", headers: { "x-api-key": key } }).then((r) => r.json());
  check("[5] 1 回目は created", s1.created > 0 && s1.updated === 0, true);
  check("[5] 2 回目は updated だけ（重複なし）", s2.created === 0 && s2.updated === s1.created, true);
  check("[5] 行数 = 1 日分", await prisma.caPipelineDailySnapshot.count(), s1.rows);
  const dry = await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=true`, { method: "POST", headers: { "x-api-key": key } }).then((r) => r.json());
  check("[5] dry_run は保存しない", dry.created === 0 && dry.updated === 0 && Array.isArray(dry.preview), true);
  check("[5] 応答に個人の行が無い", JSON.stringify(dry).includes("9000001") || JSON.stringify(dry).includes("架空"), false);

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
