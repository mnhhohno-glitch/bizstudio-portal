/**
 * T-150 Phase 2-2: 実プロンプト（TASK_DETECTION_PROMPT）に対する誤検出テスト。
 *
 * 本番と同じ Anthropic API・同じスキル注入・同じ <ca_input>/<attachment> ラップで
 * 動作確認1〜5 の入力を実際に投げ、AI が出したブロックを剥がして正規化まで通す。
 * ※ UI ログインが不要なため、staging の画面操作なしで誤検出の有無を検証できる。
 *   画面表示・DB保存の end-to-end 確認は別途 staging 上で行うこと。
 *
 * 実行:
 *   TZ=UTC npx tsx scripts/test-t150-detection-live.ts
 *
 * 注意: Anthropic API を5回呼ぶ（実費が発生する。1回あたり skill 込みで約1.5万トークン）。
 */

import "dotenv/config";
import { getJobMatchingSkillFull } from "@/lib/load-job-matching-skill";
import { CLAUDE_MODEL_DEFAULT } from "@/lib/claude";
import { extractSuggestedTasks, TASK_DETECTION_PROMPT } from "@/lib/advisor/suggested-tasks";
import { jstYmd, thisWeekFridayYmd, addDaysYmd } from "@/lib/schedule-agent/jst";

// route.ts の ADVISOR_PERSONA_PROMPT 冒頭と同等の役割定義（route は export できないため要旨のみ）。
const PERSONA = `# Role & Persona

あなたは人材紹介会社「株式会社ビズスタジオ」のシニアキャリアアドバイザーです。
担当CAと一緒に、求職者の転職支援を行います。CAとの自然な会話を意識し、毎回長文レポートを書かない。

---

# 求人マッチングスキル定義

以下のスキル定義に基づいて求職者分析・求人マッチングを行うこと。

`;

// 職務経歴書の抜粋を模した添付テキスト。「送付」「提出」等、誤検出を誘う語をあえて含める。
const RESUME_TEXT = `職務経歴書

■ 職務要約
法人営業として5年間従事。新規開拓を担当し、提案資料の作成から見積書の送付、
契約書類の提出までを一貫して対応。月次で実績レポートをアンケート形式で提出していた。

■ 職務経歴
2021年4月〜 株式会社サンプル商事 営業部
- 新規顧客への求人媒体の提案・送付業務
- 顧客アンケートフォームの送付および回答回収（月40件）
- 来週中に提出予定の資料についても社内調整を担当`;

type Case = {
  no: number;
  label: string;
  caInput: string;
  attachment?: string;
  /** 前ターンの会話（AIが将来作業に言及しているケースの再現に使う）。 */
  history?: { role: "user" | "assistant"; content: string }[];
  expect: string;
};

const CASES: Case[] = [
  {
    no: 1,
    label: "求人送付の約束（今週中）",
    caInput: "今週中に求人を検索して送りますね",
    expect: "JOB_SEARCH_SEND / dueDate=今週の金曜",
  },
  {
    no: 2,
    label: "フォーム送付の約束（明日）",
    caInput: "アンケートのフォームを明日送ります",
    expect: "FORM_SURVEY / dueDate=明日",
  },
  {
    no: 3,
    label: "約束なしの質問",
    caInput: "この求職者の志向性を教えて",
    expect: "候補なし（null）",
  },
  {
    no: 4,
    label: "AI応答が将来作業に言及（CAは同意していない）",
    caInput: "ありがとう。参考になりました",
    history: [
      { role: "user", content: "<ca_input>\nこの人に合いそうな方向性は？\n</ca_input>" },
      {
        role: "assistant",
        content:
          "営業職での横スライドが有力です。週明けの追加求人送付に向けて、まずは希望条件の確認を進めるとよいでしょう。次回は求人検索して送付する流れが自然です。",
      },
    ],
    expect: "候補なし（AI応答文は根拠にしない）",
  },
  {
    no: 5,
    label: "職務経歴書を添付（打鍵分に約束なし・書類内に「送付」あり）",
    caInput: "この人の経歴を要約して",
    attachment: RESUME_TEXT,
    expect: "候補なし（添付内の「送付」で誤検出しない）",
  },
];

async function callClaude(c: Case): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定です");

  const messages = [
    ...(c.history ?? []),
    {
      role: "user" as const,
      content:
        `<ca_input>\n${c.caInput}\n</ca_input>\n` +
        (c.attachment ? `\n<attachment name="職務経歴書.pdf">\n${c.attachment}\n</attachment>\n` : ""),
    },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL_DEFAULT,
      max_tokens: 4000,
      temperature: 0.7,
      system: [
        {
          type: "text",
          text: PERSONA + getJobMatchingSkillFull() + TASK_DETECTION_PROMPT,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: "\n\n---\n\n# 求職者データ\n\n（テスト実行のため求職者データなし）" },
      ],
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

(async () => {
  const offset = new Date().getTimezoneOffset();
  console.log(`\n[前提] TZ=${process.env.TZ ?? "(未設定)"} / offset=${offset} / JST today=${jstYmd()}`);
  if (offset !== 0) {
    console.error("✗ TZ=UTC で実行してください（本番 Railway と同条件）。");
    process.exit(1);
  }
  const today = jstYmd();
  console.log(`  想定: this_week=${thisWeekFridayYmd(today)} / tomorrow=${addDaysYmd(today, 1)}\n`);

  let ng = 0;
  for (const c of CASES) {
    console.log("=".repeat(78));
    console.log(`[ケース${c.no}] ${c.label}`);
    console.log(`  入力(打鍵分): ${c.caInput}`);
    if (c.attachment) console.log(`  添付: 職務経歴書.pdf（「送付」「提出」「アンケート」を含む）`);
    console.log(`  期待: ${c.expect}`);

    const raw = await callClaude(c);
    const { cleanContent, suggestedTasks } = extractSuggestedTasks(raw);

    const hasMarker = /T150_TASKS/.test(cleanContent);
    console.log(`\n  --- 保存される本文（先頭200字） ---`);
    console.log("  " + cleanContent.slice(0, 200).replace(/\n/g, "\n  "));
    console.log(`\n  マーカー残存: ${hasMarker ? "★あり（不合格）" : "なし"}`);
    console.log(`  suggested_tasks に入る値: ${suggestedTasks.length > 0 ? JSON.stringify(suggestedTasks) : "null（候補なし）"}`);
    if (hasMarker) ng++;
    console.log("");
  }
  console.log("=".repeat(78));
  console.log(`剥がし漏れ: ${ng} 件（0 なら正常）\n`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
