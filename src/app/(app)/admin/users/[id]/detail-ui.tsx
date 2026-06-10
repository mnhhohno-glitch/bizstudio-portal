"use client";

// T-096 タブ共通 UI（FileMaker 参考デザイン）。
// 入力欄は下線スタイルに統一。textarea のみ枠ありを維持。

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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={UNDERLINE_INPUT_CLASS}
    />
  );
}

export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={UNDERLINE_INPUT_CLASS}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
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

/** 保存／キャンセルを並べる共通フッタ。border-t の上で右寄せ。 */
export function SaveBar({
  saving,
  error,
  saved,
  onSave,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  saved: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mt-6 pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
      {saved && <span className="text-[12px] text-green-600">保存しました</span>}
      {error && <span className="text-[12px] text-red-600">{error}</span>}
      {onCancel && (
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-1.5 text-[12px] text-slate-700 hover:bg-gray-50 disabled:opacity-50"
        >
          キャンセル
        </button>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={onSave}
        className="rounded bg-blue-700 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
      >
        {saving ? "保存中..." : "保存"}
      </button>
    </div>
  );
}

/** タブ内のブロック見出し。 */
export function BlockTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-medium text-gray-400 mb-2.5">{children}</h4>
  );
}
