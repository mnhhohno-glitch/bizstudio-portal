// T-206 step1: 本番での動作確認（外部 API・内部 API・閲覧記録・入力ロック・410 の 3 種類・90 日超トークン）。
//   実行: npx tsx --env-file=.env --env-file=<MENSETSU_API_SECRET / MENSETSU_TOKEN_SECRET を書いた env> scripts/t206-prod-check.ts
//   - 内部 API はログイン画面を操作せず、テスト用のセッション行（user_sessions）を作って Cookie で呼ぶ。終わったら削除する
//   - テスト求職者「大野テスト」（candidateNumber 5999999）にテスト用の記録を作り、最後に削除する
//     ただし step2 の確認用に「step2確認用」（公開中）と「step2確認用（停止）」の 2 件は残す
//   - 岡野様の記録（jb6oFtu）は読むだけ（閲覧記録が増えないことを確認）
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { addDaysYmd, jstMidnight, todayJst } from "../src/lib/mensetsu/dates";

const BASE = (process.env.T206_PORTAL_BASE || "https://bizstudio-portal-production.up.railway.app").replace(/\/+$/, "");
const API_SECRET = process.env.MENSETSU_API_SECRET!;
const TOKEN_SECRET = process.env.MENSETSU_TOKEN_SECRET!;
const TEST_CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk"; // 大野テスト
const TEST_CLOSED_ENTRY_ID = "cmrcnguly00001doj6zv7smqf"; // 大野テストのアーカイブ済み（書類見送り）エントリー
const OKANO_SLUG = "jb6oFtu";
const OKANO_HTML_PATH = "C:/bizstudio/bizstudio-mensetsu/public/jb6oFtu.html";
const MENSETSU_ENV_LOCAL = "C:/bizstudio/bizstudio-mensetsu/.env.local";
const UA_BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_LINE_PREVIEW = "facebookexternalhit/1.1;line-poker/1.0";

const TEST_HTML_V1 = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>T-206 test</title></head><body><h1>T-206 テスト資料 v1</h1><p>MARK_V1</p></body></html>`;
const TEST_HTML_V2 = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>T-206 test</title></head><body><h1>T-206 テスト資料 v2</h1><p>MARK_V2</p></body></html>`;

if (!API_SECRET || !TOKEN_SECRET) {
  console.error("MENSETSU_API_SECRET / MENSETSU_TOKEN_SECRET が未設定です");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  NG  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  }
}

type Resp = { status: number; json: Record<string, unknown> };
async function ext(method: string, path: string, opts: { secret?: string | null; token?: string | null; ua?: string | null; body?: unknown } = {}): Promise<Resp> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = opts.secret === undefined ? API_SECRET : opts.secret;
  if (secret) headers["x-api-secret"] = secret;
  if (opts.token) headers["x-viewer-token"] = opts.token;
  if (opts.ua) headers["x-viewer-ua"] = opts.ua;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

let sessionCookie = "";
async function internal(method: string, path: string, body?: unknown): Promise<Resp> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

type Row = Record<string, any>;
const pageOf = (r: Resp) => r.json.page as Row;

async function dbPage(id: string) {
  return prisma.interviewPrepPage.findUniqueOrThrow({ where: { id }, select: { viewCount: true, firstViewedAt: true, lastViewedAt: true, expiresAt: true, status: true, verifyLockedUntil: true, verifyFailCount: true } });
}

function oldToken(pageId: string, daysAgo: number): string {
  const issuedAt = Date.now() - daysAgo * 86400000;
  const sig = createHmac("sha256", TOKEN_SECRET).update(`${pageId}.${issuedAt}`).digest("base64url");
  return `${pageId}.${issuedAt}.${sig}`;
}

