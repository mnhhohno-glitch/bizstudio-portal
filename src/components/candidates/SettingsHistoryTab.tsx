"use client";

import { useEffect, useState, useCallback } from "react";

type SettingsHistory = {
  id: string;
  sentAt: string;
  sendType: string;
  sendResult: string;
  templateName: string;
  senderName: string;
  /** T-193追補2: 送信できなかった理由などの補足（既存レコードは null） */
  note?: string | null;
};

const SEND_TYPE_LABEL: Record<string, string> = {
  MYNAVI_FIRST_REPLY: "マイナビ一次返信",
  MYNAVI_RESEND: "マイナビ再送信",
  // T-193追補2: portal から Resend で送るメール。マイナビ上の返信とは別物なので表記を分ける。
  MYNAVI_FIRST_REPLY_MAIL: "マイナビ一次返信メール",
};

/**
 * T-193追補2: sendResult の表示。
 * NO_EMAIL は「送信に失敗した」のではなく「アドレスが無いので送っていない」ため、
 * 赤の「失敗」ではなくグレーの中立表示にする（SUCCESS / それ以外の既存表示は変えない）。
 */
function sendResultBadge(sendResult: string): { label: string; className: string } {
  if (sendResult === "SUCCESS") {
    return { label: "成功", className: "border-green-200 bg-green-50 text-green-700" };
  }
  if (sendResult === "NO_EMAIL") {
    return {
      label: "未送信（アドレス未登録）",
      className: "border-gray-200 bg-gray-50 text-gray-600",
    };
  }
  return { label: "失敗", className: "border-red-200 bg-red-50 text-red-700" };
}

function formatDateTimeJST(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SettingsHistoryTab({
  candidateId,
}: {
  candidateId: string;
}) {
  const [histories, setHistories] = useState<SettingsHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/candidates/${candidateId}/settings-history`);
    if (res.ok) {
      const data = await res.json();
      setHistories(data.histories || []);
    }
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-gray-400">読み込み中...</p>;
  }

  if (histories.length === 0) {
    return (
      <p className="text-sm text-gray-400">設定履歴はまだありません</p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">全{histories.length}件</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-medium">送信日時</th>
              <th className="px-4 py-3 text-left font-medium">送信種別</th>
              <th className="px-4 py-3 text-left font-medium">送信結果</th>
              <th className="px-4 py-3 text-left font-medium">送信文章名</th>
              <th className="px-4 py-3 text-left font-medium">送信担当者</th>
              <th className="px-4 py-3 text-left font-medium">備考</th>
            </tr>
          </thead>
          <tbody>
            {histories.map((h) => {
              const badge = sendResultBadge(h.sendResult);
              return (
              <tr key={h.id} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                  {formatDateTimeJST(h.sentAt)}
                </td>
                <td className="px-4 py-3">
                  {SEND_TYPE_LABEL[h.sendType] || h.sendType}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">{h.templateName}</td>
                <td className="px-4 py-3 text-gray-700">{h.senderName}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{h.note || ""}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
