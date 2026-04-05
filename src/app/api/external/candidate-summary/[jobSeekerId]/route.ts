import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobSeekerId: string }> }
) {
  const apiSecret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.KYUUJIN_API_SECRET;

  if (!expectedSecret || apiSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobSeekerId } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber: jobSeekerId },
    include: {
      employee: { select: { name: true } },
    },
  });

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 並列でデータ取得
  const [guideEntry, notes, jimuSessions, jobEntries] = await Promise.all([
    prisma.guideEntry.findFirst({
      where: { candidateId: candidate.id, guideType: "INTERVIEW" },
    }),
    prisma.candidateNote.findMany({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.jimuSession.findMany({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.jobEntry.findMany({
      where: { candidateId: candidate.id },
      orderBy: { entryDate: "desc" },
    }),
  ]);

  // 年齢計算
  let age: number | null = null;
  if (candidate.birthday) {
    age = Math.floor(
      (Date.now() - new Date(candidate.birthday).getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
    );
  }

  // 性別変換
  const genderMap: Record<string, string> = {
    male: "男性",
    female: "女性",
    other: "その他",
  };
  const gender = candidate.gender ? (genderMap[candidate.gender] ?? candidate.gender) : null;

  // 現職（最新の職歴）
  const currentCompany = jobEntries.length > 0 ? jobEntries[0].companyName : null;

  // 希望条件（JobEntryから集約）
  const desiredLocations = [
    ...new Set(
      jobEntries
        .map((e) => e.prefecture)
        .filter((v): v is string => v != null && v !== "")
    ),
  ];
  const desiredJobTypes = [
    ...new Set(
      jobEntries
        .map((e) => e.jobCategory)
        .filter((v): v is string => v != null && v !== "")
    ),
  ];
  const salaries = jobEntries
    .map((e) => e.salary)
    .filter((v): v is string => v != null && v !== "");
  const desiredSalary = salaries.length > 0 ? salaries[0] : null;

  // 経歴要約（GuideEntryのparsed_resumeまたはai_generated_axis）
  const guideData = (guideEntry?.data ?? {}) as Record<string, unknown>;
  const careerSummary =
    typeof guideData.parsed_resume === "string" && guideData.parsed_resume
      ? guideData.parsed_resume
      : typeof guideData.ai_generated_axis === "string" && guideData.ai_generated_axis
        ? guideData.ai_generated_axis
        : "";

  // 面談ログ（CAメモ + ワークシート + 事務深掘りセッション）
  let interviewLog = "";

  // ワークシート回答
  const ws1 = guideData.worksheet_q1;
  const ws2 = guideData.worksheet_q2;
  const ws3 = guideData.worksheet_q3;
  if (ws1 || ws2 || ws3) {
    interviewLog += "【転職軸ワークシート】\n";
    if (ws1) interviewLog += `なぜ転職するのか？: ${ws1}\n`;
    if (ws2) interviewLog += `何を大切にして働きたいか？: ${ws2}\n`;
    if (ws3) interviewLog += `どんな自分になりたいか？: ${ws3}\n`;
    interviewLog += "\n";
  }

  // PREP法
  const pp = guideData.prep_point;
  const pr = guideData.prep_reason;
  const pe = guideData.prep_example;
  const pp2 = guideData.prep_point2;
  if (pp || pr || pe || pp2) {
    interviewLog += "【PREP法練習シート】\n";
    if (pp) interviewLog += `Point（結論）: ${pp}\n`;
    if (pr) interviewLog += `Reason（理由）: ${pr}\n`;
    if (pe) interviewLog += `Example（具体例）: ${pe}\n`;
    if (pp2) interviewLog += `Point（再結論）: ${pp2}\n`;
    interviewLog += "\n";
  }

  // 事務深掘りセッション
  if (jimuSessions.length > 0) {
    interviewLog += "【事務深掘りセッション】\n";
    for (const session of jimuSessions) {
      const state = session.state as Record<string, unknown>;
      if (state.summary && typeof state.summary === "string") {
        interviewLog += `${state.summary}\n`;
      }
    }
    if (interviewLog.endsWith("【事務深掘りセッション】\n")) {
      // サマリーがない場合はヘッダーを除去
      interviewLog = interviewLog.replace("【事務深掘りセッション】\n", "");
    } else {
      interviewLog += "\n";
    }
  }

  // CAメモ
  if (notes.length > 0) {
    interviewLog += "【CAメモ】\n";
    for (const note of notes) {
      const date = note.createdAt.toISOString().slice(0, 10);
      interviewLog += `${note.author.name} (${date}): ${note.content}\n`;
    }
  }

  interviewLog = interviewLog.trim();

  // スキル・資格（GuideEntryから抽出、なければ空配列）
  const skills: string[] = [];
  if (Array.isArray(guideData.skills)) {
    for (const s of guideData.skills) {
      if (typeof s === "string") skills.push(s);
    }
  }

  // 職歴一覧（JobEntryから構築）
  // 同一企業のエントリーをまとめる
  const companyMap = new Map<
    string,
    { company: string; jobTitle: string; entryDate: Date }
  >();
  for (const entry of jobEntries) {
    const company = entry.companyName || "不明";
    if (!companyMap.has(company)) {
      companyMap.set(company, {
        company,
        jobTitle: entry.jobTitle || "",
        entryDate: entry.entryDate,
      });
    }
  }

  const workHistory = [...companyMap.values()].map((item) => ({
    company: item.company,
    period: "",
    role: item.jobTitle,
    description: "",
  }));

  return NextResponse.json({
    job_seeker_id: jobSeekerId,
    name: candidate.name,
    age,
    gender,
    current_company: currentCompany,
    desired_conditions: {
      desired_salary: desiredSalary,
      desired_locations: desiredLocations,
      desired_job_types: desiredJobTypes,
    },
    career_summary: careerSummary,
    interview_log: interviewLog,
    skills,
    work_history: workHistory,
  });
}
