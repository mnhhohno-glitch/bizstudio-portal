"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export type SummaryRow = {
  userId: string;
  userName: string;
  quizKey: string;
  quizTitle: string;
  attemptCount: number;
  bestLabel: string | null;
  clearLabel: string;
};

export type QuizOption = { quizKey: string; title: string };

type Stat = {
  qid: string;
  category: string;
  questionText: string;
  total: number;
  wrong: number;
  wrongRate: number;
};

type ReflectionAnswer = { itemId: string; itemLabel: string; rating: string };

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
  answers: ReflectionAnswer[];
};

type ReflectionStat = {
  itemId: string;
  itemLabel: string;
  dayLabel: string;
  total: number;
  countA: number;
  countB: number;
  countC: number;
  countD: number;
  cdCount: number;
  cdRate: number;
};

type CheckItem = {
  id: string;
  dayLabel: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
};

const RATING_MARKS: Record<string, string> = { A: "◎", B: "○", C: "△", D: "×" };

type WorkItemLite = {
  id: string;
  itemCode: string;
  sortOrder: number;
  title: string;
  jobContent: string;
};

type WorkAnswer = {
  employeeId: string;
  employeeName: string;
  itemCode: string;
  answerCompany: string;
  answerHelp: string;
  answerDay: string;
  answerUnknown: string;
  updatedAt: string;
};

type WorkStatsData = {
  workKey: string;
  workKeys: string[];
  items: WorkItemLite[];
  employees: { id: string; name: string }[];
  answers: WorkAnswer[];
};

