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
// T-XXX step5C: 分析ツール（集計値のみ・少人数は伏せる）
import { buildCaRoster } from "@/lib/aiRead/analytics/roster";
import { buildCohortFunnel } from "@/lib/aiRead/analytics/cohort";
import { buildSelectionConversion } from "@/lib/aiRead/analytics/conversion";
import { buildPipelineNow } from "@/lib/aiRead/analytics/pipeline";
import { buildAcceptRevenue } from "@/lib/aiRead/analytics/revenue";
import { buildForecastInputs } from "@/lib/aiRead/analytics/forecast";
import { buildSegmentBreakdown, SEGMENTS } from "@/lib/aiRead/analytics/segment";
import { buildSnapshotHistory } from "@/lib/aiRead/analytics/snapshot";
import { buildDataQuality } from "@/lib/aiRead/analytics/quality";

export const MCP_SERVER_INFO = { name: "bizstudio-portal-ca-kpi", version: "1.1.0" } as const;

const INSTRUCTIONS = [
  "株式会社ビズスタジオのポータルに登録された CA（キャリアアドバイザー）実績を読み取るツール群です。すべて読み取り専用で、求職者の個人情報は返しません（集計値のみ・人数 5 未満のグループは伏せます）。",
  "分析の前に必ず get_metric_definitions を読み、数値の定義・基準日付・信頼できる開始日・注意点に従ってください。",
  "CA別・期間別の実績は get_ca_kpi、CA の一覧は list_cas、会社全体の売上・粗利・目標は get_company_kpi を使います。",
  "深い分析と予測売上は、get_data_quality → get_ca_roster → 目的に応じて get_cohort_funnel（初回面談月コホート）/ get_selection_conversion（応募月コホート）/ get_pipeline_now（今の進行中）/ get_accept_revenue（承諾売上・粗利）/ get_forecast_inputs（予測の材料）/ get_segment_breakdown（切り口別）/ get_snapshot_history（日次推移）の順で使います。",
  "数値はツールで取得したものだけを使い、推測で数字を作らないでください。記録開始日（historySince）より前の履歴は存在しません。",
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

  // ---- T-XXX step5C: 分析ツール（第1段）。すべて読み取り専用・集計値のみ・少人数は伏せる ----------------------------

  const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM 形式（JST）で指定してください");
  const CA_ID = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "caId は社員番号（例 1000001）を指定してください")
    .optional()
    .describe("CA の社員番号（get_ca_roster / list_cas の employeeNumber）。省略すると在籍CA全員＋全体行（ca='ALL'）");
  const BY_CA = z.boolean().optional().describe("CA 別の行も返すか（既定 true。応答が大きいときは false にして全体だけにする）");

  /** 分析ツール共通の実行: 例外（入力誤り・上限超え）は対処法つきの isError にする。 */
  const analytics = (tool: string, args: unknown, fn: () => Promise<Record<string, unknown>>) =>
    run(tool, args, async () => {
      try {
        return jsonResult(await fn());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/サーバー内部|ECONN|timeout|Prisma|prisma/i.test(msg)) throw e;
        return errorResult(`${tool} エラー: ${msg}`);
      }
    });

  const COMMON_RETURNS =
    "共通で返るもの: definitionVersion・generatedAt（JST）・observationEnd（観測終了日＝今日）・period・cas（対象CA）・exclusions（除外条件）・suppression（伏せ方）・dataFreshness（最終更新時刻）・historySince（各記録の開始日）・counts（件数・除外・欠損率）・warnings（品質警告）・definitions（分母と定義）。";

  server.registerTool(
    "get_ca_roster",
    {
      title: "CA 一覧と在籍期間",
      description:
        "CA（キャリアアドバイザー）の一覧と在籍期間（入社日・退職日・登録状況・在籍月数）、今の担当人数・活動中（支援中/待機）・選考中（件数と人数）・承諾済み未入社を返す。" +
        "いつ使うか: 深い分析の最初（get_data_quality の次）に、どの CA をどの期間で比べてよいかを決めるとき。入社日未登録の CA は warnings に出る（在籍前の月を除けない）。" +
        "分母: 在籍CA＝job_category='CA'。current の数は取得時点の値。引数なし。" + COMMON_RETURNS,
      inputSchema: z.object({}),
      annotations: { ...READ_ONLY, title: "CA 一覧と在籍期間" },
    },
    async (args) => analytics("get_ca_roster", args, () => buildCaRoster()),
  );

  server.registerTool(
    "get_cohort_funnel",
    {
      title: "初回面談月コホートの進捗",
      description:
        "初回面談した月ごとに同じ求職者群を追い、初回提案→応募→書類通過→企業面接→内定→承諾→入社まで進んだ人数（rates は人数÷コホート人数）と、初回面談から各段階までの日数の分布（中央値・四分位）を、全体（ALL）と CA 別、月別と期間合計で返す。承諾なしで活動中の人数（observing）と終了（ended）を分けて返す。" +
        "いつ使うか: 『初回面談から何割がエントリー・承諾に進むか』『CA ごとの進み方の違い』『初回面談→承諾の日数』を見るとき。直近 2 か月は観測中が多く承諾率は未確定。" +
        "分母: その月に初回面談（辞退・日程再調整を除いた最も早い実施済み面談）した求職者の人数。既定の期間は 2026-05〜今月（最長 18 か月）。人数 5 未満のグループは伏せる。" + COMMON_RETURNS,
      inputSchema: z.object({
        cohortFrom: MONTH.optional().describe("コホート（初回面談月）の開始 YYYY-MM。既定 2026-05"),
        cohortTo: MONTH.optional().describe("コホートの終了 YYYY-MM（含む）。既定 今月"),
        caId: CA_ID,
        byCa: BY_CA,
      }),
      annotations: { ...READ_ONLY, title: "初回面談月コホートの進捗" },
    },
    async (args) => analytics("get_cohort_funnel", args, () => buildCohortFunnel(args)),
  );

  server.registerTool(
    "get_selection_conversion",
    {
      title: "応募月コホートの選考通過",
      description:
        "応募（エントリー）した月ごとに同じ案件群を追い、段階ごと（書類提出・書類通過・一次/二次/最終・企業面接・内定・承諾・入社）の到達件数と人数・率、エントリーから各段階までの日数の分布、取得時点の結果（承諾・承諾後辞退・辞退・見送り・クローズ・選考中・不明）を、全体と CA 別、月別と期間合計で返す。" +
        "いつ使うか: 『応募した案件のうち何割が書類通過・内定・承諾になるか』『辞退・見送りの内訳』『段階ごとの日数』を見るとき。同じ月の通過数÷応募数を通過率にしないこと（こちらは応募月起点の到達率）。" +
        "分母: その月にエントリーした案件数（1 案件 1 行・同じ人の複数応募は別の行。人数は people）。既定の期間は 2026-05〜今月。人数 5 未満のグループは伏せる。" + COMMON_RETURNS,
      inputSchema: z.object({
        from: MONTH.optional().describe("エントリー月の開始 YYYY-MM。既定 2026-05"),
        to: MONTH.optional().describe("エントリー月の終了 YYYY-MM（含む）。既定 今月"),
        caId: CA_ID,
        byCa: BY_CA,
      }),
      annotations: { ...READ_ONLY, title: "応募月コホートの選考通過" },
    },
    async (args) => analytics("get_selection_conversion", args, () => buildSelectionConversion(args)),
  );

  server.registerTool(
    "get_pipeline_now",
    {
      title: "今の進行中案件",
      description:
        "取得時点の進行中案件を段階別（エントリー済み・書類選考・一次/二次/最終/その他面接・内定承諾前）× CA 別に件数・人数と、段階に入ってからの日数の分布で返す。あわせて活動中の求職者数（支援中/待機）、今後の面談予約数（初回/継続）、承諾済み未入社（入社予定月別）を返す。全体（ALL）・担当なし（NONE）の行もある。" +
        "いつ使うか: 『今どれだけ案件が動いているか』『予測売上の母数』『停滞している段階』を見るとき。" +
        "分母: 有効（is_active・未アーカイブ）なエントリーのうち辞退/見送り/クローズ/入社済以外。件数・人数は伏せない（運用上の現在値）。分布は標本 5 未満で伏せる。" + COMMON_RETURNS,
      inputSchema: z.object({ caId: CA_ID }),
      annotations: { ...READ_ONLY, title: "今の進行中案件" },
    },
    async (args) => analytics("get_pipeline_now", args, () => buildPipelineNow(args)),
  );

  server.registerTool(
    "get_accept_revenue",
    {
      title: "承諾売上・粗利",
      description:
        "承諾月（acceptance_date の JST 月）× CA 別に、承諾件数・人数、承諾売上（税抜・円）・求人DB費・仕入・粗利（売上−求人DB費−仕入）、単価の分布、課金方式の内訳、入社日の入力状況、そして承諾後辞退（acceptedThenDeclined）を分けた値と net（承諾−承諾後辞退）を返す。" +
        "いつ使うか: 売上・粗利・単価・承諾後辞退の話題。『承諾売上』であり請求・入金ではない。ALL の revenue は get_company_kpi の invoiceRevenue と同じ母集団（承諾後辞退を含む）。" +
        "分母: 承諾日がある未アーカイブのエントリー。既定の期間は 2026-05〜今月。件数・合計は伏せない（既存ツールと同じ）。分布は標本 5 未満で伏せる。" + COMMON_RETURNS,
      inputSchema: z.object({
        from: MONTH.optional().describe("承諾月の開始 YYYY-MM。既定 2026-05"),
        to: MONTH.optional().describe("承諾月の終了 YYYY-MM（含む）。既定 今月"),
        caId: CA_ID,
        byCa: BY_CA,
      }),
      annotations: { ...READ_ONLY, title: "承諾売上・粗利" },
    },
    async (args) => analytics("get_accept_revenue", args, () => buildAcceptRevenue(args)),
  );

  server.registerTool(
    "get_forecast_inputs",
    {
      title: "予測売上の材料",
      description:
        "予測売上に必要な材料をまとめて返す（予測そのものは計算しない）: 学習期間の案件について各段階（エントリー・書類提出・書類通過・企業面接・内定）から承諾へ進んだ割合（全体分母 / 結果が出た分母）と残り日数の分布、初回面談→承諾の割合と日数、単価・粗利の分布、承諾後辞退の割合、今の進行中案件（段階別）、今後の面談予約、観測終了日、結果待ち件数。全体（ALL）と CA 別。" +
        "いつ使うか: 『今月・来月の予測売上』『このまま進むと承諾は何件か』を聞かれたとき。ChatGPT 側で『進行中案件 × 段階→承諾率 × 単価』と『今後の面談予約 × 初回面談→承諾率 × 単価』を分けて計算し、同じ人を二重に数えない。保守的／標準／好調の幅で出す。" +
        "分母: stageToAcceptance は学習期間にエントリーした案件、firstInterviewToAcceptance は学習期間に初回面談した人。既定の学習期間は 2026-05〜今月。" + COMMON_RETURNS,
      inputSchema: z.object({
        baseFrom: MONTH.optional().describe("学習期間（割合・日数・単価を学ぶ期間）の開始 YYYY-MM。既定 2026-05"),
        baseTo: MONTH.optional().describe("学習期間の終了 YYYY-MM（含む）。既定 今月"),
        caId: CA_ID,
      }),
      annotations: { ...READ_ONLY, title: "予測売上の材料" },
    },
    async (args) => analytics("get_forecast_inputs", args, () => buildForecastInputs(args)),
  );

  server.registerTool(
    "get_segment_breakdown",
    {
      title: "切り口別の進捗",
      description:
        "希望職種・経験職種・現年収帯・希望年収帯・転職時期・最終学歴区分・希望勤務地・希望雇用形態・活動期間・他社エージェント利用の、初回面談の面談詳細の値で求職者を分け、区分ごとの初回面談人数・提案・エントリー・企業面接・内定・承諾の人数と率、日数の中央値を返す。全体と（byCa=true なら）CA 別。" +
        "いつ使うか: 『どの職種・年収帯の人が承諾に進みやすいか』『切り口ごとの差』を見るとき。少人数の区分は伏せられる。相関を因果と読まない。" +
        "分母: その区分の初回面談人数（期間は初回面談月・既定 2026-05〜今月）。面談詳細が無い人は『未記載』。人数 5 未満の区分は伏せる。" + COMMON_RETURNS,
      inputSchema: z.object({
        segment: z.enum(SEGMENTS).describe("切り口。desiredJobType=希望職種1 / experienceJobType=経験職種 / currentSalaryBand=現年収帯 / desiredSalaryBand=希望年収帯 / jobChangeTimeline=転職時期 / educationLevel=最終学歴区分 / desiredPrefecture=希望勤務地 / desiredEmploymentType=希望雇用形態 / activityPeriod=活動期間 / agentUsage=他社エージェント利用"),
        from: MONTH.optional().describe("初回面談月の開始 YYYY-MM。既定 2026-05"),
        to: MONTH.optional().describe("初回面談月の終了 YYYY-MM（含む）。既定 今月"),
        caId: CA_ID,
        byCa: z.boolean().optional().describe("CA 別の内訳も返すか（既定 false。CA 別は少人数で伏せられやすい）"),
      }),
      annotations: { ...READ_ONLY, title: "切り口別の進捗" },
    },
    async (args) => analytics("get_segment_breakdown", args, () => buildSegmentBreakdown(args)),
  );

  server.registerTool(
    "get_snapshot_history",
    {
      title: "日次スナップショットの推移",
      description:
        "毎日 23:50 JST に保存している進行中案件の日次スナップショット（活動中の求職者数・段階別の選考中件数・承諾済み未入社・今後の面談予約）の推移を、日 × CA（ALL / NONE / 各CA）で返す。記録開始日（period.recordedSince・historySince.pipelineSnapshot）以降の分しか無い。" +
        "いつ使うか: 『先週と比べて選考中が増えたか』『予測の答え合わせ』など、ある日時点の進行中の数を見るとき。" +
        "分母: get_pipeline_now と同じ定義の保存値。期間は YYYY-MM-DD で最長 120 日（既定 直近 30 日）。" + COMMON_RETURNS,
      inputSchema: z.object({
        from: YMD.optional().describe("開始日 YYYY-MM-DD（JST）。既定 to の 30 日前"),
        to: YMD.optional().describe("終了日 YYYY-MM-DD（含む）。既定 今日"),
        caId: CA_ID,
      }),
      annotations: { ...READ_ONLY, title: "日次スナップショットの推移" },
    },
    async (args) => analytics("get_snapshot_history", args, () => buildSnapshotHistory(args)),
  );

  server.registerTool(
    "get_data_quality",
    {
      title: "データ品質・記録開始日",
      description:
        "項目ごとの入力率（初回面談の面談詳細・エントリーの各日付・承諾の売上/費用/入社日・面談記録の結果/評価）、各記録の開始日（担当CA替え・選考ステータス・支援状況・希望条件・日次スナップショット）、CA の入社日・退職日の登録状況、定義の注意点、品質警告の一覧を返す。" +
        "いつ使うか: 深い分析の最初に必ず 1 回。どの項目が使えるか・どこから履歴があるかを確かめてから他のツールを呼ぶ。" +
        "分母: 期間（既定 2026-05〜今月）の初回面談人数・エントリー件数・承諾件数・面談記録数。" + COMMON_RETURNS,
      inputSchema: z.object({
        from: MONTH.optional().describe("対象期間の開始 YYYY-MM。既定 2026-05"),
        to: MONTH.optional().describe("対象期間の終了 YYYY-MM（含む）。既定 今月"),
      }),
      annotations: { ...READ_ONLY, title: "データ品質・記録開始日" },
    },
    async (args) => analytics("get_data_quality", args, () => buildDataQuality(args)),
  );

  return server;
}
