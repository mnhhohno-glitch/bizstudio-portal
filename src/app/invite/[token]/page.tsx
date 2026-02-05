"use client";

import { useState } from "react";
import { useSearchParams, useParams } from "next/navigation";

export default function InviteSetPasswordPage() {
  const params = useParams();
  const token = params.token as string;
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const name = searchParams.get("name") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/auth/consume-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, name, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "失敗しました");
      return;
    }
    setDone(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white text-slate-900">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-semibold">初回パスワード設定</h1>
        <p className="text-sm text-gray-500 mt-1">
          招待を受けたメール: <span className="font-mono">{email}</span>
        </p>

        {done ? (
          <div className="mt-6">
            <div className="text-sm">設定が完了しました。ログインしてください。</div>
            <a
              className="inline-block mt-4 rounded-md border px-3 py-2 hover:bg-gray-100"
              href="/login"
            >
              /loginへ
            </a>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="text-sm">新しいパスワード</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <div className="mt-1 text-xs text-gray-500">8文字以上推奨</div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <button
              className="w-full rounded-md border px-3 py-2 hover:bg-gray-100"
              type="submit"
            >
              設定する
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
