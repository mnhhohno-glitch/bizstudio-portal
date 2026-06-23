import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const ids = ["cmpl8242q000n1dpl4nl6n4iz", "cmomk3r5j001y1dlmvdd9vurv"];
  for (const id of ids) {
    const c = await prisma.candidate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        candidateNumber: true,
        supportStatus: true,
        supportSubStatus: true,
        supportSubStatusManual: true,
        employeeId: true,
        recruiterName: true,
        applicationRoute: true,
        mediaSource: true,
      },
    });
    console.log(JSON.stringify(c, null, 2));
  }

  // Check jobs API data (kyuujinPDF job count)
  for (const id of ids) {
    const c = await prisma.candidate.findUnique({
      where: { id },
      select: { candidateNumber: true, name: true },
    });
    console.log(`\n--- Jobs for ${c?.name} (${c?.candidateNumber}) ---`);

    // Count CandidateFile(BOOKMARK) to check bookmarks
    const bmCount = await prisma.candidateFile.count({
      where: { candidateId: id, category: "BOOKMARK", archivedAt: null },
    });
    console.log(`Bookmarks: ${bmCount}`);

    // Count job entries
    const entryCount = await prisma.jobEntry.count({
      where: { candidateId: id },
    });
    console.log(`JobEntries: ${entryCount}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
