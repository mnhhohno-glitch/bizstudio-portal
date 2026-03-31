"use client";

import { useState } from "react";

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
}

function normalizeName(name: string): string {
  return name.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

export default function CandidateRegistrationModal({
  isOpen,
  onClose,
  employees,
  onCreated,
}: CandidateRegistrationModalProps) {
  const [candidateNumber, setCandidateNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [gender, setGender] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const handleClose = () => {
    setCandidateNumber("");
    setCandidateName("");
    setNameKana("");
    setGender("");
    setEmployeeId("");
    setErrors({});
    onClose();
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!candidateNumber.trim()) {
      next.candidateNumber = "求職者番号を入力してください";
    } else if (!/^5\d{6}$/.test(candidateNumber.trim())) {
      next.candidateNumber =
        "求職者番号は5から始まる7桁の数字で入力してください";
    }

    if (!candidateName.trim()) {
      next.candidateName = "氏名を入力してください";
    }

    if (!nameKana.trim()) {
      next.nameKana = "フリガナを入力してください";
    }

    if (!gender) {
      next.gender = "性別を選択してください";
    }

    if (!employeeId) {
      next.employeeId = "担当キャリアアドバイザーを選択してください";
    }

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
          gender,
          employeeId,
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

      handleClose();
      onCreated();
    } catch {
      setErrors({ form: "登録に失敗しました" });
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const errorInputClass =
    "mt-1 w-full rounded-md border border-red-400 px-3 py-2.5 text-[14px] focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500";

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl max-w-lg w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[16px] font-bold text-[#374151]">
            求職者を新規登録
          </h2>
          <button
            onClick={handleClose}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {errors.form && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
            {errors.form}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-[13px] font-medium text-[#374151]">
              求職者番号 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="例: 5001234"
              maxLength={7}
              value={candidateNumber}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value.replace(
                  /\D/g,
                  ""
                );
                setCandidateNumber(v);
              }}
              className={errors.candidateNumber ? errorInputClass : inputClass}
            />
            <p className="mt-1 text-[11px] text-[#6B7280]">
              ※ 5から始まる7桁の数字
            </p>
            {errors.candidateNumber && (
              <p className="text-red-500 text-xs mt-1">
                {errors.candidateNumber}
              </p>
            )}
          </div>

          <div>
            <label className="text-[13px] font-medium text-[#374151]">
              氏名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="例: 山田 太郎"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              className={errors.candidateName ? errorInputClass : inputClass}
            />
            <p className="mt-1 text-[11px] text-[#6B7280]">
              ※ 姓と名の間にスペースを入れてください
            </p>
            {errors.candidateName && (
              <p className="text-red-500 text-xs mt-1">
                {errors.candidateName}
              </p>
            )}
          </div>

          <div>
            <label className="text-[13px] font-medium text-[#374151]">
              フリガナ <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="例: ヤマダ タロウ"
              value={nameKana}
              onChange={(e) => setNameKana(e.target.value.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)))}
              className={errors.nameKana ? errorInputClass : inputClass}
            />
            {errors.nameKana && (
              <p className="text-red-500 text-xs mt-1">{errors.nameKana}</p>
            )}
          </div>

          <div>
            <label className="text-[13px] font-medium text-[#374151]">
              性別 <span className="text-red-500">*</span>
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={errors.gender ? errorInputClass : inputClass}
            >
              <option value="">選択してください</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
            {errors.gender && (
              <p className="text-red-500 text-xs mt-1">{errors.gender}</p>
            )}
          </div>

          <div>
            <label className="text-[13px] font-medium text-[#374151]">
              担当キャリアアドバイザー <span className="text-red-500">*</span>
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={errors.employeeId ? errorInputClass : inputClass}
            >
              <option value="">選択してください</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            {errors.employeeId && (
              <p className="text-red-500 text-xs mt-1">{errors.employeeId}</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={handleClose}
            className="rounded-md border border-[#E5E7EB] px-5 py-2.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA] transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-md bg-[#2563EB] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
          >
            {loading ? "登録中..." : "登録する"}
          </button>
        </div>
      </div>
    </div>
  );
}
