// T-147: Resend 送信の共通ヘルパ。
// candidate-site-notifications.ts の Resend 直叩き実装（fetch + AbortController 10秒）を
// 汎用化したもの。あちらは既存挙動を変えないためそのまま残している（リファクタしない）。
//
// 呼び出し側の性質でエラーの扱いが違うため、この関数は投げずに ok を返す:
// - セキュア送信の案内メール: 失敗したら送信レコードを作らずエラー表示（fail-closed）
// - 自動無効化の通知メール: 失敗しても無効化自体は成立させる（fail-open）

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "BizStudio <noreply@bizstudio.co.jp>";
const TIMEOUT_MS = 10000;

export type SendMailResult = { ok: true } | { ok: false; error: string };

export async function sendResendEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendMailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    // 既存実装は warn してスキップするが、T-147 は「送れたかどうか」が要件なので失敗として返す
    console.error("[Resend] RESEND_API_KEY not configured");
    return { ok: false, error: "メール送信の設定がされていません（RESEND_API_KEY）" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.status === 200 || res.status === 201) {
      return { ok: true };
    }
    const body = await res.text().catch(() => "");
    console.error(`[Resend] send failed: status=${res.status} body=${body.slice(0, 300)}`);
    return { ok: false, error: `メール送信に失敗しました（HTTP ${res.status}）` };
  } catch (e) {
    console.error("[Resend] send failed:", e);
    return { ok: false, error: "メール送信に失敗しました（通信エラー）" };
  }
}
