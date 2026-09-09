/**
 * スカウト配信枠の「時刻」定義（単一ソース）
 *
 * ScoutDeliverySlot は hourSlot(時) + minuteSlot(分) の組で1枠を表す。
 * 枠の候補一覧・ラベル・集計バケットキー・妥当性チェックはすべてここを経由すること
 * （8〜19 の決め打ちや `${hourSlot}:00` の直書きを各所に持たない）。
 *
 * このモジュールは prisma に依存しない純粋な定義なので、client component からも import できる。
 * サーバ側は従来どおり `@/lib/scout/slot-helpers` からも同名で再 export されている。
 */

export type SlotTime = { hour: number; minute: number };

/**
 * 1日の配信枠（13枠）。日次自動生成・UI のプルダウン・ダッシュボードの x 軸はすべてこの並び。
 * 14:30 は 2026-09 に追加（既存日には遡及して枠を作らない。createDailySlots は既存日をスキップする）。
 */
export const SLOT_TIMES: readonly SlotTime[] = [
  { hour: 8, minute: 0 },
  { hour: 9, minute: 0 },
  { hour: 10, minute: 0 },
  { hour: 11, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 14, minute: 30 },
  { hour: 15, minute: 0 },
  { hour: 16, minute: 0 },
  { hour: 17, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 19, minute: 0 },
];

/** 表示ラベル兼バケットキー: "9:00" / "14:30"（時はゼロ埋めしない・分は2桁） */
export function formatSlotTime(hour: number, minute: number = 0): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

/** 集計（groupBy=hour）のバケットキー。表示ラベルと同じ "14:30" 形式。 */
export function slotBucketKey(hour: number, minute: number = 0): string {
  return formatSlotTime(hour, minute);
}

/** 0:00 からの通算分（ソート・距離計算用） */
export function slotMinutes(hour: number, minute: number = 0): number {
  return hour * 60 + minute;
}

/** (hour, minute) が SLOT_TIMES に存在する枠か */
export function isValidSlotTime(hour: unknown, minute: unknown): boolean {
  if (typeof hour !== "number" || typeof minute !== "number") return false;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return SLOT_TIMES.some((t) => t.hour === hour && t.minute === minute);
}

/** "14:30" / "9:00" / "14" を {hour, minute} に戻す（UI の select 値・バケットキーの逆変換）。不正なら null */
export function parseSlotTimeKey(key: string): SlotTime | null {
  const m = String(key).trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

/** バケットキー同士の並び順（"8:00" < "14:00" < "14:30" < "19:00"）。数値順なので文字列順の罠を踏まない */
export function compareSlotKeys(a: string, b: string): number {
  const ta = parseSlotTimeKey(a);
  const tb = parseSlotTimeKey(b);
  const ma = ta ? slotMinutes(ta.hour, ta.minute) : Number.MAX_SAFE_INTEGER;
  const mb = tb ? slotMinutes(tb.hour, tb.minute) : Number.MAX_SAFE_INTEGER;
  return ma - mb;
}

/** 妥当性エラー時のメッセージ用に候補一覧を "8:00, 9:00, ..." で返す */
export function slotTimesLabel(): string {
  return SLOT_TIMES.map((t) => formatSlotTime(t.hour, t.minute)).join(", ");
}
