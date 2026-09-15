"use client";

// T-199: マイナビ「検索項目設定」画面の構造に揃えたフォーム部品。
// - FormGroup: 幅いっぱいの青い見出しバー＋細い罫線で囲んだ枠
// - FormRow:   左列＝項目名（固定幅・薄いグレー）／右列＝入力欄（左端から始める）。行の下に横罫線
// 色は画面で既に使っている青（#2563EB / #1D4ED8 / #DBEAFE）とグレー（#F3F4F6 / #E5E7EB）だけを使い、新しい色は増やさない。
import type { ReactNode } from "react";

/** 左列の幅。全グループで揃える（マイナビの項目名列と同じく固定幅） */
export const LABEL_COL_WIDTH = "180px";

export function FormGroup({ title, titleNote, children }: { title: string; titleNote?: string; children: ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-[4px] border border-[#E5E7EB]">
      {/* 見出しバー: マイナビのピンク帯に相当。目に痛くないよう淡い青地＋濃い青の文字にする */}
      <div className="flex items-baseline gap-2 border-l-4 border-[#2563EB] bg-[#DBEAFE] px-3 py-1.5">
        <span className="text-[13px] font-bold text-[#1D4ED8]">{title}</span>
        {titleNote && <span className="text-[11px] text-[#1D4ED8]/80">{titleNote}</span>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function FormRow({
  no,
  label,
  note,
  dense = false,
  children,
}: {
  /** 7軸の通し番号（"1." など）。説明資料と対応が取れるよう項目名の左に小さく残す */
  no?: string;
  label: string;
  /** 補足文。入力欄の直下に小さい文字で置く（マイナビの赤い注意書きに相当） */
  note?: string;
  /** 表示専用の行など高さを詰めたいとき */
  dense?: boolean;
  children: ReactNode;
}) {
  const pad = dense ? "px-3 py-1.5" : "px-3 py-2.5";
  return (
    <div className="grid border-b border-[#E5E7EB] last:border-b-0" style={{ gridTemplateColumns: `${LABEL_COL_WIDTH} minmax(0, 1fr)` }}>
      <div className={`flex items-start gap-1 bg-[#F3F4F6] text-[12px] font-semibold text-[#374151] ${pad}`}>
        {no && <span className="w-[18px] shrink-0 text-[11px] font-normal text-[#9CA3AF]">{no}</span>}
        <span>{label}</span>
      </div>
      <div className={`min-w-0 ${pad}`}>
        {children}
        {note && <div className="mt-1 text-[10px] leading-snug text-[#6B7280]">{note}</div>}
      </div>
    </div>
  );
}
