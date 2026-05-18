"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import RpaErrorNav from "@/components/rpa-error/RpaErrorNav";
import { formatDateTimeJST } from "@/lib/rpa-error/formatDate";

type ProcessingLog = {
  id: string;
  candidateId: string | null;
  phoneNormalized: string | null;
  candidateName: string | null;
  candidateAge: number | null;
  status: string;
  reason: string | null;
  canSendReply: boolean;
  replySentAt: string | null;
  replyResult: string | null;
  processedAt: string;
  candidate: { id: string; candidateNumber: string; name: string } | null;
};

type Batch = {
  id: string;
  machineNumber: number;
  flowName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  totalCount: number;
  normalCount: number;
  ageNgCount: number;
  foreignNgCount: number;
  aiFailedCount: number;
  duplicateSkipCount: number;
  errorCount: number;
  errorMessage: string | null;
  processingLogs: ProcessingLog[];
};

const BATCH_STATUS_LABEL: Record<string, string> = {
  RUNNING: "実行中",
  COMPLETED: "完了",
  FAILED: "失敗",
};

const LOG_STATUS: Record<string, { label: string; style: string }> = {
  NORMAL: { label: "通常送信", style: "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]" },
  AGE_NG: { label: "年齢NG", style: "border-[#D97706]/30 bg-[#D97706]/10 text-[#D97706]" },
  FOREIGN_NG: { label: "外国籍NG", style: "border-[#D97706]/30 bg-[#D97706]/10 text-[#D97706]" },
  AI_FAILED: { label: "AI解析失敗", style: "border-[#9CA3AF]/30 bg-[#9CA3AF]/10 text-[#6B7280]" },
  DUPLICATE_SKIP: { label: "二重処理スキップ", style: "border-[#9CA3AF]/30 bg-[#9CA3AF]/10 text-[#6B7280]" },
  ERROR: { label: "エラー", style: "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]" },
};

export default function RpaExecutionDetailPage() {
  const params = useParams();
  const batchId = params.batchId as string;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/rpa-error/executions/${batchId}`);
    if (res.ok) {
      const data = await res.json();
      setBatch(data.batch);
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <RpaErrorNav />
      <Link
        href="/rpa-error/executions"
        className="text-[13px] text-[#2563EB] hover:underline"
      >
        ← 実行履歴一覧へ戻る
      </Link>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : !batch ? (
        <p className="mt-6 text-[#9CA3AF]">バッチが見つかりません</p>
      ) : (
        <>
          {/* バッチ情報カード */}
          <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
            <div className="flex items-center gap-3">
              <h1 className="text-[18px] font-bold text-[#374151]">
                {batch.machineNumber}号機 実行バッチ
              </h1>
              <span className="rounded-full border border-[#E5E7EB] px-2 py-0.5 text-[12px] text-[#6B7280]">
                {BATCH_STATUS_LABEL[batch.status] || batch.status}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] text-[#374151] md:grid-cols-3">
              <div>フロー: {batch.flowName}</div>
              <div>開始: {formatDateTimeJST(batch.startedAt)}</div>
              <div>
                完了: {batch.finishedAt ? formatDateTimeJST(batch.finishedAt) : "—"}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[#374151]">
              <span>処理総数: {batch.totalCount}</span>
              <span>通常送信: {batch.normalCount}</span>
              <span>年齢NG: {batch.ageNgCount}</span>
              <span>外国籍NG: {batch.foreignNgCount}</span>
              <span>AI解析失敗: {batch.aiFailedCount}</span>
              <span>二重処理スキップ: {batch.duplicateSkipCount}</span>
              <span>エラー: {batch.errorCount}</span>
            </div>
            {batch.errorMessage && (
              <p className="mt-3 rounded bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#DC2626]">
                {batch.errorMessage}
              </p>
            )}
          </div>

          {/* 処理ログテーブル */}
          <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
            <table className="w-full text-[14px]">
              <thead className="bg-[#F9FAFB] text-[13px] text-[#6B7280]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">処理時刻</th>
                  <th className="px-4 py-3 text-left font-medium">氏名</th>
                  <th className="px-4 py-3 text-left font-medium">電話番号</th>
                  <th className="px-4 py-3 text-left font-medium">ステータス</th>
                  <th className="px-4 py-3 text-left font-medium">理由</th>
                  <th className="px-4 py-3 text-left font-medium">求職者</th>
                </tr>
              </thead>
              <tbody>
                {batch.processingLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">
                      処理ログがありません
                    </td>
                  </tr>
                ) : (
                  batch.processingLogs.map((log) => {
                    const s = LOG_STATUS[log.status] || {
                      label: log.status,
                      style: "border-[#E5E7EB] text-[#6B7280]",
                    };
                    return (
                      <tr key={log.id} className="border-t border-[#F3F4F6]">
                        <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
                          {formatDateTimeJST(log.processedAt)}
                        </td>
                        <td className="px-4 py-3">{log.candidateName || "—"}</td>
                        <td className="px-4 py-3 text-[13px]">
                          {log.phoneNormalized || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[12px] ${s.style}`}
                          >
                            {s.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[13px] text-[#374151]">
                          {log.reason || "—"}
                        </td>
                        <td className="px-4 py-3 text-[13px]">
                          {log.candidate ? (
                            <Link
                              href={`/candidates/${log.candidate.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#2563EB] hover:underline"
                            >
                              {log.candidate.candidateNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
