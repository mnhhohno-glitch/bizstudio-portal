"use client";

// T-147: 社外の受信者向けダウンロードページ（認証不要）。
// - 初期表示で /status を確認し、無効なら理由を区別せず「このリンクは利用できません」を出す
// - パスワード照合成功でファイル一覧を表示。ダウンロードは署名付きURLへのリダイレクト
// - パスワードを間違え続けるとサーバー側で自動無効化される（このページは結果を表示するだけ）

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

type FileInfo = { id: string; fileName: string; fileSize: number };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatJst(dt: string): string {
  return new Date(dt).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function TransferPage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<
    "loading" | "password" | "authenticated" | "unavailable" | "error"
  >("loading");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/transfer/${token}/status`)
      .then(async (res) => {
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data = await res.json();
        setStatus(data.available ? "password" : "unavailable");
      })
      .catch(() => setStatus("error"));
  }, [token]);

  const handleVerify = async () => {
    if (!password.trim() || verifying) return;
    setVerifying(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/transfer/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFiles(data.files || []);
        setExpiresAt(data.expiresAt ?? null);
        setStatus("authenticated");
      } else if (res.status === 404) {
        // 存在しない/期限切れ/無効化はすべて同じ表示
        setStatus("unavailable");
      } else {
        setErrorMsg(data.error || "認証に失敗しました");
      }
    } catch {
      setErrorMsg("通信エラーが発生しました");
    } finally {
      setVerifying(false);
    }
  };

  const handleDownload = (fileId: string) => {
    window.open(`/api/transfer/${token}/download/${fileId}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="BIZSTUDIO" className="h-10 w-auto mx-auto" />
          <h1 className="text-lg font-bold text-[#374151] mt-3">ファイルのお受け取り</h1>
          <p className="text-sm text-gray-500 mt-1">株式会社ビズスタジオ</p>
        </div>

        {status === "loading" && (
          <div className="text-center py-8 text-gray-400 text-sm">読み込み中...</div>
        )}

        {status === "error" && (
          <div className="text-center py-8">
            <p className="text-red-500 text-sm">通信エラーが発生しました</p>
          </div>
        )}

        {status === "unavailable" && (
          <div className="text-center py-8">
            <p className="text-red-500 text-sm">このリンクは利用できません</p>
            <p className="text-xs text-gray-400 mt-2">
              有効期限が切れているか、無効化されています。
              <br />
              お手数ですが送信元にお問い合わせください。
            </p>
          </div>
        )}

        {status === "password" && (
          <div>
            <p className="text-sm text-gray-600 text-center mb-4">
              メールに記載されたパスワードを
              <br />
              入力してください
            </p>
            {errorMsg && (
              <p className="text-red-500 text-sm text-center mb-3">{errorMsg}</p>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder="パスワード"
              autoComplete="off"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-[#2563EB]"
            />
            <button
              onClick={handleVerify}
              disabled={!password.trim() || verifying}
              className="w-full mt-4 bg-[#2563EB] text-white rounded-lg px-4 py-3 font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
            >
              {verifying ? "確認中..." : "確認する"}
            </button>
          </div>
        )}

        {status === "authenticated" && (
          <div>
            <p className="text-sm text-gray-600 text-center mb-4">
              以下のファイルをダウンロードしてください
            </p>
            <div className="space-y-3">
              {files.map((file) => (
                <div key={file.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📄</span>
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {file.fileName}
                    </span>
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
              <p className="text-xs text-gray-400 text-center mt-4">
                ※ 有効期限: {formatJst(expiresAt)} まで（日本時間）
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
