import "dotenv/config";

async function main() {
  const url = "https://web-production-95808.up.railway.app";
  const token = "5004282-51gervlx";

  const res = await fetch(url + "/api/external/mypage/" + token);
  if (!res.ok) {
    console.log("Error: " + res.status + " " + res.statusText);
    const text = await res.text();
    console.log(text.substring(0, 500));
    return;
  }

  const data = await res.json();
  const jobs = data.jobs || [];
  console.log("=== マイページ jobs ===");
  console.log("総件数: " + jobs.length);
  console.log("");

  for (const j of jobs) {
    console.log("  id=" + j.id + " company=" + (j.company_name || "").substring(0, 35) + " hidden=" + j.hidden);
  }

  // Check top-level keys
  console.log("");
  console.log("--- data top-level keys ---");
  console.log(Object.keys(data).join(", "));

  if (jobs.length > 0) {
    console.log("");
    console.log("--- job[0] keys ---");
    console.log(Object.keys(jobs[0]).join(", "));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
