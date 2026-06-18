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
// 改修①: 全カテゴリで generate と create の間に "confirmQuestions"（質問確認画面）を挟む。
// （T-035 step2 ではその他系のみだったが、全カテゴリで事前確認するよう変更）
// 改修③（途中保存）: モーダルを開いた時に下書きがあれば "restorePrompt"（復元確認）を挟む。
type ModalStep =
  | "idle"
  | "restorePrompt"
  | "processing"
  | "selectCompany"
  | "confirmQuestions"
  | "completed"
  | "error";

type WorkHistoryEntry = {
  company?: string;
  period?: string;
  [key: string]: unknown;
};

// T-035 step2: 確認画面プレビュー用の questionsJson 最小型（candidate-intake の QuestionsJson に準拠、表示のみ）。
type PreviewQuestionItem = {
  type?: string;
  title?: string;
  help_text?: string | null;
  choices?: string[] | null;
  required?: boolean | null;
};
type PreviewQuestionSection = {
  id?: string;
  header?: string;
  items?: PreviewQuestionItem[];
};
type PreviewQuestions = {
  candidate_name?: string;
  greeting?: string;
  sections?: PreviewQuestionSection[];
};

// 質問タイプの日本語ラベル（確認画面の表示用）。
const ITEM_TYPE_LABEL: Record<string, string> = {
  short_text: "記述（短）",
  long_text: "記述（長）",
  single_select: "単一選択",
  multi_select: "複数選択",
  dropdown: "プルダウン",
  section_header: "見出し",
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

// T-035 step2: 部分再生成の対象にできるセクション（AI生成系のみ）。
// work_content_*（職務内容・実績などAI生成）と mindset のみ。consent/個人情報/固定dutiesは対象外。
function isEditableSection(sectionId: string | undefined | null): boolean {
  return !!sectionId && (sectionId.startsWith("work_content") || sectionId === "mindset");
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

  // T-035 step2: 確認画面の部分再生成。チェック済み item（key=`${sectionId}__${itemIndex}`）と指示文。
  const [checkedTargets, setCheckedTargets] = useState<Record<string, boolean>>({});
  const [regenerateInstruction, setRegenerateInstruction] = useState<string>("");
  const [regenerateNotice, setRegenerateNotice] = useState<string | null>(null);

  // 改修③（途中保存）: 開いた時に見つかった下書き（復元プロンプト用）と保存状態。
  const [draftPrompt, setDraftPrompt] = useState<{ questionsJson: unknown; updatedAt: string | null } | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSavedNotice, setDraftSavedNotice] = useState<string | null>(null);

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
          return; // 既存フォームあり → 下書き確認はスキップ
        }
      } catch (err) {
        // サイレントに idle 表示（通常の新規作成フローにフォールバック）
        console.warn("[GoogleFormCreatorModal] Failed to check existing URL:", err);
      }

      // 改修③（途中保存）: フォーム未作成なら下書きを確認 → あれば復元プロンプトを表示。
      // 同一セッションで既に確認画面まで進んでいる（questionsJson 保持中）場合は復元プロンプトを出さない。
      if (questionsJson) return;
      try {
        const dres = await fetch(`/api/candidates/${candidateId}/google-form/draft`);
        if (!dres.ok) return;
        const ddata = await dres.json();
        if (ddata?.draft?.questionsJson) {
          setDraftPrompt({
            questionsJson: ddata.draft.questionsJson,
            updatedAt: ddata.draft.updatedAt ?? null,
          });
          setStep("restorePrompt");
        }
      } catch (err) {
        console.warn("[GoogleFormCreatorModal] Failed to check draft:", err);
      }
    })();
  }, [isOpen, hasCheckedExistingUrl, formResult, candidateId, questionsJson]);

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
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);
    setDraftPrompt(null);
    setDraftSaving(false);
    setDraftSavedNotice(null);
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

  // 選択中のカテゴリ（1画面目 categoryValue か 会社別 companyCategoryMap）に
  // その他系コードが含まれるか。
  // 改修①以降、確認画面は全カテゴリで表示するため、この判定は
  // 「その他系の自由記入ラベル（achievementCategoryOtherLabel）を送るか」の判断にのみ使う。
  const includesOtherType = (): boolean =>
    isOtherTypeCategory(categoryValue) ||
    Object.values(companyCategoryMap).some((c) => isOtherTypeCategory(c));

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
      const hasOtherTypeSomewhere = includesOtherType();

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
      // 改修③（途中保存）: フォーム作成に成功したら下書きを自動削除（残り続けないように）。
      // 失敗してもフォーム作成自体は成功扱い（fire-and-forget）。
      fetch(`/api/candidates/${candidateId}/google-form/draft`, { method: "DELETE" }).catch(
        () => {},
      );
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

  // T-035: 質問生成 開始。
  // 通常職種：generate → 即 create（従来通り）。
  // T-035 step2 その他系：generate のあと確認画面で停止（create はユーザー操作で実行）。
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
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);

    const e2 = await runGenerate(resumeData, interviewLogText);
    if (!e2) {
      setStep("error");
      return;
    }

    // 改修①（全カテゴリ事前確認化）: カテゴリに関わらず必ず確認画面で停止する。
    // create_form_v2 はユーザーが確認画面で「フォーム作成」を押したときのみ実行する
    // （従来は その他系のみ確認画面・それ以外は即フォーム化していた）。
    setStep("confirmQuestions");
  };

  // T-035 step2: 確認画面「フォーム作成」。保持中の questionsJson でフォーム化（create_form_v2）。
  const handleConfirmCreate = async () => {
    if (!questionsJson) return;
    setStep("processing");
    setErrorMessage(null);
    setStageStatus((s) => ({ ...s, create: "pending" }));
    setFormResult(null);

    const e3 = await runCreate(questionsJson);
    if (!e3) {
      setStep("error");
      return;
    }
    setStep("completed");
    toast.success("Google フォーム作成完了");
  };

  // 改修③（途中保存）: 現在の questionsJson を下書きとして保存（PUT upsert）。
  const handleSaveDraft = async () => {
    if (!questionsJson) return;
    setDraftSaving(true);
    setDraftSavedNotice(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/google-form/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionsJson }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `途中保存に失敗しました (HTTP ${res.status})`);
      }
      setDraftSavedNotice("保存しました");
      toast.success("途中保存しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftSaving(false);
    }
  };

  // 改修③（途中保存）: 下書きを復元 → 生成をスキップして確認画面へ。
  const handleRestoreDraft = () => {
    if (!draftPrompt) return;
    setQuestionsJson(draftPrompt.questionsJson);
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);
    setDraftSavedNotice(null);
    setDraftPrompt(null);
    setStep("confirmQuestions");
  };

  // 改修③（途中保存）: 下書きを破棄 → 通常の新規作成フロー（idle）へ。
  const handleDiscardDraft = async () => {
    setDraftPrompt(null);
    setStep("idle");
    try {
      await fetch(`/api/candidates/${candidateId}/google-form/draft`, { method: "DELETE" });
    } catch (e) {
      console.warn("[GoogleFormCreatorModal] draft delete failed:", e);
    }
  };

  // T-035 step2: 確認画面「やり直し」。同パラメータで generate_form を再呼び出し → 確認画面を更新。
  const handleRegenerate = async () => {
    // 改修③: 下書き復元など、解析データが無い状態では最初からの作り直しはできない。
    if (!resumeData) {
      toast.error("最初から作り直すには、いったん閉じて履歴書解析からやり直してください。");
      return;
    }
    setErrorMessage(null);
    setStageStatus((s) => ({ ...s, generate: "pending" }));
    const e2 = await runGenerate(resumeData, interviewLogText);
    if (!e2) {
      setStep("error");
      return;
    }
    // 成功時：runGenerate が questionsJson を更新済み。confirmQuestions のまま再描画される。
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);
  };

  // T-035 step2: 確認画面の部分再生成。チェックした item ＋指示で regenerate_questions を呼ぶ。
  // - チェックあり → その item のみ targets。
  // - チェックなし＋指示あり → 許可セクション内の全 item を targets に展開（全体指示）。
  // - 返ってきた questionsJson をそのまま次の previousQuestionsJson として保持（index ずれ防止）。
  const handleRegenerateTargeted = async () => {
    const instruction = regenerateInstruction.trim();
    if (!instruction || stageStatus.generate === "running") return;

    const q = (questionsJson ?? {}) as PreviewQuestions;
    const sections = q.sections ?? [];
    const targets: { sectionId: string; itemIndex: number }[] = Object.entries(checkedTargets)
      .filter(([, v]) => v)
      .map(([k]) => {
        const idx = k.lastIndexOf("__");
        return { sectionId: k.slice(0, idx), itemIndex: Number(k.slice(idx + 2)) };
      });

    // チェックなし → 許可セクションの全 item を対象に展開（全体指示）。
    if (targets.length === 0) {
      sections.forEach((sec) => {
        if (!isEditableSection(sec.id)) return;
        (sec.items ?? []).forEach((_, ii) => targets.push({ sectionId: sec.id as string, itemIndex: ii }));
      });
    }
    if (targets.length === 0) {
      toast.error("再生成できる質問（AI生成セクション）がありません");
      return;
    }

    setStageStatus((s) => ({ ...s, generate: "running" }));
    setRegenerateNotice(null);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/google-form/regenerate-questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previousQuestionsJson: questionsJson, instruction, targets }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `再生成失敗 (HTTP ${res.status})`);
      }
      const data = await res.json();
      // サーバから返った JSON をそのまま保持（次の previousQuestionsJson＝index ずれ防止）。
      setQuestionsJson(data.questionsJson);
      setCheckedTargets({});
      setRegenerateInstruction("");
      const regenCount = Array.isArray(data.regenerated) ? data.regenerated.length : data.regenerated ? 1 : 0;
      if (regenCount === 0) setRegenerateNotice("変更されませんでした。");
      setStageStatus((s) => ({ ...s, generate: "done" }));
    } catch (e) {
      // 確認画面に留めてエラーをトーストで知らせる（error ステップには飛ばさない）。
      setStageStatus((s) => ({ ...s, generate: "done" }));
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // 改修②（チェック削除）: チェックした質問を questionsJson から一括削除する。
  // - 各 item のキーは `${sec.id ?? ""}__${itemIndex}`（チェックボックスと同一規則）。
  // - 元の item オブジェクトは filter で温存（type/choices 等のフィールド欠損なし）。
  // - 削除後は itemIndex がずれるため checkedTargets を必ずクリアする（調査の「唯一の注意点」）。
  // - 削除はクライアント state のみ。create_form_v2 / regenerate_questions は渡した配列をそのまま使う。
  const handleDeleteChecked = () => {
    const checkedKeys = Object.entries(checkedTargets)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (checkedKeys.length === 0) return;
    if (!window.confirm(`選択した ${checkedKeys.length} 件の質問を削除しますか？`)) return;

    const checkedSet = new Set(checkedKeys);
    const q = (questionsJson ?? {}) as PreviewQuestions;
    const sections = q.sections ?? [];
    const newSections = sections.map((sec) => {
      const items = sec.items ?? [];
      const keptItems = items.filter(
        (_, ii) => !checkedSet.has(`${sec.id ?? ""}__${ii}`),
      );
      return { ...sec, items: keptItems };
    });

    setQuestionsJson({ ...q, sections: newSections });
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);
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
    const questions: unknown = questionsJson;

    if (stageStatus.generate === "failed") {
      setStageStatus((s) => ({ ...s, generate: "pending", create: "pending" }));
      const r = await runGenerate(resume, log);
      if (!r) {
        setStep("error");
        return;
      }
      // 改修①（全カテゴリ事前確認化）: 質問生成に成功したら全カテゴリで確認画面へ戻す
      // （create はユーザーが確認画面で実行する）。
      setStep("confirmQuestions");
      return;
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
        className={`bg-white rounded-xl w-full mx-4 p-6 max-h-[92vh] overflow-y-auto shadow-xl ${
          step === "confirmQuestions" ? "max-w-5xl" : "max-w-2xl"
        }`}
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

        {/* 改修③（途中保存）: restorePrompt - 下書き復元の確認 */}
        {step === "restorePrompt" && (
          <div>
            <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-[13px] text-blue-800">
              この求職者の <span className="font-semibold">フォーム質問の下書き</span> が保存されています。
              {draftPrompt?.updatedAt && (
                <span className="block text-[12px] text-blue-700 mt-1">
                  保存日時: {new Date(draftPrompt.updatedAt).toLocaleDateString("sv-SE")}{" "}
                  {new Date(draftPrompt.updatedAt).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
            <p className="mb-4 text-[13px] text-gray-600">
              続きから再開するか、破棄して新しく作成し直すかを選んでください。
            </p>
            <div className="flex gap-2 pt-2 border-t border-gray-200">
              <button
                onClick={handleClose}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                閉じる
              </button>
              <button
                onClick={handleDiscardDraft}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-[13px] font-medium hover:bg-gray-50"
              >
                破棄して新規作成
              </button>
              <button
                onClick={handleRestoreDraft}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]"
              >
                続きから
              </button>
            </div>
          </div>
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

        {/* Step 1.7: confirmQuestions - 質問確認画面（T-035 step2、その他系のみ）。
            チェック＋指示で部分再生成。確認画面のみ広く・文字を大きく。 */}
        {step === "confirmQuestions" && (() => {
          const q = (questionsJson ?? {}) as PreviewQuestions;
          const sections = q.sections ?? [];
          const isRegenerating = stageStatus.generate === "running";
          const totalItems = sections.reduce((n, s) => n + (s.items?.length ?? 0), 0);
          const checkedCount = Object.values(checkedTargets).filter(Boolean).length;
          const canRegenerate = regenerateInstruction.trim().length > 0 && !isRegenerating;
          return (
            <div>
              <div className="mb-3 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-[14px] text-green-800">
                ✓ 質問を生成しました（{sections.length} セクション / {totalItems} 項目）。内容をご確認ください。
                <span className="block text-[12px] text-green-700 mt-1">
                  この時点ではまだ Google フォームは作成されていません。
                </span>
              </div>
              <div className="mb-3 rounded-md bg-yellow-50 border border-yellow-200 px-4 py-3 text-[13px] text-yellow-800">
                ⚠️ 修正したい場合はGoogleフォーム編集画面で後ほど修正してください。
              </div>
              <div className="mb-3 rounded-md bg-blue-50 border border-blue-200 px-4 py-2.5 text-[12px] text-blue-800">
                💡 直したい質問（AI生成セクションのみ選択可）にチェックを入れ、下の欄に指示を書いて「この内容で再生成」を押すと、その質問だけを作り直せます。チェックなしで指示すると、AI生成質問全体を直します。
              </div>

              {q.greeting && (
                <div className="mb-3 text-[13px] text-gray-600 whitespace-pre-wrap border border-gray-100 rounded-md p-3 bg-gray-50">
                  {q.greeting}
                </div>
              )}

              <div className="space-y-4 mb-4 pr-1">
                {sections.length === 0 ? (
                  <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-4 text-center text-[13px] text-gray-500">
                    質問が生成されませんでした。「やり直し」で再生成してください。
                  </div>
                ) : (
                  sections.map((sec, si) => {
                    const editable = isEditableSection(sec.id);
                    return (
                      <div key={sec.id ?? si} className="border border-gray-200 rounded-md">
                        <div className="bg-[#F9FAFB] px-4 py-2.5 text-[15px] font-semibold text-[#374151] border-b border-gray-200 flex items-center gap-2">
                          <span>{sec.header || `セクション ${si + 1}`}</span>
                          {editable ? (
                            <span className="text-[11px] font-normal text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">再生成OK</span>
                          ) : (
                            <span className="text-[11px] font-normal text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">🔒 固定</span>
                          )}
                        </div>
                        <ol className="divide-y divide-gray-100">
                          {(sec.items ?? []).map((it, ii) => {
                            const key = `${sec.id ?? ""}__${ii}`;
                            return (
                              <li key={ii} className="px-4 py-3">
                                <div className="flex items-start gap-3">
                                  {editable ? (
                                    <input
                                      type="checkbox"
                                      checked={!!checkedTargets[key]}
                                      disabled={isRegenerating}
                                      onChange={(e) => {
                                        setRegenerateNotice(null);
                                        setCheckedTargets((prev) => ({ ...prev, [key]: e.target.checked }));
                                      }}
                                      className="mt-1 w-4 h-4 accent-[#2563EB] shrink-0 disabled:opacity-40"
                                    />
                                  ) : (
                                    <span className="mt-1 w-4 h-4 shrink-0" aria-hidden />
                                  )}
                                  <span className="text-[12px] text-gray-400 mt-0.5">{ii + 1}.</span>
                                  <div className="flex-1">
                                    <div className="text-[14px] text-[#374151] leading-relaxed">
                                      {it.title || "（無題）"}
                                      {it.required ? <span className="text-red-500 ml-1">*</span> : null}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] text-gray-500 bg-gray-100 rounded px-2 py-0.5">
                                        {ITEM_TYPE_LABEL[it.type ?? ""] ?? it.type ?? "—"}
                                      </span>
                                      {it.choices && it.choices.length > 0 && (
                                        <span className="text-[11px] text-gray-400">
                                          選択肢: {it.choices.join(" / ")}
                                        </span>
                                      )}
                                    </div>
                                    {it.help_text && (
                                      <div className="mt-1 text-[11px] text-gray-400">{it.help_text}</div>
                                    )}
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 改修②（チェック削除）: チェック中の質問を一括削除。チェック1件以上で活性。 */}
              {checkedCount > 0 && (
                <div className="mb-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2">
                  <span className="text-[12px] text-red-700">
                    {checkedCount} 問を選択中
                  </span>
                  <div className="flex items-center gap-2">
                    {/* T-100b: チェックを一括解除（質問は削除しない）。チェック1件以上のときのみ表示・活性。 */}
                    <button
                      onClick={() => { setCheckedTargets({}); setRegenerateNotice(null); }}
                      disabled={isRegenerating}
                      className="border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-1.5 text-[12px] font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      選択をすべて解除
                    </button>
                    <button
                      onClick={handleDeleteChecked}
                      disabled={isRegenerating}
                      className="border border-red-300 bg-white text-red-600 rounded-md px-3 py-1.5 text-[12px] font-medium hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      選択した質問を削除
                    </button>
                  </div>
                </div>
              )}

              {/* T-100c: 指示で再生成の入力＋下部アクションをスティッキー領域にし、質問リストだけが上でスクロールするようにする。
                  モーダル本体(overflow-y-auto)を唯一のスクロールコンテナにし、この領域を bottom-0 で固定。 */}
              <div className="sticky bottom-0 -mx-6 -mb-6 px-6 pt-3 pb-4 bg-white border-t border-gray-200">
              {/* 指示チャット欄＋部分再生成 */}
              <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                <label className="block text-[13px] font-medium text-[#374151] mb-1.5">
                  指示で再生成
                  {checkedCount > 0 ? (
                    <span className="ml-2 text-[12px] text-blue-600 font-normal">チェック中: {checkedCount} 問</span>
                  ) : (
                    <span className="ml-2 text-[12px] text-gray-400 font-normal">（チェックなし＝AI生成質問全体が対象）</span>
                  )}
                </label>
                <textarea
                  value={regenerateInstruction}
                  onChange={(e) => {
                    setRegenerateInstruction(e.target.value);
                    setRegenerateNotice(null);
                  }}
                  disabled={isRegenerating}
                  rows={2}
                  placeholder="チェックした質問をどう直したいか入力（例: もっと専門的に／この2問を1つに）"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:bg-gray-100 resize-y"
                />
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={handleRegenerateTargeted}
                    disabled={!canRegenerate}
                    className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRegenerating ? "再生成中..." : "この内容で再生成"}
                  </button>
                  {isRegenerating && (
                    <span className="flex items-center gap-2 text-[12px] text-blue-700">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                      質問を再生成中...
                    </span>
                  )}
                  {regenerateNotice && !isRegenerating && (
                    <span className="text-[12px] text-gray-500">{regenerateNotice}</span>
                  )}
                </div>
              </div>

              {/* 改修②: 全質問を削除した場合はフォーム作成不可（空フォーム防止）。 */}
              {totalItems === 0 && (
                <div className="mb-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-[12px] text-yellow-800">
                  質問が1件もありません。フォームを作成するには質問が1件以上必要です（「最初から作り直し」で再生成できます）。
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleClose}
                  disabled={isRegenerating}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  閉じる
                </button>
                {/* 改修③（途中保存）: 現在の質問内容を下書き保存。 */}
                <button
                  onClick={handleSaveDraft}
                  disabled={isRegenerating || draftSaving || totalItems === 0}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {draftSaving ? "保存中..." : "途中保存"}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="flex-1 border border-[#2563EB] text-[#2563EB] bg-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-blue-50 disabled:opacity-50"
                >
                  {isRegenerating ? "再生成中..." : "最初から作り直し"}
                </button>
                <button
                  onClick={handleConfirmCreate}
                  disabled={isRegenerating || totalItems === 0}
                  className="flex-1 bg-[#16A34A] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50"
                >
                  フォーム作成
                </button>
              </div>
              {draftSavedNotice && (
                <div className="mt-1 text-right text-[12px] text-green-600">{draftSavedNotice}</div>
              )}
              </div>
            </div>
          );
        })()}

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
