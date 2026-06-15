import "dotenv/config";

const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;

async function main() {
  const numbers = ["5007966", "5004419"];
  for (const num of numbers) {
    console.log(`\n--- candidateNumber=${num} ---`);
    try {
      const res = await fetch(
        `${baseUrl}/api/projects/by-job-seeker-id/${num}/jobs`
      );
      console.log(`Status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        console.log(`total_jobs: ${data.total_jobs}`);
        console.log(`jobs.length: ${(data.jobs || []).length}`);
        if (data.jobs && data.jobs.length > 0) {
          const j = data.jobs[0];
          console.log(`First job keys: ${Object.keys(j).join(", ")}`);
          console.log(`First job: company=${j.company_name}, job_db=${j.job_db}, created_at=${j.created_at}`);
        }
      } else {
        const text = await res.text().catch(() => "");
        console.log(`Error body: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`Fetch error:`, e);
    }
  }
}

main();
