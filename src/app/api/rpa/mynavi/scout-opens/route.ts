import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { findMachineByRecruiterName } from "@/lib/scout/auto-link";
import {
  bucketOpenRow,
  parseScoutDateTime,
  jstDateFromYmd,
  ymdFromJstDate,
} from "@/lib/scout/open-count-bucket";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/rpa/mynavi/scout-opens
 * T-201 Step1: マイナビ「スカウトボックス」を既読で絞った一覧の行を RPA(PAD) から受け取り、
 * 配信枠（日 × 号機 × 時間帯）の開封数 `ScoutDeliverySlot.openCount` を埋める受け口。
 *
 * これまで開封数を入れる経路は手入力（`/scout/open-count`）と FM 一括取込しか無く、
 * 直近の枠は常に 0 のままで開封率が出せていなかった。
 *
 * 業務側で確定している仕様:
 *   - マイナビの「既読」で絞った件数がそのまま開封数（応募済・辞退の行も既読に含まれる）
 *   - 粒度は 日 × 号機 × 時間帯。個人単位では持たない（件数のみ）
 *   - 毎晩「過去30日分を数え直して上書き」する（既読は後から増えるため、加算してはいけない）
 *   - 号機は一覧の担当者名から判別する。手動配信の「藤本 夏海」も集計に含める
 *     ★1号機の「藤本 なつみ」（ひらがな）とは別人。マスタ上も別レコード
 *
 * 認証: x-rpa-secret（verifyRpaSecret）
 * ボディ: parseRpaRequestBody（PAD は JSON を URL エンコードした文字列で送ってくる）
 *
 * 時間帯バケットのルールは `src/lib/scout/open-count-bucket.ts` に集約。
 * 配信数側と同一でなければ開封率が壊れるため、ここで独自に決めない。
 *
 * ★PAD へ渡す読み取り範囲について（重要）
 *   20〜23時の行は「翌日の8時枠」に乗る。一方その翌日の 0〜7時・8時台の行も同じ8時枠に乗る。
 *   そのため targetDate=D の1リクエストだけでは D+1 の8時枠を確定できず、
 *   後から targetDate=D+1 を投げると D の 20〜23時ぶんが上書きで消える。
 *   これを避けるため、PAD 側は **「D-1 の 20:00 〜 D の 19:59」の窓で読んだ行を targetDate=D として送る**
 *   運用にすること。そうすれば全行が D 自身の枠に収まり、翌日枠への溢れが出ない。
 *   （どちらの送り方でも受理はする。溢れが出た場合は updatedDates に翌日が現れる）
 */

/** レスポンスのキー集合は全ケースで固定。PAD がプロパティ参照で落ちるため（pdf-upload と同じ方針）。 */
type ScoutOpensResponse = {
  status: "OK" | "PARTIAL" | "FORBIDDEN";
  targetDate: string | null;
  received: number;
  counted: number;
  skipped: number;
  unresolved: number;
  unresolvedNames: string[];
  noSlot: number;
  updatedSlots: number;
  updatedDates: string[];
  reason: string | null;
};

function buildResponse(partial: Partial<ScoutOpensResponse>): ScoutOpensResponse {
  return {
    status: "OK",
    targetDate: null,
    received: 0,
    counted: 0,
    skipped: 0,
    unresolved: 0,
    unresolvedNames: [],
    noSlot: 0,
    updatedSlots: 0,
    updatedDates: [],
    reason: null,
    ...partial,
  };
}

type ParsedRow = { ymd: string; hour: number; recruiterName: string };

