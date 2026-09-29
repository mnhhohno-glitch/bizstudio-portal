"use client";

// T-208 step2: 初回面談の「台本モード」。面談記録画面の本体（左右2カラム）を置き換えて出す。
// - 上: 7つのパートの進み具合（押すとそのパートへ。終わったパートに ✓）。「新人向けの注意」は畳んだ状態。
// - 左: 今の場面のカード（読むセリフ・ボタン・拾う一言・入れ先・自動計算・前へ／次へ）。
// - 右: 面談準備チャット（InterviewPrepPanel を embedded で埋め込み）と、タブ「入力内容」（台本で入った欄の一覧・提案）。
// 台本の定義と実行は src/lib/interview-script/（ここは描画と答えの保持だけ）。
// 欄への反映は親（InterviewForm）が行う（onApplyWrites → 画面の state → 既存の自動保存）。サーバーで面談記録は書かない。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InterviewPrepPanel from "./InterviewPrepPanel";
import { ContactMailConfirmDialog, formatSentAt, type ContactMailStatusResponse } from "./CandidateContactMailButton";
import { SCRIPT_NOTES_FOR_BEGINNERS, SCRIPT_PARTS } from "@/lib/interview-script/script-v1";
import {
  buildContext,
  expandScenes,
  firstIndexOfPart,
  isLastOfPart,
  readMeta,
  renderScene,
  resolveNextKey,
  sceneWritesWithClears,
  writeMeta,
  type PrepSummaryLike,
  type SceneWrite,
  type WorkHistoryLike,
} from "@/lib/interview-script/runtime";
import { fieldLabelOf } from "@/lib/interview-script/field-labels";
import type { AnswerMap, AppliedMap, PartId, RuntimeScene, SceneAnswer, ScriptButton, ScriptButtonGroup } from "@/lib/interview-script/types";
import type { ContactMailType } from "@/lib/candidate-mail/templates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export type ScriptProposal = { value: string };

type Props = {
  candidateId: string;
  candidate: { name: string; email: string | null } | null;
  form: AnyRecord;
  detail: AnyRecord;
  workHistories: WorkHistoryLike[];
  answers: AnswerMap;
  applied: AppliedMap;
  proposals: Record<string, ScriptProposal>;
  /** 答えが変わった（保存は親が行う） */
  onAnswersChange: (next: AnswerMap) => void;
  /** 場面の答えから決まった書き込みを欄に反映する（入れ方の決まりは親が apply.ts で判定） */
  onApplyWrites: (writes: SceneWrite[]) => void;
  onAcceptProposal: (path: string) => void;
  onDismissProposal: (path: string) => void;
  /** 職歴の行が無いとき、登録情報の会社名で職歴を作る */
  onImportCompanies: (names: string[]) => void;
  /** 「入力内容」タブに出す、いまの欄の値（パス → 値） */
  currentValueOf: (path: string) => string;
};

type PrepStateLike = {
  room: { summaryJson: PrepSummaryLike; askedQuestions: Record<string, unknown> | null } | null;
};

const BTN_BASE: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--im-bdr2)",
  background: "var(--im-bg)",
  color: "var(--im-fg)",
  fontFamily: "inherit",
  cursor: "pointer",
  lineHeight: 1.4,
  textAlign: "left",
};
const BTN_ON: React.CSSProperties = {
  ...BTN_BASE,
  border: "1px solid var(--im-bdr-info)",
  background: "var(--im-bg-info)",
  color: "var(--im-fg-info)",
  fontWeight: 600,
};

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-3">
      {paras.map((p, i) => {
        const aside = p.startsWith("（");
        return (
          <p key={i} style={{ fontSize: aside ? 13 : 15, lineHeight: 1.9, color: aside ? "var(--im-fg2)" : "var(--im-fg)", whiteSpace: "pre-wrap" }}>
            {p}
          </p>
        );
      })}
    </div>
  );
}

