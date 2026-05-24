"use client";

import { useState } from "react";
import { toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";

const TARGET_FIELDS = [
  { key: "scoutNumber", label: "スカウト番号 (SC######## or 数字)", required: true },
  { key: "deliveryDate", label: "配信日 (YYYY-MM-DD)", required: true },
  { key: "hourSlot", label: "配信時間（時、0-23）", required: true },
  { key: "recruiterName", label: "担当者名（号機マスタ引き当て用）", required: false },
  { key: "mediaSource", label: "媒体", required: false },
  { key: "searchConditionName", label: "検索条件名", required: false },
  { key: "deliveryCount", label: "配信数", required: false },
  { key: "openCount", label: "開封数", required: false },
  { key: "deliveryCategoryLarge", label: "配信種別(大)", required: false },
  { key: "deliveryCategoryMedium", label: "配信種別(中)", required: false },
  { key: "deliveryCategorySmall", label: "配信種別(小)", required: false },
  { key: "memo", label: "メモ", required: false },
];

export default function ImportLegacyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // csvCol -> dbField
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    successCount: number;
    failureCount: number;
    errors: string[];
    totalRows: number;
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    // CSV ヘッダー読み取り
    const text = await f.text();
    const firstLine = text.split(/\r?\n/)[0];
    // 簡易 CSV パース（カンマ区切り、ダブルクォート対応）
    const headers = parseCSVLine(firstLine);
    setCsvHeaders(headers);
    // 自動マッピング: 同名キーがあれば自動設定
    const auto: Record<string, string> = {};
    for (const h of headers) {
      const match = TARGET_FIELDS.find((f) => f.key === h || f.label.startsWith(h));
      if (match) auto[h] = match.key;
    }
    setMapping(auto);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/scout/import/filemaker-legacy", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        toast.success(`インポート完了: ${data.successCount}件成功 / ${data.failureCount}件失敗`);
      } else {
        toast.error(data.error || "インポート失敗");
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <ScoutNav />
      <h1 className="text-[20px] font-bold text-[#374151]">過去データインポート</h1>
      <p className="mt-1 text-[12px] text-[#9CA3AF]">
        ファイルメーカーから CSV エクスポートした過去のスカウト配信データを取り込みます
      </p>

      <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
        <label className="block text-[13px] font-medium text-[#374151] mb-2">
          1. CSV ファイルを選択
        </label>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="text-[13px]"
        />
      </div>

      {csvHeaders.length > 0 && (
        <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
          <p className="text-[13px] font-medium text-[#374151] mb-3">
            2. 列マッピング（CSV 列 → DB カラム）
          </p>
          <div className="space-y-2">
            {csvHeaders.map((h) => (
              <div key={h} className="flex items-center gap-3 text-[13px]">
                <span className="w-1/3 text-[#6B7280] truncate">{h}</span>
                <span className="text-[#9CA3AF]">→</span>
                <select
                  value={mapping[h] || ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [h]: e.target.value })
                  }
                  className="flex-1 rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                >
                  <option value="">（マッピングなし）</option>
                  {TARGET_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label} {f.required ? "(必須)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading || !Object.values(mapping).includes("scoutNumber")}
              className="rounded-md bg-[#2563EB] px-5 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {uploading ? "取り込み中..." : "取り込み実行"}
            </button>
          </div>
          {!Object.values(mapping).includes("scoutNumber") && (
            <p className="mt-2 text-right text-[11px] text-[#DC2626]">
              ※ scoutNumber のマッピングが必須です
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-[#E5E7EB] bg-white p-5">
          <h3 className="text-[14px] font-semibold text-[#374151]">取り込み結果</h3>
          <div className="mt-2 text-[13px]">
            <p>総行数: {result.totalRows}</p>
            <p>成功: <span className="text-[#16A34A]">{result.successCount}</span></p>
            <p>失敗: <span className="text-[#DC2626]">{result.failureCount}</span></p>
          </div>
          {result.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] text-[#6B7280]">
                エラー詳細（最大50件）
              </summary>
              <div className="mt-2 max-h-60 overflow-y-auto rounded bg-[#F9FAFB] p-2 text-[11px] font-mono text-[#DC2626]">
                {result.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        result.push(cur.trim());
        cur = "";
      } else if (c === '"') {
        inQuote = true;
      } else {
        cur += c;
      }
    }
  }
  result.push(cur.trim());
  return result.map((s) => s.replace(/^﻿/, "")); // BOM除去
}
