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
type ModalStep = "idle" | "processing" | "selectCompany" | "completed" | "error";

type WorkHistoryEntry = {
  company?: string;
  period?: string;
  [key: string]: unknown;
};

// T-038: モーダル open 時に既存 URL チェックで使う最小型
type InterviewRecordForGoogleForm = {
  id: string;
  isLatest: boolean;
  googleFormId: string | null;
  googleFormEditUrl: string | null;
  googleFormViewUrl: string | null;
  googleFormCreatedAt: string | null;
  googleFormStatus: string | null;
};

// T-035 step2: 「その他系」職種コード判定。会社別の自由記入ラベル入力欄を出す対象。
// office_other / planning_other / care_other / other（業種カテゴリ「その他」）。
const OTHER_TYPE_CATEGORY_VALUES = new Set([
  "other",
  "office_other",
  "planning_other",
  "care_other",
]);

function isOtherTypeCategory(value: string | undefined | null): boolean {
  return !!value && OTHER_TYPE_CATEGORY_VALUES.has(value);
}

function getOtherTypeLabelPlaceholder(value: string): string {
  switch (value) {
    case "office_other":
      return "例: 特許事務、医療事務 など";
    case "planning_other":
      return "例: 経営企画、新規事業 など";
    case "care_other":
      return "例: 歯科助手、薬剤師補助 など";
    case "other":
      return "例: トラック運転手、職人 など";
    default:
      return "";
  }
}

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

  // T-038: 既存 URL 再表示
  const [hasCheckedExistingUrl, setHasCheckedExistingUrl] = useState(false);
  const [formCreatedAt, setFormCreatedAt] = useState<string | null>(null);

  // T-035: 会社別カテゴリマップ
  // キー: work_history 配列インデックスの文字列（"0", "1", "2"...）
  // 値: subcategory コード（candidate-intake が受け取る "sales_corporate" 等）
  const [companyCategoryMap, setCompanyCategoryMap] = useState<Record<string, string>>({});
  // 大項目 label を保持する内部 state（UI の 2 階層ドロップダウン用、API には送らない）
  const [companyGroupMap, setCompanyGroupMap] = useState<Record<string, string>>({});
  // T-035 step2: 会社別の自由記入ラベル（その他系のみ表示・保持）。
  // キー: work_history index 文字列。値: ユーザー入力ラベル（例「特許事務」）。
  const [companyCategoryLabelMap, setCompanyCategoryLabelMap] = useState<Record<string, string>>({});

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

  // T-038: モーダル open 時に既存 Google フォーム URL をチェック → あれば completed へジャンプ
  useEffect(() => {
    if (!isOpen) {
      setHasCheckedExistingUrl(false);
      return;
    }
    if (hasCheckedExistingUrl) return;
    if (formResult) {
      // 同一セッション内で既に作成済み or DB から復元済み → 再 fetch 不要
      setHasCheckedExistingUrl(true);
      return;
    }
    setHasCheckedExistingUrl(true);

    (async () => {
      try {
        const res = await fetch(`/api/candidates/${candidateId}/interviews`);
        if (!res.ok) return;
        const data = await res.json();
        const records: InterviewRecordForGoogleForm[] = data.records || [];
        const latest = records.find((r) => r.isLatest);

        if (latest?.googleFormEditUrl && latest?.googleFormViewUrl) {
          setFormResult({
            formId: latest.googleFormId || "",
            editUrl: latest.googleFormEditUrl,
            viewUrl: latest.googleFormViewUrl,
            persisted: true,
          });
          setFormCreatedAt(latest.googleFormCreatedAt);
          setStep("completed");
        }
      } catch (err) {
        // サイレントに idle 表示（通常の新規作成フローにフォールバック）
        console.warn("[GoogleFormCreatorModal] Failed to check existing URL:", err);
      }
    })();
  }, [isOpen, hasCheckedExistingUrl, formResult, candidateId]);

  const groups = GOOGLE_FORM_CATEGORY_GROUPS;
  const selectedGroup = groups.find((g) => g.label === groupKey) ?? null;

  const filesValid = !!selectedPdfFileId && !!selectedTxtFileId;
  // T-035 step2: その他系の自由記入ラベルは任意（空でも先に進める）。サブカテゴリのみ必須。
  const categoryValid = !!categoryValue;
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
    setFormCreatedAt(null);
    setCompanyCategoryMap({});
    setCompanyGroupMap({});
    setCompanyCategoryLabelMap({});
  };

  // T-038: 「新しく作り直す」ボタン（confirm 付きで handleResetAll を呼ぶ）
  const handleStartFresh = () => {
    const confirmed = window.confirm(
      "既存の Google フォームはそのままに、新しいフォームを作成し直します。\n" +
        "既に求職者へ URL を共有済みの場合、共有 URL は引き続き有効ですが、新規作成後は別 URL になります。\n\n" +
        "本当に作り直しますか?",
    );
    if (!confirmed) return;
    handleResetAll();
  };

  // T-035: work_history を取り出すヘルパー（resumeData は unknown）
  const getWorkHistory = (resume: unknown): WorkHistoryEntry[] => {
    const wh = (resume as { work_history?: unknown } | null)?.work_history;
    return Array.isArray(wh) ? (wh as WorkHistoryEntry[]) : [];
  };

  // T-035: extract 直後に各社にデフォルトカテゴリを初期適用
  // T-035 step2: その他系のときは、1画面目で入力された自由記入ラベルを各社の初期値として配る。
  const initializeCompanyCategoryMap = (
    workHistory: WorkHistoryEntry[],
    defaultGroupLabel: string,
    defaultCategoryValue: string,
    defaultLabel: string,
  ) => {
    const initialMap: Record<string, string> = {};
    const initialGroupMap: Record<string, string> = {};
    const initialLabelMap: Record<string, string> = {};
    const shouldPropagateLabel =
      isOtherTypeCategory(defaultCategoryValue) && defaultLabel.trim().length > 0;
    workHistory.forEach((_, index) => {
      const key = String(index);
      initialMap[key] = defaultCategoryValue;
      initialGroupMap[key] = defaultGroupLabel;
      if (shouldPropagateLabel) {
        initialLabelMap[key] = defaultLabel.trim();
      }
    });
    setCompanyCategoryMap(initialMap);
    setCompanyGroupMap(initialGroupMap);
    setCompanyCategoryLabelMap(initialLabelMap);
  };

  // T-035: 質問生成前のバリデーション（全社サブカテゴリ必須）
  // T-035 step2: その他系の自由記入ラベルは任意（空でも進める）ため、ラベル必須チェックは削除。
  const validateBeforeGenerate = (resume: unknown): string | null => {
    const workHistory = getWorkHistory(resume);
    for (let i = 0; i < workHistory.length; i++) {
      const key = String(i);
      const value = companyCategoryMap[key];
      if (!value) {
        const name = workHistory[i].company || `会社 ${i + 1}`;
        return `${name} のカテゴリが未選択です`;
      }
    }
    return null;
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
      // T-035 step2: その他系の会社のみ、非空のラベルを抽出して送る。
      // 空 / その他系でない会社はマップに含めない（candidate-intake は空を無視する仕様）。
      const labelMapToSend: Record<string, string> = {};
      for (const [key, cat] of Object.entries(companyCategoryMap)) {
        if (!isOtherTypeCategory(cat)) continue;
        const label = (companyCategoryLabelMap[key] ?? "").trim();
        if (label) labelMapToSend[key] = label;
      }
      const hasOtherTypeSomewhere =
        isOtherTypeCategory(categoryValue) ||
        Object.values(companyCategoryMap).some((c) => isOtherTypeCategory(c));

      const res = await fetch(
        `/api/candidates/${candidateId}/google-form/generate-form`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeData: resume,
            interviewLog: log,
            achievementCategory: categoryValue,
            // 後方互換: 1画面目で入力されたラベル（その他系のとき）。
            // 会社別マップが優先される想定だが、ない会社の fallback として candidate-intake が利用する。
            achievementCategoryOtherLabel: hasOtherTypeSomewhere ? otherLabel.trim() : null,
            // T-035: 会社別カテゴリマップ（空 / undefined は candidate-intake が後方互換動作）
            companyCategoryMap,
            // T-035 step2: 会社別の自由記入ラベルマップ（その他系のみ、非空のみ）。
            // 空オブジェクトでも素直に送る（candidate-intake 側は空無視で正規化済み）。
            companyCategoryLabelMap: labelMapToSend,
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
      setFormCreatedAt(new Date().toISOString());
      setStageStatus((s) => ({ ...s, create: "done" }));
      return result;
    } catch (e) {
      setStageStatus((s) => ({ ...s, create: "failed" }));
      setErrorMessage(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // T-035: 履歴書解析 開始（extract のみ実行 → 会社別選択画面へ遷移）
  const handleStartExtract = async () => {
    if (!canStart) return;
    setStep("processing");
    setErrorMessage(null);
    setStageStatus({ extract: "pending", generate: "pending", create: "pending" });
    setResumeData(null);
    setInterviewLogText("");
    setQuestionsJson(null);
    setFormResult(null);
    setCompanyCategoryMap({});
    setCompanyGroupMap({});

    const e1 = await runExtract();
    if (!e1) {
      setStep("error");
      return;
    }
    initializeCompanyCategoryMap(getWorkHistory(e1.resumeData), groupKey, categoryValue, otherLabel);
    setStep("selectCompany");
  };

  // T-035: 質問生成 開始（バリデーション後、generate + create を一気に実行）
  const handleStartGenerate = async () => {
    const validationError = validateBeforeGenerate(resumeData);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setStep("processing");
    setErrorMessage(null);
    setStageStatus((s) => ({ ...s, generate: "pending", create: "pending" }));
    setQuestionsJson(null);
    setFormResult(null);

    const e2 = await runGenerate(resumeData, interviewLogText);
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

    // extract が失敗していた場合: extract 再実行 → selectCompany 画面へ戻す
    if (stageStatus.extract === "failed") {
      setStageStatus({ extract: "pending", generate: "pending", create: "pending" });
      const r = await runExtract();
      if (!r) {
        setStep("error");
        return;
      }
      initializeCompanyCategoryMap(getWorkHistory(r.resumeData), groupKey, categoryValue, otherLabel);
      setStep("selectCompany");
      return;
    }

    // generate / create が失敗していた場合: 必要なステージから再開
    const resume: unknown = resumeData;
    const log: string = interviewLogText;
    let questions: unknown = questionsJson;

    if (stageStatus.generate === "failed") {
      setStageStatus((s) => ({ ...s, generate: "pending", create: "pending" }));
      const r = await runGenerate(resume, log);
      if (!r) {
        setStep("error");
        return;
      }
      questions = r;
    }

    if (stageStatus.create === "failed" || (questions !== questionsJson && !formResult)) {
      setStageStatus((s) => ({ ...s, create: "pending" }));
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
              {/* T-035 step2: その他系（_other / other）のとき、1画面目に自由記入欄を出す。
                  任意入力（空でも進める）。ここに書いた値は解析後に各社の初期値として配られる。 */}
              {isOtherTypeCategory(categoryValue) && (
                <>
                  <input
                    type="text"
                    value={otherLabel}
                    onChange={(e) => setOtherLabel(e.target.value)}
                    placeholder={getOtherTypeLabelPlaceholder(categoryValue)}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    任意。解析後、各会社の自由記入欄に初期値として反映され、会社ごとに変更できます。
                  </p>
                </>
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
                onClick={handleStartExtract}
                disabled={!canStart}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                履歴書解析 開始
              </button>
            </div>
          </>
        )}

        {/* Step 1.5: selectCompany - 会社別カテゴリ選択（T-035） */}
        {step === "selectCompany" && (
          <div>
            <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-[12px] text-blue-800">
              ✓ 履歴書解析が完了しました。会社ごとに業種カテゴリを設定してください。
            </div>
            <div className="mb-3">
              <h3 className="text-[13px] font-semibold text-[#374151] mb-1">
                会社ごとの業種カテゴリ
              </h3>
              <p className="text-[11px] text-gray-600">
                デフォルトカテゴリ「{groupKey} &gt;{" "}
                {selectedGroup?.options.find((o) => o.value === categoryValue)?.label ?? "—"}」を全社に適用しています。業種が異なる会社は変更してください。
              </p>
            </div>

            {(() => {
              const workHistory = getWorkHistory(resumeData);
              if (workHistory.length === 0) {
                return (
                  <div className="mb-4 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[12px] text-yellow-800">
                    履歴書から職歴が抽出できませんでした。デフォルトカテゴリのみで生成します。
                  </div>
                );
              }
              return (
                <div className="space-y-2 mb-4 max-h-[55vh] overflow-y-auto pr-1">
                  {workHistory.map((company, index) => {
                    const key = String(index);
                    const currentGroup = companyGroupMap[key] ?? "";
                    const currentCategory = companyCategoryMap[key] ?? "";
                    const groupForCategory = groups.find((g) => g.label === currentGroup);
                    const isChanged = currentCategory !== categoryValue;

                    return (
                      <div key={key} className="border border-gray-200 rounded-md p-3">
                        <div className="text-[13px] font-medium text-[#374151] mb-2 flex items-center gap-2 flex-wrap">
                          <span className="truncate">
                            {company.company || `会社 ${index + 1}`}
                          </span>
                          {company.period && (
                            <span className="text-[11px] text-gray-500 font-normal">
                              {company.period}
                            </span>
                          )}
                          {isChanged && (
                            <span className="text-[11px] text-blue-600 font-normal">
                              変更済み
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={currentGroup}
                            onChange={(e) => {
                              const newGroup = e.target.value;
                              setCompanyGroupMap((prev) => ({ ...prev, [key]: newGroup }));
                              const firstSubInGroup =
                                groups.find((g) => g.label === newGroup)?.options[0]?.value ?? "";
                              setCompanyCategoryMap((prev) => ({
                                ...prev,
                                [key]: firstSubInGroup,
                              }));
                              // T-035 step2: 切替後がその他系でなければラベルをクリア
                              if (!isOtherTypeCategory(firstSubInGroup)) {
                                setCompanyCategoryLabelMap((prev) => {
                                  if (!(key in prev)) return prev;
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                              }
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
                            value={currentCategory}
                            onChange={(e) => {
                              const newCat = e.target.value;
                              setCompanyCategoryMap((prev) => ({
                                ...prev,
                                [key]: newCat,
                              }));
                              // T-035 step2: 非その他系に切り替わったらラベルをクリア
                              if (!isOtherTypeCategory(newCat)) {
                                setCompanyCategoryLabelMap((prev) => {
                                  if (!(key in prev)) return prev;
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                              }
                            }}
                            disabled={!currentGroup}
                            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            <option value="">サブカテゴリを選択...</option>
                            {groupForCategory?.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {/* T-035 step2: その他系のときだけ、会社別の自由記入欄（任意） */}
                        {isOtherTypeCategory(currentCategory) && (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={companyCategoryLabelMap[key] ?? ""}
                              onChange={(e) =>
                                setCompanyCategoryLabelMap((prev) => ({
                                  ...prev,
                                  [key]: e.target.value,
                                }))
                              }
                              placeholder={getOtherTypeLabelPlaceholder(currentCategory)}
                              className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                            />
                            <p className="mt-0.5 text-[11px] text-gray-500">
                              この会社の自由記入欄（任意）。空のままでも進めます。
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2 border-t border-gray-200">
              <button
                onClick={() => setStep("idle")}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                戻る
              </button>
              <button
                onClick={handleStartGenerate}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]"
              >
                質問生成 開始
              </button>
            </div>
          </div>
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

            {/* T-038: 作成日時表示（JST、罠ポイント #17 準拠で sv-SE ロケール使用）*/}
            {formCreatedAt && (
              <div className="text-[11px] text-gray-500 mb-4">
                作成日時: {new Date(formCreatedAt).toLocaleDateString("sv-SE")}{" "}
                {new Date(formCreatedAt).toLocaleTimeString("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-gray-200 gap-2">
              {/* T-038: 「新しく作り直す」ボタン（confirm 付き）*/}
              <button
                type="button"
                onClick={handleStartFresh}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                新しく作り直す
              </button>
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
