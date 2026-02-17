"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CandidateForm() {
  const router = useRouter();
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/master/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateNumber: candidateNumber.trim(),
          name: candidateName,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登録に失敗しました");
        return;
      }

      setCandidateNumber("");
      setCandidateName("");
      router.refresh(); // サーバーコンポーネントを再取得
    } catch {
      setError("登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6">
      <div className="grid gap-4 sm:grid-cols-[200px_1fr_auto]">
        <div>
          <label className="text-[12px] text-[#374151]/80">求職者番号</label>
          <input
            type="text"
            placeholder="例: C-001"
            value={candidateNumber}
            onChange={(e) => setCandidateNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">氏名</label>
          <input
            type="text"
            placeholder="例: 山田 太郎"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-[#2563EB] px-6 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {loading ? "登録中..." : "求職者を追加"}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-[13px] text-[#DC2626]">{error}</p>
      )}
    </form>
  );
}
