import "dotenv/config";

async function main() {
  const url = process.env.KYUUJIN_PDF_TOOL_URL || "https://web-production-95808.up.railway.app";

  // Fetch jobs (same as Portal's GET /api/candidates/[id]/jobs does)
  const res = await fetch(url + "/api/projects/by-job-seeker-id/5004282/jobs");
  const data = await res.json();
  const allJobs = data.jobs || [];

  // Portal's hidden IDs
  const hiddenIds = new Set([3667, 3935, 3934, 3933, 3940, 3941, 3942, 3943, 3666, 3668, 3664, 3665, 3672, 3673]);

  const visibleJobs = allJobs.filter((j: any) => !hiddenIds.has(j.id));
  console.log("=== Portal表示（hidden除外後） ===");
  console.log("kyuujinPDF全件: " + allJobs.length);
  console.log("Portal hidden: " + hiddenIds.size);
  console.log("Portal表示件数: " + visibleJobs.length);
  console.log("");

  console.log("--- Portal表示の15件 ---");
  for (const j of visibleJobs) {
    console.log("  id=" + j.id + " company=" + (j.company_name || "").substring(0, 35));
  }

  console.log("");
  console.log("--- hidden扱いの14件 ---");
  const hiddenJobs = allJobs.filter((j: any) => hiddenIds.has(j.id));
  for (const j of hiddenJobs) {
    console.log("  id=" + j.id + " company=" + (j.company_name || "").substring(0, 35));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
