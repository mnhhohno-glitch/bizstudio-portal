"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { DUMMY_JOBS } from "@/lib/dummyJobs";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("ja-JP");
  } catch {
    return iso;
  }
}

export default function JobsListPage() {
  const searchParams = useSearchParams();
  const jobId = (searchParams.get("jobId") ?? "").trim() || undefined;

  const jobs = useMemo(() => {
    if (!jobId) return DUMMY_JOBS;
    return DUMMY_JOBS.filter((j) => j.aiJobId === jobId);
  }, [jobId]);

  async function handleExportAll() {
    try {
      const res = await fetch("/api/jobs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: jobs.map((j) => j.id) }),
      });
      if (!res.ok) {
        alert("エクスポートに失敗しました");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobs_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("エクスポートに失敗しました");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <PageTitle>求人解析結果</PageTitle>
          <PageSubtleText>
            AI解析された求人データの一覧です。クリックで詳細を表示できます。
          </PageSubtleText>
        </div>
        <button
          className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8]"
          onClick={handleExportAll}
        >
          {jobId ? "絞り込み結果をExcel出力" : "全件Excel出力"}
        </button>
      </div>

      {/* 絞り込み中の表示 */}
      {jobId && (
        <div className="mt-4 flex items-center justify-between rounded-[8px] border border-[#E5E7EB] bg-white px-4 py-3">
          <div className="text-[14px] text-[#374151]">
            絞り込み中: <span className="font-medium text-[#2563EB]">jobId={jobId}</span>
          </div>
          <Link
            href="/jobs"
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1 text-[13px] text-[#374151] hover:bg-[#F5F7FA] transition-colors"
          >
            解除
          </Link>
        </div>
      )}

      <div className="mt-6">
        <Card>
          <CardHeader title={`求人一覧（${jobs.length}件）`} />
          <CardBody>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>連番</Th>
                    <Th>会社名</Th>
                    <Th>求人タイトル</Th>
                    <Th>求人DB</Th>
                    <Th>更新日時</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="cursor-pointer hover:bg-[#F5F7FA] transition-colors"
                    >
                      <Td>
                        <Link href={`/jobs/${job.id}`} className="block">
                          {job.seq_no}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/jobs/${job.id}`} className="block font-medium text-[#374151]">
                          {job.company_name}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/jobs/${job.id}`} className="block text-[#2563EB] hover:underline">
                          {job.job_title}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/jobs/${job.id}`} className="block">
                          <span className="inline-block rounded bg-[#E5E7EB] px-2 py-0.5 text-[12px]">
                            {job.job_db}
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/jobs/${job.id}`} className="block font-mono text-[12px] text-[#374151]/70">
                          {formatDate(job.updated_at)}
                        </Link>
                      </Td>
                    </tr>
                  ))}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[14px] text-[#374151]/60">
                        {jobId
                          ? "該当する求人がありません"
                          : "求人データがありません"}
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
