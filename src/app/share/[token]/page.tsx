"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

type FileInfo = { id: string; fileName: string; fileSize: number; mimeType: string };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"loading" | "password" | "authenticated" | "error" | "expired">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    // Check if link is valid
    fetch(`/api/share/${token}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "__check__" }),
    }).then(async (res) => {
      if (res.status === 404) {
        setStatus("error");
        setErrorMsg("このリンクは無効です");
      } else if (res.status === 410) {
        setStatus("expired");
      } else {
        // 401 means needs password (expected)
        setStatus("password");
      }
    }).catch(() => {
      setStatus("error");
      setErrorMsg("通信エラーが発生しました");
    });
  }, [token]);

  const handleVerify = async () => {
    if (!password.trim()) return;
    setVerifying(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/share/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setFiles(data.files || []);
        setStatus("authenticated");
      } else if (res.status === 410) {
        setStatus("expired");
      } else {
        setErrorMsg(data.error || "認証に失敗しました");
      }
    } catch {
      setErrorMsg("通信エラーが発生しました");
    } finally {
      setVerifying(false);
    }
  };

  // Also fetch link info for expiry display
  useEffect(() => {
    // We'll get expiry from the response if needed
    // For now, just show files after auth
  }, []);

  const handleDownload = (fileId: string) => {
    window.open(`/api/share/${token}/download/${fileId}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8">
        <div className="text-center mb-6">
          <span className="text-3xl">📄</span>
          <h1 className="text-lg font-bold text-[#374151] mt-2">書類確認</h1>
          <p className="text-sm text-gray-500 mt-1">株式会社ビズスタジオ</p>
        </div>

        {status === "loading" && (
          <div className="text-center py-8 text-gray-400 text-sm">読み込み中...</div>
        )}

        {status === "error" && (
          <div className="text-center py-8">
            <p className="text-red-500 text-sm">{errorMsg}</p>
          </div>
        )}

        {status === "expired" && (
          <div className="text-center py-8">
            <p className="text-red-500 text-sm">このリンクの有効期限が切れています</p>
          </div>
        )}

        {status === "password" && (
          <div>
            <p className="text-sm text-gray-600 text-center mb-4">
              書類を確認するには<br />生年月日を入力してください
            </p>
            <p className="text-xs text-gray-400 text-center mb-4">（例: 19980315）</p>
            {errorMsg && (
              <p className="text-red-500 text-sm text-center mb-3">{errorMsg}</p>
            )}
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="生年月日（YYYYMMDD）"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB]"
            />
            <button
              onClick={handleVerify}
              disabled={password.length !== 8 || verifying}
              className="w-full mt-4 bg-[#2563EB] text-white rounded-lg px-4 py-3 font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
            >
              {verifying ? "確認中..." : "確認する"}
            </button>
          </div>
        )}

        {status === "authenticated" && (
          <div>
            <p className="text-sm text-gray-600 text-center mb-4">以下の書類をご確認ください</p>
            {files.length > 1 && (
              <button
                onClick={() => window.open(`/api/share/${token}/download-all`, "_blank")}
                className="w-full bg-[#2563EB] text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-[#1D4ED8] transition-colors mb-4"
              >
                📦 すべてのファイルを一括ダウンロード（ZIP）
              </button>
            )}
            <div className="space-y-3">
              {files.map((file) => (
                <div key={file.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📄</span>
                    <span className="text-sm font-medium text-gray-800 truncate">{file.fileName}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{formatFileSize(file.fileSize)}</p>
                  <button
                    onClick={() => handleDownload(file.id)}
                    className="mt-3 w-full bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
                  >
                    ⬇ ダウンロード
                  </button>
                </div>
              ))}
            </div>
            {expiresAt && (
              <p className="text-xs text-gray-400 text-center mt-4">※ 有効期限: {expiresAt}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
