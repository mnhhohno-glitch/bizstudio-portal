"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import GuideForm from "@/components/guides/GuideForm";
import { interviewGuideConfig } from "@/lib/guides/interview/config";

type GuideEntry = {
  id: string;
  data: Record<string, string>;
  guideType: string;
  updatedAt: string;
};

export default function CandidateGuidePage() {
  const params = useParams();
  const token = params.token as string;

  const [guideEntry, setGuideEntry] = useState<GuideEntry | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/guides/${token}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json();
      setGuideEntry(data.guideEntry);
      setCandidateName(data.candidate.name);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async (data: Record<string, string>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/guides/${token}`, {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center">
        <p className="text-[14px] text-[#6B7280]">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F5F7FA] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-8 text-center">
          <div className="text-[32px] mb-4">⚠️</div>
          <h1 className="text-[20px] font-semibold text-[#374151] mb-2">このURLは無効です</h1>
          <p className="text-[14px] text-[#6B7280]">
            このリンクは無効か、期限が切れています。<br />
            担当のキャリアアドバイザーにお問い合わせください。
          </p>
        </div>
      </div>
    );
  }

  const config = interviewGuideConfig;

  return (
    <div className="min-h-screen bg-[#F5F7FA] py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
          <div className="mb-6">
            <h1 className="text-[20px] font-semibold text-[#374151]">{config.title}</h1>
            <p className="text-[14px] text-[#6B7280] mt-1">{candidateName} さん</p>
          </div>

          <GuideForm
            config={config}
            data={(guideEntry?.data as Record<string, string>) || {}}
            onSave={handleSave}
            isSaving={saving}
            lastUpdated={guideEntry?.updatedAt}
          />
        </div>
      </div>
    </div>
  );
}
