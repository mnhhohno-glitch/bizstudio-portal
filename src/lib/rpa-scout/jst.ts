// RpaScoutLog.recordedAt / RpaScoutPlan.planDate は
// 「JSTの壁時計値をそのまま timestamp without time zone に保持する」列（UTC変換しない）。
//
// 書き込み: JST文字列をUTC扱いのDateに載せ替えて渡す（Prismaは UTC表現のリテラルを格納するため、
//           DBに入る値がそのままJST壁時計になる）。new Date("...+09:00") は9時間ズレるので禁止（罠#17）。
// 読み出し: timeZone "UTC" でフォーマットすればJST壁時計が得られる。
//           APIのJSON上は "YYYY-MM-DDTHH:mm:00.000Z" の形で流れるので、クライアントは文字列slice で表示してよい。

// "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" / "YYYY-MM-DD HH:mm:ss" (JST壁時計) → DB格納用Date
export function jstStringToDbDate(s: string): Date {
  const normalized = s.trim().replace(" ", "T");
  const m = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`JST日時文字列が不正です: ${s}`);
  const [, ymd, hh = "00", mm = "00", ss = "00"] = m;
  return new Date(`${ymd}T${hh}:${mm}:${ss}.000Z`);
}

// DBから読んだDate（JST壁時計をUTC欄に保持）→ "YYYY-MM-DD"
export function dbDateToJstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "UTC" });
}

// DBから読んだDate → "YYYY-MM-DD HH:mm"
export function dbDateToJstDateTime(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "UTC" }).slice(0, 16);
}

// 現在時刻のJST表現
export function nowJstYmd(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export function nowJstDateTimeLocal(): string {
  // datetime-local input の初期値用 "YYYY-MM-DDTHH:mm"
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" })
    .slice(0, 16)
    .replace(" ", "T");
}

// "YYYY-MM-DD" に日数を加算（JST壁時計のまま日付演算）
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString("sv-SE", { timeZone: "UTC" });
}

// "YYYY-MM-DD" の曜日 (0=日 ... 6=土)
export function ymdWeekday(ymd: string): number {
  return new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
}

// その週の月曜日の "YYYY-MM-DD"（月曜始まり）
export function mondayOfWeek(ymd: string): string {
  const wd = ymdWeekday(ymd);
  const diff = wd === 0 ? -6 : 1 - wd;
  return addDaysYmd(ymd, diff);
}
