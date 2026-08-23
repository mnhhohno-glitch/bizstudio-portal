// T-147: Resend 送信の共通ヘルパ。
// candidate-site-notifications.ts の Resend 直叩き実装（fetch + AbortController 10秒）を
// 汎用化したもの。あちらは既存挙動を変えないためそのまま残している（リファクタしない）。
//
// 呼び出し側の性質でエラーの扱いが違うため、この関数は投げずに ok を返す:
// - セキュア送信の案内メール: 失敗したら送信レコードを作らずエラー表示（fail-closed）
// - 自動無効化の通知メール: 失敗しても無効化自体は成立させる（fail-open）

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "株式会社ビズスタジオ <noreply@bizstudio.co.jp>";
const TIMEOUT_MS = 10000;

/** Resend でドメイン認証（SPF/DKIM）済みのドメイン。ここ以外を From にすると不達・迷惑メール行きになる。 */
const VERIFIED_FROM_DOMAIN = "@bizstudio.co.jp";

// From ヘッダの表示名に混ぜてはいけない文字（ヘッダインジェクション・アドレス構文の破壊を防ぐ）
const UNSAFE_DISPLAY_NAME_CHARS = /[<>"'`,;:\\\r\n]/g;

/**
 * 送信ユーザー本人を From にするための値（`名前 <addr@bizstudio.co.jp>`）を組み立てる。
 *
 * Resend のドメイン認証は bizstudio.co.jp 単位のため、**そのドメインのアドレスのときだけ**返す。
 * 他ドメイン・取得不可のときは null を返し、呼び出し側で既定の noreply + Reply-To に倒すこと
 * （他ドメインを From にすると SPF/DKIM 不一致で不達・迷惑メール行きになる）。
 */
export function buildSenderFrom(
  email: string | null | undefined,
  name?: string | null
): string | null {
  const addr = email?.trim();
  if (!addr) return null;
  if (!addr.toLowerCase().endsWith(VERIFIED_FROM_DOMAIN)) return null;
  // 制御文字や区切り文字が入っていたら諦める（アドレス自体は加工しない）
  if (/[\s<>",;:\\]/.test(addr)) return null;

  const displayName = (name ?? "").replace(UNSAFE_DISPLAY_NAME_CHARS, "").trim();
  return displayName ? `${displayName} <${addr}>` : addr;
}

// staging（本番以外）からの誤送信対策: 件名の先頭に【検証】を自動付与する。
// 専用の環境判別の仕組みは無いため、Railway のサービス名か PORTAL_BASE_URL に
// "staging" が含まれるかで判定する（staging サービスは両方とも staging を含む）。
// どちらも判定できない場合は「付けない」側に倒す（本番に【検証】が付く事故を防ぐ）。
function isStagingEnv(): boolean {
  const service = process.env.RAILWAY_SERVICE_NAME || "";
  const baseUrl = process.env.PORTAL_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  return service.includes("staging") || baseUrl.includes("staging");
}

export type SendMailResult = { ok: true } | { ok: false; error: string };

export async function sendResendEmail(params: {
  to: string | string[]; // 複数指定するとその全員が TO に並ぶ1通になる
  cc?: string[]; // CC。空配列・未指定なら cc ヘッダ自体を付けない
  subject: string;
  text: string;
  replyTo?: string; // 受信者が返信したとき届くアドレス（例: 送信者本人の User.email）
  // 差出人。未指定なら既定の noreply。bizstudio.co.jp 以外を渡してはいけない（buildSenderFrom で作る）
  from?: string;
}): Promise<SendMailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    // 既存実装は warn してスキップするが、T-147 は「送れたかどうか」が要件なので失敗として返す
    console.error("[Resend] RESEND_API_KEY not configured");
    return { ok: false, error: "メール送信の設定がされていません（RESEND_API_KEY）" };
  }

  const subject = isStagingEnv() ? `【検証】${params.subject}` : params.subject;

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
        from: params.from?.trim() || FROM,
        to: Array.isArray(params.to) ? params.to : [params.to],
        ...(params.cc && params.cc.length > 0 ? { cc: params.cc } : {}),
        subject,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
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
