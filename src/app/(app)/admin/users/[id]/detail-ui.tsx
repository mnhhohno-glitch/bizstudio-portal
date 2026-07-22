"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { patchEmployeeSection } from "./detail-types";

// T-096 タブ共通 UI（FileMaker 参考デザイン）。
// 入力欄は下線スタイルに統一。textarea のみ枠ありを維持。
//
// T-096 追補（自動保存化）:
//  - テキスト・日付・数値・textarea は onBlur で保存、select は onChange で即保存する。
//  - 保存は既存 API（PATCH /api/admin/employees/[employeeId]{section,data}）にフィールド単位で
//    部分更新を投げる（buildXxxData がホワイトリスト方式で「送られたキーだけ」を書き換えるため安全）。
//  - 保存ボタン・キャンセルボタンは撤去し、AutoSaveIndicator で控えめに状態表示する。

// 下線スタイル: 枠なし・下線のみ・透明背景・フォーカス時に青下線。
const UNDERLINE_INPUT_CLASS =
  "w-full border-0 border-b border-gray-300 rounded-none px-0 py-1 text-[13px] bg-transparent focus:ring-0 focus:border-blue-600 focus:outline-none";

const TEXTAREA_CLASS =
  "w-full rounded border border-gray-300 px-3 py-2 text-[13px] bg-white focus:border-blue-600 focus:outline-none focus:ring-0 resize-y";

export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={UNDERLINE_INPUT_CLASS}
    />
  );
}

export function DateInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={UNDERLINE_INPUT_CLASS}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={UNDERLINE_INPUT_CLASS}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={UNDERLINE_INPUT_CLASS}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  onBlur?: () => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={rows}
      className={TEXTAREA_CLASS}
    />
  );
}

/** 読み取り専用の自動計算欄（在籍年数・支給総額など）。下線を薄く・文字色を薄く。 */
export function ReadOnlyField({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full border-0 border-b border-gray-200 px-0 py-1 text-[13px] text-gray-500 bg-transparent">
      {children}
    </div>
  );
}

/** タブ内のブロック見出し。 */
export function BlockTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-medium text-gray-400 mb-2.5">{children}</h4>
  );
}

// ---- 自動保存 ----

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export type EmployeeSection = "basic" | "bank" | "insurance" | "salary" | "equipment";

/**
 * フィールド単位の保存を汎用の save 関数で行う自動保存フック。
 * - `saveFn(field, value)` は「そのフィールドをサーバへ書き込む」実装。空欄→クリアもサーバ側で処理される。
 * - 直前保存値と一致していれば no-op（同値多重発火のガード）。
 * - 保存はキュー化され、同一フィールドの多重リクエストは順次実行される。
 * - 保存成功時は 1.5s だけ「保存しました」を表示して idle に戻る。
 */
export function useAutoSave(
  saveFn: (field: string, value: unknown) => Promise<void>,
  initial: Record<string, unknown>,
): {
  save: (field: string, value: unknown) => void;
  status: AutoSaveStatus;
  error: string | null;
} {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<Record<string, unknown>>({ ...initial });
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const save = useCallback(
    (field: string, value: unknown) => {
      if (savedRef.current[field] === value) return;
      queueRef.current = queueRef.current.then(async () => {
        if (savedRef.current[field] === value) return;
        setStatus("saving");
        setError(null);
        try {
          await saveFn(field, value);
          savedRef.current[field] = value;
          setStatus("saved");
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => {
            setStatus((s) => (s === "saved" ? "idle" : s));
          }, 1500);
        } catch (e) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "保存に失敗しました");
        }
      });
    },
    [saveFn],
  );

  return { save, status, error };
}

/**
 * 社員詳細の section 単位（basic/bank/insurance/salary/equipment）に投げる自動保存フック。
 * 既存の PATCH /api/admin/employees/[employeeId] にフィールド単位の部分更新を投げる。
 */
export function useSectionAutoSave(
  employeeId: string,
  section: EmployeeSection,
  initial: Record<string, unknown>,
) {
  const saveFn = useCallback(
    (field: string, value: unknown) => patchEmployeeSection(employeeId, section, { [field]: value }),
    [employeeId, section],
  );
  return useAutoSave(saveFn, initial);
}

