// 求職者向け案内文の「選考状況」分類・文言変換。
//
// 調査根拠:
//   - docs/reports/entry-message-generator-survey.md §3-3 / §3-4 / §4
//   - docs/reports/entry-url-format-correction.md
//
// 罠（必ず守ること）:
//   1. DB の entry_flag_masters.sort_order を並び順に流用してはいけない。面接配下の
//      「適性検査」「所感」は sort_order 12〜16 に後付けされており、降順にすると
//      適性検査が最終面接より上に来る（survey §3-4）。順序は本ファイルの配列を正とする。
//   2. entry_flag_detail には master に存在しない値（「検討中」21件・空文字1件）が混入している
//      （survey §3-3）。文言マップは必ず「未知の値 → 補足なし」でフォールバックする。
//   3. 見送りは「確定」と「本人へ通知済み」を区別する。person_flag が
//      見送り通知送信済 / 見送り通知済み のときだけ「選考終了」。
//      「見送り通知未送信」は本人へ未通知なので、選考終了にしてはいけない（事故防止）。

/** 案内文のセクション見出し。配列の順序がそのまま出力順になる。 */
export const SELECTION_SECTIONS = [
  "内定",
  "最終面接",
  "選考中",
  "書類選考中",
  "エントリー",
  "選考終了",
  "入社済",
] as const;

export type SelectionSection = (typeof SELECTION_SECTIONS)[number];

/**
 * 本人へ見送りを通知済みであることを示す person_flag。
 * この値が入った行は entry_flag に関係なく「選考終了」に分類する（最優先判定）。
 * ※「見送り通知未送信」は含めない（未通知＝本人にはまだ伝えていない）。
 */
export const NOTIFIED_REJECTION_PERSON_FLAGS = ["見送り通知送信済", "見送り通知済み"] as const;

const NOTIFIED_SET: ReadonlySet<string> = new Set(NOTIFIED_REJECTION_PERSON_FLAGS);

/** entry_flag='面接' のうち「最終面接」段階とみなす entry_flag_detail。 */
const FINAL_INTERVIEW_DETAILS: ReadonlySet<string> = new Set([
  "最終日程調整中",
  "最終面接実施前",
  "最終面接選考中",
]);

/**
 * 会社名の後ろに括弧書きで添える補足文言。DB の表記（受講）を案内文の表記（受検）へ寄せる。
 * マップに無い値・null・空文字は補足なし（罠2）。
 */
const DETAIL_LABELS: Record<string, string> = {
  適性検査受講中: "適性検査受検中",
  適性検査受講済: "適性検査受検済",
  // 面接段階は日時行（buildInterviewLine）を併記するため、括弧側は段階名だけに留める。
  // 「一次面接前」＋「一次面接：8月17日…」だと重複して冗長になるため。
  一次日程調整中: "一次面接（日程調整中）",
  一次面接実施前: "一次面接",
  一次面接選考中: "一次面接の結果待ち",
  二次日程調整中: "二次面接（日程調整中）",
  二次面接実施前: "二次面接",
  二次面接選考中: "二次面接の結果待ち",
  最終日程調整中: "最終面接（日程調整中）",
  最終面接実施前: "最終面接",
  最終面接選考中: "最終面接の結果待ち",
  // 以下は「何も付けない」ことを明示（マップに無い値と同じ扱いだが、意図的な無表示であることを残す）
  検討中: "",
  選考中: "",
  選考落ち: "",
  クローズ: "",
};

export type ClassifiableEntry = {
  entryFlag: string | null;
  entryFlagDetail: string | null;
  personFlag: string | null;
};

/**
 * 選考状況セクションを決める。
 *
 * 判定順:
 *   0. person_flag が通知済み見送り → 選考終了（他のどの条件よりも優先）
 *   1. 内定 / 2. 最終面接 / 3. 選考中 / 4. 書類選考中 / 5. エントリー / 7. 入社済
 *
 * どれにも当てはまらない（entry_flag が null や「求人紹介」「応募」など）場合は null。
 * null は案内文から除外し、呼び出し側で件数を報告する。
 */
export function classifySelectionSection(entry: ClassifiableEntry): SelectionSection | null {
  if (entry.personFlag && NOTIFIED_SET.has(entry.personFlag)) return "選考終了";

  const flag = entry.entryFlag ?? "";
  const detail = entry.entryFlagDetail ?? "";

  if (flag === "内定") return "内定";
  if (flag === "面接") return FINAL_INTERVIEW_DETAILS.has(detail) ? "最終面接" : "選考中";
  if (flag === "書類選考") return "書類選考中";
  if (flag === "エントリー") return "エントリー";
  if (flag === "入社済") return "入社済";
  return null;
}

