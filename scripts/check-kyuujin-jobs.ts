import "dotenv/config";

async function main() {
  const url = process.env.KYUUJIN_PDF_TOOL_URL || "https://web-production-95808.up.railway.app";
  console.log("API URL: " + url);

  const res = await fetch(url + "/api/projects/by-job-seeker-id/5004282/jobs");
  if (!res.ok) {
    console.log("Error: " + res.status + " " + res.statusText);
    const text = await res.text();
    console.log(text.substring(0, 500));
    return;
  }

  const data = await res.json();
  const jobs = data.jobs || [];
  console.log("=== kyuujinPDF jobs (5004282) ===");
  console.log("総件数: " + jobs.length);

  const hiddenJobs = jobs.filter((j: any) => j.hidden);
  const visibleJobs = jobs.filter((j: any) => !j.hidden);
  console.log("hidden=true: " + hiddenJobs.length);
  console.log("hidden=false/undefined: " + visibleJobs.length);

  console.log("");
  console.log("--- hidden=true ---");
  for (const j of hiddenJobs) {
    console.log("  id=" + j.id + " company=" + (j.company_name || "").substring(0, 35));
  }

  console.log("");
  console.log("--- hidden=false ---");
  for (const j of visibleJobs) {
    console.log("  id=" + j.id + " company=" + (j.company_name || "").substring(0, 35) + " hidden=" + j.hidden);
  }

  if (jobs.length > 0) {
    console.log("");
    console.log("--- job[0] のキー一覧 ---");
    console.log(Object.keys(jobs[0]).join(", "));
  }

  // Also check total_jobs field
  console.log("");
  console.log("total_jobs field: " + data.total_jobs);
  console.log("project_id: " + data.project_id);
}

main().catch((e) => { console.error(e); process.exit(1); });
