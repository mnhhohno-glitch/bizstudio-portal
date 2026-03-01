"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keySetAt, setKeySetAt] = useState<string | null>(null);
  const [keyLast4, setKeyLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchKeyStatus();
  }, []);

  const fetchKeyStatus = async () => {
    try {
      const res = await fetch("/api/users/me/manus-key");
      const data = await res.json();
      setHasKey(data.has_key);
      setKeyLast4(data.last4 ?? null);
      setKeySetAt(data.set_at ?? null);
    } catch {
      setError("取得に失敗しました");
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
        ) : hasKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                設定済み
              </span>
              <span className="text-slate-600 text-sm">
                （末尾4文字: ****{keyLast4}）
              </span>
            </div>
            {keySetAt && (
              <p className="text-slate-500 text-xs">
                設定日時: {new Date(keySetAt).toLocaleString("ja-JP")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              未設定
            </span>
          </div>
        )}

        <div className="mt-4 rounded bg-amber-50 border border-amber-200 p-3 text-amber-800 text-sm">
          ManusAPIキーの設定・変更は管理者にお問い合わせください。
        </div>
      </div>
    </div>
  );
}
