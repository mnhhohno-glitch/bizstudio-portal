/**
 * T-XXX step2: 担当CA変更の記録（src/lib/ca-assignment-history.ts）のテスト。**ローカル検証DB専用**（書き込みを伴う）。
 *
 * - 担当が変わる保存で履歴が 1 行増え、変わらない保存では増えないこと
 * - 一括変更で「変わる行だけ」増えること
 * - 更新と同じトランザクションで書かれること（履歴側の失敗で更新も戻る）
 *
 * 実行: CA_KPI_TEST_DB=1 DATABASE_URL=postgresql://...@localhost:55432/... npx tsx scripts/test-ca-assignment-history-t-xxx-step2.ts
 * 本番 DB（localhost 以外）に向けると起動時に止まる。
 */
import assert from "node:assert/strict";

{
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.CA_KPI_TEST_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error("このテストは CA_KPI_TEST_DB=1 かつ localhost の検証DBでのみ実行できます");
    process.exit(2);
  }
}

import { prisma } from "@/lib/prisma";
import { recordCaAssignmentChange, recordCaAssignmentChanges, caAssignmentChanged, CA_ASSIGNMENT_ROUTES } from "@/lib/ca-assignment-history";

async function count() {
  return prisma.candidateCaAssignmentHistory.count();
}

async function main() {
  const tag = `hist-test-${Date.now()}`;
  const u = await prisma.user.create({ data: { name: tag, email: `${tag}@example.test`, passwordHash: "x" } });
  const e1 = await prisma.employee.create({ data: { employeeNumber: `${tag}-1`, name: "A" } });
  const e2 = await prisma.employee.create({ data: { employeeNumber: `${tag}-2`, name: "B" } });
  const c1 = await prisma.candidate.create({ data: { candidateNumber: `${tag}-c1`, name: "x", employeeId: e1.id } });
  const c2 = await prisma.candidate.create({ data: { candidateNumber: `${tag}-c2`, name: "y", employeeId: e2.id } });
  const c3 = await prisma.candidate.create({ data: { candidateNumber: `${tag}-c3`, name: "z", employeeId: null } });

  // caAssignmentChanged
  assert.equal(caAssignmentChanged(null, null), false);
  assert.equal(caAssignmentChanged(undefined, ""), false);
  assert.equal(caAssignmentChanged("a", "a"), false);
  assert.equal(caAssignmentChanged("a", "b"), true);
  assert.equal(caAssignmentChanged(null, "b"), true);
  assert.equal(caAssignmentChanged("a", null), true);

  // 1) 画面編集相当: 変わらない → 増えない / 変わる → 1 行
  const n0 = await count();
  const same = await prisma.$transaction(async (tx) => {
    await tx.candidate.update({ where: { id: c1.id }, data: { employeeId: e1.id, name: "x2" } });
    return recordCaAssignmentChange(tx, { candidateId: c1.id, fromEmployeeId: e1.id, toEmployeeId: e1.id, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateUpdate });
  });
  assert.equal(same, false);
  assert.equal(await count(), n0, "担当が変わらない保存では増えない");

  const changed = await prisma.$transaction(async (tx) => {
    const row = await tx.candidate.update({ where: { id: c1.id }, data: { employeeId: e2.id } });
    return recordCaAssignmentChange(tx, { candidateId: c1.id, fromEmployeeId: e1.id, toEmployeeId: row.employeeId, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateUpdate });
  });
  assert.equal(changed, true);
  assert.equal(await count(), n0 + 1, "担当が変わる保存で 1 行増える");
  const h = await prisma.candidateCaAssignmentHistory.findFirst({ where: { candidateId: c1.id }, orderBy: { changedAt: "desc" } });
  assert.deepEqual(
    { from: h?.fromEmployeeId, to: h?.toEmployeeId, by: h?.changedByUserId, route: h?.route },
    { from: e1.id, to: e2.id, by: u.id, route: "candidate_update" },
  );

  // 担当解除（→ null）も記録される
  await prisma.$transaction(async (tx) => {
    await tx.candidate.update({ where: { id: c1.id }, data: { employeeId: null } });
    await recordCaAssignmentChange(tx, { candidateId: c1.id, fromEmployeeId: e2.id, toEmployeeId: null, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateUpdate });
  });
  assert.equal(await count(), n0 + 2);

  // 2) 一括変更: c2 は既に e2 → 増えない / c3 (null→e2) → 増える
  const n1 = await count();
  const added = await prisma.$transaction(async (tx) => {
    const before = await tx.candidate.findMany({ where: { id: { in: [c2.id, c3.id] } }, select: { id: true, employeeId: true } });
    await tx.candidate.updateMany({ where: { id: { in: [c2.id, c3.id] } }, data: { employeeId: e2.id } });
    return recordCaAssignmentChanges(
      tx,
      before.map((b) => ({ candidateId: b.id, fromEmployeeId: b.employeeId, toEmployeeId: e2.id, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.bulkChangeAssignee })),
    );
  });
  assert.equal(added, 1);
  assert.equal(await count(), n1 + 1, "一括変更では変わる行だけ増える");
  const h3 = await prisma.candidateCaAssignmentHistory.findFirst({ where: { candidateId: c3.id } });
  assert.equal(h3?.route, "bulk_change_assignee");
  assert.equal(h3?.fromEmployeeId, null);

  // 3) 新規登録相当: 担当なしで登録 → 増えない / 担当付き → 増える
  const n2 = await count();
  await prisma.$transaction(async (tx) => {
    const c = await tx.candidate.create({ data: { candidateNumber: `${tag}-c4`, name: "w" } });
    await recordCaAssignmentChange(tx, { candidateId: c.id, fromEmployeeId: null, toEmployeeId: c.employeeId, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateCreate });
  });
  assert.equal(await count(), n2, "担当なしの新規登録では増えない");
  await prisma.$transaction(async (tx) => {
    const c = await tx.candidate.create({ data: { candidateNumber: `${tag}-c5`, name: "v", employeeId: e1.id } });
    await recordCaAssignmentChange(tx, { candidateId: c.id, fromEmployeeId: null, toEmployeeId: c.employeeId, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateCreate });
  });
  assert.equal(await count(), n2 + 1, "担当付きの新規登録で 1 行増える");

  // 4) 同一トランザクション: 履歴の書き込みが失敗したら更新も戻る（存在しない candidateId で FK 違反を起こす）
  const n3 = await count();
  const beforeName = (await prisma.candidate.findUnique({ where: { id: c2.id } }))!.name;
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.candidate.update({ where: { id: c2.id }, data: { name: "rolled-back" } });
      await recordCaAssignmentChange(tx, { candidateId: "no-such-candidate", fromEmployeeId: null, toEmployeeId: e1.id, changedByUserId: u.id, route: CA_ASSIGNMENT_ROUTES.candidateUpdate });
    }),
  );
  assert.equal((await prisma.candidate.findUnique({ where: { id: c2.id } }))!.name, beforeName, "履歴側の失敗で更新も戻る");
  assert.equal(await count(), n3);

  console.log("PASS: 担当CA変更の記録テスト");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

export {};
