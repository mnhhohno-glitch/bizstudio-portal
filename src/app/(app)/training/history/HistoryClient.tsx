"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

type Attempt = {
  id: string;
  userId: string;
  userName: string;
  quizKey: string;
  quizTitle: string;
  mode: string;
  round: number;
  totalQuestions: number;
  correctCount: number;
  cleared: boolean;
  startedAt: string;
  finishedAt: string;
};

type Answer = {
  id: string;
  qid: string;
  category: string;
  questionText: string;
  chosenText: string;
  correctText: string;
  isCorrect: boolean;
  position: number;
};

type AttemptDetail = Attempt & { answers: Answer[] };

type UserOption = { id: string; name: string | null };
type QuizOption = { quizKey: string; title: string };

// 日時表示は JST 固定（罠#17: Railway 本番は UTC）
function formatJstDateTime(dt: string): string {
  const d = new Date(dt);
  const date = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const time = d.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

function formatJstTime(dt: string): string {
  return new Date(dt).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailModal({ attemptId, onClose }: { attemptId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState("");
  const [wrongOnly, setWrongOnly] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/training/quiz-attempts/${attemptId}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data.attempt);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "詳細の取得に失敗しました");
      }
    })();
  }, [attemptId]);

  const rows = detail
    ? wrongOnly
      ? detail.answers.filter((a) => !a.isCorrect)
      : detail.answers
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {error ? (
          <p className="text-[14px] text-[#DC2626]">{error}</p>
        ) : !detail ? (
          <p className="text-[14px] text-[#6B7280]">読み込み中...</p>
        ) : (
          <>
            <h2 className="text-[16px] font-semibold text-[#374151]">
              {detail.quizTitle} ／ {detail.mode} ／ {detail.round}周目
              {detail.cleared && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[12px]">
                  ✓ クリア
                </span>
              )}
            </h2>
            <p className="mt-1 text-[13px] text-[#6B7280]">
              {detail.userName} ／ {formatJstDateTime(detail.startedAt)} - {formatJstTime(detail.finishedAt)}
              　正答 {detail.correctCount}/{detail.totalQuestions}（
              {Math.round((detail.correctCount / detail.totalQuestions) * 100)}%）
            </p>

            <div className="mt-4 flex gap-1">
              <button
                onClick={() => setWrongOnly(true)}
                className={`px-3 py-1.5 text-[13px] rounded-md border ${
                  wrongOnly
                    ? "bg-[#2563EB] text-white border-[#2563EB]"
                    : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
                }`}
              >
                誤答のみ
              </button>
              <button
                onClick={() => setWrongOnly(false)}
                className={`px-3 py-1.5 text-[13px] rounded-md border ${
                  !wrongOnly
                    ? "bg-[#2563EB] text-white border-[#2563EB]"
                    : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
                }`}
              >
                全件表示
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="mt-4 text-[14px] text-[#16A34A]">誤答はありません（全問正解）</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-[13px] border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                      <th className="py-2 pr-2 font-medium w-10">#</th>
                      <th className="py-2 pr-2 font-medium">設問</th>
                      <th className="py-2 pr-2 font-medium">選んだ答え</th>
                      <th className="py-2 pr-2 font-medium">正解</th>
                      <th className="py-2 font-medium w-10">判定</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr
                        key={a.id}
                        className={`border-b border-[#F3F4F6] align-top ${
                          a.isCorrect ? "" : "bg-[#FEF2F2]"
                        }`}
                      >
                        <td className="py-2 pr-2 text-[#6B7280]">{a.position}</td>
                        <td className="py-2 pr-2 text-[#374151]">
                          <span className="text-[#6B7280]">[{a.category}]</span> {a.questionText}
                        </td>
                        <td className={`py-2 pr-2 ${a.isCorrect ? "text-[#374151]" : "text-[#DC2626]"}`}>
                          {a.chosenText}
                        </td>
                        <td className="py-2 pr-2 text-[#374151]">{a.correctText}</td>
                        <td className={`py-2 font-semibold ${a.isCorrect ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                          {a.isCorrect ? "○" : "✗"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          </>
        )}
      </div>
    </div>
  );
}

function HistoryList({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams();

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [quizzes, setQuizzes] = useState<QuizOption[]>([]);

  // フィルタ入力値（絞り込むボタンで適用）
  const [userId, setUserId] = useState(searchParams.get("userId") || "");
  const [quizKey, setQuizKey] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // 適用済みフィルタ
  const [applied, setApplied] = useState({
    userId: searchParams.get("userId") || "",
    quizKey: "",
    from: "",
    to: "",
  });

  const limit = 50;

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/admin/users")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.users) {
            setUsers(
              d.users
                .filter((u: { status: string }) => u.status === "active")
                .map((u: { id: string; name: string | null }) => ({ id: u.id, name: u.name }))
            );
          }
        });
    }
    fetch("/api/training-materials")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.materials) {
          const qs: QuizOption[] = d.materials
            .filter((m: { quizKey: string | null }) => m.quizKey)
            .map((m: { quizKey: string; title: string }) => ({ quizKey: m.quizKey, title: m.title }));
          setQuizzes(qs);
        }
      });
  }, [isAdmin]);

  const fetchAttempts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (applied.userId) params.set("userId", applied.userId);
      if (applied.quizKey) params.set("quizKey", applied.quizKey);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await fetch(`/api/training/quiz-attempts?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAttempts(data.attempts);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const selectClass =
    "px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[#374151]">回答履歴</h1>
        <span className="text-[14px] text-[#6B7280]">全 {total} 件</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isAdmin && (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={selectClass}>
            <option value="">社員: すべて</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? "(名前未設定)"}
              </option>
            ))}
          </select>
        )}
        <select value={quizKey} onChange={(e) => setQuizKey(e.target.value)} className={selectClass}>
          <option value="">教材: すべて</option>
          {quizzes.map((q) => (
            <option key={q.quizKey} value={q.quizKey}>
              {q.title}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
        <span className="text-[#6B7280]">〜</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} />
        <button
          onClick={() => {
            setPage(1);
            setApplied({ userId, quizKey, from, to });
          }}
          className="px-4 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
        >
          絞り込む
        </button>
      </div>

      <hr className="my-4 border-[#E5E7EB]" />

      {loading ? (
        <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>
      ) : attempts.length === 0 ? (
        <div className="py-12 text-center text-[#6B7280]">回答履歴はまだありません</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-[8px] border border-[#E5E7EB]">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                <th className="py-2.5 px-3 font-medium">日時</th>
                <th className="py-2.5 px-3 font-medium">社員</th>
                <th className="py-2.5 px-3 font-medium">教材</th>
                <th className="py-2.5 px-3 font-medium">範囲</th>
                <th className="py-2.5 px-3 font-medium">周回</th>
                <th className="py-2.5 px-3 font-medium">正答</th>
                <th className="py-2.5 px-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="py-2.5 px-3 text-[#6B7280] whitespace-nowrap">
                    {formatJstDateTime(a.finishedAt)}
                  </td>
                  <td className="py-2.5 px-3 text-[#374151]">{a.userName}</td>
                  <td className="py-2.5 px-3 text-[#374151]">{a.quizTitle}</td>
                  <td className="py-2.5 px-3 text-[#374151]">{a.mode}</td>
                  <td className="py-2.5 px-3 text-[#374151] whitespace-nowrap">
                    {a.round}周目
                    {a.cleared && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A] text-[11px]">
                        ✓
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[#374151] whitespace-nowrap">
                    {a.correctCount}/{a.totalQuestions}（
                    {Math.round((a.correctCount / a.totalQuestions) * 100)}%）
                  </td>
                  <td className="py-2.5 px-3">
                    <button
                      onClick={() => setDetailId(a.id)}
                      className="px-3 py-1 text-[13px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-[14px] border border-[#E5E7EB] rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F9FAFB]"
          >
            &lt; 前へ
          </button>
          <span className="text-[14px] text-[#6B7280]">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-[14px] border border-[#E5E7EB] rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F9FAFB]"
          >
            次へ &gt;
          </button>
        </div>
      )}

      {detailId && <DetailModal attemptId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export default function HistoryClient({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Suspense fallback={<div className="py-12 text-center text-[#6B7280]">読み込み中...</div>}>
      <HistoryList isAdmin={isAdmin} />
    </Suspense>
  );
}
