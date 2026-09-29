"use client";

// T-207: 面談記録画面の「案内メール」ボタン＋メニュー＋確認画面。
// InterviewForm.tsx が肥大化しているため、ボタン・メニュー・確認画面をこのコンポーネントにまとめる。
// - ボタンを押すと小さなメニュー: ［LINE登録案内］［あいさつメール］（送信済みなら「送信済み（M/D HH:MM）」を並べる）
// - 送れないとき（求職者のメールアドレス無し／CAの LINE WORKS URL 無し）は項目を押せなくして理由を添える
// - 項目を選ぶと確認画面（宛先・差出人・件名・本文・LINE はQRの見た目）→［送信］。送信済みなら［再送］＋注意文
// API: GET/POST /api/candidates/[candidateId]/contact-mail（文面・判定・記録はサーバ側 src/lib/candidate-mail/）

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import {
  CONTACT_MAIL_LABELS,
  CONTACT_MAIL_TYPES,
  QR_TEXT_FALLBACK,
  type ContactMailType,
} from "@/lib/candidate-mail/templates";

type ItemStatus = { canSend: boolean; reason: string | null; lastSentAt: string | null };
type StatusResponse = {
  candidate: { id: string; name: string; email: string | null };
  sender: { email: string; name: string; familyName: string; from: string | null };
  items: Record<ContactMailType, ItemStatus>;
};
type PreviewResponse = StatusResponse & {
  type: ContactMailType;
  preview: { subject: string; text: string; html: string; qrDataUrl: string | null };
};

