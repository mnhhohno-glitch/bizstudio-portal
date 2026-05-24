/**
 * T-064 Phase A: ファイルメーカー過去データインポート API
 *
 * POST /api/scout/import/filemaker-legacy
 *   認証: セッション認証 (admin のみ)
 *   リクエスト: multipart/form-data
 *     - file: CSV
 *     - mapping: JSON 文字列 (CSV列名 → DBカラム名)
 *
 *   想定 DB カラム:
 *     - scoutNumber (string, "SC########" or 数字)
 *     - deliveryDate (string, "YYYY-MM-DD")
 *     - hourSlot (number, 0-23)
 *     - recruiterName (string, machineMaster 引き当て用)
 *     - mediaSource (string)
 *     - searchConditionName (string)
 *     - deliveryCount (number)
 *     - openCount (number)
 *     - deliveryCategoryLarge / Medium / Small
 *     - memo
 */

import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { parseSlotDate } from "@/lib/scout/slot-helpers";
import { isValidScoutNumberFormat, parseScoutNumber, formatScoutNumber } from "@/lib/scout/scout-number";

export const runtime = "nodejs";
export const maxDuration = 300;

type Mapping = Record<string, string>; // CSV 列名 → DB カラム名

const TARGET_FIELDS = [
  "scoutNumber",
  "deliveryDate",
  "hourSlot",
  "recruiterName",
  "mediaSource",
  "searchConditionName",
  "deliveryCount",
  "openCount",
  "deliveryCategoryLarge",
  "deliveryCategoryMedium",
  "deliveryCategorySmall",
  "memo",
] as const;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "admin 権限が必要です" }, { status: 403 });
  }

  const log = await prisma.scoutImportLog.create({
    data: { importType: "FILEMAKER_LEGACY", status: "RUNNING" },
  });

  try {
    const form = await req.formData();
    const file = form.get("file");
    const mappingRaw = form.get("mapping");

    if (!(file instanceof File)) {
      throw new Error("file は必須です");
    }
    if (typeof mappingRaw !== "string") {
      throw new Error("mapping は必須です（JSON 文字列）");
    }

    const mapping: Mapping = JSON.parse(mappingRaw);

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: { fileName: file.name },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const records: Record<string, string>[] = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    // 担当者→号機マスタを全件キャッシュ
    const machines = await prisma.scoutMachineMaster.findMany();
    const machineByName = new Map(machines.map((m) => [m.recruiterName, m]));

    let successCount = 0;
    let failureCount = 0;
    let maxScoutSeq = 0;
    const errors: string[] = [];

    for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
      const record = records[rowIdx];
      try {
        // CSV → DB マッピング
        const data: Record<string, unknown> = {};
        for (const [csvCol, dbField] of Object.entries(mapping)) {
          if (!TARGET_FIELDS.includes(dbField as (typeof TARGET_FIELDS)[number])) continue;
          data[dbField] = record[csvCol];
        }

        // スカウト番号正規化
        let scoutNumber = String(data.scoutNumber || "").trim();
        if (!scoutNumber) {
          throw new Error("scoutNumber は必須");
        }
        if (!isValidScoutNumberFormat(scoutNumber)) {
          // 数字だけの場合は SC + 8桁ゼロ埋めに変換
          const onlyNum = scoutNumber.replace(/\D/g, "");
          if (onlyNum) {
            const n = parseInt(onlyNum, 10);
            if (Number.isFinite(n)) {
              scoutNumber = formatScoutNumber(n);
            }
          }
        }
        if (!isValidScoutNumberFormat(scoutNumber)) {
          throw new Error(`スカウト番号フォーマット不正: ${data.scoutNumber}`);
        }
        const seqNum = parseScoutNumber(scoutNumber);
        if (seqNum !== null && seqNum > maxScoutSeq) maxScoutSeq = seqNum;

        const dateStr = String(data.deliveryDate || "").trim();
        if (!dateStr) throw new Error("deliveryDate は必須");
        const deliveryDate = parseSlotDate(dateStr);

        const hour = parseInt(String(data.hourSlot || "0"), 10);
        if (!Number.isFinite(hour)) throw new Error("hourSlot 不正");

        const recruiterName = String(data.recruiterName || "").trim();
        const machine = recruiterName ? machineByName.get(recruiterName) : null;
        const isMachine = machine?.isMachine ?? true;

        // 既存重複チェック（scoutNumber unique）
        const existing = await prisma.scoutDeliverySlot.findUnique({
          where: { scoutNumber },
        });
        if (existing) {
          failureCount++;
          errors.push(`row${rowIdx + 2}: 既存スカウト番号スキップ ${scoutNumber}`);
          continue;
        }

        await prisma.scoutDeliverySlot.create({
          data: {
            scoutNumber,
            deliveryDate,
            hourSlot: hour,
            machineId: machine?.id ?? null,
            isMachine,
            isStaff: !isMachine,
            deliveryCategoryLarge:
              String(data.deliveryCategoryLarge || (isMachine ? "機械" : "社員")),
            deliveryCategoryMedium:
              data.deliveryCategoryMedium != null
                ? String(data.deliveryCategoryMedium) || null
                : null,
            deliveryCategorySmall:
              data.deliveryCategorySmall != null
                ? String(data.deliveryCategorySmall) || null
                : null,
            mediaSource: String(data.mediaSource || "マイナビ転職"),
            searchConditionName:
              data.searchConditionName != null
                ? String(data.searchConditionName) || null
                : null,
            deliveryCount: parseInt(String(data.deliveryCount || "0"), 10) || 0,
            openCount: parseInt(String(data.openCount || "0"), 10) || 0,
            isAggregationTarget: true,
            memo: data.memo != null ? String(data.memo) || null : null,
          },
        });
        successCount++;
      } catch (e) {
        failureCount++;
        errors.push(
          `row${rowIdx + 2}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // ScoutSequence を最大番号に追従（CSV に含まれる最大番号で更新）
    if (maxScoutSeq > 0) {
      const seq = await prisma.scoutSequence.findFirst();
      if (seq && seq.lastNumber < maxScoutSeq) {
        await prisma.scoutSequence.update({
          where: { id: seq.id },
          data: { lastNumber: maxScoutSeq },
        });
      }
    }

    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        totalRows: records.length,
        successCount,
        failureCount,
        errorMessage: errors.length > 0 ? errors.slice(0, 50).join("\n") : null,
        finishedAt: new Date(),
      },
    });

    return NextResponse.json({
      status: "COMPLETED",
      totalRows: records.length,
      successCount,
      failureCount,
      errors: errors.slice(0, 50),
      scoutSequenceUpdated: maxScoutSeq,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scout/import/filemaker-legacy] error:", msg);
    await prisma.scoutImportLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        errorMessage: msg,
        finishedAt: new Date(),
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
