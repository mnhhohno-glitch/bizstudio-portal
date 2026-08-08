// T-133 P2: マイページ回答同期の共有ロジック。
// 従来は kyuujinPDF → POST /api/external/candidate-response（webhook）の route 内にあった
// CandidateJobResponse upsert / 取り消し削除 / タスク自動生成（10分dedup）を lib へ抽出し、
// webhook と portal内製API（response-status / response-submission）の両方から呼べるようにした。
// 挙動は webhook 従来実装から不変（移動のみ）。
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";

// 旧: タスクの重複排除窓。現在はタスク集約が未着手タスクの有無で決まるため、
// 「既存タスク更新時に LINE 通知を再送するまでのクールダウン」として使う。
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
 * JST の「当日 0:00」を絶対時刻として返す（タスク期限用）。
 * 罠#17: `toISOString().slice(0,10)` は Railway（UTC）で JST 深夜に前日へズレるため使わない。
 */
function todayJstDueDate(): Date {
  // sv-SE ロケールは "YYYY-MM-DD" 形式を返す
  const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  return new Date(`${ymd}T00:00:00+09:00`);
}

/**
 * マイページ回答タスクの自動生成/更新（未着手タスクへの集約・担当CA宛・LINE WORKS タスクBot通知）。
 *
 * 集約方式（旧: 10分dedup窓）:
 * - 同一求職者の未着手（NOT_STARTED）【マイページ回答】タスクが残っている限り新規作成せず、
 *   その1枚を「現時点の全量」で上書きする。IN_PROGRESS は CA が着手中の内容を書き換えないため
 *   集約対象にせず新規作成する。COMPLETED も同様（片付け済み＝新しい回答は新しいタスク）。
 * - 本文は常に CandidateJobResponse の全量から組み立てる。旧実装は時間窓
 *   （updatedAt >= existingTask.createdAt）の差分を全置換していたため、更新のたびに
 *   前回本文の求人が消える欠落バグがあった。
 * - 検索〜作成/更新は pg_advisory_xact_lock（求職者単位）で直列化する。旧実装は
 *   findFirst→create の read-then-write レースで 1ms 差の二重作成が実際に発生していた。
 * - 更新時も LINE 通知を送る。ただし直前の更新から10分以内の再更新は通知のみスキップ
 *   （タスク本文の更新自体は必ず行う）。
 * - 求人ラベルが1件も解決できない（kyuujinPDF 応答不能）場合、更新はスキップして既存本文を
 *   温存する。「求人ID: 12345」だけの本文で会社名入りの既存本文を潰さないため。
 *   新規作成時は本文が無いよりましなのでフォールバックラベルのまま作成する。
 *
 * @param options.refreshOnly 既存の未着手タスクがある場合のみ本文を追従させ、無ければ何もしない。
 *   回答の「取り消し（保留・対象外・未回答へ変更）」時に使う。取り消しを契機に新しいタスクを
 *   生やしてしまわないため。
 */
