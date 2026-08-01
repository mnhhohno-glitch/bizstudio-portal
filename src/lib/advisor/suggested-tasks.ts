// T-150: AIアドバイザーの応答に併記されたタスク候補 JSON を、本文から剥がして正規化する。
//
// 設計の要点:
//  - AI には「相対表現」だけを出させ、実際の日付はここでサーバー側（JST）で決める。
//    LLM に年月日を出させると年ズレする（T-139 の resolveYearNearestFuture と同じ方針）。
//  - 種別のホワイトリストをサーバー側でも強制する（プロンプトだけに頼らない二重防御）。
//    確定仕様は「固定2種のみ・自由抽出禁止」なので、想定外の kind は黙って捨てる。
//  - パースに失敗しても例外を投げない。チャット応答は必ず成立させる（fail-open）。

import {
  jstYmd,
  addDaysYmd,
  thisWeekFridayYmd,
  nextMondayYmd,
  addBusinessDaysYmd,
  clampNotPastYmd,
} from "@/lib/schedule-agent/jst";

/**
 * 会話中の「約束」から固定2種のタスク候補だけを検出させる指示文。
 * messages route の systemBlocks[0]（cache_control 付きの固定ブロック）末尾に連結する。
 *
 * ソース内の静的定数で候補者ごとに変わらない＝byte 安定のため、罠#39（プロンプトキャッシュ）に抵触しない。
 * マーカーは Markdown のコードフェンス（```）にしない（剥がし漏れ時に整形されて画面に出るため）。
 *
 * ※ route ファイルは Next.js の制約で任意の定数を export できないため、実プロンプトを
 *   テストから参照できるようここに置いている（route と検証で同じ文言を使うための単一情報源）。
 */
export const TASK_DETECTION_PROMPT = `

---

# タスク候補の検出

応答本文の末尾に、以下の条件をすべて満たす場合のみタスク候補 JSON を付ける。
条件を満たさない場合は JSON を一切出力しない。

【検出してよい唯一の根拠】
- 直近の <ca_input> タグ内のテキストに、CA自身が「やる」と述べた約束が含まれる場合のみ。
- <ca_input> の外にあるもの（あなた自身の応答文・過去の会話・<attachment> の中身）は
  根拠にしてはならない。
- あなたが提案した作業は、CAが <ca_input> 内で同意を明言していない限り検出しない。

【検出する種別（この2つ以外は絶対に出力しない）】
- JOB_SEARCH_SEND: 求職者へ求人を検索して送る約束
- FORM_SURVEY: Googleフォーム（書類アンケート）の送付・回答確認の約束

【期日】
- 相対表現のみを出す。日付・年月日は絶対に出力しない。
- 使える値: this_week / next_monday / tomorrow / in_days:N / none

【出力形式】
応答本文の末尾に、以下の形式で正確に出力する。

<<<T150_TASKS
{"tasks":[{"kind":"JOB_SEARCH_SEND","due":"this_week"}]}
T150_TASKS>>>
`;

/** 起票できる種別（この2つ以外は絶対に受け付けない）。 */
export const SUGGESTED_TASK_KINDS = ["JOB_SEARCH_SEND", "FORM_SURVEY"] as const;
export type SuggestedTaskKind = (typeof SUGGESTED_TASK_KINDS)[number];

export type SuggestedTask = {
  kind: SuggestedTaskKind;
  /** AI が出した相対表現（監査用にそのまま残す）。 */
  due: string;
  /** サーバー側で JST 確定させた期日 "YYYY-MM-DD"。UI ではこれを編集させる。 */
  dueDate: string;
};

/** 応答本文に併記させる JSON ブロックのマーカー。Markdown のコードフェンスにはしない。 */
const TASKS_BLOCK_RE = /<<<T150_TASKS([\s\S]*?)T150_TASKS>>>/;

/** `in_days:N` の N の上限。これを超える値は指示違反とみなし none 扱いにする。 */
const MAX_IN_DAYS = 90;

