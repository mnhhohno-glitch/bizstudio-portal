// T-194: 配信テンプレートのシード用 JSON（prisma/seed/scout-templates.json）を生成する。
//
//   xlsx から:  npx tsx scripts/generate-scout-templates-json.ts --xlsx "prisma/seed/05.集計ファイル.xlsx"
//   DB から:    npx tsx --env-file=.env scripts/generate-scout-templates-json.ts --from-db
//
// xlsx の「テンプレートマスタ」シートを読む。ヘッダ行に「種別」「名称（テンプレ名）」「件名」「本文」列がある前提で
// 列名を見て取り出す（列順には依存しない）。「号機」「デフォルト」を含む列があればデフォルト割当として拾う。
// xlsx が手元に無い場合は、同じマスタを移行済みの RpaScoutSubjectTemplate（kind 付き・有効）から生成する。
// 生成した JSON はコミットする。xlsx はコミットしない（.gitignore 済み）。
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

type TemplateJson = {
  kind: "UNSENT" | "SENT" | "INDIVIDUAL";
  name: string;
  subject: string;
  body: string;
  sortOrder: number;
};
type Out = {
  generatedAt: string;
  source: string;
  templates: TemplateJson[];
  // 号機ごとのデフォルト割当（テンプレ名で参照）。不明なら空
  defaultAssignments: { machineNo: number; templateName: string }[];
};

const OUT_PATH = join(process.cwd(), "prisma", "seed", "scout-templates.json");

function kindFromText(s: string): TemplateJson["kind"] | null {
  const t = s.replace(/\s/g, "");
  if (/未送信/.test(t)) return "UNSENT";
  if (/送信済/.test(t)) return "SENT";
  if (/個別/.test(t)) return "INDIVIDUAL";
  if (t === "UNSENT" || t === "SENT" || t === "INDIVIDUAL") return t;
  return null;
}

async function fromXlsx(path: string): Promise<Out> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(readFileSync(path));
  const sheetName = wb.SheetNames.find((n) => n.includes("テンプレートマスタ")) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const col = (re: RegExp) => headers.find((h) => re.test(h));
  const kindCol = col(/種別|区分/);
  const nameCol = col(/テンプレ名|名称|テンプレート名/);
  const subjectCol = col(/件名/);
  const bodyCol = col(/本文/);
  if (!kindCol || !nameCol || !subjectCol || !bodyCol)
    throw new Error(`テンプレートマスタの列が見つかりません: ${headers.join(" / ")}`);

  const templates: TemplateJson[] = [];
  const counters: Record<string, number> = {};
  for (const r of rows) {
    const kind = kindFromText(String(r[kindCol] ?? ""));
    const name = String(r[nameCol] ?? "").trim();
    const subject = String(r[subjectCol] ?? "").trim();
    const body = String(r[bodyCol] ?? "");
    if (!kind || !name || !subject) continue;
    counters[kind] = (counters[kind] ?? 0) + 1;
    templates.push({ kind, name, subject, body, sortOrder: counters[kind] });
  }

  // デフォルト割当（「号機」「デフォルト」を含む列。無ければ空）
  const defaultAssignments: Out["defaultAssignments"] = [];
  const machineCol = col(/号機/);
  const defaultCol = col(/デフォルト|既定/);
  if (machineCol && defaultCol) {
    for (const r of rows) {
      const m = String(r[machineCol] ?? "").match(/([1-6])/);
      const t = String(r[defaultCol] ?? "").trim();
      if (m && t) defaultAssignments.push({ machineNo: Number(m[1]), templateName: t });
    }
  }
  return { generatedAt: new Date().toISOString(), source: `xlsx:${sheetName}`, templates, defaultAssignments };
}

async function fromDb(): Promise<Out> {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.rpaScoutSubjectTemplate.findMany({
    where: { isActive: true, kind: { not: null }, subject: { not: "" } },
    orderBy: [{ createdAt: "asc" }],
  });
  const counters: Record<string, number> = {};
  const templates: TemplateJson[] = [];
  for (const r of rows) {
    const kind = kindFromText(r.kind ?? "");
    if (!kind) continue;
    counters[kind] = (counters[kind] ?? 0) + 1;
    templates.push({ kind, name: r.name, subject: r.subject, body: r.body ?? "", sortOrder: counters[kind] });
  }
  return { generatedAt: new Date().toISOString(), source: "db:rpa_scout_subject_templates", templates, defaultAssignments: [] };
}

async function main() {
  const args = process.argv.slice(2);
  const xi = args.indexOf("--xlsx");
  let out: Out;
  if (xi >= 0) {
    const path = args[xi + 1];
    if (!path || !existsSync(path)) throw new Error(`xlsx が見つかりません: ${path}`);
    out = await fromXlsx(path);
  } else if (args.includes("--from-db")) {
    out = await fromDb();
  } else {
    throw new Error("--xlsx <path> か --from-db を指定してください");
  }
  const kindOrder = { UNSENT: 0, SENT: 1, INDIVIDUAL: 2 };
  out.templates.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.sortOrder - b.sortOrder);
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const byKind = out.templates.reduce<Record<string, number>>((acc, t) => ((acc[t.kind] = (acc[t.kind] ?? 0) + 1), acc), {});
  console.log(`wrote ${OUT_PATH}: ${out.templates.length} templates`, byKind, `defaults=${out.defaultAssignments.length}`, `source=${out.source}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

export {};
