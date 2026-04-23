"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import JobCategorySelector, { type JobAxis } from "@/components/tasks/JobCategorySelector";
import PointsModal from "@/components/tasks/PointsModal";

/* ---------- types ---------- */

type Candidate = { id: string; candidateNo: string; name: string };
type Employee = { id: string; employeeNo: string; name: string };
type Option = { id: string; label: string; value: string };
type Field = {
  id: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  placeholder: string | null;
  description: string | null;
  sortOrder: number;
  options: Option[];
};
type Category = {
  id: string;
  name: string;
  description: string | null;
  fields: Field[];
  group: { id: string; name: string; sortOrder: number } | null;
};
type CatGroup = { id: string; name: string; sortOrder: number };
type JobCatItem = { id: string; name: string; sortOrder: number };

const STEPS = [
  "求職者選択",
  "カテゴリ選択",
  "テンプレート入力",
  "担当者選択",
  "追加情報",
  "確認・作成",
];

/** カテゴリ名定数 */
const RIREKISHO_CATEGORY = "履歴書作成";

/** 数字実績ありと判定する大分類 */
const SALES_MAJORS = ["営業", "販売・フード・アミューズメント"];

/** 職務経歴書の「応募職種」フィールドラベル */
const SHOKUMU_CATEGORY = "職務経歴書作成";

/** 職務経歴書で非表示にするフィールド（職種に応じて出し分け） */
const SALES_ONLY_LABELS = ["営業実績"];
const NON_SALES_HIDDEN_LABELS = [
  "提示できる実績や数字がない（「数字実績なしで構いません」と記載する）",
  "営業実績",
  "その他実績",
];

const SUISENJOU_CATEGORY = "推薦状作成";

const THREE_POINT_CATEGORY_IDS = [
  "cmmolxn1v0026po4f0olekfps", // 履歴書作成
  "cmmolxv0g002qpo4fazblhj0f", // 職務経歴書作成
  "cmmolxxtl002xpo4f1mf6srei", // 推薦状作成
] as const;
const THREE_POINT_LABELS = ["履歴書作成", "職務経歴書作成", "推薦状作成"];
const HIDDEN_CATEGORY_ID = "cmoal05cp002r1dsxyokhti3i";

const MENDAN_FUSANKA_CATEGORY = "面談不参加共有";
const MENSETSU_TAISAKU_CATEGORY = "面接対策依頼";
const NAITEI_CATEGORY = "内定承諾報告";
const NYUSHA_CATEGORY = "入社報告";
const RA_ENTRY_CATEGORY = "RAエントリーのFM登録";
const FM_TOUROKU_CATEGORY = "求職者紹介のFM登録依頼";
const KYUJIN_KENSAKU_CATEGORY = "求人検索";

/** テンプレートにファイル添付があるため追加情報ステップの添付を非表示にするカテゴリ */
const HIDE_STEP5_ATTACHMENT_CATEGORIES = [
  MENSETSU_TAISAKU_CATEGORY,
  NAITEI_CATEGORY,
  NYUSHA_CATEGORY,
  FM_TOUROKU_CATEGORY,
];

/** 時刻オプション（9:00〜21:00、15分刻み） */
const TIME_OPTIONS: string[] = [];
for (let h = 9; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 21 && m > 0) break;
    TIME_OPTIONS.push(`${h}:${String(m).padStart(2, "0")}`);
  }
}

/** 時刻オプション（30分刻み） */
const TIME_OPTIONS_30: string[] = [];
for (let h = 9; h <= 21; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 21 && m > 0) break;
    TIME_OPTIONS_30.push(`${h}:${String(m).padStart(2, "0")}`);
  }
}

