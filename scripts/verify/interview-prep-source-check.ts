/**
 * T-205 step12: 面談準備の材料（「面談」フォルダの最新 PDF）が見つかるか・文字を取り出せるかの確認。
 * 本番環境で実行。DB への書き込みなし・AI を呼ばない・部屋も作らない。
 *
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-source-check.ts 求職者番号"
 *
 * 出力は有無・件数・文字数だけ（本文は出さない）。ファイル名は「材料:」表示の確認のため出す。
 */
import { prisma } from "@/lib/prisma";
import { extractResumeText, findLatestMeetingPdf, meetingPdfWhere } from "@/lib/interview-prep/resume";

async function main() {
  const candidateNumber = process.argv[2];
  if (!candidateNumber) throw new Error("求職者番号を渡してください");

  const cand = await prisma.candidate.findUnique({ where: { candidateNumber }, select: { id: true } });
  if (!cand) {
    console.log("candidate: not found");
    return;
  }

  const meetingFiles = await prisma.candidateFile.findMany({
    where: { candidateId: cand.id, category: "MEETING", archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: { fileName: true, mimeType: true, memo: true, createdAt: true, driveFileId: true },
  });
  console.log(`meeting_files: ${meetingFiles.length}`);
  for (const f of meetingFiles) {
    console.log(
      `  - ${f.createdAt.toISOString().slice(0, 10)} mime=${f.mimeType} memo=${f.memo ? JSON.stringify(f.memo) : "null"} drive=${f.driveFileId ? "yes" : "no"} name=${f.fileName}`,
    );
  }
  const pdfCount = await prisma.candidateFile.count({ where: meetingPdfWhere(cand.id) });
  console.log(`meeting_pdf_files: ${pdfCount}`);

  const file = await findLatestMeetingPdf(cand.id);
  if (!file) {
    console.log("source_file: none");
    return;
  }
  console.log(`source_file: found name=${file.fileName} imported=${file.createdAt.toISOString().slice(0, 10)} drive=${file.driveFileId ? "yes" : "no"}`);

  const extracted = await extractResumeText(file);
  if (!extracted.ok) {
    console.log(`source_text: failed (${extracted.reason}, chars=${extracted.chars})`);
    return;
  }
  console.log(`source_text: ok chars=${extracted.chars}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
