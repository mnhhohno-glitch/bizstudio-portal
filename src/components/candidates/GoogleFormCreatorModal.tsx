"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  GOOGLE_FORM_CATEGORY_GROUPS,
  resolveGoogleFormGroupKey,
} from "@/constants/google-form-categories";
import type { GoogleFormRequestData } from "@/constants/google-form-request";
import { useOverlayClose } from "@/hooks/useOverlayClose";

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

// T-171: 「Googleフォーム作成依頼」タスク（未完了・最新1件）の受け取り型。
// GET /api/candidates/[id]/google-form/request の request をそのまま持つ。
type GoogleFormRequestInfo = {
  taskId: string;
  title: string;
  status: string;
  createdAt: string;
  createdByName: string | null;
  data: GoogleFormRequestData;
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

  // T-171: 「Googleフォーム作成依頼」タスク由来の依頼内容。
  // requestIgnored=true は「依頼内容を使わずに最初からやり直す」を押した状態。
  const [requestInfo, setRequestInfo] = useState<GoogleFormRequestInfo | null>(null);
  const [requestIgnored, setRequestIgnored] = useState(false);
  // T-171: selectCompany の会社カードに出す職種詳細ヒント（キー=work_history index 文字列）。
  const [requestDetailMap, setRequestDetailMap] = useState<Record<string, string>>({});

  // 改修③（途中保存）: 開いた時に見つかった下書き（復元プロンプト用）と保存状態。
  const [draftPrompt, setDraftPrompt] = useState<{ questionsJson: unknown; updatedAt: string | null } | null>(null);
  // 自動保存の3状態表示（保存中 / 保存しました / 保存に失敗しました）。
  // 手動の「途中保存」ボタンからも同じ saveDraftNow を呼ぶので、この state に集約する。
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // 「フォーム作成」押下時の確認ダイアログの表示制御。
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  // 「この内容で再生成」を最後に実行したときの指示テキスト（trim 済）。
  // 現在の regenerateInstruction と比較して、未反映の指示があるかを確認ダイアログで判定する。
  const [lastAppliedInstruction, setLastAppliedInstruction] = useState<string>("");
  // 自動保存のレースコンディション対策トークン。古いレスポンスで状態を上書きしない。
  const saveTokenRef = useRef(0);
  // 800ms デバウンスタイマーの参照。フォーム作成前フラッシュでキャンセルする。
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 確認ダイアログの「キャンセル」に初期フォーカスを当てるための参照。
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

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
      // T-171: 未完了の「Googleフォーム作成依頼」タスク（最新1件）を取得。
      // 見つかったら初期選択（大項目/サブカテゴリ/自由記述/PDF・txt）を依頼値で埋める。
      // 既存フォームありでも requestInfo は保持する（完了画面の「依頼タスクへ」リンク用）。
      let loadedRequest: GoogleFormRequestInfo | null = null;
      try {
        const rres = await fetch(`/api/candidates/${candidateId}/google-form/request`);
        if (rres.ok) {
          const rdata = await rres.json();
          if (rdata?.request?.data) {
            loadedRequest = rdata.request as GoogleFormRequestInfo;
            setRequestInfo(loadedRequest);
            setRequestIgnored(false);
            const d = loadedRequest.data;
            // T-170: 依頼保存時と定義が変わっている場合があるため、
            // サブカテゴリの実所属から大項目を解決する（コードは全グループで一意）。
            const resolvedGroupKey = resolveGoogleFormGroupKey(d.groupKey, d.categoryValue);
            if (resolvedGroupKey) setGroupKey(resolvedGroupKey);
            if (d.categoryValue) setCategoryValue(d.categoryValue);
            setOtherLabel(d.otherLabel ?? "");
            if (d.pdfFileId && meetingFiles.some((f) => f.id === d.pdfFileId)) {
              setSelectedPdfFileId(d.pdfFileId);
            }
            if (d.txtFileId && meetingFiles.some((f) => f.id === d.txtFileId)) {
              setSelectedTxtFileId(d.txtFileId);
            }
          }
        }
      } catch (err) {
        console.warn("[GoogleFormCreatorModal] Failed to check request task:", err);
      }

      try {
        const res = await fetch(`/api/candidates/${candidateId}/interviews`);
        if (!res.ok) return;
        const data = await res.json();
        const records: InterviewRecordForGoogleForm[] = data.records || [];

        // 出力済みフォームのURLは、フォーム作成後に面談が追加されると isLatest=false に降格した
        // 旧レコードへ取り残されることがある。そのため isLatest だけでなく全レコードから
        // edit/view 両URLを持つものを探し、複数あれば作成日時が最新のものを採用する。
        const formRecord = records
          .filter((r) => r.googleFormEditUrl && r.googleFormViewUrl)
          .sort(
            (a, b) =>
              new Date(b.googleFormCreatedAt ?? 0).getTime() -
              new Date(a.googleFormCreatedAt ?? 0).getTime(),
          )[0];

        if (formRecord?.googleFormEditUrl && formRecord?.googleFormViewUrl) {
          setFormResult({
            formId: formRecord.googleFormId || "",
            editUrl: formRecord.googleFormEditUrl,
            viewUrl: formRecord.googleFormViewUrl,
            persisted: true,
          });
          setFormCreatedAt(formRecord.googleFormCreatedAt);
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
  }, [isOpen, hasCheckedExistingUrl, formResult, candidateId, questionsJson, meetingFiles]);

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
  const overlayClose = useOverlayClose(handleClose);

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
    setAutoSaveStatus("idle");
    setShowCreateConfirm(false);
    setLastAppliedInstruction("");
    setRequestDetailMap({});
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  // T-171: 「依頼内容を使わずに最初からやり直す」。依頼由来の初期選択をすべて解除して
  // 通常の新規作成フローに戻す（handleResetAll 相当＋カテゴリ選択のクリア）。
  const handleIgnoreRequest = () => {
    setRequestIgnored(true);
    handleResetAll();
    setGroupKey("");
    setCategoryValue("");
    setOtherLabel("");
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

  // T-171: デフォルト適用後、依頼（Googleフォーム作成依頼タスク）の会社別分類で上書きする。
  // useIndex=true: 依頼 JSON の index で work_history に対応付け（依頼時の resumeData を再利用する場合）。
  // useIndex=false: 会社名一致（空白除去の完全一致）で対応付け。当たらない会社は既定カテゴリのまま。
  // あわせて会社カードのヒント用に職種詳細（detail）マップも組み立てる。
  const initializeCompanyMapsWithRequest = (workHistory: WorkHistoryEntry[], useIndex: boolean) => {
    initializeCompanyCategoryMap(workHistory, groupKey, categoryValue, otherLabel);
    const req = !requestIgnored ? requestInfo : null;
    if (!req || !Array.isArray(req.data.companies)) {
      setRequestDetailMap({});
      return;
    }
    const norm = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, "");
    const mapPatch: Record<string, string> = {};
    const groupPatch: Record<string, string> = {};
    const detailMap: Record<string, string> = {};
    workHistory.forEach((w, i) => {
      const key = String(i);
      const match = useIndex
        ? req.data.companies.find((c) => c.index === i)
        : req.data.companies.find((c) => norm(c.name) !== "" && norm(c.name) === norm(w.company));
      if (!match) return;
      if (match.categoryValue) {
        mapPatch[key] = match.categoryValue;
        // T-170: 保存済み groupKey より、サブカテゴリの実所属を優先する
        groupPatch[key] = resolveGoogleFormGroupKey(match.groupKey, match.categoryValue);
      }
      if (match.detail) detailMap[key] = match.detail;
    });
    if (Object.keys(mapPatch).length > 0) {
      setCompanyCategoryMap((prev) => ({ ...prev, ...mapPatch }));
      setCompanyGroupMap((prev) => ({ ...prev, ...groupPatch }));
    }
    setRequestDetailMap(detailMap);
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

    // T-171: 依頼の resumeData を再利用できる場合は extract（30〜75秒の解析）を省略する。
    // 条件: 依頼が extract 方式・resumeData あり・依頼時と同じ PDF が現存し選択中。
    // 面談ログ（.txt）はローカル DL で読めるため candidate-intake を呼ぶ必要がない。
    const req = !requestIgnored ? requestInfo : null;
    const canReuseRequestResume =
      !!req &&
      req.data.inputMode === "extract" &&
      req.data.resumeData != null &&
      !!req.data.pdfFileId &&
      selectedPdfFileId === req.data.pdfFileId &&
      meetingFiles.some((f) => f.id === req.data.pdfFileId);
    if (canReuseRequestResume && req && selectedTxtFileId) {
      setStageStatus((s) => ({ ...s, extract: "running" }));
      try {
        const tres = await fetch(`/api/candidates/${candidateId}/files/${selectedTxtFileId}?download=true`);
        if (!tres.ok) throw new Error(`面談ログの取得に失敗しました (HTTP ${tres.status})`);
        const logText = await tres.text();
        setResumeData(req.data.resumeData);
        setInterviewLogText(logText);
        setStageStatus((s) => ({ ...s, extract: "done" }));
        initializeCompanyMapsWithRequest(getWorkHistory(req.data.resumeData), true);
        setStep("selectCompany");
        return;
      } catch (err) {
        // 再利用に失敗したら通常の extract にフォールバック
        console.warn("[GoogleFormCreatorModal] request resume reuse failed, fallback to extract:", err);
        setStageStatus((s) => ({ ...s, extract: "pending" }));
      }
    }

    const e1 = await runExtract();
    if (!e1) {
      setStep("error");
      return;
    }
    // 依頼あり（手入力方式・PDF 変更時など）は会社名一致で依頼の分類を当てる
    initializeCompanyMapsWithRequest(getWorkHistory(e1.resumeData), false);
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

  // T-035 step2: 確認画面「フォーム作成」ボタン。いきなり作成せず確認ダイアログを1枚挟む。
  // 実際の作成処理は doCreate。
  const handleConfirmCreate = () => {
    if (!questionsJson) return;
    setShowCreateConfirm(true);
  };

  // 確認ダイアログの「フォームを作成する」を押したときの本体処理。
  // 1) デバウンス待ちの未保存分をフラッシュ → 保存できなければ作成中止。
  // 2) create_form_v2 を実行。
  const doCreate = async () => {
    setShowCreateConfirm(false);
    if (!questionsJson) return;

    setStep("processing");
    setErrorMessage(null);
    setStageStatus((s) => ({ ...s, create: "pending" }));
    setFormResult(null);

    // フォーム作成前フラッシュ: create_form_v2 はローカル state を送るが、
    // 「保存 → 作成の順序を保証」するため下書きも先に確定させる。
    const flushed = await flushPendingDraft();
    if (!flushed) {
      setStep("confirmQuestions");
      toast.error("編集内容の保存に失敗したため、フォーム作成を中止しました。保存状態を確認して再度お試しください。");
      return;
    }

    const e3 = await runCreate(questionsJson);
    if (!e3) {
      setStep("error");
      return;
    }
    setStep("completed");
    toast.success("Google フォーム作成完了");
  };

  // 確認ダイアログを開いた瞬間に「キャンセル」へフォーカスを移す（Enter 誤爆で作成されないように）。
  useEffect(() => {
    if (showCreateConfirm) {
      // 描画後に focus を当てるため次フレームで実行。
      queueMicrotask(() => cancelButtonRef.current?.focus());
    }
  }, [showCreateConfirm]);

  // 現在のテキストエリア値と、最後に「この内容で再生成」を押したときの指示テキストが
  // 一致しない、かつ現在の値が空でない場合、指示が未反映のまま残っていると判定。
  const hasStaleInstruction =
    regenerateInstruction.trim() !== "" &&
    regenerateInstruction.trim() !== lastAppliedInstruction;

  // 自動保存の中核。PUT /draft を1回実行し、失敗したら1回だけ自動リトライ。
  // saveTokenRef で古いレスポンスによる state 上書きを防ぐ（レースコンディション対策）。
  // 呼び出し元: 自動保存 effect / 「途中保存」ボタン / フォーム作成前フラッシュ。
  const saveDraftNow = useCallback(
    async (payload: unknown): Promise<boolean> => {
      const token = ++saveTokenRef.current;
      setAutoSaveStatus("saving");
      const doPut = async () => {
        const res = await fetch(`/api/candidates/${candidateId}/google-form/draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionsJson: payload }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || `保存に失敗しました (HTTP ${res.status})`);
        }
      };
      try {
        await doPut();
        if (saveTokenRef.current === token) setAutoSaveStatus("saved");
        return true;
      } catch {
        try {
          await doPut();
          if (saveTokenRef.current === token) setAutoSaveStatus("saved");
          return true;
        } catch {
          if (saveTokenRef.current === token) setAutoSaveStatus("failed");
          return false;
        }
      }
    },
    [candidateId],
  );

  // 自動保存: confirmQuestions 中に questionsJson が変わったら 800ms デバウンスで保存する。
  // - 削除（handleDeleteChecked）/ 再生成（handleRegenerate*）で questionsJson が変わるたびに再スケジュール。
  // - null / step 不一致では走らない。
  // - unmount / 依存変更でタイマーは常にクリーンアップ。
  useEffect(() => {
    if (step !== "confirmQuestions") return;
    if (!questionsJson) return;
    const timer = setTimeout(() => {
      void saveDraftNow(questionsJson);
    }, 800);
    debounceTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (debounceTimerRef.current === timer) debounceTimerRef.current = null;
    };
  }, [questionsJson, step, saveDraftNow]);

  // フォーム作成前フラッシュ: デバウンス待ちをキャンセルして、直近の questionsJson を確定保存する。
  // 「フォーム作成」を押した瞬間に呼ぶ。保存失敗時は false を返し、呼び出し元がフォーム作成を中止する。
  const flushPendingDraft = async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!questionsJson) return true;
    return await saveDraftNow(questionsJson);
  };

  // 手動「途中保存」ボタン。saveDraftNow に集約（自動保存と同じ状態表示に統一）。
  const handleSaveDraft = async () => {
    if (!questionsJson) return;
    const ok = await saveDraftNow(questionsJson);
    if (ok) toast.success("途中保存しました");
    else toast.error("途中保存に失敗しました");
  };

  // 改修③（途中保存）: 下書きを復元 → 生成をスキップして確認画面へ。
  const handleRestoreDraft = () => {
    if (!draftPrompt) return;
    setQuestionsJson(draftPrompt.questionsJson);
    setCheckedTargets({});
    setRegenerateInstruction("");
    setRegenerateNotice(null);
    setLastAppliedInstruction("");
    setAutoSaveStatus("idle");
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
    // 「最初から作り直し」は指示テキスト不要のため、未反映指示の追跡もクリア。
    setLastAppliedInstruction("");
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
      // 適用した指示を記録（確認ダイアログの未反映警告判定に使う）。
      setLastAppliedInstruction(instruction);
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
      initializeCompanyMapsWithRequest(getWorkHistory(r.resumeData), false);
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
    <>
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      {...overlayClose}
    >
      <div
        className={`bg-white rounded-xl w-full mx-4 p-6 max-h-[92vh] overflow-y-auto shadow-xl ${
          step === "confirmQuestions" ? "max-w-6xl" : "max-w-2xl"
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
            {/* T-171: 依頼タスクの内容を読み込んだバナー（日時は JST 表示） */}
            {requestInfo && !requestIgnored && (
              <div className="mb-4 rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2.5 text-[12px] text-indigo-900">
                <p className="font-medium">
                  📋 依頼内容を読み込みました（タスク: {requestInfo.title}／依頼者: {requestInfo.createdByName ?? "不明"}／
                  {new Date(requestInfo.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}{" "}
                  {new Date(requestInfo.createdAt).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Tokyo",
                  })}）
                </p>
                <p className="mt-0.5 text-indigo-700">
                  経験職種カテゴリ・対象ファイル・会社別の職種分類を依頼内容から初期設定しています。
                  {requestInfo.data.memo && (
                    <span className="block mt-0.5">依頼メモ: {requestInfo.data.memo}</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={handleIgnoreRequest}
                  className="mt-1.5 text-[12px] font-medium text-indigo-700 underline hover:text-indigo-900"
                >
                  依頼内容を使わずに最初からやり直す
                </button>
              </div>
            )}

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
              {/* T-171: 依頼タスクもあるが FormDraft を優先している旨の表示 */}
              {requestInfo && (
                <span className="block text-[12px] text-blue-700 mt-1 font-medium">
                  依頼内容あり（途中保存を優先表示中）: {requestInfo.title}
                </span>
              )}
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
                        {/* T-171: 依頼タスクに書かれた職種詳細のヒント表示（この会社分） */}
                        {requestDetailMap[key] && (
                          <p className="mt-1.5 rounded bg-indigo-50 border border-indigo-100 px-2 py-1 text-[11px] text-indigo-800">
                            💡 依頼の職種詳細: {requestDetailMap[key]}
                          </p>
                        )}
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

              {/* T-100c/T-100e: 選択バー＋指示で再生成の入力＋下部アクションをスティッキー領域にし、
                  質問リストだけが上でスクロールするようにする。
                  モーダル本体(overflow-y-auto)を唯一のスクロールコンテナにし、この領域を bottom-0 で固定。 */}
              <div className="sticky bottom-0 -mx-6 -mb-6 px-6 pt-3 pb-4 bg-white border-t border-gray-200">
              {/* 改修②（チェック削除）＋一括解除: 選択バー。チェック1件以上で表示。スティッキー領域内に配置し
                  リストをスクロールしても埋もれないようにする。 */}
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
                {/* 改修③（途中保存）: 現在の質問内容を下書き保存。
                    自動保存も動いているため必須ではないが、明示的な確定操作として残す。 */}
                <button
                  onClick={handleSaveDraft}
                  disabled={isRegenerating || autoSaveStatus === "saving" || totalItems === 0}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {autoSaveStatus === "saving" ? "保存中..." : "途中保存"}
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
              {/* 自動保存の3状態表示。「保存に失敗しました」には手動リトライ導線を付ける。 */}
              {autoSaveStatus !== "idle" && (
                <div className="mt-1 text-right text-[12px]">
                  {autoSaveStatus === "saving" && <span className="text-gray-500">保存中…</span>}
                  {autoSaveStatus === "saved" && <span className="text-green-600">保存しました</span>}
                  {autoSaveStatus === "failed" && (
                    <>
                      <span className="text-red-600">保存に失敗しました </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (questionsJson) void saveDraftNow(questionsJson);
                        }}
                        className="underline text-red-600"
                      >
                        再試行
                      </button>
                    </>
                  )}
                </div>
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
              <div className="flex items-center gap-2">
                {/* T-171: 依頼タスクへのリンク（完了操作は担当者の手動。ステータスは変更しない） */}
                {requestInfo && (
                  <a
                    href={`/tasks/${requestInfo.taskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border border-[#2563EB] bg-white text-[#2563EB] rounded-md px-4 py-2 text-[13px] font-medium hover:bg-blue-50"
                  >
                    依頼タスクへ ↗
                  </a>
                )}
                <button
                  onClick={handleClose}
                  className="border border-gray-300 bg-white text-gray-700 rounded-md px-5 py-2 text-[13px] font-medium hover:bg-gray-50"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 「フォーム作成」押下時の確認ダイアログ。
        - モーダル本体(z-50)より上のレイヤ(z-60)に置くことで、ダイアログ backdrop クリックでは
          本体モーダルの overlayClose が発火しないようにする。
        - 未反映の再生成指示がある場合は本文の先頭に警告行を出す（ブロックはしない）。 */}
    {showCreateConfirm && (
      <div
        className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center"
        onClick={() => setShowCreateConfirm(false)}
      >
        <div
          className="bg-white rounded-xl w-full max-w-md mx-4 p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-[15px] font-bold text-[#374151] mb-4">フォームを作成します</h3>
          <div className="text-[13px] text-gray-700 space-y-2 mb-5">
            {hasStaleInstruction && (
              <p className="rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-[13px] text-orange-800">
                ⚠ 再生成の指示が入力されたままです。「この内容で再生成」を押していない可能性があります。
              </p>
            )}
            <p>質問の再生成はすべて完了していますか？</p>
            <p>この内容でフォームを作成してよろしいでしょうか？</p>
          </div>
          <div className="flex gap-2">
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={() => setShowCreateConfirm(false)}
              className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-[13px] font-medium hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={doCreate}
              className="flex-1 bg-[#16A34A] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#15803D]"
            >
              フォームを作成する
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