async function main() {
  console.log(`[t206-prod-check] base=${BASE}`);
  const createdPageIds: string[] = [];
  let sessionId: string | null = null;
  const keep: { slug: string; title: string }[] = [];

  try {
    // ---------------------------------------------------------------- A. 岡野様（本人確認なし）
    console.log("\n== A. 岡野様 jb6oFtu（本人確認なし・移行確認）");
    const okanoBefore = await prisma.interviewPrepPage.findUniqueOrThrow({ where: { slug: OKANO_SLUG }, select: { id: true, viewCount: true, firstViewedAt: true } });
    const okanoHtml = readFileSync(OKANO_HTML_PATH, "utf8");
    const a1 = await ext("GET", `/api/external/mensetsu/pages/${OKANO_SLUG}`);
    check("A1 正しい秘密・UAなし → 200", a1.status === 200, a1);
    check("A2 html が public/jb6oFtu.html と一致（useWrapper=false）", a1.json.html === okanoHtml, { len: String(a1.json.html ?? "").length, expected: okanoHtml.length });
    check("A3 expiresAt = 2026-10-30 0:00 JST", a1.json.expiresAt === "2026-10-29T15:00:00.000Z", a1.json.expiresAt);
    const okanoAfter = await prisma.interviewPrepPage.findUniqueOrThrow({ where: { slug: OKANO_SLUG }, select: { viewCount: true, firstViewedAt: true } });
    check("A4 UAなしでは閲覧記録が増えない", okanoAfter.viewCount === okanoBefore.viewCount && okanoAfter.firstViewedAt === null, okanoAfter);
    const a5 = await ext("GET", `/api/external/mensetsu/pages/${OKANO_SLUG}`, { secret: null });
    check("A5 秘密なし → 401", a5.status === 401, a5);
    const a6 = await ext("GET", `/api/external/mensetsu/pages/${OKANO_SLUG}`, { secret: "wrong-secret" });
    check("A6 秘密不一致 → 401", a6.status === 401, a6);
    const a7 = await ext("GET", `/api/external/mensetsu/pages/zzzzzz9`);
    check("A7 存在しない slug → 404", a7.status === 404, a7);
    const a8 = await ext("GET", `/api/external/mensetsu/pages/not-a-slug`);
    check("A8 形式外の slug → 404", a8.status === 404, a8);
    const a9 = await ext("POST", `/api/external/mensetsu/pages/${OKANO_SLUG}/verify`, { secret: null, body: { birthdate: "19970803" } });
    check("A9 verify 秘密なし → 401", a9.status === 401, a9);

    // ---------------------------------------------------------------- B. テスト用セッション
    console.log("\n== B. 内部 API 用のテストセッション");
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin", status: "active", name: { contains: "大野" } }, select: { id: true, name: true } });
    const rawToken = "bss_" + randomBytes(32).toString("base64url");
    const now = new Date();
    const session = await prisma.userSession.create({
      data: { userId: admin.id, tokenHash: createHash("sha256").update(rawToken, "utf8").digest("hex"), expiresAt: new Date(now.getTime() + 60 * 60 * 1000), createdAt: now, lastUsedAt: now },
      select: { id: true },
    });
    sessionId = session.id;
    sessionCookie = `bs_session=${rawToken}`;
    const b0 = await fetch(`${BASE}/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`);
    check("B0 未ログインで内部 API → 403", b0.status === 403, b0.status);
    const b1 = await internal("GET", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`);
    check("B1 ログイン済みで一覧 → 200", b1.status === 200, b1);
    const cand = b1.json.candidate as Row;
    check("B2 一覧に candidate.name / hasBirthday=true", cand?.name === "大野 テスト" && cand?.hasBirthday === true, cand);
    const entries = b1.json.entries as Row[];
    const closedEntry = entries.find((e) => e.id === TEST_CLOSED_ENTRY_ID);
    check("B3 一覧の entries にアーカイブ済み（書類見送り）エントリーが closed=true", closedEntry?.closed === true, closedEntry);

    // ---------------------------------------------------------------- C. アップロード→下書き→プレビュー→公開
    console.log("\n== C. アップロード → 下書き → プレビュー → 公開");
    const c1 = await internal("POST", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`, { stage: "一次面接", entryId: null, interviewDate: "2026-10-10", html: TEST_HTML_V1, title: "T-206テストA" });
    check("C1 下書き作成 → 201 status=draft", c1.status === 201 && pageOf(c1).status === "draft", c1);
    const A = pageOf(c1);
    createdPageIds.push(A.id);
    check("C2 slug は英数 7 文字", /^[A-Za-z0-9]{7}$/.test(A.slug), A.slug);
    const c3 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`);
    check("C3 下書きは外部 API で 404", c3.status === 404, c3);
    const c4 = await internal("GET", `/api/mensetsu-pages/${A.id}/preview`);
    const c4html = String(c4.json.html ?? "");
    check("C4 プレビュー → 200・共通ヘッダー（氏名）入り", c4.status === 200 && c4html.includes("大野 テスト様 専用ページ"), c4.status);
    check("C5 プレビューに検索除け・フッター入り", c4html.includes('name="robots" content="noindex, nofollow, noarchive"') && c4html.includes("bzs-wrap-footer") && c4html.includes("MARK_V1"));
    const c6 = await internal("POST", `/api/mensetsu-pages/${A.id}/publish`);
    const today = todayJst();
    const expectedExpires = jstMidnight(addDaysYmd(today, 30)).toISOString();
    check("C6 公開 → 200 status=published", c6.status === 200 && pageOf(c6).status === "published", c6);
    check("C7 expiresAt = 今日+30日の 0:00 JST", pageOf(c6).expiresAt === expectedExpires, { got: pageOf(c6).expiresAt, expectedExpires });
    check("C8 表示最終日 = 今日+29日", pageOf(c6).lastViewableDay === addDaysYmd(today, 29), pageOf(c6).lastViewableDay);
    check("C9 公開 URL = MENSETSU_PUBLIC_BASE_URL/slug", pageOf(c6).publicUrl === `https://mensetsu.bizstudio.co.jp/${A.slug}`, pageOf(c6).publicUrl);
    const guide = String(pageOf(c6).guideMessage ?? "");
    check("C10 案内文に URL・公開期限・初回の生年月日案内", guide.startsWith("大野さん\n一次面接に向けた対策資料をお送りします。") && guide.includes(pageOf(c6).publicUrl) && guide.includes("初回のみ、ご本人確認のため生年月日の入力をお願いします。"), guide);
    const c11 = await internal("POST", `/api/mensetsu-pages/${A.id}/publish`);
    check("C11 公開済みをもう一度公開 → 400 not_draft", c11.status === 400 && c11.json.error === "not_draft", c11);

    // ---------------------------------------------------------------- D. 本人確認
    console.log("\n== D. 本人確認（トークンなし 403 / 不一致 400 / 5 回で 429 / ロック解除 / 表記ゆれ）");
    const d1 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { ua: UA_BROWSER });
    check("D1 トークンなし → 403 verify", d1.status === 403 && d1.json.reason === "verify", d1);
    check("D2 403 の本文に中身・氏名が無い", !("html" in d1.json) && !JSON.stringify(d1.json).includes("大野"), d1.json);
    let after = await dbPage(A.id);
    check("D3 403 では閲覧数が増えない", after.viewCount === 0, after);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1999/01/01" } });
      statuses.push(r.status);
    }
    check("D4 不一致 4 回 → すべて 400", statuses.every((s) => s === 400), statuses);
    const d5 = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1999/01/01" } });
    check("D5 5 回目 → 429 locked（until あり）", d5.status === 429 && d5.json.reason === "locked" && typeof d5.json.until === "string", d5);
    const d6 = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/05" } });
    check("D6 ロック中は正しい値でも 429（照合しない）", d6.status === 429, d6);
    const d7 = await internal("GET", `/api/mensetsu-pages/${A.id}`);
    check("D7 一覧行に verifyLockedUntil が入る", typeof pageOf(d7).verifyLockedUntil === "string", pageOf(d7).verifyLockedUntil);
    const d8 = await internal("POST", `/api/mensetsu-pages/${A.id}/unlock`);
    check("D8 ロック解除 → verifyLockedUntil=null", d8.status === 200 && pageOf(d8).verifyLockedUntil === null, d8);
    after = await dbPage(A.id);
    check("D9 ロック解除で失敗回数も 0", after.verifyFailCount === 0 && after.verifyLockedUntil === null, after);
    const tokens: string[] = [];
    for (const input of ["1983/05/05", "1983-05-05", "１９８３０５０５", "1983年5月5日", "19830505"]) {
      const r = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: input } });
      check(`D10 一致（${input}）→ 200 token・maxAgeSeconds=7776000`, r.status === 200 && typeof r.json.token === "string" && r.json.maxAgeSeconds === 7776000, r);
      if (typeof r.json.token === "string") tokens.push(r.json.token);
    }
    const tokenA = tokens[0];
    const d11 = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/06" } });
    check("D11 一致後の不一致 → 400（回数は 1 から）", d11.status === 400 && d11.json.reason === "mismatch", d11);
    await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/05" } }); // リセット

    // ---------------------------------------------------------------- E. 閲覧記録
    console.log("\n== E. 閲覧記録（トークン＋通常UA で増える／LINE プレビュー UA・UA なし・トークンなし・別記録のトークン・90 日超は増えない）");
    const e1 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    const e1html = String(e1.json.html ?? "");
    check("E1 トークン付き → 200・共通ヘッダー・フッター・検索除け入り", e1.status === 200 && e1html.includes("大野 テスト様 専用ページ") && e1html.includes("bzs-wrap-footer") && e1html.includes('name="robots"') && e1html.includes("MARK_V1"), e1.status);
    after = await dbPage(A.id);
    check("E2 閲覧数 1・firstViewedAt/lastViewedAt あり", after.viewCount === 1 && !!after.firstViewedAt && !!after.lastViewedAt, after);
    const firstViewedAt = after.firstViewedAt;
    const e3 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_LINE_PREVIEW });
    after = await dbPage(A.id);
    check("E3 LINE プレビュー UA → 200 だが閲覧数は増えない", e3.status === 200 && after.viewCount === 1, { status: e3.status, viewCount: after.viewCount });
    const e4 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA });
    after = await dbPage(A.id);
    check("E4 UA なし → 200 だが増えない", e4.status === 200 && after.viewCount === 1, { status: e4.status, viewCount: after.viewCount });
    const e5 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { ua: UA_BROWSER });
    after = await dbPage(A.id);
    check("E5 トークンなし → 403・増えない", e5.status === 403 && after.viewCount === 1, { status: e5.status, viewCount: after.viewCount });
    const e6 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    after = await dbPage(A.id);
    check("E6 2 回目の閲覧 → 閲覧数 2・firstViewedAt は変わらない", e6.status === 200 && after.viewCount === 2 && after.firstViewedAt?.getTime() === firstViewedAt?.getTime(), after);
    // 別の記録 B を作って公開し、そのトークンで A を開く
    const cB = await internal("POST", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`, { stage: "最終面接", entryId: null, html: TEST_HTML_V1, title: "T-206テストB" });
    const B = pageOf(cB);
    createdPageIds.push(B.id);
    await internal("POST", `/api/mensetsu-pages/${B.id}/publish`);
    const vB = await ext("POST", `/api/external/mensetsu/pages/${B.slug}/verify`, { body: { birthdate: "1983/05/05" } });
    const tokenB = String(vB.json.token);
    const e7 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenB, ua: UA_BROWSER });
    after = await dbPage(A.id);
    check("E7 別の記録のトークン → 403・増えない", e7.status === 403 && after.viewCount === 2, { status: e7.status, viewCount: after.viewCount });
    const e8 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: oldToken(A.id, 91), ua: UA_BROWSER });
    check("E8 発行から 91 日のトークン → 403", e8.status === 403 && e8.json.reason === "verify", e8);
    const e9 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: oldToken(A.id, 89), ua: UA_BROWSER });
    after = await dbPage(A.id);
    check("E9 発行から 89 日のトークン（同じ秘密で署名）→ 200・閲覧数 3", e9.status === 200 && after.viewCount === 3, { status: e9.status, viewCount: after.viewCount });
    const e10 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA.slice(0, -3) + "xyz", ua: UA_BROWSER });
    check("E10 署名を改ざんしたトークン → 403", e10.status === 403, e10);
    // ポータルのプレビュー（PC 幅・スマホ幅は同じ API。2 回呼ぶ）
    await internal("GET", `/api/mensetsu-pages/${A.id}/preview`);
    await internal("GET", `/api/mensetsu-pages/${A.id}/preview?version=1`);
    after = await dbPage(A.id);
    check("E11 ポータルのプレビューでは閲覧数が増えない（3 のまま）", after.viewCount === 3, after.viewCount);

    // ---------------------------------------------------------------- F. 差し替え・版・延長・停止・再公開・PATCH
    console.log("\n== F. 差し替え → 版の履歴 → 延長 → 停止 → 再公開 → 項目変更");
    const f1 = await internal("POST", `/api/mensetsu-pages/${A.id}/preview`, { html: TEST_HTML_V2 });
    check("F1 未保存 HTML のプレビュー → 200・ヘッダー入り・MARK_V2", f1.status === 200 && String(f1.json.html).includes("MARK_V2") && String(f1.json.html).includes("bzs-wrap-header"), f1.status);
    const beforeReplace = await dbPage(A.id);
    const f2 = await internal("POST", `/api/mensetsu-pages/${A.id}/replace`, { html: TEST_HTML_V2, note: "v2.html" });
    check("F2 差し替え → 200 versionNo=2・公開中のまま", f2.status === 200 && f2.json.versionNo === 2 && pageOf(f2).status === "published" && pageOf(f2).currentVersionNo === 2, f2);
    const afterReplace = await dbPage(A.id);
    check("F3 差し替えで expiresAt・閲覧数は変わらない", afterReplace.expiresAt?.getTime() === beforeReplace.expiresAt?.getTime() && afterReplace.viewCount === beforeReplace.viewCount, { before: beforeReplace, after: afterReplace });
    const f4 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F4 差し替え後も同じトークンで 200・中身は v2", f4.status === 200 && String(f4.json.html).includes("MARK_V2"), f4.status);
    const f5 = await internal("GET", `/api/mensetsu-pages/${A.id}/versions`);
    const vers = f5.json.versions as Row[];
    check("F5 版の履歴 → 2 件（新しい順）", f5.status === 200 && vers.length === 2 && vers[0].versionNo === 2 && vers[1].versionNo === 1, vers);
    const f6 = await internal("GET", `/api/mensetsu-pages/${A.id}/preview?version=1`);
    check("F6 版 1 のプレビュー → MARK_V1", f6.status === 200 && String(f6.json.html).includes("MARK_V1") && f6.json.versionNo === 1, f6.status);
    check("F7 差し替え後の案内文 2 行目", String(pageOf(f2).guideMessageUpdated).split("\n")[1] === "面接対策の内容を反映して、資料を更新しました。", pageOf(f2).guideMessageUpdated);
    // 延長: expiresAt を過去にして 410 expired → 延長で復活
    await prisma.interviewPrepPage.update({ where: { id: A.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const f8 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F8 expiresAt 過去 → 410 expired", f8.status === 410 && f8.json.reason === "expired", f8);
    const f8v = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/05" } });
    check("F8b 期限切れの verify も 410 expired", f8v.status === 410 && f8v.json.reason === "expired", f8v);
    const f8l = await internal("GET", `/api/mensetsu-pages/${A.id}`);
    check("F8c 一覧行の displayStatus=expired", pageOf(f8l).displayStatus === "expired", pageOf(f8l).displayStatus);
    const f9 = await internal("POST", `/api/mensetsu-pages/${A.id}/extend`);
    check("F9 延長 → expiresAt = 今日+30日 0:00 JST", f9.status === 200 && pageOf(f9).expiresAt === expectedExpires, { got: pageOf(f9).expiresAt, expectedExpires });
    const f10 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F10 延長後 → 200", f10.status === 200, f10.status);
    // 停止 / 再公開
    const f11 = await internal("POST", `/api/mensetsu-pages/${A.id}/stop`, { reason: "manual" });
    check("F11 公開停止 → status=stopped", f11.status === 200 && pageOf(f11).status === "stopped" && pageOf(f11).displayStatus === "stopped", f11);
    const f12 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F12 停止中 → 410 stopped", f12.status === 410 && f12.json.reason === "stopped", f12);
    const f12v = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/05" } });
    check("F12b 停止中の verify → 410 stopped", f12v.status === 410 && f12v.json.reason === "stopped", f12v);
    const f13 = await internal("POST", `/api/mensetsu-pages/${A.id}/stop`);
    check("F13 停止中をもう一度停止 → 400", f13.status === 400, f13);
    const f14 = await internal("POST", `/api/mensetsu-pages/${A.id}/republish`);
    check("F14 再公開 → status=published・期限はそのまま", f14.status === 200 && pageOf(f14).status === "published" && pageOf(f14).expiresAt === expectedExpires, f14);
    const f15 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F15 再公開後 → 200（本人確認済みの端末はそのまま）", f15.status === 200, f15.status);
    // 選考終了のエントリーにひもづけ → 410 closed
    const f16 = await internal("PATCH", `/api/mensetsu-pages/${A.id}`, { entryId: TEST_CLOSED_ENTRY_ID });
    check("F16 終了状態のエントリーにひもづけ → displayStatus=closed", f16.status === 200 && pageOf(f16).displayStatus === "closed" && pageOf(f16).companyName === "アスフィール株式会社", f16);
    const f17 = await ext("GET", `/api/external/mensetsu/pages/${A.slug}`, { token: tokenA, ua: UA_BROWSER });
    check("F17 選考終了 → 410 closed", f17.status === 410 && f17.json.reason === "closed", f17);
    const f17v = await ext("POST", `/api/external/mensetsu/pages/${A.slug}/verify`, { body: { birthdate: "1983/05/05" } });
    check("F17b 選考終了の verify → 410 closed", f17v.status === 410 && f17v.json.reason === "closed", f17v);
    const entryAfter = await prisma.jobEntry.findUniqueOrThrow({ where: { id: TEST_CLOSED_ENTRY_ID }, select: { entryFlagDetail: true, archivedAt: true } });
    check("F18 エントリーの状態は変えていない", entryAfter.entryFlagDetail === "書類見送り" && !!entryAfter.archivedAt, entryAfter);
    const f19 = await internal("PATCH", `/api/mensetsu-pages/${A.id}`, { entryId: null, title: "T-206テストA（変更）", stage: "二次面接", interviewDate: "2026-10-20" });
    check("F19 ひもづけ解除＋項目変更 → published に戻る", f19.status === 200 && pageOf(f19).displayStatus === "published" && pageOf(f19).title === "T-206テストA（変更）" && pageOf(f19).stage === "二次面接" && pageOf(f19).interviewDate === "2026-10-20" && pageOf(f19).entryId === null, f19);
    const f20 = await internal("PATCH", `/api/mensetsu-pages/${A.id}`, { stage: "存在しない種別" });
    check("F20 不正な種別 → 400", f20.status === 400, f20);
    const f21 = await internal("POST", `/api/mensetsu-pages/${A.id}/replace`, { html: "" });
    check("F21 空 HTML の差し替え → 400", f21.status === 400, f21);
    const big = "x".repeat(4 * 1024 * 1024 + 1);
    const f22 = await internal("POST", `/api/mensetsu-pages/${A.id}/replace`, { html: big });
    check("F22 4MB 超の HTML → 400 html_too_large", f22.status === 400 && f22.json.error === "html_too_large", f22.json);
    // 終了状態のエントリー付きの下書きは公開できない
    const cD = await internal("POST", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`, { stage: "一次面接", entryId: TEST_CLOSED_ENTRY_ID, html: TEST_HTML_V1 });
    const D = pageOf(cD);
    createdPageIds.push(D.id);
    check("F23 エントリー付き作成でタイトル自動入力", cD.status === 201 && D.title === "一次面接対策（アスフィール株式会社）", D.title);
    const f24 = await internal("POST", `/api/mensetsu-pages/${D.id}/publish`);
    check("F24 選考終了エントリー付きの下書きは公開不可 → 400 entry_closed", f24.status === 400 && f24.json.error === "entry_closed", f24);
    const f25 = await internal("POST", `/api/mensetsu-pages/${D.id}/extend`);
    check("F25 下書きの延長 → 400", f25.status === 400, f25);
    const f26 = await internal("POST", `/api/mensetsu-pages/${D.id}/replace`, { html: TEST_HTML_V2, publish: true });
    check("F26 下書きの「差し替えて公開」も entry_closed で 400（版は保存される）", f26.status === 400 && f26.json.error === "entry_closed", f26);

    // ---------------------------------------------------------------- G. step2 用に残す 2 件
    console.log("\n== G. step2 確認用の記録を作る");
    const gA = await internal("POST", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`, { stage: "その他", entryId: null, html: TEST_HTML_V1, title: "step2確認用" });
    const GA = pageOf(gA);
    const gA2 = await internal("POST", `/api/mensetsu-pages/${GA.id}/publish`);
    check("G1 step2確認用 → 公開中", gA2.status === 200 && pageOf(gA2).status === "published", gA2);
    keep.push({ slug: GA.slug, title: "step2確認用" });
    const gB = await internal("POST", `/api/candidates/${TEST_CANDIDATE_ID}/mensetsu-pages`, { stage: "その他", entryId: null, html: TEST_HTML_V1, title: "step2確認用（停止）" });
    const GB = pageOf(gB);
    await internal("POST", `/api/mensetsu-pages/${GB.id}/publish`);
    const gB3 = await internal("POST", `/api/mensetsu-pages/${GB.id}/stop`, { reason: "step2 test" });
    check("G2 step2確認用（停止） → 停止中", gB3.status === 200 && pageOf(gB3).status === "stopped", gB3);
    keep.push({ slug: GB.slug, title: "step2確認用（停止）" });

    // ---------------------------------------------------------------- H. 後片付け
    console.log("\n== H. 後片付け");
    const del = await prisma.interviewPrepPage.deleteMany({ where: { id: { in: createdPageIds }, candidateId: TEST_CANDIDATE_ID } });
    check(`H1 テスト用の記録を削除（${del.count} 件）`, del.count === createdPageIds.length, { del: del.count, expected: createdPageIds.length });
    const remaining = await prisma.interviewPrepPage.findMany({ where: { candidateId: TEST_CANDIDATE_ID }, select: { slug: true, title: true, status: true } });
    check("H2 大野テストに残るのは step2 用の 2 件だけ", remaining.length === 2 && remaining.every((r) => r.title.startsWith("step2確認用")), remaining);
    const okanoFinal = await prisma.interviewPrepPage.findUniqueOrThrow({ where: { slug: OKANO_SLUG }, select: { viewCount: true, firstViewedAt: true, status: true } });
    check("H3 岡野様の閲覧記録は増えていない（0・未閲覧）", okanoFinal.viewCount === 0 && okanoFinal.firstViewedAt === null && okanoFinal.status === "published", okanoFinal);

    // .env.local へ追記（既にあれば書かない）
    const envText = readFileSync(MENSETSU_ENV_LOCAL, "utf8");
    if (!envText.includes("MENSETSU_TEST_SLUG=")) {
      appendFileSync(MENSETSU_ENV_LOCAL, `\n# T-206 step2 の確認用（大野テスト・生年月日は 1983-05-05）\nMENSETSU_TEST_SLUG=${GA.slug}\nMENSETSU_TEST_BIRTHDATE=19830505\nMENSETSU_TEST_STOPPED_SLUG=${GB.slug}\n`);
      console.log(`  .env.local に MENSETSU_TEST_SLUG=${GA.slug} / MENSETSU_TEST_STOPPED_SLUG=${GB.slug} を追記`);
    } else {
      console.log("  .env.local には既に MENSETSU_TEST_SLUG がある（追記せず）。残した slug:", keep);
    }
  } finally {
    if (sessionId) {
      await prisma.userSession.delete({ where: { id: sessionId } }).catch(() => undefined);
      console.log("  テスト用セッションを削除");
    }
  }

  console.log(`\n[t206-prod-check] pass=${pass} fail=${fail}`);
  if (fail) console.log("  failures:", failures);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
