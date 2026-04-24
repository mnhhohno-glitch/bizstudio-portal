import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";

const DEDUP_WINDOW_MINUTES = 10;

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.KYUUJIN_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { candidateId, jobId, response, respondedAt } = body as {
    candidateId: string;
    jobId: number;
    response: string;
    respondedAt: string;
  };

  if (!candidateId || !jobId || !response) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const validResponses = ["WANT_TO_APPLY", "INTERESTED"];
  if (!validResponses.includes(response)) {
    return NextResponse.json(
      { error: "Invalid response value" },
      { status: 400 }
    );
  }

  const candidate = await prisma.candidate.findFirst({
    where: candidateId.startsWith("cm")
      ? { id: candidateId }
      : { candidateNumber: candidateId },
    select: {
      id: true,
      name: true,
      candidateNumber: true,
      employeeId: true,
      employee: {
        select: {
          id: true,
          name: true,
          userId: true,
          user: {
            select: {
              id: true,
              lineworksId: true,
            },
          },
        },
      },
    },
  });

  if (!candidate) {
    return NextResponse.json(
      { error: "Candidate not found" },
      { status: 404 }
    );
  }

  await prisma.candidateJobResponse.upsert({
    where: {
      candidateId_externalJobId: {
        candidateId: candidate.id,
        externalJobId: jobId,
      },
    },
    create: {
      candidateId: candidate.id,
      externalJobId: jobId,
      response,
      respondedAt: respondedAt ? new Date(respondedAt) : new Date(),
    },
    update: {
      response,
      respondedAt: respondedAt ? new Date(respondedAt) : new Date(),
    },
  });

  try {
    await createOrUpdateResponseTask(candidate);
  } catch (e) {
    console.error("マイページ回答タスク自動生成に失敗:", e);
  }

  return NextResponse.json({ success: true, updated: true });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-secret",
    },
  });
}

// --- タスク自動生成 ---

type CandidateWithCA = {
  id: string;
  name: string;
  candidateNumber: string | null;
  employeeId: string | null;
  employee: {
    id: string;
    name: string;
    userId: string | null;
    user: { id: string; lineworksId: string | null } | null;
  } | null;
};

async function createOrUpdateResponseTask(candidate: CandidateWithCA) {
  if (!candidate.employee?.userId || !candidate.employee.user) {
    console.warn(
      `求職者 ${candidate.name} に担当CAが設定されていないため、タスク生成をスキップ`
    );
    return;
  }

  const employee = candidate.employee;
  const user = employee.user!;
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000);
  const titlePrefix = `【マイページ回答】${candidate.name}`;

  const existingTask = await prisma.task.findFirst({
    where: {
      candidateId: candidate.id,
      title: { startsWith: titlePrefix },
      createdAt: { gte: dedupCutoff },
      status: { not: "COMPLETED" },
    },
    orderBy: { createdAt: "desc" },
  });

  const recentResponses = await prisma.candidateJobResponse.findMany({
    where: {
      candidateId: candidate.id,
      response: { in: ["WANT_TO_APPLY", "INTERESTED"] },
      updatedAt: { gte: existingTask?.createdAt ?? dedupCutoff },
    },
    orderBy: { respondedAt: "desc" },
  });

  if (recentResponses.length === 0) return;

  const jobMap = await fetchJobMap(candidate.candidateNumber);
  const { title, description } = buildTaskContent(
    candidate.name,
    recentResponses,
    jobMap
  );

  if (existingTask) {
    await prisma.task.update({
      where: { id: existingTask.id },
      data: { title, description },
    });
  } else {
    const task = await prisma.task.create({
      data: {
        title,
        description,
        candidateId: candidate.id,
        status: "NOT_STARTED",
        priority: "MEDIUM",
        dueDate: new Date(),
        createdByUserId: user.id,
        completionType: "any",
        assignees: {
          create: [{ employeeId: employee.id }],
        },
      },
    });

    await notifyMypageResponse(task.id, title, candidate.name, employee, user);
  }
}

async function fetchJobMap(
  candidateNumber: string | null
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!candidateNumber) return map;

  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL;
  if (!baseUrl) return map;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      `${baseUrl}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return map;

    const data = await res.json();
    if (data.jobs && Array.isArray(data.jobs)) {
      for (const job of data.jobs as {
        id: number;
        company_name?: string;
        job_title?: string;
      }[]) {
        const company = (job.company_name ?? "").replace(/_\d{14,}$/, "");
        const jobTitle = job.job_title ?? "";
        map.set(job.id, [company, jobTitle].filter(Boolean).join(" "));
      }
    }
  } catch {
    // kyuujin-pdf-tool が応答しない場合は求人IDをフォールバック表示
  }

  return map;
}

function buildTaskContent(
  candidateName: string,
  responses: { externalJobId: number; response: string }[],
  jobMap: Map<number, string>
): { title: string; description: string } {
  const grouped: Record<string, string[]> = {};
  for (const r of responses) {
    if (!grouped[r.response]) grouped[r.response] = [];
    grouped[r.response].push(
      jobMap.get(r.externalJobId) ?? `求人ID: ${r.externalJobId}`
    );
  }

  const titleParts: string[] = [];
  if (grouped.WANT_TO_APPLY) {
    titleParts.push(`応募したい（${grouped.WANT_TO_APPLY.length}件）`);
  }
  if (grouped.INTERESTED) {
    titleParts.push(`気になる（${grouped.INTERESTED.length}件）`);
  }
  const title = `【マイページ回答】${candidateName} - ${titleParts.join("・")}`;

  const lines = [
    `${candidateName}様がマイページで以下の求人に回答しました。`,
    "",
  ];
  if (grouped.WANT_TO_APPLY) {
    lines.push(`▶ 応募したい（${grouped.WANT_TO_APPLY.length}件）`);
    for (const label of grouped.WANT_TO_APPLY) {
      lines.push(`・${label}`);
    }
    lines.push("");
  }
  if (grouped.INTERESTED) {
    lines.push(`▶ 気になる（${grouped.INTERESTED.length}件）`);
    for (const label of grouped.INTERESTED) {
      lines.push(`・${label}`);
    }
    lines.push("");
  }

  return { title, description: lines.join("\n") };
}

async function notifyMypageResponse(
  taskId: string,
  title: string,
  candidateName: string,
  employee: { name: string },
  user: { lineworksId: string | null }
) {
  try {
    const botId = process.env.LINEWORKS_TASK_BOT_ID;
    const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
    const baseUrl = process.env.PORTAL_BASE_URL;

    if (!botId || !channelId) return;

    const lines = [
      "📋 マイページ回答タスクが自動生成されました",
      "",
      "■ タイトル",
      title,
      "",
      "■ 求職者",
      `${candidateName} 様`,
      "",
      "■ 担当者",
      employee.name,
      "",
      "■ ステータス",
      "未着手",
      "",
      "🔗 タスク詳細",
      `${baseUrl}/tasks/${taskId}`,
    ];

    if (user.lineworksId) {
      const mentionedLines = [
        `<m userId="${user.lineworksId}">`,
        " マイページ回答タスクが自動生成されました",
        "",
        ...lines.slice(2),
      ];
      try {
        await sendBotMessage(botId, channelId, mentionedLines.join("\n"));
        return;
      } catch {
        // メンション失敗時はメンションなしで再送
      }
    }

    await sendBotMessage(botId, channelId, lines.join("\n"));
  } catch (e) {
    console.error("LINE WORKS通知の送信に失敗:", e);
  }
}