export async function createOrUpdateResponseTask(
  candidate: CandidateWithCA,
  options?: { refreshOnly?: boolean }
) {
  if (!candidate.employee?.userId || !candidate.employee.user) {
    console.warn(
      `求職者 ${candidate.name} に担当CAが設定されていないため、タスク生成をスキップ`
    );
    return;
  }

  const employee = candidate.employee;
  const user = employee.user!;
  const titlePrefix = `【マイページ回答】${candidate.name}`;

  // 外部fetch（kyuujinPDF）はトランザクションの外で済ませる（advisory lock の保持時間を最小化）。
  const jobMap = await fetchJobMap(candidate.candidateNumber);

  type TxResult =
    | { action: "created"; taskId: string; title: string }
    | { action: "updated"; taskId: string; title: string; notify: boolean }
    | { action: "skipped"; reason: string }
    | null;

  const result: TxResult = await prisma.$transaction(
    async (tx) => {
      // 同一求職者の並行処理を直列化（二重作成レースの根治）。トランザクション終了で自動解放。
      // $queryRaw ではなく $executeRaw を使う: pg_advisory_xact_lock の戻り値は void で、
      // $queryRaw だと Prisma が「型 void の列をデシリアライズできない」(P2010) で落ちる。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id})::bigint)`;

      const existingTask = await tx.task.findFirst({
        where: {
          candidateId: candidate.id,
          title: { startsWith: titlePrefix },
          status: "NOT_STARTED",
        },
        orderBy: { createdAt: "desc" },
      });

      // 全量（差分窓なし）。取り消し済み・未回答は CandidateJobResponse に存在しないので自然に除外される。
      const responses = await tx.candidateJobResponse.findMany({
        where: {
          candidateId: candidate.id,
          response: { in: ["WANT_TO_APPLY", "INTERESTED"] },
        },
        orderBy: { respondedAt: "desc" },
      });

      // 有効な回答が0件かつ既存タスクも無い → 作るものが無い。
      if (responses.length === 0 && !existingTask) return null;
      // 取り消し契機（refreshOnly）で既存タスクが無ければ、新しいタスクは生やさない。
      if (options?.refreshOnly && !existingTask) return null;

      const { title, description } = buildTaskContent(
        candidate.name,
        responses,
        jobMap
      );

      if (existingTask) {
        // ラベルが1件も解決できていない＝kyuujinPDF 応答不能とみなし、既存本文を温存する。
        const anyResolved = responses.some((r) => jobMap.has(r.externalJobId));
        if (responses.length > 0 && !anyResolved) {
          return { action: "skipped", reason: "job-label-unresolved" };
        }

        // 通知のクールダウン判定は更新前の updatedAt で行う（更新すると now になるため）。
        const sincePrevUpdate = Date.now() - existingTask.updatedAt.getTime();
        const withinCooldown =
          sincePrevUpdate < DEDUP_WINDOW_MINUTES * 60 * 1000;

        await tx.task.update({
          where: { id: existingTask.id },
          data: { title, description, dueDate: todayJstDueDate() },
        });

        return {
          action: "updated",
          taskId: existingTask.id,
          title,
          // 通知しないケース: 全量0件（全部取り下げ／保留）／取り消し契機の追従更新。
          // どちらも「回答が増えた」わけではないのでCAを呼ぶ必要がない。
          notify:
            !withinCooldown && responses.length > 0 && !options?.refreshOnly,
        };
      }

      const task = await tx.task.create({
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

      return { action: "created", taskId: task.id, title };
    },
    { maxWait: 10000, timeout: 20000 }
  );

  if (!result) return;

  if (result.action === "skipped") {
    console.warn(
      `[createOrUpdateResponseTask] 求人ラベル解決不能のため既存タスクの更新をスキップ（${candidate.name}）: ${result.reason}`
    );
    return;
  }

  // 通知はトランザクション外（外部API・失敗してもタスクは残す）。
  // 集約後は「作成/更新した」と「通知した/しなかった」が一致しないため、両方をログに残す
  // （通知は送信成功時に外形ログが出ないため、運用時の追跡はこの行が頼りになる）。
  const notify = result.action === "created" || result.notify;
  console.info(
    `[createOrUpdateResponseTask] ${result.action} task=${result.taskId} candidate=${candidate.name} notify=${notify}`
  );

  if (notify) {
    await notifyMypageResponse(
      result.taskId,
      result.title,
      candidate.name,
      employee,
      user,
      result.action === "created" ? "created" : "updated"
    );
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

// 本文は「差分の追記」ではなく「現時点の全量」。呼び出し側が毎回これで全置換する。
function buildTaskContent(
  candidateName: string,
  responses: { externalJobId: number; response: string }[],
  jobMap: Map<number, string>
): { title: string; description: string } {
  // 全量0件（すべて取り下げ・保留・対象外に変更された）→ 既存タスクの本文をこの形へ更新する。
  if (responses.length === 0) {
    return {
      title: `【マイページ回答】${candidateName} - 回答なし`,
      description: [
        `${candidateName}様のマイページ回答状況（最新の全量）です。`,
        "",
        "（現在有効な回答はありません。すべて取り下げ・保留等に変更されました）",
      ].join("\n"),
    };
  }

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
    `${candidateName}様のマイページ回答状況（最新の全量）です。`,
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
  user: { lineworksId: string | null },
  // "created" = 新規作成 / "updated" = 既存の未着手タスクへ集約（回答が追加・変更された）
  mode: "created" | "updated" = "created"
) {
  try {
    const botId = process.env.LINEWORKS_TASK_BOT_ID;
    const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
    const baseUrl = process.env.PORTAL_BASE_URL;

    if (!botId || !channelId) return;

    const headline =
      mode === "updated"
        ? "マイページ回答タスクが更新されました（回答が追加・変更されました）"
        : "マイページ回答タスクが自動生成されました";

    const lines = [
      `📋 ${headline}`,
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
        ` ${headline}`,
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
