"use client";

import { useState, useEffect, useCallback } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";

type Candidate = {
  id: string;
  candidateNumber: string;
  name: string;
  createdAt: string;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ja-JP");
  } catch {
    return iso;
  }
}

export default function CandidateMasterPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/master/candidates");
      if (res.ok) {
        const data = await res.json();
        setCandidates(data);
      }
    } catch {
      console.error("Failed to fetch candidates");
    }
  }, []);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleAddCandidate = async (e: React.FormEvent) => {
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
      fetchCandidates();
    } catch {
      setError("登録に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageTitle>求職者管理</PageTitle>
      <PageSubtleText>求職者の基本情報を管理します（求職者番号・氏名）</PageSubtleText>

      <div className="mt-6">
        <Card>
          <CardHeader title="求職者マスター" />
          <CardBody>
            {/* 登録フォーム */}
            <form onSubmit={handleAddCandidate} className="mb-6">
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

            {/* 一覧テーブル */}
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>求職者番号</Th>
                    <Th>氏名</Th>
                    <Th>登録日時</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((cand) => (
                    <tr key={cand.id}>
                      <Td>
                        <span className="font-mono text-[13px]">{cand.candidateNumber}</span>
                      </Td>
                      <Td>{cand.name}</Td>
                      <Td>
                        <span className="font-mono text-[12px] text-[#374151]/70">
                          {formatDate(cand.createdAt)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-[14px] text-[#374151]/60">
                        求職者が登録されていません
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
