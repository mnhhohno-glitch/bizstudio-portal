"use client";

// T-207: 配信テンプレートの新規作成・編集モーダル。
// テンプレート番号（T-001）は自動採番なので表示のみ（入力欄を置かない）。
// 本文は複数行のまま保持する（改行をそのまま DB に入れ、RPA へ原文で渡す）。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { MERGE_TAGS, TEMPLATE_KINDS, TEMPLATE_SUBJECT_LIMIT, templateKindLabel } from "@/lib/scout-conditions/constants";
import type { TemplateDto } from "@/lib/scout-conditions/types";
import { HighlightedText } from "../../conditions/_components/TemplatePreview";

const INPUT = "w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] text-[#374151]";
const SELECT = "rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151]";

export type TemplateModalMode = { kind: "new" } | { kind: "edit"; template: TemplateDto };

type Form = { kind: string; name: string; subject: string; body: string; isActive: boolean };

function toForm(mode: TemplateModalMode): Form {
  if (mode.kind === "new") return { kind: "UNSENT", name: "", subject: "", body: "", isActive: true };
  const t = mode.template;
  return { kind: t.kind, name: t.name, subject: t.subject, body: t.body, isActive: t.isActive };
}

export default function TemplateModal({
  mode,
  onClose,
  onSaved,
}: {
  mode: TemplateModalMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(() => toForm(mode));
  const [saving, setSaving] = useState(false);
  const overlayClose = useOverlayClose(onClose);

  const modeKey = mode.kind === "new" ? "new" : mode.template.id;
  const [loadedKey, setLoadedKey] = useState(modeKey);
  useEffect(() => {
    if (loadedKey !== modeKey) {
      setForm(toForm(mode));
      setLoadedKey(modeKey);
    }
  }, [modeKey, loadedKey, mode]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // 件名は「社名を差し込んだ後」の長さで定型文に落ちるため、ここでの文字数はあくまで目安
  const subjectLen = useMemo(() => [...form.subject].length, [form.subject]);
  const subjectOver = subjectLen > TEMPLATE_SUBJECT_LIMIT;

  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) return toast.error("テンプレート名を入力してください");
    if (!form.subject.trim()) return toast.error("件名を入力してください");
    if (!form.body.trim()) return toast.error("本文を入力してください");
    setSaving(true);
    try {
      const url = mode.kind === "new" ? "/api/scout/templates" : `/api/scout/templates/${mode.template.id}`;
      const res = await fetch(url, {
        method: mode.kind === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? "保存に失敗しました");
        return;
      }
      toast.success(mode.kind === "new" ? "テンプレートを作成しました" : "テンプレートを保存しました");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" {...overlayClose}>
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[980px] flex-col rounded-[10px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
          <div className="flex items-center gap-3">
            {mode.kind === "edit" ? (
              <>
                <span className="rounded bg-[#111827] px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wide text-white">
                  {mode.template.templateNo ?? "-"}
                </span>
                <span className="text-[15px] font-semibold text-[#374151]">テンプレートの編集</span>
              </>
            ) : (
              <>
                <span className="rounded bg-[#111827] px-2 py-0.5 text-[13px] font-semibold tracking-wide text-white">新規</span>
                <span className="text-[15px] font-semibold text-[#374151]">テンプレート</span>
                <span className="text-[12px] text-[#6B7280]">番号は保存時に「T-001」形式で自動採番されます</span>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
            閉じる ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-3">
          {/* 差し込みの案内。RPA が1人ごとに置換するため、ここでは原文のまま書く */}
          <div className="rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[12px] leading-relaxed text-[#1E40AF]">
            <div className="font-semibold">差し込み項目は件名・本文のどちらにも書けます</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {MERGE_TAGS.map((t) => (
                <span key={t.tag} className={`rounded px-1 font-medium ${t.className}`}>
                  {t.tag}
                </span>
              ))}
              <span className="ml-1 text-[#1E3A8A]">
                の4種類。配信するときに RPA が1人ごとの値へ置き換えます（ここでは置き換えずそのまま保存されます）。
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <label className="pt-2 text-[12px] font-semibold text-[#374151]">テンプレート番号</label>
            <div className="text-[13px] text-[#6B7280]">
              <span className="font-mono">{mode.kind === "edit" ? (mode.template.templateNo ?? "-") : "保存時に自動採番"}</span>
              <span className="ml-2 text-[11px]">（自動採番のため変更できません。削除しても後続の番号は振り直しません）</span>
            </div>

            <label className="pt-2 text-[12px] font-semibold text-[#374151]">種別</label>
            <div>
              <select className={SELECT} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                {TEMPLATE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="pt-2 text-[12px] font-semibold text-[#374151]">テンプレート名</label>
            <div>
              <input
                className={INPUT}
                value={form.name}
                placeholder="【未送信用】まずはキャリア相談から"
                onChange={(e) => set("name", e.target.value)}
              />
              <div className="mt-1 text-[10px] text-[#6B7280]">CSV 取り込みではこの名前をキーに上書きします</div>
            </div>

            <label className="pt-2 text-[12px] font-semibold text-[#374151]">件名</label>
            <div>
              <input className={INPUT} value={form.subject} onChange={(e) => set("subject", e.target.value)} />
              <div className={`mt-1 text-[11px] ${subjectOver ? "font-semibold text-[#B91C1C]" : "text-[#6B7280]"}`}>
                {subjectLen} / {TEMPLATE_SUBJECT_LIMIT} 文字
                {subjectOver
                  ? "　※この長さだとマイナビ側の定型文で送信されます（[社名] を差し込んだ後の長さで判定されます）"
                  : "　※[社名] を差し込んだ後の長さが50文字を超えると定型文で送信されます"}
              </div>
            </div>

            <label className="pt-2 text-[12px] font-semibold text-[#374151]">本文</label>
            <div>
              <textarea
                className={`${INPUT} min-h-[320px] whitespace-pre-wrap font-mono leading-relaxed`}
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
              />
              <div className="mt-1 text-[10px] text-[#6B7280]">改行はそのまま保存され、RPA へも原文のまま渡されます</div>
            </div>

            <label className="pt-2 text-[12px] font-semibold text-[#374151]">有効</label>
            <div className="pt-1">
              <label className="inline-flex items-center gap-2 text-[13px] text-[#374151]">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                配信条件の選択肢に出す
              </label>
            </div>
          </div>

          {/* プレビュー（差し込みを色分けして、置換前の状態が分かるようにする） */}
          <div>
            <div className="mb-1 text-[12px] font-semibold text-[#374151]">プレビュー</div>
            <div className="rounded-[6px] border border-[#E5E7EB] bg-[#FAFAFA]">
              <div className="border-b border-[#E5E7EB] px-3 py-2">
                <div className="text-[11px] text-[#6B7280]">
                  {templateKindLabel(form.kind)}｜{form.name || "（名称未入力）"}
                </div>
                <div className="mt-1 text-[13px] font-semibold leading-snug text-[#111827]">
                  <HighlightedText text={form.subject} />
                </div>
              </div>
              <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap px-3 py-2 text-[12px] leading-relaxed text-[#374151]">
                <HighlightedText text={form.body} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
