"use client";

import { useEffect, useMemo, useState } from "react";

type SystemRow = {
  id: string;
  name: string;
  description: string;
  url: string;
  status: "active" | "disabled";
  sortOrder: number;
};

function isHttpUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AdminSystemsPage() {
  const [systems, setSystems] = useState<SystemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [status, setStatus] = useState<"active" | "disabled">("active");

  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeCount = useMemo(
    () => systems.filter((s) => s.status === "active").length,
    [systems]
  );

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/systems");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "取得に失敗しました");
      setSystems(data.systems ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "取得に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  function resetForm() {
    setName("");
    setDescription("");
    setUrl("");
    setSortOrder(0);
    setStatus("active");
    setEditId(null);
  }

  function startEdit(s: SystemRow) {
    setEditId(s.id);
    setName(s.name);
    setDescription(s.description);
    setUrl(s.url);
    setSortOrder(s.sortOrder);
    setStatus(s.status);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !url.trim()) return;
    if (!isHttpUrl(url)) {
      alert("URLは http または https で始まるURLを入力してください");
      return;
    }

    setBusy(true);
    try {
      const endpoint = editId
        ? `/api/admin/systems/${editId}/update`
        : "/api/admin/systems/create";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          url,
          sortOrder: Number(sortOrder),
          status,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "保存に失敗しました");
        return;
      }
      await fetchAll();
      resetForm();
    } catch {
      alert("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(s: SystemRow) {
    const next = s.status === "active" ? "disabled" : "active";
    const ok = window.confirm(
      `${s.name} を ${next === "disabled" ? "無効化" : "有効化"}しますか？`
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/systems/${s.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name,
          description: s.description,
          url: s.url,
          sortOrder: s.sortOrder,
          status: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error ?? "更新に失敗しました");
        return;
      }
      await fetchAll();
    } catch {
      alert("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white text-slate-900">
      <h1 className="text-xl font-semibold">システム管理</h1>
      <p className="mt-2 text-sm text-slate-600">
        有効なシステム数: <span className="font-semibold">{activeCount}</span>
      </p>

      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold">
          {editId ? "編集" : "新規追加"}
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={submit}>
          <div>
            <label className="text-xs text-slate-600">名前</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-600">
              並び順（小さいほど上）
            </label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              min={0}
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-slate-600">説明</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-slate-600">URL（http/https）</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>

          <div className="md:col-span-2 flex items-center gap-3">
            <label className="text-xs text-slate-600">状態</label>
            <select
              className="rounded-md border px-3 py-2 text-sm bg-white"
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "disabled")}
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-center gap-2">
            <button
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              type="submit"
              disabled={busy}
            >
              {busy ? "処理中..." : editId ? "更新する" : "追加する"}
            </button>

            {editId && (
              <button
                className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
                type="button"
                onClick={resetForm}
              >
                編集をやめる
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">登録済みシステム</div>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
            onClick={fetchAll}
            disabled={loading}
          >
            {loading ? "更新中..." : "更新"}
          </button>
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">並び</th>
                <th className="py-2 text-left">名前</th>
                <th className="py-2 text-left">状態</th>
                <th className="py-2 text-left">URL</th>
                <th className="py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{s.sortOrder}</td>
                  <td className="py-2">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-slate-600">{s.description}</div>
                  </td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        s.status === "active"
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs break-all max-w-xs">
                    {s.url}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <button
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-50"
                        onClick={() => startEdit(s)}
                      >
                        編集
                      </button>
                      <button
                        className="rounded-md border px-3 py-1.5 text-xs hover:bg-slate-50"
                        onClick={() => toggleStatus(s)}
                        disabled={busy}
                      >
                        {s.status === "active" ? "無効化" : "有効化"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && systems.length === 0 && (
                <tr>
                  <td className="py-4 text-slate-600" colSpan={5}>
                    システムがまだ登録されていません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