/**
 * 会社名の後ろに添える補足文言。付けない場合は空文字を返す。
 * 「選考終了」セクションでは進行中の詳細（例:「一次面接前」）を出すと矛盾するため、
 * 呼び出し側でセクションを渡して抑止できるようにしている。
 */
export function selectionDetailLabel(
  entryFlagDetail: string | null,
  section?: SelectionSection | null,
): string {
  if (section === "選考終了" || section === "入社済") return "";
  if (!entryFlagDetail) return "";
  return DETAIL_LABELS[entryFlagDetail] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────
// 面接日時の案内行
//
// 調査根拠: docs/reports/guide-message-interview-schedule-survey.md
//   - 面接は一次・二次・最終の3段階のみ（三次面接は存在しない。§2）
//   - 日付=DateTime? / 時刻=String? / 実施形式=String? の別カラム（§2）
//   - 実施形式の実値は「オンライン」95件・「対面」52件のみ。自由文字列なので
//     ホワイトリスト方式にし、未知値は何も出さない（生値を求職者に見せない・§4-2）
//   - 時刻は "HH:mm:ss" と "HH:mm" が混在する。正規化しないと「14:00:00」と出る（§4-3）
//   - 日付は必ず JST 変換。toISOString は禁止（罠 #17・§4-4）
// ─────────────────────────────────────────────────────────────────────────

/** 案内対象の面接スロット。 */
export type InterviewSlot = "first" | "second" | "final";

const SLOT_LABELS: Record<InterviewSlot, string> = {
  first: "一次面接",
  second: "二次面接",
  final: "最終面接",
};

/**
 * entry_flag_detail から「いま案内すべき面接」を決める。
 * 予定が入っている面接をすべて出すのではなく、選考段階に対応する1つだけを出す。
 * 対応する段階でなければ null（＝日時行を出さない）。
 */
const DETAIL_TO_SLOT: Record<string, InterviewSlot> = {
  一次日程調整中: "first",
  一次面接実施前: "first",
  一次面接選考中: "first",
  二次日程調整中: "second",
  二次面接実施前: "second",
  二次面接選考中: "second",
  最終日程調整中: "final",
  最終面接実施前: "final",
  最終面接選考中: "final",
};

export function interviewSlotForDetail(entryFlagDetail: string | null): InterviewSlot | null {
  if (!entryFlagDetail) return null;
  return DETAIL_TO_SLOT[entryFlagDetail] ?? null;
}

/**
 * 実施形式のホワイトリスト。DB は自由文字列なので、ここに無い値は何も出力しない。
 * 実データは「オンライン」「対面」の2値のみ（「電話」は選択肢にあるが実データ0件）。
 */
const INTERVIEW_TOOL_LABELS: Record<string, string> = {
  オンライン: "オンライン",
  対面: "対面",
  電話: "電話",
};

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * JST 基準で「2026年8月17日（月）」を返す。
 * 曜日は JST の暦日付から Date.UTC 経由で決定的に求める（Intl のロケール差異に依存しない）。
 */
function formatJstDateWithWeekday(date: Date): string | null {
  // 罠 #17: toISOString は本番UTC環境で1日ずれるため禁止。必ず Asia/Tokyo で暦日付を取る。
  const ymd = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD"
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = WEEKDAY_JA[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${y}年${mo}月${d}日（${weekday}）`;
}

/** "10:00:00" / "13:00" のゆれを "HH:mm" に正規化。取れなければ null。 */
function normalizeTime(time: string | null): string | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  if (!Number.isFinite(hh) || hh > 23) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

export type InterviewSchedule = {
  date: Date | string | null;
  time: string | null;
  tool: string | null;
};

/**
 * 「一次面接：2026年8月17日（月）14:00　対面」の1行を組み立てる。
 *
 *   - 日付が無ければ null（日程調整中で未定のケース。行ごと出さない）
 *   - 時刻が無ければ日付で終える
 *   - 実施形式はホワイトリストにある場合のみ、全角スペース1つ空けて付ける
 */
export function buildInterviewLine(slot: InterviewSlot, schedule: InterviewSchedule): string | null {
  if (!schedule.date) return null;
  const date = schedule.date instanceof Date ? schedule.date : new Date(schedule.date);
  if (Number.isNaN(date.getTime())) return null;
  const ymd = formatJstDateWithWeekday(date);
  if (!ymd) return null;

  const hhmm = normalizeTime(schedule.time);
  const tool = schedule.tool ? INTERVIEW_TOOL_LABELS[schedule.tool] : undefined;

  let line = `${SLOT_LABELS[slot]}：${ymd}`;
  if (hhmm) line += hhmm;
  if (tool) line += `　${tool}`;
  return line;
}

