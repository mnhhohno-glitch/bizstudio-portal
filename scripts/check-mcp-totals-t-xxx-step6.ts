/**
 * T-XXX step6: MCP 経由で会社全体（ALL）の合計値と退職後の成果（postExit）・稼働しない期間を取り出す（読み取りのみ・AI を呼ばない）。
 * 反映前と反映後に 1 回ずつ実行し、出力 JSON を比べて「全体の合計が変わっていないか」を確かめる。集計値だけを出し、URL・秘密は表示しない。
 *
 *   （PowerShell）$env:MCP_URL = (Get-Content "$env:USERPROFILE\Desktop\portal-mcp-url.txt" -Raw).Trim()
 *   npx tsx scripts/check-mcp-totals-t-xxx-step6.ts > before.json   … 反映前
 *   npx tsx scripts/check-mcp-totals-t-xxx-step6.ts > after.json    … 反映後
 */
type Json = Record<string, unknown>;
const url = process.env.MCP_URL;
if (!url) {
  console.error("MCP_URL（完全な接続URL）を環境変数で渡してください（表示はしません）");
  process.exit(1);
}

let nextId = 1;
async function rpc(method: string, params: Json): Promise<Json | undefined> {
  const id = nextId++;
  const res = await fetch(url!, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (res.status !== 200) throw new Error(`${method}: HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const messages: Json[] = [];
  if (ct.startsWith("text/event-stream")) {
    for (const line of text.split("\n")) if (line.startsWith("data:")) { const p = line.slice(5).trim(); if (p) messages.push(JSON.parse(p)); }
  } else {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) messages.push(...parsed); else messages.push(parsed);
  }
  return ((messages.find((x) => x.id === id) ?? messages[0])?.result as Json | undefined);
}
async function tool(name: string, args: Json): Promise<Json> {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = (((r?.content as Json[]) ?? [])[0]?.text as string) ?? "";
  if (r?.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Json;
}
const arr = (b: Json, k: string) => (b[k] ?? []) as Json[];
const all = (rs: Json[]) => rs.filter((r) => r.ca === "ALL");
const pick = (o: Json | undefined, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

async function main(): Promise<void> {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-step6", version: "0" } });
  const tools = (((await rpc("tools/list", {}))?.tools as Json[]) ?? []).map((t) => t.name);
  const range = { from: "2026-05", to: "2026-09" };
  const [rev, conv, pipe, fc, coh, company, caKpi, roster] = await Promise.all([
    tool("get_accept_revenue", { ...range, byCa: false }),
    tool("get_selection_conversion", { ...range, byCa: false }),
    tool("get_pipeline_now", {}),
    tool("get_forecast_inputs", { baseFrom: "2026-05", baseTo: "2026-09" }),
    tool("get_cohort_funnel", { cohortFrom: "2026-05", cohortTo: "2026-09", byCa: false }),
    tool("get_company_kpi", { month: "2026-08" }),
    tool("get_ca_kpi", { granularity: "month", from: "2026-08-01", to: "2026-08-31" }),
    tool("get_ca_roster", {}),
  ]);
  const caKpiAll = arr(caKpi, "rows").find((r) => r.ca === "ALL");
  const out = {
    toolsListCount: tools.length,
    definitionVersion: rev.definitionVersion,
    totals: {
      acceptRevenue: all(arr(rev, "byMonth")).map((r) => pick(r, ["month", "deals", "revenue", "grossProfit"])).concat(all(arr(rev, "total")).map((r) => pick(r, ["month", "deals", "revenue", "grossProfit"]))),
      selectionConversion: all(arr(conv, "byMonth")).map((r) => pick(r, ["month", "records", "people"])),
      cohort: all(arr(coh, "byMonth")).map((r) => ({ month: r.month, people: r.people, accepted: (r.reached as Json | undefined)?.acceptance })),
      pipelineNowAll: (() => {
        const a = arr(pipe, "rows").find((r) => r.ca === "ALL");
        return { inSelection: a?.inSelection, acceptedNotJoined: (a?.acceptedNotJoined as Json | undefined)?.records, activeCandidates: a?.activeCandidates, upcomingInterviews: a?.upcomingInterviews };
      })(),
      forecastAll: (() => {
        const a = arr(fc, "scopes").find((r) => r.ca === "ALL");
        return { revenueDeals: (a?.revenue as Json | undefined)?.deals, pipelineNow: a?.pipelineNow, pending: a?.pending };
      })(),
      companyKpi2026_08: pick(company.month as Json, ["invoiceRevenue", "grossProfit", "decidedDealCount", "caInterviewCount", "companyInterviewCount"]),
      caKpi2026_08_ALL: caKpiAll ? { interview: caKpiAll.interview, entry: caKpiAll.entry, selection: caKpiAll.selection } : null,
    },
    postExit: {
      acceptRevenue: rev.postExit ?? null,
      selectionConversion: conv.postExit ?? null,
      pipelineNow: (pipe.postExit as Json[] | undefined)?.map((p) => pick(p, ["ca", "name", "resignDate", "inSelection", "acceptedNotJoined", "activeCandidates", "upcomingInterviews"])) ?? null,
      forecast: fc.postExit ?? null,
      cohort: coh.postExit ?? null,
    },
    roster: (roster.cas as Json[]).map((c) => ({
      employeeNumber: c.employeeNumber,
      name: c.name,
      status: c.status,
      resignDate: c.resignDate,
      inactivePeriods: c.inactivePeriods ?? null,
      fte: ((c.availabilityByMonth as Json[] | undefined) ?? []).map((a) => `${a.month}:${a.fte}`),
    })),
    rosterWarnings: roster.warnings,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e).replace(url!, "<MCP_URL>"));
  process.exit(1);
});

export {};
