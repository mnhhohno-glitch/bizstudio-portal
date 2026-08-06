/* eslint-disable @typescript-eslint/no-explicit-any --
   検証スクリプトは API レスポンスを素の JSON として扱う（本体の型に追随させない）。 */
// T-147: 送信控えメール（2026-08-06 改修）の動作確認。
//
// 実行: npx tsx scripts/verify_t147_copy.ts production
//
// 控えON / 控えOFF で1回ずつ送信し、レスポンスの copyRequested / copySent を確認する。
// 受信者宛メールが従来どおり届き、URL+パスワードでDLできることもあわせて確認する。
// ★作成したレコードは無効化せず残す（テストレコード保持の指定）。
// ★送信先は TEST_ADDRESS のみ。他アドレスが混ざったら即異常終了。

const ACTOR_USER_ID = "cml9jturt00037k4ftqsi6yvz"; // 大野 将幸（admin）
const TEST_ADDRESS = "masayuki_oono@bizstudio.co.jp"; // ★これ以外へは絶対に送らない

const HOSTS: Record<string, string> = {
  staging: "https://bizstudio-portal-staging-production.up.railway.app",
  production: "https://bizstudio-portal-production.up.railway.app",
};
const target = process.argv[2] ?? "production";
const BASE = HOSTS[target];
if (!BASE) {
  console.error(`unknown target: ${target}`);
  process.exit(1);
}
const UA = "bizstudio-portal-verify/1.0";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) pass++;
  else fail++;
  console.log(`[${ok ? "OK" : "NG"}] ${id}  ${detail}`);
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Cookie: `bs_session=${ACTOR_USER_ID}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML 等 */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function pub(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { "User-Agent": UA, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML 等 */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** 1件アップロードして1通送る。sendCopyToSender を切り替えて検証する。 */
async function send(label: string, sendCopyToSender: boolean) {
  const fileName = `t147-copy-${sendCopyToSender ? "on" : "off"}-${target}.txt`;
  const content = Buffer.from(`T-147 copy mail verification (${label})\n`, "utf8");

  const up = await api("/api/transfers/upload-url", {
    method: "POST",
    body: JSON.stringify({ fileName, fileSize: content.length }),
  });
  if (up.status !== 200 || !up.json?.signedUrl) {
    console.error("upload-url failed:", up.status, up.text.slice(0, 200));
    process.exit(1);
  }
  const put = await fetch(up.json.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain", "User-Agent": UA },
    body: content,
  });
  if (!put.ok) {
    console.error("supabase upload failed:", put.status);
    process.exit(1);
  }

  for (const a of [TEST_ADDRESS]) {
    if (a !== TEST_ADDRESS) {
      console.error("SAFETY ABORT");
      process.exit(1);
    }
  }

  return api("/api/transfers", {
    method: "POST",
    body: JSON.stringify({
      recipientEmails: [TEST_ADDRESS],
      ccEmails: [TEST_ADDRESS],
      subject: `T-147 控え検証 ${label} (${target})`,
      message: "控えメールの動作確認です。この本文が控えにも全文入ります。",
      signature: "──\n株式会社ビズスタジオ 大野 将幸\nmasayuki_oono@bizstudio.co.jp",
      expiresDays: 1,
      passwordInEmail: true,
      sendCopyToSender,
      files: [{ fileName, fileSize: content.length, storagePath: up.json.storagePath }],
    }),
  });
}

async function main() {
  console.log(`\n=== T-147 送信控えメール 動作確認 (${target}) ===`);
  console.log(`base=${BASE}\n`);

  // -------------------------------------------------- 控え ON
  const on = await send("控えON", true);
  if (on.status !== 201) {
    console.error("send(copy on) failed:", on.status, on.text.slice(0, 400));
    process.exit(1);
  }
  check(
    "C-1 控えON: 控えの送信を要求し、送信に成功している",
    on.json.copyRequested === true && on.json.copySent === true,
    `copyRequested=${on.json.copyRequested} copySent=${on.json.copySent} transferId=${on.json.id}`
  );

  // -------------------------------------------------- 相手宛メールと DL（従来どおり）
  const token = String(on.json.url).split("/transfer/")[1];
  const password = String(on.json.password);
  const st = await pub(`/api/transfer/${token}/status`);
  const vf = await pub(`/api/transfer/${token}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const cookie = (vf.headers.get("set-cookie") ?? "").split(";")[0];
  const fileId = vf.json?.files?.[0]?.id;
  let dl = 0;
  let signed = false;
  if (fileId && cookie) {
    const d = await pub(`/api/transfer/${token}/download/${fileId}`, { headers: { Cookie: cookie } });
    dl = d.status;
    signed = (d.headers.get("location") ?? "").includes("supabase");
  }
  check(
    "C-2 相手宛メールは従来どおり: URL+パスワードでDLできる",
    st.json?.available === true && vf.status === 200 && (dl === 302 || dl === 307) && signed,
    `status=${st.json?.available} verify=${vf.status} download=${dl} 署名URL=${signed}`
  );

  // -------------------------------------------------- 控え OFF
  const off = await send("控えOFF", false);
  if (off.status !== 201) {
    console.error("send(copy off) failed:", off.status, off.text.slice(0, 400));
    process.exit(1);
  }
  check(
    "C-3 控えOFF: 控えを送らない",
    off.json.copyRequested === false && off.json.copySent === false,
    `copyRequested=${off.json.copyRequested} copySent=${off.json.copySent} transferId=${off.json.id}`
  );

  // -------------------------------------------------- /share 回帰
  const shareBad = await pub("/share/definitely-not-a-real-token-t147");
  const shareApi = await pub("/api/share/definitely-not-a-real-token-t147");
  check(
    "C-4 /share/[token] が従来どおり応答する",
    (shareBad.status === 200 || shareBad.status === 404) && shareApi.status !== 500,
    `/share status=${shareBad.status} /api/share status=${shareApi.status}`
  );

  // -------------------------------------------------- テストレコードを残す
  const d1 = await api(`/api/transfers/${on.json.id}`);
  const d2 = await api(`/api/transfers/${off.json.id}`);
  check(
    "C-5 テストレコードを無効化せず残している",
    d1.json?.status === "active" &&
      d1.json?.revokedAt === null &&
      d2.json?.status === "active" &&
      d2.json?.revokedAt === null,
    `控えON=${d1.json?.status} / 控えOFF=${d2.json?.status}`
  );

  console.log(`\n--- 結果: ${pass} OK / ${fail} NG ---`);
  console.log(`控えON transferId=${on.json.id}`);
  console.log(`控えOFF transferId=${off.json.id}`);
  console.log(`※ 控えメールの実物（パスワード非記載）は Resend ダッシュボードで確認する`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
