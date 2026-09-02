"use client";

// T-189 Phase3-1: 自動配信の承認ページ（一覧 → 行を開くと承認待ちカード）。
//   一覧: 自動配信ONの求職者全員（承認待ち0件でも出す）。並びは承認待ち多い順 → 前回LINE送信が古い順。
//   詳細: PENDING のカードに ✓承認 / ✗却下。「表示中を一括✓」。公開済み・却下/期限切れは折りたたみ参考表示。
//   LINE送信済み: Candidate.lastLineSentAt を今に更新（確認ダイアログなし・押し直しで上書き）。
// データは /api/admin/auto-recommend/* から取得（全て自動配信の管理者のみ 200・それ以外 403）。

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { Table, TableWrap, Td, Th } from "@/components/ui/Table";
import { openJobPlatformDetail } from "@/lib/openJobPlatformDetail";
import { extractAxis } from "@/lib/ai-rating";
import { parseCaAnalysisBlocks, type CaMark } from "@/lib/ca-analysis-format";
import {
  RANK_KEYS,
  REJECT_REASON_CHOICES,
  toRankKey,
  type AutoApprovalCard,
  type AutoApprovalDetail,
  type AutoApprovalOverviewRow,
  type RejectReasonChoice,
} from "@/lib/recommend/auto-approval-shared";

/* ---------- 表示ヘルパ ---------- */

// HistoryTab の RATING_PALETTE と同じ配色（A 緑 / B+ 水 / B 青 / C 黄 / D 赤 / 未評価 灰）
const RATING_BADGE: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  "B+": "bg-cyan-100 text-cyan-800 border-cyan-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-red-100 text-red-800 border-red-300",
  未評価: "bg-gray-100 text-gray-500 border-gray-300",
};
const CA_MARK_STYLES: Record<CaMark, string> = {
  ok: "bg-green-50 text-green-700 border-green-300",
  warn: "bg-amber-50 text-amber-700 border-amber-300",
  ng: "bg-red-50 text-red-700 border-red-300",
};

function fmtJst(iso: string | null, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function RatingBadge({ rating, size = "md" }: { rating: string | null; size?: "sm" | "md" }) {
  const key = toRankKey(rating);
  const cls = RATING_BADGE[key] ?? RATING_BADGE["未評価"];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-bold ${cls} ${
        size === "sm" ? "h-5 min-w-[20px] px-1.5 text-[11px]" : "h-7 min-w-[28px] px-2 text-[13px]"
      }`}
    >
      {key}
    </span>
  );
}

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

function AnalysisComment({ comment }: { comment: string }) {
  const blocks = useMemo(() => parseCaAnalysisBlocks(cleanAnalysisComment(comment)), [comment]);
  return (
    <div className="text-[13px] leading-relaxed text-gray-700">
      {blocks.map((b, i) =>
        b.kind === "item" ? (
          <div key={i} className={`flex items-center gap-2 ${i === 0 ? "" : "mt-2"} mb-0.5`}>
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold ${CA_MARK_STYLES[b.mark]}`}
            >
              {b.symbol}
            </span>
            <span className="font-semibold text-gray-900">{b.label}</span>
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap">
            {b.text}
          </div>
        ),
      )}
    </div>
  );
}

/* ---------- 求人カード ---------- */

