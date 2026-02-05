"use client";

import { useEffect, useMemo, useState } from "react";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";

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
    <div>
      <PageTitle>システム管理</PageTitle>
      <PageSubtleText>
        有効なシステム数: <span className="font-semibold">{activeCount}</span>
      </PageSubtleText>

      <div className="mt-6">
        <Card>
          <CardHeader title={editId ? "編集" : "新規追加"} />
          <CardBody>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
              <div>
                <label className="text-[12px] text-[#374151]/80">名前</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-[12px] text-[#374151]/80">
                  並び順（小さいほど上）
                </label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  min={0}
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[12px] text-[#374151]/80">説明</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[12px] text-[#374151]/80">URL（http/https）</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-[14px] focus:border-[#2563EB] focus:outline-none"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>

              <div className="md:col-span-2 flex items-center gap-4">
                <div>
                  <label className="text-[12px] text-[#374151]/80">状態</label>
                  <select
                    className="mt-1 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as "active" | "disabled")}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </div>
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <button
                  className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "処理中..." : editId ? "更新する" : "追加する"}
                </button>

                {editId && (
                  <button
                    className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                    type="button"
                    onClick={resetForm}
                  >
                    編集をやめる
                  </button>
                )}
              </div>
            </form>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="登録済みシステム"
            right={
              <button
                className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
                onClick={fetchAll}
                disabled={loading}
              >
                {loading ? "更新中..." : "更新"}
              </button>
            }
          />
          <CardBody>
            {error && <div className="mb-3 text-[14px] text-[#DC2626]">{error}</div>}

            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>並び</Th>
                    <Th>名前</Th>
                    <Th>状態</Th>
                    <Th>URL</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {systems.map((s) => (
                    <tr key={s.id}>
                      <Td>{s.sortOrder}</Td>
                      <Td>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-[12px] text-[#374151]/60">{s.description}</div>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${
                            s.status === "active"
                              ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]"
                              : "border-[#6B7280]/30 bg-[#6B7280]/10 text-[#6B7280]"
                          }`}
                        >
                          {s.status}
                        </span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px] break-all">{s.url}</span>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <button
                            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F5F7FA]"
                            onClick={() => startEdit(s)}
                          >
                            編集
                          </button>
                          <button
                            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F5F7FA]"
                            onClick={() => toggleStatus(s)}
                            disabled={busy}
                          >
                            {s.status === "active" ? "無効化" : "有効化"}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {!loading && systems.length === 0 && (
                    <tr>
                      <Td>
                        <span className="text-[#374151]/60">システムがまだ登録されていません</span>
                      </Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                      <Td></Td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
