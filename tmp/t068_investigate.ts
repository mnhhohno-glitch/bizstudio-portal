import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
(async () => {
  // C-9: resultFlag value distribution
  const resultFlagDist = await prisma.$queryRawUnsafe<{ result_flag: string | null; count: bigint }[]>(
    `SELECT result_flag, COUNT(*)::bigint as count FROM interview_records GROUP BY result_flag ORDER BY count DESC NULLS LAST`
  );
  console.log("=== C-9 resultFlag distribution ===");
  console.log(JSON.stringify(resultFlagDist.map(r => ({ value: r.result_flag, count: Number(r.count) })), null, 2));

  // C-11: interviewType / interviewCount distribution
  const typeDist = await prisma.$queryRawUnsafe<{ interview_type: string | null; count: bigint }[]>(
    `SELECT interview_type, COUNT(*)::bigint as count FROM interview_records GROUP BY interview_type ORDER BY count DESC NULLS LAST`
  );
  console.log("\n=== C-11a interviewType distribution ===");
  console.log(JSON.stringify(typeDist.map(r => ({ value: r.interview_type, count: Number(r.count) })), null, 2));

  const countDist = await prisma.$queryRawUnsafe<{ interview_count: number | null; cnt: bigint }[]>(
    `SELECT interview_count, COUNT(*)::bigint as cnt FROM interview_records GROUP BY interview_count ORDER BY interview_count NULLS LAST`
  );
  console.log("\n=== C-11b interviewCount distribution ===");
  console.log(JSON.stringify(countDist.map(r => ({ value: r.interview_count, count: Number(r.cnt) })), null, 2));

  // C-11c interview_records status distribution (draft vs complete etc)
  const statusDist = await prisma.$queryRawUnsafe<{ status: string | null; cnt: bigint }[]>(
    `SELECT status, COUNT(*)::bigint as cnt FROM interview_records GROUP BY status ORDER BY cnt DESC NULLS LAST`
  );
  console.log("\n=== C-11c interview status distribution ===");
  console.log(JSON.stringify(statusDist.map(r => ({ value: r.status, count: Number(r.cnt) })), null, 2));

  // C-12: today JST 初回面談予定数 / 実施数
  const jstToday = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const startUtc = new Date(`${jstToday}T00:00:00+09:00`);
  const endUtc = new Date(`${jstToday}T23:59:59.999+09:00`);
  const todayFirst = await prisma.interviewRecord.findMany({
    where: { interviewDate: { gte: startUtc, lte: endUtc }, interviewCount: 1 },
    select: { id: true, status: true, resultFlag: true, interviewType: true, isLatest: true },
  });
  console.log("\n=== C-12 today JST=" + jstToday + " 初回面談 ===");
  console.log("scheduled:", todayFirst.length, "by status:", JSON.stringify(
    Object.entries(todayFirst.reduce((m: Record<string, number>, r) => { m[r.status || "null"] = (m[r.status || "null"] || 0) + 1; return m; }, {}))
  ));
  console.log("by resultFlag:", JSON.stringify(
    Object.entries(todayFirst.reduce((m: Record<string, number>, r) => { const k = r.resultFlag || "null"; m[k] = (m[k] || 0) + 1; return m; }, {}))
  ));

  // D-13: CandidateFile.category=BOOKMARK with createdAt today/this month
  const todayBookmarks = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", createdAt: { gte: startUtc, lte: endUtc }, archivedAt: null },
  });
  const monthStart = new Date(`${jstToday.slice(0,7)}-01T00:00:00+09:00`);
  const monthBookmarks = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", createdAt: { gte: monthStart }, archivedAt: null },
  });
  console.log("\n=== D-13 BOOKMARK count ===");
  console.log("today:", todayBookmarks, "this_month:", monthBookmarks);

  // D-14: lastExportedAt today (introduction = exported to job-tool)
  const todayExported = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", lastExportedAt: { gte: startUtc, lte: endUtc } },
  });
  const monthExported = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", lastExportedAt: { gte: monthStart } },
  });
  console.log("\n=== D-14 lastExportedAt count ===");
  console.log("today:", todayExported, "this_month:", monthExported);

  // D-15: JobEntry created today / this month (entryDate / createdAt 両方)
  const todayJEByCreated = await prisma.jobEntry.count({
    where: { createdAt: { gte: startUtc, lte: endUtc } },
  });
  const todayJEByEntryDate = await prisma.jobEntry.count({
    where: { entryDate: { gte: startUtc, lte: endUtc } },
  });
  console.log("\n=== D-15 JobEntry count today ===");
  console.log("by createdAt:", todayJEByCreated, "by entryDate:", todayJEByEntryDate);

  // D-16: entryFlag distribution + documentPassDate / offerDate / acceptanceDate this month
  const entryFlagDist = await prisma.$queryRawUnsafe<{ entry_flag: string | null; cnt: bigint }[]>(
    `SELECT entry_flag, COUNT(*)::bigint as cnt FROM job_entries WHERE is_active = true GROUP BY entry_flag ORDER BY cnt DESC NULLS LAST`
  );
  console.log("\n=== D-16a entryFlag distribution (isActive=true) ===");
  console.log(JSON.stringify(entryFlagDist.map(r => ({ value: r.entry_flag, count: Number(r.cnt) })), null, 2));

  const monthDocPass = await prisma.jobEntry.count({ where: { documentPassDate: { gte: monthStart } } });
  const monthOffer = await prisma.jobEntry.count({ where: { offerDate: { gte: monthStart } } });
  const monthAccept = await prisma.jobEntry.count({ where: { acceptanceDate: { gte: monthStart } } });
  const monthJoin = await prisma.jobEntry.count({ where: { joinDate: { gte: monthStart } } });
  console.log("\n=== D-16b this month milestone counts ===");
  console.log(JSON.stringify({ docPass: monthDocPass, offer: monthOffer, accept: monthAccept, join: monthJoin }, null, 2));

  // E-18: User role distribution
  const userRoles = await prisma.$queryRawUnsafe<{ role: string; cnt: bigint }[]>(
    `SELECT role, COUNT(*)::bigint as cnt FROM users GROUP BY role ORDER BY cnt DESC`
  );
  console.log("\n=== E-18 User role distribution ===");
  console.log(JSON.stringify(userRoles.map(r => ({ role: r.role, count: Number(r.cnt) })), null, 2));

  // E-19: Employee salaryRange distribution (近似的に職種を表しうるか?)
  const empSalary = await prisma.$queryRawUnsafe<{ salary_range: string; cnt: bigint }[]>(
    `SELECT salary_range, COUNT(*)::bigint as cnt FROM employees WHERE status='active' GROUP BY salary_range`
  );
  console.log("\n=== E-19 Employee salary_range distribution (active) ===");
  console.log(JSON.stringify(empSalary.map(r => ({ value: r.salary_range, count: Number(r.cnt) })), null, 2));

  // careerAdvisorId / interviewerUserId 紐付け確認
  const sampleEntry = await prisma.jobEntry.findFirst({
    where: { careerAdvisorId: { not: null } },
    select: { id: true, careerAdvisorId: true, candidateId: true },
  });
  console.log("\n=== E-19 sample JobEntry.careerAdvisorId binding ===");
  console.log(JSON.stringify(sampleEntry, null, 2));

  await prisma.$disconnect();
  await pool.end();
})();
