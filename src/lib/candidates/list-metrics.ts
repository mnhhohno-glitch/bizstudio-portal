// T-170: 求職者管理一覧（/admin/master）に出す 5 指標の一括集計。
//
// - 希望職種 / 希望エリア: 最新面談（InterviewRecord.isLatest=true）の希望条件タブの入力
//   （InterviewDetail.desiredJobTypes / desiredAreas。旧データ用に単一カラムへフォールバック）。
//   Candidate.desiredJobType1 は充足率が低いため使わない（03-portal-spec の方針）。
// - 求人紹介数 / 放置日数: ダッシュボードタブと同一定義。定義は src/lib/candidates/last-contact.ts の
//   共通関数に集約しており、ダッシュボード route も同じものを呼ぶ。
// - エントリー数: JobEntry のうち entryFlag ∈ {エントリー,書類選考,面接,内定} のレコード件数
//   （有効/無効は問わない・入社済は含めない）。
//
// N+1 禁止: 候補者数によらずクエリ本数は固定（6本）。全て groupBy / findMany の一括取得。

import { prisma } from "@/lib/prisma";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import {
  DELIVERED_BOOKMARK_FILTER,
  computeLastContact,
  idleDaysFrom,
  idleLevelOf,
  maxDate,
  type IdleLevel,
} from "./last-contact";

/** エントリー数の対象 entryFlag（入社済は含めない）。 */
export const ENTRY_COUNT_FLAGS = ["エントリー", "書類選考", "面接", "内定"] as const;

export type CandidateListMetrics = {
  desiredJobType: string | null; // 表示用（第1希望 ＋「ほかN件」）
  desiredJobTypeFull: string | null; // title 用フル文字列
  desiredArea: string | null;
  desiredAreaFull: string | null;
  referralCount: number; // 求人紹介数（＝ダッシュボードの求人配信数）
  entryCount: number; // エントリー数
  idleDays: number | null; // 放置日数
  idleLevel: IdleLevel | null; // 信号色
};

export const EMPTY_CANDIDATE_LIST_METRICS: CandidateListMetrics = {
  desiredJobType: null,
  desiredJobTypeFull: null,
  desiredArea: null,
  desiredAreaFull: null,
  referralCount: 0,
  entryCount: 0,
  idleDays: null,
  idleLevel: null,
};

/* ---------- 希望条件の整形 ---------- */

type Item = { label: string; full: string };

// 旧データの自由記述には改行が混ざることがあるため、連続する空白・改行は 1 スペースに畳む。
// （1行 truncate の列に出すのと、title のフル文字列を読みやすくするため）
function str(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

// desiredJobTypes: SearchableMultiSelect が保存する [{large, medium, small}]（最大3件）
function jobTypeItems(json: unknown, fallback: string | null): Item[] {
  if (Array.isArray(json)) {
    const items = json
      .map((raw): Item => {
        const o = (raw ?? {}) as Record<string, unknown>;
        const parts = [str(o.large), str(o.medium), str(o.small)].filter(Boolean);
        return { label: parts[parts.length - 1] ?? "", full: parts.join(" / ") };
      })
      .filter((i) => i.full);
    if (items.length > 0) return items;
  }
  // 旧データ: desiredJobType1 は "大 / 中 / 小" 形式の単一文字列
  const fb = str(fallback);
  if (!fb) return [];
  const parts = fb.split("/").map((s) => s.trim()).filter(Boolean);
  return [{ label: parts[parts.length - 1] ?? fb, full: fb }];
}

// desiredAreas: [{area, prefecture, city}]（最大5件）。より古い行は {large, medium, small} で入っていることがある。
function areaItems(
  json: unknown,
  fallbackArea: string | null,
  fallbackPrefecture: string | null,
  fallbackCity: string | null,
): Item[] {
  if (Array.isArray(json)) {
    const items = json
      .map((raw): Item => {
        const o = (raw ?? {}) as Record<string, unknown>;
        const area = str(o.area) || str(o.large);
        const prefecture = str(o.prefecture) || str(o.medium);
        const city = str(o.city) || str(o.small);
        const parts = [area, prefecture, city].filter(Boolean);
        return { label: prefecture || area || city, full: parts.join(" / ") };
      })
      .filter((i) => i.full);
    if (items.length > 0) return items;
  }
  const area = str(fallbackArea);
  const prefecture = str(fallbackPrefecture);
  const city = str(fallbackCity);
  const parts = [area, prefecture, city].filter(Boolean);
  if (parts.length === 0) return [];
  return [{ label: prefecture || area || city, full: parts.join(" / ") }];
}

function joinFull(items: Item[]): string | null {
  return items.length > 0 ? items.map((i) => i.full).join("、") : null;
}

// 表示用ラベルの連結。同じ都道府県を市区違いで複数選ぶケースがあるため重複は畳む（順序は維持）。
// フル文字列（title）側は畳まずに全件そのまま出す。
function joinLabels(items: Item[]): string | null {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const i of items) {
    if (!i.label || seen.has(i.label)) continue;
    seen.add(i.label);
    labels.push(i.label);
  }
  return labels.length > 0 ? labels.join("、") : null;
}

