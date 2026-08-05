"use client";

import { useState, useEffect, useCallback } from "react";

const WORK_KEY = "work0-shokushu-gyoshu";

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

type Draft = {
  answerCompany: string;
  answerHelp: string;
  answerDay: string;
  answerUnknown: string;
};

const EMPTY_DRAFT: Draft = { answerCompany: "", answerHelp: "", answerDay: "", answerUnknown: "" };

const FIELDS: { key: keyof Draft; label: string; rows: number; placeholder: string }[] = [
  { key: "answerCompany", label: "① この会社は何をしている会社か", rows: 2, placeholder: "1行程度" },
  { key: "answerHelp", label: "② この仕事は誰を助ける仕事か", rows: 2, placeholder: "1行程度" },
  { key: "answerDay", label: "③ 1日の動きを想像して書いてください", rows: 4, placeholder: "2〜3行" },
  { key: "answerUnknown", label: "④ 分からなかった言葉があれば書いてください", rows: 2, placeholder: "例: レセプト、入稿" },
];

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

function WorkCard({
  item,
  initialDraft,
  savedAt,
  onSaved,
}: {
  item: WorkItem;
  initialDraft: Draft;
  savedAt: string | null;
  onSaved: (itemCode: string, updatedAt: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMark, setSavedMark] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSavedMark(false);
    try {
      const res = await fetch("/api/training/work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey: WORK_KEY, itemCode: item.itemCode, ...draft }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "保存に失敗しました");
        return;
      }
      onSaved(item.itemCode, data.updatedAt);
      setSavedMark(true);
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const textareaClass =
    "w-full px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-y";

  return (
    <div className="bg-white rounded-[8px] border border-[#E5E7EB] p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB] text-[12px] font-semibold">
          {item.itemCode}
        </span>
        <h2 className="text-[15px] font-semibold text-[#374151]">{item.title}</h2>
        {savedAt && (
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
            ✓ 保存済み {formatJst(savedAt)}
          </span>
        )}
      </div>

      <div className="mt-3 p-3 rounded-md bg-[#F9FAFB] border border-[#E5E7EB]">
        <p className="text-[12px] font-medium text-[#6B7280] mb-1">仕事内容</p>
        <p className="text-[14px] text-[#374151] whitespace-pre-wrap leading-relaxed">
          {item.jobContent}
        </p>
        {item.hintNote && (
          <p className="mt-2 text-[13px] text-[#6B7280] whitespace-pre-wrap">{item.hintNote}</p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">{f.label}</label>
            <textarea
              value={draft[f.key]}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                setSavedMark(false);
              }}
              rows={f.rows}
              placeholder={f.placeholder}
              className={textareaClass}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {savedMark && <span className="text-[13px] text-[#16A34A]">保存しました</span>}
        {error && <span className="text-[13px] text-[#DC2626]">{error}</span>}
      </div>
    </div>
  );
}

export default function WorkClient() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [savedAtMap, setSavedAtMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/training/work?workKey=${encodeURIComponent(WORK_KEY)}`);
      if (!res.ok) {
        setLoadError("読み込みに失敗しました。再読み込みしてください。");
        return;
      }
      const data = await res.json();
      setItems(data.items);
      const draftMap = new Map<string, Draft>();
      const savedMap = new Map<string, string>();
      for (const a of data.answers as SavedAnswer[]) {
        draftMap.set(a.itemCode, {
          answerCompany: a.answerCompany,
          answerHelp: a.answerHelp,
          answerDay: a.answerDay,
          answerUnknown: a.answerUnknown,
        });
        savedMap.set(a.itemCode, a.updatedAt);
      }
      setDrafts(draftMap);
      setSavedAtMap(savedMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaved = useCallback((itemCode: string, updatedAt: string) => {
    setSavedAtMap((m) => new Map(m).set(itemCode, updatedAt));
  }, []);

  const savedCount = items.filter((i) => savedAtMap.has(i.itemCode)).length;

  return (
    <div className="max-w-3xl">
      <h1 className="text-[20px] font-semibold text-[#374151]">
        記述ワーク：職種・業種を推測する
      </h1>

      <div className="mt-3 p-3 rounded-md bg-[#FFFBEB] border border-[#FDE68A] text-[13px] text-[#92400E] leading-relaxed">
        業種や会社名は書かれていません。仕事内容だけを読んで推測してください。分からなくても構いません。分からなかった言葉を④に残すことが大切です。
      </div>

      {loading ? (
        <p className="py-12 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
      ) : loadError ? (
        <p className="py-12 text-center text-[14px] text-[#DC2626]">{loadError}</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-[14px] text-[#6B7280]">設問が登録されていません</p>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[14px] font-medium text-[#374151]">
              進捗: {items.length}件中 {savedCount}件 保存済み
            </span>
            <div className="flex-1 max-w-[240px] h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2563EB] rounded-full transition-all"
                style={{ width: `${items.length > 0 ? (savedCount / items.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="mt-4 space-y-5 pb-10">
            {items.map((item) => (
              <WorkCard
                key={item.itemCode}
                item={item}
                initialDraft={drafts.get(item.itemCode) ?? EMPTY_DRAFT}
                savedAt={savedAtMap.get(item.itemCode) ?? null}
                onSaved={handleSaved}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
