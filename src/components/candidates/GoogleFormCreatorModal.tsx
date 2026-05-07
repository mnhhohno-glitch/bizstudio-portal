"use client";

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { GOOGLE_FORM_CATEGORY_GROUPS } from "@/constants/google-form-categories";

export type GoogleFormMeetingFile = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  driveFileId: string;
  createdAt: string;
};

type Props = {
  candidateId: string;
  candidateNumber: string;
  candidateName: string;
  isOpen: boolean;
  onClose: () => void;
  meetingFiles: GoogleFormMeetingFile[];
};

type Stage = "extract" | "generate" | "create";
type StageState = "pending" | "running" | "done" | "failed";
type ModalStep = "idle" | "processing" | "completed" | "error";

const STAGE_LABELS: Record<Stage, string> = {
  extract: "履歴書解析",
  generate: "質問生成",
  create: "フォーム作成",
};

const STAGE_DETAILS: Record<Stage, string> = {
  extract: "PDF と面談ログを解析中（30〜75 秒）",
  generate: "質問項目を生成中（〜2 秒）",
  create: "Google フォームを作成中（25〜65 秒）",
};

function StageIcon({ state }: { state: StageState }) {
  if (state === "running") {
    return (
      <span className="inline-block w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
    );
  }
  if (state === "done") {
    return (
      <span className="inline-block w-5 h-5 rounded-full bg-green-500 text-white text-xs flex items-center justify-center leading-none">
        ✓
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-block w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center leading-none">
        ✕
      </span>
    );
  }
  return <span className="inline-block w-5 h-5 rounded-full bg-gray-200" />;
}

