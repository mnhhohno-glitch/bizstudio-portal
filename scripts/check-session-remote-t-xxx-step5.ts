/**
 * T-XXX step5A: staging / 本番の URL でログインセッションの新方式を確かめる（DB には触らない・画面と API だけ）。
 *
 *   BASE_URL=https://<host> CHECK_EMAIL=<確認用ユーザー> CHECK_PASSWORD=<その人のパスワード> npx tsx scripts/check-session-remote-t-xxx-step5.ts
 *   （ログインを試さず、旧 Cookie の拒否と未認証の挙動だけ見るときは CHECK_EMAIL を省略）
 *
 * メール・パスワード・Cookie の値は表示しない。
 * 確かめること: 未認証 → /login、旧形式 Cookie（User.id 風）→ 拒否して Cookie を消す、誤ったパスワード → 401、
 *               ログイン → Cookie は新形式・HttpOnly・Secure・SameSite=Lax・Max-Age 7 日、主要画面 200、ログアウト → 以後 401、
 *               Bearer なし → 401、MCP の誤った秘密 → 404。
 */
const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error("BASE_URL を環境変数で渡してください");
  process.exit(1);
}
const EMAIL = process.env.CHECK_EMAIL;
const PASSWORD = process.env.CHECK_PASSWORD;

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}
function checkTrue(label: string, cond: boolean, detail = ""): void {
  checks++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}
const mask = (s: string | null) => (s ?? "").replace(/bs_session=[^;]*/g, "bs_session=***");

async function page(path: string, cookie: string | null) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie: `bs_session=${cookie}` } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.get("set-cookie") };
}
async function session(cookie: string | null): Promise<number> {
  const res = await fetch(`${BASE}/api/auth/session`, { headers: cookie ? { cookie: `bs_session=${cookie}` } : {}, redirect: "manual" });
  return res.status;
}

async function main() {
  const p0 = await page("/", null);
  check("[1] 未認証の画面は /login へ", p0.status === 307 && (p0.location ?? "").includes("/login"), true);
  check("[1] 未認証の API は 401", await session(null), 401);

  const oldStyle = "cmg1234567890abcdefghijkl"; // User.id（cuid）風の旧形式
  check("[2] 旧形式 Cookie は API 401", await session(oldStyle), 401);
  const old = await page("/", oldStyle);
  check("[2] 旧形式 Cookie の画面は /login へ", old.status === 307 && (old.location ?? "").includes("/login"), true);
  checkTrue("[2] 旧形式 Cookie は消される（Max-Age=0）", /bs_session=;.*max-age=0/i.test(old.setCookie ?? ""), mask(old.setCookie).slice(0, 80));
  check("[2] 形式だけ合う推測トークンは 401", await session("bss_" + "A".repeat(43)), 401);

  const wrong = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.invalid", password: "x" }) });
  check("[3] 誤ったログインは 401", wrong.status, 401);

  const bearerless = (await fetch(`${BASE}/api/ai/ca-kpi?from=2026-08-01&to=2026-08-31`)).status;
  checkTrue("[4] Bearer なしの AI 読み取り API は 401（鍵未設定の環境では 503・どちらも拒否）", bearerless === 401 || bearerless === 503, String(bearerless));
  check("[4] x-api-key なしの内部 API は 401", (await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=true`, { method: "POST" })).status, 401);
  check("[4] MCP の誤った秘密は 404", (await fetch(`${BASE}/api/mcp/${"x".repeat(48)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);

  if (EMAIL && PASSWORD) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }), redirect: "manual" });
    check("[5] ログイン 200", res.status, 200);
    const sc = res.headers.get("set-cookie") ?? "";
    const cookie = /bs_session=([^;]*)/.exec(sc)?.[1] ?? null;
    checkTrue("[5] Cookie が新形式", /^bss_[A-Za-z0-9_-]{43}$/.test(cookie ?? ""));
    const l = sc.toLowerCase();
    checkTrue("[5] HttpOnly / Secure / SameSite=Lax / Path=/ / Max-Age=604800", l.includes("httponly") && l.includes("secure") && l.includes("samesite=lax") && l.includes("path=/") && l.includes("max-age=604800"), mask(sc));
    check("[5] ログイン後の API は 200", await session(cookie), 200);
    for (const path of ["/", "/entries", "/tasks", "/announcements"]) {
      const r = await page(path, cookie);
      check(`[5] 主要画面 ${path} が 200`, r.status, 200);
    }
    const lo = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie: `bs_session=${cookie}` }, redirect: "manual" });
    check("[6] ログアウトは 303", lo.status, 303);
    check("[6] ログアウト後は 401", await session(cookie), 401);
  } else {
    console.log("（CHECK_EMAIL / CHECK_PASSWORD が無いのでログイン〜ログアウトは省略）");
  }

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e instanceof Error ? e.message : e);
  process.exit(1);
});
