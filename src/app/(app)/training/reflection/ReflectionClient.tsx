"use client";

import { useState, useEffect, useCallback } from "react";

type Answer = {
  reflectionId?: string;
  itemId: string;
  itemLabel: string;
  rating: string;
};

type Reflection = {
  id: string;
  userId: string;
  userName: string;
  reportDate: string;
  learned: string;
  confused: string;
  questions: string;
  freeNote: string | null;
  dayLabel: string | null;
  workJobCount: number | null;
  workCorrectCount: number | null;
  workTarget: string | null;
  workMistake: string | null;
  workNextTime: string | null;
  observeScene: string | null;
  observeHard: string | null;
  isDraft: boolean;
  submittedAt: string | null;
  answers: Answer[];
};

type CheckItem = {
  id: string;
  dayLabel: string;
  label: string;
  sortOrder: number;
};

type Material = {
  id: string;
  title: string;
  quizKey: string | null;
};

type MyAttempt = {
  quizKey: string;
  round: number;
  totalQuestions: number;
  correctCount: number;
  finishedAt: string;
};

const DAY_OPTIONS = [
  ...Array.from({ length: 15 }, (_, i) => `Day ${i + 1}`),
  "その他",
];

const RATING_OPTIONS = [
  { value: "A", mark: "◎", label: "人に説明できる" },
  { value: "B", mark: "○", label: "分かった" },
  { value: "C", mark: "△", label: "あいまい" },
  { value: "D", mark: "×", label: "分からない" },
];

function formatDateLabel(reportDate: string): string {
  return reportDate.replaceAll("-", "/");
}

// finishedAt(ISO) を JST の日付文字列に変換して当日判定に使う（罠#17）
function toJstDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function jstDayOfWeek(reportDate: string): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  // JST正午 = UTC同日3時なので getUTCDay() が JST の曜日と一致する
  return days[new Date(`${reportDate}T12:00:00+09:00`).getUTCDay()];
}

function nextDayLabel(latest: string | null): string {
  if (!latest) return "Day 1";
  const m = /^Day (\d+)$/.exec(latest);
  if (!m) return "Day 1";
  const n = Math.min(parseInt(m[1], 10) + 1, 15);
  return `Day ${n}`;
}

function StatusBadge({ reflection }: { reflection: Reflection | null }) {
  if (!reflection) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[12px]">
        未提出
      </span>
    );
  }
  if (reflection.isDraft) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
        下書き
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
      提出済み
    </span>
  );
}

