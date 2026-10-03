// T-206 step1: 既存 1 件（岡野 佑美 様 / slug jb6oFtu）を interview_prep_pages に登録する（本番 DB への追加のみ）。
//   実行: npx tsx --env-file=.env scripts/t206-register-okano.ts [--apply]
//   --apply 無しは dry-run（登録内容を表示するだけ）。
//   - 求職者「岡野 佑美」が 0 件 or 複数なら登録せず終了
//   - Dr.JOY株式会社 のエントリーが「選考終了」でなければひもづける（終了なら空のまま）
//   - 版 1 の html は C:\bizstudio\bizstudio-mensetsu\public\jb6oFtu.html の中身をそのまま
//   - useWrapper=false（資料にヘッダー・フッター入り）/ requireBirthdate=false（案内済み）
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { CLOSABLE_ENTRY_SELECT, isEntryClosed } from "../src/lib/mensetsu/constants";
import { expiresAtFrom } from "../src/lib/mensetsu/dates";
import { createPageWithFirstVersion } from "../src/lib/mensetsu/service";

const SLUG = "jb6oFtu";
const HTML_PATH = "C:/bizstudio/bizstudio-mensetsu/public/jb6oFtu.html";
const CANDIDATE_NAME = "岡野 佑美";
const COMPANY = "Dr.JOY株式会社";

async function main() {
  const apply = process.argv.includes("--apply");
  const dbHost = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`[t206] DATABASE host=${dbHost} mode=${apply ? "APPLY" : "dry-run"}`);

  const existing = await prisma.interviewPrepPage.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (existing) {
    console.log(`[t206] slug ${SLUG} は登録済み（id=${existing.id}）。何もしません`);
    return;
  }

  const candidates = await prisma.candidate.findMany({ where: { name: CANDIDATE_NAME }, select: { id: true, name: true, candidateNumber: true, birthday: true } });
  if (candidates.length !== 1) {
    console.log(`[t206] 求職者「${CANDIDATE_NAME}」が ${candidates.length} 件のため登録しません:`, candidates);
    return;
  }
  const candidate = candidates[0];

  const entries = await prisma.jobEntry.findMany({ where: { candidateId: candidate.id, companyName: COMPANY }, select: CLOSABLE_ENTRY_SELECT });
  let entryId: string | null = null;
  let entryNote = "エントリーなし";
  if (entries.length >= 1) {
    const e = entries[0];
    const closed = isEntryClosed(e);
    entryNote = `${e.companyName} entryFlag=${e.entryFlag} detail=${e.entryFlagDetail} person=${e.personFlag} company=${e.companyFlag} archived=${!!e.archivedAt} → ${closed ? "終了扱い（ひもづけない）" : "進行中（ひもづける）"}`;
    if (!closed) entryId = e.id;
  }

  // 作成者: 管理者ユーザー「大野」（1 件に特定できなければ中止）
  const users = await prisma.user.findMany({ where: { role: "admin", status: "active", name: { contains: "大野" } }, select: { id: true, name: true, email: true } });
  if (users.length !== 1) {
    console.log("[t206] 作成者ユーザーを 1 件に特定できません:", users);
    return;
  }
  const createdById = users[0].id;

  const html = readFileSync(HTML_PATH, "utf8");
  const publishedAt = new Date("2026-09-30T00:00:00+09:00");
  const expiresAt = expiresAtFrom("2026-09-30", 30); // 2026-10-30 0:00 JST

  console.log("[t206] 登録内容:", {
    candidate: `${candidate.name} (${candidate.candidateNumber}) id=${candidate.id} birthday=${candidate.birthday?.toISOString() ?? null}`,
    entry: entryNote,
    entryId,
    createdBy: `${users[0].name} <${users[0].email}>`,
    slug: SLUG,
    stage: "一次面接",
    title: `一次面接対策（${COMPANY}）`,
    publishedAt: publishedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    htmlBytes: Buffer.byteLength(html, "utf8"),
    useWrapper: false,
    requireBirthdate: false,
  });

  if (!apply) {
    console.log("[t206] dry-run のため登録しません（--apply で登録）");
    return;
  }

  const page = await createPageWithFirstVersion({
    candidateId: candidate.id,
    entryId,
    stage: "一次面接",
    title: `一次面接対策（${COMPANY}）`,
    interviewDate: null,
    html,
    note: "bizstudio-mensetsu public/jb6oFtu.html から移行（T-206 step1）",
    createdById,
    slug: SLUG,
    status: "published",
    publishedAt,
    expiresAt,
    useWrapper: false,
    requireBirthdate: false,
  });
  console.log(`[t206] 登録しました id=${page.id} slug=${page.slug} status=${page.status} versions=${page.versions.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export {};
