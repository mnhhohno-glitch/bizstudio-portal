"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AxisResult from "@/components/guides/interview/AxisResult";

export default function CandidateAxisResultPage() {
  const params = useParams();
  const token = params.token as string;

  const [content, setContent] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const backUrl = `/g/${token}`;

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/guides/${token}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = await res.json();
      setCandidateName(json.candidate?.name || "");
      const axis = (json.guideEntry?.data as Record<string, string>)?.ai_generated_axis || "";
      setContent(axis);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F7F9] flex items-center justify-center">
        <p className="text-[14px] text-[#6B7280]">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F4F7F9] flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[#DC2626] mb-4">データの取得に失敗しました</p>
          <Link href={backUrl} className="text-[#2563EB] hover:underline">
            ← ガイドに戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen bg-[#F4F7F9] flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[#6B7280] mb-4">まだ転職軸が生成されていません</p>
          <Link href={backUrl} className="text-[#2563EB] hover:underline">
            ← ガイドに戻る
          </Link>
        </div>
      </div>
    );
  }

  return <AxisResult content={content} candidateName={candidateName} backUrl={backUrl} />;
}
