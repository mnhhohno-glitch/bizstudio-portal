"use client";

// T-147: セキュアファイル送信の新規作成画面。
// - ファイルはブラウザから Supabase へ直接アップロード（署名付きアップロードURL・XHRで進捗表示）。
//   ファイル本体を portal サーバー経由で流さない（確定仕様）。
// - 複数宛先対応（改行・カンマ区切り、最大10件）。宛先ごとに URL・パスワードが個別発行される。
// - 送信ボタン → 実際に送られるメール本文の確認画面 → 送信、の2段階。
//   確認画面の本文は実送信と同じ buildTransferNoticeBody（secure-transfer-shared.ts）で組み立てる。
// - 送信完了画面で宛先ごとの URL とパスワードを一度だけ表示する（再表示不可・DBに平文なし）。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  buildDefaultTransferBodyIntro,
  buildTransferFixedBlock,
  buildTransferSignature,
  calcExpiresAt,
  MAX_TRANSFER_RECIPIENTS,
  TRANSFER_MAIL_SUBJECT,
} from "@/lib/secure-transfer-shared";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB（サーバー側と同値）

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UploadState = {
  file: File;
  progress: number; // 0-100
  status: "pending" | "uploading" | "done" | "error";
  storagePath?: string;
};

type SendResult = {
  batchId: string;
  passwordInEmail: boolean;
  expiresAt: string;
  files: { fileName: string; fileSize: number }[];
  transfers: { id: string; recipientEmail: string; url: string; password: string }[];
  failedRecipients: string[];
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
  const [recipientsText, setRecipientsText] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [expiresDays, setExpiresDays] = useState(30);
  const [passwordInEmail, setPasswordInEmail] = useState(true);
  const [step, setStep] = useState<"form" | "confirm">("form");
  // 確認画面で編集する（1）本文。確認画面に入るたびに既定文面＋添え書きから再合成する
  const [editableBody, setEditableBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [senderInfo, setSenderInfo] = useState<{ name: string; email: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 確認画面の本文プレビューに署名（送信者名・メール）を出すため、ログイン中ユーザーを取得する
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (u?.email) setSenderInfo({ name: u.name ?? u.email, email: u.email });
      })
      .catch(() => {});
  }, []);

  // 宛先: 改行・カンマ・セミコロン区切りで複数入力（空要素は無視・重複はそのまま許容）
  const recipients = useMemo(
    () =>
      recipientsText
        .split(/[\n,、;]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    [recipientsText]
  );
  const invalidRecipients = useMemo(
    () => recipients.filter((r) => !EMAIL_RE.test(r)),
    [recipients]
  );
  const tooManyRecipients = recipients.length > MAX_TRANSFER_RECIPIENTS;

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

  const canProceed =
    uploads.length > 0 &&
    recipients.length > 0 &&
    invalidRecipients.length === 0 &&
    !tooManyRecipients &&
    !sending;

  const handleProceed = () => {
    if (!canProceed) return;
    // 添え書きを下書きとして既定文面に合成する（確認画面に入り直すたびに再合成 = 添え書きの変更を反映）
    setEditableBody(buildDefaultTransferBodyIntro(message));
    setStep("confirm");
    window.scrollTo({ top: 0 });
  };

  const handleSend = async () => {
    if (sending) return;
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

      // 2) 送信レコード作成（宛先ごとに個別発行）＋メール送信
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmails: recipients,
          subject: subject.trim() || undefined,
          // 確認画面で編集された（1）本文の最終形をそのまま送る（message 列に保存される）
          message: editableBody.trim() || undefined,
          expiresDays,
          passwordInEmail,
          files: uploaded,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 全宛先失敗時はサーバー側で Storage ごとロールバック済み → 再アップロードが必要
        if (res.status === 502) {
          setUploads((prev) =>
            prev.map((u) => ({ ...u, status: "pending", progress: 0, storagePath: undefined }))
          );
        }
        throw new Error(data.error || "送信に失敗しました");
      }
      if ((data as SendResult).failedRecipients?.length > 0) {
        toast.error(
          `一部の宛先へ送信できませんでした: ${(data as SendResult).failedRecipients.join(", ")}`
        );
      }
      setResult(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "送信に失敗しました");
      setStep("form");
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
            {result.transfers.length}件の宛先へダウンロード案内メールを送信しました。
            宛先ごとに URL とパスワードが個別に発行されています。
          </p>

          {result.failedRecipients.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-600">
                以下の宛先へは送信できませんでした（レコードは作成されていません）:
              </p>
              <ul className="mt-1 text-sm text-red-600">
                {result.failedRecipients.map((r) => (
                  <li key={r}>・{r}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-red-500">
                必要に応じて、新規送信からこの宛先へ再度お送りください。
              </p>
            </div>
          )}

          {!result.passwordInEmail && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">
                パスワードはメールに記載されていません。
              </p>
              <p className="mt-1 text-xs text-amber-800">
                下記の宛先ごとのパスワードを、SMS・電話など、メール以外の方法で各受信者へお伝えください。
              </p>
              <p className="mt-1 text-sm font-semibold text-red-600">
                ⚠ この画面を閉じるとパスワードは二度と表示できません。
              </p>
            </div>
          )}

          <ul className="space-y-4">
            {result.transfers.map((t) => (
              <li key={t.id} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">{t.recipientEmail}</p>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">ダウンロードURL</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      {t.url}
                    </code>
                    <button
                      onClick={() => copyText(t.url, "URL")}
                      className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      コピー
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">パスワード</p>
                  <div className="flex items-center gap-2">
                    <code
                      className={`flex-1 rounded px-3 py-2 font-mono tracking-widest ${
                        result.passwordInEmail
                          ? "bg-gray-50 text-lg text-gray-800"
                          : "bg-amber-50 text-2xl text-gray-900 border border-amber-200"
                      }`}
                    >
                      {t.password}
                    </code>
                    <button
                      onClick={() => copyText(t.password, "パスワード")}
                      className="shrink-0 rounded border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      コピー
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-red-500">
            ⚠ パスワードはこの画面でのみ表示されます。この画面を閉じると再表示できません
            {result.passwordInEmail ? "（各宛先のメールにも記載済みです）。" : "。"}
          </p>

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

  // ---------- 送信前の確認画面 ----------
  if (step === "confirm") {
    // （2）（3）（4）は自動挿入・編集不可。プレビューは実送信と同じ関数で組み立てる
    const fixedPreview =
      buildTransferFixedBlock({
        url: "（送信時に宛先ごとに自動発行されます）",
        password: "（送信時に自動生成されます）",
        passwordInEmail,
        expiresAt: calcExpiresAt(expiresDays),
        fileNames: uploads.map((u) => u.file.name),
      }) +
      "\n\n" +
      buildTransferSignature(senderInfo?.name ?? "（送信者名）", senderInfo?.email ?? "");

    return (
      <div className="max-w-xl">
        <h1 className="mb-4 text-xl font-bold text-[#374151]">送信内容の確認</h1>
        <div className="rounded-xl bg-white p-6 shadow-sm space-y-5">
          <div className="rounded-lg bg-blue-50 px-4 py-3">
            <p className="text-sm font-semibold text-blue-800">
              この内容で {recipients.length}件に送信します
            </p>
            <p className="mt-1 text-xs text-blue-700">
              URL とパスワードは宛先ごとに個別発行されます（本文は全宛先で共通のため、1通分を表示しています）。
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">宛先（{recipients.length}件）</p>
            <ul className="space-y-1">
              {recipients.map((r, i) => (
                <li key={`${r}-${i}`} className="text-sm text-gray-800">
                  ・{r}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">メール件名</p>
            <p className="text-sm text-gray-800">{subject.trim() || TRANSFER_MAIL_SUBJECT}</p>
            {!subject.trim() && (
              <p className="mt-0.5 text-xs text-gray-400">
                件名が未入力のため既定の件名を使用します
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">
              メール本文（この欄は自由に編集できます）
            </p>
            <textarea
              value={editableBody}
              onChange={(e) => setEditableBody(e.target.value)}
              disabled={sending}
              rows={Math.min(16, Math.max(6, editableBody.split("\n").length + 1))}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-xs leading-5 text-gray-700 focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            />
            <p className="mt-1 text-xs text-gray-400">
              宛名・挨拶を含めて全文を書き換えできます。編集した内容がそのまま送信されます。
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">
              以下は自動で挿入されます（編集不可）
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-xs leading-5 text-gray-500 font-sans">
              {fixedPreview}
            </pre>
          </div>

          {sending && uploads.some((u) => u.status === "uploading") && (
            <ul className="space-y-2">
              {uploads.map((u) => (
                <li key={`${u.file.name}-${u.file.size}`} className="rounded border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-gray-700">📄 {u.file.name}</span>
                    <span className="w-10 text-right text-xs text-gray-400">
                      {u.status === "done" ? "完了" : u.status === "uploading" ? `${u.progress}%` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setStep("form")}
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              戻って修正する
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex-1 rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {sending ? "アップロード・送信中..." : "送信する"}
            </button>
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

        {/* 宛先（複数） */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            宛先メールアドレス <span className="text-red-500">*</span>
            <span className="ml-2 text-xs font-normal text-gray-400">
              改行またはカンマ区切りで最大{MAX_TRANSFER_RECIPIENTS}件
            </span>
          </label>
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            disabled={sending}
            rows={3}
            placeholder={"example1@client.co.jp\nexample2@client.co.jp"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
          />
          {recipients.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recipients.map((r, i) => {
                const valid = EMAIL_RE.test(r);
                return (
                  <span
                    key={`${r}-${i}`}
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${
                      valid
                        ? "bg-blue-50 text-blue-700"
                        : "bg-red-50 text-red-600 border border-red-200"
                    }`}
                  >
                    {r}
                    {!valid && " ⚠"}
                  </span>
                );
              })}
            </div>
          )}
          {invalidRecipients.length > 0 && (
            <p className="mt-1 text-xs text-red-500">
              形式が正しくないアドレスがあります: {invalidRecipients.join(", ")}
            </p>
          )}
          {tooManyRecipients && (
            <p className="mt-1 text-xs text-red-500">
              宛先は最大{MAX_TRANSFER_RECIPIENTS}件までです（現在 {recipients.length}件）
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            宛先ごとに URL とパスワードが個別に発行され、メールも1通ずつ送信されます。
          </p>
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
          <p className="mt-1 text-xs text-gray-400">
            そのままメールの件名になります。空欄の場合は「{TRANSFER_MAIL_SUBJECT}」が使われます。
          </p>
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
          <p className="mt-1 text-xs text-gray-400">
            ここに書いた内容は、次の確認画面で全文を編集できます。URL・パスワード・有効期限・署名は自動で入ります。
          </p>
        </div>

        {/* パスワード送付方式 */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">パスワードの伝え方</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="passwordInEmail"
                checked={passwordInEmail}
                onChange={() => setPasswordInEmail(true)}
                disabled={sending}
                className="mt-0.5"
              />
              <span>
                パスワードをメールに記載する（既定）
                <span className="block text-xs text-gray-400">
                  URLと同じメールにパスワードも記載されます
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="passwordInEmail"
                checked={!passwordInEmail}
                onChange={() => setPasswordInEmail(false)}
                disabled={sending}
                className="mt-0.5"
              />
              <span>
                メールに記載しない
                <span className="block text-xs text-gray-400">
                  送信完了画面にパスワードが表示されるので、SMS・電話など別の方法で伝えます
                </span>
              </span>
            </label>
          </div>
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
                {d}日{d === 30 ? "（推奨）" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            期限日の23:59（日本時間）まで有効。期限を過ぎるとファイルは自動削除されます。
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={handleProceed}
            disabled={!canProceed}
            className="w-full rounded-lg bg-[#2563EB] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            パスワードを発行してメール送信
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            次の画面で、実際に送信されるメール本文を確認してから送信します
          </p>
        </div>
      </div>
    </div>
  );
}
