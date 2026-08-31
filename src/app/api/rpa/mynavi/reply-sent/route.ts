import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";

export const runtime = "nodejs";

const TEMPLATE_NAME = "【日程調整】初回メッセージ";
const SENDER_NAME = "藤本 夏海";

/**
 * T-169: RPA(PAD) から届く送信日時は **JST の壁時計値**（例 "2026/08/18 23:10:00"）。
 * 旧実装は `new Date(y, mo-1, d, ...)`（＝サーバーのローカル時刻として構築）していたため、
 * Railway 本番コンテナ（TZ=UTC）では JST の壁時計値がそのまま UTC 値として保存され、
 * 真の instant より **9時間進んだ値**が入っていた（罠#17）。
 *
 * ここでは **タイムゾーン表記を持たない入力を JST(+09:00) として解釈**する。
 * 末尾に `Z` / `+09:00` / `+0900` などの TZ 表記を含む入力は従来どおりその表記に従う。
 * パースできない入力の挙動（現在時刻を返す）は変更しない。
 * 罠#17: `toISOString().slice()` 系の変換は使わない。
 */
function parseDateLoose(value: unknown): Date {
  if (!value) return new Date();
  const s = String(value).trim();
  if (!s) return new Date();

  const hasTz = /([zZ])$|([+-]\d{2}:?\d{2})$/.test(s);
  if (!hasTz) {
    // "2026/08/18 23:10:00" / "2026-08-18 23:10:00" / "2026-08-18T23:10:00" / 日付のみ
    const m = s.match(
      /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?)?$/,
    );
    if (m) {
      const p = (n: string | undefined) => String(Number(n ?? 0)).padStart(2, "0");
      const jst = new Date(
        `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}+09:00`,
      );
      if (!isNaN(jst.getTime())) return jst;
    }
    const withJst = new Date(`${s}+09:00`);
    if (!isNaN(withJst.getTime())) return withJst;
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * T-167: 送信結果はフェイルクローズで判定する。
 * 以前は `sendResult === "FAILURE"` 以外を全て SUCCESS とみなしていたため、
 * RPA が実際に送っていた "FAILED" / 空文字 / 変数展開失敗（"%送信結果%"）/
 * フィールド欠落が全て「送信成功」として永久記録されていた。
 * ここでは **"SUCCESS" に一致したときだけ成功**とし、それ以外は全て失敗にする。
 * 保存する値は必ず "SUCCESS" または "FAILED" のどちらかに正規化する（生値は保存しない）。
 */
function normalizeSendResult(raw: unknown): "SUCCESS" | "FAILED" {
  if (raw === null || raw === undefined) return "FAILED";
  return String(raw).trim().toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED";
}

/**
 * POST /api/rpa/mynavi/reply-sent
 * RPA が一次返信を送信した後の完了通知。処理ログを更新し設定履歴を追加する。
 */
export async function POST(req: Request) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await parseRpaRequestBody(req);

    const processingLogId: string = String(body?.processingLogId || "");
    const rawSendResult: unknown = body?.sendResult;
    const sendResult = normalizeSendResult(rawSendResult);
    const sentAt: Date = parseDateLoose(body?.sentAt);

    // T-167: 正常系でも受信した生値を必ずログに残す（事後検証のため）。
    console.log(
      "[rpa/mynavi/reply-sent] received:",
      JSON.stringify({
        processingLogId,
        rawSendResult:
          rawSendResult === undefined ? "(missing)" : rawSendResult,
        rawSendResultType: typeof rawSendResult,
        normalized: sendResult,
        rawSentAt: body?.sentAt ?? null,
      }),
    );

    if (!processingLogId) {
      console.error("[rpa/mynavi/reply-sent] processingLogId missing. body:", JSON.stringify(body));
      return NextResponse.json(
        { error: "processingLogId は必須です" },
        { status: 400 },
      );
    }

    const log = await prisma.mynaviRpaProcessingLog.findUnique({
      where: { id: processingLogId },
      select: { id: true, candidateId: true },
    });
    if (!log) {
      return NextResponse.json(
        { error: "指定された処理ログが見つかりません" },
        { status: 404 },
      );
    }

    const candidateId: string | null =
      (body?.candidateId ? String(body.candidateId) : null) || log.candidateId;

    // 失敗時は replySentAt を更新しない（送信していないものに送信日時を残さない）。
    await prisma.mynaviRpaProcessingLog.update({
      where: { id: processingLogId },
      data:
        sendResult === "SUCCESS"
          ? { replySentAt: sentAt, replyResult: sendResult }
          : { replyResult: sendResult },
    });

    if (sendResult === "FAILED") {
      console.error(
        "[rpa/mynavi/reply-sent] 送信失敗として記録しました:",
        JSON.stringify({
          processingLogId,
          candidateId,
          rawSendResult:
            rawSendResult === undefined ? "(missing)" : rawSendResult,
        }),
      );
    }

    if (candidateId) {
      const candidate = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true },
      });
      if (candidate) {
        await prisma.candidateSettingsHistory.create({
          data: {
            candidateId,
            sentAt,
            sendType: "MYNAVI_FIRST_REPLY",
            sendResult,
            templateName: TEMPLATE_NAME,
            senderName: SENDER_NAME,
          },
        });
      }
    }

    // 失敗でも 200 を返す（RPA 側のフローを止めないため）。
    // 保存した結果値を返し、RPA 側のログから portal の解釈を確認できるようにする。
    return NextResponse.json({ ok: true, sendResult });
  } catch (e) {
    console.error("[rpa/mynavi/reply-sent] error:", e);
    const message = e instanceof Error ? e.message : String(e);
    await notifyMynaviError(`一次返信完了通知の処理に失敗しました`, { detail: message });
    return NextResponse.json(
      { error: `予期しないエラー: ${message}` },
      { status: 500 },
    );
  }
}
