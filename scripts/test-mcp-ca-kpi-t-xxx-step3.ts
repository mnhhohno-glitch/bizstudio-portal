/**
 * T-XXX step3: MCP 入口（/api/mcp/[secret]）の疎通・整合テスト（読み取りのみ・DB に書かない・AI を呼ばない）。
 *
 * 接続先は環境変数 MCP_URL（https://<host>/api/mcp/<秘密> の完全な URL）で渡す。**この script は URL・秘密を一切表示しない**。
 *
 * 実行:
 *   ローカル:  MCP_URL=http://localhost:3100/api/mcp/<秘密> npx tsx scripts/test-mcp-ca-kpi-t-xxx-step3.ts --rate-limit
 *   本番:      （PowerShell）$env:MCP_URL = (Get-Content "$env:USERPROFILE\Desktop\portal-mcp-url.txt" -Raw).Trim(); npx tsx scripts/test-mcp-ca-kpi-t-xxx-step3.ts --expect-2026-08
 *
 * オプション:
 *   --expect-2026-08  get_ca_kpi（2026-08・全CA・month）の全員行が step1/step2 の数字と一致することを確かめる
 *                     （面談185・初回82・エントリー48人/229件・書類通過26・内定10・承諾9人/10件）
 *   --rate-limit      1 分 60 回の制限を超えて 429 が返ることを確かめる（終わると最長 60 秒この入口が使えなくなるので最後に実行する）
 *
 * 確かめること:
 *   1. initialize → serverInfo.name が bizstudio-portal-ca-kpi
 *   2. tools/list → 既存 4 ツール（list_cas / get_ca_kpi / get_company_kpi / get_metric_definitions）が残り・全ツール readOnlyHint=true（step5C で 9 本増えた）
 *   3. tools/call get_metric_definitions → definitions / caveats が入っている
 *   4. tools/call list_cas → cas 配列
 *   5. tools/call get_ca_kpi（2026-08-01〜08-31・month）→ rows が返り、全員行がある（--expect-2026-08 なら数字も一致）
 *   6. tools/call get_company_kpi（month=2026-08）→ month ブロック
 *   7. 入力誤り（from の形式違い・granularity 不正・groups 不正）→ 分かりやすい文で isError
 *   8. 誤った秘密 → 404、秘密なし（/api/mcp/）→ 404
 *   9. （--rate-limit）61 回目以降が 429
 */

type Json = Record<string, unknown>;

const url = process.env.MCP_URL;
if (!url) {
  console.error("MCP_URL（完全な接続URL）を環境変数で渡してください（表示はしません）");
  process.exit(1);
}
const EXPECT_AUG = process.argv.includes("--expect-2026-08");
const RATE_LIMIT = process.argv.includes("--rate-limit");

let failures = 0;
let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${ok ? "" : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
}
function checkTrue(label: string, cond: boolean, detail = ""): void {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}

let nextId = 1;
let protocolVersion = "2025-06-18";

/** SSE（text/event-stream）か JSON のどちらで返ってきても、id の一致する JSON-RPC 応答を取り出す。 */
async function rpc(method: string, params: Json | undefined, target: string = url!): Promise<{ status: number; result?: Json; error?: Json; raw?: string }> {
  const id = nextId++;
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (res.status !== 200) return { status: res.status, raw: text.slice(0, 300) };
  const messages: Json[] = [];
  if (ct.startsWith("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload) messages.push(JSON.parse(payload));
      }
    }
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) messages.push(...parsed);
    else messages.push(parsed);
  }
  const mine = messages.find((m) => m.id === id) ?? messages[messages.length - 1];
  return { status: res.status, result: mine?.result as Json | undefined, error: mine?.error as Json | undefined };
}

async function callTool(name: string, args: Json): Promise<{ isError: boolean; text: string; json: Json | null; bytes: number }> {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r.error) return { isError: true, text: JSON.stringify(r.error), json: null, bytes: 0 };
  const result = r.result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined;
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
  let json: Json | null = null;
  if (!result?.isError) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { isError: !!result?.isError, text, json, bytes: Buffer.byteLength(text, "utf8") };
}