export default function GoogleFormCreatorModal({
  candidateId,
  candidateNumber,
  candidateName,
  isOpen,
  onClose,
  meetingFiles,
}: Props) {
  const [step, setStep] = useState<ModalStep>("idle");
  const [stageStatus, setStageStatus] = useState<Record<Stage, StageState>>({
    extract: "pending",
    generate: "pending",
    create: "pending",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedPdfFileId, setSelectedPdfFileId] = useState<string | null>(null);
  const [selectedTxtFileId, setSelectedTxtFileId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string>("");
  const [categoryValue, setCategoryValue] = useState<string>("");
  const [otherLabel, setOtherLabel] = useState<string>("");

  const [resumeData, setResumeData] = useState<unknown>(null);
  const [interviewLogText, setInterviewLogText] = useState<string>("");
  const [questionsJson, setQuestionsJson] = useState<unknown>(null);
  const [formResult, setFormResult] = useState<{
    formId: string;
    editUrl: string;
    viewUrl: string;
    persisted: boolean;
  } | null>(null);

  const [editUrlCopied, setEditUrlCopied] = useState(false);
  const [viewUrlCopied, setViewUrlCopied] = useState(false);

  const pdfCandidates = useMemo(
    () =>
      meetingFiles
        .filter((f) => f.fileName.toLowerCase().endsWith(".pdf"))
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [meetingFiles],
  );
  const txtCandidates = useMemo(
    () =>
      meetingFiles
        .filter((f) => f.fileName.toLowerCase().endsWith(".txt"))
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [meetingFiles],
  );

  // 初期選択（モーダル開いた瞬間 / ファイル一覧変更時）
  useEffect(() => {
    if (!isOpen) return;
    if (selectedPdfFileId === null && pdfCandidates.length > 0) {
      setSelectedPdfFileId(pdfCandidates[0].id);
    }
    if (selectedTxtFileId === null && txtCandidates.length > 0) {
      setSelectedTxtFileId(txtCandidates[0].id);
    }
  }, [isOpen, pdfCandidates, txtCandidates, selectedPdfFileId, selectedTxtFileId]);

  const groups = GOOGLE_FORM_CATEGORY_GROUPS;
  const selectedGroup = groups.find((g) => g.label === groupKey) ?? null;

  const filesValid = !!selectedPdfFileId && !!selectedTxtFileId;
  const categoryValid =
    !!categoryValue && (categoryValue !== "other" || otherLabel.trim().length > 0);
  const canStart = filesValid && categoryValid && step === "idle";

  const handleClose = () => {
    if (step === "processing") return;
    onClose();
  };

  const handleResetAll = () => {
    setStep("idle");
    setStageStatus({ extract: "pending", generate: "pending", create: "pending" });
    setErrorMessage(null);
    setResumeData(null);
    setInterviewLogText("");
    setQuestionsJson(null);
    setFormResult(null);
  };

  const runExtract = async (): Promise<{ resumeData: unknown; interviewLogText: string } | null> => {
    setStageStatus((s) => ({ ...s, extract: "running" }));
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/google-form/extract-resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pdfFileId: selectedPdfFileId,
            interviewLogFileId: selectedTxtFileId,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `履歴書解析失敗 (HTTP ${res.status})`);
      }
      const data = await res.json();
      setResumeData(data.resumeData);
      setInterviewLogText(data.interviewLogText);
      setStageStatus((s) => ({ ...s, extract: "done" }));
      return { resumeData: data.resumeData, interviewLogText: data.interviewLogText };
    } catch (e) {
      setStageStatus((s) => ({ ...s, extract: "failed" }));
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const runGenerate = async (
    resume: unknown,
    log: string,
  ): Promise<unknown | null> => {
    setStageStatus((s) => ({ ...s, generate: "running" }));
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/google-form/generate-form`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeData: resume,
            interviewLog: log,
            achievementCategory: categoryValue,
            achievementCategoryOtherLabel:
              categoryValue === "other" ? otherLabel.trim() : null,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `質問生成失敗 (HTTP ${res.status})`);
      }
      const data = await res.json();
      setQuestionsJson(data.questionsJson);
      setStageStatus((s) => ({ ...s, generate: "done" }));
      return data.questionsJson;
    } catch (e) {
      setStageStatus((s) => ({ ...s, generate: "failed" }));
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const runCreate = async (
    questions: unknown,
  ): Promise<{ formId: string; editUrl: string; viewUrl: string; persisted: boolean } | null> => {
    setStageStatus((s) => ({ ...s, create: "running" }));
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/google-form/create-form`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionsJson: questions }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `フォーム作成失敗 (HTTP ${res.status})`);
      }
      const data = await res.json();
      const result = {
        formId: data.formId,
        editUrl: data.editUrl,
        viewUrl: data.viewUrl,
        persisted: !!data.persisted,
      };
      setFormResult(result);
      setStageStatus((s) => ({ ...s, create: "done" }));
      return result;
    } catch (e) {
      setStageStatus((s) => ({ ...s, create: "failed" }));
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const handleStart = async () => {
    if (!canStart) return;
    setStep("processing");
    setErrorMessage(null);
    setStageStatus({ extract: "pending", generate: "pending", create: "pending" });
    setResumeData(null);
    setInterviewLogText("");
    setQuestionsJson(null);
    setFormResult(null);

    const e1 = await runExtract();
    if (!e1) {
      setStep("error");
      return;
    }
    const e2 = await runGenerate(e1.resumeData, e1.interviewLogText);
    if (!e2) {
      setStep("error");
      return;
    }
    const e3 = await runCreate(e2);
    if (!e3) {
      setStep("error");
      return;
    }
    setStep("completed");
    toast.success("Google フォーム作成完了");
  };

  const handleRetry = async () => {
    if (step !== "error") return;
    setErrorMessage(null);
    setStep("processing");

    let resume: unknown = resumeData;
    let log: string = interviewLogText;

    if (stageStatus.extract === "failed") {
      const r = await runExtract();
      if (!r) {
        setStep("error");
        return;
      }
      resume = r.resumeData;
      log = r.interviewLogText;
    }

    let questions: unknown = questionsJson;
    if (stageStatus.generate === "failed" || (resume !== resumeData && questions === null)) {
      const r = await runGenerate(resume, log);
      if (!r) {
        setStep("error");
        return;
      }
      questions = r;
    }

    if (stageStatus.create === "failed" || (questions !== questionsJson && !formResult)) {
      const r = await runCreate(questions);
      if (!r) {
        setStep("error");
        return;
      }
    }
    setStep("completed");
    toast.success("Google フォーム作成完了");
  };

  const copyToClipboard = async (text: string, kind: "edit" | "view") => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "edit") {
        setEditUrlCopied(true);
        setTimeout(() => setEditUrlCopied(false), 2000);
      } else {
        setViewUrlCopied(true);
        setTimeout(() => setViewUrlCopied(false), 2000);
      }
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">
            🤖 Google フォーム作成
          </h2>
          <button
            onClick={handleClose}
            disabled={step === "processing"}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>

        <div className="text-[12px] text-gray-500 mb-4">
          対象: {candidateName} 様（{candidateNumber}）
        </div>

        {/* Step 1: idle - 入力 */}
        {step === "idle" && (
          <>
            {/* PDF ファイル選択 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-2">
                PDF ファイル <span className="text-red-500">*</span>
              </label>
              {pdfCandidates.length === 0 ? (
                <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[12px] text-yellow-800">
                  面談サブタブに PDF ファイルがありません。書類タブの「面談」サブタブにアップロードしてください。
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
                  {pdfCandidates.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="pdfFile"
                        checked={selectedPdfFileId === f.id}
                        onChange={() => setSelectedPdfFileId(f.id)}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[12px] text-gray-700 truncate flex-1" title={f.fileName}>
                        📄 {f.fileName}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(f.createdAt).toLocaleDateString("ja-JP")}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* テキストファイル選択 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-2">
                面談ログ（.txt） <span className="text-red-500">*</span>
              </label>
              {txtCandidates.length === 0 ? (
                <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[12px] text-yellow-800">
                  面談サブタブにテキストファイル（.txt）がありません。書類タブの「面談」サブタブにアップロードしてください。
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
                  {txtCandidates.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="txtFile"
                        checked={selectedTxtFileId === f.id}
                        onChange={() => setSelectedTxtFileId(f.id)}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[12px] text-gray-700 truncate flex-1" title={f.fileName}>
                        📝 {f.fileName}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(f.createdAt).toLocaleDateString("ja-JP")}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* カテゴリ選択 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-2">
                経験職種カテゴリ <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2 mb-2">
                <select
                  value={groupKey}
                  onChange={(e) => {
                    setGroupKey(e.target.value);
                    setCategoryValue("");
                    setOtherLabel("");
                  }}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                >
                  <option value="">大項目を選択...</option>
                  {groups.map((g) => (
                    <option key={g.label} value={g.label}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <select
                  value={categoryValue}
                  onChange={(e) => setCategoryValue(e.target.value)}
                  disabled={!selectedGroup}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">サブカテゴリを選択...</option>
                  {selectedGroup?.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {categoryValue === "other" && (
                <input
                  type="text"
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  placeholder="職種を自由記述（例: トラック運転手）"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              )}
            </div>

            {/* 開始ボタン */}
            <div className="flex gap-2 pt-2 border-t border-gray-200">
              <button
                onClick={handleClose}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleStart}
                disabled={!canStart}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                生成開始
              </button>
            </div>
          </>
        )}

        {/* Step 2: processing / Step 4: error */}
        {(step === "processing" || step === "error") && (
          <div className="mb-4">
            <div className="space-y-3">
              {(["extract", "generate", "create"] as Stage[]).map((stage) => (
                <div key={stage} className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <StageIcon state={stageStatus[stage]} />
                  </div>
                  <div className="flex-1">
                    <div
                      className={`text-[13px] font-medium ${
                        stageStatus[stage] === "running"
                          ? "text-blue-700"
                          : stageStatus[stage] === "done"
                            ? "text-green-700"
                            : stageStatus[stage] === "failed"
                              ? "text-red-700"
                              : "text-gray-500"
                      }`}
                    >
                      {STAGE_LABELS[stage]}
                    </div>
                    <div className="text-[11px] text-gray-500">{STAGE_DETAILS[stage]}</div>
                  </div>
                </div>
              ))}
            </div>

            {step === "error" && errorMessage && (
              <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-700">
                ❌ エラー: {errorMessage}
              </div>
            )}

            {step === "error" && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleResetAll}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50"
                >
                  初めからやり直す
                </button>
                <button
                  onClick={handleRetry}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]"
                >
                  失敗段階から再試行
                </button>
              </div>
            )}

            {step === "processing" && (
              <div className="mt-4 text-[11px] text-gray-400 text-center">
                処理中はモーダルを閉じられません。完了までお待ちください。
              </div>
            )}
          </div>
        )}

        {/* Step 3: completed */}
        {step === "completed" && formResult && (
          <div>
            <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3">
              <p className="text-[13px] text-green-700 font-bold">
                ✓ Google フォーム作成完了
              </p>
              <p className="text-[11px] text-green-700 mt-1">
                {formResult.persisted
                  ? "InterviewRecord に保存済み（最新の面談レコードに紐付け）"
                  : "ブラウザで保持中（面談レコードがないため永続化スキップ。このモーダルを閉じると URL が失われます）"}
              </p>
            </div>

            <div className="mb-3">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">
                編集 URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={formResult.editUrl}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-[12px] text-gray-700 bg-gray-50 font-mono select-all focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(formResult.editUrl, "edit")}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[12px] hover:bg-gray-50"
                >
                  {editUrlCopied ? "✓" : "コピー"}
                </button>
                <a
                  href={formResult.editUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#2563EB] text-white rounded-md px-3 py-2 text-[12px] hover:bg-[#1D4ED8] flex items-center gap-1"
                >
                  編集を開く ↗
                </a>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[12px] font-medium text-[#374151] mb-1">
                回答用 URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={formResult.viewUrl}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-[12px] text-gray-700 bg-gray-50 font-mono select-all focus:outline-none"
                />
                <button
                  onClick={() => copyToClipboard(formResult.viewUrl, "view")}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[12px] hover:bg-gray-50"
                >
                  {viewUrlCopied ? "✓" : "コピー"}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-200">
              <button
                onClick={handleClose}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-5 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
