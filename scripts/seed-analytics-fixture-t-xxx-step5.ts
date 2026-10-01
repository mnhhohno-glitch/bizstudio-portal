/**
 * T-XXX step5: ローカル検証DB用の架空データ（分析ツール・履歴記録・セッションのテスト用）。
 *
 * **ローカル（localhost / 127.0.0.1）の DATABASE_URL でしか動かない**（本番・staging に流さないためのガード）。
 *
 *   DATABASE_URL=postgresql://postgres:t5@localhost:55432/t5 npx tsx scripts/seed-analytics-fixture-t-xxx-step5.ts
 *
 * 作るもの（すべて架空）:
 *   - User: admin（admin@example.test / pass1234）、member、disabled
 *   - Employee（CA）: 9001 全期間在籍 / 9002 2026-07-15 入社（5・6月は在籍前）/ 9003 入社日未登録 / 9004 退職済み（status=disabled）、9101 スカウト担当（CA 以外）
 *   - 求職者 ~40 名、初回面談 2026-05〜09、面談詳細（切り口用）、ブックマーク（提案）、エントリー（複数応募・承諾・承諾後辞退・選考中・月またぎ）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) });

const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`); // アプリの保存規約（JST 暦日 = UTC 0:00）

async function main() {
  // 掃除（履歴テーブルも含めて空にする）
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE job_entry_status_histories, candidate_support_status_histories, candidate_preference_histories, ca_pipeline_daily_snapshots, candidate_ca_assignment_histories, user_sessions RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE interview_details, interview_ratings, interview_records, candidate_files, job_entries, candidates, employees, users RESTART IDENTITY CASCADE`);

  const pw = await bcrypt.hash("pass1234", 10);
  const admin = await prisma.user.create({ data: { name: "管理者テスト", email: "admin@example.test", passwordHash: pw, role: "admin", status: "active" } });
  const member = await prisma.user.create({ data: { name: "一般テスト", email: "member@example.test", passwordHash: pw, role: "member", status: "active" } });
  await prisma.user.create({ data: { name: "無効テスト", email: "disabled@example.test", passwordHash: pw, role: "member", status: "disabled" } });
  // 監査ログ（src/lib/audit.ts）がログイン失敗時に使う匿名ユーザー（本番にある）
  await prisma.user.create({ data: { name: "anonymous", email: "anonymous@local", passwordHash: pw, role: "member", status: "disabled" } });

  const mkEmp = (employeeNumber: string, name: string, extra: Record<string, unknown>) =>
    prisma.employee.create({ data: { employeeNumber, name, ...extra } as never });
  const caA = await mkEmp("9001", "CA 甲", { jobCategory: "CA", hireDate: D("2024-06-01"), userId: admin.id });
  const caB = await mkEmp("9002", "CA 乙", { jobCategory: "CA", hireDate: D("2026-07-15"), userId: member.id });
  const caC = await mkEmp("9003", "CA 丙", { jobCategory: "CA" });
  const caD = await mkEmp("9004", "CA 丁", { jobCategory: "CA", hireDate: D("2025-01-01"), resignDate: D("2026-07-31"), status: "disabled" });
  const scout = await mkEmp("9101", "スカウト 戊", { jobCategory: null });

  let seq = 0;
  const cand = async (employeeId: string | null, supportStatus = "ACTIVE") => {
    seq += 1;
    return prisma.candidate.create({
      data: { candidateNumber: String(9000000 + seq), name: `架空 ${seq}`, employeeId, supportStatus, supportSubStatus: supportStatus === "ACTIVE" ? "求人紹介前" : null },
    });
  };
  const iv = (candidateId: string, ymd: string, resultFlag: string | null, count: number, detail?: Record<string, unknown>) =>
    prisma.interviewRecord.create({
      data: {
        candidateId, interviewDate: D(ymd), startTime: "10:00", endTime: "10:30", interviewTool: "Zoom", interviewerUserId: scout.id,
        interviewType: "新規面談", interviewCount: count, resultFlag, createdByUserId: scout.id, status: "complete",
        detail: detail ? { create: detail as never } : undefined,
      },
    });
  const bm = (candidateId: string, introducedYmd: string) =>
    prisma.candidateFile.create({
      data: { candidateId, category: "BOOKMARK", fileName: "架空株式会社_求人.pdf", fileSize: 1, mimeType: "application/pdf", uploadedByUserId: admin.id, origin: "ca", introducedAt: D(introducedYmd), createdAt: D(introducedYmd) },
    });
  const entry = (candidateId: string, entryYmd: string, extra: Record<string, unknown>) =>
    prisma.jobEntry.create({
      data: {
        candidateId, externalJobId: 0, companyName: "架空株式会社", jobTitle: "営業", entryDate: D(entryYmd), introducedAt: D(entryYmd),
        entryFlag: "書類選考", entryFlagDetail: "選考中", ...extra,
      } as never,
    });

  // 各 CA × 月のコホート。CA 甲: 5〜9 月に毎月 6 名（伏せられない）。
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const detailFor = (i: number) => ({
    desiredJobType1: i % 2 === 0 ? "営業" : "事務",
    jobTypeFlag: i % 3 === 0 ? "販売" : "営業",
    currentSalary: 250 + i * 40,
    desiredSalaryMin: 300 + i * 30,
    jobChangeTimeline: i % 2 === 0 ? "すぐにでも" : "3カ月以内",
    educationFlag: i % 3 === 0 ? "大学卒" : i % 3 === 1 ? "高校卒" : "短大・専門卒",
    desiredPrefecture: "東京都",
    desiredEmploymentType: "正社員",
  });
  for (const [mi, m] of months.entries()) {
    for (let i = 0; i < 6; i++) {
      const c = await cand(caA.id, i === 5 ? "ENDED" : "ACTIVE");
      const day = String(3 + i * 4).padStart(2, "0");
      await iv(c.id, `${m}-${day}`, "求人紹介 送付前", 1, detailFor(i));
      await bm(c.id, `${m}-${String(5 + i * 4).padStart(2, "0")}`);
      // i=0,1,2 はエントリー、i=0 は承諾、i=1 は選考中、i=2 は選考落ち。3 は提案のみ、4 は複数応募（3 社）、5 は支援終了
      if (i <= 2 || i === 4) {
        const eYmd = `${m}-${String(10 + i * 3).padStart(2, "0")}`;
        if (i === 0) {
          const acc = mi <= 3 ? `${months[Math.min(mi + 1, 4)]}-15` : null; // 9 月コホートはまだ承諾なし
          await entry(c.id, eYmd, {
            documentSubmitDate: D(eYmd), documentPassDate: D(`${m}-20`), firstInterviewDate: D(`${m}-25`), offerDate: acc ? D(`${months[Math.min(mi + 1, 4)]}-10`) : null,
            acceptanceDate: acc ? D(acc) : null, entryFlag: acc ? "内定" : "面接", entryFlagDetail: acc ? "承諾" : "一次面接選考中",
            revenue: acc ? 800000 + mi * 50000 : null, jobDbCost: acc ? 50000 : null, cost: acc ? 30000 : null, feeType: acc ? "FIXED" : null,
            joinDate: acc ? D(`${months[Math.min(mi + 1, 4)]}-28`) : null,
          });
        } else if (i === 1) {
          await entry(c.id, eYmd, { documentSubmitDate: D(eYmd), entryFlag: "書類選考", entryFlagDetail: "選考中" });
        } else if (i === 2) {
          await entry(c.id, eYmd, { documentSubmitDate: D(eYmd), entryFlag: "書類選考", entryFlagDetail: "選考落ち", isActive: false });
        } else {
          for (let k = 0; k < 3; k++) await entry(c.id, eYmd, { entryFlag: k === 0 ? "面接" : "書類選考", entryFlagDetail: k === 0 ? "一次面接選考中" : "選考中", documentPassDate: k === 0 ? D(`${m}-22`) : null, firstInterviewDate: k === 0 ? D(`${m}-27`) : null });
        }
      }
    }
  }
  // CA 乙（7/15 入社）: 5・6 月にも担当として初回面談が付いている（在籍前＝CA 別の行から除外されるべき）、7〜9 月は 5 名ずつ
  for (const m of months) {
    const n = m < "2026-07" ? 2 : 5;
    for (let i = 0; i < n; i++) {
      const c = await cand(caB.id);
      await iv(c.id, `${m}-${String(4 + i * 5).padStart(2, "0")}`, "求人紹介 送付済", 1, detailFor(i + 1));
      if (i < 2) await entry(c.id, `${m}-${String(12 + i * 2).padStart(2, "0")}`, {});
    }
  }
  // CA 丙（入社日未登録）: 3 名だけ → 伏せられる
  for (let i = 0; i < 3; i++) {
    const c = await cand(caC.id);
    await iv(c.id, `2026-08-${String(6 + i).padStart(2, "0")}`, "求人紹介 送付前", 1, detailFor(i));
  }
  // CA 丁（退職済み）: 6 月に 5 名
  for (let i = 0; i < 5; i++) {
    const c = await cand(caD.id);
    await iv(c.id, `2026-06-${String(6 + i).padStart(2, "0")}`, "継続", 1);
  }
  // 担当なし・スカウト担当: ALL にだけ入る
  const noCa = await cand(null);
  await iv(noCa.id, "2026-08-11", "継続", 1);
  const scoutCand = await cand(scout.id);
  await iv(scoutCand.id, "2026-08-12", "継続", 1);

  // ケース: 初回面談の再設定（辞退 → 翌月に実施）2 名。初回は実施分（6 月・7 月）になるべき
  const r1 = await cand(caA.id);
  await iv(r1.id, "2026-05-20", "連絡なし辞退", 1);
  await iv(r1.id, "2026-06-02", "求人紹介 送付前", 2, detailFor(2));
  const r2 = await cand(caA.id);
  await iv(r2.id, "2026-06-28", "日程再調整", 1);
  await iv(r2.id, "2026-07-01", "継続", 2, detailFor(3));

  // ケース: 月またぎ（初回面談 5/31、エントリー 6/1）→ コホートは 5 月、応募月コホートは 6 月
  const s1 = await cand(caA.id);
  await iv(s1.id, "2026-05-31", "求人紹介 送付前", 1, detailFor(4));
  await entry(s1.id, "2026-06-01", { documentSubmitDate: D("2026-06-01") });

  // ケース: 承諾後辞退（8 月承諾・売上 700,000・本人辞退で無効）
  const d1 = await cand(caA.id, "ENDED");
  await iv(d1.id, "2026-07-08", "求人紹介 送付前", 1, detailFor(5));
  await entry(d1.id, "2026-07-20", {
    documentPassDate: D("2026-07-25"), firstInterviewDate: D("2026-08-01"), offerDate: D("2026-08-10"), acceptanceDate: D("2026-08-14"),
    entryFlag: "内定", entryFlagDetail: "本人辞退_他社決", isActive: false, revenue: 700000, jobDbCost: 20000, cost: 0, feeType: "FIXED", joinDate: D("2026-09-01"),
  });

  // ケース: 担当変更後（今は CA 乙）。初回面談は 8 月。
  const mv = await cand(caB.id);
  await iv(mv.id, "2026-08-20", "継続", 1, detailFor(0));
  await prisma.candidateCaAssignmentHistory.create({ data: { candidateId: mv.id, fromEmployeeId: caA.id, toEmployeeId: caB.id, route: "candidate_update", changedAt: D("2026-09-15") } });

  // 未来の面談予約（初回 2 件・継続 1 件）
  const f1 = await cand(caA.id, "BEFORE");
  await iv(f1.id, "2026-10-05", null, 1);
  const f2 = await cand(caB.id, "BEFORE");
  await iv(f2.id, "2026-10-06", "面談前", 1);
  await iv(s1.id, "2026-10-07", null, 2);

  const counts = {
    users: await prisma.user.count(), employees: await prisma.employee.count(), candidates: await prisma.candidate.count(),
    interviews: await prisma.interviewRecord.count(), details: await prisma.interviewDetail.count(), bookmarks: await prisma.candidateFile.count(), entries: await prisma.jobEntry.count(),
  };
  console.log("seeded", counts);
}

main().finally(() => prisma.$disconnect());
