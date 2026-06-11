"use client";

import { useEffect, useRef, useState } from "react";
import { mergeEmptyOnly } from "./resume-ai-merge";

// T-098: 履歴書・入社書類を /api/admin/employees/{employeeId}/parse-resume に送り、
// 返却JSON のうち allowedKeys に含まれ、かつ「現在の form 値が空のフィールドのみ」を setForm でマージする。
// 空欄のみマージのため、人が編集した値を AI が上書きすることはない。

type FormShape = Record<string, string>;

/** ボタン経路: 単一ファイルを選んで自タブの allowedKeys だけ空欄マージする。 */
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
      fd.append("files", file);
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
        const r = mergeEmptyOnly(prev, data, allowedKeys);
        filled = r.filled;
        return r.next;
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

/**
 * D&D経路: 親（EmployeeDetailClient）が1回の解析で取得した aiFillData を各タブへ配布する。
 * aiFillData の参照が変わったとき（＝新しいドロップ）と、aiFillData を持った状態でタブが
 * マウントされたとき（＝ドロップ後に別タブを開いた）に、自タブの allowedKeys だけ空欄マージする。
 * 同一参照では再マージしない。
 */
export function useAiFillData<T extends FormShape>(
  aiFillData: Record<string, unknown> | null | undefined,
  setForm: React.Dispatch<React.SetStateAction<T>>,
  allowedKeys: readonly (keyof T & string)[],
) {
  const appliedRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  const [filledCount, setFilledCount] = useState<number | null>(null);

  useEffect(() => {
    if (!aiFillData) return;
    if (appliedRef.current === aiFillData) return;
    appliedRef.current = aiFillData;
    let filled = 0;
    setForm((prev) => {
      const r = mergeEmptyOnly(prev, aiFillData, allowedKeys);
      filled = r.filled;
      return r.next;
    });
    setFilledCount(filled);
  }, [aiFillData, setForm, allowedKeys]);

  return { filledCount };
}
