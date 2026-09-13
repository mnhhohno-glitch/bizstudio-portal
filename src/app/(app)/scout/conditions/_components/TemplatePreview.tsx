"use client";

// T-194: 配信文プレビュー。件名・本文の差し込み項目（[担当者] [社名] [最終学歴] [経験職種]）を色分けする。
import { MERGE_TAGS, MERGE_TAG_RE, templateKindLabel } from "@/lib/scout-conditions/constants";
import type { TemplateDto } from "@/lib/scout-conditions/types";

const TAG_CLASS = new Map<string, string>(MERGE_TAGS.map((t) => [t.tag, t.className]));

export function HighlightedText({ text }: { text: string }) {
  const parts = text.split(MERGE_TAG_RE);
  return (
    <>
      {parts.map((p, i) => {
        const cls = TAG_CLASS.get(p);
        return cls ? (
          <span key={i} className={`rounded px-1 font-medium ${cls}`}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

export default function TemplatePreview({ template }: { template: TemplateDto | null }) {
  if (!template) {
    return (
      <div className="rounded-[6px] border border-dashed border-[#D1D5DB] p-3 text-[12px] text-[#9CA3AF]">
        テンプレートが選択されていません
      </div>
    );
  }
  return (
    <div className="rounded-[6px] border border-[#E5E7EB] bg-[#FAFAFA]">
      <div className="border-b border-[#E5E7EB] px-3 py-2">
        <div className="text-[11px] text-[#6B7280]">
          {templateKindLabel(template.kind)}｜{template.name}
        </div>
        <div className="mt-1 text-[13px] font-semibold leading-snug text-[#111827]">
          <HighlightedText text={template.subject} />
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap px-3 py-2 text-[12px] leading-relaxed text-[#374151]">
        <HighlightedText text={template.body} />
      </div>
      <div className="flex flex-wrap gap-1 border-t border-[#E5E7EB] px-3 py-1.5 text-[10px] text-[#6B7280]">
        差し込み項目:
        {MERGE_TAGS.map((t) => (
          <span key={t.tag} className={`rounded px-1 ${t.className}`}>
            {t.tag}
          </span>
        ))}
      </div>
    </div>
  );
}
