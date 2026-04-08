"use client";
import { inputCls, labelCls } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { r: Record<string, any>; set: (k: string, v: any) => void };

const SECTIONS = [
  { title: "人物評価", prefix: "personality", items: [
    { key: "Motivation", label: "やる気・熱意" },
    { key: "Communication", label: "コミュニケーション" },
    { key: "Manner", label: "マナー" },
    { key: "Intelligence", label: "地頭" },
    { key: "Humanity", label: "人間性" },
  ]},
  { title: "経歴評価", prefix: "career", items: [
    { key: "JobType", label: "職種マッチ" },
    { key: "Experience", label: "経験年数" },
    { key: "JobChangeCount", label: "転職回数" },
    { key: "Achievement", label: "実績" },
    { key: "Qualification", label: "資格" },
  ]},
  { title: "条件評価", prefix: "condition", items: [
    { key: "JobType", label: "職種" },
    { key: "Salary", label: "年収" },
    { key: "Holiday", label: "休日" },
    { key: "Area", label: "エリア" },
    { key: "Flexibility", label: "柔軟性" },
  ]},
];

export default function RankEvaluation({ r, set }: Props) {
  const grandTotal = SECTIONS.reduce((sum, sec) =>
    sum + sec.items.reduce((s, item) => s + (r[`${sec.prefix}${item.key}`] || 0), 0), 0);

  return (
    <div className="space-y-6">
      {SECTIONS.map((sec) => {
        const total = sec.items.reduce((s, item) => s + (r[`${sec.prefix}${item.key}`] || 0), 0);
        return (
          <div key={sec.prefix}>
            <h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">
              {sec.title}（小計: {total} / {sec.items.length * 5}）
            </h4>
            <div className="space-y-2">
              {sec.items.map((item) => {
                const scoreKey = `${sec.prefix}${item.key}`;
                const memoKey = `${scoreKey}Memo`;
                return (
                  <div key={item.key} className="flex items-center gap-3">
                    <span className="text-[12px] w-32 shrink-0">{item.label}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => set(scoreKey, r[scoreKey] === n ? null : n)}
                          className={`w-7 h-7 rounded text-[11px] font-bold border ${
                            r[scoreKey] === n ? "bg-[#2563EB] text-white border-[#2563EB]" : "bg-white text-gray-500 border-gray-300 hover:border-[#2563EB]"
                          }`}>{n}</button>
                      ))}
                    </div>
                    <input type="text" value={r[memoKey] || ""} onChange={(e) => set(memoKey, e.target.value)}
                      placeholder="メモ" className="flex-1 rounded border border-gray-300 px-2 py-1 text-[11px] focus:border-[#2563EB] focus:outline-none" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="border-t pt-4">
        <div className="flex items-center gap-6">
          <span className="text-[14px]">合計: <strong className="text-lg">{grandTotal}</strong> / 75</span>
          <div>
            <label className={labelCls}>面談評価:</label>
            <select value={r.overallRank || ""} onChange={(e) => set("overallRank", e.target.value || null)}
              className="border border-gray-300 rounded px-2 py-1 text-[14px] font-bold ml-1">
              <option value="">-</option>
              {["A", "B", "C", "D"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>総合メモ</label>
          <textarea value={r.grandTotalMemo || ""} onChange={(e) => set("grandTotalMemo", e.target.value)} rows={3} className={inputCls} />
        </div>
      </div>
    </div>
  );
}
