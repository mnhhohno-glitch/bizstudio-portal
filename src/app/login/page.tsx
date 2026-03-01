"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "ログインに失敗しました");
        return;
      }
      window.location.href = redirectUrl || "/";
    } catch {
      setError("通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <h1 className="text-[20px] font-semibold text-[#374151]">ログイン</h1>
      <p className="text-[14px] text-[#374151]/80 mt-1">
        メールとパスワードでログインします。
      </p>

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-[12px] text-[#374151]/80">メール</label>
          <input
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="text-[12px] text-[#374151]/80">パスワード</label>
          <input
            className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[14px] focus:border-[#2563EB] focus:outline-none"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div className="text-[14px] text-[#DC2626]">{error}</div>}

        <button
          className="w-full rounded-md bg-[#2563EB] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          type="submit"
          disabled={loading}
        >
          {loading ? "処理中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F5F7FA]">
      <Suspense fallback={
        <div className="w-full max-w-sm rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] text-[#374151]">読み込み中...</p>
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  );
}
