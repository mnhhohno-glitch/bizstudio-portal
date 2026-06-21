"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { REGIONS } from "@/lib/constants/prefectures";
import { EMPLOYMENT_TYPES } from "@/lib/constants/employment-types";

type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
};

interface CandidateRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  onCreated: () => void;
  currentEmployeeName?: string | null;
}

function normalizeName(name: string): string {
  return name.replace(/　/g, " ").replace(/\s+/g, " ").trim();
}

function calculateAge(birthdayStr: string): string {
  if (!birthdayStr) return "";
  const birth = new Date(birthdayStr);
  if (isNaN(birth.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? `${age}歳` : "";
}

const ROUTE_OPTIONS = ["スカウト", "応募"];
const MEDIA_OPTIONS = [
  "マイナビ転職",
  "indeed",
  "日経HR",
  "自社HP",
  "dodaMaps",
  "マイナビエージェント",
];

export default function CandidateRegistrationModal({
  isOpen,
  onClose,
  employees,
  onCreated,
  currentEmployeeName,
}: CandidateRegistrationModalProps) {
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [isKanaComposing, setIsKanaComposing] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [recruiterName, setRecruiterName] = useState("");
  const [applicationRoute, setApplicationRoute] = useState("");
  const [mediaSource, setMediaSource] = useState("");
  const [scoutNumber, setScoutNumber] = useState("");
  const [scoutDeliveryDate, setScoutDeliveryDate] = useState("");
  const [applicationDate, setApplicationDate] = useState("");
  const [masType, setMasType] = useState("");
  const [desiredJobType1, setDesiredJobType1] = useState("");
  const [desiredJobType2, setDesiredJobType2] = useState("");
  const [desiredIndustry1, setDesiredIndustry1] = useState("");
  const [desiredIndustry2, setDesiredIndustry2] = useState("");
  const [desiredPrefecture1, setDesiredPrefecture1] = useState("");
  const [desiredPrefecture2, setDesiredPrefecture2] = useState("");
  const [desiredEmploymentType, setDesiredEmploymentType] = useState("");
  const [desiredSalaryMin, setDesiredSalaryMin] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // PDF upload
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDragging, setPdfDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Support status dialog
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [createdCandidateId, setCreatedCandidateId] = useState<string | null>(null);
  const [createdCandidateName, setCreatedCandidateName] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("BEFORE");
  const [savingStatus, setSavingStatus] = useState(false);
  const router = useRouter();

  // Auto-fetch next number on open
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/candidates/next-number")
      .then((r) => r.json())
      .then((data) => {
        if (data.nextNumber) setCandidateNumber(data.nextNumber);
      })
      .catch(() => {});
    // Auto-set current employee
    if (currentEmployeeName) {
      const emp = employees.find((e) => e.name === currentEmployeeName);
      if (emp) setEmployeeId(emp.id);
    }
  }, [isOpen, currentEmployeeName, employees]);

  if (!isOpen) return null;

  const handleClose = () => {
    setCandidateNumber("");
    setCandidateName("");
    setNameKana("");
    setEmail("");
    setPhone("");
    setAddress("");
    setGender("");
    setBirthday("");
    setEmployeeId("");
    setRecruiterName("");
    setApplicationRoute("");
    setMediaSource("");
    setScoutNumber("");
    setDesiredJobType1("");
    setDesiredJobType2("");
    setDesiredIndustry1("");
    setDesiredIndustry2("");
    setDesiredPrefecture1("");
    setDesiredPrefecture2("");
    setDesiredEmploymentType("");
    setDesiredSalaryMin("");
    setPdfFile(null);
    setErrors({});
    onClose();
  };

  const handleParseResume = async () => {
    if (!pdfFile) return;
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const res = await fetch("/api/candidates/parse-resume", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "PDF解析に失敗しました");
        return;
      }
      const data = await res.json();
      if (data.name) setCandidateName(data.name);
      if (data.furigana) setNameKana(data.furigana);
      if (data.gender) setGender(data.gender);
      if (data.birthday) setBirthday(data.birthday);
      if (data.email) setEmail(data.email);
      if (data.phone) setPhone(data.phone);
      if (data.address) setAddress(data.address);
      if (data.consultantName) setRecruiterName(data.consultantName);
      setApplicationRoute(data.applicationRoute || "スカウト");
      setMediaSource(data.mediaSource || "マイナビ転職");
      // 応募日・配信日・開放日/通常（解析結果に値があればセット、null/空なら手入力に委ねる）
      if (data.applicationDate) setApplicationDate(data.applicationDate);
      if (data.scoutDeliveryDate) setScoutDeliveryDate(data.scoutDeliveryDate);
      if (data.masType) setMasType(data.masType);
      if (data.desiredJobType1) setDesiredJobType1(data.desiredJobType1);
      if (data.desiredJobType2) setDesiredJobType2(data.desiredJobType2);
      if (data.desiredIndustry1) setDesiredIndustry1(data.desiredIndustry1);
      if (data.desiredIndustry2) setDesiredIndustry2(data.desiredIndustry2);
      if (data.desiredPrefecture1) setDesiredPrefecture1(data.desiredPrefecture1);
      if (data.desiredPrefecture2) setDesiredPrefecture2(data.desiredPrefecture2);
      if (data.desiredEmploymentType) setDesiredEmploymentType(data.desiredEmploymentType);
      if (typeof data.desiredSalaryMin === "number") setDesiredSalaryMin(String(data.desiredSalaryMin));
      toast.success("履歴書の解析が完了しました");
    } catch {
      toast.error("PDF解析に失敗しました");
    } finally {
      setParsing(false);
    }
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!candidateNumber.trim()) {
      next.candidateNumber = "求職者番号を入力してください";
    } else if (!/^5\d{6}$/.test(candidateNumber.trim())) {
      next.candidateNumber = "求職者番号は5から始まる7桁の数字で入力してください";
    }
    if (!candidateName.trim()) next.candidateName = "氏名を入力してください";
    if (!nameKana.trim()) next.nameKana = "フリガナを入力してください";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "正しいメールアドレスを入力してください";
    }
    if (!gender) next.gender = "性別を選択してください";
    if (!employeeId) next.employeeId = "担当キャリアアドバイザーを選択してください";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    try {
      const res = await fetch("/api/master/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateNumber: candidateNumber.trim(),
          name: normalizeName(candidateName),
          nameKana: normalizeName(nameKana),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          address: address.trim() || undefined,
          gender,
          birthday: birthday || undefined,
          employeeId,
          recruiterName: recruiterName.trim() || undefined,
          applicationRoute: applicationRoute || undefined,
          mediaSource: mediaSource || undefined,
          scoutNumber: scoutNumber.trim() || undefined,
          scoutDeliveryDate: scoutDeliveryDate || undefined,
          applicationDate: applicationDate || undefined,
          masType: masType || undefined,
          desiredJobType1: desiredJobType1.trim() || undefined,
          desiredJobType2: desiredJobType2.trim() || undefined,
          desiredIndustry1: desiredIndustry1.trim() || undefined,
          desiredIndustry2: desiredIndustry2.trim() || undefined,
          desiredPrefecture1: desiredPrefecture1 || undefined,
          desiredPrefecture2: desiredPrefecture2 || undefined,
          desiredEmploymentType: desiredEmploymentType || undefined,
          desiredSalaryMin: desiredSalaryMin.trim() ? parseInt(desiredSalaryMin, 10) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.error?.includes("既に登録")) {
          setErrors({ candidateNumber: data.error });
        } else {
          setErrors({ form: data.error || "登録に失敗しました" });
        }
        return;
      }

      const createdCandidate = await res.json();

      // PDF自動解析で登録した場合、PDFを原本として保存
      if (pdfFile) {
        try {
          const uploadFormData = new FormData();
          uploadFormData.append("file", pdfFile);
          uploadFormData.append("category", "MEETING");
          await fetch(`/api/candidates/${createdCandidate.id}/files/upload`, {
            method: "POST",
            body: uploadFormData,
          });
        } catch {
          // PDF保存失敗は登録自体には影響させない
        }
      }

      toast.success("求職者を登録しました");
      onCreated();
      setCreatedCandidateId(createdCandidate.id);
      setCreatedCandidateName(normalizeName(candidateName));
      setSelectedStatus("BEFORE");
      setShowStatusDialog(true);
    } catch {
      setErrors({ form: "登録に失敗しました" });
    } finally {
      setLoading(false);
    }
  };

  const handleStatusSubmit = async () => {
    if (!createdCandidateId) return;
    setSavingStatus(true);
    try {
      await fetch(`/api/candidates/${createdCandidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportStatus: selectedStatus }),
      });
    } catch { /* ignore */ }
    finally { setSavingStatus(false); }
    setShowStatusDialog(false);
    handleClose();
    router.push(`/candidates/${createdCandidateId}`);
  };

  const handleStatusSkip = () => {
    setShowStatusDialog(false);
    handleClose();
    if (createdCandidateId) router.push(`/candidates/${createdCandidateId}`);
  };

  const STATUS_OPTIONS = [
    { value: "BEFORE", label: "支援前" },
    { value: "ACTIVE", label: "支援中" },
    { value: "WAITING", label: "待機" },
    { value: "ENDED", label: "支援終了" },
  ];

  const inputClass =
    "mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const errorInputClass =
    "mt-1 w-full rounded-md border border-red-400 px-3 py-2 text-[13px] focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

  // Show support status dialog
  if (showStatusDialog) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl max-w-sm w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[16px] font-bold text-[#374151] mb-2">支援状況を選択してください</h2>
          <p className="text-[13px] text-[#6B7280] mb-5">{createdCandidateName}さんの支援状況を設定してください</p>
          <div className="space-y-2 mb-5">
            {STATUS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                  selectedStatus === opt.value
                    ? "border-[#2563EB] bg-blue-50"
                    : "border-[#E5E7EB] hover:border-[#9CA3AF]"
                }`}
              >
                <input
                  type="radio"
                  name="supportStatus"
                  value={opt.value}
                  checked={selectedStatus === opt.value}
                  onChange={() => setSelectedStatus(opt.value)}
                  className="accent-[#2563EB]"
                />
                <span className="text-[14px] font-medium text-[#374151]">{opt.label}</span>
              </label>
            ))}
          </div>
          <button
            onClick={handleStatusSubmit}
            disabled={savingStatus}
            className="w-full rounded-md bg-[#2563EB] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
          >
            {savingStatus ? "設定中..." : "設定する"}
          </button>
          <button
            onClick={handleStatusSkip}
            className="w-full mt-2 text-center text-[13px] text-[#6B7280] hover:text-[#374151] py-1"
          >
            スキップ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={handleClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[16px] font-bold text-[#374151]">求職者を新規登録</h2>
          <button onClick={handleClose} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
        </div>

        {errors.form && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">{errors.form}</div>
        )}

        {/* PDF Upload Section */}
        <div className="mb-5 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-[13px] font-medium text-[#374151] mb-2">📄 WEB履歴書から自動入力（任意）</p>
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer relative ${pdfDragging ? "border-[#2563EB] bg-blue-50" : "border-gray-300 hover:border-[#2563EB]"}`}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragging(false); const f = e.dataTransfer.files[0]; if (f?.type === "application/pdf") setPdfFile(f); }}
            onClick={() => fileInputRef.current?.click()}
          >
            {pdfFile ? (
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-gray-700">📄 {pdfFile.name}</span>
                <button onClick={(e) => { e.stopPropagation(); setPdfFile(null); }} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
              </div>
            ) : (
              <p className="text-[13px] text-gray-400 pointer-events-none">{pdfDragging ? "ここにドロップ" : "PDFをドラッグ＆ドロップ、またはクリックして選択"}</p>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPdfFile(f); e.target.value = ""; }} />
          <button
            onClick={handleParseResume}
            disabled={!pdfFile || parsing}
            className="mt-2 w-full bg-purple-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {parsing ? "解析中..." : "✨ AI解析して自動入力"}
          </button>
        </div>

        {/* 基本情報 */}
        <h3 className="text-[14px] font-semibold text-[#374151] mb-3">基本情報</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">求職者番号 <span className="text-red-500">*</span></label>
              <input type="text" inputMode="numeric" placeholder="例: 5001234" maxLength={7} value={candidateNumber} onInput={(e) => setCandidateNumber((e.target as HTMLInputElement).value.replace(/\D/g, ""))} className={errors.candidateNumber ? errorInputClass : inputClass} />
              <p className="mt-0.5 text-[11px] text-[#6B7280]">※ 自動生成（編集可）</p>
              {errors.candidateNumber && <p className="text-red-500 text-xs mt-0.5">{errors.candidateNumber}</p>}
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">担当CA <span className="text-red-500">*</span></label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={errors.employeeId ? errorInputClass : inputClass}>
                <option value="">選択してください</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
              {errors.employeeId && <p className="text-red-500 text-xs mt-0.5">{errors.employeeId}</p>}
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">担当RC</label>
              <input type="text" placeholder="例: 藤本 なつみ" value={recruiterName} onChange={(e) => setRecruiterName(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">氏名 <span className="text-red-500">*</span></label>
              <input type="text" placeholder="例: 山田 太郎" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} className={errors.candidateName ? errorInputClass : inputClass} />
              {errors.candidateName && <p className="text-red-500 text-xs mt-0.5">{errors.candidateName}</p>}
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">フリガナ <span className="text-red-500">*</span></label>
              <input type="text" placeholder="例: ヤマダ タロウ" value={nameKana}
                onCompositionStart={() => setIsKanaComposing(true)}
                onCompositionEnd={(e) => { setIsKanaComposing(false); setNameKana(e.currentTarget.value.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))); }}
                onChange={(e) => setNameKana(isKanaComposing ? e.target.value : e.target.value.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)))}
                className={errors.nameKana ? errorInputClass : inputClass} />
              {errors.nameKana && <p className="text-red-500 text-xs mt-0.5">{errors.nameKana}</p>}
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">性別 <span className="text-red-500">*</span></label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={errors.gender ? errorInputClass : inputClass}>
                <option value="">選択してください</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
              </select>
              {errors.gender && <p className="text-red-500 text-xs mt-0.5">{errors.gender}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">生年月日</label>
              <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">年齢</label>
              <input type="text" value={calculateAge(birthday)} readOnly disabled placeholder="生年月日から自動計算" className="mt-1 w-full rounded-md border border-[#E5E7EB] bg-gray-50 px-3 py-2 text-[13px] text-gray-500" />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">電話番号</label>
              <input type="tel" placeholder="例: 08012345678" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">住所</label>
              <input type="text" placeholder="例: 埼玉県三郷市谷中" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">メールアドレス</label>
              <input type="email" placeholder="例: yamada@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className={errors.email ? errorInputClass : inputClass} />
              {errors.email && <p className="text-red-500 text-xs mt-0.5">{errors.email}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">配信日</label>
              <input type="date" value={scoutDeliveryDate} onChange={(e) => setScoutDeliveryDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">応募日</label>
              <input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">開放日/通常</label>
              <select value={masType} onChange={(e) => setMasType(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                <option value="開放日">開放日</option>
                <option value="通常">通常</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">スカウトNO</label>
              <input type="text" value={scoutNumber} onChange={(e) => setScoutNumber(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">経路</label>
              <select value={applicationRoute} onChange={(e) => setApplicationRoute(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">媒体</label>
              <select value={mediaSource} onChange={(e) => setMediaSource(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                {MEDIA_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* 希望条件 */}
        <h3 className="text-[14px] font-semibold text-[#374151] mt-5 mb-3 pt-4 border-t border-gray-200">希望条件</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望職種（第1希望）</label>
              <input type="text" placeholder="例: 営業事務" value={desiredJobType1} onChange={(e) => setDesiredJobType1(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望職種（第2希望）</label>
              <input type="text" placeholder="例: 一般事務" value={desiredJobType2} onChange={(e) => setDesiredJobType2(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望業種（第1希望）</label>
              <input type="text" value={desiredIndustry1} onChange={(e) => setDesiredIndustry1(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望業種（第2希望）</label>
              <input type="text" value={desiredIndustry2} onChange={(e) => setDesiredIndustry2(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望勤務地（第1希望）</label>
              <select value={desiredPrefecture1} onChange={(e) => setDesiredPrefecture1(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                {REGIONS.map((region) => (
                  <optgroup key={region.name} label={region.name}>
                    {region.prefectures.map((pref) => <option key={pref} value={pref}>{pref}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望勤務地（第2希望）</label>
              <select value={desiredPrefecture2} onChange={(e) => setDesiredPrefecture2(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                {REGIONS.map((region) => (
                  <optgroup key={region.name} label={region.name}>
                    {region.prefectures.map((pref) => <option key={pref} value={pref}>{pref}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望雇用形態</label>
              <select value={desiredEmploymentType} onChange={(e) => setDesiredEmploymentType(e.target.value)} className={inputClass}>
                <option value="">選択してください</option>
                {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[13px] font-medium text-[#374151]">希望年収（万円）</label>
              <input type="number" min="0" placeholder="例: 450" value={desiredSalaryMin} onChange={(e) => setDesiredSalaryMin(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3 justify-end">
          <button onClick={handleClose} className="rounded-md border border-[#E5E7EB] px-5 py-2.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA] transition-colors">キャンセル</button>
          <button onClick={handleSubmit} disabled={loading} className="rounded-md bg-[#2563EB] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors">
            {loading ? "登録中..." : "登録する"}
          </button>
        </div>
      </div>
    </div>
  );
}
