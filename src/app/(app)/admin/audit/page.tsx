"use client";

import { useEffect, useState } from "react";

type LogRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actorUser: {
    email: string;
    name: string;
  };
};

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/audit");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "取得に失敗しました");
      setLogs(data.logs ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "取得に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="bg-white text-slate-900">
      <h1 className="text-xl font-semibold">監査ログ</h1>
      <p className="mt-2 text-sm text-slate-600">
        システム上の重要操作の履歴です（直近200件）。
      </p>

      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">ログ一覧</div>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
            onClick={fetchLogs}
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
                <th className="py-2 text-left">日時</th>
                <th className="py-2 text-left">操作</th>
                <th className="py-2 text-left">対象</th>
                <th className="py-2 text-left">実行者</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-2 font-mono text-xs">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                        l.action.includes("SUCCESS") || l.action.includes("CREATED")
                          ? "border-green-300 bg-green-50 text-green-700"
                          : l.action.includes("FAILED")
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {l.action}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="text-xs">{l.targetType}</div>
                    {l.targetId && (
                      <div className="text-[10px] text-slate-500 font-mono">
                        {l.targetId}
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="text-xs">{l.actorUser.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {l.actorUser.email}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td className="py-4 text-slate-600" colSpan={4}>
                    ログがありません
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
