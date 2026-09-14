// T-196 step1: 日程調整タスクに「マイナビで送る返信」を積む側のロジック。
//
// 送信そのものは RPA(7号機) が行う。portal の責務は
//   1) 送り先（マイナビ会員No.）を決める
//   2) 文面を作って Task の mynaviReply* 列に置く
// の2点だけ。ここでの失敗がフォーム送信（create-schedule-task）を壊してはいけない。

import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import {
  buildMynaviScheduleReceivedReply,
  buildMynaviScheduleReservedReply,
} from "@/lib/schedule-reply-message";

/** 送らない理由。列 Task.mynaviReplySkipReason に入る値の全部。 */
export const MYNAVI_REPLY_SKIP_NO_MEMBER_NO = "no_member_no";

/**
 * 氏名の照合キー。空白（半角・全角・タブ）をすべて落とす。
 * フォーム手入力とマイナビ登録名で空白の入り方が違うため、空白を無視して突き合わせる。
 */
export function normalizeNameKey(raw: string): string {
  return raw.replace(/[\s　]/g, "");
}

/**
 * 会員No. 解決の依存。単体確認でモックに差し替えられるよう外から渡す。
 * - findById: candidateId が来たときの引き当て（実在しなければ null）
 * - findByNormalizedName: 空白除去した氏名で一致する Candidate 全件（一意判定のため件数が要る）
 */
export type CandidateMemberNoLookup = {
  findById(candidateId: string): Promise<{ mynaviMemberNo: string | null } | null>;
  findByNormalizedName(nameKey: string): Promise<{ mynaviMemberNo: string | null }[]>;
};

/**
 * 送信先のマイナビ会員No.を決める。取れなければ null（＝人が対応する。氏名検索はRPAにさせない）。
 *
 * 優先順:
 *   1) candidateId があればその Candidate の会員No.（複数人に当たりようがないので最優先）
 *   2) 無ければ空白除去した氏名で **ちょうど1件** ヒットした Candidate の会員No.
 *   3) 0件・2件以上、または会員No.が空 → null
 */
export async function resolveMynaviMemberNo(
  input: { candidateId: string | null; candidateName: string },
  lookup: CandidateMemberNoLookup,
): Promise<string | null> {
  const pick = (v: string | null | undefined): string | null => {
    const s = (v ?? "").trim();
    return s.length > 0 ? s : null;
  };

  if (input.candidateId) {
    const byId = await lookup.findById(input.candidateId);
    // candidateId が来ている以上、その人が正。会員No.が無くても氏名検索へは落とさない
    // （同姓同名の別人へ誤送信するリスクの方が大きい）。
    if (byId) return pick(byId.mynaviMemberNo);
  }

  const key = normalizeNameKey(input.candidateName);
  if (!key) return null;
  const hits = await lookup.findByNormalizedName(key);
  if (hits.length !== 1) return null;
  return pick(hits[0].mynaviMemberNo);
}

/** 本番用の lookup（Prisma 直結）。 */
export const prismaCandidateMemberNoLookup: CandidateMemberNoLookup = {
  async findById(candidateId) {
    return prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { mynaviMemberNo: true },
    });
  },
  async findByNormalizedName(nameKey) {
    // 空白除去は SQL 側で行う（name に空白を含む行も拾うため）。件数は一意判定にしか使わないので 5 件で足りる。
    return prisma.$queryRaw<{ mynaviMemberNo: string | null }[]>`
      SELECT mynavi_member_no AS "mynaviMemberNo"
      FROM candidates
      WHERE REPLACE(REPLACE(REPLACE(name, ' ', ''), '　', ''), E'\t', '') = ${nameKey}
      LIMIT 5
    `;
  },
};

/**
 * 日程調整タスクに「マイナビで送る返信」を積む。
 *
 * **絶対に throw しない**。呼び出し側（create-schedule-task）のレスポンスは成功のまま返す。
 * @returns 積めたら memberNo、送らないなら null（理由は列に入る）
 */
