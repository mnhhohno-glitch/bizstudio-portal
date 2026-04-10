"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

export default function NewInterviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const candidateId = searchParams.get("candidateId") || "";

  const [candidate, setCandidate] = useState<{ id: string; name: string; candidateNumber: string } | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [originalFiles, setOriginalFiles] = useState<{ id: string; fileName: string; driveFileId: string }[]>([]);

  // Form state
  const [interviewDate, setInterviewDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("15:00");
  const [interviewTool, setInterviewTool] = useState("オンライン");
  const [interviewerUserId, setInterviewerUserId] = useState("");
  const [interviewType, setInterviewType] = useState("新規面談");

  // AI input
  const [transcript, setTranscript] = useState("");
  const [resumePdfFile, setResumePdfFile] = useState<File | null>(null);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (candidateId) {
      fetch(`/api/candidates/${candidateId}`)
        .then((r) => r.json())
        .then((d) => setCandidate(d.candidate || d))
        .catch(() => {});

      fetch(`/api/candidates/${candidateId}/files?category=ORIGINAL`)
        .then((r) => r.json())
        .then((d) => setOriginalFiles(d.files || []))
        .catch(() => {});
    }
    fetch("/api/employees")
      .then((r) => r.json())
      .then((d) => {
        const list = d.employees || d || [];
        setEmployees(list);
        if (list.length > 0 && !interviewerUserId) setInterviewerUserId(list[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const handleTxtDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type === "text/plain" || file?.name.endsWith(".txt")) {
      file.text().then(setTranscript);
    }
  };

  const handleTxtFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) file.text().then(setTranscript);
  };

  const handlePdfDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") setResumePdfFile(file);
  };

  const handleAnalyze = async () => {
    if (!transcript && !resumePdfFile && !selectedFileId) {
      toast.error("テキストまたはPDFを入力してください");
      return;
    }
    setAnalyzing(true);
    try {
      const formData = new FormData();
      if (transcript) formData.append("transcript", transcript);

      if (resumePdfFile) {
        formData.append("resumePdf", resumePdfFile);
      } else if (selectedFileId) {
        // Download file from Drive and send
        const res = await fetch(`/api/candidates/${candidateId}/files/${selectedFileId}/download`);
        if (res.ok) {
          const blob = await res.blob();
          formData.append("resumePdf", blob, "resume.pdf");
        }
      }

      const res = await fetch("/api/interviews/analyze", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "解析に失敗しました");
      }

      const aiResult = await res.json();
      // Save with AI results
      await saveInterview(aiResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解析に失敗しました");
    } finally {
      setAnalyzing(false);
    }
  };

  const saveInterview = async (aiResult?: Record<string, unknown>) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        candidateId,
        interviewDate: `${interviewDate}T12:00:00.000Z`,
        startTime,
        endTime,
        interviewTool,
        interviewerUserId,
        interviewType,
        rawTranscript: transcript || null,
        resumePdfFileId: selectedFileId || null,
      };

      if (aiResult) {
        body.interviewMemo = aiResult.interviewMemo || null;
        body.summaryText = aiResult.summaryText || null;
        if (aiResult.detail) body.detail = aiResult.detail;
      }

      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "保存に失敗しました");
      }

      const { record } = await res.json();
      toast.success("面談を登録しました");
      router.push(`/interviews/${record.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = () => saveInterview();

  const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const selectCls = inputCls;
  const labelCls = "block text-[13px] font-medium text-[#374151] mb-1";

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[#374151] mb-6">📝 面談登録</h1>

      {candidate && (
        <div className="mb-6 p-3 bg-blue-50 rounded-lg text-[14px]">
          <span className="font-medium">{candidate.name}</span>
          <span className="text-gray-500 ml-2">({candidate.candidateNumber})</span>
        </div>
      )}

      {/* AI解析用ファイル */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-[15px] font-bold text-[#374151] mb-4">AI解析用ファイル</h2>

        <div className="mb-4">
          <label className={labelCls}>Notta文字起こし (.txt)</label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleTxtDrop}
            className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-[#2563EB] transition-colors"
          >
            {transcript ? (
              <div className="text-[13px] text-gray-600">
                <span className="text-green-600 font-medium">✓ テキスト読み込み済み</span>
                <span className="ml-2">({transcript.length.toLocaleString()}文字)</span>
                <button onClick={() => setTranscript("")} className="ml-2 text-red-500 hover:underline">クリア</button>
              </div>
            ) : (
              <div>
                <p className="text-[13px] text-gray-500 mb-2">TXTファイルをドラッグ＆ドロップ、またはテキスト貼付け</p>
                <label className="text-[13px] text-[#2563EB] cursor-pointer hover:underline">
                  ファイルを選択
                  <input type="file" accept=".txt" className="hidden" onChange={handleTxtFileSelect} />
                </label>
              </div>
            )}
          </div>
          {!transcript && (
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="または、文字起こしテキストを直接貼り付け..."
              rows={3}
              className={`${inputCls} mt-2`}
            />
          )}
        </div>

        <div>
          <label className={labelCls}>WEB履歴書 (PDF)</label>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handlePdfDrop}
            className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-[#2563EB] transition-colors mb-2"
          >
            {resumePdfFile ? (
              <div className="text-[13px]">
                <span className="text-green-600 font-medium">✓ {resumePdfFile.name}</span>
                <button onClick={() => setResumePdfFile(null)} className="ml-2 text-red-500 hover:underline">クリア</button>
              </div>
            ) : (
              <div>
                <p className="text-[13px] text-gray-500 mb-2">PDFをドラッグ＆ドロップ</p>
                <label className="text-[13px] text-[#2563EB] cursor-pointer hover:underline">
                  ファイルを選択
                  <input type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setResumePdfFile(e.target.files[0]); }} />
                </label>
              </div>
            )}
          </div>
          {originalFiles.length > 0 && !resumePdfFile && (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-500">📁 原本から選択:</span>
              <select value={selectedFileId} onChange={(e) => setSelectedFileId(e.target.value)}
                className="text-[13px] border border-gray-300 rounded px-2 py-1">
                <option value="">選択してください</option>
                {originalFiles.map((f) => (
                  <option key={f.id} value={f.id}>{f.fileName}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 面談基本情報 */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <h2 className="text-[15px] font-bold text-[#374151] mb-4">面談基本情報</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>面談日 *</label>
            <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>面談種別 *</label>
            <select value={interviewType} onChange={(e) => setInterviewType(e.target.value)} className={selectCls}>
              <option value="新規面談">新規面談</option>
              <option value="フォロー面談">フォロー面談</option>
              <option value="面接対策">面接対策</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>開始時間 *</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>終了時間 *</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>面談ツール *</label>
            <select value={interviewTool} onChange={(e) => setInterviewTool(e.target.value)} className={selectCls}>
              <option value="電話">電話</option>
              <option value="オンライン">オンライン</option>
              <option value="対面">対面</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>担当CA *</label>
            <select value={interviewerUserId} onChange={(e) => setInterviewerUserId(e.target.value)} className={selectCls}>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={handleAnalyze}
          disabled={analyzing || saving || (!transcript && !resumePdfFile && !selectedFileId)}
          className="bg-[#7C3AED] text-white rounded-lg px-6 py-3 text-[14px] font-medium hover:bg-[#6D28D9] disabled:opacity-50 transition-colors"
        >
          {analyzing ? "解析中..." : "✨ AI解析して自動入力"}
        </button>
        <button
          onClick={handleManualSave}
          disabled={analyzing || saving}
          className="border border-gray-300 bg-white text-gray-700 rounded-lg px-6 py-3 text-[14px] font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "保存中..." : "手動で入力 →"}
        </button>
      </div>
    </div>
  );
}
