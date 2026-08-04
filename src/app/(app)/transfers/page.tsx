"use client";

// T-147: セキュアファイル送信の一覧画面（ログイン必須・admin/member 両方可）。
// 全社員の送信を閲覧できる（社内の証跡目的）。無効化は送信者本人と admin のみ（APIで判定）。
// 複数宛先送信（同一 batch_id）は1行のグループにまとめ、展開すると宛先ごとの状態
// （未DL / DL済 / 無効化）・個別無効化・ダウンロード履歴が見える。
// グループ単位の一括無効化と宛先単位の個別無効化の両方に対応する。

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

type FileRow = { id: string; fileName: string; fileSize: number; deletedAt: string | null };

type TransferRow = {
  id: string;
  recipientEmail: string;
  subject: string | null;
  expiresAt: string;
  revokedAt: string | null;
  failedAttempts: number;
  passwordInEmail: boolean;
  batchId: string | null;
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

// 複数宛先送信は batchId で1グループに束ねる。旧レコード（batchId=null）は1件1グループ。
type TransferGroup = { key: string; rows: TransferRow[] };

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

/** グループ行の状態表示: 全件同一ならバッジ1つ、混在なら内訳を出す。 */
function GroupStatus({ rows }: { rows: TransferRow[] }) {
  const counts = { active: 0, expired: 0, revoked: 0 };
  for (const r of rows) counts[r.status]++;
  const kinds = (Object.keys(counts) as (keyof typeof counts)[]).filter((k) => counts[k] > 0);
  if (kinds.length === 1) return <StatusBadge status={kinds[0]} />;
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-0.5 text-xs text-gray-600">
          <StatusBadge status={k} />
          <span>{counts[k]}</span>
        </span>
      ))}
    </span>
  );
}