function JobCard({
  card,
  busy,
  onApprove,
  onReject,
  onRetryPdf,
}: {
  card: AutoApprovalCard;
  busy: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onRetryPdf?: (id: string) => void;
}) {
  const pending = card.approvalStatus === "PENDING";
  // 承認待ちカードは AI評価コメントを最初から開く（判断材料）。参考表示の行は閉じておく。
  const [open, setOpen] = useState(pending);
  const wish = extractAxis(card.aiAnalysisComment, "本人希望");
  const pass = extractAxis(card.aiAnalysisComment, "通過率");

  const openJob = async () => {
    if (card.jobUrl) {
      window.open(card.jobUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (card.externalJobRef) await openJobPlatformDetail(card.externalJobRef);
    else toast.error("求人票のリンクがありません");
  };

  return (
    <div className={`rounded-[8px] border bg-white px-4 py-3 ${pending ? "border-[#E5E7EB]" : "border-[#F3F4F6]"}`}>
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <RatingBadge rating={card.aiMatchRating} />
          {(wish || pass) && (
            <div className="text-[10px] leading-tight text-gray-500">
              希望{wish ?? "—"}/通過{pass ?? "—"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-semibold text-gray-900">{card.companyName}</span>
            {card.jobCategory && <span className="text-[11px] text-gray-500">{card.jobCategory}</span>}
          </div>
          <div className="text-[13px] text-gray-800">{card.jobTitle ?? <span className="text-gray-400">（求人タイトル未取得）</span>}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span>引き当て {fmtJst(card.autoSourcedAt)}</span>
            {card.aiAnalyzedAt && <span>AI評価 {fmtJst(card.aiAnalyzedAt)}</span>}
            {card.introducedAt && <span>公開 {fmtJst(card.introducedAt)}</span>}
            {card.approvalStatus === "APPROVED" && (
              <span className={card.viewed ? "text-green-700" : "text-amber-700"}>{card.viewed ? "閲覧済み" : "未読"}</span>
            )}
            {card.approvalStatus === "APPROVED" && !card.hasPdf && (
              <span className="text-red-600">PDF未生成</span>
            )}
            {card.rejectedReason && <span className="text-gray-600">却下理由: {card.rejectedReason}</span>}
            <button type="button" onClick={openJob} className="text-[#2563EB] underline hover:text-[#1D4ED8]">
              求人票を開く
            </button>
            {card.aiAnalysisComment && (
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-[#2563EB] underline hover:text-[#1D4ED8]">
                {open ? "AI評価コメントを閉じる" : "AI評価コメントを見る"}
              </button>
            )}
          </div>
          {open && card.aiAnalysisComment && (
            <div className="mt-2 rounded-[6px] bg-[#F9FAFB] px-3 py-2">
              <AnalysisComment comment={card.aiAnalysisComment} />
            </div>
          )}
          {!card.aiAnalysisComment && pending && (
            <div className="mt-1 text-[11px] text-gray-400">AI評価は未実施（朝のバッチ評価後に表示されます）</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {pending && onApprove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(card.id)}
              className="rounded-[6px] bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
            >
              ✓ 承認
            </button>
          )}
          {pending && onReject && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(card.id)}
              className="rounded-[6px] border border-[#DC2626] bg-white px-3 py-1.5 text-[13px] font-medium text-[#DC2626] hover:bg-[#FEF2F2] disabled:opacity-50"
            >
              ✗ 却下
            </button>
          )}
          {card.approvalStatus === "APPROVED" && !card.hasPdf && onRetryPdf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRetryPdf(card.id)}
              className="rounded-[6px] border border-[#D1D5DB] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              PDF再生成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 却下モーダル ---------- */

function RejectModal({
  count,
  onCancel,
  onSubmit,
}: {
  count: number;
  onCancel: () => void;
  onSubmit: (reason: RejectReasonChoice, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<RejectReasonChoice>(REJECT_REASON_CHOICES[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const needNote = reason === "その他" && !note.trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="w-[420px] rounded-[8px] bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold text-gray-900">却下理由（{count}件）</div>
        <div className="mt-3 space-y-1.5">
          {REJECT_REASON_CHOICES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-[14px] text-gray-800">
              <input type="radio" name="reject-reason" checked={reason === c} onChange={() => setReason(c)} />
              {c}
            </label>
          ))}
        </div>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={reason === "その他" ? "理由を1行で（必須）" : "補足があれば1行で（任意）"}
          maxLength={200}
          className="mt-3 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[14px]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-gray-700">
            キャンセル
          </button>
          <button
            type="button"
            disabled={submitting || needNote}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit(reason, note.trim());
              } finally {
                setSubmitting(false);
              }
            }}
            className="rounded-[6px] bg-[#DC2626] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#B91C1C] disabled:opacity-50"
          >
            ✗ 却下する
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 詳細（1求職者分） ---------- */

function CandidateDetail({ candidateId, onChanged }: { candidateId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<AutoApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectTargets, setRejectTargets] = useState<string[] | null>(null);
  const [showApproved, setShowApproved] = useState(false);
  const [showRef, setShowRef] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/auto-recommend/candidates/${candidateId}`);
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? "詳細の取得に失敗しました");
      setLoading(false);
      return;
    }
    setDetail(await res.json());
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (ids: string[]) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auto-recommend/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ids }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(j?.error ?? "承認に失敗しました");
        return;
      }
      const failed: { fileId: string; error?: string }[] = j?.pdfFailed ?? [];
      if (failed.length > 0) {
        toast.warning(`${j.approved}件を承認しました（PDF生成に${failed.length}件失敗。「PDF再生成」で再試行できます）`);
      } else {
        toast.success(`${j.approved}件を承認し、PDFを生成しました`);
      }
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (reason: RejectReasonChoice, note: string) => {
    if (!rejectTargets) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auto-recommend/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: rejectTargets, reason, note }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(j?.error ?? "却下に失敗しました");
        return;
      }
      toast.success(`${j.rejected}件を却下しました`);
      setRejectTargets(null);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const retryPdf = async (fileId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/auto-recommend/retry-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(j?.error ?? "PDF生成に失敗しました");
        return;
      }
      toast.success("PDFを生成しました");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="px-4 py-3 text-[13px] text-gray-500">読み込み中…</div>;
  if (!detail) return null;

  const reference = [...detail.rejected, ...detail.expired];

  return (
    <div className="space-y-3 bg-[#F9FAFB] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-gray-800">
          承認待ち {detail.pending.length}件
          {!detail.candidate.autoRecommendEnabled && <span className="ml-2 text-[11px] font-normal text-red-600">（自動配信OFF）</span>}
        </div>
        {detail.pending.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => approve(detail.pending.map((c) => c.id))}
            className="rounded-[6px] bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
          >
            表示中を一括 ✓（{detail.pending.length}件）
          </button>
        )}
      </div>
      {detail.pending.length === 0 && <div className="text-[13px] text-gray-500">承認待ちの求人はありません。</div>}
      <div className="space-y-2">
        {detail.pending.map((c) => (
          <JobCard key={c.id} card={c} busy={busy} onApprove={(id) => approve([id])} onReject={(id) => setRejectTargets([id])} />
        ))}
      </div>

      <div>
        <button type="button" onClick={() => setShowApproved((v) => !v)} className="text-[12px] text-[#2563EB] underline">
          {showApproved ? "▼" : "▶"} 公開済み（{detail.approved.length}件・未読 {detail.approved.filter((c) => !c.viewed).length}件）
        </button>
        {showApproved && (
          <div className="mt-2 space-y-2">
            {detail.approved.length === 0 && <div className="text-[12px] text-gray-500">公開済みの求人はありません。</div>}
            {detail.approved.map((c) => (
              <JobCard key={c.id} card={c} busy={busy} onRetryPdf={retryPdf} />
            ))}
          </div>
        )}
      </div>

      <div>
        <button type="button" onClick={() => setShowRef((v) => !v)} className="text-[12px] text-[#2563EB] underline">
          {showRef ? "▼" : "▶"} 直近の却下・期限切れ（参考・{reference.length}件）
        </button>
        {showRef && (
          <div className="mt-2 space-y-2">
            {reference.length === 0 && <div className="text-[12px] text-gray-500">却下・期限切れの求人はありません。</div>}
            {reference.map((c) => (
              <JobCard key={c.id} card={c} busy={busy} />
            ))}
          </div>
        )}
      </div>

      {rejectTargets && <RejectModal count={rejectTargets.length} onCancel={() => setRejectTargets(null)} onSubmit={reject} />}
    </div>
  );
}

/* ---------- 一覧 ---------- */

export default function AutoRecommendApprovalClient() {
  const [rows, setRows] = useState<AutoApprovalOverviewRow[]>([]);
  const [dailyCap, setDailyCap] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lineBusy, setLineBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/auto-recommend/overview");
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "一覧の取得に失敗しました");
      setLoading(false);
      return;
    }
    const j = await res.json();
    setRows(j.rows ?? []);
    if (typeof j.dailyCap === "number") setDailyCap(j.dailyCap);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markLineSent = async (candidateId: string) => {
    setLineBusy(candidateId);
    try {
      const res = await fetch("/api/admin/auto-recommend/line-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(j?.error ?? "更新に失敗しました");
        return;
      }
      setRows((prev) => prev.map((r) => (r.candidateId === candidateId ? { ...r, lastLineSentAt: j.lastLineSentAt } : r)));
      toast.success("LINE送信日時を記録しました");
    } finally {
      setLineBusy(null);
    }
  };

  const totalPending = rows.reduce((s, r) => s + r.pendingCount, 0);

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-4 flex items-center justify-between">
        <div>
          <PageTitle>自動配信 承認</PageTitle>
          <p className="mt-1 text-[12px] text-gray-500">
            自動配信ONの求職者 {rows.length}名・承認待ち {totalPending}件。承認した求人だけが求職者のマイページ「新着マッチ求人」に出ます。
          </p>
          <p className="mt-0.5 text-[12px] text-gray-500">
            各求職者の詳細ブックマークタブからも承認できます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/master" className="text-[13px] text-[#2563EB] underline">
            求職者管理へ
          </Link>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="rounded-[6px] border border-[#D1D5DB] bg-white px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            再読み込み
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">{error}</div>}
      {loading && <div className="text-[13px] text-gray-500">読み込み中…</div>}

      {!loading && !error && (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>求職者</Th>
                <Th>担当</Th>
                <Th className="text-right">承認待ち</Th>
                <Th>ランク内訳</Th>
                <Th className="text-right">公開済み未読</Th>
                <Th>前回LINE送信</Th>
                <Th>最終ログイン</Th>
                <Th>当日上限</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="border-b border-[#E5E7EB] px-3 py-3 text-[13px] text-gray-500">
                    自動配信ONの求職者がいません（求職者詳細ヘッダの「自動配信」トグルでONにできます）。
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isOpen = openId === r.candidateId;
                return (
                  <RowGroup key={r.candidateId}>
                    <tr className={isOpen ? "bg-[#EFF6FF]" : "hover:bg-[#F9FAFB]"}>
                      <Td>
                        <button type="button" onClick={() => setOpenId(isOpen ? null : r.candidateId)} className="text-left">
                          <span className="mr-1 text-[11px] text-gray-400">{isOpen ? "▼" : "▶"}</span>
                          <span className="font-medium text-gray-900">{r.name}</span>
                          <span className="ml-2 text-[12px] text-gray-500">{r.candidateNumber}</span>
                        </button>
                        <Link href={`/candidates/${r.candidateId}`} className="ml-2 text-[11px] text-[#2563EB] underline" target="_blank">
                          詳細
                        </Link>
                      </Td>
                      <Td className="text-[13px] text-gray-600">{r.employeeName ?? "—"}</Td>
                      <Td className="text-right">
                        <span className={`text-[15px] font-semibold ${r.pendingCount > 0 ? "text-[#DC2626]" : "text-gray-400"}`}>{r.pendingCount}</span>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1">
                          {RANK_KEYS.filter((k) => r.rankCounts[k] > 0).map((k) => (
                            <span key={k} className="inline-flex items-center gap-0.5 text-[12px] text-gray-700">
                              <RatingBadge rating={k} size="sm" />
                              {r.rankCounts[k]}
                            </span>
                          ))}
                          {r.pendingCount === 0 && <span className="text-[12px] text-gray-400">—</span>}
                        </div>
                      </Td>
                      <Td className="text-right text-[13px]">
                        <span className={r.approvedUnreadCount > 0 ? "font-semibold text-amber-700" : "text-gray-500"}>{r.approvedUnreadCount}</span>
                        <span className="text-[11px] text-gray-400"> / {r.approvedCount}</span>
                      </Td>
                      <Td className="text-[13px] text-gray-600">{fmtJst(r.lastLineSentAt)}</Td>
                      <Td className="text-[13px] text-gray-600">{fmtJst(r.lastLoginAt)}</Td>
                      <Td className="text-[13px]">
                        {r.dailyCapReached ? (
                          <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#92400E]">到達 {r.todayCount}/{dailyCap}</span>
                        ) : (
                          <span className="text-gray-500">
                            {r.todayCount}/{dailyCap}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <button
                          type="button"
                          disabled={lineBusy === r.candidateId}
                          onClick={() => markLineSent(r.candidateId)}
                          className="whitespace-nowrap rounded-[6px] border border-[#06C755] bg-white px-2.5 py-1 text-[12px] font-medium text-[#06C755] hover:bg-[#F0FDF4] disabled:opacity-50"
                          title="LINEで案内を送ったら押してください（前回LINE送信日を今に更新）"
                        >
                          LINE送信済み
                        </button>
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="border-b border-[#E5E7EB] p-0">
                          <CandidateDetail candidateId={r.candidateId} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </RowGroup>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

// <tbody> の直下に複数 <tr> を返すためのフラグメント（key を付けるためだけの薄いラッパ）
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
