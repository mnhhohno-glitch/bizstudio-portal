"use client";

import { useEffect, useState, useCallback } from "react";

type KnownError = {
  id: string;
  patternName: string;
  keywords: string[];
  solution: string;
  solutionUrl: string | null;
  severity: string;
  _count: { errorLogs: number };
};

type FormData = {
  patternName: string;
  keywords: string[];
  solution: string;
  solutionUrl: string;
  severity: string;
};

const emptyForm: FormData = { patternName: "", keywords: [], solution: "", solutionUrl: "", severity: "要対応" };

export default function RpaKnownErrorsPage() {
  const [errors, setErrors] = useState<KnownError[]>([]);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; id?: string } | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [keywordInput, setKeywordInput] = useState("");
  const [saving, setSaving] = useState(false);

  const loadErrors = useCallback(async () => {
    const res = await fetch("/api/rpa-error/known-errors");
    if (res.ok) {
      const data = await res.json();
      setErrors(data.errors);
    }
  }, []);

  useEffect(() => { loadErrors(); }, [loadErrors]);

  const openCreate = () => {
    setForm(emptyForm);
    setKeywordInput("");
    setModal({ mode: "create" });
  };

  const openEdit = (e: KnownError) => {
    setForm({
      patternName: e.patternName,
      keywords: e.keywords,
      solution: e.solution,
      solutionUrl: e.solutionUrl || "",
      severity: e.severity,
    });
    setKeywordInput("");
    setModal({ mode: "edit", id: e.id });
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !form.keywords.includes(kw)) {
      setForm({ ...form, keywords: [...form.keywords, kw] });
    }
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => {
    setForm({ ...form, keywords: form.keywords.filter((k) => k !== kw) });
  };

  const handleSave = async () => {
    setSaving(true);
    const url = modal?.mode === "edit"
      ? `/api/rpa-error/known-errors/${modal.id}`
      : "/api/rpa-error/known-errors";
    const method = modal?.mode === "edit" ? "PATCH" : "POST";

    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setModal(null);
    loadErrors();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このエラーパターンを削除しますか？")) return;
    await fetch(`/api/rpa-error/known-errors/${id}`, { method: "DELETE" });
    loadErrors();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-bold text-[#374151]">既知エラー管理</h1>
        <button onClick={openCreate} className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8]">
          + 新規登録
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-[14px]">
          <thead className="bg-[#F9FAFB] text-[#6B7280] text-[13px]">
            <tr>
              <th className="px-4 py-3 text-left font-medium">パターン名</th>
              <th className="px-4 py-3 text-left font-medium">キーワード</th>
              <th className="px-4 py-3 text-left font-medium">深刻度</th>
              <th className="px-4 py-3 text-left font-medium">URL</th>
              <th className="px-4 py-3 text-left font-medium">発生数</th>
              <th className="px-4 py-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {errors.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[#9CA3AF]">既知エラーパターンがありません</td></tr>
            ) : errors.map((e) => (
              <tr key={e.id} className="border-t border-[#F3F4F6]">
                <td className="px-4 py-3 font-medium">{e.patternName}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {e.keywords.map((kw) => (
                      <span key={kw} className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[12px] text-[#6B7280]">{kw}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={e.severity === "緊急" ? "text-[#DC2626] font-semibold" : e.severity === "要対応" ? "text-[#D97706]" : "text-[#9CA3AF]"}>
                    {e.severity}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {e.solutionUrl ? <a href={e.solutionUrl} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] underline text-[13px]">リンク</a> : "—"}
                </td>
                <td className="px-4 py-3 text-[#6B7280]">{e._count.errorLogs}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(e)} className="rounded bg-[#F3F4F6] px-3 py-1 text-[12px] hover:bg-[#E5E7EB]">編集</button>
                    <button onClick={() => handleDelete(e.id)} className="rounded bg-[#FEE2E2] px-3 py-1 text-[12px] text-[#DC2626] hover:bg-[#FECACA]">削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* モーダル */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-[16px] font-semibold text-[#374151] mb-4">
              {modal.mode === "create" ? "新規エラーパターン登録" : "エラーパターン編集"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">パターン名</label>
                <input value={form.patternName} onChange={(e) => setForm({ ...form, patternName: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">キーワード</label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                    placeholder="キーワードを入力してEnter"
                    className="flex-1 rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]"
                  />
                  <button onClick={addKeyword} className="rounded-md bg-[#F3F4F6] px-3 py-2 text-[13px]">追加</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {form.keywords.map((kw) => (
                    <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[13px] text-[#2563EB]">
                      {kw}
                      <button onClick={() => removeKeyword(kw)} className="text-[#2563EB]/60 hover:text-[#2563EB]">&times;</button>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">対応手順</label>
                <textarea value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} rows={4} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">対応手順URL（任意）</label>
                <input value={form.solutionUrl} onChange={(e) => setForm({ ...form, solutionUrl: e.target.value })} placeholder="https://..." className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">深刻度</label>
                <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px]">
                  <option value="放置OK">放置OK</option>
                  <option value="要対応">要対応</option>
                  <option value="緊急">緊急</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(null)} className="rounded-md bg-[#F3F4F6] px-4 py-2 text-[14px] font-medium text-[#374151]">キャンセル</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.patternName || !form.keywords.length || !form.solution}
                className="rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
