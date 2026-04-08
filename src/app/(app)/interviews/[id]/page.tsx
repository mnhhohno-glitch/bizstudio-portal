"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

type InterviewRecord = {
  id: string;
  candidateId: string;
  candidate: { id: string; name: string; candidateNumber: string };
  interviewer: { id: string; name: string };
  interviewDate: string;
  startTime: string;
  endTime: string;
  duration: number | null;
  interviewTool: string;
  interviewerUserId: string;
  interviewType: string;
  interviewCount: number | null;
  resultFlag: string | null;
  interviewMemo: string | null;
  previousMemo: string | null;
  summaryText: string | null;
  rawTranscript: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rating: Record<string, any> | null;
};

const TABS = [
  { key: "initial", label: "初期条件" },
  { key: "desired", label: "希望条件" },
  { key: "rating", label: "ランク評価" },
  { key: "action", label: "アクション" },
  { key: "memo", label: "面談メモ" },
] as const;

export default function InterviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [record, setRecord] = useState<InterviewRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("initial");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [form, setForm] = useState<Record<string, any>>({});

  const fetchRecord = useCallback(async () => {
    const res = await fetch(`/api/interviews/${id}`);
    if (!res.ok) { router.push("/"); return; }
    const data = await res.json();
    setRecord(data.record);
    setForm({
      interviewMemo: data.record.interviewMemo || "",
      summaryText: data.record.summaryText || "",
      resultFlag: data.record.resultFlag || "",
      detail: data.record.detail || {},
      rating: data.record.rating || {},
    });
    setLoading(false);
  }, [id, router]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  const setDetail = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, detail: { ...prev.detail, [key]: value } }));
  };

  const setRating = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, rating: { ...prev.rating, [key]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Auto-calculate rating totals
      const r = form.rating || {};
      const pTotal = (r.personalityMotivation || 0) + (r.personalityCommunication || 0) + (r.personalityManner || 0) + (r.personalityIntelligence || 0) + (r.personalityHumanity || 0);
      const cTotal = (r.careerJobType || 0) + (r.careerExperience || 0) + (r.careerJobChangeCount || 0) + (r.careerAchievement || 0) + (r.careerQualification || 0);
      const condTotal = (r.conditionJobType || 0) + (r.conditionSalary || 0) + (r.conditionHoliday || 0) + (r.conditionArea || 0) + (r.conditionFlexibility || 0);

      const ratingData = {
        ...r,
        personalityTotal: pTotal || null,
        careerTotal: cTotal || null,
        conditionTotal: condTotal || null,
        grandTotal: (pTotal + cTotal + condTotal) || null,
      };
      // Remove relation fields
      delete ratingData.id;
      delete ratingData.interviewRecordId;
      delete ratingData.createdAt;
      delete ratingData.updatedAt;
      delete ratingData.interviewRecord;

      const detailData = { ...form.detail };
      delete detailData.id;
      delete detailData.interviewRecordId;
      delete detailData.createdAt;
      delete detailData.updatedAt;
      delete detailData.interviewRecord;

      const res = await fetch(`/api/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewMemo: form.interviewMemo || null,
          summaryText: form.summaryText || null,
          resultFlag: form.resultFlag || null,
          detail: detailData,
          rating: ratingData,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("保存しました");
      fetchRecord();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">読み込み中...</div>;
  if (!record) return null;

  const d = form.detail || {};
  const r = form.rating || {};
  const inputCls = "w-full rounded-md border border-gray-300 px-3 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none";
  const selectCls = inputCls;
  const labelCls = "block text-[12px] font-medium text-[#6B7280] mb-0.5";

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#374151]">面談詳細</h1>
          <div className="text-[13px] text-gray-500 mt-1">
            <Link href={`/candidates/${record.candidateId}`} className="text-[#2563EB] hover:underline">
              {record.candidate.name} ({record.candidate.candidateNumber})
            </Link>
            <span className="mx-2">|</span>
            {new Date(record.interviewDate).toLocaleDateString("ja-JP")}
            <span className="mx-1">{record.startTime}〜{record.endTime}</span>
            <span className="mx-2">|</span>
            {record.interviewType} #{record.interviewCount}
            <span className="mx-2">|</span>
            {record.interviewer.name}
          </div>
        </div>
        <button onClick={() => router.push(`/candidates/${record.candidateId}`)}
          className="text-[13px] text-gray-500 hover:text-gray-700">← 求職者に戻る</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
              activeTab === tab.key ? "text-[#2563EB] border-[#2563EB]" : "text-gray-500 border-transparent hover:text-gray-700"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-20">
        {activeTab === "initial" && (
          <div className="space-y-6">
            <Section title="転職活動状況">
              <div className="grid grid-cols-2 gap-4">
                <Field label="AG利用" value={d.agentUsageFlag} onChange={(v) => setDetail("agentUsageFlag", v)}
                  options={["初めて利用", "利用中", "過去利用あり"]} type="select" />
                <Field label="AG利用メモ" value={d.agentUsageMemo} onChange={(v) => setDetail("agentUsageMemo", v)} />
                <Field label="在籍状況" value={d.employmentStatus} onChange={(v) => setDetail("employmentStatus", v)}
                  options={["在職中", "離職中", "退職予定"]} type="select" />
                <Field label="転職時期" value={d.jobChangeTimeline} onChange={(v) => setDetail("jobChangeTimeline", v)}
                  options={["1カ月以内", "3カ月以内", "半年以内", "未定"]} type="select" />
                <Field label="転職時期メモ" value={d.jobChangeTimelineMemo} onChange={(v) => setDetail("jobChangeTimelineMemo", v)} />
                <Field label="活動期間" value={d.activityPeriod} onChange={(v) => setDetail("activityPeriod", v)}
                  options={["1週間以内", "1カ月以内", "3カ月以内"]} type="select" />
                <Field label="応募数" value={d.currentApplicationCount} onChange={(v) => setDetail("currentApplicationCount", v ? Number(v) : null)} type="number" />
                <Field label="応募状況" value={d.applicationTypeFlag} onChange={(v) => setDetail("applicationTypeFlag", v)}
                  options={["検討中", "応募中"]} type="select" />
              </div>
              <Field label="応募メモ" value={d.applicationMemo} onChange={(v) => setDetail("applicationMemo", v)} type="textarea" />
            </Section>

            <Section title="学歴・職歴">
              <div className="grid grid-cols-2 gap-4">
                <Field label="学歴" value={d.educationFlag} onChange={(v) => setDetail("educationFlag", v)}
                  options={["大学院卒", "大卒", "短大・専門卒", "高卒"]} type="select" />
                <Field label="学歴メモ" value={d.educationMemo} onChange={(v) => setDetail("educationMemo", v)} />
                <Field label="卒業年月" value={d.graduationDate} onChange={(v) => setDetail("graduationDate", v)} />
                <Field label="企業名" value={d.companyName} onChange={(v) => setDetail("companyName", v)} />
                <Field label="事業内容" value={d.businessContent} onChange={(v) => setDetail("businessContent", v)} />
                <Field label="在籍期間" value={d.tenure} onChange={(v) => setDetail("tenure", v)} />
                <Field label="職種" value={d.jobTypeFlag} onChange={(v) => setDetail("jobTypeFlag", v)} />
                <Field label="職種メモ" value={d.jobTypeMemo} onChange={(v) => setDetail("jobTypeMemo", v)} />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4">
                <Field label="退職理由（大）" value={d.resignReasonLarge} onChange={(v) => setDetail("resignReasonLarge", v)} />
                <Field label="退職理由（中）" value={d.resignReasonMedium} onChange={(v) => setDetail("resignReasonMedium", v)} />
                <Field label="退職理由（小）" value={d.resignReasonSmall} onChange={(v) => setDetail("resignReasonSmall", v)} />
              </div>
              <Field label="転職理由メモ" value={d.jobChangeReasonMemo} onChange={(v) => setDetail("jobChangeReasonMemo", v)} type="textarea" />
              <Field label="転職軸" value={d.jobChangeAxisFlag} onChange={(v) => setDetail("jobChangeAxisFlag", v)} />
              <Field label="転職軸メモ" value={d.jobChangeAxisMemo} onChange={(v) => setDetail("jobChangeAxisMemo", v)} type="textarea" />
            </Section>
          </div>
        )}

        {activeTab === "desired" && (
          <div className="space-y-6">
            <Section title="職種・業種">
              <div className="grid grid-cols-2 gap-4">
                <Field label="第一希望職種" value={d.desiredJobType1} onChange={(v) => setDetail("desiredJobType1", v)} />
                <Field label="職種メモ" value={d.desiredJobType1Memo} onChange={(v) => setDetail("desiredJobType1Memo", v)} />
                <Field label="第二希望職種" value={d.desiredJobType2} onChange={(v) => setDetail("desiredJobType2", v)} />
                <Field label="希望業界" value={d.desiredIndustry1} onChange={(v) => setDetail("desiredIndustry1", v)} />
                <Field label="業界メモ" value={d.desiredIndustry1Memo} onChange={(v) => setDetail("desiredIndustry1Memo", v)} />
              </div>
            </Section>

            <Section title="エリア">
              <div className="grid grid-cols-2 gap-4">
                <Field label="希望エリア" value={d.desiredArea} onChange={(v) => setDetail("desiredArea", v)} />
                <Field label="都道府県" value={d.desiredPrefecture} onChange={(v) => setDetail("desiredPrefecture", v)} />
                <Field label="市区町村" value={d.desiredCity} onChange={(v) => setDetail("desiredCity", v)} />
                <Field label="エリアメモ" value={d.desiredAreaMemo} onChange={(v) => setDetail("desiredAreaMemo", v)} />
              </div>
            </Section>

            <Section title="年収">
              <div className="grid grid-cols-3 gap-4">
                <Field label="現在年収（万円）" value={d.currentSalary} onChange={(v) => setDetail("currentSalary", v ? Number(v) : null)} type="number" />
                <Field label="希望下限（万円）" value={d.desiredSalaryMin} onChange={(v) => setDetail("desiredSalaryMin", v ? Number(v) : null)} type="number" />
                <Field label="希望上限（万円）" value={d.desiredSalaryMax} onChange={(v) => setDetail("desiredSalaryMax", v ? Number(v) : null)} type="number" />
              </div>
            </Section>

            <Section title="休日・残業・転勤">
              <div className="grid grid-cols-2 gap-4">
                <Field label="休日" value={d.desiredDayOff} onChange={(v) => setDetail("desiredDayOff", v)} />
                <Field label="年間休日数" value={d.desiredHolidayCount} onChange={(v) => setDetail("desiredHolidayCount", v)} />
                <Field label="残業上限" value={d.desiredOvertimeMax} onChange={(v) => setDetail("desiredOvertimeMax", v)} />
                <Field label="転勤" value={d.desiredTransfer} onChange={(v) => setDetail("desiredTransfer", v)}
                  options={["可", "不可", "条件付き可"]} type="select" />
              </div>
            </Section>

            <Section title="スキル">
              <div className="grid grid-cols-2 gap-4">
                <Field label="普通免許" value={d.driverLicenseFlag} onChange={(v) => setDetail("driverLicenseFlag", v)}
                  options={["あり", "なし"]} type="select" />
                <Field label="語学力" value={d.languageSkillFlag} onChange={(v) => setDetail("languageSkillFlag", v)} />
                <Field label="語学メモ" value={d.languageSkillMemo} onChange={(v) => setDetail("languageSkillMemo", v)} />
                <Field label="日本語力" value={d.japaneseSkillFlag} onChange={(v) => setDetail("japaneseSkillFlag", v)} />
              </div>
            </Section>

            <Section title="優先条件">
              <div className="grid grid-cols-3 gap-4">
                <Field label="1位" value={d.priorityCondition1} onChange={(v) => setDetail("priorityCondition1", v)} />
                <Field label="2位" value={d.priorityCondition2} onChange={(v) => setDetail("priorityCondition2", v)} />
                <Field label="3位" value={d.priorityCondition3} onChange={(v) => setDetail("priorityCondition3", v)} />
              </div>
              <Field label="優先条件メモ" value={d.priorityConditionMemo} onChange={(v) => setDetail("priorityConditionMemo", v)} type="textarea" />
            </Section>
          </div>
        )}

        {activeTab === "rating" && (
          <div className="space-y-6">
            <RatingSection title="人物評価" prefix="personality" items={[
              { key: "Motivation", label: "やる気・熱意" },
              { key: "Communication", label: "コミュニケーション" },
              { key: "Manner", label: "マナー" },
              { key: "Intelligence", label: "地頭" },
              { key: "Humanity", label: "人間性" },
            ]} rating={r} setRating={setRating} />

            <RatingSection title="経歴評価" prefix="career" items={[
              { key: "JobType", label: "職種マッチ" },
              { key: "Experience", label: "経験年数" },
              { key: "JobChangeCount", label: "転職回数" },
              { key: "Achievement", label: "実績" },
              { key: "Qualification", label: "資格" },
            ]} rating={r} setRating={setRating} />

            <RatingSection title="条件評価" prefix="condition" items={[
              { key: "JobType", label: "職種" },
              { key: "Salary", label: "年収" },
              { key: "Holiday", label: "休日" },
              { key: "Area", label: "エリア" },
              { key: "Flexibility", label: "柔軟性" },
            ]} rating={r} setRating={setRating} />

            <Section title="総合">
              <div className="flex items-center gap-6 text-[14px]">
                <span>合計: <strong className="text-lg">{
                  ((r.personalityMotivation||0)+(r.personalityCommunication||0)+(r.personalityManner||0)+(r.personalityIntelligence||0)+(r.personalityHumanity||0)
                  +(r.careerJobType||0)+(r.careerExperience||0)+(r.careerJobChangeCount||0)+(r.careerAchievement||0)+(r.careerQualification||0)
                  +(r.conditionJobType||0)+(r.conditionSalary||0)+(r.conditionHoliday||0)+(r.conditionArea||0)+(r.conditionFlexibility||0)) || 0
                }</strong> / 75</span>
                <div>
                  <label className="text-[12px] text-gray-500 mr-2">面談評価:</label>
                  <select value={r.overallRank || ""} onChange={(e) => setRating("overallRank", e.target.value || null)}
                    className="border border-gray-300 rounded px-2 py-1 text-[14px] font-bold">
                    <option value="">-</option>
                    {["A", "B", "C", "D"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <label className={labelCls}>総合メモ</label>
                <textarea value={r.grandTotalMemo || ""} onChange={(e) => setRating("grandTotalMemo", e.target.value)}
                  rows={3} className={inputCls} />
              </div>
            </Section>
          </div>
        )}

        {activeTab === "action" && (
          <div className="space-y-6">
            <Section title="応募書類">
              <div className="grid grid-cols-2 gap-4">
                <Field label="書類ステータス" value={d.documentStatusFlag} onChange={(v) => setDetail("documentStatusFlag", v)}
                  options={["未着手", "作成中", "完了"]} type="select" />
                <Field label="書類メモ" value={d.documentStatusMemo} onChange={(v) => setDetail("documentStatusMemo", v)} />
                <Field label="書類サポート" value={d.documentSupportFlag} onChange={(v) => setDetail("documentSupportFlag", v)} />
                <Field label="サポートメモ" value={d.documentSupportMemo} onChange={(v) => setDetail("documentSupportMemo", v)} />
              </div>
            </Section>
            <Section title="求人送付">
              <div className="grid grid-cols-2 gap-4">
                <Field label="送付フラグ" value={d.jobReferralFlag} onChange={(v) => setDetail("jobReferralFlag", v)}
                  options={["未送付", "送付予定", "送付済"]} type="select" />
                <Field label="送付予定時期" value={d.jobReferralTimeline} onChange={(v) => setDetail("jobReferralTimeline", v)} />
              </div>
              <Field label="送付メモ" value={d.jobReferralMemo} onChange={(v) => setDetail("jobReferralMemo", v)} type="textarea" />
            </Section>
            <Section title="次回面談">
              <div className="grid grid-cols-2 gap-4">
                <Field label="次回面談フラグ" value={d.nextInterviewFlag} onChange={(v) => setDetail("nextInterviewFlag", v)} />
                <Field label="次回面談メモ" value={d.nextInterviewMemo} onChange={(v) => setDetail("nextInterviewMemo", v)} />
              </div>
            </Section>
            <Section title="フリーメモ">
              <Field label="" value={d.freeMemo} onChange={(v) => setDetail("freeMemo", v)} type="textarea" rows={6} />
            </Section>
            <Section title="初回面談まとめ">
              <Field label="" value={d.initialSummary || form.summaryText} onChange={(v) => setDetail("initialSummary", v)} type="textarea" rows={6} />
            </Section>
          </div>
        )}

        {activeTab === "memo" && (
          <div className="space-y-6">
            <Section title="面談メモ">
              <textarea value={form.interviewMemo || ""} onChange={(e) => setForm((prev) => ({ ...prev, interviewMemo: e.target.value }))}
                rows={12} className={inputCls} placeholder="面談メモを入力..." />
            </Section>
            {record.previousMemo && (
              <Section title="前回面談メモ（読み取り専用）">
                <div className="bg-gray-50 rounded-lg p-4 text-[13px] text-gray-600 whitespace-pre-wrap">{record.previousMemo}</div>
              </Section>
            )}
          </div>
        )}
      </div>

      {/* Fixed save bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex justify-center z-40">
        <button onClick={handleSave} disabled={saving}
          className="bg-[#2563EB] text-white rounded-lg px-8 py-2.5 text-[14px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
          {saving ? "保存中..." : "💾 保存"}
        </button>
      </div>
    </div>
  );
}

/* ========== Sub-Components ========== */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <h3 className="text-[14px] font-bold text-[#374151] mb-3 border-b border-gray-200 pb-1">{title}</h3>}
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", options, rows }: {
  label: string; value: unknown; onChange: (v: string) => void;
  type?: "text" | "textarea" | "select" | "number"; options?: string[]; rows?: number;
}) {
  const cls = "w-full rounded-md border border-gray-300 px-3 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none";
  if (type === "select" && options) {
    return (
      <div>
        {label && <label className="block text-[12px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
        <select value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">-</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (type === "textarea") {
    return (
      <div className="mt-2">
        {label && <label className="block text-[12px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
        <textarea value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} rows={rows || 3} className={cls} />
      </div>
    );
  }
  return (
    <div>
      {label && <label className="block text-[12px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
      <input type={type === "number" ? "number" : "text"} value={value != null ? String(value) : ""} onChange={(e) => onChange(e.target.value)} className={cls} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RatingSection({ title, prefix, items, rating, setRating }: {
  title: string; prefix: string;
  items: { key: string; label: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rating: Record<string, any>;
  setRating: (key: string, value: unknown) => void;
}) {
  const total = items.reduce((sum, item) => sum + (rating[`${prefix}${item.key}`] || 0), 0);
  return (
    <Section title={`${title}（小計: ${total} / ${items.length * 5}）`}>
      <div className="space-y-2">
        {items.map((item) => {
          const scoreKey = `${prefix}${item.key}`;
          const memoKey = `${scoreKey}Memo`;
          return (
            <div key={item.key} className="flex items-center gap-3">
              <span className="text-[13px] w-40 shrink-0">{item.label}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(scoreKey, rating[scoreKey] === n ? null : n)}
                    className={`w-8 h-8 rounded text-[12px] font-bold border ${
                      rating[scoreKey] === n ? "bg-[#2563EB] text-white border-[#2563EB]" : "bg-white text-gray-500 border-gray-300 hover:border-[#2563EB]"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
              <input type="text" value={rating[memoKey] || ""} onChange={(e) => setRating(memoKey, e.target.value)}
                placeholder="メモ" className="flex-1 rounded border border-gray-300 px-2 py-1 text-[12px] focus:border-[#2563EB] focus:outline-none" />
            </div>
          );
        })}
      </div>
    </Section>
  );
}