// 履歴カード（折りたたみ）
function HistoryCard({ r, showName }: { r: Reflection; showName: boolean }) {
  const [open, setOpen] = useState(false);

  const detailRows: { label: string; value: string | null }[] = [
    { label: "今日一番の学び", value: r.learned || null },
    { label: "分からなかった言葉・概念", value: r.confused || null },
    { label: "明日聞きたいこと", value: r.questions || null },
    { label: "自由記述", value: r.freeNote },
    {
      label: "求人票の判定",
      value:
        r.workJobCount !== null || r.workCorrectCount !== null || r.workTarget
          ? `${r.workJobCount ?? "—"}件中 ${r.workCorrectCount ?? "—"}件正解${r.workTarget ? `（対象: ${r.workTarget}）` : ""}`
          : null,
    },
    { label: "間違えた求人とその理由", value: r.workMistake },
    { label: "次に同じ判定をするとき何を変えるか", value: r.workNextTime },
    { label: "同席: 印象に残った場面と理由", value: r.observeScene },
    { label: "同席: 自分がやるとしたら難しそうな点", value: r.observeHard },
  ];

  return (
    <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left p-4 flex items-center gap-2 hover:bg-[#F9FAFB] rounded-[8px]"
      >
        <span className="text-[14px] font-semibold text-[#374151] whitespace-nowrap">
          {formatDateLabel(r.reportDate)}
        </span>
        {r.dayLabel && (
          <span className="text-[12px] text-[#6B7280] whitespace-nowrap">{r.dayLabel}</span>
        )}
        {showName && <span className="text-[13px] text-[#6B7280] whitespace-nowrap">{r.userName}</span>}
        <StatusBadge reflection={r} />
        <span className="text-[13px] text-[#6B7280] truncate flex-1">{r.learned}</span>
        <span className="text-[12px] text-[#9CA3AF]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-[#F3F4F6]">
          <dl className="mt-3 space-y-2">
            {detailRows.map(
              ({ label, value }) =>
                value && (
                  <div key={label}>
                    <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
                    <dd className="text-[14px] text-[#374151] whitespace-pre-wrap">{value}</dd>
                  </div>
                )
            )}
          </dl>
          {r.answers.length > 0 && (
            <div className="mt-3">
              <p className="text-[12px] font-medium text-[#6B7280] mb-1">理解度の自己評価</p>
              <div className="space-y-1">
                {r.answers.map((a) => {
                  const opt = RATING_OPTIONS.find((o) => o.value === a.rating);
                  return (
                    <div key={a.itemId} className="flex items-center gap-2 text-[13px]">
                      <span
                        className={`w-5 text-center font-semibold ${
                          a.rating === "C" || a.rating === "D" ? "text-[#DC2626]" : "text-[#16A34A]"
                        }`}
                      >
                        {opt?.mark ?? a.rating}
                      </span>
                      <span className="text-[#374151]">{a.itemLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReflectionClient({ isAdmin }: { isAdmin: boolean }) {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [today, setToday] = useState("");
  const [selfId, setSelfId] = useState("");
  const [selfName, setSelfName] = useState("");
  const [loading, setLoading] = useState(true);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [myAttempts, setMyAttempts] = useState<MyAttempt[]>([]);

  const [dayLabel, setDayLabel] = useState("Day 1");
  const [checkItems, setCheckItems] = useState<CheckItem[]>([]);
  const [ratings, setRatings] = useState<Record<string, string>>({});

  const [learned, setLearned] = useState("");
  const [confused, setConfused] = useState("");
  const [questions, setQuestions] = useState("");
  const [freeNote, setFreeNote] = useState("");
  const [workJobCount, setWorkJobCount] = useState("");
  const [workCorrectCount, setWorkCorrectCount] = useState("");
  const [workTarget, setWorkTarget] = useState("");
  const [workMistake, setWorkMistake] = useState("");
  const [workNextTime, setWorkNextTime] = useState("");
  const [observeScene, setObserveScene] = useState("");
  const [observeHard, setObserveHard] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [apiError, setApiError] = useState("");
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);

  const [filterUserId, setFilterUserId] = useState("");

  const todayReflection =
    reflections.find((r) => r.userId === selfId && r.reportDate === today) ?? null;

  const fetchReflections = useCallback(async (prefill: boolean) => {
    try {
      const res = await fetch("/api/training/reflections");
      if (!res.ok) return;
      const data = await res.json();
      setReflections(data.reflections);
      setToday(data.today);
      setSelfId(data.selfId);
      const mineAll: Reflection[] = data.reflections.filter(
        (r: Reflection) => r.userId === data.selfId
      );
      if (mineAll.length > 0) setSelfName(mineAll[0].userName);
      const mine = mineAll.find((r) => r.reportDate === data.today);
      if (prefill) {
        if (mine) {
          setDayLabel(mine.dayLabel ?? "Day 1");
          setLearned(mine.learned);
          setConfused(mine.confused);
          setQuestions(mine.questions);
          setFreeNote(mine.freeNote ?? "");
          setWorkJobCount(mine.workJobCount !== null ? String(mine.workJobCount) : "");
          setWorkCorrectCount(mine.workCorrectCount !== null ? String(mine.workCorrectCount) : "");
          setWorkTarget(mine.workTarget ?? "");
          setWorkMistake(mine.workMistake ?? "");
          setWorkNextTime(mine.workNextTime ?? "");
          setObserveScene(mine.observeScene ?? "");
          setObserveHard(mine.observeHard ?? "");
          setRatings(Object.fromEntries(mine.answers.map((a) => [a.itemId, a.rating])));
        } else {
          // デフォルトは前回提出時の翌日
          const latestWithDay = mineAll.find((r) => r.dayLabel);
          setDayLabel(nextDayLabel(latestWithDay?.dayLabel ?? null));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReflections(true);
    fetch("/api/training-materials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.materials) setMaterials(d.materials.filter((m: Material) => m.quizKey));
      });
    fetch("/api/training/quiz-attempts?mine=1&limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.attempts) setMyAttempts(d.attempts);
      });
  }, [fetchReflections]);

  // dayLabel 変更で該当の理解度項目を取り直す
  useEffect(() => {
    if (!dayLabel) return;
    fetch(`/api/training/check-items?dayLabel=${encodeURIComponent(dayLabel)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.items) setCheckItems(d.items);
      });
  }, [dayLabel]);

  const requiredErrors = {
    learned: learned.trim().length === 0 ? "必須項目です" : "",
    confused: confused.trim().length === 0 ? "必須項目です" : "",
    questions: questions.trim().length === 0 ? "必須項目です" : "",
  };
  const hasRequiredError = Object.values(requiredErrors).some((e) => e.length > 0);

  const buildPayload = (isDraft: boolean) => ({
    isDraft,
    dayLabel,
    learned,
    confused,
    questions,
    freeNote: freeNote.trim() || null,
    workJobCount: workJobCount.trim() !== "" ? Number(workJobCount) : null,
    workCorrectCount: workCorrectCount.trim() !== "" ? Number(workCorrectCount) : null,
    workTarget: workTarget.trim() || null,
    workMistake: workMistake.trim() || null,
    workNextTime: workNextTime.trim() || null,
    observeScene: observeScene.trim() || null,
    observeHard: observeHard.trim() || null,
    checkAnswers: Object.entries(ratings).map(([itemId, rating]) => ({ itemId, rating })),
  });

  const handleSave = async (isDraft: boolean) => {
    if (saving) return;
    if (!isDraft && hasRequiredError) {
      setShowRequiredErrors(true);
      setSavedMessage("");
      setApiError("必須項目を入力してください");
      return;
    }
    setSaving(true);
    setSavedMessage("");
    setApiError("");
    try {
      const res = await fetch("/api/training/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(isDraft)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApiError(data?.error || "保存に失敗しました");
        return;
      }
      setSavedMessage(isDraft ? "下書きを保存しました" : "提出しました");
      setShowRequiredErrors(false);
      await fetchReflections(false);
    } catch {
      setApiError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // セクション1: 当日のクイズ実績（教材ごとに最高スコアと周回数）
  const todayAttempts = myAttempts.filter((a) => toJstDate(a.finishedAt) === today);
  const quizResults = materials.map((m) => {
    const own = todayAttempts.filter((a) => a.quizKey === m.quizKey);
    if (own.length === 0) return { material: m, label: "未受験", done: false };
    // 再挑戦ラウンド（間違えた問題だけの少問セット）が比率で勝たないよう、1周目のスコアを優先する
    const round1 = own.filter((a) => a.round === 1);
    const pool = round1.length > 0 ? round1 : own;
    const best = pool.reduce((mx, a) =>
      a.correctCount / a.totalQuestions > mx.correctCount / mx.totalQuestions ? a : mx
    );
    const maxRound = Math.max(...own.map((a) => a.round));
    return {
      material: m,
      label: `最高 ${best.correctCount}/${best.totalQuestions}・${maxRound}周`,
      done: true,
    };
  });

  const userOptions = isAdmin
    ? [...new Map(reflections.map((r) => [r.userId, r.userName])).entries()].map(([id, name]) => ({
        id,
        name,
      }))
    : [];
  const visibleReflections = reflections.filter((r) => !filterUserId || r.userId === filterUserId);

  const textareaClass =
    "w-full px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";
  const inputClass = textareaClass;
  const sectionClass = "bg-white rounded-[8px] border border-[#E5E7EB] p-5";
  const sectionTitleClass = "text-[15px] font-semibold text-[#374151]";

  return (
    <div>
      {/* 画面上部 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold text-[#374151] flex items-center gap-2">
          研修
          <select
            value={dayLabel}
            onChange={(e) => setDayLabel(e.target.value)}
            className="px-2 py-1 border border-[#E5E7EB] rounded-md text-[16px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          の振り返り
        </h1>
        <span className="text-[14px] text-[#6B7280]">
          {today && `${formatDateLabel(today)}（${jstDayOfWeek(today)}）`}
          {selfName && ` ${selfName}`}
        </span>
        <StatusBadge reflection={todayReflection} />
      </div>

      <div className="mt-4 space-y-5 max-w-3xl">
        {/* セクション1: 今日の実績（読み取り専用） */}
        <section className={sectionClass}>
          <h2 className={sectionTitleClass}>今日の実績（クイズ・自動表示）</h2>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quizResults.map(({ material, label, done }) => (
              <div
                key={material.id}
                className={`px-3 py-2 rounded-md border text-[13px] ${
                  done
                    ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#374151]"
                    : "border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
                }`}
              >
                <span className="font-medium">{material.title}</span>
                <span className="ml-2">{label}</span>
              </div>
            ))}
            {quizResults.length === 0 && (
              <p className="text-[13px] text-[#6B7280]">クイズ教材がありません</p>
            )}
          </div>
        </section>

        {/* セクション2: 理解度の自己評価（項目0件なら非表示） */}
        {checkItems.length > 0 && (
          <section className={sectionClass}>
            <h2 className={sectionTitleClass}>理解度の自己評価</h2>
            <p className="mt-1 text-[12px] text-[#6B7280]">
              ◎ 人に説明できる ／ ○ 分かった ／ △ あいまい ／ × 分からない
            </p>
            <div className="mt-3 space-y-2">
              {checkItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-[#F3F4F6]"
                >
                  <span className="text-[14px] text-[#374151]">{item.label}</span>
                  <div className="flex gap-1">
                    {RATING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        title={opt.label}
                        onClick={() =>
                          setRatings((prev) => {
                            const next = { ...prev };
                            if (next[item.id] === opt.value) delete next[item.id];
                            else next[item.id] = opt.value;
                            return next;
                          })
                        }
                        className={`w-9 h-9 rounded-md border text-[15px] ${
                          ratings[item.id] === opt.value
                            ? "bg-[#2563EB] text-white border-[#2563EB]"
                            : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB]"
                        }`}
                      >
                        {opt.mark}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* セクション3: ワーク① 求人票の判定（すべて任意） */}
        <section className={sectionClass}>
          <h2 className={sectionTitleClass}>ワーク① 求人票の判定</h2>
          <p className="mt-1 text-[12px] text-[#6B7280]">実施しなかった日は空欄のままでOK</p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">判定した件数</label>
              <input
                type="number"
                min="0"
                value={workJobCount}
                onChange={(e) => setWorkJobCount(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">正解した件数</label>
              <input
                type="number"
                min="0"
                value={workCorrectCount}
                onChange={(e) => setWorkCorrectCount(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">対象の求職者</label>
              <input
                type="text"
                value={workTarget}
                onChange={(e) => setWorkTarget(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                間違えた求人と、その理由
              </label>
              <textarea
                rows={3}
                value={workMistake}
                onChange={(e) => setWorkMistake(e.target.value)}
                className={textareaClass}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                次に同じ判定をするとき、何を変えるか
              </label>
              <textarea
                rows={3}
                value={workNextTime}
                onChange={(e) => setWorkNextTime(e.target.value)}
                className={textareaClass}
              />
            </div>
          </div>
        </section>

        {/* セクション4: 同席・見学の学び（すべて任意） */}
        <section className={sectionClass}>
          <h2 className={sectionTitleClass}>同席・見学の学び</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                印象に残った場面と、その理由
              </label>
              <textarea
                rows={3}
                value={observeScene}
                onChange={(e) => setObserveScene(e.target.value)}
                className={textareaClass}
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                自分がやるとしたら、難しそうな点
              </label>
              <textarea
                rows={3}
                value={observeHard}
                onChange={(e) => setObserveHard(e.target.value)}
                className={textareaClass}
              />
            </div>
          </div>
        </section>

        {/* セクション5: 明日への申し送り */}
        <section className={sectionClass}>
          <h2 className={sectionTitleClass}>明日への申し送り</h2>
          <div className="mt-3 space-y-3">
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
              {showRequiredErrors && requiredErrors.learned && (
                <p className="mt-1 text-[12px] text-[#DC2626]">{requiredErrors.learned}</p>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                分からなかった言葉・概念 <span className="text-[#DC2626]">*</span>
              </label>
              <textarea
                rows={3}
                value={confused}
                onChange={(e) => setConfused(e.target.value)}
                className={textareaClass}
              />
              {showRequiredErrors && requiredErrors.confused && (
                <p className="mt-1 text-[12px] text-[#DC2626]">{requiredErrors.confused}</p>
              )}
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
              {showRequiredErrors && requiredErrors.questions && (
                <p className="mt-1 text-[12px] text-[#DC2626]">{requiredErrors.questions}</p>
              )}
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                自由記述（感想・体調・その他）
              </label>
              <textarea
                rows={4}
                value={freeNote}
                onChange={(e) => setFreeNote(e.target.value)}
                className={textareaClass}
              />
            </div>
          </div>
        </section>

        {/* 画面下部: ボタン */}
        <div className="flex items-center justify-end gap-3">
          <span className="text-[12px] text-[#6B7280]">同じ日に何度でも書き直せます</span>
          {savedMessage && <span className="text-[13px] text-[#16A34A]">{savedMessage}</span>}
          {apiError && <span className="text-[13px] text-[#DC2626]">{apiError}</span>}
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-5 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下書き保存
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-5 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中..." : "提出する"}
          </button>
        </div>
      </div>

      {/* 履歴 */}
      <section className="mt-10">
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
          <div className="space-y-3 max-w-3xl">
            {visibleReflections.map((r) => (
              <HistoryCard key={r.id} r={r} showName={isAdmin} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
