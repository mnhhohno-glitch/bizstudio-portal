"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import LeftColumn from "@/components/interviews/LeftColumn";
import InitialConditions from "@/components/interviews/tabs/InitialConditions";
import DesiredConditions from "@/components/interviews/tabs/DesiredConditions";
import RankEvaluation from "@/components/interviews/tabs/RankEvaluation";
import ActionItems from "@/components/interviews/tabs/ActionItems";
import MemoTab from "@/components/interviews/tabs/MemoTab";
import type { InterviewFormData, Employee, CandidateFile, CandidateInfo } from "@/components/interviews/types";

const TABS = [
  { key: "initial", label: "初期条件" },
  { key: "desired", label: "希望条件" },
  { key: "rating", label: "ランク評価" },
  { key: "action", label: "アクション" },
  { key: "existingMemo", label: "既存面談メモ" },
  { key: "prepMemo", label: "面接対策メモ" },
  { key: "referral", label: "紹介履歴" },
];

function defaultForm(candidateId: string): InterviewFormData {
  return {
    candidateId,
    interviewDate: new Date().toISOString().slice(0, 10),
    startTime: "14:00", endTime: "15:00",
    interviewTool: "オンライン", interviewerUserId: "", interviewType: "新規面談",
    resultFlag: "", interviewMemo: "", rawTranscript: "", resumePdfFileId: "", summaryText: "",
    detail: {}, rating: {},
  };
}

export default function NewInterviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const candidateId = searchParams.get("candidateId") || "";

  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [originalFiles, setOriginalFiles] = useState<CandidateFile[]>([]);
  const [form, setForm] = useState<InterviewFormData>(defaultForm(candidateId));
  const [activeTab, setActiveTab] = useState("initial");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const setDetail = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, detail: { ...prev.detail, [key]: value } }));
  }, []);
  const setRating = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, rating: { ...prev.rating, [key]: value } }));
  }, []);

  useEffect(() => {
    if (candidateId) {
      fetch(`/api/candidates/${candidateId}`)
        .then((r) => r.json()).then((d) => setCandidate(d.candidate || d)).catch(() => {});
      fetch(`/api/candidates/${candidateId}/files?category=ORIGINAL`)
        .then((r) => r.json()).then((d) => setOriginalFiles(d.files || [])).catch(() => {});
    }
    fetch("/api/employees").then((r) => r.json()).then((d) => {
      const list = d.employees || d || [];
      setEmployees(list);
      if (list.length > 0) setForm((p) => ({ ...p, interviewerUserId: p.interviewerUserId || list[0].id }));
    }).catch(() => {});
  }, [candidateId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      console.log("[analyze-client] Sending request...");
      const fd = new FormData();
      if (form.rawTranscript) fd.append("transcript", form.rawTranscript);
      const res = await fetch("/api/interviews/analyze", { method: "POST", body: fd });
      console.log("[analyze-client] Response status:", res.status);
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      const data = await res.json();
      console.log("[analyze-client] Response data:", JSON.stringify(data).substring(0, 500));
      setForm((prev) => ({
        ...prev,
        interviewMemo: data.interviewMemo || prev.interviewMemo,
        summaryText: data.summaryText || prev.summaryText,
        detail: { ...prev.detail, ...data.detail },
      }));
      toast.success("AI解析完了。各タブに反映しました。");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async (andClose = false) => {
    if (!candidateId || !form.interviewerUserId) {
      toast.error("求職者と担当CAを選択してください");
      return;
    }
    setSaving(true);
    try {
      const r = form.rating || {};
      const pT = (r.personalityMotivation||0)+(r.personalityCommunication||0)+(r.personalityManner||0)+(r.personalityIntelligence||0)+(r.personalityHumanity||0);
      const cT = (r.careerJobType||0)+(r.careerExperience||0)+(r.careerJobChangeCount||0)+(r.careerAchievement||0)+(r.careerQualification||0);
      const condT = (r.conditionJobType||0)+(r.conditionSalary||0)+(r.conditionHoliday||0)+(r.conditionArea||0)+(r.conditionFlexibility||0);
      const { id: _ri, interviewRecordId: _rr, createdAt: _rc, updatedAt: _ru, interviewRecord: _rir, ...ratingRest } = r;
      const ratingData = { ...ratingRest, personalityTotal: pT||null, careerTotal: cT||null, conditionTotal: condT||null, grandTotal: (pT+cT+condT)||null };
      const { id: _di, interviewRecordId: _dr, createdAt: _dc, updatedAt: _du, interviewRecord: _dir, ...detailData } = form.detail;

      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId, interviewDate: `${form.interviewDate}T12:00:00.000Z`,
          startTime: form.startTime, endTime: form.endTime,
          interviewTool: form.interviewTool, interviewerUserId: form.interviewerUserId,
          interviewType: form.interviewType, resultFlag: form.resultFlag || null,
          interviewMemo: form.interviewMemo || null,
          rawTranscript: form.rawTranscript || null, resumePdfFileId: form.resumePdfFileId || null,
          summaryText: form.summaryText || null, detail: detailData, rating: ratingData,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      const { record } = await res.json();
      toast.success("面談を登録しました");
      if (andClose) router.push(`/candidates/${candidateId}`);
      else router.push(`/interviews/${record.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally { setSaving(false); }
  };

  const d = form.detail || {};
  const r = form.rating || {};

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#374151]">📝 面談登録</h1>
          {candidate && (
            <Link href={`/candidates/${candidateId}`} className="text-[13px] text-[#2563EB] hover:underline">
              {candidate.name} ({candidate.candidateNumber})
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-5 lg:flex-row flex-col">
        <div className="lg:w-[40%] w-full shrink-0">
          <LeftColumn form={form} setForm={setForm} setDetail={setDetail}
            employees={employees} originalFiles={originalFiles} candidateId={candidateId}
            isNew={true} onAnalyze={handleAnalyze} analyzing={analyzing} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-[12px] font-medium border-b-2 whitespace-nowrap ${
                  activeTab === tab.key ? "text-[#2563EB] border-[#2563EB]" : "text-gray-500 border-transparent hover:text-gray-700"
                }`}>{tab.label}</button>
            ))}
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-20">
            {activeTab === "initial" && <InitialConditions d={d} set={setDetail} />}
            {activeTab === "desired" && <DesiredConditions d={d} set={setDetail} />}
            {activeTab === "rating" && <RankEvaluation r={r} set={setRating} />}
            {activeTab === "action" && <ActionItems d={d} set={setDetail} />}
            {activeTab === "existingMemo" && <MemoTab label="既存面談メモ" value={d.existingInterviewMemo || ""} onChange={(v) => setDetail("existingInterviewMemo", v)} />}
            {activeTab === "prepMemo" && <MemoTab label="面接対策メモ" value={d.interviewPrepMemo || ""} onChange={(v) => setDetail("interviewPrepMemo", v)} />}
            {activeTab === "referral" && <MemoTab label="紹介履歴" value={d.referralHistory || ""} onChange={(v) => setDetail("referralHistory", v)} />}
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex justify-center gap-3 z-40">
        <button onClick={() => handleSave(false)} disabled={saving}
          className="bg-[#2563EB] text-white rounded-lg px-6 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
          {saving ? "保存中..." : "💾 保存"}</button>
        <button onClick={() => handleSave(true)} disabled={saving}
          className="border border-gray-300 bg-white text-gray-700 rounded-lg px-6 py-2.5 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">
          保存して閉じる</button>
      </div>
    </div>
  );
}
