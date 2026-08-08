"use client";

import { fmtJstShortDateTime, isRecentlyUsed, type RpaPattern } from "./types";

// 選択中パターンの最終使用（全号機横断）。native <option> は文字列の一部だけ着色できないため、
// プルダウン直下に出す注記側で日時部分を赤系にする
export default function LastUsedNote({ pattern }: { pattern: RpaPattern | undefined }) {
  if (!pattern) return null;

  if (!pattern.lastUsedAt) {
    return <div className="mt-1 text-[12px] text-[#6B7280]">最終使用: 未使用</div>;
  }

  const recent = isRecentlyUsed(pattern.lastUsedAt);
  return (
    <div className="mt-1 text-[12px] text-[#6B7280]">
      最終使用:{" "}
      <span className={recent ? "font-semibold text-red-600" : "text-[#374151]"}>
        {fmtJstShortDateTime(pattern.lastUsedAt)}
      </span>
      {pattern.lastUsedMachineNo != null && ` ${pattern.lastUsedMachineNo}号機`}
      {recent && <span className="ml-1 text-red-600">（3日以内に使用）</span>}
    </div>
  );
}