/** 宛先ごとの DL 状態（未DL / DL済 / 無効化はバッジ側で表現）。 */
function DownloadState({ row }: { row: TransferRow }) {
  return row.downloadCount > 0 ? (
    <span className="text-green-700">DL済 {row.downloadCount}回</span>
  ) : (
    <span className="text-gray-400">未DL</span>
  );
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);

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

  // createdAt 降順の並びを保ったまま batchId でグループ化する
  const groups = useMemo<TransferGroup[]>(() => {
    const map = new Map<string, TransferGroup>();
    const list: TransferGroup[] = [];
    for (const t of transfers) {
      const key = t.batchId ? `batch:${t.batchId}` : `single:${t.id}`;
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(t);
      } else {
        const g = { key, rows: [t] };
        map.set(key, g);
        list.push(g);
      }
    }
    return list;
  }, [transfers]);

  const loadDetail = async (id: string) => {
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

  const toggleGroup = (g: TransferGroup) => {
    if (expandedGroupKey === g.key) {
      setExpandedGroupKey(null);
      setDetailId(null);
      setDetail(null);
      return;
    }
    setExpandedGroupKey(g.key);
    setDetailId(null);
    setDetail(null);
    // 1件だけのグループは展開と同時にダウンロード履歴まで表示する（従来挙動）
    if (g.rows.length === 1) {
      loadDetail(g.rows[0].id);
    }
  };

  const handleRevoke = async (t: TransferRow) => {
    if (
      !window.confirm(
        `${t.recipientEmail} 宛の送信を無効化します。\n無効化すると受信者はダウンロードできなくなります（元に戻せません）。よろしいですか？`
      )
    ) {
      return;
    }
    setRevokingKey(t.id);
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
      setRevokingKey(null);
    }
  };

  const handleRevokeBatch = async (g: TransferGroup) => {
    const batchId = g.rows[0].batchId;
    if (!batchId) return;
    const targetCount = g.rows.filter((r) => !r.revokedAt).length;
    if (
      !window.confirm(
        `この送信の全宛先（${targetCount}件）を一括無効化します。\n無効化すると受信者はダウンロードできなくなります（元に戻せません）。よろしいですか？`
      )
    ) {
      return;
    }
    setRevokingKey(g.key);
    try {
      const res = await fetch(`/api/transfers/batch/${batchId}/revoke`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.revokedCount}件を無効化しました`);
      await load();
      setDetailId(null);
      setDetail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "無効化に失敗しました");
    } finally {
      setRevokingKey(null);
    }
  };

  const renderDetailPanel = (t: TransferRow) => (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
      {detailLoading && <p className="text-xs text-gray-400">読み込み中...</p>}
      {detail && detail.id === t.id && (
        <div className="space-y-3">
          <div>
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
                    <span className="ml-1 text-gray-400">
                      削除済み {formatJst(f.deletedAt)}
                    </span>
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#374151]">ファイル送信</h1>
        <Link
          href="/transfers/new"
          className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D4ED8] transition-colors"
        >
          ＋ 新規送信
        </Link>
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
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  読み込み中...
                </td>
              </tr>
            )}
            {!loading && groups.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  送信履歴はまだありません
                </td>
              </tr>
            )}
            {groups.map((g) => {
              const head = g.rows[0];
              const isMulti = g.rows.length > 1;
              const totalDownloads = g.rows.reduce((s, r) => s + r.downloadCount, 0);
              const anyCanRevoke = g.rows.some((r) => r.canRevoke);
              const expanded = expandedGroupKey === g.key;
              return (
                <Fragment key={g.key}>
                  <tr
                    onClick={() => toggleGroup(g)}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatJst(head.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      {isMulti ? (
                        <span>
                          <span className="mr-1.5 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {g.rows.length}件
                          </span>
                          {head.recipientEmail}
                          <span className="text-gray-400"> 他{g.rows.length - 1}件</span>
                        </span>
                      ) : (
                        head.recipientEmail
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {head.subject && <div className="font-medium text-gray-800">{head.subject}</div>}
                      <div className="text-xs text-gray-500">
                        {head.files.map((f) => f.fileName).join(" / ")}
                        {head.filesDeleted && (
                          <span className="ml-1 text-gray-400">（ファイル削除済み）</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{head.sender.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatJst(head.expiresAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <GroupStatus rows={g.rows} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {totalDownloads > 0 ? (
                        <span className="text-green-700">済 {totalDownloads}回</span>
                      ) : (
                        <span className="text-gray-400">未</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {isMulti
                        ? anyCanRevoke && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevokeBatch(g);
                              }}
                              disabled={revokingKey === g.key}
                              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {revokingKey === g.key ? "無効化中..." : "一括無効化"}
                            </button>
                          )
                        : head.canRevoke && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevoke(head);
                              }}
                              disabled={revokingKey === head.id}
                              className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {revokingKey === head.id ? "無効化中..." : "無効化"}
                            </button>
                          )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-gray-50 bg-gray-50/60">
                      <td colSpan={8} className="px-6 py-4">
                        {isMulti ? (
                          <div className="space-y-1.5">
                            <p className="text-xs text-gray-400">
                              宛先ごとの状態（クリックでダウンロード履歴を表示）
                            </p>
                            {g.rows.map((r) => (
                              <div key={r.id}>
                                <div
                                  onClick={() => loadDetail(r.id)}
                                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50"
                                >
                                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                    {r.recipientEmail}
                                  </span>
                                  <StatusBadge status={r.status} />
                                  <span className="w-20 text-xs">
                                    <DownloadState row={r} />
                                  </span>
                                  {r.canRevoke ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRevoke(r);
                                      }}
                                      disabled={revokingKey === r.id}
                                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      {revokingKey === r.id ? "無効化中..." : "無効化"}
                                    </button>
                                  ) : (
                                    <span className="w-14" />
                                  )}
                                </div>
                                {detailId === r.id && renderDetailPanel(r)}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div>
                            {detailLoading && detailId === head.id && (
                              <p className="text-xs text-gray-400">読み込み中...</p>
                            )}
                            {detail && detail.id === head.id && renderDetailPanel(head)}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
