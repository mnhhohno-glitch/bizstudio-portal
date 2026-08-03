// DOCUMENT_SEND（応募書類の作成・送付）の検出精度検証。読み取り専用（DB書き込み・タスク起票はしない）。
//
// 実行: npx tsx scripts/test_document_task_detection.ts
// 必要: ANTHROPIC_API_KEY
//   実ログ（PII）を使うケースは環境変数でパスを渡す。リポジトリには置かない:
//     NARITA_LOG_PATH=/path/to/2回目面談_成田 鈴.txt npx tsx scripts/test_document_task_detection.ts
//
//  J-1〜J-4 = DOCUMENT_SEND を検出すべき（J-1 は実ログ。指定が無ければ SKIP）
//  N-1〜N-3 = DOCUMENT_SEND を出してはいけない
//  V-1〜V-2 = 既存2種のデグレ確認
//  V-3      = 3種同時検出
//
// 合格条件: expect に挙げた kind をすべて含み、それ以外の kind を1つも含まないこと。
//
// ★test_t151_detection.ts と同じ方式: 本番と同じ INTERVIEW_TASK_DETECTION_PROMPT と
//   parseDetectionOutput（どちらも実物を import）を使い、Anthropic 呼び出しだけここで行う。
//   recordAdvisorUsage を経由しない＝DBに書かない。

import fs from "fs";
import {
  INTERVIEW_TASK_DETECTION_PROMPT,
  parseDetectionOutput,
} from "../src/lib/interview/detect-suggested-tasks";
import { CLAUDE_MODEL_DEFAULT } from "../src/lib/claude";
import type { SuggestedTask, SuggestedTaskKind } from "../src/lib/advisor/suggested-tasks";

type Usage = { input_tokens?: number; output_tokens?: number };

async function detect(interviewLog: string): Promise<{ tasks: SuggestedTask[]; usage: Usage }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL_DEFAULT,
      max_tokens: 500,
      temperature: 0,
      system: INTERVIEW_TASK_DETECTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `以下は面談ログです。指示に従ってタスク候補を抽出してください。\n\n<interview_log>\n${interviewLog}\n</interview_log>`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    tasks: parseDetectionOutput(data.content?.[0]?.text ?? ""),
    usage: data.usage ?? {},
  };
}

type Case = { id: string; expect: SuggestedTaskKind[]; log: string };

const naritaPath = process.env.NARITA_LOG_PATH;
const naritaLog = naritaPath && fs.existsSync(naritaPath)
  ? fs.readFileSync(naritaPath, "utf-8")
  : null;

