"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeEmptyOnly } from "./resume-ai-merge";

// T-098: 履歴書・入社書類を /api/admin/employees/{employeeId}/parse-resume に送り、
// 返却JSON のうち allowedKeys に含まれ、かつ「現在の form 値が空のフィールドのみ」を setForm でマージする。
// 空欄のみマージのため、人が編集した値を AI が上書きすることはない。
//
// T-098 追補2（未保存バグ修正）:
//  (1) 各タブの保存は onBlur/onChange 起点の自動保存なので、AI が setForm しただけのフィールドは
//      人がその欄を触らない限り一度も保存されない（＝画面を開き直すと消える）。埋めたキーを
//      pendingKeys として返し、タブ側が「未保存です」バー＋保存ボタンを出せるようにする。
//      自動保存はしない（AI の誤読をそのまま DB に入れないための既存設計を維持）。
//  (2) マージ判定は formRef（現在値）を直接読む。旧実装は setForm の updater 内で件数を数えて
//      直後に setFilledCount していたため、updater が遅延実行されると件数が 0 のまま読まれ、
//      実際は埋まっているのに「新たに埋まる空欄はありませんでした」と出ていた。

type FormShape = Record<string, string>;

/** 判定済みキーだけを現在の form に上書きする（他フィールドの同時編集を壊さない）。 */
function applyKeys<T extends FormShape>(
  setForm: React.Dispatch<React.SetStateAction<T>>,
  next: T,
  filledKeys: string[],
) {
  if (filledKeys.length === 0) return;
  setForm((f) => {
    const merged = { ...f };
    for (const k of filledKeys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[k] = (next as any)[k];
    }
    return merged;
  });
}

/** ボタン経路: 単一ファイルを選んで自タブの allowedKeys だけ空欄マージする。 */
export function useResumeAiFill<T extends FormShape>(
  employeeId: string,
  setForm: React.Dispatch<React.SetStateAction<T>>,
  allowedKeys: readonly (keyof T & string)[],
  formRef: React.RefObject<T>,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const clearPending = useCallback(() => setPendingKeys([]), []);

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

      const r = mergeEmptyOnly(formRef.current, data, allowedKeys);
      applyKeys(setForm, r.next, r.filledKeys);
      setFilledCount(r.filled);
      // 既存の未保存キーと合流（AI読み取りを複数回押した場合）
      if (r.filledKeys.length > 0) {
        setPendingKeys((prev) => Array.from(new Set([...prev, ...r.filledKeys])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI解析に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return { inputRef, openPicker, handleFile, loading, error, filledCount, pendingKeys, clearPending };
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
  formRef: React.RefObject<T>,
) {
  const appliedRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const clearPending = useCallback(() => setPendingKeys([]), []);

  useEffect(() => {
    if (!aiFillData) return;
    if (appliedRef.current === aiFillData) return;
    appliedRef.current = aiFillData;
    const r = mergeEmptyOnly(formRef.current, aiFillData, allowedKeys);
    applyKeys(setForm, r.next, r.filledKeys);
    setFilledCount(r.filled);
    if (r.filledKeys.length > 0) {
      setPendingKeys((prev) => Array.from(new Set([...prev, ...r.filledKeys])));
    }
  }, [aiFillData, setForm, allowedKeys, formRef]);

  return { filledCount, pendingKeys, clearPending };
}
