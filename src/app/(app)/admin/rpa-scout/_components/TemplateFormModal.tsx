"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import {
  TEMPLATE_EXCEL_NOTE,
  TEMPLATE_KIND_OPTIONS,
  TEMPLATE_MERGE_TAGS,
} from "@/lib/rpa-scout/constants";
import type { RpaTemplate } from "./types";
import { CopyFallbackModal, useCopyText } from "./CopyText";

// パターンフォームと同じ薄青の帯でセクションを区切る
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="border-y border-[#BFDBFE] bg-[#EFF6FF] px-5 py-1.5 text-[13px] font-bold text-[#1E3A8A]">
        {title}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

// メールテンプレートの新規作成／編集。
// mode="duplicate" は複製元の内容を初期値に持つ新規作成（複製元は書き換えない）
export default function TemplateFormModal({
  template,
  mode,
  existingTemplates,
  onClose,
  onSaved,
}: {
  template: RpaTemplate | null; // null=新規
  mode: "new" | "edit" | "duplicate";
  existingTemplates: RpaTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  const { copy, fallback, closeFallback } = useCopyText();
  const isEdit = mode === "edit";

  const [kind, setKind] = useState<string>(template?.kind ?? "UNSENT");
  const [name, setName] = useState<string>(
    mode === "duplicate" ? `${template?.name ?? ""}のコピー` : (template?.name ?? "")
  );
  const [subject, setSubject] = useState<string>(template?.subject ?? "");
  const [body, setBody] = useState<string>(template?.body ?? "");
  const [saving, setSaving] = useState(false);

  const excludeId = isEdit ? template?.id : undefined;
  const duplicateExists = useMemo(
    () =>
      name.trim() !== "" &&
      existingTemplates.some((t) => t.isActive && t.name === name.trim() && t.id !== excludeId),
    [existingTemplates, name, excludeId]
  );

  const save = async () => {
    if (!kind) return toast.error("種別を選択してください");
    if (!name.trim()) return toast.error("テンプレ名を入力してください");
    if (!subject.trim()) return toast.error("件名を入力してください");
    if (!body.trim()) return toast.error("本文を入力してください");

    setSaving(true);
    const res = await fetch(
      isEdit ? `/api/rpa-scout/templates/${template!.id}` : "/api/rpa-scout/templates",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: name.trim(), subject: subject.trim(), body }),
      }
    );
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      if (data.duplicateWarning) toast.warning("同名のテンプレートが既に存在します（保存済み）");
      else toast.success(isEdit ? "保存しました" : "作成しました");
      onSaved();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "保存に失敗しました");
    }
  };

  const label = "mb-1 block text-[12px] font-semibold text-[#6B7280]";
  const inputCls = "w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[14px]";
  const copyBtn =
    "rounded-[6px] border border-[#D1D5DB] px-2 py-0.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      {...overlayClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#374151]">
              {mode === "duplicate"
                ? "テンプレート新規作成（複製）"
                : isEdit
                  ? "テンプレート編集"
                  : "テンプレート新規作成"}
            </h2>
            {mode === "duplicate" && template && (
              <div className="mt-0.5 text-[11px] text-[#6B7280]">複製元: {template.name}</div>
            )}
          </div>
          <button onClick={onClose} className="text-xl text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        {duplicateExists && (
          <div className="border-b bg-[#FFFBEB] px-5 py-2 text-[12px] font-medium text-[#D97706]">
            ⚠ 同名のテンプレートが既に存在します（保存は可能です）
          </div>
        )}

        <div className="flex-1 overflow-y-auto pb-2">
          <Section title="基本">
            <div>
              <label className={label}>種別</label>
              <div className="flex gap-4 pt-1">
                {TEMPLATE_KIND_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-[14px]">
                    <input
                      type="radio"
                      name="templateKind"
                      checked={kind === o.value}
                      onChange={() => setKind(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>テンプレ名（必須）</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 【未送信用】口コミ4.9オーダーメイド"
                className={inputCls}
              />
            </div>
          </Section>

          <Section title="メール内容">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={`${label} mb-0`}>件名（必須）</label>
                <button onClick={() => copy(subject, "件名")} className={copyBtn}>
                  件名をコピー
                </button>
              </div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="例: ≪口コミ評価4.9★≫経験を活かすオーダーメイド転職サポート"
                className={inputCls}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={`${label} mb-0`}>本文（必須）</label>
                <button onClick={() => copy(body, "本文")} className={copyBtn}>
                  本文をコピー
                </button>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                placeholder="改行はそのまま保存されます"
                className={`${inputCls} min-h-[280px] resize-y whitespace-pre-wrap leading-relaxed`}
              />
              <div className="mt-2 rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                <div className="mb-1 text-[12px] font-semibold text-[#374151]">差し込みタグ</div>
                <ul className="space-y-0.5 text-[12px] text-[#4B5563]">
                  {TEMPLATE_MERGE_TAGS.map((t) => (
                    <li key={t.tag}>
                      <code className="rounded bg-[#E5E7EB] px-1 font-mono">{t.tag}</code>{" "}
                      … {t.desc}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 text-[11px] text-[#B45309]">
                  これらのタグはRPA側で自動置換されます。表記を変えると置換されなくなるため、そのままの形で使ってください。
                </div>
              </div>
              <div className="mt-2 text-[11px] text-[#6B7280]">{TEMPLATE_EXCEL_NOTE}</div>
            </div>
          </Section>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {fallback && (
        <CopyFallbackModal
          title={fallback.title}
          text={fallback.text}
          onClose={closeFallback}
        />
      )}
    </div>
  );
}
