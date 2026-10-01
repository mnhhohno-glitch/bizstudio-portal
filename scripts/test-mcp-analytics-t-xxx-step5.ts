/**
 * T-XXX step5C: MCP 入口経由で分析ツール 9 本の疎通・形を確かめる（読み取りのみ・DB に書かない・AI を呼ばない）。
 * 接続先は環境変数 MCP_URL（https://<host>/api/mcp/<秘密> の完全な URL）。**URL・秘密は表示しない**。
 *
 *   ローカル:  MCP_URL=http://localhost:3100/api/mcp/<ローカル専用の秘密> npx tsx scripts/test-mcp-analytics-t-xxx-step5.ts
 *   本番:      （PowerShell）$env:MCP_URL = (Get-Content "$env:USERPROFILE\Desktop\portal-mcp-url.txt" -Raw).Trim(); npx tsx scripts/test-mcp-analytics-t-xxx-step5.ts --prod
 *
 * --prod を付けると、2026-05〜09 の主要な集計値（集計値のみ）を表示し、get_accept_revenue の ALL と get_company_kpi の月次が一致することも確かめる。
 */
type Json = Record<string, unknown>;

const url = process.env.MCP_URL;
if (!url) {
  console.error("MCP_URL（完全な接続URL）を環境変数で渡してください（表示はしません）");
  process.exit(1);
}
const PROD = process.argv.includes("--prod");

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
async function rpc(method: string, params: Json | undefined): Promise<{ status: number; result?: Json; error?: Json }> {
  const id = nextId++;
  const res = await fetch(url!, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (res.status !== 200) return { status: res.status };
  const messages: Json[] = [];
  if (ct.startsWith("text/event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) { const p = line.slice(5).trim(); if (p) messages.push(JSON.parse(p)); }
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) messages.push(...parsed); else messages.push(parsed);
  }
  const m = messages.find((x) => x.id === id) ?? messages[0];
  return { status: res.status, result: m?.result as Json | undefined, error: m?.error as Json | undefined };
}
async function callTool(name: string, args: Json): Promise<{ isError: boolean; json: Json | null; text: string; bytes: number; ms: number }> {
  const t0 = Date.now();
  const r = await rpc("tools/call", { name, arguments: args });
  const ms = Date.now() - t0;
  const content = ((r.result?.content as Json[]) ?? [])[0];
  const text = (content?.text as string) ?? "";
  let json: Json | null = null;
  try { json = JSON.parse(text); } catch { /* error text */ }
  return { isError: !!r.result?.isError || !!r.error, json, text, bytes: Buffer.byteLength(text, "utf8"), ms };
}

const NEW_TOOLS = ["get_ca_roster", "get_cohort_funnel", "get_selection_conversion", "get_pipeline_now", "get_accept_revenue", "get_forecast_inputs", "get_segment_breakdown", "get_snapshot_history", "get_data_quality"];
const ENVELOPE = ["definitionVersion", "generatedAt", "observationEnd", "timezone", "cas", "exclusions", "suppression", "dataFreshness", "historySince", "counts", "warnings", "definitions"];

async function main(): Promise<void> {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  check("[1] initialize", init.status, 200);
  const list = await rpc("tools/list", {});
  const tools = (list.result?.tools as Json[]) ?? [];
  check("[1] ツール数（既存 4 + 新規 9）", tools.length, 13);
  for (const t of NEW_TOOLS) {
    const tool = tools.find((x) => x.name === t);
    checkTrue(`[1] ${t} が readOnlyHint`, !!tool && (tool.annotations as Json)?.readOnlyHint === true);
    checkTrue(`[1] ${t} の説明に 分母 がある`, !!tool && String(tool.description).includes("分母"));
  }
  for (const t of ["get_metric_definitions", "list_cas", "get_ca_kpi", "get_company_kpi"]) checkTrue(`[1] 既存 ${t} が残っている`, tools.some((x) => x.name === t));

  const period = PROD ? { from: "2026-05", to: "2026-09" } : {};
  const calls: [string, Json][] = [
    ["get_data_quality", period],
    ["get_ca_roster", {}],
    ["get_cohort_funnel", PROD ? { cohortFrom: "2026-05", cohortTo: "2026-09" } : {}],
    ["get_selection_conversion", period],
    ["get_pipeline_now", {}],
    ["get_accept_revenue", period],
    ["get_forecast_inputs", PROD ? { baseFrom: "2026-05", baseTo: "2026-09" } : {}],
    ["get_segment_breakdown", { segment: "desiredJobType", ...period }],
    ["get_snapshot_history", {}],
  ];
  const results: Record<string, Json> = {};
  for (const [name, args] of calls) {
    const r = await callTool(name, args);
    checkTrue(`[2] ${name} が応答（${Math.round(r.bytes / 1000)}KB・${r.ms}ms）`, !r.isError && r.json != null, r.isError ? r.text.slice(0, 200) : "");
    if (r.json) {
      results[name] = r.json;
      const missing = ENVELOPE.filter((k) => !(k in r.json!));
      check(`[2] ${name} の共通項目`, missing, []);
      checkTrue(`[2] ${name} は 85KB 以内`, r.bytes <= 85_000, `${r.bytes}`);
      checkTrue(`[2] ${name} に求職者番号・氏名らしき値が無い`, !/"candidateNumber"|"name":"[^"]{2,}\s[^"]{1,}"/.test(JSON.stringify(r.json).replace(/"name":"[^"]*"/g, (m) => (/employeeNumber/.test(JSON.stringify(r.json)) ? "" : m))));
    }
  }

  // 入力誤り → isError と対処法
  const e1 = await callTool("get_cohort_funnel", { cohortFrom: "2026/05" });
  checkTrue("[3] 月の形式誤りは isError", e1.isError && /YYYY-MM/.test(e1.text), e1.text.slice(0, 120));
  const e2 = await callTool("get_segment_breakdown", { segment: "gender" });
  checkTrue("[3] 不正な segment は isError", e2.isError, e2.text.slice(0, 120));
  const e3 = await callTool("get_accept_revenue", { caId: "no-such-ca" });
  checkTrue("[3] caId 不在は isError と案内", e3.isError && /employeeNumber/.test(e3.text), e3.text.slice(0, 120));
  const e4 = await callTool("get_snapshot_history", { from: "2025-01-01", to: "2026-10-01" });
  checkTrue("[3] 期間超過は isError", e4.isError && /上限/.test(e4.text), e4.text.slice(0, 120));

  if (PROD) {
    // 2026-05〜09 の主要な集計値（集計値のみ）
    const cohort = results.get_cohort_funnel;
    const conv = results.get_selection_conversion;
    const rev = results.get_accept_revenue;
    const pipe = results.get_pipeline_now;
    const show = (label: string, v: unknown) => console.log(`  ${label}: ${JSON.stringify(v)}`);
    console.log("\n=== 2026-05〜09 主要な結果（集計値のみ）===");
    for (const r of (cohort?.byMonth as Json[]) ?? []) if (r.ca === "ALL") show(`コホート ${r.month}`, { people: r.people, reached: r.reached, outcome: r.outcome });
    for (const r of (conv?.byMonth as Json[]) ?? []) if (r.ca === "ALL") show(`応募月 ${r.month}`, { records: r.records, people: r.people, outcome: r.outcome });
    for (const r of (rev?.byMonth as Json[]) ?? []) if (r.ca === "ALL") show(`承諾月 ${r.month}`, { deals: r.deals, revenue: r.revenue, grossProfit: r.grossProfit, acceptedThenDeclined: r.acceptedThenDeclined });
    const pAll = ((pipe?.rows as Json[]) ?? []).find((r) => r.ca === "ALL");
    show("進行中（ALL）", { inSelection: pAll?.inSelection, acceptedNotJoined: (pAll?.acceptedNotJoined as Json)?.records, upcoming: pAll?.upcomingInterviews, active: pAll?.activeCandidates });
    show("historySince", results.get_data_quality?.historySince);
    show("warnings(roster)", results.get_ca_roster?.warnings);

    // ALL の承諾売上 = company-kpi の invoiceRevenue（同じ月）
    for (const m of ["2026-07", "2026-08"]) {
      const ck = await callTool("get_company_kpi", { month: m });
      const cm = (ck.json?.month as Json) ?? {};
      const rr = ((rev?.byMonth as Json[]) ?? []).find((r) => r.ca === "ALL" && r.month === m) as Json | undefined;
      check(`[4] ${m} ALL.revenue = company-kpi invoiceRevenue`, rr?.revenue, cm.invoiceRevenue);
      check(`[4] ${m} ALL.grossProfit = company-kpi grossProfit`, rr?.grossProfit, cm.grossProfit);
      check(`[4] ${m} ALL.deals = company-kpi decidedDealCount`, rr?.deals, cm.decidedDealCount);
    }
    // CA別合計 = 全体合計（期間合計・在籍前の月は CA 行から外れるので差があれば報告）
    const tot = (rev?.total as Json[]) ?? [];
    const all = tot.find((r) => r.ca === "ALL") as Json;
    const caSum = tot.filter((r) => r.ca !== "ALL").reduce((s, r) => s + ((r.revenue as number) ?? 0), 0);
    console.log(`  期間合計 revenue: ALL=${all?.revenue} / CA別合計=${caSum}（差 ${((all?.revenue as number) ?? 0) - caSum}＝担当なし・CA以外の担当・在籍外の月の分）`);
  }

  console.log(`\n${checks - failures}/${checks} PASS${failures ? ` (${failures} FAIL)` : ""}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e instanceof Error ? e.message : e);
  process.exit(1);
});

// このファイルをモジュールにする（罠: import の無い scripts/*.ts はグローバルになり next build の型検査で衝突する）
export {};
