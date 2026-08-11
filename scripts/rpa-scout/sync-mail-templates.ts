/**
 * RPAスカウト メールテンプレート同期（Excelテンプレートマスタ → RpaScoutSubjectTemplate）
 *
 * 実行: npx tsx --env-file=.env scripts/rpa-scout/sync-mail-templates.ts            # dry-run（差分の表示のみ）
 *       npx tsx --env-file=.env scripts/rpa-scout/sync-mail-templates.ts --execute  # DB反映
 *
 * 入力: prisma/seed-data/rpa-scout/rpa-mail-templates.csv
 *       列 = name, kind, action, changed, subject, body（本文に改行を含むため csv-parse で読む）
 *
 * action の扱い:
 *   SKIP   … 既存と同内容。kind のみセット（内容の差分は警告表示のみで上書きしない）
 *   UPDATE … name で既存を特定し subject / body / kind を CSV の内容で上書き
 *   INSERT … 新規作成（isActive=true）。既に同名があれば内容を揃える更新に倒す（再実行安全）
 *
 * 新規テーブルは作らない。既存 RpaScoutSubjectTemplate を状況ボード・カレンダーと共有し続ける。
 * CSV に無い既存レコード（「停止」ダミー等）は削除も変更もしない。
 */
import { prisma } from "@/lib/prisma";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";
import { TEMPLATE_KIND_VALUES } from "@/lib/rpa-scout/constants";

const EXECUTE = process.argv.includes("--execute");
const CSV_PATH = path.join(
  process.cwd(),
  "prisma",
  "seed-data",
  "rpa-scout",
  "rpa-mail-templates.csv"
);

type Row = {
  name: string;
  kind: string;
  action: string;
  changed: string;
  subject: string;
  body: string;
};

async function main() {
  console.log(`=== RPAスカウト メールテンプレート同期 (${EXECUTE ? "EXECUTE" : "DRY-RUN"}) ===`);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSVが見つかりません: ${CSV_PATH}`);
  }
  const rows = parse(fs.readFileSync(CSV_PATH, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Row[];
  console.log(`CSV読込: ${rows.length}件`);

  for (const r of rows) {
    if (!TEMPLATE_KIND_VALUES.includes(r.kind))
      throw new Error(`kind が不正です: ${r.name} / ${r.kind}`);
    if (!["SKIP", "UPDATE", "INSERT"].includes(r.action))
      throw new Error(`action が不正です: ${r.name} / ${r.action}`);
  }

  const existing = await prisma.rpaScoutSubjectTemplate.findMany();
  const byName = new Map(existing.map((t) => [t.name, t]));
  console.log(`DB既存: ${existing.length}件`);

  const counts = { skipKindOnly: 0, updated: 0, inserted: 0, unchanged: 0 };
  const warnings: string[] = [];

  for (const r of rows) {
    const current = byName.get(r.name);

    if (r.action === "INSERT" && !current) {
      console.log(`[INSERT] ${r.name}（${r.kind}）`);
      if (EXECUTE) {
        await prisma.rpaScoutSubjectTemplate.create({
          data: { name: r.name, kind: r.kind, subject: r.subject, body: r.body, isActive: true },
        });
      }
      counts.inserted++;
      continue;
    }

    if (!current) {
      // SKIP/UPDATE のはずが既存に無い＝CSVとDBの前提ずれ。取りこぼさないよう作成する
      warnings.push(`${r.action} 指定だがDBに存在しないため新規作成: ${r.name}`);
      console.log(`[INSERT(補)] ${r.name}（${r.kind}）`);
      if (EXECUTE) {
        await prisma.rpaScoutSubjectTemplate.create({
          data: { name: r.name, kind: r.kind, subject: r.subject, body: r.body, isActive: true },
        });
      }
      counts.inserted++;
      continue;
    }

    // 内容を上書きするのは UPDATE と、再実行時の INSERT（既に作成済み）のみ
    const overwriteContent = r.action === "UPDATE" || r.action === "INSERT";
    const contentDiffers = current.subject !== r.subject || (current.body ?? "") !== r.body;

    if (r.action === "SKIP" && contentDiffers) {
      warnings.push(
        `SKIP指定だが既存と内容差あり（上書きしない）: ${r.name}` +
          ` subject:${current.subject === r.subject ? "同" : "差"}` +
          ` body:${(current.body ?? "").length}→${r.body.length}文字`
      );
    }

    const data: { kind?: string; subject?: string; body?: string } = {};
    if (current.kind !== r.kind) data.kind = r.kind;
    if (overwriteContent && contentDiffers) {
      data.subject = r.subject;
      data.body = r.body;
    }

    if (Object.keys(data).length === 0) {
      counts.unchanged++;
      continue;
    }

    const kindOnly = !("subject" in data);
    console.log(
      `[${kindOnly ? "KIND" : "UPDATE"}] ${r.name}（${Object.keys(data).join(",")}）`
    );
    if (EXECUTE) {
      await prisma.rpaScoutSubjectTemplate.update({ where: { id: current.id }, data });
    }
    if (kindOnly) counts.skipKindOnly++;
    else counts.updated++;
  }

  console.log("--- 集計 ---");
  console.log(
    `INSERT=${counts.inserted} / 内容UPDATE=${counts.updated} / kindのみ=${counts.skipKindOnly} / 変更なし=${counts.unchanged}`
  );
  if (warnings.length) {
    console.log(`--- 警告 ${warnings.length}件 ---`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (!EXECUTE) {
    console.log("--- dry-run のためDB反映はスキップ ---");
    return;
  }

  // 件数照合
  const [total, withKind, stopRow] = await Promise.all([
    prisma.rpaScoutSubjectTemplate.count(),
    prisma.rpaScoutSubjectTemplate.count({ where: { kind: { not: null } } }),
    prisma.rpaScoutSubjectTemplate.findFirst({ where: { name: "停止" } }),
  ]);
  console.log("=== 件数照合 ===");
  console.log(`総数=${total} (期待20) ${total === 20 ? "OK" : "NG"}`);
  console.log(`kindあり=${withKind} (期待19) ${withKind === 19 ? "OK" : "NG"}`);
  console.log(
    `「停止」行 残存=${stopRow ? "あり" : "なし"} kind=${stopRow?.kind ?? "null"} ${stopRow && stopRow.kind === null ? "OK" : "NG"}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
