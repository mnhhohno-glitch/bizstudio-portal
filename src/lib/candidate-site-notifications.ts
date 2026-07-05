// T-133 P3: まとめ送信時の通知（箱B kyuujinPDF submit_feedback から移植・文面/発火条件は箱Bと同一挙動）。
//
// ① LINE WORKS マイページBot通知
//    移植元: backend/app/routers/mypage.py submit_feedback の LINE WORKS ブロック
//            ＋ services/lineworks_service.py（get_lineworks_id_by_name / send_message_with_mention）
//    発火条件: LINEWORKS_CLIENT_ID・LINEWORKS_MYPAGE_BOT_ID・LINEWORKS_MYPAGE_CHANNEL_ID が全て設定済み
//              （差分submit成立時は 気になる/応募したい が0件でもヘッダのみ送る＝箱B実装と同一）
//    メンション: LINEWORKS_ADVISOR_MAP（JSON: CA名→LINE WORKS userId）で担当CAを解決。
//                解決不可(未設定/parse失敗/名前なし)はメンションなし。メンション送信失敗時はプレーン再送。
//    下回り: portal 既存 src/lib/lineworks.ts の sendBotMessage を流用（認証系 env はタスクBotと共通、
//            Bot/チャンネルは LINEWORKS_MYPAGE_* で分離）。
//
// ② 候補者確認メール（Resend）
//    移植元: backend/app/services/email_service.py send_feedback_confirmation_email
//    発火条件: 候補者のメールアドレスが存在する場合のみ（portal では Candidate.email が出所。
//              箱B の share_tokens.job_seeker_email 相当）。RESEND_API_KEY 未設定は warn してスキップ。
//
// 箱Bとの意図的差異（データソースの違いによる・報告書に明記）:
//   - 求人の memo（箱B JobFeedback.memo の 💬 行）: /site/ 不使用のため portal に存在せず出力しない
//   - 全体への質問（share_tokens.overall_comment の 📝 節）: portal submit に相当データが無いため出力しない
//   - 会社名/求人名の解決: kyuujinJobId → kyuujin jobs API（by-job-seeker-id）で company_name/job_title を取得。
//     未紐付け行は fileName から会社名を復元（求人名は空）。
//
// 通知失敗はまとめ送信本体を失敗させない（本ファイル内で完全に捕捉しログのみ）。
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import { stripFileMetadata } from "@/lib/normalize-filename";

export type SubmissionJobSummary = {
  fileName: string;
  kyuujinJobId: number | null;
  responseStatus: string; // 送信時点の仕分け（INTERESTED / APPLY / PENDING）
};

export type SubmissionNotificationPayload = {
  candidateId: string;
  candidateNumber: string | null;
  candidateName: string;
  submissionId: string;
  interestedCount: number;
  applyCount: number;
  jobs: SubmissionJobSummary[];
};

type JobDisplay = { companyName: string; jobTitle: string };

// kyuujin jobs API（認証不要・既存パターン）で kyuujinJobId → 会社名/求人名 を解決。
// 取得失敗・未紐付けは fileName から会社名を復元（箱Bでは job テーブル直参照のため常に取得できたが、
// portal では紐付けが無い行がありうるためのフォールバック）。
async function resolveJobDisplays(
  candidateNumber: string | null,
  jobs: SubmissionJobSummary[],
): Promise<Map<SubmissionJobSummary, JobDisplay>> {
  const byId = new Map<number, { company_name?: string; job_title?: string }>();
  const baseUrl = process.env.KYUUJIN_PDF_TOOL_URL || process.env.KYUUJIN_API_URL;
  if (candidateNumber && baseUrl && jobs.some((j) => j.kyuujinJobId != null)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `${baseUrl}/api/projects/by-job-seeker-id/${candidateNumber}/jobs`,
        { signal: controller.signal },
      ).finally(() => clearTimeout(timer));
      if (res.ok) {
        const data = (await res.json()) as { jobs?: { id: number; company_name?: string; job_title?: string }[] };
        for (const j of data.jobs ?? []) byId.set(j.id, j);
      }
    } catch (e) {
      console.warn("[candidate-site-notifications] kyuujin jobs 取得失敗（fileName フォールバックで続行）:", e);
    }
  }
  const map = new Map<SubmissionJobSummary, JobDisplay>();
  for (const j of jobs) {
    const kj = j.kyuujinJobId != null ? byId.get(j.kyuujinJobId) : undefined;
    map.set(j, {
      companyName: kj?.company_name ?? stripFileMetadata(j.fileName),
      jobTitle: kj?.job_title ?? "",
    });
  }
  return map;
}

// 箱B get_lineworks_id_by_name と同一: LINEWORKS_ADVISOR_MAP(JSON) から CA名→LW userId。失敗は null。
function getLineworksIdByName(advisorName: string | null | undefined): string | null {
  const mapJson = process.env.LINEWORKS_ADVISOR_MAP;
  if (!mapJson || !advisorName) return null;
  try {
    const map = JSON.parse(mapJson) as Record<string, string>;
    return map[advisorName] ?? null;
  } catch {
    console.error("[LINE WORKS] Failed to parse LINEWORKS_ADVISOR_MAP");
    return null;
  }
}

