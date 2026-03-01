"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("認証処理中...");

  useEffect(() => {
    const token = searchParams.get("token");
    const redirect = searchParams.get("redirect");

    if (!token) {
      setStatus("error");
      setMessage("認証トークンがありません");
      return;
    }

    async function verifyToken() {
      try {
        const res = await fetch("/api/auth/verify-callback-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const data = await res.json();
          setStatus("error");
          setMessage(data.error || "認証に失敗しました");
          return;
        }

        setStatus("success");
        setMessage("認証成功。リダイレクト中...");

        setTimeout(() => {
          window.location.href = redirect || "/";
        }, 500);
      } catch {
        setStatus("error");
        setMessage("認証処理に失敗しました");
      }
    }

    verifyToken();
  }, [searchParams]);

  return (
    <div className="w-full max-w-sm rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-center">
      {status === "loading" && (
        <>
          <div className="text-[24px] mb-4">⏳</div>
          <p className="text-[14px] text-[#374151]">{message}</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="text-[24px] mb-4">✅</div>
          <p className="text-[14px] text-[#16A34A]">{message}</p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="text-[24px] mb-4">❌</div>
          <p className="text-[14px] text-[#DC2626]">{message}</p>
          <a
            href="/login"
            className="inline-block mt-4 text-[14px] text-[#2563EB] hover:underline"
          >
            ログインページへ
          </a>
        </>
      )}
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F5F7FA]">
      <Suspense fallback={
        <div className="w-full max-w-sm rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-center">
          <div className="text-[24px] mb-4">⏳</div>
          <p className="text-[14px] text-[#374151]">読み込み中...</p>
        </div>
      }>
        <AuthCallbackContent />
      </Suspense>
    </div>
  );
}
