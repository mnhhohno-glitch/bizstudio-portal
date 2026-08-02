// T-151 Phase 2-3: 面談ログ（Notta 等）から固定2種のタスク約束を検出する。
//
// 設計方針（Phase 1 調査 docs/survey_T-151_interview_task_phase1.md に基づく）:
//  - AI は Anthropic を使う。**Gemini は1コールも増やさない**（月次上限到達で7月に障害実績。
//    面談解析は candidate-intake 側で既に最大3コール Gemini を使っている）。
//  - 検出は「別呼び出し」。candidate-intake の変更禁止ファイル（specs/ / loadSpec.ts /
//    geminiClient.ts）には一切触れない。
//  - AI には相対表現だけを出させ、実際の日付は resolveDueDate（JST）でサーバー側が決める。
//    LLM に年月日を出させると年ズレする。
//  - 種別のホワイトリストはサーバー側でも強制する（normalizeSuggestedTasks が担保）。
//  - パース失敗・API エラーで例外を投げない。面談解析本体は必ず成立させる（fail-open）。
//
// ★T-150（アドバイザー会話）との検出方針の違い:
//  T-150 は <ca_input>（CAの打鍵）限定で「厳しく絞る」。面談ログは話者混在テキストで
//  厳密な話者確定が不可能なため、T-151 は逆に「迷ったら候補を出す」に倒す。
//  誤検出は CA が「今回は不要」で消せるが、取りこぼしは気づかれずに約束が消えるため。
//
// ★プロンプトキャッシュ（罠#39）: 面談ログは毎回異なる非決定的テキストなので
//  cache_control は付けない。付けると毎回 cache write（1.25倍）で純損になる。

import { CLAUDE_MODEL_DEFAULT } from "@/lib/claude";
import { recordAdvisorUsage } from "@/lib/advisor-usage";
import { normalizeSuggestedTasks, type SuggestedTask } from "@/lib/advisor/suggested-tasks";

/** 検出専用のタイムアウト。面談解析本体（maxDuration=300）の後段で走るため短めに切る。 */
const DETECT_TIMEOUT_MS = 60_000;

/** 入力に乗せるログの上限。実測の最大級は約32,000字（2回目面談 88KB）。 */
const MAX_LOG_CHARS = 40_000;

/** 出力は JSON1行だけなので小さくてよい。 */
const MAX_OUTPUT_TOKENS = 500;

/**
 * 面談ログからタスク約束を検出させる指示文。
 *
 * ★実ログ60件の調査（Phase 1）で判明した事実に基づく:
 *  - 38%（23/60）に「対応事項」「次のステップ」節があり、その全件に
 *    `@エージェント（氏名）：…` 形式のCA側アクション行、91%に日付表現が含まれる。
 *    → 話者識別の困難さを迂回できる最良の根拠なので最優先で見る。
 *  - 残りは Notta 生文字起こしで、文字起こし精度が著しく低い箇所がある。
 *  - 除外例は実ログから採取した実物（特に N-2「LINE登録確認メールの送信」が最頻出の誤検出源）。
 */
export const INTERVIEW_TASK_DETECTION_PROMPT = `あなたは人材紹介会社のCA（キャリアアドバイザー）の面談ログを読み、
「CAが求職者に対してこれからやると約束した作業」のうち、下記2種類だけを抽出するアシスタントです。

# 抽出する種別（この2つ以外は絶対に出力しない）
- JOB_SEARCH_SEND: CAが求人を検索・ピックアップして求職者に送る／マイページに掲載する約束
- FORM_SURVEY: CAがGoogleフォーム（アンケート・質問票）を求職者に送付する約束

# 判断の手順
1. ログ内に「対応事項」「次のステップ」「アクションアイテム」等の見出しがある場合、
   **そこを最優先の根拠にする**。この節では担当者が明示されている（例: 「@エージェント（山田）：」
   「@担当者：」「担当者：」「@山田氏：」）。**CA側の行だけを見る**。
2. その節が無い場合は、会話本文からCAの約束表現（「送りますね」「ピックアップして送らせていただきます」
   「アンケートのURLを送ります」等）を探す。
3. 面談ログは書き起こし精度が低く、文が崩れていることがある。多少崩れていても
   意味が取れるなら約束とみなしてよい。

# 迷ったときの方針（重要）
**迷ったら出す。** 誤検出はCAが1クリックで消せるが、見落とすと約束が消える。
「たぶん求人を送る約束だろう」程度の確信でも出してよい。

# 出力してはいけないもの（実際のログでよくある紛らわしい例）
- サービス内容の一般説明。特に「本日は求人のご紹介というよりは…」のような**否定文脈**。
- **LINE登録確認のメール送信**（例:「ラインのご登録案内という件名でメールを送らせていただきましたので、
  届きましたら教えてください」）。送付の動詞が出るが、求人ともフォームとも無関係で、しかも
  その場で完了している。**最も多い誤検出源なので必ず除外すること。**
- 求職者側のアクション（例:「@山田さん：Googleフォームに追加情報を入力する」
  「@山田さん：履歴書・職務経歴書を記入・返送する」）。主語がCAでないものは対象外。
- 過去に完了した紹介への言及（例:「先日ご紹介させていただいた求人が9件」）。
- 上記2種以外のCA側アクション（例: 面接対策資料の準備、次回面談の日程確保、
  履歴書・職務経歴書の作成、マイページの発行のみ）。

# 期日
- **相対表現のみを出す。日付・年月日は絶対に出力しない**（年を間違えるため）。
- 使える値: this_week / next_monday / tomorrow / in_days:N / none
  - 「今週中」「今週金曜まで」→ this_week
  - 「週明け」「月曜までに」→ next_monday
  - 「明日」→ tomorrow
  - 「来週火〜水曜までに」「3日以内」→ in_days:N（Nは日数）
  - 「本日中」「今日この後」→ in_days:0
  - 期日の言及がない → none

# 出力形式
必ず以下の形式のみを出力する。前後に説明文を書かない。
候補が1件も無い場合は tasks を空配列にする。

<<<T150_TASKS
{"tasks":[{"kind":"JOB_SEARCH_SEND","due":"this_week"}]}
T150_TASKS>>>`;