const CASES: Case[] = [
  // ---- 拾うべき（DOCUMENT_SEND）----
  ...(naritaLog
    ? [{
        id: "J-1 実ログ/2回目面談_成田 鈴/職務経歴書の修正を明日中に送付",
        expect: ["DOCUMENT_SEND", "JOB_SEARCH_SEND"] as SuggestedTaskKind[],
        log: naritaLog,
      }]
    : []),
  {
    id: "J-2 志望動機入りの書類を作成して送る",
    expect: ["DOCUMENT_SEND"],
    log: `話者 1 10:12 ありがとうございます。では、志望動機を入れた書類をこちらで作成してお送りしますね。
話者 2 10:12 はい、お願いします。`,
  },
  {
    id: "J-3 履歴書をこちらで整えて週明けに送付",
    expect: ["DOCUMENT_SEND"],
    log: `対応事項
@エージェント（大野）：履歴書はこちらで整えて、週明けにお送りする
@求職者：内容を確認する`,
  },
  {
    id: "J-4 書類を仕上げて確認できるように送る",
    expect: ["DOCUMENT_SEND"],
    log: `話者 1 22:40 えっと、では書類を仕上げて、確認いただけるように送りますので、見ていただければと思います。
話者 2 22:41 わかりました。`,
  },
  // ---- 拾ってはいけない ----
  {
    id: "N-1 証明写真は求職者側の宿題",
    expect: [],
    log: `話者 1 05:20 では、証明写真を撮ってLINEで送ってください。それをこちらで確認します。
話者 2 05:21 はい、撮ったら送りますね。`,
  },
  {
    id: "N-2 過去形（先週すでに送った職務経歴書）",
    expect: [],
    log: `話者 1 03:02 先週お送りした職務経歴書ですが、ご覧いただけましたでしょうか。
話者 2 03:03 はい、拝見しました。ありがとうございます。`,
  },
  {
    id: "N-3 求人送付は JOB_SEARCH_SEND のみ（書類として二重検出しない）",
    expect: ["JOB_SEARCH_SEND"],
    log: `話者 1 15:10 では、条件に合いそうな求人を3件ほどお送りしますね。今週中にお送りします。
話者 2 15:11 ありがとうございます。`,
  },
  // ---- 既存2種のデグレ確認 ----
  {
    id: "V-1 既存: 求人検索・送付",
    expect: ["JOB_SEARCH_SEND"],
    log: `話者 1 12:03 まずは求人のご紹介をさせていただく形なので、月曜日ぐらいまでに応募できそうな求人をピックアップして送らせていただきます。`,
  },
  {
    id: "V-2 既存: アンケート（Googleフォーム）送付",
    expect: ["FORM_SURVEY"],
    log: `話者 1 08:44 この後、書類作成用のアンケートのGoogleフォームのURLをお送りしますので、ご入力をお願いします。`,
  },
  {
    id: "V-3 3種同時（求人＋フォーム＋書類）",
    expect: ["JOB_SEARCH_SEND", "FORM_SURVEY", "DOCUMENT_SEND"],
    log: `対応事項
@エージェント（大野）：条件に合う求人を今週中にピックアップして送付する
@エージェント（大野）：書類作成用アンケートのGoogleフォームを本日中に送付する
@エージェント（大野）：職務経歴書を修正し、明日中に送付する
@求職者：気になる求人に「応募したい」を押す`,
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が未設定です");
    process.exit(1);
  }
  if (!naritaLog) {
    console.log("※ J-1（実ログ）は NARITA_LOG_PATH 未指定のためスキップします\n");
  }

  const results: { id: string; pass: boolean }[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const c of CASES) {
    const { tasks, usage } = await detect(c.log);
    totalIn += usage.input_tokens ?? 0;
    totalOut += usage.output_tokens ?? 0;

    const got = tasks.map((t) => t.kind);
    const gotDetail = tasks
      .map((t) => `${t.kind}(${t.due}→${t.dueDate}${t.detail ? `/${t.detail}` : ""}${t.docAction ? `/${t.docAction}` : ""})`)
      .join(",");

    const missing = c.expect.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !c.expect.includes(k));
    const pass = missing.length === 0 && extra.length === 0;

    results.push({ id: c.id, pass });
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${c.id}\n` +
        `        expect=[${c.expect.join(",") || "なし"}]  got=[${gotDetail || "なし"}]` +
        (pass ? "" : `\n        missing=[${missing.join(",")}] extra=[${extra.join(",")}]`),
    );
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  // 参考: Claude Sonnet 系の目安単価（$3/M in, $15/M out）。実際の単価はモデルにより異なる。
  const usd = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;
  console.log(
    `tokens: in=${totalIn} out=${totalOut} / ${CASES.length}件 = 1件あたり in≈${Math.round(totalIn / CASES.length)} out≈${Math.round(totalOut / CASES.length)}`,
  );
  console.log(`概算コスト: 合計 $${usd.toFixed(4)} / 1件あたり $${(usd / CASES.length).toFixed(4)}`);

  if (passed !== results.length) {
    console.log("FAILED: " + results.filter((r) => !r.pass).map((r) => r.id).join(" / "));
    process.exitCode = 1;
  }
}

main();
