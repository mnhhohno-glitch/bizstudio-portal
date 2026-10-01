/**
 * T-XXX step2: /api/ai/ca-kpi のパラメータ検証・期間の区切り（純粋関数）のテスト。DB 不要。
 *
 * 実行: npx tsx scripts/test-ca-kpi-params-t-xxx-step2.ts
 * 失敗があれば exit 1。
 */
import assert from "node:assert/strict";
import {
  parseCaKpiQuery,
  buildCaKpiBuckets,
  isValidYmd,
  daysInclusive,
  lastDayOfMonthYmd,
  checkCaKpiSizeLimit,
  estimateCaKpiRowBytes,
  CA_KPI_DEFAULT_GROUPS,
} from "@/lib/aiRead/caKpiParams";

const TODAY = "2026-10-01";
const sp = (q: string) => new URLSearchParams(q);
let count = 0;
function test(name: string, fn: () => void) {
  fn();
  count++;
  console.log(`ok - ${name}`);
}

test("isValidYmd", () => {
  assert.equal(isValidYmd("2026-02-28"), true);
  assert.equal(isValidYmd("2026-02-30"), false);
  assert.equal(isValidYmd("2026-13-01"), false);
  assert.equal(isValidYmd("20260101"), false);
});

test("daysInclusive / lastDayOfMonth", () => {
  assert.equal(daysInclusive("2026-08-01", "2026-08-31"), 31);
  assert.equal(daysInclusive("2026-08-01", "2026-08-01"), 1);
  assert.equal(daysInclusive("2026-08-02", "2026-08-01"), 0);
  assert.equal(lastDayOfMonthYmd("2026-02"), "2026-02-28");
  assert.equal(lastDayOfMonthYmd("2028-02"), "2028-02-29");
  assert.equal(lastDayOfMonthYmd("2026-12"), "2026-12-31");
});

test("month buckets: 暦月・両端は切り詰め", () => {
  const b = buildCaKpiBuckets("2026-07-15", "2026-09-10", "month");
  assert.deepEqual(b, [
    { key: "2026-07", from: "2026-07-15", to: "2026-07-31" },
    { key: "2026-08", from: "2026-08-01", to: "2026-08-31" },
    { key: "2026-09", from: "2026-09-01", to: "2026-09-10" },
  ]);
  assert.deepEqual(buildCaKpiBuckets("2026-08-01", "2026-08-31", "month"), [{ key: "2026-08", from: "2026-08-01", to: "2026-08-31" }]);
  // 年またぎ
  assert.deepEqual(
    buildCaKpiBuckets("2025-12-20", "2026-01-05", "month").map((x) => x.key),
    ["2025-12", "2026-01"],
  );
});

test("week buckets: 月曜始まり日曜終わり・最初と最後は端数", () => {
  // 2026-08-01 は土曜。W1 = 8/1(土)〜8/2(日)、以降 月〜日。
  const b = buildCaKpiBuckets("2026-08-01", "2026-08-31", "week");
  assert.deepEqual(b[0], { key: "2026-08-01", from: "2026-08-01", to: "2026-08-02" });
  assert.deepEqual(b[1], { key: "2026-08-03", from: "2026-08-03", to: "2026-08-09" });
  assert.deepEqual(b[b.length - 1], { key: "2026-08-31", from: "2026-08-31", to: "2026-08-31" }); // 8/31 は月曜
  assert.equal(b.length, 6);
  // 月曜起点なら最初の週がフル週
  assert.deepEqual(buildCaKpiBuckets("2026-08-03", "2026-08-09", "week"), [{ key: "2026-08-03", from: "2026-08-03", to: "2026-08-09" }]);
  // 日曜起点は 1 日だけの週
  assert.deepEqual(buildCaKpiBuckets("2026-08-02", "2026-08-03", "week"), [
    { key: "2026-08-02", from: "2026-08-02", to: "2026-08-02" },
    { key: "2026-08-03", from: "2026-08-03", to: "2026-08-03" },
  ]);
});

