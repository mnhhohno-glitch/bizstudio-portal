"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { toast } from "sonner";
import { AREA_GROUPS, OTHER_PREFECTURES } from "@/lib/constants/target-areas";
import { stripFileMetadata, stripCorpSuffixes, extractCompanyNameCandidates } from "@/lib/normalize-filename";
import { resolveJobDbFromBookmark, extractJobNoFromRef, resolveBookmarkMedia } from "@/lib/constants/source-media";
import { openJobPlatformDetail } from "@/lib/openJobPlatformDetail";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { RATING_VALUE, RANK_ORDER, RANK_UNRANKED, extractAxis } from "@/lib/ai-rating";
import { parseCaAnalysisBlocks, type CaMark } from "@/lib/ca-analysis-format";
import { oneDriveSyncBadge, type OneDriveSyncBadgeSource } from "@/lib/onedrive-sync-badge";

/* ---------- Types ---------- */
type Job = {
  id: number;
  // T-161 R3: 行の出所。"kyuujin"=求人ツール由来 / "site"=本人応募（サイト経由）/
  // "introduced"=CAが出力なしに紹介済みにした行。site/introduced は portal のブックマーク由来で
  // id は負数（kyuujin と衝突しない選択キー）、file_id に CandidateFile.id を持つ。
  source?: "kyuujin" | "site" | "introduced";
  file_id?: string;
  external_job_ref?: string | null;
  job_id: string | null;
  company_name: string;
  job_title: string;
  job_db: string | null;
  job_type: string | null;
  job_category: string | null;
  work_location: string | null;
  salary: string | null;
  overtime: string | null;
  area_match: string | null;
  transfer: string | null;
  original_url: string | null;
  created_at: string;
  updated_at: string;
  candidate_response: string | null;
  candidate_responded_at: string | null;
};

const RESPONSE_BADGE: Record<string, { label: string; cls: string }> = {
  WANT_TO_APPLY: { label: "応募したい", cls: "bg-red-100 text-red-700" },
  INTERESTED: { label: "気になる", cls: "bg-yellow-100 text-yellow-700" },
};

// T-133 FU: CA画面の「本人回答」列用。求職者本人のマイページ回答 = CandidateFile.responseStatus。
// 上の RESPONSE_BADGE（CandidateJobResponse 由来・会社名脇チップ）とは別テーブル・別系統。
// キーは CandidateFile.responseStatus の正準値（src/lib/constants/response-status.ts）。
// UNANSWERED / null / 不明値はこのマップに含めず、呼び出し側で「—」表示する。
// 色は既存バッジ配色を流用（応募したい=赤・気になる=黄）。新色は作らない。
const RESPONSE_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  APPLY: { label: "応募したい", cls: "bg-red-100 text-red-700" },
  INTERESTED: { label: "気になる", cls: "bg-yellow-100 text-yellow-700" },
  PENDING: { label: "保留", cls: "bg-gray-100 text-gray-600" },
  EXCLUDED: { label: "対象外", cls: "bg-gray-100 text-gray-400" },
  IN_SELECTION: { label: "選考中", cls: "bg-blue-100 text-blue-700" },
  SELECTION_ENDED: { label: "選考終了", cls: "bg-gray-100 text-gray-500" },
};

type JobsResponse = {
  jobs: Job[];
  total_jobs: number;
  project_id?: number;
  project_name?: string;
  job_seeker_id?: string;
  job_seeker_name?: string;
};

type Entry = {
  id: string;
  candidateId: string;
  externalJobId: number;
  // T-161: 求人単位の引き当てキー（job-platform source_job_id）。portal 由来行の「エントリー済」判定に使う。
  externalJobRef?: string | null;
  companyName: string;
  jobTitle: string;
  jobDb: string | null;
  jobType: string | null;
  jobCategory: string | null;
  workLocation: string | null;
  salary: string | null;
  overtime: string | null;
  areaMatch: string | null;
  transfer: string | null;
  originalUrl: string | null;
  entryDate: string;
  introducedAt: string;
  createdAt: string;
  updatedAt: string;
};

/* ---------- Helpers ---------- */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase();
}