/** 保存状態を控えめに表示する小型インジケータ（旧「保存」ボタン位置に置く）。 */
export function AutoSaveIndicator({
  status,
  error,
}: {
  status: AutoSaveStatus;
  error: string | null;
}) {
  if (status === "saving") {
    return <span className="text-[11px] text-gray-400">保存中...</span>;
  }
  if (status === "saved") {
    return <span className="text-[11px] text-green-600">✓ 保存しました</span>;
  }
  if (status === "error" && error) {
    return <span className="text-[11px] text-red-600">{error}</span>;
  }
  return null;
}

// ---- 続柄セレクト ----

/** 緊急連絡先・扶養家族の続柄で使う固定選択肢（この順で固定）。 */
export const RELATION_OPTIONS = [
  "配偶者",
  "父",
  "母",
  "子",
  "兄",
  "姉",
  "弟",
  "妹",
  "祖父",
  "祖母",
  "叔父",
  "叔母",
  "その他",
] as const;

const RELATION_SET = new Set<string>(RELATION_OPTIONS);

/**
 * 続柄セレクト。
 * - 現在値が固定リスト外なら「◯◯（現在値）」を最上位オプションとして残す（既存値を勝手に消さない）。
 * - 未設定用の空値も選べる。
 */
export function RelationSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const currentIsCustom = value.length > 0 && !RELATION_SET.has(value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={UNDERLINE_INPUT_CLASS}
    >
      <option value="">未設定</option>
      {currentIsCustom && <option value={value}>{value}（現在値）</option>}
      {RELATION_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

// ---- 郵便番号 → 住所 表示ボタン ----

/**
 * 「住所表示」ボタン。
 * - クリック時のみ /api/masters/postal-code で検索し、住所フィールドを上書きする。
 * - 郵便番号未入力・0件は住所を変更せず、控えめなメッセージだけ出す。
 * - 複数件ある場合は候補を返すので、呼び出し側でドロップダウン表示を行う。
 * - 反映後の再検索は起きない（旧: onFocus/onChange/onBlur 発火の自動検索を撤去した）。
 */
export function AddressLookupButton({
  postalCode,
  onResolved,
}: {
  postalCode: string;
  onResolved: (result: { address?: string; candidates?: string[]; message?: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    const code = postalCode.replace(/\D/g, "");
    if (code.length < 7) {
      setMessage("郵便番号は7桁で入力してください");
      onResolved({ message: "郵便番号は7桁で入力してください" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/masters/postal-code/${code}`);
      if (!res.ok) {
        const msg = "住所が見つかりませんでした";
        setMessage(msg);
        onResolved({ message: msg });
        return;
      }
      const j = await res.json();
      const matches: string[] = (j?.matches ?? []).map(
        (m: { address: string }) => m.address,
      );
      if (matches.length === 1) {
        onResolved({ address: matches[0] });
      } else if (matches.length > 1) {
        onResolved({ candidates: matches });
      } else {
        const msg = "住所が見つかりませんでした";
        setMessage(msg);
        onResolved({ message: msg });
      }
    } catch {
      const msg = "住所検索に失敗しました";
      setMessage(msg);
      onResolved({ message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
      >
        {loading ? "検索中..." : "住所表示"}
      </button>
      {message && <span className="text-[11px] text-gray-500">{message}</span>}
    </div>
  );
}

/**
 * T-098: 履歴書AI読み取りボタン＋隠しファイルinput。
 * useResumeAiFill から返る ref/openPicker/handleFile/loading/error/filledCount を受け取り、
 * 控えめなアウトラインボタン＋小さな状態メッセージを描画する。
 */
export function ResumeAiButton({
  inputRef,
  openPicker,
  handleFile,
  loading,
  error,
  filledCount,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  openPicker: () => void;
  handleFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading: boolean;
  error: string | null;
  filledCount: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={openPicker}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2.5 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:opacity-50"
      >
        {loading ? "解析中…" : "履歴書・書類をAI読み取り"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/jpg,image/webp,image/heic"
        onChange={handleFile}
        className="hidden"
      />
      {filledCount !== null && !loading && !error && (
        <span className="text-[11px] text-green-600">
          {filledCount > 0 ? `${filledCount} 件を仮入力しました（空欄のみ）` : "新たに埋まる空欄はありませんでした"}
        </span>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
