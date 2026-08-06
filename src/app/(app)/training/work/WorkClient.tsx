"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import type { AnswerKey, FieldLabel } from "@/lib/training-work";
import { ANSWER_KEYS } from "@/lib/training-work";

type WorkItem = {
  id: string;
  itemCode: string;
  sortOrder: number;
  title: string;
  jobContent: string;
  hintNote: string | null;
};

type SavedAnswer = {
  itemCode: string;
  answerCompany: string;
  answerHelp: string;
  answerDay: string;
  answerUnknown: string;
  updatedAt: string;
};

type WorkSet = {
  workKey: string;
  title: string;
  description: string;
  fieldLabels: FieldLabel[];
};

type Draft = Record<AnswerKey, string>;

type SavedEntry = Draft & { updatedAt: string };

const EMPTY_DRAFT: Draft = {
  answerCompany: "",
  answerHelp: "",
  answerDay: "",
  answerUnknown: "",
};

// 保存日時の表示はJSTに固定する（罠#17: Railway 本番は UTC）
function formatJst(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const time = d.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date.replaceAll("-", "/")} ${time}`;
}

function toDraft(a: SavedAnswer): Draft {
  return {
    answerCompany: a.answerCompany,
    answerHelp: a.answerHelp,
    answerDay: a.answerDay,
    answerUnknown: a.answerUnknown,
  };
}

export default function WorkClient() {
  const [sets, setSets] = useState<WorkSet[]>([]);
  const [workKey, setWorkKey] = useState<string | null>(null);
  const [set, setSet] = useState<WorkSet | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  // 入力途中の内容は親で保持する（求人を移動しても画面上は消えない。ただし未保存なのでリロードでは消える）
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [saved, setSaved] = useState<Map<string, SavedEntry>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ワークごとに設問ラベルも件数も変わるため、切り替えのたびに取り直す
  const fetchWork = useCallback(async (key: string | null) => {
    setLoading(true);
    setLoadError("");
    setError("");
    try {
      const qs = key ? `?workKey=${encodeURIComponent(key)}` : "";
      const res = await fetch(`/api/training/work${qs}`);
      if (!res.ok) {
        setLoadError("読み込みに失敗しました。再読み込みしてください。");
        return;
      }
      const data = await res.json();
      const loadedItems: WorkItem[] = data.items ?? [];
      const draftMap = new Map<string, Draft>();
      const savedMap = new Map<string, SavedEntry>();
      for (const a of (data.answers ?? []) as SavedAnswer[]) {
        const d = toDraft(a);
        draftMap.set(a.itemCode, d);
        savedMap.set(a.itemCode, { ...d, updatedAt: a.updatedAt });
      }
      setSets(data.sets ?? []);
      setSet(data.set ?? null);
      setWorkKey(data.workKey ?? null);
      setItems(loadedItems);
      setDrafts(draftMap);
      setSaved(savedMap);
      // 開いたときは未保存の最初の1件から。全件保存済みなら1件目
      const firstUnsaved = loadedItems.findIndex((i) => !savedMap.has(i.itemCode));
      setCurrentIndex(firstUnsaved === -1 ? 0 : firstUnsaved);
      setFinished(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWork(null);
  }, [fetchWork]);

  // isDirty / save の依存に入るため、参照が毎回変わらないようにする
  const fields: FieldLabel[] = useMemo(() => set?.fieldLabels ?? [], [set]);
  const current = items[currentIndex];
  const currentDraft = current ? drafts.get(current.itemCode) ?? EMPTY_DRAFT : EMPTY_DRAFT;
  const currentSaved = current ? saved.get(current.itemCode) ?? null : null;
  const isLast = currentIndex === items.length - 1;
  const savedCount = items.filter((i) => saved.has(i.itemCode)).length;
  const unsavedItems = items.filter((i) => !saved.has(i.itemCode));

  // 保存済みの内容と一致しなければ「未保存の変更あり」とみなす。
  // このワークで使う欄だけを見る（使わない欄は常に空文字で保存されるため）
  const isDirty = useCallback(
    (itemCode: string) => {
      const d = drafts.get(itemCode) ?? EMPTY_DRAFT;
      const base: Draft = saved.get(itemCode) ?? EMPTY_DRAFT;
      return fields.some((f) => d[f.key].trim() !== base[f.key].trim());
    },
    [drafts, saved, fields]
  );

  // 保存を伴わない移動。未保存の変更があるときだけ確認する
  const goTo = useCallback(
    (index: number, skipConfirm = false) => {
      if (index < 0 || index >= items.length) return;
      if (index === currentIndex && !finished) return;
      const from = items[currentIndex];
      if (!skipConfirm && from && isDirty(from.itemCode)) {
        if (!window.confirm("保存していない入力があります。移動しますか？")) return;
      }
      setError("");
      setFinished(false);
      setCurrentIndex(index);
    },
    [items, currentIndex, finished, isDirty]
  );

  // テキストエリアにフォーカスが無いときだけ左右キーで前後移動する
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (loading || finished || items.length === 0) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      goTo(e.key === "ArrowLeft" ? currentIndex - 1 : currentIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, currentIndex, loading, finished, items.length]);

  const updateField = (key: AnswerKey, value: string) => {
    if (!current) return;
    setDrafts((m) => {
      const next = new Map(m);
      next.set(current.itemCode, { ...(next.get(current.itemCode) ?? EMPTY_DRAFT), [key]: value });
      return next;
    });
  };

  const save = async (item: WorkItem, draft: Draft): Promise<boolean> => {
    if (!workKey) return false;
    setSaving(true);
    setError("");
    try {
      // このワークで使わない欄は空文字で送る（保存APIのリクエスト形式は変えない）
      const payload: Record<string, string> = {};
      for (const key of ANSWER_KEYS) {
        payload[key] = fields.some((f) => f.key === key) ? draft[key] : "";
      }
      const res = await fetch("/api/training/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey, itemCode: item.itemCode, ...payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "保存に失敗しました");
        return false;
      }
      // サーバ側で trim されるため、保存済みの値も trim 後の内容で持つ
      const stored: Draft = {
        answerCompany: (payload.answerCompany ?? "").trim(),
        answerHelp: (payload.answerHelp ?? "").trim(),
        answerDay: (payload.answerDay ?? "").trim(),
        answerUnknown: (payload.answerUnknown ?? "").trim(),
      };
      setSaved((m) => new Map(m).set(item.itemCode, { ...stored, updatedAt: data.updatedAt }));
      setDrafts((m) => new Map(m).set(item.itemCode, stored));
      return true;
    } catch {
      setError("保存に失敗しました");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const advance = () => {
    setError("");
    if (isLast) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleSaveNext = async () => {
    if (!current) return;
    // このワークで使う欄がすべて空だと API は 400 を返すため、保存を試みずに次へ進む
    const allEmpty = fields.every((f) => currentDraft[f.key].trim().length === 0);
    if (!allEmpty) {
      const ok = await save(current, currentDraft);
      if (!ok) return; // 失敗時は移動しない
    }
    advance();
  };

  const dotClass = (idx: number, itemCode: string) => {
    const isSaved = saved.has(itemCode);
    const isCurrent = idx === currentIndex && !finished;
    return [
      "w-3.5 h-3.5 rounded-full transition-all",
      isSaved ? "bg-[#2563EB]" : "bg-white",
      isCurrent
        ? "border-[3px] border-[#1D4ED8] scale-125"
        : isSaved
          ? "border border-[#2563EB]"
          : "border border-[#D1D5DB] hover:border-[#9CA3AF]",
    ].join(" ");
  };

  const textareaClass =
    "w-full px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-y";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-[20px] font-semibold text-[#374151]">
          {set ? set.title : "記述ワーク"}
        </h1>
        <Link href="/training/work/review" className="text-[13px] text-[#2563EB] hover:underline">
          自分の回答を見返す →
        </Link>
      </div>

      {/* ワーク選択 */}
      {sets.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap">
          {sets.map((s) => {
            const active = s.workKey === workKey;
            return (
              <button
                key={s.workKey}
                type="button"
                onClick={() => {
                  if (s.workKey === workKey) return;
                  fetchWork(s.workKey);
                }}
                className={[
                  "px-3 py-1.5 text-[13px] rounded-md border transition-colors",
                  active
                    ? "bg-[#2563EB] text-white border-[#2563EB] font-medium"
                    : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F9FAFB]",
                ].join(" ")}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      )}

      {set && (
        <div className="mt-3 p-3 rounded-md bg-[#FFFBEB] border border-[#FDE68A] text-[13px] text-[#92400E] leading-relaxed">
          {set.description}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
      ) : loadError ? (
        <p className="py-12 text-center text-[14px] text-[#DC2626]">{loadError}</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-[14px] text-[#6B7280]">設問が登録されていません</p>
      ) : (
        <>
          {/* 進捗インジケータ: 現在位置 + 件数分のドット（クリックで直接移動） */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <span className="text-[15px] font-semibold text-[#374151] tabular-nums">
              {finished ? items.length : currentIndex + 1} / {items.length}
            </span>
            <div className="flex items-center gap-2">
              {items.map((item, idx) => (
                <button
                  key={item.itemCode}
                  type="button"
                  onClick={() => goTo(idx)}
                  title={`${item.itemCode}${saved.has(item.itemCode) ? "（保存済み）" : "（未保存）"}`}
                  aria-label={`${item.itemCode} へ移動`}
                  className={dotClass(idx, item.itemCode)}
                />
              ))}
            </div>
            <span className="text-[12px] text-[#6B7280]">保存済み {savedCount}件</span>
          </div>

          {finished ? (
            // 完了画面
            <div className="mt-4 bg-white rounded-[8px] border border-[#E5E7EB] p-6 text-center">
              <p className="text-[16px] font-semibold text-[#374151]">
                {items.length}件中 {savedCount}件 保存しました。お疲れさまでした。
              </p>
              {unsavedItems.length > 0 && (
                <div className="mt-3">
                  <p className="text-[13px] text-[#92400E]">
                    未保存の求人があります（クリックするとその求人へ移動します）
                  </p>
                  <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                    {unsavedItems.map((item) => (
                      <button
                        key={item.itemCode}
                        type="button"
                        onClick={() => goTo(items.findIndex((i) => i.itemCode === item.itemCode), true)}
                        className="px-2 py-1 rounded border border-[#FDE68A] bg-[#FFFBEB] text-[12px] text-[#92400E] hover:bg-[#FEF3C7]"
                      >
                        {item.itemCode}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => goTo(0, true)}
                  className="px-5 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
                >
                  最初に戻る
                </button>
              </div>
            </div>
          ) : (
            current && (
              <div className="mt-4 bg-white rounded-[8px] border border-[#E5E7EB] p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB] text-[12px] font-semibold">
                    {current.itemCode}
                  </span>
                  <h2 className="text-[15px] font-semibold text-[#374151]">{current.title}</h2>
                  {currentSaved && (
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
                      ✓ 保存済み {formatJst(currentSaved.updatedAt)}
                    </span>
                  )}
                </div>

                <div className="mt-2.5 p-3 rounded-md bg-[#F9FAFB] border border-[#E5E7EB]">
                  <p className="text-[12px] font-medium text-[#6B7280] mb-1">仕事内容</p>
                  <p className="text-[14px] text-[#374151] whitespace-pre-wrap leading-6">
                    {current.jobContent}
                  </p>
                  {current.hintNote && (
                    <p className="mt-2 text-[13px] text-[#6B7280] whitespace-pre-wrap">
                      {current.hintNote}
                    </p>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {fields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-[13px] font-medium text-[#374151] mb-0.5">
                        {f.label}
                      </label>
                      <textarea
                        value={currentDraft[f.key]}
                        onChange={(e) => updateField(f.key, e.target.value)}
                        rows={f.rows}
                        placeholder={f.placeholder}
                        className={textareaClass}
                      />
                    </div>
                  ))}
                </div>

                {error && <p className="mt-2 text-[13px] text-[#DC2626]">{error}</p>}

                {/* ナビゲーション */}
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => goTo(currentIndex - 1)}
                    disabled={currentIndex === 0}
                    className="px-4 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB] disabled:opacity-40 disabled:hover:bg-white"
                  >
                    ← 前へ
                  </button>
                  <button
                    type="button"
                    onClick={advance}
                    className="text-[13px] text-[#6B7280] hover:text-[#374151] hover:underline"
                  >
                    保存せず{isLast ? "完了" : "次へ"}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNext}
                    disabled={saving}
                    className="ml-auto px-5 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {saving ? "保存中..." : isLast ? "保存して完了" : "保存して次へ →"}
                  </button>
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