export async function stageMynaviScheduleReply(params: {
  taskId: string;
  candidateId: string | null;
  candidateName: string;
  meetingFormat: string;
  preferredDates: string;
  /** 仮確定できたとき「9月16日（火）19:00〜20:00」。できなかったときは null。 */
  reservedLabel: string | null;
  /** 仮確定できたときの確定面談方法（電話 / オンライン）。 */
  reservedMethod: string | null;
  lookup?: CandidateMemberNoLookup;
}): Promise<{ memberNo: string | null }> {
  const lookup = params.lookup ?? prismaCandidateMemberNoLookup;

  const memberNo = await resolveMynaviMemberNo(
    { candidateId: params.candidateId, candidateName: params.candidateName },
    lookup,
  );

  if (!memberNo) {
    await prisma.task.update({
      where: { id: params.taskId },
      data: { mynaviReplySkipReason: MYNAVI_REPLY_SKIP_NO_MEMBER_NO },
    });
    return { memberNo: null };
  }

  const reply =
    params.reservedLabel !== null
      ? buildMynaviScheduleReservedReply({
          candidateName: params.candidateName,
          whenLabel: params.reservedLabel,
          meetingFormat: params.reservedMethod ?? params.meetingFormat,
        })
      : buildMynaviScheduleReceivedReply({
          candidateName: params.candidateName,
          meetingFormat: params.meetingFormat,
          preferredDates: params.preferredDates,
        });

  await prisma.task.update({
    where: { id: params.taskId },
    data: {
      mynaviReplyText: reply.text,
      mynaviReplySubject: reply.subject,
      mynaviReplyMemberNo: memberNo,
      mynaviReplySkipReason: null,
    },
  });
  return { memberNo };
}

/**
 * 送信成功時にタスクへ残すコメント。
 * ★AI_COMMENT_PREFIX（【日程調整AI】）を **わざと** 含める。
 *   これにより GET /api/external/schedule-tasks の hasAiReplyComment が true になり、
 *   既存の日程調整AI（夜間RPA・モードA）はこのタスクを再処理しない＝応募者への二重返信を防げる。
 */
export const MYNAVI_REPLY_SENT_COMMENT = "【日程調整AI】マイナビで返信を送信";

/**
 * 送信失敗時にタスクへ残すコメントの接頭辞。
 * ★こちらは AI_COMMENT_PREFIX を **含めない**。含めると「1通も送れていないのに
 *   既存の日程調整AIまで黙る」状態になり、応募者が誰からも返信を受け取れなくなるため。
 * (a) の3回失敗判定もこの文字列で数える。
 */
export const MYNAVI_REPLY_FAILED_PREFIX = "【マイナビ返信】マイナビ返信に失敗";

/** 3回失敗したタスクは pending に出し続けない（RPAが延々と同じ行を掴むのを防ぐ）。 */
export const MYNAVI_REPLY_MAX_FAILURES = 3;

/** pending の対象にする作成日の範囲（日）。古い申し込みは人の対応に委ねる。 */
export const MYNAVI_REPLY_PENDING_WINDOW_DAYS = 7;

/**
 * 送信結果が不明（RPAが「送信しました」の表示を拾えなかった）ときにタスクへ残すコメントの接頭辞。
 * ★AI_COMMENT_PREFIX（【日程調整AI】）は **含めない**。含めると既存の夜間RPAまで黙らせてしまう。
 * ★MYNAVI_REPLY_FAILED_PREFIX とも別文字列にする。pending の3回失敗カウントに混ぜないため。
 */
export const MYNAVI_REPLY_UNCONFIRMED_PREFIX = "【マイナビ返信】送信結果が不明";

/**
 * 「送信結果が不明」を受けたことを人に知らせる LINE WORKS 通知。
 * 経路は既存のタスク通知と同じ（LINEWORKS_TASK_BOT_ID / LINEWORKS_TASK_CHANNEL_ID）。
 * **絶対に throw しない**。通知の失敗で受け口のレスポンスを落とさない。
 */
export async function notifyMynaviReplyUnconfirmed(params: {
  taskId: string;
  candidateName: string;
  memberNo: string;
}): Promise<boolean> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  const baseUrl = process.env.PORTAL_BASE_URL ?? "";
  const message = [
    "【要目視確認】日程調整のマイナビ返信が送れたか不明です",
    `氏名: ${params.candidateName || "（氏名不明）"} / 会員No: ${params.memberNo || "-"}`,
    "マイナビのメール履歴で送信済みか確認し、未送信なら手動で送ってください",
    `${baseUrl}/tasks/${params.taskId}`,
  ].join("\n");

  if (!botId || !channelId) {
    console.error("[mynavi-reply] LINEWORKS_TASK_* が未設定のため通知をスキップ:", message);
    return false;
  }
  try {
    await sendBotMessage(botId, channelId, message);
    return true;
  } catch (e) {
    console.error("[mynavi-reply] 要目視確認の通知に失敗:", e);
    return false;
  }
}
