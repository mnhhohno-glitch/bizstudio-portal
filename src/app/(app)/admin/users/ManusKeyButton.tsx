"use client";

import { useState } from "react";

type Props = {
  userId: string;
  userName: string;
  hasKey: boolean;
  last4: string | null;
  setAt: string | null;
};

export default function ManusKeyButton({ userId, userName, hasKey, last4, setAt }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [currentHasKey, setCurrentHasKey] = useState(hasKey);
  const [currentLast4, setCurrentLast4] = useState(last4);
  const [currentSetAt, setCurrentSetAt] = useState(setAt);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("APIキーを入力してください");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}/manus-key`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manus_api_key: apiKey }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "保存に失敗しました");
        return;
      }

      const data = await res.json();
      setCurrentHasKey(true);
      setCurrentLast4(apiKey.slice(-4));
      setCurrentSetAt(data.set_at);
      setApiKey("");
      setIsOpen(false);
    } catch {
      setError("保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`${userName}さんのManusAPIキーを削除してよろしいですか？`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/users/${userId}/manus-key`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "削除に失敗しました");
        return;
      }

      setCurrentHasKey(false);
      setCurrentLast4(null);
      setCurrentSetAt(null);
      setIsOpen(false);
    } catch {
      setError("削除に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Manus設定
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">
              {userName}さんのManus連携設定
            </h3>

            {error && (
              <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className="mb-4 rounded bg-slate-50 border border-slate-200 p-3">
              <p className="text-sm text-slate-600">
                <span className="font-medium">現在の状態: </span>
                {currentHasKey ? (
                  <>
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 ml-1">
                      設定済み
                    </span>
                    <span className="ml-2 text-slate-500">
                      （末尾4文字: ****{currentLast4}）
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ml-1">
                    未設定
                  </span>
                )}
              </p>
              {currentSetAt && (
                <p className="text-xs text-slate-500 mt-1">
                  設定日時: {new Date(currentSetAt).toLocaleString("ja-JP")}
                </p>
              )}
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor={`manus-key-${userId}`} className="block text-sm font-medium text-slate-700 mb-1">
                  {currentHasKey ? "新しいAPIキー" : "ManusAPIキー"}
                </label>
                <input
                  id={`manus-key-${userId}`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ManusダッシュボードからコピーしたAPIキーを貼り付け"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={loading}
                />
              </div>

              <div className="flex gap-2 justify-end">
                {currentHasKey && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={loading}
                    className="rounded bg-red-100 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                  >
                    削除
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setApiKey("");
                    setError(null);
                  }}
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
