import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { autoLinkCandidateToSlot } from "@/lib/scout/auto-link";

/**
 * POST /api/scout/backfill-delivery-date
 * T-067 Phase B-4a: 会員No照合で「正しい配信日」を Candidate.scoutDeliveryDate にセットするバッチ。
 * - 認証: x-rpa-secret（既存 verifyRpaSecret 流用）。
 * - 対象: mynaviMemberNo が非null かつ scoutDeliveryDate が null の Candidate（＝会員Noはあるが配信日未確定）。
 *   既に値が入っている scoutDeliveryDate（findMatchingSlot 推測値含む）はデフォルトでは触らない（非破壊）。
 * - 各対象を ScoutSendRecord.memberNo で照合し、最新（最大）の deliveryDate を採用してセット。
 * - 罠#17: deliveryDate は @db.Date 由来の Date をそのままコピー（文字列変換しない＝TZずれなし）。
 *
 * T-067: 配信日セットの後ろで masType（開放日/通常）も自動判定する（両日付が揃った行のみ）。
 *
 * body(任意): { overwriteExisting?: boolean }  // true のとき既存の scoutDeliveryDate も対象（将来拡張・既定 false）
 * res: { scanned, matched, updated, skipped, masTypeScanned, masTypeUpdated }
 */
export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let overwriteExisting = false;
  try {
    const body = (await req.json()) as { overwriteExisting?: unknown };
    overwriteExisting = body?.overwriteExisting === true;
  } catch {
    // body 無し/不正でも既定（null のみ対象）で続行
  }

  // 1) 対象 Candidate（会員Noあり・配信日未確定。overwriteExisting=true なら配信日有無を問わない）
  const candidates = await prisma.candidate.findMany({
    where: {
      mynaviMemberNo: { not: null },
      ...(overwriteExisting ? {} : { scoutDeliveryDate: null }),
    },
    select: {
      id: true,
      mynaviMemberNo: true,
      candidateNumber: true,
      // T-190: 配信日を書き換えたら枠も張り替えるため、判定材料をここで取っておく
      scoutDeliveryDate: true,
      applicationDate: true,
      applicationRoute: true,
      recruiterName: true,
      scoutLinkedById: true,
    },
  });
  const scanned = candidates.length;

  // 2) 対象会員Noの配信明細をまとめて取得し、会員Noごとの最新 deliveryDate を求める
  const memberNos = [...new Set(candidates.map((c) => c.mynaviMemberNo).filter((m): m is string => !!m))];
  const records = memberNos.length
    ? await prisma.scoutSendRecord.findMany({
        where: { memberNo: { in: memberNos } },
        select: { memberNo: true, deliveryDate: true },
      })
    : [];
  const latestByMember = new Map<string, Date>();
  for (const r of records) {
    const cur = latestByMember.get(r.memberNo);
    // Date 比較（@db.Date 由来の UTC 0:00）。最大＝最新を採用。
    if (!cur || r.deliveryDate > cur) latestByMember.set(r.memberNo, r.deliveryDate);
  }

  // 3) 見つかった対象に正しい配信日をセット
  //    T-190: 配信日の JST 暦日が変わったレコードは、紐づく配信枠も同じ日の枠へ張り替える。
  //      集計 API は ScoutDeliverySlot.deliveryDate しか見ないため、配信日だけ直すと数字が動かない
  //      （このバッチが 144 件の「配信日は正しいが枠は応募日のまま」を作った本体）。
  //      - scoutLinkedById 非 NULL（人が手で紐づけた行）は対象外
  //      - 指定日の枠が無ければ前日へ飛ばさず現状維持（relinkFailed に計上）
  //      - 張り替えに失敗してもバッチは止めない
  const toJstYmdOrNull = (d: Date | null) =>
    d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null; // 罠#17
  let updated = 0;
  let relinked = 0;
  let relinkFailed = 0;
  for (const c of candidates) {
    const d = c.mynaviMemberNo ? latestByMember.get(c.mynaviMemberNo) : undefined;
    if (!d) continue; // 配信明細が無い会員No は null のまま（誤セットしない）
    const changedDay = toJstYmdOrNull(c.scoutDeliveryDate) !== toJstYmdOrNull(d);
    await prisma.candidate.update({
      where: { id: c.id },
      data: { scoutDeliveryDate: d }, // @db.Date 由来 Date をそのまま（罠#17: 文字列変換なし）
    });
    updated++;

    if (!changedDay) continue;
    if (c.scoutLinkedById) continue; // 手動紐付けは触らない
    if (c.applicationRoute !== "スカウト" || !c.recruiterName?.trim()) continue;
    try {
      const res = await autoLinkCandidateToSlot({
        candidateId: c.id,
        recruiterName: c.recruiterName,
        applicationDate: c.applicationDate ?? d,
        scoutDeliveryDate: d,
        disablePreviousDayFallback: true,
      });
      if (res.linked) relinked++;
      else {
        relinkFailed++;
        console.warn(
          `[BackfillDeliveryDate] T-190 relink 不可 candidate=${c.candidateNumber} reason=${res.reason}`,
        );
      }
    } catch (e) {
      relinkFailed++;
      console.error(`[BackfillDeliveryDate] T-190 relink failed candidate=${c.candidateNumber}:`, e);
    }
  }

  const matched = updated;
  const skipped = scanned - matched;

  // 4) masType（開放日/通常）自動判定: 配信日・登録日が両方揃った Candidate を全件対象に、
  //    diffDays = 配信日 − 登録日（JST暦日・罠#17）が 0..7（境界含む）→ "開放日"、それ以外（<0 or >7）→ "通常"。
  //    両日付が揃ったときの計算値を正とし、現在値と異なる場合のみ上書き（冪等）。片方欠ける行は対象外＝触らない。
  const toJstYmd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD"（罠#17）
  const datedCandidates = await prisma.candidate.findMany({
    where: { scoutDeliveryDate: { not: null }, mynaviRegisteredDate: { not: null } },
    select: { id: true, scoutDeliveryDate: true, mynaviRegisteredDate: true, masType: true },
  });
  const masTypeScanned = datedCandidates.length;
  let masTypeUpdated = 0;
  for (const c of datedCandidates) {
    if (!c.scoutDeliveryDate || !c.mynaviRegisteredDate) continue;
    const diffDays = Math.round(
      (Date.parse(toJstYmd(c.scoutDeliveryDate) + "T00:00:00Z")
        - Date.parse(toJstYmd(c.mynaviRegisteredDate) + "T00:00:00Z")) / 86_400_000,
    );
    const masType = diffDays >= 0 && diffDays <= 7 ? "開放日" : "通常";
    if (masType !== c.masType) {
      await prisma.candidate.update({ where: { id: c.id }, data: { masType } });
      masTypeUpdated++;
    }
  }

  console.log(`[BackfillDeliveryDate] scanned=${scanned} matched=${matched} updated=${updated} skipped=${skipped} relinked=${relinked} relinkFailed=${relinkFailed} masTypeScanned=${masTypeScanned} masTypeUpdated=${masTypeUpdated} overwriteExisting=${overwriteExisting}`);
  return NextResponse.json({ scanned, matched, updated, skipped, relinked, relinkFailed, masTypeScanned, masTypeUpdated });
}
