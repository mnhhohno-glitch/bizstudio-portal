// T-151 Phase 2-3 の検出精度検証。読み取り専用（DB書き込み・タスク起票は一切しない）。
//
// 実行: npx tsx scripts/test_t151_detection.ts
// 必要: ANTHROPIC_API_KEY
//
// ケースは docs/survey_T-151_interview_task_phase1.md の実ログ引用（本番の面談ログから採取・伏字済み）。
//  J-1〜J-5 = JOB_SEARCH_SEND を検出すべき
//  F-1〜F-5 = FORM_SURVEY を検出すべき
//  N-1〜N-6 = 何も検出してはいけない（紛らわしい非約束）
//
// 合格条件: expect に挙げた kind をすべて含み、それ以外の kind を1つも含まないこと。
//
// ★DB書き込みを避けるため recordAdvisorUsage を経由しない。本番と同じ
//   INTERVIEW_TASK_DETECTION_PROMPT（実物をimport）と parseDetectionOutput（実物）を使い、
//   Anthropic 呼び出しだけこのスクリプト内で行う。検出精度を決めるのはこの2つ。

import {
  INTERVIEW_TASK_DETECTION_PROMPT,
  parseDetectionOutput,
} from "../src/lib/interview/detect-suggested-tasks";
import { CLAUDE_MODEL_DEFAULT } from "../src/lib/claude";
import type { SuggestedTask } from "../src/lib/advisor/suggested-tasks";

async function detect(interviewLog: string): Promise<SuggestedTask[]> {
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
  return parseDetectionOutput(data.content?.[0]?.text ?? "");
}

type Case = {
  id: string;
  expect: ("JOB_SEARCH_SEND" | "FORM_SURVEY")[];
  log: string;
};

