import { prisma } from "../src/lib/prisma";
import { checkInputMissing } from "../src/lib/interview-input-missing";

async function main() {
  const candidateNumber = process.argv[2] || "5005695";
  const candidate = await prisma.candidate.findFirst({
    where: { candidateNumber },
  });
  if (!candidate) throw new Error("Candidate not found (" + candidateNumber + ")");

  const interview = await prisma.interviewRecord.findFirst({
    where: { candidateId: candidate.id },
    orderBy: { interviewCount: "asc" },
    include: {
      detail: true,
      rating: true,
      workHistories: true,
    },
  });
  if (!interview) throw new Error("Interview not found");

  console.log("=== " + candidate.name + " さん 面談 #" + interview.interviewCount + " 入力漏れ判定 ===");
  console.log("Candidate:", candidate.name, "(" + candidate.candidateNumber + ")");
  console.log("Interview ID:", interview.id);
  console.log("Status:", interview.status);
  console.log("resultFlag:", interview.resultFlag);
  console.log("isLatest:", interview.isLatest);
  console.log("workHistories count:", interview.workHistories.length);
  console.log("");

  const result = checkInputMissing({
    form: {
      interviewDate: interview.interviewDate,
      startTime: interview.startTime,
      endTime: interview.endTime,
      interviewTool: interview.interviewTool,
      resultFlag: interview.resultFlag,
      interviewMemo: interview.interviewMemo,
    },
    detail: interview.detail as Record<string, unknown> | null,
    rating: interview.rating as Record<string, unknown> | null,
    workHistoriesCount: interview.workHistories.length,
  });

  console.log("=== 判定結果 ===");
  console.log("hasMissing:", result.hasMissing);
  console.log("missingFields count:", result.missingFields.length);
  console.log("");
  console.log("=== 漏れと判定されたフィールド ===");
  for (const field of result.missingFields) {
    console.log("  - " + field);
  }
  console.log("");

  console.log("=== 各漏れフィールドの実値 ===");
  for (const field of result.missingFields) {
    const [group, key] = field.split(".");
    let value: unknown;
    if (group === "form") {
      value = (interview as unknown as Record<string, unknown>)[key];
    } else if (group === "d") {
      value = interview.detail
        ? (interview.detail as unknown as Record<string, unknown>)[key]
        : "(detail row missing)";
    } else if (group === "r") {
      value = interview.rating
        ? (interview.rating as unknown as Record<string, unknown>)[key]
        : "(rating row missing)";
    } else if (group === "workHistories") {
      value = "length=" + interview.workHistories.length;
    }
    console.log("  " + field + ": " + JSON.stringify(value));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
