"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Table, TableWrap, Td, Th } from "@/components/ui/Table";
import { DUMMY_AI_JOBS, DummyAiJob } from "@/lib/dummyAiJobs";

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusLabel(s: DummyAiJob["status"]) {
  if (s === "completed") return "完了";
  if (s === "processing") return "処理中";
  return "失敗";
}

function statusColor(s: DummyAiJob["status"]) {
  if (s === "completed") return "#16A34A";
  if (s === "processing") return "#2563EB";
  return "#DC2626";
}

export default function AiJobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState(DUMMY_AI_JOBS);

  const handleAddDummy = () => {
    const newJob: DummyAiJob = {
      id: `AJ-2024-${String(jobs.length + 1).padStart(3, "0")}`,
      executedAt: new Date().toISOString(),
      candidateName: "新規 求職者",
      caName: "担当 CA",
      jobDb: "リクナビNEXT",
      areas: ["東京都"],
      jobCount: Math.floor(Math.random() * 100) + 1,
      status: "processing",
    };
    setJobs([newJob, ...jobs]);
  };

  const handleRowClick = (id: string) => {
    router.push(`/ai-jobs/${id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <PageTitle>AIジョブ（解析履歴）</PageTitle>
          <PageSubtleText>求職者ごと・処理単位ごとの解析履歴です。クリックで詳細へ移動します。</PageSubtleText>
        </div>
        <button
          type="button"
          onClick={handleAddDummy}
          className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] transition-colors"
        >
          新規ジョブ（ダミー作成）
        </button>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="解析履歴" />
          <CardBody>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>実行日時</Th>
                    <Th>求職者名</Th>
                    <Th>担当CA</Th>
                    <Th>求人DB</Th>
                    <Th>対象エリア</Th>
                    <Th>求人数</Th>
                    <Th>ステータス</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="cursor-pointer transition-colors hover:bg-[#F5F7FA]"
                      onClick={() => handleRowClick(job.id)}
                    >
                      <Td>
                        <span className="font-mono text-[13px]">{formatDateTime(job.executedAt)}</span>
                      </Td>
                      <Td>{job.candidateName}</Td>
                      <Td>{job.caName}</Td>
                      <Td>{job.jobDb}</Td>
                      <Td>
                        <span className="text-[13px]">{job.areas.join(", ")}</span>
                      </Td>
                      <Td>
                        <span className="font-mono">{job.jobCount}</span>
                      </Td>
                      <Td>
                        <span
                          className="inline-block rounded px-2 py-0.5 text-[12px] text-white"
                          style={{ backgroundColor: statusColor(job.status) }}
                        >
                          {statusLabel(job.status)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[14px] text-[#374151]/60">
                        解析履歴がありません
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
