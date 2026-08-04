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

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-[#374151]">研修管理</h1>

      {/* セクション1: 社員別サマリ */}
      <section className="mt-4">
        <h2 className="text-[16px] font-semibold text-[#374151] mb-3">社員別サマリ</h2>
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
            className="px-3 py-1.5 border border-[#E5E7EB] rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
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
                  // 誤答率50%以上は研修内容の改善対象として目立たせる
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
    </div>
  );
}