async function main(): Promise<void> {
  const started = Date.now();

  // 1. initialize
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t-xxx-step3-test", version: "1.0.0" },
  });
  check("[1] initialize status", init.status, 200);
  const serverInfo = (init.result?.serverInfo ?? {}) as Json;
  check("[1] serverInfo.name", serverInfo.name, "bizstudio-portal-ca-kpi");
  if (typeof init.result?.protocolVersion === "string") protocolVersion = init.result.protocolVersion;
  checkTrue("[1] instructions あり", typeof init.result?.instructions === "string" && (init.result.instructions as string).length > 0);

  // 2. tools/list
  const list = await rpc("tools/list", {});
  const tools = ((list.result?.tools ?? []) as Array<{ name: string; annotations?: { readOnlyHint?: boolean }; description?: string; inputSchema?: Json }>).slice();
  // T-XXX step5C で分析ツール 9 本が増えた。既存 4 本が残っていること（名前・入力項目）を確かめる（増えた分は scripts/test-mcp-analytics-t-xxx-step5.ts）
  check(
    "[2] tools/list に既存 4 ツール",
    tools.map((t) => t.name).filter((n) => ["get_ca_kpi", "get_company_kpi", "get_metric_definitions", "list_cas"].includes(n)).sort(),
    ["get_ca_kpi", "get_company_kpi", "get_metric_definitions", "list_cas"],
  );
  checkTrue("[2] 全ツール readOnlyHint=true", tools.length >= 4 && tools.every((t) => t.annotations?.readOnlyHint === true));
  checkTrue("[2] 全ツールに日本語の説明", tools.every((t) => (t.description ?? "").length > 20));
  const caKpiTool = tools.find((t) => t.name === "get_ca_kpi");
  const props = (caKpiTool?.inputSchema?.properties ?? {}) as Json;
  check("[2] get_ca_kpi の入力項目", Object.keys(props).sort(), ["caId", "from", "granularity", "groups", "to"]);

  // 3. get_metric_definitions
  const defs = await callTool("get_metric_definitions", {});
  checkTrue("[3] get_metric_definitions 成功", !defs.isError, defs.isError ? defs.text.slice(0, 200) : `${defs.bytes} bytes`);
  const caKpiDefs = (defs.json?.caKpi ?? {}) as Json;
  checkTrue("[3] definitions.interview あり", !!(caKpiDefs.definitions as Json | undefined)?.interview);
  checkTrue("[3] caveats が配列", Array.isArray(caKpiDefs.caveats) && (caKpiDefs.caveats as unknown[]).length >= 5);
  checkTrue("[3] companyKpi.definitions あり", !!((defs.json?.companyKpi ?? {}) as Json).definitions);

  // 4. list_cas
  const cas = await callTool("list_cas", {});
  checkTrue("[4] list_cas 成功", !cas.isError, cas.isError ? cas.text.slice(0, 200) : `${(cas.json?.cas as unknown[] | undefined)?.length ?? 0} 名`);
  const casRows = (cas.json?.cas ?? []) as Array<Json>;
  checkTrue("[4] 各行に employeeNumber/name/status/inDefaultAggregation", casRows.every((r) => "employeeNumber" in r && "name" in r && "status" in r && "inDefaultAggregation" in r));
  checkTrue(
    "[4] 個人情報の列が無い（phone/address/birthday/email）",
    casRows.every((r) => !("phone" in r) && !("address" in r) && !("birthday" in r) && !("email" in r)),
  );

  // 5. get_ca_kpi 2026-08
  const kpi = await callTool("get_ca_kpi", { from: "2026-08-01", to: "2026-08-31", granularity: "month" });
  checkTrue("[5] get_ca_kpi 成功", !kpi.isError, kpi.isError ? kpi.text.slice(0, 200) : `${kpi.bytes} bytes`);
  const rows = (kpi.json?.rows ?? []) as Array<Json>;
  const all = rows.find((r) => r.ca === "ALL" && r.bucket === "2026-08") as
    | { interview?: { total: number; first: number }; entry?: { records: number; candidates: number }; selection?: Record<string, { records: number; candidates: number }> }
    | undefined;
  checkTrue("[5] 全員行（ALL・2026-08）あり", !!all);
  check("[5] period", kpi.json?.period, { from: "2026-08-01", to: "2026-08-31", requestedTo: "2026-08-31", toClampedToToday: false });
  checkTrue("[5] definitions / caveats 同梱", !!kpi.json?.definitions && Array.isArray(kpi.json?.caveats));
  if (EXPECT_AUG && all) {
    check("[5][step2] 2026-08 全員 面談", all.interview?.total, 185);
    check("[5][step2] 2026-08 全員 初回", all.interview?.first, 82);
    check("[5][step2] 2026-08 全員 エントリー人数", all.entry?.candidates, 48);
    check("[5][step2] 2026-08 全員 エントリー件数", all.entry?.records, 229);
    check("[5][step2] 2026-08 全員 書類通過 人数", all.selection?.documentPass?.candidates, 26);
    check("[5][step2] 2026-08 全員 内定 人数", all.selection?.offer?.candidates, 10);
    check("[5][step2] 2026-08 全員 承諾 人数", all.selection?.acceptance?.candidates, 9);
    check("[5][step2] 2026-08 全員 承諾 件数", all.selection?.acceptance?.records, 10);
    const caRows = rows.filter((r) => r.ca !== "ALL" && r.bucket === "2026-08") as Array<{ interview?: { total: number } }>;
    check("[5][step2] CA別 面談合計 = 全員行", caRows.reduce((s, r) => s + (r.interview?.total ?? 0), 0), 185);
  }

  // 6. get_company_kpi
  const ck = await callTool("get_company_kpi", { month: "2026-08" });
  checkTrue("[6] get_company_kpi 成功", !ck.isError, ck.isError ? ck.text.slice(0, 200) : `${ck.bytes} bytes`);
  check("[6] month.period.from", ((ck.json?.month ?? {}) as Json).period, { from: "2026-08-01", to: "2026-08-31" });
  if (EXPECT_AUG) {
    const m = (ck.json?.month ?? {}) as Json;
    check("[6][step2] company-kpi 2026-08 面談", m.caInterviewCount, 185);
    check("[6][step2] company-kpi 2026-08 エントリー人数", m.entryCount, 48);
    check("[6][step2] company-kpi 2026-08 決定人数", m.decidedCandidateCount, 9);
  }

  // 7. 入力誤り
  const e1 = await callTool("get_ca_kpi", { from: "2026/08/01", to: "2026-08-31" });
  checkTrue("[7] from の形式違い → isError", e1.isError, e1.text.slice(0, 120));
  const e2 = await callTool("get_ca_kpi", { from: "2026-08-01", to: "2026-08-31", granularity: "year" });
  checkTrue("[7] granularity 不正 → isError", e2.isError, e2.text.slice(0, 120));
  const e3 = await callTool("get_ca_kpi", { from: "2026-08-01", to: "2026-08-31", groups: ["interview", "money"] });
  checkTrue("[7] groups 不正 → isError", e3.isError, e3.text.slice(0, 120));
  const e4 = await callTool("get_ca_kpi", { from: "2025-01-01", to: "2026-08-31", granularity: "day" });
  checkTrue("[7] 期間超過（day 600 日）→ isError に上限の文", e4.isError && /上限/.test(e4.text), e4.text.slice(0, 120));
  const e5 = await callTool("get_ca_kpi", { from: "2026-08-01", to: "2026-08-31", caId: "0000000" });
  checkTrue("[7] caId 不在 → isError に list_cas の案内", e5.isError && /list_cas/.test(e5.text), e5.text.slice(0, 120));
  const e6 = await callTool("get_company_kpi", { month: "2026-13" });
  checkTrue("[7] month 不正 → isError", e6.isError, e6.text.slice(0, 120));

  // 8. 誤った秘密・秘密なし → 404
  const u = new URL(url!);
  const segs = u.pathname.split("/");
  segs[segs.length - 1] = "wrong-secret-" + "x".repeat(40);
  const wrong = new URL(u.toString());
  wrong.pathname = segs.join("/");
  const w = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }, wrong.toString());
  check("[8] 誤った秘密 → 404", w.status, 404);
  const none = new URL(u.toString());
  none.pathname = segs.slice(0, -1).join("/") + "/";
  const n = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }, none.toString());
  check("[8] 秘密なし → 404", n.status, 404);
  const g = await fetch(url!, { method: "GET", headers: { accept: "text/event-stream" } });
  checkTrue("[8] GET（セッション用）は 405 か 400（200 で何かを返さない）", g.status === 405 || g.status === 400, `status=${g.status}`);

  // 9. 回数制限
  if (RATE_LIMIT) {
    let first429 = -1;
    for (let i = 1; i <= 70; i++) {
      const r = await fetch(url!, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocolVersion },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1000 + i, method: "ping", params: {} }),
      });
      await r.text();
      if (r.status === 429) {
        first429 = i;
        checkTrue("[9] 429 に Retry-After", !!r.headers.get("retry-after"), `Retry-After=${r.headers.get("retry-after")}`);
        break;
      }
    }
    checkTrue("[9] 70 回以内に 429 が出る（1 分 60 回）", first429 > 0 && first429 <= 70, `first429=${first429}`);
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${checks - failures}/${checks} checks, ${Date.now() - started} ms`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("ERROR", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

export {};
