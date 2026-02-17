"use client";

import { useState, useEffect, useCallback } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";

type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
  status: "active" | "disabled";
  createdAt: string;
};

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

export default function MasterPage() {
  // 社員
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState("");

  // 求職者
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");

  // 社員一覧取得
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/master/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data);
      }
    } catch {
      console.error("Failed to fetch employees");
    }
  }, []);

  // 求職者一覧取得
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
    fetchEmployees();
    fetchCandidates();
  }, [fetchEmployees, fetchCandidates]);

  // 社員登録
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmployeeError("");
    setEmployeeLoading(true);

    try {
      const res = await fetch("/api/master/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeNumber: employeeNumber.trim(),
          name: employeeName,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEmployeeError(data.error || "登録に失敗しました");
        return;
      }

      setEmployeeNumber("");
      setEmployeeName("");
      fetchEmployees();
    } catch {
      setEmployeeError("登録に失敗しました");
    } finally {
      setEmployeeLoading(false);
    }
  };

  // 求職者登録
  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCandidateError("");
    setCandidateLoading(true);

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
        setCandidateError(data.error || "登録に失敗しました");
        return;
      }

      setCandidateNumber("");
      setCandidateName("");
      fetchCandidates();
    } catch {
      setCandidateError("登録に失敗しました");
    } finally {
      setCandidateLoading(false);
    }
  };

  return (
    <div>
      <PageTitle>マスター管理</PageTitle>
      <PageSubtleText>社員・求職者の基本情報を管理します</PageSubtleText>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 社員マスター */}
        <Card>
          <CardHeader title="社員マスター" />
          <CardBody>
            <form onSubmit={handleAddEmployee} className="mb-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="社員番号"
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  required
                />
                <input
                  type="text"
                  placeholder="氏名"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  required
                />
              </div>
              {employeeError && (
                <p className="text-[13px] text-[#DC2626]">{employeeError}</p>
              )}
              <button
                type="submit"
                disabled={employeeLoading}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {employeeLoading ? "登録中..." : "社員を追加"}
              </button>
            </form>

            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>社員番号</Th>
                    <Th>氏名</Th>
                    <Th>ステータス</Th>
                    <Th>登録日時</Th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.id}>
                      <Td>
                        <span className="font-mono text-[13px]">{emp.employeeNumber}</span>
                      </Td>
                      <Td>{emp.name}</Td>
                      <Td>
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[12px] text-white ${
                            emp.status === "active" ? "bg-[#16A34A]" : "bg-[#6B7280]"
                          }`}
                        >
                          {emp.status === "active" ? "有効" : "無効"}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px] text-[#374151]/70">
                          {formatDate(emp.createdAt)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-[14px] text-[#374151]/60">
                        社員が登録されていません
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>

        {/* 求職者マスター */}
        <Card>
          <CardHeader title="求職者マスター" />
          <CardBody>
            <form onSubmit={handleAddCandidate} className="mb-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="求職者番号"
                  value={candidateNumber}
                  onChange={(e) => setCandidateNumber(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  required
                />
                <input
                  type="text"
                  placeholder="氏名"
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  required
                />
              </div>
              {candidateError && (
                <p className="text-[13px] text-[#DC2626]">{candidateError}</p>
              )}
              <button
                type="submit"
                disabled={candidateLoading}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {candidateLoading ? "登録中..." : "求職者を追加"}
              </button>
            </form>

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
                      <td colSpan={3} className="py-6 text-center text-[14px] text-[#374151]/60">
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
