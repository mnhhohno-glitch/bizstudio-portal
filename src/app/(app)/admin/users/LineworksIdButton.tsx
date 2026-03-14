"use client";

import { useState } from "react";

type Props = {
  userId: string;
  userName: string;
  currentId: string | null;
};

export default function LineworksIdButton({ userId, userName, currentId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineworksId, setLineworksId] = useState(currentId ?? "");
  const [savedId, setSavedId] = useState(currentId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}/lineworks-id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineworksId: lineworksId.trim() || null }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "保存に失敗しました");
        return;
      }

      const data = await res.json();
      setSavedId(data.lineworksId);
      setIsOpen(false);
    } catch {
      setError("保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setLineworksId(savedId ?? "");
          setError(null);
          setIsOpen(true);
        }}
        className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        LW設定
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">
              {userName}さんのLINE WORKS ID設定
            </h3>

            {error && (
              <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor={`lw-id-${userId}`} className="block text-sm font-medium text-slate-700 mb-1">
                  LINE WORKS ID
                </label>
                <input
                  id={`lw-id-${userId}`}
                  type="text"
                  value={lineworksId}
                  onChange={(e) => setLineworksId(e.target.value)}
                  placeholder="例: username@bizstudio.co.jp"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={loading}
                />
                <p className="mt-1 text-xs text-slate-500">
                  空欄で保存するとIDを削除します
                </p>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
