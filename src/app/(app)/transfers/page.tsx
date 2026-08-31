"use client";

// T-147: セキュアファイル送信の一覧画面（ログイン必須・admin/member 両方可）。
// 全社員の送信を閲覧できる（社内の証跡目的）。無効化は送信者本人と admin のみ（APIで判定）。
//
// 2026-08-06 改修: 宛先ごとの個別送信をやめ TO/CC の1通送信にしたため、
// batch_id によるグループ化・展開・一括無効化を廃止し「1送信＝1行」の表示に戻した。
// 行をクリックするとダウンロード履歴（日時・IP）が開く。誰がダウンロードしたかは特定できない。
//
// 後方互換: 旧仕様（宛先ごとに1レコード）で作られた過去の送信は、そのまま1行ずつ表示される。
// 旧レコードは recipient_email が単一アドレス・cc_emails が null なので、
// カンマ分割（splitStoredEmails）でそのまま1件として扱える。

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { splitStoredEmails } from "@/lib/secure-transfer-shared";

type FileRow = { id: string; fileName: string; fileSize: number; deletedAt: string | null };

type TransferRow = {
  id: string;
  recipientEmail: string; // TO（複数はカンマ区切り）
  ccEmails: string | null; // CC（複数はカンマ区切り）。CC 無し・旧レコードは null
  subject: string | null;
  expiresAt: string;
  revokedAt: string | null;
  failedAttempts: number;
  passwordInEmail: boolean;
  batchId: string | null; // 旧仕様の名残。表示には使わない
  createdAt: string;
  status: "active" | "expired" | "revoked";
  filesDeleted: boolean;
  sender: { id: string; name: string };
  files: FileRow[];
  downloadCount: number;
  canRevoke: boolean;
};

