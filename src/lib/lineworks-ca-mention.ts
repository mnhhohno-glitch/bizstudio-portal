// 担当CAへの LINE WORKS メンション宛先を社員情報から解決する（2026-09-26）。
//
// 宛先の出所は Employee（candidate.employeeId）→ User.lineworksId の1本だけ。
// 名前一致や別の対応表（旧 LINEWORKS_ADVISOR_MAP・Employee.lineUserId）は使わない
// （罠#45: 対応表を社員情報と別に持つと、人が増えたときに登録漏れで黙って届かなくなる）。
//
// 担当CAに届かないとき（未設定／社員なし／lineworksId 未登録／退職・無効）は、
// 代表（大野 将幸・社員番号 1000001）にメンションし、本文末尾に注記を付ける。
// 代表も引けない場合はメンションなしで送り、注記とエラーログを残す（黙って落とさない）。
//
// タスク通知（task-notification.ts の resolveAssigneeNotifyTargets）はこの関数を使わない（挙動を変えないため）。
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";

export const CA_MENTION_FALLBACK_EMPLOYEE_NUMBER = "1000001";

export type CaMentionTarget = {
  /** 担当CA名（未設定・社員なしは null） */
  caName: string | null;
  /** 担当CA本人の lineworksId（届かない場合は null） */
  caLineworksId: string | null;
  /** 代表（フォールバック先）の lineworksId（引けない場合は null） */
  fallbackLineworksId: string | null;
  /** 担当CAに届かないときに本文末尾へ付ける注記 */
  unreachedNote: string;
};

export function buildCaUnreachedNote(caName: string | null): string {
  return `※担当CA（${caName ?? "未設定"}）に届いていません（LINE WORKS未登録）`;
}

async function resolveEmployeeLineworksId(
  where: { id: string } | { employeeNumber: string },
): Promise<{ name: string; lineworksId: string | null } | null> {
  const emp = await prisma.employee.findUnique({
    where,
    select: {
      name: true,
      status: true,
      user: { select: { status: true, lineworksId: true } },
    },
  });
  if (!emp) return null;
  const lw = emp.user?.lineworksId?.trim();
  const usable = emp.status === "active" && emp.user?.status === "active" && !!lw;
  return { name: emp.name, lineworksId: usable ? lw! : null };
}

/** 担当CA（candidate.employeeId）の宛先と、届かないときの代表の宛先を解決する。 */
export async function resolveCaMentionTarget(employeeId: string | null | undefined): Promise<CaMentionTarget> {
  const ca = employeeId ? await resolveEmployeeLineworksId({ id: employeeId }) : null;
  const caName = ca?.name ?? null;
  const caLineworksId = ca?.lineworksId ?? null;
  const fallback = caLineworksId
    ? null
    : await resolveEmployeeLineworksId({ employeeNumber: CA_MENTION_FALLBACK_EMPLOYEE_NUMBER });
  return {
    caName,
    caLineworksId,
    fallbackLineworksId: fallback?.lineworksId ?? null,
    unreachedNote: buildCaUnreachedNote(caName),
  };
}

async function resolveFallbackLineworksId(): Promise<string | null> {
  const fb = await resolveEmployeeLineworksId({ employeeNumber: CA_MENTION_FALLBACK_EMPLOYEE_NUMBER });
  return fb?.lineworksId ?? null;
}

/**
 * 担当CAメンション付きで送る。render(mentionId, note) が本文を組み立てる
 * （mentionId=null はメンションなし、note は本文末尾に付ける注記・本人に届く場合は null）。
 *
 * 1) 担当CAに届く → 本人へメンション
 * 2) 届かない → 代表へメンション＋注記、代表も引けなければメンションなし＋注記＋エラーログ
 * 3) メンション付き送信が失敗したら、次の段（本人→代表→メンションなし）に切り替えて1回だけ再送
 */
export async function sendBotMessageWithCaMention(
  botId: string,
  channelId: string,
  target: CaMentionTarget,
  render: (mentionId: string | null, note: string | null) => string,
  logScope: string,
): Promise<void> {
  const note = target.unreachedNote;
  const first: { id: string | null; note: string | null; isCa: boolean } = target.caLineworksId
    ? { id: target.caLineworksId, note: null, isCa: true }
    : { id: target.fallbackLineworksId, note, isCa: false };

  if (!first.isCa) {
    if (first.id) {
      console.warn(`[${logScope}] 担当CA（${target.caName ?? "未設定"}）に宛先なし。代表へフォールバック`);
    } else {
      console.error(`[${logScope}] 担当CA（${target.caName ?? "未設定"}）・代表とも宛先なし。メンションなしで送信`);
    }
  }

  try {
    await sendBotMessage(botId, channelId, render(first.id, first.note));
    return;
  } catch (e) {
    if (!first.id) throw e; // メンションなしの送信失敗は宛先起因ではない
    console.warn(`[${logScope}] メンション付き送信に失敗。宛先を切り替えて1回だけ再送:`, e);
  }

  const nextId = first.isCa
    ? (target.fallbackLineworksId ?? (await resolveFallbackLineworksId()))
    : null;
  if (!nextId) {
    console.error(`[${logScope}] 担当CA（${target.caName ?? "未設定"}）に届かず代表も宛先なし。メンションなしで再送`);
  }
  await sendBotMessage(botId, channelId, render(nextId, note));
}