/* ---------- 本体 ---------- */

export async function computeCandidateListMetrics(
  candidateIds: string[],
): Promise<Map<string, CandidateListMetrics>> {
  const out = new Map<string, CandidateListMetrics>();
  if (candidateIds.length === 0) return out;

  const scope = { candidateId: { in: candidateIds } };

  const [interviewAgg, noteAgg, contactLogAgg, deliveryAgg, entryAgg, latestInterviews] =
    await Promise.all([
      // 最終接触日の材料①: 面談実施日（ダッシュボードは orderBy interviewDate desc の1件 ＝ 最大値）
      prisma.interviewRecord.groupBy({
        by: ["candidateId"],
        where: scope,
        _max: { interviewDate: true },
      }),
      // ②連絡メモ
      prisma.candidateNote.groupBy({
        by: ["candidateId"],
        where: scope,
        _max: { createdAt: true },
      }),
      // ③連絡記録
      prisma.contactLog.groupBy({
        by: ["candidateId"],
        where: scope,
        _max: { contactedAt: true },
      }),
      // ④求人提案（送信・紹介）＝ 求人紹介数の母数でもあるので件数と最新日を同時に取る
      prisma.candidateFile.groupBy({
        by: ["candidateId"],
        where: { ...DELIVERED_BOOKMARK_FILTER, ...scope },
        _max: { lastExportedAt: true, introducedAt: true },
        _count: { id: true },
      }),
      // エントリー数（レコード件数）
      prisma.jobEntry.groupBy({
        by: ["candidateId"],
        where: { ...scope, entryFlag: { in: [...ENTRY_COUNT_FLAGS] } },
        _count: { id: true },
      }),
      // 希望条件（最新面談の希望条件タブ）
      prisma.interviewRecord.findMany({
        where: { ...scope, isLatest: true },
        orderBy: { interviewDate: "asc" }, // 同一候補者に複数あれば最後（＝最新）で上書き
        select: {
          candidateId: true,
          detail: {
            select: {
              desiredJobTypes: true,
              desiredJobType1: true,
              desiredAreas: true,
              desiredArea: true,
              desiredPrefecture: true,
              desiredCity: true,
            },
          },
        },
      }),
    ]);

  const interviewMap = new Map(interviewAgg.map((r) => [r.candidateId, r._max.interviewDate]));
  const noteMap = new Map(noteAgg.map((r) => [r.candidateId, r._max.createdAt]));
  const contactMap = new Map(contactLogAgg.map((r) => [r.candidateId, r._max.contactedAt]));
  const deliveryMap = new Map(
    deliveryAgg.map((r) => [
      r.candidateId,
      { at: maxDate(r._max.lastExportedAt, r._max.introducedAt), count: r._count.id },
    ]),
  );
  const entryMap = new Map(entryAgg.map((r) => [r.candidateId, r._count.id]));

  const desiredMap = new Map<string, { job: Item[]; area: Item[] }>();
  for (const rec of latestInterviews) {
    const d = rec.detail;
    if (!d) continue;
    desiredMap.set(rec.candidateId, {
      job: jobTypeItems(d.desiredJobTypes, d.desiredJobType1),
      area: areaItems(d.desiredAreas, d.desiredArea, d.desiredPrefecture, d.desiredCity),
    });
  }

  // 「今日」は全行で共通（1回だけ算出）。罠#17: JST 基準。
  const todayStr = todayJstDateString();

  for (const id of candidateIds) {
    const delivery = deliveryMap.get(id);
    const lastContact = computeLastContact({
      latestInterviewAt: interviewMap.get(id) ?? null,
      latestNoteAt: noteMap.get(id) ?? null,
      latestContactLogAt: contactMap.get(id) ?? null,
      latestDeliveryAt: delivery?.at ?? null,
    });
    const idleDays = idleDaysFrom(lastContact, todayStr);
    const desired = desiredMap.get(id);
    const jobItems = desired?.job ?? [];
    const areas = desired?.area ?? [];

    out.set(id, {
      desiredJobType:
        jobItems.length > 0
          ? jobItems[0].label + (jobItems.length > 1 ? ` ほか${jobItems.length - 1}件` : "")
          : null,
      desiredJobTypeFull: joinFull(jobItems),
      desiredArea: joinLabels(areas),
      desiredAreaFull: joinFull(areas),
      referralCount: delivery?.count ?? 0,
      entryCount: entryMap.get(id) ?? 0,
      idleDays,
      idleLevel: idleLevelOf(idleDays),
    });
  }

  return out;
}