/** 送信済み表示用「M/D HH:MM」（JST）。 */
function formatSentAt(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export default function CandidateContactMailButton({
  candidateId,
  appearance,
}: {
  candidateId: string;
  /** header = InterviewForm の操作ボタン列（PDF表示・面談準備と同種の見た目） / empty = 面談記録が無い空状態のボタン */
  appearance: "header" | "empty";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState<ContactMailType | null>(null);
  const [sending, setSending] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-mail`);
      if (!res.ok) {
        setStatus(null);
        return;
      }
      setStatus((await res.json()) as StatusResponse);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, [candidateId]);

  // メニューを開くたびに最新の送信状況を取り直す
  useEffect(() => {
    if (menuOpen) void fetchStatus();
  }, [menuOpen, fetchStatus]);

  // メニューの外側クリックで閉じる
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const openPreview = async (type: ContactMailType) => {
    setPreviewLoading(type);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-mail?type=${type}`);
      const json = (await res.json().catch(() => null)) as PreviewResponse | { error?: string } | null;
      if (!res.ok || !json || !("preview" in json)) {
        toast.error((json && "error" in json && json.error) || "確認画面を開けませんでした");
        return;
      }
      setPreview(json);
      setMenuOpen(false);
    } catch {
      toast.error("確認画面を開けませんでした（通信エラー）");
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleSend = async () => {
    if (!preview || sending) return;
    const type = preview.type;
    const alreadySent = !!preview.items[type].lastSentAt;
    setSending(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-mail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, resend: alreadySent }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; code?: string } | null;
      if (!res.ok || !json?.ok) {
        if (res.status === 409) {
          toast.error("すでに送信済みでした。メニューを開き直して、再送として送ってください");
        } else {
          toast.error(json?.error || "送信に失敗しました");
        }
        return;
      }
      toast.success("送信しました");
      setPreview(null);
    } catch {
      toast.error("送信に失敗しました（通信エラー）");
    } finally {
      setSending(false);
    }
  };

  const closePreview = useCallback(() => {
    if (!sending) setPreview(null);
  }, [sending]);
  const overlayClose = useOverlayClose(closePreview);

  // ---- ボタンの見た目（置き場所ごと） ----
  const button =
    appearance === "header" ? (
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-1 cursor-pointer"
        style={{
          minWidth: 104,
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: 13,
          border: "0.5px solid var(--im-bdr)",
          background: menuOpen ? "var(--im-bg2, transparent)" : "transparent",
          color: "var(--im-fg)",
          fontFamily: "inherit",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--im-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        案内メール
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="ml-2 inline-flex items-center gap-1 px-4 py-2 rounded-md text-[13px] font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
      >
        案内メール
      </button>
    );

  // ---- メニュー ----
  const menu = menuOpen && (
    <div
      className="absolute z-40 mt-1 w-[300px] rounded-md border border-gray-200 bg-white shadow-lg text-left"
      style={{ top: "100%", ...(appearance === "header" ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }) }}
      role="menu"
    >
      {statusLoading && !status ? (
        <div className="px-3 py-2 text-[12px] text-gray-400">確認中...</div>
      ) : !status ? (
        <div className="px-3 py-2 text-[12px] text-red-500">送信状況を取得できませんでした</div>
      ) : (
        CONTACT_MAIL_TYPES.map((type) => {
          const item = status.items[type];
          const disabled = !item.canSend || previewLoading !== null;
          return (
            <button
              key={type}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => openPreview(type)}
              className="w-full px-3 py-2 text-left hover:bg-gray-50 disabled:hover:bg-white disabled:cursor-not-allowed border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[13px] ${item.canSend ? "text-gray-900" : "text-gray-400"}`}>
                  {previewLoading === type ? "確認画面を準備中..." : CONTACT_MAIL_LABELS[type]}
                </span>
                {item.lastSentAt && (
                  <span className="shrink-0 text-[11px] text-emerald-600">送信済み（{formatSentAt(item.lastSentAt)}）</span>
                )}
              </div>
              {!item.canSend && item.reason && <div className="mt-0.5 text-[11px] text-amber-600">{item.reason}</div>}
            </button>
          );
        })
      )}
    </div>
  );

  // ---- 確認画面 ----
  const modal =
    preview &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" {...overlayClose}>
        <div className="w-full max-w-[640px] max-h-[90vh] rounded-lg bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-gray-900">
              {CONTACT_MAIL_LABELS[preview.type]} を送る
            </h3>
            <button type="button" onClick={closePreview} className="text-gray-400 hover:text-gray-600 text-[18px] leading-none" aria-label="閉じる">
              ×
            </button>
          </div>
          <div className="px-5 py-4 overflow-y-auto text-[13px] text-gray-800 space-y-3">
            {preview.items[preview.type].lastSentAt && (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                すでに送信済みです（{formatSentAt(preview.items[preview.type].lastSentAt!)}）。もう一度送りますか？
              </div>
            )}
            <dl className="grid grid-cols-[72px_1fr] gap-y-1.5 gap-x-3">
              <dt className="text-gray-400">宛先</dt>
              <dd>
                {preview.candidate.name} 様 &lt;{preview.candidate.email}&gt;
              </dd>
              <dt className="text-gray-400">差出人</dt>
              <dd>{preview.sender.from ?? preview.sender.email}</dd>
              <dt className="text-gray-400">件名</dt>
              <dd className="font-medium">{preview.preview.subject}</dd>
            </dl>
            <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 leading-7 whitespace-pre-wrap break-words">
              {preview.preview.text.split("\n").map((line, i) =>
                line === QR_TEXT_FALLBACK && preview.preview.qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={preview.preview.qrDataUrl} alt="LINE登録用QRコード" width={160} height={160} className="block my-1" />
                ) : (
                  <span key={i}>
                    {line}
                    {"\n"}
                  </span>
                ),
              )}
            </div>
            <p className="text-[11px] text-gray-400">控えとして差出人のアドレスにも同じメールが届きます（BCC）。</p>
          </div>
          <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={closePreview}
              disabled={sending}
              className="px-4 py-1.5 rounded-md text-[13px] border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="px-4 py-1.5 rounded-md text-[13px] font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {sending ? "送信中..." : preview.items[preview.type].lastSentAt ? "再送" : "送信"}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div ref={wrapRef} className="relative inline-block">
      {button}
      {menu}
      {modal}
    </div>
  );
}
