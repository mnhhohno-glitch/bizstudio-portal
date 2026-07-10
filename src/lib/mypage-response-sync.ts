// T-133 P2: マイページ回答同期の共有ロジック。
// 従来は kyuujinPDF → POST /api/external/candidate-response（webhook）の route 内にあった
// CandidateJobResponse upsert / 取り消し削除 / タスク自動生成（10分dedup）を lib へ抽出し、
// webhook と portal内製API（response-status / response-submission）の両方から呼べるようにした。
// 挙動は webhook 従来実装から不変（移動のみ）。
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";

export const DEDUP_WINDOW_MINUTES = 10;

// candidate-response webhook と同一の取得形。呼び出し側はこの select で Candidate を取る。
export const CANDIDATE_CA_SELECT = {
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
} as const;

export type CandidateWithCA = {
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

/**
 * 応募意向を CandidateJobResponse に反映する。
 * intent = "WANT_TO_APPLY" | "INTERESTED" → upsert / null → 取り消し（deleteMany・冪等）。
 * externalJobId は kyuujinPDF の Job 内部ID（Int）。
 */
export async function applyJobResponseIntent(
  candidateId: string,
  externalJobId: number,
  intent: "WANT_TO_APPLY" | "INTERESTED" | null,
  respondedAt?: Date,
): Promise<"upserted" | "cleared"> {
  if (intent === null) {
    await prisma.candidateJobResponse.deleteMany({
      where: { candidateId, externalJobId },
    });
    return "cleared";
  }
  const at = respondedAt ?? new Date();
  await prisma.candidateJobResponse.upsert({
    where: {
      candidateId_externalJobId: { candidateId, externalJobId },
    },
    create: { candidateId, externalJobId, response: intent, respondedAt: at },
    update: { response: intent, respondedAt: at },
  });
  return "upserted";
}

/**
 * マイページ回答タスクの自動生成/更新（10分dedup・担当CA宛・LINE WORKS タスクBot通知）。
 * candidate-response webhook から移動（挙動不変）。
 */
export async function createOrUpdateResponseTask(candidate: CandidateWithCA) {
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

type KyuujinJobLite = { company: string; title: string };

// kyuujinPDF の求職者担当求人（id → 会社名/求人名）を取得。company_name は末尾の
// _14桁以上の連番（内部サフィックス）を除去して正規化。応答不能時は空 Map（呼び出し側でフォールバック）。
async function fetchCandidateJobsMap(
  candidateNumber: string | null
): Promise<Map<number, KyuujinJobLite>> {
  const map = new Map<number, KyuujinJobLite>();
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
        map.set(job.id, { company, title: job.job_title ?? "" });
      }
    }
  } catch {
    // kyuujin-pdf-tool が応答しない場合は空（呼び出し側で求人IDフォールバック）
  }

  return map;
}