/** ① LINE WORKS マイページBot 通知（箱B submit_feedback の LINE WORKS ブロックと同一挙動）。 */
export async function notifySubmissionViaLineWorks(
  payload: SubmissionNotificationPayload,
): Promise<void> {
  try {
    const botId = process.env.LINEWORKS_MYPAGE_BOT_ID;
    const channelId = process.env.LINEWORKS_MYPAGE_CHANNEL_ID;
    if (!process.env.LINEWORKS_CLIENT_ID || !botId || !channelId) return; // 箱Bと同一のゲート

    // 担当CA名（箱B: project.career_advisor 相当 → portal: candidate.employee.name）
    const cand = await prisma.candidate.findUnique({
      where: { id: payload.candidateId },
      select: { employee: { select: { name: true } } },
    });
    const careerAdvisor = cand?.employee?.name ?? null;

    const displays = await resolveJobDisplays(payload.candidateNumber, payload.jobs);
    const interested = payload.jobs.filter((j) => j.responseStatus === "INTERESTED");
    const apply = payload.jobs.filter((j) => j.responseStatus === "APPLY");

    // 文面: 箱Bと同一（memo行・全体への質問は portal に存在しないため出力なし＝ヘッダコメント参照）
    const lines: string[] = ["📱 求人マイページ回答通知"];
    lines.push(`求職者: ${payload.candidateName}`);
    if (careerAdvisor) lines.push(`担当: ${careerAdvisor}`);
    if (interested.length > 0) {
      lines.push(`\n👀 気になる (${interested.length}件)\n`);
      for (const j of interested) {
        const d = displays.get(j)!;
        const cleanCompany = d.companyName.replace(/_\d{10,}$/, "");
        lines.push(`・${cleanCompany}\n${d.jobTitle}`);
        lines.push("");
      }
    }
    if (apply.length > 0) {
      lines.push(`\n✋ 応募したい (${apply.length}件)\n`);
      for (const j of apply) {
        const d = displays.get(j)!;
        const cleanCompany = d.companyName.replace(/_\d{10,}$/, "");
        lines.push(`・${cleanCompany}\n${d.jobTitle}`);
        lines.push("");
      }
    }
    const message = lines.join("\n");

    // メンション付き送信 → 失敗時プレーン再送（箱B send_message_with_mention と同一）
    const lineworksId = careerAdvisor ? getLineworksIdByName(careerAdvisor) : null;
    if (lineworksId) {
      try {
        await sendBotMessage(botId, channelId, `<m userId="${lineworksId}"> ${message}`);
        return;
      } catch (e) {
        console.warn("[LINE WORKS] Mention message failed, falling back:", e);
      }
    }
    await sendBotMessage(botId, channelId, message);
  } catch (e) {
    // 通知失敗はまとめ送信本体を失敗させない
    console.error("[LINE WORKS] Notification failed:", e);
  }
}

// 箱B send_feedback_confirmation_email と同一の本文（テスト検証用に export）。
export function buildFeedbackConfirmationEmailBody(
  jobSeekerName: string,
  interestedJobs: JobDisplay[],
  applyJobs: JobDisplay[],
): string {
  const lines: string[] = [
    `${jobSeekerName} 様`,
    "",
    "求人情報へのご回答ありがとうございます。",
    "以下の内容で担当キャリアアドバイザーに送信いたしました。",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ];
  if (interestedJobs.length > 0) {
    lines.push("");
    lines.push(`【気になる】${interestedJobs.length}件`);
    for (const j of interestedJobs) lines.push(`  ・${j.companyName} / ${j.jobTitle}`);
  }
  if (applyJobs.length > 0) {
    lines.push("");
    lines.push(`【応募したい】${applyJobs.length}件`);
    for (const j of applyJobs) lines.push(`  ・${j.companyName} / ${j.jobTitle}`);
  }
  lines.push(
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "担当のキャリアアドバイザーより",
    "近日中にご連絡いたします。",
    "",
    "※このメールは自動送信です。",
    "  ご不明点は担当キャリアアドバイザーまでお問い合わせください。",
    "",
    "──────────────────",
    "株式会社ビズスタジオ",
    "〒102-0083 東京都千代田区麹町4-5-20 KSビル8階",
    "https://bizstudio.co.jp",
  );
  return lines.join("\n");
}

const RESEND_API_URL = "https://api.resend.com/emails";

/** ② 候補者確認メール（箱B send_feedback_confirmation_email と同一挙動・宛先は Candidate.email）。 */
export async function notifySubmissionViaResendEmail(
  payload: SubmissionNotificationPayload,
): Promise<void> {
  try {
    // 宛先: portal Candidate.email（箱B share_tokens.job_seeker_email 相当）。未保持はスキップ（エラーにしない）
    const cand = await prisma.candidate.findUnique({
      where: { id: payload.candidateId },
      select: { email: true },
    });
    const toEmail = cand?.email?.trim();
    if (!toEmail) return;

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.warn("[Resend] RESEND_API_KEY not configured, skipping email");
      return;
    }

    const displays = await resolveJobDisplays(payload.candidateNumber, payload.jobs);
    const toDisplay = (j: SubmissionJobSummary): JobDisplay => displays.get(j)!;
    const interestedJobs = payload.jobs.filter((j) => j.responseStatus === "INTERESTED").map(toDisplay);
    const applyJobs = payload.jobs.filter((j) => j.responseStatus === "APPLY").map(toDisplay);

    const bodyText = buildFeedbackConfirmationEmailBody(payload.candidateName, interestedJobs, applyJobs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BizStudio <noreply@bizstudio.co.jp>",
        to: [toEmail],
        subject: "【BizStudio】求人へのご回答を受け付けました",
        text: bodyText,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.status === 200 || res.status === 201) {
      console.log(`[Resend] Feedback confirmation email sent: submission=${payload.submissionId}`);
    } else {
      const text = await res.text().catch(() => "");
      console.error(`[Resend] Email send failed: status=${res.status} body=${text.slice(0, 300)}`);
    }
  } catch (e) {
    // 通知失敗はまとめ送信本体を失敗させない
    console.error("[Resend] Email send failed:", e);
  }
}
