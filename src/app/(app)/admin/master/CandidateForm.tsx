"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
};

type Props = {
  employees: Employee[];
};

export default function CandidateForm({ employees }: Props) {
  const router = useRouter();
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [gender, setGender] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!employeeId) {
      setError("担当キャリアアドバイザーを選択してください");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/master/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateNumber: candidateNumber.trim(),
          name: candidateName.trim(),
          nameKana: nameKana.trim(),
          gender,
          employeeId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "登録に失敗しました");
        return;
      }

      setCandidateNumber("");
      setCandidateName("");
      setNameKana("");
      setGender("");
      setEmployeeId("");
      router.refresh();
    } catch {
      setError("登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="text-[12px] text-[#374151]/80">
            求職者番号 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="例: 5001234"
            value={candidateNumber}
            onChange={(e) => setCandidateNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">
            氏名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="例: 山田 太郎"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">
            ふりがな <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="例: やまだ たろう"
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">
            性別 <span className="text-red-500">*</span>
          </label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          >
            <option value="">選択してください</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
          </select>
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">
            担当キャリアアドバイザー <span className="text-red-500">*</span>
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            required
          >
            <option value="">選択してください</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
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
