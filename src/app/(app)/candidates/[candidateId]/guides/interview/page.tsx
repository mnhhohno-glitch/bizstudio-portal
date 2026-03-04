"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import GuideForm from "@/components/guides/GuideForm";
import { interviewGuideConfig } from "@/lib/guides/interview/config";

type GuideEntry = {
  id: string;
  data: Record<string, string>;
  updatedAt: string;
};

export default function CaInterviewGuidePage() {
  const params = useParams();
  const candidateId = params.candidateId as string;

  const [guideEntry, setGuideEntry] = useState<GuideEntry | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/guides/interview`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "データの取得に失敗しました");
        return;
      }
      const data = await res.json();
      setGuideEntry(data.guideEntry);
      setCandidateName(data.candidate.name);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async (data: Record<string, string>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/guides/interview`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      if (res.ok) {
        const result = await res.json();
        setGuideEntry(result.guideEntry);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/guides/interview/token`);
      if (!res.ok) return;
      const data = await res.json();
      const fullUrl = data.url.startsWith("http")
        ? data.url
        : `${window.location.origin}/g/${data.token}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>;
  }

  if (error) {
    return (
      <div>
        <Link href="/admin/master" className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6">
          ← 求職者一覧に戻る
        </Link>
        <div className="py-12 text-center text-[#DC2626]">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/master"
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6"
      >
        ← 求職者一覧に戻る
      </Link>

      <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-[20px] font-semibold text-[#374151]">
              {candidateName} さんの{interviewGuideConfig.title}
            </h1>
            <p className="text-[14px] text-[#6B7280] mt-1">
              {interviewGuideConfig.description}
            </p>
          </div>
          <button
            onClick={handleCopyUrl}
            className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB] shrink-0"
          >
            {copied ? "✅ コピーしました" : "🔗 求職者用URLをコピー"}
          </button>
        </div>

        <GuideForm
          config={interviewGuideConfig}
          data={(guideEntry?.data as Record<string, string>) || {}}
          onSave={handleSave}
          isSaving={saving}
          lastUpdated={guideEntry?.updatedAt}
        />
      </div>
    </div>
  );
}
