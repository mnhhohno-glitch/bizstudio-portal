// T-XXX step3: ChatGPT の「MCP アプリ」から CA別実績を読むための MCP サーバー定義（ツール 4 本・すべて読み取り専用）。
//
// - 入口は src/app/api/mcp/[secret]/route.ts（秘密URL方式・Streamable HTTP・ステートレス）。
// - 各ツールは HTTP API（/api/ai/ca-kpi・/api/ai/company-kpi）と同じ組み立て関数を直接呼ぶ
//   （src/lib/aiRead/caKpiResponse.ts・companyKpiResponse.ts）。HTTP で自分の API を呼び直さない。AI_READ_API_KEY も使わない。
// - DB への書き込み・AI 呼び出しはしない。個人情報は返さない（件数・CA の社員番号＋表示名・定義のみ）。
// - 呼び出しごとに 1 行ログ（ツール名・パラメータ・処理時間・結果サイズ）。URL・秘密の文字列はログに出さない。
// - ライブラリは @modelcontextprotocol/server（MCP TypeScript SDK v2）。選定理由は docs/survey_T-XXX_ca-kpi-api.md「step3 実装結果」。

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildCaKpiResponse, CA_KPI_DEFINITIONS, CA_KPI_CAVEATS, CA_KPI_LIMITS_PUBLIC, jstIso, jstYmd } from "@/lib/aiRead/caKpiResponse";
import { buildCompanyKpiResponse, COMPANY_KPI_DEFINITIONS, COMPANY_KPI_SCOPE_NOTE } from "@/lib/aiRead/companyKpiResponse";
import { CA_KPI_GROUPS, CA_KPI_DEFAULT_GROUPS } from "@/lib/aiRead/caKpiParams";
import { queryCaKpiMeta } from "@/lib/aiRead/caKpi";

export const MCP_SERVER_INFO = { name: "bizstudio-portal-ca-kpi", version: "1.0.0" } as const;

const INSTRUCTIONS = [
  "株式会社ビズスタジオのポータルに登録された CA（キャリアアドバイザー）実績を読み取るツール群です。すべて読み取り専用で、求職者の個人情報は返しません。",
  "分析の前に必ず get_metric_definitions を読み、数値の定義・基準日付・信頼できる開始日・注意点に従ってください。",
  "CA別・期間別の実績は get_ca_kpi、CA の一覧は list_cas、会社全体の売上・粗利・目標は get_company_kpi を使います。",
  "数値はツールで取得したものだけを使い、推測で数字を作らないでください。",
].join("\n");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** ツールの結果（JSON を text として返す。ChatGPT は text を読む）。 */
function jsonResult(body: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

/** エラー時の結果。isError を立て、対処法を含む文を text に入れる（ChatGPT が読んで言い直せるように）。 */
function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** 1 行ログ。パラメータは件数・日付・社員番号のみ（個人情報・URL・秘密は含まれない）。 */
function logCall(tool: string, params: unknown, startedAt: number, result: CallToolResult): void {
  const bytes = result.content.reduce((s, c) => s + (c.type === "text" ? Buffer.byteLength(c.text, "utf8") : 0), 0);
  console.log(
    `[mcp] tool=${tool} params=${JSON.stringify(params ?? {})} ms=${Date.now() - startedAt} bytes=${bytes} ok=${result.isError ? 0 : 1}`,
  );
}

/** 共通の実行ラッパ：例外は isError の結果に変え、必ず 1 行ログを出す。 */
async function run(tool: string, params: unknown, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  const startedAt = Date.now();
  let result: CallToolResult;
  try {
    result = await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = errorResult(`サーバー内部でエラーが起きました（${msg}）。少し待ってから同じ条件でもう一度呼んでください。続くときは大野さんに連絡してください`);
  }
  logCall(tool, params, startedAt, result);
  return result;
}

const YMD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式（JST）で指定してください");

const GetCaKpiInput = z.object({
  from: YMD.describe("集計開始日（JST・YYYY-MM-DD・この日を含む）。例 2026-08-01"),
  to: YMD.describe("集計終了日（JST・YYYY-MM-DD・この日を含む）。今日より後を指定すると今日に丸められる。例 2026-08-31"),
  granularity: z
    .enum(["day", "week", "month"])
    .optional()
    .describe("区切りの粒度。month（既定・暦月）/ week（月曜〜日曜）/ day。期間の上限は day 92 日・week/month 400 日"),
  caId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "caId は社員番号（例 1000001）を指定してください")
    .optional()
    .describe("CA の社員番号（list_cas の employeeNumber）。省略すると在籍CA全員＋全員行（ca='ALL'）を返す"),
  groups: z
    .array(z.enum(CA_KPI_GROUPS))
    .optional()
    .describe(
      `返す項目グループ。省略時は ${CA_KPI_DEFAULT_GROUPS.join(",")}（activity はタスク・チャット等の操作回数で、指定したときだけ返す）。応答が大きすぎる（エラー）ときは減らす。例 ["interview","entry","selection"]`,
    ),
});