// タスク本文用の「会社名 求人名」ラベル Map。挙動不変（従来の fetchJobMap と同一出力）。
async function fetchJobMap(
  candidateNumber: string | null
): Promise<Map<number, string>> {
  const rich = await fetchCandidateJobsMap(candidateNumber);
  const map = new Map<number, string>();
  for (const [id, v] of rich) {
    map.set(id, [v.company, v.title].filter(Boolean).join(" "));
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

// 本人お気に入り／webhook 行の uploadedByUserId 用のシステムユーザー。
// 実ユーザー（求職者）は存在しないため anonymous@local を使う（無ければ active admin フォールバック）。
// favorites / from-job-platform ルートの同名ヘルパと同じ挙動。
async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({
    where: { email: "anonymous@local" },
    select: { id: true },
  });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

// webhook の応募意向（CandidateJobResponse.response）→ 箱A responseStatus への逆マッピング。
const RESPONSE_TO_STATUS: Record<"WANT_TO_APPLY" | "INTERESTED", "APPLY" | "INTERESTED"> = {
  WANT_TO_APPLY: "APPLY",
  INTERESTED: "INTERESTED",
};

/**
 * 旧マイページ（kyuujin candidate-response webhook）の回答でも台帳（CandidateFile BOOKMARK）を確保する。
 *
 * 背景: 旧webhookは CandidateJobResponse＋タスクは作るが CandidateFile を作らないため、
 * CA管理画面「紹介履歴 > ブックマーク」に出ず、CAが手作業で引き当て直していた（本不具合の本体）。
 * /site/（新サイト）経由は favorites POST で行が作られるのと同じ台帳行をここで確保する。
 *
 * - 冪等: 同一候補者×同一 kyuujinJobId の BOOKMARK 行が既にあれば何もしない
 *   （@@unique([candidateId, kyuujinJobId]) はアーカイブ行も含むため archivedAt 問わず存在確認。
 *    CAが意図的にアーカイブした行を復活させない）。
 * - 会社名は kyuujin から best-effort 取得（失敗時は求人IDでフォールバック・行は作る）。
 * - origin="candidate"（本人操作由来＝CA画面で「サイト経由」表示）。externalJobRef は取得不能なため null
 *   （kyuujinJobId は保持するのでエントリー系橋渡し・CJR同期は成立。externalJobRef は後続バックフィル対象）。
 * - responseStatus は回答に合わせる（WANT_TO_APPLY→APPLY / INTERESTED→INTERESTED）。旧マイページ由来は
 *   送信済み扱い（responseStatusUpdatedAt = responseSubmittedAt = respondedAt）で偽の未送信差分を作らない。
 * - 既存処理（CJR upsert・タスク生成）には一切手を加えない（追加のみ）。
 */
export async function ensureBookmarkForMypageResponse(params: {
  candidateId: string;
  candidateNumber: string | null;
  kyuujinJobId: number;
  response: "WANT_TO_APPLY" | "INTERESTED";
  respondedAt: Date;
}): Promise<"created" | "exists" | "skipped"> {
  const { candidateId, candidateNumber, kyuujinJobId, response, respondedAt } = params;

  // 一意制約に従い（アーカイブ含む全行）存在確認。既にあれば何もしない。
  const existing = await prisma.candidateFile.findFirst({
    where: { candidateId, category: "BOOKMARK", kyuujinJobId },
    select: { id: true },
  });
  if (existing) return "exists";

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    console.warn("[ensureBookmarkForMypageResponse] システムユーザー未解決のためスキップ");
    return "skipped";
  }

  // 会社名（fileName 用）を kyuujin から取得（best-effort）。取れなければ求人IDで代替。
  const jobs = await fetchCandidateJobsMap(candidateNumber);
  const company = jobs.get(kyuujinJobId)?.company?.trim() || null;
  const safeCompany = (company ?? `求人${kyuujinJobId}`).replace(/[\\/:*?"<>|]/g, "").trim();
  const fileName = `求人票_${safeCompany}.pdf`;

  const responseStatus = RESPONSE_TO_STATUS[response];

  try {
    await prisma.candidateFile.create({
      data: {
        candidateId,
        category: "BOOKMARK",
        fileName,
        fileSize: 0,
        mimeType: "text/plain",
        driveFileId: null,
        driveViewUrl: null,
        driveFolderId: null,
        sourceType: null, // kyuujin PDF 由来の行（externalJobRef 無し）。既存の legacy ブックマーク慣例に一致
        externalJobRef: null,
        kyuujinJobId,
        origin: "candidate",
        responseStatus,
        responseStatusUpdatedAt: respondedAt,
        responseSubmittedAt: respondedAt, // 旧マイページ由来＝送信済み扱い（未送信差分を作らない）
        uploadedByUserId: systemUserId,
      },
    });
    return "created";
  } catch (e) {
    // 競合（同時受信での一意制約違反等）は既存扱い＝冪等
    console.error("[ensureBookmarkForMypageResponse] BOOKMARK 作成に失敗（冪等スキップ）:", e);
    return "skipped";
  }
}
