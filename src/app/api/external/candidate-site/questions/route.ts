import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import { notifyCandidateQuestion } from "@/lib/candidate-site/question-notification";
import { todayJST } from "@/lib/attendance/timezone";

// T-128 batch4: 求職者サイト「担当CAに質問する」の確定送信。
// POST /api/external/candidate-site/questions
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（401）。既存4エンドポイントと同一テンプレ。
// - 候補者スコープ: リクエストが指す候補者に厳密スコープ。
// - 入力: { candidateId|candidateNumber, question, summary }（summarize後に本人が確定したもの）。
// - 上限ガード: 同一候補者の質問タスク作成が当日（JST）10件で 429。
// - Task作成: 既存 Task モデルをスキーマ変更なしで使用（新規関数・dedup流用なし）。assignee=担当CA。
//   タイトルに候補者名、本文に AI要約＋原文の両方を含める。担当CA未設定なら assignee なしで作成。
// - LINE WORKS通知: 応募通知（apply）で稼働中の sendBotMessage 経路を流用（宛先= Employee.lineUserId）。
//   担当CA未設定時はチャンネル宛のみ（メンションなし）。

const DAILY_LIMIT = 10;
const MAX_QUESTION_LEN = 1000;
const MAX_SUMMARY_LEN = 2000;
const TITLE_PREFIX = "【マイページ質問】";

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// Task.createdByUserId 用のシステムユーザー（担当CA未設定時のフォールバック）。
async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

export async function POST(request: Request) {
  if (!verifyCandidateSiteKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId,
    candidateNumber: body.candidateNumber,
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const question = str(body.question);
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LEN) {
    return NextResponse.json({ error: `question must be <= ${MAX_QUESTION_LEN} characters` }, { status: 400 });
  }
  // summary が無ければ原文で代替（フォールバック）。
  const summary = str(body.summary) ?? question;
  if (summary.length > MAX_SUMMARY_LEN) {
    return NextResponse.json({ error: `summary must be <= ${MAX_SUMMARY_LEN} characters` }, { status: 400 });
  }

  // 上限ガード: 当日（JST 0:00 以降）の質問タスク作成数。候補者スコープ。
  const jstDayStart = todayJST().toDate();
  const todayCount = await prisma.task.count({
    where: {
      candidateId: candidate.id,
      title: { startsWith: TITLE_PREFIX },
      createdAt: { gte: jstDayStart },
    },
  });
  if (todayCount >= DAILY_LIMIT) {
    return NextResponse.json(
      { ok: false, reason: "daily-limit", message: "本日の質問受付上限に達しました" },
      { status: 429 }
    );
  }

  // 担当CAを解決（通知先・assignee）。
  const withCa = await prisma.candidate.findUnique({
    where: { id: candidate.id },
    select: {
      employee: { select: { id: true, name: true, lineUserId: true, userId: true } },
    },
  });
  const employee = withCa?.employee ?? null;

  // Task.createdByUserId は必須。担当CAの userId があればそれ、無ければシステムユーザー。
  const systemUserId = await resolveSystemUserId();
  const createdByUserId = employee?.userId ?? systemUserId;
  if (!createdByUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  const title = `${TITLE_PREFIX}${candidate.name} - 担当CAへの質問`;
  const description = [
    `${candidate.name} 様から担当CAへの質問がありました。`,
    "",
    "■ 質問（AI要約）",
    summary,
    "",
    "■ 質問（原文）",
    question,
  ].join("\n");

  const task = await prisma.task.create({
    data: {
      title,
      description,
      candidateId: candidate.id,
      status: "NOT_STARTED",
      priority: "MEDIUM",
      dueDate: new Date(),
      createdByUserId,
      completionType: "any",
      // 担当CAがいれば assignee 付与、いなければ未割当（通知はチャンネル宛のみ）。
      ...(employee ? { assignees: { create: [{ employeeId: employee.id }] } } : {}),
    },
    select: { id: true },
  });

  // LINE WORKS通知（失敗してもタスクは作成済み＝タスクが消えるのが最悪なので握りつぶしログのみ）。
  let notified = false;
  try {
    notified = await notifyCandidateQuestion({
      candidateName: candidate.name,
      candidateNumber: candidate.candidateNumber,
      caName: employee?.name ?? null,
      caLineUserId: employee?.lineUserId ?? null,
      taskId: task.id,
      summary,
    });
  } catch (e) {
    console.error("[candidate-site/questions] LINE WORKS通知失敗（タスクは作成済み）:", e);
    notified = false;
  }

  return NextResponse.json({
    ok: true,
    taskId: task.id,
    assigned: !!employee,
    notified,
  });
}
