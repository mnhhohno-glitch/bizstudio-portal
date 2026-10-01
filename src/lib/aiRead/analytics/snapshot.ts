// T-XXX step5C: get_snapshot_history — 日次スナップショット（ca_pipeline_daily_snapshots）の推移。記録開始日以降のみ。
import { prisma } from "@/lib/prisma";
import { SNAPSHOT_CA_KEY_ALL, SNAPSHOT_CA_KEY_NONE } from "@/lib/pipeline-snapshot";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { isValidYmd, addDaysYmd, daysInclusive } from "@/lib/aiRead/caKpiParams";
import { buildEnvelope, resolveCas, checkResponseSize, COMMON_DEFINITIONS, ALL_KEY } from "./common";

const MAX_DAYS = 120;

export async function buildSnapshotHistory(input: { from?: string; to?: string; caId?: string }): Promise<Record<string, unknown>> {
  const today = todayJstDateString();
  const to = input.to ?? today;
  const from = input.from ?? addDaysYmd(to, -30);
  if (!isValidYmd(from) || !isValidYmd(to)) throw new Error("from / to は YYYY-MM-DD 形式で指定してください");
  if (from > to) throw new Error("from は to 以前の日付を指定してください");
  if (daysInclusive(from, to) > MAX_DAYS) throw new Error(`期間が長すぎます（上限 ${MAX_DAYS} 日）。期間を分けて呼んでください`);
  const { roster, targets, single } = await resolveCas(input.caId);
  const keys = [...(single ? [] : [SNAPSHOT_CA_KEY_ALL, SNAPSHOT_CA_KEY_NONE]), ...targets.map((c) => c.id)];
  const rows = await prisma.caPipelineDailySnapshot.findMany({
    where: { snapshotDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) }, caKey: { in: keys } },
    orderBy: [{ snapshotDate: "asc" }, { caKey: "asc" }],
  });
  const since = await prisma.caPipelineDailySnapshot.aggregate({ _min: { snapshotDate: true } });
  const label = (key: string) => (key === SNAPSHOT_CA_KEY_ALL ? ALL_KEY : key === SNAPSHOT_CA_KEY_NONE ? "NONE" : (targets.find((c) => c.id === key)?.employeeNumber ?? key));
  const env = await buildEnvelope({
    tool: "get_snapshot_history",
    period: { from, to, days: daysInclusive(from, to), recordedSince: since._min.snapshotDate ? since._min.snapshotDate.toISOString().slice(0, 10) : null },
    cas: targets,
    single,
    roster,
    exclusions: [],
    counts: { rows: rows.length, days: new Set(rows.map((r) => r.snapshotDate.toISOString().slice(0, 10))).size },
    warnings: [
      since._min.snapshotDate ? "記録開始日より前の日付の行は無い（過去分は作れない）" : "まだスナップショットが 1 件も無い（本番反映当日の 23:50 JST から毎日 1 回保存される）",
      "保存は毎日 23:50 JST。同じ日に 2 回保存されると最後の値で上書き（run_count で分かる）",
    ],
    definitions: {
      row: "1 日 × CA の集計値（get_pipeline_now と同じ定義・個人の行は保存していない）。ALL=全体、NONE=担当なし",
      activeCandidates: "support_status が ACTIVE / WAITING の人数（active / waiting の内訳つき）",
      stages: "取得時点の段階ごとの有効エントリー件数。inSelectionRecords / inSelectionCandidates は 書類選考〜内定（承諾前）",
      acceptedNotJoined: "承諾済み未入社の件数",
      upcomingInterviews: "保存時点で面談日が未来の予約（first=初回 / existing=2 回目以降）",
      attribution: COMMON_DEFINITIONS.attribution,
    },
  });
  const body = {
    ...env,
    rows: rows.map((r) => ({
      date: r.snapshotDate.toISOString().slice(0, 10),
      ca: label(r.caKey),
      activeCandidates: { total: r.activeCandidates, active: r.activeStatusActive, waiting: r.activeStatusWaiting },
      stages: {
        entered: r.entered, documentScreening: r.documentScreening, firstInterview: r.firstInterview, secondInterview: r.secondInterview,
        finalInterview: r.finalInterview, interviewOther: r.interviewOther, offered: r.offered,
      },
      inSelection: { records: r.inSelectionRecords, people: r.inSelectionCandidates },
      acceptedNotJoined: r.acceptedNotJoined,
      upcomingInterviews: { first: r.upcomingInterviewsFirst, existing: r.upcomingInterviewsExisting },
      runCount: r.runCount,
    })),
  };
  const tooBig = checkResponseSize(body);
  if (tooBig) throw new Error(tooBig);
  return body;
}
