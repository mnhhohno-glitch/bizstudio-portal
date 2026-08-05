"use client";

import { useState, useEffect, useCallback } from "react";

type Reflection = {
  id: string;
  userId: string;
  userName: string;
  reportDate: string;
  learned: string;
  confused: string;
  questions: string;
  freeNote: string | null;
};

const FIELD_LABELS = [
  { key: "learned", label: "今日一番の学び" },
  { key: "confused", label: "一番分からなかったこと" },
  { key: "questions", label: "明日聞きたいこと" },
  { key: "freeNote", label: "自由記述（感想・その他）" },
] as const;

function formatDateLabel(reportDate: string): string {
  return reportDate.replaceAll("-", "/");
}

export default function ReflectionClient({ isAdmin }: { isAdmin: boolean }) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [today, setToday] = useState("");
  const [selfId, setSelfId] = useState("");
  const [loading, setLoading] = useState(true);

  const [learned, setLearned] = useState("");
  const [confused, setConfused] = useState("");
  const [questions, setQuestions] = useState("");
  const [freeNote, setFreeNote] = useState("");
  const [hasToday, setHasToday] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [apiError, setApiError] = useState("");

  const [filterUserId, setFilterUserId] = useState("");

  const fetchReflections = useCallback(async (prefill: boolean) => {
    try {
      const res = await fetch("/api/training/reflections");
      if (!res.ok) return;
      const data = await res.json();
      setReflections(data.reflections);
      setToday(data.today);
      setSelfId(data.selfId);
      const mine = data.reflections.find(
        (r: Reflection) => r.userId === data.selfId && r.reportDate === data.today
      );
      setHasToday(!!mine);
      if (prefill && mine) {
        setLearned(mine.learned);
        setConfused(mine.confused);
        setQuestions(mine.questions);
        setFreeNote(mine.freeNote ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReflections(true);
  }, [fetchReflections]);

  const errors = {
    learned: learned.trim().length === 0 ? "必須項目です" : "",
    confused: confused.trim().length === 0 ? "必須項目です" : "",
    questions: questions.trim().length === 0 ? "必須項目です" : "",
  };
  const hasError = Object.values(errors).some((e) => e.length > 0);

  const handleSave = async () => {
    if (hasError || saving) return;
    setSaving(true);
    setSavedMessage("");
    setApiError("");
    try {
      const res = await fetch("/api/training/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          learned: learned.trim(),
          confused: confused.trim(),
          questions: questions.trim(),
          freeNote: freeNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApiError(data?.error || "保存に失敗しました");
        return;
      }
      setSavedMessage("保存しました");
      await fetchReflections(false);
    } catch {
      setApiError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // admin 用の社員絞り込み候補は履歴に存在するユーザーから作る
  const userOptions = isAdmin
    ? [...new Map(reflections.map((r) => [r.userId, r.userName])).entries()].map(
        ([id, name]) => ({ id, name })
      )
    : [];

  const visibleReflections = reflections.filter(
    (r) => !filterUserId || r.userId === filterUserId
  );

  const textareaClass =
    "w-full px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-[#374151]">研修振り返り</h1>

      {/* 上段: 今日の振り返りフォーム */}
      <section className="mt-4 bg-white rounded-[8px] border border-[#E5E7EB] p-5 max-w-3xl">
        <h2 className="text-[16px] font-semibold text-[#374151]">
          今日の振り返り{today && `（${formatDateLabel(today)}）`}
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              今日一番の学び <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              rows={3}
              value={learned}
              onChange={(e) => setLearned(e.target.value)}
              className={textareaClass}
            />
            {errors.learned && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.learned}</p>}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              一番分からなかったこと <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              rows={3}
              value={confused}
              onChange={(e) => setConfused(e.target.value)}
              className={textareaClass}
            />
            {errors.confused && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.confused}</p>}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              明日聞きたいこと <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              rows={3}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              className={textareaClass}
            />
            {errors.questions && (
              <p className="mt-1 text-[12px] text-[#DC2626]">{errors.questions}</p>
            )}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              自由記述（感想・その他）
            </label>
            <textarea
              rows={4}
              value={freeNote}
              onChange={(e) => setFreeNote(e.target.value)}
              className={textareaClass}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {savedMessage && <span className="text-[13px] text-[#16A34A]">{savedMessage}</span>}
          {apiError && <span className="text-[13px] text-[#DC2626]">{apiError}</span>}
          <button
            onClick={handleSave}
            disabled={hasError || saving}
            className="px-5 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中..." : hasToday ? "更新する" : "保存する"}
          </button>
        </div>
      </section>

      {/* 下段: 振り返りの履歴 */}
      <section className="mt-8">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[16px] font-semibold text-[#374151]">振り返りの履歴</h2>
          {isAdmin && (
            <select
              value={filterUserId}
              onChange={(e) => setFilterUserId(e.target.value)}
              className="px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            >
              <option value="">社員: すべて</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
        ) : visibleReflections.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">振り返りはまだありません</p>
        ) : (
          <div className="space-y-4 max-w-3xl">
            {visibleReflections.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-[#374151]">
                    {formatDateLabel(r.reportDate)}
                  </span>
                  {isAdmin && <span className="text-[13px] text-[#6B7280]">{r.userName}</span>}
                  {selfId === r.userId && r.reportDate === today && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DBEAFE] text-[#2563EB] text-[11px]">
                      今日
                    </span>
                  )}
                </div>
                <dl className="mt-3 space-y-2">
                  {FIELD_LABELS.map(({ key, label }) => {
                    const value = r[key];
                    if (key === "freeNote" && !value) return null;
                    return (
                      <div key={key}>
                        <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
                        <dd className="text-[14px] text-[#374151] whitespace-pre-wrap">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
