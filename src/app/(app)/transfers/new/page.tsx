"use client";

// T-147: セキュアファイル送信の新規作成画面。
// - ファイルはブラウザから Supabase へ直接アップロード（署名付きアップロードURL・XHRで進捗表示）。
//   ファイル本体を portal サーバー経由で流さない（確定仕様）。
// - 送信完了画面で URL とパスワードを一度だけ表示する（再表示不可・DBに平文なし）。

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB（サーバー側と同値）

type UploadState = {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  storagePath?: string;
};

type SendResult = {
  url: string;
  password: string;
  expiresAt: string;
  recipientEmail: string;
  files: { fileName: string; fileSize: number }[];
};

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

/** 署名付きURLへ XHR で PUT（fetch はアップロード進捗が取れないため）。 */
function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload failed: network error"));
    xhr.send(file);
  });
}

export default function NewTransferPage() {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [expiresDays, setExpiresDays] = useState(7);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const next = [...uploads];
    for (const file of Array.from(fileList)) {
      if (next.length >= MAX_FILES) {
        toast.error(`ファイルは最大${MAX_FILES}件までです`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`1GBを超えるファイルは送信できません: ${file.name}`);
        continue;
      }
      if (next.some((u) => u.file.name === file.name && u.file.size === file.size)) {
        continue; // 同名同サイズの重複追加はスキップ
      }
      next.push({ file, progress: 0, status: "pending" });
    }
    setUploads(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const updateUpload = (index: number, patch: Partial<UploadState>) => {
    setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());
  const canSend = uploads.length > 0 && emailValid && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      // 1) 各ファイルを Supabase へ直接アップロード
      const uploaded: { fileName: string; fileSize: number; storagePath: string }[] = [];
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        if (u.status === "done" && u.storagePath) {
          uploaded.push({ fileName: u.file.name, fileSize: u.file.size, storagePath: u.storagePath });
          continue; // 前回送信失敗時の再試行ではアップロード済み分をスキップ
        }
        updateUpload(i, { status: "uploading", progress: 0 });

        const res = await fetch("/api/transfers/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: u.file.name, fileSize: u.file.size }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "アップロードURLの発行に失敗しました");

        await uploadToSignedUrl(data.signedUrl, u.file, (p) => updateUpload(i, { progress: p }));
        updateUpload(i, { status: "done", progress: 100, storagePath: data.storagePath });
        uploaded.push({ fileName: u.file.name, fileSize: u.file.size, storagePath: data.storagePath });
      }

      // 2) 送信レコード作成＋メール送信
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: recipientEmail.trim(),
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          expiresDays,
          files: uploaded,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // メール送信失敗時はサーバー側で Storage ごとロールバック済み → 再アップロードが必要
        if (res.status === 502) {
          setUploads((prev) =>
            prev.map((u) => ({ ...u, status: "pending", progress: 0, storagePath: undefined }))
          );
        }
        throw new Error(data.error || "送信に失敗しました");
      }
      setResult(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}をコピーしました`);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  // ---------- 送信完了画面 ----------
  if (result) {
    return (
      <div className="max-w-xl">
        <h1 className="mb-4 text-xl font-bold text-[#374151]">送信が完了しました</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-4">
          <p className="text-sm text-gray-600">
            {result.recipientEmail} 宛にダウンロード案内メールを送信しました。
          </p>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">ダウンロードURL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                {result.url}
              </code>
              <button
                onClick={() => copyText(result.url, "URL")}
                className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                コピー
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">パスワード</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-gray-50 px-3 py-2 text-lg font-mono tracking-widest text-gray-800">
                {result.password}
              </code>
              <button
                onClick={() => copyText(result.password, "パスワード")}
                className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                コピー
              </button>
            </div>
            <p className="mt-2 text-xs text-red-500">
              ⚠ パスワードはこの画面でのみ表示されます。この画面を閉じると再表示できません
              （メールにも記載済みです）。
            </p>
          </div>

          <div className="text-xs text-gray-500">
            <p>有効期限: {formatJst(result.expiresAt)} まで（日本時間）</p>
            <p className="mt-1">
              ファイル: {result.files.map((f) => f.fileName).join(" / ")}
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Link
              href="/transfers"
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8]"
            >
              送信一覧へ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------- 入力フォーム ----------
  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/transfers" className="text-sm text-gray-400 hover:text-gray-600">
          ← 一覧へ
        </Link>
        <h1 className="text-xl font-bold text-[#374151]">ファイルを送信</h1>
      </div>

      <div className="rounded-xl bg-white p-6 shadow-sm space-y-5">
        {/* ファイル選択 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            ファイル（複数可・1件1GBまで）
          </label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            disabled={sending}
            className="block w-full text-sm text-gray-500 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:text-gray-700 hover:file:bg-gray-200"
          />
          {uploads.length > 0 && (
            <ul className="mt-3 space-y-2">
              {uploads.map((u, i) => (
                <li key={`${u.file.name}-${u.file.size}`} className="rounded border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-gray-700">
                      📄 {u.file.name}
                      <span className="ml-2 text-xs text-gray-400">
                        {formatFileSize(u.file.size)}
                      </span>
                    </span>
                    {!sending && u.status !== "done" && (
                      <button
                        onClick={() => removeFile(i)}
                        className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                      >
                        削除
                      </button>
                    )}
                  </div>
                  {(u.status === "uploading" || u.status === "done") && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-100">
                        <div
                          className={`h-full transition-all ${u.status === "done" ? "bg-green-500" : "bg-[#2563EB]"}`}
                          style={{ width: `${u.progress}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs text-gray-400">
                        {u.status === "done" ? "完了" : `${u.progress}%`}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 宛先 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            宛先メールアドレス <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            disabled={sending}
            placeholder="example@client.co.jp"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* 件名 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">件名（任意）</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            placeholder="例: ご契約書類の送付"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* 添え書き */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">添え書き（任意）</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
            rows={3}
            placeholder="メール本文に追記するメッセージ"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
        </div>

        {/* 有効期限 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">有効期限</label>
          <select
            value={expiresDays}
            onChange={(e) => setExpiresDays(parseInt(e.target.value, 10))}
            disabled={sending}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日{d === 7 ? "（推奨）" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            期限日の23:59（日本時間）まで有効。期限を過ぎるとファイルは自動削除されます。
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {sending ? "アップロード・送信中..." : "パスワードを発行してメール送信"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            パスワードは自動生成され、URLとあわせて宛先へメールで届きます
          </p>
        </div>
      </div>
    </div>
  );
}
