// T-207: 配信テンプレート（scout_templates）の採番・CSV 取り込みを1か所に集める。
//
// - テンプレート番号: 種別に関係ない通し番号 seq_no（表示は「T-001」）。全体の MAX+1 を advisory lock の中で採る。
//   一度振った番号は変えない（削除しても詰め直さない）。重複は @@unique(seqNo) が最後の砦。
// - 排他: pg_advisory_xact_lock(hashtext('scout-templates'))。テンプレートは号機をまたぐので単一キーで直列化する
//   （配信条件の号機ロック `scout-runs:<machineId>` とは別キー。互いに待たせない）。
// - 差し込み記号（[担当者] 等）は原文のまま保持する。展開するのは RPA 側の1人ごとの処理。
import { prisma } from "@/lib/prisma";
import type { Prisma, ScoutTemplate } from "@prisma/client";
import { TEMPLATE_CSV_HEADERS, TEMPLATE_KIND_VALUES, formatTemplateNo, templateKindFromLabel } from "./constants";
import type { TemplateDto } from "./types";

type Client = Prisma.TransactionClient;

/** 一覧・配信条件コンソールの両方がこの形で受け取る（画面から見た1本のテンプレート） */
export function toTemplateDto(t: ScoutTemplate): TemplateDto {
  return {
    id: t.id,
    seqNo: t.seqNo,
    templateNo: formatTemplateNo(t.seqNo),
    kind: t.kind,
    name: t.name,
    subject: t.subject,
    body: t.body,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
  };
}

/** 一覧の並び。番号順（未採番は末尾）で出す */
export const templateOrderBy: Prisma.ScoutTemplateOrderByWithRelationInput[] = [
  { seqNo: "asc" },
  { kind: "asc" },
  { sortOrder: "asc" },
  { name: "asc" },
];

