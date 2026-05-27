"use client";

import { useState } from "react";

interface CalendarConnectButtonProps {
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function CalendarConnectButton({
  isConnected,
  onConnect,
  onDisconnect,
}: CalendarConnectButtonProps) {
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!confirm("Googleカレンダーの連携を解除しますか？")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/calendar/disconnect", { method: "DELETE" });
      onDisconnect();
    } catch { /* */ }
    finally { setDisconnecting(false); }
  };

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-green-600">✅ Googleカレンダー / ToDo 連携中</span>
        <button
          onClick={onConnect}
          className="text-[#2563EB] hover:underline"
          title="権限スコープが更新された場合に再認証します"
        >
          再認証
        </button>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="text-gray-400 hover:text-red-500 disabled:opacity-50"
        >
          {disconnecting ? "解除中..." : "解除"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      className="text-[11px] text-gray-500 hover:text-[#2563EB] transition-colors"
    >
      🔗 Googleカレンダー / ToDo を連携
    </button>
  );
}
