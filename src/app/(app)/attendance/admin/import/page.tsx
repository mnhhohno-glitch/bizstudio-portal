"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";

type ImportResult = {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
  employeeSummary: { empNo: string; name: string; imported: number; skipped: number }[];
  debug: string[];
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!file) { toast.error("ファイルを選択してください"); return; }
    if (!confirm("インポートを実行しますか？既存データは上書きされません。")) return;

    setImporting(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/attendance/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) { toast.error(data.error || "インポートに失敗しました"); return; }

      setResult(data);
      toast.success(`${data.imported}件のデータをインポートしました`);
    } catch { toast.error("インポートに失敗しました"); }
    finally { setImporting(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Toaster position="top-center" richColors />
      <div className="mb-6 flex items-center gap-3">
        <Link href="/attendance/admin" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 管理者メニュー</Link>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">勤怠データインポート</h1>
      </div>

      {/* File Upload */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <h2 className="mb-3 text-[15px] font-bold text-[#374151]">Step 1: Excelファイル選択</h2>
        <p className="mb-4 text-[13px] text-[#6B7280]">FileMakerからエクスポートした勤怠データ（.xlsx）を選択してください</p>

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] px-4 py-3">
            <span className="text-[20px]">📊</span>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-[#374151] truncate">{file.name}</p>
              <p className="text-[12px] text-[#6B7280]">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={() => { setFile(null); setResult(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="text-[13px] text-[#6B7280] hover:text-red-600">変更</button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 py-8 cursor-pointer hover:border-[#2563EB] hover:bg-[#F9FAFB]"
          >
            <span className="text-[28px] mb-2">📊</span>
            <p className="text-[14px] text-[#6B7280]">クリックしてファイルを選択</p>
            <p className="text-[12px] text-[#9CA3AF] mt-1">.xlsx ファイルのみ</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />

        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-800">
          <p className="font-medium mb-1">注意事項</p>
          <ul className="list-disc pl-5 space-y-0.5 text-[12px]">
            <li>2026年3月以降のデータは自動的に除外されます</li>
            <li>BS1000008xx（不正データ）は除外されます</li>
            <li>既にDBに存在する日付のデータはスキップされます（上書きしません）</li>
          </ul>
        </div>

        <button onClick={handleImport} disabled={!file || importing}
          className="mt-4 w-full rounded-lg bg-[#2563EB] py-3 text-[14px] font-bold text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed">
          {importing ? "インポート中..." : "インポート実行"}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-4 rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <h2 className="mb-4 text-[15px] font-bold text-[#374151]">インポート結果</h2>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg bg-green-50 p-3 text-center">
              <p className="text-[12px] text-green-700">登録</p>
              <p className="text-[20px] font-bold text-green-800">{result.imported}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-[12px] text-[#6B7280]">スキップ</p>
              <p className="text-[20px] font-bold text-[#374151]">{result.skipped}</p>
            </div>
            <div className="rounded-lg bg-red-50 p-3 text-center">
              <p className="text-[12px] text-red-700">エラー</p>
              <p className="text-[20px] font-bold text-red-800">{result.errors.length}</p>
            </div>
          </div>

          {/* Per-employee breakdown */}
          <h3 className="mb-2 text-[13px] font-medium text-[#374151]">社員別内訳</h3>
          <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#6B7280]">
                  <th className="px-3 py-2">社員NO</th>
                  <th className="px-3 py-2">氏名</th>
                  <th className="px-3 py-2 text-right">登録</th>
                  <th className="px-3 py-2 text-right">スキップ</th>
                </tr>
              </thead>
              <tbody>
                {result.employeeSummary.map((s) => (
                  <tr key={s.empNo} className="border-t border-[#F3F4F6]">
                    <td className="px-3 py-2 font-mono">{s.empNo}</td>
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2 text-right font-medium text-green-700">{s.imported}</td>
                    <td className="px-3 py-2 text-right text-[#6B7280]">{s.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-medium text-red-700">エラー詳細</h3>
              <div className="max-h-[200px] overflow-y-auto rounded-lg bg-red-50 p-3 text-[12px] text-red-800">
                {result.errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            </div>
          )}

          {result.debug.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[13px] font-medium text-[#6B7280]">デバッグ情報</h3>
              <div className="max-h-[200px] overflow-y-auto rounded-lg bg-gray-50 p-3 text-[12px] text-[#374151] font-mono">
                {result.debug.map((d, i) => <p key={i}>{d}</p>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
