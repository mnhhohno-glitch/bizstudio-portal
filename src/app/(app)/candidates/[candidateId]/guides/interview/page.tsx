"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import InterviewGuideContent from "@/components/guides/interview/InterviewGuideContent";

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
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyText, setCopyText] = useState("🔗 求職者用URLをコピー");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/guides/interview`);
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "データの取得に失敗しました");
        return;
      }
      const json = await res.json();
      setGuideEntry(json.guideEntry);
      setCandidateName(json.candidate.name);
      setData((json.guideEntry?.data as Record<string, string>) || {});
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
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
      const json = await res.json();
      const fullUrl = json.url.startsWith("http")
        ? json.url
        : `${window.location.origin}/g/${json.token}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopyText("✅ コピーしました");
      setTimeout(() => setCopyText("🔗 求職者用URLをコピー"), 2000);
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
        <Link href={`/candidates/${candidateId}`} className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6">
          ← 求職者詳細に戻る
        </Link>
        <div className="py-12 text-center text-[#DC2626]">{error}</div>
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <Link
        href={`/candidates/${candidateId}`}
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-1"
      >
        ← 求職者詳細に戻る
      </Link>

      <div className="max-w-7xl mx-auto">
        <InterviewGuideContent
          candidateName={candidateName}
          data={data}
          onChange={(key, value) => setData((prev) => ({ ...prev, [key]: value }))}
          onSave={handleSave}
          isSaving={saving}
          lastUpdated={guideEntry?.updatedAt}
          showCopyButton={true}
          onCopyUrl={handleCopyUrl}
          copyButtonText={copyText}
          axisResultUrl={`/candidates/${candidateId}/guides/interview/axis-result`}
        />
      </div>
    </div>
  );
}
