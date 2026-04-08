"use client";

import { useState } from "react";
import { inputCls, labelCls } from "./types";
import type { InterviewFormData, Employee, CandidateFile } from "./types";

type Props = {
  form: InterviewFormData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setForm: (fn: (prev: InterviewFormData) => InterviewFormData) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDetail: (key: string, value: any) => void;
  employees: Employee[];
  originalFiles: CandidateFile[];
  candidateId: string;
  isNew: boolean;
  onAnalyze: () => void;
  analyzing: boolean;
};

export default function LeftColumn({ form, setForm, setDetail, employees, originalFiles, candidateId, isNew, onAnalyze, analyzing }: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const [transcript, setTranscript] = useState(form.rawTranscript || "");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [selectedFileId, setSelectedFileId] = useState(form.resumePdfFileId || "");
  const d = form.detail || {};

  const handleTxtDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "text/plain" || file.name.endsWith(".txt"))) {
      file.text().then((t) => {
        setTranscript(t);
        setForm((prev) => ({ ...prev, rawTranscript: t }));
      });
    }
  };

  const handlePdfDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") setPdfFile(file);
  };

  const doAnalyze = () => {
    // Store transcript and file info in form for parent to use
    setForm((prev) => ({
      ...prev,
      rawTranscript: transcript,
      resumePdfFileId: selectedFileId,
    }));
    onAnalyze();
  };

  return (
    <div className="space-y-5">
      {/* 面談基本情報 */}
      <Section title="面談基本情報">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>面談日 *</label>
            <input type="date" value={form.interviewDate} onChange={(e) => setForm((p) => ({ ...p, interviewDate: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>面談種別 *</label>
            <select value={form.interviewType} onChange={(e) => setForm((p) => ({ ...p, interviewType: e.target.value }))} className={inputCls}>
              <option value="新規面談">新規面談</option>
              <option value="フォロー面談">フォロー面談</option>
              <option value="電話面談">電話面談</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>開始時間 *</label>
            <input type="time" step="900" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>終了時間 *</label>
            <input type="time" step="900" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>面談ツール *</label>
            <select value={form.interviewTool} onChange={(e) => setForm((p) => ({ ...p, interviewTool: e.target.value }))} className={inputCls}>
              <option value="オンライン">オンライン</option>
              <option value="対面">対面</option>
              <option value="電話">電話</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>担当CA *</label>
            <select value={form.interviewerUserId} onChange={(e) => setForm((p) => ({ ...p, interviewerUserId: e.target.value }))} className={inputCls}>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* AI解析ファイル（折りたたみ） */}
      <div className="border border-gray-200 rounded-lg">
        <button type="button" onClick={() => setFileOpen(!fileOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-[13px] font-medium text-[#374151] hover:bg-gray-50">
          <span>AI解析ファイル</span>
          <span className="text-gray-400">{fileOpen ? "▲" : "▼"}</span>
        </button>
        {fileOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div>
              <label className={labelCls}>Notta文字起こし (.txt)</label>
              <div onDragOver={(e) => e.preventDefault()} onDrop={handleTxtDrop}
                className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-[#2563EB] transition-colors">
                {transcript ? (
                  <span className="text-[12px] text-green-600">✓ {transcript.length.toLocaleString()}文字</span>
                ) : (
                  <div>
                    <p className="text-[12px] text-gray-500">TXTをドロップ or テキスト貼付け</p>
                    <label className="text-[12px] text-[#2563EB] cursor-pointer hover:underline">
                      ファイル選択<input type="file" accept=".txt" className="hidden" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) f.text().then((t) => { setTranscript(t); setForm((p) => ({ ...p, rawTranscript: t })); });
                      }} />
                    </label>
                  </div>
                )}
              </div>
              {!transcript && (
                <textarea value={transcript} onChange={(e) => { setTranscript(e.target.value); setForm((p) => ({ ...p, rawTranscript: e.target.value })); }}
                  placeholder="テキストを直接貼り付け..." rows={2} className={`${inputCls} mt-1`} />
              )}
            </div>
            <div>
              <label className={labelCls}>WEB履歴書 (PDF)</label>
              <div onDragOver={(e) => e.preventDefault()} onDrop={handlePdfDrop}
                className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center hover:border-[#2563EB] transition-colors">
                {pdfFile ? (
                  <span className="text-[12px] text-green-600">✓ {pdfFile.name}</span>
                ) : (
                  <label className="text-[12px] text-[#2563EB] cursor-pointer hover:underline">
                    PDFをドロップ or 選択<input type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }} />
                  </label>
                )}
              </div>
              {originalFiles.length > 0 && !pdfFile && (
                <select value={selectedFileId} onChange={(e) => setSelectedFileId(e.target.value)} className={`${inputCls} mt-1`}>
                  <option value="">📁 原本から選択</option>
                  {originalFiles.map((f) => <option key={f.id} value={f.id}>{f.fileName}</option>)}
                </select>
              )}
            </div>
            <button type="button" onClick={doAnalyze} disabled={analyzing || (!transcript && !pdfFile && !selectedFileId)}
              className="w-full bg-[#7C3AED] text-white rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-[#6D28D9] disabled:opacity-50">
              {analyzing ? "解析中..." : "✨ AI解析で自動入力"}
            </button>
          </div>
        )}
      </div>

      {/* 転職活動状況 */}
      <Section title="転職活動状況">
        <TextAreaField label="他AG状況" value={d.agentUsageMemo} onChange={(v) => setDetail("agentUsageMemo", v)}
          placeholder="エージェントを利用したいと思った理由は？" />
        <TextAreaField label="転職時期" value={d.jobChangeTimelineMemo} onChange={(v) => setDetail("jobChangeTimelineMemo", v)}
          placeholder="○月入社希望だが絶対にというわけでもない..." />
        <TextAreaField label="活動期間" value={d.activityPeriodMemo} onChange={(v) => setDetail("activityPeriodMemo", v)}
          placeholder="まだ1週間程度、情報収集段階で..." />
        <TextAreaField label="他社応募状況" value={d.applicationMemo} onChange={(v) => setDetail("applicationMemo", v)}
          placeholder="事務系を中心に○社応募済み..." />
        <div className="flex items-center gap-2 mt-1">
          <input type="number" min="0" value={d.currentApplicationCount ?? ""} onChange={(e) => setDetail("currentApplicationCount", e.target.value ? Number(e.target.value) : null)}
            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-[13px]" placeholder="0" />
          <span className="text-[12px] text-gray-500">社</span>
        </div>
        <div className="mt-2">
          <label className={labelCls}>最終学歴</label>
          <input type="text" value={d.educationMemo || ""} onChange={(e) => setDetail("educationMemo", e.target.value)}
            placeholder="○○大学○○学部○○学科 ※WEBレジュメからコピー" className={inputCls} />
        </div>
      </Section>

      {/* 職務経歴概要 */}
      <Section title="職務経歴概要">
        <textarea value={d.careerSummary || ""} onChange={(e) => setDetail("careerSummary", e.target.value)}
          rows={8} className={inputCls} placeholder="職務経歴の概要を入力..." />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="text-[13px] font-bold text-[#374151] mb-3">{title}</h3>
      {children}
    </div>
  );
}

function TextAreaField({ label, value, onChange, placeholder }: { label: string; value: string | null | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="mt-2">
      <label className={labelCls}>{label}</label>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className={inputCls} />
    </div>
  );
}