/**
 * 相対表現を JST の "YYYY-MM-DD" に変換する。
 * 想定外の値・空はすべて none（会話日 + 3営業日）として扱う。
 *
 * 罠#17: 曜日判定は jst.ts 側で JST 暦日文字列から Date.UTC 経由で行っている。
 * ここで new Date().getDay() 等を使ってはいけない（Railway は UTC 稼働）。
 */
export function resolveDueDate(due: string | null | undefined, today: string = jstYmd()): string {
  const raw = typeof due === "string" ? due.trim() : "";

  let resolved: string;
  if (raw === "this_week") {
    resolved = thisWeekFridayYmd(today);
  } else if (raw === "next_monday") {
    resolved = nextMondayYmd(today);
  } else if (raw === "tomorrow") {
    resolved = addDaysYmd(today, 1);
  } else if (/^in_days:-?\d+$/.test(raw)) {
    const n = parseInt(raw.slice("in_days:".length), 10);
    // 負値は clampNotPastYmd が今日に丸めるが、非現実的な未来は指示違反として既定値に倒す。
    resolved = n > MAX_IN_DAYS ? addBusinessDaysYmd(today, 3) : addDaysYmd(today, n);
  } else {
    // "none" および想定外の値
    resolved = addBusinessDaysYmd(today, 3);
  }

  // 過去日を期日にしない（朝バッチが即日から超過通知を出すのを防ぐ）。
  return clampNotPastYmd(resolved);
}

function isKind(v: unknown): v is SuggestedTaskKind {
  return typeof v === "string" && (SUGGESTED_TASK_KINDS as readonly string[]).includes(v);
}

/**
 * AI が出した生 JSON を SuggestedTask[] に正規化する。
 * - kind がホワイトリスト外なら破棄
 * - 同一 kind は最初の1件のみ（＝最大2件）
 * - 形が壊れていれば空配列
 */
export function normalizeSuggestedTasks(raw: unknown): SuggestedTask[] {
  const today = jstYmd();
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks)
      ? (raw as { tasks: unknown[] }).tasks
      : null;
  if (!list) return [];

  const out: SuggestedTask[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    if (!isKind(kind)) continue; // 自由抽出の禁止をサーバー側でも強制
    if (seen.has(kind)) continue; // 同一種別は1件だけ
    seen.add(kind);
    const dueRaw = (item as { due?: unknown }).due;
    const due = typeof dueRaw === "string" ? dueRaw.trim() : "none";
    out.push({ kind, due, dueDate: resolveDueDate(due, today) });
    if (out.length >= SUGGESTED_TASK_KINDS.length) break;
  }
  return out;
}

/**
 * AI 応答本文から候補 JSON ブロックを剥がし、本文と正規化済み候補を返す。
 * 例外は投げない（parse 失敗時は候補なし・本文はブロックだけ除去して返す）。
 *
 * DB に保存するのは必ず cleanContent 側。生のまま保存すると
 *  1) ReactMarkdown にそのまま流れて画面に JSON が出る
 *  2) 次ターンの messages に乗り、AI が自分の過去 JSON を模倣する
 */
export function extractSuggestedTasks(aiContent: string): {
  cleanContent: string;
  suggestedTasks: SuggestedTask[];
} {
  if (!aiContent) return { cleanContent: aiContent, suggestedTasks: [] };

  const m = aiContent.match(TASKS_BLOCK_RE);
  if (!m) return { cleanContent: aiContent, suggestedTasks: [] };

  const cleanContent = aiContent.replace(m[0], "").trimEnd();
  try {
    return { cleanContent, suggestedTasks: normalizeSuggestedTasks(JSON.parse(m[1])) };
  } catch (e) {
    console.warn("[advisor-chat] suggestedTasks parse failed (non-fatal):", e);
    return { cleanContent, suggestedTasks: [] };
  }
}
