"use client";

// T-207: 配信テンプレートの CSV 取り込み。
// 「ファイルを選ぶ → プレビュー（新規/上書きの内訳とエラー行）→ 実行 → 結果」の3段。
// CSV の解析はサーバー側に寄せる（本文に改行が入るため、画面とサーバーで解析が食い違わないようにする）。
import { useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { TEMPLATE_CSV_HEADERS, templateKindLabel } from "@/lib/scout-conditions/constants";
import type { TemplateImportResponse } from "@/lib/scout-conditions/types";

export default function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<TemplateImportResponse | null>(null);
  const [result, setResult] = useState<TemplateImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const overlayClose = useOverlayClose(onClose);

  const post = async (text: string, execute: boolean): Promise<TemplateImportResponse | null> => {
    const res = await fetch("/api/scout/templates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text, execute }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(json?.error ?? "取り込みに失敗しました");
      return null;
    }
    return json as TemplateImportResponse;
  };

  const onPick = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      // BOM はサーバー側で落とすのでここでは付いたまま送る
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      setResult(null);
      setPreview(await post(text, false));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!csv || busy) return;
    setBusy(true);
    try {
      const r = await post(csv, true);
      if (!r) return;
      setResult(r);
      toast.success(`新規 ${r.created ?? 0}件 / 上書き ${r.updated ?? 0}件を取り込みました`);
      onImported();
    } finally {
      setBusy(false);
    }
  };

  const shown = result ?? preview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" {...overlayClose}>
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[900px] flex-col rounded-[10px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
          <span className="text-[15px] font-semibold text-[#374151]">CSV 取り込み</span>
          <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
            閉じる ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-3">
          <div className="rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[12px] leading-relaxed text-[#374151]">
            <div className="font-semibold">CSV の形式</div>
            <div className="mt-1">
              UTF-8（BOM 付き）、1行目はヘッダー <span className="font-mono">{TEMPLATE_CSV_HEADERS.join(",")}</span>
            </div>
            <div>種別は「未送信用 / 送信済用 / 個別配信用」のいずれか。本文の改行はダブルクォートの中でそのまま保持されます。</div>
            <div>
              テンプレート名が既存と一致する行は<span className="font-semibold">上書き</span>（番号は維持）、一致しなければ
              <span className="font-semibold">新規</span>として採番します。番号の列は不要です。
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
              className="text-[13px]"
            />
            {fileName && <span className="text-[12px] text-[#6B7280]">{fileName}</span>}
          </div>

          {shown && (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-[#E5E7EB] px-3 py-2 text-[13px]">
                {result ? (
                  <>
                    <span className="font-semibold text-[#374151]">取り込み結果</span>
                    <span className="text-[#15803D]">新規 {result.created ?? 0}件</span>
                    <span className="text-[#1D4ED8]">上書き {result.updated ?? 0}件</span>
                    <span className={result.errors.length ? "text-[#B91C1C]" : "text-[#6B7280]"}>
                      エラー {result.errors.length}件
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-[#374151]">プレビュー</span>
                    <span className="text-[#15803D]">新規 {shown.createCount}件</span>
                    <span className="text-[#1D4ED8]">上書き {shown.updateCount}件</span>
                    <span className={shown.errors.length ? "text-[#B91C1C]" : "text-[#6B7280]"}>
                      エラー {shown.errors.length}件
                    </span>
                  </>
                )}
              </div>

              {shown.errors.length > 0 && (
                <div className="rounded-[6px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B]">
                  <div className="font-semibold">取り込まない行（他の行は取り込みます）</div>
                  <ul className="mt-1 space-y-0.5">
                    {shown.errors.map((e, i) => (
                      <li key={i}>
                        {e.lineNo}行目{e.name ? `「${e.name}」` : ""}：{e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {shown.rows.length > 0 && (
                <div className="overflow-x-auto rounded-[6px] border border-[#E5E7EB]">
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="bg-[#F3F4F6] text-[11px] text-[#374151]">
                      <tr>
                        <th className="w-0 whitespace-nowrap px-2 py-1.5 text-left">行</th>
                        <th className="w-0 whitespace-nowrap px-2 py-1.5 text-left">区分</th>
                        <th className="w-0 whitespace-nowrap px-2 py-1.5 text-left">番号</th>
                        <th className="w-0 whitespace-nowrap px-2 py-1.5 text-left">種別</th>
                        <th className="px-2 py-1.5 text-left">テンプレート名 / 件名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.rows.map((r) => (
                        <tr key={r.lineNo} className="border-t border-[#E5E7EB] align-top">
                          <td className="whitespace-nowrap px-2 py-1.5 text-[#6B7280]">{r.lineNo}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                r.action === "CREATE" ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#DBEAFE] text-[#1D4ED8]"
                              }`}
                            >
                              {r.action === "CREATE" ? "新規" : "上書き"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[#374151]">{r.templateNo ?? "採番"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[#6B7280]">{templateKindLabel(r.kind)}</td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-[#111827]">{r.name}</div>
                            <div className="text-[#6B7280]">{r.subject}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            {result ? "閉じる" : "キャンセル"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={run}
              disabled={busy || !preview || preview.rows.length === 0}
              className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {busy ? "処理中…" : `取り込む（新規 ${preview?.createCount ?? 0} / 上書き ${preview?.updateCount ?? 0}）`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
