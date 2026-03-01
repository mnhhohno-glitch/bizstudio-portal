"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keySetAt, setKeySetAt] = useState<string | null>(null);
  const [keyLast4, setKeyLast4] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKeyStatus();
  }, []);

  const fetchKeyStatus = async () => {
    try {
      const res = await fetch("/api/users/me/manus-key");
      const data = await res.json();
      setHasKey(data.has_key);
      if (data.has_key && data.manus_api_key) {
        const key = data.manus_api_key as string;
        setKeyLast4(key.slice(-4));
      }
    } catch {
      setError("取得に失敗しました");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("APIキーを入力してください");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users/me/manus-key", {
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
      setHasKey(true);
      setKeySetAt(data.set_at);
      setKeyLast4(apiKey.slice(-4));
      setShowForm(false);
      setApiKey("");
    } catch {
      setError("保存に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("ManusAPIキーを削除してよろしいですか？\n削除すると資料生成アプリでManusが利用できなくなります。")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users/me/manus-key", { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "削除に失敗しました");
        return;
      }

      setHasKey(false);
      setKeySetAt(null);
      setKeyLast4(null);
    } catch {
      setError("削除に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">設定</h1>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="text-lg font-semibold mb-4">Manus連携設定</h2>

        {error && (
          <div className="mb-4 rounded bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {hasKey === null ? (
          <p className="text-slate-500 text-sm">読み込み中...</p>
        ) : hasKey && !showForm ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                設定済み
              </span>
              <span className="text-slate-600 text-sm">
                末尾4文字: ****{keyLast4}
              </span>
            </div>
            {keySetAt && (
              <p className="text-slate-500 text-xs">
                設定日時: {new Date(keySetAt).toLocaleString("ja-JP")}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(true)}
                className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                変更
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="rounded bg-red-100 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
              >
                削除
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!hasKey && (
              <p className="text-slate-600 text-sm">
                ManusAPIキーが未設定です。資料生成アプリでManusを利用するには、APIキーを設定してください。
              </p>
            )}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="manus-api-key" className="block text-sm font-medium text-slate-700 mb-1">
                  ManusAPIキー
                </label>
                <input
                  id="manus-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ManusダッシュボードからコピーしたAPIキーを貼り付け"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  disabled={loading}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "保存中..." : "保存"}
                </button>
                {showForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setApiKey("");
                      setError(null);
                    }}
                    className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                  >
                    キャンセル
                  </button>
                )}
              </div>
            </form>
            <div className="rounded bg-slate-50 border border-slate-200 p-3 text-slate-600 text-xs">
              <p className="font-medium mb-1">APIキーの取得方法:</p>
              <p>
                ManusのダッシュボードのSettings → Integration → Build with Manus APIからAPIキーを取得してください。
              </p>
              <a
                href="https://manus.app/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-blue-600 hover:underline"
              >
                Manusダッシュボードを開く →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
