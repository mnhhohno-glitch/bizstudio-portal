"use client";

import { useMemo } from "react";
import {
  TEMPLATE_KIND_OTHER_LABEL,
  TEMPLATE_KIND_VALUES,
  templateKindLabel,
  templateKindOrder,
} from "@/lib/rpa-scout/constants";
import type { RpaTemplate } from "./types";

// 件名テンプレートの選択。種別（未送信用／送信済用／個別配信用）でグループ分けし、
// 選択中パターンの送信状態に合う種別を先頭に出す。選択肢は絞り込まない
export default function SubjectTemplateSelect({
  templates,
  value,
  onChange,
  sendStatus,
}: {
  templates: RpaTemplate[];
  value: string;
  onChange: (id: string) => void;
  sendStatus: string | null | undefined; // 選択中パターンの送信状態。未選択/移行パターンは null
}) {
  const groups = useMemo(() => {
    const active = templates.filter((t) => t.isActive);
    const byName = (a: RpaTemplate, b: RpaTemplate) => a.name.localeCompare(b.name, "ja");
    const result: { key: string; label: string; items: RpaTemplate[] }[] = [];
    for (const kind of templateKindOrder(sendStatus)) {
      const items = active.filter((t) => t.kind === kind).sort(byName);
      if (items.length > 0) result.push({ key: kind, label: templateKindLabel(kind), items });
    }
    // kind が null／未知の値のものは最後に「その他」でまとめる
    const others = active
      .filter((t) => !t.kind || !TEMPLATE_KIND_VALUES.includes(t.kind))
      .sort(byName);
    if (others.length > 0) {
      result.push({ key: "__other__", label: TEMPLATE_KIND_OTHER_LABEL, items: others });
    }
    return result;
  }, [templates, sendStatus]);

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5"
      >
        <option value="">選択してください</option>
        {groups.map((g) => (
          <optgroup key={g.key} label={g.label}>
            {g.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="mt-1 text-[11px] text-[#6B7280]">
        パターンの送信状態に合う種別を上に表示しています（他の種別も下から選べます）
      </div>
    </>
  );
}
