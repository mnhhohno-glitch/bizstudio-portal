/**
 * T-029 Phase D-2 統合テストスクリプト
 *
 * portal staging 環境（DB + 環境変数）で 3 ケース（大野/西/志喜屋）を統合検証する。
 * candidate-intake の 3 段階 API（extract_resume → generate_form → create_form_v2）
 * を直接呼び出し、portal API ルートと同等のロジックで InterviewRecord 永続化まで実施する。
 *
 * 使用例:
 *   railway run npx tsx scripts/test_phase_d2.ts \
 *     --candidate-number=5999999 --category=office_sales --execute
 *   railway run npx tsx scripts/test_phase_d2.ts \
 *     --candidate-number=5004292 --category=office_other --execute --skip-create
 *
 * オプション:
 *   --candidate-number=N   テスト対象の候補者番号（必須）
 *   --category=X           achievement_category の value（必須）
 *   --category-other-label=X  category=other 時の自由記述
 *   --dry-run              API 呼び出しスキップ、Candidate + ファイル取得のみ（既定）
 *   --execute              全ステップ実行（API + 永続化）
 *   --skip-create          extract + generate のみ実行、create_form_v2 をスキップ
 *
 * 環境変数:
 *   - DATABASE_URL: railway run 経由で注入
 *   - CANDIDATE_INTAKE_URL: staging URL を指す前提
 *   - PORTAL_SHARED_SECRET: candidate-intake への認証
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { downloadFileFromDrive } from "../src/lib/google-drive";

type Args = {
  candidateNumber: string;
  category: string;
  categoryOtherLabel: string | null;
  mode: "dry-run" | "execute";
  skipCreate: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (key: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`--${key}=`));
    return arg?.split("=").slice(1).join("=");
  };
  const candidateNumber = get("candidate-number");
  const category = get("category");
  const categoryOtherLabel = get("category-other-label") ?? null;
  if (!candidateNumber) throw new Error("--candidate-number=... is required");
  if (!category) throw new Error("--category=... is required");
  const mode: "dry-run" | "execute" = argv.includes("--execute") ? "execute" : "dry-run";
  const skipCreate = argv.includes("--skip-create");
  return { candidateNumber, category, categoryOtherLabel, mode, skipCreate };
}

const INTAKE_URL =
  process.env.CANDIDATE_INTAKE_URL ||
  process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
  "https://candidate-intake-production.up.railway.app";

const PORTAL_SECRET = process.env.PORTAL_SHARED_SECRET;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = parseArgs();

  console.log("=".repeat(80));
  console.log(`Phase D-2 統合テスト [${args.mode}${args.skipCreate ? " skipCreate" : ""}]`);
  console.log("=".repeat(80));
  console.log(`candidateNumber: ${args.candidateNumber}`);
  console.log(`category: ${args.category}${args.categoryOtherLabel ? ` (other: ${args.categoryOtherLabel})` : ""}`);
  console.log(`INTAKE_URL host: ${new URL(INTAKE_URL).host}`);
  console.log(`PORTAL_SHARED_SECRET: ${PORTAL_SECRET ? "set (***)" : "NOT SET"}`);
  console.log("");

  if (args.mode === "execute" && !PORTAL_SECRET) {
    throw new Error("PORTAL_SHARED_SECRET is not set in environment");
  }

  // 1. Candidate 取得
  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber: args.candidateNumber },
    select: { id: true, name: true, candidateNumber: true },
  });
  if (!candidate) {
    throw new Error(`Candidate not found: candidateNumber=${args.candidateNumber}`);
  }
  console.log(`[1/8] Candidate found: id=${candidate.id} name=${candidate.name}`);

  // 2. CandidateFile category=MEETING 取得（portal の DocumentsTab activeSubTab="MEETING" と同条件）
  const files = await prisma.candidateFile.findMany({
    where: { candidateId: candidate.id, category: "MEETING" },
    orderBy: { createdAt: "desc" },
  });

  const pdfFiles = files.filter((f) => f.fileName.toLowerCase().endsWith(".pdf"));
  const txtFiles = files.filter((f) => f.fileName.toLowerCase().endsWith(".txt"));

  console.log(
    `[2/8] CandidateFile (MEETING) fetched: total=${files.length} pdf=${pdfFiles.length} txt=${txtFiles.length}`,
  );

  if (pdfFiles.length === 0 || txtFiles.length === 0) {
    console.warn(`⚠️  MEETING ファイル不足: pdf=${pdfFiles.length} txt=${txtFiles.length}`);
    console.warn(`このケースは生成スキップします（書類タブの面談サブタブにアップロードしてください）`);
    return { skipped: true, reason: "no MEETING files (pdf and/or txt)" };
  }

  const pdfFile = pdfFiles[0];
  const txtFile = txtFiles[0];
  console.log(`[2/8] selected pdf: ${pdfFile.fileName} (driveFileId=${pdfFile.driveFileId})`);
  console.log(`[2/8] selected txt: ${txtFile.fileName} (driveFileId=${txtFile.driveFileId})`);

  if (args.mode === "dry-run") {
    console.log("\n--- DRY RUN: API 呼び出しスキップ ---");
    return { dryRun: true, candidateId: candidate.id, pdf: pdfFile.fileName, txt: txtFile.fileName };
  }

  // 3. Drive からファイル取得
  console.log("[3/8] Drive download starting...");
  const t3 = Date.now();
  const [pdfData, txtData] = await Promise.all([
    downloadFileFromDrive(pdfFile.driveFileId),
    downloadFileFromDrive(txtFile.driveFileId),
  ]);
  const interviewLogText = Buffer.from(txtData.base64, "base64").toString("utf-8");
  console.log(
    `[3/8] Drive download done: latency_ms=${Date.now() - t3} pdf_b64=${pdfData.base64.length} txt_chars=${interviewLogText.length}`,
  );

  // 4. extract_resume (multipart/form-data)
  console.log("[4/8] extract_resume starting...");
  const t4 = Date.now();
  const fd = new FormData();
  fd.append("candidateId", candidate.candidateNumber);
  fd.append(
    "pdf",
    new Blob([new Uint8Array(Buffer.from(pdfData.base64, "base64"))], { type: pdfData.mimeType || "application/pdf" }),
    pdfFile.fileName,
  );
  fd.append(
    "interviewLog",
    new Blob([new Uint8Array(Buffer.from(txtData.base64, "base64"))], { type: txtData.mimeType || "text/plain" }),
    txtFile.fileName,
  );

  const r4 = await fetch(`${INTAKE_URL}/api/intake/extract_resume`, {
    method: "POST",
    headers: { "x-portal-secret": PORTAL_SECRET! },
    body: fd,
  });
  if (!r4.ok) {
    const errBody = await r4.text();
    throw new Error(`extract_resume failed: HTTP ${r4.status} body=${errBody.slice(0, 800)}`);
  }
  const d4 = await r4.json();
  const r4Latency = Date.now() - t4;
  console.log(`[4/8] extract_resume done: latency_ms=${r4Latency} HTTP ${r4.status} upstream_latency_ms=${d4?.latency_ms ?? "?"}`);
  console.log(`     resumeData keys: ${Object.keys(d4.resumeData || {}).join(", ")}`);
  console.log(`     work_history count: ${d4.resumeData?.work_history?.length ?? 0}`);
  console.log(`     qualifications count: ${d4.resumeData?.qualifications?.length ?? 0}`);

  // 5. generate_form (JSON)
  console.log("[5/8] generate_form starting...");
  const t5 = Date.now();
  const r5 = await fetch(`${INTAKE_URL}/api/intake/generate_form`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-portal-secret": PORTAL_SECRET! },
    body: JSON.stringify({
      candidateId: candidate.candidateNumber,
      candidateName: candidate.name,
      resumeData: d4.resumeData,
      interviewLog: interviewLogText,
      achievementCategory: args.category,
      achievementCategoryOtherLabel: args.categoryOtherLabel,
    }),
  });
  if (!r5.ok) {
    const errBody = await r5.text();
    throw new Error(`generate_form failed: HTTP ${r5.status} body=${errBody.slice(0, 800)}`);
  }
  const d5 = await r5.json();
  const r5Latency = Date.now() - t5;
  console.log(`[5/8] generate_form done: latency_ms=${r5Latency} HTTP ${r5.status} upstream_latency_ms=${d5?.latency_ms ?? "?"}`);
  const sectionsCount = d5.questionsJson?.sections?.length ?? 0;
  console.log(`     questionsJson sections: ${sectionsCount}`);

  // greeting body 確認: top of body should start with お世話になっております
  const greetingBody: string = d5.questionsJson?.greeting?.body ?? d5.questionsJson?.body ?? "";
  const greetingHead = greetingBody.trim().slice(0, 50);
  console.log(`     greeting body 冒頭 50 文字: "${greetingHead}"`);
  const noDuplicateName =
    greetingHead.startsWith("お世話になっております") ||
    greetingHead.startsWith("お世話になっています");
  console.log(`     重複氏名解消チェック: ${noDuplicateName ? "✅ OK" : "⚠️ 要確認 (氏名が冒頭に出ている可能性)"}`);

  if (args.skipCreate) {
    console.log("\n--- skip-create: create_form_v2 スキップ ---");
    return {
      candidateId: candidate.id,
      extractLatencyMs: r4Latency,
      generateLatencyMs: r5Latency,
      resumeKeys: Object.keys(d4.resumeData || {}),
      sectionsCount,
      noDuplicateName,
      skippedCreate: true,
    };
  }

  // 6. create_form_v2 (JSON)
  console.log("[6/8] create_form_v2 starting...");
  const t6 = Date.now();
  const r6 = await fetch(`${INTAKE_URL}/api/intake/create_form_v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-portal-secret": PORTAL_SECRET! },
    body: JSON.stringify({
      candidateId: candidate.candidateNumber,
      questionsJson: d5.questionsJson,
    }),
  });
  if (!r6.ok) {
    const errBody = await r6.text();
    throw new Error(`create_form_v2 failed: HTTP ${r6.status} body=${errBody.slice(0, 800)}`);
  }
  const d6 = await r6.json();
  const r6Latency = Date.now() - t6;
  console.log(`[6/8] create_form_v2 done: latency_ms=${r6Latency} HTTP ${r6.status} upstream_latency_ms=${d6?.latency_ms ?? "?"}`);
  console.log(`     formId: ${d6.formId}`);
  console.log(`     editUrl: ${d6.editUrl}`);
  console.log(`     responseUrl: ${d6.responseUrl}`);

  // 7. InterviewRecord 永続化（portal API の create-form と同等のロジック）
  console.log("[7/8] InterviewRecord 永続化チェック...");
  const latestRecord = await prisma.interviewRecord.findFirst({
    where: { candidateId: candidate.id, isLatest: true },
    select: { id: true, status: true, interviewCount: true },
  });

  let persisted = false;
  let interviewRecordId: string | null = null;
  if (latestRecord) {
    await prisma.interviewRecord.update({
      where: { id: latestRecord.id },
      data: {
        googleFormId: d6.formId,
        googleFormEditUrl: d6.editUrl,
        googleFormViewUrl: d6.responseUrl,
        googleFormCreatedAt: new Date(),
        googleFormStatus: "completed",
        googleFormError: null,
      },
    });
    persisted = true;
    interviewRecordId = latestRecord.id;
    console.log(`[7/8] InterviewRecord updated: id=${latestRecord.id} count=${latestRecord.interviewCount} status=${latestRecord.status}`);
  } else {
    console.log(`[7/8] InterviewRecord (isLatest=true) not found → 永続化スキップ`);
  }

  // 8. 保存確認 SELECT
  console.log("[8/8] DB 確認...");
  if (persisted) {
    const refetched = await prisma.interviewRecord.findFirst({
      where: { candidateId: candidate.id, isLatest: true },
      select: {
        id: true,
        googleFormId: true,
        googleFormEditUrl: true,
        googleFormViewUrl: true,
        googleFormCreatedAt: true,
        googleFormStatus: true,
        googleFormError: true,
      },
    });
    console.log(`[8/8] 保存確認:`);
    console.log(JSON.stringify(refetched, null, 2));
  } else {
    console.log(`[8/8] 永続化なし、SELECT スキップ`);
  }

  return {
    candidateId: candidate.id,
    interviewRecordId,
    formId: d6.formId,
    editUrl: d6.editUrl,
    responseUrl: d6.responseUrl,
    persisted,
    extractLatencyMs: r4Latency,
    generateLatencyMs: r5Latency,
    createLatencyMs: r6Latency,
    sectionsCount,
    noDuplicateName,
  };
}

main()
  .then((result) => {
    console.log("\n" + "=".repeat(80));
    console.log("RESULT:", JSON.stringify(result, null, 2));
    console.log("=".repeat(80));
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n" + "=".repeat(80));
    console.error("ERROR:", err.message);
    console.error(err.stack);
    console.error("=".repeat(80));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
