/**
 * T-XXX step5A: ログインセッション（bs_session）の新方式の検証。ローカル dev サーバー＋ローカル DB 専用。
 *
 *   前提: scripts/seed-analytics-fixture-t-xxx-step5.ts を流したローカル DB で、dev サーバーを次の環境変数で起動しておく
 *         DATABASE_URL（localhost）/ INTERNAL_API_KEY / AI_READ_API_KEY / MCP_PATH_SECRET（32 文字以上・ローカル専用）/ EXTERNAL_API_SECRET / RPA_API_SECRET
 *   実行: DATABASE_URL=... BASE_URL=http://localhost:3100 INTERNAL_API_KEY=... AI_READ_API_KEY=... MCP_PATH_SECRET=... EXTERNAL_API_SECRET=... RPA_API_SECRET=... \
 *         npx tsx scripts/test-session-auth-t-xxx-step5.ts
 *   秘密の値は表示しない。
 *
 * 確かめること（§D-A）:
 *   ログイン・ログアウト・期限切れ・社員無効化・旧形式 Cookie（User.id）の拒否・形式だけ合う推測トークンの拒否・無効ユーザーのログイン拒否・
 *   Cookie 属性（HttpOnly / SameSite=Lax / Path=/ / Max-Age 7 日）・主要画面の表示（/ と /candidates が 200）・
 *   Cookie 以外の認証（Bearer AI_READ_API_KEY・x-api-key・x-api-secret・x-rpa-secret・MCP 秘密URL）が従来どおり動くこと。
 */
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL がローカルではありません。中止します");
  process.exit(1);
}
import { prisma } from "@/lib/prisma";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} を環境変数で渡してください`);
  return v;
};

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

async function login(email: string, password: string): Promise<{ status: number; cookie: string | null; setCookie: string | null }> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }), redirect: "manual" });
  const setCookie = res.headers.get("set-cookie");
  const m = setCookie ? /bs_session=([^;]*)/.exec(setCookie) : null;
  return { status: res.status, cookie: m && m[1] ? m[1] : null, setCookie };
}
async function session(cookie: string | null): Promise<number> {
  const res = await fetch(`${BASE}/api/auth/session`, { headers: cookie ? { cookie: `bs_session=${cookie}` } : {}, redirect: "manual" });
  return res.status;
}
async function page(path: string, cookie: string | null): Promise<{ status: number; location: string | null; setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie: `bs_session=${cookie}` } : {}, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.get("set-cookie") };
}

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@example.test" } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: "member@example.test" } });

  // 未ログイン
  const p0 = await page("/", null);
  check("[1] 未ログインの画面は /login へ", p0.status === 307 && (p0.location ?? "").includes("/login"), true);
  check("[1] 未ログインの API は 401", await session(null), 401);

  // 誤ったパスワード・無効ユーザー
  check("[2] 誤ったパスワードは 401", (await login("admin@example.test", "wrong")).status, 401);
  check("[2] 無効ユーザーは 401", (await login("disabled@example.test", "pass1234")).status, 401);

  // ログイン
  const a = await login("admin@example.test", "pass1234");
  check("[3] ログイン 200", a.status, 200);
  checkTrue("[3] Cookie が新形式（bss_ + 43 文字）", /^bss_[A-Za-z0-9_-]{43}$/.test(a.cookie ?? ""));
  checkTrue("[3] Cookie に User.id が入っていない", a.cookie !== admin.id);
  const sc = (a.setCookie ?? "").toLowerCase();
  checkTrue("[3] HttpOnly", sc.includes("httponly"), sc.replace(/bs_session=[^;]*/, "bs_session=***"));
  checkTrue("[3] SameSite=Lax", sc.includes("samesite=lax"));
  checkTrue("[3] Path=/", sc.includes("path=/"));
  checkTrue("[3] Max-Age=604800（7 日）", sc.includes("max-age=604800"));
  check("[3] ログイン後の API は 200", await session(a.cookie), 200);
  const dbRow = await prisma.userSession.findFirst({ where: { userId: admin.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
  checkTrue("[3] DB にはハッシュだけ（平文トークンと一致しない・64 hex）", !!dbRow && dbRow.tokenHash !== a.cookie && /^[0-9a-f]{64}$/.test(dbRow.tokenHash));
  checkTrue("[3] 有効期限は約 7 日後", !!dbRow && Math.abs(dbRow.expiresAt.getTime() - dbRow.createdAt.getTime() - 7 * 86_400_000) < 60_000);

  // 主要画面
  const anyCand = await prisma.candidate.findFirstOrThrow({ select: { id: true } });
  for (const path of ["/", "/entries", "/tasks", `/candidates/${anyCand.id}`]) {
    const r = await page(path, a.cookie);
    check(`[4] 主要画面 ${path} が 200`, r.status, 200);
  }

  // 旧形式 Cookie（User.id そのまま）
  check("[5] 旧形式 Cookie（User.id）は API 401", await session(admin.id), 401);
  const old = await page("/", admin.id);
  check("[5] 旧形式 Cookie の画面は /login へ", old.status === 307 && (old.location ?? "").includes("/login"), true);
  checkTrue("[5] 旧形式 Cookie は消される（Set-Cookie で Max-Age=0）", /bs_session=;.*max-age=0/i.test(old.setCookie ?? ""), (old.setCookie ?? "").slice(0, 80));

  // 推測トークン（形式は正しいが DB に無い）
  const guess = "bss_" + "A".repeat(43);
  check("[6] 形式だけ合う推測トークンは 401", await session(guess), 401);
  const g = await page("/", guess);
  // middleware は形式だけ見るので通すが、サーバー側の getSessionUser が null → /login
  check("[6] 推測トークンの画面はログインへ", g.status === 307 && (g.location ?? "").includes("/login"), true);

  // 期限切れ
  await prisma.userSession.update({ where: { id: dbRow!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("[7] 期限切れは 401", await session(a.cookie), 401);
  await prisma.userSession.update({ where: { id: dbRow!.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
  check("[7] 期限を戻すと 200", await session(a.cookie), 200);

  // ログアウト
  const lo = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie: `bs_session=${a.cookie}` }, redirect: "manual" });
  check("[8] ログアウトは 303", lo.status, 303);
  check("[8] ログアウト後は 401", await session(a.cookie), 401);
  const revoked = await prisma.userSession.findUnique({ where: { id: dbRow!.id } });
  check("[8] DB で失効（reason=logout）", revoked?.revokeReason, "logout");

  // 社員の無効化で全セッション失効
  const m1 = await login("member@example.test", "pass1234");
  const m2 = await login("member@example.test", "pass1234");
  check("[9] member 2 セッションとも 200", [await session(m1.cookie), await session(m2.cookie)], [200, 200]);
  const a2 = await login("admin@example.test", "pass1234");
  const dis = await fetch(`${BASE}/api/admin/users/${member.id}/status`, { method: "POST", headers: { "content-type": "application/json", cookie: `bs_session=${a2.cookie}` }, body: JSON.stringify({ status: "disabled" }) });
  check("[9] 無効化 API 200", dis.status, 200);
  check("[9] 無効化後は両方 401", [await session(m1.cookie), await session(m2.cookie)], [401, 401]);
  const cnt = await prisma.userSession.count({ where: { userId: member.id, revokeReason: "user_disabled" } });
  check("[9] 失効理由 user_disabled の行数", cnt, 2);
  check("[9] 無効ユーザーはログインできない", (await login("member@example.test", "pass1234")).status, 401);
  await fetch(`${BASE}/api/admin/users/${member.id}/status`, { method: "POST", headers: { "content-type": "application/json", cookie: `bs_session=${a2.cookie}` }, body: JSON.stringify({ status: "active" }) });
  check("[9] 有効に戻すとログインできる", (await login("member@example.test", "pass1234")).status, 200);

  // Cookie 以外の認証経路（従来どおり）
  const bearer = await fetch(`${BASE}/api/ai/ca-kpi?from=2026-08-01&to=2026-08-31`, { headers: { authorization: `Bearer ${env("AI_READ_API_KEY")}` } });
  check("[10] Bearer AI_READ_API_KEY は 200", bearer.status, 200);
  check("[10] Bearer なしは 401", (await fetch(`${BASE}/api/ai/ca-kpi?from=2026-08-01&to=2026-08-31`)).status, 401);
  const internal = await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=true`, { method: "POST", headers: { "x-api-key": env("INTERNAL_API_KEY") } });
  check("[10] x-api-key（内部定期処理）は 200", internal.status, 200);
  check("[10] x-api-key なしは 401", (await fetch(`${BASE}/api/internal/pipeline-snapshot?dry_run=true`, { method: "POST" })).status, 401);
  const ext = await fetch(`${BASE}/api/external/scout-conditions/current`, { headers: { "x-api-secret": env("EXTERNAL_API_SECRET") } });
  check("[10] x-api-secret（外部連携）は 200", ext.status, 200);
  check("[10] x-api-secret なしは 401", (await fetch(`${BASE}/api/external/scout-conditions/current`)).status, 401);
  const rpa = await fetch(`${BASE}/api/rpa/mynavi/pdf-upload`, { method: "POST", headers: { "x-rpa-secret": "wrong" } });
  check("[10] x-rpa-secret 不一致は 403（Cookie なしで RPA 認証が動いている・この入口は 403 を返す）", rpa.status, 403);
  const mcp = await fetch(`${BASE}/api/mcp/${env("MCP_PATH_SECRET")}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
  });
  check("[10] MCP 秘密URL は 200", mcp.status, 200);
  check("[10] MCP 誤った秘密は 404", (await fetch(`${BASE}/api/mcp/${"x".repeat(48)}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