/** 地域・都道府県 */
const REGIONS = [
  { name: "北海道・東北", prefectures: ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { name: "関東", prefectures: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "山梨県"] },
  { name: "北信越", prefectures: ["新潟県", "富山県", "石川県", "福井県", "長野県"] },
  { name: "東海", prefectures: ["岐阜県", "静岡県", "愛知県", "三重県"] },
  { name: "関西", prefectures: ["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { name: "中国・四国", prefectures: ["鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県"] },
  { name: "九州・沖縄", prefectures: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
  { name: "海外", prefectures: ["海外"] },
];

const EMPLOYMENT_TYPES = ["正社員", "契約社員", "派遣社員", "アルバイト", "業務委託"];

/* ========================================================== */

export default function TaskNewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetCandidateId = searchParams.get("candidateId");
  const presetCategoryId = searchParams.get("categoryId");

  /* ----- master data ----- */
  const [categories, setCategories] = useState<Category[]>([]);
  const [catGroups, setCatGroups] = useState<CatGroup[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  /* ----- wizard state ----- */
  const [step, setStep] = useState(0);

  // step 0
  const [withCandidate, setWithCandidate] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");

  // step 1
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // 3点セットモード
  const [is3pointSet, setIs3pointSet] = useState(false);
  const [subStep3pt, setSubStep3pt] = useState(0); // 0=履歴書, 1=職務経歴書, 2=推薦状
  const [fieldValues3pt, setFieldValues3pt] = useState<Record<string, string>[]>([{}, {}, {}]);
  const [motivState3pt, setMotivState3pt] = useState({ majorId: "", majorName: "", middleId: "", middleName: "", minors: [] as string[] });
  const [jobState3pt, setJobState3pt] = useState({ majorId: "", majorName: "", middleId: "", middleName: "", minorId: "", minorName: "" });
  const [careerSummary3pt, setCareerSummary3pt] = useState("");

  // step 2
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // step 2 - 職種選択 (職務経歴書作成用)
  const [jobMajors, setJobMajors] = useState<JobCatItem[]>([]);
  const [jobMiddles, setJobMiddles] = useState<JobCatItem[]>([]);
  const [jobMinors, setJobMinors] = useState<JobCatItem[]>([]);
  const [selectedMajorId, setSelectedMajorId] = useState("");
  const [selectedMiddleId, setSelectedMiddleId] = useState("");
  const [selectedMinorId, setSelectedMinorId] = useState("");
  const [selectedMajorName, setSelectedMajorName] = useState("");
  const [selectedMiddleName, setSelectedMiddleName] = useState("");
  const [selectedMinorName, setSelectedMinorName] = useState("");

  // step 2 - 志望動機選択 (履歴書作成用)
  const [motivMajors, setMotivMajors] = useState<JobCatItem[]>([]);
  const [motivMiddles, setMotivMiddles] = useState<JobCatItem[]>([]);
  const [motivMinors, setMotivMinors] = useState<JobCatItem[]>([]);
  const [motivMajorId, setMotivMajorId] = useState("");
  const [motivMiddleId, setMotivMiddleId] = useState("");
  const [motivMajorName, setMotivMajorName] = useState("");
  const [motivMiddleName, setMotivMiddleName] = useState("");
  const [selectedMotivMinors, setSelectedMotivMinors] = useState<string[]>([]);

  // step 2 - 職務経歴書: 非営業用の経歴概要
  const [careerSummary, setCareerSummary] = useState("");

  // step 2 - カテゴリ固有: 面接対策依頼
  const [mensetsuInfoType, setMensetsuInfoType] = useState<"url" | "pdf">("url");
  const [mensetsuPdfFile, setMensetsuPdfFile] = useState<File | null>(null);

  // step 2 - カテゴリ固有: 内定承諾報告
  const [naiteiIndustryMajors, setNaiteiIndustryMajors] = useState<{ id: string; name: string; sortOrder: number }[]>([]);
  const [naiteiIndustryMiddles, setNaiteiIndustryMiddles] = useState<{ id: string; name: string; sortOrder: number }[]>([]);
  const [naiteiIndustryMinors, setNaiteiIndustryMinors] = useState<{ id: string; name: string; sortOrder: number }[]>([]);
  const [naiteiIndMajorId, setNaiteiIndMajorId] = useState("");
  const [naiteiIndMajorName, setNaiteiIndMajorName] = useState("");
  const [naiteiIndMiddleId, setNaiteiIndMiddleId] = useState("");
  const [naiteiIndMiddleName, setNaiteiIndMiddleName] = useState("");
  const [naiteiIndMinorName, setNaiteiIndMinorName] = useState("");
  const [naiteiRegion, setNaiteiRegion] = useState("");
  const [naiteiPrefecture, setNaiteiPrefecture] = useState("");
  const [naiteiEmploymentType, setNaiteiEmploymentType] = useState("");
  const [naiteiCandidateSearch, setNaiteiCandidateSearch] = useState("");

  // step 2 - カテゴリ固有: テンプレート添付ファイル
  const [templateAttachFiles, setTemplateAttachFiles] = useState<File[]>([]);
  const [templateAttachError, setTemplateAttachError] = useState<string | null>(null);
  const [templateDragOver, setTemplateDragOver] = useState(false);
  const templateFileInputRef = useRef<HTMLInputElement>(null);

  // step 2 - カテゴリ固有: 求人検索
  const [kyujinJobAxes, setKyujinJobAxes] = useState<JobAxis[]>([{ axis: 1, major: "", middle: null, minor: null }]);
  const [aiOrganizing, setAiOrganizing] = useState(false);
  const [pointsModalOpen, setPointsModalOpen] = useState(false);
  const [pointsModalFieldId, setPointsModalFieldId] = useState("");

  // step 3
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");

  // step 4
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [completionType, setCompletionType] = useState<"any" | "all">("any");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showCandidateFilePicker, setShowCandidateFilePicker] = useState(false);
  const [candidateFilesForPicker, setCandidateFilesForPicker] = useState<{ id: string; fileName: string; fileSize: number; mimeType: string; driveFileId: string; category: string }[]>([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerAttaching, setPickerAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // step 1 - accordion
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // step 5
  const [submitting, setSubmitting] = useState(false);

  /* ----- derived ----- */
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );
  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === candidateId) ?? null,
    [candidates, candidateId]
  );

  const threePointCategories = useMemo(
    () => THREE_POINT_CATEGORY_IDS.map((id) => categories.find((c) => c.id === id) ?? null),
    [categories]
  );
  const active3ptCategory = is3pointSet ? threePointCategories[subStep3pt] : null;
  const effectiveCategory = is3pointSet ? active3ptCategory : selectedCategory;

  const isRirekisho = effectiveCategory?.name === RIREKISHO_CATEGORY;
  const isShokumu = effectiveCategory?.name === SHOKUMU_CATEGORY;
  const isSalesJob = SALES_MAJORS.includes(is3pointSet ? jobState3pt.majorName : selectedMajorName);
  const isMendanFusanka = selectedCategory?.name === MENDAN_FUSANKA_CATEGORY;
  const isMensetsuTaisaku = selectedCategory?.name === MENSETSU_TAISAKU_CATEGORY;
  const isNaitei = selectedCategory?.name === NAITEI_CATEGORY;
  const isNyusha = selectedCategory?.name === NYUSHA_CATEGORY;
  const isRAEntry = selectedCategory?.name === RA_ENTRY_CATEGORY;
  const isFmTouroku = selectedCategory?.name === FM_TOUROKU_CATEGORY;
  const isKyujinKensaku = selectedCategory?.name === KYUJIN_KENSAKU_CATEGORY;
  const hideStep5Attachment = HIDE_STEP5_ATTACHMENT_CATEGORIES.includes(selectedCategory?.name ?? "");

  /** 職務経歴書: 「実績なし」チェックがONか */
  const noNumbersChecked = useMemo(() => {
    if (!isShokumu) return false;
    const cat = is3pointSet ? active3ptCategory : selectedCategory;
    if (!cat) return false;
    const checkField = cat.fields.find((f) =>
      f.label.startsWith("提示できる実績や数字がない")
    );
    const vals = is3pointSet ? fieldValues3pt[subStep3pt] : fieldValues;
    return checkField ? vals[checkField.id] === "true" : false;
  }, [isShokumu, selectedCategory, active3ptCategory, is3pointSet, fieldValues, fieldValues3pt, subStep3pt]);

  /* ----- fetch master data ----- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, empRes, canRes, jobRes, motivRes] = await Promise.all([
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
        fetch("/api/candidates"),
        fetch("/api/job-categories"),
        fetch("/api/motivation-categories"),
      ]);
      const catJson = await catRes.json();
      const empJson = await empRes.json();
      const canJson = await canRes.json();
      const jobJson = await jobRes.json();
      const motivJson = await motivRes.json();
      setCategories(catJson.categories ?? []);
      setCatGroups(catJson.groups ?? []);
      setEmployees(Array.isArray(empJson) ? empJson : []);
      setCandidates(Array.isArray(canJson) ? canJson : []);
      setJobMajors(Array.isArray(jobJson) ? jobJson : []);
      setMotivMajors(Array.isArray(motivJson) ? motivJson : []);
    } catch {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // クエリパラメータで求職者をプリセット
  const presetApplied = useRef(false);
  useEffect(() => {
    if (presetApplied.current || !presetCandidateId || candidates.length === 0) return;
    const found = candidates.find((c) => c.id === presetCandidateId || c.candidateNo === presetCandidateId);
    if (found) {
      setWithCandidate(true);
      setCandidateId(found.id);
      setCandidateSearch(found.name);
      presetApplied.current = true;
    }
  }, [presetCandidateId, candidates]);

  // クエリパラメータでカテゴリをプリセット
  const categoryPresetApplied = useRef(false);
  useEffect(() => {
    if (categoryPresetApplied.current || !presetCategoryId || categories.length === 0) return;
    // If candidateId is also preset, wait for candidate preset to apply first
    if (presetCandidateId && !presetApplied.current && candidates.length > 0) return;
    const found = categories.find((c) => c.id === presetCategoryId);
    if (found) {
      setCategoryId(found.id);
      categoryPresetApplied.current = true;
      const hasFields = found.fields && found.fields.length > 0;
      setStep(hasFields ? 2 : 3);
    }
  }, [presetCategoryId, categories, presetCandidateId, candidates]);

  // エントリーボードからの一括プリセット (prefill=entry)
  // categoryName, assignees (csv employeeNo), title, entryDate/entryCount/entryComment, step を一括適用
  const entryPrefillApplied = useRef(false);
  useEffect(() => {
    if (entryPrefillApplied.current) return;
    if (searchParams.get("prefill") !== "entry") return;
    if (loading) return;
    if (categories.length === 0 || employees.length === 0 || candidates.length === 0) return;

    // カテゴリ名 → categoryId（exact → fallback → contains）
    const catName = searchParams.get("categoryName");
    let selectedCat: Category | undefined;
    if (catName) {
      selectedCat =
        categories.find((c) => c.name === catName) ||
        categories.find((c) => c.name === "エントリー対応") ||
        categories.find((c) => c.name.includes("エントリー対応"));
      if (selectedCat) setCategoryId(selectedCat.id);
    }

    // 担当者社員番号csv → assigneeIds (Employee.id)
    const assigneesCsv = searchParams.get("assignees");
    if (assigneesCsv) {
      const nums = assigneesCsv.split(",").map((s) => s.trim()).filter(Boolean);
      const ids = nums
        .map((n) => employees.find((e) => e.employeeNo === n)?.id)
        .filter((id): id is string => !!id);
      if (ids.length > 0) setAssigneeIds(ids);
    }

    // タイトル
    const pt = searchParams.get("title");
    if (pt) setTitle(pt);

    // テンプレートフィールド（エントリー日 / エントリー件数 / コメント）をラベルで紐付け
    if (selectedCat) {
      const entryDateVal = searchParams.get("entryDate");
      const entryCountVal = searchParams.get("entryCount");
      const entryCommentVal = searchParams.get("entryComment");
      const updates: Record<string, string> = {};
      for (const field of selectedCat.fields) {
        if (field.label === "エントリー日" && entryDateVal) updates[field.id] = entryDateVal;
        else if (field.label === "エントリー件数" && entryCountVal) updates[field.id] = entryCountVal;
        else if (field.label === "コメント" && entryCommentVal) updates[field.id] = entryCommentVal;
      }
      if (Object.keys(updates).length > 0) {
        setFieldValues((prev) => ({ ...prev, ...updates }));
      }
    }

    // ステップ指定（1-indexed → 0-indexed）
    const stepStr = searchParams.get("step");
    if (stepStr) {
      const s = parseInt(stepStr, 10);
      if (!isNaN(s) && s >= 1 && s <= STEPS.length) {
        setStep(s - 1);
      }
    }

    entryPrefillApplied.current = true;
  }, [loading, categories, employees, candidates, searchParams]);

  /* ----- job category cascading ----- */
  useEffect(() => {
    if (!selectedMajorId) {
      setJobMiddles([]);
      setSelectedMiddleId("");
      setSelectedMiddleName("");
      setJobMinors([]);
      setSelectedMinorId("");
      setSelectedMinorName("");
      return;
    }
    fetch(`/api/job-categories/${selectedMajorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        setJobMiddles(Array.isArray(data) ? data : []);
        setSelectedMiddleId("");
        setSelectedMiddleName("");
        setJobMinors([]);
        setSelectedMinorId("");
        setSelectedMinorName("");
      });
  }, [selectedMajorId]);

  useEffect(() => {
    if (!selectedMiddleId) {
      setJobMinors([]);
      setSelectedMinorId("");
      setSelectedMinorName("");
      return;
    }
    fetch(`/api/job-categories/middles/${selectedMiddleId}/minors`)
      .then((r) => r.json())
      .then((data) => {
        setJobMinors(Array.isArray(data) ? data : []);
        setSelectedMinorId("");
        setSelectedMinorName("");
      });
  }, [selectedMiddleId]);

  /* ----- motivation category cascading ----- */
  useEffect(() => {
    if (!motivMajorId) {
      setMotivMiddles([]);
      setMotivMiddleId("");
      setMotivMiddleName("");
      setMotivMinors([]);
      setSelectedMotivMinors([]);
      return;
    }
    fetch(`/api/motivation-categories/${motivMajorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        setMotivMiddles(Array.isArray(data) ? data : []);
        setMotivMiddleId("");
        setMotivMiddleName("");
        setMotivMinors([]);
        setSelectedMotivMinors([]);
      });
  }, [motivMajorId]);

  useEffect(() => {
    if (!motivMiddleId) {
      setMotivMinors([]);
      setSelectedMotivMinors([]);
      return;
    }
    fetch(`/api/motivation-categories/middles/${motivMiddleId}/minors`)
      .then((r) => r.json())
      .then((data) => {
        setMotivMinors(Array.isArray(data) ? data : []);
        setSelectedMotivMinors([]);
      });
  }, [motivMiddleId]);

  /* ----- industry category cascading (内定承諾報告) ----- */
  useEffect(() => {
    if (!isNaitei) return;
    fetch("/api/industry-categories")
      .then((r) => r.json())
      .then((data) => setNaiteiIndustryMajors(Array.isArray(data) ? data : []));
  }, [isNaitei]);

  useEffect(() => {
    if (!naiteiIndMajorId) {
      setNaiteiIndustryMiddles([]);
      setNaiteiIndMiddleId("");
      setNaiteiIndMiddleName("");
      setNaiteiIndustryMinors([]);
      setNaiteiIndMinorName("");
      return;
    }
    fetch(`/api/industry-categories/${naiteiIndMajorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        setNaiteiIndustryMiddles(Array.isArray(data) ? data : []);
        setNaiteiIndMiddleId("");
        setNaiteiIndMiddleName("");
        setNaiteiIndustryMinors([]);
        setNaiteiIndMinorName("");
      });
  }, [naiteiIndMajorId]);

  useEffect(() => {
    if (!naiteiIndMiddleId) {
      setNaiteiIndustryMinors([]);
      setNaiteiIndMinorName("");
      return;
    }
    fetch(`/api/industry-categories/middles/${naiteiIndMiddleId}/minors`)
      .then((r) => r.json())
      .then((data) => {
        setNaiteiIndustryMinors(Array.isArray(data) ? data : []);
        setNaiteiIndMinorName("");
      });
  }, [naiteiIndMiddleId]);

  /* ----- auto title ----- */
  useEffect(() => {
    if (step === 4 && !is3pointSet) {
      const catName = selectedCategory?.name ?? "";
      const canName = selectedCandidate?.name ?? "";
      setTitle(canName ? `${catName} - ${canName}` : catName);
    }
  }, [step, is3pointSet, selectedCategory, selectedCandidate]);

  /* ----- step validation ----- */
  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return !withCandidate || !!candidateId;
      case 1:
        return !!categoryId || is3pointSet;
      case 2: {
        const cat = is3pointSet ? active3ptCategory : selectedCategory;
        if (!cat) return false;
        // 履歴書作成: 志望動機の大中小必須
        if (isRirekisho) {
          if (!motivMajorName || !motivMiddleName || selectedMotivMinors.length === 0) return false;
        }
        // 職務経歴書: 職種大分類は必須
        if (isShokumu) {
          if (!selectedMajorName) return false;
        }
        // 求人検索: 第1軸の大項目は必須
        if (isKyujinKensaku && (!kyujinJobAxes[0]?.major)) return false;
        // テンプレート必須フィールドのバリデーション
        const visibleFields = getVisibleFields();
        const vals = is3pointSet ? fieldValues3pt[subStep3pt] : fieldValues;
        return visibleFields
          .filter((f) => f.isRequired)
          .every((f) => {
            if (f.label === "応募職種") return true;
            if (isRirekisho && (f.label === "志望動機（大分類）" || f.label === "志望動機（中分類）" || f.label === "志望動機（小分類）")) return true;
            if (isKyujinKensaku && f.label === "職種") return true;
            const v = vals[f.id];
            return v !== undefined && v !== "";
          });
      }
      case 3:
        return assigneeIds.length > 0;
      case 4:
        return is3pointSet || !!title.trim();
      default:
        return true;
    }
  };

  /** 表示するフィールドを返す */
  const getVisibleFields = useCallback((): Field[] => {
    const cat = is3pointSet ? active3ptCategory : selectedCategory;
    if (!cat) return [];

    // 履歴書作成: 志望動機フィールドはカスケードUIで代替するので非表示
    if (isRirekisho) {
      return cat.fields.filter((f) =>
        f.label !== "志望動機（大分類）" &&
        f.label !== "志望動機（中分類）" &&
        f.label !== "志望動機（小分類）"
      );
    }

    // 内定承諾報告: カスタムUIで代替するフィールドを非表示
    if (isNaitei) {
      const hiddenLabels = ["対象者フルネーム", "内定した職種", "内定した業種", "内定した勤務地（都道府県）", "雇用形態"];
      return cat.fields.filter((f) => !hiddenLabels.includes(f.label));
    }

    // 面接対策依頼: 選考求人情報をカスタムUIで代替（インラインで表示）
    if (isMensetsuTaisaku) {
      return cat.fields.filter((f) => f.label !== "選考求人情報" && f.label !== "選考求人URL");
    }

    // RAエントリー: エリアをカスタムUIで代替
    if (isRAEntry) {
      return cat.fields.filter((f) => f.label !== "エリア");
    }

    // FM登録依頼: カスタムUIで代替するフィールドを非表示
    if (isFmTouroku) {
      const hiddenLabels = ["フルネーム", "ふりがな", "郵便番号＆住所"];
      return cat.fields.filter((f) => !hiddenLabels.includes(f.label));
    }

    if (!isShokumu) return cat.fields;

    return cat.fields.filter((f) => {
      if (f.label === "応募職種") return false;
      if (isSalesJob) {
        if (noNumbersChecked && SALES_ONLY_LABELS.includes(f.label)) return false;
        return true;
      }
      if (NON_SALES_HIDDEN_LABELS.includes(f.label)) return false;
      return true;
    });
  }, [selectedCategory, active3ptCategory, is3pointSet, isRirekisho, isShokumu, isSalesJob, noNumbersChecked, isNaitei, isMensetsuTaisaku, isRAEntry, isFmTouroku]);

  /* ----- submit (3point set) ----- */
  const handle3ptSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 最後のサブステップ(推薦状)のstateを保存
      save3ptSubStepState(2);

      const buildFieldValues = (catIdx: number): { fieldId: string; value: string }[] => {
        const cat = threePointCategories[catIdx];
        if (!cat) return [];
        const vals = fieldValues3pt[catIdx];
        const normalFvs = Object.entries(vals)
          .filter(([k, v]) => v !== "" && !k.startsWith("__"))
          .map(([fieldId, value]) => ({ fieldId, value }));
        const extra: { fieldId: string; value: string }[] = [];

        if (catIdx === 0) {
          // 履歴書: 志望動機
          const majorField = cat.fields.find((f) => f.label === "志望動機（大分類）");
          const middleField = cat.fields.find((f) => f.label === "志望動機（中分類）");
          const minorField = cat.fields.find((f) => f.label === "志望動機（小分類）");
          if (majorField && motivState3pt.majorName) extra.push({ fieldId: majorField.id, value: motivState3pt.majorName });
          if (middleField && motivState3pt.middleName) extra.push({ fieldId: middleField.id, value: motivState3pt.middleName });
          if (minorField && motivState3pt.minors.length > 0) extra.push({ fieldId: minorField.id, value: JSON.stringify(motivState3pt.minors) });
        } else if (catIdx === 1) {
          // 職務経歴書: 応募職種
          const shokuField = cat.fields.find((f) => f.label === "応募職種");
          if (shokuField) {
            const name = jobState3pt.minorName || jobState3pt.middleName || jobState3pt.majorName;
            if (name) extra.push({ fieldId: shokuField.id, value: name });
          }
          // 非営業: 経歴概要 → その他実績
          if (!SALES_MAJORS.includes(jobState3pt.majorName) && careerSummary3pt.trim()) {
            const otherField = cat.fields.find((f) => f.label === "その他実績");
            if (otherField) extra.push({ fieldId: otherField.id, value: careerSummary3pt.trim() });
          }
        }
        return [...normalFvs, ...extra];
      };

      const res = await fetch("/api/tasks/bulk-create-3point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidateId,
          assigneeId: assigneeIds[0],
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          priority,
          fieldValues: {
            resume: buildFieldValues(0),
            career: buildFieldValues(1),
            recommendation: buildFieldValues(2),
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "一括起票に失敗しました");
        return;
      }

      const data = await res.json();

      // 添付ファイルのアップロード
      const allFiles = [...attachmentFiles, ...templateAttachFiles];
      if (allFiles.length > 0 && data.createdTaskIds?.length > 0) {
        const failedFiles: string[] = [];
        for (const file of allFiles) {
          for (const taskId of data.createdTaskIds) {
            try {
              const formData = new FormData();
              formData.append("file", file);
              const uploadRes = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: formData });
              if (!uploadRes.ok) failedFiles.push(file.name);
              break;
            } catch { failedFiles.push(file.name); break; }
          }
        }
        if (failedFiles.length > 0) {
          alert(`3タスクを作成しました。\n一部ファイルのアップロードに失敗しました: ${failedFiles.join("、")}`);
        } else {
          alert(data.message || "応募書類3点セットのタスクを作成しました");
        }
      } else {
        alert(data.message || "応募書類3点セットのタスクを作成しました");
      }

      router.push("/tasks");
    } catch {
      alert("一括起票に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- submit ----- */
  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 追加のfieldValues
      const extraFieldValues: { fieldId: string; value: string }[] = [];

      // 履歴書作成: 志望動機フィールドをセット
      if (isRirekisho && selectedCategory) {
        const majorField = selectedCategory.fields.find((f) => f.label === "志望動機（大分類）");
        const middleField = selectedCategory.fields.find((f) => f.label === "志望動機（中分類）");
        const minorField = selectedCategory.fields.find((f) => f.label === "志望動機（小分類）");
        if (majorField && motivMajorName) {
          extraFieldValues.push({ fieldId: majorField.id, value: motivMajorName });
        }
        if (middleField && motivMiddleName) {
          extraFieldValues.push({ fieldId: middleField.id, value: motivMiddleName });
        }
        if (minorField && selectedMotivMinors.length > 0) {
          extraFieldValues.push({ fieldId: minorField.id, value: JSON.stringify(selectedMotivMinors) });
        }
      }

      // 応募職種フィールドに職種名をセット
      if (isShokumu && selectedCategory) {
        const shokuField = selectedCategory.fields.find(
          (f) => f.label === "応募職種"
        );
        if (shokuField && selectedMinorName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMinorName });
        } else if (shokuField && selectedMiddleName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMiddleName });
        } else if (shokuField && selectedMajorName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMajorName });
        }
      }

      // 内定承諾報告: カスタムフィールドをセット
      if (isNaitei && selectedCategory) {
        const nameField = selectedCategory.fields.find((f) => f.label === "対象者フルネーム");
        if (nameField && naiteiCandidateSearch) extraFieldValues.push({ fieldId: nameField.id, value: naiteiCandidateSearch });
        const jobField = selectedCategory.fields.find((f) => f.label === "内定した職種");
        if (jobField && selectedMajorName) extraFieldValues.push({ fieldId: jobField.id, value: [selectedMajorName, selectedMiddleName, selectedMinorName].filter(Boolean).join(" > ") });
        const indField = selectedCategory.fields.find((f) => f.label === "内定した業種");
        if (indField && naiteiIndMajorName) extraFieldValues.push({ fieldId: indField.id, value: [naiteiIndMajorName, naiteiIndMiddleName, naiteiIndMinorName].filter(Boolean).join(" > ") });
        const locField = selectedCategory.fields.find((f) => f.label === "内定した勤務地（都道府県）");
        if (locField && naiteiPrefecture) extraFieldValues.push({ fieldId: locField.id, value: `${naiteiRegion} ${naiteiPrefecture}` });
        const empField = selectedCategory.fields.find((f) => f.label === "雇用形態");
        if (empField && naiteiEmploymentType) extraFieldValues.push({ fieldId: empField.id, value: naiteiEmploymentType });
      }

      // FM登録依頼: カスタムフィールドをセット
      if (isFmTouroku && selectedCategory) {
        const nameField = selectedCategory.fields.find((f) => f.label === "フルネーム");
        if (nameField) extraFieldValues.push({ fieldId: nameField.id, value: `${fieldValues["__fm_sei"] ?? ""} ${fieldValues["__fm_mei"] ?? ""}`.trim() });
        const kanaField = selectedCategory.fields.find((f) => f.label === "ふりがな");
        if (kanaField) extraFieldValues.push({ fieldId: kanaField.id, value: `${fieldValues["__fm_sei_kana"] ?? ""} ${fieldValues["__fm_mei_kana"] ?? ""}`.trim() });
        const addrField = selectedCategory.fields.find((f) => f.label === "郵便番号＆住所");
        if (addrField) extraFieldValues.push({ fieldId: addrField.id, value: `${fieldValues["__fm_zip"] ?? ""} ${fieldValues["__fm_address"] ?? ""}`.trim() });
      }

      // 通常のfieldValues（内部キー __で始まるものを除外）
      const normalFieldValues = Object.entries(fieldValues)
        .filter(([k, v]) => v !== "" && !k.startsWith("__"))
        .map(([fieldId, value]) => ({ fieldId, value }));

      // 非営業の経歴概要 → 「その他実績」フィールドに保存
      if (isShokumu && !isSalesJob && careerSummary.trim() && selectedCategory) {
        const otherField = selectedCategory.fields.find(
          (f) => f.label === "その他実績"
        );
        if (otherField) {
          extraFieldValues.push({ fieldId: otherField.id, value: careerSummary.trim() });
        }
      }

      const allFieldValues = [...normalFieldValues, ...extraFieldValues];

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          categoryId,
          candidateId: withCandidate ? candidateId : null,
          status: "NOT_STARTED",
          priority,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          assigneeIds,
          completionType: assigneeIds.length > 1 ? completionType : "any",
          fieldValues: allFieldValues,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "タスク作成に失敗しました");
        return;
      }

      const { id } = await res.json();

      // 添付ファイルのアップロード（ステップ5 + テンプレート + 面接対策PDF）
      const allFiles = [
        ...attachmentFiles,
        ...templateAttachFiles,
        ...(mensetsuPdfFile ? [mensetsuPdfFile] : []),
      ];
      if (allFiles.length > 0) {
        const failedFiles: string[] = [];
        for (const file of allFiles) {
          try {
            const formData = new FormData();
            formData.append("file", file);
            const uploadRes = await fetch(`/api/tasks/${id}/attachments`, {
              method: "POST",
              body: formData,
            });
            if (!uploadRes.ok) {
              failedFiles.push(file.name);
            }
          } catch {
            failedFiles.push(file.name);
          }
        }
        if (failedFiles.length > 0) {
          alert(
            `タスクを作成しました。\n\n一部のファイルのアップロードに失敗しました。タスク詳細画面から再度アップロードしてください。\n\n失敗: ${failedFiles.join("、")}`
          );
        } else {
          alert("タスクを作成しました");
        }
      } else {
        alert("タスクを作成しました");
      }

      router.push(`/tasks/${id}`);
    } catch {
      alert("タスク作成に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- helpers ----- */
  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.candidateNo.toLowerCase().includes(q)
    );
  }, [candidates, candidateSearch]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const activeFieldValues = is3pointSet ? fieldValues3pt[subStep3pt] : fieldValues;

  const setFieldValue = (fieldId: string, value: string) => {
    if (is3pointSet) {
      setFieldValues3pt((prev) => {
        const next = [...prev];
        next[subStep3pt] = { ...next[subStep3pt], [fieldId]: value };
        return next;
      });
    } else {
      setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    }
  };

  const toggleMultiSelect = (fieldId: string, optValue: string) => {
    const vals = is3pointSet ? fieldValues3pt[subStep3pt] : fieldValues;
    const current: string[] = (() => {
      try {
        return JSON.parse(vals[fieldId] || "[]");
      } catch {
        return [];
      }
    })();
    const next = current.includes(optValue)
      ? current.filter((v) => v !== optValue)
      : [...current, optValue];
    setFieldValue(fieldId, JSON.stringify(next));
  };

  const save3ptSubStepState = (sub: number) => {
    if (sub === 0) {
      setMotivState3pt({
        majorId: motivMajorId, majorName: motivMajorName,
        middleId: motivMiddleId, middleName: motivMiddleName,
        minors: [...selectedMotivMinors],
      });
    } else if (sub === 1) {
      setJobState3pt({
        majorId: selectedMajorId, majorName: selectedMajorName,
        middleId: selectedMiddleId, middleName: selectedMiddleName,
        minorId: selectedMinorId, minorName: selectedMinorName,
      });
      setCareerSummary3pt(careerSummary);
    }
  };

  const restore3ptSubStepState = (sub: number) => {
    if (sub === 0) {
      setMotivMajorId(motivState3pt.majorId);
      setMotivMajorName(motivState3pt.majorName);
      setMotivMiddleId(motivState3pt.middleId);
      setMotivMiddleName(motivState3pt.middleName);
      setSelectedMotivMinors([...motivState3pt.minors]);
      setSelectedMajorId(""); setSelectedMajorName("");
      setSelectedMiddleId(""); setSelectedMiddleName("");
      setSelectedMinorId(""); setSelectedMinorName("");
      setCareerSummary("");
    } else if (sub === 1) {
      setSelectedMajorId(jobState3pt.majorId);
      setSelectedMajorName(jobState3pt.majorName);
      setSelectedMiddleId(jobState3pt.middleId);
      setSelectedMiddleName(jobState3pt.middleName);
      setSelectedMinorId(jobState3pt.minorId);
      setSelectedMinorName(jobState3pt.minorName);
      setCareerSummary(careerSummary3pt);
      setMotivMajorId(""); setMotivMajorName("");
      setMotivMiddleId(""); setMotivMiddleName("");
      setSelectedMotivMinors([]);
    } else if (sub === 2) {
      setSelectedMajorId(""); setSelectedMajorName("");
      setSelectedMiddleId(""); setSelectedMiddleName("");
      setSelectedMinorId(""); setSelectedMinorName("");
      setMotivMajorId(""); setMotivMajorName("");
      setMotivMiddleId(""); setMotivMiddleName("");
      setSelectedMotivMinors([]);
      setCareerSummary("");
    }
  };

  const priorityLabel = (p: string) =>
    p === "HIGH" ? "高" : p === "MEDIUM" ? "中" : "低";

  const ALLOWED_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    setAttachmentError(null);
    const newFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        setAttachmentError(`「${file.name}」はファイルサイズが10MBを超えています`);
        continue;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        setAttachmentError(`「${file.name}」は許可されていないファイル形式です`);
        continue;
      }
      newFiles.push(file);
    }
    setAttachmentFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachmentFile = (index: number) => {
    setAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openCandidateFilePicker = async () => {
    if (!candidateId) return;
    setShowCandidateFilePicker(true);
    setPickerLoading(true);
    setPickerSelectedIds(new Set());
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files`);
      if (res.ok) {
        const data = await res.json();
        setCandidateFilesForPicker(data.files || []);
      }
    } catch { /* */ }
    finally { setPickerLoading(false); }
  };

  const handlePickerAttach = async () => {
    if (pickerSelectedIds.size === 0 || !candidateId) return;
    setPickerAttaching(true);
    try {
      const selected = candidateFilesForPicker.filter((f) => pickerSelectedIds.has(f.id));
      let attached = 0;
      for (const f of selected) {
        try {
          const res = await fetch(`/api/candidates/${candidateId}/files/${f.id}?download=true`);
          if (!res.ok) continue;
          const blob = await res.blob();
          const file = new File([blob], f.fileName, { type: blob.type || f.mimeType });
          setAttachmentFiles((prev) => [...prev, file]);
          attached++;
        } catch (e) {
          console.error(`Failed to download ${f.fileName}:`, e);
        }
      }
      if (attached > 0) setShowCandidateFilePicker(false);
    } catch { /* */ }
    finally { setPickerAttaching(false); }
  };

  const CATEGORY_LABELS: Record<string, string> = {
    ORIGINAL: "原本", BS_DOCUMENT: "BS作成書類", APPLICATION: "応募企業",
    INTERVIEW_PREP: "面接対策", MEETING: "面談", BOOKMARK: "ブックマーク",
  };

  const selectCls =
    "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  /* ----- loading ----- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">
        読み込み中...
      </div>
    );
  }

  /* ========================================================== */
  return (
    <div className="mx-auto max-w-3xl">
      {/* header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/tasks"
          className="text-[14px] text-[#6B7280] hover:text-[#374151]"
        >
          &larr; タスク管理
        </Link>
        <span className="text-[14px] text-[#D1D5DB]">/</span>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">タスクを作成</h1>
      </div>

      {/* step indicator */}
      <div className="mb-8 flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={[
                "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold",
                i < step
                  ? "bg-[#2563EB] text-white"
                  : i === step
                    ? "bg-[#2563EB] text-white ring-4 ring-[#BFDBFE]"
                    : "bg-[#E5E7EB] text-[#9CA3AF]",
              ].join(" ")}
            >
              {i < step ? "\u2713" : i + 1}
            </div>
            <span
              className={[
                "text-[11px] text-center leading-tight",
                i <= step ? "text-[#374151] font-medium" : "text-[#9CA3AF]",
              ].join(" ")}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Selection summary bar */}
      {step > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2 text-[12px] text-gray-600">
          {step > 0 && selectedCandidate && (
            <span>👤 {selectedCandidate.name}（{selectedCandidate.candidateNo}）</span>
          )}
          {step > 0 && !withCandidate && candidateId === null && (
            <span className="text-gray-400">👤 求職者なし</span>
          )}
          {step > 1 && (is3pointSet ? (
            <span>📁 応募書類3点セット</span>
          ) : selectedCategory ? (
            <span>📁 {selectedCategory.name}{selectedCategory.group ? `（${selectedCategory.group.name}）` : ""}</span>
          ) : null)}
          {step > 3 && assigneeIds.length > 0 && (
            <span>👥 {employees.filter((e) => assigneeIds.includes(e.id)).map((e) => e.name).join("、")}（{assigneeIds.length}名）</span>
          )}
        </div>
      )}

      {/* card */}
      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* ----- Step 0: 求職者選択 ----- */}
        {step === 0 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              求職者選択（任意）
            </h2>
            <label className="mb-4 flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={withCandidate}
                onChange={(e) => {
                  setWithCandidate(e.target.checked);
                  if (!e.target.checked) setCandidateId(null);
                }}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span className="text-[14px] text-[#374151]">
                求職者を選択する
              </span>
            </label>
            {withCandidate && (
              <div>
                <input
                  type="text"
                  placeholder="名前・求職者番号で検索"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="mb-3 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
                <div className="max-h-[300px] overflow-y-auto rounded-[6px] border border-[#E5E7EB]">
                  {filteredCandidates.length === 0 && (
                    <p className="p-4 text-center text-[13px] text-[#9CA3AF]">
                      該当する求職者がありません
                    </p>
                  )}
                  {filteredCandidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCandidateId(c.id)}
                      className={[
                        "flex w-full items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left text-[14px] transition-colors last:border-b-0",
                        candidateId === c.id
                          ? "bg-[#EEF2FF] text-[#2563EB]"
                          : "hover:bg-[#F9FAFB] text-[#374151]",
                      ].join(" ")}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[12px] text-[#9CA3AF]">
                        {c.candidateNo}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ----- Step 1: カテゴリ選択 ----- */}
        {step === 1 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              タスクカテゴリ選択
            </h2>
            {(() => {
              const selectCategory = (id: string) => {
                setCategoryId(id);
                setIs3pointSet(false);
                setFieldValues({});
                setSelectedMajorId("");
                setSelectedMajorName("");
                setSelectedMiddleId("");
                setSelectedMiddleName("");
                setSelectedMinorId("");
                setSelectedMinorName("");
                setCareerSummary("");
                setMotivMajorId("");
                setMotivMajorName("");
                setMotivMiddleId("");
                setMotivMiddleName("");
                setSelectedMotivMinors([]);
              };

              const select3pointSet = () => {
                setIs3pointSet(true);
                setCategoryId(null);
                setSubStep3pt(0);
                setFieldValues3pt([{}, {}, {}]);
                setMotivState3pt({ majorId: "", majorName: "", middleId: "", middleName: "", minors: [] });
                setJobState3pt({ majorId: "", majorName: "", middleId: "", middleName: "", minorId: "", minorName: "" });
                setCareerSummary3pt("");
              };

              const renderCatButton = (cat: Category) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => selectCategory(cat.id)}
                  className={[
                    "rounded-[8px] border-2 p-4 text-left transition-colors",
                    !is3pointSet && categoryId === cat.id
                      ? "border-[#2563EB] bg-[#EEF2FF]"
                      : "border-[#E5E7EB] hover:border-[#93C5FD] hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[14px] font-bold text-[#374151]">{cat.name}</p>
                  {cat.description && (
                    <p className="mt-1 text-[12px] text-[#6B7280]">{cat.description}</p>
                  )}
                </button>
              );

              const render3ptButton = () => (
                <button
                  key="__3point"
                  type="button"
                  onClick={select3pointSet}
                  className={[
                    "rounded-[8px] border-2 p-4 text-left transition-colors",
                    is3pointSet
                      ? "border-[#2563EB] bg-[#EEF2FF]"
                      : "border-[#E5E7EB] hover:border-[#93C5FD] hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[14px] font-bold text-[#374151]">応募書類3点セット</p>
                  <p className="mt-1 text-[12px] text-[#6B7280]">履歴書・職務経歴書・推薦状を一度に作成</p>
                </button>
              );

              const visibleCategories = categories.filter((c) => c.id !== HIDDEN_CATEGORY_ID);

              if (catGroups.length === 0) {
                return (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visibleCategories.map(renderCatButton)}
                    {render3ptButton()}
                  </div>
                );
              }

              const sections: { label: string; cats: Category[] }[] = [];
              for (const g of catGroups) {
                const cats = visibleCategories.filter((c) => c.group?.id === g.id);
                if (cats.length > 0) sections.push({ label: g.name, cats });
              }
              const ungrouped = visibleCategories.filter((c) => !c.group);
              if (ungrouped.length > 0) sections.push({ label: "未分類", cats: ungrouped });

              const toggleGroup = (label: string) => {
                setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return next;
                });
              };

              return (
                <div className="space-y-2">
                  {sections.map((sec) => (
                    <div key={sec.label} className="rounded-[8px] border border-[#E5E7EB] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(sec.label)}
                        className="w-full flex items-center justify-between px-4 py-3 bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors text-left"
                      >
                        <span className="text-[14px] font-bold text-[#374151]">
                          {sec.label}
                          <span className="ml-1 text-[12px] font-normal text-[#9CA3AF]">（{sec.cats.length}）</span>
                        </span>
                        <span className="text-[12px] text-[#9CA3AF]">
                          {openGroups.has(sec.label) ? "▼" : "▶"}
                        </span>
                      </button>
                      {openGroups.has(sec.label) && (
                        <div className="p-3 grid gap-3 sm:grid-cols-2">
                          {sec.cats.map(renderCatButton)}
                          {sec.cats.some((c) => (THREE_POINT_CATEGORY_IDS as readonly string[]).includes(c.id)) && render3ptButton()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ----- Step 2: テンプレート入力 ----- */}
        {step === 2 && (is3pointSet ? active3ptCategory : selectedCategory) && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              {is3pointSet ? (
                <>
                  <span className="mr-2 text-[12px] font-normal text-[#6B7280]">
                    応募書類3点セット（{subStep3pt + 1}/3）
                  </span>
                  {active3ptCategory?.name} - テンプレート入力
                </>
              ) : (
                <>{selectedCategory?.name} - テンプレート入力</>
              )}
            </h2>

            {/* 履歴書作成: 志望動機カスケード選択 */}
            {isRirekisho && (
              <div className="mb-6 space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <p className="text-[13px] font-bold text-[#374151]">
                  志望動機<span className="ml-1 text-red-500">*</span>
                </p>
                {/* 大分類 */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#6B7280]">
                    志望動機（大分類）
                  </label>
                  <select
                    value={motivMajorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setMotivMajorId(id);
                      const name = motivMajors.find((m) => m.id === id)?.name ?? "";
                      setMotivMajorName(name);
                    }}
                    className={selectCls}
                  >
                    <option value="">選択してください</option>
                    {motivMajors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 中分類 */}
                {motivMajorId && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      志望動機（中分類）
                    </label>
                    <select
                      value={motivMiddleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setMotivMiddleId(id);
                        const name = motivMiddles.find((m) => m.id === id)?.name ?? "";
                        setMotivMiddleName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {motivMiddles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 小分類 (複数選択) */}
                {motivMiddleId && motivMinors.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      志望動機（小分類）<span className="ml-1 text-[#9CA3AF]">（複数選択可）</span>
                    </label>
                    {selectedMotivMinors.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {selectedMotivMinors.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedMotivMinors((prev) =>
                                  prev.filter((n) => n !== name)
                                )
                              }
                              className="ml-0.5 text-[#93C5FD] hover:text-[#2563EB]"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-3">
                      {motivMinors.map((minor) => (
                        <label
                          key={minor.id}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedMotivMinors.includes(minor.name)}
                            onChange={() => {
                              setSelectedMotivMinors((prev) =>
                                prev.includes(minor.name)
                                  ? prev.filter((n) => n !== minor.name)
                                  : [...prev, minor.name]
                              );
                            }}
                            className="h-4 w-4 shrink-0 accent-[#2563EB]"
                          />
                          <span className="text-[14px] text-[#374151]">{minor.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* 選択結果 */}
                {motivMajorName && (
                  <p className="text-[12px] text-[#2563EB]">
                    選択中: {motivMajorName}
                    {motivMiddleName ? ` > ${motivMiddleName}` : ""}
                    {selectedMotivMinors.length > 0
                      ? ` > ${selectedMotivMinors.join("、")}`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {/* 職務経歴書: 職種カスケード選択 */}
            {isShokumu && (
              <div className="mb-6 space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <p className="text-[13px] font-bold text-[#374151]">
                  応募職種<span className="ml-1 text-red-500">*</span>
                </p>
                {/* 大分類 */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#6B7280]">
                    職種（大分類）
                  </label>
                  <select
                    value={selectedMajorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedMajorId(id);
                      const name = jobMajors.find((m) => m.id === id)?.name ?? "";
                      setSelectedMajorName(name);
                    }}
                    className={selectCls}
                  >
                    <option value="">選択してください</option>
                    {jobMajors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 中分類 */}
                {selectedMajorId && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      職種（中分類）
                    </label>
                    <select
                      value={selectedMiddleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedMiddleId(id);
                        const name = jobMiddles.find((m) => m.id === id)?.name ?? "";
                        setSelectedMiddleName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {jobMiddles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 小分類 */}
                {selectedMiddleId && jobMinors.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      職種（小分類）
                    </label>
                    <select
                      value={selectedMinorId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedMinorId(id);
                        const name = jobMinors.find((m) => m.id === id)?.name ?? "";
                        setSelectedMinorName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {jobMinors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 選択結果 */}
                {selectedMajorName && (
                  <p className="text-[12px] text-[#2563EB]">
                    選択中: {selectedMajorName}
                    {selectedMiddleName ? ` > ${selectedMiddleName}` : ""}
                    {selectedMinorName ? ` > ${selectedMinorName}` : ""}
                  </p>
                )}
              </div>
            )}

            {/* テンプレートフィールド */}
            {(() => {
              const visibleFields = getVisibleFields();
              if (visibleFields.length === 0 && !isShokumu && !isKyujinKensaku) {
                return (
                  <p className="text-[14px] text-[#6B7280]">
                    テンプレート項目はありません。次へ進んでください。
                  </p>
                );
              }
              return (
                <div className="space-y-5">
                  {/* FM登録依頼: カスタムフィールド（先頭に表示） */}
                  {isFmTouroku && (
                    <>
                      {/* 氏名（姓・名分割） */}
                      <div>
                        <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                          氏名<span className="ml-1 text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <input type="text" placeholder="姓" value={fieldValues["__fm_sei"] ?? ""} onChange={(e) => setFieldValue("__fm_sei", e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                          <input type="text" placeholder="名" value={fieldValues["__fm_mei"] ?? ""} onChange={(e) => setFieldValue("__fm_mei", e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                        </div>
                      </div>

                      {/* フリガナ（セイ・メイ分割） */}
                      <div>
                        <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                          フリガナ<span className="ml-1 text-red-500">*</span>
                          <span className="ml-2 text-[12px] font-normal text-[#9CA3AF]">※カタカナで入力してください</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <input type="text" placeholder="セイ" value={fieldValues["__fm_sei_kana"] ?? ""} onChange={(e) => setFieldValue("__fm_sei_kana", e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                          <input type="text" placeholder="メイ" value={fieldValues["__fm_mei_kana"] ?? ""} onChange={(e) => setFieldValue("__fm_mei_kana", e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                        </div>
                      </div>
                    </>
                  )}

                  {/* 求人検索: 職種選択UI */}
                  {isKyujinKensaku && (
                    <div>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                        職種<span className="ml-1 text-red-500">*</span>
                      </label>
                      <JobCategorySelector
                        value={kyujinJobAxes}
                        onChange={(axes) => {
                          setKyujinJobAxes(axes);
                          // 職種フィールドにJSON保存
                          const jobField = selectedCategory?.fields.find((f) => f.label === "職種");
                          if (jobField) setFieldValue(jobField.id, JSON.stringify(axes));
                        }}
                      />
                    </div>
                  )}

                  {visibleFields.map((field) => {
                    // 求人検索: 職種フィールドはカスタムUIで表示済み
                    if (isKyujinKensaku && field.label === "職種") return null;

                    return (
                    <div key={field.id}>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                        {field.label}
                        {field.isRequired && (
                          <span className="ml-1 text-red-500">*</span>
                        )}
                        {/* 求人検索: AI整理ボタン */}
                        {isKyujinKensaku && field.label === "求人のポイント・条件" && (
                          <button
                            type="button"
                            disabled={aiOrganizing || !(fieldValues[field.id] ?? "").trim()}
                            onClick={async () => {
                              const text = (fieldValues[field.id] ?? "").trim();
                              if (!text) return;
                              setAiOrganizing(true);
                              try {
                                const res = await fetch("/api/tasks/ai-organize", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ text }),
                                });
                                if (!res.ok) { alert("整理に失敗しました"); return; }
                                const data = await res.json();
                                if (data.organized) setFieldValue(field.id, data.organized);
                              } catch { alert("整理に失敗しました"); }
                              finally { setAiOrganizing(false); }
                            }}
                            className="ml-3 inline-flex items-center gap-1 rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#2563EB] disabled:opacity-40"
                          >
                            {aiOrganizing ? "整理中..." : "✨ AI整理"}
                          </button>
                        )}
                        {isKyujinKensaku && field.label === "求人のポイント・条件" && (
                          <button
                            type="button"
                            onClick={() => { setPointsModalFieldId(field.id); setPointsModalOpen(true); }}
                            className="ml-1 inline-flex items-center gap-1 rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#2563EB]"
                          >
                            全体表示
                          </button>
                        )}
                      </label>
                      {field.description && (
                        <p className="mb-1 text-[12px] text-[#9CA3AF]">{field.description}</p>
                      )}
                      {renderField(field, activeFieldValues, setFieldValue, toggleMultiSelect)}

                      {/* FM登録: メールアドレスの直下に郵便番号・住所を挿入 */}
                      {isFmTouroku && field.label === "メールアドレス" && (
                        <>
                          <div className="mt-5">
                            <label className="mb-1 block text-[13px] font-medium text-[#374151]">郵便番号</label>
                            <input type="text" placeholder="000-0000" value={fieldValues["__fm_zip"] ?? ""} onChange={(e) => setFieldValue("__fm_zip", e.target.value)} className="max-w-[160px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                          </div>
                          <div className="mt-5">
                            <label className="mb-1 block text-[13px] font-medium text-[#374151]">住所</label>
                            <input type="text" value={fieldValues["__fm_address"] ?? ""} onChange={(e) => setFieldValue("__fm_address", e.target.value)} className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                          </div>
                        </>
                      )}

                      {/* 面接対策: 選考企業名の直下に選考求人情報を挿入 */}
                      {isMensetsuTaisaku && field.label === "選考企業名" && (
                        <div className="mt-5">
                          <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                            選考求人情報<span className="ml-1 text-red-500">*</span>
                          </label>
                          <div className="flex gap-4 mb-2">
                            {(["url", "pdf"] as const).map((t) => (
                              <label key={t} className="flex cursor-pointer items-center gap-2">
                                <input type="radio" name="mensetsuInfoType" checked={mensetsuInfoType === t} onChange={() => setMensetsuInfoType(t)} className="accent-[#2563EB]" />
                                <span className="text-[14px] text-[#374151]">{t === "url" ? "URL" : "PDF"}</span>
                              </label>
                            ))}
                          </div>
                          {mensetsuInfoType === "url" ? (
                            <input
                              type="text"
                              value={fieldValues[selectedCategory?.fields.find((f) => f.label === "選考求人情報")?.id ?? ""] ?? ""}
                              onChange={(e) => {
                                const fld = selectedCategory?.fields.find((f) => f.label === "選考求人情報");
                                if (fld) setFieldValue(fld.id, e.target.value);
                              }}
                              placeholder="https://..."
                              className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                            />
                          ) : (
                            <div>
                              <div
                                onDragOver={(e) => { e.preventDefault(); setTemplateDragOver(true); }}
                                onDragLeave={() => setTemplateDragOver(false)}
                                onDrop={(e) => { e.preventDefault(); setTemplateDragOver(false); if (e.dataTransfer.files[0]) setMensetsuPdfFile(e.dataTransfer.files[0]); }}
                                className={`flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-4 transition-colors ${templateDragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]"}`}
                              >
                                <p className="text-[13px] text-[#6B7280]">PDFをドラッグ＆ドロップ、または</p>
                                <button type="button" onClick={() => templateFileInputRef.current?.click()} className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline">ファイルを選択</button>
                                <input ref={templateFileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setMensetsuPdfFile(e.target.files[0]); }} />
                              </div>
                              {mensetsuPdfFile && (
                                <div className="mt-2 flex items-center gap-2 rounded-[6px] border border-[#E5E7EB] px-3 py-2">
                                  <span className="flex-1 truncate text-[13px] text-[#374151]">{mensetsuPdfFile.name}</span>
                                  <button type="button" onClick={() => setMensetsuPdfFile(null)} className="text-[12px] text-[#9CA3AF] hover:text-red-600">削除</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                  })}

                  {/* 非営業: 経歴・実績の概要 */}
                  {isShokumu && selectedMajorName && !isSalesJob && (
                    <div>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                        経歴・実績の概要
                      </label>
                      <textarea
                        rows={4}
                        value={careerSummary}
                        placeholder="これまでの経歴や実績、アピールポイントを入力してください"
                        onChange={(e) => setCareerSummary(e.target.value)}
                        className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                      />
                    </div>
                  )}

                  {/* ===== 内定承諾報告: カスタムフィールド ===== */}
                  {isNaitei && (
                    <>
                      {/* 対象者（候補者検索） */}
                      <div>
                        <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                          対象者<span className="ml-1 text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={naiteiCandidateSearch}
                          onChange={(e) => {
                            setNaiteiCandidateSearch(e.target.value);
                            const fld = selectedCategory?.fields.find((f) => f.label === "対象者フルネーム");
                            if (fld) setFieldValue(fld.id, e.target.value);
                          }}
                          placeholder="候補者名を入力"
                          className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                          list="naitei-candidate-list"
                        />
                        <datalist id="naitei-candidate-list">
                          {candidates.filter((c) => naiteiCandidateSearch && c.name.includes(naiteiCandidateSearch)).slice(0, 10).map((c) => (
                            <option key={c.id} value={c.name}>{c.name}（{c.candidateNo}）</option>
                          ))}
                        </datalist>
                      </div>

                      {/* 内定した職種（3階層） */}
                      <div className="space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                        <p className="text-[13px] font-bold text-[#374151]">内定した職種<span className="ml-1 text-red-500">*</span></p>
                        <select value={selectedMajorId} onChange={(e) => { const id = e.target.value; setSelectedMajorId(id); setSelectedMajorName(jobMajors.find((m) => m.id === id)?.name ?? ""); }} className={selectCls}>
                          <option value="">大分類を選択</option>
                          {jobMajors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {selectedMajorId && (
                          <select value={selectedMiddleId} onChange={(e) => { const id = e.target.value; setSelectedMiddleId(id); setSelectedMiddleName(jobMiddles.find((m) => m.id === id)?.name ?? ""); }} className={selectCls}>
                            <option value="">中分類を選択</option>
                            {jobMiddles.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        )}
                        {selectedMiddleId && jobMinors.length > 0 && (
                          <select value={selectedMinorId} onChange={(e) => { const id = e.target.value; setSelectedMinorId(id); setSelectedMinorName(jobMinors.find((m) => m.id === id)?.name ?? ""); }} className={selectCls}>
                            <option value="">小分類を選択</option>
                            {jobMinors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        )}
                        {selectedMajorName && <p className="text-[12px] text-[#2563EB]">選択中: {[selectedMajorName, selectedMiddleName, selectedMinorName].filter(Boolean).join(" > ")}</p>}
                      </div>

                      {/* 内定した業種（3階層） */}
                      <div className="space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                        <p className="text-[13px] font-bold text-[#374151]">内定した業種<span className="ml-1 text-red-500">*</span></p>
                        <select value={naiteiIndMajorId} onChange={(e) => { const id = e.target.value; setNaiteiIndMajorId(id); setNaiteiIndMajorName(naiteiIndustryMajors.find((m) => m.id === id)?.name ?? ""); }} className={selectCls}>
                          <option value="">大分類を選択</option>
                          {naiteiIndustryMajors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {naiteiIndMajorId && (
                          <select value={naiteiIndMiddleId} onChange={(e) => { const id = e.target.value; setNaiteiIndMiddleId(id); setNaiteiIndMiddleName(naiteiIndustryMiddles.find((m) => m.id === id)?.name ?? ""); }} className={selectCls}>
                            <option value="">中分類を選択</option>
                            {naiteiIndustryMiddles.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        )}
                        {naiteiIndMiddleId && naiteiIndustryMinors.length > 0 && (
                          <select onChange={(e) => setNaiteiIndMinorName(e.target.value)} value={naiteiIndMinorName} className={selectCls}>
                            <option value="">小分類を選択</option>
                            {naiteiIndustryMinors.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                          </select>
                        )}
                        {naiteiIndMajorName && <p className="text-[12px] text-[#2563EB]">選択中: {[naiteiIndMajorName, naiteiIndMiddleName, naiteiIndMinorName].filter(Boolean).join(" > ")}</p>}
                      </div>

                      {/* 勤務地（地域→都道府県） */}
                      <div className="space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                        <p className="text-[13px] font-bold text-[#374151]">内定した勤務地<span className="ml-1 text-red-500">*</span></p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-[12px] text-[#6B7280]">地域</label>
                            <select value={naiteiRegion} onChange={(e) => { setNaiteiRegion(e.target.value); setNaiteiPrefecture(""); }} className={selectCls}>
                              <option value="">選択してください</option>
                              {REGIONS.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[12px] text-[#6B7280]">都道府県</label>
                            <select value={naiteiPrefecture} onChange={(e) => setNaiteiPrefecture(e.target.value)} className={selectCls}>
                              <option value="">選択してください</option>
                              {(REGIONS.find((r) => r.name === naiteiRegion)?.prefectures ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* 雇用形態 */}
                      <div>
                        <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                          雇用形態<span className="ml-1 text-red-500">*</span>
                        </label>
                        <select value={naiteiEmploymentType} onChange={(e) => setNaiteiEmploymentType(e.target.value)} className={selectCls}>
                          <option value="">選択してください</option>
                          {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {/* ===== RAエントリー: エリア（地域→都道府県） ===== */}
                  {isRAEntry && (
                    <div className="space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                      <p className="text-[13px] font-bold text-[#374151]">エリア<span className="ml-1 text-red-500">*</span></p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-[12px] text-[#6B7280]">地域</label>
                          <select
                            value={fieldValues["__ra_region"] ?? ""}
                            onChange={(e) => { setFieldValue("__ra_region", e.target.value); setFieldValue("__ra_pref", ""); }}
                            className={selectCls}
                          >
                            <option value="">選択してください</option>
                            {REGIONS.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[12px] text-[#6B7280]">都道府県</label>
                          <select
                            value={fieldValues["__ra_pref"] ?? ""}
                            onChange={(e) => {
                              setFieldValue("__ra_pref", e.target.value);
                              const fld = selectedCategory?.fields.find((f) => f.label === "エリア");
                              if (fld) setFieldValue(fld.id, `${fieldValues["__ra_region"] ?? ""} ${e.target.value}`);
                            }}
                            className={selectCls}
                          >
                            <option value="">選択してください</option>
                            {(REGIONS.find((r) => r.name === (fieldValues["__ra_region"] ?? ""))?.prefectures ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ===== テンプレート添付ファイル（対象カテゴリのみ） ===== */}
                  {(isMensetsuTaisaku || isNaitei || isNyusha || isFmTouroku) && !isMensetsuTaisaku && (
                    <div>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">添付ファイル（任意）</label>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setTemplateDragOver(true); }}
                        onDragLeave={() => setTemplateDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault(); setTemplateDragOver(false);
                          if (e.dataTransfer.files) {
                            setTemplateAttachFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
                          }
                        }}
                        className={`flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-4 transition-colors ${templateDragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]"}`}
                      >
                        <p className="text-[13px] text-[#6B7280]">ファイルをドラッグ＆ドロップ、または</p>
                        <button type="button" onClick={() => { const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.accept = ".pdf,.jpg,.jpeg,.png,.gif,.docx,.xlsx,.csv,.txt"; input.onchange = (ev) => { const files = (ev.target as HTMLInputElement).files; if (files) setTemplateAttachFiles((prev) => [...prev, ...Array.from(files)]); }; input.click(); }} className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline">ファイルを選択</button>
                        <p className="mt-1 text-[11px] text-[#9CA3AF]">PDF, 画像, Word, Excel, CSV, テキスト（最大10MB）</p>
                      </div>
                      {templateAttachFiles.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {templateAttachFiles.map((f, i) => (
                            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-[6px] border border-[#E5E7EB] px-3 py-2">
                              <span className="flex-1 truncate text-[13px] text-[#374151]">{f.name}</span>
                              <button type="button" onClick={() => setTemplateAttachFiles((prev) => prev.filter((_, j) => j !== i))} className="text-[12px] text-[#9CA3AF] hover:text-red-600">削除</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ----- Step 3: 担当者選択 ----- */}
        {step === 3 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              担当者選択（必須）
            </h2>
            <input
              type="text"
              placeholder="名前で検索"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              className="mb-3 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            {assigneeIds.length > 0 && (
              <p className="mb-2 text-[12px] text-[#2563EB] font-medium">
                {assigneeIds.length}名 選択中
              </p>
            )}
            <div className="max-h-[300px] overflow-y-auto rounded-[6px] border border-[#E5E7EB]">
              {filteredEmployees.length === 0 && (
                <p className="p-4 text-center text-[13px] text-[#9CA3AF]">
                  該当する社員がいません
                </p>
              )}
              {filteredEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className={[
                    "flex cursor-pointer items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 text-[14px] transition-colors last:border-b-0",
                    assigneeIds.includes(emp.id)
                      ? "bg-[#EEF2FF]"
                      : "hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(emp.id)}
                    onChange={() => toggleAssignee(emp.id)}
                    className="h-4 w-4 accent-[#2563EB]"
                  />
                  <span className="font-medium text-[#374151]">{emp.name}</span>
                  <span className="text-[12px] text-[#9CA3AF]">
                    {emp.employeeNo}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ----- Step 4: 追加情報 ----- */}
        {step === 4 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              追加情報
            </h2>
            <div className="space-y-4">
              {is3pointSet ? (
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                    タスクタイトル（自動生成）
                  </label>
                  <div className="space-y-1">
                    {THREE_POINT_LABELS.map((label) => (
                      <p key={label} className="rounded-[6px] bg-[#F9FAFB] px-3 py-2 text-[14px] text-[#374151]">
                        {label} - {selectedCandidate?.name ?? ""}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  タスクタイトル<span className="ml-1 text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              )}
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  詳細メモ（任意）
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  期限（任意）
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  優先度
                </label>
                <div className="flex gap-4">
                  {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="priority"
                        checked={priority === p}
                        onChange={() => setPriority(p)}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[14px] text-[#374151]">
                        {priorityLabel(p)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 完了条件（担当者2名以上の場合） */}
              {assigneeIds.length > 1 && (
                <div>
                  <label className="mb-1 block text-[13px] font-medium text-[#374151]">完了条件</label>
                  <div className="space-y-2">
                    {[
                      { value: "any" as const, label: "誰か1人で完了", desc: "担当者の誰か1人が完了すればタスク全体が完了" },
                      { value: "all" as const, label: "全員完了で完了", desc: "担当者全員が完了しないとタスクは完了にならない" },
                    ].map((opt) => (
                      <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                        <input type="radio" name="completionType" checked={completionType === opt.value} onChange={() => setCompletionType(opt.value)} className="mt-0.5 accent-[#2563EB]" />
                        <div>
                          <span className="text-[14px] text-[#374151] font-medium">{opt.label}</span>
                          <p className="text-[12px] text-[#9CA3AF]">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 添付ファイル（カテゴリによって非表示） */}
              {!hideStep5Attachment && (
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  添付ファイル（任意）
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFilesSelected(e.dataTransfer.files);
                  }}
                  className={[
                    "flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-6 transition-colors",
                    dragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[13px] text-[#6B7280]">
                    ファイルをドラッグ＆ドロップ、または
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline"
                  >
                    ファイルを選択
                  </button>
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">
                    PDF, 画像, Word, Excel, CSV, テキスト（最大10MB）
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.docx,.xlsx,.csv,.txt"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                  />
                </div>

                {candidateId && (
                  <button
                    type="button"
                    onClick={openCandidateFilePicker}
                    className="mt-2 text-[13px] font-medium text-[#2563EB] hover:underline"
                  >
                    📁 求職者ファイルから選択
                  </button>
                )}

                {attachmentError && (
                  <p className="mt-2 text-[13px] text-red-600">{attachmentError}</p>
                )}

                {attachmentFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {attachmentFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center gap-3 rounded-[6px] border border-[#E5E7EB] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[#374151]">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-[#9CA3AF]">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachmentFile(idx)}
                          className="shrink-0 rounded-[4px] px-2 py-1 text-[12px] text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          </div>
        )}

        {/* ----- Step 5: 確認 ----- */}
        {step === 5 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              入力内容の確認
            </h2>
            <dl className="space-y-3 text-[14px]">
              {is3pointSet ? (
                <>
                  <ConfirmRow label="モード" value="応募書類3点セット一括作成" />
                  {selectedCandidate && (
                    <ConfirmRow label="求職者" value={selectedCandidate.name} />
                  )}
                  <div>
                    <dt className="text-[12px] font-medium text-[#6B7280]">作成されるタスク</dt>
                    <dd className="mt-1 space-y-1">
                      {THREE_POINT_LABELS.map((label) => (
                        <p key={label} className="text-[13px] text-[#374151]">
                          {label} - {selectedCandidate?.name ?? ""}
                        </p>
                      ))}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  <ConfirmRow label="タスクタイトル" value={title} />
                  {selectedCandidate && (
                    <ConfirmRow label="求職者" value={selectedCandidate.name} />
                  )}
                  <ConfirmRow
                    label="カテゴリ"
                    value={selectedCategory?.name ?? "-"}
                  />
                </>
              )}
              {/* 志望動機情報 */}
              {is3pointSet ? (
                motivState3pt.majorName ? (
                  <>
                    <ConfirmRow label="志望動機（大分類）" value={motivState3pt.majorName} />
                    {motivState3pt.middleName && (
                      <ConfirmRow label="志望動機（中分類）" value={motivState3pt.middleName} />
                    )}
                    {motivState3pt.minors.length > 0 && (
                      <div>
                        <dt className="text-[12px] font-medium text-[#6B7280]">志望動機（小分類）</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {motivState3pt.minors.map((name) => (
                            <span key={name} className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]">{name}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                  </>
                ) : null
              ) : (
                isRirekisho && motivMajorName && (
                  <>
                    <ConfirmRow label="志望動機（大分類）" value={motivMajorName} />
                    {motivMiddleName && (
                      <ConfirmRow label="志望動機（中分類）" value={motivMiddleName} />
                    )}
                    {selectedMotivMinors.length > 0 && (
                      <div>
                        <dt className="text-[12px] font-medium text-[#6B7280]">志望動機（小分類）</dt>
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {selectedMotivMinors.map((name) => (
                            <span
                              key={name}
                              className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                            >
                              {name}
                            </span>
                          ))}
                        </dd>
                      </div>
                    )}
                  </>
                )
              )}
              {/* 職種情報 */}
              {is3pointSet ? (
                jobState3pt.majorName ? (
                  <ConfirmRow
                    label="応募職種"
                    value={[jobState3pt.majorName, jobState3pt.middleName, jobState3pt.minorName]
                      .filter(Boolean)
                      .join(" > ")}
                  />
                ) : null
              ) : (
                isShokumu && selectedMajorName && (
                  <ConfirmRow
                    label="応募職種"
                    value={[selectedMajorName, selectedMiddleName, selectedMinorName]
                      .filter(Boolean)
                      .join(" > ")}
                  />
                )
              )}
              <ConfirmRow
                label="担当者"
                value={
                  employees
                    .filter((e) => assigneeIds.includes(e.id))
                    .map((e) => e.name)
                    .join("、") || "-"
                }
              />
              <ConfirmRow label="優先度" value={priorityLabel(priority)} />
              <ConfirmRow label="期限" value={dueDate || "なし"} />
              {description && (
                <ConfirmRow label="詳細メモ" value={description} />
              )}
              {/* 経歴概要（非営業・3pt） */}
              {is3pointSet && !SALES_MAJORS.includes(jobState3pt.majorName) && careerSummary3pt && (
                <ConfirmRow label="経歴・実績の概要" value={careerSummary3pt} />
              )}
              {!is3pointSet && isShokumu && !isSalesJob && careerSummary && (
                <ConfirmRow label="経歴・実績の概要" value={careerSummary} />
              )}
              {!is3pointSet && selectedCategory &&
                selectedCategory.fields.length > 0 && (
                  <div>
                    <dt className="text-[12px] font-medium text-[#6B7280]">
                      テンプレート項目
                    </dt>
                    <dd className="mt-1 space-y-1">
                      {selectedCategory.fields.map((f) => {
                        if (isRirekisho && (f.label === "志望動機（大分類）" || f.label === "志望動機（中分類）" || f.label === "志望動機（小分類）")) return null;
                        if (f.label === "応募職種" && isShokumu) return null;
                        if (isKyujinKensaku && f.label === "職種") {
                          return (
                            <div key={f.id} className="flex gap-2 text-[13px]">
                              <span className="shrink-0 text-[#6B7280]">{f.label}:</span>
                              <div className="text-[#374151]">
                                {kyujinJobAxes.filter(a => a.major).map((a) => (
                                  <div key={a.axis}>第{a.axis}軸: {[a.major, a.middle, a.minor].filter(Boolean).join(" > ")}</div>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        const raw = fieldValues[f.id] ?? "";
                        if (!raw) return null;

                        if (
                          (f.fieldType === "MULTI_SELECT" || (f.fieldType === "CHECKBOX" && f.options.length > 0)) &&
                          raw.startsWith("[")
                        ) {
                          let labels: string[] = [];
                          try {
                            labels = (JSON.parse(raw) as string[]).map(
                              (v) =>
                                f.options.find((o) => o.value === v)?.label ?? v
                            );
                          } catch {
                            /* skip */
                          }
                          if (labels.length === 0) return null;
                          return (
                            <div key={f.id}>
                              <span className="text-[12px] text-[#6B7280]">{f.label}:</span>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {labels.map((l) => (
                                  <span
                                    key={l}
                                    className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                                  >
                                    {l}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        let display = raw;
                        if (f.fieldType === "SELECT" || f.fieldType === "RADIO") {
                          display =
                            f.options.find((o) => o.value === raw)?.label ?? raw;
                        } else if (f.fieldType === "CHECKBOX" && f.options.length === 0) {
                          display = raw === "true" ? "はい" : "いいえ";
                        }
                        return (
                          <p key={f.id} className="text-[13px] text-[#374151]">
                            <span className="text-[#6B7280]">{f.label}:</span>{" "}
                            {display}
                          </p>
                        );
                      })}
                    </dd>
                  </div>
                )}
              {/* 添付ファイル */}
              <div>
                <dt className="text-[12px] font-medium text-[#6B7280]">添付ファイル</dt>
                <dd className="mt-1">
                  {attachmentFiles.length === 0 ? (
                    <p className="text-[13px] text-[#9CA3AF]">添付ファイルなし</p>
                  ) : (
                    <div className="space-y-1">
                      {attachmentFiles.map((file, idx) => (
                        <p key={`${file.name}-${idx}`} className="text-[13px] text-[#374151]">
                          {file.name}
                          <span className="ml-2 text-[#9CA3AF]">({formatFileSize(file.size)})</span>
                        </p>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* ----- navigation ----- */}
        <div className="mt-6 flex items-center justify-between border-t border-[#F3F4F6] pt-4">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => {
              if (is3pointSet && step === 2 && subStep3pt > 0) {
                save3ptSubStepState(subStep3pt);
                setSubStep3pt((s) => s - 1);
                restore3ptSubStepState(subStep3pt - 1);
              } else {
                if (is3pointSet && step === 3) {
                  restore3ptSubStepState(subStep3pt);
                }
                setStep((s) => s - 1);
              }
            }}
            className={[
              "rounded-[6px] px-4 py-2 text-[14px] font-medium transition-colors",
              step === 0
                ? "cursor-not-allowed text-[#D1D5DB]"
                : "text-[#6B7280] hover:bg-[#F3F4F6]",
            ].join(" ")}
          >
            戻る
          </button>

          {step < 5 ? (
            <button
              type="button"
              disabled={!canProceed()}
              onClick={() => {
                if (is3pointSet && step === 2 && subStep3pt < 2) {
                  save3ptSubStepState(subStep3pt);
                  setSubStep3pt((s) => s + 1);
                  restore3ptSubStepState(subStep3pt + 1);
                } else {
                  if (is3pointSet && step === 2) {
                    save3ptSubStepState(subStep3pt);
                  }
                  setStep((s) => s + 1);
                }
              }}
              className={[
                "rounded-[8px] px-5 py-2.5 text-[14px] font-medium text-white transition-colors",
                canProceed()
                  ? "bg-[#2563EB] hover:bg-[#1D4ED8]"
                  : "cursor-not-allowed bg-[#93C5FD]",
              ].join(" ")}
            >
              次へ
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={is3pointSet ? handle3ptSubmit : handleSubmit}
              className={[
                "rounded-[8px] px-5 py-2.5 text-[14px] font-medium text-white transition-colors",
                submitting
                  ? "cursor-not-allowed bg-[#93C5FD]"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8]",
              ].join(" ")}
            >
              {submitting ? "タスクを作成中..." : is3pointSet ? "3タスクを一括作成" : "タスクを作成"}
            </button>
          )}
        </div>
      </div>
      {/* 求人ポイント全体表示モーダル */}
      {pointsModalOpen && pointsModalFieldId && (
        <PointsModal
          value={fieldValues[pointsModalFieldId] ?? ""}
          onChange={(v) => setFieldValue(pointsModalFieldId, v)}
          onClose={() => setPointsModalOpen(false)}
        />
      )}

      {/* 求職者ファイル選択モーダル */}
      {showCandidateFilePicker && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCandidateFilePicker(false)}>
          <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-3 flex items-center justify-between shrink-0">
              <h3 className="text-[15px] font-bold text-[#374151]">📁 求職者ファイルから選択</h3>
              <button onClick={() => setShowCandidateFilePicker(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {pickerLoading ? (
                <p className="text-center text-sm text-gray-400 py-8">読み込み中...</p>
              ) : candidateFilesForPicker.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">ファイルがありません</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(
                    candidateFilesForPicker.reduce<Record<string, typeof candidateFilesForPicker>>((acc, f) => {
                      const cat = f.category || "OTHER";
                      if (!acc[cat]) acc[cat] = [];
                      acc[cat].push(f);
                      return acc;
                    }, {})
                  ).map(([cat, catFiles]) => (
                    <div key={cat} className="mb-3">
                      <p className="text-[12px] font-semibold text-gray-500 mb-1">{CATEGORY_LABELS[cat] || cat}</p>
                      {catFiles.map((f) => (
                        <label key={f.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-1">
                          <input type="checkbox" checked={pickerSelectedIds.has(f.id)} onChange={() => setPickerSelectedIds((prev) => { const n = new Set(prev); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB]" />
                          <span className="text-[13px] text-gray-700 truncate">{f.fileName}</span>
                          <span className="text-[11px] text-gray-400 shrink-0">{formatFileSize(f.fileSize)}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t px-5 py-3 flex gap-2 shrink-0">
              <button onClick={() => setShowCandidateFilePicker(false)} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-sm hover:bg-gray-50">キャンセル</button>
              <button onClick={handlePickerAttach} disabled={pickerSelectedIds.size === 0 || pickerAttaching} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
                {pickerAttaching ? "添付中..." : `${pickerSelectedIds.size}件を添付`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- field renderer ---------- */

function renderField(
  field: Field,
  fieldValues: Record<string, string>,
  setFieldValue: (id: string, v: string) => void,
  toggleMultiSelect: (id: string, v: string) => void
) {
  const value = fieldValues[field.id] ?? "";
  const base =
    "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  switch (field.fieldType) {
    case "TEXT":
      if (field.label === "年収情報") {
        const salaryMatch = value.match(/^(現在|前職)\s*(\d*)\s*万円\s*\/\s*希望\s*(\d*)\s*[〜~～]\s*(\d*)\s*万円$/);
        const sType = salaryMatch?.[1] || "現在";
        const sCurrent = salaryMatch?.[2] || "";
        const sLow = salaryMatch?.[3] || "";
        const sHigh = salaryMatch?.[4] || "";
        const composeSalary = (t: string, c: string, l: string, h: string) =>
          !c && !l && !h ? "" : `${t} ${c}万円 / 希望 ${l}〜${h}万円`;
        const numInput = "w-[90px] rounded-[6px] border border-[#D1D5DB] px-2 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <select
              value={sType}
              onChange={(e) => setFieldValue(field.id, composeSalary(e.target.value, sCurrent, sLow, sHigh))}
              className="rounded-[6px] border border-[#D1D5DB] px-2 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="現在">現在</option>
              <option value="前職">前職</option>
            </select>
            <input type="number" min="0" value={sCurrent} placeholder="例: 350" onChange={(e) => setFieldValue(field.id, composeSalary(sType, e.target.value, sLow, sHigh))} className={numInput} />
            <span className="text-[14px] text-[#374151]">万円</span>
            <span className="text-[14px] text-[#6B7280] ml-2">希望</span>
            <input type="number" min="0" value={sLow} placeholder="例: 400" onChange={(e) => setFieldValue(field.id, composeSalary(sType, sCurrent, e.target.value, sHigh))} className={numInput} />
            <span className="text-[14px] text-[#6B7280]">〜</span>
            <input type="number" min="0" value={sHigh} placeholder="例: 500" onChange={(e) => setFieldValue(field.id, composeSalary(sType, sCurrent, sLow, e.target.value))} className={numInput} />
            <span className="text-[14px] text-[#374151]">万円</span>
          </div>
        );
      }
      if (field.label === "エントリー件数") {
        return (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={value}
              placeholder="5"
              onChange={(e) => setFieldValue(field.id, e.target.value)}
              className="max-w-[120px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <span className="text-[14px] text-[#374151]">件</span>
          </div>
        );
      }
      return (
        <input
          type="text"
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
    case "TEXTAREA":
      return (
        <textarea
          rows={4}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
    case "SELECT":
      return (
        <select
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        >
          <option value="">選択してください</option>
          {field.options.map((opt) => (
            <option key={opt.id} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected: string[] = (() => {
        try {
          return JSON.parse(value || "[]");
        } catch {
          return [];
        }
      })();
      return (
        <div>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((v) => {
                const opt = field.options.find((o) => o.value === v);
                return (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                  >
                    {opt?.label ?? v}
                    <button
                      type="button"
                      onClick={() => toggleMultiSelect(field.id, v)}
                      className="ml-0.5 text-[#93C5FD] hover:text-[#2563EB]"
                    >
                      &times;
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-3">
            {field.options.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggleMultiSelect(field.id, opt.value)}
                  className="h-4 w-4 shrink-0 accent-[#2563EB]"
                />
                <span className="text-[14px] text-[#374151]">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "DATE": {
      const needsTime = ["面談日", "面談予定日"].includes(field.label);
      const needsTimeRange = field.label.startsWith("候補日");
      const dateVal = value.split(" ")[0] ?? "";
      const timeVal = value.split(" ")[1] ?? "";
      const timeEndVal = value.split(" ")[2] ?? "";

      if (needsTimeRange) {
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={dateVal} onChange={(e) => setFieldValue(field.id, `${e.target.value} ${timeVal} ${timeEndVal}`.trim())} className="max-w-[180px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
            <select value={timeVal} onChange={(e) => setFieldValue(field.id, `${dateVal} ${e.target.value} ${timeEndVal}`.trim())} className="rounded-[6px] border border-[#D1D5DB] px-2 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]">
              <option value="">開始</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-[14px] text-[#6B7280]">〜</span>
            <select value={timeEndVal} onChange={(e) => setFieldValue(field.id, `${dateVal} ${timeVal} ${e.target.value}`.trim())} className="rounded-[6px] border border-[#D1D5DB] px-2 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]">
              <option value="">終了</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        );
      }

      if (needsTime) {
        return (
          <div className="flex items-center gap-2">
            <input type="date" value={dateVal} onChange={(e) => setFieldValue(field.id, `${e.target.value} ${timeVal}`.trim())} className="max-w-[180px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
            <input
              type="text"
              list={`time-list-${field.id}`}
              value={timeVal}
              onChange={(e) => setFieldValue(field.id, `${dateVal} ${e.target.value}`.trim())}
              placeholder="時刻"
              className="w-[100px] rounded-[6px] border border-[#D1D5DB] px-2 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <datalist id={`time-list-${field.id}`}>
              {TIME_OPTIONS_30.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
        );
      }

      // 生年月日: 年齢自動表示
      if (field.label === "生年月日") {
        const age = value ? Math.floor((Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
        return (
          <div className="flex items-center gap-2">
            <input type="date" value={value} onChange={(e) => setFieldValue(field.id, e.target.value)} className="max-w-[180px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
            {age !== null && age >= 0 && <span className="text-[14px] text-[#6B7280]">（{age}歳）</span>}
          </div>
        );
      }

      return (
        <input
          type="date"
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className="max-w-[180px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
        />
      );
    }
    case "CHECKBOX": {
      // オプションがある場合は複数選択チェックボックスリスト
      if (field.options.length > 0) {
        const selected: string[] = (() => {
          try { return JSON.parse(value || "[]"); } catch { return []; }
        })();
        return (
          <div className="space-y-2">
            {field.options.map((opt) => (
              <label key={opt.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggleMultiSelect(field.id, opt.value)}
                  className="h-4 w-4 shrink-0 accent-[#2563EB]"
                />
                <span className="text-[14px] text-[#374151]">{opt.label}</span>
              </label>
            ))}
          </div>
        );
      }
      // オプションなしの場合は従来の単一チェックボックス
      return (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) =>
              setFieldValue(field.id, e.target.checked ? "true" : "false")
            }
            className="h-4 w-4 accent-[#2563EB]"
          />
          <span className="text-[14px] text-[#374151]">はい</span>
        </label>
      );
    }
    case "RADIO":
      return (
        <div className="space-y-2">
          {field.options.map((opt) => (
            <label key={opt.id} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`radio-${field.id}`}
                checked={value === opt.value}
                onChange={() => setFieldValue(field.id, opt.value)}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span className="text-[14px] text-[#374151]">{opt.label}</span>
            </label>
          ))}
        </div>
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
  }
}

/* ---------- confirm row ---------- */

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-[#374151] whitespace-pre-wrap">
        {value}
      </dd>
    </div>
  );
}
