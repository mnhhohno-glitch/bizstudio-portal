// T-XXX step6: 社員の「稼働しない期間」（休業など）の入力検証・重複判定・保存と、月ごとの稼働日数の計算。
//
// - 保存するのは期間（開始日・終了日）だけ。**理由（産休など）は保存しない・受け取らない・返さない**。
// - 終了日 null = 終了未定（今も稼働しない）。日付は JST の暦日 "YYYY-MM-DD"（@db.Date に UTC 0:00 で保存・罠 #17）。
// - 同じ社員の期間の重複は保存時にはじく（両端を含む。終了未定は無限に続くものとして扱う）。
//   判定〜書き込みは社員単位の pg_advisory_xact_lock で直列化する（同時に 2 件追加されても重ならない）。
// - 稼働日数（CA 分析の分母）: その月の暦日のうち「在籍している日（入社日〜退職日）」から「稼働しない期間の日」を除いた日数。
//   稼働人月 = 稼働日数 ÷ その月の暦日数（小数 3 桁）。土日祝を区別しない暦日按分。
import { prisma } from "@/lib/prisma";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** 終了未定を比較するときの番兵（どの実日付よりも後）。 */
const OPEN_END = "9999-12-31";

export interface InactivePeriodYmd {
  id?: string;
  startDate: string;
  endDate: string | null;
}

/** @db.Date の値 → "YYYY-MM-DD"（UTC 0:00 保存なので UTC の日付部分がそのまま JST の暦日）。 */
export function dbDateToYmd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const ymdToDbDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

function isValidYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = ymdToDbDate(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // 2026-02-30 などを弾く
}

/** 入力（{ startDate, endDate }）を検証する。理由などそれ以外のキーは読まない。 */
export function parseInactivePeriodInput(body: unknown): { ok: true; value: InactivePeriodYmd } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const start = typeof b.startDate === "string" ? b.startDate.trim() : "";
  const endRaw = b.endDate;
  const end = endRaw == null ? "" : typeof endRaw === "string" ? endRaw.trim() : null;
  if (!start || !isValidYmd(start)) return { ok: false, error: "開始日を YYYY-MM-DD で入力してください" };
  if (end === null || (end !== "" && !isValidYmd(end))) return { ok: false, error: "終了日は YYYY-MM-DD で入力するか空欄（終了未定）にしてください" };
  if (end && end < start) return { ok: false, error: "終了日は開始日以降にしてください" };
  return { ok: true, value: { startDate: start, endDate: end || null } };
}

/** 2 つの期間が 1 日でも重なるか（両端を含む・終了未定は無限）。 */
export function periodsOverlap(a: InactivePeriodYmd, b: InactivePeriodYmd): boolean {
  return a.startDate <= (b.endDate ?? OPEN_END) && b.startDate <= (a.endDate ?? OPEN_END);
}

/** 既存の期間のうち、新しい期間と重なるもの（excludeId は編集中の自分）。 */
export function findOverlapping(existing: InactivePeriodYmd[], next: InactivePeriodYmd, excludeId?: string): InactivePeriodYmd | null {
  return existing.find((p) => p.id !== excludeId && periodsOverlap(p, next)) ?? null;
}

export class InactivePeriodOverlapError extends Error {
  constructor(public readonly conflict: InactivePeriodYmd) {
    super(`既に登録されている期間（${conflict.startDate} 〜 ${conflict.endDate ?? "終了未定"}）と重なっています`);
  }
}

export async function listInactivePeriods(employeeId: string): Promise<InactivePeriodYmd[]> {
  const rows = await prisma.employeeInactivePeriod.findMany({
    where: { employeeId },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true },
  });
  return rows.map((r) => ({ id: r.id, startDate: dbDateToYmd(r.startDate)!, endDate: dbDateToYmd(r.endDate) }));
}

/**
 * 追加（id なし）または更新（id あり）。重複は InactivePeriodOverlapError。
 * 更新で id が別の社員の行なら null（呼び出し側で 404）。
 */