export default function InterviewScriptMode({
  candidateId,
  candidate,
  form,
  detail,
  workHistories,
  answers,
  applied,
  proposals,
  onAnswersChange,
  onApplyWrites,
  onAcceptProposal,
  onDismissProposal,
  onImportCompanies,
  currentValueOf,
}: Props) {
  const [prep, setPrep] = useState<PrepStateLike | null>(null);
  const [mail, setMail] = useState<ContactMailStatusResponse | null>(null);
  const [mailDialog, setMailDialog] = useState<ContactMailType | null>(null);
  const [rightTab, setRightTab] = useState<"prep" | "inputs">("prep");
  const [inputsUpdated, setInputsUpdated] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // 入力欄の途中の文字（欄への反映は blur / Enter のとき）
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});

  const fetchPrep = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interview-prep`);
      if (!res.ok) return;
      setPrep((await res.json()) as PrepStateLike);
    } catch {
      /* silent */
    }
  }, [candidateId]);
  const fetchMail = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-mail`);
      if (!res.ok) return;
      setMail((await res.json()) as ContactMailStatusResponse);
    } catch {
      /* silent */
    }
  }, [candidateId]);
  // 開いたときの読み込み（setState は fetch の then の中＝React Compiler 系 lint の「effect 内で同期 setState」に当たらない形）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/candidates/${candidateId}/interview-prep`)
      .then((r) => (r.ok ? (r.json() as Promise<PrepStateLike>) : null))
      .then((data) => {
        if (!cancelled && data) setPrep(data);
      })
      .catch(() => {});
    fetch(`/api/candidates/${candidateId}/contact-mail`)
      .then((r) => (r.ok ? (r.json() as Promise<ContactMailStatusResponse>) : null))
      .then((data) => {
        if (!cancelled && data) setMail(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  const ctx = useMemo(
    () =>
      buildContext({
        candidateName: candidate?.name ?? "",
        candidateEmail: candidate?.email ?? null,
        caName: mail?.sender.name ?? "",
        caFamilyName: mail?.sender.familyName ?? "",
        startTime: typeof form.startTime === "string" ? form.startTime : "",
        tool: typeof form.interviewTool === "string" ? form.interviewTool : "",
        detail,
        workHistories,
        prepSummary: prep?.room?.summaryJson ?? null,
        askedQuestions: prep?.room?.askedQuestions ?? {},
      }),
    [candidate, mail, form.startTime, form.interviewTool, detail, workHistories, prep],
  );

  const scenes = useMemo(() => expandScenes(ctx, answers), [ctx, answers]);
  const meta = readMeta(answers);
  const currentIndex = Math.max(0, scenes.findIndex((s) => s.key === meta.currentKey));
  const rs: RuntimeScene | undefined = scenes[currentIndex];
  const doneParts = new Set<PartId>(meta.doneParts ?? []);

  const setMeta = (patch: { currentKey?: string; doneParts?: PartId[] }) => {
    onAnswersChange(writeMeta(answers, { ...meta, ...patch }));
  };

  const goTo = (index: number) => {
    const target = scenes[Math.max(0, Math.min(index, scenes.length - 1))];
    if (!target) return;
    const nextDone = new Set(doneParts);
    if (rs && index > currentIndex) {
      // 今のパートを通り過ぎたら ✓
      if (isLastOfPart(scenes, currentIndex) || target.scene.part !== rs.scene.part) nextDone.add(rs.scene.part);
    }
    setMeta({ currentKey: target.key, doneParts: [...nextDone] });
    setDraftInputs({});
  };

  const sceneAnswer: SceneAnswer = (rs && answers[rs.key]) || {};

  // 答えを更新して、欄への書き込みを親に渡す
  const commitSceneAnswer = (nextSa: SceneAnswer) => {
    if (!rs) return;
    const nextAnswers: AnswerMap = { ...answers, [rs.key]: { ...nextSa, at: new Date().toISOString() } };
    onAnswersChange(nextAnswers);
    onApplyWrites(sceneWritesWithClears(rs, nextSa));
    if (rightTab !== "inputs") setInputsUpdated(true);
  };

  const pressButton = (group: ScriptButtonGroup, btn: ScriptButton) => {
    const choices = { ...(sceneAnswer.choices ?? {}) };
    if (group.multi) {
      const cur = Array.isArray(choices[group.key]) ? (choices[group.key] as string[]) : [];
      if (btn.label === "特になし") {
        choices[group.key] = cur.includes("特になし") ? [] : ["特になし"];
      } else {
        const without = cur.filter((v) => v !== "特になし");
        choices[group.key] = without.includes(btn.label) ? without.filter((v) => v !== btn.label) : [...without, btn.label];
      }
    } else {
      choices[group.key] = choices[group.key] === btn.label ? "" : btn.label;
      if (!choices[group.key]) delete choices[group.key];
    }
    commitSceneAnswer({ ...sceneAnswer, choices });
  };

  const commitInput = (key: string, value: string) => {
    const inputs = { ...(sceneAnswer.inputs ?? {}) };
    if (value.trim()) inputs[key] = value;
    else delete inputs[key];
    if ((sceneAnswer.inputs?.[key] ?? "") === (inputs[key] ?? "")) return;
    commitSceneAnswer({ ...sceneAnswer, inputs });
  };

  const chosenNext = (() => {
    if (!rs) return undefined;
    for (const g of rs.scene.groups ?? []) {
      const v = sceneAnswer.choices?.[g.key];
      if (typeof v !== "string") continue;
      const b = g.buttons.find((x) => x.label === v);
      if (b?.next) return b.next;
    }
    return undefined;
  })();

  const say = rs ? renderScene(rs, ctx, answers) : "";
  const calcLines = rs?.scene.calc ? rs.scene.calc(sceneAnswer, { ...ctx, companyIndex: rs.companyIndex }, answers) : [];
  const pickups: string[] = [];
  if (rs) {
    for (const g of rs.scene.groups ?? []) {
      if (g.showIf && !g.showIf(sceneAnswer)) continue;
      const v = sceneAnswer.choices?.[g.key];
      const list = Array.isArray(v) ? v : v ? [v] : [];
      for (const label of list) {
        const b = g.buttons.find((x) => x.label === label);
        if (b?.pickup) pickups.push(b.pickup);
      }
    }
    const dyn = rs.scene.pickup?.(sceneAnswer, { ...ctx, companyIndex: rs.companyIndex }, answers);
    if (dyn) pickups.push(dyn);
  }

  const company = rs?.companyIndex != null ? ctx.companies[rs.companyIndex] : undefined;
  const allPlaceholder = ctx.companies.length > 0 && ctx.companies.every((c) => c.placeholder);
  const prepCompanyNames = ctx.companies.filter((c) => c.placeholder && c.name).map((c) => c.name);

  const appliedEntries = Object.entries(applied);
  const proposalEntries = Object.entries(proposals);
  const inputsRef = useRef<HTMLDivElement>(null);

  // ---- 右: 入力内容タブ ----
  const inputsTab = (
    <div ref={inputsRef} className="p-4 overflow-y-auto h-full" style={{ fontSize: 13 }}>
      {proposalEntries.length > 0 && (
        <div className="mb-4">
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--im-fg-warn)", marginBottom: 6 }}>すでに値がある欄（台本の答えに替えますか？）</div>
          <div className="space-y-1.5">
            {proposalEntries.map(([path, p]) => (
              <div key={path} className="rounded-md px-3 py-2 flex items-center gap-2" style={{ background: "var(--im-bg-warn)", border: "0.5px solid #f0d9b5" }}>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 12, color: "var(--im-fg2)" }}>{fieldLabelOf(path)}</div>
                  <div className="truncate" style={{ fontSize: 12 }}>
                    いま: {currentValueOf(path) || "-"} → 台本の答え: <b>{p.value}</b>
                  </div>
                </div>
                <button type="button" onClick={() => onAcceptProposal(path)} style={{ ...BTN_BASE, padding: "4px 10px", fontSize: 12 }}>
                  替える
                </button>
                <button type="button" onClick={() => onDismissProposal(path)} style={{ ...BTN_BASE, padding: "4px 10px", fontSize: 12, color: "var(--im-fg3)" }}>
                  そのまま
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--im-fg2)", marginBottom: 6 }}>台本で入った欄（{appliedEntries.length}件）</div>
      {appliedEntries.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--im-fg3)" }}>まだありません。左のボタンや入力で欄に入ります。</p>
      ) : (
        <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {appliedEntries.map(([key, val]) => {
              const path = key.split("@")[0];
              const cur = currentValueOf(path);
              const stillScript = path.startsWith("ws.") ? true : cur.includes(val);
              return (
                <tr key={key} style={{ borderBottom: "0.5px solid var(--im-bdr)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--im-fg2)", whiteSpace: "nowrap", verticalAlign: "top", width: 130 }}>{fieldLabelOf(path)}</td>
                  <td style={{ padding: "5px 6px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {path.startsWith("ws.") ? "チェック" : val}
                    {!stillScript && <span className="ml-1" style={{ fontSize: 10, color: "var(--im-fg-warn)" }}>（CAが変更）</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  // ---- 左: 場面カード ----
  const visibleGroups = (rs?.scene.groups ?? []).filter((g) => !g.showIf || g.showIf(sceneAnswer));
  const visibleInputs = (rs?.scene.inputs ?? []).filter((i) => !i.showIf || i.showIf(sceneAnswer));
  const partOf = rs ? SCRIPT_PARTS.find((p) => p.id === rs.scene.part) : undefined;

  return (
    <div className="flex flex-col" style={{ background: "var(--im-bg)" }}>
      {/* 上: パートの進み具合 */}
      <div className="flex items-center gap-1 px-4 py-2 overflow-x-auto" style={{ borderBottom: "0.5px solid var(--im-bdr)" }}>
        {SCRIPT_PARTS.map((p) => {
          const active = rs?.scene.part === p.id;
          const done = doneParts.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => goTo(firstIndexOfPart(scenes, p.id))}
              className="whitespace-nowrap"
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 12,
                border: active ? "1px solid var(--im-bdr-info)" : "0.5px solid var(--im-bdr)",
                background: active ? "var(--im-bg-info)" : done ? "var(--im-bg-ok)" : "transparent",
                color: active ? "var(--im-fg-info)" : done ? "var(--im-fg-ok)" : "var(--im-fg2)",
                fontWeight: active ? 600 : 400,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {done ? "✓ " : ""}{p.no}. {p.title}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="ml-auto whitespace-nowrap"
          style={{ fontSize: 11, color: "var(--im-fg2)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
        >
          {notesOpen ? "▾" : "▸"} 新人向けの注意
        </button>
      </div>
      {notesOpen && (
        <ul className="px-6 py-2 space-y-1" style={{ fontSize: 12, color: "var(--im-fg2)", background: "var(--im-bg2)", borderBottom: "0.5px solid var(--im-bdr)", listStyle: "disc", paddingLeft: 32 }}>
          {SCRIPT_NOTES_FOR_BEGINNERS.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        {/* 左: 今の場面 */}
        <div className="p-5" style={{ borderRight: "0.5px solid var(--im-bdr)", minHeight: 640 }}>
          {rs && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 11, color: "var(--im-fg3)" }}>
                  {partOf?.no}. {partOf?.title}　場面 {currentIndex + 1} / {scenes.length}
                </span>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                {rs.scene.title}
                {company && rs.scene.repeat === "company" && (
                  <span className="ml-2" style={{ fontSize: 12, fontWeight: 400, color: "var(--im-fg2)" }}>
                    {rs.companyIndex! + 1}社目{company.name ? `：${company.name}` : ""}
                    {company.placeholder && "（職歴の行なし）"}
                  </span>
                )}
              </h3>

              {rs.scene.kind !== "prep-questions" && (
                <div className="rounded-lg px-4 py-3 mb-4" style={{ background: "var(--im-bg2)", borderLeft: "3px solid var(--im-fg-info)" }}>
                  <Paragraphs text={say} />
                </div>
              )}

              {rs.scene.repeat === "company" && allPlaceholder && (
                <div className="rounded-md px-3 py-2 mb-3" style={{ background: "var(--im-bg-warn)", fontSize: 12, color: "var(--im-fg-warn)" }}>
                  職務経歴の行がまだ無いので、答えを欄に入れられません。
                  {prepCompanyNames.length > 0 ? (
                    <button type="button" onClick={() => onImportCompanies(prepCompanyNames)} className="ml-2 underline" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "var(--im-fg-warn)", fontSize: 12 }}>
                      登録情報の職歴を取り込む（{prepCompanyNames.length}社）
                    </button>
                  ) : (
                    <span className="ml-1">いつもの入力画面で「＋ 職歴を追加」を押してから戻ってください。</span>
                  )}
                </div>
              )}

              {rs.scene.kind === "prep-questions" && (
                <div className="mb-4">
                  <p style={{ fontSize: 13, color: "var(--im-fg2)", marginBottom: 8 }}>{say}</p>
                  {ctx.prepQuestions.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--im-fg3)" }}>面談準備の整理がまだありません（右の面談準備で「面談準備を作る」）。</p>
                  ) : (
                    <ol className="space-y-2" style={{ paddingLeft: 0, listStyle: "none" }}>
                      {ctx.prepQuestions.map((q, i) => (
                        <li key={i} className="rounded-md px-3 py-2" style={{ border: "0.5px solid var(--im-bdr)", opacity: q.asked ? 0.55 : 1, background: "var(--im-bg)" }}>
                          <div className="flex items-start gap-2">
                            <span style={{ fontSize: 11, color: "var(--im-fg3)", marginTop: 3 }}>Q{i + 1}</span>
                            {q.mismatch && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#fef3c7", color: "#92400e", marginTop: 3 }}>食い違い</span>}
                            <span className="flex-1" style={{ fontSize: 14, lineHeight: 1.7 }}>{q.question}</span>
                            {q.asked && <span style={{ fontSize: 11, color: "var(--im-fg-ok)" }}>✓ 聞いた</span>}
                          </div>
                          {q.why && <div style={{ fontSize: 11, color: "var(--im-fg3)", marginTop: 2, paddingLeft: 24 }}>なぜ: {q.why}</div>}
                        </li>
                      ))}
                    </ol>
                  )}
                  <button type="button" onClick={() => void fetchPrep()} className="mt-2" style={{ fontSize: 11, color: "var(--im-fg-info)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                    ↻ 面談準備から読み直す
                  </button>
                </div>
              )}

              {/* 入力 */}
              {visibleInputs.length > 0 && (
                <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                  {visibleInputs.map((inp) => {
                    const val = draftInputs[inp.key] ?? sceneAnswer.inputs?.[inp.key] ?? "";
                    return (
                      <label key={inp.key} className="flex flex-col gap-1" style={{ fontSize: 12, color: "var(--im-fg2)" }}>
                        <span>{inp.label}</span>
                        <span className="flex items-center gap-1">
                          <input
                            type={inp.type === "number" ? "number" : inp.type === "date" ? "date" : inp.type === "time" ? "time" : inp.type === "month" ? "month" : "text"}
                            value={val}
                            placeholder={inp.placeholder}
                            onChange={(e) => setDraftInputs((p) => ({ ...p, [inp.key]: e.target.value }))}
                            onBlur={(e) => commitInput(inp.key, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.currentTarget as HTMLInputElement).blur();
                            }}
                            style={{ flex: 1, minWidth: 0, fontSize: 14, padding: "7px 10px", borderRadius: 6, border: "0.5px solid var(--im-bdr2)", background: "var(--im-bg)", color: "var(--im-fg)", fontFamily: "inherit" }}
                          />
                          {inp.unit && <span style={{ fontSize: 12, color: "var(--im-fg3)" }}>{inp.unit}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* ボタン */}
              {visibleGroups.map((g) => {
                const chosen = sceneAnswer.choices?.[g.key];
                const chosenList = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
                const buttons = g.buttons.filter((b) => !b.showIf || b.showIf(sceneAnswer));
                if (buttons.length === 0) return null;
                return (
                  <div key={g.key} className="mb-4">
                    {g.label && <div style={{ fontSize: 12, color: "var(--im-fg2)", marginBottom: 6 }}>{g.label}</div>}
                    <div className="flex flex-wrap gap-2">
                      {buttons.map((b) => {
                        const on = chosenList.includes(b.label);
                        return (
                          <button key={b.label} type="button" onClick={() => pressButton(g, b)} style={on ? BTN_ON : BTN_BASE}>
                            {on ? "● " : ""}{b.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* 連絡方法: 案内メールの確認画面を開く */}
              {rs.scene.kind === "contact" && (
                <div className="mb-4 rounded-md px-3 py-2" style={{ border: "0.5px solid var(--im-bdr)", fontSize: 12 }}>
                  {(["line", "greeting"] as ContactMailType[]).map((t) => {
                    const item = mail?.items[t];
                    const label = t === "line" ? "LINE登録案内" : "あいさつメール";
                    const chosenMethod = sceneAnswer.choices?.method;
                    const highlight = (t === "line" && chosenMethod === "LINE") || (t === "greeting" && chosenMethod === "メール");
                    return (
                      <div key={t} className="flex items-center gap-2 py-1">
                        <button
                          type="button"
                          disabled={!item?.canSend}
                          onClick={() => setMailDialog(t)}
                          style={{ ...(highlight ? BTN_ON : BTN_BASE), padding: "6px 12px", fontSize: 13, opacity: item?.canSend ? 1 : 0.5, cursor: item?.canSend ? "pointer" : "not-allowed" }}
                        >
                          {label}の確認画面を開く
                        </button>
                        {item?.lastSentAt ? (
                          <span style={{ color: "var(--im-fg-ok)" }}>送信済み（{formatSentAt(item.lastSentAt)}）</span>
                        ) : item && !item.canSend ? (
                          <span style={{ color: "var(--im-fg-warn)" }}>{item.reason}</span>
                        ) : null}
                      </div>
                    );
                  })}
                  {!mail && <span style={{ color: "var(--im-fg3)" }}>送信状況を確認中...</span>}
                </div>
              )}

              {/* 拾う一言 */}
              {pickups.length > 0 && (
                <div className="rounded-lg px-4 py-3 mb-4" style={{ background: "var(--im-bg-ok)", borderLeft: "3px solid var(--im-fg-ok)" }}>
                  <div style={{ fontSize: 11, color: "var(--im-fg-ok)", fontWeight: 600, marginBottom: 4 }}>拾う一言</div>
                  {pickups.map((p, i) => (
                    <p key={i} style={{ fontSize: 15, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
                      {p}
                    </p>
                  ))}
                </div>
              )}

              {/* 自動計算 */}
              {calcLines.length > 0 && (
                <div className="rounded-lg px-4 py-3 mb-4" style={{ background: "var(--im-bg-info)" }}>
                  <div style={{ fontSize: 11, color: "var(--im-fg-info)", fontWeight: 600, marginBottom: 4 }}>自動計算</div>
                  {calcLines.map((l) => (
                    <div key={l} style={{ fontSize: 14, lineHeight: 1.8 }}>
                      {l}
                    </div>
                  ))}
                </div>
              )}

              {rs.scene.notes && rs.scene.notes.length > 0 && (
                <ul className="mb-4" style={{ fontSize: 12, color: "var(--im-fg2)", paddingLeft: 18, listStyle: "disc" }}>
                  {rs.scene.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}

              {rs.scene.targetsHint && (
                <div style={{ fontSize: 11, color: "var(--im-fg3)", marginBottom: 16 }}>入れ先: {rs.scene.targetsHint}</div>
              )}

              <div className="flex items-center gap-2 pt-3" style={{ borderTop: "0.5px solid var(--im-bdr)" }}>
                <button type="button" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0} style={{ ...BTN_BASE, opacity: currentIndex === 0 ? 0.4 : 1 }}>
                  ← 前へ
                </button>
                <div className="flex-1" />
                {rs.scene.skippable && (
                  <button type="button" onClick={() => goTo(resolveNextKey(scenes, currentIndex))} style={{ ...BTN_BASE, color: "var(--im-fg2)" }}>
                    飛ばす
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goTo(resolveNextKey(scenes, currentIndex, chosenNext))}
                  disabled={currentIndex >= scenes.length - 1}
                  style={{ ...BTN_ON, opacity: currentIndex >= scenes.length - 1 ? 0.4 : 1 }}
                >
                  次へ →
                </button>
              </div>
            </>
          )}
        </div>

        {/* 右: 面談準備／入力内容 */}
        <div className="flex flex-col" style={{ position: "sticky", top: 0, alignSelf: "start", height: "calc(100vh - 120px)", minHeight: 480 }}>
          <div className="flex shrink-0" style={{ borderBottom: "0.5px solid var(--im-bdr)" }}>
            {([
              { id: "prep", label: "面談準備" },
              { id: "inputs", label: "入力内容" },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setRightTab(t.id);
                  if (t.id === "inputs") setInputsUpdated(false);
                }}
                style={{
                  padding: "9px 14px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: rightTab === t.id ? "var(--im-fg)" : "var(--im-fg2)",
                  fontWeight: rightTab === t.id ? 500 : 400,
                  borderBottom: rightTab === t.id ? "2px solid var(--im-fg-info)" : "2px solid transparent",
                }}
              >
                {t.label}
                {t.id === "inputs" && (inputsUpdated || proposalEntries.length > 0) && (
                  <span className="ml-1 rounded-full px-1.5" style={{ fontSize: 10, background: proposalEntries.length > 0 ? "var(--im-bg-warn)" : "var(--im-bg-info)", color: proposalEntries.length > 0 ? "var(--im-fg-warn)" : "var(--im-fg-info)" }}>
                    {proposalEntries.length > 0 ? `確認${proposalEntries.length}` : "更新"}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0" style={{ display: rightTab === "prep" ? "block" : "none" }}>
            <InterviewPrepPanel candidateId={candidateId} open onClose={() => {}} embedded />
          </div>
          {rightTab === "inputs" && <div className="flex-1 min-h-0 overflow-hidden">{inputsTab}</div>}
        </div>
      </div>

      {mailDialog && (
        <ContactMailConfirmDialog
          candidateId={candidateId}
          type={mailDialog}
          onClose={() => setMailDialog(null)}
          onSent={() => void fetchMail()}
        />
      )}
    </div>
  );
}
