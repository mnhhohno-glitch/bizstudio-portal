import { createHmac } from "crypto";

// T-130 Phase2: CA 用「求職者サイトのプレビュー」短命署名URLの生成（portal 側の正）。
//
// 目的:
//   CA が候補者詳細から、その候補者の求職者サイト（/site/）を閲覧専用で開くための
//   短命（15分）の署名付きURLを発行する。mypage 側 /site/preview は本仕様どおりに
//   `pt` を検証し、署名一致 & 未失効なら token のサイトを閲覧専用で表示する。
//
// ── 署名仕様（mypage 側検証はこの定義を「正」とすること）─────────────────────
//
//   1. ペイロード（オブジェクト）:
//        { token: string, exp: number }
//      - token : ShareToken 文字列（kyuujinPDF の /v/{token} の {token} と同一値）
//      - exp   : 失効時刻。Unix エポック「秒」（整数）。発行時刻 + 15分。
//      - キー順は必ず token → exp（下記 JSON 直列化がバイト一致するため）。
//
//   2. payloadJson = JSON.stringify(payload)
//        → 空白なしのコンパクト JSON。例: {"token":"abc","exp":1735732800}
//        （portal も mypage も Next.js/TypeScript のため JSON.stringify の出力は一致する）
//
//   3. body = base64url( utf8(payloadJson) )
//        - base64url = 標準 base64 の「+」→「-」「/」→「_」、末尾「=」パディング除去。
//        - Node では Buffer.from(payloadJson,"utf8").toString("base64url")。
//
//   4. sig = base64url( HMAC_SHA256( key = CANDIDATE_SITE_API_KEY(utf8), message = utf8(body) ) )
//        - 署名対象は「body 文字列そのもの（base64url 済み ASCII 文字列）」であって
//          再直列化した JSON ではない（JSON 正規化差異による不一致を避けるため）。
//        - digest も base64url（パディングなし）。
//
//   5. pt = body + "." + sig
//        - 区切りは ASCII ドット「.」1個。body / sig はどちらも base64url なのでドットを含まない。
//
//   6. URL = `${MYPAGE_PREVIEW_BASE}/site/preview?pt=${pt}`
//        - pt は base64url + "." のみで構成され URL セーフ。追加のパーセントエンコード不要。
//
//   ── mypage 側の検証手順（参考・本ファイルが正）────────────────────────────
//     a. pt を "." で 2 分割して [body, sig] を得る（要素数 2 以外は拒否）。
//     b. expectedSig = base64url(HMAC_SHA256(CANDIDATE_SITE_API_KEY, body)) を計算し、
//        sig と定数時間比較（timingSafeEqual）。不一致は拒否。
//     c. payload = JSON.parse(utf8(base64urlDecode(body)))。
//     d. payload.exp * 1000 < Date.now() なら失効として拒否。
//     e. payload.token を閲覧専用サイトのトークンとして採用。
// ─────────────────────────────────────────────────────────────────────────

/** プレビューURLの有効期間（秒）。発行から 15 分。 */
export const PREVIEW_TTL_SECONDS = 15 * 60;

export type PreviewPayload = { token: string; exp: number };

/**
 * ペイロードを署名して `pt`（body.sig）を返す。署名鍵は CANDIDATE_SITE_API_KEY。
 * key 未設定時は呼び出し側で 500 にできるよう例外を投げる（fail-closed）。
 */
export function signPreviewToken(payload: PreviewPayload, key: string): string {
  if (!key) throw new Error("CANDIDATE_SITE_API_KEY is not set");
  const payloadJson = JSON.stringify({ token: payload.token, exp: payload.exp });
  const body = Buffer.from(payloadJson, "utf8").toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/**
 * 署名付きプレビューURLを組み立てる。
 * @param token   ShareToken 文字列
 * @param key     CANDIDATE_SITE_API_KEY
 * @param nowMs   現在時刻（ミリ秒・Date.now()）。exp = floor(nowMs/1000) + PREVIEW_TTL_SECONDS。
 * @param baseUrl mypage のベースURL（既定 https://mypage.bizstudio.co.jp）
 */
export function buildPreviewUrl(
  token: string,
  key: string,
  nowMs: number,
  baseUrl?: string,
): { url: string; exp: number } {
  const exp = Math.floor(nowMs / 1000) + PREVIEW_TTL_SECONDS;
  const pt = signPreviewToken({ token, exp }, key);
  const base = (baseUrl || "https://mypage.bizstudio.co.jp").replace(/\/+$/, "");
  return { url: `${base}/site/preview?pt=${pt}`, exp };
}

/** kyuujinPDF の `/v/{token}` 形式URLから token 部分を抽出。取れなければ null。 */
export function extractTokenFromMypageUrl(url: string): string | null {
  const m = url.match(/\/v\/([^/?#]+)/);
  return m ? m[1] : null;
}
