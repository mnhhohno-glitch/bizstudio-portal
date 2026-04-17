import { readFileSync } from 'fs';

const API_URL = 'https://bizstudio-portal-production.up.railway.app/api/internal/entries/bulk-import';
const API_KEY = '5Ut51UxKyQ5A9Tve6zvHe0XHIMmDM1Jov9SqvyJF2fdifEtW';
const BATCH_SIZE = 200;

async function run() {
  const allEntries = JSON.parse(readFileSync('./entry-import-all.json', 'utf-8'));
  console.log(`Total entries: ${allEntries.length}`);

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  const allErrors = [];

  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allEntries.length / BATCH_SIZE);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({ entries: batch }),
      });

      if (!res.ok) {
        console.error(`Batch ${batchNum}/${totalBatches}: HTTP ${res.status}`);
        totalFailed += batch.length;
        continue;
      }

      const data = await res.json();
      totalCreated += data.result.created;
      totalSkipped += data.result.skipped;
      totalFailed += data.result.failed;

      if (data.errors && data.errors.length > 0) {
        allErrors.push(...data.errors);
      }

      console.log(
        `Batch ${batchNum}/${totalBatches}: ` +
        `created=${data.result.created} skipped=${data.result.skipped} failed=${data.result.failed} ` +
        `(累計: ${totalCreated}/${allEntries.length})`
      );

      if (i + BATCH_SIZE < allEntries.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error(`Batch ${batchNum}: Error - ${e.message}`);
      totalFailed += batch.length;
    }
  }

  console.log('\n=== 完了 ===');
  console.log(`Created: ${totalCreated}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Failed:  ${totalFailed}`);
  console.log(`Total:   ${allEntries.length}`);

  if (allErrors.length > 0) {
    console.log(`\nErrors (先頭20件):`);
    allErrors.slice(0, 20).forEach(e => console.log(`  ${e}`));
  }
}

run();
