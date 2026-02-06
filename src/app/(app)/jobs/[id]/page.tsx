"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageTitle } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { DUMMY_JOBS, generateJobCodeBlock } from "@/lib/dummyJobs";

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [copied, setCopied] = useState(false);

  const job = useMemo(() => DUMMY_JOBS.find((j) => j.id === jobId), [jobId]);
  const codeBlock = useMemo(() => (job ? generateJobCodeBlock(job) : ""), [job]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeBlock);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("コピーに失敗しました");
    }
  }

  async function handleExport() {
    if (!job) return;
    try {
      const res = await fetch("/api/jobs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: [job.id] }),
      });
      if (!res.ok) {
        alert("エクスポートに失敗しました");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `job_${job.seq_no}_${job.company_name}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("エクスポートに失敗しました");
    }
  }

  if (!job) {
    return (
      <div>
        <PageTitle>求人が見つかりません</PageTitle>
        <div className="mt-4">
          <Link href="/jobs" className="text-[14px] text-[#2563EB] hover:underline">
            ← 一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Link href="/jobs" className="text-[14px] text-[#2563EB] hover:underline">
          ← 一覧に戻る
        </Link>
      </div>

      <div className="mt-4">
        <PageTitle>{job.company_name}</PageTitle>
        <p className="mt-1 text-[14px] text-[#374151]/80">{job.job_title}</p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* メイン：コードブロック */}
        <Card>
          <CardHeader
            title="コードブロック形式テキスト"
            right={
              <div className="flex gap-2">
                <button
                  className={[
                    "rounded-md px-4 py-2 text-[14px] font-medium transition-colors",
                    copied
                      ? "bg-[#16A34A] text-white"
                      : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]",
                  ].join(" ")}
                  onClick={handleCopy}
                >
                  {copied ? "コピーしました!" : "コピー"}
                </button>
                <button
                  className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                  onClick={handleExport}
                >
                  Excel出力
                </button>
              </div>
            }
          />
          <CardBody>
            <pre className="whitespace-pre-wrap rounded-md border border-[#E5E7EB] bg-[#F5F7FA] p-4 font-mono text-[13px] leading-[1.6] text-[#374151]">
              {codeBlock}
            </pre>
          </CardBody>
        </Card>

        {/* サイド：メタ情報 */}
        <Card>
          <CardHeader title="メタ情報" />
          <CardBody>
            <div className="space-y-4">
              <div>
                <div className="text-[12px] text-[#374151]/70">求人ID</div>
                <div className="font-mono text-[14px]">{job.id}</div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">連番</div>
                <div className="text-[14px]">{job.seq_no}</div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">求人DB</div>
                <div className="text-[14px]">
                  <span className="inline-block rounded bg-[#E5E7EB] px-2 py-0.5 text-[12px]">
                    {job.job_db}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">勤務地</div>
                <div className="text-[14px]">{job.location}</div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">年収</div>
                <div className="text-[14px]">{job.salary}</div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">転勤</div>
                <div className="text-[14px]">{job.transfer}</div>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">求人URL</div>
                <a
                  href={job.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[14px] text-[#2563EB] hover:underline"
                >
                  {job.source_url}
                </a>
              </div>
              <div>
                <div className="text-[12px] text-[#374151]/70">更新日時</div>
                <div className="font-mono text-[12px] text-[#374151]/70">
                  {new Date(job.updated_at).toLocaleString("ja-JP")}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
