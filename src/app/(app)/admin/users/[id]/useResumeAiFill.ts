"use client";

import { useRef, useState } from "react";

// T-098: 履歴書・入社書類を /api/admin/employees/{employeeId}/parse-resume に送り、
// 返却JSON のうち allowedKeys に含まれ、かつ「現在の form 値が空のフィールドのみ」を setForm でマージする。
// 空欄のみマージのため、人が編集した値を AI が上書きすることはない。

type FormShape = Record<string, string>;

export function useResumeAiFill<T extends FormShape>(
  employeeId: string,
  setForm: React.Dispatch<React.SetStateAction<T>>,
  allowedKeys: readonly (keyof T & string)[],
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState<number | null>(null);

  const openPicker = () => {
    setError(null);
    setFilledCount(null);
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを連続選択できるよう input を毎回リセット
    e.target.value = "";
    if (!file) return;
    setLoading(true);
    setError(null);
    setFilledCount(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/employees/${employeeId}/parse-resume`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `エラー ${res.status}`);
      }
      const data: Record<string, unknown> = await res.json();

      let filled = 0;
      setForm((prev) => {
        const next = { ...prev };
        for (const key of allowedKeys) {
          // 空欄のみマージ: 現在の値が空文字 or 空白のみのときに限る
          const cur = (prev[key] ?? "").toString();
          if (cur.trim() !== "") continue;
          const v = data[key];
          if (typeof v === "string" && v.trim() !== "") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (next as any)[key] = v;
            filled++;
          }
        }
        return next;
      });
      setFilledCount(filled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI解析に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return { inputRef, openPicker, handleFile, loading, error, filledCount };
}