function formatDateJST(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function toInputDate(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function todayString(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/* ---------- Sub-components ---------- */

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3 animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-28 bg-gray-200 rounded" />
            <div className="ml-auto h-4 w-20 bg-gray-200 rounded" />
          </div>
          <div className="h-4 w-full bg-gray-200 rounded mb-2" />
          <div className="h-3 w-24 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Entry Date Modal ---------- */
function EntryDateModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayString());
  const overlayClose = useOverlayClose(onCancel);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      {...overlayClose}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">
            エントリー日を選択
          </h2>
          <button
            onClick={onCancel}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          {count}件の求人をエントリーします
        </p>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(date)}
            disabled={!date}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            登録
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Delete Confirm Modal ---------- */
function DeleteConfirmModal({
  count,
  skippedCount,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  skippedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const overlayClose = useOverlayClose(onCancel);
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      {...overlayClose}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">
            紹介リストから削除
          </h2>
          <button
            onClick={onCancel}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-2">
          選択した{count}件の求人を紹介リストから削除しますか？
        </p>

        {skippedCount > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2 mb-4">
            ※エントリー済みの{skippedCount}件は削除されません
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="bg-red-500 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? "削除中..." : "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
/* ---------- Sort Icon ---------- */
function SortIcon({ field, current, dir }: { field: string; current: string | null; dir: "asc" | "desc" }) {
  const active = current === field;
  return (
    <span className="inline-flex flex-col text-[8px] leading-[9px] ml-0.5">
      <span className={active && dir === "asc" ? "text-[#2563EB]" : "text-gray-300"}>▲</span>
      <span className={active && dir === "desc" ? "text-[#2563EB]" : "text-gray-300"}>▼</span>
    </span>
  );
}

// 2段クロスソート用：基準が現在効いている方向を ▲▼ で表示（未指定は両方グレー）。
function DirArrows({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <span className="inline-flex flex-col text-[8px] leading-[9px] ml-0.5">
      <span className={dir === "asc" ? "text-[#2563EB]" : "text-gray-300"}>▲</span>
      <span className={dir === "desc" ? "text-[#2563EB]" : "text-gray-300"}>▼</span>
    </span>
  );
}

// 1次/2次の次数バッジ（n=null なら非表示）。
function OrderBadge({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span className="ml-0.5 inline-flex items-center justify-center w-3 h-3 rounded-full bg-[#2563EB] text-white text-[8px] font-bold leading-none">
      {n}
    </span>
  );
}

/* ---------- Bookmark Section ---------- */
type BookmarkFile = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  driveFileId: string | null; // 案Z: job-platform 由来は PDF 実体なし
  driveViewUrl: string | null;
  memo: string | null;
  extractedAt: string | null;
  aiMatchRating: string | null;
  aiAnalysisComment: string | null;
  aiAnalyzedAt: string | null;
  caComment: string | null; // T-128 batch4: CAアドバイザーコメント
  candidateNote: string | null; // T-133 FU-1: 求職者本人が /site/ で書いたメモ（CA画面では表示のみ）
  // T-133 FU: 求職者本人のマイページ回答（UNANSWERED/INTERESTED/APPLY/PENDING/EXCLUDED/IN_SELECTION/SELECTION_ENDED）。CA画面は表示のみ。
  responseStatus?: string | null;
  lastExportedAt: string | null;
  lastExportedTo: string | null;
  // T-161: 出力なしの「紹介済み」時刻。出力済（lastExportedAt）とは別系統で、実績集計は両者の COALESCE。
  introducedAt?: string | null;
  // 求職者本人のサイト操作由来（"candidate"）は担当列を「サイト経由」表示。CA追加は null|"ca"。
  origin?: string | null;
  // DB名/DBNO列用: externalJobRef=job-platform source_job_id、sourceMedia=元媒体コード（webhook由来のみ）。
  externalJobRef?: string | null;
  sourceMedia?: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  archivedAt?: string | null;
  archivedReason?: string | null;
  archivedNote?: string | null;
  archivedBy?: { id: string; name: string } | null;
  // T-159 Phase 2-c: OneDrive コピー状況。null / 未定義なら何も表示しない（正常時は無音）。
  oneDriveSyncLog?: OneDriveSyncBadgeSource | null;
};

const ARCHIVE_REASONS = [
  "重複",
  "希望条件不一致",
  "応募条件不足",
  "求職者意向",
  "選考終了",
  "その他",
] as const;

/* ---------- Archive Modal ---------- */
function ArchiveModal({
  count,
  fileName,
  onConfirm,
  onCancel,
  busy,
}: {
  count: number;
  fileName?: string;
  onConfirm: (reason: string | null, note: string | null) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const overlayClose = useOverlayClose(() => { if (!busy) onCancel(); });
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayClose}>
      <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[#374151]">紹介保留に移動</h2>
          <button onClick={onCancel} disabled={busy} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none disabled:opacity-50">×</button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {fileName ? <><span className="font-medium">{fileName}</span> を紹介保留に移動します。</> : `${count}件のブックマークを紹介保留に移動します。`}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">削除理由（任意）</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              disabled={busy}
            >
              <option value="">（選択しない）</option>
              {ARCHIVE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">メモ（任意）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="補足があれば入力..."
              disabled={busy}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 pt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
          <button
            onClick={() => onConfirm(reason || null, note.trim() || null)}
            disabled={busy}
            className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {busy ? "処理中..." : "保留に移動"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ランクの配色は**ここが単一の出所**。バッジ（className）とドーナツグラフ（SVG の stroke）で共有する。
 * stroke はバッジ枠線と同じ Tailwind トークン（-300）を指すので、円とバッジの色が完全に一致し、
 * グラフ用に別の色を定義する必要がない（hex を書き起こさない）。
 */
const RATING_PALETTE: Record<string, { badge: string; stroke: string }> = {
  A: { badge: "bg-green-100 text-green-800 border-green-300", stroke: "stroke-green-300" },
  "B+": { badge: "bg-cyan-100 text-cyan-800 border-cyan-300", stroke: "stroke-cyan-300" },
  B: { badge: "bg-blue-100 text-blue-800 border-blue-300", stroke: "stroke-blue-300" },
  C: { badge: "bg-yellow-100 text-yellow-800 border-yellow-300", stroke: "stroke-yellow-300" },
  D: { badge: "bg-red-100 text-red-800 border-red-300", stroke: "stroke-red-300" },
  未評価: { badge: "bg-gray-100 text-gray-500 border-gray-300", stroke: "stroke-gray-300" },
};
const RATING_STYLES: Record<string, string> = Object.fromEntries(
  Object.entries(RATING_PALETTE).map(([k, v]) => [k, v.badge]),
);

/** 評価内訳・ドーナツで共通のランク列。未評価は実データに1件でもあるときだけ末尾に足す。 */
const RATING_RANKS = ["A", "B+", "B", "C", "D"];
function ratingCols(maps: Record<string, number>[]): string[] {
  const hasUnrated = maps.some((m) => (m["未評価"] ?? 0) > 0);
  return hasUnrated ? [...RATING_RANKS, "未評価"] : RATING_RANKS;
}
const RATING_LABELS: Record<string, string> = {
  A: "A 非常に良い", "B+": "B+ 良い（上位）", B: "B 良い", C: "C 要検討", D: "D 合わない",
};

/**
 * ランク別内訳のドーナツグラフ（外部ライブラリ不使用・SVG の stroke-dasharray のみ）。
 *
 * 半径を r = 15.9155 にすると円周 2πr = 100 になるため、dasharray/dashoffset に
 * 「％の値そのもの」を渡せる（比率計算が1回で済み、丸め誤差で隙間が出ない）。
 * グループを -90度回転して 12時方向から時計回りに描く。
 *
 * エッジケース:
 *   - 総数0件: セグメントを1つも描かず、薄いグレーの空円だけを出す（NaN を作らない）。
 *   - 1ランク100%: dasharray が "100 0" になり途切れず1色で閉じる。
 *   - 件数3桁以上: 中心の数字のフォントを桁数に応じて落とし、円からはみ出させない。
 */
function RatingDonut({ label, map, cols, size = 88 }: {
  label: string;
  map: Record<string, number>;
  cols: string[];
  size?: number;
}) {
  const total = cols.reduce((sum, k) => sum + (map[k] ?? 0), 0);
  // 累積%を進めながらセグメントを積む。total=0 のときは segments が空配列になる。
  let acc = 0;
  const segments = total === 0 ? [] : cols.flatMap((k) => {
    const n = map[k] ?? 0;
    if (n === 0) return [];
    const portion = (n / total) * 100;
    const seg = { k, n, portion, offset: acc };
    acc += portion;
    return [seg];
  });
  const digits = String(total).length;
  const numCls = digits >= 4 ? "text-[12px]" : digits === 3 ? "text-[14px]" : "text-[17px]";

  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" role="img" aria-label={`${label}の内訳`}>
          {/* 土台のリング。0件のときはこれだけが見える。 */}
          <circle
            cx="18" cy="18" r="15.9155" fill="none"
            className="stroke-gray-100" strokeWidth="4"
          />
          {segments.map((s) => (
            <circle
              key={s.k}
              cx="18" cy="18" r="15.9155" fill="none"
              className={RATING_PALETTE[s.k]?.stroke ?? "stroke-gray-300"}
              strokeWidth="4"
              strokeDasharray={`${s.portion} ${100 - s.portion}`}
              strokeDashoffset={-s.offset}
            >
              <title>{`${label} ${s.k === "未評価" ? "—" : s.k}: ${s.n}件 (${Math.round(s.portion)}%)`}</title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none pointer-events-none">
          <span className={`${numCls} font-bold tabular-nums text-gray-700`}>{total}</span>
          <span className="text-[9px] text-gray-400 mt-0.5">件</span>
        </div>
      </div>
      <span className="text-[12px] text-gray-500">{label}</span>
    </div>
  );
}

/** 総合/希望/通過 の3つのドーナツ＋共通凡例。気になる/応募したいは0件が多く円が描けないため対象外。 */
function RatingDonuts({ summary, cols }: {
  summary: { overall: Record<string, number>; wish: Record<string, number>; pass: Record<string, number> };
  cols: string[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-3 min-w-0">
      <RatingDonut label="総合" map={summary.overall} cols={cols} />
      <RatingDonut label="希望" map={summary.wish} cols={cols} />
      <RatingDonut label="通過" map={summary.pass} cols={cols} />
      {/* 凡例は3円で共通。円ごとには出さない。 */}
      <div className="flex flex-col gap-0.5 shrink-0 pt-1">
        {cols.map((k) => (
          <span key={k} className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm border ${RATING_PALETTE[k]?.badge ?? "bg-gray-100 border-gray-300"}`} />
            {k === "未評価" ? "—" : k}
          </span>
        ))}
      </div>
    </div>
  );
}

// 総合のみ B+ を取りうる（希望・通過は A/B/C/D）。ただし読み取りは3軸とも同じ
// パターンを使う。幅表記「B〜C」は B+ にマッチせず従来どおり先頭1文字 "B" を返す。
function parse3AxisRatings(comment: string | null): { wish: string; pass: string; overall: string } | null {
  if (!comment) return null;
  const w = extractAxis(comment, "本人希望");
  const p = extractAxis(comment, "通過率");
  const o = extractAxis(comment, "総合");
  if (!w && !p && !o) return null;
  return { wish: w || "—", pass: p || "—", overall: o || "—" };
}

// T-180: 評価コメント本文の表示。
// 新フォーマット（選考分析が「【項目名】〇▲×」+ 次行コメント）は項目見出しを色付きで強調表示し、
// それ以外の行は従来どおりのプレーンテキスト表示にする。
// 過去に評価済みの旧フォーマットは項目見出し行を含まないため、text ブロック1つ＝従来表示のまま崩れない。
const CA_MARK_STYLES: Record<CaMark, string> = {
  ok: "bg-green-50 text-green-700 border-green-300",
  warn: "bg-amber-50 text-amber-700 border-amber-300",
  ng: "bg-red-50 text-red-700 border-red-300",
};

function cleanAnalysisComment(comment: string): string {
  return comment
    .replace(/\*\*/g, "")
    .replace(/^###?\s+/gm, "")
    .replace(/^-{3,}\s*$/gm, "")
    .split("\n")
    .filter((line) => !/^\s*■\s*(本人希望|通過率|総合)[：:]/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AnalysisCommentBody({ comment }: { comment: string }) {
  const blocks = useMemo(() => parseCaAnalysisBlocks(cleanAnalysisComment(comment)), [comment]);
  return (
    <div className="text-sm text-gray-700 leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === "item" ? (
          <div key={i} className={`flex items-center gap-2 ${i === 0 ? "" : "mt-3"} mb-1`}>
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-sm font-bold shrink-0 ${CA_MARK_STYLES[b.mark]}`}>
              {b.symbol}
            </span>
            <span className="font-semibold text-gray-900">{b.label}</span>
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap">
            {b.text}
          </div>
        )
      )}
    </div>
  );
}

/* ---------- Bookmark sort helpers (pure functions) ---------- */
// A=最良 … D=最低。空欄/null/「—」は方向に関わらず常に末尾に寄せるため Infinity 扱い。
function rankValue(r: string | null | undefined): number {
  if (!r) return Number.POSITIVE_INFINITY;
  const v = RANK_ORDER[r];
  return v === undefined ? Number.POSITIVE_INFINITY : v;
}
// 1ランクキーの比較。null/空欄は dir に関わらず常に末尾。
function compareRank(a: string | null | undefined, b: string | null | undefined, dir: 1 | -1): number {
  const va = rankValue(a);
  const vb = rankValue(b);
  const aMissing = va === Number.POSITIVE_INFINITY;
  const bMissing = vb === Number.POSITIVE_INFINITY;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // a を末尾へ
  if (bMissing) return -1; // b を末尾へ
  return (va - vb) * dir;
}

// 紹介日キーは「JST の暦日（YYYY-MM-DD）」単位で比較する（罠#17）。
// フル日時(getTime)で比べると同一表示日でも秒単位で全行異なり、1次=紹介日だけで順序が確定して
// 2次キーへフォールスルーしなくなるため。null/未設定/不正値は "" を返し、呼び出し側で常に末尾へ。
function jstDateKey(v: string | number | Date | null | undefined): string {
  if (v == null || v === "") return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // 'YYYY-MM-DD'
}

// ---- 2段（1次/2次）クロスソートモデル ----
// 並び替えキーは最大2つ（1次・2次）。各キーは基準 + 方向。
type SortBasis = "company_name" | "want" | "interest" | "wish" | "pass" | "overall" | "response" | "uploader" | "date";
type SortDir = "asc" | "desc";
type SortKey = { basis: SortBasis; dir: SortDir };

// 方向トグルを持たない単方向の基準（応募したい順 / 気になる順）。
const SINGLE_DIR_BASES = new Set<SortBasis>(["want", "interest"]);
function hasDirToggle(basis: SortBasis): boolean {
  return !SINGLE_DIR_BASES.has(basis);
}
// 基準を新たに1次へ昇格させるときのデフォルト方向。紹介日のみ降順（新しい順）。
function defaultDir(basis: SortBasis): SortDir {
  return basis === "date" ? "desc" : "asc";
}
// チップ/ボタンに表示する基準ラベル。
const BASIS_LABEL: Record<SortBasis, string> = {
  company_name: "会社名",
  want: "応募したい順",
  interest: "気になる順",
  wish: "希望",
  pass: "通過",
  overall: "総合",
  response: "本人回答",
  uploader: "担当",
  date: "紹介日",
};

// 修正2: 並び替えの判定値を「本人回答優先」にするための正規化。
// 2つの記録系統は同じ意味の値でも綴りが違うため、必ず同じ内部意向へ正規化してから比較する。
//   本人回答 CandidateFile.responseStatus : APPLY / INTERESTED / PENDING / EXCLUDED / UNANSWERED
//                                           （＋CA駆動の IN_SELECTION / SELECTION_ENDED）
//   従来値   CandidateJobResponse.response : WANT_TO_APPLY / INTERESTED
// ★「応募したい」が APPLY と WANT_TO_APPLY で綴り違い。大文字小文字・前後空白も吸収する。
type ResponseIntent = "APPLY" | "INTERESTED" | "PENDING" | "EXCLUDED";
function normalizeResponseIntent(resp: string | null | undefined): ResponseIntent | null {
  if (!resp) return null;
  switch (resp.trim().toUpperCase()) {
    case "APPLY":
    case "WANT_TO_APPLY":
      return "APPLY";
    case "INTERESTED":
      return "INTERESTED";
    case "PENDING":
      return "PENDING";
    case "EXCLUDED":
      return "EXCLUDED";
    default:
      // UNANSWERED / IN_SELECTION / SELECTION_ENDED / 不明値は「回答なし」＝常に末尾。
      return null;
  }
}

// 本人回答（CandidateFile.responseStatus）を優先し、無ければ従来値（CandidateJobResponse 由来）へフォールバック。
// 従来値は廃止しない（旧マイページ経由の過去分は従来値にしか記録が無く、落とすと並びが壊れるため）。
// IN_SELECTION / SELECTION_ENDED は CA 駆動で本人の意向ではないため「回答なし」扱いになり、従来値へ落ちる。
function resolveResponseForSort(
  own: string | null | undefined,
  legacy: string | null | undefined,
): ResponseIntent | null {
  return normalizeResponseIntent(own) ?? normalizeResponseIntent(legacy);
}

// 正規化済み意向 → 基準に応じた優先順位の数値。回答なしは基準に関わらず常に末尾。
// 順位: 応募したい ＞ 気になる ＞ 保留 ＞ 対象外 ＞ 未回答（「気になる順」では上位2つが入れ替わる）。
const WANT_ORDER: ResponseIntent[] = ["APPLY", "INTERESTED", "PENDING", "EXCLUDED"];
const INTEREST_ORDER: ResponseIntent[] = ["INTERESTED", "APPLY", "PENDING", "EXCLUDED"];
/** 回答なしの順位値。方向トグル付きの response 基準で「常に末尾」を判定するのに使う。 */
const RESPONSE_RANK_NONE = WANT_ORDER.length;
function responseRank(resp: string | null, basis: "want" | "interest"): number {
  const intent = normalizeResponseIntent(resp);
  if (!intent) return RESPONSE_RANK_NONE; // 回答なしは常に末尾
  return (basis === "want" ? WANT_ORDER : INTEREST_ORDER).indexOf(intent);
}

// 基準ごとの値取得を accessor で受け取り、BM/Jobs 両方で同一ロジックを共有する。
// getRank は欠損時 null（compareRank 側で常に末尾）。getResponse は罠#6 の解決済みステータス。
// getUploader 省略可（求人紹介には担当列が無い → uploader 基準は使わない）。
type SortAccessors<T> = {
  getCompanyName: (x: T) => string;
  getRank: (x: T, axis: "wish" | "pass" | "overall") => string | null;
  getResponse: (x: T) => string | null;
  getDate: (x: T) => string | number | Date;
  getUploader?: (x: T) => string;
};

// 1基準のみの比較。want/interest は単方向（dir 無視）。ランク欠損は方向に関わらず常に末尾。
function compareByBasis<T>(a: T, b: T, key: SortKey, acc: SortAccessors<T>): number {
  const dir: 1 | -1 = key.dir === "asc" ? 1 : -1;
  switch (key.basis) {
    case "company_name":
      return acc.getCompanyName(a).localeCompare(acc.getCompanyName(b)) * dir;
    case "want":
    case "interest": {
      const ra = responseRank(acc.getResponse(a), key.basis);
      const rb = responseRank(acc.getResponse(b), key.basis);
      return ra - rb; // 単方向（dir は適用しない）
    }
    case "wish":
    case "pass":
    case "overall": {
      const k = key.basis as "wish" | "pass" | "overall";
      return compareRank(acc.getRank(a, k), acc.getRank(b, k), dir);
    }
    case "response": {
      // 本人回答列のソート。順序定義は「応募したい順」ボタンと同じ responseRank(want) を流用する
      //（応募したい > 気になる > 保留 > 対象外）。担当/紹介日と同じく方向トグルを持つが、
      // 未回答は他列の欠損と同様に方向に関わらず常に末尾へ寄せる。
      const ra = responseRank(acc.getResponse(a), "want");
      const rb = responseRank(acc.getResponse(b), "want");
      const aMissing = ra === RESPONSE_RANK_NONE;
      const bMissing = rb === RESPONSE_RANK_NONE;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return (ra - rb) * dir;
    }
    case "uploader": {
      const ua = acc.getUploader?.(a) ?? "";
      const ub = acc.getUploader?.(b) ?? "";
      return ua.localeCompare(ub) * dir;
    }
    case "date": {
      // JST 暦日単位で比較（同一日は 0 を返し 2次キーへフォールスルー）。desc=新しい日が上。
      const da = jstDateKey(acc.getDate(a));
      const db = jstDateKey(acc.getDate(b));
      const aMissing = da === "";
      const bMissing = db === "";
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1; // 未設定は方向不問で末尾
      if (bMissing) return -1;
      return da.localeCompare(db) * dir;
    }
    default:
      return 0;
  }
}

// 1次 → 2次 → 確定タイブレーク（総合A優先 → 会社名昇順）の順に評価する合成比較関数。
// キー未指定（空配列）でも確定タイブレークが効くため同値行は毎回同じ順に並ぶ。
function makeCompositeComparator<T>(
  sortKeys: SortKey[],
  acc: SortAccessors<T>,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const key of sortKeys) {
      const cmp = compareByBasis(a, b, key, acc);
      if (cmp !== 0) return cmp;
    }
    const ov = compareRank(acc.getRank(a, "overall"), acc.getRank(b, "overall"), 1);
    if (ov !== 0) return ov;
    return acc.getCompanyName(a).localeCompare(acc.getCompanyName(b));
  };
}

// 2段クロスソートの state + 操作（keyOf/degreeOf/activateBasis/cycleKeyDir/removeKey）を提供する共有フック。
// BM・Jobs それぞれが独立した sortKeys を持つ（呼び出し側で別インスタンス）。
function useCrossSort(initial: SortKey[]) {
  const [sortKeys, setSortKeys] = useState<SortKey[]>(initial);
  const keyOf = (basis: SortBasis): SortKey | null => sortKeys.find((k) => k.basis === basis) ?? null;
  const degreeOf = (basis: SortBasis): number | null => {
    const i = sortKeys.findIndex((k) => k.basis === basis);
    return i === -1 ? null : i + 1;
  };
  // 基準クリック：先勝ち（最初に選んだ条件を1次のまま固定し、後から選んだ条件を2次に追加）。
  //  - 現1次クリック → 方向トグルのみ（want/interest は単方向なので無変化）。順位は1次のまま
  //  - 現2次クリック → 方向トグルのみ。順位は2次のまま（1次へ昇格させない）
  //  - 未選択クリック（キー0個）→ 1次として追加（デフォルト方向）
  //  - 未選択クリック（キー1個＝1次のみ）→ 2次として末尾追加。1次はそのまま固定
  //  - 未選択クリック（キー2個）→ 2次（index 1）を新基準で置き換え。1次はそのまま固定
  const activateBasis = (basis: SortBasis) => {
    setSortKeys((prev) => {
      const idx = prev.findIndex((k) => k.basis === basis);
      if (idx !== -1) {
        if (!hasDirToggle(basis)) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], dir: next[idx].dir === "asc" ? "desc" : "asc" };
        return next;
      }
      const newKey: SortKey = { basis, dir: defaultDir(basis) };
      if (prev.length === 0) return [newKey];
      if (prev.length === 1) return [...prev, newKey];
      return [prev[0], newKey];
    });
  };
  // チップの ▲▼：そのキーの方向のみ変更し優先順位は変えない（2次の方向もここで変えられる）。
  const cycleKeyDir = (basis: SortBasis) => {
    setSortKeys((prev) => prev.map((k) => (k.basis === basis ? { ...k, dir: k.dir === "asc" ? "desc" : "asc" } : k)));
  };
  // チップの ✕：そのキーを解除。1次を消すと2次が繰り上がる（filter で自動）。
  const removeKey = (basis: SortBasis) => {
    setSortKeys((prev) => prev.filter((k) => k.basis !== basis));
  };
  return { sortKeys, keyOf, degreeOf, activateBasis, cycleKeyDir, removeKey };
}

// 会社名軸3択ボタン（名前順=company_name / 応募したい順=want / 気になる順=interest）。BM・Jobs 共用。
function SortBasisButtons({ degreeOf, activateBasis }: {
  degreeOf: (b: SortBasis) => number | null;
  activateBasis: (b: SortBasis) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-gray-500 shrink-0">表示順：</span>
      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
        {([
          { basis: "company_name", label: "名前順" },
          { basis: "want", label: "応募したい順" },
          { basis: "interest", label: "気になる順" },
        ] as { basis: SortBasis; label: string }[]).map((opt, i) => {
          const deg = degreeOf(opt.basis);
          return (
            <button
              key={opt.basis}
              onClick={() => activateBasis(opt.basis)}
              className={`px-3 py-1 text-[13px] font-medium transition-colors flex items-center gap-1 ${i > 0 ? "border-l border-gray-300" : ""} ${
                deg ? "bg-[#2563EB] text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
              {deg && (
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/90 text-[#2563EB] text-[9px] font-bold leading-none">{deg}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 「並び替え：」1次/2次チップバー（基準ラベル・▲▼方向トグル〔want/interest 非表示〕・✕解除）。BM・Jobs 共用。
/**
 * T-146 P2-6: 引き当ての評価内訳（ブックマークタブ）。
 * 「選定率」は日報側に別定義の同名指標があるため、この語は使わない。
 * 母数は絞り込み後の表示中の件数（AI評価対象外を除く）＝一覧に見えている行と一致させる。
 */
function RatingBreakdown({ summary, filtering, totalAll, archivedCount, onClearFilter }: {
  summary: {
    total: number; excluded: number;
    overall: Record<string, number>; wish: Record<string, number>; pass: Record<string, number>;
    interested: Record<string, number>; applied: Record<string, number>;
  };
  filtering: boolean;
  totalAll: number;
  /** 紹介保留（CandidateFile.archivedAt != null）の件数。一覧（分母）には含まれない別枠の数。 */
  archivedCount: number;
  onClearFilter: () => void;
}) {
  // 開閉状態は保持しない。呼び出し側で key={candidateId} を付けており、
  // 求職者を切り替えると再マウントされて必ず閉じた状態から始まる（localStorage 等にも保存しない）。
  const [detailOpen, setDetailOpen] = useState(false);

  if (summary.total === 0) return null;

  const pct = (n: number) => Math.round((n / summary.total) * 100);

  // ランク列。A/B+/B/C/D は0件でも常に出す（「そのランクが無い」ことを読み取れるようにする）。
  // 列の決定はドーナツグラフと共通の ratingCols() に委譲する（両者で列が食い違わないようにするため）。
  const DETAIL_MAPS: { label: string; map: Record<string, number> }[] = [
    { label: "希望", map: summary.wish },
    { label: "通過", map: summary.pass },
    { label: "気になる", map: summary.interested },
    { label: "応募したい", map: summary.applied },
  ];
  const COLS = ratingCols([summary.overall, ...DETAIL_MAPS.map((d) => d.map)]);

  // ★1行目のバッジ行と詳細行はこの1つの grid の直接の子として並べ、同じ列トラックを共有する。
  //   これによりランク列の幅はバッジの幅で決まり、その真下に数値が中央揃えで並ぶ。
  //   列構成: [ラベル] + ランク数ぶんの auto + [詳細ボタン]
  const gridTemplateColumns = `auto repeat(${COLS.length}, auto) auto`;

  return (
    <div className="w-fit whitespace-nowrap border-l border-gray-200 pl-3">
      <div
        className="grid items-center gap-x-3 gap-y-1 justify-end"
        style={{ gridTemplateColumns }}
      >
        {/* ---- 1行目: ラベル / ランクごとのバッジ / 詳細ボタン ---- */}
        <span className="text-[14px] text-gray-500 justify-self-start">
          評価内訳
          <span className="ml-1 text-gray-700 font-medium tabular-nums">{summary.total}件</span>
        </span>
        {COLS.map((k) => {
          const n = summary.overall[k] ?? 0;
          const s = RATING_STYLES[k];
          return (
            <span
              key={`chip-${k}`}
              className="inline-flex items-center gap-1 justify-self-center"
              title={`総合${k === "未評価" ? "評価なし" : k}: ${n}件 (${pct(n)}%)`}
            >
              <span className={`inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded text-[14px] font-bold border ${s ?? "bg-gray-100 text-gray-500 border-gray-300"}`}>
                {k === "未評価" ? "—" : k}
              </span>
              <span className="text-[14px] tabular-nums text-gray-700">{n}</span>
              <span className="text-[12px] tabular-nums text-gray-400">{pct(n)}%</span>
            </span>
          );
        })}
        <button
          onClick={() => setDetailOpen((v) => !v)}
          className="text-[13px] text-[#2563EB] hover:text-[#1D4ED8] font-medium justify-self-end"
          title="希望/通過/本人回答のランク別内訳を開閉"
        >
          詳細 {detailOpen ? "▲" : "▼"}
        </button>

        {/* ---- 詳細: 同じ grid に続けて流し込む（列位置が1行目と一致する） ---- */}
        {detailOpen && (
          <>
            {/* ヘッダ行。バッジと二重に見えるため薄い色にとどめる。 */}
            <span />
            {COLS.map((k) => (
              <span key={`head-${k}`} className="text-[13px] font-medium text-gray-400 justify-self-center">
                {k === "未評価" ? "—" : k}
              </span>
            ))}
            <span />

            {DETAIL_MAPS.map(({ label, map }) => (
              <Fragment key={`row-${label}`}>
                <span className="text-[13px] text-gray-500 justify-self-start">{label}</span>
                {COLS.map((k) => (
                  <span key={`${label}-${k}`} className="text-[13px] tabular-nums text-gray-700 justify-self-center">
                    {map[k] ?? 0}
                  </span>
                ))}
                <span />
              </Fragment>
            ))}

            {/* 区切り線を挟んだ最下段。全列ぶち抜きで右寄せ。 */}
            <span
              className="mt-1.5 pt-1.5 border-t border-gray-200 text-[13px] text-gray-400 text-right"
              style={{ gridColumn: "1 / -1" }}
            >
              <span title="サイト経由でPDF未保管のため母数から除外">AI評価対象外 {summary.excluded}件</span>
              <span className="mx-1.5 text-gray-300">｜</span>
              <span title="紹介保留に移動した件数（この一覧の母数には含まれない）">紹介保留 {archivedCount}件</span>
            </span>
          </>
        )}
      </div>

      {/* 絞り込み中は「表示中の数字が全体ではない」ことの注意書きなので、
          詳細の開閉に関わらず常に出す（アコーディオン内に隠すと部分集計を全体と誤読する）。 */}
      {filtering && (
        <div className="mt-1 text-right text-[13px] text-amber-600">
          絞り込み中（{summary.total + summary.excluded}件 / 全{totalAll}件）
          <button onClick={onClearFilter} className="ml-1 underline hover:text-amber-700">解除</button>
        </div>
      )}
    </div>
  );
}

function SortChipBar({ sortKeys, cycleKeyDir, removeKey }: {
  sortKeys: SortKey[];
  cycleKeyDir: (b: SortBasis) => void;
  removeKey: (b: SortBasis) => void;
}) {
  if (sortKeys.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[13px] text-gray-500 shrink-0">並び替え：</span>
      {sortKeys.map((k, i) => (
        <span
          key={k.basis}
          className="inline-flex items-center gap-1 rounded-full border border-[#2563EB]/40 bg-blue-50 pl-2 pr-1 py-0.5 text-[13px] text-[#2563EB]"
        >
          <span className="font-semibold">{i === 0 ? "1次" : "2次"}</span>
          <span>{BASIS_LABEL[k.basis]}</span>
          {hasDirToggle(k.basis) && (
            <button
              onClick={() => cycleKeyDir(k.basis)}
              title="昇順/降順を切替"
              className="hover:bg-blue-100 rounded px-0.5 leading-none"
            >
              {k.dir === "asc" ? "▲" : "▼"}
            </button>
          )}
          <button
            onClick={() => removeKey(k.basis)}
            title="このキーを解除"
            className="hover:bg-blue-100 rounded px-0.5 leading-none text-gray-500"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
  if (mimeType === "text/plain") return "📝";
  return "📎";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatFileDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function BookmarkSection({ candidateId, jobResponseMap, archivedCount = 0, onCountChange, onSwitchToJobs, onArchivedChange, onEntryCreated }: { candidateId: string; jobResponseMap: Map<string, string>; /** 紹介保留の件数（親が保持・評価内訳の詳細に表示する） */ archivedCount?: number; onCountChange?: (count: number) => void; onSwitchToJobs?: () => void; onArchivedChange?: () => void; onEntryCreated?: () => void }) {
  const [files, setFiles] = useState<BookmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ kind: "single"; file: BookmarkFile } | { kind: "bulk"; ids: string[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDate, setFilterDate] = useState("");
  // 2段クロスソート：初期表示は紹介日 降順（新しい順）。✕で解除すると確定タイブレーク（総合→会社名）順に戻る。
  const { sortKeys, keyOf, degreeOf, activateBasis, cycleKeyDir, removeKey } = useCrossSort([{ basis: "date", dir: "desc" }]);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendDbType, setSendDbType] = useState("hito_mynavi");
  const [sendAreas, setSendAreas] = useState<Set<string>>(new Set());
  const [otherSearch, setOtherSearch] = useState("");
  const [showOtherDropdown, setShowOtherDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; projectUrl?: string; message?: string } | null>(null);
  const [sendStep, setSendStep] = useState(0);
  const [selectedAnalysis, setSelectedAnalysis] = useState<{ fileId: string; fileName: string; rating: string; comment: string } | null>(null);
  const [editingComment, setEditingComment] = useState(false);
  const [editedCommentText, setEditedCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [wishRating, setWishRating] = useState<string>("");
  const [passRating, setPassRating] = useState<string>("");
  const [overallRating, setOverallRating] = useState<string>("");
  const [previewFile, setPreviewFile] = useState<BookmarkFile | null>(null);
  // T-128 batch4: CAアドバイザーコメント編集
  const [caCommentEdit, setCaCommentEdit] = useState<{ fileId: string; fileName: string } | null>(null);
  const [caCommentText, setCaCommentText] = useState("");
  const [caCommentSaving, setCaCommentSaving] = useState(false);
  // T-133 FU-1: 求職者メモの閲覧（読み取り専用。求職者が /site/ で編集するもの）
  const [noteView, setNoteView] = useState<{ fileName: string; note: string } | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  // DBNO列: job-platform 求人詳細へ SSO 遷移中の externalJobRef（二重クリック防止＋⏳表示）
  const [openingRef, setOpeningRef] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractTriggered = useRef(false);
  // 求人票詳細モーダルの本文スクロール領域（◀▶ 移動時に先頭へ戻すため）
  const analysisBodyRef = useRef<HTMLDivElement>(null);

  // T-136: オーバーレイ誤クローズ防止（handleCloseSendModal は後方定義のため arrow で遅延参照）
  const overlayCloseSend = useOverlayClose(() => handleCloseSendModal());
  const overlayClosePreview = useOverlayClose(() => setPreviewFile(null));
  const overlayCloseAnalysis = useOverlayClose(() => { if (!editingComment) setSelectedAnalysis(null); });
  const overlayCloseCaComment = useOverlayClose(() => { if (!caCommentSaving) setCaCommentEdit(null); });
  const overlayCloseNoteView = useOverlayClose(() => setNoteView(null));

  const findJobResponse = useCallback((fileName: string): string | null => {
    const key = normalize(stripCorpSuffixes(stripFileMetadata(fileName)));
    if (!key) return null;
    for (const [cn, response] of jobResponseMap) {
      if (key.includes(cn) || cn.includes(key)) return response;
    }
    return null;
  }, [jobResponseMap]);

  // DBNO クリック: portal SSO（issue-app-token）で job-platform 求人詳細を新規タブで開く。
  // T-140: EntryTable と共有するため実処理は @/lib/openJobPlatformDetail に切り出し。
  // ここでは二重クリック防止の in-flight ガード(openingRef)だけを持つ。
  const handleOpenJobPlatformDetail = async (externalJobRef: string) => {
    if (openingRef) return;
    setOpeningRef(externalJobRef);
    try {
      await openJobPlatformDetail(externalJobRef);
    } finally {
      setOpeningRef(null);
    }
  };

  const triggerExtraction = (fileIds: string[], label = "") => {
    if (fileIds.length === 0) return;
    console.log(`[ExtractText${label}] Triggering extraction for`, fileIds.length, "files:", fileIds);
    fetch(`/api/candidates/${candidateId}/bookmarks/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          console.error(`[ExtractText${label}] API error:`, res.status, data);
        } else {
          console.log(`[ExtractText${label}] Result:`, data);
          if (data?.extracted > 0) {
            fetchFiles(); // refresh to show ✅ icons
          }
        }
      })
      .catch((err) => {
        console.error(`[ExtractText${label}] Fetch failed:`, err);
      });
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
      if (res.ok) {
        const data = await res.json();
        const f = data.files || [];
        setFiles(f);
        onCountChange?.(f.length);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [candidateId, onCountChange]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // Refresh when AI analysis completes (ratings updated)
  useEffect(() => {
    const handler = () => fetchFiles();
    window.addEventListener("bookmark-ratings-updated", handler);
    return () => window.removeEventListener("bookmark-ratings-updated", handler);
  }, [fetchFiles]);

  // Auto-extract text for existing files without extraction (run once)
  useEffect(() => {
    if (extractTriggered.current || loading || files.length === 0) return;
    // PDF実体が無い行（サイト経由・driveFileId=null）はテキスト抽出できない＝AI評価対象外。無駄な抽出要求を避けて除外。
    const filesWithoutText = files.filter((f) => !f.extractedAt && f.driveFileId);
    if (filesWithoutText.length > 0) {
      extractTriggered.current = true;
      triggerExtraction(filesWithoutText.map((f) => f.id), ":auto");
    }
  }, [files, loading]);

  // Initialize 3-axis rating state when analysis modal opens for a new file
  useEffect(() => {
    if (!selectedAnalysis) return;
    const axis = parse3AxisRatings(selectedAnalysis.comment);
    setWishRating(axis?.wish && axis.wish !== "—" ? axis.wish : "");
    setPassRating(axis?.pass && axis.pass !== "—" ? axis.pass : "");
    setOverallRating(axis?.overall && axis.overall !== "—" ? axis.overall : selectedAnalysis.rating || "");
    // ◀▶ で別の求人へ移動したときは本文を先頭から読ませたいのでスクロール位置を戻す
    analysisBodyRef.current?.scrollTo({ top: 0 });
  }, [selectedAnalysis?.fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRatingMarker = (axis: "wish" | "pass" | "overall", newValue: string) => {
    const label = axis === "wish" ? "本人希望" : axis === "pass" ? "通過率" : "総合";
    const setRating = axis === "wish" ? setWishRating : axis === "pass" ? setPassRating : setOverallRating;
    const baseText = editingComment ? editedCommentText : (selectedAnalysis?.comment || "");
    setRating(newValue);

    const markerLineRe = new RegExp(`^[ \\t]*■\\s*${label}[：:]\\s*${RATING_VALUE}?\\s*$`, "m");
    let newText: string;
    if (newValue === "") {
      newText = markerLineRe.test(baseText)
        ? baseText.replace(new RegExp(`^[ \\t]*■\\s*${label}[：:]\\s*${RATING_VALUE}?\\s*\\n?`, "m"), "")
        : baseText;
    } else if (markerLineRe.test(baseText)) {
      newText = baseText.replace(markerLineRe, `■ ${label}: ${newValue}`);
    } else {
      const otherMarkerRe = new RegExp(`^[ \\t]*■\\s*(?:本人希望|通過率|総合)[：:]\\s*${RATING_VALUE}?\\s*$`, "m");
      const m = baseText.match(otherMarkerRe);
      if (m && m.index !== undefined) {
        const insertPos = m.index + m[0].length;
        newText = baseText.slice(0, insertPos) + `\n■ ${label}: ${newValue}` + baseText.slice(insertPos);
      } else {
        newText = `■ ${label}: ${newValue}\n${baseText}`;
      }
    }
    setEditedCommentText(newText);
    setEditingComment(true);
  };

  const uploadFiles = async (fileList: File[]) => {
    const valid = fileList.filter((f) => ALLOWED_TYPES.has(f.type) && f.size <= 20 * 1024 * 1024);
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: valid.length });

    const uploadedFileIds: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      setUploadProgress({ current: i + 1, total: valid.length });
      try {
        const formData = new FormData();
        formData.append("file", valid[i]);
        formData.append("category", "BOOKMARK");
        const res = await fetch(`/api/candidates/${candidateId}/files/upload`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.file?.id) uploadedFileIds.push(data.file.id);
        }
      } catch { /* */ }
    }

    setUploading(false);
    // 二重発火防止（FU-8）: この後の fetchFiles() で files が更新されると、未抽出キャッチアップ effect が
    // :upload と併走して同じ求人を2回 extract→job-platform投入してしまう。先に extractTriggered を立てて
    // キャッチアップを抑止し、アップロード分は下の :upload 経路のみで1回だけ抽出させる。
    extractTriggered.current = true;
    fetchFiles();

    // Background text extraction for uploaded files
    triggerExtraction(uploadedFileIds, ":upload");
  };

  const handleArchiveConfirm = async (reason: string | null, note: string | null) => {
    if (!archiveTarget) return;
    if (archiveTarget.kind === "single") {
      const fileId = archiveTarget.file.id;
      setArchivingId(fileId);
      try {
        const res = await fetch(`/api/candidates/${candidateId}/files/${fileId}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, note }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "保留化に失敗しました");
        }
        toast.success("紹介保留に移動しました");
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(fileId); return n; });
        setArchiveTarget(null);
        fetchFiles();
        onArchivedChange?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保留化に失敗しました");
      } finally {
        setArchivingId(null);
      }
    } else {
      const ids = archiveTarget.ids;
      setBulkArchiving(true);
      try {
        const results = await Promise.allSettled(
          ids.map((fileId) =>
            fetch(`/api/candidates/${candidateId}/files/${fileId}/archive`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason, note }),
            }).then(async (res) => {
              if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || `failed: ${fileId}`);
              }
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast.error(`${failed}件の保留化に失敗しました`);
        } else {
          toast.success(`${ids.length}件を紹介保留に移動しました`);
        }
        setSelectedIds(new Set());
        setArchiveTarget(null);
        fetchFiles();
        onArchivedChange?.();
      } finally {
        setBulkArchiving(false);
      }
    }
  };

  const handleArchive = (file: BookmarkFile) => {
    setArchiveTarget({ kind: "single", file });
  };

  const handleBulkArchive = () => {
    if (selectedIds.size === 0) return;
    setArchiveTarget({ kind: "bulk", ids: Array.from(selectedIds) });
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    setBulkDownloading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/bulk-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        // 全件PDF未保管（422）等はサーバの理由をそのまま表示する。
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "一括ダウンロードに失敗しました。ファイル数が多い場合は個別にDLしてください。");
        return;
      }
      const downloaded = parseInt(res.headers.get("X-Downloaded-Count") || "0", 10);
      const skipped = parseInt(res.headers.get("X-Skipped-Count") || "0", 10);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = downloaded === 1 ? `bookmark_${stamp}.pdf` : `bookmarks_${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      if (skipped > 0) {
        toast.success(`${downloaded}件をダウンロードしました（${skipped}件はPDF未保管のためスキップ）`);
      }
    } catch {
      toast.error("一括ダウンロードに失敗しました。ファイル数が多い場合は個別にDLしてください。");
    } finally {
      setBulkDownloading(false);
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };

  // BM の基準別値取得（accessor）。会社名=ファイル名、ランク=AIコメントの3軸パース、応募状況=罠#6解決済、紹介日=createdAt、担当=uploadedBy.name。
  const bookmarkAccessors: SortAccessors<BookmarkFile> = {
    getCompanyName: (f) => f.fileName,
    getRank: (f, axis) => parse3AxisRatings(f.aiAnalysisComment)?.[axis] ?? null,
    // 修正2: 本人回答（responseStatus・「本人回答」列と同じ値）を優先し、無ければ従来値へフォールバック。
    getResponse: (f) => resolveResponseForSort(f.responseStatus, findJobResponse(f.fileName)),
    getDate: (f) => f.createdAt,
    getUploader: (f) => (f.origin === "candidate" ? "サイト経由" : f.uploadedBy.name),
  };

  // Filtered + sorted files（空キーでも確定タイブレーク 総合→会社名 が効く）
  const filteredFiles = (() => {
    const result = files.filter((f) => {
      if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterDate) {
        const fileDate = new Date(f.createdAt).toISOString().slice(0, 10);
        if (fileDate !== filterDate) return false;
      }
      return true;
    });
    return [...result].sort(makeCompositeComparator(sortKeys, bookmarkAccessors));
  })();

  // ---- 求人票詳細モーダルの前後ナビゲーション ----
  // 移動順は「一覧に表示されている順序」そのまま（filteredFiles = ソート・フィルタ適用後）。
  // ただしこのモーダルは AI評価コメントを表示するものなので、コメントを持たない行
  //（未分析／AI評価対象外）は移動先から除く。開いても中身が空になり、行クリックでも開けないため。
  const analysisNavFiles = filteredFiles.filter((f) => f.aiAnalysisComment);
  const analysisIndex = selectedAnalysis
    ? analysisNavFiles.findIndex((f) => f.id === selectedAnalysis.fileId)
    : -1;

  const openAnalysis = (f: BookmarkFile) => {
    if (!f.aiAnalysisComment) return;
    setSelectedAnalysis({ fileId: f.id, fileName: f.fileName, rating: f.aiMatchRating || "", comment: f.aiAnalysisComment });
  };

  // delta: -1=前 / +1=次。編集中の未保存分は確認してから破棄する（評価セレクトの変更も編集扱い＝未保存）。
  const gotoAnalysis = (delta: number) => {
    if (!selectedAnalysis || analysisIndex < 0) return;
    const next = analysisIndex + delta;
    if (next < 0 || next >= analysisNavFiles.length) return;
    if (editingComment) {
      const dirty = editedCommentText !== selectedAnalysis.comment;
      if (dirty && !window.confirm("編集内容が保存されていません。移動しますか？")) return;
      setEditingComment(false);
      setEditedCommentText("");
    }
    openAnalysis(analysisNavFiles[next]);
  };

  // ←→ キーで前後の求人へ。ハンドラは毎レンダの最新版を ref 経由で参照する
  //（依存に入れると毎レンダで addEventListener し直しになるため）。
  const gotoAnalysisRef = useRef(gotoAnalysis);
  useEffect(() => { gotoAnalysisRef.current = gotoAnalysis; });
  const analysisOpen = Boolean(selectedAnalysis);
  useEffect(() => {
    if (!analysisOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // 評価セレクトやテキストエリアの操作を邪魔しない
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      gotoAnalysisRef.current(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysisOpen]);

  // T-146 P2-6: 評価内訳（絞り込み後の表示中の件数を集計）。
  //   ※「選定率」とは呼ばない。日報側に同名で別定義の指標（出力数÷(BM数+紹介保留数)）があり、
  //     同じ語で違う数字が2箇所に出ると必ず混乱するため。
  //   母数からは「AI評価対象外」（サイト経由でPDF未保管）を除く。一覧で対象外と明示している行を
  //   分母に入れると内訳が不当に薄まるため。バッジと同じ値解決（総合のみ aiMatchRating フォールバック）。
  const ratingSummary = (() => {
    const evaluable = filteredFiles.filter(
      (f) => !(f.origin === "candidate" && !f.driveFileId && !f.aiAnalysisComment)
    );
    const tally = (axis: "wish" | "pass" | "overall") => {
      const m: Record<string, number> = {};
      for (const f of evaluable) {
        const parsed = parse3AxisRatings(f.aiAnalysisComment);
        const raw = axis === "overall" ? parsed?.overall || f.aiMatchRating || "" : parsed?.[axis] ?? "";
        const key = raw && raw !== "—" && RANK_ORDER[raw] !== undefined ? raw : "未評価";
        m[key] = (m[key] ?? 0) + 1;
      }
      return m;
    };
    // 本人回答（気になる/応募したい）別の総合ランク内訳。
    // 判定値は一覧の「本人回答」列・「応募したい順/気になる順」ソートと同じ bookmarkAccessors.getResponse
    //（＝ resolveResponseForSort(responseStatus, 従来値)）を通し、normalizeResponseIntent で正規化する。
    // 新しい判定ロジックは作らない＝一覧の並びと集計値が食い違わない。
    const tallyByResponse = (intent: "APPLY" | "INTERESTED") => {
      const m: Record<string, number> = {};
      for (const f of evaluable) {
        if (normalizeResponseIntent(bookmarkAccessors.getResponse(f)) !== intent) continue;
        const parsed = parse3AxisRatings(f.aiAnalysisComment);
        const raw = parsed?.overall || f.aiMatchRating || "";
        const key = raw && raw !== "—" && RANK_ORDER[raw] !== undefined ? raw : "未評価";
        m[key] = (m[key] ?? 0) + 1;
      }
      return m;
    };
    return {
      total: evaluable.length,
      excluded: filteredFiles.length - evaluable.length,
      overall: tally("overall"),
      wish: tally("wish"),
      pass: tally("pass"),
      interested: tallyByResponse("INTERESTED"),
      applied: tallyByResponse("APPLY"),
    };
  })();

  const toggleAll = () => {
    const ids = filteredFiles.map((f) => f.id);
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));

  // 未出力（出力済バッジ＝lastExportedAt が付いていない）行のみを対象にトグルする。
  // 出力済の表示条件（file.lastExportedAt）と必ず同一ロジックの逆を使う。
  const unexportedFiles = filteredFiles.filter((f) => !f.lastExportedAt);
  const unexportedAllChecked = unexportedFiles.length > 0 && unexportedFiles.every((f) => selectedIds.has(f.id));
  const toggleUnexported = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (unexportedAllChecked) {
        // すべて選択済み → 未出力分のみ除外（出力済の選択状態は触らない）
        unexportedFiles.forEach((f) => next.delete(f.id));
      } else {
        // 未出力分を追加（出力済の選択状態は触らない）
        unexportedFiles.forEach((f) => next.add(f.id));
      }
      return next;
    });
  };

  const shortDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  const handleSendToJobTool = async () => {
    const areas = [...sendAreas];
    if (areas.length === 0) return;
    setSending(true);
    setSendResult(null);
    setSendStep(1);

    try {
      // Simulate step progress during API call
      const stepTimer = setInterval(() => {
        setSendStep((prev) => Math.min(prev + 1, 3));
      }, 2000);

      const res = await fetch(`/api/candidates/${candidateId}/bookmarks/send-to-job-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds: Array.from(selectedIds),
          dbType: sendDbType,
          targetAreas: areas,
        }),
      });

      clearInterval(stepTimer);
      setSendStep(4);

      const data = await res.json();
      if (res.ok && data.success) {
        setSendResult({ success: true, projectUrl: data.projectUrl, message: data.message });
        toast.success(data.message);
      } else {
        setSendResult({ success: false, message: data.error || "送信に失敗しました" });
        toast.error(data.error || "送信に失敗しました");
      }
    } catch {
      setSendResult({ success: false, message: "通信エラーが発生しました" });
      toast.error("通信エラーが発生しました");
    } finally {
      setSending(false);
    }
  };

  const handleCloseSendModal = () => {
    setShowSendModal(false);
    setSendResult(null);
    setSendStep(0);
    setOtherSearch("");
    setShowOtherDropdown(false);
    if (sendResult?.success) {
      setSelectedIds(new Set());
      fetchFiles();
    }
  };

  // サイト経由（origin="candidate" & driveFileId=null）判定。求人紹介タブには構造上出せないため、
  // 求人紹介への移動対象から外し、専用の「エントリーへ登録」導線へ回す。
  const isSiteApply = (f: BookmarkFile) => f.origin === "candidate" && !f.driveFileId;

  // T-161 R2: 出力なしで「紹介済み」にできる行 = 非サイト・未出力・未紹介。
  const isIntroducible = (f: BookmarkFile) => !isSiteApply(f) && !f.lastExportedAt && !f.introducedAt;
  const selectedIntroducibleIds = [...selectedIds].filter((id) => {
    const f = files.find((x) => x.id === id);
    return f ? isIntroducible(f) : false;
  });

  // T-161: 「エントリーへ登録」対象 = サイト経由 + 紹介済み・未出力（to-entry のサーバー側条件と同一）。
  const isEntryRegistrable = (f: BookmarkFile) => isSiteApply(f) || (!!f.introducedAt && !f.lastExportedAt);
  const selectedEntryRegistrableIds = [...selectedIds].filter((id) => {
    const f = files.find((x) => x.id === id);
    return f ? isEntryRegistrable(f) : false;
  });

  const [markingIntroduced, setMarkingIntroduced] = useState(false);
  const handleMarkIntroduced = async () => {
    if (selectedIntroducibleIds.length === 0) return;
    setMarkingIntroduced(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/bookmarks/mark-introduced`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: selectedIntroducibleIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "紹介済みへの変更に失敗しました");
      const parts = [`${data.marked ?? 0}件を紹介済みにしました`];
      if (data.skippedExported > 0) parts.push(`${data.skippedExported}件は出力済のため対象外`);
      if (data.skippedSite > 0) parts.push(`${data.skippedSite}件は本人応募のため対象外`);
      toast.success(parts.join("、"));
      setSelectedIds(new Set());
      fetchFiles();
      onSwitchToJobs?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setMarkingIntroduced(false);
    }
  };

  const [movingToJobs, setMovingToJobs] = useState(false);
  const handleMoveToJobs = async () => {
    if (selectedIds.size === 0) return;
    const selected = files.filter((f) => selectedIds.has(f.id));
    // サイト経由は kyuujin に対応 job が無く求人紹介タブに出せない。求人紹介へは移動させず
    //（＝ last_exported_at を立てず）、「エントリーへ登録」へ案内する。通常行のみ従来処理。
    const siteApply = selected.filter(isSiteApply);
    const movable = selected.filter((f) => !isSiteApply(f));

    if (movable.length === 0) {
      toast.info("サイト応募の求人は「エントリーへ登録」から進めてください");
      return;
    }

    setMovingToJobs(true);
    try {
      const exportedIds = movable.filter((f) => f.lastExportedAt).map((f) => f.id);
      const notExportedIds = movable.filter((f) => !f.lastExportedAt).map((f) => f.id);

      let restoredCount = 0;
      let alreadyActiveCount = 0;
      let sentCount = 0;
      // 「出力済」だが kyuujin 側に求人が無い行（抽出失敗等）。restore できないので新規送信でやり直す。
      let missingIds: string[] = [];
      const problems: string[] = [];

      if (exportedIds.length > 0) {
        const res = await fetch(`/api/candidates/${candidateId}/bookmarks/restore-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: exportedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "復活処理に失敗しました");
        restoredCount = data.restored ?? 0;
        alreadyActiveCount = data.notExcluded?.length ?? 0;
        missingIds = data.missingFileIds ?? [];
        if (data.ambiguous?.length) {
          problems.push(
            `照合できませんでした（${data.ambiguous.length}件・似た会社名の求人あり）: ` +
              data.ambiguous.map((a: { fileName: string }) => a.fileName).join(" / ")
          );
        }
        if (data.errors?.length) problems.push(data.errors.join(" / "));
      }

      // 新規送信対象 = 未出力 + 出力済だが kyuujin に存在しない行。
      // db種別は元の出力先に合わせる（既定は HITO-Link/マイナビ）。
      const sendTargetIds = [...notExportedIds, ...missingIds];
      const groups = new Map<string, string[]>();
      for (const id of sendTargetIds) {
        const f = movable.find((x) => x.id === id);
        const dbType = f?.lastExportedTo === "circus" ? "circus" : "hito_mynavi";
        groups.set(dbType, [...(groups.get(dbType) ?? []), id]);
      }

      for (const [dbType, ids] of groups) {
        const res = await fetch(`/api/candidates/${candidateId}/bookmarks/send-to-job-tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: ids, dbType, targetAreas: ["首都圏"] }),
        });
        const data = await res.json();
        if (!res.ok) {
          problems.push(data.error || "送信に失敗しました");
          continue;
        }
        // uploadedCount=PDF送信分、linkedCount=サイト経由(PDF不要)分。両方を「移動」件数に含める。
        const n = (data.uploadedCount ?? 0) + (data.linkedCount ?? 0);
        sentCount += n || ids.length;
      }

      const moved = restoredCount + sentCount + alreadyActiveCount;
      if (moved === 0) {
        // 「押しても何も起きない」を無くす。理由が分かる形で必ず知らせる。
        toast.error(
          problems.length
            ? `求人紹介へ移動できませんでした。${problems.join(" / ")}`
            : "求人紹介へ移動できませんでした（対象の求人が求人ツール側に見つかりません）"
        );
      } else {
        const parts: string[] = [];
        if (restoredCount > 0) parts.push(`${restoredCount}件を復活`);
        if (sentCount > 0) parts.push(`${sentCount}件を新規送信`);
        if (alreadyActiveCount > 0) parts.push(`${alreadyActiveCount}件は既に有効`);
        toast.success(parts.join("、") + "しました");
        if (problems.length) toast.error(problems.join(" / "));
      }

      if (siteApply.length > 0) {
        toast.info(`サイト応募${siteApply.length}件は移動対象外です。「エントリーへ登録」から進めてください`);
      }

      setSelectedIds(new Set());
      fetchFiles();
      if (moved > 0) onSwitchToJobs?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setMovingToJobs(false);
    }
  };

  // サイト経由レコードを求人紹介を経由せずエントリー(JobEntry)へ直接登録する。
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [registeringEntry, setRegisteringEntry] = useState(false);
  const handleRegisterEntry = async (entryDate: string) => {
    if (selectedEntryRegistrableIds.length === 0) return;
    setRegisteringEntry(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/bookmarks/to-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: selectedEntryRegistrableIds, entryDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エントリー登録に失敗しました");
      const parts = [`${data.created ?? 0}件をエントリーに登録`];
      if (data.skipped > 0) parts.push(`${data.skipped}件はスキップ`);
      toast.success(parts.join("、") + "しました");
      // T-161: スキップを黙らせない。会社名と理由を必ず表示する（黙って消えると取りこぼしに気付けない）。
      const notes = (data.skippedDetails ?? []).map((d: { companyName: string; reason: string }) => `${d.companyName}（${d.reason}）`);
      if (notes.length > 0) toast.info(`スキップ: ${notes.join(" / ")}`, { duration: 8000 });
      setShowEntryModal(false);
      setSelectedIds(new Set());
      onEntryCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setRegisteringEntry(false);
    }
  };

  const toggleArea = (area: string) => {
    setSendAreas((prev) => {
      const n = new Set(prev);
      if (n.has(area)) n.delete(area); else if (n.size < 5) n.add(area);
      return n;
    });
  };

  const toggleGroup = (prefectures: readonly string[]) => {
    setSendAreas((prev) => {
      const n = new Set(prev);
      const allSelected = prefectures.every((p) => n.has(p));
      if (allSelected) {
        for (const p of prefectures) n.delete(p);
      } else {
        for (const p of prefectures) {
          if (!n.has(p) && n.size < 5) n.add(p);
        }
      }
      return n;
    });
  };

  const otherSelected = [...sendAreas].filter((a) =>
    OTHER_PREFECTURES.includes(a)
  );

  const filteredOtherPrefectures = OTHER_PREFECTURES.filter(
    (p) => !sendAreas.has(p) && p.includes(otherSearch)
  );

  return (
    <div
      className="bg-white rounded-lg border border-gray-200"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        if (e.dataTransfer.files?.length) uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Fixed header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[#374151]">📁 ブックマーク</h3>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {uploading ? `アップロード中 (${uploadProgress.current}/${uploadProgress.total})` : "+ アップロード"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt"
            onChange={(e) => { if (e.target.files?.length) uploadFiles(Array.from(e.target.files)); e.target.value = ""; }}
          />
        </div>
        <p className="text-[12px] text-gray-500">求人票PDFを保管します</p>

        {/* Select all + bulk delete */}
        {files.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            <label className="flex items-center gap-1.5 text-[13px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
              />
              全選択
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={unexportedAllChecked}
                onChange={toggleUnexported}
                className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
              />
              未出力を選択
            </label>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleBulkArchive}
                  disabled={bulkArchiving}
                  className="text-[13px] text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50"
                >
                  📦 紹介保留に移動（{selectedIds.size}件）
                </button>
                <button
                  onClick={handleBulkDownload}
                  disabled={bulkDownloading}
                  className="text-[13px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
                >
                  {bulkDownloading ? "⬇ ダウンロード中..." : `⬇ 一括DL（${selectedIds.size}件）`}
                </button>
                <button
                  onClick={() => { setSendResult(null); setSendStep(0); setSendDbType("hito_mynavi"); setSendAreas(new Set()); setOtherSearch(""); setShowOtherDropdown(false); setShowSendModal(true); }}
                  className="text-[13px] text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                >
                  📤 求人出力へ送信（{selectedIds.size}件）
                </button>
                <button
                  onClick={handleMoveToJobs}
                  disabled={movingToJobs}
                  className="text-[13px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
                >
                  {movingToJobs ? "📋 送信中..." : `📋 求人紹介へ移動（${selectedIds.size}件）`}
                </button>
                {selectedIntroducibleIds.length > 0 && (
                  <button
                    onClick={handleMarkIntroduced}
                    disabled={markingIntroduced}
                    className="text-[13px] text-teal-600 hover:text-teal-800 font-medium disabled:opacity-50"
                    title="求人票を出力せずに紹介済みにします（求人紹介一覧に載り、実績集計でも紹介に数えます。求人ツールへの送信は行いません）"
                  >
                    {markingIntroduced ? "✅ 処理中..." : `✅ 紹介済みにする（${selectedIntroducibleIds.length}件）`}
                  </button>
                )}
                {selectedEntryRegistrableIds.length > 0 && (
                  <button
                    onClick={() => setShowEntryModal(true)}
                    disabled={registeringEntry}
                    className="text-[13px] text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                    title="サイト応募（本人がマイページで応募した求人）と紹介済み（出力なし）の求人を、求人ツールを経由せずエントリー管理へ直接登録します"
                  >
                    {registeringEntry ? "➡ 登録中..." : `➡ エントリーへ登録（${selectedEntryRegistrableIds.length}件）`}
                  </button>
                )}
                {/* 社名コピー: エントリー管理（EntryBoard.tsx「社名をコピー」）と同一挙動。
                    区切りは改行、成功時 toast、失敗時は alert(names) にフォールバック。
                    BM側は会社名列がファイル名なので、抽出は T-146 の extractCompanyNameCandidates を再利用する
                    （先頭候補＝会社名コア。新規に正規表現は書き起こさない）。 */}
                <button
                  onClick={async () => {
                    const names = filteredFiles
                      .filter((f) => selectedIds.has(f.id))
                      .map((f) => extractCompanyNameCandidates(f.fileName)[0] ?? stripFileMetadata(f.fileName))
                      .join("\n");
                    try {
                      await navigator.clipboard.writeText(names);
                      toast.success(`${selectedIds.size}件の社名をコピーしました`);
                    } catch {
                      alert(names);
                    }
                  }}
                  className="text-[13px] text-gray-600 hover:text-gray-800 font-medium"
                  title="選択した行の会社名を改行区切りでコピーします"
                >
                  📋 社名コピー（{selectedIds.size}件）
                </button>
              </>
            )}
          </div>
        )}

        {/* Search + date filter */}
        {files.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 ファイル名で検索..."
                className="w-full border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
            <div className="relative">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {filterDate && (
                <button onClick={() => setFilterDate("")} className="absolute -right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
          </div>
        )}

        {/* Sort: 会社名軸の基準ボタン + 1次/2次チップバー（2段クロスソート, BM/Jobs 共用） */}
        {files.length > 0 && (
          <div className="flex items-start justify-between gap-3 mt-2">
            <div className="flex flex-col gap-1.5 min-w-0">
              <SortBasisButtons degreeOf={degreeOf} activateBasis={activateBasis} />
              <SortChipBar sortKeys={sortKeys} cycleKeyDir={cycleKeyDir} removeKey={removeKey} />
            </div>
            {/* 表示順/並び替えの行と評価内訳ブロックの間。狭いときは折り返して縮み、
                評価内訳ブロック（shrink-0）を潰さない。詳細の開閉とは連動せず常時表示。 */}
            {ratingSummary.total > 0 && (
              <div className="min-w-0 shrink">
                <RatingDonuts
                  summary={ratingSummary}
                  cols={ratingCols([
                    ratingSummary.overall,
                    ratingSummary.wish,
                    ratingSummary.pass,
                    ratingSummary.interested,
                    ratingSummary.applied,
                  ])}
                />
              </div>
            )}
            {/* 右端の位置は固定し、中身が増えたら左へ伸びる。幅は固定値にせず w-fit（RatingBreakdown 側）で中身なり。 */}
            <div className="shrink-0">
              <RatingBreakdown
                key={candidateId}
                summary={ratingSummary}
                filtering={Boolean(searchQuery || filterDate)}
                totalAll={files.length}
                archivedCount={archivedCount}
                onClearFilter={() => { setSearchQuery(""); setFilterDate(""); }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Drop zone hint */}
      {isDragging && (
        <div className="mx-4 my-3 border-2 border-dashed border-[#2563EB] bg-blue-50 rounded-lg p-6 text-center">
          <p className="text-[#2563EB] font-medium text-sm">ここにファイルをドロップしてアップロード</p>
        </div>
      )}

      {/* Table header */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[13px] font-medium text-gray-500 select-none">
          <span className="w-4 shrink-0" />
          <span className="w-[80px] shrink-0">DB名</span>
          <span className="w-[120px] shrink-0">DBNO</span>
          <span className="flex-1 min-w-0">会社名</span>
          <span onClick={() => activateBasis("wish")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${degreeOf("wish") ? "text-[#2563EB]" : ""}`}>
            希望<DirArrows dir={keyOf("wish")?.dir ?? null} /><OrderBadge n={degreeOf("wish")} />
          </span>
          <span onClick={() => activateBasis("pass")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${degreeOf("pass") ? "text-[#2563EB]" : ""}`}>
            通過<DirArrows dir={keyOf("pass")?.dir ?? null} /><OrderBadge n={degreeOf("pass")} />
          </span>
          <span onClick={() => activateBasis("overall")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${degreeOf("overall") ? "text-[#2563EB]" : ""}`}>
            総合<DirArrows dir={keyOf("overall")?.dir ?? null} /><OrderBadge n={degreeOf("overall")} />
          </span>
          {/* T-133 FU: 本人回答（CandidateFile.responseStatus）。
              並び替えは担当/紹介日と同じ2段クロスソート機構に response 基準として組み込む。
              順序定義は「応募したい順」ボタンと同じ responseRank(want) を流用（compareByBasis 参照）。 */}
          <span
            onClick={() => activateBasis("response")}
            className={`w-[84px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${degreeOf("response") ? "text-[#2563EB]" : ""}`}
            title="求職者本人がマイページで付けた回答（気になる/応募したい 等）"
          >
            本人回答
            <DirArrows dir={keyOf("response")?.dir ?? null} /><OrderBadge n={degreeOf("response")} />
          </span>
          <span
            onClick={() => activateBasis("uploader")}
            className={`w-[72px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${degreeOf("uploader") ? "text-[#2563EB]" : ""}`}
          >
            担当
            <DirArrows dir={keyOf("uploader")?.dir ?? null} /><OrderBadge n={degreeOf("uploader")} />
          </span>
          <span
            onClick={() => activateBasis("date")}
            className={`w-[68px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 whitespace-nowrap ${degreeOf("date") ? "text-[#2563EB]" : ""}`}
          >
            紹介日
            <DirArrows dir={keyOf("date")?.dir ?? null} /><OrderBadge n={degreeOf("date")} />
          </span>
          <span className="w-[100px] shrink-0" />
        </div>
      )}

      {/* Scrollable file list */}
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 && !isDragging ? (
          <div className="mx-4 my-4 border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-400">ファイルをドラッグ＆ドロップ、または「アップロード」ボタンをクリック</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFiles.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-gray-400">該当するファイルが見つかりません</div>
            ) : filteredFiles.map((file) => (
              <div key={file.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedIds.has(file.id)}
                  onChange={() => toggleSelect(file.id)}
                  className="w-4 h-3.5 shrink-0 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                {(() => {
                  // DB名: sourceMedia 優先 → externalJobRef 接頭辞判定。判定不能は「—」。
                  const dbName = resolveBookmarkMedia(file.sourceMedia, file.externalJobRef);
                  const ref = file.externalJobRef ?? null;
                  return (
                    <>
                      <span className="w-[80px] shrink-0 text-[11px] text-gray-600 truncate" title={dbName ?? undefined}>
                        {dbName ?? <span className="text-gray-300">—</span>}
                      </span>
                      <span className="w-[120px] shrink-0 text-[11px] truncate">
                        {ref ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenJobPlatformDetail(ref); }}
                            disabled={openingRef === ref}
                            className="text-blue-600 hover:text-blue-800 hover:underline truncate max-w-full text-left disabled:opacity-50 disabled:cursor-wait"
                            title={`${ref} — クリックで求人ページを開く`}
                          >{openingRef === ref ? "⏳ " : ""}{ref}</button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </span>
                    </>
                  );
                })()}
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="shrink-0 text-sm">{getFileIcon(file.mimeType)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                    className="text-[13px] font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                    title={file.fileName}
                  >{file.fileName}</button>
                  {file.extractedAt && <span className="shrink-0 text-[10px] text-green-500" title="テキスト化済">✅</span>}
                  {(() => {
                    const resp = findJobResponse(file.fileName);
                    return resp && RESPONSE_BADGE[resp] ? (
                      <span className={`shrink-0 text-[10px] rounded px-1.5 py-0 font-medium ${RESPONSE_BADGE[resp].cls}`}>
                        {RESPONSE_BADGE[resp].label}
                      </span>
                    ) : null;
                  })()}
                  {file.lastExportedAt && (
                    <span
                      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-100 text-green-800 border border-green-200"
                      title={`${file.lastExportedTo === "circus" ? "Circus" : "HITO-Link"} に送信済（${new Date(file.lastExportedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）`}
                    >出力済</span>
                  )}
                  {/* T-161: 出力なしの紹介済み。出力済とは別バッジ（出力済が立てばそちらが優先表示） */}
                  {!file.lastExportedAt && file.introducedAt && (
                    <span
                      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-teal-100 text-teal-800 border border-teal-200"
                      title={`求人票を出力せずに紹介済みにした求人（${new Date(file.introducedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）。実績集計では紹介に数えます`}
                    >紹介済み</span>
                  )}
                  {/* T-159 Phase 2-c: OneDrive に入っていない場合だけ出す（SUCCESS・ログ行なしは無音） */}
                  {(() => {
                    const od = oneDriveSyncBadge(file.oneDriveSyncLog, {
                      hasFileBody: file.driveFileId !== null,
                    });
                    return od ? (
                      <span
                        className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${od.cls}`}
                        title={od.title}
                      >{od.label}</span>
                    ) : null;
                  })()}
                </div>
                {(() => {
                  // サイト経由（PDF未保管）は AI評価対象外。空「—」だと「未分析」と紛らわしいので明示する。
                  const isSiteNoPdf = file.origin === "candidate" && !file.driveFileId;
                  if (isSiteNoPdf && !file.aiAnalysisComment) {
                    return (
                      <span
                        className="w-[168px] shrink-0 text-center text-[10px] text-gray-400"
                        title="PDF未保管のためAI評価対象外（サイト経由求人）"
                      >AI評価対象外</span>
                    );
                  }
                  const axis = parse3AxisRatings(file.aiAnalysisComment);
                  const badge = (v: string | undefined) => {
                    if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                    const s = RATING_STYLES[v];
                    return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
                  };
                  const onOpenAnalysis = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    openAnalysis(file);
                  };
                  return (
                    <>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={onOpenAnalysis}>{badge(axis?.wish)}</span>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={onOpenAnalysis}>{badge(axis?.pass)}</span>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={onOpenAnalysis}>{badge(axis?.overall || file.aiMatchRating || undefined)}</span>
                    </>
                  );
                })()}
                {(() => {
                  // T-133 FU: 求職者本人のマイページ回答（responseStatus）。UNANSWERED/null/不明は「—」。内部値は出さず日本語表示。
                  const b = file.responseStatus ? RESPONSE_STATUS_BADGE[file.responseStatus] : null;
                  return (
                    <span className="w-[84px] shrink-0 text-center">
                      {b ? (
                        <span className={`inline-flex items-center justify-center rounded px-1.5 py-0 text-[10px] font-medium ${b.cls}`}>{b.label}</span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </span>
                  );
                })()}
                {file.origin === "candidate" ? (
                  <span
                    className="w-[72px] shrink-0 text-[11px] text-emerald-600 font-medium truncate"
                    title="求職者がサイト（マイページ）から登録・応募した求人"
                  >サイト経由</span>
                ) : (
                  <span className="w-[72px] shrink-0 text-[11px] text-gray-500 truncate">{file.uploadedBy.name}</span>
                )}
                <span className="w-[68px] shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{shortDate(file.createdAt)}</span>
                <span className="w-[100px] shrink-0 flex items-center gap-0.5 justify-end">
                  {/* 案Z: PDF実体が無い行（driveFileId=null）はDLリンクを出さない */}
                  {file.driveFileId && (
                    <a
                      href={`https://drive.google.com/uc?export=download&id=${file.driveFileId}`}
                      download
                      className="text-gray-400 hover:text-gray-700 text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors"
                      title="ダウンロード"
                    >
                      ⬇
                    </a>
                  )}
                  {/* T-133 FU-1: 求職者本人のメモ（/site/ 由来）。CA画面では表示のみ。メモがある行だけアイコン表示。 */}
                  {file.candidateNote && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setNoteView({ fileName: file.fileName, note: file.candidateNote! });
                      }}
                      className="text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors text-amber-500 hover:text-amber-700"
                      title={`求職者メモ: ${file.candidateNote}`}
                    >
                      📝
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCaCommentEdit({ fileId: file.id, fileName: file.fileName });
                      setCaCommentText(file.caComment ?? "");
                    }}
                    className={`text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors ${file.caComment ? "text-blue-500 hover:text-blue-700" : "text-gray-400 hover:text-blue-600"}`}
                    title={file.caComment ? "CAコメントを編集（登録済み）" : "CAコメントを追加"}
                  >
                    {file.caComment ? "💬" : "🗨️"}
                  </button>
                  <button
                    onClick={() => handleArchive(file)}
                    disabled={archivingId === file.id}
                    className="text-gray-400 hover:text-amber-600 text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
                    title="紹介保留に移動"
                  >
                    📦
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send to job tool modal */}
      {showEntryModal && (
        <EntryDateModal
          count={selectedEntryRegistrableIds.length}
          onConfirm={handleRegisterEntry}
          onCancel={() => setShowEntryModal(false)}
        />
      )}

      {showSendModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseSend}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-bold text-[#374151]">📤 求人出力へ送信</h2>
              <button onClick={handleCloseSendModal} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>

            {sendResult ? (
              <div>
                {sendResult.success ? (
                  <div className="text-center py-4">
                    <p className="text-green-600 font-medium mb-3">✅ {sendResult.message}</p>
                    {sendResult.projectUrl && (
                      <a href={sendResult.projectUrl} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] hover:underline text-sm font-medium">
                        メモ編集・抽出へ進む →
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-red-600 text-sm py-4 text-center">{sendResult.message}</p>
                )}
                <button onClick={handleCloseSendModal} className="w-full mt-4 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50">閉じる</button>
              </div>
            ) : sending ? (
              <div className="py-4 space-y-2 text-[13px]">
                <p className="animate-pulse text-blue-600 font-semibold mb-3">📤 処理中...</p>
                {[
                  { step: 1, label: "プロジェクト確認" },
                  { step: 2, label: "PDFアップロード" },
                  { step: 3, label: "メモ作成" },
                  { step: 4, label: "抽出開始" },
                ].map(({ step, label }) => {
                  const done = sendStep >= step;
                  const active = !done && sendStep === step - 1;
                  return (
                    <div key={step} className="flex items-center gap-2">
                      {done ? (
                        <span className="text-green-500">✅</span>
                      ) : active ? (
                        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <span className="text-gray-300">⬜</span>
                      )}
                      <span className={active ? "text-blue-600 font-medium" : done ? "text-gray-700" : "text-gray-400"}>{label}{active ? "..." : ""}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">選択したPDF: {selectedIds.size}件</p>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-2">データベースタイプ</label>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="dbType" value="hito_mynavi" checked={sendDbType === "hito_mynavi"} onChange={() => setSendDbType("hito_mynavi")} className="accent-[#2563EB]" />
                      HITO-Link / マイナビ / Bee（自動処理）
                    </label>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="dbType" value="circus" checked={sendDbType === "circus"} onChange={() => setSendDbType("circus")} className="accent-[#2563EB]" />
                      Circus（手動処理）
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-2">
                    対象エリア（1〜5件選択）
                    <span className="ml-2 text-[12px] font-normal text-gray-500">{sendAreas.size}/5</span>
                  </label>
                  {sendAreas.size >= 5 && (
                    <p className="text-[11px] text-red-500 mb-2">最大5件まで選択可能です</p>
                  )}
                  <div className="space-y-2">
                    {AREA_GROUPS.map((group) => {
                      const allSelected = group.prefectures.every((p) => sendAreas.has(p));
                      const someSelected = !allSelected && group.prefectures.some((p) => sendAreas.has(p));
                      const wouldExceed = !allSelected && sendAreas.size + group.prefectures.filter((p) => !sendAreas.has(p)).length > 5;
                      return (
                        <div key={group.label}>
                          <label className="flex items-start gap-1.5 text-[13px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => { if (el) el.indeterminate = someSelected; }}
                              onChange={() => toggleGroup(group.prefectures)}
                              disabled={wouldExceed && !allSelected && !someSelected}
                              className="w-3.5 h-3.5 mt-0.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer disabled:opacity-50"
                            />
                            <span>
                              <span className="font-medium">{group.label}</span>
                              <span className="text-[11px] text-gray-500 ml-1">（{group.prefectures.join("・")}）</span>
                            </span>
                          </label>
                          <div className="ml-5 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            {group.prefectures.map((pref) => (
                              <label key={pref} className="flex items-center gap-1 text-[12px] cursor-pointer text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={sendAreas.has(pref)}
                                  onChange={() => toggleArea(pref)}
                                  disabled={!sendAreas.has(pref) && sendAreas.size >= 5}
                                  className="w-3 h-3 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer disabled:opacity-50"
                                />
                                {pref}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    <span className="text-[12px] font-medium text-gray-600">その他の都道府県</span>
                    {otherSelected.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1.5">
                        {otherSelected.map((pref) => (
                          <span key={pref} className="inline-flex items-center gap-1 bg-blue-50 text-[#2563EB] text-[12px] px-2 py-0.5 rounded-full border border-blue-200">
                            {pref}
                            <button onClick={() => toggleArea(pref)} className="hover:text-red-500 text-[10px] leading-none">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative mt-1">
                      <input
                        value={otherSearch}
                        onChange={(e) => { setOtherSearch(e.target.value); setShowOtherDropdown(true); }}
                        onFocus={() => setShowOtherDropdown(true)}
                        onBlur={() => setTimeout(() => setShowOtherDropdown(false), 200)}
                        placeholder="都道府県を検索..."
                        disabled={sendAreas.size >= 5}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50 disabled:bg-gray-50"
                      />
                      {showOtherDropdown && filteredOtherPrefectures.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-[150px] overflow-y-auto">
                          {filteredOtherPrefectures.map((pref) => (
                            <button
                              key={pref}
                              onClick={() => {
                                toggleArea(pref);
                                setOtherSearch("");
                                setShowOtherDropdown(false);
                              }}
                              disabled={sendAreas.size >= 5}
                              className="block w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-blue-50 hover:text-[#2563EB] disabled:opacity-50"
                            >
                              {pref}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={handleCloseSendModal} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50">キャンセル</button>
                  <button onClick={handleSendToJobTool} disabled={sendAreas.size === 0} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">送信開始</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PDF Preview popup */}
      {previewFile && previewFile.driveViewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" {...overlayClosePreview}>
          <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b bg-gray-50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(previewFile.id)}
                  onChange={() => toggleSelect(previewFile.id)}
                  className="w-4 h-4 rounded border-gray-300 text-[#2563EB] shrink-0"
                />
                <span className="text-[13px] font-medium truncate">{previewFile.fileName}</span>
                {previewFile.aiMatchRating && RATING_STYLES[previewFile.aiMatchRating] && (
                  <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-semibold border shrink-0 ${RATING_STYLES[previewFile.aiMatchRating]}`}>
                    {previewFile.aiMatchRating}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={getPreviewUrl(previewFile.driveViewUrl!)} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] text-blue-600 hover:underline">新しいタブで開く</a>
                <button onClick={() => setPreviewFile(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                src={getPreviewUrl(previewFile.driveViewUrl!)}
                className="w-full h-full border-0"
                title={previewFile.fileName}
              />
            </div>
          </div>
        </div>
      )}

      {/* Analysis comment modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" {...overlayCloseAnalysis}>
          {/* T-180: 長文の選考分析を読みやすくするため幅を拡大（スマホは従来どおりほぼ全幅） */}
          <div className="bg-white rounded-lg shadow-xl w-[92vw] max-w-5xl mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b bg-gray-50 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selectedAnalysis.rating && RATING_STYLES[selectedAnalysis.rating] && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${RATING_STYLES[selectedAnalysis.rating]}`}>
                    {RATING_LABELS[selectedAnalysis.rating]}
                  </span>
                )}
                <h3 className="font-semibold text-sm truncate">{selectedAnalysis.fileName}</h3>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 ml-2">
                {analysisNavFiles.length > 1 && (
                  <>
                    <button
                      onClick={() => gotoAnalysis(-1)}
                      disabled={analysisIndex <= 0}
                      title="前の求人（←キー）"
                      className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded px-1.5 py-1 text-sm leading-none transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                    >◀</button>
                    <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap px-0.5">
                      {analysisIndex + 1} / {analysisNavFiles.length}
                    </span>
                    <button
                      onClick={() => gotoAnalysis(1)}
                      disabled={analysisIndex < 0 || analysisIndex >= analysisNavFiles.length - 1}
                      title="次の求人（→キー）"
                      className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded px-1.5 py-1 text-sm leading-none transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                    >▶</button>
                  </>
                )}
                <button
                  onClick={() => { setSelectedAnalysis(null); setEditingComment(false); }}
                  className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded px-1.5 text-xl leading-none transition-colors"
                >✕</button>
              </div>
            </div>
            <div ref={analysisBodyRef} className="p-4 overflow-y-auto flex-1">
              <div className="font-mono text-sm mb-3 space-y-1">
                {(["wish", "pass", "overall"] as const).map((axis) => {
                  const label = axis === "wish" ? "本人希望：" : axis === "pass" ? "通過率　：" : "総合　　：";
                  const value = axis === "wish" ? wishRating : axis === "pass" ? passRating : overallRating;
                  const styleCls = value && RATING_STYLES[value]
                    ? RATING_STYLES[value]
                    : "bg-white text-gray-500 border-gray-300";
                  return (
                    <div key={axis} className="flex items-center">
                      <span className="whitespace-pre">{label}</span>
                      <select
                        value={value}
                        onChange={(e) => updateRatingMarker(axis, e.target.value)}
                        className={`ml-1 rounded border px-2 py-0.5 text-xs font-bold cursor-pointer ${styleCls}`}
                      >
                        <option value="">—</option>
                        <option value="A">A</option>
                        {/* B+ は総合のみ。本人希望・通過率は A/B/C/D の4段階（T-146） */}
                        {axis === "overall" && <option value="B+">B+</option>}
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              {editingComment ? (
                <textarea
                  value={editedCommentText}
                  onChange={(e) => setEditedCommentText(e.target.value)}
                  rows={16}
                  className="w-full text-sm text-gray-700 border border-gray-300 rounded p-3 focus:border-[#2563EB] focus:outline-none resize-none font-mono"
                />
              ) : (
                <AnalysisCommentBody comment={selectedAnalysis.comment} />
              )}
            </div>
            <div className="p-3 border-t flex justify-end gap-2 shrink-0">
              {editingComment ? (
                <>
                  <button
                    onClick={() => { setEditingComment(false); setEditedCommentText(""); }}
                    disabled={savingComment}
                    className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={async () => {
                      setSavingComment(true);
                      try {
                        const res = await fetch(`/api/candidates/${candidateId}/files/${selectedAnalysis.fileId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ aiAnalysisComment: editedCommentText }),
                        });
                        if (!res.ok) throw new Error();
                        const data = await res.json().catch(() => null);
                        const updatedRating: string | null = data?.file?.aiMatchRating ?? null;
                        toast.success("コメントを保存しました");
                        // Update local state (aiAnalysisComment + aiMatchRating sync)
                        setFiles((prev) => prev.map((f) => f.id === selectedAnalysis.fileId
                          ? { ...f, aiAnalysisComment: editedCommentText, aiMatchRating: updatedRating ?? f.aiMatchRating }
                          : f));
                        setSelectedAnalysis({ ...selectedAnalysis, comment: editedCommentText, rating: updatedRating ?? selectedAnalysis.rating });
                        setEditingComment(false);
                        setEditedCommentText("");
                      } catch {
                        toast.error("保存に失敗しました");
                      } finally {
                        setSavingComment(false);
                      }
                    }}
                    disabled={savingComment}
                    className="bg-[#2563EB] text-white rounded px-3 py-1 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {savingComment ? "保存中..." : "💾 保存"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditedCommentText(selectedAnalysis.comment); setEditingComment(true); }}
                    className="text-sm text-blue-600 hover:text-blue-800 px-2"
                  >
                    ✏️ 編集
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedAnalysis.comment);
                      toast.success("コピーしました");
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800 px-2"
                  >
                    📋 コピー
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive (紹介保留に移動) modal */}
      {archiveTarget && (
        <ArchiveModal
          count={archiveTarget.kind === "bulk" ? archiveTarget.ids.length : 1}
          fileName={archiveTarget.kind === "single" ? archiveTarget.file.fileName : undefined}
          onConfirm={handleArchiveConfirm}
          onCancel={() => setArchiveTarget(null)}
          busy={archivingId !== null || bulkArchiving}
        />
      )}

      {/* T-128 batch4: CAアドバイザーコメント編集モーダル */}
      {caCommentEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseCaComment}>
          <div className="bg-white rounded-xl max-w-lg w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] font-bold text-[#374151]">💬 CAコメント</h2>
              <button onClick={() => !caCommentSaving && setCaCommentEdit(null)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <p className="text-[12px] text-gray-500 mb-1 truncate" title={caCommentEdit.fileName}>{caCommentEdit.fileName}</p>
            <p className="text-[11px] text-gray-400 mb-3">求職者サイトの「担当CAのおすすめ」に表示されます。空にして保存すると削除されます。</p>
            <textarea
              value={caCommentText}
              onChange={(e) => setCaCommentText(e.target.value)}
              rows={6}
              placeholder="この求人をおすすめする理由やポイントを記入…"
              className="w-full text-sm text-gray-700 border border-gray-300 rounded p-3 focus:border-[#2563EB] focus:outline-none resize-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setCaCommentEdit(null)}
                disabled={caCommentSaving}
                className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={async () => {
                  setCaCommentSaving(true);
                  try {
                    const res = await fetch(`/api/candidates/${candidateId}/files/${caCommentEdit.fileId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ caComment: caCommentText }),
                    });
                    if (!res.ok) throw new Error();
                    const saved = caCommentText.trim() === "" ? null : caCommentText;
                    setFiles((prev) => prev.map((f) => f.id === caCommentEdit.fileId ? { ...f, caComment: saved } : f));
                    toast.success(saved ? "CAコメントを保存しました" : "CAコメントを削除しました");
                    setCaCommentEdit(null);
                  } catch {
                    toast.error("保存に失敗しました");
                  } finally {
                    setCaCommentSaving(false);
                  }
                }}
                disabled={caCommentSaving}
                className="bg-[#2563EB] text-white rounded px-3 py-1 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {caCommentSaving ? "保存中..." : "💾 保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* T-133 FU-1: 求職者メモ 閲覧モーダル（読み取り専用）。求職者サイトで本人が記入したメモ。 */}
      {noteView && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseNoteView}>
          <div className="bg-white rounded-xl max-w-lg w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] font-bold text-[#374151]">📝 求職者メモ</h2>
              <button onClick={() => setNoteView(null)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <p className="text-[12px] text-gray-500 mb-1 truncate" title={noteView.fileName}>{noteView.fileName}</p>
            <p className="text-[11px] text-gray-400 mb-3">求職者がマイページで記入したメモです（CA画面では閲覧のみ）。</p>
            <div className="w-full text-sm text-gray-700 border border-gray-200 bg-gray-50 rounded p-3 whitespace-pre-wrap break-words">{noteView.note}</div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setNoteView(null)}
                className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Archived Bookmark Section ---------- */
function ArchivedBookmarkSection({ candidateId, onCountChange }: { candidateId: string; onCountChange?: (count: number) => void }) {
  const [files, setFiles] = useState<BookmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"name" | "wish" | "pass" | "overall" | "archivedBy" | "archivedAt" | null>("archivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [permanentDeletingId, setPermanentDeletingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<BookmarkFile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BookmarkFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<BookmarkFile | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  // T-136: オーバーレイ誤クローズ防止
  const overlayCloseRestore = useOverlayClose(() => setConfirmRestore(null));
  const overlayCloseDelete = useOverlayClose(() => setConfirmDelete(null));
  const overlayCloseBulkDelete = useOverlayClose(() => { if (!bulkDeleting) setShowBulkDeleteConfirm(false); });
  const overlayClosePreview = useOverlayClose(() => setPreviewFile(null));

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK&archived=true`);
      if (res.ok) {
        const data = await res.json();
        const f = (data.files || []) as BookmarkFile[];
        setFiles(f);
        onCountChange?.(f.length);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [candidateId, onCountChange]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleRestore = async (file: BookmarkFile) => {
    setRestoringId(file.id);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/${file.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "復元に失敗しました");
      }
      toast.success("復元しました");
      setConfirmRestore(null);
      fetchFiles();
      window.dispatchEvent(new CustomEvent("bookmark-archived-changed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "復元に失敗しました");
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (file: BookmarkFile) => {
    setPermanentDeletingId(file.id);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/${file.id}/permanent`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "完全削除に失敗しました");
      }
      toast.success("完全削除しました");
      setConfirmDelete(null);
      fetchFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "完全削除に失敗しました");
    } finally {
      setPermanentDeletingId(null);
    }
  };

  const handleBulkRestore = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkRestoring(true);
    try {
      const results = await Promise.allSettled(
        ids.map((fileId) =>
          fetch(`/api/candidates/${candidateId}/files/${fileId}/restore`, { method: "POST" }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              throw new Error(data?.error || `failed: ${fileId}`);
            }
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      if (failed === 0) {
        toast.success(`${succeeded}件を復元しました`);
      } else if (succeeded === 0) {
        toast.error(`${failed}件すべての復元に失敗しました`);
      } else {
        toast.error(`${ids.length}件中${succeeded}件成功、${failed}件失敗`);
      }
      setSelectedIds(new Set());
      fetchFiles();
      window.dispatchEvent(new CustomEvent("bookmark-archived-changed"));
    } finally {
      setBulkRestoring(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((fileId) =>
          fetch(`/api/candidates/${candidateId}/files/${fileId}/permanent`, { method: "DELETE" }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              throw new Error(data?.error || `failed: ${fileId}`);
            }
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      if (failed === 0) {
        toast.success(`${succeeded}件を完全削除しました`);
      } else if (succeeded === 0) {
        toast.error(`${failed}件すべての削除に失敗しました`);
      } else {
        toast.error(`${ids.length}件中${succeeded}件成功、${failed}件失敗`);
      }
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      fetchFiles();
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };

  const handleSort = (field: "name" | "wish" | "pass" | "overall" | "archivedBy" | "archivedAt") => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir(field === "archivedAt" ? "desc" : "asc");
    }
  };

  const ratingOrder = RANK_ORDER;
  const filteredFiles = (() => {
    let result = files.filter((f) => {
      if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
    if (sortField) {
      const dir = sortDir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        if (sortField === "name") return a.fileName.localeCompare(b.fileName) * dir;
        if (sortField === "wish" || sortField === "pass" || sortField === "overall") {
          const axisA = parse3AxisRatings(a.aiAnalysisComment);
          const axisB = parse3AxisRatings(b.aiAnalysisComment);
          const key = sortField;
          const va = axisA ? (ratingOrder[axisA[key]] ?? RANK_UNRANKED) : RANK_UNRANKED;
          const vb = axisB ? (ratingOrder[axisB[key]] ?? RANK_UNRANKED) : RANK_UNRANKED;
          return (va - vb) * dir;
        }
        if (sortField === "archivedBy") {
          return (a.archivedBy?.name || "").localeCompare(b.archivedBy?.name || "") * dir;
        }
        if (sortField === "archivedAt") {
          const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
          const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
          return (ta - tb) * dir;
        }
        return 0;
      });
    }
    return result;
  })();

  const toggleAll = () => {
    const ids = filteredFiles.map((f) => f.id);
    if (ids.length === 0) return;
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.delete(id);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.add(id);
        return n;
      });
    }
  };

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));
  const someChecked = filteredFiles.some((f) => selectedIds.has(f.id)) && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  const shortDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  const reasonText = (file: BookmarkFile): string => {
    const r = file.archivedReason;
    const n = file.archivedNote;
    if (r && n) return `${r}: ${n}`;
    if (r) return r;
    if (n) return n;
    return "—";
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[#374151]">📦 紹介保留</h3>
          {files.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={selectedIds.size === 0 || bulkRestoring || bulkDeleting}
                className="text-[12px] text-blue-600 border border-blue-300 rounded-md px-3 py-1 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {bulkRestoring ? "復元中..." : `一括復元${selectedIds.size > 0 ? ` (${selectedIds.size}件)` : ""}`}
              </button>
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={selectedIds.size === 0 || bulkRestoring || bulkDeleting}
                className="text-[12px] text-red-600 border border-red-300 rounded-md px-3 py-1 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {`一括削除${selectedIds.size > 0 ? ` (${selectedIds.size}件)` : ""}`}
              </button>
            </div>
          )}
        </div>
        <p className="text-[12px] text-gray-500">紹介を保留にしたブックマークの一覧。復元または完全削除できます。</p>

        {files.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 ファイル名で検索..."
                className="w-full border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[11px] font-medium text-gray-500 select-none">
          <span className="w-[18px] shrink-0 flex items-center">
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="cursor-pointer"
              aria-label="全選択"
            />
          </span>
          <span
            onClick={() => handleSort("name")}
            className={`flex-1 min-w-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "name" ? "text-[#2563EB]" : ""}`}
          >
            会社名
            <SortIcon field="name" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("wish")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "wish" ? "text-[#2563EB]" : ""}`}>
            希望<SortIcon field="wish" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("pass")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "pass" ? "text-[#2563EB]" : ""}`}>
            通過<SortIcon field="pass" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("overall")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "overall" ? "text-[#2563EB]" : ""}`}>
            総合<SortIcon field="overall" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("archivedAt")}
            className={`w-[64px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 whitespace-nowrap ${sortField === "archivedAt" ? "text-[#2563EB]" : ""}`}
          >
            保留日
            <SortIcon field="archivedAt" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("archivedBy")}
            className={`w-[80px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "archivedBy" ? "text-[#2563EB]" : ""}`}
          >
            保留者
            <SortIcon field="archivedBy" current={sortField} dir={sortDir} />
          </span>
          <span className="w-[160px] shrink-0">保留理由</span>
          <span className="w-[110px] shrink-0" />
        </div>
      )}

      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-gray-400">紹介保留中のブックマークはありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFiles.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-gray-400">該当するファイルが見つかりません</div>
            ) : filteredFiles.map((file) => {
              const axis = parse3AxisRatings(file.aiAnalysisComment);
              const badge = (v: string | undefined) => {
                if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                const s = RATING_STYLES[v];
                return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
              };
              return (
                <div key={file.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors">
                  <span className="w-[18px] shrink-0 flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(file.id)}
                      onChange={() => toggleSelect(file.id)}
                      className="cursor-pointer"
                      aria-label="選択"
                    />
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="shrink-0 text-sm">📄</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                      className="text-[13px] font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                      title={file.fileName}
                    >{file.fileName}</button>
                  </div>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.wish)}</span>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.pass)}</span>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.overall || file.aiMatchRating || undefined)}</span>
                  <span className="w-[64px] shrink-0 text-[11px] text-gray-500 whitespace-nowrap">{shortDate(file.archivedAt)}</span>
                  <span className="w-[80px] shrink-0 text-[11px] text-gray-500 truncate">{file.archivedBy?.name || "—"}</span>
                  <span className="w-[160px] shrink-0 text-[11px] text-gray-600 truncate" title={reasonText(file)}>{reasonText(file)}</span>
                  <span className="w-[110px] shrink-0 flex items-center gap-1 justify-end">
                    <button
                      onClick={() => setConfirmRestore(file)}
                      disabled={restoringId === file.id}
                      className="text-[11px] text-blue-600 hover:text-blue-800 border border-blue-300 rounded px-2 py-0.5 hover:bg-blue-50 transition-colors disabled:opacity-50"
                      title="復元"
                    >
                      {restoringId === file.id ? "..." : "復元"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(file)}
                      disabled={permanentDeletingId === file.id}
                      className="text-[11px] text-red-600 hover:text-red-800 border border-red-300 rounded px-2 py-0.5 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="完全削除"
                    >
                      {permanentDeletingId === file.id ? "..." : "削除"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Restore confirm modal */}
      {confirmRestore && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseRestore}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-[#374151] mb-3">紹介保留から復元</h2>
            <p className="text-sm text-gray-600 mb-4"><span className="font-medium">{confirmRestore.fileName}</span> をブックマークに復元します。</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRestore(null)} disabled={restoringId === confirmRestore.id} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                disabled={restoringId === confirmRestore.id}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {restoringId === confirmRestore.id ? "復元中..." : "復元する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseDelete}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-red-600 mb-3">⚠️ 完全削除</h2>
            <div className="text-sm text-gray-700 mb-4 space-y-2">
              <p><span className="font-medium">{confirmDelete.fileName}</span> を完全に削除します。</p>
              <p className="text-red-600 font-medium">DB と Google Drive から完全に削除されます。元に戻せません。本当に削除しますか？</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={permanentDeletingId === confirmDelete.id} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              <button
                onClick={() => handlePermanentDelete(confirmDelete)}
                disabled={permanentDeletingId === confirmDelete.id}
                className="flex-1 bg-red-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {permanentDeletingId === confirmDelete.id ? "削除中..." : "完全削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" {...overlayCloseBulkDelete}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-red-600 mb-3">⚠️ 一括削除</h2>
            <div className="text-sm text-gray-700 mb-4 space-y-2">
              <p>選択した <span className="font-medium">{selectedIds.size}件</span> の紹介保留を削除します。よろしいですか？</p>
              <p className="text-red-600 font-medium">DB と Google Drive から完全に削除されます。元に戻せません。</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={bulkDeleting}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleBulkDeleteConfirm}
                disabled={bulkDeleting}
                className="flex-1 bg-red-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview popup */}
      {previewFile && previewFile.driveViewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" {...overlayClosePreview}>
          <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b bg-gray-50 shrink-0">
              <span className="text-[13px] font-medium truncate">{previewFile.fileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <a href={getPreviewUrl(previewFile.driveViewUrl!)} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] text-blue-600 hover:underline">新しいタブで開く</a>
                <button onClick={() => setPreviewFile(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe src={getPreviewUrl(previewFile.driveViewUrl!)} className="w-full h-full border-0" title={previewFile.fileName} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
export default function HistoryTab({ candidateId, candidateName, initialSubTab }: { candidateId: string; candidateName?: string; initialSubTab?: "bookmark" | "jobs" | "entries" | "archived" }) {
  const [activeSubTab, setActiveSubTab] = useState<"bookmark" | "jobs" | "entries" | "archived">(initialSubTab ?? "bookmark");
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);

  // Jobs state
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState<number[]>([]);
  const [jobDeleting, setJobDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [responseFilter, setResponseFilter] = useState<"ALL" | "WANT_TO_APPLY" | "INTERESTED" | "NONE">("ALL");
  // 求人紹介(Jobs)の2段クロスソート（BM と独立の sortKeys）。初期表示は紹介日 降順。
  const {
    sortKeys: jobSortKeys,
    keyOf: jobKeyOf,
    degreeOf: jobDegreeOf,
    activateBasis: jobActivateBasis,
    cycleKeyDir: jobCycleKeyDir,
    removeKey: jobRemoveKey,
  } = useCrossSort([{ basis: "date", dir: "desc" }]);

  // Entries state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [bulkReverting, setBulkReverting] = useState(false);

  // Bookmark ratings for cross-referencing with jobs
  const [bookmarkRatings, setBookmarkRatings] = useState<Map<string, { wish: string; pass: string; overall: string }>>(new Map());

  // 修正2: 求人紹介一覧の並び替えでも本人回答を優先するため、ブックマーク側の responseStatus を
  // 会社名キー（bookmarkRatings と同一の正規化）で引けるようにする。取得は fetchBookmarkRatings に相乗り（追加リクエストなし）。
  const [bookmarkResponses, setBookmarkResponses] = useState<Map<string, string>>(new Map());

  // T-128 Phase2-1: エントリー化時に jobDb/externalJobNo を正値化するためのブックマーク由来ソース情報。
  //   key = 会社名の正規化キー（fetchBookmarkRatings と同じルールを使う。厳密1:1にならないケースはあるが
  //   job-platform 経由は現状100% HITO-Link のため、同一会社複数求人は同じ jobDb になる）。
  const [bookmarkSourceMap, setBookmarkSourceMap] = useState<Map<string, { sourceType: string | null; externalJobRef: string | null; sourceMedia: string | null }>>(new Map());

  // Derive entered external job ids for cross-referencing
  const enteredJobIds = new Set(entries.map((e) => e.externalJobId));
  // T-161: portal 由来行（site/introduced）は externalJobId を持たないため、求人参照キーで判定する。
  const enteredJobRefs = new Set(entries.map((e) => e.externalJobRef).filter(Boolean) as string[]);
  const isJobEntered = (j: Job) =>
    j.source === "site" || j.source === "introduced"
      ? !!j.external_job_ref && enteredJobRefs.has(j.external_job_ref)
      : enteredJobIds.has(j.id);

  // Job candidate responses for cross-referencing with bookmarks
  const jobResponseMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!jobsData?.jobs) return map;
    for (const job of jobsData.jobs) {
      if (!job.candidate_response) continue;
      const cn = normalize(stripCorpSuffixes(job.company_name));
      if (cn) map.set(cn, job.candidate_response);
    }
    return map;
  }, [jobsData]);

  /* ---------- Fetch ---------- */
  const fetchBookmarkRatings = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, { wish: string; pass: string; overall: string }>();
      // T-128 Phase2-1: sourceType/externalJobRef/sourceMedia も同じ正規化キーで別マップに保持。
      const srcMap = new Map<string, { sourceType: string | null; externalJobRef: string | null; sourceMedia: string | null }>();
      // 修正2: 本人回答（responseStatus）の会社名別マップ。意向として意味のある値だけ入れる
      //（UNANSWERED 等で実回答を上書きしない＝未登録なら従来値へフォールバックできる）。
      const respMap = new Map<string, string>();
      for (const f of data.files || []) {
        const key = normalize(
          (f.fileName as string)
            .replace(/\.pdf$/i, "")
            .replace(/^求人票[_]?/, "")
            .replace(/_\d{10,}$/, "")
            .replace(/株式会社|有限会社|合同会社/g, "")
            .trim()
        );
        const axis = parse3AxisRatings(f.aiAnalysisComment);
        if (key && axis) map.set(key, axis);
        if (key && normalizeResponseIntent(f.responseStatus as string | null)) {
          respMap.set(key, f.responseStatus as string);
        }
        // sourceType が来ている行だけソースマップに登録（job-platform 由来を優先し、上書きしない）。
        if (key && f.sourceType) {
          const prev = srcMap.get(key);
          if (!prev || prev.sourceType !== "job-platform") {
            srcMap.set(key, {
              sourceType: (f.sourceType as string) ?? null,
              externalJobRef: (f.externalJobRef as string) ?? null,
              sourceMedia: (f.sourceMedia as string) ?? null,
            });
          }
        }
      }
      setBookmarkRatings(map);
      setBookmarkResponses(respMap);
      setBookmarkSourceMap(srcMap);
    } catch { /* silent */ }
  }, [candidateId]);

  const findBookmarkRating = useCallback((companyName: string) => {
    const cn = normalize(companyName.replace(/株式会社|有限会社|合同会社/g, "").trim());
    for (const [key, axis] of bookmarkRatings) {
      if (key.includes(cn) || cn.includes(key)) return axis;
    }
    return null;
  }, [bookmarkRatings]);

  // 修正2: 会社名からブックマーク側の本人回答（responseStatus）を引く。照合規則は findBookmarkRating と同一。
  const findBookmarkResponse = useCallback((companyName: string): string | null => {
    const cn = normalize(companyName.replace(/株式会社|有限会社|合同会社/g, "").trim());
    if (!cn) return null;
    for (const [key, resp] of bookmarkResponses) {
      if (key.includes(cn) || cn.includes(key)) return resp;
    }
    return null;
  }, [bookmarkResponses]);

  // T-128 Phase2-1: 会社名からブックマークの sourceType/externalJobRef/sourceMedia を引く。
  //   fetchBookmarkRatings と同一の正規化ルール（法人格除去 + 部分一致）。job-platform 由来が優先。
  const findBookmarkSource = useCallback((companyName: string) => {
    const cn = normalize(companyName.replace(/株式会社|有限会社|合同会社/g, "").trim());
    // 完全一致優先
    const exact = bookmarkSourceMap.get(cn);
    if (exact) return exact;
    for (const [key, src] of bookmarkSourceMap) {
      if (key.includes(cn) || cn.includes(key)) return src;
    }
    return null;
  }, [bookmarkSourceMap]);

  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/jobs`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `エラー (${res.status})`);
      }
      const data: JobsResponse = await res.json();
      setJobsData(data);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setJobsLoading(false);
    }
  }, [candidateId]);

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/entries`);
      if (!res.ok) throw new Error("エントリーの取得に失敗しました");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setEntriesLoading(false);
    }
  }, [candidateId]);

  const fetchArchivedCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK&archived=true`);
      if (!res.ok) return;
      const data = await res.json();
      setArchivedCount((data.files || []).length);
    } catch { /* silent */ }
  }, [candidateId]);

  useEffect(() => {
    fetchJobs();
    fetchEntries();
    fetchBookmarkRatings();
    fetchArchivedCount();
  }, [fetchJobs, fetchEntries, fetchBookmarkRatings, fetchArchivedCount]);

  useEffect(() => {
    const handler = () => fetchArchivedCount();
    window.addEventListener("bookmark-archived-changed", handler);
    return () => window.removeEventListener("bookmark-archived-changed", handler);
  }, [fetchArchivedCount]);

  useEffect(() => {
    const handler = () => fetchBookmarkRatings();
    window.addEventListener("bookmark-ratings-updated", handler);
    return () => window.removeEventListener("bookmark-ratings-updated", handler);
  }, [fetchBookmarkRatings]);

  /* ---------- Handlers ---------- */
  const toggleJobSelection = (jobId: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const selectableJobIds = (jobsData?.jobs || [])
    .filter((j) => !isJobEntered(j))
    .map((j) => j.id);

  const allSelectableChecked =
    selectableJobIds.length > 0 &&
    selectableJobIds.every((id) => selectedJobIds.has(id));

  const handleToggleAll = () => {
    if (allSelectableChecked) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(selectableJobIds));
    }
  };

  const handleEntrySubmit = async (entryDate: string) => {
    if (!jobsData) return;
    setSubmitting(true);

    const allSelected = jobsData.jobs.filter((j) => selectedJobIds.has(j.id));
    // T-161 R3: portal 由来行（site/introduced・id 負数）は kyuujin の求人IDを持たないため、
    // 従来の POST /entries ではなく to-entry（fileIds 指定）で登録する。kyuujin 行は従来どおり。
    const selectedJobs = allSelected.filter((j) => j.source !== "site" && j.source !== "introduced");
    const portalJobs = allSelected.filter((j) => (j.source === "site" || j.source === "introduced") && j.file_id);
    const payload = {
      entries: selectedJobs.map((j) => {
        // T-128 Phase2-1: 元ブックマークが job-platform 由来なら jobDb/externalJobNo を正値化する。
        //   kyuujinPDF は job_db='マイナビJOB'/job_id=内部連番 で返してくるが、
        //   実体は HITO-Link 等（sourceMedia）+ 元求人番号（externalJobRef 末尾数字）が正。
        const src = findBookmarkSource(j.company_name);
        const overrideDb = src ? resolveJobDbFromBookmark(src.sourceType, src.sourceMedia) : null;
        const overrideNo = src?.sourceType === "job-platform"
          ? extractJobNoFromRef(src.externalJobRef)
          : null;
        return {
          externalJobId: j.id,
          externalJobNo: overrideNo ?? j.job_id,
          companyName: j.company_name,
          jobTitle: j.job_title,
          jobDb: overrideDb ?? j.job_db,
          // job-platform 由来なら jobType は媒体別選択肢に合わないため null にリセット（後で CA が選択）。
          jobType: overrideDb ? null : j.job_type,
          jobCategory: j.job_category,
          workLocation: j.work_location,
          salary: j.salary,
          overtime: j.overtime,
          areaMatch: j.area_match,
          transfer: j.transfer,
          originalUrl: j.original_url,
          introducedAt: j.created_at,
        };
      }),
      entryDate,
    };

    try {
      let created = 0;
      let skipped = 0;
      const skippedNotes: string[] = [];

      if (selectedJobs.length > 0) {
        const res = await fetch(`/api/candidates/${candidateId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("エントリーの登録に失敗しました");
        const data = await res.json();
        created += data.created ?? 0;
        skipped += data.skipped ?? 0;
      }

      // T-161: portal 由来行は to-entry で登録。スキップは黙らせず理由つきで表示する。
      if (portalJobs.length > 0) {
        const res = await fetch(`/api/candidates/${candidateId}/bookmarks/to-entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: portalJobs.map((j) => j.file_id), entryDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "エントリーの登録に失敗しました");
        created += data.created ?? 0;
        skipped += data.skipped ?? 0;
        for (const d of data.skippedDetails ?? []) {
          skippedNotes.push(`${d.companyName}（${d.reason}）`);
        }
      }

      if (skipped > 0) {
        toast.success(`${created}件登録、${skipped}件はスキップ`);
        if (skippedNotes.length > 0) toast.info(`スキップ: ${skippedNotes.join(" / ")}`, { duration: 8000 });
      } else {
        toast.success(`${created}件のエントリーを登録しました`);
      }

      setSelectedJobIds(new Set());
      setShowEntryModal(false);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm("このエントリーを削除します。よろしいですか？")) return;
    setDeletingId(entryId);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("削除に失敗しました");
      toast.success("エントリーを削除しました");
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateEntryDate = async (entryId: string, newDate: string) => {
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryDate: newDate }),
        }
      );
      if (!res.ok) throw new Error("更新に失敗しました");
      toast.success("エントリー日を更新しました");
      setEditingEntryId(null);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました");
    }
  };

  const handleRevertEntry = async (entryId: string) => {
    if (!confirm("このエントリーを求人紹介に戻しますか？")) return;
    setRevertingId(entryId);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/revert-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryIds: [entryId] }),
        }
      );
      if (!res.ok) throw new Error("戻す処理に失敗しました");
      toast.success("求人紹介に戻しました");
      fetchEntries();
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "戻す処理に失敗しました");
    } finally {
      setRevertingId(null);
    }
  };

  const handleBulkRevertEntries = async () => {
    if (selectedEntryIds.size === 0) return;
    if (!confirm(`${selectedEntryIds.size}件を求人紹介に戻しますか？`)) return;
    setBulkReverting(true);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/revert-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryIds: Array.from(selectedEntryIds) }),
        }
      );
      if (!res.ok) throw new Error("一括戻す処理に失敗しました");
      const data = await res.json();
      toast.success(data.message || `${selectedEntryIds.size}件を求人紹介に戻しました`);
      setSelectedEntryIds(new Set());
      fetchEntries();
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "一括戻す処理に失敗しました");
    } finally {
      setBulkReverting(false);
    }
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const toggleAllEntries = () => {
    if (selectedEntryIds.size === filteredEntries.length) {
      setSelectedEntryIds(new Set());
    } else {
      setSelectedEntryIds(new Set(filteredEntries.map((e) => e.id)));
    }
  };

  /* ---------- Job Delete Handlers ---------- */
  const openDeleteModal = (jobIds: number[]) => {
    // T-161: portal 由来行（id 負数）は hidden_job_introductions（kyuujin 求人ID前提）で消せないため除外。
    // ブックマークタブ側（紹介保留・アーカイブ）で管理する。
    const kyuujinIds = jobIds.filter((id) => id > 0);
    if (kyuujinIds.length === 0) {
      toast.info("本人応募・紹介済みの行はここでは削除できません（ブックマークタブで操作してください）");
      return;
    }
    if (kyuujinIds.length < jobIds.length) {
      toast.info(`本人応募・紹介済みの${jobIds.length - kyuujinIds.length}件は削除対象から除外しました`);
    }
    setDeleteTargetIds(kyuujinIds);
    setShowDeleteModal(true);
  };

  const handleDeleteJobs = async () => {
    if (deleteTargetIds.length === 0) return;
    setJobDeleting(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/job-introductions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: deleteTargetIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "削除に失敗しました");
      }
      const data = await res.json();
      if (data.deleted_count > 0) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
      setSelectedJobIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTargetIds) next.delete(id);
        return next;
      });
      setShowDeleteModal(false);
      setDeleteTargetIds([]);
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setJobDeleting(false);
    }
  };

  const deleteSkippedCount = deleteTargetIds.filter((id) => enteredJobIds.has(id)).length;

  /* ---------- Render ---------- */
  const allJobs = jobsData?.jobs || [];
  const totalJobs = jobsData?.total_jobs ?? 0;

  // Jobs の基準別値取得（accessor）。会社名=company_name、ランク=BM評価のクロス参照(findBookmarkRating)、
  // 応募状況=candidate_response（行に直接）、紹介日=created_at。担当列は無いため getUploader 省略。
  const jobAccessors: SortAccessors<Job> = {
    getCompanyName: (j) => j.company_name,
    getRank: (j, axis) => findBookmarkRating(j.company_name)?.[axis] ?? null,
    // 修正2: ブックマーク側の本人回答を優先し、無ければ従来値（行の candidate_response）へフォールバック。
    getResponse: (j) => resolveResponseForSort(findBookmarkResponse(j.company_name), j.candidate_response),
    getDate: (j) => j.created_at,
  };

  const jobs = (() => {
    let result = allJobs;
    if (jobSearch) {
      result = result.filter((j) => normalize(j.company_name).includes(normalize(jobSearch)));
    }
    if (responseFilter !== "ALL") {
      result = responseFilter === "NONE"
        ? result.filter((j) => !j.candidate_response)
        : result.filter((j) => j.candidate_response === responseFilter);
    }
    return [...result].sort(makeCompositeComparator(jobSortKeys, jobAccessors));
  })();
  const filteredEntries = entrySearch
    ? entries.filter((e) => normalize(e.companyName).includes(normalize(entrySearch)))
    : entries;

  return (
    <div className="min-w-0">
      {/* サブタブバー */}
      <div className="bg-gray-50 rounded-lg p-1 inline-flex gap-1 mb-6">
        <button
          onClick={() => setActiveSubTab("bookmark")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "bookmark"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          ブックマーク
          {bookmarkCount > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({bookmarkCount})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("jobs")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "jobs"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          求人紹介
          {totalJobs > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({totalJobs})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("entries")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "entries"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          エントリー
          {entries.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({entries.length})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("archived")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "archived"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          紹介保留
          {archivedCount > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({archivedCount})</span>
          )}
        </button>
      </div>

      {/* ===== ブックマークサブタブ ===== */}
      {activeSubTab === "bookmark" && (
        <BookmarkSection candidateId={candidateId} jobResponseMap={jobResponseMap} archivedCount={archivedCount} onCountChange={setBookmarkCount} onSwitchToJobs={() => { setActiveSubTab("jobs"); fetchJobs(); }} onArchivedChange={fetchArchivedCount} onEntryCreated={fetchEntries} />
      )}

      {/* ===== 紹介保留サブタブ ===== */}
      {activeSubTab === "archived" && (
        <ArchivedBookmarkSection candidateId={candidateId} onCountChange={setArchivedCount} />
      )}

      {/* ===== 求人紹介サブタブ ===== */}
      {activeSubTab === "jobs" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 min-w-0">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              抽出結果（{jobSearch ? `${jobs.length}件 / ${totalJobs}件` : `${totalJobs}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {jobSearch && (
                <button
                  onClick={() => setJobSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
            <select
              value={responseFilter}
              onChange={(e) => setResponseFilter(e.target.value as typeof responseFilter)}
              className="border border-gray-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="ALL">全て</option>
              <option value="WANT_TO_APPLY">応募したい</option>
              <option value="INTERESTED">気になる</option>
              <option value="NONE">未回答</option>
            </select>
            {selectableJobIds.length > 0 && (
              <button
                onClick={handleToggleAll}
                className="text-[13px] text-gray-500 hover:text-[#2563EB] transition-colors"
              >
                {allSelectableChecked ? "☑ 全解除" : "☐ 全選択"}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {selectedJobIds.size > 0 && (
                <button
                  onClick={() => openDeleteModal(Array.from(selectedJobIds))}
                  disabled={jobDeleting}
                  className="border border-red-400 text-red-500 rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🗑 選択を削除（{selectedJobIds.size}件）
                </button>
              )}
              <button
                onClick={() => setShowEntryModal(true)}
                disabled={selectedJobIds.size === 0 || submitting}
                className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ☑ 選択してエントリー
                {selectedJobIds.size > 0 && ` (${selectedJobIds.size})`}
              </button>
            </div>
          </div>

          {/* Sort: 会社名軸の基準ボタン + 1次/2次チップバー（BM と同一・共用コンポーネント） */}
          {allJobs.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-4">
              <SortBasisButtons degreeOf={jobDegreeOf} activateBasis={jobActivateBasis} />
              <SortChipBar sortKeys={jobSortKeys} cycleKeyDir={jobCycleKeyDir} removeKey={jobRemoveKey} />
            </div>
          )}

          {/* コンテンツ */}
          {jobsLoading ? (
            <SkeletonCards />
          ) : jobsError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{jobsError}</div>
          ) : allJobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              この求職者の求人紹介データはまだありません
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当する求人が見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto overflow-x-hidden min-w-0"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              {/* 列ヘッダー */}
              <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[11px] font-medium text-gray-500 select-none min-w-0">
                <span className="w-4 shrink-0" />
                <span className="flex-1 min-w-0">会社名</span>
                <span onClick={() => jobActivateBasis("wish")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobDegreeOf("wish") ? "text-[#2563EB]" : ""}`}>
                  希望<DirArrows dir={jobKeyOf("wish")?.dir ?? null} /><OrderBadge n={jobDegreeOf("wish")} />
                </span>
                <span onClick={() => jobActivateBasis("pass")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobDegreeOf("pass") ? "text-[#2563EB]" : ""}`}>
                  通過<DirArrows dir={jobKeyOf("pass")?.dir ?? null} /><OrderBadge n={jobDegreeOf("pass")} />
                </span>
                <span onClick={() => jobActivateBasis("overall")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobDegreeOf("overall") ? "text-[#2563EB]" : ""}`}>
                  総合<DirArrows dir={jobKeyOf("overall")?.dir ?? null} /><OrderBadge n={jobDegreeOf("overall")} />
                </span>
                <span className="w-[72px] shrink-0">DB</span>
                <span onClick={() => jobActivateBasis("date")}
                  className={`w-[52px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 whitespace-nowrap ${jobDegreeOf("date") ? "text-[#2563EB]" : ""}`}>
                  紹介日<DirArrows dir={jobKeyOf("date")?.dir ?? null} /><OrderBadge n={jobDegreeOf("date")} />
                </span>
                <span className="w-[28px] shrink-0" />
              </div>
              <div className="divide-y divide-gray-100">
                {jobs.map((job) => {
                  const isEntered = isJobEntered(job);
                  const isSelected = selectedJobIds.has(job.id);
                  // T-161 R3: portal 由来行（本人応募/紹介済み・未出力）。kyuujin 前提の操作（非表示削除）は不可。
                  const isPortalRow = job.source === "site" || job.source === "introduced";
                  const axis = findBookmarkRating(job.company_name);
                  const badge = (v: string | undefined) => {
                    if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                    const s = RATING_STYLES[v];
                    return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
                  };

                  return (
                    <div
                      key={job.id}
                      className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-50 min-w-0 ${
                        isSelected ? "bg-blue-50/40" : ""
                      }`}
                    >
                      {isEntered ? (
                        <span className="w-4 shrink-0 text-xs text-gray-400 text-center">済</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleJobSelection(job.id)}
                          className="shrink-0 w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                        />
                      )}
                      <div className="flex-1 min-w-0 group/job relative">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13px] font-medium text-[#374151] truncate">{job.company_name}</span>
                          {/* T-161 R3: 出所バッジ。本人応募（サイト経由）と出力なし紹介済みを kyuujin 行と見分ける */}
                          {job.source === "site" && (
                            <span className="shrink-0 text-[10px] rounded px-1.5 py-0 font-medium bg-purple-100 text-purple-700" title="求職者本人が求人サイトで見つけて応募・気になるした求人（CA紹介実績には数えません）">
                              本人応募
                            </span>
                          )}
                          {job.source === "introduced" && (
                            <span className="shrink-0 text-[10px] rounded px-1.5 py-0 font-medium bg-teal-100 text-teal-700" title="求人票を出力せずに紹介済みにした求人（CA紹介実績に数えます）">
                              紹介済み
                            </span>
                          )}
                          {job.candidate_response && RESPONSE_BADGE[job.candidate_response] && (
                            <span className={`shrink-0 text-[10px] rounded px-1.5 py-0 font-medium ${RESPONSE_BADGE[job.candidate_response].cls}`}>
                              {RESPONSE_BADGE[job.candidate_response].label}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 truncate">{job.job_title}</p>
                      </div>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.wish)}</span>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.pass)}</span>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.overall)}</span>
                      <span className="w-[72px] shrink-0 text-[11px] text-gray-500 truncate">{job.job_db || "—"}</span>
                      <span className="w-[52px] shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{formatDateJST(job.created_at).slice(5)}</span>
                      {!isEntered && !isPortalRow ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeleteModal([job.id]); }}
                          className="w-[28px] shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
                          title="紹介リストから削除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      ) : <span className="w-[28px] shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== エントリーサブタブ ===== */}
      {activeSubTab === "entries" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              エントリー一覧（{entrySearch ? `${filteredEntries.length}件 / ${entries.length}件` : `${entries.length}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {entrySearch && (
                <button
                  onClick={() => setEntrySearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
            {selectedEntryIds.size > 0 && (
              <button
                onClick={handleBulkRevertEntries}
                disabled={bulkReverting}
                className="shrink-0 rounded-md bg-amber-50 border border-amber-300 px-3 py-1 text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                {bulkReverting ? "処理中..." : `選択を求人紹介に戻す（${selectedEntryIds.size}件）`}
              </button>
            )}
            <a
              href={`/entries${candidateName ? `?candidateName=${encodeURIComponent(candidateName)}` : ""}`}
              className="shrink-0 ml-auto text-[12px] text-[#2563EB] hover:underline"
            >
              エントリー管理画面へ &rarr;
            </a>
          </div>

          {/* コンテンツ */}
          {entriesLoading ? (
            <SkeletonCards />
          ) : entriesError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{entriesError}</div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              エントリーはまだありません。求人紹介タブから求人を選択してエントリーできます。
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当するエントリーが見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              {/* 全選択 */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <input
                  type="checkbox"
                  checked={filteredEntries.length > 0 && selectedEntryIds.size === filteredEntries.length}
                  onChange={toggleAllEntries}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                />
                <span className="text-[12px] text-gray-500">全選択</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-3 hover:shadow-sm transition-shadow ${selectedEntryIds.has(entry.id) ? "border-amber-300 bg-amber-50/30" : "border-gray-200"}`}
                  >
                    {/* 1行目: チェックボックス + 会社名 + バッジ + DB/タイプ */}
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.has(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      <span className="font-semibold text-sm text-[#374151] truncate">
                        {entry.companyName}
                      </span>
                      {entry.jobCategory && (
                        <span className="shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                          {entry.jobCategory}
                        </span>
                      )}
                      <span className="shrink-0 ml-auto text-xs text-gray-400">
                        {[entry.jobDb, entry.jobType].filter(Boolean).join(" / ")}
                      </span>
                    </div>
                    {/* 2行目: 求人タイトル + エントリー日/紹介日 + 削除 */}
                    <div className="flex items-start justify-between gap-3 mt-1">
                      <p className="text-sm text-gray-700 line-clamp-2 min-w-0">
                        {entry.jobTitle}
                      </p>
                      <div className="shrink-0 flex items-center gap-2 pt-0.5">
                        <span className="text-xs font-medium text-[#374151]">
                          エントリー日:{" "}
                          {editingEntryId === entry.id ? (
                            <input
                              type="date"
                              value={editingDate}
                              onChange={(e) => setEditingDate(e.target.value)}
                              onBlur={() => {
                                if (editingDate && editingDate !== toInputDate(entry.entryDate)) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else {
                                  setEditingEntryId(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editingDate) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else if (e.key === "Escape") {
                                  setEditingEntryId(null);
                                }
                              }}
                              autoFocus
                              className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingEntryId(entry.id);
                                setEditingDate(toInputDate(entry.entryDate));
                              }}
                              className="hover:text-[#2563EB] hover:underline transition-colors"
                            >
                              {formatDateJST(entry.entryDate)}
                            </button>
                          )}
                        </span>
                        <span className="text-xs text-gray-400">
                          (紹介日: {formatDateJST(entry.introducedAt)})
                        </span>
                        <button
                          onClick={() => handleRevertEntry(entry.id)}
                          disabled={revertingId === entry.id}
                          className="text-xs text-amber-600 hover:text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-50 transition-colors disabled:opacity-50"
                          title="求人紹介に戻す"
                        >
                          {revertingId === entry.id ? "..." : "戻す"}
                        </button>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          disabled={deletingId === entry.id}
                          className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          title="削除"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* エントリー日選択モーダル */}
      {showEntryModal && (
        <EntryDateModal
          count={selectedJobIds.size}
          onConfirm={handleEntrySubmit}
          onCancel={() => setShowEntryModal(false)}
        />
      )}

      {/* 削除確認モーダル */}
      {showDeleteModal && (
        <DeleteConfirmModal
          count={deleteTargetIds.length}
          skippedCount={deleteSkippedCount}
          onConfirm={handleDeleteJobs}
          onCancel={() => { setShowDeleteModal(false); setDeleteTargetIds([]); }}
          deleting={jobDeleting}
        />
      )}
    </div>
  );
}