/** 応答から JSON ブロックを取り出す（T-150 と同じマーカーを共用）。 */
const TASKS_BLOCK_RE = /<<<T150_TASKS([\s\S]*?)T150_TASKS>>>/;

export type DetectResult = {
  suggestedTasks: SuggestedTask[];
  /** 検出をスキップした理由（ログ用）。検出した場合は null。 */
  skippedReason: string | null;
};

/**
 * 面談ログからタスク候補を検出する。
 *
 * ★例外を投げない。失敗はすべて「候補なし」として返す（面談解析本体を絶対に落とさない）。
 * ★入力は面談ログ（txt）のみ。履歴書PDFを混ぜてはいけない（書類内の「送付」等で誤検出するため）。
 */
export async function detectSuggestedTasksFromInterviewLog(params: {
  interviewLog: string;
  candidateId?: string | null;
}): Promise<DetectResult> {
  const { interviewLog, candidateId } = params;

  const log = (interviewLog ?? "").trim();
  if (log.length === 0) {
    return { suggestedTasks: [], skippedReason: "no-interview-log" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[interview-task-detect] ANTHROPIC_API_KEY 未設定のため検出をスキップします");
    return { suggestedTasks: [], skippedReason: "no-api-key" };
  }

  const body = log.length > MAX_LOG_CHARS ? log.slice(0, MAX_LOG_CHARS) : log;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL_DEFAULT,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        // ★cache_control は付けない（面談ログは毎回異なる＝罠#39）。
        system: INTERVIEW_TASK_DETECTION_PROMPT,
        messages: [
          {
            role: "user",
            content: `以下は面談ログです。指示に従ってタスク候補を抽出してください。\n\n<interview_log>\n${body}\n</interview_log>`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[interview-task-detect] Anthropic API error:", response.status, errText.slice(0, 300));
      await recordAdvisorUsage({
        endpoint: "interview-task-detect",
        model: CLAUDE_MODEL_DEFAULT,
        usage: null,
        candidateId,
        note: `error-${response.status}`,
      });
      return { suggestedTasks: [], skippedReason: `api-error-${response.status}` };
    }

    const data = await response.json();
    await recordAdvisorUsage({
      endpoint: "interview-task-detect",
      model: CLAUDE_MODEL_DEFAULT,
      usage: data.usage ?? null,
      candidateId,
      note: `log-chars-${body.length}`,
    });

    const text: string = data.content?.[0]?.text ?? "";
    const suggestedTasks = parseDetectionOutput(text);

    console.log(
      `[interview-task-detect] chars=${body.length} detected=${suggestedTasks.length} ` +
        suggestedTasks.map((t) => `${t.kind}(${t.due}→${t.dueDate})`).join(" "),
    );

    return { suggestedTasks, skippedReason: null };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      console.error("[interview-task-detect] timeout after", DETECT_TIMEOUT_MS, "ms");
      return { suggestedTasks: [], skippedReason: "timeout" };
    }
    console.error("[interview-task-detect] failed (non-fatal):", e);
    return { suggestedTasks: [], skippedReason: "exception" };
  }
}

/**
 * 応答テキストからタスク候補を取り出す。
 * マーカーが無い場合は、応答全体が JSON である可能性も見る（AI がマーカーを忘れた場合の救済）。
 * 期日の確定（JST）は normalizeSuggestedTasks → resolveDueDate が行う。
 */
export function parseDetectionOutput(text: string): SuggestedTask[] {
  if (!text) return [];

  const m = text.match(TASKS_BLOCK_RE);
  const jsonText = m ? m[1] : extractBareJson(text);
  if (!jsonText) return [];

  try {
    return normalizeSuggestedTasks(JSON.parse(jsonText));
  } catch (e) {
    console.warn("[interview-task-detect] JSON parse failed (non-fatal):", e);
    return [];
  }
}

/** マーカー無しで JSON だけ返ってきた場合に拾う（``` フェンス付きも許容）。 */
function extractBareJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}