type DownloadRow = {
  id: string;
  fileName: string | null;
  downloadedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

type TransferDetail = TransferRow & { downloads: DownloadRow[] };

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function StatusBadge({ status }: { status: TransferRow["status"] }) {
  const map = {
    active: { label: "有効", cls: "bg-green-100 text-green-700" },
    expired: { label: "期限切れ", cls: "bg-gray-100 text-gray-500" },
    revoked: { label: "無効化済み", cls: "bg-red-100 text-red-600" },
  } as const;
  const { label, cls } = map[status];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

/** アドレス一覧を「先頭アドレス 他N件」に省略して表示する（全件は展開時に出す）。 */
function AddressSummary({ emails }: { emails: string[] }) {
  if (emails.length === 0) return <span className="text-gray-300">-</span>;
  return (
    <span>
      {emails[0]}
      {emails.length > 1 && (
        <span className="text-gray-400"> 他{emails.length - 1}件</span>
      )}
    </span>
  );
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transfers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTransfers(data.transfers || []);
    } catch {
      toast.error("一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDetail = async (id: string) => {
    if (detailId === id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/transfers/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetail(data);
    } catch {
      toast.error("詳細の取得に失敗しました");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRevoke = async (t: TransferRow) => {
    const toList = splitStoredEmails(t.recipientEmail);
    const label = toList.length > 1 ? `${toList[0]} 他${toList.length - 1}件` : toList[0];
    if (
      !window.confirm(
        `${label} 宛の送信を無効化します。\n無効化すると受信者はダウンロードできなくなります（元に戻せません）。よろしいですか？`
      )
    ) {
      return;
    }
    setRevokingId(t.id);
    try {
      const res = await fetch(`/api/transfers/${t.id}/revoke`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("無効化しました");
      await load();
      setDetailId(null);
      setDetail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "無効化に失敗しました");
    } finally {
      setRevokingId(null);
    }
  };

  const renderDetailPanel = (t: TransferRow) => {
    const toList = splitStoredEmails(t.recipientEmail);
    const ccList = splitStoredEmails(t.ccEmails);
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        {detailLoading && <p className="text-xs text-gray-400">読み込み中...</p>}
        {detail && detail.id === t.id && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-500">宛先: </span>
                {toList.join(", ")}
              </p>
              {ccList.length > 0 && (
                <p className="text-xs text-gray-600">
                  <span className="font-semibold text-gray-500">CC: </span>
                  {ccList.join(", ")}
                </p>
              )}
              <p className="text-xs text-gray-600">
                <span className="font-semibold text-gray-500">パスワード: </span>
                {detail.passwordInEmail ? "メール記載" : "別途連絡"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">ファイル</p>
              <ul className="text-xs text-gray-600 space-y-0.5">
                {detail.files.map((f) => (
                  <li key={f.id}>
                    📄 {f.fileName}（{formatFileSize(f.fileSize)}）
                    {f.deletedAt && (
                      <span className="ml-1 text-gray-400">削除済み {formatJst(f.deletedAt)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                ダウンロード履歴（{detail.downloads.length}件）
              </p>
              {detail.downloads.length === 0 ? (
                <p className="text-xs text-gray-400">まだダウンロードされていません</p>
              ) : (
                <>
                  <table className="text-xs text-gray-600">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pr-6 py-1 font-medium">日時</th>
                        <th className="pr-6 py-1 font-medium">ファイル</th>
                        <th className="pr-6 py-1 font-medium">IPアドレス</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.downloads.map((d) => (
                        <tr key={d.id}>
                          <td className="pr-6 py-0.5 whitespace-nowrap">
                            {formatJst(d.downloadedAt)}
                          </td>
                          <td className="pr-6 py-0.5">{d.fileName ?? "-"}</td>
                          <td className="pr-6 py-0.5 font-mono">{d.ipAddress ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {toList.length + ccList.length > 1 && (
                    <p className="mt-1 text-xs text-gray-400">
                      ※ 受信者全員が同じURLを使うため、どの受信者がダウンロードしたかは特定できません。
                    </p>
                  )}
                </>
              )}
            </div>
            {detail.failedAttempts > 0 && (
              <p className="text-xs text-amber-600">
                ⚠ パスワード入力失敗: {detail.failedAttempts}回
                {detail.status === "revoked" &&
                  detail.failedAttempts >= 10 &&
                  "（上限到達により自動無効化）"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#374151]">ファイル送信</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/transfers/templates"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            テンプレート管理
          </Link>
          <Link
            href="/transfers/new"
            className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8] transition-colors"
          >
            ＋ 新規送信
          </Link>
        </div>
      </div>

      <p className="mb-4 text-xs text-gray-500">
        クライアント企業へファイルをパスワード付きURLで送付します。全社員の送信履歴が表示されます（証跡）。
      </p>

      <div className="rounded-xl bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
              <th className="px-4 py-3 font-medium">送信日時</th>
              <th className="px-4 py-3 font-medium">宛先</th>
              <th className="px-4 py-3 font-medium">CC</th>
              <th className="px-4 py-3 font-medium">件名 / ファイル</th>
              <th className="px-4 py-3 font-medium">送信者</th>
              <th className="px-4 py-3 font-medium">有効期限</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3 font-medium">DL状況</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  読み込み中...
                </td>
              </tr>
            )}
            {!loading && transfers.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  送信履歴はまだありません
                </td>
              </tr>
            )}
            {transfers.map((t) => (
              <Fragment key={t.id}>
                <tr
                  onClick={() => toggleDetail(t.id)}
                  className="cursor-pointer border-b border-gray-50 hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {formatJst(t.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    <AddressSummary emails={splitStoredEmails(t.recipientEmail)} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <AddressSummary emails={splitStoredEmails(t.ccEmails)} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {t.subject && <div className="font-medium text-gray-800">{t.subject}</div>}
                    <div className="text-xs text-gray-500">
                      {t.files.map((f) => f.fileName).join(" / ")}
                      {t.filesDeleted && (
                        <span className="ml-1 text-gray-400">（ファイル削除済み）</span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t.sender.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {formatJst(t.expiresAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {t.downloadCount > 0 ? (
                      <span className="text-green-700">済 {t.downloadCount}回</span>
                    ) : (
                      <span className="text-gray-400">未</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {t.canRevoke && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevoke(t);
                        }}
                        disabled={revokingId === t.id}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {revokingId === t.id ? "無効化中..." : "無効化"}
                      </button>
                    )}
                  </td>
                </tr>
                {detailId === t.id && (
                  <tr className="border-b border-gray-50 bg-gray-50/60">
                    <td colSpan={9} className="px-6 py-4">
                      {renderDetailPanel(t)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
