"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";
import { PageTitle } from "@/components/ui/PageTitle";
import { Card, CardBody } from "@/components/ui/Card";
import { DUMMY_AI_JOBS } from "@/lib/dummyAiJobs";

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

function statusLabel(s: string) {
  if (s === "completed") return "完了";
  if (s === "processing") return "処理中";
  return "失敗";
}

function statusColor(s: string) {
  if (s === "completed") return "#16A34A";
  if (s === "processing") return "#2563EB";
  return "#DC2626";
}

export default function AiJobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const job = useMemo(() => DUMMY_AI_JOBS.find((j) => j.id === jobId), [jobId]);

  if (!job) {
    return (
      <div>
        <PageTitle>AIジョブ詳細</PageTitle>
        <div className="mt-6">
          <Card>
            <CardBody>
              <p className="text-[14px] text-[#374151]/70">指定されたジョブが見つかりません。</p>
              <Link
                href="/ai-jobs"
                className="mt-4 inline-block text-[14px] text-[#2563EB] hover:underline"
              >
                ← 解析履歴に戻る
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  const handleViewJobs = () => {
    router.push(`/jobs?jobId=${job.id}`);
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/ai-jobs"
          className="text-[14px] text-[#2563EB] hover:underline"
        >
          ← 解析履歴に戻る
        </Link>
      </div>

      <PageTitle>AIジョブ詳細</PageTitle>

      {/* Summary Cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">求職者名</div>
            <div className="mt-1 text-[16px] font-medium text-[#374151]">{job.candidateName}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">求人DB</div>
            <div className="mt-1 text-[16px] font-medium text-[#374151]">{job.jobDb}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">対象エリア</div>
            <div className="mt-1 text-[14px] text-[#374151]">{job.areas.join(", ")}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">求人数</div>
            <div className="mt-1 text-[20px] font-bold text-[#2563EB]">{job.jobCount}</div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[12px] text-[#374151]/70">最終更新</div>
            <div className="mt-1 font-mono text-[13px] text-[#374151]">{formatDateTime(job.executedAt)}</div>
            <div className="mt-1">
              <span
                className="inline-block rounded px-2 py-0.5 text-[12px] text-white"
                style={{ backgroundColor: statusColor(job.status) }}
              >
                {statusLabel(job.status)}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Actions */}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={handleViewJobs}
          className="rounded-md bg-[#2563EB] px-6 py-3 text-[14px] font-medium text-white hover:bg-[#1D4ED8] transition-colors"
        >
          このジョブの求人一覧を見る
        </button>
        <button
          type="button"
          disabled
          className="rounded-md border border-[#E5E7EB] bg-white px-6 py-3 text-[14px] text-[#374151]/50 cursor-not-allowed"
        >
          全件Excel出力（準備中）
        </button>
      </div>

      {/* Note */}
      <div className="mt-8 rounded-md border border-[#E5E7EB] bg-[#F5F7FA] p-4">
        <p className="text-[13px] text-[#374151]/70">
          この画面は統合の骨格です。後続タスクで既存解析システムと接続し、jobIdで求人を絞り込む機能を実装します。
        </p>
      </div>
    </div>
  );
}