const CASES: Case[] = [
  {
    id: "J-1 初回面談/Notta生/月曜日ぐらいまでに",
    expect: ["JOB_SEARCH_SEND"],
    log: `話者 1 12:03 では、えっと、ちょっと今後の進め方のところですね。えっと、まずは求人のご紹介をさせていただくという形なので、月曜日ぐらいまでに行ったあのエリアですね。あのエリアも含めて、あの応募できそうな求人をピックアップして、えっと送らせていただくという形で、えっと、よろしいでしょうか。
話者 2 12:31 はい、お願いします。`,
  },
  {
    id: "J-2 初回面談/AI要約アクション節/週明け月曜日",
    expect: ["JOB_SEARCH_SEND", "FORM_SURVEY"],
    log: `キャリア相談 - 初回面談のまとめ
候補者プロフィール
氏名： 小林 ○○ 様
現職： 販売職（3年目）

次のステップ
@エージェント（○○）：求人を検索し、週明け月曜日にマイページURLとピックアップ求人（約20件）をLINEで送付する
@エージェント（○○）：履歴書・職務経歴書作成のためのGoogleフォームを週明け月曜日に送付する
@小林さん：Googleフォームに高校情報などの追加情報を入力する`,
  },
  {
    id: "J-3 初回面談/AI要約アクション節/今週中",
    expect: ["JOB_SEARCH_SEND"],
    log: `キャリア相談概要 - 初回セッション
候補者プロフィール
氏名： 吉川 ○○ 様

対応事項
@○○氏：倉庫系・事務系・その他求人を今週中にピックアップし、マイページに掲載する
@○○氏：マイナビ登録情報をベースに、履歴書・職務経歴書の草案を作成する`,
  },
  {
    id: "J-4 初回面談/AI要約アクション節/今週中+週明け月曜日",
    expect: ["JOB_SEARCH_SEND"],
    log: `キャリア相談 – 初回面談のまとめ
候補者プロフィール
氏名： 清水 ○○ 様
最終学歴： 短期大学（2024年卒）

対応事項
@○○（担当者）：今週中に長崎エリアの事務系求人を検索し、週明け月曜日までに求人マイページへピックアップ求人を掲載・案内する
@○○（担当者）：求人が見つからない場合は隣県も対象に広げる`,
  },
  {
    id: "J-5 2回目面談/AI要約アクション節/来週火〜水曜日までに",
    expect: ["JOB_SEARCH_SEND"],
    log: `プロジェクト同期／状況更新の概要
求人状況の確認
松山エリア：条件に合う求人がほとんどなく、事務系職種・年収水準の観点では現職の方が条件が良い可能性が高い。

対応事項
担当者：来週火〜水曜日までに、ルート営業・既存顧客向け営業を中心とした追加求人をマイページにアップする。
担当者：週明けにLINEで○○さんへ連絡する。
@○○さん：8月2日以降に求人を確認する。`,
  },
  {
    id: "F-1 初回面談/Notta生/また後日",
    expect: ["FORM_SURVEY"],
    log: `話者 1 26:10 はい、そしたら、あのまた後日ですね。あのGoogleフォームっていうアンケートがありまして、あのアンケートのURLをまた後日送らせていただくので、そこでですね、ちょっとポチポチ、あの質問に答えていっていただくと、こちら側に情報が飛んできてで、その情報と、今、マイナビに登録していただいている情報を合わせて、履歴書と職務経歴書のたたき台を作れるんですよ。
話者 2 26:40 はい、わかりました。`,
  },
  {
    id: "F-2 初回面談/AI要約アクション節/週明け月曜日",
    expect: ["FORM_SURVEY"],
    log: `初回面談のまとめ
連絡手段： LINEに決定（登録完了済み）

次のステップ
@エージェント（○○）：履歴書・職務経歴書作成のためのGoogleフォームを週明け月曜日に送付する
@エージェント（○○）：8月4日（火）20:00に次回電話面談を実施する`,
  },
  {
    id: "F-3 2回目面談/Notta生/また後で",
    expect: ["FORM_SURVEY"],
    log: `話者 1 46:20 はい、そしたら、えっと、まずえっと書類を作る準備を私のでしていくんで、えっと、また後であのラインの方で、えっと、Googleフォームっていうものがあるんですけど、あのアンケートみたいなんですね。あのそのURLを送らせていただくので、そこにこう回答していただくと、あの履歴書を埋めるための必要な情報をいろいろと書き出しができるんですよ。
話者 2 46:55 はい。`,
  },
  {
    id: "F-4 既存面談/Notta生/今日この後",
    expect: ["FORM_SURVEY"],
    log: `話者 1 07:30 2つ目は、あの私、今日この後、えっと、履歴書の雛形をお送りしますので、そちらにご記入いただいて、えっとお戻しくださいというところと、私はこの職務経歴書専用のアンケートフォームをお送りしますので、こちら、あの就業時間あるときに埋めていただければと思います。
話者 2 07:55 はい、わかりました。`,
  },
  {
    id: "F-5 2回目面談/AI要約アクション節/今週中",
    expect: ["FORM_SURVEY"],
    log: `プロジェクト同期のまとめ
@○○さん：履歴書・職務経歴書作成のための質問票に回答する（回答後、営業日以内に書類を作成予定）。
@○○さん：今週日曜日の簿記試験に集中して臨む。
@担当者（話者 1）：履歴書・職務経歴書の質問票を今週中に送付する。`,
  },
  {
    id: "N-1 サービス説明の定型・否定文脈",
    expect: [],
    log: `話者 1 00:02 はい、大丈夫ですね。はい、すいません。それでいえば、改めまして、あのマイナビのスカウトの方からですね、ご応募いただきましてありがとうございます。はい、本日初回面談という形になりまして、あのお仕事の直接的なご紹介というよりはですね、あのこれまでの○○様のご経歴であったりとか、あの今後やりたい仕事っていったところですね。いろいろとヒアリングさせていただければと思いますので。
話者 2 00:40 はい、よろしくお願いします。`,
  },
  {
    id: "N-2 LINE登録確認のメール送信（最頻出の誤検出源）",
    expect: [],
    log: `話者 1 30:40 こちらにですね、ラインのご登録案内、株式会社ビズスタジオの○○ですという件名で、今メールを送らせていただきましたので、メールが届きましたら教えていただけますか？
話者 2 30:58 はい、わかりました。はい。
話者 1 31:05 はい、今来ました。はい、ありがとうございます。
話者 2 31:25 で友達追加、はい。
話者 1 31:27 あ、できました。ありがとうございます。はい、ちょっと確認でメッセージ1通だけ送らせていただきますね。
話者 2 31:34 は？
話者 1 31:35 はいはい、疎通確認取れました。ありがとうございます。`,
  },
  {
    id: "N-3 求職者側のアクション行のみ",
    expect: [],
    log: `面談のまとめ
対応事項
@○○さん：Googleフォームに高校情報などの追加情報を入力する
@○○さん：8月2日以降に履歴書・職務経歴書（Googleフォーム）を記入・返送する
@○○さん：マイページに届く参考求人を確認し、気になるものをピックアップする`,
  },
  {
    id: "N-4 サービス内容の一般説明",
    expect: [],
    log: `話者 1 02:10 具体的にはやらせていただくことは細かいところを含めますとかなりたくさんあるんですが、大きく分けますと三つにわかれます。まず一つ目というのが応募先の選定というところで、求人のご紹介というところはもちろんなんですけれども、キャリアプランニングといってですね、自分が何をやりたいのかとか、この先どういうキャリアを積んでいきたいのかっていう。二つ目が書類作成サポート、三つ目が面接対策になります。
話者 2 02:50 なるほど。`,
  },
  {
    id: "N-5 固定2種以外のCA側アクション",
    expect: [],
    log: `初回面談のまとめ
次回面談： 7月25日（土）10:00

対応事項
@エージェント：次回面談（7月25日10:00）に向けて、業種・職種説明資料を準備する
@エージェント：8月7日（水）21時の面談をカレンダーに確保する
@エージェント：マイナビ登録情報をもとに履歴書・職務経歴書の叩き台を作成する`,
  },
  {
    id: "N-6 過去に完了した紹介への言及",
    expect: [],
    log: `話者 1 02:15 前回、私がご紹介させていただいた求人が9件ですね。並んでいるかなと思うんですので、これじゃあ、すべて1通りちょっと応募したいの方に、私の方で進めさせていただきますので、あの追加した求人も、こちらの方にあのピックアップされて表示されるようになります。
話者 2 02:45 はい、ありがとうございます。`,
  },
];

async function main() {
  const results: { id: string; expect: string[]; got: string[]; pass: boolean }[] = [];

  for (const c of CASES) {
    const tasks = await detect(c.log);
    const got = tasks.map((t) => t.kind);
    const gotDetail = tasks.map((t) => `${t.kind}(${t.due}→${t.dueDate})`);

    const missing = c.expect.filter((k) => !got.includes(k));
    // 非約束ケース(expect=[])は何も出してはいけない。約束ケースは expect 以外が出ても許容しない。
    const extra = got.filter((k) => !c.expect.includes(k));
    const pass = missing.length === 0 && extra.length === 0;

    results.push({ id: c.id, expect: c.expect, got, pass });
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${c.id}\n` +
        `        expect=[${c.expect.join(",") || "なし"}]  got=[${gotDetail.join(",") || "なし"}]` +
        (pass ? "" : `\n        missing=[${missing.join(",")}] extra=[${extra.join(",")}]`),
    );
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  if (passed !== results.length) {
    console.log("FAILED: " + results.filter((r) => !r.pass).map((r) => r.id).join(" / "));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