function formatMd(reportDate: string): string {
  const [, m, d] = reportDate.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 振り返り詳細モーダル（提出状況マトリクスのセルクリックで開く）
function ReflectionDetailModal({ r, onClose }: { r: Reflection; onClose: () => void }) {
  const rows: { label: string; value: string | null }[] = [
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-[#374151] flex items-center gap-2">
          {r.reportDate.replaceAll("-", "/")} {r.userName}
          {r.dayLabel && <span className="text-[13px] text-[#6B7280]">{r.dayLabel}</span>}
          {r.isDraft ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
              下書き
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
              提出済み
            </span>
          )}
        </h2>

        <dl className="mt-4 space-y-2">
          {rows.map(
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
          <div className="mt-4">
            <p className="text-[12px] font-medium text-[#6B7280] mb-1">理解度の自己評価</p>
            <div className="space-y-1">
              {r.answers.map((a) => (
                <div key={a.itemId} className="flex items-center gap-2 text-[13px]">
                  <span
                    className={`w-5 text-center font-semibold ${
                      a.rating === "C" || a.rating === "D" ? "text-[#DC2626]" : "text-[#16A34A]"
                    }`}
                  >
                    {RATING_MARKS[a.rating] ?? a.rating}
                  </span>
                  <span className="text-[#374151]">{a.itemLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// 理解度チェック項目の管理モーダル
function CheckItemsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<CheckItem[]>([]);
  const [dayFilter, setDayFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDay, setFormDay] = useState("Day 1");
  const [formLabel, setFormLabel] = useState("");
  const [formSort, setFormSort] = useState("0");
  const [formActive, setFormActive] = useState(true);
  const [error, setError] = useState("");

  const fetchItems = useCallback(async () => {
    const res = await fetch("/api/training/check-items?all=1");
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const dayOptions = [...new Set(items.map((i) => i.dayLabel))];
  const visible = items.filter((i) => !dayFilter || i.dayLabel === dayFilter);

  const resetForm = () => {
    setEditingId(null);
    setFormLabel("");
    setFormSort("0");
    setFormActive(true);
  };

  const handleSubmit = async () => {
    setError("");
    if (formLabel.trim().length === 0 || formDay.trim().length === 0) {
      setError("研修日と項目名は必須です");
      return;
    }
    const payload = {
      dayLabel: formDay.trim(),
      label: formLabel.trim(),
      sortOrder: Number(formSort) || 0,
      isActive: formActive,
    };
    const res = await fetch(
      editingId ? `/api/training/check-items/${editingId}` : "/api/training/check-items",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "保存に失敗しました");
      return;
    }
    resetForm();
    fetchItems();
  };

  const handleDelete = async (item: CheckItem) => {
    if (!window.confirm(`「${item.label}」を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/training/check-items/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error || "削除に失敗しました");
      return;
    }
    fetchItems();
  };

  const inputClass =
    "px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-[#374151]">理解度チェック項目の管理</h2>

        {/* 追加・編集フォーム */}
        <div className="mt-4 p-3 rounded-md bg-[#F9FAFB] border border-[#E5E7EB]">
          <p className="text-[13px] font-medium text-[#374151] mb-2">
            {editingId ? "項目を編集" : "項目を追加"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={formDay}
              onChange={(e) => setFormDay(e.target.value)}
              placeholder="Day 1"
              className={`${inputClass} w-24`}
            />
            <input
              type="text"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="項目名"
              className={`${inputClass} flex-1 min-w-[200px]`}
            />
            <input
              type="number"
              value={formSort}
              onChange={(e) => setFormSort(e.target.value)}
              title="表示順"
              className={`${inputClass} w-20`}
            />
            <label className="flex items-center gap-1 text-[13px] text-[#374151]">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
              />
              有効
            </label>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 text-[13px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
            >
              {editingId ? "更新" : "追加"}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-md hover:bg-white"
              >
                キャンセル
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-[12px] text-[#DC2626]">{error}</p>}
        </div>

        {/* 一覧 */}
        <div className="mt-4 flex items-center gap-2">
          <select
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            className={`${inputClass} py-1.5 text-[13px]`}
          >
            <option value="">研修日: すべて</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <table className="mt-3 w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
              <th className="py-2 pr-2 font-medium">研修日</th>
              <th className="py-2 pr-2 font-medium">項目</th>
              <th className="py-2 pr-2 font-medium">表示順</th>
              <th className="py-2 pr-2 font-medium">状態</th>
              <th className="py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} className={`border-b border-[#F3F4F6] ${item.isActive ? "" : "opacity-50"}`}>
                <td className="py-2 pr-2 whitespace-nowrap">{item.dayLabel}</td>
                <td className="py-2 pr-2 text-[#374151]">{item.label}</td>
                <td className="py-2 pr-2">{item.sortOrder}</td>
                <td className="py-2 pr-2">{item.isActive ? "有効" : "無効"}</td>
                <td className="py-2 whitespace-nowrap">
                  <button
                    onClick={() => {
                      setEditingId(item.id);
                      setFormDay(item.dayLabel);
                      setFormLabel(item.label);
                      setFormSort(String(item.sortOrder));
                      setFormActive(item.isActive);
                    }}
                    className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(item)}
                    className="ml-1 px-2 py-1 text-[12px] border border-[#FCA5A5] text-[#DC2626] rounded-md hover:bg-[#FEF2F2]"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[#6B7280]">
                  項目がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// 記述ワーク（職種・業種当て）の回答セクション
// 提出状況マトリクス / 社員別の回答全文 / ④分からなかった言葉の全社員一覧（講師が講義の重点を決めるために使う）
function WorkAnswersSection() {
  const [data, setData] = useState<WorkStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [workKey, setWorkKey] = useState("work0-shokushu-gyoshu");
  const [view, setView] = useState<"matrix" | "detail" | "unknown">("matrix");
  const [selectedEmployee, setSelectedEmployee] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/training/work-stats?workKey=${encodeURIComponent(workKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d);
      })
      .finally(() => setLoading(false));
  }, [workKey]);

  const selectClass =
    "px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  // 保存日時の表示はJSTに固定する（罠#17: Railway 本番は UTC）
  const formatJst = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replaceAll("-", "/")} ${d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}`;
  };

  const answerByEmployeeItem = new Map(
    (data?.answers ?? []).map((a) => [`${a.employeeId}|${a.itemCode}`, a])
  );
  const itemByCode = new Map((data?.items ?? []).map((i) => [i.itemCode, i]));

  // 回答があるがアクティブ社員一覧にいない人（退職者等）も行に出す
  const answerOnlyEmployees = [
    ...new Map(
      (data?.answers ?? [])
        .filter((a) => !(data?.employees ?? []).some((e) => e.id === a.employeeId))
        .map((a) => [a.employeeId, { id: a.employeeId, name: a.employeeName }])
    ).values(),
  ];
  const allEmployees = [...(data?.employees ?? []), ...answerOnlyEmployees];

  const unknownAnswers = (data?.answers ?? [])
    .filter((a) => a.answerUnknown.trim().length > 0)
    .sort((a, b) =>
      a.itemCode === b.itemCode
        ? a.employeeName.localeCompare(b.employeeName, "ja")
        : a.itemCode.localeCompare(b.itemCode)
    );

  const detailAnswers = (data?.items ?? []).map((item) => ({
    item,
    answer: answerByEmployeeItem.get(`${selectedEmployee}|${item.itemCode}`) ?? null,
  }));

  const viewButtons: { key: typeof view; label: string }[] = [
    { key: "matrix", label: "提出状況" },
    { key: "detail", label: "社員別回答" },
    { key: "unknown", label: "分からなかった言葉" },
  ];

  return (
    <section className="mt-8">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 className="text-[16px] font-semibold text-[#374151]">記述ワーク回答</h2>
        <select value={workKey} onChange={(e) => setWorkKey(e.target.value)} className={selectClass}>
          {(data?.workKeys.length ? data.workKeys : [workKey]).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-[#E5E7EB] overflow-hidden">
          {viewButtons.map((b) => (
            <button
              key={b.key}
              onClick={() => setView(b.key)}
              className={`px-3 py-1.5 text-[13px] ${
                view === b.key ? "bg-[#2563EB] text-white" : "bg-white text-[#374151] hover:bg-[#F9FAFB]"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
      ) : !data || data.items.length === 0 ? (
        <p className="py-8 text-center text-[14px] text-[#6B7280]">設問が登録されていません</p>
      ) : view === "matrix" ? (
        <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">社員</th>
                {data.items.map((i) => (
                  <th key={i.itemCode} className="py-2.5 px-2 font-medium whitespace-nowrap" title={i.title}>
                    {i.itemCode}
                  </th>
                ))}
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">提出数</th>
              </tr>
            </thead>
            <tbody>
              {allEmployees.map((u) => {
                const submitted = data.items.filter((i) =>
                  answerByEmployeeItem.has(`${u.id}|${i.itemCode}`)
                ).length;
                return (
                  <tr key={u.id} className={`border-b border-[#F3F4F6] ${submitted === 0 ? "text-[#9CA3AF]" : ""}`}>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setSelectedEmployee(u.id);
                          setView("detail");
                        }}
                        className="text-[#2563EB] hover:underline"
                      >
                        {u.name}
                      </button>
                    </td>
                    {data.items.map((i) => {
                      const has = answerByEmployeeItem.has(`${u.id}|${i.itemCode}`);
                      return (
                        <td key={i.itemCode} className="py-2.5 px-2 whitespace-nowrap">
                          {has ? (
                            <span className="text-[#16A34A] font-medium">✓</span>
                          ) : (
                            <span className="text-[#D1D5DB]">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-3">
                      {submitted}/{data.items.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === "detail" ? (
        <div>
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            className={selectClass}
          >
            <option value="">社員を選択してください</option>
            {allEmployees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          {selectedEmployee && (
            <div className="mt-3 space-y-3">
              {detailAnswers.map(({ item, answer }) => (
                <div key={item.itemCode} className="bg-white rounded-[8px] border border-[#E5E7EB] p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB] text-[12px] font-semibold">
                      {item.itemCode}
                    </span>
                    <span className="text-[14px] font-medium text-[#374151]">{item.title}</span>
                    {answer ? (
                      <span className="ml-auto text-[12px] text-[#6B7280]">
                        保存: {formatJst(answer.updatedAt)}
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#9CA3AF] text-[12px]">
                        未提出
                      </span>
                    )}
                  </div>
                  {answer && (
                    <dl className="mt-3 space-y-2">
                      {[
                        { label: "① 何をしている会社か", value: answer.answerCompany },
                        { label: "② 誰を助ける仕事か", value: answer.answerHelp },
                        { label: "③ 1日の動き", value: answer.answerDay },
                        { label: "④ 分からなかった言葉", value: answer.answerUnknown },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
                          <dd className="text-[14px] text-[#374151] whitespace-pre-wrap">
                            {value || <span className="text-[#9CA3AF]">（未記入）</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ④分からなかった言葉の全社員一覧（講師が講義の重点を決めるために使う）
        <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">求人</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">社員</th>
                <th className="py-2.5 px-3 font-medium">分からなかった言葉</th>
              </tr>
            </thead>
            <tbody>
              {unknownAnswers.map((a) => (
                <tr key={`${a.employeeId}-${a.itemCode}`} className="border-b border-[#F3F4F6]">
                  <td className="py-2.5 px-3 whitespace-nowrap text-[#6B7280]" title={itemByCode.get(a.itemCode)?.title ?? ""}>
                    {a.itemCode}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-[#374151]">{a.employeeName}</td>
                  <td className="py-2.5 px-3 text-[#374151] whitespace-pre-wrap">{a.answerUnknown}</td>
                </tr>
              ))}
              {unknownAnswers.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-[#6B7280]">
                    まだ記入がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function AdminClient({
  summary,
  quizzes,
}: {
  summary: SummaryRow[];
  quizzes: QuizOption[];
}) {
  const [stats, setStats] = useState<Stat[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsQuizKey, setStatsQuizKey] = useState("");

  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [detailReflection, setDetailReflection] = useState<Reflection | null>(null);

  const [rStats, setRStats] = useState<ReflectionStat[]>([]);
  const [rStatsLoading, setRStatsLoading] = useState(true);
  const [rStatsDay, setRStatsDay] = useState("");
  const [dayOptions, setDayOptions] = useState<string[]>([]);

  const [checkItemsOpen, setCheckItemsOpen] = useState(false);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const params = statsQuizKey ? `?quizKey=${encodeURIComponent(statsQuizKey)}` : "";
      const res = await fetch(`/api/training/quiz-stats${params}`);
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
      }
    } finally {
      setStatsLoading(false);
    }
  }, [statsQuizKey]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetch("/api/training/reflections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.reflections) setReflections(d.reflections);
      });
    fetch("/api/training/check-items?all=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.items) setDayOptions([...new Set(d.items.map((i: CheckItem) => i.dayLabel))] as string[]);
      });
  }, [checkItemsOpen]); // 項目管理モーダルを閉じたら dayLabel 候補を取り直す

  const fetchRStats = useCallback(async () => {
    setRStatsLoading(true);
    try {
      const params = rStatsDay ? `?dayLabel=${encodeURIComponent(rStatsDay)}` : "";
      const res = await fetch(`/api/training/reflection-stats${params}`);
      if (res.ok) {
        const data = await res.json();
        setRStats(data.stats);
      }
    } finally {
      setRStatsLoading(false);
    }
  }, [rStatsDay]);

  useEffect(() => {
    fetchRStats();
  }, [fetchRStats]);

  // 提出状況マトリクス: 実データが存在する reportDate の直近10日分を列にする
  const matrixDates = [...new Set(reflections.map((r) => r.reportDate))]
    .sort()
    .reverse()
    .slice(0, 10)
    .reverse();
  const matrixUsers = [...new Map(summary.map((s) => [s.userId, s.userName])).entries()].map(
    ([id, name]) => ({ id, name })
  );
  const reflectionByUserDate = new Map(reflections.map((r) => [`${r.userId}|${r.reportDate}`, r]));

  const selectClass =
    "px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-[#374151]">研修管理</h1>

      {/* セクション1: 社員別サマリ */}
      <section className="mt-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[16px] font-semibold text-[#374151]">社員別サマリ</h2>
          <Link href="/training/reflection" className="text-[13px] text-[#2563EB] hover:underline">
            振り返りを見る →
          </Link>
        </div>
        {summary.length === 0 ? (
          <p className="text-[14px] text-[#6B7280]">クイズ教材が登録されていません</p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                  <th className="py-2.5 px-3 font-medium">社員</th>
                  <th className="py-2.5 px-3 font-medium">教材</th>
                  <th className="py-2.5 px-3 font-medium">挑戦回数</th>
                  <th className="py-2.5 px-3 font-medium">最高スコア</th>
                  <th className="py-2.5 px-3 font-medium">クリア</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr
                    key={`${r.userId}-${r.quizKey}`}
                    className={`border-b border-[#F3F4F6] ${
                      r.attemptCount === 0 ? "text-[#9CA3AF]" : ""
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <Link
                        href={`/training/history?userId=${r.userId}`}
                        className="text-[#2563EB] hover:underline"
                      >
                        {r.userName}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-[#374151]">{r.quizTitle}</td>
                    <td className="py-2.5 px-3">{r.attemptCount}回</td>
                    <td className="py-2.5 px-3">{r.bestLabel ?? "—"}</td>
                    <td className="py-2.5 px-3">
                      {r.clearLabel.startsWith("✓") ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
                          {r.clearLabel}
                        </span>
                      ) : (
                        <span className={r.clearLabel === "未受験" ? "text-[#9CA3AF]" : "text-[#6B7280]"}>
                          {r.clearLabel}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* セクション2: 設問別の誤答率 */}
      <section className="mt-8">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[16px] font-semibold text-[#374151]">設問別の誤答率</h2>
          <select
            value={statsQuizKey}
            onChange={(e) => setStatsQuizKey(e.target.value)}
            className={selectClass}
          >
            <option value="">教材: すべて</option>
            {quizzes.map((q) => (
              <option key={q.quizKey} value={q.quizKey}>
                {q.title}
              </option>
            ))}
          </select>
        </div>

        {statsLoading ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
        ) : stats.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">まだ回答データがありません</p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                  <th className="py-2.5 px-3 font-medium">設問</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">出題回数</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">誤答回数</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">誤答率</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const highlight = s.wrongRate >= 0.5;
                  return (
                    <tr
                      key={s.qid}
                      className={`border-b border-[#F3F4F6] ${highlight ? "bg-[#FEF2F2]" : ""}`}
                    >
                      <td className="py-2.5 px-3 text-[#374151]">
                        <span className="text-[#6B7280]">[{s.category}]</span> {s.questionText}
                      </td>
                      <td className="py-2.5 px-3">{s.total}回</td>
                      <td className="py-2.5 px-3">{s.wrong}回</td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          highlight ? "text-[#DC2626]" : "text-[#374151]"
                        }`}
                      >
                        {Math.round(s.wrongRate * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* セクションA: 振り返りの提出状況 */}
      <section className="mt-8">
        <h2 className="text-[16px] font-semibold text-[#374151] mb-3">振り返りの提出状況</h2>
        {matrixDates.length === 0 ? (
          <p className="py-4 text-[14px] text-[#6B7280]">振り返りはまだありません</p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                  <th className="py-2.5 px-3 font-medium">社員</th>
                  {matrixDates.map((d) => (
                    <th key={d} className="py-2.5 px-3 font-medium whitespace-nowrap">
                      {formatMd(d)}
                    </th>
                  ))}
                  <th className="py-2.5 px-3 font-medium">提出率</th>
                </tr>
              </thead>
              <tbody>
                {matrixUsers.map((u) => {
                  const submitted = matrixDates.filter((d) => {
                    const r = reflectionByUserDate.get(`${u.id}|${d}`);
                    return r && !r.isDraft;
                  }).length;
                  return (
                    <tr key={u.id} className="border-b border-[#F3F4F6]">
                      <td className="py-2.5 px-3 text-[#374151] whitespace-nowrap">{u.name}</td>
                      {matrixDates.map((d) => {
                        const r = reflectionByUserDate.get(`${u.id}|${d}`);
                        if (!r) {
                          return (
                            <td key={d} className="py-2.5 px-3 text-[#9CA3AF] whitespace-nowrap">
                              未提出
                            </td>
                          );
                        }
                        return (
                          <td key={d} className="py-2.5 px-3 whitespace-nowrap">
                            <button
                              onClick={() => setDetailReflection(r)}
                              className={`hover:underline ${
                                r.isDraft ? "text-[#6B7280]" : "text-[#16A34A] font-medium"
                              }`}
                            >
                              {r.isDraft ? "下書き" : "✓提出"}
                            </button>
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3">
                        {Math.round((submitted / matrixDates.length) * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* セクションC: 記述ワーク回答 */}
      <WorkAnswersSection />

      {/* セクションB: 理解度の集計 */}
      <section className="mt-8 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[16px] font-semibold text-[#374151]">理解度の集計</h2>
          <select value={rStatsDay} onChange={(e) => setRStatsDay(e.target.value)} className={selectClass}>
            <option value="">研修日: すべて</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCheckItemsOpen(true)}
            className="px-3 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
          >
            項目を管理
          </button>
        </div>

        {rStatsLoading ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">読み込み中...</p>
        ) : rStats.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[#6B7280]">まだ回答データがありません</p>
        ) : (
          <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                  <th className="py-2.5 px-3 font-medium">項目</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">回答者</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">◎A / ○B / △C / ×D</th>
                  <th className="py-2.5 px-3 font-medium whitespace-nowrap">あいまい以下（C+D）</th>
                </tr>
              </thead>
              <tbody>
                {rStats.map((s) => {
                  // C+D が50%以上 = 研修内容そのものの改善対象として強調する
                  const highlight = s.cdRate >= 0.5;
                  return (
                    <tr
                      key={s.itemId}
                      className={`border-b border-[#F3F4F6] ${highlight ? "bg-[#FEF2F2]" : ""}`}
                    >
                      <td className="py-2.5 px-3 text-[#374151]">
                        <span className="text-[#6B7280]">[{s.dayLabel}]</span> {s.itemLabel}
                      </td>
                      <td className="py-2.5 px-3">{s.total}名</td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {s.countA} / {s.countB} / {s.countC} / {s.countD}
                      </td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          highlight ? "text-[#DC2626]" : "text-[#374151]"
                        }`}
                      >
                        {s.cdCount}名（{Math.round(s.cdRate * 100)}%）
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detailReflection && (
        <ReflectionDetailModal r={detailReflection} onClose={() => setDetailReflection(null)} />
      )}
      {checkItemsOpen && <CheckItemsModal onClose={() => setCheckItemsOpen(false)} />}
    </div>
  );
}