test("day buckets", () => {
  const b = buildCaKpiBuckets("2026-08-30", "2026-09-01", "day");
  assert.deepEqual(b.map((x) => x.key), ["2026-08-30", "2026-08-31", "2026-09-01"]);
  assert.equal(buildCaKpiBuckets("2026-09-02", "2026-09-01", "day").length, 0);
});

test("parse: 必須・形式", () => {
  assert.equal(parseCaKpiQuery(sp(""), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-08-01"), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-08-01&to=2026-08-32"), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-08-31&to=2026-08-01"), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-10-02&to=2026-10-05"), TODAY).ok, false); // from が未来
  assert.equal(parseCaKpiQuery(sp("from=2026-08-01&to=2026-08-31&granularity=year"), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-08-01&to=2026-08-31&groups=foo"), TODAY).ok, false);
  assert.equal(parseCaKpiQuery(sp("from=2026-08-01&to=2026-08-31&caId=1000001;drop"), TODAY).ok, false);
});

test("parse: 既定値と to の丸め", () => {
  const r = parseCaKpiQuery(sp("from=2026-08-01&to=2026-08-31"), TODAY);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.query.granularity, "month");
    assert.equal(r.query.caId, null);
    assert.deepEqual(r.query.groups, [...CA_KPI_DEFAULT_GROUPS]);
    assert.equal(r.query.toClamped, false);
  }
  const c = parseCaKpiQuery(sp("from=2026-09-01&to=2026-10-31&granularity=week&caId=1000001&groups=entry,interview,activity"), TODAY);
  assert.ok(c.ok);
  if (c.ok) {
    assert.equal(c.query.to, TODAY);
    assert.equal(c.query.requestedTo, "2026-10-31");
    assert.equal(c.query.toClamped, true);
    assert.equal(c.query.caId, "1000001");
    assert.deepEqual(c.query.groups, ["interview", "entry", "activity"]); // 定義順に正規化
  }
});

test("parse: 期間の上限（day 92 日 / week・month 400 日）", () => {
  assert.equal(parseCaKpiQuery(sp("from=2026-06-01&to=2026-08-31&granularity=day"), TODAY).ok, true); // 92 日
  const over = parseCaKpiQuery(sp("from=2026-06-01&to=2026-09-01&granularity=day"), TODAY); // 93 日
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.error, /92/);
  assert.equal(parseCaKpiQuery(sp("from=2025-08-28&to=2026-10-01&granularity=month"), TODAY).ok, true); // 400 日
  assert.equal(parseCaKpiQuery(sp("from=2025-08-27&to=2026-10-01&granularity=month"), TODAY).ok, false); // 401 日
  // 未来の to で上限を回避できない（丸める前の期間で判定）
  assert.equal(parseCaKpiQuery(sp("from=2026-07-01&to=2026-10-02&granularity=day"), TODAY).ok, false);
});

test("応答サイズの上限（rows の推定 ≤ 85KB）", () => {
  const def = [...CA_KPI_DEFAULT_GROUPS];
  assert.equal(estimateCaKpiRowBytes(def), 1070);
  assert.equal(checkCaKpiSizeLimit(8, 9, def), null); // 全CA 8 名 + 全員 × 8 か月 = 72 行 ≈ 77KB
  assert.match(checkCaKpiSizeLimit(9, 9, def) ?? "", /81 行/); // 9 か月は超過
  assert.match(checkCaKpiSizeLimit(11, 9, def) ?? "", /区切りは 8 個まで/);
  assert.equal(checkCaKpiSizeLimit(79, 1, def), null); // caId 指定の day 79 日 ≈ 84.5KB
  assert.match(checkCaKpiSizeLimit(92, 1, def) ?? "", /groups/); // 既定グループの day 92 日は超過（groups を減らせば通る）
  assert.equal(checkCaKpiSizeLimit(92, 1, ["interview", "entry", "selection"]), null); // 780B × 92 = 72KB
  assert.equal(checkCaKpiSizeLimit(13, 9, ["interview"]), null); // 270B × 117 = 32KB
});

console.log(`\n${count} tests passed`);
export {};
