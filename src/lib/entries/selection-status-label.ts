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
  一次日程調整中: "一次面接の日程調整中",
  一次面接実施前: "一次面接前",
  一次面接選考中: "一次面接の結果待ち",
  二次日程調整中: "二次面接の日程調整中",
  二次面接実施前: "二次面接前",
  二次面接選考中: "二次面接の結果待ち",
  最終日程調整中: "最終面接の日程調整中",
  最終面接実施前: "最終面接前",
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