const GetCompanyKpiInput = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/, "year は YYYY 形式で指定してください")
    .optional()
    .describe("対象年（YYYY）。省略時は今年。当年は 1/1〜今日まで"),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "month は YYYY-MM 形式で指定してください")
    .optional()
    .describe("対象月（YYYY-MM）。省略時は今月。当月は 1 日〜今日まで"),
});

/**
 * リクエストごとに新しいサーバーを作る（ステートレス）。ツールの登録はこの関数の中で完結する。
 */
export function createCaKpiMcpServer(): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_metric_definitions",
    {
      title: "数値の定義・注意点",
      description:
        "CA実績（get_ca_kpi）と会社KPI（get_company_kpi）の各数値の定義・基準日付・信頼できる開始日・注意点、応答の上限、担当CA替えの記録開始日、データの最終更新時刻を返す。" +
        "分析を始める前に必ず 1 回呼び、以後の解釈（件数と人数の区別、面談時間は予約枠、ABCD判定は 2026-09-25 以降、選考中を不合格と数えない等）はこの内容に従うこと。引数なし",
      inputSchema: z.object({}),
      annotations: { ...READ_ONLY, title: "数値の定義・注意点" },
    },
    async (args) =>
      run("get_metric_definitions", args, async () => {
        const meta = await queryCaKpiMeta();
        return jsonResult({
          caKpi: {
            definitions: CA_KPI_DEFINITIONS,
            caveats: CA_KPI_CAVEATS,
            limits: CA_KPI_LIMITS_PUBLIC,
            availableGroups: CA_KPI_GROUPS,
            defaultGroups: CA_KPI_DEFAULT_GROUPS,
            granularity: {
              day: "JST の暦日。期間は最長 92 日",
              week: "月曜〜日曜（実績表と同じ）。最初と最後の週は from/to で切り詰めた端数。期間は最長 400 日",
              month: "暦月。最初と最後の月は from/to で切り詰めた端数（当月は今日まで）。期間は最長 400 日",
            },
            attribution: "current_ca（求職者の『今の』担当CA）",
            caAssignmentHistorySince: jstYmd(meta.caAssignmentHistorySince),
          },
          companyKpi: {
            scope: "CA_ONLY",
            scopeNote: COMPANY_KPI_SCOPE_NOTE,
            definitions: COMPANY_KPI_DEFINITIONS,
          },
          dataFreshness: {
            interview_records: jstIso(meta.interviewRecordsUpdatedAt),
            job_entries: jstIso(meta.jobEntriesUpdatedAt),
            candidate_files: jstIso(meta.candidateFilesUpdatedAt),
          },
          howToUse: [
            "1. list_cas で社員番号（employeeNumber）を確認する",
            "2. get_ca_kpi を from/to（JST）と granularity で呼ぶ。全CA × 月別は既定の項目で 8 か月まで。超えるときは期間を分ける・caId で 1 人に絞る・groups を減らす",
            "3. エラーの文に上限と対処が書いてあるので、それに従って条件を変えて呼び直す",
            "4. 当月は今日までの値で動く。確定値の比較は過去の月で行う",
          ],
        });
      }),
  );

  server.registerTool(
    "list_cas",
    {
      title: "CA 一覧",
      description:
        "集計対象の CA（キャリアアドバイザー）一覧を返す。各行は employeeNumber（社員番号。get_ca_kpi の caId に使う）・name（表示名）・status（active=在籍 / disabled=退職等）・inDefaultAggregation（在籍CAだけが true。get_ca_kpi で caId を省略したときの対象）。" +
        "CA を名前で指定されたときや、CA別に比較するときの最初に呼ぶ。引数なし",
      inputSchema: z.object({}),
      annotations: { ...READ_ONLY, title: "CA 一覧" },
    },
    async (args) =>
      run("list_cas", args, async () => {
        const rows = await prisma.employee.findMany({
          where: { jobCategory: "CA" },
          select: { employeeNumber: true, name: true, status: true },
          orderBy: { employeeNumber: "asc" },
        });
        const cas = rows.map((r) => ({
          employeeNumber: r.employeeNumber,
          name: r.name,
          status: r.status,
          inDefaultAggregation: r.status === "active",
        }));
        return jsonResult({
          count: cas.length,
          activeCount: cas.filter((c) => c.inDefaultAggregation).length,
          note:
            "get_ca_kpi で caId を省略すると status=active の CA 全員＋全員行（ca='ALL'）が返る。退職した CA（disabled）も caId を指定すれば個別に取れるが、担当替えで実績が今の担当に移っている可能性がある",
          cas,
        });
      }),
  );

  server.registerTool(
    "get_ca_kpi",
    {
      title: "CA別実績",
      description:
        "CA別・期間別の実績を返す（HTTP API /api/ai/ca-kpi と同じ内容）。面談（実施・初回・既存・予約・辞退・面談時間・初回面談ランク分布）、求人紹介、ブックマーク、評価分布、エントリー（件数と人数）、選考段階（書類提出・書類通過・一次/二次/最終面接・内定・承諾・入社。それぞれ件数と人数）、取得時点の選考状況（currentStatus）を、区切り（月/週/日）× CA（全員行 'ALL' ＋ 各CA）の rows で返す。" +
        "担当軸は求職者の『今の』担当CA。応答には definitions / caveats / limits も含まれる。" +
        "使いどころ: 「2026年8月の全CAの面談数とエントリー数」「CA 1000001 の直近3か月を週別で」など。期間が長い・全CA × 日別などで応答が大きすぎるとエラー文に上限が書かれるので、期間を分ける・caId で絞る・groups を減らして呼び直す",
      inputSchema: GetCaKpiInput,
      annotations: { ...READ_ONLY, title: "CA別実績" },
    },
    async (args) =>
      run("get_ca_kpi", args, async () => {
        const sp = new URLSearchParams();
        sp.set("from", args.from);
        sp.set("to", args.to);
        if (args.granularity) sp.set("granularity", args.granularity);
        if (args.caId) sp.set("caId", args.caId);
        if (args.groups && args.groups.length) sp.set("groups", args.groups.join(","));
        const r = await buildCaKpiResponse(sp);
        if (r.status !== 200) {
          const err = (r.body as { error?: string }).error ?? "不明なエラー";
          const hint =
            r.status === 404
              ? " list_cas で正しい社員番号（employeeNumber）を確認してから呼び直してください"
              : " 条件を変えて呼び直してください（from/to は YYYY-MM-DD・JST、granularity は day/week/month、groups は interview,proposal,rating,entry,selection,activity から選ぶ）";
          return errorResult(`get_ca_kpi エラー: ${err}。${hint}`);
        }
        return jsonResult(r.body);
      }),
  );

  server.registerTool(
    "get_company_kpi",
    {
      title: "会社KPI（CA売上）",
      description:
        "会社全体（在籍CA合算）と CA別の、年（1/1〜）と月の KPI を返す（HTTP API /api/ai/company-kpi と同じ内容）。請求売上（税抜）・粗利・粗利目標・CA面談数・企業面接人数・エントリー人数・書類通過人数・内定人数・成約件数・決定人数・平均単価。" +
        "対象は Portal に登録された CA売上のみ（RA売上・シェアリング・業務委託は含まない）。売上・粗利・目標・決定人数の話題で使う。CA別の月次推移や週別・日別は get_ca_kpi を使う（売上は get_company_kpi にしか無い）",
      inputSchema: GetCompanyKpiInput,
      annotations: { ...READ_ONLY, title: "会社KPI（CA売上）" },
    },
    async (args) =>
      run("get_company_kpi", args, async () => {
        const r = await buildCompanyKpiResponse({ year: args.year ?? null, month: args.month ?? null });
        if (r.status !== 200) {
          const err = (r.body as { error?: string }).error ?? "不明なエラー";
          return errorResult(`get_company_kpi エラー: ${err}。year は YYYY、month は YYYY-MM で指定してください（例 year=2026, month=2026-08）`);
        }
        return jsonResult(r.body);
      }),
  );

  return server;
}