/** テンプレート全体の採番ロック（キー文字列を変えないこと） */
export async function lockTemplates(t: Client): Promise<void> {
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"scout-templates"})::bigint)`;
}

async function nextSeqNo(t: Client): Promise<number> {
  const max = await t.scoutTemplate.aggregate({ _max: { seqNo: true } });
  return (max._max.seqNo ?? 0) + 1;
}

export type TemplateData = {
  kind: Prisma.ScoutTemplateCreateInput["kind"];
  name: string;
  subject: string;
  body: string;
  sortOrder?: number;
  isActive?: boolean;
};

/** 画面から届いた1本分の入力を検証する（作成 POST・更新 PATCH で共用） */
export function parseTemplateInput(
  body: Record<string, unknown>,
): { ok: true; data: TemplateData } | { ok: false; error: string } {
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!TEMPLATE_KIND_VALUES.includes(kind)) return { ok: false, error: "種別を選択してください" };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "テンプレート名を入力してください" };
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return { ok: false, error: "件名を入力してください" };
  // 本文は改行と字下げを保持する（trim しない。空かどうかの判定だけ trim で見る）
  const bodyText = typeof body.body === "string" ? body.body : "";
  if (!bodyText.trim()) return { ok: false, error: "本文を入力してください" };
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
  return { ok: true, data: { kind: kind as TemplateData["kind"], name, subject, body: bodyText, isActive } };
}

/** 1件作成する。番号はサーバー側で決める（人は編集できない） */
export async function createScoutTemplate(data: TemplateData) {
  return prisma.$transaction(
    async (t) => {
      await lockTemplates(t);
      const seqNo = await nextSeqNo(t);
      return t.scoutTemplate.create({ data: { ...data, seqNo } });
    },
    { timeout: 20000 },
  );
}

/**
 * seq_no が空の行に番号を振る（デプロイ中の窓で旧コードが作った行の救済。通常は0件で何もしない）。
 * 既存の MAX の後ろへ、作成日時の古い順で続ける。
 */
export async function ensureTemplateSeqNos(): Promise<number> {
  const missing = await prisma.scoutTemplate.count({ where: { seqNo: null } });
  if (missing === 0) return 0;
  return prisma.$transaction(
    async (t) => {
      await lockTemplates(t);
      const rows = await t.scoutTemplate.findMany({
        where: { seqNo: null },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      let seq = await nextSeqNo(t);
      for (const r of rows) await t.scoutTemplate.update({ where: { id: r.id }, data: { seqNo: seq++ } });
      return rows.length;
    },
    { timeout: 20000 },
  );
}

// ============================================================
// CSV 取り込み
// ============================================================

/**
 * RFC4180 の CSV を解析する。本文はダブルクォートで囲まれた中に改行を含むため、
 * 行で split せず1文字ずつ読む（import-legacy の parseCSVLine は1行完結前提なので流用しない）。
 * 値の前後空白は落とさない（本文の字下げを壊さないため）。改行は \n に揃える。
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else if (c === "\r" && src[i + 1] === "\n") {
        cur += "\n";
        i++;
      } else if (c === "\r") {
        cur += "\n";
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else {
      cur += c;
    }
  }
  // 末尾に改行が無いときの最終行（完全な空行は捨てる）
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type ImportRowPlan = {
  /** CSV の行番号（ヘッダーを1行目とした人が数える番号） */
  lineNo: number;
  name: string;
  kind: string | null;
  kindLabel: string;
  subject: string;
  body: string;
  action: "CREATE" | "UPDATE";
  /** UPDATE のとき、そのまま維持されるテンプレート番号（表示は formatTemplateNo を通す） */
  targetSeqNo: number | null;
  targetId: string | null;
};

export type ImportRowError = { lineNo: number; name: string; reason: string };

export type ImportPlan = {
  rows: ImportRowPlan[];
  errors: ImportRowError[];
  createCount: number;
  updateCount: number;
};

/** 既存テンプレート（name をキーにした突き合わせ用） */
type ExistingRow = { id: string; name: string; seqNo: number | null };

/**
 * CSV 本文から取り込み計画を作る。1行でもエラーがあっても他の行は落とさない（行単位で切り分ける）。
 * 突き合わせのキーは「テンプレート名」。一致すれば上書き（番号は維持）、一致しなければ新規。
 */
export function buildImportPlan(csv: string, existing: ExistingRow[]): ImportPlan {
  const rows = parseCsv(csv);
  const errors: ImportRowError[] = [];
  const plans: ImportRowPlan[] = [];
  if (rows.length === 0) {
    return { rows: [], errors: [{ lineNo: 1, name: "", reason: "CSV が空です" }], createCount: 0, updateCount: 0 };
  }

  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  const expected = TEMPLATE_CSV_HEADERS;
  const headerOk = expected.every((h, i) => header[i] === h);
  if (!headerOk) {
    return {
      rows: [],
      errors: [{ lineNo: 1, name: "", reason: `1行目は「${expected.join(",")}」にしてください（実際: ${header.join(",")}）` }],
      createCount: 0,
      updateCount: 0,
    };
  }

  // 同名が複数ある既存行は突き合わせ先を決められない（@@unique は [kind, name] のため理論上は起こりうる）
  const byName = new Map<string, ExistingRow[]>();
  for (const e of existing) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }

  // CSV 内で同じ名前が2回出てきたときは後勝ちにせず、2件目以降をエラーにする（どちらが正か決められないため）
  const seenNames = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const lineNo = i + 1;
    const cols = rows[i];
    const name = (cols[0] ?? "").trim();
    const kindLabel = (cols[1] ?? "").trim();
    const subject = (cols[2] ?? "").trim();
    const body = cols[3] ?? "";

    if (!name) {
      errors.push({ lineNo, name: "", reason: "テンプレート名が空です" });
      continue;
    }
    const kind = templateKindFromLabel(kindLabel);
    if (!kind || !TEMPLATE_KIND_VALUES.includes(kind)) {
      errors.push({ lineNo, name, reason: `種別「${kindLabel}」は未送信用 / 送信済用 / 個別配信用 のいずれかにしてください` });
      continue;
    }
    if (!subject) {
      errors.push({ lineNo, name, reason: "件名が空です" });
      continue;
    }
    if (!body.trim()) {
      errors.push({ lineNo, name, reason: "本文が空です" });
      continue;
    }
    if (seenNames.has(name)) {
      errors.push({ lineNo, name, reason: "同じテンプレート名が CSV 内に複数あります" });
      continue;
    }
    seenNames.add(name);

    const matched = byName.get(name) ?? [];
    if (matched.length > 1) {
      errors.push({ lineNo, name, reason: "同じ名前のテンプレートが既に複数あるため、上書き先を決められません" });
      continue;
    }
    const target = matched[0] ?? null;
    plans.push({
      lineNo,
      name,
      kind,
      kindLabel,
      subject,
      body,
      action: target ? "UPDATE" : "CREATE",
      targetSeqNo: target?.seqNo ?? null,
      targetId: target?.id ?? null,
    });
  }

  return {
    rows: plans,
    errors,
    createCount: plans.filter((p) => p.action === "CREATE").length,
    updateCount: plans.filter((p) => p.action === "UPDATE").length,
  };
}

export type ImportResult = { created: number; updated: number; errors: ImportRowError[] };

/**
 * 計画どおりに書き込む。新規は採番ロックの中で連番を取り、上書きは番号を維持する。
 * 上書き時に sort_order は触らない（一覧の並びを CSV の順で入れ替えないため）。
 */
export async function applyImportPlan(plan: ImportPlan): Promise<ImportResult> {
  const creates = plan.rows.filter((r) => r.action === "CREATE");
  const updates = plan.rows.filter((r) => r.action === "UPDATE");
  const errors = [...plan.errors];
  let created = 0;
  let updated = 0;

  for (const r of updates) {
    if (!r.targetId || !r.kind) continue;
    try {
      await prisma.scoutTemplate.update({
        where: { id: r.targetId },
        data: { kind: r.kind as TemplateData["kind"], subject: r.subject, body: r.body },
      });
      updated++;
    } catch (e) {
      console.error("[scout-templates/import] update failed:", e);
      errors.push({ lineNo: r.lineNo, name: r.name, reason: "上書きに失敗しました" });
    }
  }

  if (creates.length > 0) {
    // 新規はまとめて1トランザクションで採番する（1件ずつロックを取り直すより速く、番号も連続する）
    const done = await prisma.$transaction(
      async (t) => {
        await lockTemplates(t);
        let seq = await nextSeqNo(t);
        const ok: string[] = [];
        for (const r of creates) {
          if (!r.kind) continue;
          // 種別内の並びは末尾に足す（既存の並びを崩さない）
          const maxSort = await t.scoutTemplate.aggregate({
            where: { kind: r.kind as TemplateData["kind"] },
            _max: { sortOrder: true },
          });
          await t.scoutTemplate.create({
            data: {
              kind: r.kind as TemplateData["kind"],
              name: r.name,
              subject: r.subject,
              body: r.body,
              sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
              seqNo: seq++,
            },
          });
          ok.push(r.name);
        }
        return ok;
      },
      { timeout: 60000 },
    );
    created = done.length;
  }

  return { created, updated, errors };
}
