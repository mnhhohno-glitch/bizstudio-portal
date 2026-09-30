// T-208 step3（付録G）: 台本の答え（interview_script_answers.answers）を、面談準備チャットに添える文にする（純粋関数）。
//
// - 書式は決まった形: 見出し「【面談スクリプトで分かったこと】」（T-208 step4 で「台本」から改名）の下に、1行に「場面名: 値」。答えのある場面だけ出す（無ければ空文字）。
// - 会社ごとの場面は「場面名（会社名）」（会社名が無ければ「N社目」）。
// - 値は押したボタンの表示名と入力した文字を「／」でつなぐ。今の答えで見えないグループ・ボタン・入力（showIf）は入れない。
// - チャット API は withScriptFacts で「今回の質問の先頭にだけ」付けて AI に送る。system と過去の履歴には入れない（キャッシュを壊さない・罠#39）。
//   保存する CA の発言は画面に打った文だけ（添えた部分は保存しない）。

import { SCRIPT_SCENES } from "./script-v1";
import { isSceneAnswered } from "./runtime";
import type { AnswerMap, SceneAnswer, ScriptScene } from "./types";

export const SCRIPT_FACTS_HEADER = "【面談スクリプトで分かったこと】";

/** 1つの場面の答えを「値」の文にする（見えているグループ・入力だけ）。答えが無ければ "" */
export function sceneFactValue(scene: ScriptScene, sa: SceneAnswer): string {
  const parts: string[] = [];
  for (const g of scene.groups ?? []) {
    if (g.showIf && !g.showIf(sa)) continue;
    const chosen = sa.choices?.[g.key];
    const list = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
    const labels = list.filter((label) => {
      const b = g.buttons.find((x) => x.label === label);
      return !!b && (!b.showIf || b.showIf(sa));
    });
    if (labels.length === 0) continue;
    parts.push(g.label ? `${g.label}: ${labels.join("、")}` : labels.join("、"));
  }
  for (const inp of scene.inputs ?? []) {
    if (inp.showIf && !inp.showIf(sa)) continue;
    const v = (sa.inputs?.[inp.key] ?? "").trim();
    if (!v) continue;
    parts.push(`${inp.label}: ${v}${inp.unit ? inp.unit : ""}`);
  }
  return parts.join("／");
}

/**
 * 「場面名: 値」の行を台本の順に作る。companyNames は会社番号順の会社名（無い番号は「N社目」）。
 */
export function scriptFactLines(answers: AnswerMap, companyNames: ReadonlyArray<string> = []): string[] {
  const lines: string[] = [];
  for (const scene of SCRIPT_SCENES) {
    if (scene.repeat === "company") {
      const prefix = `${scene.id}#`;
      const indexes = Object.keys(answers)
        .filter((k) => k.startsWith(prefix))
        .map((k) => Number(k.slice(prefix.length)))
        .filter((n) => Number.isInteger(n) && n >= 0)
        .sort((a, b) => a - b);
      for (const n of indexes) {
        const sa = answers[`${scene.id}#${n}`];
        if (!isSceneAnswered(sa)) continue;
        const value = sceneFactValue(scene, sa);
        if (!value) continue;
        const name = (companyNames[n] ?? "").trim() || `${n + 1}社目`;
        lines.push(`${scene.title}（${name}）: ${value}`);
      }
    } else {
      const sa = answers[scene.id];
      if (!isSceneAnswered(sa)) continue;
      const value = sceneFactValue(scene, sa);
      if (!value) continue;
      lines.push(`${scene.title}: ${value}`);
    }
  }
  return lines;
}

/** 添える文（見出し＋行）。答えのある項目が1つも無ければ "" */
export function formatScriptFacts(answers: AnswerMap | null | undefined, companyNames: ReadonlyArray<string> = []): string {
  if (!answers) return "";
  const lines = scriptFactLines(answers, companyNames);
  if (lines.length === 0) return "";
  return [SCRIPT_FACTS_HEADER, ...lines].join("\n");
}

/** AI に送る今回の質問（添える文があれば先頭に付ける）。保存には使わない */
export function withScriptFacts(question: string, facts: string): string {
  return facts ? `${facts}\n\n${question}` : question;
}
