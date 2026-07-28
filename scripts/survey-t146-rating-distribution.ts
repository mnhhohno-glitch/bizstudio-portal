/**
 * T-146 Phase 1: ブックマークAI評価の分布調査（★読み取り専用★）
 *
 * 目的:
 *   評価の5段階化（A/B+/B/C/D）に先立ち、現行データの実態を把握する。
 *   - 3軸（本人希望・通過率・総合）の A/B/C/D 分布
 *   - 「B〜C」のような幅を持った評価の実件数・出現パターン・時期別推移
 *   - aiMatchRating（総合ミラー列）と本文パース結果の食い違い
 *   - 本文マーカーの表記ゆれ（■ の有無）による表示漏れ
 *
 * ★重要★
 *   本番の表示側 regex `/■\s*総合[：:]\s*([ABCD])/` は先頭1文字しかキャプチャしないため、
 *   本文が「■ 総合：B〜C」でも画面上は「B」と表示される。
 *   よって幅評価はパース結果では検出できず、生テキストを見る必要がある。
 *   本スクリプトは生テキスト（マーカー以降の行末まで）を採取して分類する。
 *
 * 使い方:
 *   npx tsx scripts/survey-t146-rating-distribution.ts
 *
 * 注意:
 *   SELECT のみ。UPDATE/DELETE/INSERT は一切行わない。
 *   日付は JST（罠#17: toISOString().slice(0,10) は使わない）。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BATCH = 500;

type Axis = "wish" | "pass" | "overall";
const AXIS_MARKER: Record<Axis, string> = {
  wish: "本人希望",
  pass: "通過率",
  overall: "総合",
};

/** 本番の HistoryTab.parse3AxisRatings と同一（■ 必須・先頭1文字のみ）。 */
function parseProdStrict(comment: string, axis: Axis): string | null {
  const re = new RegExp(`■\\s*${AXIS_MARKER[axis]}[：:]\\s*([ABCD])`);
  return comment.match(re)?.[1] ?? null;
}

/** analyze-batch 側の緩い判定（■ 省略可）。HistoryTab との差分を測るために使う。 */
function parseLoose(comment: string, axis: Axis): string | null {
  const re = new RegExp(`(?:■\\s*)?${AXIS_MARKER[axis]}[：:]\\s*([ABCD])`);
  return comment.match(re)?.[1] ?? null;
}

/** マーカー行の「値の表現そのもの」を行末まで採取する（幅評価の検出用）。 */
function extractRawValue(comment: string, axis: Axis): string | null {
  const re = new RegExp(`■?\\s*${AXIS_MARKER[axis]}\\s*[：:]\\s*([^\\n\\r]{0,40})`);
  const m = comment.match(re);
  if (!m) return null;
  return m[1].trim();
}

type ValueKind = "single" | "plus" | "width" | "empty" | "other";

/** 採取した値表現を分類する。 */
function classifyValue(raw: string): { kind: ValueKind; normalized: string } {
  if (!raw) return { kind: "empty", normalized: "(空)" };

  // 先頭の連続するランク表現だけを取り出す（後続の説明文を落とす）
  // 例: "B〜C　条件は合うが..." → "B〜C" / "A 非常に良い" → "A"
  const head = raw.slice(0, 12);

  // 単独（後ろに説明が続いてもよいが、2つ目のランク文字が近接していない）
  const single = /^([ABCD])(?![＋+])(?:\s|$|[^A-D＋+])/.exec(head);
  const plus = /^([ABCD])[＋+]/.exec(head);
  // 幅: ランク文字 → 区切り（記号/かな/空白）→ ランク文字
  const width = /^([ABCD])[＋+]?\s*(?:[〜～~ー\-–—/／・、,]|か|または|もしくは|or|\s)+\s*([ABCD])/i.exec(head);

  if (width) return { kind: "width", normalized: `${width[1]}〜${width[2]}` };
  if (plus) return { kind: "plus", normalized: `${plus[1]}+` };
  if (single) return { kind: "single", normalized: single[1] };
  return { kind: "other", normalized: head };
}