export async function saveInactivePeriod(input: {
  employeeId: string;
  id?: string;
  period: InactivePeriodYmd;
  actorUserId: string | null;
}): Promise<InactivePeriodYmd | null> {
  return prisma.$transaction(async (tx) => {
    // $queryRaw ではなく $executeRaw（pg_advisory_xact_lock は void を返すため）
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inactive:${input.employeeId}`})::bigint)`;
    if (input.id) {
      const own = await tx.employeeInactivePeriod.findUnique({ where: { id: input.id }, select: { employeeId: true } });
      if (!own || own.employeeId !== input.employeeId) return null;
    }
    const existing = await tx.employeeInactivePeriod.findMany({
      where: { employeeId: input.employeeId },
      select: { id: true, startDate: true, endDate: true },
    });
    const conflict = findOverlapping(
      existing.map((r) => ({ id: r.id, startDate: dbDateToYmd(r.startDate)!, endDate: dbDateToYmd(r.endDate) })),
      input.period,
      input.id,
    );
    if (conflict) throw new InactivePeriodOverlapError(conflict);
    const data = {
      startDate: ymdToDbDate(input.period.startDate),
      endDate: input.period.endDate ? ymdToDbDate(input.period.endDate) : null,
    };
    const row = input.id
      ? await tx.employeeInactivePeriod.update({ where: { id: input.id }, data, select: { id: true, startDate: true, endDate: true } })
      : await tx.employeeInactivePeriod.create({
          data: { employeeId: input.employeeId, createdByUserId: input.actorUserId, ...data },
          select: { id: true, startDate: true, endDate: true },
        });
    return { id: row.id, startDate: dbDateToYmd(row.startDate)!, endDate: dbDateToYmd(row.endDate) };
  });
}

// ---- 稼働日数 -----------------------------------------------------------------

export interface MonthAvailability {
  month: string;
  /** その月の暦日数 */
  calendarDays: number;
  /** 在籍している日数（入社日〜退職日と月の重なり。入社日未登録は月初から在籍とみなす） */
  employedDays: number;
  /** 在籍日のうち稼働しない期間に入る日数 */
  inactiveDays: number;
  /** 稼働日数 = employedDays − inactiveDays */
  activeDays: number;
  /** 稼働人月 = activeDays ÷ calendarDays（小数 3 桁） */
  fte: number;
}

const DAY_MS = 86_400_000;
const ymdNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const numYmd = (n: number) => new Date(n).toISOString().slice(0, 10);

function monthBounds(month: string): { first: string; last: string; days: number } {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** [a1, a2] と [b1, b2] の重なり日数（両端を含む）。 */
function overlapDays(a1: string, a2: string, b1: string, b2: string): number {
  const s = a1 > b1 ? a1 : b1;
  const e = a2 < b2 ? a2 : b2;
  return s > e ? 0 : Math.round((ymdNum(e) - ymdNum(s)) / DAY_MS) + 1;
}

/**
 * 月の稼働日数。hireYmd / resignYmd は "YYYY-MM-DD" か null。periods は重ならない前提（保存時に重複をはじいている）。
 * 入社日未登録は「月初から在籍」、退職日未登録は「月末まで在籍」とみなす。
 */
export function monthAvailability(
  emp: { hireYmd: string | null; resignYmd: string | null; periods: InactivePeriodYmd[] },
  month: string,
): MonthAvailability {
  const { first, last, days } = monthBounds(month);
  const empFrom = emp.hireYmd && emp.hireYmd > first ? emp.hireYmd : first;
  const empTo = emp.resignYmd && emp.resignYmd < last ? emp.resignYmd : last;
  const employedDays = empFrom > empTo ? 0 : overlapDays(empFrom, empTo, first, last);
  let inactiveDays = 0;
  if (employedDays > 0) {
    for (const p of emp.periods) inactiveDays += overlapDays(p.startDate, p.endDate ?? OPEN_END, empFrom, empTo);
  }
  inactiveDays = Math.min(inactiveDays, employedDays);
  const activeDays = employedDays - inactiveDays;
  return { month, calendarDays: days, employedDays, inactiveDays, activeDays, fte: Math.round((activeDays / days) * 1000) / 1000 };
}

/** その日（"YYYY-MM-DD"）が稼働しない期間に入るか。 */
export function isInInactivePeriod(periods: InactivePeriodYmd[], ymd: string): boolean {
  return periods.some((p) => p.startDate <= ymd && ymd <= (p.endDate ?? OPEN_END));
}

/** 期間の日付を 1 日進める（"YYYY-MM-DD"）。SQL の半開区間の終端に使う。 */
export function nextYmd(ymd: string): string {
  return numYmd(ymdNum(ymd) + DAY_MS);
}
