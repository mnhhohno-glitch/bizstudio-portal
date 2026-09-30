"use client";

// T-208 step4: 「面談スクリプト」タブを開いているときの、求職者の上部表示（1行の小さな表示）。
// 名前・フリガナ・求職者ID・年齢/性別・支援状況・応募経路・担当CA だけを1行に並べ、下（スクリプト＋面談準備）を広く取る。
// 編集や操作ボタンは持たない（それらは「基本」タブの CandidateHeader）。

import { SUPPORT_STATUS_LABEL } from "@/lib/support-status-constants";

type Props = {
  candidate: {
    name: string;
    nameKana: string | null;
    candidateNumber: string;
    gender: string | null;
    birthday: string | null;
    supportStatus: string;
    supportSubStatus: string | null;
    applicationRoute: string | null;
    employee: { name: string } | null;
  };
};

function calcAge(bd: string | null): number | null {
  if (!bd) return null;
  const today = new Date();
  const birth = new Date(bd);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function CandidateCompactHeader({ candidate }: Props) {
  const age = calcAge(candidate.birthday);
  const statusLabel = SUPPORT_STATUS_LABEL[candidate.supportStatus] ?? candidate.supportStatus;
  const status = candidate.supportSubStatus && candidate.supportSubStatus !== statusLabel ? `${statusLabel} / ${candidate.supportSubStatus}` : statusLabel;
  const ageGender = [age != null ? `${age}歳` : null, candidate.gender || null].filter(Boolean).join("・");
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap bg-white border border-gray-200 rounded-lg px-4 py-2 mb-3 text-[12px] text-gray-600">
      <span className="text-[15px] font-semibold text-gray-900">{candidate.name}</span>
      {candidate.nameKana && <span className="text-gray-400">{candidate.nameKana}</span>}
      <span className="font-mono text-gray-500">{candidate.candidateNumber}</span>
      {ageGender && <span>{ageGender}</span>}
      <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[11px]">{status}</span>
      {candidate.applicationRoute && <span>経路: {candidate.applicationRoute}</span>}
      <span>担当CA: {candidate.employee?.name || "-"}</span>
    </div>
  );
}