function jstMonth(d: Date | null): string {
  if (!d) return "(日付なし)";
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 7);
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;
}

function printDist(title: string, counts: Map<string, number>, total: number) {
  console.log(`\n### ${title}（母数 ${total}）`);
  const order = ["A", "B+", "B", "C", "D"];
  const keys = [
    ...order.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !order.includes(k)).sort(),
  ];
  for (const k of keys) {
    const c = counts.get(k) ?? 0;
    console.log(`  ${k.padEnd(4)} : ${String(c).padStart(6)} 件  ${pct(c, total)}`);
  }
}

function inc(m: Map<string, number>, k: string, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

async function main() {
  const url = process.env.DATABASE_URL || "";
  console.log("=== T-146 ブックマークAI評価 分布調査（読み取り専用）===");
  console.log(`実行: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`);
  console.log(`DB host: ${url.match(/@([^/:]+)/)?.[1] ?? "(unknown)"}`);

  const total = await prisma.candidateFile.count({ where: { category: "BOOKMARK" } });
  const withComment = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", aiAnalysisComment: { not: null } },
  });
  const withRating = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", aiMatchRating: { not: null } },
  });
  const archived = await prisma.candidateFile.count({
    where: { category: "BOOKMARK", archivedAt: { not: null } },
  });

  console.log(`\n## 0. 母数`);
  console.log(`  BOOKMARK 総数            : ${total}`);
  console.log(`  aiAnalysisComment あり   : ${withComment}  ${pct(withComment, total)}`);
  console.log(`  aiMatchRating あり       : ${withRating}  ${pct(withRating, total)}`);
  console.log(`  紹介保留(archivedAt有)   : ${archived}  ${pct(archived, total)}`);

  // --- 集計器 ---
  const distStrict: Record<Axis, Map<string, number>> = { wish: new Map(), pass: new Map(), overall: new Map() };
  const kindCount: Record<Axis, Map<ValueKind, number>> = { wish: new Map(), pass: new Map(), overall: new Map() };
  const rawSamples: Record<Axis, Map<string, number>> = { wish: new Map(), pass: new Map(), overall: new Map() };
  const widthByMonth = new Map<string, number>();
  const analyzedByMonth = new Map<string, number>();
  // 幅評価の発生日を特定するための日次集計（直近90日相当のみ保持）。
  const widthByDay = new Map<string, number>();
  const analyzedByDay = new Map<string, number>();
  const widthExamples: { id: string; axis: Axis; raw: string; month: string }[] = [];

  let noMarkerAtAll = 0; // コメントはあるが3軸マーカーが1つも無い
  let mismatchRatingVsParsed = 0; // aiMatchRating と本文パース(総合)の食い違い
  const mismatchExamples: { id: string; rating: string | null; parsed: string | null }[] = [];
  let strictMissLooseHit = 0; // ■ 無しで HistoryTab が読めない件数
  const strictMissExamples: { id: string; axis: Axis; raw: string }[] = [];
  let anyWidthRow = 0; // 3軸のいずれかに幅がある行数
  let plusAlreadyExists = 0; // 既に B+ 等が入っている行数

  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const rows = await prisma.candidateFile.findMany({
      where: { category: "BOOKMARK", aiAnalysisComment: { not: null } },
      select: {
        id: true,
        aiMatchRating: true,
        aiAnalysisComment: true,
        aiAnalyzedAt: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    for (const r of rows) {
      const c = r.aiAnalysisComment ?? "";
      const when = r.aiAnalyzedAt ?? r.createdAt;
      const month = jstMonth(when);
      const day = when
        ? when.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
        : "(日付なし)";

      let hasAnyMarker = false;
      let rowHasWidth = false;
      let rowHasPlus = false;

      for (const axis of ["wish", "pass", "overall"] as Axis[]) {
        const raw = extractRawValue(c, axis);
        if (raw === null) continue;
        hasAnyMarker = true;

        const { kind, normalized } = classifyValue(raw);
        inc(kindCount[axis] as unknown as Map<string, number>, kind);
        inc(rawSamples[axis], normalized);

        if (kind === "single" || kind === "plus") {
          inc(distStrict[axis], normalized);
        }
        if (kind === "width") {
          rowHasWidth = true;
          inc(distStrict[axis], `幅:${normalized}`);
          if (widthExamples.length < 40) widthExamples.push({ id: r.id, axis, raw, month });
        }
        if (kind === "plus") rowHasPlus = true;

        // ■ の有無による表示漏れ（HistoryTab strict が読めず loose なら読める）
        const s = parseProdStrict(c, axis);
        const l = parseLoose(c, axis);
        if (s === null && l !== null) {
          strictMissLooseHit++;
          if (strictMissExamples.length < 20) strictMissExamples.push({ id: r.id, axis, raw });
        }
      }

      if (!hasAnyMarker) noMarkerAtAll++;
      if (rowHasWidth) {
        anyWidthRow++;
        inc(widthByMonth, month);
        inc(widthByDay, day);
      }
      if (rowHasPlus) plusAlreadyExists++;
      if (hasAnyMarker) {
        inc(analyzedByMonth, month);
        inc(analyzedByDay, day);
      }

      // aiMatchRating vs 本文パース（総合）
      const parsedOverall = parseProdStrict(c, "overall");
      if ((r.aiMatchRating ?? null) !== parsedOverall) {
        mismatchRatingVsParsed++;
        if (mismatchExamples.length < 20)
          mismatchExamples.push({ id: r.id, rating: r.aiMatchRating, parsed: parsedOverall });
      }
    }

    if (scanned % 5000 === 0) console.error(`  ...scanned ${scanned}`);
  }

  console.log(`\n  走査した行数（コメントあり）: ${scanned}`);

  // --- 3-1 3軸分布 ---
  console.log(`\n## 3-1. 3軸それぞれの分布（本文パースベース）`);
  for (const axis of ["wish", "pass", "overall"] as Axis[]) {
    const m = distStrict[axis];
    const t = [...m.values()].reduce((a, b) => a + b, 0);
    printDist(`${AXIS_MARKER[axis]}（${axis}）`, m, t);
  }

  // --- 3-2 幅評価の件数 ---
  console.log(`\n## 3-2. 幅を持った評価の件数`);
  console.log(`  3軸のいずれかに幅がある行 : ${anyWidthRow} 件  （コメントあり ${scanned} 件中 ${pct(anyWidthRow, scanned)}）`);
  for (const axis of ["wish", "pass", "overall"] as Axis[]) {
    const w = (kindCount[axis] as unknown as Map<string, number>).get("width") ?? 0;
    console.log(`    ${AXIS_MARKER[axis].padEnd(6)} : ${w} 件`);
  }
  console.log(`  既に B+ 等のプラス表記がある行 : ${plusAlreadyExists} 件`);

  // --- 3-3 出現パターン ---
  console.log(`\n## 3-3. 値表現の出現パターン（軸別・上位20）`);
  for (const axis of ["wish", "pass", "overall"] as Axis[]) {
    console.log(`\n### ${AXIS_MARKER[axis]}`);
    const sorted = [...rawSamples[axis].entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [v, c] of sorted) console.log(`  ${String(c).padStart(6)}  "${v}"`);
  }
  console.log(`\n### 幅評価の生テキスト実例（最大40件）`);
  for (const e of widthExamples) {
    console.log(`  [${e.month}] ${AXIS_MARKER[e.axis]}: "${e.raw}"  (id=${e.id})`);
  }

  // --- 3-4 時期別推移 ---
  console.log(`\n## 3-4. 幅評価の時期別推移（JST・aiAnalyzedAt 基準）`);
  const months = [...new Set([...widthByMonth.keys(), ...analyzedByMonth.keys()])].sort();
  console.log(`  月        判定行数   幅あり   比率`);
  for (const mo of months) {
    const a = analyzedByMonth.get(mo) ?? 0;
    const w = widthByMonth.get(mo) ?? 0;
    console.log(`  ${mo.padEnd(9)} ${String(a).padStart(7)} ${String(w).padStart(8)}   ${pct(w, a)}`);
  }

  // --- 3-1b 2軸クロス集計（B+ のマッピング設計用） ---
  // SKILL.md の総合評価テーブルは「希望 × 通過」で総合を決める。
  // どのセルに何件あるかが、B+ を割り当てたときの母数をそのまま決める。
  console.log(`\n## 3-1b. 本人希望 × 通過率 クロス集計（B+ 割当設計用）`);
  const cross = new Map<string, number>();
  const crossOverall = new Map<string, Map<string, number>>();
  {
    let cur2: string | undefined;
    for (;;) {
      const rows = await prisma.candidateFile.findMany({
        where: { category: "BOOKMARK", aiAnalysisComment: { not: null } },
        select: { id: true, aiAnalysisComment: true },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cur2 ? { cursor: { id: cur2 }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cur2 = rows[rows.length - 1].id;
      for (const r of rows) {
        const c = r.aiAnalysisComment ?? "";
        const w = parseProdStrict(c, "wish");
        const p = parseProdStrict(c, "pass");
        const o = extractRawValue(c, "overall");
        if (!w || !p) continue;
        const key = `${w} × ${p}`;
        inc(cross, key);
        const ov = o ? classifyValue(o).normalized : "(なし)";
        if (!crossOverall.has(key)) crossOverall.set(key, new Map());
        inc(crossOverall.get(key)!, ov);
      }
    }
  }
  const crossTotal = [...cross.values()].reduce((a, b) => a + b, 0);
  console.log(`  希望×通過      件数     割合    現在の総合の内訳`);
  for (const [k, v] of [...cross.entries()].sort((a, b) => b[1] - a[1])) {
    const inner = crossOverall.get(k)!;
    const detail = [...inner.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ov, n]) => `${ov}:${n}`)
      .join(" ");
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)}  ${pct(v, crossTotal).padStart(6)}    ${detail}`);
  }

  // --- 3-4b 日次推移（幅評価の発生日特定用・幅が出た月のみ） ---
  console.log(`\n## 3-4b. 幅評価の日次推移（幅が発生した月のみ・JST）`);
  const widthMonths = new Set([...widthByMonth.keys()]);
  const days = [...analyzedByDay.keys()]
    .filter((d) => widthMonths.has(d.slice(0, 7)))
    .sort();
  console.log(`  日付          判定数   幅あり   比率`);
  for (const d of days) {
    const a = analyzedByDay.get(d) ?? 0;
    const w = widthByDay.get(d) ?? 0;
    console.log(`  ${d}   ${String(a).padStart(6)} ${String(w).padStart(8)}   ${pct(w, a)}`);
  }

  // --- 3-5 ミラー列の食い違い ---
  console.log(`\n## 3-5. aiMatchRating と本文パース(総合)の食い違い`);
  console.log(`  食い違い行数: ${mismatchRatingVsParsed} 件  （コメントあり ${scanned} 件中 ${pct(mismatchRatingVsParsed, scanned)}）`);
  console.log(`  実例（最大20件）:`);
  for (const e of mismatchExamples) {
    console.log(`    id=${e.id}  aiMatchRating=${e.rating ?? "NULL"}  本文パース=${e.parsed ?? "NULL"}`);
  }

  // --- 3-6 評価なし ---
  console.log(`\n## 3-6. 評価なし`);
  console.log(`  コメントあり・3軸マーカーが1つも無い : ${noMarkerAtAll} 件`);
  console.log(`  コメント自体が NULL                  : ${total - withComment} 件`);

  // --- 3-7 ■ の有無による表示漏れ ---
  console.log(`\n## 3-7. ■ 表記ゆれによる表示漏れ（HistoryTab は ■ 必須・analyze-batch は省略可）`);
  console.log(`  strict が読めず loose なら読める軸の数: ${strictMissLooseHit}`);
  console.log(`  実例（最大20件）:`);
  for (const e of strictMissExamples) {
    console.log(`    id=${e.id}  ${AXIS_MARKER[e.axis]}: "${e.raw}"`);
  }

  console.log(`\n=== 完了（SELECT のみ・書き込みなし）===`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