/** 1行が不正でも全体を落とさない。読めない行は null（＝skipped）。 */
function parseRow(raw: unknown): ParsedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const scoutDateRaw = typeof r.scoutDate === "string" ? r.scoutDate.trim() : "";
  const recruiterRaw = typeof r.recruiterName === "string" ? r.recruiterName.trim() : "";
  if (!scoutDateRaw || !recruiterRaw) return null;

  const dt = parseScoutDateTime(scoutDateRaw);
  if (!dt) return null;

  return { ymd: dt.ymd, hour: dt.hour, recruiterName: recruiterRaw };
}

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json(
      buildResponse({ status: "FORBIDDEN", reason: "forbidden" }),
      { status: 403 },
    );
  }

  let targetDateInput = "";

  try {
    const body = await parseRpaRequestBody(req);

    targetDateInput =
      typeof body.targetDate === "string" ? body.targetDate.trim() : "";
    const m = targetDateInput.match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})$/);
    if (!m) {
      return NextResponse.json(
        buildResponse({
          status: "PARTIAL",
          targetDate: targetDateInput || null,
          reason: "targetDate は必須です（YYYY-MM-DD）",
        }),
        { status: 400 },
      );
    }
    const targetYmd = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const targetDate = jstDateFromYmd(targetYmd);
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json(
        buildResponse({
          status: "PARTIAL",
          targetDate: targetDateInput,
          reason: "targetDate が日付として不正です",
        }),
        { status: 400 },
      );
    }

    // rows は 0 件でも受理する（既読が1件も無い日がありうる）
    const rowsRaw = Array.isArray(body.rows) ? body.rows : [];
    const received = rowsRaw.length;

    let skipped = 0;
    let unresolved = 0;
    let noSlot = 0;
    let counted = 0;
    const unresolvedNames = new Set<string>();

    // 担当者名 → machineId の解決結果をリクエスト内でキャッシュ（マスタは10件程度だが行数は多い）
    const machineCache = new Map<string, string | null>();
    const resolveMachineId = async (name: string): Promise<string | null> => {
      if (machineCache.has(name)) return machineCache.get(name) ?? null;
      const machine = await findMachineByRecruiterName(name);
      const id = machine?.id ?? null;
      machineCache.set(name, id);
      return id;
    };

    // バケット（日付 × 時間帯 × 号機）ごとの件数
    const bucketKey = (ymd: string, hour: number, machineId: string) =>
      `${ymd}|${hour}|${machineId}`;
    const bucketCounts = new Map<
      string,
      { ymd: string; hour: number; machineId: string; count: number }
    >();

    for (const raw of rowsRaw) {
      const row = parseRow(raw);
      if (!row) {
        skipped++;
        continue;
      }
      const machineId = await resolveMachineId(row.recruiterName);
      if (!machineId) {
        unresolved++;
        unresolvedNames.add(row.recruiterName);
        continue;
      }
      const bucket = bucketOpenRow(row.ymd, row.hour);
      if (!bucket) {
        skipped++;
        continue;
      }
      const ymd = ymdFromJstDate(bucket.deliveryDate);
      const key = bucketKey(ymd, bucket.hourSlot, machineId);
      const cur = bucketCounts.get(key);
      if (cur) cur.count++;
      else
        bucketCounts.set(key, {
          ymd,
          hour: bucket.hourSlot,
          machineId,
          count: 1,
        });
    }

    // 書き込み対象の枠を集める。
    //   - targetDate の枠は全件（該当が無いものを 0 で上書きするため。数え直し方式なので減ることもある）
    //   - バケットが targetDate 以外の日付（20〜23時の溢れ＝翌日8時枠）に落ちた場合はその日付の枠も
    const extraDates = new Set<string>();
    for (const b of bucketCounts.values()) {
      if (b.ymd !== targetYmd) extraDates.add(b.ymd);
    }
    const allDates = [targetYmd, ...Array.from(extraDates)];

    const slots = await prisma.scoutDeliverySlot.findMany({
      where: { deliveryDate: { in: allDates.map(jstDateFromYmd) } },
      select: {
        id: true,
        deliveryDate: true,
        hourSlot: true,
        machineId: true,
        deliveryCount: true,
        openCount: true,
        scoutNumber: true,
      },
    });

    // (日付, 時, 号機) → 枠（複数ありうる。schema 上ユニーク制約は無い）
    const slotsByBucket = new Map<string, typeof slots>();
    for (const s of slots) {
      if (!s.machineId) continue;
      const key = bucketKey(ymdFromJstDate(s.deliveryDate), s.hourSlot, s.machineId);
      const arr = slotsByBucket.get(key);
      if (arr) arr.push(s);
      else slotsByBucket.set(key, [s]);
    }

    // 目標値を作る。targetDate の枠は既定 0（＝該当が無ければ 0 で上書き）。
    const desired = new Map<string, number>();
    for (const s of slots) {
      if (ymdFromJstDate(s.deliveryDate) === targetYmd) desired.set(s.id, 0);
    }

    for (const b of bucketCounts.values()) {
      const key = bucketKey(b.ymd, b.hour, b.machineId);
      const matched = slotsByBucket.get(key);
      if (!matched || matched.length === 0) {
        // 配信数が入っていない枠に開封数だけ入れても率が出ないので、枠は作らない
        noSlot += b.count;
        continue;
      }
      // 同一バケットに複数行ある場合は1枠へ寄せる（集計は枠の合計なので分散させると二重にならない）。
      // 配信数が入っている枠を優先し、同条件ならスカウトNO順で安定させる。
      const sorted = [...matched].sort((a, x) => {
        if ((x.deliveryCount > 0 ? 1 : 0) !== (a.deliveryCount > 0 ? 1 : 0)) {
          return (x.deliveryCount > 0 ? 1 : 0) - (a.deliveryCount > 0 ? 1 : 0);
        }
        return a.scoutNumber.localeCompare(x.scoutNumber);
      });
      desired.set(sorted[0].id, b.count);
      for (const rest of sorted.slice(1)) desired.set(rest.id, 0);
      counted += b.count;
    }

    // 実際に値が変わる枠だけ更新する（updatedAt を無駄に動かさない）
    const currentById = new Map(slots.map((s) => [s.id, s]));
    const toUpdate: { id: string; openCount: number }[] = [];
    for (const [id, value] of desired) {
      const cur = currentById.get(id);
      if (!cur) continue;
      if (cur.openCount !== value) toUpdate.push({ id, openCount: value });
    }

    const updatedDates = new Set<string>();
    for (const u of toUpdate) {
      await prisma.scoutDeliverySlot.update({
        where: { id: u.id },
        data: { openCount: u.openCount },
      });
      const cur = currentById.get(u.id);
      if (cur) updatedDates.add(ymdFromJstDate(cur.deliveryDate));
    }

    const status: ScoutOpensResponse["status"] =
      skipped > 0 || unresolved > 0 || noSlot > 0 ? "PARTIAL" : "OK";

    const reasonParts: string[] = [];
    if (skipped > 0) reasonParts.push(`読み取れない行 ${skipped}件`);
    if (unresolved > 0)
      reasonParts.push(
        `担当者を号機に解決できない行 ${unresolved}件（${Array.from(unresolvedNames).join(" / ")}）`,
      );
    if (noSlot > 0) reasonParts.push(`該当する配信枠が無い行 ${noSlot}件`);

    console.log(
      `[rpa/mynavi/scout-opens] targetDate=${targetYmd} received=${received} counted=${counted} ` +
        `skipped=${skipped} unresolved=${unresolved} noSlot=${noSlot} updatedSlots=${toUpdate.length}`,
    );

    return NextResponse.json(
      buildResponse({
        status,
        targetDate: targetYmd,
        received,
        counted,
        skipped,
        unresolved,
        unresolvedNames: Array.from(unresolvedNames),
        noSlot,
        updatedSlots: toUpdate.length,
        updatedDates: Array.from(updatedDates).sort(),
        reason: reasonParts.length > 0 ? reasonParts.join(" / ") : null,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[rpa/mynavi/scout-opens] unexpected error:", e);
    await notifyMynaviError("スカウト開封数の取り込みでエラーが発生しました", {
      detail: message,
      targetDate: targetDateInput || null,
    });
    // 500 でもキー集合は同じにする（PAD がプロパティ参照で落ちるため）
    return NextResponse.json(
      buildResponse({
        status: "PARTIAL",
        targetDate: targetDateInput || null,
        reason: `予期しないエラー: ${message}`,
      }),
      { status: 500 },
    );
  }
}
